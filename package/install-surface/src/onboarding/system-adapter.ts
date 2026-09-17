import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type {
  CapabilityProbe,
  CapabilityRequirement,
  OnboardingProbeAdapter,
  OnboardingProbeContext,
} from "./contracts.ts";

export interface PathInfo {
  exists: boolean;
  type: "file" | "directory" | "other";
  readable: boolean;
  writable: boolean;
  mode: number;
}

export interface OnboardingProbeIO {
  platform: NodeJS.Platform;
  which(executable: string): Promise<string | null>;
  execFile(file: string, args: readonly string[], options: { signal: AbortSignal }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  pathInfo(path: string): Promise<PathInfo>;
  fetch(url: string, options: { signal: AbortSignal; method: "HEAD" }): Promise<Response>;
}

const execFileAsync = promisify(execFileCallback);

async function nodePathInfo(path: string): Promise<PathInfo> {
  try {
    const metadata = await stat(path);
    const [readable, writable] = await Promise.all([
      access(path, constants.R_OK).then(() => true, () => false),
      access(path, constants.W_OK).then(() => true, () => false),
    ]);
    return {
      exists: true,
      type: metadata.isFile() ? "file" : metadata.isDirectory() ? "directory" : "other",
      readable,
      writable,
      mode: metadata.mode & 0o777,
    };
  } catch {
    return { exists: false, type: "other", readable: false, writable: false, mode: 0 };
  }
}

export const nodeOnboardingProbeIO: OnboardingProbeIO = {
  platform: process.platform,
  which: async (executable) => Bun.which(executable),
  execFile: async (file, args, options) => {
    try {
      const result = await execFileAsync(file, [...args], { signal: options.signal, encoding: "utf8" });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error: any) {
      return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", exitCode: typeof error.code === "number" ? error.code : 1 };
    }
  },
  pathInfo: nodePathInfo,
  fetch: (url, options) => fetch(url, options),
};

function available(capabilityId: string, evidence: string[]): CapabilityProbe {
  return { capability_id: capabilityId, available: true, reason_code: "AVAILABLE", evidence };
}

function unavailable(capabilityId: string, reason_code: CapabilityProbe["reason_code"], evidence: string[] = []): CapabilityProbe {
  return { capability_id: capabilityId, available: false, reason_code, evidence };
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function probeBinary(requirement: Extract<CapabilityRequirement, { kind: "binary" }>, context: OnboardingProbeContext, io: OnboardingProbeIO): Promise<CapabilityProbe> {
  const executable = await io.which(requirement.executable);
  if (!executable) return unavailable(requirement.id, "BINARY_MISSING");
  if (!requirement.version) return available(requirement.id, ["binary is present"]);
  const output = await io.execFile(executable, requirement.version.argv ?? ["--version"], { signal: context.signal });
  if (output.exitCode !== 0) return unavailable(requirement.id, "PROBE_FAILED", ["version command failed"]);
  const combined = `${output.stdout}\n${output.stderr}`;
  const versionPattern = requirement.version.pattern
    ? new RegExp(requirement.version.pattern)
    : new RegExp(`(?:^|[^0-9.])${escapePattern(requirement.version.exact)}(?:$|[^0-9.])`);
  return versionPattern.test(combined)
    ? available(requirement.id, ["binary is present", "exact version is installed"])
    : unavailable(requirement.id, "VERSION_MISMATCH", ["required exact version was not observed"]);
}

async function probeApplication(requirement: Extract<CapabilityRequirement, { kind: "application" }>, context: OnboardingProbeContext, io: OnboardingProbeIO): Promise<CapabilityProbe> {
  if (io.platform !== "darwin") return unavailable(requirement.id, "UNSUPPORTED_PLATFORM");
  const result = await io.execFile("mdfind", [`kMDItemCFBundleIdentifier == '${requirement.bundle_id}'`], { signal: context.signal });
  return result.exitCode === 0 && result.stdout.trim().length > 0
    ? available(requirement.id, ["application bundle is present"])
    : unavailable(requirement.id, "APPLICATION_MISSING");
}

async function probeMount(requirement: Extract<CapabilityRequirement, { kind: "mount" }>, context: OnboardingProbeContext, io: OnboardingProbeIO): Promise<CapabilityProbe> {
  const mountPath = context.profile.variables[requirement.mount_path_variable];
  if (!mountPath) return unavailable(requirement.id, "VARIABLE_MISSING");
  const relative = requirement.required_relative_path_variable
    ? context.profile.variables[requirement.required_relative_path_variable]
    : undefined;
  if (!isAbsolute(mountPath)) return unavailable(requirement.id, "VARIABLE_INVALID", ["mount path must be absolute"]);
  if (relative && (isAbsolute(relative) || relative.includes("\\") || relative.split("/").includes(".."))) {
    return unavailable(requirement.id, "VARIABLE_INVALID", ["mount-relative path is unsafe"]);
  }
  const mount = await io.pathInfo(mountPath);
  if (!mount.exists || mount.type !== "directory") return unavailable(requirement.id, "MOUNT_ABSENT");
  if (requirement.required_relative_path_variable) {
    if (!relative) return unavailable(requirement.id, "VARIABLE_MISSING");
    const requiredPath = await io.pathInfo(join(mountPath, relative));
    if (!requiredPath.exists) return unavailable(requirement.id, "PATH_MISSING", ["required mount-relative path is absent"]);
  }
  if (requirement.expected_uuid_variable && io.platform === "darwin") {
    const expected = context.profile.variables[requirement.expected_uuid_variable];
    if (!expected) return unavailable(requirement.id, "VARIABLE_MISSING");
    const result = await io.execFile("diskutil", ["info", mountPath], { signal: context.signal });
    const observed = result.stdout.match(/^\s*Volume UUID:\s*(\S+)\s*$/m)?.[1];
    if (result.exitCode !== 0 || !observed) return unavailable(requirement.id, "PROBE_FAILED", ["volume identity could not be read"]);
    if (observed !== expected) return unavailable(requirement.id, "MOUNT_UUID_MISMATCH", ["mounted volume identity differs"]);
  }
  return available(requirement.id, ["mount path is present", ...(requirement.expected_uuid_variable ? ["volume identity matches"] : [])]);
}

async function probePath(requirement: Extract<CapabilityRequirement, { kind: "path" }>, context: OnboardingProbeContext, io: OnboardingProbeIO): Promise<CapabilityProbe> {
  const path = context.profile.variables[requirement.path_variable];
  if (!path) return unavailable(requirement.id, "VARIABLE_MISSING");
  if (!isAbsolute(path)) return unavailable(requirement.id, "VARIABLE_INVALID", ["path must be absolute"]);
  const info = await io.pathInfo(path);
  if (!info.exists || info.type !== requirement.path_type) return unavailable(requirement.id, "PATH_MISSING");
  if (requirement.access === "readable" && !info.readable) return unavailable(requirement.id, "PATH_INACCESSIBLE");
  if (requirement.access === "writable" && !info.writable) return unavailable(requirement.id, "PATH_INACCESSIBLE");
  return available(requirement.id, ["configured path is available"]);
}

async function probeKeychain(requirement: Extract<CapabilityRequirement, { kind: "keychain-secret" }>, context: OnboardingProbeContext, io: OnboardingProbeIO): Promise<CapabilityProbe> {
  if (io.platform !== "darwin") return unavailable(requirement.id, "UNSUPPORTED_PLATFORM");
  const reference = context.profile.secret_references[requirement.secret_reference];
  if (!reference) return unavailable(requirement.id, "SECRET_REFERENCE_MISSING");
  const result = await io.execFile("security", ["find-generic-password", "-s", reference.service, "-a", reference.account], { signal: context.signal });
  return result.exitCode === 0
    ? available(requirement.id, ["keychain item is present"])
    : unavailable(requirement.id, "SECRET_UNAVAILABLE", ["keychain item is absent"]);
}

async function probeHttp(requirement: Extract<CapabilityRequirement, { kind: "http-health" }>, context: OnboardingProbeContext, io: OnboardingProbeIO): Promise<CapabilityProbe> {
  const url = context.profile.variables[requirement.url_variable];
  if (!url) return unavailable(requirement.id, "VARIABLE_MISSING");
  try {
    const response = await io.fetch(url, { signal: context.signal, method: "HEAD" });
    return response.ok ? available(requirement.id, ["health endpoint responded"]): unavailable(requirement.id, "HTTP_UNAVAILABLE", ["health endpoint returned a failure status"]);
  } catch {
    return unavailable(requirement.id, "HTTP_UNAVAILABLE", ["health endpoint did not respond"]);
  }
}

async function probeNineRouterManagement(requirement: Extract<CapabilityRequirement, { kind: "9router-management" }>, context: OnboardingProbeContext, io: OnboardingProbeIO): Promise<CapabilityProbe> {
  const dataDirectory = context.profile.variables[requirement.data_dir_variable];
  if (!dataDirectory) return unavailable(requirement.id, "VARIABLE_MISSING");
  if (!isAbsolute(dataDirectory)) return unavailable(requirement.id, "VARIABLE_INVALID", ["9router DATA_DIR must be absolute"]);
  const dataInfo = await io.pathInfo(dataDirectory);
  if (!dataInfo.exists || dataInfo.type !== "directory") return unavailable(requirement.id, "PATH_MISSING", ["9router DATA_DIR is absent"]);
  const machine = await io.pathInfo(join(dataDirectory, "machine-id"));
  const secret = await io.pathInfo(join(dataDirectory, "auth", "cli-secret"));
  if (!machine.exists || machine.type !== "file" || !secret.exists || secret.type !== "file") {
    return unavailable(requirement.id, "PATH_MISSING", ["9router derived-auth metadata is incomplete"]);
  }
  if ((secret.mode & 0o777) !== 0o600) return unavailable(requirement.id, "PATH_INACCESSIBLE", ["9router CLI secret metadata has an unsafe mode"]);
  return available(requirement.id, ["9router derived-auth metadata is present", "9router CLI secret mode is 0600"]);
}

export function createSystemProbeAdapter(options: { io?: OnboardingProbeIO } = {}): OnboardingProbeAdapter {
  const io = options.io ?? nodeOnboardingProbeIO;
  return {
    probe: async (requirement, context) => {
      try {
        switch (requirement.kind) {
          case "binary": return await probeBinary(requirement, context, io);
          case "application": return await probeApplication(requirement, context, io);
          case "mount": return await probeMount(requirement, context, io);
          case "path": return await probePath(requirement, context, io);
          case "keychain-secret": return await probeKeychain(requirement, context, io);
          case "routing-alias": return context.profile.routing_aliases.some((alias) => alias.alias === requirement.alias)
            ? available(requirement.id, ["routing alias is declared"])
            : unavailable(requirement.id, "ROUTING_ALIAS_MISSING");
          case "http-health": return await probeHttp(requirement, context, io);
          case "9router-management": return await probeNineRouterManagement(requirement, context, io);
        }
      } catch {
        return unavailable(requirement.id, "PROBE_FAILED", ["capability probe failed"]);
      }
    },
    now: () => new Date(),
  };
}
