import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, link, lstat, mkdir, open, readFile, realpath, rm, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";

import {
  createNineRouterLaunchAgent,
  renderNineRouterLaunchAgentPlist,
} from "../install-surface/src/onboarding/nine-router-launch-agent.ts";
import { V4CutoverExecutionError } from "./v4-cutover-executor.ts";
import {
  type PortableV4ReplacementServices,
  type PortableV4ServiceInput,
  type PortableV4ServiceVerification,
} from "./v4-portable-replacement.ts";
import { ROUTER_VERSION } from "./v4-cutover-plan.ts";

const LABEL = "com.temperance.engine.9router" as const;
const PORT = 20128 as const;

export interface MacOsV4ServiceCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface MacOsV4ReplacementServicesIO {
  platform: NodeJS.Platform;
  exec(argv: readonly string[], signal: AbortSignal): Promise<MacOsV4ServiceCommandResult>;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export interface MacOsV4DoctorProbe {
  run(input: PortableV4ServiceInput, signal: AbortSignal): Promise<boolean>;
}

export interface MacOsV4ReplacementServicesOptions {
  launchAgentsDirectory: string;
  runtimeRoot: string;
  dataDirectory: string;
  logDirectory: string;
  envExecutable: string;
  nodeExecutable: string;
  executablePath: string;
  doctor: MacOsV4DoctorProbe;
  io?: MacOsV4ReplacementServicesIO;
  uid?: number;
  launchctlExecutable?: string;
  lsofExecutable?: string;
  psExecutable?: string;
  listenerAttempts?: number;
  pollIntervalMs?: number;
}

interface ListenerObservation {
  pid: number;
  process: string;
  name: string;
}

function canonicalAbsolute(value: string): boolean {
  return value.length > 1 && isAbsolute(value) && normalize(value) === value && !value.includes("\0");
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

function exists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST");
}

function safeInteger(value: string): number | undefined {
  return /^\d+$/u.test(value.trim()) ? Number.parseInt(value.trim(), 10) : undefined;
}

function parseServicePid(output: string): number | undefined {
  const match = output.match(/(?:^|\n)\s*pid\s*=\s*(\d+)\s*(?:\n|$)/u);
  return match?.[1] ? safeInteger(match[1]) : undefined;
}

function parseListeners(output: string): ListenerObservation[] {
  const listeners: ListenerObservation[] = [];
  let current: Partial<ListenerObservation> | undefined;
  const flush = (): void => {
    if (current?.pid !== undefined && current.process && current.name) listeners.push(current as ListenerObservation);
  };
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith("p")) {
      flush();
      current = { pid: safeInteger(line.slice(1)) };
    } else if (line.startsWith("c") && current) {
      current.process = line.slice(1);
    } else if (line.startsWith("n") && current) {
      current.name = line.slice(1);
    }
  }
  flush();
  return listeners;
}

