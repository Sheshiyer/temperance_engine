import type { ProjectCandidateV1 } from "./public-contracts.ts";

export const ONBOARDING_CATALOG_SCHEMA = "temperance.onboarding.catalog.v1" as const;
export const ONBOARDING_PROFILE_SCHEMA = "temperance.onboarding.profile.v1" as const;
export const ONBOARDING_PLAN_SCHEMA = "temperance.onboarding.plan.v1" as const;
export const ONBOARDING_RECEIPT_SCHEMA = "temperance.onboarding.receipt.v1" as const;

export const NINE_ROUTER_PACKAGE = {
  name: "9router",
  version: "0.5.75",
  executable: "9router",
  current_state_directory: ".9router",
  legacy_state_directory: ".omniroute",
} as const;

export interface OnboardingVersionV1 {
  major: 1;
  minor: 0;
}

export interface BinaryCapability {
  id: string;
  kind: "binary";
  executable: string;
  /** Optional private host binding for an isolated executable. */
  executable_variable?: string;
  version?: { exact: string; argv?: string[]; pattern?: string };
}

export interface ApplicationCapability {
  id: string;
  kind: "application";
  bundle_id: string;
}

export interface MountCapability {
  id: string;
  kind: "mount";
  mount_path_variable: string;
  expected_uuid_variable?: string;
  required_relative_path_variable?: string;
}

export interface PathCapability {
  id: string;
  kind: "path";
  path_variable: string;
  path_type: "file" | "directory";
  access: "exists" | "readable" | "writable";
}

export interface KeychainSecretCapability {
  id: string;
  kind: "keychain-secret";
  secret_reference: string;
}

export interface RoutingAliasCapability {
  id: string;
  kind: "routing-alias";
  alias: string;
}

export interface HttpHealthCapability {
  id: string;
  kind: "http-health";
  url_variable: string;
}

export interface NineRouterManagementCapability {
  id: string;
  kind: "9router-management";
  data_dir_variable: string;
}

export type CapabilityRequirement =
  | BinaryCapability
  | ApplicationCapability
  | MountCapability
  | PathCapability
  | KeychainSecretCapability
  | RoutingAliasCapability
  | HttpHealthCapability
  | NineRouterManagementCapability;

export type GuidedInstall =
  | { id: string; label: string; kind: "command"; argv: string[]; environment?: Record<string, string> }
  | { id: string; label: string; kind: "open-url"; url: string };

export interface StateTransition {
  from_relative_path: string;
  to_relative_path: string;
  policy: "fresh-rebuild";
  copy_legacy_state: false;
}

export interface NineRouterRuntimeContract {
  owner: "temperance";
  launch_agent_label: "com.temperance.engine.9router";
  forbidden_launch_agent_label: "com.9router.autostart";
  listen_host: "127.0.0.1";
  listen_port: 20128;
  data_dir_variable: "NINE_ROUTER_DATA_DIR";
  node_executable_variable: "NINE_ROUTER_NODE_EXECUTABLE";
  cli_entrypoint_variable: "NINE_ROUTER_CLI_ENTRYPOINT";
  path_variable: "NINE_ROUTER_PATH";
  log_directory_variable: "NINE_ROUTER_LOG_DIR";
  argv: ["--tray", "--host", "127.0.0.1", "--no-browser", "--skip-update"];
  run_at_load: true;
  keep_alive: true;
  management_auth: {
    header: "x-9r-cli-token";
    derivation: "data-dir-machine-secret";
    machine_id_relative_path: "machine-id";
    secret_relative_path: "auth/cli-secret";
    secret_mode: "0600";
    persist_derived_token: false;
  };
  api_contract: {
    keys: { collection: "/api/keys"; item: "/api/keys/{id}" };
    cli_tool_settings: "/api/cli-tools/{tool}-settings";
    cli_tools: ["claude", "codex", "droid", "openclaw"];
    providers: "/api/providers";
    provider_item: "/api/providers/{id}";
    provider_create_fields: ["provider", "name", "apiKey"];
    combos: "/api/combos";
    combo_item: "/api/combos/{id}";
    combo_create_fields: ["name", "models"];
    gateway_key_policy: {
      capture: "one-time-to-keychain";
      profile_storage: "reference-only";
      receipt_storage: "redacted";
    };
  };
  cleanup_path_divergence: "doctor-required";
}

