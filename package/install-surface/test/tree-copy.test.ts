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
const declaredHash = (text: string): `sha256:${string}` => `sha256:${hash(text)}`;
async function fixture(source = "payload") {
  const root = mkdtempSync(join(tmpdir(), "ro00-copy-")); roots.push(root);
  const repo = join(root, "repo"), home = join(root, "target"), stateRoot = join(root, "state");
  await fs.mkdir(join(repo, "payload/nested"), { recursive: true });
  await fs.mkdir(join(home, "installed"), { recursive: true });
  await fs.writeFile(join(repo, "payload/a.txt"), "new a\n");
  await fs.writeFile(join(repo, "payload/nested/b.txt"), "new b\n");
  await fs.chmod(join(repo, "payload/nested/b.txt"), 0o755);
  await fs.writeFile(join(home, "installed/a.txt"), "old a\n");
  await fs.chmod(join(home, "installed/a.txt"), 0o700);
  await fs.writeFile(join(home, "installed/sentinel"), "user-owned\n");
  const io: LifecycleIO = {
    mkdir: async (p, o) => { await fs.mkdir(p, o); },
    writeFile: (p, d) => fs.writeFile(p, d), readFile: p => fs.readFile(p, "utf8"),
    readdir: p => fs.readdir(p), rm: (p, o) => fs.rm(p, o), lstat: p => fs.lstat(p),
    chmod: (p, mode) => fs.chmod(p, mode),
    rename: (a, b) => fs.rename(a, b), realpath: p => fs.realpath(p), now: () => new Date(),
    writeFileAtomic: async (p, d, options) => {
      await fs.writeFile(p + ".tmp", d, { mode: options?.mode });
      if (options?.mode !== undefined) await fs.chmod(p + ".tmp", options.mode);
      await fs.rename(p + ".tmp", p);
    },
    execFile: async () => { throw new Error("no processes"); }, fetch: async () => { throw new Error("no network"); },
  };
  const compileResult: CompileResult = {
    lockObject: { schema: "temperance.install-surface.lock.v1", schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1", version: { major: 1, minor: 0 }, records: [{
      id: "tree", owner: "test", class: "COPY", source,
      destination: { root_token: "HOME", relative_path: "installed", ownership: { kind: "exclusive-path" } },
      authority: { requirement_ids: ["RO-00"], isa: "RO-00" },
      eligibility: { platforms: ["darwin", "linux"], profiles: ["minimal"], required: true },
      verification: {
        method: "sha256",
        expected: {
          kind: "tree",
          files: {
            "a.txt": declaredHash("new a\n"),
            "nested/b.txt": declaredHash("new b\n"),
          },
          modes: {
            "a.txt": "0644",
            "nested/b.txt": "0755",
          },
        },
      },
      rollback: { policy: "restore-backup" },
    }] }, canonicalBytes: "{}", digest: `sha256:${"a".repeat(64)}`, semanticIds: ["tree"],
  };
  const options = { stateRoot, io, compileResult, verb: "install", profile: "minimal",
    repositoryRoot: repo, resolveRoot: () => home,
    plan: createPlan({ verb: "install", profile: "minimal", profileResult: compileResult }),
  };
  return { root, repo, home, io, options };
}

test("tree COPY records deterministic manifests, restores old leaves, removes created leaves, preserves unknown sentinel", async () => {
  const f = await fixture();
  const result = await executePlan(f.options);
  expect(result.status).toBe("committed");
  expect(await fs.readFile(join(f.home, "installed/nested/b.txt"), "utf8")).toBe("new b\n");
  const installedAMode = (await fs.lstat(join(f.home, "installed/a.txt"))).mode & 0o777;
  const installedBMode = (await fs.lstat(join(f.home, "installed/nested/b.txt"))).mode & 0o777;
  expect(installedAMode).toBe(0o644);
  expect(installedBMode).toBe(0o755);
  const manifest = JSON.parse(await fs.readFile(join(f.options.stateRoot, "transactions", result.txid, "copy-manifest.json"), "utf8"));
  expect(manifest.leaves.map((l: any) => l.relative_path)).toEqual(["installed/a.txt", "installed/nested/b.txt"]);
  expect(manifest.leaves[0].prior_hash).toBe(hash("old a\n"));
  expect(manifest.leaves[1].prior_hash).toBeNull();
  expect((await rollbackTransaction(result.txid, f.options.stateRoot, f.io, { resolveRoot: () => f.home })).status).toBe("committed");
  expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
  const restoredAMode = (await fs.lstat(join(f.home, "installed/a.txt"))).mode & 0o777;
  expect(restoredAMode).toBe(0o700);
  expect(await fs.exists(join(f.home, "installed/nested/b.txt"))).toBe(false);
  expect(await fs.readFile(join(f.home, "installed/sentinel"), "utf8")).toBe("user-owned\n");
  expect((await rollbackTransaction(result.txid, f.options.stateRoot, f.io, { resolveRoot: () => f.home })).status).toBe("committed");
});

