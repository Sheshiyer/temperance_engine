import { createHash } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Database } from "bun:sqlite";

export const NATIVE_CONTROL_PLANE_SCHEMA = "temperance.omniroute.native-control-plane.v1" as const;
export const NATIVE_CONTROL_PLANE_TTL_MS = 30_000;

const MAX_MANIFEST_BYTES = 1_048_576;
const MAX_PACKAGE_BYTES = 65_536;
const MAX_STATE_BYTES = 16_384;
const SUPPORTED_TOPOLOGY_VERSION = "3.8.48";
const SUPPORTED_DATABASE_SCHEMA_VERSION = "1";
const SOL_FAMILY = /(^|[-_/.])sol(?:[-_]?max)?(?=$|[-_/.])/iu;
const SAFE_PROVIDER = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const SAFE_ROLE = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const FORBIDDEN_OUTPUT_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|bearer|password|credential|cookie|client[_-]?secret|private[_-]?key|provider[_-]?specific[_-]?data|email|account[_-]?id)/iu;
const FORBIDDEN_OUTPUT_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/-]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}|https?:\/\/[^\s/@:]+:[^\s/@]+@|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/iu;

const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  provider_connections: ["provider", "is_active", "test_status"],
  call_logs: ["id", "timestamp", "status", "provider"],
  key_value: ["namespace", "key", "value"],
  compression_combos: ["id", "name", "pipeline", "is_default"],
  a2a_tasks: ["state", "created_at"],
  mcp_tool_audit: ["created_at"],
  combos: ["id", "name"],
  model_intelligence: ["model"],
  db_meta: ["key", "value"],
};

const NATIVE_NON_CODEX_PROFILES = [
  "antigravity-claude-sonnet-5",
  "gh-claude-sonnet-5",
  "no-think-antigravity-claude-sonnet-5",
  "no-think-gh-claude-sonnet-5",
] as const;

const CLI_TOOLS = [
  { id: "claude", executable: "claude", family: "code" },
  { id: "codex", executable: "codex", family: "code" },
  { id: "opencode", executable: "opencode", family: "code" },
  { id: "cline", executable: "cline", family: "code" },
  { id: "kilocode", executable: "kilocode", family: "code" },
  { id: "continue", executable: "cn", family: "code" },
  { id: "hermes", executable: "hermes", family: "agent" },
  { id: "hermes-agent", executable: "hermes", family: "agent" },
  { id: "openclaw", executable: "openclaw", family: "agent" },
] as const;

export class NativeControlPlaneError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "NativeControlPlaneError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new NativeControlPlaneError(code);
}

export interface RuntimeIdentity {
  pid: number;
  startedHash: string;
  listener: "127.0.0.1:20128" | "[::1]:20128";
  version: string;
  packageIdentityHash: string;
  databaseBindingHash: string;
}

export interface FileIdentity {
  device: number;
  inode: number;
  uid: number;
  mode: number;
  links: number;
  size: number;
}

export interface CollectionOptions {
  databasePath: string;
  dispatchManifestPath: string;
  installedVersion: string;
  expectedUid?: number;
  now?: () => Date;
  runtimeProbe: (databasePath: string) => RuntimeIdentity;
  cloudflaredProcessProbe?: () => number[];
  cliProbe?: () => Record<string, boolean>;
  quickTunnelStatePath?: string;
  hermesDirectoryPath?: string;
  databaseFactory?: (path: string) => Database;
}

interface ConnectionStatsRow {
  total_connections: number;
  active_connections: number;
  configured_families: number;
  active_families: number;
  healthy_connections: number;
  unhealthy_connections: number;
}

interface ObservedStatsRow {
  observed_families: number;
}

interface CallRow {
  provider: string;
  status: number;
  timestamp: string;
}

interface CountRow {
  count: number;
}

interface GovernedHermesComboRow {
  temperance_coding: number;
  te_build: number;
  te_free_burst: number;
  te_reason: number;
  te_plan: number;
}

interface ModelStatsRow {
  entries: number;
  local_catalog_like_families: number;
}

interface KeyValueRow {
  key: string;
  value: string;
}

interface ComboRow {
  id: string;
  name: string;
  pipeline: string;
  is_default: number;
}

interface ProtocolStateRow {
  state: string;
  count: number;
}

interface AuditStatsRow {
  count: number;
  last_at: string | null;
}

interface DispatchWorker {
  role: string;
  provider: string;
  model: string;
}

interface DispatchFallback {
  backend: string;
  model: string;
}

interface DispatchProjection {
  portfolio: string;
  strategy: string;
  maxParallel: number;
  workerCount: number;
  nonCodexWorkerCount: number;
  nonCodexProviderFamilyCount: number;
  nonCodexTargetCount: number;
  sparkWorkerCount: number;
  fallbackCount: number;
  solFree: boolean;
  workers: DispatchWorker[];
  fallbacks: DispatchFallback[];
  nativeNonCodexProfiles: readonly string[];
  nativeProfileEvidence: "allowlist-only-not-probed-by-snapshot";
  manifestSha256: string;
}

interface CompressionProjection {
  masterEnabled: boolean;
  defaultMode: string;
  preserveSystemPrompt: boolean;
  activeComboId: string | null;
  activeComboResolves: boolean;
  candidateEngines: string[];
  configuredPipeline: Array<{ engine: string; intensity: string }>;
  effectivePipeline: "off" | "request-dependent";
  adoption: "preview-only";
}

