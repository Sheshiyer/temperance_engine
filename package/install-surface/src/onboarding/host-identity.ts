import type { HostIdentityBindingV1 } from "./public-contracts.ts";

export function hostIdentityMatches(
  expected: HostIdentityBindingV1,
  observed: Omit<HostIdentityBindingV1, "user_id"> & { user_id: number | null },
): boolean {
  return expected.platform === observed.platform
    && expected.hardware_model === observed.hardware_model
    && expected.chip_model === observed.chip_model
    && expected.architecture === observed.architecture
    && expected.user_id === observed.user_id;
}
