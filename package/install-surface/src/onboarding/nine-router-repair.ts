import { canonical } from "../canonical-json.ts";
import type { OnboardingPlanV1, OnboardingProfileV1 } from "./contracts.ts";
import {
  createNineRouterGuidedSetupEffector,
  createNineRouterGuidedSetupPlanInput,
  type NineRouterGuidedSetupApi,
  type NineRouterGuidedSetupKeychain,
} from "./nine-router-guided-setup.ts";
import {
  executeOnboardingOperation,
  type OperationConfirmationV1,
  type OperationReceiptSink,
  type ResolvedExecutable,
} from "./operation-executor.ts";
import type { NineRouterGuidedSetupV1, OperationReceiptV1 } from "./public-contracts.ts";

export class NineRouterRepairError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "NineRouterRepairError";
  }
}

/**
 * The only host-mutating 9Router onboarding entry point. It accepts exactly
 * the digest confirmation emitted by the review TUI and one-module scope.
 */
export async function executeConfirmedNineRouterRepair(options: {
  plan: OnboardingPlanV1;
  profile: OnboardingProfileV1;
  confirmation?: OperationConfirmationV1;
  desired: NineRouterGuidedSetupV1;
  api: NineRouterGuidedSetupApi;
  keychain: NineRouterGuidedSetupKeychain;
  executable: ResolvedExecutable;
  receiptSink: OperationReceiptSink;
  operationId?: string;
  now?: () => Date;
}): Promise<OperationReceiptV1> {
  if (!options.confirmation) throw new NineRouterRepairError("NINE_ROUTER_REPAIR_CONFIRMATION_REQUIRED");
  if (options.plan.dry_run) throw new NineRouterRepairError("NINE_ROUTER_REPAIR_DRY_RUN_PLAN");
  if (options.plan.install_order.length !== 1 || options.plan.install_order[0] !== "provider.9router") {
    throw new NineRouterRepairError("NINE_ROUTER_REPAIR_SCOPE_INVALID");
  }
  const expectedInput = createNineRouterGuidedSetupPlanInput(options.desired, options.profile);
  const boundInput = options.plan.configuration_inputs?.find(({ id }) => id === expectedInput.id);
  if (!boundInput || canonical(boundInput) !== canonical(expectedInput)) {
    throw new NineRouterRepairError("NINE_ROUTER_REPAIR_CONFIGURATION_MISMATCH");
  }
  return executeOnboardingOperation({
    plan: options.plan,
    profile: options.profile,
    confirmation: options.confirmation,
    effectors: [createNineRouterGuidedSetupEffector({
      desired: options.desired,
      profile: options.profile,
      api: options.api,
      keychain: options.keychain,
      executable: options.executable,
    })],
    receiptSink: options.receiptSink,
    operationId: options.operationId,
    now: options.now,
  });
}
