#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export const POLICY_VERSION = "temperance-routing-v1";
export const CIRCUIT_FAILURE_THRESHOLD = 3;
export const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;

export type PolicyMode = "off" | "shadow" | "enforce";
export type CircuitState = "closed" | "open" | "half_open";

export interface RouteCandidate {
  backend: string;
  model: string;
  static_rank: number;
  tier?: string;
  strength?: string;
  context_window?: string;
}

export interface BackendObservation {
  health?: number;
  health_updated_at_ms?: number;
  quota_remaining?: number;
  quota_updated_at_ms?: number;
  cost_efficiency?: number;
  cost_efficiency_updated_at_ms?: number;
  latency_ewma_ms?: number;
  latency_updated_at_ms?: number;
  success_count?: number;
  failure_count?: number;
  timeout_count?: number;
  consecutive_failures?: number;
  circuit_state?: CircuitState;
  circuit_updated_at_ms?: number;
  cooldown_until_ms?: number;
  probe_claimed_until_ms?: number;
  probe_claim_id?: string;
}

export interface ObservationState {
  version: 1;
  updated_at_ms: number;
  backends: Record<string, BackendObservation>;
}

export interface RoutingInput {
  mode: PolicyMode;
  task_type: string;
  now_ms: number;
  candidates: RouteCandidate[];
  observations?: ObservationState;
  observation_max_age_ms?: number;
  forced?: boolean;
  disposition?: "external" | "inline" | "unavailable";
}

export interface CandidateFactors {
  capability: number;
  health: number;
  quota: number;
  cost_efficiency: number;
  stability: number;
  circuit: number;
}

export interface ScoredCandidate extends RouteCandidate {
  score: number;
  eligible: boolean;
  effective_circuit_state: CircuitState;
  factors: CandidateFactors;
  reasons: string[];
}

export interface RoutingPlan {
  policy_version: string;
  mode: PolicyMode;
  plan_id: string;
  correlation_id: string;
  input_hash: string;
  task_type: string;
  decision_time_ms: number;
  diverged: boolean;
  status: "ok" | "off" | "no-observations" | "inline" | "unavailable";
  static_order: RouteCandidate[];
  proposed_order: RouteCandidate[];
  selected_order: RouteCandidate[];
  candidates: ScoredCandidate[];
}

export interface AttemptObservation {
  backend: string;
  status: string;
  duration_s?: number;
  started_at_ms?: number;
  finished_at_ms?: number;
  task_id?: string;
  attempt_index?: number;
}

const WEIGHTS = {
  capability: 0.35,
  health: 0.25,
  quota: 0.15,
  cost_efficiency: 0.1,
  stability: 0.15,
} as const;

function clamp(value: number, fallback = 0.5): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function capabilityFactor(taskType: string, candidate: RouteCandidate): number {
  const strength = candidate.strength ?? "unknown";
  const tier = candidate.tier ?? "unknown";
  const preferred: Record<string, string[]> = {
    fast: ["speed", "free", "parallel", "frontier"],
    "long-horizon": ["long-horizon", "coding", "reasoning", "frontier"],
    reasoning: ["reasoning", "frontier", "coding", "general"],
    validation: ["reasoning", "coding", "general", "frontier"],
    creative: ["creative", "frontier", "general", "balanced"],
    balanced: ["balanced", "general", "frontier", "coding"],
  };
  const order = preferred[taskType] ?? preferred.balanced;
  const index = order.indexOf(strength);
  let factor = index < 0 ? 0.5 : 1 - index * 0.08;
  if (taskType === "long-horizon" && tier === "deep") factor += 0.08;
  if (taskType === "fast" && tier === "fast") factor += 0.05;
  return clamp(factor);
}

