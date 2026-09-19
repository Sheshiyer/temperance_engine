import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSurfaceContract } from "./surface-convergence-contract.ts";
import type { CapabilityResolutionInput } from "./phase-capability-contract.ts";
import { admitSessionAttempt, checkpointSession, gatewaySessionAdmission, parseSessionRailPolicy, resumeSession, usableContextTokens,
  type SessionRailPolicy, type SessionRouteContext } from "./session-rail.ts";
import { checkSessionAdmission } from "./session-admission-cli.ts";

const policy: SessionRailPolicy = {
  schema: "temperance.session-rail-policy.v1",
  aliases: { observe: "noesis-observe", think: "noesis-observe", plan: "noesis-plan", build: "noesis-build", execute: "noesis-execute", verify: "noesis-verify", learn: "noesis-observe" },
  longContextAliases: ["noesis-orchestrator", "noesis-build", "noesis-execute"], minimumContextTokens: 900000, preferredContextTokens: 1000000,
};
const context: SessionRouteContext = { runId: "run-a", sessionId: "session-a", projectId: "project-a", gsdStepId: "step-a", phase: "build", alias: "noesis-build" };
const now = "2026-09-19T10:00:00Z";
const budget = { inputTokens: 800000, systemTokens: 20000, toolTokens: 10000, outputTokens: 32000, headroomTokens: 32000 };

