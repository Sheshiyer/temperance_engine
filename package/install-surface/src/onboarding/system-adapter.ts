import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { createConnection } from "node:net";
import { promisify } from "node:util";

import type {
  CapabilityProbe,
  CapabilityRequirement,
  OnboardingProbeAdapter,
  OnboardingProbeContext,
} from "./contracts.ts";
import { NineRouterApiClient, NineRouterApiError } from "./nine-router-api.ts";

/** Membership inspection only: no write methods or inference are available here. */
export type OnboardingRouterApi = Pick<NineRouterApiClient, "readCatalog" | "readCombo" | "readAvailableModels">;
export type OnboardingRouterApiFactory = (options: { dataDirectory: string; baseUrl: string }) => OnboardingRouterApi;

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
  fetch(url: string, options: { signal: AbortSignal; method: "HEAD" | "GET"; redirect?: "manual" }): Promise<Response>;
  /** Resolves true when a TCP connection to host:port succeeds. Defaults to node:net. */
  tcpConnect?(host: string, port: number, options: { signal: AbortSignal; timeoutMs: number }): Promise<boolean>;
  /** Numeric user id for the launchd gui domain. Defaults to process.getuid(). */
  uid?: number;
  /** Reads an environment variable for an environment secret reference. Defaults to process.env. */
  env?(name: string): string | undefined;
}

const execFileAsync = promisify(execFileCallback);
const TCP_PROBE_TIMEOUT_MS = 2_000;

function nodeTcpConnect(host: string, port: number, options: { signal: AbortSignal; timeoutMs: number }): Promise<boolean> {
  return new Promise((resolve) => {
    if (options.signal.aborted) return resolve(false);
    const socket = createConnection({ host, port });
    const done = (result: boolean): void => {
      socket.destroy();
      options.signal.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = (): void => done(false);
    socket.setTimeout(options.timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    options.signal.addEventListener("abort", abort, { once: true });
  });
}

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
  tcpConnect: nodeTcpConnect,
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
  const boundExecutable = requirement.executable_variable
    ? context.profile.variables[requirement.executable_variable]
    : undefined;
  if (boundExecutable && !isAbsolute(boundExecutable)) {
    return unavailable(requirement.id, "VARIABLE_INVALID", ["bound executable path must be absolute"]);
  }
  const executable = await io.which(boundExecutable ?? requirement.executable);
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
  const reference = context.profile.secret_references[requirement.secret_reference];
  // An environment reference works on any host: only its presence is checked, never its value.
  if (reference?.store === "environment") {
    const value = (io.env ?? ((name: string) => process.env[name]))(reference.variable);
    return value
      ? available(requirement.id, ["environment secret is set"])
      : unavailable(requirement.id, "SECRET_UNAVAILABLE", ["environment secret is not set"]);
  }
  if (io.platform !== "darwin") return unavailable(requirement.id, "UNSUPPORTED_PLATFORM");
  if (!reference) return unavailable(requirement.id, "SECRET_REFERENCE_MISSING");
  const result = await io.execFile("security", ["find-generic-password", "-s", reference.service, "-a", reference.account], { signal: context.signal });
  return result.exitCode === 0
    ? available(requirement.id, ["keychain item is present"])
    : unavailable(requirement.id, "SECRET_UNAVAILABLE", ["keychain item is absent"]);
}

/** Cloudflare edge statuses meaning "the hostname is published but its tunnel or origin is down". */
const ORIGIN_OFFLINE_STATUSES = new Set([502, 521, 522, 523, 530]);
const HTTP_PROBE_TIMEOUT_MS = 5_000;

async function probeHttp(requirement: Extract<CapabilityRequirement, { kind: "http-health" }>, context: OnboardingProbeContext, io: OnboardingProbeIO): Promise<CapabilityProbe> {
  const raw = context.profile.variables[requirement.url_variable];
  if (!raw) return unavailable(requirement.id, "VARIABLE_MISSING");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return unavailable(requirement.id, "VARIABLE_INVALID", ["health URL is not a valid URL"]);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return unavailable(requirement.id, "VARIABLE_INVALID", ["health URL must use http or https"]);
  let response: Response;
  try {
    // Never follow redirects: an identity proxy's login page would otherwise look like a healthy 200.
    response = await io.fetch(url.href, {
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(HTTP_PROBE_TIMEOUT_MS)]),
      method: requirement.method ?? "HEAD",
      redirect: "manual",
    });
  } catch {
    return unavailable(requirement.id, "HTTP_UNAVAILABLE", ["health endpoint did not respond"]);
  }
  try {
    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = response.headers.get("location");
      const target = location ? new URL(location, url) : undefined;
      // A redirect to another host comes from the edge, not the origin, so it proves nothing about the origin.
      if (!target || target.host !== url.host) {
        return unavailable(requirement.id, "ORIGIN_UNVERIFIED", [`redirected to another host (${status}); origin unverified`]);
      }
    }
    const accepted = requirement.accept_status ? requirement.accept_status.includes(status) : response.ok;
    if (accepted) return available(requirement.id, [`health endpoint responded (${status})`]);
    if (ORIGIN_OFFLINE_STATUSES.has(status)) return unavailable(requirement.id, "ORIGIN_OFFLINE", [`edge reported origin unreachable (${status})`]);
    return unavailable(requirement.id, "HTTP_UNAVAILABLE", [`health endpoint returned an unexpected status (${status})`]);
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }
}

