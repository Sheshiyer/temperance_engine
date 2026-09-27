import { isAbsolute, join, normalize } from "node:path";

import type { KeychainSecretReference } from "../install-surface/src/onboarding/contracts.ts";
import {
  V4CutoverExecutionError,
  createV4CutoverReview,
  executeV4Cutover,
  verifyV4ReplacementProof,
  type V4CutoverAdapter,
  type V4CutoverConfirmation,
  type V4CutoverJournal,
  type V4CutoverReceipt,
  type V4ReplacementProof,
} from "./v4-cutover-executor.ts";
import {
  createMacOsV4CutoverRuntime,
  type MacOsV4CutoverRuntimeOptions,
} from "./v4-macos-cutover-runtime.ts";
import type { MacOsV4DoctorProbe } from "./v4-macos-replacement-services.ts";
import type { PortableV4ServiceInput } from "./v4-portable-replacement.ts";
import {
  MANAGED_LAUNCH_AGENTS,
  createV4CutoverPlan,
  observeV4CutoverHost,
  validateV4CutoverHostObservation,
  verifyV4CutoverPlanDigest,
  type V4CutoverHostObservation,
  type V4CutoverPlan,
} from "./v4-cutover-plan.ts";

const REFERENCE_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;

export interface V4CutoverApplyBinding {
  home_directory: string;
  expected_host: V4CutoverHostObservation;
  source_repository: string;
  env_executable: string;
  node_executable: string;
  executable_path: string;
  bun_executable: string;
  git_executable: string;
  tar_executable: string;
  data_directory: string;
  log_directory: string;
  cli_entrypoint: string;
  health_url: string;
  legacy_credential_reference_id: string;
  legacy_credential_reference: KeychainSecretReference;
}

export interface V4CutoverApplyInput {
  plan: V4CutoverPlan;
  proof: V4ReplacementProof;
  confirmation: V4CutoverConfirmation;
  binding: V4CutoverApplyBinding;
  signal?: AbortSignal;
  operation_id?: string;
}

export interface V4CutoverApplyRuntime {
  adapter: V4CutoverAdapter;
  journal: V4CutoverJournal;
}

export interface V4CutoverApplyDependencies {
  observeHost?: () => V4CutoverHostObservation;
  createPlan?: () => V4CutoverPlan;
  createRuntime?: (options: MacOsV4CutoverRuntimeOptions) => V4CutoverApplyRuntime;
  execute?: typeof executeV4Cutover;
  fetch?: typeof fetch;
  now?: () => Date;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalAbsolute(value: string): boolean {
  return value.length > 1 && isAbsolute(value) && normalize(value) === value && !value.includes("\0");
}

function assertReference(reference: KeychainSecretReference): void {
  if (reference.store !== "macos-keychain") throw new V4CutoverExecutionError("CUTOVER_APPLY_KEYCHAIN_REFERENCE_INVALID");
  for (const value of [reference.service, reference.account]) {
    if (!value || value.length > 512 || value.trim() !== value || /[\0\r\n]/u.test(value)) {
      throw new V4CutoverExecutionError("CUTOVER_APPLY_KEYCHAIN_REFERENCE_INVALID");
    }
  }
}

function assertBinding(plan: V4CutoverPlan, proof: V4ReplacementProof, confirmation: V4CutoverConfirmation, binding: V4CutoverApplyBinding): void {
  if (!verifyV4CutoverPlanDigest(plan) || plan.activation_blocked || !verifyV4ReplacementProof(proof)) {
    throw new V4CutoverExecutionError("CUTOVER_APPLY_REVIEW_INVALID");
  }
  const review = createV4CutoverReview(plan, proof);
  if (Object.keys(confirmation).sort().join(",") !== "confirmed,confirmed_at,operation_digest"
    || confirmation.confirmed !== true
    || confirmation.operation_digest !== review.operation_digest
    || !Number.isFinite(Date.parse(confirmation.confirmed_at))) {
    throw new V4CutoverExecutionError("CUTOVER_APPLY_CONFIRMATION_INVALID");
  }
  if (!validateV4CutoverHostObservation(binding.expected_host)
    || binding.expected_host.platform !== "darwin"
    || canonical(binding.expected_host) !== canonical(plan.host)) {
    throw new V4CutoverExecutionError("CUTOVER_APPLY_INTENDED_HOST_MISMATCH");
  }
  const paths = [
    binding.home_directory,
    binding.source_repository,
    binding.env_executable,
    binding.node_executable,
    binding.bun_executable,
    binding.git_executable,
    binding.tar_executable,
    binding.data_directory,
    binding.log_directory,
    binding.cli_entrypoint,
    ...binding.executable_path.split(":"),
  ];
  if (!paths.every(canonicalAbsolute)) throw new V4CutoverExecutionError("CUTOVER_APPLY_PATH_INVALID");
  const runtime = join(binding.home_directory, ".temperance_engine");
  if (binding.data_directory !== join(binding.home_directory, ".9router")
    || binding.log_directory !== join(runtime, "logs")
    || binding.cli_entrypoint !== join(runtime, "providers", "9router", "node_modules", "9router", "cli.js")) {
    throw new V4CutoverExecutionError("CUTOVER_APPLY_RUNTIME_BINDING_DRIFTED");
  }
  const expectedPaths = new Map([
    ["runtime", runtime],
    ["legacy-omniroute", join(binding.home_directory, ".omniroute")],
    ["legacy-omnirouter", join(binding.home_directory, ".omnirouter")],
    ["router-state", binding.data_directory],
  ]);
  if (plan.paths.length !== expectedPaths.size
    || plan.paths.some((path) => expectedPaths.get(path.id) !== path.path)) {
    throw new V4CutoverExecutionError("CUTOVER_APPLY_PLAN_SCOPE_DRIFTED");
  }
  const launchAgents = join(binding.home_directory, "Library", "LaunchAgents");
  if (plan.launch_agents.length !== MANAGED_LAUNCH_AGENTS.length
    || plan.launch_agents.some((agent) => agent.path !== join(launchAgents, `${agent.label}.plist`))) {
    throw new V4CutoverExecutionError("CUTOVER_APPLY_PLAN_SCOPE_DRIFTED");
  }
  if (!REFERENCE_ID.test(binding.legacy_credential_reference_id)) {
    throw new V4CutoverExecutionError("CUTOVER_APPLY_REFERENCE_ID_INVALID");
  }
  assertReference(binding.legacy_credential_reference);
  let health: URL;
  try { health = new URL(binding.health_url); }
  catch { throw new V4CutoverExecutionError("CUTOVER_APPLY_HEALTH_URL_INVALID"); }
  if (health.protocol !== "http:"
    || health.hostname !== "127.0.0.1"
    || health.port !== "20128"
    || health.username !== ""
    || health.password !== ""
    || health.hash !== "") {
    throw new V4CutoverExecutionError("CUTOVER_APPLY_HEALTH_URL_INVALID");
  }
}

/** Secret-free, bounded HTTP liveness check for the replacement service. */
export class LoopbackV4DoctorProbe implements MacOsV4DoctorProbe {
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly healthUrl: string,
    private readonly dataDirectory: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.fetcher = fetcher;
    assertBindingHealthUrl(healthUrl);
    if (!canonicalAbsolute(dataDirectory)) throw new V4CutoverExecutionError("CUTOVER_DOCTOR_DATA_DIR_INVALID");
  }

