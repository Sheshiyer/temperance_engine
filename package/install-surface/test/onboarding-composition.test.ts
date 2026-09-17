import { describe, expect, test } from "bun:test";

import { composeOnboardingProfile } from "../src/onboarding/composition.ts";
import type { HostBindingV1, HostProfileV1, ProjectCapsuleV1 } from "../src/onboarding/public-contracts.ts";

const profile: HostProfileV1 = {
  schema: "temperance.host-profile.v1",
  version: { major: 1, minor: 0 },
  id: "personal-overlay",
  variables: [
    { name: "PROJECT_ROOT", kind: "absolute-path", required: true },
    { name: "MADARA_ROOT", kind: "absolute-path", required: false },
    { name: "MADARA_UUID", kind: "volume-uuid", required: false },
  ],
  secret_references: [{ name: "GATEWAY_KEY", required: true }],
  preselected_modules: ["provider.9router"],
  required_routing_aliases: ["noesis-build"],
};

const binding: HostBindingV1 = {
  schema: "temperance.host-binding.v1",
  version: { major: 1, minor: 0 },
  profile_id: "personal-overlay",
  variables: { PROJECT_ROOT: "/private/projects", MADARA_ROOT: "/Volumes/madara" },
  secret_references: { GATEWAY_KEY: { store: "macos-keychain", service: "temperance.gateway", account: "primary" } },
  routing_aliases: [{ alias: "noesis-build", combo: "noesis-build" }],
  volume_bindings: [{ id: "madara", mount_path_variable: "MADARA_ROOT", volume_uuid_variable: "MADARA_UUID", volume_uuid: "ABCD-1234" }],
};

const capsule: ProjectCapsuleV1 = {
  schema: "temperance.project-capsule.v1",
  version: { major: 1, minor: 0 },
  id: "project.cambium",
  repository_identity: "github.com/example/cambium",
  root_variable: "PROJECT_ROOT",
  relative_path: "cambium",
  access: "read-only",
  approved: true,
};

describe("hand-in-glove profile composition", () => {
  test("joins portable declarations to private bindings without adding secret values", () => {
    const composed = composeOnboardingProfile(profile, binding, { projectCapsules: [capsule] });
    expect(composed.variables).toEqual({ PROJECT_ROOT: "/private/projects", MADARA_ROOT: "/Volumes/madara", MADARA_UUID: "ABCD-1234" });
    expect(composed.secret_references).toEqual(binding.secret_references);
    expect(composed.routing_aliases).toEqual([{ alias: "noesis-build", combo: "noesis-build" }]);
    expect(composed.project_enrollments).toEqual([{ id: "project.cambium", root_variable: "PROJECT_ROOT", approved: true, access: "read-only" }]);
    expect(JSON.stringify(composed)).not.toContain("secret-value");
  });

  test("rejects profile drift, undeclared bindings, missing requirements, and unsafe paths", () => {
    expect(() => composeOnboardingProfile(profile, { ...binding, profile_id: "other" })).toThrow("HOST_BINDING_PROFILE_MISMATCH");
    expect(() => composeOnboardingProfile(profile, { ...binding, variables: { ...binding.variables, UNKNOWN_ROOT: "/tmp" } })).toThrow("HOST_BINDING_VARIABLE_UNDECLARED");
    expect(() => composeOnboardingProfile(profile, { ...binding, secret_references: {} })).toThrow("HOST_BINDING_REQUIRED_SECRET_MISSING");
    expect(() => composeOnboardingProfile(profile, { ...binding, variables: { ...binding.variables, PROJECT_ROOT: "relative/path" } })).toThrow("HOST_BINDING_PATH_INVALID");
    expect(() => composeOnboardingProfile(profile, { ...binding, routing_aliases: [] })).toThrow("HOST_BINDING_REQUIRED_ALIAS_MISSING");
  });

  test("requires an explicit UUID variable when multiple volume identities are declared", () => {
    const ambiguous: HostProfileV1 = {
      ...profile,
      variables: [...profile.variables, { name: "SECOND_UUID", kind: "volume-uuid", required: false }],
    };
    const withoutVariable: HostBindingV1 = {
      ...binding,
      volume_bindings: [{ id: "madara", mount_path_variable: "MADARA_ROOT", volume_uuid: "ABCD-1234" }],
    };
    expect(() => composeOnboardingProfile(ambiguous, withoutVariable)).toThrow("HOST_BINDING_VOLUME_UUID_VARIABLE_AMBIGUOUS");
  });
});
