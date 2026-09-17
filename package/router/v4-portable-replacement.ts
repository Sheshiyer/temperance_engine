import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";

import {
  V4CutoverExecutionError,
  verifyV4ReplacementProof,
  type V4CutoverVerification,
  type V4ReplacementProof,
} from "./v4-cutover-executor.ts";
import type { V4ReplacementLifecycle } from "./v4-macos-host-adapter.ts";
import { ROUTER_VERSION, type ManagedPathObservation } from "./v4-cutover-plan.ts";

export const V4_ROUTER_RUNTIME_DEPENDENCIES = {
  "sql.js": "1.14.1",
  "better-sqlite3": "13.0.3",
  systray2: "2.1.4",
} as const;

const CUTOVER_TESTS = [
  "package/router/v4-cutover-plan.test.ts",
  "package/router/v4-cutover-executor.test.ts",
  "package/router/v4-cutover-apply.test.ts",
  "package/router/v4-cutover-journal.test.ts",
  "package/router/v4-macos-cutover-runtime.test.ts",
  "package/router/v4-macos-host-adapter.test.ts",
  "package/router/v4-macos-replacement-services.test.ts",
  "package/router/v4-portable-replacement.test.ts",
  "package/router/v4-replacement-proof.test.ts",
] as const;

export interface PortableV4CommandResult {
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

export interface PortableV4ReplacementIO {
  lstat(path: string): Promise<Stats>;
  mkdir(path: string, options: { recursive: boolean; mode: number }): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: string, options: { mode: number; flag: "wx" }): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  exec(argv: readonly string[], cwd: string, signal: AbortSignal): Promise<PortableV4CommandResult>;
}

export interface PortableV4ServiceInput {
  node_executable: string;
  cli_entrypoint: string;
  data_directory: string;
  log_directory: string;
  path: string;
}

export type PortableV4ServiceVerification = Pick<
  V4CutoverVerification,
  "router_version" | "listener_owner" | "listener_port" | "loopback_only" | "doctor_passed"
>;

/** Host service wiring is injected; portable source and package work stays here. */
export interface PortableV4ReplacementServices {
  install(input: PortableV4ServiceInput, signal: AbortSignal): Promise<void>;
  activate(input: PortableV4ServiceInput, signal: AbortSignal): Promise<void>;
  verify(input: PortableV4ServiceInput, signal: AbortSignal): Promise<PortableV4ServiceVerification>;
}

export interface PortableV4ReplacementOptions {
  sourceRepository: string;
  stagingRoot: string;
  runtimeRoot: string;
  dataDirectory: string;
  logDirectory: string;
  nodeExecutable: string;
  executablePath: string;
  services: PortableV4ReplacementServices;
  io?: PortableV4ReplacementIO;
  bunExecutable?: string;
  gitExecutable?: string;
  tarExecutable?: string;
  nodeMajor?: number;
  platform?: NodeJS.Platform;
  architecture?: string;
}

interface StagedReplacement {
  proofDigest: string;
  root: string;
  payload: string;
}

function canonicalAbsolute(value: string): boolean {
  return value.length > 1 && isAbsolute(value) && normalize(value) === value && !value.includes("\0");
}

function contained(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function disjoint(left: string, right: string): boolean {
  return !contained(left, right) && !contained(right, left);
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

function digest(parts: readonly Uint8Array[]): `sha256:${string}` {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return `sha256:${hash.digest("hex")}`;
}

function text(bytes: Uint8Array, code: string): string {
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    if (value) return value;
  } catch { /* Normalize all command-output failures. */ }
  throw new V4CutoverExecutionError(code);
}

function packageDocument(name: string): string {
  return `${JSON.stringify({ name, version: "1.0.0", private: true }, null, 2)}\n`;
}

export const nodePortableV4ReplacementIO: PortableV4ReplacementIO = Object.freeze({
  lstat,
  mkdir: async (path: string, options: { recursive: boolean; mode: number }) => { await mkdir(path, options); },
  readFile: async (path: string) => new Uint8Array(await readFile(path)),
  writeFile: async (path: string, data: string, options: { mode: number; flag: "wx" }) => { await writeFile(path, data, options); },
  chmod,
  rename,
  rm: async (path: string, options: { recursive: boolean; force: boolean }) => { await rm(path, options); },
  exec: async (argv: readonly string[], cwd: string, signal: AbortSignal) => {
    const child = Bun.spawn([...argv], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", signal });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).arrayBuffer(),
    ]);
    return { exitCode, stdout: new Uint8Array(stdout), stderr: new Uint8Array(stderr) };
  },
});

