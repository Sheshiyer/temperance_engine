// Standalone numerical extraction: policy values and arithmetic preserved.
// Trusted typed inputs only; validation, freshness and authorization are caller-owned.
// No filesystem, environment, provider, ledger or private runtime dependencies.
// Pure selection invariants shared by backend and lane-family decisions.
// Callers supply eligible candidates and only their admitted arbitration signals.
export const FIT_EQUIVALENCE_TOLERANCE = 0.02;

export function finiteSignal(value: unknown, min = 0, max = Infinity): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value : null;
}

export function fitBucket<T>(candidates: readonly T[], fit: (candidate: T) => number): {
  maxFit: number | null;
  bucket: T[];
  rest: T[];
} {
  const scores = candidates.map((candidate) => finiteSignal(fit(candidate), 0, 1));
  const known = scores.filter((score): score is number => score !== null);
  const maxFit = known.length > 0 ? Math.max(...known) : null;
  const bucket: T[] = [];
  const rest: T[] = [];
  candidates.forEach((candidate, index) => {
    const score = scores[index];
    // Include the decimal 0.020 boundary despite binary subtraction noise
    // (e.g. 1 - 0.98). This ULP allowance cannot admit a 0.021 gap.
    const within = maxFit !== null && score !== null && score !== undefined
      && maxFit - score <= FIT_EQUIVALENCE_TOLERANCE + 4 * Number.EPSILON;
    (within ? bucket : rest).push(candidate);
  });
  return { maxFit, bucket, rest };
}

function narrow<T>(candidates: readonly T[], signal: (candidate: T) => number | null, highest: boolean) {
  const known = candidates.map((candidate) => ({ candidate, value: signal(candidate) }))
    .filter((entry): entry is { candidate: T; value: number } => entry.value !== null);
  if (known.length === 0) return { candidates: [...candidates], narrowed: false };
  const best = highest ? Math.max(...known.map((entry) => entry.value)) : Math.min(...known.map((entry) => entry.value));
  const tied = known.filter((entry) => entry.value === best).map((entry) => entry.candidate);
  return { candidates: tied, narrowed: tied.length < candidates.length };
}

// ---------------------------------------------------------------------------
// TRIVECTOR v4.1 (Phase 44). Every term below is inert unless a caller selects
// arbitration "v4.1"; "legacy" is the rollback switch and restores v1 heads.
// Nothing here grants eligibility: gates only remove head candidates, and the
// 429 hazard narrows V1 inside the fit bucket without ever touching V3/G9.
// ---------------------------------------------------------------------------
export const TRIVECTOR_V41_POLICY = Object.freeze({
  schema: "temperance.trivector-arbitration-policy.v1",
  version: "trivector-v4.1.0",
  arbitration_default: "legacy" as ArbitrationMode,
  hazard_k: 0.5,
  hazard_half_life_ms: 30 * 60 * 1000,
  hazard_max_events: 32,
  headroom_saturation_units: 100,
  neutral_headroom: 0.5,
  per_seat_concurrency_cap: 4,
  g9_min_evidence_mass: 20,
  g9_upper_bound_floor: 0.2,
  g9_consecutive_failures_min: 5,
});

export type ArbitrationMode = "legacy" | "v4.1";

/** Explicit inputs only. Unknown/malformed resolves to legacy. */
export function resolveArbitrationMode(
  explicit?: unknown,
  fallback?: unknown,
): ArbitrationMode {
  const value = explicit ?? fallback;
  return value === "v4.1" ? "v4.1" : "legacy";
}

export interface QuotaWindowObservation {
  window: string;
  remaining: number;
  limit?: number;
  inflight?: number;
  margin?: number;
  resets_at_ms?: number;
  /** Absent means blocking: an exhausted window of unknown kind gates the head. */
  blocking?: boolean;
  updated_at_ms?: number;
}

/** H = min over windows of (remaining - inflight - margin) / est_units, plus the
 * normalized [0,1] form (saturating at headroom_saturation_units) used by V1. */