function effectiveCircuit(
  observation: BackendObservation | undefined,
  nowMs: number,
): CircuitState {
  const state = observation?.circuit_state ?? "closed";
  if (
    state === "open" &&
    typeof observation?.cooldown_until_ms === "number" &&
    nowMs >= observation.cooldown_until_ms
  ) {
    if (
      typeof observation.probe_claimed_until_ms === "number" &&
      observation.probe_claimed_until_ms > nowMs
    ) {
      return "open";
    }
    return "half_open";
  }
  return state;
}

function plainCandidate(candidate: RouteCandidate): RouteCandidate {
  return {
    backend: candidate.backend,
    model: candidate.model,
    static_rank: candidate.static_rank,
    ...(candidate.tier === undefined ? {} : { tier: candidate.tier }),
    ...(candidate.strength === undefined ? {} : { strength: candidate.strength }),
    ...(candidate.context_window === undefined
      ? {}
      : { context_window: candidate.context_window }),
  };
}

function scoreCandidate(
  taskType: string,
  candidate: RouteCandidate,
  candidateCount: number,
  observation: BackendObservation | undefined,
  nowMs: number,
  forced: boolean,
): ScoredCandidate {
  const circuitState = effectiveCircuit(observation, nowMs);
  const eligible = forced || circuitState !== "open";
  const stability =
    candidateCount <= 1 ? 1 : 1 - candidate.static_rank / (candidateCount - 1);
  const factors: CandidateFactors = {
    capability: capabilityFactor(taskType, candidate),
    health: clamp(observation?.health ?? 0.5),
    quota: clamp(observation?.quota_remaining ?? 0.5),
    cost_efficiency: clamp(observation?.cost_efficiency ?? 0.5),
    stability: clamp(stability),
    circuit: circuitState === "closed" ? 1 : circuitState === "half_open" ? 0.25 : 0,
  };
  const weighted =
    factors.capability * WEIGHTS.capability +
    factors.health * WEIGHTS.health +
    factors.quota * WEIGHTS.quota +
    factors.cost_efficiency * WEIGHTS.cost_efficiency +
    factors.stability * WEIGHTS.stability;
  const reasons: string[] = [];
  if (forced) reasons.push("explicit-override");
  if (circuitState === "open" && forced) reasons.push("circuit-bypassed-by-override");
  else if (circuitState === "open") reasons.push("circuit-open");
  else if (circuitState === "half_open") reasons.push("cooldown-probe");
  if (!observation) reasons.push("telemetry-missing-neutral");

  return {
    ...plainCandidate(candidate),
    score: round(weighted * factors.circuit),
    eligible,
    effective_circuit_state: circuitState,
    factors,
    reasons,
  };
}

function signalFresh(
  timestamp: number | undefined,
  legacyTimestamp: number,
  nowMs: number,
  maxAgeMs: number,
): boolean {
  const observedAt = timestamp ?? legacyTimestamp;
  const age = nowMs - observedAt;
  return Number.isFinite(observedAt) && age >= 0 && age <= maxAgeMs;
}

