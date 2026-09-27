import type { Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative } from "node:path";

import type { KeychainSecretReference } from "../install-surface/src/onboarding/contracts.ts";
import {
  V4CutoverExecutionError,
  type V4CutoverAdapter,
  type V4CutoverVerification,
  type V4ReplacementProof,
} from "./v4-cutover-executor.ts";
import {
  MANAGED_LAUNCH_AGENT_LABELS,
  ROUTER_VERSION,
  type BinaryObservation,
  type LaunchAgentObservation,
  type ManagedPathObservation,
  type PortObservation,
} from "./v4-cutover-plan.ts";

export interface V4HostCommandResult {
  exitCode: number;
}

export interface V4MacOsHostIO {
  platform: NodeJS.Platform;
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  readFile(path: string): Promise<string>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  exec(argv: readonly string[], signal: AbortSignal): Promise<V4HostCommandResult>;
}

export interface V4ReplacementLifecycle {
  preflight(proof: V4ReplacementProof, signal: AbortSignal): Promise<void>;
  stage(proof: V4ReplacementProof, signal: AbortSignal): Promise<void>;
  promoteRuntime(path: ManagedPathObservation, proof: V4ReplacementProof, signal: AbortSignal): Promise<void>;
  installRouter(version: typeof ROUTER_VERSION, signal: AbortSignal): Promise<void>;
  installLaunchAgents(signal: AbortSignal): Promise<void>;
  activate(signal: AbortSignal): Promise<void>;
  verify(signal: AbortSignal): Promise<V4CutoverVerification>;
  discardStage(signal: AbortSignal): Promise<void>;
  recover(proof: V4ReplacementProof, signal: AbortSignal): Promise<void>;
}

export interface V4MacOsHostAdapterOptions {
  homeDirectory: string;
  launchAgentsDirectory: string;
  legacyCredentialReferences: Readonly<Record<string, KeychainSecretReference>>;
  replacement: V4ReplacementLifecycle;
  io?: V4MacOsHostIO;
  launchctlExecutable?: string;
  securityExecutable?: string;
  uid?: number;
}

const LEGACY_AGENT_LABELS = new Set([
  "com.9router.autostart",
  "com.temperance.engine.mini-gateway",
  "com.temperance.engine.omniroute",
  "space.thoughtseed.omniroute-env",
]);

function canonicalAbsolute(value: string): boolean {
  return value.length > 1 && isAbsolute(value) && normalize(value) === value && !value.includes("\0");
}