/**
 * Fresh-only source and package lifecycle. It never reads legacy bytes and it
 * never invokes npm. Host services are deliberately outside this boundary.
 */
export class PortableV4ReplacementLifecycle implements V4ReplacementLifecycle {
  private readonly io: PortableV4ReplacementIO;
  private readonly bun: string;
  private readonly git: string;
  private readonly tar: string;
  private readonly nodeMajor: number;
  private readonly platform: NodeJS.Platform;
  private readonly architecture: string;
  private readonly routerRoot: string;
  private readonly routerRuntime: string;
  private readonly serviceInput: PortableV4ServiceInput;
  private preflightProofDigest?: string;
  private staged?: StagedReplacement;
  private promotedProofDigest?: string;
  private routerInstalled = false;

  constructor(private readonly options: PortableV4ReplacementOptions) {
    this.io = options.io ?? nodePortableV4ReplacementIO;
    this.bun = options.bunExecutable ?? "bun";
    this.git = options.gitExecutable ?? "git";
    this.tar = options.tarExecutable ?? "tar";
    this.nodeMajor = options.nodeMajor ?? Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
    this.platform = options.platform ?? process.platform;
    this.architecture = options.architecture ?? process.arch;
    const paths = [
      options.sourceRepository,
      options.stagingRoot,
      options.runtimeRoot,
      options.dataDirectory,
      options.logDirectory,
      options.nodeExecutable,
      ...options.executablePath.split(":"),
    ];
    if (!paths.every(canonicalAbsolute)
      || ![options.sourceRepository, options.stagingRoot, options.runtimeRoot, options.dataDirectory]
        .every((path, index, roots) => roots.every((other, otherIndex) => index === otherIndex || disjoint(path, other)))) {
      throw new V4CutoverExecutionError("REPLACEMENT_PATH_SCOPE_INVALID");
    }
    if (!Number.isInteger(this.nodeMajor) || this.nodeMajor < 22) {
      throw new V4CutoverExecutionError("REPLACEMENT_NODE_VERSION_UNSUPPORTED");
    }
    this.routerRoot = join(options.runtimeRoot, "providers", "9router");
    this.routerRuntime = join(options.dataDirectory, "runtime");
    this.serviceInput = {
      node_executable: options.nodeExecutable,
      cli_entrypoint: join(this.routerRoot, "node_modules", "9router", "cli.js"),
      data_directory: options.dataDirectory,
      log_directory: options.logDirectory,
      path: options.executablePath,
    };
  }