function freshObservation(
  state: ObservationState,
  backend: string,
  nowMs: number,
  maxAgeMs: number,
): BackendObservation | undefined {
  const raw = state.backends?.[backend];
  if (!raw) return undefined;
  const fresh: BackendObservation = {};
  let relevantSignals = 0;

  if (
    raw.health !== undefined &&
    signalFresh(raw.health_updated_at_ms, state.updated_at_ms, nowMs, maxAgeMs)
  ) {
    fresh.health = raw.health;
    fresh.health_updated_at_ms = raw.health_updated_at_ms ?? state.updated_at_ms;
    relevantSignals += 1;
  }
  if (
    raw.quota_remaining !== undefined &&
    signalFresh(raw.quota_updated_at_ms, state.updated_at_ms, nowMs, maxAgeMs)
  ) {
    fresh.quota_remaining = raw.quota_remaining;
    fresh.quota_updated_at_ms = raw.quota_updated_at_ms ?? state.updated_at_ms;
    relevantSignals += 1;
  }
  if (
    raw.cost_efficiency !== undefined &&
    signalFresh(raw.cost_efficiency_updated_at_ms, state.updated_at_ms, nowMs, maxAgeMs)
  ) {
    fresh.cost_efficiency = raw.cost_efficiency;
    fresh.cost_efficiency_updated_at_ms =
      raw.cost_efficiency_updated_at_ms ?? state.updated_at_ms;
    relevantSignals += 1;
  }
  if (
    raw.latency_ewma_ms !== undefined &&
    signalFresh(raw.latency_updated_at_ms, state.updated_at_ms, nowMs, maxAgeMs)
  ) {
    fresh.latency_ewma_ms = raw.latency_ewma_ms;
    fresh.latency_updated_at_ms = raw.latency_updated_at_ms ?? state.updated_at_ms;
  }

  const hasCircuitSignal =
    raw.circuit_state !== undefined ||
    raw.cooldown_until_ms !== undefined ||
    raw.probe_claimed_until_ms !== undefined;
  if (
    hasCircuitSignal &&
    signalFresh(raw.circuit_updated_at_ms, state.updated_at_ms, nowMs, maxAgeMs)
  ) {
    if (raw.circuit_state !== undefined) fresh.circuit_state = raw.circuit_state;
    if (raw.cooldown_until_ms !== undefined) fresh.cooldown_until_ms = raw.cooldown_until_ms;
    if (raw.probe_claimed_until_ms !== undefined) {
      fresh.probe_claimed_until_ms = raw.probe_claimed_until_ms;
    }
    if (raw.probe_claim_id !== undefined) fresh.probe_claim_id = raw.probe_claim_id;
    fresh.circuit_updated_at_ms = raw.circuit_updated_at_ms ?? state.updated_at_ms;
    relevantSignals += 1;
  }

  return relevantSignals > 0 ? fresh : undefined;
}

export function planRouting(input: RoutingInput): RoutingPlan {
  const normalizedMode: PolicyMode = ["off", "shadow", "enforce"].includes(input.mode)
    ? input.mode
    : "shadow";
  const normalizedInput: RoutingInput = {
    ...input,
    mode: normalizedMode,
    candidates: input.candidates.map(plainCandidate).sort((left, right) =>
      left.static_rank - right.static_rank ||
      left.backend.localeCompare(right.backend) ||
      left.model.localeCompare(right.model),
    ),
    observations: input.observations ?? {
      version: 1,
      updated_at_ms: 0,
      backends: {},
    },
    observation_max_age_ms: input.observation_max_age_ms ?? 24 * 60 * 60 * 1000,
  };
  const inputHash = createHash("sha256").update(stableJson(normalizedInput)).digest("hex");
  const staticOrder = normalizedInput.candidates.map(plainCandidate);
  const disposition = input.disposition ?? (staticOrder.length > 0 ? "external" : "unavailable");
  const observationState = normalizedInput.observations as ObservationState;
  const observationBackends = Object.fromEntries(
    staticOrder.flatMap((candidate) => {
      const observation = freshObservation(
        observationState,
        candidate.backend,
        normalizedInput.now_ms,
        normalizedInput.observation_max_age_ms ?? 24 * 60 * 60 * 1000,
      );
      return observation ? [[candidate.backend, observation]] : [];
    }),
  );
  const hasObservations = Object.keys(observationBackends).length > 0;
  const scored = staticOrder.map((candidate) =>
    scoreCandidate(
      normalizedInput.task_type,
      candidate,
      staticOrder.length,
      observationBackends[candidate.backend],
      normalizedInput.now_ms,
      Boolean(normalizedInput.forced),
    ),
  );

  let status: RoutingPlan["status"] = "ok";
  let proposedOrder = staticOrder;
  if (disposition === "inline") status = "inline";
  else if (disposition === "unavailable") status = "unavailable";
  else if (normalizedMode === "off") status = "off";
  else if (!hasObservations && !normalizedInput.forced) status = "no-observations";
  else {
    proposedOrder = scored
      .filter((candidate) => candidate.eligible)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.static_rank - right.static_rank ||
          left.backend.localeCompare(right.backend) ||
          left.model.localeCompare(right.model),
      )
      .map(plainCandidate);
    if (normalizedMode === "enforce" && proposedOrder.length === 0) {
      status = "unavailable";
    }
  }

  const selectedOrder =
    status === "inline" || status === "unavailable"
      ? []
      : normalizedMode === "enforce" && status === "ok"
        ? proposedOrder
        : staticOrder;
  const diverged =
    stableJson(staticOrder.map(({ backend, model }) => ({ backend, model }))) !==
    stableJson(proposedOrder.map(({ backend, model }) => ({ backend, model })));

  return {
    policy_version: POLICY_VERSION,
    mode: normalizedMode,
    plan_id: `rp_${inputHash.slice(0, 16)}`,
    correlation_id: `tc_${inputHash.slice(0, 24)}`,
    input_hash: inputHash,
    task_type: normalizedInput.task_type,
    decision_time_ms: normalizedInput.now_ms,
    diverged,
    status,
    static_order: staticOrder,
    proposed_order: proposedOrder,
    selected_order: selectedOrder,
    candidates: scored,
  };
}