function input(): CapabilityResolutionInput {
  const loaded = loadSurfaceContract();
  if (!loaded.ok) throw new Error(loaded.reasonCode);
  // Fixture inventory derives names only from the tested contract, not a developer home.
  const skills = Object.fromEntries(Object.values(loaded.contract.alchemyMap.stages_detail).flatMap((stage) =>
    stage.primary_hubs.map((hub) => [hub.name, { role: "hub", status: "active-hub" }])));
  const seat = { provider: "fixture-provider", connectionId: "fixture-connection", model: "fixture-model" };
  return { surfaceContract: loaded.contract, clusterIndex: { skills }, surface: "codex", phase: "build", effort: "E1", now,
    selectedSeat: seat, mcpCapabilities: ["filesystem.read", "filesystem.write", "git.read", "git.write"],
    quotaEvidence: { ...seat, freshness: "fresh", observedAt: now, window: "fixture", resetAt: "2026-09-20T10:00:00Z", remaining: 2 },
    contextEvidence: { ...seat, verifiedAt: now, maxTokens: 1000000, source: "connection-probe" } };
}
function boundedInput(): CapabilityResolutionInput {
  const attempt = input();
  attempt.phase = "observe";
  attempt.mcpCapabilities = attempt.surfaceContract.alchemyMap.stages_detail.observe!.mcp_policy.required;
  return attempt;
}
const boundedContext: SessionRouteContext = { ...context, phase: "observe", alias: "noesis-observe" };
const smallBudget = { inputTokens: 10000, systemTokens: 1000, toolTokens: 1000, outputTokens: 1000, headroomTokens: 1000 };
const roots: string[] = [];
function temp(): string { const root = mkdtempSync(join(tmpdir(), "session-rail-test-")); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("optional session rail policy", () => {
  test("is generic and validates thresholds and phase completeness", () => {
    const generic = { ...policy, aliases: Object.fromEntries(Object.keys(policy.aliases).map((phase) => [phase, `work-${phase}`])), longContextAliases: ["work-build"] };
    expect(parseSessionRailPolicy(generic).aliases.build).toBe("work-build");
    expect(() => parseSessionRailPolicy({ ...policy, minimumContextTokens: 1000001 })).toThrow("SESSION_POLICY_INVALID");
    expect(() => parseSessionRailPolicy({ ...policy, aliases: { build: "x" } })).toThrow("SESSION_POLICY_INVALID");
    expect(() => parseSessionRailPolicy({ ...policy, aliases: { ...policy.aliases, build: 123 } })).toThrow("SESSION_POLICY_INVALID");
  });
  test("900k floor applies at E1, not just E4/E5", () => {
    const attempt = input();
    expect(admitSessionAttempt(policy, context, attempt, 1000000, budget).ok).toBe(true);
    attempt.contextEvidence!.maxTokens = 899999;
    expect(admitSessionAttempt(policy, context, attempt, 1000000, budget)).toMatchObject({ ok: false, reasonCode: "context_window_insufficient" });
    attempt.contextEvidence!.maxTokens = 900000;
    expect(admitSessionAttempt(policy, context, attempt, 900000, budget).ok).toBe(true);
  });
  test("every fallback requires its own exact fresh context and quota evidence", () => {
    const attempt = input();
    expect(admitSessionAttempt(policy, context, attempt, 1000000, budget).ok).toBe(true);
    attempt.selectedSeat = { ...attempt.selectedSeat, connectionId: "fallback-connection" };
    expect(admitSessionAttempt(policy, context, attempt, 1000000, budget)).toMatchObject({ ok: false, reasonCode: "quota_identity_mismatch" });
    attempt.quotaEvidence!.connectionId = "fallback-connection";
    expect(admitSessionAttempt(policy, context, attempt, 1000000, budget)).toMatchObject({ ok: false, reasonCode: "context_identity_mismatch" });
    attempt.contextEvidence!.connectionId = "fallback-connection";
    attempt.contextEvidence!.maxTokens = 200000;
    expect(admitSessionAttempt(policy, context, attempt, 1000000, budget)).toMatchObject({ ok: false, reasonCode: "context_window_insufficient" });
  });
  test.each(["2026-09-17T10:00:00Z", "2026-09-20T10:00:00Z", "not-a-date"])("rejects stale/future/invalid evidence: %s", (verifiedAt) => {
    const attempt = input(); attempt.contextEvidence!.verifiedAt = verifiedAt;
    expect(admitSessionAttempt(policy, context, attempt, 1000000, budget)).toMatchObject({ ok: false, reasonCode: "context_evidence_stale" });
  });
  test("requires verified harness capacity and reserves input budget", () => {
    expect(admitSessionAttempt(policy, context, input(), undefined, budget)).toMatchObject({ ok: false, reasonCode: "harness_context_unverified" });
    expect(admitSessionAttempt(policy, context, input(), 200000, budget)).toMatchObject({ ok: false, reasonCode: "harness_context_insufficient" });
    expect(usableContextTokens(1000000, budget)).toBe(906000);
    expect(admitSessionAttempt(policy, context, input(), 1000000, { ...budget, inputTokens: 906001 })).toMatchObject({ ok: false, reasonCode: "context_budget_exceeded" });
    expect(() => usableContextTokens(1000000, { ...budget, toolTokens: -1 })).toThrow("CONTEXT_BUDGET_INVALID");
  });
  test("bounded workers still validate exact fresh context before using its budget", () => {
    const mutations = [
      { connectionId: "different-seat", expected: "context_identity_mismatch" },
      { provider: "different-provider", expected: "context_identity_mismatch" },
      { model: "different-model", expected: "context_identity_mismatch" },
      { verifiedAt: "2020-01-01T00:00:00Z", expected: "context_evidence_stale" },
      { verifiedAt: "2026-09-20T10:00:00Z", expected: "context_evidence_stale" },
      { source: "untrusted", expected: "context_window_insufficient" },
    ];
    for (const { expected, ...mutation } of mutations) {
      const attempt = boundedInput();
      Object.assign(attempt.contextEvidence!, mutation);
      expect(admitSessionAttempt(policy, boundedContext, attempt, 1000000, budget)).toMatchObject({ ok: false, reasonCode: expected });
    }
    const missing = boundedInput(); delete missing.contextEvidence;
    expect(admitSessionAttempt(policy, boundedContext, missing, 128000, smallBudget)).toMatchObject({ ok: false, reasonCode: "context_evidence_missing" });
    const bounded = boundedInput(); bounded.contextEvidence!.maxTokens = 128000;
    expect(admitSessionAttempt(policy, boundedContext, bounded, 128000, smallBudget)).toMatchObject({ ok: true, value: { contextClass: { kind: "verified", maxTokens: 128000 } } });
  });
  test.each(["E4", "E5"] as const)("%s applies the same implicit 1M floor to provider and harness", (effort) => {
    const attempt = boundedInput(); attempt.effort = effort;
    expect(admitSessionAttempt(policy, boundedContext, attempt, 128000, smallBudget)).toMatchObject({ ok: false, reasonCode: "harness_context_insufficient" });
    expect(admitSessionAttempt(policy, boundedContext, attempt, 1000000, smallBudget).ok).toBe(true);
    attempt.requiredContextTokens = 64000;
    expect(admitSessionAttempt(policy, boundedContext, attempt, 128000, smallBudget)).toMatchObject({ ok: false, reasonCode: "harness_context_insufficient" });
    attempt.contextEvidence!.maxTokens = 999999;
    expect(admitSessionAttempt(policy, boundedContext, attempt, 1000000, smallBudget)).toMatchObject({ ok: false, reasonCode: "context_window_insufficient" });
    const longAttempt = input(); longAttempt.effort = effort; longAttempt.contextEvidence!.maxTokens = 900000;
    expect(admitSessionAttempt(policy, context, longAttempt, 1000000, smallBudget)).toMatchObject({ ok: false, reasonCode: "context_window_insufficient" });
  });
  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])("invalid explicit requirement cannot be masked by policy floor: %s", (requiredContextTokens) => {
    expect(admitSessionAttempt(policy, context, { ...input(), requiredContextTokens }, 1000000, budget)).toMatchObject({ ok: false, reasonCode: "context_window_insufficient" });
  });
  test("gateway support cannot be inferred from selected aliases", () => {
    expect(gatewaySessionAdmission("9router", policy, "noesis-build")).toEqual({ ok: false, reasonCode: "GATEWAY_ATTEMPT_ADMISSION_UNAVAILABLE" });
  });
  test("portable core works without a personal policy, explicit missing policy holds", () => {
    const root = temp();
    expect(checkSessionAdmission(["build", "work-build"], { TEMPERANCE_STATE: root })).toMatchObject({ ok: true });
    expect(() => checkSessionAdmission(["build", "work-build"], { TEMPERANCE_SESSION_POLICY: join(root, "missing") })).toThrow("SESSION_POLICY_MISSING");
    expect(checkSessionAdmission(["--alias", "provider/model"], { TEMPERANCE_STATE: root })).toMatchObject({ ok: true });
  });
  test("blank explicit policies never disable the default policy", () => {
    for (const value of ["", " ", "\n\t"]) {
      expect(() => checkSessionAdmission(["--alias", "noesis-build"], { TEMPERANCE_SESSION_POLICY: value })).toThrow("SESSION_POLICY_INVALID");
    }
  });
  test("default policy honors the supplied HOME and alias-only requests fail closed", () => {
    const home = temp(); mkdirSync(join(home, ".temperance"));
    writeFileSync(join(home, ".temperance", "session-policy.json"), JSON.stringify(policy));
    expect(checkSessionAdmission(["build", "noesis-build"], { HOME: home })).toEqual({ ok: false, reasonCode: "GATEWAY_ATTEMPT_ADMISSION_UNAVAILABLE" });
    expect(checkSessionAdmission(["--alias", "noesis-orchestrator"], { HOME: home })).toEqual({ ok: false, reasonCode: "GATEWAY_ATTEMPT_ADMISSION_UNAVAILABLE" });
    expect(checkSessionAdmission(["--alias", "provider/model"], { HOME: home })).toEqual({ ok: false, reasonCode: "SESSION_ALIAS_UNKNOWN" });
  });
  test("dangling default and explicit policy symlinks are invalid, not unselected", () => {
    const state = temp(); const file = join(state, "session-policy.json");
    symlinkSync(join(state, "missing-target.json"), file);
    expect(() => checkSessionAdmission(["--alias", "noesis-build"], { TEMPERANCE_STATE: state })).toThrow("SESSION_POLICY_INVALID");
    expect(() => checkSessionAdmission(["build", "noesis-build"], { TEMPERANCE_SESSION_POLICY: file })).toThrow("SESSION_POLICY_INVALID");
  });
  test.each(["noesis-build", "noesis-orchestrator", "provider/model"])("common wire blocks %s before Codex or Keychain access", (alias) => {
    const root = temp(); const file = join(root, "policy.json");
    writeFileSync(file, JSON.stringify(policy));
    for (const command of ["codex", "security"]) {
      writeFileSync(join(root, command), `#!/bin/sh\necho UNEXPECTED_${command}_INVOCATION >&2\nexit 42\n`, { mode: 0o700 });
    }
    const result = Bun.spawnSync(["/bin/bash", join(import.meta.dir, "omniroute-codex.sh"), alias, "fixture only"], {
      env: { PATH: `${root}:/usr/bin:/bin`, HOME: root, USER: "fixture", TEMPERANCE_SESSION_POLICY: file, TEMPERANCE_BUN: process.execPath },
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderr.toString()).toContain(alias === "provider/model" ? "SESSION_ALIAS_UNKNOWN" : "GATEWAY_ATTEMPT_ADMISSION_UNAVAILABLE");
    expect(result.stderr.toString()).not.toContain("UNEXPECTED_");
    expect(result.stdout.toString()).toBe("");
  });
  test("common wire remains portable without a policy using only a stub Codex", () => {
    const root = temp();
    writeFileSync(join(root, "codex"), "#!/bin/sh\necho STUB_CODEX_ONLY >&2\nexit 42\n", { mode: 0o700 });
    writeFileSync(join(root, "security"), "#!/bin/sh\necho UNEXPECTED_KEYCHAIN >&2\nexit 42\n", { mode: 0o700 });
    const result = Bun.spawnSync(["/bin/bash", join(import.meta.dir, "omniroute-codex.sh"), "provider/model", "fixture only"], {
      env: { PATH: `${root}:/usr/bin:/bin`, HOME: root, USER: "fixture", TEMPERANCE_BUN: process.execPath, OMNIROUTE_API_KEY: "fixture-not-a-real-key" },
    });
    expect(result.exitCode).toBe(42);
    expect(result.stderr.toString()).toContain("OPTIONAL_SESSION_POLICY_NOT_SELECTED");
    expect(result.stderr.toString()).toContain("STUB_CODEX_ONLY");
    expect(result.stderr.toString()).not.toContain("UNEXPECTED_KEYCHAIN");
  });
  test.each(["omniroute-claude.sh", "omniroute-opencode.sh"])("%s holds selected policy before Keychain or native launcher calls", (launcher) => {
    const root = temp(); const file = join(root, "policy.json");
    writeFileSync(file, JSON.stringify(policy));
    const stub = join(root, "native-stub");
    const security = join(root, "security-stub");
    writeFileSync(stub, "#!/bin/sh\necho UNEXPECTED_NATIVE_LAUNCH >&2\nexit 42\n", { mode: 0o700 });
    writeFileSync(security, "#!/bin/sh\necho UNEXPECTED_KEYCHAIN_ACCESS >&2\nexit 42\n", { mode: 0o700 });
    const args = launcher === "omniroute-claude.sh" ? ["gh-claude-sonnet-5", "--fixture"] : ["run", "fixture only"];
    const result = Bun.spawnSync(["/bin/bash", join(import.meta.dir, launcher), ...args], {
      env: {
        PATH: "/usr/bin:/bin", HOME: root, USER: "fixture", TEMPERANCE_SESSION_POLICY: file, TEMPERANCE_BUN: process.execPath,
        TEMPERANCE_SECURITY_BIN: security, TEMPERANCE_OMNIROUTE_BIN: stub, TEMPERANCE_REAL_CLAUDE_BIN: stub, TEMPERANCE_REAL_OPENCODE_BIN: stub,
      },
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderr.toString()).toContain("SESSION_ALIAS_UNKNOWN");
    expect(result.stderr.toString()).not.toContain("UNEXPECTED_");
    expect(result.stdout.toString()).toBe("");
  });
  test.each(["omniroute-claude.sh", "omniroute-opencode.sh"])("%s preserves no-policy launch behavior with fake credentials and launcher only", (launcher) => {
    const root = temp(); const stub = join(root, "native-stub"); const security = join(root, "security-stub");
    writeFileSync(stub, "#!/bin/sh\necho STUB_NATIVE_ONLY >&2\nprintf '<%s>' \"$@\" >&2\nexit 42\n", { mode: 0o700 });
    writeFileSync(security, "#!/bin/sh\nprintf fixture-not-a-real-key\n", { mode: 0o700 });
    const args = launcher === "omniroute-claude.sh" ? ["gh-claude-sonnet-5", "--fixture", "with spaces"] : ["run", "with spaces"];
    const result = Bun.spawnSync(["/bin/bash", join(import.meta.dir, launcher), ...args], {
      env: {
        PATH: "/usr/bin:/bin", HOME: root, USER: "fixture", TEMPERANCE_BUN: process.execPath,
        TEMPERANCE_SECURITY_BIN: security, TEMPERANCE_OMNIROUTE_BIN: stub, TEMPERANCE_REAL_CLAUDE_BIN: stub, TEMPERANCE_REAL_OPENCODE_BIN: stub,
      },
    });
    expect(result.exitCode).toBe(42);
    expect(result.stderr.toString()).toContain("OPTIONAL_SESSION_POLICY_NOT_SELECTED");
    expect(result.stderr.toString()).toContain("STUB_NATIVE_ONLY");
    expect(result.stderr.toString()).toContain("<with spaces>");
    expect(result.stderr.toString()).not.toContain("fixture-not-a-real-key");
  });
  test.each(["omniroute-codex.sh", "omniroute-claude.sh", "omniroute-opencode.sh"])("%s locates the admission gate through a launcher symlink", (launcher) => {
    const root = temp(); const file = join(root, "policy.json"); const link = join(root, "launcher");
    writeFileSync(file, JSON.stringify(policy));
    symlinkSync(join(import.meta.dir, launcher), link);
    const args = launcher === "omniroute-claude.sh" ? ["gh-claude-sonnet-5"] : ["noesis-build", "fixture only"];
    const result = Bun.spawnSync(["/bin/bash", link, ...args], {
      env: { PATH: "/usr/bin:/bin", HOME: root, USER: "fixture", TEMPERANCE_SESSION_POLICY: file, TEMPERANCE_BUN: process.execPath },
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderr.toString()).toContain(launcher === "omniroute-codex.sh" ? "GATEWAY_ATTEMPT_ADMISSION_UNAVAILABLE" : "SESSION_ALIAS_UNKNOWN");
    expect(result.stderr.toString()).not.toContain("Module not found");
  });
  test("actual dispatcher refuses the wire when selected long-session policy cannot be enforced", () => {
    const root = temp(); const file = join(root, "policy.json");
    writeFileSync(file, JSON.stringify(policy));
    const result = Bun.spawnSync(["bash", join(import.meta.dir, "temperance-phase-dispatch.sh"), "build", "fixture only"], {
      env: { ...process.env, TEMPERANCE_SESSION_POLICY: file, TEMPERANCE_OMNIROUTE_CODEX: "/usr/bin/false", TEMPERANCE_BUN: process.execPath },
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderr.toString()).toContain("GATEWAY_ATTEMPT_ADMISSION_UNAVAILABLE");
    expect(result.stdout.toString()).toBe("");
  });
});

describe("checkpoint identity", () => {
  test("pins the work and policy while requiring fresh session and fresh admission", () => {
    const checkpoint = checkpointSession(policy, context, "disconnect", "continuation-1", now);
    const resumed = resumeSession(policy, checkpoint, { ...context, sessionId: "session-b" }, now);
    expect(resumed.gsdStepId).toBe(context.gsdStepId);
    expect(() => resumeSession(policy, checkpoint, context, now)).toThrow("SESSION_RESUME_REQUIRES_FRESH_SESSION");
    expect(() => resumeSession(policy, checkpoint, { ...context, sessionId: "session-b", projectId: "other" }, now)).toThrow("SESSION_RESUME_IDENTITY_MISMATCH");
    expect(() => resumeSession({ ...policy, minimumContextTokens: 950000 }, checkpoint, resumed, now)).toThrow("SESSION_CHECKPOINT_INVALID");
  });
  test("rejects malformed checkpoint and routes with a mismatched phase alias", () => {
    expect(() => checkpointSession(policy, { ...context, alias: "noesis-plan" }, "disconnect", "ref", now)).toThrow("SESSION_ROUTE_CONTEXT_INVALID");
    const checkpoint = checkpointSession(policy, context, "context-pressure", "ref", now);
    expect(() => resumeSession(policy, { ...checkpoint, checkpointedAt: "invalid" }, { ...context, sessionId: "new" }, now)).toThrow("SESSION_CHECKPOINT_INVALID");
    expect(() => resumeSession(policy, checkpoint, { ...context, sessionId: "new" }, "invalid")).toThrow("SESSION_CHECKPOINT_INVALID");
  });
});
