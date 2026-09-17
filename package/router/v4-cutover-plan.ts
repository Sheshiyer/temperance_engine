import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

export const V4_CUTOVER_PLAN_SCHEMA = "temperance.v4-cutover-plan.v1" as const;
export const ROUTER_PACKAGE = "9router" as const;
export const ROUTER_VERSION = "0.5.75" as const;

export const MANAGED_LAUNCH_AGENTS = [
  "com.9router.autostart.plist",
  "com.temperance.engine.mini-gateway.plist",
  "com.temperance.engine.9router.plist",
  "com.temperance.engine.omniroute.plist",
  "com.temperance.engine.openai-proxy.plist",
  "space.thoughtseed.omniroute-env.plist",
] as const;

export type RouterPortOwner = "free" | "legacy-omniroute" | "replacement-9router" | "unknown" | "unsupported";

export interface PortObservation {
  port: number;
  owner: RouterPortOwner;
  pid?: number;
  process?: string;
  listener_host?: string | null;
  loopback_only?: boolean | null;
}

export interface ManagedPathObservation {
  id: "runtime" | "legacy-omniroute" | "legacy-omnirouter" | "router-state";
  path: string;
  observed: "absent" | "directory" | "file" | "symlink" | "other";
  file_count: number;
  disposition: "replace" | "remove" | "reset-and-recreate" | "verify-absent";
}

export interface LaunchAgentObservation {
  label: string;
  path: string;
  observed: "absent" | "file" | "symlink" | "other";
  disposition: "remove" | "replace";
}

export interface BinaryObservation {
  package: "omniroute" | "9router";
  path: string | null;
  version: string | null;
  disposition: "remove" | "install-exact" | "keep-exact";
}

export interface CutoverAction {
  order: number;
  id: string;
  effect: "observe" | "stop" | "revoke" | "remove" | "install" | "verify" | "activate";
  target: string;
  required: boolean;
  status: "ready" | "not-needed" | "blocked" | "manual";
  reason: string;
}

export interface MigrationFinding {
  code: "LEGACY_PROJECT_ROOT_REFERENCE";
  managed_path_id: "runtime";
  relative_path: string;
  occurrence_count: number;
  remediation: string;
}

export interface V4CutoverPlan {
  schema: typeof V4_CUTOVER_PLAN_SCHEMA;
  generated_at: string;
  read_only: true;
  target: { package: typeof ROUTER_PACKAGE; version: typeof ROUTER_VERSION };
  policy: {
    runnable_backup: false;
    secret_values_recorded: false;
    destructive_execution_authorized: false;
  };
  paths: ManagedPathObservation[];
  launch_agents: LaunchAgentObservation[];
  binaries: BinaryObservation[];
  router_port: PortObservation;
  migration_findings: MigrationFinding[];
  actions: CutoverAction[];
  activation_blocked: boolean;
  blocking_reasons: string[];
  plan_digest: `sha256:${string}`;
}

export interface V4CutoverPlanOptions {
  homeDirectory?: string;
  launchAgentsDirectory?: string;
  platform?: NodeJS.Platform;
  now?: () => Date;
  findBinary?: (name: string) => string | null;
  readVersion?: (binary: string) => string | null;
  inspectPort?: (port: number) => PortObservation;
}

type V4CutoverDigestScope = Pick<V4CutoverPlan,
  "schema" | "target" | "paths" | "launch_agents" | "binaries" | "router_port" | "migration_findings" | "actions"
>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

export function calculateV4CutoverPlanDigest(plan: V4CutoverDigestScope): `sha256:${string}` {
  return sha256({
    schema: plan.schema,
    target: plan.target,
    paths: plan.paths,
    launch_agents: plan.launch_agents,
    binaries: plan.binaries,
    router_port: plan.router_port,
    migration_findings: plan.migration_findings,
    actions: plan.actions,
  });
}