function finiteCount(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) >= 0 ? Math.floor(value ?? 0) : 0;
}

export function reduceObservations(
  current: ObservationState,
  attempts: AttemptObservation[],
  nowMs: number,
): ObservationState {
  const next: ObservationState = JSON.parse(JSON.stringify(current ?? {}));
  next.version = 1;
  const legacyUpdatedAt = Number.isFinite(current?.updated_at_ms)
    ? current.updated_at_ms
    : 0;
  next.updated_at_ms = legacyUpdatedAt;
  next.backends ??= {};

  // Materialize timestamps from the v1 global clock before advancing it. This
  // migrates legacy state without letting an unrelated result refresh stale
  // quota, cost, health, or circuit signals.
  for (const observation of Object.values(next.backends)) {
    if (observation.health !== undefined && observation.health_updated_at_ms === undefined) {
      observation.health_updated_at_ms = legacyUpdatedAt;
    }
    if (
      observation.quota_remaining !== undefined &&
      observation.quota_updated_at_ms === undefined
    ) {
      observation.quota_updated_at_ms = legacyUpdatedAt;
    }
    if (
      observation.cost_efficiency !== undefined &&
      observation.cost_efficiency_updated_at_ms === undefined
    ) {
      observation.cost_efficiency_updated_at_ms = legacyUpdatedAt;
    }
    if (
      observation.latency_ewma_ms !== undefined &&
      observation.latency_updated_at_ms === undefined
    ) {
      observation.latency_updated_at_ms = legacyUpdatedAt;
    }
    if (
      (observation.circuit_state !== undefined ||
        observation.cooldown_until_ms !== undefined ||
        observation.probe_claimed_until_ms !== undefined) &&
      observation.circuit_updated_at_ms === undefined
    ) {
      observation.circuit_updated_at_ms = legacyUpdatedAt;
    }
  }

  const orderedAttempts = attempts
    .map((attempt, inputIndex) => ({ attempt, inputIndex }))
    .sort((left, right) => {
      const leftFinished = left.attempt.finished_at_ms ?? Number.MAX_SAFE_INTEGER;
      const rightFinished = right.attempt.finished_at_ms ?? Number.MAX_SAFE_INTEGER;
      return (
        leftFinished - rightFinished ||
        (left.attempt.started_at_ms ?? Number.MAX_SAFE_INTEGER) -
          (right.attempt.started_at_ms ?? Number.MAX_SAFE_INTEGER) ||
        (left.attempt.task_id ?? "").localeCompare(right.attempt.task_id ?? "") ||
        (left.attempt.attempt_index ?? 0) - (right.attempt.attempt_index ?? 0) ||
        left.inputIndex - right.inputIndex
      );
    });

  let reducedAny = false;
  for (const { attempt } of orderedAttempts) {
    if (!attempt.backend || ["inline", "none"].includes(attempt.backend)) continue;
    const previous = next.backends[attempt.backend] ?? {};
    const observation: BackendObservation = { ...previous };
    observation.success_count = finiteCount(previous.success_count);
    observation.failure_count = finiteCount(previous.failure_count);
    observation.timeout_count = finiteCount(previous.timeout_count);
    observation.consecutive_failures = finiteCount(previous.consecutive_failures);
    observation.circuit_state = previous.circuit_state ?? "closed";

    const durationMs = Number(attempt.duration_s) * 1000;
    const eventTime = Number.isFinite(attempt.finished_at_ms)
      ? Number(attempt.finished_at_ms)
      : nowMs;
    if (Number.isFinite(durationMs) && durationMs >= 0) {
      observation.latency_ewma_ms =
        previous.latency_ewma_ms === undefined
          ? durationMs
          : round(previous.latency_ewma_ms * 0.8 + durationMs * 0.2);
      observation.latency_updated_at_ms = eventTime;
    }

    if (attempt.status === "ok") {
      observation.success_count += 1;
      observation.consecutive_failures = 0;
      observation.health = round(clamp(previous.health ?? 0.5) * 0.8 + 0.2);
      observation.health_updated_at_ms = eventTime;
      observation.circuit_state = "closed";
      observation.circuit_updated_at_ms = eventTime;
      delete observation.cooldown_until_ms;
      delete observation.probe_claimed_until_ms;
      delete observation.probe_claim_id;
    } else if (attempt.status === "failed") {
      observation.failure_count += 1;
      observation.consecutive_failures += 1;
      observation.health = round(clamp(previous.health ?? 0.5) * 0.8);
      observation.health_updated_at_ms = eventTime;
      if (observation.consecutive_failures >= CIRCUIT_FAILURE_THRESHOLD) {
        observation.circuit_state = "open";
        observation.cooldown_until_ms = eventTime + CIRCUIT_COOLDOWN_MS;
      }
      observation.circuit_updated_at_ms = eventTime;
      delete observation.probe_claimed_until_ms;
      delete observation.probe_claim_id;
    } else if (attempt.status === "timeout") {
      observation.timeout_count += 1;
      observation.circuit_updated_at_ms = eventTime;
      delete observation.probe_claimed_until_ms;
      delete observation.probe_claim_id;
    } else {
      continue;
    }

    next.backends[attempt.backend] = observation;
    reducedAny = true;
  }

  if (reducedAny) next.updated_at_ms = nowMs;

  return next;
}

