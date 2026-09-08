import { resolveEffortContract, type EffortContract, type EffortTier } from "./effort-contract.ts";
import {
  resolveSurfaceStage,
  type SurfaceContract,
  type SurfaceStageId,
} from "./surface-convergence-contract.ts";

export const SUPPORTED_COORDINATOR_SURFACES = [
  "claude",
  "codex",
  "grok",
  "opencode",
  "cursor",
  "antigravity",
  "superset",
] as const;

export type CoordinatorSurface = (typeof SUPPORTED_COORDINATOR_SURFACES)[number];

export interface ExactSeatReference {
  provider: string;
  connectionId: string;
  model: string;
}

export interface QuotaWindowEvidence extends ExactSeatReference {
  freshness: "fresh" | "stale" | "unknown";
  observedAt: string;
  window: string;
  resetAt: string;
  remaining: number;
}

export interface ContextClassEvidence extends ExactSeatReference {
  verifiedAt: string;
  maxTokens: number;
  source: "connection-probe" | "provider-contract";
}

export interface CapabilityResolutionInput {
  surfaceContract: SurfaceContract;
  clusterIndex: unknown;
  surface: CoordinatorSurface;
  phase: SurfaceStageId;
  effort: EffortTier;
  mcpCapabilities: readonly string[];
  selectedSeat: ExactSeatReference;
  quotaEvidence?: QuotaWindowEvidence;
  contextEvidence?: ContextClassEvidence;
  requiredContextTokens?: number;
  now: string;
}

export type PhaseCapabilityHoldReason =
  | "coordinator_surface_unsupported"
  | "coordinator_lane_invalid"
  | "phase_contract_invalid"
  | "phase_cluster_index_invalid"
  | "phase_cluster_missing"
  | "phase_mcp_missing"
  | "quota_evidence_missing"
  | "quota_identity_mismatch"
  | "quota_evidence_stale"
  | "quota_window_invalid"
  | "quota_exhausted"
  | "context_evidence_missing"
  | "context_identity_mismatch"
  | "context_evidence_stale"
  | "context_window_insufficient";

export interface PhaseWorkerContract {
  readonly schema: "temperance.phase-worker-contract.v1";
  readonly surface: CoordinatorSurface;
  readonly surfaceRole: string;
  readonly coordinatorLane: "noesis-orchestrator";
  readonly workerLane: string;
  readonly phase: SurfaceStageId;
  readonly phaseOrdinal: number;
  readonly phaseAgent: Readonly<{ name: string; kosha: string; maxTurns: number }>;
  readonly clusterHubs: readonly string[];
  readonly mcpPolicy: Readonly<{ required: readonly string[]; allowed: readonly string[] }>;
  readonly effort: Readonly<EffortContract>;
  readonly quotaWindow: Readonly<{ window: string; resetAt: string; remaining: number }>;
  readonly contextClass: Readonly<{ kind: "not-required" } | { kind: "verified"; maxTokens: number }>;
}

export type PhaseCapabilityResult =
  | { readonly ok: true; readonly value: Readonly<PhaseWorkerContract> }
  | { readonly ok: false; readonly reasonCode: PhaseCapabilityHoldReason; readonly key?: string };

const SURFACE_ROLES: Readonly<Record<CoordinatorSurface, string>> = Object.freeze({
  claude: "coordinator-and-approved-superset-hands-worker",
  codex: "cockpit-and-gates-not-hands-worker",
  grok: "coordination-and-human-gates-not-hands-fleet",
  opencode: "coordination-and-bounded-phase-work",
  cursor: "bounded-project-contract-worker",
  antigravity: "bounded-project-contract-worker",
  superset: "delivery-cockpit-claude-is-hands-worker",
});

export function coordinatorSurfaceRole(surface: CoordinatorSurface): string {
  return SURFACE_ROLES[surface];
}

const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