export function verifyV4CutoverPlanDigest(plan: V4CutoverPlan): boolean {
  return /^sha256:[0-9a-f]{64}$/u.test(plan.plan_digest)
    && plan.plan_digest === calculateV4CutoverPlanDigest(plan);
}

function fileCount(root: string): number {
  if (!existsSync(root)) return 0;
  const stat = lstatSync(root);
  if (!stat.isDirectory()) return stat.isFile() ? 1 : 0;
  let count = 0;
  const queue = [root];
  while (queue.length > 0) {
    const directory = queue.shift()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) queue.push(entryPath);
      else if (entry.isFile()) count += 1;
      // Symlinks are deliberately not followed across the managed root.
    }
  }
  return count;
}

function legacyProjectRootFindings(runtimeRoot: string): MigrationFinding[] {
  if (!existsSync(runtimeRoot) || !lstatSync(runtimeRoot).isDirectory()) return [];
  const allowed = new Set([".json", ".md", ".mjs", ".sh", ".toml", ".ts", ".yaml", ".yml"]);
  const findings: MigrationFinding[] = [];
  const queue = [runtimeRoot];
  while (queue.length > 0) {
    const directory = queue.shift()!;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (!entry.isFile() || !allowed.has(extname(entry.name).toLowerCase())) continue;
      const stat = lstatSync(entryPath);
      if (stat.size > 1_048_576) continue;
      const text = readFileSync(entryPath, "utf8");
      const occurrence_count = text.match(/twc-vault\/01-Projects/gu)?.length ?? 0;
      if (occurrence_count === 0) continue;
      findings.push({
        code: "LEGACY_PROJECT_ROOT_REFERENCE",
        managed_path_id: "runtime",
        relative_path: relative(runtimeRoot, entryPath),
        occurrence_count,
        remediation: "Migrate this managed runtime reference to a bound V4 project root before activation.",
      });
    }
  }
  return findings.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
}

function pathKind(target: string): ManagedPathObservation["observed"] {
  if (!existsSync(target)) return "absent";
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "other";
}

function launchAgentKind(target: string): LaunchAgentObservation["observed"] {
  const kind = pathKind(target);
  return kind === "directory" ? "other" : kind;
}

function sanitizeVersion(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/u);
  return match?.[0] ?? null;
}

function defaultReadVersion(binary: string): string | null {
  const result = Bun.spawnSync([binary, "--version"], { stdout: "pipe", stderr: "pipe" });
  return sanitizeVersion(`${result.stdout.toString()}\n${result.stderr.toString()}`);
}

function defaultInspectPort(port: number): PortObservation {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return { port, owner: "unsupported" };
  }
  const result = Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpcn"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = result.stdout.toString();
  const pidMatch = output.match(/^p(\d+)$/mu);
  if (!pidMatch) return { port, owner: "free" };
  const pid = Number(pidMatch[1]);
  const command = output.match(/^c(.+)$/mu)?.[1] ?? "unknown";
  const listener = output.match(/^n(.+)$/mu)?.[1] ?? null;
  const listener_host = listener?.startsWith("[")
    ? listener.slice(1, listener.indexOf("]"))
    : listener?.slice(0, listener.lastIndexOf(":")) ?? null;
  const loopback_only = listener_host === "127.0.0.1" || listener_host === "::1" || listener_host === "localhost";
  const ps = Bun.spawnSync(["ps", "-p", String(pid), "-o", "command="], { stdout: "pipe", stderr: "pipe" });
  const fingerprint = `${command} ${ps.stdout.toString()}`.toLowerCase();
  const owner: RouterPortOwner = fingerprint.includes("omniroute")
    ? "legacy-omniroute"
    : fingerprint.includes("9router")
      ? "replacement-9router"
      : "unknown";
  return { port, owner, pid, process: command.slice(0, 128), listener_host, loopback_only };
}