async function acquireLock(lockPath: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      mkdirSync(lockPath);
      writeFileSync(
        `${lockPath}/owner.json`,
        JSON.stringify({ pid: process.pid, acquired_at_ms: Date.now() }),
        { mode: 0o600 },
      );
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        let ownerAlive = false;
        const ownerPath = `${lockPath}/owner.json`;
        if (existsSync(ownerPath)) {
          const owner = JSON.parse(readFileSync(ownerPath, "utf8")) as { pid?: number };
          if (typeof owner.pid === "number") {
            try {
              process.kill(owner.pid, 0);
              ownerAlive = true;
            } catch {
              ownerAlive = false;
            }
          }
        }
        if (!ownerAlive && Date.now() - statSync(lockPath).mtimeMs > 30_000) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        // The other writer may have released the lock between EEXIST and stat.
      }
      await Bun.sleep(20);
    }
  }
  throw new Error(`timed out waiting for routing-state lock: ${lockPath}`);
}

function writeStateAtomic(
  statePath: string,
  state: ObservationState,
  uniqueSuffix: string,
): void {
  const tempPath = `${statePath}.tmp.${process.pid}.${uniqueSuffix}`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, statePath);
}

async function claimCommand(args: string[]): Promise<void> {
  const stateIndex = args.indexOf("--state");
  const backendIndex = args.indexOf("--backend");
  const nowIndex = args.indexOf("--now-ms");
  const claimIndex = args.indexOf("--claim-id");
  const leaseIndex = args.indexOf("--lease-ms");
  if (
    stateIndex < 0 ||
    !args[stateIndex + 1] ||
    backendIndex < 0 ||
    !args[backendIndex + 1] ||
    nowIndex < 0 ||
    !args[nowIndex + 1] ||
    claimIndex < 0 ||
    !args[claimIndex + 1]
  ) {
    throw new Error("claim requires --state FILE --backend NAME --now-ms N --claim-id ID");
  }
  const statePath = args[stateIndex + 1];
  const backend = args[backendIndex + 1];
  const nowMs = Number(args[nowIndex + 1]);
  const claimId = args[claimIndex + 1];
  const leaseMs = leaseIndex >= 0 ? Number(args[leaseIndex + 1]) : 10 * 60 * 1000;
  if (!Number.isFinite(nowMs) || !Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error("claim clock and lease must be finite positive numbers");
  }

  mkdirSync(dirname(statePath), { recursive: true });
  const lockPath = `${statePath}.lock`;
  await acquireLock(lockPath);
  try {
    const state: ObservationState = existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, "utf8"))
      : { version: 1, updated_at_ms: 0, backends: {} };
    const observation = state.backends[backend];
    const claimed = effectiveCircuit(observation, nowMs) === "half_open";
    if (claimed && observation) {
      observation.probe_claimed_until_ms = nowMs + leaseMs;
      observation.probe_claim_id = claimId;
      observation.circuit_updated_at_ms = nowMs;
      state.updated_at_ms = Math.max(state.updated_at_ms ?? 0, nowMs);
      writeStateAtomic(statePath, state, `claim.${nowMs}`);
    }
    process.stdout.write(`${JSON.stringify({ claimed })}\n`);
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