export interface OnboardingModule {
  id: string;
  title: string;
  summary: string;
  preselection: "selected" | "available" | "off";
  depends_on: string[];
  requires: CapabilityRequirement[];
  guided_installs: GuidedInstall[];
  state_transition?: StateTransition;
  runtime_contract?: NineRouterRuntimeContract;
}

export interface OnboardingCatalogV1 {
  schema: typeof ONBOARDING_CATALOG_SCHEMA;
  version: OnboardingVersionV1;
  modules: OnboardingModule[];
}

export interface KeychainSecretReference {
  store: "macos-keychain";
  service: string;
  account: string;
}

export interface RoutingAlias {
  alias: string;
  combo: string;
}

export interface ProjectEnrollment {
  id: string;
  root_variable: string;
  approved: boolean;
  access: "read-only" | "read-write";
}

export interface OnboardingProfileV1 {
  schema: typeof ONBOARDING_PROFILE_SCHEMA;
  version: OnboardingVersionV1;
  id: string;
  variables: Record<string, string>;
  secret_references: Record<string, KeychainSecretReference>;
  preselected_modules: string[];
  routing_aliases: RoutingAlias[];
  project_enrollments: ProjectEnrollment[];
}

export type CapabilityProbeReasonCode =
  | "AVAILABLE"
  | "BINARY_MISSING"
  | "VERSION_MISMATCH"
  | "APPLICATION_MISSING"
  | "MOUNT_ABSENT"
  | "MOUNT_UUID_MISMATCH"
  | "PATH_MISSING"
  | "PATH_INACCESSIBLE"
  | "SECRET_REFERENCE_MISSING"
  | "SECRET_UNAVAILABLE"
  | "ROUTING_ALIAS_MISSING"
  | "ROUTING_ALIAS_AMBIGUOUS"
  | "ROUTING_COMBO_MISSING"
  | "ROUTING_COMBO_AMBIGUOUS"
  | "ROUTING_COMBO_EMPTY"
  | "ROUTING_COMBO_CHANGED"
  | "ROUTING_MODEL_UNAVAILABLE"
  | "ROUTING_MODEL_NESTED"
  | "ROUTING_API_UNAVAILABLE"
  | "ROUTING_AUTH_UNAVAILABLE"
  | "ROUTING_RESPONSE_INVALID"
  | "VARIABLE_MISSING"
  | "VARIABLE_INVALID"
  | "HTTP_UNAVAILABLE"
  | "UNSUPPORTED_PLATFORM"
  | "PROBE_FAILED";

export interface CapabilityProbe {
  capability_id: string;
  available: boolean;
  reason_code: CapabilityProbeReasonCode;
  evidence: string[];
}

export interface OnboardingProbeContext {
  profile: OnboardingProfileV1;
  signal: AbortSignal;
}

export interface OnboardingProbeAdapter {
  probe(requirement: CapabilityRequirement, context: OnboardingProbeContext): Promise<CapabilityProbe>;
  now?: () => Date;
}

export type HoldReasonCode = CapabilityProbeReasonCode | "DEPENDENCY_BLOCKED" | "DEPENDENCY_MISSING" | "DEPENDENCY_CYCLE";

export interface OnboardingHold {
  reason_code: HoldReasonCode;
  message: string;
  remediation: string[];
  capability_id?: string;
  dependency_id?: string;
  evidence: string[];
}

export interface OnboardingModuleResolution {
  id: string;
  title: string;
  requested: boolean;
  status: "eligible" | "blocked" | "not-selected";
  holds: OnboardingHold[];
  guided_installs: GuidedInstall[];
  advisories: Array<{
    reason_code: "NINE_ROUTER_DATA_DIR_CLEANUP_DIVERGENCE";
    message: string;
    remediation: string[];
  }>;
}

export interface OnboardingPlanV1 {
  schema: typeof ONBOARDING_PLAN_SCHEMA;
  version: OnboardingVersionV1;
  profile_id: string;
  generated_at: string;
  dry_run: boolean;
  operating_mode: "ready" | "blocked" | "read-only-degraded";
  install_order: string[];
  project_enrollments?: Array<Pick<ProjectEnrollment, "id" | "approved" | "access">>;
  project_candidates?: ProjectCandidateV1[];
  project_discovery_findings?: Array<{ source_id: string; code: string; message: string }>;
  configuration_inputs?: Array<{
    id: string;
    digest: `sha256:${string}`;
    details: string[];
  }>;
  modules: OnboardingModuleResolution[];
  plan_digest: `sha256:${string}`;
}