function contained(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

function validateReference(reference: KeychainSecretReference): void {
  if (reference.store !== "macos-keychain") throw new V4CutoverExecutionError("CUTOVER_KEYCHAIN_REFERENCE_INVALID");
  for (const value of [reference.service, reference.account]) {
    if (!value || value.length > 512 || value.trim() !== value || value.includes("\0") || /[\r\n]/u.test(value)) {
      throw new V4CutoverExecutionError("CUTOVER_KEYCHAIN_REFERENCE_INVALID");
    }
  }
}

const systemIO: V4MacOsHostIO = {
  platform: process.platform,
  lstat: async (path) => (await import("node:fs/promises")).lstat(path),
  realpath: async (path) => (await import("node:fs/promises")).realpath(path),
  readFile: async (path) => (await import("node:fs/promises")).readFile(path, "utf8"),
  rm: async (path, options) => { await (await import("node:fs/promises")).rm(path, options); },
  exec: async (argv, signal) => {
    const child = Bun.spawn([...argv], { stdin: "ignore", stdout: "ignore", stderr: "ignore", signal });
    return { exitCode: await child.exited };
  },
};

/** Mac-only destructive boundary; portable installation remains delegated. */
export class MacOsV4CutoverAdapter implements V4CutoverAdapter {
  private readonly io: V4MacOsHostIO;
  private readonly home: string;
  private readonly launchAgents: string;
  private readonly launchctl: string;
  private readonly security: string;
  private readonly domain: string;
  private readonly stoppedAgents = new Map<string, string>();

  constructor(private readonly options: V4MacOsHostAdapterOptions) {
    this.io = options.io ?? systemIO;
    this.home = options.homeDirectory;
    this.launchAgents = options.launchAgentsDirectory;
    this.launchctl = options.launchctlExecutable ?? "/bin/launchctl";
    this.security = options.securityExecutable ?? "/usr/bin/security";
    this.domain = `gui/${options.uid ?? process.getuid?.() ?? 0}`;
    if (this.io.platform !== "darwin") throw new V4CutoverExecutionError("CUTOVER_MACOS_ADAPTER_UNSUPPORTED");
    if (![this.home, this.launchAgents, this.launchctl, this.security].every(canonicalAbsolute)) {
      throw new V4CutoverExecutionError("CUTOVER_MACOS_ADAPTER_PATH_INVALID");
    }
    for (const reference of Object.values(options.legacyCredentialReferences)) validateReference(reference);
  }

  private expectedAgentPath(label: string): string {
    if (!MANAGED_LAUNCH_AGENT_LABELS.includes(label)) throw new V4CutoverExecutionError("CUTOVER_LAUNCH_AGENT_NOT_ALLOWLISTED");
    return join(this.launchAgents, `${label}.plist`);
  }

  private assertAgent(agent: LaunchAgentObservation): void {
    if (agent.path !== this.expectedAgentPath(agent.label)) throw new V4CutoverExecutionError("CUTOVER_LAUNCH_AGENT_SCOPE_MISMATCH");
  }

  private expectedManagedPath(id: ManagedPathObservation["id"]): string {
    return {
      runtime: join(this.home, ".temperance_engine"),
      "legacy-omniroute": join(this.home, ".omniroute"),
      "legacy-omnirouter": join(this.home, ".omnirouter"),
      "router-state": join(this.home, ".9router"),
    }[id];
  }

  private async pathKind(path: string): Promise<"absent" | "file" | "directory" | "symlink" | "other"> {
    try {
      const stat = await this.io.lstat(path);
      if (stat.isSymbolicLink()) return "symlink";
      if (stat.isFile()) return "file";
      if (stat.isDirectory()) return "directory";
      return "other";
    } catch (error) {
      if (missing(error)) return "absent";
      throw error;
    }
  }

  private async serviceLoaded(label: string, signal: AbortSignal): Promise<boolean> {
    const result = await this.io.exec([this.launchctl, "print", `${this.domain}/${label}`], signal);
    if (result.exitCode === 0) return true;
    if (result.exitCode === 113) return false;
    throw new V4CutoverExecutionError("CUTOVER_LAUNCH_AGENT_STATUS_FAILED");
  }

  private async unload(label: string, path: string, signal: AbortSignal): Promise<void> {
    if (this.stoppedAgents.has(label) || !await this.serviceLoaded(label, signal)) return;
    const result = await this.io.exec([this.launchctl, "bootout", `${this.domain}/${label}`], signal);
    if (result.exitCode !== 0) throw new V4CutoverExecutionError("CUTOVER_LAUNCH_AGENT_UNLOAD_FAILED");
    this.stoppedAgents.set(label, path);
  }

  async preflightReplacement(proof: V4ReplacementProof, signal: AbortSignal): Promise<void> {
    await this.options.replacement.preflight(proof, signal);
  }

  async stageReplacement(proof: V4ReplacementProof, signal: AbortSignal): Promise<void> {
    await this.options.replacement.stage(proof, signal);
  }

  async stopRouterPortOwner(owner: PortObservation, signal: AbortSignal): Promise<void> {
    const label = owner.managed_service_label;
    if ((owner.owner !== "legacy-omniroute" && owner.owner !== "replacement-9router")
      || !label
      || !MANAGED_LAUNCH_AGENT_LABELS.includes(label)
      || (owner.conflicting_service_labels?.length ?? 0) > 1) {
      throw new V4CutoverExecutionError("CUTOVER_ROUTER_SERVICE_SCOPE_INVALID");
    }
    await this.unload(label, this.expectedAgentPath(label), signal);
  }

  async unloadLaunchAgent(agent: LaunchAgentObservation, signal: AbortSignal): Promise<void> {
    this.assertAgent(agent);
    await this.unload(agent.label, agent.path, signal);
  }

  async restorePreCutoverServices(signal: AbortSignal): Promise<void> {
    for (const [label, path] of [...this.stoppedAgents].reverse()) {
      if (await this.pathKind(path) !== "file") throw new V4CutoverExecutionError("CUTOVER_LAUNCH_AGENT_RESTORE_SOURCE_INVALID");
      const result = await this.io.exec([this.launchctl, "bootstrap", this.domain, path], signal);
      if (result.exitCode !== 0) throw new V4CutoverExecutionError("CUTOVER_LAUNCH_AGENT_RESTORE_FAILED");
      this.stoppedAgents.delete(label);
    }
  }

  async revokeLegacyGatewayCredential(referenceId: string, signal: AbortSignal): Promise<void> {
    const reference = this.options.legacyCredentialReferences[referenceId];
    if (!reference) throw new V4CutoverExecutionError("CUTOVER_KEYCHAIN_REFERENCE_UNKNOWN");
    validateReference(reference);
    const result = await this.io.exec([
      this.security, "delete-generic-password", "-s", reference.service, "-a", reference.account,
    ], signal);
    if (result.exitCode !== 0 && result.exitCode !== 44) throw new V4CutoverExecutionError("CUTOVER_KEYCHAIN_DELETE_FAILED");
  }

  async removeLaunchAgent(agent: LaunchAgentObservation, signal: AbortSignal): Promise<void> {
    this.assertAgent(agent);
    if (await this.serviceLoaded(agent.label, signal)) {
      throw new V4CutoverExecutionError("CUTOVER_LAUNCH_AGENT_STILL_LOADED");
    }
    const kind = await this.pathKind(agent.path);
    if (kind === "absent") return;
    if (kind !== "file") throw new V4CutoverExecutionError("CUTOVER_LAUNCH_AGENT_FILE_UNSAFE");
    await this.io.rm(agent.path, { recursive: false, force: false });
  }

  async removeManagedPath(path: ManagedPathObservation, _signal: AbortSignal): Promise<void> {
    if (path.id === "runtime" || path.path !== this.expectedManagedPath(path.id)) {
      throw new V4CutoverExecutionError("CUTOVER_MANAGED_PATH_SCOPE_MISMATCH");
    }
    const kind = await this.pathKind(path.path);
    if (kind === "absent") return;
    if (kind !== "directory" && kind !== "file") throw new V4CutoverExecutionError("CUTOVER_MANAGED_PATH_UNSAFE");
    await this.io.rm(path.path, { recursive: kind === "directory", force: false });
  }

  async removeLegacyPackage(binary: BinaryObservation, _signal: AbortSignal): Promise<void> {
    if (binary.package !== "omniroute" || !binary.path || !canonicalAbsolute(binary.path)) {
      throw new V4CutoverExecutionError("CUTOVER_LEGACY_PACKAGE_SCOPE_INVALID");
    }
    const binaryStat = await this.io.lstat(binary.path);
    if (!binaryStat.isSymbolicLink()) throw new V4CutoverExecutionError("CUTOVER_LEGACY_PACKAGE_LINK_INVALID");
    const target = await this.io.realpath(binary.path);
    let packageRoot: string | undefined;
    let candidate = dirname(target);
    for (let depth = 0; depth < 5; depth += 1) {
      try {
        const parsed = JSON.parse(await this.io.readFile(join(candidate, "package.json"))) as { name?: unknown };
        if (parsed.name === "omniroute") { packageRoot = candidate; break; }
      } catch (error) {
        if (!missing(error) && !(error instanceof SyntaxError)) throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
    if (!packageRoot
      || basename(packageRoot) !== "omniroute"
      || basename(dirname(packageRoot)) !== "node_modules"
      || !contained(packageRoot, target)) {
      throw new V4CutoverExecutionError("CUTOVER_LEGACY_PACKAGE_ROOT_INVALID");
    }
    const packageStat = await this.io.lstat(packageRoot);
    if (!packageStat.isDirectory() || packageStat.isSymbolicLink()) {
      throw new V4CutoverExecutionError("CUTOVER_LEGACY_PACKAGE_ROOT_UNSAFE");
    }
    await this.io.rm(binary.path, { recursive: false, force: false });
    await this.io.rm(packageRoot, { recursive: true, force: false });
  }

  async promoteTemperanceRuntime(path: ManagedPathObservation, proof: V4ReplacementProof, signal: AbortSignal): Promise<void> {
    if (path.id !== "runtime" || path.path !== this.expectedManagedPath("runtime")) {
      throw new V4CutoverExecutionError("CUTOVER_RUNTIME_SCOPE_MISMATCH");
    }
    await this.options.replacement.promoteRuntime(path, proof, signal);
  }

  async installExactRouter(version: typeof ROUTER_VERSION, signal: AbortSignal): Promise<void> {
    if (version !== ROUTER_VERSION) throw new V4CutoverExecutionError("CUTOVER_ROUTER_VERSION_INVALID");
    await this.options.replacement.installRouter(version, signal);
  }

  async installReplacementLaunchAgents(signal: AbortSignal): Promise<void> {
    await this.options.replacement.installLaunchAgents(signal);
  }

  async activateReplacement(signal: AbortSignal): Promise<void> {
    await this.options.replacement.activate(signal);
  }

  async verifyReplacement(signal: AbortSignal): Promise<V4CutoverVerification> {
    const result = await this.options.replacement.verify(signal);
    const legacyStateAbsent = await Promise.all([
      this.pathKind(this.expectedManagedPath("legacy-omniroute")),
      this.pathKind(this.expectedManagedPath("legacy-omnirouter")),
    ]).then((kinds) => kinds.every((kind) => kind === "absent"));
    const legacyAgentsAbsent = await Promise.all([...LEGACY_AGENT_LABELS]
      .map((label) => this.pathKind(this.expectedAgentPath(label))))
      .then((kinds) => kinds.every((kind) => kind === "absent"));
    if (!legacyStateAbsent || !legacyAgentsAbsent) {
      throw new V4CutoverExecutionError("CUTOVER_LEGACY_RESIDUE_PRESENT");
    }
    return {
      ...result,
      legacy_state_absent: true,
      legacy_launch_agents_absent: true,
    };
  }

  async discardStagedReplacement(signal: AbortSignal): Promise<void> {
    await this.options.replacement.discardStage(signal);
  }

  async recoverFreshReplacement(proof: V4ReplacementProof, signal: AbortSignal): Promise<void> {
    await this.options.replacement.recover(proof, signal);
  }
}
