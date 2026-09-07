import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { compileFragments } from "../src/compile.ts";
import { loadLock } from "../src/load.ts";
import { runDoctorV2 } from "../src/doctor/orchestrator.ts";
import { sha256 } from "../src/lifecycle/copy-tree.ts";
import { executePlan, rollbackTransaction, type ExecutorResult } from "../src/lifecycle/executor.ts";
import type { LifecycleIO } from "../src/lifecycle/journal.ts";
import { createPlan } from "../src/lifecycle/planner.ts";
import type { SurfaceManifest } from "../src/lifecycle/prepared-surface.ts";

const checkout = resolve(import.meta.dir, "../../..");
const fragmentDirectory = join(checkout, "package/install-surface/fragments");
// Compile the real inventory and authority documents, without updating its lock
// or replacing expectations with hashes of whatever happens to be installed.
const compiled = compileFragments(readdirSync(fragmentDirectory).filter(name => name.endsWith(".json")).sort().map(name => ({
  name, contents: readFileSync(join(fragmentDirectory, name), "utf8"),
})), {
  isaText: readFileSync(join(checkout, "ISA.md"), "utf8"),
  requirementsText: readFileSync(join(checkout, ".planning/REQUIREMENTS.md"), "utf8"),
  priorLock: loadLock(join(checkout, "package/install-surface/install-surface-manifest.lock.json")).lockObject,
});
const profiles = [...new Set(compiled.lockObject.records.filter(record => record.class !== "NEVER-SHIP")
  .flatMap(record => record.eligibility.profiles))].sort();
const temporaryRoots: string[] = [];
afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

type Snapshot = Record<string, { hash: string; mode: number }>;
async function snapshot(root: string, skipTransactions = false): Promise<Snapshot> {
  const result: Snapshot = {};
  async function visit(directory: string): Promise<void> {
    for (const name of (await fs.readdir(directory)).sort()) {
      const path = join(directory, name), key = relative(root, path);
      if (skipTransactions && key === "transactions") continue;
      const stat = await fs.lstat(path);
      if (stat.isDirectory()) await visit(path);
      else {
        expect(stat.isFile() && !stat.isSymbolicLink()).toBe(true);
        result[key] = { hash: sha256(await fs.readFile(path, "utf8")), mode: stat.mode & 0o7777 };
      }
    }
  }
  await visit(root);
  return result;
}

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "temperance-full-replay-")));
  temporaryRoots.push(root);
  const repository = join(root, "repository");
  const rootPaths: Record<string, string> = {
    HOME: join(root, "home"), CODEX_HOME: join(root, "codex"),
    CLAUDE_CONFIG_DIR: join(root, "claude"), TEMPERANCE_STATE: join(root, "state"),
  };
  for (const path of [repository, ...Object.values(rootPaths)]) await fs.mkdir(path);
  // Only public COPY/TRANSFORM sources are imported. Installed lifecycle code
  // receives the disposable repository, never the operator's runtime checkout.
  for (const record of compiled.lockObject.records) {
    if (record.class !== "COPY" && record.class !== "TRANSFORM") continue;
    const target = join(repository, record.source);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.cp(join(checkout, record.source), target, { recursive: true, dereference: false });
  }
  await fs.mkdir(join(repository, "package/install-surface"), { recursive: true });
  await fs.writeFile(join(repository, "package/install-surface/install-surface-manifest.lock.json"), compiled.canonicalBytes);
  const resolveRoot = (token: string): string => {
    if (!Object.hasOwn(rootPaths, token)) throw new Error(`UNINJECTED_ROOT:${token}`);
    return rootPaths[token];
  };
  const originalAgents = "user prefix\n<!-- temperance:managed:start temperance-engine -->\nprevious managed guidance\n<!-- temperance:managed:end temperance-engine -->\nuser suffix\n";
  await fs.writeFile(join(rootPaths.CODEX_HOME, "AGENTS.md"), originalAgents);
  await fs.chmod(join(rootPaths.CODEX_HOME, "AGENTS.md"), 0o600);
  for (const path of Object.values(rootPaths)) await fs.writeFile(join(path, "unrelated-sentinel.txt"), "user-owned sentinel\n");

  const accesses: { operation: string; path: string }[] = [];
  const violations: string[] = [];
  function guard(operation: string, path: string, mutation = false): string {
    const absolute = resolve(path), rel = relative(root, absolute);
    const sourceRel = relative(repository, absolute);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)
      || (mutation && (sourceRel === "" || (!sourceRel.startsWith("../") && sourceRel !== ".." && !isAbsolute(sourceRel))))) {
      violations.push(operation);
      throw new Error(`DISPOSABLE_BOUNDARY_VIOLATION:${operation}`);
    }
    accesses.push({ operation, path: absolute });
    return absolute;
  }
  const io: LifecycleIO = {
    mkdir: async (path, options) => { await fs.mkdir(guard("mkdir", path, true), options); },
    writeFile: async (path, data) => { await fs.writeFile(guard("writeFile", path, true), data); },
    readFile: path => fs.readFile(guard("readFile", path), "utf8"),
    readdir: path => fs.readdir(guard("readdir", path)),
    rm: (path, options) => fs.rm(guard("rm", path, true), options),
    lstat: path => fs.lstat(guard("lstat", path)),
    chmod: (path, mode) => fs.chmod(guard("chmod", path, true), mode),
    rename: (from, to) => fs.rename(guard("rename-from", from, true), guard("rename-to", to, true)),
    realpath: async path => guard("realpath-result", await fs.realpath(guard("realpath", path))),
    now: () => new Date("2026-09-07T00:00:00.000Z"),
    writeFileAtomic: async (path, data, options) => {
      const target = guard("writeFileAtomic", path, true), staged = guard("atomic-stage", `${target}.test-stage`, true);
      const file = await fs.open(staged, "wx", 0o600);
      try {
        await file.writeFile(data);
        await file.chmod(options?.mode ?? 0o600);
        await file.sync();
      } finally { await file.close(); }
      await fs.rename(staged, target);
    },
    fetch: async () => { violations.push("network"); throw new Error("NETWORK_FORBIDDEN"); },
    execFile: async () => { violations.push("process"); throw new Error("PROCESS_FORBIDDEN"); },
  };
  const destinationSnapshot = async () => Object.fromEntries(await Promise.all(Object.entries(rootPaths)
    .map(async ([token, path]) => [token, await snapshot(path, token === "TEMPERANCE_STATE")])));
  const doctor = (platform: NodeJS.Platform = "darwin") => runDoctorV2({
    repositoryRoot: repository, stateRoot: rootPaths.TEMPERANCE_STATE,
    sections: ["install"], platform, rootBindings: rootPaths, inventory: compiled,
    io: {
      readFile: io.readFile, readBytes: path => fs.readFile(guard("readBytes", path)),
      readdir: io.readdir, lstat: io.lstat, realpath: io.realpath,
      now: io.now, fetch: io.fetch, execFile: io.execFile,
    },
  });
  return { root, repository, rootPaths, resolveRoot, io, originalAgents, accesses, violations, destinationSnapshot, doctor };
}