interface RawProjectionInput {
  connectionStats: ConnectionStatsRow;
  observedStats: ObservedStatsRow;
  lastPersisted: CallRow | null;
  lastPersistedError: CallRow | null;
  modelStats: ModelStatsRow;
  comboCount: number;
  governedHermesCombos: GovernedHermesComboRow;
  compressionRows: KeyValueRow[];
  compressionCombos: ComboRow[];
  a2aStates: ProtocolStateRow[];
  mcpAudit: AuditStatsRow;
  dispatch: DispatchProjection;
  runtime: RuntimeIdentity;
  database: FileIdentity & { schemaVersion: string | null; dataVersion: number; journalMode: "wal" };
  installedVersion: string;
  cli: Record<string, boolean>;
  quickTunnel: {
    state: "stopped" | "unsafe" | "unknown";
    publicUrlPresent: boolean;
    cloudflaredProcessesPresent: boolean;
  };
  hermesLocalStatePresent: boolean;
  collectedAt: Date;
}

export interface NativeControlPlaneSnapshot {
  schema: typeof NATIVE_CONTROL_PLANE_SCHEMA;
  mode: "read-only-local-snapshot";
  collectedAt: string;
  expiresAt: string;
  fresh: true;
  promotionAuthorized: false;
  mutationMethods: [];
  evidence: {
    installedVersion: string;
    database: {
      mode: number;
      links: number;
      size: number;
      schemaVersion: string | null;
      dataVersion: number;
      journalMode: "wal";
    };
    runtime: RuntimeIdentity;
    dispatchManifestSha256: string;
    atomicTransaction: true;
    databaseIdentityContinuity: true;
    runtimeContinuity: true;
  };
  layers: {
    inventory: {
      owner: "OmniRoute";
      configuredConnections: number;
      activeConnections: number;
      configuredProviderFamilies: number;
      activeProviderFamilies: number;
      healthyConnections: number;
      unhealthyConnections: number;
      persistedObservedProviderFamilies: number;
      localModelIntelligenceEntries: number;
      localCatalogLikeFamilies: number;
      governedComboCount: number;
      governedHermesCombos: {
        temperanceCoding: boolean;
        teBuild: boolean;
        teFreeBurst: boolean;
        teReason: boolean;
        tePlan: boolean;
      };
    };
    activity: {
      owner: "OmniRoute realtime telemetry";
      liveInFlightProviderFamilies: null;
      liveInFlightState: "unknown-websocket-only-not-collected";
      lastPersistedProvider: string | null;
      lastPersistedAt: string | null;
      lastPersistedErrorProvider: string | null;
      lastPersistedErrorAt: string | null;
      dashboardTopologySemantics: {
        versionBound: boolean;
        blueBadge: "in-flight-provider-family-count";
        green: "active";
        amber: "last-routed";
        red: "last-error";
        dim: "inventory-not-current-activity";
        conclusion: "highlighted-rails-are-not-provider-count";
      };
    };
    policy: {
      owner: "Temperance PAI/GSD/ISA/skill-clusters";
      compression: CompressionProjection;
      dispatch: DispatchProjection;
      contextSources: "client-pointer-catalog";
      customSystemPrompt: "off";
    };
    execution: {
      owner: "client tool loops";
      cliTools: Array<{ id: string; family: string; installed: boolean; adoption: string }>;
      hermes: {
        localStatePresent: boolean;
        adoption: "proposal-only";
        protectedEc2State: "not-probed";
      };
      protocols: {
        mcp: {
          configuredState: "unknown-without-server-authenticated-channel";
          adoption: "dormant";
          auditCalls: number;
          lastAuditAt: string | null;
        };
        a2a: {
          configuredState: "unknown-without-server-authenticated-channel";
          adoption: "held";
          taskCounts: Record<string, number>;
        };
      };
    };
    authority: {
      owner: "human operator plus external administrators";
      cloudflare: {
        quickTunnel: "stopped" | "unsafe" | "unknown";
        publicUrlPresent: boolean;
        cloudflaredProcessesPresent: boolean;
        namedTunnelPromotion: "external-authority-gated";
      };
      omnirouteManagement: "not-contacted";
      hermesEc2: "not-contacted";
      algorithmSProvider: "not-promoted";
    };
  };
}

function exactInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function safeProvider(value: unknown): string | null {
  return typeof value === "string" && SAFE_PROVIDER.test(value) ? value : null;
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedJson(value: string, code: string, maxBytes = MAX_STATE_BYTES): unknown {
  if (Buffer.byteLength(value, "utf8") > maxBytes) fail(code);
  try {
    return JSON.parse(value);
  } catch {
    return fail(code);
  }
}

function booleanSetting(value: string | undefined, fallback: boolean, code: string): boolean {
  if (value === undefined) return fallback;
  const parsed = boundedJson(value, code);
  if (typeof parsed !== "boolean") fail(code);
  return parsed;
}

function stringSetting(value: string | undefined, fallback: string, code: string): string {
  if (value === undefined) return fallback;
  const parsed = boundedJson(value, code);
  if (typeof parsed !== "string" || parsed.length > 80) fail(code);
  return parsed;
}

function nullableStringSetting(value: string | undefined, code: string): string | null {
  if (value === undefined) return null;
  const parsed = boundedJson(value, code);
  if (parsed === null) return null;
  if (typeof parsed !== "string" || parsed.length > 128) fail(code);
  return parsed;
}

function compressionProjection(rows: KeyValueRow[], combos: ComboRow[]): CompressionProjection {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const masterEnabled = booleanSetting(values.get("enabled"), false, "compression_enabled_invalid");
  const defaultMode = stringSetting(values.get("defaultMode"), "off", "compression_mode_invalid");
  const preserveSystemPrompt = booleanSetting(
    values.get("preserveSystemPrompt"),
    true,
    "compression_preserve_system_invalid",
  );
  const activeComboId = nullableStringSetting(values.get("activeComboId"), "compression_combo_invalid");
  const candidateEngines: string[] = [];
  const cavemanValue = values.get("cavemanConfig");
  if (cavemanValue !== undefined) {
    const parsed = boundedJson(cavemanValue, "compression_caveman_invalid");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("compression_caveman_invalid");
    if ((parsed as Record<string, unknown>).enabled === true) candidateEngines.push("caveman");
  }
  const selected =
    combos.find((combo) => activeComboId !== null && combo.id === activeComboId) ??
    combos.find((combo) => combo.is_default === 1) ??
    null;
  const configuredPipeline: Array<{ engine: string; intensity: string }> = [];
  if (selected) {
    const pipeline = boundedJson(selected.pipeline, "compression_pipeline_invalid");
    if (!Array.isArray(pipeline) || pipeline.length > 16) fail("compression_pipeline_invalid");
    for (const item of pipeline) {
      if (!item || typeof item !== "object" || Array.isArray(item)) fail("compression_pipeline_invalid");
      const engine = (item as Record<string, unknown>).engine;
      const intensity = (item as Record<string, unknown>).intensity;
      if (
        typeof engine !== "string" ||
        !SAFE_ROLE.test(engine) ||
        typeof intensity !== "string" ||
        !SAFE_ROLE.test(intensity)
      ) fail("compression_pipeline_invalid");
      configuredPipeline.push({ engine, intensity });
    }
  }
  return {
    masterEnabled,
    defaultMode,
    preserveSystemPrompt,
    activeComboId,
    activeComboResolves: activeComboId !== null && combos.some((combo) => combo.id === activeComboId),
    candidateEngines,
    configuredPipeline,
    effectivePipeline: masterEnabled ? "request-dependent" : "off",
    adoption: "preview-only",
  };
}

function dispatchProjection(manifestSource: string): DispatchProjection {
  if (Buffer.byteLength(manifestSource, "utf8") > MAX_MANIFEST_BYTES) fail("dispatch_manifest_too_large");
  const parsed = boundedJson(manifestSource, "dispatch_manifest_invalid", MAX_MANIFEST_BYTES);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("dispatch_manifest_invalid");
  const dispatch = (parsed as Record<string, unknown>).dispatch;
  if (!dispatch || typeof dispatch !== "object" || Array.isArray(dispatch)) fail("dispatch_manifest_invalid");
  const record = dispatch as Record<string, unknown>;
  const workersValue = record.omniroute_workers;
  if (!Array.isArray(workersValue) || workersValue.length === 0 || workersValue.length > 16) {
    fail("dispatch_workers_invalid");
  }
  const workers: DispatchWorker[] = workersValue.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("dispatch_worker_invalid");
    const worker = value as Record<string, unknown>;
    if (
      typeof worker.role !== "string" ||
      !SAFE_ROLE.test(worker.role) ||
      typeof worker.provider !== "string" ||
      !SAFE_PROVIDER.test(worker.provider) ||
      typeof worker.model !== "string" ||
      !SAFE_MODEL.test(worker.model)
    ) fail("dispatch_worker_invalid");
    return { role: worker.role, provider: worker.provider, model: worker.model };
  });
  const fallbackValue = record.direct_cli_fallbacks;
  if (fallbackValue !== undefined && (!Array.isArray(fallbackValue) || fallbackValue.length > 16)) {
    fail("dispatch_fallbacks_invalid");
  }
  const fallbacks: DispatchFallback[] = (fallbackValue ?? []).map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("dispatch_fallback_invalid");
    const fallback = value as Record<string, unknown>;
    if (
      typeof fallback.backend !== "string" ||
      !SAFE_PROVIDER.test(fallback.backend) ||
      typeof fallback.model !== "string" ||
      !SAFE_MODEL.test(fallback.model)
    ) fail("dispatch_fallback_invalid");
    return { backend: fallback.backend, model: fallback.model };
  });
  const portfolio = record.portfolio;
  const strategy = record.strategy;
  const maxParallel = record.max_parallel;
  if (typeof portfolio !== "string" || !SAFE_ROLE.test(portfolio)) fail("dispatch_portfolio_invalid");
  if (typeof strategy !== "string" || !SAFE_ROLE.test(strategy)) fail("dispatch_strategy_invalid");
  if (typeof maxParallel !== "number" || !Number.isSafeInteger(maxParallel) || maxParallel < 1 || maxParallel > 16) {
    fail("dispatch_parallelism_invalid");
  }
  const solFree = [
    portfolio,
    strategy,
    ...workers.flatMap((worker) => [worker.role, worker.provider, worker.model]),
    ...fallbacks.flatMap((fallback) => [fallback.backend, fallback.model]),
  ]
    .every((value) => !SOL_FAMILY.test(value));
  if (!solFree) fail("dispatch_sol_forbidden");
  const nonCodexWorkers = workers.filter(
    (worker) => worker.provider !== "codex" && !worker.model.toLowerCase().startsWith("codex/"),
  );
  return {
    portfolio,
    strategy,
    maxParallel,
    workerCount: workers.length,
    nonCodexWorkerCount: nonCodexWorkers.length,
    nonCodexProviderFamilyCount: new Set(nonCodexWorkers.map((worker) => worker.provider)).size,
    nonCodexTargetCount: new Set(nonCodexWorkers.map((worker) => `${worker.provider}\0${worker.model}`)).size,
    sparkWorkerCount: workers.filter((worker) => worker.model === "codex/gpt-5.3-codex-spark").length,
    fallbackCount: fallbacks.length,
    solFree,
    workers,
    fallbacks,
    nativeNonCodexProfiles: [...NATIVE_NON_CODEX_PROFILES],
    nativeProfileEvidence: "allowlist-only-not-probed-by-snapshot",
    manifestSha256: sha256(manifestSource),
  };
}

