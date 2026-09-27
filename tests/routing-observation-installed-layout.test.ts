import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { compileFragments } from "../package/install-surface/src/compile.ts";
import { executePlan, rollbackTransaction } from "../package/install-surface/src/lifecycle/executor.ts";
import { createPlan } from "../package/install-surface/src/lifecycle/planner.ts";
import type { LifecycleIO } from "../package/install-surface/src/lifecycle/journal.ts";

const checkout = resolve(import.meta.dir, "..");
// Explicit bounded runtime graph, not a whole-bridge closure declaration. The
// source snapshot is computed before installation; RO-06 owns pinned promotion
// provenance and the production inventory. Type-only edges are included too.
const groups = [
  { source: "package/router", installed: "router", files: ["routing-observation-adapter.ts", "contracts/routing-observation-receipt.v1.ts"] },
  { source: "package/manifest-bridge", installed: "runtime/manifest-bridge", files: ["src/routing-observation.ts", "src/store.ts", "src/catalog.ts", "src/contract.ts", "src/types.ts", "src/project.ts", "src/contracts/routing-observation-receipt.v1.ts"] },
] as const;
const builtins = ["node:util", "node:crypto", "node:fs", "node:path", "node:child_process", "node:os"].sort();
const entrypoints = ["router/routing-observation-adapter.ts", "runtime/manifest-bridge/src/routing-observation.ts", "runtime/manifest-bridge/src/store.ts", "runtime/manifest-bridge/src/catalog.ts"];
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
type Entry = { source: string; installed: string; sha256: string; size: number; mode: number };
type Closure = { schema: string; product_source_commit: string; contract_sha256: string; entries: Entry[]; builtins: string[]; entrypoints: string[]; digest: string };
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel); };

async function regularFile(root: string, path: string): Promise<Buffer> {
  if (!inside(root, path)) throw new Error("CLOSURE_PATH_ESCAPE");
  for (let current = path; current !== root; current = dirname(current)) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error("CLOSURE_SYMLINK");
  }
  const stat = await fs.lstat(path);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error("CLOSURE_NONREGULAR_FILE");
  return fs.readFile(path);
}