export function effectiveHeadroom(
  windows: readonly QuotaWindowObservation[] | undefined,
  nowMs: number,
  estUnits = 1,
  saturation = TRIVECTOR_V41_POLICY.headroom_saturation_units,
): { units: number | null; normalized: number | null; exhausted: string[] } {
  const units: number[] = [];
  const exhausted: string[] = [];
  const est = finiteSignal(estUnits) !== null && estUnits > 0 ? estUnits : 1;
  for (const window of windows ?? []) {
    const remaining = finiteSignal(window?.remaining, -Infinity);
    if (remaining === null || typeof window.window !== "string") continue;
    const resetsAt = finiteSignal(window.resets_at_ms);
    if (resetsAt !== null && resetsAt <= nowMs) continue;
    const free = remaining - (finiteSignal(window.inflight) ?? 0) - (finiteSignal(window.margin) ?? 0);
    units.push(free / est);
    if (window.blocking !== false && remaining <= 0) exhausted.push(window.window);
  }
  if (units.length === 0) return { units: null, normalized: null, exhausted };
  const min = Math.min(...units);
  return { units: min, normalized: Math.min(1, Math.max(0, min / saturation)), exhausted: exhausted.sort() };
}

/** Decayed 429 intensity: sum of 2^(-age/half_life) over supplied past events.
 * Only the caller's evidence binding establishes whether those events are seat-bound. */
export function decayedHazard(
  eventsMs: readonly number[] | undefined,
  nowMs: number,
  halfLifeMs = TRIVECTOR_V41_POLICY.hazard_half_life_ms,
): number {
  let lambda = 0;
  for (const at of eventsMs ?? []) {
    if (!Number.isFinite(at) || at > nowMs) continue;
    lambda += Math.pow(2, -(nowMs - at) / halfLifeMs);
  }
  return lambda;
}

export function hazardAdjustedHeadroom(headroom: number, lambda: number, k = TRIVECTOR_V41_POLICY.hazard_k): number {
  return headroom * Math.exp(-k * Math.max(0, lambda));
}

/** Head-ineligibility reasons from cooldown and exhausted blocking windows. */
export function headGateReasons(input: {
  nowMs: number;
  rateLimitedUntilMs?: number;
  windows?: readonly QuotaWindowObservation[];
}): string[] {
  const reasons: string[] = [];
  const until = finiteSignal(input.rateLimitedUntilMs);
  if (until !== null && until > input.nowMs) reasons.push("head-gate:cooldown");
  for (const window of effectiveHeadroom(input.windows, input.nowMs).exhausted) {
    reasons.push(`head-gate:window-exhausted:${window}`);
  }
  return reasons;
}

export function wilsonUpperBound(successes: number, samples: number, z = 1.96): number | null {
  if (!Number.isFinite(successes) || !Number.isFinite(samples) || samples <= 0) return null;
  const p = Math.min(samples, Math.max(0, successes)) / samples;
  const z2 = z * z;
  const centre = p + z2 / (2 * samples);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * samples)) / samples);
  return Math.min(1, (centre + margin) / (1 + z2 / samples));
}

/** G9 may act only with enough non-429 evidence mass and an upper bound below the floor. */
export function g9GateV41(evidence: {
  successes?: number; failures?: number; consecutiveFailures?: number;
}, policy = TRIVECTOR_V41_POLICY): { acts: boolean; mass: number; upper: number | null } {
  const successes = finiteSignal(evidence.successes) ?? 0;
  const failures = finiteSignal(evidence.failures) ?? 0;
  const mass = successes + failures;
  const upper = wilsonUpperBound(successes, mass);
  const acts = mass >= policy.g9_min_evidence_mass && upper !== null && upper < policy.g9_upper_bound_floor
    && (finiteSignal(evidence.consecutiveFailures) ?? 0) >= policy.g9_consecutive_failures_min;
  return { acts, mass, upper };
}

export function arbitrateFitBucket<T>(bucket: readonly T[], policy: {
  // These are prevalidated, fresh observations, never fleet slot counts or V3.
  quotaHeadroom?: (candidate: T) => number | null | undefined;
  latencyMs?: (candidate: T) => number | null | undefined;
  compareStatic: (a: T, b: T) => number;
}): { head: T | null; arbiter: "quota_headroom" | "latency" | "static_rank" } {
  const quota = narrow(bucket, (candidate) => finiteSignal(policy.quotaHeadroom?.(candidate), 0, 1), true);
  const latency = narrow(quota.candidates, (candidate) => finiteSignal(policy.latencyMs?.(candidate)), false);
  return {
    head: [...latency.candidates].sort(policy.compareStatic)[0] ?? null,
    arbiter: quota.narrowed ? "quota_headroom" : latency.narrowed ? "latency" : "static_rank",
  };
}