function taskCounts(rows: ProtocolStateRow[]): Record<string, number> {
  const output: Record<string, number> = {
    submitted: 0,
    working: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    other: 0,
  };
  for (const row of rows) {
    const count = exactInteger(row.count, "a2a_task_count_invalid");
    if (Object.prototype.hasOwnProperty.call(output, row.state)) output[row.state] += count;
    else output.other += count;
  }
  return output;
}

function cliProjection(cli: Record<string, boolean>): NativeControlPlaneSnapshot["layers"]["execution"]["cliTools"] {
  return CLI_TOOLS.map((tool) => ({
    id: tool.id,
    family: tool.family,
    installed: cli[tool.id] === true,
    adoption:
      tool.id === "codex"
        ? "native-preview"
        : tool.id === "hermes-agent" || tool.id === "hermes"
          ? "proposal-only"
          : tool.id === "opencode"
            ? "governed-launcher"
            : "detected-only",
  }));
}

export function projectNativeControlPlane(input: RawProjectionInput): NativeControlPlaneSnapshot {
  const collectedAt = input.collectedAt.toISOString();
  const expiresAt = new Date(input.collectedAt.getTime() + NATIVE_CONTROL_PLANE_TTL_MS).toISOString();
  const c = input.connectionStats;
  const activity = input.lastPersisted;
  const error = input.lastPersistedError;
  return {
    schema: NATIVE_CONTROL_PLANE_SCHEMA,
    mode: "read-only-local-snapshot",
    collectedAt,
    expiresAt,
    fresh: true,
    promotionAuthorized: false,
    mutationMethods: [],
    evidence: {
      installedVersion: input.installedVersion,
      database: {
        mode: input.database.mode,
        links: input.database.links,
        size: input.database.size,
        schemaVersion: input.database.schemaVersion,
        dataVersion: input.database.dataVersion,
        journalMode: input.database.journalMode,
      },
      runtime: input.runtime,
      dispatchManifestSha256: input.dispatch.manifestSha256,
      atomicTransaction: true,
      databaseIdentityContinuity: true,
      runtimeContinuity: true,
    },
    layers: {
      inventory: {
        owner: "OmniRoute",
        configuredConnections: exactInteger(c.total_connections, "provider_count_invalid"),
        activeConnections: exactInteger(c.active_connections, "provider_count_invalid"),
        configuredProviderFamilies: exactInteger(c.configured_families, "provider_count_invalid"),
        activeProviderFamilies: exactInteger(c.active_families, "provider_count_invalid"),
        healthyConnections: exactInteger(c.healthy_connections, "provider_count_invalid"),
        unhealthyConnections: exactInteger(c.unhealthy_connections, "provider_count_invalid"),
        persistedObservedProviderFamilies: exactInteger(
          input.observedStats.observed_families,
          "observed_provider_count_invalid",
        ),
        localModelIntelligenceEntries: exactInteger(input.modelStats.entries, "model_count_invalid"),
        localCatalogLikeFamilies: exactInteger(
          input.modelStats.local_catalog_like_families,
          "model_family_count_invalid",
        ),
        governedComboCount: exactInteger(input.comboCount, "combo_count_invalid"),
        governedHermesCombos: {
          temperanceCoding:
            exactInteger(input.governedHermesCombos.temperance_coding, "hermes_combo_count_invalid") === 1,
          teBuild: exactInteger(input.governedHermesCombos.te_build, "hermes_combo_count_invalid") === 1,
          teFreeBurst:
            exactInteger(input.governedHermesCombos.te_free_burst, "hermes_combo_count_invalid") === 1,
          teReason: exactInteger(input.governedHermesCombos.te_reason, "hermes_combo_count_invalid") === 1,
          tePlan: exactInteger(input.governedHermesCombos.te_plan, "hermes_combo_count_invalid") === 1,
        },
      },
      activity: {
        owner: "OmniRoute realtime telemetry",
        liveInFlightProviderFamilies: null,
        liveInFlightState: "unknown-websocket-only-not-collected",
        lastPersistedProvider: safeProvider(activity?.provider),
        lastPersistedAt: safeTimestamp(activity?.timestamp),
        lastPersistedErrorProvider: safeProvider(error?.provider),
        lastPersistedErrorAt: safeTimestamp(error?.timestamp),
        dashboardTopologySemantics: {
          versionBound: input.installedVersion === SUPPORTED_TOPOLOGY_VERSION,
          blueBadge: "in-flight-provider-family-count",
          green: "active",
          amber: "last-routed",
          red: "last-error",
          dim: "inventory-not-current-activity",
          conclusion: "highlighted-rails-are-not-provider-count",
        },
      },
      policy: {
        owner: "Temperance PAI/GSD/ISA/skill-clusters",
        compression: compressionProjection(input.compressionRows, input.compressionCombos),
        dispatch: input.dispatch,
        contextSources: "client-pointer-catalog",
        customSystemPrompt: "off",
      },
      execution: {
        owner: "client tool loops",
        cliTools: cliProjection(input.cli),
        hermes: {
          localStatePresent: input.hermesLocalStatePresent,
          adoption: "proposal-only",
          protectedEc2State: "not-probed",
        },
        protocols: {
          mcp: {
            configuredState: "unknown-without-server-authenticated-channel",
            adoption: "dormant",
            auditCalls: exactInteger(input.mcpAudit.count, "mcp_count_invalid"),
            lastAuditAt: safeTimestamp(input.mcpAudit.last_at),
          },
          a2a: {
            configuredState: "unknown-without-server-authenticated-channel",
            adoption: "held",
            taskCounts: taskCounts(input.a2aStates),
          },
        },
      },
      authority: {
        owner: "human operator plus external administrators",
        cloudflare: {
          quickTunnel: input.quickTunnel.state,
          publicUrlPresent: input.quickTunnel.publicUrlPresent,
          cloudflaredProcessesPresent: input.quickTunnel.cloudflaredProcessesPresent,
          namedTunnelPromotion: "external-authority-gated",
        },
        omnirouteManagement: "not-contacted",
        hermesEc2: "not-contacted",
        algorithmSProvider: "not-promoted",
      },
    },
  };
}

