import { types } from "node:util";
import {
  buildReceipt, ROUTING_OBSERVATION_MAX_COUNT, ROUTING_OBSERVATION_RECEIPT_SCHEMA,
  type Attribution, type ReceiptContent, type ReceiptPolicy, type ReceiptResult, type ToolState,
} from "./contracts/routing-observation-receipt.v1";

export type AttemptIdentity =
  | { state: "available"; provider: string; model: string }
  | { state: "unavailable" };
/** Null binding is explicitly unbound. Ordinals identify attempts only within this observation. */
export interface RoutingAttemptEvidence {
  observation_id: string | null;
  ordinal: number;
  phase: "terminal" | "pending";
  outcome: "succeeded" | "failed" | "unavailable";
  termination: "completed" | "not_streamed" | "incomplete" | "unavailable";
  identity: AttemptIdentity;
}
export type RoutingToolEvidence =
  | { state: "unavailable"; reason_code: "not_instrumented" | "evidence_unavailable" }
  | {
    state: "available";
    coverage: "complete" | "incomplete";
    terminal_evidence: boolean;
    started_count: number;
    completed_count: number;
    failed_count: number;
  };
export interface RoutingObservationEvidence {
  request: ReceiptContent["request"];
  attempts: { state: "available"; records: readonly RoutingAttemptEvidence[] } | { state: "unavailable" };
  tools: RoutingToolEvidence;
}
export interface RoutingObservationContext {
  observation_id: string;
  project_ref: string;
  observed_at: string;
  fresh_until: string;
  evidence_mode: ReceiptContent["evidence_mode"];
  provenance: ReceiptContent["provenance"];
  policy: ReceiptPolicy;
}
export const ROUTING_OBSERVATION_ADAPTER_REJECTION_CODES = Object.freeze(["INVALID_EVIDENCE", "INVALID_CONTEXT"] as const);
export type RoutingObservationAdapterResult = ReceiptResult | {
  ok: false; code: (typeof ROUTING_OBSERVATION_ADAPTER_REJECTION_CODES)[number];
};

function check(condition: unknown): asserts condition { if (!condition) throw new Error("INVALID_INPUT"); }
type Plain = Record<string, any>;
function exact(value: any, fields: readonly string[]): asserts value is Plain {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  check(Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)));
}
function member(value: unknown, allowed: readonly string[]): void { check(typeof value === "string" && allowed.includes(value)); }
function count(value: unknown, minimum = 0): void {
  check(typeof value === "number" && Number.isInteger(value) && !Object.is(value, -0) && value >= minimum && value <= ROUTING_OBSERVATION_MAX_COUNT);
}
function matches(value: unknown, pattern: RegExp): void { check(typeof value === "string" && pattern.test(value)); }

/** Detach before inspection; never execute input getters, proxy traps, iterators or coercion. */
function detached(input: unknown): any {
  const active = new Set<object>();
  let nodes = 0;
  function copy(value: unknown, depth: number): any {
    check(++nodes <= 250_000 && depth <= 8);
    if (typeof value === "string") {
      check(value.length <= 4096 && !/[\u0000-\u001f\u007f-\u009f]/.test(value));
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = value.charCodeAt(++i);
          check(next >= 0xdc00 && next <= 0xdfff);
        } else check(code < 0xdc00 || code > 0xdfff);
      }
      return value;
    }
    if (typeof value === "number") { check(Number.isFinite(value)); return value; }
    if (typeof value === "boolean" || value === null) return value;
    check(typeof value === "object" && value !== null && !types.isProxy(value) && !active.has(value));
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    check(array ? proto === Array.prototype : proto === Object.prototype || proto === null);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    check(keys.every(key => typeof key === "string"));
    active.add(value);
    let result: any;
    if (array) {
      const length = descriptors.length?.value;
      count(length);
      check(keys.length === length + 1);
      result = [];
      for (let i = 0; i < length; i++) {
        const descriptor = descriptors[String(i)];
        check(descriptor && descriptor.enumerable && "value" in descriptor);
        result.push(copy(descriptor.value, depth + 1));
      }
    } else {
      check(keys.length <= 16);
      result = Object.create(null);
      for (const key of keys as string[]) {
        const descriptor = descriptors[key];
        check(/^[a-z_][a-z0-9_]*$/.test(key) && descriptor.enumerable && "value" in descriptor);
        result[key] = copy(descriptor.value, depth + 1);
      }
    }
    active.delete(value);
    return result;
  }
  return copy(input, 0);
}

function evidence(input: unknown): RoutingObservationEvidence {
  const value = detached(input);
  exact(value, ["request", "attempts", "tools"]);
  exact(value.request, ["outcome"]);
  member(value.request.outcome, ["succeeded", "failed", "unavailable"]);
  const attempts = value.attempts;
  check(attempts !== null && typeof attempts === "object");
  if (attempts.state === "unavailable") exact(attempts, ["state"]);
  else {
    exact(attempts, ["state", "records"]);
    check(attempts.state === "available" && Array.isArray(attempts.records));
    for (const attempt of attempts.records) {
      exact(attempt, ["observation_id", "ordinal", "phase", "outcome", "termination", "identity"]);
      if (attempt.observation_id !== null) matches(attempt.observation_id, /^obs_[a-f0-9]{32}$/);
      count(attempt.ordinal, 1);
      member(attempt.phase, ["terminal", "pending"]);
      member(attempt.outcome, ["succeeded", "failed", "unavailable"]);
      member(attempt.termination, ["completed", "not_streamed", "incomplete", "unavailable"]);
      const identity = attempt.identity;
      check(identity !== null && typeof identity === "object");
      if (identity.state === "unavailable") exact(identity, ["state"]);
      else {
        exact(identity, ["state", "provider", "model"]);
        check(identity.state === "available");
        matches(identity.provider, /^[a-z][a-z0-9_-]{0,63}$/);
        matches(identity.model, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/);
      }
    }
  }
  const tools = value.tools;
  check(tools !== null && typeof tools === "object");
  if (tools.state === "unavailable") {
    exact(tools, ["state", "reason_code"]);
    member(tools.reason_code, ["not_instrumented", "evidence_unavailable"]);
  } else {
    exact(tools, ["state", "coverage", "terminal_evidence", "started_count", "completed_count", "failed_count"]);
    check(tools.state === "available" && typeof tools.terminal_evidence === "boolean");
    member(tools.coverage, ["complete", "incomplete"]);
    count(tools.started_count); count(tools.completed_count); count(tools.failed_count);
    check(tools.completed_count + tools.failed_count <= tools.started_count);
  }
  return value as RoutingObservationEvidence;
}