function observePath(
  id: ManagedPathObservation["id"],
  target: string,
  disposition: ManagedPathObservation["disposition"],
): ManagedPathObservation {
  return { id, path: target, observed: pathKind(target), file_count: fileCount(target), disposition };
}

function launchAgentLabel(filename: string): string {
  return filename.endsWith(".plist") ? filename.slice(0, -6) : filename;
}

export function createV4CutoverPlan(options: V4CutoverPlanOptions = {}): V4CutoverPlan {
  const homeDirectory = resolve(options.homeDirectory ?? homedir());
  if (!isAbsolute(homeDirectory)) throw new Error("CUTOVER_HOME_NOT_ABSOLUTE");
  const launchAgentsDirectory = resolve(options.launchAgentsDirectory ?? join(homeDirectory, "Library", "LaunchAgents"));
  const platform = options.platform ?? process.platform;
  const now = options.now ?? (() => new Date());
  const findBinary = options.findBinary ?? ((name: string) => Bun.which(name));
  const readVersion = options.readVersion ?? defaultReadVersion;
  const inspectPort = options.inspectPort ?? defaultInspectPort;

  const paths: ManagedPathObservation[] = [
    observePath("runtime", join(homeDirectory, ".temperance_engine"), "replace"),
    observePath("legacy-omniroute", join(homeDirectory, ".omniroute"), "remove"),
    observePath("legacy-omnirouter", join(homeDirectory, ".omnirouter"), "verify-absent"),
    observePath("router-state", join(homeDirectory, ".9router"), "reset-and-recreate"),
  ];

  const launch_agents: LaunchAgentObservation[] = platform === "darwin"
    ? MANAGED_LAUNCH_AGENTS.map((filename) => ({
        label: launchAgentLabel(filename),
        path: join(launchAgentsDirectory, filename),
        observed: launchAgentKind(join(launchAgentsDirectory, filename)),
        disposition:
          filename === "com.temperance.engine.openai-proxy.plist" ||
          filename === "com.temperance.engine.9router.plist"
            ? "replace"
            : "remove",
      }))
    : [];

  const omniroutePath = findBinary("omniroute");
  const routerPath = findBinary(ROUTER_PACKAGE);
  const omnirouteVersion = omniroutePath ? sanitizeVersion(readVersion(omniroutePath)) : null;
  const routerVersion = routerPath ? sanitizeVersion(readVersion(routerPath)) : null;
  const binaries: BinaryObservation[] = [
    { package: "omniroute", path: omniroutePath, version: omnirouteVersion, disposition: "remove" },
    {
      package: ROUTER_PACKAGE,
      path: routerPath,
      version: routerVersion,
      disposition: "install-exact",
    },
  ];

  const router_port = inspectPort(20128);
  const migration_findings = legacyProjectRootFindings(join(homeDirectory, ".temperance_engine"));
  const blocking_reasons: string[] = [];
  if (router_port.owner === "unknown") blocking_reasons.push("ROUTER_PORT_OWNED_BY_UNMANAGED_PROCESS");
  if (router_port.owner === "unsupported") blocking_reasons.push("ROUTER_PORT_INSPECTION_UNSUPPORTED");
  if (router_port.owner === "replacement-9router" && router_port.loopback_only !== true) blocking_reasons.push("ROUTER_LISTENER_NOT_LOOPBACK_ONLY");
  if (platform !== "darwin") blocking_reasons.push("LAUNCH_AGENT_CUTOVER_UNSUPPORTED_ON_PLATFORM");

  const legacyAgentsPresent = launch_agents.some((entry) => entry.observed !== "absent");
  const legacyStatePresent = paths.some((entry) => entry.id.startsWith("legacy-") && entry.observed !== "absent");
  const routerNeedsInstall = true;
  const actions: CutoverAction[] = [
    { order: 10, id: "verify-isolated-replacement", effect: "verify", target: "reviewed-source-worktree", required: true, status: "manual", reason: "Replacement tests and dry-run receipts must pass before any live service is stopped." },
    { order: 20, id: "capture-redacted-inventory", effect: "observe", target: "managed-cutover-scope", required: true, status: "ready", reason: "Inventory records metadata only; file contents and credential values are excluded." },
    { order: 30, id: "stop-router-port-owner", effect: "stop", target: "router-port:20128", required: router_port.owner === "legacy-omniroute" || router_port.owner === "replacement-9router", status: router_port.owner === "legacy-omniroute" || router_port.owner === "replacement-9router" ? "ready" : router_port.owner === "unknown" ? "blocked" : "not-needed", reason: `Observed owner: ${router_port.owner}.` },
    { order: 40, id: "unload-managed-launch-agents", effect: "stop", target: launchAgentsDirectory, required: legacyAgentsPresent, status: legacyAgentsPresent ? "ready" : "not-needed", reason: "Only the six allowlisted legacy and replacement labels are in scope." },
    { order: 50, id: "revoke-legacy-gateway-credential", effect: "revoke", target: "macos-keychain-reference", required: true, status: "manual", reason: "Secret value is intentionally absent from this plan." },
    { order: 60, id: "remove-legacy-router-state", effect: "remove", target: "legacy-router-state", required: legacyStatePresent, status: legacyStatePresent ? "ready" : "not-needed", reason: "Delete only the exact observed .omniroute/.omnirouter targets." },
    { order: 70, id: "reset-router-state", effect: "remove", target: join(homeDirectory, ".9router"), required: paths.find((entry) => entry.id === "router-state")?.observed !== "absent", status: paths.find((entry) => entry.id === "router-state")?.observed !== "absent" ? "ready" : "not-needed", reason: "Fresh 9router state is created by the replacement install." },
    { order: 80, id: "replace-temperance-runtime", effect: "install", target: join(homeDirectory, ".temperance_engine"), required: true, status: "manual", reason: "Transaction executor must promote the reviewed source and emit a receipt." },
    { order: 90, id: "remove-legacy-package", effect: "remove", target: "package:omniroute", required: omniroutePath !== null, status: omniroutePath ? "ready" : "not-needed", reason: "9router is the exclusive successor package." },
    { order: 100, id: "install-exact-router", effect: "install", target: `package:${ROUTER_PACKAGE}@${ROUTER_VERSION}`, required: routerNeedsInstall, status: routerNeedsInstall ? "ready" : "not-needed", reason: "The architecture pin is exact, not a floating latest tag." },
    { order: 110, id: "verify-secret-free-launch-agents", effect: "verify", target: launchAgentsDirectory, required: true, status: "manual", reason: "Generated services may contain Keychain references but no secret values." },
    { order: 120, id: "activate-replacement-router", effect: "activate", target: "router-port:20128", required: true, status: blocking_reasons.length ? "blocked" : "manual", reason: blocking_reasons.length ? blocking_reasons.join(",") : "Activation follows install and doctor verification." },
  ];

  const digestScope = { schema: V4_CUTOVER_PLAN_SCHEMA, target: { package: ROUTER_PACKAGE, version: ROUTER_VERSION }, paths, launch_agents, binaries, router_port, migration_findings, actions };
  return {
    schema: V4_CUTOVER_PLAN_SCHEMA,
    generated_at: now().toISOString(),
    read_only: true,
    target: { package: ROUTER_PACKAGE, version: ROUTER_VERSION },
    policy: { runnable_backup: false, secret_values_recorded: false, destructive_execution_authorized: false },
    paths,
    launch_agents,
    binaries,
    router_port,
    migration_findings,
    actions,
    activation_blocked: blocking_reasons.length > 0,
    blocking_reasons,
    plan_digest: calculateV4CutoverPlanDigest(digestScope),
  };
}

export function resolveSymlinkTarget(target: string): string | null {
  if (!existsSync(target) || !lstatSync(target).isSymbolicLink()) return null;
  return readlinkSync(target);
}