function canonicalPath(path: string, expectedUid: number, kind: "file" | "directory"): FileIdentity {
  if (!isAbsolute(path) || resolve(path) !== path || path !== path.normalize("NFC") || path.includes("\0")) {
    fail(`${kind}_path_invalid`);
  }
  const link = lstatSync(path);
  if (link.isSymbolicLink()) fail(`${kind}_symlink_forbidden`);
  if (realpathSync(path) !== path) fail(`${kind}_path_noncanonical`);
  const stat = statSync(path);
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) fail(`${kind}_type_invalid`);
  if (stat.uid !== expectedUid) fail(`${kind}_owner_invalid`);
  if ((stat.mode & 0o022) !== 0) fail(`${kind}_writable_by_others`);
  if (kind === "file" && stat.nlink !== 1) fail("file_link_count_invalid");
  return {
    device: stat.dev,
    inode: stat.ino,
    uid: stat.uid,
    mode: stat.mode & 0o777,
    links: stat.nlink,
    size: stat.size,
  };
}

function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.device === b.device && a.inode === b.inode && a.uid === b.uid && a.mode === b.mode && a.links === b.links;
}

function databaseBindingHash(device: number, inode: number): string {
  return sha256(`${device}:${inode}`);
}

function validateDatabasePath(path: string, expectedUid: number): FileIdentity {
  const parent = dirname(path);
  canonicalPath(parent, expectedUid, "directory");
  return canonicalPath(path, expectedUid, "file");
}

function descriptorIdentity(path: string, expectedUid: number): FileIdentity {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) fail("database_descriptor_type_invalid");
    if (stat.uid !== expectedUid) fail("database_descriptor_owner_invalid");
    if ((stat.mode & 0o022) !== 0) fail("database_descriptor_writable_by_others");
    if (stat.nlink !== 1) fail("database_descriptor_link_count_invalid");
    return {
      device: stat.dev,
      inode: stat.ino,
      uid: stat.uid,
      mode: stat.mode & 0o777,
      links: stat.nlink,
      size: stat.size,
    };
  } catch (error) {
    if (error instanceof NativeControlPlaneError) throw error;
    return fail("database_descriptor_open_failed");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertWalDatabaseHeader(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const header = Buffer.alloc(100);
    if (readSync(descriptor, header, 0, header.length, 0) !== header.length) fail("database_header_invalid");
    if (header.subarray(0, 16).toString("binary") !== "SQLite format 3\0") fail("database_header_invalid");
    if (header[18] !== 2 || header[19] !== 2) fail("database_journal_mode_unsupported");
  } catch (error) {
    if (error instanceof NativeControlPlaneError) throw error;
    return fail("database_header_read_failed");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function optionalDatabaseSidecar(path: string, expectedUid: number): FileIdentity | null {
  try {
    return canonicalPath(path, expectedUid, "file");
  } catch (error) {
    if (error instanceof NativeControlPlaneError) throw error;
    if ((error as { code?: string }).code === "ENOENT") return null;
    return fail("database_sidecar_invalid");
  }
}

function databaseSidecars(path: string, expectedUid: number): {
  wal: FileIdentity | null;
  shm: FileIdentity | null;
  journal: FileIdentity | null;
} {
  return {
    wal: optionalDatabaseSidecar(`${path}-wal`, expectedUid),
    shm: optionalDatabaseSidecar(`${path}-shm`, expectedUid),
    journal: optionalDatabaseSidecar(`${path}-journal`, expectedUid),
  };
}

function sameOptionalIdentity(a: FileIdentity | null, b: FileIdentity | null): boolean {
  return a === null ? b === null : b !== null && sameIdentity(a, b);
}

function assertSnapshotSafe(value: unknown): void {
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      if (FORBIDDEN_OUTPUT_VALUE.test(node)) fail("snapshot_secret_leak");
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_OUTPUT_KEY.test(key)) fail("snapshot_secret_leak");
      visit(child);
    }
  };
  visit(value);
}

function normalizedProcessIds(probe: (() => number[]) | undefined): number[] {
  const ids = probe?.() ?? [];
  if (!Array.isArray(ids) || ids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) {
    fail("cloudflared_process_identity_invalid");
  }
  const normalized = [...new Set(ids)].sort((a, b) => a - b);
  if (normalized.length !== ids.length) fail("cloudflared_process_identity_invalid");
  return normalized;
}

function assertSchema(db: Database): void {
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    let rows: Array<{ name: string }>;
    try {
      rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    } catch {
      return fail("database_schema_invalid");
    }
    const columns = new Set(rows.map((row) => row.name));
    if (required.some((column) => !columns.has(column))) fail("database_schema_invalid");
  }
}