async function probeTcpPort(requirement: Extract<CapabilityRequirement, { kind: "tcp-port" }>, context: OnboardingProbeContext, io: OnboardingProbeIO): Promise<CapabilityProbe> {
  const host = requirement.host_variable ? context.profile.variables[requirement.host_variable] : "127.0.0.1";
  if (!host) return unavailable(requirement.id, "VARIABLE_MISSING");
  const override = requirement.port_variable ? context.profile.variables[requirement.port_variable] : undefined;
  if (override !== undefined && !/^\d{1,5}$/.test(override)) return unavailable(requirement.id, "VARIABLE_INVALID", ["port override is not a valid port"]);
  const port = override === undefined ? requirement.port : Number(override);
  if (port < 1 || port > 65535) return unavailable(requirement.id, "VARIABLE_INVALID", ["port override is not a valid port"]);
  const connect = io.tcpConnect ?? nodeTcpConnect;
  return await connect(host, port, { signal: context.signal, timeoutMs: TCP_PROBE_TIMEOUT_MS })
    ? available(requirement.id, [`port ${port} accepts connections`])
    : unavailable(requirement.id, "PORT_CLOSED", [`port ${port} refused or timed out`]);
}

async function probeLaunchAgent(requirement: Extract<CapabilityRequirement, { kind: "launch-agent" }>, context: OnboardingProbeContext, io: OnboardingProbeIO): Promise<CapabilityProbe> {
  if (io.platform !== "darwin") return unavailable(requirement.id, "UNSUPPORTED_PLATFORM");
  const label = requirement.label ?? (requirement.label_variable ? context.profile.variables[requirement.label_variable] : undefined);
  if (!label) return unavailable(requirement.id, "VARIABLE_MISSING");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(label)) return unavailable(requirement.id, "VARIABLE_INVALID", ["LaunchAgent label is not a valid label"]);
  const uid = io.uid ?? process.getuid?.();
  if (uid === undefined) return unavailable(requirement.id, "PROBE_FAILED", ["user id is unavailable"]);
  const result = await io.execFile("launchctl", ["print", `gui/${uid}/${label}`], { signal: context.signal });
  if (result.exitCode !== 0) return unavailable(requirement.id, "LAUNCH_AGENT_ABSENT", ["LaunchAgent is not loaded"]);
  // Evidence carries the state only; the label can be private, so it stays out of the output.
  // The service's own state is the single-tab line; deeper-indented `state =` lines belong to nested sections.
  const state = result.stdout.match(/^\tstate = (.+?)\s*$/m)?.[1];
  return state === "running"
    ? available(requirement.id, ["LaunchAgent is running"])
    : unavailable(requirement.id, "LAUNCH_AGENT_STOPPED", [`LaunchAgent state is ${state ?? "unknown"}`]);
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

