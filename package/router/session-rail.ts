/** Optional host policy. No provider membership, credentials, or personal imports. */
import { createHash } from "node:crypto";
import { resolvePhaseCapabilityContract, type CapabilityResolutionInput, type PhaseCapabilityResult } from "./phase-capability-contract.ts";

export interface SessionRailPolicy {
  schema: "temperance.session-rail-policy.v1";
  aliases: Record<string, string>;
  longContextAliases: string[];
  minimumContextTokens: number;
  preferredContextTokens: number;
}

export interface SessionRouteContext {
  runId: string;
  sessionId: string;
  projectId: string;
  gsdStepId: string;
  phase: string;
  alias: string;
}

export interface ContextBudget {
  inputTokens: number;
  systemTokens: number;
  toolTokens: number;
  outputTokens: number;
  headroomTokens: number;
}

const phases = ["observe", "think", "plan", "build", "execute", "verify", "learn"];
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}
function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function parseSessionRailPolicy(value: unknown): SessionRailPolicy {
  if (!record(value) || !exactKeys(value, ["schema", "aliases", "longContextAliases", "minimumContextTokens", "preferredContextTokens"])
    || value.schema !== "temperance.session-rail-policy.v1" || !record(value.aliases)
    || Object.keys(value.aliases).some((phase) => !phases.includes(phase))
    || phases.some((phase) => {
      const alias = (value.aliases as Record<string, unknown>)[phase];
      return typeof alias !== "string" || !identifier.test(alias);
    })
    || !Array.isArray(value.longContextAliases) || value.longContextAliases.length === 0
    || value.longContextAliases.some((alias) => typeof alias !== "string" || !identifier.test(alias))
    || new Set(value.longContextAliases).size !== value.longContextAliases.length
    || !positive(value.minimumContextTokens) || !positive(value.preferredContextTokens)
    || value.minimumContextTokens > value.preferredContextTokens) throw new Error("SESSION_POLICY_INVALID");
  return structuredClone(value) as unknown as SessionRailPolicy;
}

export function parseSessionRouteContext(value: unknown, policy: SessionRailPolicy): SessionRouteContext {
  if (!record(value) || !exactKeys(value, ["runId", "sessionId", "projectId", "gsdStepId", "phase", "alias"])
    || Object.values(value).some((part) => typeof part !== "string" || !identifier.test(part))
    || !phases.includes(String(value.phase)) || policy.aliases[String(value.phase)] !== value.alias) {
    throw new Error("SESSION_ROUTE_CONTEXT_INVALID");
  }
  return { ...value } as unknown as SessionRouteContext;
}

