import { types } from "node:util";
import { digest, digestValue, frozen, id, invalid, list, record, timestamp, type Digest } from "./boundary.ts";
import { invokeBounded } from "./invoke.ts";
import { inspectCompositionV2, validateCompositionV2, validateDescriptor, validateObservationsV2 } from "./v2.ts";

export interface WorkRequestV2 {
  schema: "temperance.work-request.v2";
  plant_id: string; run_id: string; occurrence_id: string; task_digest: Digest;
  source_manifest_digest: Digest; flow_ref: string; step_ref: string;
  module_id: string; operation_id: string; occurred_at: string; input: unknown;
}
export interface ActionPlanV1 {
  schema: "temperance.owner-action-plan.v1";
  plant_id: string; run_id: string; task_digest: Digest; source_manifest_digest: Digest;
  flow_ref: string; step_ref: string; module_id: string; operation_id: string;
  capability: string; owner_ref: string; owner_source_digest: Digest;
  mode: "read" | "write"; input_digest: Digest; plan_digest: Digest;
}
export interface OwnerResultV1 {
  schema: "temperance.owner-action-result.v1";
  plan_digest: Digest; status: "completed" | "held" | "failed" | "indeterminate";
  receipt_ref: string | null; artifact_refs: string[]; value: unknown;
}
export interface OwnerAdapter {
  ref: string; source_digest: Digest;
  invoke(plan: Readonly<ActionPlanV1>, input: unknown, signal: AbortSignal): Promise<OwnerResultV1>;
  /** Reconcile an uncertain attempt before considering any new invocation. */
  status?(plan: Readonly<ActionPlanV1>, signal: AbortSignal): Promise<OwnerResultV1>;
}
export interface AuthorizationOwner {
  ref: string; source_digest: Digest;
  authorize(plan: Readonly<ActionPlanV1>, input: unknown, signal: AbortSignal): Promise<{
    authorized: boolean; plan_digest: Digest; task_digest: Digest; expires_at: string; receipt_ref: string;
  }>;
}
export interface ModuleHandler {
  source_digest: Digest;
  invoke(context: ModuleContextV2): Promise<{ status: "completed" | "held"; artifact_refs: string[]; reason_code: string }>;
}
export interface ModuleContextV2 {
  readonly request: Readonly<WorkRequestV2>; readonly signal: AbortSignal; readonly deadline_ms: number;
  perform(input: unknown): Promise<Readonly<OwnerResultV1>>;
}
export interface WorkReceiptV2 {
  schema: "temperance.work-receipt.v2";
  identity_digest: Digest; request_digest: Digest; source_manifest_digest: Digest;
  plant_id: string; run_id: string; step_ref: string; module_id: string; operation_id: string;
  status: "completed" | "held" | "failed" | "indeterminate" | "replay" | "in-progress" | "persistence-failed";
  reason_code: string; persisted: boolean; callback_settled: boolean; cancellation_requested: boolean;
  actions: Array<{ plan_digest: Digest; owner_ref: string; capability: string; mode: "read" | "write"; status: OwnerResultV1["status"]; receipt_ref: string | null; artifact_refs: string[] }>;
  artifact_refs: string[]; acceptance_asserted: false;
}
export interface WorkLedgerV2 {
  /** A durable atomic claim must remain held after crashes and uncertain commits. */
  claim(identity: Digest): Promise<"claimed" | "replay" | "in-progress">;
  commit(identity: Digest, receipt: Readonly<WorkReceiptV2>): Promise<void>;
}
export interface InvokeModuleOptionsV2 {
  manifest: unknown; descriptors: readonly unknown[]; observations?: unknown; request: unknown;
  handlers: Readonly<Record<string, ModuleHandler>>; owners: readonly OwnerAdapter[];
  authorization?: AuthorizationOwner; ledger: WorkLedgerV2; now?: () => number; timeout_ms?: number; signal?: AbortSignal;
}
function validateRequest(input: unknown): Readonly<WorkRequestV2> {
  const v = record(input, ["schema", "plant_id", "run_id", "occurrence_id", "task_digest", "source_manifest_digest", "flow_ref", "step_ref", "module_id", "operation_id", "occurred_at", "input"]);
  if (v.schema !== "temperance.work-request.v2") invalid();
  for (const key of ["plant_id", "run_id", "occurrence_id", "flow_ref", "step_ref", "module_id", "operation_id"]) id(v[key]);
  digest(v.task_digest); digest(v.source_manifest_digest); timestamp(v.occurred_at);
  return frozen(input as WorkRequestV2);
}
function validateOwnerResult(value: unknown, plan: Readonly<ActionPlanV1>): Readonly<OwnerResultV1> {
  const v = record(value, ["schema", "plan_digest", "status", "receipt_ref", "artifact_refs", "value"]);
  if (v.schema !== "temperance.owner-action-result.v1" || v.plan_digest !== plan.plan_digest || !["completed", "held", "failed", "indeterminate"].includes(v.status)) invalid("ENGINE_OWNER_RESULT_INVALID");
  if (v.receipt_ref !== null) id(v.receipt_ref);
  if (v.status === "completed" && v.receipt_ref === null) invalid("ENGINE_OWNER_RECEIPT_MISSING");
  list(v.artifact_refs, id, 32);
  return frozen(value as OwnerResultV1);
}
function safeAdapters(handlers: InvokeModuleOptionsV2["handlers"]): Readonly<Record<string, ModuleHandler>> {
  if (!handlers || typeof handlers !== "object" || types.isProxy(handlers) || ![Object.prototype, null].includes(Object.getPrototypeOf(handlers))) invalid();
  const snapshot: Record<string, ModuleHandler> = Object.create(null);
  for (const key of Reflect.ownKeys(handlers)) {
    if (typeof key !== "string") invalid(); id(key);
    const property = Object.getOwnPropertyDescriptor(handlers, key)!;
    if (!property.enumerable || property.get || property.set) invalid();
    const adapter = property.value;
    if (!adapter || typeof adapter !== "object" || types.isProxy(adapter)) invalid();
    const source = Object.getOwnPropertyDescriptor(adapter, "source_digest"), invoke = Object.getOwnPropertyDescriptor(adapter, "invoke");
    if (!source || source.get || source.set || !invoke || invoke.get || invoke.set || typeof invoke.value !== "function") invalid();
    digest(source.value);
    snapshot[key] = Object.freeze({ source_digest: source.value, invoke: invoke.value });
  }
  return Object.freeze(snapshot);
}

