import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { LifecycleIO } from "../src/lifecycle/journal.ts";
import { executePlan, rollbackTransaction } from "../src/lifecycle/executor.ts";
import { createPlan } from "../src/lifecycle/planner.ts";
import type { CompileResult } from "../src/compile.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture(source = "payload") {
  const root = mkdtempSync(join(tmpdir(), "ro00-copy-")); roots.push(root);
  const repo = join(root, "repo"), home = join(root, "target"), stateRoot = join(root, "state");
  await fs.mkdir(join(repo, "payload/nested"), { recursive: true });
  await fs.mkdir(join(home, "installed"), { recursive: true });
  await fs.writeFile(join(repo, "payload/a.txt"), "new a\n");
  await fs.writeFile(join(repo, "payload/nested/b.txt"), "new b\n");
  await fs.writeFile(join(home, "installed/a.txt"), "old a\n");
  await fs.writeFile(join(home, "installed/sentinel"), "user-owned\n");
  const io: LifecycleIO = {
    mkdir: async (p, o) => { await fs.mkdir(p, o); },
    writeFile: (p, d) => fs.writeFile(p, d), readFile: p => fs.readFile(p, "utf8"),
    readdir: p => fs.readdir(p), rm: (p, o) => fs.rm(p, o), lstat: p => fs.lstat(p),
    rename: (a, b) => fs.rename(a, b), realpath: p => fs.realpath(p), now: () => new Date(),
    writeFileAtomic: async (p, d) => { await fs.writeFile(p + ".tmp", d); await fs.rename(p + ".tmp", p); },
    execFile: async () => { throw new Error("no processes"); }, fetch: async () => { throw new Error("no network"); },
  };
  const compileResult: CompileResult = {
    lockObject: { schema: "temperance.install-surface.lock.v1", schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1", version: { major: 1, minor: 0 }, records: [{
      id: "tree", owner: "test", class: "COPY", source,
      destination: { root_token: "HOME", relative_path: "installed", ownership: { kind: "exclusive-path" } },
      authority: { requirement_ids: ["RO-00"], isa: "RO-00" },
      eligibility: { platforms: ["darwin", "linux"], profiles: ["minimal"], required: true },
      verification: { method: "sha256" }, rollback: { policy: "restore-backup" },
    }] }, canonicalBytes: "{}", digest: `sha256:${"a".repeat(64)}`, semanticIds: ["tree"],
  };
  const options = { stateRoot, io, compileResult, verb: "install", profile: "minimal",
    sourceRoot: repo, resolveRoot: () => home,
    declaredCopyHashes: { tree: { "a.txt": hash("new a\n"), "nested/b.txt": hash("new b\n") } },
    plan: createPlan({ verb: "install", profile: "minimal", profileResult: compileResult }),
  };
  return { root, repo, home, io, options };
}

test("tree COPY records deterministic manifests, restores old leaves, removes created leaves, preserves unknown sentinel", async () => {
  const f = await fixture();
  const result = await executePlan(f.options);
  expect(result.status).toBe("committed");
  expect(await fs.readFile(join(f.home, "installed/nested/b.txt"), "utf8")).toBe("new b\n");
  const manifest = JSON.parse(await fs.readFile(join(f.options.stateRoot, "transactions", result.txid, "copy-manifest.json"), "utf8"));
  expect(manifest.leaves.map((l: any) => l.relative_path)).toEqual(["installed/a.txt", "installed/nested/b.txt"]);
  expect(manifest.leaves[0].prior_hash).toBe(hash("old a\n"));
  expect(manifest.leaves[1].prior_hash).toBeNull();
  expect((await rollbackTransaction(result.txid, f.options.stateRoot, f.io, { resolveRoot: () => f.home })).status).toBe("committed");
  expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
  expect(await fs.exists(join(f.home, "installed/nested/b.txt"))).toBe(false);
  expect(await fs.readFile(join(f.home, "installed/sentinel"), "utf8")).toBe("user-owned\n");
  expect((await rollbackTransaction(result.txid, f.options.stateRoot, f.io, { resolveRoot: () => f.home })).status).toBe("committed");
});

