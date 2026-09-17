import { isAbsolute, join } from "node:path";

export type VolumeBindingState = "absent" | "unverified" | "verified" | "drifted" | "unsupported";
export interface VolumeBindingProbe {
  state: VolumeBindingState;
  reason: "MOUNT_ABSENT" | "IDENTITY_UNBOUND" | "IDENTITY_UNREADABLE" | "IDENTITY_MISMATCH" | "SUBTREE_MISSING" | "VERIFIED" | "UNSUPPORTED_PLATFORM" | "INPUT_INVALID";
  observed_uuid: string | null;
  canonical_root_present: boolean;
}
export interface VolumeProbeIO {
  platform: NodeJS.Platform;
  directoryExists(path: string): Promise<boolean>;
  volumeUuid(mountPath: string): Promise<string | null>;
}

function safeRelative(value: string): boolean {
  return value.length > 0 && !isAbsolute(value) && !value.includes("\\") && !value.includes("\0") && !value.split("/").includes("..");
}

export async function probeVolumeBinding(input: {
  mount_path: string;
  expected_uuid?: string;
  required_subtree: string;
}, io: VolumeProbeIO): Promise<VolumeBindingProbe> {
  if (!isAbsolute(input.mount_path) || !safeRelative(input.required_subtree)) {
    return { state: "unverified", reason: "INPUT_INVALID", observed_uuid: null, canonical_root_present: false };
  }
  if (io.platform !== "darwin") {
    return { state: "unsupported", reason: "UNSUPPORTED_PLATFORM", observed_uuid: null, canonical_root_present: false };
  }
  if (!await io.directoryExists(input.mount_path)) {
    return { state: "absent", reason: "MOUNT_ABSENT", observed_uuid: null, canonical_root_present: false };
  }
  const observedUuid = await io.volumeUuid(input.mount_path);
  if (!input.expected_uuid) {
    return { state: "unverified", reason: "IDENTITY_UNBOUND", observed_uuid: observedUuid, canonical_root_present: false };
  }
  if (!observedUuid) {
    return { state: "unverified", reason: "IDENTITY_UNREADABLE", observed_uuid: null, canonical_root_present: false };
  }
  if (observedUuid !== input.expected_uuid) {
    return { state: "drifted", reason: "IDENTITY_MISMATCH", observed_uuid: observedUuid, canonical_root_present: false };
  }
  const canonicalRootPresent = await io.directoryExists(join(input.mount_path, input.required_subtree));
  if (!canonicalRootPresent) {
    return { state: "drifted", reason: "SUBTREE_MISSING", observed_uuid: observedUuid, canonical_root_present: false };
  }
  return { state: "verified", reason: "VERIFIED", observed_uuid: observedUuid, canonical_root_present: true };
}
