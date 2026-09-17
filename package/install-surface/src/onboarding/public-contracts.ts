import type { CapabilityRequirement, KeychainSecretReference, RoutingAlias } from "./contracts.ts";

export const HOST_PROFILE_SCHEMA = "temperance.host-profile.v1" as const;
export const HOST_BINDING_SCHEMA = "temperance.host-binding.v1" as const;
export const MODULE_DESCRIPTOR_SCHEMA = "temperance.module-descriptor.v2" as const;
export const PROJECT_CAPSULE_SCHEMA = "temperance.project-capsule.v1" as const;
export const OPERATION_RECEIPT_SCHEMA = "temperance.operation-receipt.v1" as const;

export type ModuleAdmissionState = "unavailable" | "detected" | "configured" | "healthy" | "enabled";

export interface HostProfileV1 {
  schema: typeof HOST_PROFILE_SCHEMA;
  version: { major: 1; minor: 0 };
  id: string;
  variables: Array<{ name: string; kind: "string" | "absolute-path" | "url" | "volume-uuid"; required: boolean }>;
  secret_references: Array<{ name: string; required: boolean }>;
  preselected_modules: string[];
  required_routing_aliases: string[];
}

export interface HostBindingV1 {
  schema: typeof HOST_BINDING_SCHEMA;
  version: { major: 1; minor: 0 };
  profile_id: string;
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

export interface OperationReceiptV1 {
  schema: typeof OPERATION_RECEIPT_SCHEMA;
  version: { major: 1; minor: 0 };
  operation_id: string;
  plan_digest: `sha256:${string}`;
  status: "planned" | "committed" | "failed";
  module_ids: string[];
  secret_reference_ids: string[];
  redacted_fields: string[];
  started_at: string;
  finished_at: string;
}
