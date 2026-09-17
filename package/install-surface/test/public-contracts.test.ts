import { describe, expect, test } from "bun:test";

import {
  HOST_BINDING_SCHEMA,
  HOST_PROFILE_SCHEMA,
  MODULE_DESCRIPTOR_SCHEMA,
  NINE_ROUTER_GUIDED_SETUP_SCHEMA,
  OPERATION_RECEIPT_SCHEMA,
  PROJECT_CAPSULE_SCHEMA,
  type HostBindingV1,
  type HostProfileV1,
  type ModuleDescriptorV2,
  type NineRouterGuidedSetupV1,
  type OperationReceiptV1,
  type ProjectCapsuleV1,
} from "../src/onboarding/public-contracts.ts";
import {
  validateHostBindingV1,
  validateHostProfileV1,
  validateModuleDescriptorV2,
  validateNineRouterGuidedSetupV1,
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
      host_identity: {
        platform: "darwin", hardware_model: "Mac16,11", chip_model: "Apple M4", architecture: "arm64", user_id: 501,
      },
      variables: { PROJECT_ROOT: "/example/projects" },
      secret_references: { GATEWAY_KEY: { store: "macos-keychain", service: "temperance.gateway", account: "primary" } },
      routing_aliases: [{ alias: "coding.primary", combo: "coding-primary" }],
      volume_bindings: [{ id: "projects", mount_path_variable: "PROJECT_VOLUME", volume_uuid: "EXAMPLE-UUID" }],
    };
    expect(validateHostProfileV1(profile)).toBe(true);
    expect(validateHostBindingV1(binding)).toBe(true);
    expect(validateHostBindingV1({ ...binding, host_identity: { ...binding.host_identity!, chip_model: "unknown" } })).toBe(false);
    expect(validateHostBindingV1({ ...binding, secret_references: { GATEWAY_KEY: { value: "plaintext" } } })).toBe(false);
  });

  test("validates portable project discovery declarations without host paths", () => {
    const profile: HostProfileV1 = {
      schema: HOST_PROFILE_SCHEMA,
      version: { major: 1, minor: 0 },
      id: "discovery-profile",
      variables: [
        { name: "MAP_ROOT", kind: "absolute-path", required: true },
        { name: "PROJECT_ROOT", kind: "absolute-path", required: true },
      ],
      secret_references: [], preselected_modules: [], required_routing_aliases: [],
      project_discovery: [{
        id: "project-map", kind: "json-project-map", source_root_variable: "MAP_ROOT",
        source_relative_path: "maps/projects.json", project_root_variable: "PROJECT_ROOT", access: "read-only",
      }],
    };
    expect(validateHostProfileV1(profile)).toBe(true);
    expect(validateHostProfileV1({
      ...profile,
      project_discovery: [{ ...profile.project_discovery![0], source_relative_path: "../outside.json" }],
    })).toBe(false);
    expect(validateHostProfileV1({
      ...profile,
      project_discovery: [{
        id: "portfolio-map",
        kind: "portfolio-root-map",
        source_root_variable: "MAP_ROOT",
        source_relative_path: "docs/portfolio-roots.v1.json",
        repository_mapping_relative_path: "docs/github-repository-mapping-action-queue.v1.json",
        project_root_variable: "PROJECT_ROOT",
        access: "read-only",
      }],
    })).toBe(true);
    expect(validateHostProfileV1({
      ...profile,
      project_discovery: [{
        id: "packaged-portfolio-map",
        kind: "portfolio-root-map",
        source_base: "host-profile-directory",
        source_relative_path: "project-maps/portfolio-roots.v1.json",
        project_root_variable: "PROJECT_ROOT",
        access: "read-only",
      }],
    })).toBe(true);
    expect(validateHostProfileV1({
      ...profile,
      project_discovery: [{
        id: "ambiguous-map",
        kind: "portfolio-root-map",
        source_base: "host-profile-directory",
        source_root_variable: "MAP_ROOT",
        source_relative_path: "project-maps/portfolio-roots.v1.json",
        project_root_variable: "PROJECT_ROOT",
        access: "read-only",
      }],
    })).toBe(false);
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
      resolved_executables: [{ id: "9router", path: "/managed/bin/9router", version: "0.5.75" }],
      rollback_status: "not-required",
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
    };
    expect(validateProjectCapsuleV1(capsule)).toBe(true);
    expect(validateProjectCapsuleV1({ ...capsule, relative_path: "../escape" })).toBe(false);
    expect(validateOperationReceiptV1(receipt)).toBe(true);
    expect(validateOperationReceiptV1({ ...receipt, gateway_key: "leaked" })).toBe(false);
  });

  test("runtime-validates private 9router setup without secret values", () => {
    const setup: NineRouterGuidedSetupV1 = {
      schema: NINE_ROUTER_GUIDED_SETUP_SCHEMA,
      version: { major: 1, minor: 0 },
      providers: [{ selection_id: "primary", provider: "anthropic", connection_name: "Primary", credential_reference_id: "PROVIDER_PRIMARY" }],
      combos: [{ alias: "noesis-build", models: ["anthropic/claude-build"] }],
      required_aliases: ["noesis-build"],
      gateway_key: { name: "Temperance", secret_reference_id: "GATEWAY_KEY" },
    };
    expect(validateNineRouterGuidedSetupV1(setup)).toBe(true);
    expect(validateNineRouterGuidedSetupV1({ ...setup, combos: [{ alias: "noesis-build", models: [{ provider: "anthropic" }] }] })).toBe(false);
    expect(validateNineRouterGuidedSetupV1({ ...setup, gateway_key: { ...setup.gateway_key, value: "forbidden" } })).toBe(false);
  });
});