function expectCommitted(result: ExecutorResult): void {
  expect({ status: result.status, exitCode: result.exitCode, failures: result.outcomes.filter(outcome => outcome.status === "failed") })
    .toEqual({ status: "committed", exitCode: 0, failures: [] });
}

async function expectInstalledDoctor(f: Awaited<ReturnType<typeof fixture>>, platform: NodeJS.Platform, driftRecordId?: string): Promise<void> {
  const before = await snapshot(f.root);
  const report = await f.doctor(platform);
  expect(report).toMatchObject({
    schema: "temperance.doctor.report.v2", inventory_digest: compiled.digest, trustworthy: true,
    overall_condition: driftRecordId ? "DRIFT" : "UNAVAILABLE", exit_code: 1,
    scope: { complete: false, requested_sections: ["install"] },
  });
  const checks = report.sections.flatMap(section => section.checks);
  expect(checks).toHaveLength(compiled.lockObject.records.length);
  for (const record of compiled.lockObject.records) {
    const check = checks.find(check => check.id === record.id);
    if (record.class === "COPY") expect(check).toMatchObject(record.id === driftRecordId
      ? { condition: "DRIFT", reason_code: "COPY_LEAF_SET_DRIFT" }
      : { condition: "PASS", reason_code: "COPY_DECLARATION_MATCH" });
    if (record.class === "TRANSFORM") expect(check).toMatchObject({ condition: "PASS", reason_code: "TRANSFORM_MANAGED_BLOCK_MATCH" });
    if (record.class === "REGENERATE") expect(check).toMatchObject({ condition: "UNAVAILABLE", reason_code: "GENERATOR_UNAVAILABLE" });
    if (record.class === "NEVER-SHIP") expect(check?.reason_code).toBe("NEVER_SHIP_SYMBOLIC");
  }
  expect(await snapshot(f.root)).toEqual(before);
  expect(f.violations).toEqual([]);
}