export function usableContextTokens(total: number, budget: ContextBudget): number {
  if (!positive(total) || !record(budget) || !exactKeys(budget, ["inputTokens", "systemTokens", "toolTokens", "outputTokens", "headroomTokens"])
    || Object.values(budget).some((value) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    || budget.outputTokens === 0 || budget.headroomTokens === 0) throw new Error("CONTEXT_BUDGET_INVALID");
  const usable = total - budget.systemTokens - budget.toolTokens - budget.outputTokens - budget.headroomTokens;
  if (!Number.isSafeInteger(usable) || usable < 0 || budget.inputTokens > usable) throw new Error("CONTEXT_BUDGET_EXCEEDED");
  return usable;
}

export type SessionAttemptResult = PhaseCapabilityResult | {
  ok: false;
  reasonCode: "session_alias_mismatch" | "harness_context_unverified" | "harness_context_insufficient" | "context_budget_invalid" | "context_budget_exceeded";
};

/** Called by an attempt-aware gateway adapter for EACH selected connection/fallback. */
export function admitSessionAttempt(policyInput: SessionRailPolicy, contextInput: SessionRouteContext,
  input: CapabilityResolutionInput, harnessContextTokens: number | undefined, budget: ContextBudget): SessionAttemptResult {
  const policy = parseSessionRailPolicy(policyInput);
  const context = parseSessionRouteContext(contextInput, policy);
  if (context.phase !== input.phase || policy.aliases[input.phase] !== context.alias) return { ok: false, reasonCode: "session_alias_mismatch" };
  if (input.requiredContextTokens !== undefined && !positive(input.requiredContextTokens)) {
    return { ok: false, reasonCode: "context_window_insufficient" };
  }
  // A single effective floor governs both provider and harness capacity. Even
  // bounded workers consume context evidence for the budget, so the minimum
  // value of 1 deliberately requires exact, fresh evidence for every attempt.
  const floor = Math.max(
    1,
    policy.longContextAliases.includes(context.alias) ? policy.minimumContextTokens : 0,
    input.effort === "E4" || input.effort === "E5" ? 1_000_000 : 0,
    input.requiredContextTokens ?? 0,
  );
  const result = resolvePhaseCapabilityContract({ ...input, requiredContextTokens: floor });
  if (!result.ok) return result;
  if (result.value.workerLane !== context.alias) return { ok: false, reasonCode: "session_alias_mismatch" };
  if (!positive(harnessContextTokens)) return { ok: false, reasonCode: "harness_context_unverified" };
  if (harnessContextTokens < floor) return { ok: false, reasonCode: "harness_context_insufficient" };
  if (!input.contextEvidence) return { ok: false, reasonCode: "context_evidence_missing" };
  try { usableContextTokens(Math.min(harnessContextTokens, input.contextEvidence.maxTokens), budget); }
  catch (error) {
    return { ok: false, reasonCode: error instanceof Error && error.message === "CONTEXT_BUDGET_EXCEEDED" ? "context_budget_exceeded" : "context_budget_invalid" };
  }
  return result;
}

export interface SessionCheckpoint {
  schema: "temperance.session-checkpoint.v1";
  context: SessionRouteContext;
  policyDigest: string;
  reason: "phase-change" | "disconnect" | "context-pressure";
  checkpointedAt: string;
  continuationRef: string;
  requiresFreshSession: true;
}

export function sessionPolicyDigest(policy: SessionRailPolicy): string {
  const p = parseSessionRailPolicy(policy);
  return `sha256:${createHash("sha256").update(JSON.stringify({
    schema: p.schema, aliases: phases.map((phase) => [phase, p.aliases[phase]]),
    longContextAliases: [...p.longContextAliases].sort(), minimumContextTokens: p.minimumContextTokens,
    preferredContextTokens: p.preferredContextTokens,
  })).digest("hex")}`;
}

export function checkpointSession(policy: SessionRailPolicy, context: SessionRouteContext, reason: SessionCheckpoint["reason"],
  continuationRef: string, now: string): SessionCheckpoint {
  if (!["phase-change", "disconnect", "context-pressure"].includes(reason) || !identifier.test(continuationRef)
    || !Number.isFinite(Date.parse(now))) throw new Error("SESSION_CHECKPOINT_INVALID");
  return { schema: "temperance.session-checkpoint.v1", context: parseSessionRouteContext(context, policy),
    policyDigest: sessionPolicyDigest(policy), reason, checkpointedAt: now, continuationRef, requiresFreshSession: true };
}

/** Pure identity validation, not a persisted recovery/continuation authority.
 * A production GSD adapter must persist checkpoints and obtain fresh admission;
 * returning this context does not grant dispatch or claim a continuation.
 */
export function resumeSession(policy: SessionRailPolicy, checkpoint: SessionCheckpoint, next: SessionRouteContext, now: string): SessionRouteContext {
  if (!record(checkpoint) || !exactKeys(checkpoint, ["schema", "context", "policyDigest", "reason", "checkpointedAt", "continuationRef", "requiresFreshSession"])
    || checkpoint.schema !== "temperance.session-checkpoint.v1" || checkpoint.requiresFreshSession !== true
    || checkpoint.policyDigest !== sessionPolicyDigest(policy) || !Number.isFinite(Date.parse(now))
    || Date.parse(checkpoint.checkpointedAt) > Date.parse(now)) throw new Error("SESSION_CHECKPOINT_INVALID");
  const expected = checkpointSession(policy, checkpoint.context, checkpoint.reason, checkpoint.continuationRef, checkpoint.checkpointedAt);
  const context = parseSessionRouteContext(next, policy);
  if (context.sessionId === expected.context.sessionId) throw new Error("SESSION_RESUME_REQUIRES_FRESH_SESSION");
  for (const key of ["runId", "projectId", "gsdStepId", "phase", "alias"] as const) {
    if (context[key] !== expected.context[key]) throw new Error("SESSION_RESUME_IDENTITY_MISMATCH");
  }
  return context;
}

/** The stock 0.5.75 API adapter exposes no verified pre-attempt capability hook.
 * Never upgrade this to true from a profile field or a saved evidence file.
 * Supporting a gateway requires a trusted adapter that gates every fallback.
 */
export function gatewaySessionAdmission(gateway: string, policy: SessionRailPolicy, alias: string): { ok: boolean; reasonCode: string } {
  parseSessionRailPolicy(policy);
  if (!Object.values(policy.aliases).includes(alias) && !policy.longContextAliases.includes(alias)) return { ok: false, reasonCode: "SESSION_ALIAS_UNKNOWN" };
  if (policy.longContextAliases.includes(alias)) return { ok: false, reasonCode: "GATEWAY_ATTEMPT_ADMISSION_UNAVAILABLE" };
  // Unbounded gateway-side selection cannot prove the skill/quota/seat contract either.
  return { ok: false, reasonCode: gateway === "9router" ? "GATEWAY_ATTEMPT_ADMISSION_UNAVAILABLE" : "GATEWAY_ADAPTER_UNSUPPORTED" };
}
