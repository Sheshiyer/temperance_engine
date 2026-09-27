import type { HostIdentityBindingV1 } from "./public-contracts.ts";

function safeHostValue(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0
    && normalized.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9 (),._+-]*$/u.test(normalized)
    ? normalized
    : "unknown";
}

function sysctlValue(name: string): string {
  const executable = Bun.which("sysctl");
  if (!executable) return "unknown";
  const result = Bun.spawnSync([executable, "-n", name], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? safeHostValue(result.stdout.toString()) : "unknown";
}

export function observeHostIdentity(
  platform: NodeJS.Platform = process.platform,
): Omit<HostIdentityBindingV1, "user_id"> & { user_id: number | null } {
  return {
    platform,
    hardware_model: platform === "darwin" ? sysctlValue("hw.model") : "unknown",
    chip_model: platform === "darwin" ? sysctlValue("machdep.cpu.brand_string") : "unknown",
    architecture: safeHostValue(process.arch),
    user_id: process.getuid?.() ?? null,
  };
}

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
