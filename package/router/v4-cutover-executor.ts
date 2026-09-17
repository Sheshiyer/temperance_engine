import { createHash, randomUUID } from "node:crypto";

import {
  ROUTER_PACKAGE,
  ROUTER_VERSION,
  MANAGED_LAUNCH_AGENT_LABELS,
  V4_CUTOVER_PLAN_SCHEMA,
  verifyV4CutoverPlanDigest,
  type BinaryObservation,
  type LaunchAgentObservation,
  type ManagedPathObservation,
  type PortObservation,
  type V4CutoverPlan,
} from "./v4-cutover-plan.ts";

export const V4_REPLACEMENT_PROOF_SCHEMA = "temperance.v4-replacement-proof.v1" as const;
export const V4_CUTOVER_RECEIPT_SCHEMA = "temperance.v4-cutover-receipt.v1" as const;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const REFERENCE_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const CONFIRMATION_MAX_AGE_MS = 15 * 60 * 1000;

export interface V4ReplacementProof {
  schema: typeof V4_REPLACEMENT_PROOF_SCHEMA;
  generated_at: string;
  temperance_revision: string;
  temperance_tree: string;
  router: { package: typeof ROUTER_PACKAGE; version: typeof ROUTER_VERSION };
  artifact_digest: `sha256:${string}`;
  verification: {
    install_surface: `sha256:${string}`;
    cutover_contract: `sha256:${string}`;
  };
  proof_digest: `sha256:${string}`;
}

export interface V4CutoverReview {
  plan_digest: V4CutoverPlan["plan_digest"];
  proof_digest: V4ReplacementProof["proof_digest"];
  operation_digest: `sha256:${string}`;
  details: string[];
}

export interface V4CutoverConfirmation {
  confirmed: true;
  operation_digest: V4CutoverReview["operation_digest"];
  confirmed_at: string;
}

export interface V4CutoverVerification {
  router_version: typeof ROUTER_VERSION;
  listener_owner: "replacement-9router";
  listener_port: 20128;
  loopback_only: boolean;
  legacy_state_absent: boolean;
  legacy_launch_agents_absent: boolean;
  doctor_passed: boolean;
}

export interface V4CutoverJournalEvent {
  sequence: number;
  action_id: string;
  status: "started" | "completed" | "failed";
  recorded_at: string;
  failure_code?: string;
}

export interface V4CutoverReceipt {
  schema: typeof V4_CUTOVER_RECEIPT_SCHEMA;
  version: { major: 1; minor: 0 };
  operation_id: string;
  operation_digest: V4CutoverReview["operation_digest"];
  plan_digest: V4CutoverPlan["plan_digest"];
  proof_digest: V4ReplacementProof["proof_digest"];
  status: "committed" | "failed";
  completed_action_ids: string[];
  secret_reference_ids: string[];
  redacted_fields: ["apiKey", "authorization", "credential", "password", "secret", "token"];
  recovery_status: "not-required" | "completed" | "failed";
  failure_code?: string;
  started_at: string;
  finished_at: string;
}

export interface V4CutoverJournal {
  begin(input: {
    operation_id: string;
    operation_digest: V4CutoverReview["operation_digest"];
    plan_digest: V4CutoverPlan["plan_digest"];
    proof_digest: V4ReplacementProof["proof_digest"];
    started_at: string;
  }): Promise<void>;
  append(event: V4CutoverJournalEvent): Promise<void>;
  complete(receipt: V4CutoverReceipt): Promise<void>;
}