async function withProbeSignal<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("ROUTING_PROBE_CANCELLED"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([read(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function probeRoutingAlias(
  requirement: Extract<CapabilityRequirement, { kind: "routing-alias" }>,
  context: OnboardingProbeContext,
  routerApiFactory: OnboardingRouterApiFactory,
): Promise<CapabilityProbe> {
  const mappings = context.profile.routing_aliases.filter(({ alias }) => alias === requirement.alias);
  if (mappings.length === 0) return unavailable(requirement.id, "ROUTING_ALIAS_MISSING");
  if (mappings.length !== 1) return unavailable(requirement.id, "ROUTING_ALIAS_AMBIGUOUS");
  const dataDirectory = context.profile.variables.NINE_ROUTER_DATA_DIR;
  const healthUrl = context.profile.variables.NINE_ROUTER_HEALTH_URL;
  if (!dataDirectory || !healthUrl) return unavailable(requirement.id, "VARIABLE_MISSING", ["routing inspection requires NINE_ROUTER_DATA_DIR and NINE_ROUTER_HEALTH_URL"]);
  if (!isAbsolute(dataDirectory) || normalize(dataDirectory) !== dataDirectory || dataDirectory.length <= 1 || dataDirectory.includes("\0")) {
    return unavailable(requirement.id, "VARIABLE_INVALID", ["9router DATA_DIR must be a canonical absolute path"]);
  }
  let endpoint: URL;
  try { endpoint = new URL(healthUrl); } catch {
    return unavailable(requirement.id, "VARIABLE_INVALID", ["9router health URL is invalid"]);
  }
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname.replace(/^\[|\]$/gu, ""))
    || endpoint.port !== "20128" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    return unavailable(requirement.id, "VARIABLE_INVALID", ["9router health URL must use the configured loopback management service"]);
  }
  try {
    context.signal.throwIfAborted();
    const api = routerApiFactory({ dataDirectory, baseUrl: endpoint.origin });
    // Do not cache this result across probes: provider and combo state can change.
    const [catalog, models] = await withProbeSignal(context.signal, () => Promise.all([api.readCatalog(), api.readAvailableModels()]));
    const matches = catalog.combos.filter(({ alias }) => alias === mappings[0]!.combo);
    if (matches.length === 0) return unavailable(requirement.id, "ROUTING_COMBO_MISSING", ["mapped combo was not found in the live catalog"]);
    if (matches.length !== 1) return unavailable(requirement.id, "ROUTING_COMBO_AMBIGUOUS", ["mapped combo name is not unique in the live catalog"]);
    const summary = matches[0]!;
    if (catalog.combos.filter(({ id }) => id === summary.id).length !== 1) {
      return unavailable(requirement.id, "ROUTING_RESPONSE_INVALID", ["live combo identity is ambiguous"]);
    }
    const detail = await withProbeSignal(context.signal, () => api.readCombo(summary.id));
    if (detail.id !== summary.id || detail.alias !== mappings[0]!.combo || detail.models.length !== summary.model_count) {
      return unavailable(requirement.id, "ROUTING_COMBO_CHANGED", ["live combo detail does not match its catalog entry"]);
    }
    if (detail.models.length === 0) return unavailable(requirement.id, "ROUTING_COMBO_EMPTY", ["mapped combo has no model members"]);
    if (new Set(detail.models).size !== detail.models.length || new Set(models.map(({ id }) => id)).size !== models.length) {
      return unavailable(requirement.id, "ROUTING_RESPONSE_INVALID", ["live model membership is ambiguous"]);
    }
    const comboIds = new Set([...catalog.combos.map(({ alias }) => alias), ...models.filter(({ kind }) => kind === "combo").map(({ id }) => id)]);
    if (detail.models.some((id) => comboIds.has(id))) return unavailable(requirement.id, "ROUTING_MODEL_NESTED", ["mapped combo contains another combo rather than a provider model"]);
    const providerIds = new Set(models.filter(({ kind }) => kind === "provider").map(({ id }) => id));
    if (detail.models.some((id) => !providerIds.has(id))) return unavailable(requirement.id, "ROUTING_MODEL_UNAVAILABLE", ["mapped combo contains a member absent from the live provider-model catalog"]);
    return available(requirement.id, [
      "live routing alias and provider-model membership verified",
      "catalog membership only; context, quota, tool use and inference health are not verified",
    ]);
  } catch (error) {
    if (context.signal.aborted) return unavailable(requirement.id, "PROBE_FAILED", ["routing inspection was cancelled"]);
    // Never copy exception messages, provider names, URLs, or response bodies into evidence.
    if (error instanceof NineRouterApiError) {
      if (["NINE_ROUTER_AUTH_METADATA_MISSING", "NINE_ROUTER_AUTH_METADATA_INVALID", "NINE_ROUTER_CLI_SECRET_MODE_UNSAFE", "NINE_ROUTER_API_HTTP_401", "NINE_ROUTER_API_HTTP_403"].includes(error.code)) {
        return unavailable(requirement.id, "ROUTING_AUTH_UNAVAILABLE", ["9router management authentication is unavailable"]);
      }
      if (error.code.startsWith("NINE_ROUTER_RESPONSE_")) return unavailable(requirement.id, "ROUTING_RESPONSE_INVALID", ["9router returned an unusable catalog response"]);
    }
    return unavailable(requirement.id, "ROUTING_API_UNAVAILABLE", ["live routing membership could not be inspected"]);
  }
}

export function createSystemProbeAdapter(options: { io?: OnboardingProbeIO; routerApiFactory?: OnboardingRouterApiFactory } = {}): OnboardingProbeAdapter {
  const io = options.io ?? nodeOnboardingProbeIO;
  const routerApiFactory = options.routerApiFactory ?? ((config) => new NineRouterApiClient(config));
  return {
    probe: async (requirement, context) => {
      try {
        switch (requirement.kind) {
          case "binary": return await probeBinary(requirement, context, io);
          case "application": return await probeApplication(requirement, context, io);
          case "mount": return await probeMount(requirement, context, io);
          case "path": return await probePath(requirement, context, io);
          case "keychain-secret": return await probeKeychain(requirement, context, io);
          case "routing-alias": return await probeRoutingAlias(requirement, context, routerApiFactory);
          case "http-health": return await probeHttp(requirement, context, io);
          case "tcp-port": return await probeTcpPort(requirement, context, io);
          case "launch-agent": return await probeLaunchAgent(requirement, context, io);
          case "9router-management": return await probeNineRouterManagement(requirement, context, io);
        }
      } catch {
        return unavailable(requirement.id, "PROBE_FAILED", ["capability probe failed"]);
      }
    },
    now: () => new Date(),
  };
}