  private async kind(path: string): Promise<"absent" | "file" | "directory" | "symlink" | "other"> {
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

  private async command(argv: readonly string[], cwd: string, signal: AbortSignal, code: string): Promise<PortableV4CommandResult> {
    const result = await this.io.exec(argv, cwd, signal);
    if (result.exitCode !== 0) throw new V4CutoverExecutionError(code);
    return result;
  }

  private async packageVersion(root: string, name: string): Promise<string> {
    try {
      const bytes = await this.io.readFile(join(root, "node_modules", name, "package.json"));
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { name?: unknown; version?: unknown };
      if (value.name === name && typeof value.version === "string") return value.version;
    } catch { /* Return a stable attestation failure below. */ }
    throw new V4CutoverExecutionError("REPLACEMENT_PACKAGE_ATTESTATION_FAILED");
  }

  private async assertRouterPackages(): Promise<void> {
    const expected = {
      "9router": ROUTER_VERSION,
      ...V4_ROUTER_RUNTIME_DEPENDENCIES,
    } as const;
    for (const [name, version] of Object.entries(expected)) {
      const root = name === "9router" ? this.routerRoot : this.routerRuntime;
      if (await this.packageVersion(root, name) !== version) {
        throw new V4CutoverExecutionError("REPLACEMENT_PACKAGE_VERSION_MISMATCH");
      }
    }
    const requiredFiles = [
      this.serviceInput.cli_entrypoint,
      join(this.routerRuntime, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
      join(this.routerRuntime, "node_modules", "better-sqlite3", "prebuilds", `${this.platform}-${this.architecture}.node`),
    ];
    if (this.platform !== "win32") {
      requiredFiles.push(join(this.routerRuntime, "node_modules", "systray2", "traybin", this.platform === "darwin" ? "tray_darwin_release" : "tray_linux_release"));
    }
    if (!(await Promise.all(requiredFiles.map((path) => this.kind(path)))).every((kind) => kind === "file")) {
      throw new V4CutoverExecutionError("REPLACEMENT_RUNTIME_DEPENDENCY_INCOMPLETE");
    }
  }

  async preflight(proof: V4ReplacementProof, signal: AbortSignal): Promise<void> {
    if (!verifyV4ReplacementProof(proof) || proof.router.package !== "9router" || proof.router.version !== ROUTER_VERSION) {
      throw new V4CutoverExecutionError("REPLACEMENT_PROOF_INVALID");
    }
    const status = await this.command([this.git, "status", "--porcelain=v1", "--untracked-files=all"], this.options.sourceRepository, signal, "REPLACEMENT_SOURCE_STATUS_FAILED");
    if (status.stdout.byteLength !== 0) throw new V4CutoverExecutionError("REPLACEMENT_SOURCE_DIRTY");
    const revision = text((await this.command([this.git, "rev-parse", "HEAD"], this.options.sourceRepository, signal, "REPLACEMENT_SOURCE_REVISION_FAILED")).stdout, "REPLACEMENT_SOURCE_REVISION_FAILED");
    const tree = text((await this.command([this.git, "rev-parse", "HEAD^{tree}"], this.options.sourceRepository, signal, "REPLACEMENT_SOURCE_TREE_FAILED")).stdout, "REPLACEMENT_SOURCE_TREE_FAILED");
    const archive = await this.command([this.git, "archive", "--format=tar", "HEAD"], this.options.sourceRepository, signal, "REPLACEMENT_SOURCE_ARCHIVE_FAILED");
    if (revision !== proof.temperance_revision
      || tree !== proof.temperance_tree
      || digest([archive.stdout, Uint8Array.of(0), archive.stderr]) !== proof.artifact_digest) {
      throw new V4CutoverExecutionError("REPLACEMENT_SOURCE_PROOF_MISMATCH");
    }
    this.preflightProofDigest = proof.proof_digest;
  }

  async stage(proof: V4ReplacementProof, signal: AbortSignal): Promise<void> {
    if (this.preflightProofDigest !== proof.proof_digest) throw new V4CutoverExecutionError("REPLACEMENT_PREFLIGHT_REQUIRED");
    const root = join(this.options.stagingRoot, proof.proof_digest.slice("sha256:".length));
    const payload = join(root, "payload");
    const archivePath = join(root, "source.tar");
    this.staged = { proofDigest: proof.proof_digest, root, payload };
    const stagingKind = await this.kind(this.options.stagingRoot);
    if (stagingKind !== "absent" && stagingKind !== "directory") {
      throw new V4CutoverExecutionError("REPLACEMENT_STAGING_ROOT_UNSAFE");
    }
    if (stagingKind === "directory") {
      const stagingStat = await this.io.lstat(this.options.stagingRoot);
      const uid = process.getuid?.();
      if ((stagingStat.mode & 0o077) !== 0 || (uid !== undefined && stagingStat.uid !== uid)) {
        throw new V4CutoverExecutionError("REPLACEMENT_STAGING_ROOT_UNSAFE");
      }
    }
    if (await this.kind(root) !== "absent") throw new V4CutoverExecutionError("REPLACEMENT_STAGE_ALREADY_EXISTS");
    await this.io.mkdir(this.options.stagingRoot, { recursive: true, mode: 0o700 });
    await this.io.mkdir(root, { recursive: false, mode: 0o700 });
    await this.io.mkdir(payload, { recursive: false, mode: 0o700 });
    await this.command([this.git, "archive", "--format=tar", `--output=${archivePath}`, "HEAD"], this.options.sourceRepository, signal, "REPLACEMENT_STAGE_ARCHIVE_FAILED");
    const archiveBytes = await this.io.readFile(archivePath);
    if (digest([archiveBytes, Uint8Array.of(0)]) !== proof.artifact_digest) {
      throw new V4CutoverExecutionError("REPLACEMENT_STAGE_ARCHIVE_MISMATCH");
    }
    await this.command([this.tar, "-xf", archivePath, "-C", payload], root, signal, "REPLACEMENT_STAGE_EXTRACT_FAILED");
    await this.io.rm(archivePath, { recursive: false, force: false });
    const installSurface = join(payload, "package", "install-surface");
    await this.command([this.bun, "install", "--frozen-lockfile", "--ignore-scripts"], installSurface, signal, "REPLACEMENT_STAGE_INSTALL_FAILED");
    await this.command([this.bun, "run", "verify"], installSurface, signal, "REPLACEMENT_STAGE_VERIFY_FAILED");
    await this.command([this.bun, "test", ...CUTOVER_TESTS], payload, signal, "REPLACEMENT_STAGE_CONTRACT_FAILED");
  }

  async promoteRuntime(path: ManagedPathObservation, proof: V4ReplacementProof, _signal: AbortSignal): Promise<void> {
    if (path.id !== "runtime" || path.path !== this.options.runtimeRoot) throw new V4CutoverExecutionError("REPLACEMENT_RUNTIME_SCOPE_MISMATCH");
    if (!this.staged || this.staged.proofDigest !== proof.proof_digest || await this.kind(this.staged.payload) !== "directory") {
      throw new V4CutoverExecutionError("REPLACEMENT_STAGE_NOT_READY");
    }
    const runtimeKind = await this.kind(this.options.runtimeRoot);
    if (runtimeKind === "symlink" || runtimeKind === "other") throw new V4CutoverExecutionError("REPLACEMENT_RUNTIME_TARGET_UNSAFE");
    if (runtimeKind !== "absent") await this.io.rm(this.options.runtimeRoot, { recursive: runtimeKind === "directory", force: false });
    await this.io.mkdir(dirname(this.options.runtimeRoot), { recursive: true, mode: 0o700 });
    await this.io.rename(this.staged.payload, this.options.runtimeRoot);
    await this.io.rm(this.staged.root, { recursive: true, force: false });
    this.staged = undefined;
    this.promotedProofDigest = proof.proof_digest;
    this.routerInstalled = false;
  }

  async installRouter(version: typeof ROUTER_VERSION, signal: AbortSignal): Promise<void> {
    if (version !== ROUTER_VERSION || !this.promotedProofDigest) throw new V4CutoverExecutionError("REPLACEMENT_ROUTER_INSTALL_NOT_READY");
    if (await this.kind(this.routerRoot) !== "absent" || await this.kind(this.routerRuntime) !== "absent") {
      throw new V4CutoverExecutionError("REPLACEMENT_ROUTER_TARGET_NOT_FRESH");
    }
    await this.io.mkdir(this.routerRoot, { recursive: true, mode: 0o700 });
    await this.io.writeFile(join(this.routerRoot, "package.json"), packageDocument("temperance-9router"), { mode: 0o600, flag: "wx" });
    await this.command([this.bun, "add", "--exact", "--ignore-scripts", `9router@${ROUTER_VERSION}`], this.routerRoot, signal, "REPLACEMENT_ROUTER_INSTALL_FAILED");

    await this.io.mkdir(this.routerRuntime, { recursive: true, mode: 0o700 });
    await this.io.writeFile(join(this.routerRuntime, "package.json"), packageDocument("temperance-9router-runtime"), { mode: 0o600, flag: "wx" });
    const dependencies = Object.entries(V4_ROUTER_RUNTIME_DEPENDENCIES).map(([name, dependencyVersion]) => `${name}@${dependencyVersion}`);
    await this.command([this.bun, "add", "--exact", "--ignore-scripts", ...dependencies], this.routerRuntime, signal, "REPLACEMENT_ROUTER_RUNTIME_INSTALL_FAILED");
    const trayBinary = join(this.routerRuntime, "node_modules", "systray2", "traybin", this.platform === "darwin" ? "tray_darwin_release" : "tray_linux_release");
    if (this.platform !== "win32" && await this.kind(trayBinary) === "file") await this.io.chmod(trayBinary, 0o755);
    await this.assertRouterPackages();
    this.routerInstalled = true;
  }

  async installLaunchAgents(signal: AbortSignal): Promise<void> {
    if (!this.routerInstalled) throw new V4CutoverExecutionError("REPLACEMENT_SERVICE_INSTALL_NOT_READY");
    await this.io.mkdir(this.options.logDirectory, { recursive: true, mode: 0o700 });
    await this.options.services.install({ ...this.serviceInput }, signal);
  }

  async activate(signal: AbortSignal): Promise<void> {
    if (!this.routerInstalled) throw new V4CutoverExecutionError("REPLACEMENT_ACTIVATION_NOT_READY");
    await this.options.services.activate({ ...this.serviceInput }, signal);
  }

  async verify(signal: AbortSignal): Promise<V4CutoverVerification> {
    if (!this.routerInstalled) throw new V4CutoverExecutionError("REPLACEMENT_VERIFICATION_NOT_READY");
    await this.assertRouterPackages();
    return {
      ...await this.options.services.verify({ ...this.serviceInput }, signal),
      legacy_state_absent: false,
      legacy_launch_agents_absent: false,
    };
  }

  async discardStage(_signal: AbortSignal): Promise<void> {
    if (!this.staged) return;
    if (!contained(this.options.stagingRoot, this.staged.root) || this.staged.root === this.options.stagingRoot) {
      throw new V4CutoverExecutionError("REPLACEMENT_STAGE_SCOPE_INVALID");
    }
    if (await this.kind(this.staged.root) !== "absent") await this.io.rm(this.staged.root, { recursive: true, force: false });
    this.staged = undefined;
  }

  async recover(proof: V4ReplacementProof, signal: AbortSignal): Promise<void> {
    await this.discardStage(signal);
    await this.preflight(proof, signal);
    await this.stage(proof, signal);
    await this.promoteRuntime({ id: "runtime", path: this.options.runtimeRoot, observed: "directory", file_count: 0, disposition: "replace" }, proof, signal);
    await this.installRouter(ROUTER_VERSION, signal);
    await this.installLaunchAgents(signal);
    await this.activate(signal);
    const verification = await this.verify(signal);
    if (verification.router_version !== ROUTER_VERSION
      || verification.listener_owner !== "replacement-9router"
      || verification.listener_port !== 20128
      || verification.loopback_only !== true
      || verification.doctor_passed !== true) {
      throw new V4CutoverExecutionError("REPLACEMENT_RECOVERY_VERIFICATION_FAILED");
    }
  }
}