function readQuickTunnel(
  path: string | undefined,
  expectedUid: number,
  cloudflaredProcessesPresent: boolean,
): RawProjectionInput["quickTunnel"] {
  if (!path) {
    return {
      state: cloudflaredProcessesPresent ? "unsafe" : "unknown",
      publicUrlPresent: false,
      cloudflaredProcessesPresent,
    };
  }
  try {
    const identity = canonicalPath(path, expectedUid, "file");
    if (identity.size > MAX_STATE_BYTES) fail("quick_tunnel_state_too_large");
    const parsed = boundedJson(readFileSync(path, "utf8"), "quick_tunnel_state_invalid");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("quick_tunnel_state_invalid");
    const record = parsed as Record<string, unknown>;
    const publicUrlPresent = typeof record.url === "string" && record.url.length > 0;
    const stopped =
      record.status === "stopped" && record.pid === null && !publicUrlPresent && !cloudflaredProcessesPresent;
    return {
      state: stopped ? "stopped" : "unsafe",
      publicUrlPresent,
      cloudflaredProcessesPresent,
    };
  } catch (error) {
    if (error instanceof NativeControlPlaneError) throw error;
    return {
      state: cloudflaredProcessesPresent ? "unsafe" : "unknown",
      publicUrlPresent: false,
      cloudflaredProcessesPresent,
    };
  }
}

