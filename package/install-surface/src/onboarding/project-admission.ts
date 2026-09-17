import type { ProjectCapsuleV1 } from "./public-contracts.ts";
import type { VolumeBindingProbe } from "./volume-adapter.ts";

export interface ProjectOperationAdmission {
  admitted: boolean;
  mode: "read" | "write";
  reason_code: "ADMITTED" | "PROJECT_NOT_APPROVED" | "PROJECT_READ_ONLY" | "VOLUME_NOT_VERIFIED";
}

/**
 * Project discovery never reaches this boundary. Only an approved capsule can
 * request access, and writes beneath a volume binding require a fresh verified
 * volume observation from the same operation.
 */
export function admitProjectOperation(input: {
  capsule: ProjectCapsuleV1;
  mode: "read" | "write";
  storage: { kind: "local" } | { kind: "volume"; probe: VolumeBindingProbe };
}): ProjectOperationAdmission {
  if (!input.capsule.approved) return { admitted: false, mode: input.mode, reason_code: "PROJECT_NOT_APPROVED" };
  if (input.mode === "write" && input.capsule.access !== "read-write") {
    return { admitted: false, mode: input.mode, reason_code: "PROJECT_READ_ONLY" };
  }
  if (input.storage.kind === "volume" && input.storage.probe.state !== "verified") {
    return { admitted: false, mode: input.mode, reason_code: "VOLUME_NOT_VERIFIED" };
  }
  return { admitted: true, mode: input.mode, reason_code: "ADMITTED" };
}
