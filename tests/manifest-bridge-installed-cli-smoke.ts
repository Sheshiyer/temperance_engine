#!/usr/bin/env bun
/** Explicit, opt-in source qualification. Registry downloads occur only during
 * the frozen dependency install; runtime commands use guarded disposable roots.
 * Not a default test, an OS sandbox, or a server/PostgreSQL health receipt. */
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { buildCopyInventory, assertWorkingCopyMatches } from "../package/install-surface/src/copy-inventory.ts";
import { compileFragments } from "../package/install-surface/src/compile.ts";
import { canonical } from "../package/install-surface/src/canonical-json.ts";
import { executePlan, rollbackTransaction } from "../package/install-surface/src/lifecycle/executor.ts";
import { createPlan } from "../package/install-surface/src/lifecycle/planner.ts";
import type { LifecycleIO } from "../package/install-surface/src/lifecycle/journal.ts";

const checkout = resolve(import.meta.dir, "..");
const graph = ["activation.ts", "capabilities.ts", "catalog.ts", "cli.ts", "codegraph.ts", "contract.ts", "contracts/routing-observation-receipt.v1.ts", "control-ledger.ts", "diagnostics.ts", "doctor.ts", "event-input.ts", "hook-adapter.ts", "project.ts", "routing-observation.ts", "runtime-status.ts", "server.ts", "store.ts", "types.ts", "watcher.ts", "workflow-projection.ts"];
const digest = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
type Leaf = { path: string; sha256: string; mode: number };
let stage = "opt-in";
let childDiagnostic = "none";
const contained = (root: string, candidate: string) => { const rel = relative(root, resolve(candidate)); return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel); };
async function inventory(root: string, skip = new Set<string>()): Promise<Leaf[]> {
  const result: Leaf[] = [];
  async function visit(dir: string) {
    for (const name of (await fs.readdir(dir)).sort()) {
      const path = join(dir, name), rel = relative(root, path);
      if (skip.has(rel)) continue;
      const stat = await fs.lstat(path);
      assert(!stat.isSymbolicLink(), "INVENTORY_SYMLINK");
      if (stat.isDirectory()) await visit(path);
      else { assert(stat.isFile(), "INVENTORY_NONREGULAR"); result.push({ path: rel, sha256: digest(await fs.readFile(path)), mode: stat.mode & 0o7777 }); }
    }
  }
  await visit(root); return result;
}
async function processResult(args: string[], cwd: string, env: Record<string, string>, input?: string) {
  const process = Bun.spawn(args, { cwd, env, stdin: input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
  if (input !== undefined) { (process.stdin as any).write(input); (process.stdin as any).end(); }
  const timeout = setTimeout(() => process.kill(), 90_000);
  const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]).finally(() => clearTimeout(timeout));
  childDiagnostic = stderr.match(/\bCLI_[A-Z_]+\b/u)?.[0] || (/(?:Cannot find|ModuleNotFound)/u.test(stderr) ? "MODULE_NOT_FOUND" : stderr ? "OTHER_RUNTIME_DIAGNOSTIC" : "none");
  return { code, stdout, stderr };
}
async function main() {
  assert.deepEqual(process.argv.slice(2), ["--install-locked-dependencies"], "EXPLICIT_DEPENDENCY_INSTALL_FLAG_REQUIRED");
  stage = "source-preflight";
  const fragment = JSON.parse(await fs.readFile(join(checkout, "package/install-surface/fragments/manifest.json"), "utf8"));
  const record = fragment.records.find((item: any) => item.id === "manifest.bridge-runtime");
  const provenance = JSON.parse(await fs.readFile(join(checkout, "package/install-surface/copy-expectations.provenance.json"), "utf8"));
  const built = buildCopyInventory({ repositoryRoot: checkout, revision: provenance.revision, records: [record] });
  assert.equal(canonical(built.expectations.get(record.id)), canonical(record.verification.expected));
  assert.deepEqual(built.provenance.records[0], provenance.records.find((item: any) => item.id === record.id));
  assertWorkingCopyMatches({ repositoryRoot: checkout, records: [record], expectations: built.expectations });
  assert.equal(record.destination.root_token, "TEMPERANCE_STATE");
  assert.equal(record.destination.relative_path, "runtime/manifest-bridge");
  const expected = record.verification.expected;
  assert.equal(expected.kind, "tree");
  assert.deepEqual(Object.keys(expected.files).filter(path => path.startsWith("src/")).sort(), graph.map(path => `src/${path}`).sort());
  const imports: { from: string; to: string; kind: string }[] = [], dynamic: string[] = [];
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  for (const name of graph) {
    const text = await fs.readFile(join(checkout, record.source, "src", name), "utf8");
    if (/\bimport\s*\(/u.test(text)) dynamic.push(name);
    for (const edge of transpiler.scan(text).imports) {
      if (edge.path.startsWith(".")) {
        const target = relative("src", resolve("src", dirname(name), edge.path));
        assert(graph.includes(target.endsWith(".ts") ? target : `${target}.ts`), "UNDECLARED_STATIC_LOCAL_IMPORT");
      } else assert(edge.path.startsWith("node:") || edge.path === "pg", "UNDECLARED_PACKAGE_IMPORT");
      imports.push({ from: name, to: edge.path, kind: edge.kind });
    }
  }
  // The sole nonliteral dynamic source import is the dormant host capture
  // validator in capabilities.ts. The runtime import guard denies it; this
  // command-specific qualification does not claim that validator's closure.
  assert.deepEqual(dynamic, ["capabilities.ts"]);
  const compiled = compileFragments([{ name: "manifest.json", contents: JSON.stringify({ ...fragment, records: [record] }) }], { isaText: await fs.readFile(join(checkout, "ISA.md"), "utf8"), requirementsText: await fs.readFile(join(checkout, ".planning/REQUIREMENTS.md"), "utf8") });
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "manifest-cli-smoke-")));
  try {
    const repository = join(root, "repository"), state = join(root, "state"), installed = join(state, record.destination.relative_path), data = join(root, "data");
    for (const path of [repository, state, data]) await fs.mkdir(path);
    for (const leaf of Object.keys(expected.files)) {
      const source = join(checkout, record.source, leaf), target = join(repository, record.source, leaf);
      await fs.mkdir(dirname(target), { recursive: true }); await fs.writeFile(target, await fs.readFile(source)); await fs.chmod(target, parseInt(expected.modes[leaf], 8));
    }
    await fs.mkdir(join(repository, "package/install-surface"), { recursive: true });
    await fs.writeFile(join(repository, "package/install-surface/install-surface-manifest.lock.json"), compiled.canonicalBytes);
    await fs.mkdir(join(installed, "src"), { recursive: true });
    await fs.writeFile(join(installed, "src/cli.ts"), "// synthetic prior installation\n"); await fs.chmod(join(installed, "src/cli.ts"), 0o640);
    await fs.writeFile(join(installed, "unknown-sentinel.txt"), "user-owned sentinel\n");
    await fs.writeFile(join(data, "retained-history.jsonl"), '{"schema":"synthetic.history.v1"}\n');
    const prior = await inventory(state), history = await inventory(data), repositoryBefore = await inventory(repository);
    const guard = (path: string, mutation = false) => { assert(contained(mutation ? state : root, path), "LIFECYCLE_ROOT_ESCAPE"); return path; };
    const forbidden = async () => { throw new Error("LIFECYCLE_EXTERNAL_EFFECT_FORBIDDEN"); };
    const io: LifecycleIO = {
      mkdir: async (p, o) => { await fs.mkdir(guard(p, true), o); }, writeFile: (p, d) => fs.writeFile(guard(p, true), d),
      readFile: p => fs.readFile(guard(p), "utf8"), readdir: p => fs.readdir(guard(p)), lstat: p => fs.lstat(guard(p)),
      rm: (p, o) => fs.rm(guard(p, true), o), chmod: (p, m) => fs.chmod(guard(p, true), m), rename: (a, b) => fs.rename(guard(a, true), guard(b, true)),
      realpath: async p => guard(await fs.realpath(guard(p))), now: () => new Date("2026-09-07T00:00:00.000Z"),
      writeFileAtomic: async (p, d, o) => { const temporary = guard(`${p}.stage`, true); await fs.writeFile(temporary, d, { flag: "wx", mode: o?.mode ?? 0o600 }); await fs.chmod(temporary, o?.mode ?? 0o600); await fs.rename(temporary, guard(p, true)); },
      fetch: forbidden, execFile: forbidden,
    };
    const resolveRoot = (token: string) => { assert.equal(token, "TEMPERANCE_STATE"); return state; };
    const verifySources = async () => {
      for (const leaf of Object.keys(expected.files)) { const target = join(installed, leaf); assert.equal(`sha256:${digest(await fs.readFile(target))}`, expected.files[leaf], "INSTALLED_SOURCE_DRIFT"); assert.equal((await fs.lstat(target)).mode & 0o7777, parseInt(expected.modes[leaf], 8), "INSTALLED_MODE_DRIFT"); }
    };
    stage = "lifecycle-copy";
    const applied = await executePlan({ repositoryRoot: repository, stateRoot: state, io, compileResult: compiled, verb: "install", profile: "default", resolveRoot, plan: createPlan({ verb: "install", profileResult: compiled, profile: "default", platform: "darwin" }) });
    assert.equal(applied.status, "committed"); await verifySources();
    const preload = join(root, "cli-preload.ts");
    await fs.writeFile(preload, await fs.readFile(join(checkout, "tests/fixtures/routing-observation/cli-preload.ts")));
    const runtimeManifest = async () => {
      const files = (await inventory(installed)).map(leaf => ({ ...leaf, path: relative(root, join(installed, leaf.path)) }));
      await fs.writeFile(join(root, "runtime-files.json"), JSON.stringify(files)); return files;
    };
    const cli = (command: string, input?: string) => processResult([process.execPath, "--no-env-file", "--preload", preload, join(installed, "src/cli.ts"), command, "--all"], root, { TEMPERANCE_MANIFEST_STATE_DIR: data }, input);
    stage = "missing-pg-control";
    await runtimeManifest();
    assert(!(await fs.exists(join(installed, "node_modules/pg"))));
    const missing = await cli("snapshot"); assert.notEqual(missing.code, 0); assert.equal(missing.stdout, ""); assert(missing.stderr.includes("CLI_DEPENDENCY_MISSING")); assert.deepEqual(await inventory(data), history);
    stage = "source-drift-control";
    const sourcePath = join(installed, "src/cli.ts"), sourceBytes = await fs.readFile(sourcePath);
    await fs.appendFile(sourcePath, "\n"); await assert.rejects(verifySources, /INSTALLED_SOURCE_DRIFT/); await fs.writeFile(sourcePath, sourceBytes); await verifySources();
    stage = "locked-dependency-install";
    const packageBefore = await fs.readFile(join(installed, "package.json")), lockBefore = await fs.readFile(join(installed, "bun.lock"));
    const cache = join(root, "cache"), config = join(root, "bunfig.toml"); await fs.writeFile(config, "");
    const installedDependencies = await processResult([process.execPath, "--no-env-file", `--config=${config}`, "install", "--frozen-lockfile", "--ignore-scripts", `--cache-dir=${cache}`, "--backend=copyfile", "--linker=hoisted", "--registry=https://registry.npmjs.org", "--no-progress"], installed, {});
    assert.equal(installedDependencies.code, 0, "LOCKED_INSTALL_FAILED");
    assert.deepEqual(await fs.readFile(join(installed, "package.json")), packageBefore); assert.deepEqual(await fs.readFile(join(installed, "bun.lock")), lockBefore); await verifySources();
    const dependencyRoot = join(installed, "node_modules"), dependencies = await inventory(dependencyRoot);
    const lock = Bun.JSON5.parse(lockBefore.toString("utf8"));
    for (const [name, value] of Object.entries(lock.packages) as [string, any][]) {
      const pkg = JSON.parse(await fs.readFile(join(dependencyRoot, name, "package.json"), "utf8")); assert.equal(`${pkg.name}@${pkg.version}`, value[0], "LOCKED_PACKAGE_VERSION_DRIFT");
    }
    await runtimeManifest();
    stage = "offline-runtime";
    const snapshot = await cli("snapshot"); assert.equal(snapshot.code, 0, "SNAPSHOT_FAILED"); assert.equal(snapshot.stderr, "");
    const projected = JSON.parse(snapshot.stdout); assert.equal(projected.event_count, 0); assert.deepEqual(projected.routing_observations, {});
    const emitted = await cli("emit", '{"schema":"temperance.manifest.event.v1","kind":"routing.observation.recorded"}\n');
    assert.equal(emitted.code, 1); assert.equal(emitted.stderr, ""); assert.deepEqual(JSON.parse(emitted.stdout), { accepted: false, error: "observation_disabled" });
    assert.deepEqual(await inventory(data), history); await verifySources(); assert.deepEqual(await inventory(dependencyRoot), dependencies);
    stage = "rollback";
    assert.equal((await rollbackTransaction(applied.txid, state, io, { resolveRoot })).status, "committed");
    assert.deepEqual(await inventory(state, new Set(["transactions", "runtime/manifest-bridge/node_modules"])), prior);
    assert.deepEqual(await inventory(dependencyRoot), dependencies); assert.deepEqual(await inventory(data), history); assert.deepEqual(await inventory(repository), repositoryBefore);
    console.log(JSON.stringify({ schema: "temperance.offline-cli-smoke.v1", source_revision: provenance.revision, source_files: Object.keys(expected.files).length, static_source_modules: graph.length, source_graph_sha256: digest(JSON.stringify(imports)), source_expectation_sha256: built.provenance.records[0].expectation_digest, dependency_packages: Object.keys(lock.packages).length, dependency_files: dependencies.length, dependency_tree_sha256: digest(JSON.stringify(dependencies)), lock_sha256: digest(lockBefore), missing_dependency_rejected: true, changed_source_rejected: true, snapshot_events: 0, observation_emission: "disabled", source_rollback: "restored", sentinels_dependencies_history: "preserved", guards: "not-an-os-sandbox", dormant_host_validator: "unexercised", network_scope: "locked-registry-install-only" }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
await main().catch((error) => { const reason = typeof error?.message === "string" ? error.message.match(/^[A-Z][A-Z_]+/u)?.[0] || "ASSERTION_FAILED" : "UNKNOWN_FAILURE"; console.error(`CLI_SMOKE_FAILED:${stage}:${reason}:${childDiagnostic}`); process.exitCode = 1; });