export interface V4CutoverAdapter {
  preflightReplacement(proof: V4ReplacementProof, signal: AbortSignal): Promise<void>;
  stageReplacement(proof: V4ReplacementProof, signal: AbortSignal): Promise<void>;
  stopRouterPortOwner(owner: PortObservation, signal: AbortSignal): Promise<void>;
  unloadLaunchAgent(agent: LaunchAgentObservation, signal: AbortSignal): Promise<void>;
  restorePreCutoverServices(signal: AbortSignal): Promise<void>;
  revokeLegacyGatewayCredential(referenceId: string, signal: AbortSignal): Promise<void>;
  removeLaunchAgent(agent: LaunchAgentObservation, signal: AbortSignal): Promise<void>;
  removeManagedPath(path: ManagedPathObservation, signal: AbortSignal): Promise<void>;
  removeLegacyPackage(binary: BinaryObservation, signal: AbortSignal): Promise<void>;
  promoteTemperanceRuntime(path: ManagedPathObservation, proof: V4ReplacementProof, signal: AbortSignal): Promise<void>;
  installExactRouter(version: typeof ROUTER_VERSION, signal: AbortSignal): Promise<void>;
  installReplacementLaunchAgents(signal: AbortSignal): Promise<void>;
  activateReplacement(signal: AbortSignal): Promise<void>;
  verifyReplacement(signal: AbortSignal): Promise<V4CutoverVerification>;
  discardStagedReplacement(signal: AbortSignal): Promise<void>;
  recoverFreshReplacement(proof: V4ReplacementProof, signal: AbortSignal): Promise<void>;
}

export class V4CutoverExecutionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "V4CutoverExecutionError";
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function validTimestamp(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function proofScope(proof: Omit<V4ReplacementProof, "proof_digest">): Omit<V4ReplacementProof, "proof_digest"> {
  return {
    generated_at: proof.generated_at,
    temperance_revision: proof.temperance_revision,
    temperance_tree: proof.temperance_tree,
    router: { ...proof.router },
    artifact_digest: proof.artifact_digest,
    verification: { ...proof.verification },
    schema: proof.schema,
  };
}

export function createV4ReplacementProof(input: Omit<V4ReplacementProof, "schema" | "proof_digest">): V4ReplacementProof {
  const base = { schema: V4_REPLACEMENT_PROOF_SCHEMA, ...structuredClone(input) };
  const proof = { ...base, proof_digest: digest(proofScope(base)) } satisfies V4ReplacementProof;
  if (!verifyV4ReplacementProof(proof)) throw new V4CutoverExecutionError("CUTOVER_REPLACEMENT_PROOF_INVALID");
  return proof;
}

export function verifyV4ReplacementProof(value: unknown): value is V4ReplacementProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proof = value as V4ReplacementProof;
  if (!proof.router || typeof proof.router !== "object" || Array.isArray(proof.router)
    || !proof.verification || typeof proof.verification !== "object" || Array.isArray(proof.verification)) return false;
  const topLevelKeys = ["schema", "generated_at", "temperance_revision", "temperance_tree", "router", "artifact_digest", "verification", "proof_digest"];
  if (canonical(Object.keys(proof).sort()) !== canonical(topLevelKeys.sort())
    || canonical(Object.keys(proof.router).sort()) !== canonical(["package", "version"])
    || canonical(Object.keys(proof.verification).sort()) !== canonical(["cutover_contract", "install_surface"])) return false;
  return proof.schema === V4_REPLACEMENT_PROOF_SCHEMA
    && validTimestamp(proof.generated_at)
    && GIT_OBJECT.test(proof.temperance_revision)
    && GIT_OBJECT.test(proof.temperance_tree)
    && proof.router.package === ROUTER_PACKAGE
    && proof.router.version === ROUTER_VERSION
    && DIGEST.test(proof.artifact_digest)
    && DIGEST.test(proof.verification.install_surface)
    && DIGEST.test(proof.verification.cutover_contract)
    && DIGEST.test(proof.proof_digest)
    && proof.proof_digest === digest(proofScope(proof));
}

function assertReviewedPlan(plan: V4CutoverPlan): void {
  const routerOwnsPort = plan.router_port.owner === "legacy-omniroute" || plan.router_port.owner === "replacement-9router";
  if (plan.schema !== V4_CUTOVER_PLAN_SCHEMA
    || plan.read_only !== true
    || plan.target.package !== ROUTER_PACKAGE
    || plan.target.version !== ROUTER_VERSION
    || plan.policy.runnable_backup !== false
    || plan.policy.secret_values_recorded !== false
    || plan.policy.destructive_execution_authorized !== false
    || (routerOwnsPort && !MANAGED_LAUNCH_AGENT_LABELS.includes(plan.router_port.managed_service_label ?? ""))
    || plan.activation_blocked
    || !verifyV4CutoverPlanDigest(plan)) {
    throw new V4CutoverExecutionError("CUTOVER_PLAN_NOT_EXECUTABLE");
  }
}