  async run(input: PortableV4ServiceInput, signal: AbortSignal): Promise<boolean> {
    if (input.data_directory !== this.dataDirectory || signal.aborted) return false;
    try {
      const response = await this.fetcher(this.healthUrl, { method: "HEAD", redirect: "error", signal });
      return response.ok;
    } catch {
      return false;
    }
  }
}

function assertBindingHealthUrl(value: string): void {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new V4CutoverExecutionError("CUTOVER_DOCTOR_HEALTH_URL_INVALID"); }
  if (url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || url.port !== "20128"
    || url.username !== ""
    || url.password !== ""
    || url.hash !== "") {
    throw new V4CutoverExecutionError("CUTOVER_DOCTOR_HEALTH_URL_INVALID");
  }
}

/**
 * Live apply admission. It consumes an external, short-lived confirmation and
 * re-observes the exact host before the executor opens its durable journal.
 */
export async function applyV4Cutover(
  input: V4CutoverApplyInput,
  dependencies: V4CutoverApplyDependencies = {},
): Promise<V4CutoverReceipt> {
  assertBinding(input.plan, input.proof, input.confirmation, input.binding);
  const observeHost = dependencies.observeHost ?? (() => observeV4CutoverHost());
  const observedHost = observeHost();
  if (observedHost.platform !== "darwin") {
    throw new V4CutoverExecutionError("CUTOVER_APPLY_MACOS_REQUIRED");
  }
  if (!validateV4CutoverHostObservation(observedHost)
    || canonical(observedHost) !== canonical(input.plan.host)) {
    throw new V4CutoverExecutionError("CUTOVER_APPLY_HOST_DRIFTED");
  }
  const doctor = new LoopbackV4DoctorProbe(
    input.binding.health_url,
    input.binding.data_directory,
    dependencies.fetch,
  );
  const createRuntime = dependencies.createRuntime ?? createMacOsV4CutoverRuntime;
  const runtime = createRuntime({
    homeDirectory: input.binding.home_directory,
    sourceRepository: input.binding.source_repository,
    envExecutable: input.binding.env_executable,
    nodeExecutable: input.binding.node_executable,
    executablePath: input.binding.executable_path,
    legacyCredentialReferences: {
      [input.binding.legacy_credential_reference_id]: input.binding.legacy_credential_reference,
    },
    doctor,
    uid: observedHost.user_id ?? undefined,
    bunExecutable: input.binding.bun_executable,
    gitExecutable: input.binding.git_executable,
    tarExecutable: input.binding.tar_executable,
  });
  const createPlan = dependencies.createPlan ?? (() => createV4CutoverPlan({
    homeDirectory: input.binding.home_directory,
    platform: "darwin",
    observeHost,
  }));
  const execute = dependencies.execute ?? executeV4Cutover;
  return execute({
    plan: input.plan,
    proof: input.proof,
    confirmation: input.confirmation,
    legacyCredentialReferenceId: input.binding.legacy_credential_reference_id,
    reobserve: async () => createPlan(),
    adapter: runtime.adapter,
    journal: runtime.journal,
    signal: input.signal,
    now: dependencies.now,
    operationId: input.operation_id,
  });
}
