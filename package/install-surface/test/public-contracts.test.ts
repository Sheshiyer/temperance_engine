import { describe, expect, test } from "bun:test";

import {
  HOST_BINDING_SCHEMA,
  HOST_PROFILE_SCHEMA,
  MODULE_DESCRIPTOR_SCHEMA,
  OPERATION_RECEIPT_SCHEMA,
  PROJECT_CAPSULE_SCHEMA,
  type HostBindingV1,
  type HostProfileV1,
  type ModuleDescriptorV2,
  type OperationReceiptV1,
  type ProjectCapsuleV1,
} from "../src/onboarding/public-contracts.ts";
import {
  validateHostBindingV1,
  validateHostProfileV1,
  validateModuleDescriptorV2,
  validateOperationReceiptV1,
  validateProjectCapsuleV1,
} from "../src/onboarding/contract-schema.ts";

describe("V4 public contracts", () => {
  test("runtime-validates HostProfileV1 and HostBindingV1 separately", () => {
    const profile: HostProfileV1 = {
      schema: HOST_PROFILE_SCHEMA,
      version: { major: 1, minor: 0 },
      id: "personal-overlay",
      variables: [{ name: "PROJECT_ROOT", kind: "absolute-path", required: true }],
      secret_references: [{ name: "GATEWAY_KEY", required: true }],
      preselected_modules: ["provider.9router"],
      required_routing_aliases: ["coding.primary"],
    };
    const binding: HostBindingV1 = {
      schema: HOST_BINDING_SCHEMA,
      version: { major: 1, minor: 0 },
      profile_id: "personal-overlay",
      variables: { PROJECT_ROOT: "/example/projects" },
      secret_references: { GATEWAY_KEY: { store: "macos-keychain", service: "temperance.gateway", account: "primary" } },
      routing_aliases: [{ alias: "coding.primary", combo: "coding-primary" }],
      volume_bindings: [{ id: "projects", mount_path_variable: "PROJECT_VOLUME", volume_uuid: "EXAMPLE-UUID" }],
    };
    expect(validateHostProfileV1(profile)).toBe(true);
    expect(validateHostBindingV1(binding)).toBe(true);
    expect(validateHostBindingV1({ ...binding, secret_references: { GATEWAY_KEY: { value: "plaintext" } } })).toBe(false);
  });

  test("runtime-validates ModuleDescriptorV2 with the full admission state enum", () => {
    const descriptor: ModuleDescriptorV2 = {
      schema: MODULE_DESCRIPTOR_SCHEMA,
      version: { major: 2, minor: 0 },
      id: "integration.example",
      title: "Example",
      summary: "Example module",
      dependencies: [],
      capabilities: [],
      preselection: "available",
      admission_states: ["unavailable", "detected", "configured", "healthy", "enabled"],
    };
    expect(validateModuleDescriptorV2(descriptor)).toBe(true);
    expect(validateModuleDescriptorV2({ ...descriptor, admission_states: ["enabled"] })).toBe(false);
  });

  test("runtime-validates explicit project and operation receipts", () => {
    const capsule: ProjectCapsuleV1 = {
      schema: PROJECT_CAPSULE_SCHEMA,
      version: { major: 1, minor: 0 },
      id: "project.example",
      repository_identity: "https://example.invalid/project.git",
      root_variable: "PROJECT_ROOT",
      relative_path: "portfolio/project",
      access: "read-write",
      approved: true,
    };
    const receipt: OperationReceiptV1 = {
      schema: OPERATION_RECEIPT_SCHEMA,
      version: { major: 1, minor: 0 },
      operation_id: "operation.example",
      plan_digest: `sha256:${"a".repeat(64)}`,
      status: "committed",
      module_ids: ["provider.9router"],
      secret_reference_ids: ["GATEWAY_KEY"],
      redacted_fields: ["gateway_key"],
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
    };
    expect(validateProjectCapsuleV1(capsule)).toBe(true);
    expect(validateProjectCapsuleV1({ ...capsule, relative_path: "../escape" })).toBe(false);
    expect(validateOperationReceiptV1(receipt)).toBe(true);
    expect(validateOperationReceiptV1({ ...receipt, gateway_key: "leaked" })).toBe(false);
  });
});