export function createV4CutoverReview(plan: V4CutoverPlan, proof: V4ReplacementProof): V4CutoverReview {
  assertReviewedPlan(plan);
  if (!verifyV4ReplacementProof(proof)) throw new V4CutoverExecutionError("CUTOVER_REPLACEMENT_PROOF_INVALID");
  return {
    plan_digest: plan.plan_digest,
    proof_digest: proof.proof_digest,
    operation_digest: digest({
      schema: V4_CUTOVER_RECEIPT_SCHEMA,
      plan_digest: plan.plan_digest,
      proof_digest: proof.proof_digest,
      target: plan.target,
    }),
    details: [
      `reviewed cutover plan: ${plan.plan_digest}`,
      `reviewed replacement proof: ${proof.proof_digest}`,
      `host: ${plan.host.hardware_model} · ${plan.host.chip_model} · ${plan.host.architecture} · uid ${String(plan.host.user_id)}`,
      `Temperance revision: ${proof.temperance_revision}`,
      `Temperance tree: ${proof.temperance_tree}`,
      `router replacement: ${ROUTER_PACKAGE}@${ROUTER_VERSION}`,
      ...plan.paths.map((path) => `path ${path.id}: ${path.path} · ${path.observed} → ${path.disposition}`),
      ...plan.launch_agents.map((agent) => `LaunchAgent ${agent.label}: ${agent.path} · ${agent.observed} → ${agent.disposition}`),
    ],
  };
}

function assertConfirmation(review: V4CutoverReview, confirmation: V4CutoverConfirmation, now: Date): void {
  const confirmedAt = Date.parse(confirmation.confirmed_at);
  const age = now.getTime() - confirmedAt;
  if (confirmation.confirmed !== true
    || confirmation.operation_digest !== review.operation_digest
    || !Number.isFinite(confirmedAt)
    || age < -30_000
    || age > CONFIRMATION_MAX_AGE_MS) {
    throw new V4CutoverExecutionError("CUTOVER_CONFIRMATION_INVALID");
  }
}

function failureCode(error: unknown): string {
  const candidate = error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : error instanceof Error ? error.message : "CUTOVER_FAILED";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(candidate) ? candidate : "CUTOVER_FAILED";
}

function assertVerification(value: V4CutoverVerification): void {
  if (value.router_version !== ROUTER_VERSION
    || value.listener_owner !== "replacement-9router"
    || value.listener_port !== 20128
    || value.loopback_only !== true
    || value.legacy_state_absent !== true
    || value.legacy_launch_agents_absent !== true
    || value.doctor_passed !== true) {
    throw new V4CutoverExecutionError("CUTOVER_REPLACEMENT_VERIFICATION_FAILED");
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new V4CutoverExecutionError("CUTOVER_ABORTED");
}

export function validateV4CutoverReceipt(value: unknown): value is V4CutoverReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  const required = [
    "schema", "version", "operation_id", "operation_digest", "plan_digest", "proof_digest", "status",
    "completed_action_ids", "secret_reference_ids", "redacted_fields", "recovery_status", "started_at", "finished_at",
  ];
  const allowed = new Set([...required, "failure_code"]);
  if (Object.keys(receipt).some((key) => !allowed.has(key)) || required.some((key) => !(key in receipt))) return false;
  const version = receipt.version as Record<string, unknown> | undefined;
  const actions = receipt.completed_action_ids;
  const references = receipt.secret_reference_ids;
  const redacted = receipt.redacted_fields;
  const failed = receipt.status === "failed";
  return receipt.schema === V4_CUTOVER_RECEIPT_SCHEMA
    && Boolean(version && version.major === 1 && version.minor === 0 && Object.keys(version).length === 2)
    && typeof receipt.operation_id === "string" && SAFE_ID.test(receipt.operation_id)
    && typeof receipt.operation_digest === "string" && DIGEST.test(receipt.operation_digest)
    && typeof receipt.plan_digest === "string" && DIGEST.test(receipt.plan_digest)
    && typeof receipt.proof_digest === "string" && DIGEST.test(receipt.proof_digest)
    && (receipt.status === "committed" || failed)
    && Array.isArray(actions) && actions.every((item) => typeof item === "string" && SAFE_ID.test(item)) && new Set(actions).size === actions.length
    && Array.isArray(references) && references.every((item) => typeof item === "string" && REFERENCE_ID.test(item)) && new Set(references).size === references.length
    && Array.isArray(redacted) && canonical(redacted) === canonical(["apiKey", "authorization", "credential", "password", "secret", "token"])
    && ["not-required", "completed", "failed"].includes(String(receipt.recovery_status))
    && validTimestamp(String(receipt.started_at))
    && validTimestamp(String(receipt.finished_at))
    && Date.parse(String(receipt.finished_at)) >= Date.parse(String(receipt.started_at))
    && (failed
      ? typeof receipt.failure_code === "string" && /^[A-Z][A-Z0-9_]{2,127}$/u.test(receipt.failure_code)
      : receipt.failure_code === undefined);
}