async function validateClosure(root: string, closure: Closure, source = false): Promise<void> {
  const manifestBody = { ...closure } as Partial<Closure>; delete manifestBody.digest;
  if (hash(JSON.stringify(manifestBody)) !== closure.digest) throw new Error("CLOSURE_MANIFEST_DRIFT");
  const byPath = new Map(closure.entries.map(entry => [source ? entry.source : entry.installed, entry]));
  const scan = new Bun.Transpiler({ loader: "ts" });
  for (const [path, entry] of byPath) {
    let bytes: Buffer;
    try { bytes = await regularFile(root, join(root, path)); } catch (error: any) {
      if (error.code === "ENOENT") throw new Error("CLOSURE_DEPENDENCY_MISSING");
      throw error;
    }
    if (bytes.length !== entry.size || hash(bytes) !== entry.sha256) throw new Error("CLOSURE_HASH_DRIFT");
    if (((await fs.lstat(join(root, path))).mode & 0o7777) !== entry.mode) throw new Error("CLOSURE_MODE_DRIFT");
    const text = bytes.toString("utf8");
    // This reviewed graph has no loader indirection. Fail when one is introduced,
    // including nonliteral dynamic imports that a literal import scan can omit.
    if (/\b(?:import\s*\(|require\s*\(|eval\s*\(|new\s+Function\b)/u.test(text)) throw new Error("CLOSURE_DYNAMIC_IMPORT");
    for (const edge of scan.scan(text).imports) {
      if (edge.path.startsWith("node:") && closure.builtins.includes(edge.path)) continue;
      if (!edge.path.startsWith(".")) throw new Error("CLOSURE_EXTERNAL_IMPORT");
      const target = relative(root, resolve(root, dirname(path), edge.path));
      if (!byPath.has(target) && !byPath.has(`${target}.ts`)) throw new Error("CLOSURE_UNDECLARED_IMPORT");
    }
  }
}

async function snapshot(root: string): Promise<Record<string, { hash: string; mode: number }>> {
  const result: Record<string, { hash: string; mode: number }> = {};
  async function visit(directory: string): Promise<void> {
    for (const name of (await fs.readdir(directory)).sort()) {
      const path = join(directory, name), key = relative(root, path);
      if (key === "transactions") continue; // durable lifecycle audit retained on rollback
      const stat = await fs.lstat(path);
      if (stat.isDirectory()) await visit(path);
      else { expect(stat.isFile() && !stat.isSymbolicLink()).toBe(true); result[key] = { hash: hash(await fs.readFile(path)), mode: stat.mode & 0o7777 }; }
    }
  }
  await visit(root);
  return result;
}

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "ro05-installed-"))); roots.push(root);
  const repository = join(root, "repository"), stateRoot = join(root, "state");
  await fs.mkdir(repository); await fs.mkdir(stateRoot);
  const productSourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: checkout, encoding: "utf8" }).trim();
  const entries: Entry[] = [];
  for (const group of groups) for (const leaf of group.files) {
    const source = join(group.source, leaf), installed = join(group.installed, leaf);
    const bytes = await regularFile(checkout, join(checkout, source));
    expect(hash(execFileSync("git", ["show", `${productSourceCommit}:${source}`], { cwd: checkout }))).toBe(hash(bytes));
    const mode = (await fs.lstat(join(checkout, source))).mode & 0o7777;
    entries.push({ source, installed, sha256: hash(bytes), size: bytes.length, mode });
    await fs.mkdir(dirname(join(repository, source)), { recursive: true });
    await fs.writeFile(join(repository, source), bytes); await fs.chmod(join(repository, source), mode);
  }
  const canonicalHash = hash(await regularFile(checkout, join(checkout, "package/contracts/routing-observation-receipt.v1.ts")));
  expect(entries.filter(entry => entry.source.endsWith("/contracts/routing-observation-receipt.v1.ts")).map(entry => entry.sha256)).toEqual([canonicalHash, canonicalHash]);
  expect(hash(execFileSync("git", ["show", `${productSourceCommit}:package/contracts/routing-observation-receipt.v1.ts`], { cwd: checkout }))).toBe(canonicalHash);
  const body = { schema: "ro05.bounded-runtime-closure.v1", product_source_commit: productSourceCommit, contract_sha256: canonicalHash, entries, builtins, entrypoints };
  const closure: Closure = { ...body, digest: hash(JSON.stringify(body)) };
  await validateClosure(repository, closure, true);
  const records = groups.map((group, index) => {
    const leaves = entries.filter(entry => entry.source.startsWith(`${group.source}/`));
    return { id: `fixture.observation-${index}`, owner: "temperance-engine", class: "COPY", source: group.source,
      destination: { root_token: "TEMPERANCE_STATE", relative_path: group.installed, ownership: { kind: "exclusive-path" } },
      authority: { requirement_ids: ["PROV-02"], isa: "ISC-769" },
      eligibility: { platforms: ["darwin", "linux"], profiles: ["default"], required: true },
      verification: { method: "sha256", expected: { kind: "tree", files: Object.fromEntries(leaves.map(entry => [relative(group.source, entry.source), `sha256:${entry.sha256}`])), modes: Object.fromEntries(leaves.map(entry => [relative(group.source, entry.source), `0${entry.mode.toString(8)}`])) } },
      rollback: { policy: "restore-backup" } };
  });
  const compiled = compileFragments([{ name: "synthetic-observation.json", contents: JSON.stringify({ schema: "temperance.install-surface.fragment.v1", schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/fragment/v1", version: { major: 1, minor: 0 }, records }) }], { isaText: "- [x] ISC-769: synthetic fixture authority", requirementsText: "**PROV-02** synthetic fixture" });
  await fs.mkdir(join(repository, "package/install-surface"), { recursive: true });
  await fs.writeFile(join(repository, "package/install-surface/install-surface-manifest.lock.json"), compiled.canonicalBytes);
  for (const group of groups) {
    const prior = join(stateRoot, group.installed, group.files[0]);
    await fs.mkdir(dirname(prior), { recursive: true });
    await fs.writeFile(prior, "// synthetic prior installation\nexport const prior = true;\n"); await fs.chmod(prior, 0o640);
    await fs.writeFile(join(dirname(prior), "unknown-sentinel.txt"), "user-owned sentinel\n");
  }
  const violations: string[] = [];
  function guard(path: string, mutation = false): string {
    const absolute = resolve(path);
    if (!inside(root, absolute) || (mutation && !inside(stateRoot, absolute))) { violations.push("root"); throw new Error("DISPOSABLE_BOUNDARY_VIOLATION"); }
    return absolute;
  }
  const io: LifecycleIO = {
    mkdir: async (p, o) => { await fs.mkdir(guard(p, true), o); }, writeFile: (p, d) => fs.writeFile(guard(p, true), d),
    readFile: p => fs.readFile(guard(p), "utf8"), readdir: p => fs.readdir(guard(p)), lstat: p => fs.lstat(guard(p)),
    rm: (p, o) => fs.rm(guard(p, true), o), chmod: (p, m) => fs.chmod(guard(p, true), m),
    rename: (a, b) => fs.rename(guard(a, true), guard(b, true)), realpath: async p => guard(await fs.realpath(guard(p))), now: () => new Date("2026-09-07T00:00:00.000Z"),
    writeFileAtomic: async (p, d, o) => { const target = guard(p, true), stage = guard(`${p}.stage`, true); await fs.writeFile(stage, d, { flag: "wx", mode: o?.mode ?? 0o600 }); await fs.chmod(stage, o?.mode ?? 0o600); await fs.rename(stage, target); },
    fetch: async () => { violations.push("network"); throw new Error("NETWORK_FORBIDDEN"); }, execFile: async () => { violations.push("process"); throw new Error("PROCESS_FORBIDDEN"); },
  };
  const resolveRoot = (token: string) => { if (token !== "TEMPERANCE_STATE") throw new Error("UNINJECTED_ROOT"); return stateRoot; };
  const options = { repositoryRoot: repository, stateRoot, io, compileResult: compiled, verb: "install", profile: "default", resolveRoot, plan: createPlan({ verb: "install", profileResult: compiled, profile: "default", platform: "darwin" }) };
  let childRuns = 0;
  const run = async () => {
    await validateClosure(stateRoot, closure);
    await fs.writeFile(join(root, "closure.json"), JSON.stringify(closure));
    await fs.writeFile(join(root, "child.ts"), await fs.readFile(join(checkout, "tests/fixtures/routing-observation/installed-child.ts")));
    childRuns++;
    const child = Bun.spawn([process.execPath, "--no-env-file", join(root, "child.ts")], { cwd: root, env: {}, stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill(), 15_000);
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).finally(() => clearTimeout(timeout));
    expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: "", stderr: "" });
    return JSON.parse(await fs.readFile(join(root, "result.json"), "utf8"));
  };
  return { root, repository, stateRoot, closure, options, io, resolveRoot, violations, run, childRuns: () => childRuns };
}

test("real COPY installs a closed adapter/bridge graph, preserves receipts through replay, and fully restores prior leaves", async () => {
  const f = await fixture(), prior = await snapshot(f.stateRoot), sourceBefore = await snapshot(f.repository);
  const installed = await executePlan(f.options);
  expect(installed.status).toBe("committed");
  const transactionRoot = join(f.stateRoot, "transactions", installed.txid);
  const surface = JSON.parse(await fs.readFile(join(transactionRoot, "copy-manifest.json"), "utf8"));
  expect(surface.schema).toBe("temperance.copy-manifest.v2");
  expect(surface.leaves).toHaveLength(f.closure.entries.length);
  expect(surface.leaves.filter((leaf: any) => leaf.preimage)).toHaveLength(2);
  for (const leaf of surface.leaves) {
    if (leaf.preimage) {
      expect(hash(await fs.readFile(join(transactionRoot, leaf.preimage)))).toBe(leaf.prior_hash);
      expect(leaf.prior_mode).toBe(0o640);
    } else { expect(leaf.prior_hash).toBeNull(); expect(leaf.prior_mode).toBeNull(); }
  }
  await validateClosure(f.stateRoot, f.closure);
  const installedSnapshot = await snapshot(f.stateRoot);
  const repeated = await executePlan(f.options);
  expect(repeated.status).toBe("committed");
  expect(await snapshot(f.stateRoot)).toEqual(installedSnapshot);
  const proof = await f.run();
  expect(proof).toMatchObject({ schema: "ro05.synthetic-installed-proof.v1", event_count: 2, freshness: "stale", attribution: "unavailable" });
  expect(proof.child_env_keys).not.toContain("HOME"); expect(proof.child_env_keys).not.toContain("NODE_PATH"); expect(proof.child_env_keys).not.toContain("CODEX_HOME");
  // Each negative is rejected by preflight before another child or admission.
  const dependency = join(f.stateRoot, "runtime/manifest-bridge/src/contracts/routing-observation-receipt.v1.ts");
  const dependencyBytes = await fs.readFile(dependency), dependencyMode = (await fs.lstat(dependency)).mode & 0o7777;
  await fs.rm(dependency);
  await expect(f.run()).rejects.toThrow("CLOSURE_DEPENDENCY_MISSING");
  await fs.writeFile(dependency, dependencyBytes); await fs.chmod(dependency, dependencyMode);
  await fs.appendFile(dependency, "\n");
  await expect(f.run()).rejects.toThrow("CLOSURE_HASH_DRIFT");
  await fs.writeFile(dependency, dependencyBytes); await fs.chmod(dependency, dependencyMode);
  expect(f.childRuns()).toBe(1);
  const historyBefore = await snapshot(join(f.root, "data"));
  expect((await rollbackTransaction(repeated.txid, f.stateRoot, f.io, { resolveRoot: f.resolveRoot })).status).toBe("committed");
  expect(await snapshot(f.stateRoot)).toEqual(installedSnapshot);
  expect((await rollbackTransaction(installed.txid, f.stateRoot, f.io, { resolveRoot: f.resolveRoot })).status).toBe("committed");
  expect(await snapshot(f.stateRoot)).toEqual(prior);
  expect((await rollbackTransaction(installed.txid, f.stateRoot, f.io, { resolveRoot: f.resolveRoot })).status).toBe("committed");
  expect(await snapshot(f.stateRoot)).toEqual(prior);
  expect(await snapshot(join(f.root, "data"))).toEqual(historyBefore);
  expect(await snapshot(f.repository)).toEqual(sourceBefore);
  expect(f.violations).toEqual([]);
}, 30_000);