for (const profile of profiles) {
  const platforms = [...new Set(compiled.lockObject.records.filter(record => record.class !== "NEVER-SHIP"
    && record.eligibility.profiles.includes(profile)).flatMap(record => record.eligibility.platforms))].sort();
  for (const platform of platforms) {
    test(`checked-in ${profile}/${platform} installs, replays, and rolls back all available surfaces inside disposable roots`, async () => {
      const f = await fixture(), stateRoot = f.rootPaths.TEMPERANCE_STATE;
      const plan = createPlan({ verb: "install", profileResult: compiled, profile, platform });
      const selected = compiled.lockObject.records.filter(record => plan.steps.some(step => step.record_id === record.id));
      const copyRecords = selected.filter(record => record.class === "COPY");
      expect(copyRecords.length).toBeGreaterThan(0);
      expect(selected.some(record => record.id === "configuration.codex-managed-block" && record.class === "TRANSFORM")).toBe(true);
      expect(selected.some(record => record.id === "manifest.zone-project-state" && record.class === "REGENERATE")).toBe(true);

      // Exercise restoration of an existing COPY leaf, as well as removal of
      // newly installed leaves and preservation of unknown files in its tree.
      const existing = copyRecords[0], expected = existing.verification.expected!;
      const existingLeaf = expected.kind === "tree" ? Object.keys(expected.files).sort()[0] : "";
      const existingPath = join(f.resolveRoot(existing.destination.root_token), existing.destination.relative_path, existingLeaf);
      await fs.mkdir(dirname(existingPath), { recursive: true });
      await fs.writeFile(existingPath, "previous installation bytes\n"); await fs.chmod(existingPath, 0o640);
      await fs.writeFile(join(dirname(existingPath), "unknown-neighbor.txt"), "unknown neighbor\n");
      const before = await f.destinationSnapshot(), sourceBefore = await snapshot(f.repository);
      const execute = () => executePlan({ stateRoot, repositoryRoot: f.repository, io: f.io, plan, compileResult: compiled,
        verb: "install", profile, resolveRoot: f.resolveRoot });

      const installed = await execute();
      expectCommitted(installed);
      expect(installed.outcomes).toHaveLength(compiled.lockObject.records.length);
      expect(installed.outcomes.find(outcome => outcome.record_id === "manifest.zone-project-state"))
        .toMatchObject({ status: "unavailable", reason: expect.stringContaining("GENERATOR_UNAVAILABLE") });
      for (const record of compiled.lockObject.records.filter(record => record.class === "NEVER-SHIP")) {
        expect(installed.outcomes.find(outcome => outcome.record_id === record.id)?.status).toBe("skipped");
      }
      let expectedLeafCount = 1; // codex-managed TRANSFORM
      for (const record of copyRecords) {
        expect(installed.outcomes.find(outcome => outcome.record_id === record.id)?.status).toBe("installed");
        const expected = record.verification.expected!;
        const leaves = expected.kind === "tree" ? Object.entries(expected.files) : [["", expected.sha256]];
        expectedLeafCount += leaves.length;
        for (const [leaf, hash] of leaves) {
          const path = join(f.resolveRoot(record.destination.root_token), record.destination.relative_path, leaf);
          expect(`sha256:${sha256(await fs.readFile(path, "utf8"))}`).toBe(hash);
          expect((await fs.lstat(path)).mode & 0o7777).toBe(parseInt(expected.kind === "tree" ? expected.modes![leaf] : expected.mode!, 8));
        }
      }
      const template = await fs.readFile(join(f.repository, "templates/codex.AGENTS.md"), "utf8");
      expect(await fs.readFile(join(f.rootPaths.CODEX_HOME, "AGENTS.md"), "utf8"))
        .toBe(`user prefix\n<!-- temperance:managed:start temperance-engine -->\n${template.trimEnd()}\n<!-- temperance:managed:end temperance-engine -->\nuser suffix\n`);
      expect((await fs.lstat(join(f.rootPaths.CODEX_HOME, "AGENTS.md"))).mode & 0o7777).toBe(0o600);
      const installedSnapshot = await f.destinationSnapshot();
      expect(await fs.exists(join(stateRoot, "state/manifest-zone.json"))).toBe(false);
      await expectInstalledDoctor(f, platform, existing.id);

      const replayed = await execute();
      expectCommitted(replayed);
      expect(replayed.txid).not.toBe(installed.txid);
      expect(replayed.outcomes).toEqual(installed.outcomes);
      expect(await f.destinationSnapshot()).toEqual(installedSnapshot);
      await expectInstalledDoctor(f, platform, existing.id);
      for (const result of [installed, replayed]) {
        const tx = join(stateRoot, "transactions", result.txid);
        const manifestBytes = await fs.readFile(join(tx, "surface-manifest.json"), "utf8");
        const manifest = JSON.parse(manifestBytes) as SurfaceManifest;
        expect(manifest.schema).toBe("temperance.surface-manifest.v1");
        expect(manifest.leaves).toHaveLength(expectedLeafCount);
        expect(new Set(manifest.leaves.map(leaf => leaf.surface_class))).toEqual(new Set(["COPY", "TRANSFORM"]));
        expect(manifest.leaves.some(leaf => leaf.record_id === "manifest.zone-project-state")).toBe(false);
        expect(await fs.exists(join(tx, "copy-manifest.json"))).toBe(false);
        expect(JSON.parse(await fs.readFile(join(tx, "journal.json"), "utf8"))[0])
          .toMatchObject({ kind: "BEGIN", inventory_digest: compiled.digest, surface_manifest_sha256: sha256(manifestBytes) });
        const receipt = await fs.readFile(join(tx, "receipt.json"), "utf8");
        expect(JSON.parse(receipt)).toMatchObject({ status: "committed", inventory_digest: compiled.digest });
        expect(receipt).not.toContain(f.root);
      }

      expectCommitted(await rollbackTransaction(replayed.txid, stateRoot, f.io, { resolveRoot: f.resolveRoot }));
      expect(await f.destinationSnapshot()).toEqual(installedSnapshot);
      expectCommitted(await rollbackTransaction(installed.txid, stateRoot, f.io, { resolveRoot: f.resolveRoot }));
      expect(await f.destinationSnapshot()).toEqual(before);
      expectCommitted(await rollbackTransaction(installed.txid, stateRoot, f.io, { resolveRoot: f.resolveRoot }));
      expect(await f.destinationSnapshot()).toEqual(before);
      expect(await snapshot(f.repository)).toEqual(sourceBefore);
      expect(f.accesses.length).toBeGreaterThan(0);
      expect(f.violations).toEqual([]);
    }, 30_000);
  }
}

