import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompileResult } from "../src/compile.ts";
import { executePlan, rollbackTransaction } from "../src/lifecycle/executor.ts";
import type { LifecycleIO } from "../src/lifecycle/journal.ts";
import { createPlan } from "../src/lifecycle/planner.ts";
import type { InstallSurfaceLockV1, SurfaceRecord } from "../src/types.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function root(prefix: string): string {
  const value = mkdtempSync(join(tmpdir(), prefix));
  roots.push(value);
  return value;
}

function sha(content: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function testIo(): LifecycleIO {
  return {
    mkdir: async (path, options) => mkdirSync(path, options),
    writeFile: async (path, data) => writeFileSync(path, data, "utf8"),
    readFile: async (path) => readFileSync(path, "utf8"),
    readdir: async (path) => readdirSync(path),
    rm: async (path, options) => rmSync(path, options),
    lstat: async (path) => lstatSync(path),
    chmod: async (path, mode) => chmodSync(path, mode),
    rename: async (from, to) => renameSync(from, to),
    realpath: async (path) => (await import("node:fs")).realpathSync(path),
    now: () => new Date("2026-09-07T00:00:00.000Z"),
    writeFileAtomic: async (path, data, options) => {
      writeFileSync(path, data, { encoding: "utf8", mode: options?.mode });
      if (options?.mode !== undefined) chmodSync(path, options.mode);
    },
    fetch: async () => { throw new Error("NETWORK_FORBIDDEN"); },
    execFile: async () => { throw new Error("PROCESS_FORBIDDEN"); },
  };
}

function fixture(): {
  repository: string;
  home: string;
  codex: string;
  state: string;
  originalAgents: string;
  compileResult: CompileResult;
  resolveRoot: (token: string) => string;
} {
  const base = root("lifecycle-non-copy-");
  const repository = join(base, "repository");
  const home = join(base, "home");
  const codex = join(base, "codex");
  const state = join(base, "state");
  mkdirSync(join(repository, "source"), { recursive: true });
  mkdirSync(join(repository, "templates"), { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(codex, { recursive: true });
  mkdirSync(state, { recursive: true });
  const copy = "export const installed = true;\n";
  const template = "NOESIS\ncurrent Temperance guidance\n";
  const originalAgents = "user prefix\n<!-- temperance:managed:start temperance-engine -->\nold guidance\n<!-- temperance:managed:end temperance-engine -->\nuser suffix\n";
  writeFileSync(join(repository, "source/copy.ts"), copy, { mode: 0o644 });
  writeFileSync(join(repository, "templates/codex.AGENTS.md"), template, { mode: 0o644 });
  writeFileSync(join(codex, "AGENTS.md"), originalAgents, { mode: 0o600 });
  chmodSync(join(codex, "AGENTS.md"), 0o600);
  writeFileSync(join(home, "sentinel.txt"), "unrelated\n", { mode: 0o600 });

  const records: SurfaceRecord[] = [
    {
      id: "runtime.copy", owner: "temperance-engine", class: "COPY", source: "source/copy.ts",
      destination: { root_token: "HOME", relative_path: "runtime/copy.ts", ownership: { kind: "exclusive-path" } },
      authority: { requirement_ids: ["PROV-02"], isa: "ISC-769" },
      eligibility: { platforms: ["darwin"], profiles: ["default"], required: true },
      verification: { method: "sha256", expected: { kind: "file", sha256: sha(copy), mode: "0644" } }, rollback: { policy: "remove-installed" },
    },
    {
      id: "configuration.codex-managed-block", owner: "temperance-engine", class: "TRANSFORM", source: "templates/codex.AGENTS.md",
      destination: { root_token: "CODEX_HOME", relative_path: "AGENTS.md", ownership: { kind: "managed-block", marker_id: "temperance-engine" } },
      authority: { requirement_ids: ["PROV-02"], isa: "ISC-770" },
      eligibility: { platforms: ["darwin"], profiles: ["default"], required: true },
      verification: { method: "adapter", adapter_id: "managed-template-v1", expected: { kind: "file", sha256: sha(template), mode: "0644" } }, rollback: { policy: "restore-backup" },
    },
    {
      id: "manifest.zone-project-state", owner: "temperance-engine", class: "REGENERATE",
      destination: { root_token: "TEMPERANCE_STATE", relative_path: "state/manifest-zone.json", ownership: { kind: "exclusive-path" } },
      authority: { requirement_ids: ["PROV-02"], isa: "ISC-771" },
      eligibility: { platforms: ["darwin"], profiles: ["default"], required: false },
      verification: { method: "semantic-probe", generator_id: "manifest-zone-v1" }, rollback: { policy: "regenerate" },
    },
  ];
  const lockObject: InstallSurfaceLockV1 = {
    schema: "temperance.install-surface.lock.v1", schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1", version: { major: 1, minor: 0 }, records,
  };
  const compileResult: CompileResult = { lockObject, canonicalBytes: JSON.stringify(lockObject), digest: sha(JSON.stringify(lockObject)), semanticIds: records.map((record) => record.id) };
  const resolveRoot = (token: string): string => ({ HOME: home, CODEX_HOME: codex, TEMPERANCE_STATE: state }[token] ?? (() => { throw new Error(`unexpected root: ${token}`); })());
  return { repository, home, codex, state, originalAgents, compileResult, resolveRoot };
}

describe("mixed COPY and managed-template lifecycle", () => {
  test("uses one prepared manifest, preserves user bytes/mode, reports unavailable generation, and rolls back exactly", async () => {
    const f = fixture();
    const plan = createPlan({ verb: "install", profileResult: f.compileResult, profile: "default", platform: "darwin" });
    const result = await executePlan({ stateRoot: f.state, repositoryRoot: f.repository, io: testIo(), plan, compileResult: f.compileResult, verb: "install", profile: "default", resolveRoot: f.resolveRoot });
    expect(result.status).toBe("committed");
    expect(result.outcomes.find((outcome) => outcome.record_id === "manifest.zone-project-state")).toMatchObject({ status: "unavailable", reason: expect.stringContaining("GENERATOR_UNAVAILABLE") });
    expect(readFileSync(join(f.codex, "AGENTS.md"), "utf8")).toBe("user prefix\n<!-- temperance:managed:start temperance-engine -->\nNOESIS\ncurrent Temperance guidance\n<!-- temperance:managed:end temperance-engine -->\nuser suffix\n");
    expect(lstatSync(join(f.codex, "AGENTS.md")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(f.home, "runtime/copy.ts"), "utf8")).toBe("export const installed = true;\n");
    expect(readFileSync(join(f.home, "sentinel.txt"), "utf8")).toBe("unrelated\n");
    expect(existsSync(join(f.state, "state/manifest-zone.json"))).toBe(false);

    const tx = join(f.state, "transactions", result.txid);
    expect(existsSync(join(tx, "surface-manifest.json"))).toBe(true);
    expect(existsSync(join(tx, "copy-manifest.json"))).toBe(false);
    const begin = JSON.parse(readFileSync(join(tx, "journal.json"), "utf8"))[0];
    expect(begin.surface_manifest_sha256).toMatch(/^([a-f0-9]{64})$/);

    const rollback = await rollbackTransaction(result.txid, f.state, testIo(), { resolveRoot: f.resolveRoot });
    expect(rollback.status).toBe("committed");
    expect(readFileSync(join(f.codex, "AGENTS.md"), "utf8")).toBe(f.originalAgents);
    expect(lstatSync(join(f.codex, "AGENTS.md")).mode & 0o777).toBe(0o600);
    expect(existsSync(join(f.home, "runtime/copy.ts"))).toBe(false);
    expect(readFileSync(join(f.home, "sentinel.txt"), "utf8")).toBe("unrelated\n");
  });

  test("an explicitly selected unavailable generator fails before a transaction or destination write", async () => {
    const f = fixture();
    const plan = createPlan({ verb: "install", profileResult: f.compileResult, profile: "default", platform: "darwin", explicitSelections: new Set(["manifest.zone-project-state"]) });
    const result = await executePlan({ stateRoot: f.state, repositoryRoot: f.repository, io: testIo(), plan, compileResult: f.compileResult, verb: "install", profile: "default", resolveRoot: f.resolveRoot, explicitSelections: new Set(["manifest.zone-project-state"]) });
    expect(result.status).toBe("failed");
    expect(result.outcomes.find((outcome) => outcome.record_id === "manifest.zone-project-state")?.reason).toContain("GENERATOR_UNAVAILABLE");
    expect(existsSync(join(f.state, "transactions"))).toBe(false);
    expect(readFileSync(join(f.codex, "AGENTS.md"), "utf8")).toBe(f.originalAgents);
    expect(existsSync(join(f.home, "runtime/copy.ts"))).toBe(false);
  });

  test("an aborted mixed promotion rolls back earlier outputs rather than treating ABORT as already recovered", async () => {
    const f = fixture();
    const plan = createPlan({ verb: "install", profileResult: f.compileResult, profile: "default", platform: "darwin" });
    const base = testIo();
    const io: LifecycleIO = {
      ...base,
      rename: async (from, to) => {
        if (to === join(f.codex, "AGENTS.md")) throw new Error("injected promotion failure");
        await base.rename(from, to);
      },
    };
    const failed = await executePlan({ stateRoot: f.state, repositoryRoot: f.repository, io, plan, compileResult: f.compileResult, verb: "install", profile: "default", resolveRoot: f.resolveRoot });
    expect(failed.status).toBe("failed");
    expect(existsSync(join(f.home, "runtime/copy.ts"))).toBe(true);
    const rollback = await rollbackTransaction(failed.txid, f.state, testIo(), { resolveRoot: f.resolveRoot });
    expect(rollback.status).toBe("committed");
    expect(existsSync(join(f.home, "runtime/copy.ts"))).toBe(false);
    expect(readFileSync(join(f.codex, "AGENTS.md"), "utf8")).toBe(f.originalAgents);
    expect(readFileSync(join(f.home, "sentinel.txt"), "utf8")).toBe("unrelated\n");
  });

  test("a surface-manifest rollback refuses unbound journal steps before touching any destination", async () => {
    const f = fixture();
    const plan = createPlan({ verb: "install", profileResult: f.compileResult, profile: "default", platform: "darwin" });
    const installed = await executePlan({ stateRoot: f.state, repositoryRoot: f.repository, io: testIo(), plan, compileResult: f.compileResult, verb: "install", profile: "default", resolveRoot: f.resolveRoot });
    expect(installed.status).toBe("committed");
    const tx = join(f.state, "transactions", installed.txid);
    const journalPath = join(tx, "journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.push(
      { kind: "STAGE", ts: "2026-09-07T00:00:01.000Z", step_id: "unbound-step", destination_symbolic: "$HOME/sentinel.txt", mode: "install" },
      { kind: "COMMIT_STEP", ts: "2026-09-07T00:00:02.000Z", step_id: "unbound-step" },
    );
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

    const rollback = await rollbackTransaction(installed.txid, f.state, testIo(), { resolveRoot: f.resolveRoot });
    expect(rollback.status).toBe("failed");
    expect(readFileSync(join(f.home, "runtime/copy.ts"), "utf8")).toBe("export const installed = true;\n");
    expect(readFileSync(join(f.codex, "AGENTS.md"), "utf8")).not.toBe(f.originalAgents);
    expect(readFileSync(join(f.home, "sentinel.txt"), "utf8")).toBe("unrelated\n");
  });

  test("a stage link substitution is rejected before it can alter an unrelated target mode", async () => {
    const f = fixture();
    const plan = createPlan({ verb: "install", profileResult: f.compileResult, profile: "default", platform: "darwin" });
    const victim = join(f.home, "victim.txt");
    writeFileSync(victim, "private\n", { mode: 0o600 });
    chmodSync(victim, 0o600);
    const base = testIo();
    const io: LifecycleIO = {
      ...base,
      writeFileAtomic: async (path, data, options) => {
        if (path.includes(".temperance-stage-")) {
          symlinkSync(victim, path);
          return;
        }
        await base.writeFileAtomic(path, data, options);
      },
    };
    const failed = await executePlan({ stateRoot: f.state, repositoryRoot: f.repository, io, plan, compileResult: f.compileResult, verb: "install", profile: "default", resolveRoot: f.resolveRoot });
    expect(failed.status).toBe("failed");
    expect(lstatSync(victim).mode & 0o777).toBe(0o600);
    expect(readFileSync(victim, "utf8")).toBe("private\n");
    expect(readFileSync(join(f.codex, "AGENTS.md"), "utf8")).toBe(f.originalAgents);
    expect(existsSync(join(f.home, "runtime/copy.ts"))).toBe(false);
  });

  test("managed transforms refuse uninstall until a bounded removal producer exists", async () => {
    const f = fixture();
    const plan = createPlan({ verb: "uninstall", profileResult: f.compileResult, profile: "default", platform: "darwin" });
    const result = await executePlan({ stateRoot: f.state, repositoryRoot: f.repository, io: testIo(), plan, compileResult: f.compileResult, verb: "uninstall", profile: "default", resolveRoot: f.resolveRoot });
    expect(result.status).toBe("failed");
    expect(result.outcomes.find((outcome) => outcome.record_id === "configuration.codex-managed-block")?.reason).toContain("TRANSFORM_UNINSTALL_UNSUPPORTED");
    expect(existsSync(join(f.state, "transactions"))).toBe(false);
    expect(readFileSync(join(f.codex, "AGENTS.md"), "utf8")).toBe(f.originalAgents);
  });
});
