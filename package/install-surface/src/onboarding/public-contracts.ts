import type { CapabilityRequirement, KeychainSecretReference, RoutingAlias } from "./contracts.ts";

export const HOST_PROFILE_SCHEMA = "temperance.host-profile.v1" as const;
export const HOST_BINDING_SCHEMA = "temperance.host-binding.v1" as const;
export const MODULE_DESCRIPTOR_SCHEMA = "temperance.module-descriptor.v2" as const;
export const PROJECT_CAPSULE_SCHEMA = "temperance.project-capsule.v1" as const;
export const OPERATION_RECEIPT_SCHEMA = "temperance.operation-receipt.v1" as const;
export const NINE_ROUTER_GUIDED_SETUP_SCHEMA = "temperance.9router-guided-setup.v1" as const;

export type ModuleAdmissionState = "unavailable" | "detected" | "configured" | "healthy" | "enabled";

type ProjectDiscoverySourceV1 =
  | { source_root_variable: string; source_base?: never }
  | { source_root_variable?: never; source_base: "host-profile-directory" };

export type ProjectDiscoverySpecV1 =
  | {
    id: string;
    kind: "directory-children";
    root_variable: string;
    root_prefix_variable?: string;
    require_git: boolean;
    access: "read-only" | "read-write";
  }
  | ({
    id: string;
    kind: "json-project-map";
    source_relative_path: string;
    project_root_variable: string;
    project_root_prefix_variable?: string;
    access: "read-only" | "read-write";
  } & ProjectDiscoverySourceV1)
  | ({
    id: string;
    kind: "portfolio-root-map";
    source_relative_path: string;
    repository_mapping_relative_path?: string;
    project_root_variable: string;
    project_root_prefix_variable?: string;
    access: "read-only" | "read-write";
  } & ProjectDiscoverySourceV1);

export interface HostProfileV1 {
  schema: typeof HOST_PROFILE_SCHEMA;
  version: { major: 1; minor: 0 };
  id: string;
  variables: Array<{ name: string; kind: "string" | "absolute-path" | "url" | "volume-uuid"; required: boolean }>;
  secret_references: Array<{ name: string; required: boolean }>;
  preselected_modules: string[];
  required_routing_aliases: string[];
  project_discovery?: ProjectDiscoverySpecV1[];
}

export interface HostIdentityBindingV1 {
  platform: NodeJS.Platform;
  hardware_model: string;
  chip_model: string;
  architecture: string;
  user_id: number;
}

export interface HostBindingV1 {
  schema: typeof HOST_BINDING_SCHEMA;
  version: { major: 1; minor: 0 };
  profile_id: string;
  host_identity?: HostIdentityBindingV1;
  variables: Record<string, string>;
  secret_references: Record<string, KeychainSecretReference>;
  routing_aliases: RoutingAlias[];
  volume_bindings: Array<{ id: string; mount_path_variable: string; volume_uuid: string; volume_uuid_variable?: string }>;
}

export interface ModuleDescriptorV2 {
  schema: typeof MODULE_DESCRIPTOR_SCHEMA;
  version: { major: 2; minor: 0 };
  id: string;
  title: string;
  summary: string;
  dependencies: string[];
  capabilities: CapabilityRequirement[];
  preselection: "selected" | "available" | "off";
  admission_states: ["unavailable", "detected", "configured", "healthy", "enabled"];
}

export interface ProjectCapsuleV1 {
  schema: typeof PROJECT_CAPSULE_SCHEMA;
  version: { major: 1; minor: 0 };
  id: string;
  repository_identity: string;
  root_variable: string;
  relative_path: string;
  access: "read-only" | "read-write";
  approved: boolean;
}

export interface ProjectCandidateV1 extends ProjectCapsuleV1 {
  approved: false;
  discovery_source: string;
  display_name: string;
  path_present: boolean;
  selectable?: boolean;
  portfolio_id?: string;
  mapping_status?: "repository-mapped" | "work-mapped" | "folder-only" | "path-missing";
  work_ids?: string[];
  repository_candidates?: string[];
}

export interface OperationReceiptV1 {
  schema: typeof OPERATION_RECEIPT_SCHEMA;
  version: { major: 1; minor: 0 };
  operation_id: string;
  plan_digest: `sha256:${string}`;
  status: "planned" | "committed" | "failed";
  module_ids: string[];
  secret_reference_ids: string[];
  redacted_fields: string[];
  resolved_executables: Array<{ id: string; path: string; version: string }>;
  rollback_status: "not-required" | "completed" | "failed";
  failure_code?: string;
  started_at: string;
  finished_at: string;
}

export interface NineRouterGuidedSetupV1 {
  schema: typeof NINE_ROUTER_GUIDED_SETUP_SCHEMA;
  version: { major: 1; minor: 0 };
  providers: Array<{
    selection_id: string;
    provider: string;
    connection_name: string;
    credential_reference_id: string;
  }>;
  combos: Array<{
    alias: string;
    models: Array<Record<string, unknown>>;
  }>;
  required_aliases: string[];
  gateway_key: {
    name: string;
    secret_reference_id: string;
  };
}
