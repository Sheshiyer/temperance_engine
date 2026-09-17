import { describe, expect, test } from "bun:test";

import { probeVolumeBinding, type VolumeProbeIO } from "../src/onboarding/volume-adapter.ts";

const input = { mount_path: "/Volumes/madara", expected_uuid: "EXPECTED-UUID", required_subtree: "2026/Projects/thoughtseed" };
function io(overrides: Partial<VolumeProbeIO> = {}): VolumeProbeIO {
  return {
    platform: "darwin",
    directoryExists: async () => true,
    volumeUuid: async () => "EXPECTED-UUID",
    ...overrides,
  };
}

describe("external volume binding", () => {
  test("classifies an unmounted volume as absent", async () => {
    expect(await probeVolumeBinding(input, io({ directoryExists: async () => false }))).toEqual({
      state: "absent", reason: "MOUNT_ABSENT", observed_uuid: null, canonical_root_present: false,
    });
  });

  test("classifies a present but unenrolled identity as unverified", async () => {
    expect((await probeVolumeBinding({ ...input, expected_uuid: undefined }, io())).state).toBe("unverified");
  });

  test("requires UUID equality and the canonical subtree for verification", async () => {
    expect((await probeVolumeBinding(input, io())).state).toBe("verified");
    expect(await probeVolumeBinding(input, io({ volumeUuid: async () => "SAME-LABEL-DIFFERENT-UUID" }))).toMatchObject({ state: "drifted", reason: "IDENTITY_MISMATCH" });
    let calls = 0;
    expect(await probeVolumeBinding(input, io({ directoryExists: async () => ++calls === 1 }))).toMatchObject({ state: "drifted", reason: "SUBTREE_MISSING" });
  });

  test("classifies the adapter as unsupported off macOS", async () => {
    expect((await probeVolumeBinding(input, io({ platform: "linux" }))).state).toBe("unsupported");
  });
});