const unavailable = (reason_code: Extract<Attribution, { state: "unavailable" }>["reason_code"]): Attribution => ({ state: "unavailable", reason_code });
function attribution(input: RoutingObservationEvidence["attempts"], context: RoutingObservationContext): Attribution {
  if (input.state === "unavailable") return unavailable("evidence_unavailable");
  const successes = input.records.filter(record => record.outcome === "succeeded");
  if (successes.length === 0) return unavailable("no_successful_attempt");
  // Group once so a full bounded evidence set remains linear, including duplicates.
  const boundByOrdinal = new Map<number, RoutingAttemptEvidence>();
  const conflictingOrdinals = new Set<number>();
  for (const record of input.records) {
    if (record.observation_id !== context.observation_id) continue;
    const prior = boundByOrdinal.get(record.ordinal);
    if (!prior) { boundByOrdinal.set(record.ordinal, record); continue; }
    if (record.phase !== prior.phase || record.outcome !== prior.outcome || record.termination !== prior.termination ||
      record.identity.state !== prior.identity.state || (record.identity.state === "available" && prior.identity.state === "available" &&
        (record.identity.provider !== prior.identity.provider || record.identity.model !== prior.identity.model))) {
      conflictingOrdinals.add(record.ordinal);
    }
  }
  if (successes.some(record => record.observation_id === context.observation_id && conflictingOrdinals.has(record.ordinal))) {
    return { state: "ambiguous", reason_code: "conflicting_attribution" };
  }
  // Foreign/unbound or unfinished success declarations cannot establish a winner.
  if (successes.some(record => record.observation_id !== context.observation_id || record.phase !== "terminal" || !["completed", "not_streamed"].includes(record.termination))) {
    return unavailable("evidence_unavailable");
  }
  const ordinals = new Set(successes.map(record => record.ordinal));
  if (ordinals.size > 1) return { state: "ambiguous", reason_code: "multiple_successful_bindings" };
  const winner = successes[0];
  if (winner.identity.state === "unavailable") return unavailable("missing_attribution");
  const { provider, model } = winner.identity;
  if (!context.policy.catalog.some(pair => pair.provider === provider && pair.model === model)) return unavailable("unsupported_identity");
  return { state: "observed", provider, model, successful_attempt_ordinal: winner.ordinal, evidence_basis: "terminal-attempt-record" };
}

function toolState(input: RoutingToolEvidence): ToolState {
  if (input.state === "unavailable") return { state: "unavailable", reason_code: input.reason_code };
  const counts = { started_count: input.started_count, completed_count: input.completed_count, failed_count: input.failed_count };
  if (input.failed_count > 0) return { state: "incomplete", reason_code: "tool_failed", ...counts };
  if (input.started_count > input.completed_count) return { state: "incomplete", reason_code: "open_tools", ...counts };
  if (input.coverage !== "complete" || !input.terminal_evidence) return { state: "incomplete", reason_code: "coverage_incomplete", ...counts };
  return { state: "completed", ...counts };
}

/** Pure local declaration adapter. Trusted callers supply policy and evidence; neither
 * this function nor the receipt digest authenticates a provider or grants execution authority.
 * Unknown inputs are intentional: runtime callers must pass the same exact typed boundary.
 */
export function adaptRoutingObservation(input: unknown, contextInput: unknown): RoutingObservationAdapterResult {
  let context: RoutingObservationContext;
  let base: ReceiptContent;
  try {
    context = detached(contextInput);
    exact(context, ["observation_id", "project_ref", "observed_at", "fresh_until", "evidence_mode", "provenance", "policy"]);
    base = {
      schema: ROUTING_OBSERVATION_RECEIPT_SCHEMA, source: "product-routing-adapter",
      observation_id: context.observation_id, project_ref: context.project_ref,
      observed_at: context.observed_at, fresh_until: context.fresh_until,
      evidence_mode: context.evidence_mode, provenance: context.provenance,
      request: { outcome: "unavailable" }, attribution: unavailable("evidence_unavailable"),
      tools: { state: "unavailable", reason_code: "evidence_unavailable" },
    };
    // Validate explicit context and catalog before reading them during attribution.
    const checked = buildReceipt(base, context.policy);
    if (!checked.ok) return { ok: false, code: "INVALID_CONTEXT" };
  } catch { return { ok: false, code: "INVALID_CONTEXT" }; }
  try {
    const reviewed = evidence(input);
    return buildReceipt({ ...base, request: reviewed.request, attribution: attribution(reviewed.attempts, context), tools: toolState(reviewed.tools) }, context.policy);
  } catch { return { ok: false, code: "INVALID_EVIDENCE" }; }
}