const nodeMacOsV4ReplacementServicesIO: MacOsV4ReplacementServicesIO = Object.freeze({
  platform: process.platform,
  exec: async (argv: readonly string[], signal: AbortSignal) => {
    const child = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe", signal });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  },
  wait: async (milliseconds: number, signal: AbortSignal) => {
    if (signal.aborted) throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_ABORTED");
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new V4CutoverExecutionError("REPLACEMENT_SERVICE_ABORTED"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, milliseconds);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  },
});

/** Exact macOS launchd ownership and readback for the fresh 9Router service. */
export class MacOsV4ReplacementServices implements PortableV4ReplacementServices {
  private readonly io: MacOsV4ReplacementServicesIO;
  private readonly launchctl: string;
  private readonly lsof: string;
  private readonly ps: string;
  private readonly env: string;
  private readonly uid: number;
  private readonly domain: string;
  private readonly plistPath: string;
  private readonly expectedInput: PortableV4ServiceInput;
  private readonly listenerAttempts: number;
  private readonly pollIntervalMs: number;

  constructor(private readonly options: MacOsV4ReplacementServicesOptions) {
    this.io = options.io ?? nodeMacOsV4ReplacementServicesIO;
    this.launchctl = options.launchctlExecutable ?? "/bin/launchctl";
    this.lsof = options.lsofExecutable ?? "/usr/sbin/lsof";
    this.ps = options.psExecutable ?? "/bin/ps";
    this.env = options.envExecutable;
    const processUid = process.getuid?.();
    this.uid = options.uid ?? processUid ?? 0;
    this.domain = `gui/${this.uid}`;
    this.plistPath = join(options.launchAgentsDirectory, `${LABEL}.plist`);
    this.listenerAttempts = options.listenerAttempts ?? 20;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.expectedInput = {
      node_executable: options.nodeExecutable,
      cli_entrypoint: join(options.runtimeRoot, "providers", "9router", "node_modules", "9router", "cli.js"),
      data_directory: options.dataDirectory,
      log_directory: options.logDirectory,
      path: options.executablePath,
    };
    const paths = [
      options.launchAgentsDirectory,
      options.runtimeRoot,
      options.dataDirectory,
      options.logDirectory,
      options.envExecutable,
      options.nodeExecutable,
      this.launchctl,
      this.lsof,
      this.ps,
      ...options.executablePath.split(":"),
    ];
    if (this.io.platform !== "darwin") throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_MACOS_REQUIRED");
    if (!paths.every(canonicalAbsolute)
      || !Number.isInteger(this.uid) || this.uid <= 0 || (processUid !== undefined && this.uid !== processUid)
      || !Number.isInteger(this.listenerAttempts) || this.listenerAttempts < 1 || this.listenerAttempts > 120
      || !Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 0 || this.pollIntervalMs > 5_000) {
      throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_OPTIONS_INVALID");
    }
  }

  private assertInput(input: PortableV4ServiceInput): void {
    for (const key of Object.keys(this.expectedInput) as Array<keyof PortableV4ServiceInput>) {
      if (input[key] !== this.expectedInput[key]) throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_INPUT_MISMATCH");
    }
  }

  private plist(input: PortableV4ServiceInput): string {
    this.assertInput(input);
    try {
      return renderNineRouterLaunchAgentPlist(createNineRouterLaunchAgent({ ...input, env_executable: this.env }));
    } catch {
      throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_PLIST_INVALID");
    }
  }

  private async assertDirectory(path: string, code: string, privateDirectory = false): Promise<void> {
    try {
      const stat = await lstat(path);
      const mode = stat.mode & 0o777;
      if (!stat.isDirectory()
        || stat.isSymbolicLink()
        || stat.uid !== this.uid
        || (mode & 0o022) !== 0
        || (privateDirectory && (mode & 0o077) !== 0)) {
        throw new V4CutoverExecutionError(code);
      }
    } catch (error) {
      if (error instanceof V4CutoverExecutionError) throw error;
      throw new V4CutoverExecutionError(code);
    }
  }

  private async assertResolvedExecutable(path: string, code: string): Promise<void> {
    try {
      const resolved = await realpath(path);
      const stat = await lstat(resolved);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new V4CutoverExecutionError(code);
      await access(resolved, constants.X_OK);
    } catch (error) {
      if (error instanceof V4CutoverExecutionError) throw error;
      throw new V4CutoverExecutionError(code);
    }
  }

  private async assertCli(path: string): Promise<void> {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || basename(path) !== "cli.js") {
        throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_CLI_INVALID");
      }
    } catch (error) {
      if (error instanceof V4CutoverExecutionError) throw error;
      throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_CLI_INVALID");
    }
  }

  private async publishPlist(contents: string): Promise<void> {
    await mkdir(this.options.launchAgentsDirectory, { recursive: true, mode: 0o700 });
    await this.assertDirectory(this.options.launchAgentsDirectory, "REPLACEMENT_SERVICE_LAUNCH_AGENTS_UNSAFE");
    try {
      const stat = await lstat(this.plistPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== this.uid) {
        throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_PLIST_UNSAFE");
      }
      if (await readFile(this.plistPath, "utf8") !== contents) {
        throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_PLIST_CONFLICT");
      }
      await chmod(this.plistPath, 0o644);
      return;
    } catch (error) {
      if (!missing(error)) throw error;
    }

    const temporary = join(this.options.launchAgentsDirectory, `.${LABEL}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(contents, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await chmod(temporary, 0o644);
      await link(temporary, this.plistPath);
      await unlink(temporary);
      const directory = await open(this.options.launchAgentsDirectory, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      try { await handle?.close(); } catch { /* Preserve publication failure. */ }
      try { await rm(temporary, { force: true }); } catch { /* Preserve publication failure. */ }
      if (exists(error)) throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_PLIST_CONFLICT");
      if (error instanceof V4CutoverExecutionError) throw error;
      throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_PLIST_WRITE_FAILED");
    }
  }

  private async assertInstalledPlist(input: PortableV4ServiceInput): Promise<void> {
    const expected = this.plist(input);
    try {
      const stat = await lstat(this.plistPath);
      const mode = stat.mode & 0o777;
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== this.uid || mode !== 0o644) {
        throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_PLIST_UNSAFE");
      }
      if (await readFile(this.plistPath, "utf8") !== expected) {
        throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_PLIST_DRIFTED");
      }
    } catch (error) {
      if (error instanceof V4CutoverExecutionError) throw error;
      throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_PLIST_UNAVAILABLE");
    }
  }

  private async command(argv: readonly string[], signal: AbortSignal, code: string): Promise<MacOsV4ServiceCommandResult> {
    try {
      const result = await this.io.exec(argv, signal);
      if (result.exitCode !== 0) throw new V4CutoverExecutionError(code);
      return result;
    } catch (error) {
      if (error instanceof V4CutoverExecutionError) throw error;
      throw new V4CutoverExecutionError(code);
    }
  }

  private async serviceStatus(signal: AbortSignal): Promise<{ loaded: boolean; output: string }> {
    const result = await this.io.exec([this.launchctl, "print", `${this.domain}/${LABEL}`], signal);
    if (result.exitCode === 0) return { loaded: true, output: result.stdout };
    if (result.exitCode === 113) return { loaded: false, output: "" };
    throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_STATUS_FAILED");
  }

  private async waitForLoaded(expected: boolean, signal: AbortSignal): Promise<string> {
    for (let attempt = 0; attempt < this.listenerAttempts; attempt += 1) {
      const status = await this.serviceStatus(signal);
      if (status.loaded === expected) return status.output;
      if (attempt + 1 < this.listenerAttempts) await this.io.wait(this.pollIntervalMs, signal);
    }
    throw new V4CutoverExecutionError(expected ? "REPLACEMENT_SERVICE_START_TIMEOUT" : "REPLACEMENT_SERVICE_STOP_TIMEOUT");
  }

  private assertServiceDefinition(output: string, input: PortableV4ServiceInput): void {
    const required = [
      this.env,
      "-i",
      `PATH=${input.path}`,
      `DATA_DIR=${input.data_directory}`,
      input.node_executable,
      input.cli_entrypoint,
      "127.0.0.1",
    ];
    if (required.some((value) => !output.includes(value)) || output.includes("0.0.0.0")) {
      throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_DEFINITION_DRIFTED");
    }
  }

  private async listener(signal: AbortSignal): Promise<ListenerObservation[]> {
    const result = await this.io.exec([
      this.lsof, "-nP", "-a", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-Fpcn",
    ], signal);
    if (result.exitCode === 0) return parseListeners(result.stdout);
    if (result.exitCode === 1) return [];
    throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_LISTENER_INSPECTION_FAILED");
  }

  private async descendantOf(pid: number, ancestor: number, signal: AbortSignal): Promise<boolean> {
    let current = pid;
    for (let depth = 0; depth < 16; depth += 1) {
      if (current === ancestor) return true;
      const result = await this.io.exec([this.ps, "-o", "ppid=", "-p", String(current)], signal);
      if (result.exitCode !== 0) return false;
      const parent = safeInteger(result.stdout);
      if (!parent || parent <= 1 || parent === current) return false;
      current = parent;
    }
    return false;
  }

  private async verifiedListener(servicePid: number, signal: AbortSignal): Promise<ListenerObservation> {
    for (let attempt = 0; attempt < this.listenerAttempts; attempt += 1) {
      const listeners = await this.listener(signal);
      if (listeners.length > 0) {
        const loopbackOnly = listeners.every(({ name }) => /^127\.0\.0\.1:20128(?:\s|$)/u.test(name));
        const owned = loopbackOnly && (await Promise.all(listeners.map(({ pid }) => this.descendantOf(pid, servicePid, signal)))).every(Boolean);
        if (!loopbackOnly) throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_LISTENER_EXPOSED");
        if (!owned) throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_LISTENER_OWNER_MISMATCH");
        const [first] = listeners;
        if (!first) throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_LISTENER_UNAVAILABLE");
        return first;
      }
      if (attempt + 1 < this.listenerAttempts) await this.io.wait(this.pollIntervalMs, signal);
    }
    throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_LISTENER_UNAVAILABLE");
  }

  private async routerVersion(input: PortableV4ServiceInput): Promise<string> {
    try {
      const value = JSON.parse(await readFile(join(dirname(input.cli_entrypoint), "package.json"), "utf8")) as { name?: unknown; version?: unknown };
      if (value.name === "9router" && typeof value.version === "string") return value.version;
    } catch { /* Normalize to one attestation failure below. */ }
    throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_ROUTER_ATTESTATION_FAILED");
  }

  async install(input: PortableV4ServiceInput, _signal: AbortSignal): Promise<void> {
    const contents = this.plist(input);
    await this.assertResolvedExecutable(this.env, "REPLACEMENT_SERVICE_ENV_INVALID");
    await this.assertResolvedExecutable(input.node_executable, "REPLACEMENT_SERVICE_NODE_INVALID");
    await this.assertCli(input.cli_entrypoint);
    await this.assertDirectory(input.data_directory, "REPLACEMENT_SERVICE_DATA_DIR_INVALID", true);
    await this.assertDirectory(input.log_directory, "REPLACEMENT_SERVICE_LOG_DIR_INVALID", true);
    await this.publishPlist(contents);
  }

  async activate(input: PortableV4ServiceInput, signal: AbortSignal): Promise<void> {
    await this.assertInstalledPlist(input);
    if ((await this.serviceStatus(signal)).loaded) {
      await this.command([this.launchctl, "bootout", `${this.domain}/${LABEL}`], signal, "REPLACEMENT_SERVICE_BOOTOUT_FAILED");
      await this.waitForLoaded(false, signal);
    }
    await this.command([this.launchctl, "bootstrap", this.domain, this.plistPath], signal, "REPLACEMENT_SERVICE_BOOTSTRAP_FAILED");
    this.assertServiceDefinition(await this.waitForLoaded(true, signal), input);
  }

  async verify(input: PortableV4ServiceInput, signal: AbortSignal): Promise<PortableV4ServiceVerification> {
    await this.assertInstalledPlist(input);
    const status = await this.serviceStatus(signal);
    const servicePid = status.loaded ? parseServicePid(status.output) : undefined;
    if (!servicePid) throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_PID_UNAVAILABLE");
    this.assertServiceDefinition(status.output, input);
    await this.verifiedListener(servicePid, signal);
    if (await this.routerVersion(input) !== ROUTER_VERSION) {
      throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_ROUTER_VERSION_MISMATCH");
    }
    return {
      router_version: ROUTER_VERSION,
      listener_owner: "replacement-9router",
      listener_port: PORT,
      loopback_only: true,
      doctor_passed: await this.options.doctor.run({ ...input }, signal),
    };
  }
}
