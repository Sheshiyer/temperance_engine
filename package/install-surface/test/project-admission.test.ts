import { describe, expect, test } from "bun:test";

import { admitProjectOperation } from "../src/onboarding/project-admission.ts";
import type { ProjectCapsuleV1 } from "../src/onboarding/public-contracts.ts";

const capsule: ProjectCapsuleV1 = {
  schema: "temperance.project-capsule.v1", version: { major: 1, minor: 0 }, id: "madara-project",
  repository_identity: "github.com/example/project", root_variable: "MADARA_MOUNT_ROOT",
  relative_path: "2026/Projects/thoughtseed/project", access: "read-write", approved: true,
};

describe("project operation admission", () => {
  test("blocks a Madara write when the volume is absent or drifted", () => {
    for (const state of ["absent", "drifted", "unverified"] as const) {
      expect(admitProjectOperation({
        capsule, mode: "write",
        storage: { kind: "volume", probe: { state, reason: state === "absent" ? "MOUNT_ABSENT" : state === "drifted" ? "SUBTREE_MISSING" : "IDENTITY_UNBOUND", observed_uuid: null, canonical_root_present: false } },
      })).toEqual({ admitted: false, mode: "write", reason_code: "VOLUME_NOT_VERIFIED" });
    }
  });

  test("admits a write only for an approved read-write capsule on a verified volume", () => {
    expect(admitProjectOperation({
      capsule, mode: "write",
      storage: { kind: "volume", probe: { state: "verified", reason: "VERIFIED", observed_uuid: "EXAMPLE-UUID", canonical_root_present: true } },
    })).toEqual({ admitted: true, mode: "write", reason_code: "ADMITTED" });
    expect(admitProjectOperation({ capsule: { ...capsule, approved: false }, mode: "read", storage: { kind: "local" } })).toMatchObject({ admitted: false, reason_code: "PROJECT_NOT_APPROVED" });
    expect(admitProjectOperation({ capsule: { ...capsule, access: "read-only" }, mode: "write", storage: { kind: "local" } })).toMatchObject({ admitted: false, reason_code: "PROJECT_READ_ONLY" });
  });
});
