export const EFFORT_TIERS = ["E1", "E2", "E3", "E4", "E5"] as const;

export type EffortTier = (typeof EFFORT_TIERS)[number];
export type EffortPersistence =
  | "single-operation"
  | "single-phase"
  | "planned-multi-phase"
  | "seven-phase"
  | "portfolio-fleet";

export interface EffortContract {
  readonly schema: "temperance.effort-contract.v1";
  readonly tier: EffortTier;
  readonly persistence: EffortPersistence;
  readonly durable: boolean;
  readonly resumeAfterRestart: boolean;
  readonly maxContinuations: number;
  readonly recoveryAllowance: number;
  readonly maxConcurrency: number;
  readonly worktreeRequired: boolean;
  readonly seatLeaseRequired: true;
  readonly verification: Readonly<{
    required: boolean;
    independent: boolean;
    semanticAcceptance: boolean;
  }>;
  readonly approvalGates: readonly string[];
}

export type EffortContractResult =
  | { readonly ok: true; readonly value: Readonly<EffortContract> }
  | { readonly ok: false; readonly reasonCode: "effort_tier_invalid"; readonly tier: string };

const CONTRACTS: Readonly<Record<EffortTier, EffortContract>> = Object.freeze({
  E1: Object.freeze({
    schema: "temperance.effort-contract.v1",
    tier: "E1",
    persistence: "single-operation",
    durable: false,
    resumeAfterRestart: false,
    maxContinuations: 0,
    recoveryAllowance: 0,
    maxConcurrency: 1,
    worktreeRequired: false,
    seatLeaseRequired: true,
    verification: Object.freeze({ required: false, independent: false, semanticAcceptance: false }),
    approvalGates: Object.freeze([]),
  }),
  E2: Object.freeze({
    schema: "temperance.effort-contract.v1",
    tier: "E2",
    persistence: "single-phase",
    durable: false,
    resumeAfterRestart: false,
    maxContinuations: 1,
    recoveryAllowance: 1,
    maxConcurrency: 1,
    worktreeRequired: false,
    seatLeaseRequired: true,
    verification: Object.freeze({ required: true, independent: false, semanticAcceptance: true }),
    approvalGates: Object.freeze([]),
  }),
  E3: Object.freeze({
    schema: "temperance.effort-contract.v1",
    tier: "E3",
    persistence: "planned-multi-phase",
    durable: true,
    resumeAfterRestart: true,
    maxContinuations: 2,
    recoveryAllowance: 2,
    maxConcurrency: 1,
    worktreeRequired: false,
    seatLeaseRequired: true,
    verification: Object.freeze({ required: true, independent: false, semanticAcceptance: true }),
    approvalGates: Object.freeze(["scope-expansion", "credential", "production"]),
  }),
  E4: Object.freeze({
    schema: "temperance.effort-contract.v1",
    tier: "E4",
    persistence: "seven-phase",
    durable: true,
    resumeAfterRestart: true,
    maxContinuations: 3,
    recoveryAllowance: 3,
    maxConcurrency: 1,
    worktreeRequired: false,
    seatLeaseRequired: true,
    verification: Object.freeze({ required: true, independent: true, semanticAcceptance: true }),
    approvalGates: Object.freeze(["scope-expansion", "credential", "spend", "production", "release"]),
  }),
  E5: Object.freeze({
    schema: "temperance.effort-contract.v1",
    tier: "E5",
    persistence: "portfolio-fleet",
    durable: true,
    resumeAfterRestart: true,
    maxContinuations: 4,
    recoveryAllowance: 4,
    maxConcurrency: 4,
    worktreeRequired: true,
    seatLeaseRequired: true,
    verification: Object.freeze({ required: true, independent: true, semanticAcceptance: true }),
    approvalGates: Object.freeze([
      "scope-expansion",
      "credential",
      "spend",
      "production",
      "merge",
      "release",
    ]),
  }),
});

export function resolveEffortContract(tier: EffortTier): EffortContractResult {
  if (!EFFORT_TIERS.includes(tier)) {
    return Object.freeze({ ok: false, reasonCode: "effort_tier_invalid", tier: String(tier) });
  }
  return Object.freeze({ ok: true, value: CONTRACTS[tier] });
}
