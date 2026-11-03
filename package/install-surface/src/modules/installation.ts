import { digest, digestValue, frozen, id, record, type Digest } from "../composition/boundary.ts";
import type { ActionPlanV1, OwnerAdapter, OwnerResultV1 } from "../composition/runtime-v2.ts";
import { executeOnboardingOperation, type ExecuteOnboardingOperationOptions } from "../onboarding/operation-executor.ts";
import { validateOperationReceiptV1 } from "../onboarding/contract-schema.ts";
import type { OperationReceiptV1 } from "../onboarding/public-contracts.ts";

export interface OnboardingOwnerOptions {
  ref: string; source_digest: Digest;
  /** Existing owner resolves the immutable plan, confirmation and effectors. */
  resolve(operation_ref: string, action: Readonly<ActionPlanV1>, signal: AbortSignal): Promise<ExecuteOnboardingOperationOptions>;
  /** Reuse the owner's live target/version/preimage probes. Effectors must also
   * retain their existing immediate pre-mutation drift checks. */
  observeInputs(prepared: ExecuteOnboardingOperationOptions, signal: AbortSignal): Promise<Record<string, Digest>>;
  /** Read the existing owner's durable receipt store; do not introduce another ledger. */
  read(operation_id: string): Promise<OperationReceiptV1 | undefined>;
}

/** Bridge the neutral action interface to the existing transaction executor. */
export function createOnboardingOperationOwner(options: OnboardingOwnerOptions): OwnerAdapter {
  id(options.ref); digest(options.source_digest);
  const operationId = (plan: Readonly<ActionPlanV1>) => "engine-" + plan.plan_digest.slice(7);
  function result(plan: Readonly<ActionPlanV1>, receipt?: OperationReceiptV1): OwnerResultV1 {
    const valid = receipt && validateOperationReceiptV1(receipt) && receipt.operation_id === operationId(plan);
    return frozen({ schema: "temperance.owner-action-result.v1", plan_digest: plan.plan_digest, status: !valid ? "indeterminate" : receipt.status === "committed" ? "completed" : receipt.rollback_status === "failed" ? "indeterminate" : "held", receipt_ref: valid ? digestValue(receipt) : null, artifact_refs: valid ? [digestValue(receipt)] : [], value: valid ? { kind: "installation", operation_ref: receipt.operation_id, source_plan_digest: receipt.plan_digest, disposition: receipt.status, rollback_status: receipt.rollback_status } : null });
  }
  return {
    ref: options.ref, source_digest: options.source_digest,
    async invoke(plan, input, signal) {
      if (plan.mode !== "write" || plan.owner_ref !== options.ref || plan.owner_source_digest !== options.source_digest) throw new Error("INSTALL_OWNER_AUTHORITY_MISMATCH");
      const value = record(input, ["operation_ref", "plan_digest"]); id(value.operation_ref); digest(value.plan_digest);
      const prepared = await options.resolve(value.operation_ref, plan, signal);
      if (prepared.plan.plan_digest !== value.plan_digest || prepared.confirmation.plan_digest !== value.plan_digest || prepared.confirmation.confirmed !== true) throw new Error("INSTALL_OWNER_PLAN_MISMATCH");
      const prior = await options.read(operationId(plan));
      if (prior) {
        if (prior.plan_digest !== value.plan_digest) throw new Error("INSTALL_OWNER_RECEIPT_MISMATCH");
        return result(plan, prior);
      }
      const observedInputs = await options.observeInputs(prepared, signal);
      for (const key of ["operation.target", "operation.versions", "operation.preimages"]) {
        const expected = prepared.plan.configuration_inputs?.find(input => input.id === key);
        if (!expected || digest(expected.digest) !== observedInputs[key]) throw new Error("INSTALL_OWNER_PRECONDITION_MISMATCH");
      }
      if (signal.aborted) throw new Error("INSTALL_OWNER_ABORTED");
      const receipt = await executeOnboardingOperation({ ...prepared, operationId: operationId(plan), signal });
      const observed = await options.read(operationId(plan));
      if (!observed || digestValue(observed) !== digestValue(receipt)) return result(plan);
      return result(plan, observed);
    },
    async status(plan) { return result(plan, await options.read(operationId(plan))); },
  };
}
