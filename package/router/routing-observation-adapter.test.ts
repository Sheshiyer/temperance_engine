import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { adaptRoutingObservation, type RoutingObservationContext, type RoutingObservationEvidence } from "./routing-observation-adapter";
import { validateReceipt } from "./contracts/routing-observation-receipt.v1";

function context(): RoutingObservationContext {
  return {
    observation_id: "obs_" + "1".repeat(32), project_ref: "prj_synthetic-project",
    observed_at: "2026-09-07T00:00:00.000Z", fresh_until: "2026-09-07T00:01:00.000Z", evidence_mode: "synthetic",
    provenance: { product_source_commit: "2".repeat(40), closure_sha256: "3".repeat(64), contract_sha256: "4".repeat(64) },
    policy: { registered_projects: ["prj_synthetic-project"], catalog: [
      { provider: "synthetic", model: "synthetic/model-v1" }, { provider: "other", model: "other/model-v2" },
    ], max_freshness_ms: 60_000 },
  };
}
function evidence(): any {
  return {
    request: { outcome: "succeeded" },
    attempts: { state: "available", records: [{ observation_id: context().observation_id, ordinal: 2,
      phase: "terminal", outcome: "succeeded", termination: "completed",
      identity: { state: "available", provider: "synthetic", model: "synthetic/model-v1" },
    }] },
    tools: { state: "available", coverage: "complete", terminal_evidence: true, started_count: 0, completed_count: 0, failed_count: 0 },
  } satisfies RoutingObservationEvidence;
}
function receipt(input: unknown = evidence(), ctx: unknown = context()) {
  const result = adaptRoutingObservation(input, ctx);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.receipt;
}
function unavailable(reason_code: string) { return { state: "unavailable", reason_code }; }
function reject(input: unknown, ctx: unknown = context(), code = "INVALID_EVIDENCE") {
  expect(adaptRoutingObservation(input, ctx)).toEqual({ ok: false, code });
}
function freeze(value: any): any {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

describe("pure routing observation adapter", () => {
  test("produces a strict validated deterministic receipt from a unique bound terminal success", () => {
    const input = evidence(); const ctx = context();
    const result = adaptRoutingObservation(input, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateReceipt(result.receipt, ctx.policy)).toEqual(result);
    expect(result.receipt.attribution).toEqual({ state: "observed", provider: "synthetic", model: "synthetic/model-v1", successful_attempt_ordinal: 2, evidence_basis: "terminal-attempt-record" });
    expect(result.receipt.source).toBe("product-routing-adapter");
    expect(result.receipt.evidence_mode).toBe("synthetic");
    const inputBefore = JSON.stringify(input); const contextBefore = JSON.stringify(ctx);
    expect(adaptRoutingObservation(freeze(input), freeze(ctx))).toEqual(result);
    expect(JSON.stringify(input)).toBe(inputBefore); expect(JSON.stringify(ctx)).toBe(contextBefore);
    expect(result.receipt.provenance).not.toBe(ctx.provenance);
    expect(adaptRoutingObservation(Object.fromEntries(Object.entries(input).reverse()), Object.fromEntries(Object.entries(ctx).reverse()))).toEqual(result);
  });
  test("failed attempts do not become serving identities; actual unique success wins regardless of ordering", () => {
    const input = evidence();
    const failed = { ...input.attempts.records[0], ordinal: 1, outcome: "failed", identity: { state: "available", provider: "other", model: "other/model-v2" } };
    input.attempts.records.unshift(failed);
    expect(receipt(input).attribution).toEqual(receipt().attribution);
    const forward = adaptRoutingObservation(input, context());
    input.attempts.records.reverse();
    expect(adaptRoutingObservation(input, context())).toEqual(forward);
    input.attempts.records = [failed];
    expect(receipt(input).attribution).toEqual(unavailable("no_successful_attempt"));
  });
  test("HTTP/request success and requested/configured head cannot provide attribution", () => {
    for (const attempts of [{ state: "unavailable" }, { state: "available", records: [] }]) {
      const input = evidence(); input.attempts = attempts;
      expect(receipt(input).attribution).toEqual(unavailable(attempts.state === "unavailable" ? "evidence_unavailable" : "no_successful_attempt"));
      expect(receipt(input).request.outcome).toBe("succeeded");
    }
    for (const field of ["http_status", "requested_head", "configured_head", "resolved_provider", "trailer"]) {
      const input = evidence(); input[field] = field === "http_status" ? 200 : "private-marker"; reject(input);
    }
  });
  test("requires observation binding, terminal phase and completed or non-streamed termination", () => {
    for (const patch of [{ observation_id: null }, { observation_id: "obs_" + "9".repeat(32) }, { phase: "pending" }, { termination: "incomplete" }, { termination: "unavailable" }]) {
      const input = evidence(); Object.assign(input.attempts.records[0], patch);
      expect(receipt(input).attribution).toEqual(unavailable("evidence_unavailable"));
    }
    const nonStreamed = evidence(); nonStreamed.attempts.records[0].termination = "not_streamed";
    expect(receipt(nonStreamed).attribution.state).toBe("observed");
    const mixed = evidence(); mixed.attempts.records.push({ ...mixed.attempts.records[0], ordinal: 3, observation_id: null });
    expect(receipt(mixed).attribution).toEqual(unavailable("evidence_unavailable"));
  });
  test("preserves missing and unreviewed identities without leaking their values", () => {
    const missing = evidence(); missing.attempts.records[0].identity = { state: "unavailable" };
    expect(receipt(missing).attribution).toEqual(unavailable("missing_attribution"));
    for (const identity of [{ state: "available", provider: "unreviewed", model: "unreviewed/model" }, { state: "available", provider: "synthetic", model: "other/model-v2" }]) {
      const input = evidence(); input.attempts.records[0].identity = identity;
      const output = receipt(input);
      expect(output.attribution).toEqual(unavailable("unsupported_identity"));
      expect(JSON.stringify(output)).not.toContain(identity.model);
    }
  });
  test("multiple bound successes stay ambiguous even when their identities agree", () => {
    for (const sameIdentity of [true, false]) {
      const input = evidence(); const second = { ...input.attempts.records[0], ordinal: 3 };
      if (!sameIdentity) second.identity = { state: "available", provider: "other", model: "other/model-v2" };
      input.attempts.records.push(second);
      expect(receipt(input).attribution).toEqual({ state: "ambiguous", reason_code: "multiple_successful_bindings" });
      const result = adaptRoutingObservation(input, context()); input.attempts.records.reverse();
      expect(adaptRoutingObservation(input, context())).toEqual(result);
    }
  });
  test("same-attempt contradictions are ambiguous and identical duplicates are deterministic", () => {
    for (const patch of [{ identity: { state: "available", provider: "other", model: "other/model-v2" } }, { identity: { state: "unavailable" } }, { outcome: "failed" }, { phase: "pending", outcome: "unavailable" }, { phase: "pending" }, { termination: "incomplete" }, { termination: "not_streamed" }]) {
      const input = evidence(); input.attempts.records.push({ ...input.attempts.records[0], ...patch });
      expect(receipt(input).attribution).toEqual({ state: "ambiguous", reason_code: "conflicting_attribution" });
      const result = adaptRoutingObservation(input, context()); input.attempts.records.reverse();
      expect(adaptRoutingObservation(input, context())).toEqual(result);
    }
    const duplicate = evidence(); duplicate.attempts.records.push(structuredClone(duplicate.attempts.records[0]));
    expect(adaptRoutingObservation(duplicate, context())).toEqual(adaptRoutingObservation(evidence(), context()));
  });
  test("request outcome and every tool lifecycle state remain independent of serving attribution", () => {
    const cases = [
      [evidence().tools, { state: "completed", started_count: 0, completed_count: 0, failed_count: 0 }],
      [{ ...evidence().tools, started_count: 2, completed_count: 2 }, { state: "completed", started_count: 2, completed_count: 2, failed_count: 0 }],
      [{ ...evidence().tools, started_count: 2, completed_count: 1 }, { state: "incomplete", reason_code: "open_tools", started_count: 2, completed_count: 1, failed_count: 0 }],
      [{ ...evidence().tools, started_count: 2, completed_count: 1, failed_count: 1 }, { state: "incomplete", reason_code: "tool_failed", started_count: 2, completed_count: 1, failed_count: 1 }],
      [{ ...evidence().tools, coverage: "incomplete" }, { state: "incomplete", reason_code: "coverage_incomplete", started_count: 0, completed_count: 0, failed_count: 0 }],
      [{ ...evidence().tools, terminal_evidence: false }, { state: "incomplete", reason_code: "coverage_incomplete", started_count: 0, completed_count: 0, failed_count: 0 }],
      [unavailable("not_instrumented"), unavailable("not_instrumented")],
      [unavailable("evidence_unavailable"), unavailable("evidence_unavailable")],
    ];
    for (const outcome of ["succeeded", "failed", "unavailable"]) for (const [tools, expected] of cases) {
      const input = evidence(); input.request.outcome = outcome; input.tools = tools;
      const result = receipt(input);
      expect(result.request.outcome).toBe(outcome); expect(result.attribution.state).toBe("observed"); expect(result.tools).toEqual(expected);
    }
  });
  test("tool reason precedence is deterministic with concurrent failure and open coverage", () => {
    const input = evidence(); input.tools = { ...input.tools, started_count: 3, failed_count: 1, coverage: "incomplete" };
    expect(receipt(input).tools).toEqual({ state: "incomplete", reason_code: "tool_failed", started_count: 3, failed_count: 1, completed_count: 0 });
  });
  test("rejects impossible counts, ordinals, sparsity and array overflow", () => {
    for (const value of [-1, -0, 0.5, 10_001, Infinity, NaN, "1", null]) {
      for (const key of ["started_count", "completed_count", "failed_count"]) { const input = evidence(); input.tools[key] = value; reject(input); }
      const input = evidence(); input.attempts.records[0].ordinal = value; reject(input);
    }
    const zero = evidence(); zero.attempts.records[0].ordinal = 0; reject(zero);
    const impossible = evidence(); impossible.tools.completed_count = 1; reject(impossible);
    const impossibleFailure = evidence(); impossibleFailure.tools.failed_count = 1; reject(impossibleFailure);
    const sparse = evidence(); sparse.attempts.records = new Array(2); reject(sparse);
    const overflow = evidence(); overflow.attempts.records = new Array(10_001).fill(evidence().attempts.records[0]); reject(overflow);
    const upper = evidence(); upper.attempts.records[0].ordinal = 10_000; upper.tools.started_count = upper.tools.completed_count = 10_000;
    expect(receipt(upper).tools.state).toBe("completed");
    const full = evidence(); full.attempts.records = Array.from({ length: 10_000 }, (_, index) => ({ ...full.attempts.records[0], ordinal: index + 1, outcome: index === 9999 ? "succeeded" : "failed" }));
    expect(receipt(full).attribution).toEqual({ state: "observed", provider: "synthetic", model: "synthetic/model-v1", successful_attempt_ordinal: 10_000, evidence_basis: "terminal-attempt-record" });
  });
  test("rejects unknown/private fields at every evidence and context boundary", () => {
    for (const pick of [(x: any) => x, (x: any) => x.request, (x: any) => x.attempts, (x: any) => x.attempts.records[0], (x: any) => x.attempts.records[0].identity, (x: any) => x.tools]) {
      for (const key of ["prompt", "tool_output", "connection_id", "metadata", "error"]) {
        const input = evidence(); pick(input)[key] = "private-marker"; reject(input);
      }
    }
    for (const pick of [(x: any) => x, (x: any) => x.provenance, (x: any) => x.policy, (x: any) => x.policy.catalog[0]]) {
      const ctx: any = context(); pick(ctx).private_data = "private-marker"; reject(evidence(), ctx, "INVALID_CONTEXT");
    }
    const ctx: any = context(); ctx.provenance.raw_prompt_hash = "a".repeat(64); reject(evidence(), ctx, "INVALID_CONTEXT");
  });
  test("rejects malformed and private identity encodings without echo or coercion", () => {
    for (const value of ["https://private.invalid/token", "me@private.invalid", "/tmp/private", "private\nsecret", "\ud800", "a".repeat(4097), null, 42]) {
      const input = evidence(); input.attempts.records[0].identity.provider = value; reject(input);
    }
    for (const patch of [{ state: "complete" }, { coverage: "unknown" }, { terminal_evidence: 1 }]) {
      const input = evidence(); Object.assign(input.tools, patch); reject(input);
    }
    const absentTools = evidence(); delete absentTools.tools; reject(absentTools);
  });
  test("hostile getters, proxies, prototypes, cycles and coercion never execute caller code", () => {
    let calls = 0;
    const getter = evidence(); Object.defineProperty(getter, "request", { enumerable: true, get() { calls++; throw new Error("private-marker"); } });
    reject(getter);
    const nested = evidence(); Object.defineProperty(nested.attempts.records[0].identity, "provider", { enumerable: true, get() { calls++; return "synthetic"; } }); reject(nested);
    const proxy = new Proxy(evidence(), { ownKeys() { calls++; throw new Error("private-marker"); }, getPrototypeOf() { calls++; throw new Error("private-marker"); } }); reject(proxy);
    const revoked = Proxy.revocable({}, {}); revoked.revoke(); reject(revoked.proxy);
    const nestedProxy = evidence(); nestedProxy.attempts.records = new Proxy([], { get() { calls++; throw new Error("private-marker"); } }); reject(nestedProxy);
    const coercion = evidence(); coercion.request.outcome = { toString() { calls++; return "succeeded"; } }; reject(coercion);
    const toJson = evidence(); toJson.toJSON = () => { calls++; return evidence(); }; reject(toJson);
    const inherited = Object.assign(Object.create({ private: "marker" }), evidence()); reject(inherited);
    const symbol = evidence(); symbol[Symbol("private-marker")] = true; reject(symbol);
    const nonEnumerable = evidence(); Object.defineProperty(nonEnumerable, "private", { value: "marker" }); reject(nonEnumerable);
    const cycle = evidence(); cycle.tools = cycle; reject(cycle);
    const contextGetter: any = context(); Object.defineProperty(contextGetter.policy, "catalog", { enumerable: true, get() { calls++; return []; } }); reject(evidence(), contextGetter, "INVALID_CONTEXT");
    const contextProxy = new Proxy(context(), { ownKeys() { calls++; throw new Error("private-marker"); } }); reject(evidence(), contextProxy, "INVALID_CONTEXT");
    expect(calls).toBe(0);
  });
  test("validates explicit context, freshness and reviewed catalog; no implicit defaults", () => {
    for (const patch of [{ observation_id: "obs_private" }, { project_ref: "prj_not-registered" }, { observed_at: "yesterday" }, { fresh_until: "2026-09-07T00:01:00.001Z" }, { evidence_mode: "live" }]) reject(evidence(), { ...context(), ...patch }, "INVALID_CONTEXT");
    const emptyCatalog = context(); emptyCatalog.policy.catalog = []; reject(evidence(), emptyCatalog, "INVALID_CONTEXT");
    const invalidPolicy = context(); invalidPolicy.policy.max_freshness_ms = 0; reject(evidence(), invalidPolicy, "INVALID_CONTEXT");
    const missing: any = context(); delete missing.observed_at; reject(evidence(), missing, "INVALID_CONTEXT");
    const local = context(); local.evidence_mode = "local-observation"; expect(receipt(evidence(), local).evidence_mode).toBe("local-observation");
  });
  test("source closure contains only the generated contract and proxy inspection builtin", () => {
    const source = readFileSync(new URL("./routing-observation-adapter.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(match => match[1]);
    expect(imports).toEqual(["node:util", "./contracts/routing-observation-receipt.v1"]);
    expect(source).not.toMatch(/\b(?:process|Bun|fetch|XMLHttpRequest|WebSocket|console)\s*[.(]/);
    expect(source).not.toMatch(/\b(?:Date|performance)\s*[.(]|\bMath\.random\s*\(|\b(?:require|import)\s*\(/);
  });
});