/** One caller-selected step. The engine never chooses the next flow step. */
export async function invokeModuleV2(options: InvokeModuleOptionsV2): Promise<Readonly<WorkReceiptV2>> {
  const clock = options.now ?? Date.now;
  const initialNow = clock();
  if (!Number.isSafeInteger(initialNow)) invalid();
  const timeout = options.timeout_ms ?? 1000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000) invalid();
  const manifest = validateCompositionV2(options.manifest);
  const descriptors = list(options.descriptors, validateDescriptor);
  const observations = options.observations === undefined ? undefined : validateObservationsV2(options.observations);
  const report = inspectCompositionV2(manifest, descriptors, observations, initialNow);
  const request = validateRequest(options.request);
  const handlers = safeAdapters(options.handlers);
  const owners = options.owners.map(owner => Object.freeze({ ref: owner.ref, source_digest: owner.source_digest, invoke: owner.invoke.bind(owner), ...(owner.status ? { status: owner.status.bind(owner) } : {}) }));
  const authority = options.authorization;
  const authorization = authority ? Object.freeze({ ref: authority.ref, source_digest: authority.source_digest, authorize: authority.authorize.bind(authority) }) : undefined;
  const ledger = { claim: options.ledger.claim.bind(options.ledger), commit: options.ledger.commit.bind(options.ledger) };
  if (request.plant_id !== manifest.plant.id || request.source_manifest_digest !== report.source_manifest_digest) invalid("ENGINE_WORK_IDENTITY_MISMATCH");
  if (manifest.flow?.owner_ref !== request.flow_ref) invalid("ENGINE_FLOW_OWNER_MISMATCH");
  const occurred = timestamp(request.occurred_at);
  if (occurred > initialNow || initialNow - occurred > 300000) invalid("ENGINE_WORK_STALE");
  const identity = digestValue({ plant_id: request.plant_id, run_id: request.run_id, task_digest: request.task_digest, flow_ref: request.flow_ref, step_ref: request.step_ref, module_id: request.module_id });
  const receipt: WorkReceiptV2 = { schema: "temperance.work-receipt.v2", identity_digest: identity, request_digest: digestValue(request), source_manifest_digest: report.source_manifest_digest, plant_id: request.plant_id, run_id: request.run_id, step_ref: request.step_ref, module_id: request.module_id, operation_id: request.operation_id, status: "held", reason_code: "CAPABILITY_HELD", persisted: false, callback_settled: true, cancellation_requested: false, actions: [], artifact_refs: [], acceptance_asserted: false };
  const claim = await ledger.claim(identity);
  if (claim === "replay" || claim === "in-progress") return frozen({ ...receipt, status: claim, reason_code: "WORK_ALREADY_CLAIMED" });
  if (claim !== "claimed") invalid("ENGINE_CLAIM_FAILED");
  async function commit(): Promise<Readonly<WorkReceiptV2>> {
    try { const committed = frozen({ ...receipt, persisted: true }); await ledger.commit(identity, committed); return committed; }
    catch { return frozen({ ...receipt, status: "persistence-failed" as const, reason_code: "RECEIPT_COMMIT_UNCERTAIN", persisted: false }); }
  }
  if (options.signal?.aborted) { receipt.cancellation_requested = true; receipt.reason_code = "WORK_CANCELLED"; return commit(); }
  const descriptor = descriptors.find(candidate => candidate.id === request.module_id);
  const row = report.modules.find(candidate => candidate.id === request.module_id);
  const operation = descriptor?.operations.find(candidate => candidate.id === request.operation_id);
  const handler = handlers[request.module_id];
  if (!descriptor || row?.readiness !== "configuration-observed" || !operation) return commit();
  const callbackNow = clock();
  if (callbackNow >= initialNow + timeout || callbackNow - occurred > 300000 || inspectCompositionV2(manifest, descriptors, observations, callbackNow).modules.find(candidate => candidate.id === request.module_id)?.readiness !== "configuration-observed") { receipt.reason_code = "WORK_CONTEXT_EXPIRED"; return commit(); }
  if (!handler || handler.source_digest !== descriptor.source_digest) { receipt.reason_code = "HANDLER_UNAVAILABLE_OR_PIN_MISMATCH"; return commit(); }
  const binding = manifest.bindings.find(candidate => candidate.capability === operation.capability)!;
  const owner = owners.find(candidate => candidate.ref === binding.owner_ref);
  if (!owner || owner.source_digest !== binding.source_digest) { receipt.reason_code = "OWNER_UNAVAILABLE_OR_PIN_MISMATCH"; return commit(); }
  let invoked = false;
  let performUsed = false;
  const outcome = await invokeBounded(async signal => {
    const context: ModuleContextV2 = Object.freeze({ request, signal, deadline_ms: initialNow + timeout,
      async perform(input: unknown): Promise<Readonly<OwnerResultV1>> {
        if (performUsed) invalid("ENGINE_OPERATION_ALREADY_ATTEMPTED");
        performUsed = true;
        const payload = frozen(input);
        const unsigned = { schema: "temperance.owner-action-plan.v1" as const, plant_id: request.plant_id, run_id: request.run_id, task_digest: request.task_digest, source_manifest_digest: request.source_manifest_digest, flow_ref: request.flow_ref, step_ref: request.step_ref, module_id: request.module_id, operation_id: request.operation_id, capability: operation.capability, owner_ref: owner.ref, owner_source_digest: owner.source_digest, mode: operation.mode, input_digest: digestValue(payload) };
        const plan: Readonly<ActionPlanV1> = frozen({ ...unsigned, plan_digest: digestValue(unsigned) });
        const trace: WorkReceiptV2["actions"][number] = { plan_digest: plan.plan_digest, owner_ref: owner.ref, capability: operation.capability, mode: operation.mode, status: "held", receipt_ref: null, artifact_refs: [] };
        receipt.actions.push(trace);
        const blocked = (): Readonly<OwnerResultV1> => frozen({ schema: "temperance.owner-action-result.v1", plan_digest: plan.plan_digest, status: "held", receipt_ref: null, artifact_refs: [], value: null });
        const readyAt = (at: number) => inspectCompositionV2(manifest, descriptors, observations, at).modules.find(candidate => candidate.id === request.module_id)?.readiness === "configuration-observed";
        const beforeApproval = clock();
        if (signal.aborted || beforeApproval >= context.deadline_ms || !readyAt(beforeApproval)) return blocked();
        let approvalExpiry = Infinity;
        if (operation.mode === "write") {
          if (!authorization || authorization.ref !== manifest.authorization_owner?.ref || authorization.source_digest !== manifest.authorization_owner.source_digest) return blocked();
          const raw = await authorization.authorize(plan, payload, signal);
          const decision = record(raw, ["authorized", "plan_digest", "task_digest", "expires_at", "receipt_ref"]);
          id(decision.receipt_ref);
          approvalExpiry = timestamp(decision.expires_at);
          if (decision.authorized !== true || decision.plan_digest !== plan.plan_digest || decision.task_digest !== plan.task_digest || approvalExpiry <= clock()) return blocked();
        }
        const dispatchNow = clock();
        if (signal.aborted || dispatchNow >= context.deadline_ms || dispatchNow >= approvalExpiry || !readyAt(dispatchNow)) return blocked();
        invoked = true;
        trace.status = "indeterminate";
        try {
          const result = validateOwnerResult(await owner.invoke(plan, payload, signal), plan);
          if (signal.aborted || clock() >= context.deadline_ms) return frozen({ ...result, status: "indeterminate" });
          trace.status = result.status; trace.receipt_ref = result.receipt_ref; trace.artifact_refs = [...result.artifact_refs];
          return result;
        } catch { return frozen({ ...blocked(), status: "indeterminate" }); }
      },
    });
    const raw = await handler.invoke(context);
    const result = record(raw, ["status", "artifact_refs", "reason_code"]);
    if (!["completed", "held"].includes(result.status)) invalid();
    list(result.artifact_refs, id, 32); id(result.reason_code);
    return frozen(raw);
  }, timeout, options.signal);
  receipt.callback_settled = outcome.callback_settled;
  receipt.cancellation_requested = outcome.cancellation_requested;
  if (outcome.outcome === "timeout" || outcome.outcome === "cancelled" || receipt.actions.some(action => action.status === "indeterminate")) { receipt.status = "indeterminate"; receipt.reason_code = "OWNER_STATUS_REQUIRED"; }
  else if (outcome.outcome === "failed") { receipt.status = invoked ? "indeterminate" : "failed"; receipt.reason_code = invoked ? "OWNER_STATUS_REQUIRED" : "MODULE_CALLBACK_FAILED"; }
  else if (outcome.value?.status === "completed" && receipt.actions.length > 0 && receipt.actions.every(action => action.status === "completed") && outcome.value.artifact_refs.every(ref => receipt.actions.some(action => action.artifact_refs.includes(ref)))) { receipt.status = "completed"; receipt.reason_code = "PROCESS_COMPLETED"; receipt.artifact_refs = [...outcome.value.artifact_refs]; }
  else receipt.reason_code = outcome.value?.reason_code ?? "OWNER_HELD";
  return commit();
}

/** Readback only: no retry, approval, provider selection or effect invocation. */
export async function readOwnerActionStatus(owner: OwnerAdapter, plan: Readonly<ActionPlanV1>, signal = new AbortController().signal) {
  record(plan, ["schema", "plant_id", "run_id", "task_digest", "source_manifest_digest", "flow_ref", "step_ref", "module_id", "operation_id", "capability", "owner_ref", "owner_source_digest", "mode", "input_digest", "plan_digest"]);
  const { plan_digest, ...unsigned } = plan;
  if (digestValue(unsigned) !== plan_digest || owner.ref !== plan.owner_ref || owner.source_digest !== plan.owner_source_digest) invalid("ENGINE_ACTION_IDENTITY_MISMATCH");
  if (!owner.status) throw new Error("ENGINE_OWNER_STATUS_UNAVAILABLE");
  return validateOwnerResult(await owner.status(plan, signal), plan);
}