test("declared hash mismatch and missing tree hashes fail before destination writes", async () => {
  for (const hashes of [{ tree: { "a.txt": "0".repeat(64), "nested/b.txt": hash("new b\n") } }, undefined]) {
    const f = await fixture();
    expect((await executePlan({ ...f.options, declaredCopyHashes: hashes })).status).toBe("failed");
    expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
    expect(await fs.exists(join(f.home, "installed/nested"))).toBe(false);
  }
});

test("source containment rejects traversal, symlinks, hardlinks and binary text before mutation", async () => {
  for (const kind of ["traversal", "symlink", "hardlink", "binary", "invalid-utf8"]) {
    const f = await fixture(kind === "traversal" ? "../outside" : "payload");
    if (kind === "symlink") await fs.symlink(join(f.repo, "payload/a.txt"), join(f.repo, "payload/link"));
    if (kind === "hardlink") await fs.link(join(f.repo, "payload/a.txt"), join(f.repo, "payload/link"));
    if (kind === "binary") await fs.writeFile(join(f.repo, "payload/a.txt"), "bad\0data");
    if (kind === "invalid-utf8") await fs.writeFile(join(f.repo, "payload/a.txt"), Buffer.from([0xff]));
    expect((await executePlan(f.options)).status).toBe("failed");
    expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
  }
});

test("partial promotion failure remains recoverable from an aborted transaction", async () => {
  const f = await fixture();
  const io = { ...f.io, rename: async (a: string, b: string) => { if (b.endsWith("b.txt")) throw new Error("injected"); await f.io.rename(a, b); } };
  const result = await executePlan({ ...f.options, io });
  expect(result.status).toBe("failed");
  expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("new a\n");
  expect((await rollbackTransaction(result.txid, f.options.stateRoot, f.io, { resolveRoot: () => f.home })).status).toBe("committed");
  expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
  expect(await fs.exists(join(f.home, "installed/nested/b.txt"))).toBe(false);
});

test("rollback preflights all leaves and refuses destination and preimage drift without partial restoration", async () => {
  for (const target of ["destination", "preimage"]) {
    const f = await fixture();
    const result = await executePlan(f.options);
    expect(result.status).toBe("committed");
    const txDir = join(f.options.stateRoot, "transactions", result.txid);
    const manifest = JSON.parse(await fs.readFile(join(txDir, "copy-manifest.json"), "utf8"));
    await fs.writeFile(target === "destination" ? join(f.home, "installed/a.txt") : join(txDir, manifest.leaves[0].preimage), "edited");
    expect((await rollbackTransaction(result.txid, f.options.stateRoot, f.io, { resolveRoot: () => f.home })).status).toBe("failed");
    expect(await fs.readFile(join(f.home, "installed/nested/b.txt"), "utf8")).toBe("new b\n");
  }
});

test("staged corruption is checked against declared hash before promotion", async () => {
  const f = await fixture();
  const io = { ...f.io, writeFileAtomic: async (p: string, d: string) => { await f.io.writeFileAtomic(p, p.includes(".temperance-stage-") ? "corrupt" : d); } };
  expect((await executePlan({ ...f.options, io })).status).toBe("failed");
  expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
});

test("complete declaration rejects missing and extra paths before creating journal", async () => {
  for (const delta of ["missing", "extra"]) {
    const f = await fixture();
    const declared: Record<string, string> = { ...f.options.declaredCopyHashes.tree };
    if (delta === "missing") delete declared["nested/b.txt"];
    else declared["untracked.txt"] = hash("extra");
    const result = await executePlan({ ...f.options, declaredCopyHashes: { tree: declared } });
    expect(result.status).toBe("failed");
    expect(result.outcomes[0].reason).toContain("COPY_HASH_INVENTORY_MISMATCH");
    expect(await fs.exists(f.options.stateRoot)).toBe(false);
  }
});

test("manifest corruption cannot redirect rollback to a same-content sentinel", async () => {
  const f = await fixture();
  const result = await executePlan(f.options);
  expect(result.status).toBe("committed");
  await fs.writeFile(join(f.home, "installed/sentinel"), "new b\n");
  const path = join(f.options.stateRoot, "transactions", result.txid, "copy-manifest.json");
  const manifest = JSON.parse(await fs.readFile(path, "utf8"));
  manifest.leaves[1].relative_path = "installed/sentinel";
  await fs.writeFile(path, JSON.stringify(manifest));
  expect((await rollbackTransaction(result.txid, f.options.stateRoot, f.io, { resolveRoot: () => f.home })).status).toBe("failed");
  expect(await fs.readFile(join(f.home, "installed/sentinel"), "utf8")).toBe("new b\n");
});