function receipt(input: Omit<V4CutoverReceipt, "schema" | "version" | "redacted_fields">): V4CutoverReceipt {
  const value: V4CutoverReceipt = {
    schema: V4_CUTOVER_RECEIPT_SCHEMA,
    version: { major: 1, minor: 0 },
    redacted_fields: ["apiKey", "authorization", "credential", "password", "secret", "token"],
    ...input,
  };
  if (!validateV4CutoverReceipt(value)) throw new V4CutoverExecutionError("CUTOVER_RECEIPT_INVALID");
  return value;
}

/**
 * Executes a reviewed destructive cutover without ever restoring legacy bytes.
 * Before the irreversible boundary, failures restore stopped services. After
 * it, failures recover only from the already verified fresh replacement.
 */
export async function executeV4Cutover(options: {
  plan: V4CutoverPlan;
  proof: V4ReplacementProof;
  confirmation: V4CutoverConfirmation;
  legacyCredentialReferenceId: string;
  reobserve(): Promise<V4CutoverPlan>;
  adapter: V4CutoverAdapter;
  journal: V4CutoverJournal;
  signal?: AbortSignal;
  now?: () => Date;
  operationId?: string;
}): Promise<V4CutoverReceipt> {
  const now = options.now ?? (() => new Date());
  const review = createV4CutoverReview(options.plan, options.proof);
  assertConfirmation(review, options.confirmation, now());
  if (!REFERENCE_ID.test(options.legacyCredentialReferenceId)) throw new V4CutoverExecutionError("CUTOVER_SECRET_REFERENCE_INVALID");
  const operationId = options.operationId ?? `cutover-${randomUUID()}`;
  if (!SAFE_ID.test(operationId)) throw new V4CutoverExecutionError("CUTOVER_OPERATION_ID_INVALID");
  const observed = await options.reobserve();
  assertReviewedPlan(observed);
  if (observed.plan_digest !== options.plan.plan_digest) throw new V4CutoverExecutionError("CUTOVER_PLAN_DRIFTED");

  const signal = options.signal ?? new AbortController().signal;
  const startedAt = now().toISOString();
  let sequence = 0;
  let staged = false;
  let preparationChanged = false;
  let irreversible = false;
  let replacementVerified = false;
  const completed: string[] = [];
  await options.journal.begin({
    operation_id: operationId,
    operation_digest: review.operation_digest,
    plan_digest: options.plan.plan_digest,
    proof_digest: options.proof.proof_digest,
    started_at: startedAt,
  });

  const run = async (actionId: string, action: () => Promise<void>): Promise<void> => {
    assertNotAborted(signal);
    await options.journal.append({ sequence: sequence += 1, action_id: actionId, status: "started", recorded_at: now().toISOString() });
    try {
      await action();
      completed.push(actionId);
      await options.journal.append({ sequence: sequence += 1, action_id: actionId, status: "completed", recorded_at: now().toISOString() });
    } catch (error) {
      try {
        await options.journal.append({ sequence: sequence += 1, action_id: actionId, status: "failed", recorded_at: now().toISOString(), failure_code: failureCode(error) });
      } catch { /* Preserve the action failure. */ }
      throw error;
    }
  };

  try {
    await run("preflight-replacement", () => options.adapter.preflightReplacement(options.proof, signal));
    await run("stage-replacement", async () => {
      // Staging may create partial bytes before reporting failure. Mark it as
      // started first so compensation cannot strand an incomplete artifact.
      staged = true;
      await options.adapter.stageReplacement(options.proof, signal);
    });

    if (options.plan.router_port.owner === "legacy-omniroute" || options.plan.router_port.owner === "replacement-9router") {
      await run("stop-router-port-owner", async () => {
        preparationChanged = true;
        await options.adapter.stopRouterPortOwner(options.plan.router_port, signal);
      });
    }
    for (const agent of options.plan.launch_agents.filter(({ observed: state }) => state !== "absent")) {
      await run(`unload-launch-agent.${agent.label}`, async () => {
        preparationChanged = true;
        await options.adapter.unloadLaunchAgent(agent, signal);
      });
    }

    irreversible = true;
    await run("revoke-legacy-gateway-credential", () => options.adapter.revokeLegacyGatewayCredential(options.legacyCredentialReferenceId, signal));
    for (const agent of options.plan.launch_agents.filter(({ observed: state }) => state !== "absent")) {
      await run(`remove-launch-agent.${agent.label}`, () => options.adapter.removeLaunchAgent(agent, signal));
    }
    for (const path of options.plan.paths.filter(({ id, observed: state }) => id !== "runtime" && state !== "absent")) {
      await run(`remove-path.${path.id}`, () => options.adapter.removeManagedPath(path, signal));
    }
    const legacyBinary = options.plan.binaries.find(({ package: name }) => name === "omniroute");
    if (legacyBinary?.path) await run("remove-legacy-package", () => options.adapter.removeLegacyPackage(legacyBinary, signal));
    const runtime = options.plan.paths.find(({ id }) => id === "runtime");
    if (!runtime) throw new V4CutoverExecutionError("CUTOVER_RUNTIME_SCOPE_MISSING");
    await run("promote-temperance-runtime", () => options.adapter.promoteTemperanceRuntime(runtime, options.proof, signal));
    await run("install-exact-router", () => options.adapter.installExactRouter(ROUTER_VERSION, signal));
    await run("install-replacement-launch-agents", () => options.adapter.installReplacementLaunchAgents(signal));
    await run("activate-replacement", () => options.adapter.activateReplacement(signal));
    await run("verify-replacement", async () => assertVerification(await options.adapter.verifyReplacement(signal)));
    replacementVerified = true;

    const result = receipt({
      operation_id: operationId,
      operation_digest: review.operation_digest,
      plan_digest: options.plan.plan_digest,
      proof_digest: options.proof.proof_digest,
      status: "committed",
      completed_action_ids: [...completed],
      secret_reference_ids: [options.legacyCredentialReferenceId],
      recovery_status: "not-required",
      started_at: startedAt,
      finished_at: now().toISOString(),
    });
    await options.journal.complete(result);
    return result;
  } catch (error) {
    // The replacement is already live and verified. A final journal/receipt
    // failure must be surfaced, but must never tear down a healthy runtime.
    if (replacementVerified) {
      throw new V4CutoverExecutionError("CUTOVER_RECEIPT_FINALIZATION_FAILED");
    }
    let recoveryStatus: V4CutoverReceipt["recovery_status"] = "not-required";
    if (irreversible) {
      recoveryStatus = "completed";
      try { await options.adapter.recoverFreshReplacement(options.proof, new AbortController().signal); }
      catch { recoveryStatus = "failed"; }
    } else {
      if (preparationChanged || staged) recoveryStatus = "completed";
      if (preparationChanged) {
        try { await options.adapter.restorePreCutoverServices(new AbortController().signal); }
        catch { recoveryStatus = "failed"; }
      }
      if (staged) {
        try { await options.adapter.discardStagedReplacement(new AbortController().signal); }
        catch { recoveryStatus = "failed"; }
      }
    }
    const result = receipt({
      operation_id: operationId,
      operation_digest: review.operation_digest,
      plan_digest: options.plan.plan_digest,
      proof_digest: options.proof.proof_digest,
      status: "failed",
      completed_action_ids: [...completed],
      secret_reference_ids: [options.legacyCredentialReferenceId],
      recovery_status: recoveryStatus,
      failure_code: failureCode(error),
      started_at: startedAt,
      finished_at: now().toISOString(),
    });
    await options.journal.complete(result);
    return result;
  }
}