function hold(reasonCode: PhaseCapabilityHoldReason, key?: string): PhaseCapabilityResult {
  return Object.freeze({ ok: false, reasonCode, ...(key ? { key } : {}) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactIdentity(left: ExactSeatReference, right: ExactSeatReference): boolean {
  return left.provider === right.provider &&
    left.connectionId === right.connectionId &&
    left.model === right.model;
}

function freshTimestamp(timestamp: string, now: string): boolean {
  const observed = Date.parse(timestamp);
  const current = Date.parse(now);
  return Number.isFinite(observed) && Number.isFinite(current) &&
    observed <= current && current - observed <= MAX_EVIDENCE_AGE_MS;
}

function stageMcpPolicy(contract: SurfaceContract, phase: SurfaceStageId): { required: string[]; allowed: string[] } | null {
  const detail = contract.alchemyMap.stages_detail[phase] as unknown as Record<string, unknown>;
  const policy = detail?.mcp_policy;
  if (!isRecord(policy) || !Array.isArray(policy.required) || !Array.isArray(policy.allowed) ||
    policy.required.some((item) => typeof item !== "string") ||
    policy.allowed.some((item) => typeof item !== "string")) return null;
  return { required: [...policy.required] as string[], allowed: [...policy.allowed] as string[] };
}

export function resolvePhaseCapabilityContract(input: CapabilityResolutionInput): PhaseCapabilityResult {
  if (!SUPPORTED_COORDINATOR_SURFACES.includes(input.surface)) {
    return hold("coordinator_surface_unsupported", String(input.surface));
  }
  const phaseMap = input.surfaceContract.phaseComboMap as unknown as Record<string, unknown>;
  const coordinator = phaseMap.coordinator;
  if (!isRecord(coordinator) || coordinator.lane !== "noesis-orchestrator") {
    return hold("coordinator_lane_invalid", "noesis-orchestrator");
  }

  const stage = resolveSurfaceStage(input.surfaceContract, input.phase);
  if (!stage.ok) return hold("phase_contract_invalid", stage.key);
  const effort = resolveEffortContract(input.effort);
  if (!effort.ok) return hold("phase_contract_invalid", effort.tier);

  // Binary quota/entitlement evidence is evaluated before any capability or
  // routing score. No inferred branding or combo membership is accepted.
  const quota = input.quotaEvidence;
  if (!quota) return hold("quota_evidence_missing");
  if (!exactIdentity(input.selectedSeat, quota)) return hold("quota_identity_mismatch");
  if (quota.freshness !== "fresh" || !freshTimestamp(quota.observedAt, input.now)) {
    return hold("quota_evidence_stale");
  }
  if (!quota.window || !Number.isFinite(Date.parse(quota.resetAt)) || Date.parse(quota.resetAt) <= Date.parse(input.now)) {
    return hold("quota_window_invalid");
  }
  if (!Number.isFinite(quota.remaining) || quota.remaining <= 0) return hold("quota_exhausted");

  const index = input.clusterIndex;
  if (!isRecord(index) || !isRecord(index.skills)) return hold("phase_cluster_index_invalid");
  for (const hub of stage.value.hubNames) {
    const indexed = index.skills[hub];
    if (!isRecord(indexed) || indexed.role !== "hub" ||
      !(indexed.status === "active-hub" || indexed.status === "deferred-hub")) {
      return hold("phase_cluster_missing", hub);
    }
  }

  const mcpPolicy = stageMcpPolicy(input.surfaceContract, input.phase);
  if (!mcpPolicy) return hold("phase_contract_invalid", `mcp:${input.phase}`);
  const available = new Set(input.mcpCapabilities);
  for (const required of mcpPolicy.required) {
    if (!available.has(required)) return hold("phase_mcp_missing", required);
  }

  const needsLongContext = input.effort === "E4" || input.effort === "E5" ||
    (input.requiredContextTokens ?? 0) > 200_000;
  let contextClass: PhaseWorkerContract["contextClass"] = Object.freeze({ kind: "not-required" });
  if (needsLongContext) {
    const context = input.contextEvidence;
    if (!context) return hold("context_evidence_missing");
    if (!exactIdentity(input.selectedSeat, context)) return hold("context_identity_mismatch");
    if (!freshTimestamp(context.verifiedAt, input.now)) return hold("context_evidence_stale");
    if (!Number.isFinite(context.maxTokens) || context.maxTokens < (input.requiredContextTokens ?? 1_000_000)) {
      return hold("context_window_insufficient");
    }
    contextClass = Object.freeze({ kind: "verified", maxTokens: context.maxTokens });
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      schema: "temperance.phase-worker-contract.v1",
      surface: input.surface,
      surfaceRole: SURFACE_ROLES[input.surface],
      coordinatorLane: "noesis-orchestrator",
      workerLane: stage.value.combo,
      phase: input.phase,
      phaseOrdinal: stage.value.ordinal,
      phaseAgent: stage.value.phaseAgent,
      clusterHubs: stage.value.hubNames,
      mcpPolicy: Object.freeze(mcpPolicy),
      effort: effort.value,
      quotaWindow: Object.freeze({
        window: quota.window,
        resetAt: quota.resetAt,
        remaining: quota.remaining,
      }),
      contextClass,
    }),
  });
}