test("legacy absolute file COPY verifies captured bytes and removes a prior-absent file", async () => {
  const f = await fixture();
  const record = f.options.compileResult.lockObject.records[0];
  if (record.class !== "COPY") throw new Error("fixture");
  record.source = join(f.repo, "payload/a.txt");
  record.destination.relative_path = "legacy.txt";
  const result = await executePlan({ ...f.options, sourceRoot: undefined, declaredCopyHashes: undefined,
    plan: createPlan({ verb: "install", profile: "minimal", profileResult: f.options.compileResult }) });
  expect(result.status).toBe("committed");
  expect(await fs.readFile(join(f.home, "legacy.txt"), "utf8")).toBe("new a\n");
  expect((await rollbackTransaction(result.txid, f.options.stateRoot, f.io, { resolveRoot: () => f.home })).status).toBe("committed");
  expect(await fs.exists(join(f.home, "legacy.txt"))).toBe(false);
});

test("source directory ancestor symlink and destination ancestor symlink fail closed", async () => {
  for (const side of ["source", "destination"]) {
    const f = await fixture();
    if (side === "source") {
      await fs.rename(join(f.repo, "payload/nested"), join(f.repo, "elsewhere"));
      await fs.symlink(join(f.repo, "elsewhere"), join(f.repo, "payload/nested"));
    } else {
      await fs.mkdir(join(f.home, "elsewhere"));
      await fs.symlink(join(f.home, "elsewhere"), join(f.home, "installed/nested"));
    }
    expect((await executePlan(f.options)).status).toBe("failed");
    expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
  }
});

test("uninstall does not consult missing COPY sources", async () => {
  const f = await fixture();
  const record = f.options.compileResult.lockObject.records[0];
  if (record.class !== "COPY") throw new Error("fixture");
  record.source = "gone/source.txt";
  record.destination.relative_path = "installed/a.txt";
  const io = { ...f.io, readFile: async (p: string) => { if (p.startsWith(f.repo)) throw new Error("SOURCE_READ_FORBIDDEN"); return f.io.readFile(p); } };
  const result = await executePlan({ ...f.options, io, verb: "uninstall",
    plan: createPlan({ verb: "uninstall", profile: "minimal", profileResult: f.options.compileResult }) });
  expect(result.status).toBe("committed");
  expect(await fs.exists(join(f.home, "installed/a.txt"))).toBe(false);
});

test("pre-existing stage leaf is rejected and preserved without destination mutation", async () => {
  const f = await fixture();
  let planted: string | undefined;
  const io = { ...f.io, lstat: async (p: string) => {
    if (p.includes(".temperance-stage-") && !planted) { planted = p; await fs.writeFile(p, "stage sentinel"); }
    return f.io.lstat(p);
  } };
  const result = await executePlan({ ...f.options, io });
  expect(result.status).toBe("failed");
  expect(result.outcomes[0].reason).toContain("STAGE_ALREADY_EXISTS");
  expect(await fs.exists(f.options.stateRoot)).toBe(false);
  expect(await fs.readFile(planted!, "utf8")).toBe("stage sentinel");
  expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
});

test("tree uninstall fails closed and preserves known and unknown leaves", async () => {
  const f = await fixture();
  const result = await executePlan({ ...f.options, verb: "uninstall",
    plan: createPlan({ verb: "uninstall", profile: "minimal", profileResult: f.options.compileResult }) });
  expect(result.status).toBe("failed");
  expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
  expect(await fs.readFile(join(f.home, "installed/sentinel"), "utf8")).toBe("user-owned\n");
});

test("missing tree source root fails before creating a transaction", async () => {
  const f = await fixture();
  const record = f.options.compileResult.lockObject.records[0];
  if (record.class !== "COPY") throw new Error("fixture");
  record.source = join(f.repo, "payload");
  const result = await executePlan({ ...f.options, sourceRoot: undefined });
  expect(result.status).toBe("failed");
  expect(result.outcomes[0].reason).toContain("COPY_TREE_SOURCE_ROOT_REQUIRED");
  expect(await fs.exists(f.options.stateRoot)).toBe(false);
});