function readHermesPresence(path: string | undefined): boolean {
  if (!path) return false;
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readRows(db: Database): Omit<RawProjectionInput, "dispatch" | "runtime" | "database" | "installedVersion" | "cli" | "quickTunnel" | "hermesLocalStatePresent" | "collectedAt"> {
  const connectionStats = db.query(`
    SELECT
      COUNT(*) AS total_connections,
      COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) AS active_connections,
      COUNT(DISTINCT provider) AS configured_families,
      COUNT(DISTINCT CASE WHEN is_active = 1 THEN provider END) AS active_families,
      COALESCE(SUM(CASE WHEN test_status = 'active' THEN 1 ELSE 0 END), 0) AS healthy_connections,
      COALESCE(SUM(CASE WHEN test_status IN ('error', 'banned') THEN 1 ELSE 0 END), 0) AS unhealthy_connections
    FROM provider_connections
  `).get() as ConnectionStatsRow | null;
  const observedStats = db.query(`
    SELECT COUNT(DISTINCT provider) AS observed_families
    FROM call_logs
    WHERE provider IS NOT NULL AND provider <> ''
  `).get() as ObservedStatsRow | null;
  const lastPersisted = db.query(`
    SELECT provider, status, timestamp
    FROM call_logs
    WHERE provider IS NOT NULL AND provider <> ''
    ORDER BY timestamp DESC, id DESC
    LIMIT 1
  `).get() as CallRow | null;
  const lastPersistedError = db.query(`
    SELECT provider, status, timestamp
    FROM call_logs
    WHERE provider IS NOT NULL AND provider <> '' AND (status < 200 OR status >= 400)
    ORDER BY timestamp DESC, id DESC
    LIMIT 1
  `).get() as CallRow | null;
  const modelStats = db.query(`
    SELECT
      COUNT(*) AS entries,
      COUNT(DISTINCT CASE
        WHEN instr(model, '/') > 0 THEN substr(model, 1, instr(model, '/') - 1)
        ELSE model
      END) AS local_catalog_like_families
    FROM model_intelligence
  `).get() as ModelStatsRow | null;
  const comboCount = db.query("SELECT COUNT(*) AS count FROM combos").get() as CountRow | null;
  const governedHermesCombos = db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN name = 'temperance-coding' THEN 1 ELSE 0 END), 0) AS temperance_coding,
      COALESCE(SUM(CASE WHEN name = 'te-build' THEN 1 ELSE 0 END), 0) AS te_build,
      COALESCE(SUM(CASE WHEN name = 'te-free-burst' THEN 1 ELSE 0 END), 0) AS te_free_burst,
      COALESCE(SUM(CASE WHEN name = 'te-reason' THEN 1 ELSE 0 END), 0) AS te_reason,
      COALESCE(SUM(CASE WHEN name = 'te-plan' THEN 1 ELSE 0 END), 0) AS te_plan
    FROM combos
  `).get() as GovernedHermesComboRow | null;
  const compressionRows = db.query(`
    SELECT key, value
    FROM key_value
    WHERE namespace = 'compression'
      AND key IN ('enabled', 'defaultMode', 'activeComboId', 'preserveSystemPrompt', 'cavemanConfig')
    ORDER BY key
  `).all() as KeyValueRow[];
  const compressionCombos = db.query(`
    SELECT id, name, pipeline, is_default
    FROM compression_combos
    ORDER BY id
  `).all() as ComboRow[];
  const a2aStates = db.query(`
    SELECT state, COUNT(*) AS count
    FROM a2a_tasks
    GROUP BY state
    ORDER BY state
  `).all() as ProtocolStateRow[];
  const mcpAudit = db.query(`
    SELECT COUNT(*) AS count, MAX(created_at) AS last_at
    FROM mcp_tool_audit
  `).get() as AuditStatsRow | null;
  if (!connectionStats || !observedStats || !modelStats || !comboCount || !governedHermesCombos || !mcpAudit) {
    fail("database_projection_missing");
  }
  return {
    connectionStats,
    observedStats,
    lastPersisted,
    lastPersistedError,
    modelStats,
    comboCount: comboCount.count,
    governedHermesCombos,
    compressionRows,
    compressionCombos,
    a2aStates,
    mcpAudit,
  };
}

export function collectNativeControlPlane(options: CollectionOptions): NativeControlPlaneSnapshot {
  const expectedUid = options.expectedUid ?? process.getuid?.();
  if (!Number.isSafeInteger(expectedUid) || expectedUid! < 0) fail("expected_uid_invalid");
  const uid = expectedUid as number;
  const beforeFile = validateDatabasePath(options.databasePath, uid);
  const beforeDescriptor = descriptorIdentity(options.databasePath, uid);
  if (!sameIdentity(beforeFile, beforeDescriptor)) fail("database_descriptor_identity_mismatch");
  assertWalDatabaseHeader(options.databasePath);
  const beforeSidecars = databaseSidecars(options.databasePath, uid);
  if (beforeSidecars.journal !== null) fail("database_hot_journal_present");
  if (beforeSidecars.wal === null || beforeSidecars.shm === null) fail("database_sidecars_unavailable");
  const beforeRuntime = options.runtimeProbe(options.databasePath);
  if (beforeRuntime.databaseBindingHash !== databaseBindingHash(beforeFile.device, beforeFile.inode)) {
    fail("runtime_database_identity_mismatch");
  }
  const beforeCloudflared = normalizedProcessIds(options.cloudflaredProcessProbe);
  const manifestPath = options.dispatchManifestPath;
  const manifestParent = dirname(manifestPath);
  canonicalPath(manifestParent, uid, "directory");
  const manifestIdentity = canonicalPath(manifestPath, uid, "file");
  if (manifestIdentity.size > MAX_MANIFEST_BYTES) fail("dispatch_manifest_too_large");
  const manifestSource = readFileSync(manifestPath, "utf8");
  const dispatch = dispatchProjection(manifestSource);
  const factory = options.databaseFactory ?? ((path: string) => new Database(path, { readonly: true, strict: true }));
  let db: Database | undefined;
  let rows: ReturnType<typeof readRows>;
  let dataVersion = 0;
  let schemaVersion: string | null = null;
  let journalMode: "wal" = "wal";
  try {
    db = factory(options.databasePath);
    db.exec("PRAGMA query_only = ON");
    db.exec("PRAGMA busy_timeout = 0");
    const journalRow = db.query("PRAGMA journal_mode").get() as { journal_mode: string } | null;
    if (journalRow?.journal_mode?.toLowerCase() !== "wal") fail("database_journal_mode_unsupported");
    journalMode = "wal";
    db.exec("BEGIN");
    assertSchema(db);
    const versionRow = db.query("PRAGMA data_version").get() as { data_version: number } | null;
    const schemaRow = db.query("SELECT value FROM db_meta WHERE key = 'schema_version' LIMIT 1").get() as
      | { value: string }
      | null;
    dataVersion = exactInteger(versionRow?.data_version, "database_data_version_invalid");
    if (schemaRow?.value !== SUPPORTED_DATABASE_SCHEMA_VERSION) fail("database_schema_version_unsupported");
    schemaVersion = schemaRow.value;
    rows = readRows(db);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db?.exec("ROLLBACK");
    } catch {}
    try {
      db?.close();
    } catch {}
    if (error instanceof NativeControlPlaneError) throw error;
    return fail("database_collection_failed");
  }
  db.close();
  const afterFile = validateDatabasePath(options.databasePath, uid);
  const afterDescriptor = descriptorIdentity(options.databasePath, uid);
  const afterSidecars = databaseSidecars(options.databasePath, uid);
  const afterRuntime = options.runtimeProbe(options.databasePath);
  const afterCloudflared = normalizedProcessIds(options.cloudflaredProcessProbe);
  if (!sameIdentity(beforeFile, afterFile)) fail("database_identity_changed");
  if (!sameIdentity(afterFile, afterDescriptor)) fail("database_descriptor_identity_mismatch");
  if (afterSidecars.journal !== null) fail("database_hot_journal_present");
  if (
    !sameOptionalIdentity(beforeSidecars.wal, afterSidecars.wal) ||
    !sameOptionalIdentity(beforeSidecars.shm, afterSidecars.shm)
  ) fail("database_sidecar_identity_changed");
  if (
    beforeRuntime.pid !== afterRuntime.pid ||
    beforeRuntime.startedHash !== afterRuntime.startedHash ||
    beforeRuntime.listener !== afterRuntime.listener ||
    beforeRuntime.version !== afterRuntime.version ||
    beforeRuntime.packageIdentityHash !== afterRuntime.packageIdentityHash ||
    beforeRuntime.databaseBindingHash !== afterRuntime.databaseBindingHash
  ) fail("runtime_identity_changed");
  if (!Number.isSafeInteger(beforeRuntime.pid) || beforeRuntime.pid <= 0) fail("runtime_identity_invalid");
  if (beforeRuntime.version !== options.installedVersion) fail("runtime_package_version_mismatch");
  if (beforeCloudflared.join(",") !== afterCloudflared.join(",")) fail("cloudflared_process_state_changed");
  const cli = options.cliProbe?.() ?? Object.fromEntries(CLI_TOOLS.map((tool) => [tool.id, false]));
  const snapshot = projectNativeControlPlane({
    ...rows,
    dispatch,
    runtime: beforeRuntime,
    database: { ...afterFile, schemaVersion, dataVersion, journalMode },
    installedVersion: options.installedVersion,
    cli,
    quickTunnel: readQuickTunnel(options.quickTunnelStatePath, uid, afterCloudflared.length > 0),
    hermesLocalStatePresent: readHermesPresence(options.hermesDirectoryPath),
    collectedAt: (options.now ?? (() => new Date()))(),
  });
  assertSnapshotSafe(snapshot);
  return snapshot;
}

function omniRoutePackageMetadata(root: string): { version: string; identityHash: string } {
  if (!isAbsolute(root) || realpathSync(root) !== root) fail("omniroute_package_layout_invalid");
  const packagePath = resolve(root, "package.json");
  const link = lstatSync(packagePath);
  if (link.isSymbolicLink() || !link.isFile() || link.nlink !== 1 || (link.mode & 0o022) !== 0) {
    fail("omniroute_package_invalid");
  }
  if (realpathSync(packagePath) !== packagePath) fail("omniroute_package_layout_invalid");
  const source = readFileSync(packagePath, "utf8");
  if (Buffer.byteLength(source, "utf8") > MAX_PACKAGE_BYTES) fail("omniroute_package_invalid");
  const parsed = boundedJson(source, "omniroute_package_invalid", MAX_PACKAGE_BYTES);
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const version = record?.version;
  if (record?.name !== "omniroute" || typeof version !== "string" || !/^\d+\.\d+\.\d+$/u.test(version)) {
    fail("omniroute_package_invalid");
  }
  return { version, identityHash: sha256(`${root}\0${source}`) };
}

export function defaultRuntimeProbe(databasePath: string): RuntimeIdentity {
  const lsof = Bun.spawnSync({
    cmd: ["/usr/sbin/lsof", "-nP", "-iTCP:20128", "-sTCP:LISTEN", "-Fpcn"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (lsof.exitCode !== 0) fail("omniroute_listener_unavailable");
  const source = new TextDecoder().decode(lsof.stdout);
  const pids = [...source.matchAll(/^p([0-9]+)$/gmu)].map((match) => Number(match[1]));
  const listeners = [...source.matchAll(/^n(.+)$/gmu)].map((match) => match[1]);
  if (pids.length !== 1 || !Number.isSafeInteger(pids[0]) || pids[0] <= 0) fail("omniroute_listener_ambiguous");
  if (listeners.length !== 1 || !["127.0.0.1:20128", "[::1]:20128"].includes(listeners[0])) {
    fail("omniroute_listener_not_loopback");
  }
  const ps = Bun.spawnSync({
    cmd: ["/bin/ps", "-p", String(pids[0]), "-o", "lstart="],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (ps.exitCode !== 0 || ps.stdout.length === 0) fail("omniroute_process_identity_unavailable");
  const cwd = Bun.spawnSync({
    cmd: ["/usr/sbin/lsof", "-a", "-p", String(pids[0]), "-d", "cwd", "-Fn"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (cwd.exitCode !== 0) fail("omniroute_process_package_unavailable");
  const cwdSource = new TextDecoder().decode(cwd.stdout);
  const runtimeDirectories = [...cwdSource.matchAll(/^n(.+)$/gmu)].map((match) => match[1]);
  if (runtimeDirectories.length !== 1) fail("omniroute_process_package_unavailable");
  const runtimeDirectory = realpathSync(runtimeDirectories[0]);
  if (basename(runtimeDirectory) !== "dist") fail("omniroute_process_package_unavailable");
  const runtimePackage = omniRoutePackageMetadata(dirname(runtimeDirectory));
  const database = Bun.spawnSync({
    cmd: ["/usr/sbin/lsof", "-a", "-p", String(pids[0]), "-FDin", "--", databasePath],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (database.exitCode !== 0) fail("omniroute_process_database_unavailable");
  const databaseSource = new TextDecoder().decode(database.stdout);
  const databaseDevices = [...databaseSource.matchAll(/^D(0x[0-9a-f]+)$/gimu)].map((match) =>
    Number.parseInt(match[1].slice(2), 16)
  );
  const databaseInodes = [...databaseSource.matchAll(/^i([0-9]+)$/gmu)].map((match) => Number(match[1]));
  const databaseNames = [...databaseSource.matchAll(/^n(.+)$/gmu)].map((match) => match[1]);
  const uniqueDevices = [...new Set(databaseDevices)];
  const uniqueInodes = [...new Set(databaseInodes)];
  if (
    uniqueDevices.length !== 1 ||
    uniqueInodes.length !== 1 ||
    databaseNames.length === 0 ||
    databaseNames.some((name) => name !== databasePath)
  ) fail("omniroute_process_database_unavailable");
  return {
    pid: pids[0],
    startedHash: sha256(new Uint8Array(ps.stdout)),
    listener: listeners[0] as RuntimeIdentity["listener"],
    version: runtimePackage.version,
    packageIdentityHash: runtimePackage.identityHash,
    databaseBindingHash: databaseBindingHash(uniqueDevices[0], uniqueInodes[0]),
  };
}

export function defaultCloudflaredProcessProbe(): number[] {
  const probe = Bun.spawnSync({
    cmd: ["/usr/bin/pgrep", "-x", "cloudflared"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (probe.exitCode === 1) return [];
  if (probe.exitCode !== 0) fail("cloudflared_process_probe_failed");
  const source = new TextDecoder().decode(probe.stdout).trim();
  if (source === "") return [];
  return source.split(/\s+/u).map((value) => Number(value));
}

export function defaultCliProbe(): Record<string, boolean> {
  return Object.fromEntries(CLI_TOOLS.map((tool) => [tool.id, Bun.which(tool.executable) !== null]));
}

export function resolveInstalledOmniRouteVersion(): string {
  const binary = Bun.which("omniroute");
  if (!binary || !isAbsolute(binary)) fail("omniroute_binary_unavailable");
  const realBinary = realpathSync(binary);
  const marker = `${sep}bin${sep}omniroute.mjs`;
  if (!realBinary.endsWith(marker)) fail("omniroute_binary_layout_invalid");
  const root = realBinary.slice(0, -marker.length);
  const rel = relative(root, realBinary);
  if (rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail("omniroute_binary_layout_invalid");
  return omniRoutePackageMetadata(root).version;
}