test("explicit checked-in manifest-zone selection is unavailable before any disposable destination mutation", async () => {
  const f = await fixture(), before = await f.destinationSnapshot();
  const explicitSelections = new Set(["manifest.zone-project-state"]);
  const plan = createPlan({ verb: "install", profileResult: compiled, profile: "default", platform: "darwin", explicitSelections });
  const result = await executePlan({ stateRoot: f.rootPaths.TEMPERANCE_STATE, repositoryRoot: f.repository, io: f.io,
    plan, compileResult: compiled, verb: "install", profile: "default", resolveRoot: f.resolveRoot, explicitSelections });
  expect(result).toMatchObject({ status: "failed", exitCode: 1 });
  expect(result.outcomes.find(outcome => outcome.record_id === "manifest.zone-project-state")?.reason).toContain("GENERATOR_UNAVAILABLE");
  expect(await fs.exists(join(f.rootPaths.TEMPERANCE_STATE, "transactions"))).toBe(false);
  expect(await f.destinationSnapshot()).toEqual(before);
  expect(f.violations).toEqual([]);
});

test("same disposable inventory verifies doctor, refuses corrupted recovery, and retries failed promotion and compensation", async () => {
  const f = await fixture(), stateRoot = f.rootPaths.TEMPERANCE_STATE;
  const before = await f.destinationSnapshot(), sourceBefore = await snapshot(f.repository);
  const plan = createPlan({ verb: "install", profileResult: compiled, profile: "default", platform: "darwin" });
  const execute = (io = f.io) => executePlan({ stateRoot, repositoryRoot: f.repository, io, plan,
    compileResult: compiled, verb: "install", profile: "default", resolveRoot: f.resolveRoot });
  const installed = await execute();
  expectCommitted(installed);

  const tx = join(stateRoot, "transactions", installed.txid);
  const manifest = JSON.parse(await fs.readFile(join(tx, "surface-manifest.json"), "utf8")) as SurfaceManifest;
  const transform = manifest.leaves.find(leaf => leaf.surface_class === "TRANSFORM")!;
  expect(transform.preimage).not.toBeNull();
  const agentsPath = join(f.rootPaths.CODEX_HOME, "AGENTS.md");
  for (const artifact of [join(tx, transform.output), join(tx, transform.preimage!),
    join(tx, "surface-manifest.json"), join(tx, "journal.json"), agentsPath]) {
    const original = await fs.readFile(artifact, "utf8");
    await fs.writeFile(artifact, "injected corruption\n");
    const corruptDestinations = await f.destinationSnapshot();
    const refused = await rollbackTransaction(installed.txid, stateRoot, f.io, { resolveRoot: f.resolveRoot });
    expect(refused).toMatchObject({ status: "failed", exitCode: 1 });
    // No leaf may be compensated before the whole recovery contract is valid.
    expect(await f.destinationSnapshot()).toEqual(corruptDestinations);
    const report = await f.doctor();
    expect(report.sections.flatMap(section => section.checks)
      .find(check => check.id === "configuration.codex-managed-block")?.condition).not.toBe("PASS");
    await fs.writeFile(artifact, original);
  }
  expectCommitted(await rollbackTransaction(installed.txid, stateRoot, f.io, { resolveRoot: f.resolveRoot }));
  expect(await f.destinationSnapshot()).toEqual(before);

  // The same roots now attempt a fresh installation which aborts after several
  // verified promotions. Its durable evidence must support recovery on retry.
  const failureDestination = join(f.rootPaths.CODEX_HOME, "hooks/PromptProcessing.hook.ts");
  let promotionFailures = 0;
  const failed = await execute({ ...f.io, rename: async (from, to) => {
    if (to === failureDestination) { promotionFailures++; throw new Error("INJECTED_PROMOTION_FAILURE"); }
    await f.io.rename(from, to);
  } });
  expect(failed).toMatchObject({ status: "failed", exitCode: 1 });
  expect(promotionFailures).toBe(1);
  expect(failed.outcomes.find(outcome => outcome.record_id === "hooks.codex.prompt-processing")?.status).toBe("failed");
  expect(await fs.exists(failureDestination)).toBe(false);
  const installedAgents = await fs.readFile(agentsPath, "utf8");
  expect(installedAgents).not.toBe(f.originalAgents);
  const failedJournal = JSON.parse(await fs.readFile(join(stateRoot, "transactions", failed.txid, "journal.json"), "utf8"));
  expect(failedJournal.some((entry: { kind: string }) => entry.kind === "ABORT")).toBe(true);
  expect(failedJournal.some((entry: { kind: string }) => entry.kind === "COMPLETE")).toBe(false);
  expect((await f.doctor()).sections.flatMap(section => section.checks)
    .find(check => check.id === "configuration.codex-managed-block")?.condition).not.toBe("PASS");

  let recoveryFailures = 0;
  const recoveryIo: LifecycleIO = { ...f.io, writeFileAtomic: async (path, data, options) => {
    if (path.includes(".temperance-surface-restore-")) {
      recoveryFailures++;
      throw new Error("INJECTED_RECOVERY_FAILURE");
    }
    await f.io.writeFileAtomic(path, data, options);
  } };
  expect(await rollbackTransaction(failed.txid, stateRoot, recoveryIo, { resolveRoot: f.resolveRoot }))
    .toMatchObject({ status: "failed", exitCode: 1 });
  expect(recoveryFailures).toBe(1);
  expect(await fs.readFile(agentsPath, "utf8")).toBe(installedAgents);
  expectCommitted(await rollbackTransaction(failed.txid, stateRoot, f.io, { resolveRoot: f.resolveRoot }));
  expect(await f.destinationSnapshot()).toEqual(before);
  expect(await snapshot(f.repository)).toEqual(sourceBefore);
  expect(f.violations).toEqual([]);
  const recoveredInstall = await execute();
  expectCommitted(recoveredInstall);
  await expectInstalledDoctor(f, "darwin");
  expectCommitted(await rollbackTransaction(recoveredInstall.txid, stateRoot, f.io, { resolveRoot: f.resolveRoot }));
  expect(await f.destinationSnapshot()).toEqual(before);
}, 30_000);