test("missing declared mode and source mode mismatch fail before destination writes", async () => {
  for (const mutation of ["missing", "source-mismatch"] as const) {
    const f = await fixture();
    const record = f.options.compileResult.lockObject.records[0];
    if (record.class !== "COPY" || record.verification.expected?.kind !== "tree") throw new Error("fixture");
    if (mutation === "missing") {
      delete (record.verification.expected as { modes?: Record<string, string> }).modes;
    } else {
      await fs.chmod(join(f.repo, "payload/nested/b.txt"), 0o644);
    }
    const result = await executePlan(f.options);
    expect(result.status).toBe("failed");
    expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
    const preservedAMode = (await fs.lstat(join(f.home, "installed/a.txt"))).mode & 0o777;
    expect(preservedAMode).toBe(0o700);
    expect(await fs.exists(join(f.options.stateRoot))).toBe(false);
  }
});

test("declared hash mismatch and missing tree hashes fail before destination writes", async () => {
  for (const expected of [
    {
      kind: "tree" as const,
      files: { "a.txt": `sha256:${"0".repeat(64)}`, "nested/b.txt": declaredHash("new b\n") },
      modes: { "a.txt": "0644", "nested/b.txt": "0755" },
    },
    undefined,
  ]) {
    const f = await fixture();
    const record = f.options.compileResult.lockObject.records[0];
    if (record.class !== "COPY") throw new Error("fixture");
    record.verification = expected ? { method: "sha256", expected } : { method: "sha256" };
    expect((await executePlan(f.options)).status).toBe("failed");
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
  const io = { ...f.io, writeFileAtomic: async (p: string, d: string, options?: { mode?: number }) => { await f.io.writeFileAtomic(p, p.includes(".temperance-stage-") ? "corrupt" : d, options); } };
  expect((await executePlan({ ...f.options, io })).status).toBe("failed");
  expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
});

test("staged mode corruption is checked before promotion", async () => {
  const f = await fixture();
  let stagedWrites = 0;
  const io = {
    ...f.io,
    writeFileAtomic: async (path: string, data: string, options?: { mode?: number }) => {
      if (path.includes(".temperance-stage-")) stagedWrites += 1;
      await f.io.writeFileAtomic(path, data, {
        ...options,
        mode: stagedWrites === 2 ? 0o644 : options?.mode,
      });
    },
  };
  const result = await executePlan({ ...f.options, io });
  expect(result.status).toBe("failed");
  expect(await fs.exists(join(f.home, "installed/nested/b.txt"))).toBe(false);
});

test("stage and promotion verification reject privileged mode bits", async () => {
  for (const phase of ["stage", "promotion"] as const) {
    const f = await fixture();
    let promoted = false;
    const io = {
      ...f.io,
      rename: async (from: string, to: string) => {
        await f.io.rename(from, to);
        if (to.endsWith("installed/a.txt")) promoted = true;
      },
      lstat: async (path: string) => {
        const stat = await f.io.lstat(path);
        if (
          (phase === "stage" && path.includes(".temperance-stage-"))
          || (phase === "promotion" && promoted && path.endsWith("installed/a.txt"))
        ) {
          const privileged = Object.create(stat) as typeof stat;
          Object.defineProperty(privileged, "mode", { value: stat.mode | 0o4000 });
          return privileged;
        }
        return stat;
      },
    };
    const result = await executePlan({ ...f.options, io });
    expect(result.status).toBe("failed");
    expect(result.receipt).toBeUndefined();
  }
});

test("mode-only destination drift blocks whole-manifest rollback", async () => {
  const f = await fixture();
  const result = await executePlan(f.options);
  expect(result.status).toBe("committed");
  await fs.chmod(join(f.home, "installed/a.txt"), 0o600);
  expect((await rollbackTransaction(result.txid, f.options.stateRoot, f.io, { resolveRoot: () => f.home })).status).toBe("failed");
  expect(await fs.readFile(join(f.home, "installed/nested/b.txt"), "utf8")).toBe("new b\n");
});

test("rollback stages prior bytes and mode so a stage-write failure remains retryable", async () => {
  const f = await fixture();
  const installed = await executePlan(f.options);
  expect(installed.status).toBe("committed");
  let failRestoreWrite = true;
  const io = {
    ...f.io,
    writeFileAtomic: async (path: string, data: string, options?: { mode?: number }) => {
      if (failRestoreWrite && path.includes(".temperance-restore-")) {
        failRestoreWrite = false;
        await f.io.writeFileAtomic(path, data, options);
        throw new Error("injected restore-stage write failure");
      }
      await f.io.writeFileAtomic(path, data, options);
    },
  };
  const failed = await rollbackTransaction(installed.txid, f.options.stateRoot, io, { resolveRoot: () => f.home });
  expect(failed.status).toBe("failed");
  // The installed destination remains untouched; there is no mixed old-bytes /
  // new-mode state that would block the next compensation attempt.
  expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("new a\n");
  expect((await fs.lstat(join(f.home, "installed/a.txt"))).mode & 0o777).toBe(0o644);
  const retried = await rollbackTransaction(installed.txid, f.options.stateRoot, io, { resolveRoot: () => f.home });
  expect(retried.status).toBe("committed");
  expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
  expect((await fs.lstat(join(f.home, "installed/a.txt"))).mode & 0o777).toBe(0o700);
});

test("rollback uses a fresh sibling when an interrupted restore stage remains", async () => {
  const f = await fixture();
  const installed = await executePlan(f.options);
  expect(installed.status).toBe("committed");
  const txDir = join(f.options.stateRoot, "transactions", installed.txid);
  const manifest = JSON.parse(await fs.readFile(join(txDir, "copy-manifest.json"), "utf8"));
  const stepId = manifest.leaves[0].step_id as string;
  const orphan = join(
    f.home,
    "installed",
    `.temperance-restore-${hash(`${txDir}\u0000${stepId}`).slice(0, 16)}-interrupted.tmp`,
  );
  await fs.writeFile(orphan, "incomplete prior state\n");
  const result = await rollbackTransaction(installed.txid, f.options.stateRoot, f.io, { resolveRoot: () => f.home });
  expect(result.status).toBe("committed");
  expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("old a\n");
  // An unproven orphan is intentionally left untouched rather than silently
  // deleting a file which could have appeared after the interrupted process.
  expect(await fs.readFile(orphan, "utf8")).toBe("incomplete prior state\n");
});

test("extra leaves are rejected before their content can be read", async () => {
  const f = await fixture();
  const extra = join(f.repo, "payload/unreviewed.txt");
  await fs.writeFile(extra, "unreviewed\n");
  const io = {
    ...f.io,
    readFile: async (path: string) => {
      if (path === extra) throw new Error("EXTRA_CONTENT_READ");
      return f.io.readFile(path);
    },
  };
  const result = await executePlan({ ...f.options, io });
  expect(result.status).toBe("failed");
  expect(result.outcomes[0].reason).toContain("COPY_HASH_INVENTORY_MISMATCH");
  expect(await fs.exists(f.options.stateRoot)).toBe(false);
});

test("complete declaration rejects missing and extra paths before creating journal", async () => {
  for (const delta of ["missing", "extra"]) {
    const f = await fixture();
    const record = f.options.compileResult.lockObject.records[0];
    if (record.class !== "COPY" || record.verification.expected?.kind !== "tree") throw new Error("fixture");
    const declared = { ...record.verification.expected.files };
    const modes = { ...record.verification.expected.modes };
    if (delta === "missing") {
      delete declared["nested/b.txt"];
      delete modes["nested/b.txt"];
    } else {
      declared["untracked.txt"] = declaredHash("extra");
      modes["untracked.txt"] = "0644";
    }
    record.verification = { method: "sha256", expected: { kind: "tree", files: declared, modes } };
    const result = await executePlan(f.options);
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
  record.verification = { method: "sha256", expected: { kind: "file", sha256: declaredHash("new a\n"), mode: "0644" } };
  const result = await executePlan({ ...f.options, repositoryRoot: undefined,
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
  const result = await executePlan({ ...f.options, repositoryRoot: undefined });
  expect(result.status).toBe("failed");
  expect(result.outcomes[0].reason).toContain("COPY_TREE_SOURCE_ROOT_REQUIRED");
  expect(await fs.exists(f.options.stateRoot)).toBe(false);
});

test("executor ignores caller-supplied hashes and uses the compiled expectation", async () => {
  const f = await fixture();
  const result = await executePlan({
    ...f.options,
    declaredCopyHashes: { tree: { "a.txt": "0".repeat(64), "nested/b.txt": "0".repeat(64) } },
  } as typeof f.options);
  expect(result.status).toBe("committed");
  expect(await fs.readFile(join(f.home, "installed/a.txt"), "utf8")).toBe("new a\n");
});