async function observeCommand(args: string[]): Promise<void> {
  const stateIndex = args.indexOf("--state");
  const runIndex = args.indexOf("--index");
  const nowIndex = args.indexOf("--now-ms");
  if (stateIndex < 0 || !args[stateIndex + 1] || runIndex < 0 || !args[runIndex + 1]) {
    throw new Error("observe requires --state FILE --index FILE");
  }
  const statePath = args[stateIndex + 1];
  const indexPath = args[runIndex + 1];
  const nowMs = nowIndex >= 0 ? Number(args[nowIndex + 1]) : Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("--now-ms must be a finite number");

  const run = JSON.parse(readFileSync(indexPath, "utf8")) as {
    tasks?: Array<{ attempts?: AttemptObservation[] }>;
  };
  const attempts = (run.tasks ?? []).flatMap((task) => task.attempts ?? []);
  mkdirSync(dirname(statePath), { recursive: true });
  const lockPath = `${statePath}.lock`;
  await acquireLock(lockPath);
  try {
    const current: ObservationState = existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, "utf8"))
      : { version: 1, updated_at_ms: 0, backends: {} };
    const next = reduceObservations(current, attempts, nowMs);
    writeStateAtomic(statePath, next, `observe.${nowMs}`);
    process.stdout.write(`${JSON.stringify(next)}\n`);
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2);
  if (command === "plan") {
    const input = JSON.parse(await Bun.stdin.text()) as RoutingInput;
    process.stdout.write(`${JSON.stringify(planRouting(input))}\n`);
    return;
  }
  if (command === "observe") {
    await observeCommand(args);
    return;
  }
  if (command === "claim") {
    await claimCommand(args);
    return;
  }
  throw new Error(
    "usage: routing-policy.ts plan | observe --state FILE --index FILE | claim --state FILE --backend NAME --now-ms N --claim-id ID",
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
