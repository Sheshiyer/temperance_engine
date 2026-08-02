import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { dlopen, FFIType } from "bun:ffi";

import {
  parseStrictJsonDocument,
  validatePromotionReceipt,
  type CloudflarePromotionAdapter,
  type CloudflarePromotionManifest,
  type PromotionApprovalReceipt,
  type PromotionReceipt,
  type ResourceKind,
  type ResourceRef,
} from "./omniroute-cloudflare-promotion";

const CLOEXEC = constants.O_CLOEXEC ?? 0;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const MAX_SECRET_BYTES = 16_384;
const MAX_JOURNAL_BYTES = 65_536;
const MAX_RESPONSE_BYTES = 1_048_576;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,191}$/u;
const SAFE_STEP = /^[A-Za-z][A-Za-z0-9]{1,63}$/u;
const CF_API_ORIGIN = "https://api.cloudflare.com";
const CF_API_PREFIX = "/client/v4";
const OMNIROUTE_ORIGIN = "http://127.0.0.1:20128";
const F_FULLFSYNC = 51;

let darwinSystem: ReturnType<typeof dlopen> | null = null;

type CanaryObservations = Awaited<ReturnType<CloudflarePromotionAdapter["runCanaries"]>>;

export class ProductionAdapterFailure extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ProductionAdapterFailure";
    this.code = code;
  }
}

export interface FetchRequest {
  url: string;
  init: RequestInit;
}

export interface ApprovalReplayPort {
  /** Anti-replay only. The core verifies the authorizing signature before this call. */
  consume(input: { keyId: string; approvalId: string; expiresAt: string }): Promise<
    { consumed: true; durable: true; atomic: true; authorizing: false }
    | { consumed: false; authorizing: false }
  >;
}

export interface ChallengeLedgerApprovalReplayConfig {
  ledgerPath: string;
  receiptDirectory: string;
  now?: () => number;
  lockTimeoutMs?: number;
}

export interface ConnectorPort {
  start(input: { argv: readonly string[]; ownershipHash: string; name: string }): Promise<{
    id: string;
    state: unknown;
  }>;
  stop(): Promise<void>;
  connected(): Promise<boolean>;
  cleanupConnections(tunnelId: string): Promise<void>;
  connectionCount(tunnelId: string): Promise<number>;
  inspect(id: string): Promise<unknown | null>;
}

export interface CanaryPort {
  verifyAccessBoundary(input: {
    hostname: string;
    applicationId: string;
    policyId: string;
    serviceTokenId: string;
  }): Promise<boolean>;
  run(): Promise<CanaryObservations>;
}

export interface ProductionAdapterConfig {
  manifest: CloudflarePromotionManifest;
  repositoryRoot: string;
  omniRouteAdminTokenFile: string;
  omniRouteRemoteKeySinkFile: string;
  accessServiceTokenSinkFile: string;
  fetch: (input: FetchRequest) => Promise<Response>;
  approvalReplay: ApprovalReplayPort;
  connector: ConnectorPort;
  canaries: CanaryPort;
  now?: () => number;
}

interface OperationRecord {
  schemaVersion: 1;
  kind: "temperance.cloudflare-production-operation";
  operationId: string;
  step: string;
  state: "announced" | "prepared" | "applied" | "committed" | "aborted" | "manual_orphan";
  createdAt: string;
  updatedAt: string;
  requestHash: string | null;
  resourceName: string | null;
  ownershipHash: string | null;
  responseStatus: number | null;
  responseHash: string | null;
  ref: ResourceRef | null;
  nonClaims: readonly ["external_authority", "remote_ownership_without_readback"];
}

interface PendingOperation {
  path: string;
  record: OperationRecord;
}

interface OmniRouteKeyPlan {
  supported: false;
  code: "omniroute_policy_not_exact";
  unmappedControls: readonly ["session.maxRequests", "session.maxDurationSeconds", "rate.burst", "exact_endpoint_path"];
  request: {
    name: string;
    noLog: true;
    isActive: true;
    allowedModels: string[];
    allowedEndpoints: ["chat"];
    scopes: ["chat"];
    allowUsageCommand: false;
    usageLimitEnabled: true;
    dailyUsageLimitUsd: number;
    weeklyUsageLimitUsd: number;
    rateLimits: Array<{ limit: number; window: "minute" }>;
  };
}

function fail(code: string): never {
  throw new ProductionAdapterFailure(code);
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") fail("canonical_value_invalid");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function hashBytes(value: Buffer | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function nowIso(now: () => number): string {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) fail("production_clock_invalid");
  return new Date(value).toISOString();
}

function currentUid(): number {
  if (typeof process.getuid !== "function") fail("production_euid_unavailable");
  return process.getuid();
}

function canonicalExternalPath(path: string, repositoryRoot: string, code: string): string {
  if (!isAbsolute(path) || path !== resolve(path) || path !== path.normalize("NFC") || path.includes("\0")) fail(code);
  const repository = resolve(repositoryRoot);
  const rel = relative(repository, path);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) fail(code);
  return path;
}

function assertOwnerOnlyDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("production_directory_invalid");
  if (stat.uid !== currentUid()) fail("production_directory_owner_invalid");
  if ((stat.mode & 0o777) !== 0o700) fail("production_directory_mode_invalid");
  if (resolve(path) !== path || path !== path.normalize("NFC") || realpathSync(path) !== path) fail("production_directory_path_invalid");
}

function openOwnerOnlyRegular(path: string, maxBytes: number, role = "secret"): number {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) fail(`production_${role}_file_invalid`);
  if (realpathSync(path) !== path) fail(`production_${role}_path_invalid`);
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW | CLOEXEC);
  try {
    const after = fstatSync(fd);
    if (!after.isFile() || after.isSymbolicLink()) fail(`production_${role}_file_invalid`);
    if (after.dev !== before.dev || after.ino !== before.ino) fail(`production_${role}_file_raced`);
    if (after.uid !== currentUid()) fail(`production_${role}_owner_invalid`);
    if ((after.mode & 0o777) !== 0o600) fail(`production_${role}_mode_invalid`);
    if (after.nlink !== 1) fail(`production_${role}_hardlink_invalid`);
    if (after.size < 1 || after.size > maxBytes) fail(`production_${role}_size_invalid`);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function readOwnerOnlyRegularFile(path: string, maxBytes: number, role: "receipt" | "operation"): Buffer {
  const fd = openOwnerOnlyRegular(path, maxBytes, role);
  try {
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function readOwnerOnlySecretFile(path: string, repositoryRoot: string): Buffer {
  const canonicalPath = canonicalExternalPath(path, repositoryRoot, "production_secret_path_invalid");
  const fd = openOwnerOnlyRegular(canonicalPath, MAX_SECRET_BYTES);
  try {
    const source = readFileSync(fd);
    let end = source.length;
    while (end > 0 && (source[end - 1] === 0x0a || source[end - 1] === 0x0d)) end -= 1;
    if (end === 0 || source.subarray(0, end).includes(0)) {
      source.fill(0);
      fail("production_secret_content_invalid");
    }
    const result = Buffer.from(source.subarray(0, end));
    source.fill(0);
    return result;
  } finally {
    closeSync(fd);
  }
}

function durableSync(fd: number): void {
  fsyncSync(fd);
  if (process.platform !== "darwin") return;
  if (!darwinSystem) {
    darwinSystem = dlopen("/usr/lib/libSystem.B.dylib", {
      fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    });
  }
  if (Number(darwinSystem.symbols.fcntl(fd, F_FULLFSYNC, 0)) !== 0) fail("production_full_fsync_failed");
}

function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | CLOEXEC);
  try {
    durableSync(fd);
  } finally {
    closeSync(fd);
  }
}

function atomicWriteOwnerOnly(path: string, bytes: Buffer | string, exclusive = false): void {
  assertOwnerOnlyDirectory(dirname(path));
  if (exclusive) {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW | CLOEXEC, 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeFileSync(fd, bytes);
      durableSync(fd);
    } finally {
      closeSync(fd);
    }
    syncDirectory(dirname(path));
    return;
  }
  try {
    const existing = lstatSync(path);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.uid !== currentUid() || (existing.mode & 0o777) !== 0o600 || existing.nlink !== 1) {
      fail("production_existing_target_invalid");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW | CLOEXEC, 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeFileSync(fd, bytes);
    durableSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, path);
    syncDirectory(dirname(path));
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* exact temporary cleanup only */ }
    throw error;
  }
}

function writeSecretSink(path: string, bytes: Buffer, repositoryRoot: string): { hash: string; size: number } {
  const target = canonicalExternalPath(path, repositoryRoot, "production_secret_sink_path_invalid");
  assertOwnerOnlyDirectory(dirname(target));
  const digest = hashBytes(bytes);
  const size = bytes.length;
  try {
    atomicWriteOwnerOnly(target, bytes, true);
    const fd = openOwnerOnlyRegular(target, MAX_SECRET_BYTES);
    closeSync(fd);
    return { hash: digest, size };
  } finally {
    bytes.fill(0);
  }
}

function removeOwnedSecret(path: string, repositoryRoot: string): void {
  const target = canonicalExternalPath(path, repositoryRoot, "production_secret_sink_path_invalid");
  try {
    const fd = openOwnerOnlyRegular(target, MAX_SECRET_BYTES);
    closeSync(fd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  unlinkSync(target);
  syncDirectory(dirname(target));
}

function redactText(value: string, secrets: readonly string[]): string {
  let output = value;
  for (const secret of secrets) {
    if (secret.length > 0) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function assertSafeResponseUrl(response: Response, expectedOrigin: string): void {
  if (!response.url) return;
  const actual = new URL(response.url);
  if (actual.origin !== expectedOrigin) fail("production_redirect_forbidden");
}

async function responseBytes(response: Response): Promise<Buffer> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES)) fail("production_response_oversized");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE_BYTES) {
    bytes.fill(0);
    fail("production_response_oversized");
  }
  return bytes;
}

function parseJsonBytes(bytes: Buffer, code: string): Record<string, unknown> {
  try {
    const parsed = parseStrictJsonDocument(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail(code);
    return parsed as Record<string, unknown>;
  } catch {
    fail(code);
  }
}

function cloudflareResult(envelope: Record<string, unknown>): unknown {
  if (envelope.success !== true || !("result" in envelope)) fail("cloudflare_api_failure");
  return envelope.result;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function identifier(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,191}$/u.test(value)) fail(code);
  return value;
}

function stateHash(kind: ResourceKind, stable: unknown): string {
  return hash({ domain: "temperance.cloudflare-production-resource.v1", kind, stable });
}

export function buildOmniRouteKeyPlan(input: {
  name: string;
  model: string;
  policy: CloudflarePromotionManifest["remoteKey"]["policy"];
}): OmniRouteKeyPlan {
  return {
    supported: false,
    code: "omniroute_policy_not_exact",
    unmappedControls: ["session.maxRequests", "session.maxDurationSeconds", "rate.burst", "exact_endpoint_path"],
    request: {
      name: input.name,
      noLog: true,
      isActive: true,
      allowedModels: [input.model],
      allowedEndpoints: ["chat"],
      scopes: ["chat"],
      allowUsageCommand: false,
      usageLimitEnabled: true,
      dailyUsageLimitUsd: input.policy.spendUsd.daily,
      weeklyUsageLimitUsd: input.policy.spendUsd.weekly,
      rateLimits: [{ limit: input.policy.rate.requestsPerMinute, window: "minute" }],
    },
  };
}

function stableCloudflare(kind: ResourceKind, value: Record<string, unknown>): Record<string, unknown> {
  if (kind === "serviceToken") return { id: value.id, name: value.name };
  if (kind === "accessApplication") return { id: value.id, name: value.name, domain: value.domain, type: value.type };
  if (kind === "accessPolicy") return { id: value.id, name: value.name, decision: value.decision, include: value.include };
  if (kind === "tunnel") return { id: value.id, name: value.name, config_src: value.config_src };
  if (kind === "dns") return {
    id: value.id,
    name: value.name,
    type: value.type,
    content: value.content,
    proxied: value.proxied,
    ttl: value.ttl,
    comment: value.comment,
    tags: value.tags,
  };
  return value;
}

function operationFile(directory: string, step: string): string {
  if (!SAFE_STEP.test(step)) fail("production_operation_step_invalid");
  return join(directory, `operation-${Date.now()}-${process.pid}-${randomUUID()}-${step}.json`);
}

function parseOperationRecord(bytes: Buffer, filename: string): OperationRecord {
  try {
    const value = parseStrictJsonDocument(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("production_operation_record_invalid");
    const record = value as Record<string, unknown>;
    const exactKeys = [
      "schemaVersion", "kind", "operationId", "step", "state", "createdAt", "updatedAt",
      "requestHash", "resourceName", "ownershipHash", "responseStatus", "responseHash", "ref", "nonClaims",
    ];
    if (Object.keys(record).sort().join("\0") !== exactKeys.sort().join("\0")) fail("production_operation_record_invalid");
    if (record.schemaVersion !== 1 || record.kind !== "temperance.cloudflare-production-operation") fail("production_operation_record_invalid");
    if (typeof record.operationId !== "string" || !SAFE_ID.test(record.operationId)) fail("production_operation_record_invalid");
    if (typeof record.step !== "string" || !SAFE_STEP.test(record.step) || !filename.endsWith(`-${record.step}.json`)) fail("production_operation_record_invalid");
    if (!["announced", "prepared", "applied", "committed", "aborted", "manual_orphan"].includes(String(record.state))) fail("production_operation_record_invalid");
    const createdAt = Date.parse(String(record.createdAt));
    const updatedAt = Date.parse(String(record.updatedAt));
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || updatedAt < createdAt) fail("production_operation_record_invalid");
    if (record.requestHash !== null && (typeof record.requestHash !== "string" || !HASH.test(record.requestHash))) fail("production_operation_record_invalid");
    if (record.resourceName !== null && (typeof record.resourceName !== "string" || !SAFE_ID.test(record.resourceName))) fail("production_operation_record_invalid");
    if (record.ownershipHash !== null && (typeof record.ownershipHash !== "string" || !HASH.test(record.ownershipHash))) fail("production_operation_record_invalid");
    if (record.responseStatus !== null && (!Number.isSafeInteger(record.responseStatus) || Number(record.responseStatus) < 100 || Number(record.responseStatus) > 599)) fail("production_operation_record_invalid");
    if (record.responseHash !== null && (typeof record.responseHash !== "string" || !HASH.test(record.responseHash))) fail("production_operation_record_invalid");
    if (!Array.isArray(record.nonClaims) || record.nonClaims.join("\0") !== "external_authority\0remote_ownership_without_readback") fail("production_operation_record_invalid");
    if (record.ref !== null) {
      if (!record.ref || typeof record.ref !== "object" || Array.isArray(record.ref)) fail("production_operation_ref_invalid");
      const ref = record.ref as Record<string, unknown>;
      if (Object.keys(ref).sort().join("\0") !== ["id", "kind", "name", "ownershipHash", "stateHash"].sort().join("\0")) fail("production_operation_ref_invalid");
      if (typeof ref.kind !== "string" || typeof ref.id !== "string" || typeof ref.name !== "string" || !SAFE_ID.test(ref.id) || !SAFE_ID.test(ref.name)) fail("production_operation_ref_invalid");
      if (ref.ownershipHash !== record.ownershipHash || typeof ref.stateHash !== "string" || !HASH.test(ref.stateHash)) fail("production_operation_ref_invalid");
    }
    return record as unknown as OperationRecord;
  } catch (error) {
    if (error instanceof ProductionAdapterFailure) throw error;
    fail("production_operation_record_invalid");
  } finally {
    bytes.fill(0);
  }
}

export class OmniRouteCloudflareProductionAdapter implements CloudflarePromotionAdapter {
  private readonly now: () => number;
  private readonly refs = new Map<ResourceKind, ResourceRef>();
  private pending: PendingOperation | null = null;
  private journalReady = false;
  private tunnelConfigurationValue: unknown = null;

  constructor(private readonly config: ProductionAdapterConfig) {
    if (!config || typeof config.fetch !== "function" || !config.approvalReplay || !config.connector || !config.canaries) {
      fail("production_adapter_config_invalid");
    }
    this.now = config.now ?? Date.now;
    canonicalExternalPath(config.omniRouteAdminTokenFile, config.repositoryRoot, "omniroute_admin_token_path_invalid");
    canonicalExternalPath(config.omniRouteRemoteKeySinkFile, config.repositoryRoot, "omniroute_key_sink_path_invalid");
    canonicalExternalPath(config.accessServiceTokenSinkFile, config.repositoryRoot, "access_token_sink_path_invalid");
    canonicalExternalPath(config.manifest.paths.cloudflareTokenFile, config.repositoryRoot, "cloudflare_token_path_invalid");
    canonicalExternalPath(config.manifest.paths.connectorTokenFile, config.repositoryRoot, "connector_token_path_invalid");
    canonicalExternalPath(config.manifest.paths.journalDirectory, config.repositoryRoot, "journal_path_invalid");
    canonicalExternalPath(config.manifest.paths.receiptFile, config.repositoryRoot, "receipt_path_invalid");
  }

  async openControlPlane(): Promise<void> {
    const cloudflare = readOwnerOnlySecretFile(this.config.manifest.paths.cloudflareTokenFile, this.config.repositoryRoot);
    const omniRoute = readOwnerOnlySecretFile(this.config.omniRouteAdminTokenFile, this.config.repositoryRoot);
    try {
      if (!/^oma_[A-Za-z0-9_-]{12,}$/u.test(omniRoute.toString("utf8"))) fail("omniroute_admin_token_invalid");
      if (cloudflare.length < 20) fail("cloudflare_token_invalid");
    } finally {
      cloudflare.fill(0);
      omniRoute.fill(0);
    }
  }

  async beginJournal(): Promise<void> {
    assertOwnerOnlyDirectory(this.config.manifest.paths.journalDirectory);
    if (dirname(this.config.manifest.paths.receiptFile) !== this.config.manifest.paths.journalDirectory) fail("receipt_directory_mismatch");
    this.journalReady = true;
  }

  private requireJournal(): void {
    if (!this.journalReady) fail("production_journal_not_ready");
  }

  private persistOperation(pending: PendingOperation, exclusive = false): void {
    atomicWriteOwnerOnly(pending.path, canonical(pending.record), exclusive);
  }

  private abortPending(state: "aborted" | "manual_orphan"): void {
    if (!this.pending) return;
    this.pending.record = { ...this.pending.record, state, updatedAt: nowIso(this.now) };
    this.persistOperation(this.pending);
    this.pending = null;
  }

  private prepareLocalMutation(step: string, resourceName: string, ownershipHash: string, descriptor: unknown): PendingOperation {
    const pending = this.pending;
    if (!pending || pending.record.step !== step) fail("production_operation_step_mismatch");
    pending.record = {
      ...pending.record,
      state: "prepared",
      updatedAt: nowIso(this.now),
      requestHash: hash(descriptor),
      resourceName,
      ownershipHash,
    };
    this.persistOperation(pending);
    return pending;
  }

  async beforeMutation(step: string): Promise<void> {
    this.requireJournal();
    if (this.pending) fail("production_operation_already_pending");
    const time = nowIso(this.now);
    const pending: PendingOperation = {
      path: operationFile(this.config.manifest.paths.journalDirectory, step),
      record: {
        schemaVersion: 1,
        kind: "temperance.cloudflare-production-operation",
        operationId: randomUUID(),
        step,
        state: "announced",
        createdAt: time,
        updatedAt: time,
        requestHash: null,
        resourceName: null,
        ownershipHash: null,
        responseStatus: null,
        responseHash: null,
        ref: null,
        nonClaims: ["external_authority", "remote_ownership_without_readback"],
      },
    };
    this.persistOperation(pending, true);
    this.pending = pending;
  }

  async afterMutation(step: string): Promise<void> {
    if (!this.pending || this.pending.record.step !== step || this.pending.record.state !== "applied") fail("production_operation_not_applied");
    this.pending.record = { ...this.pending.record, state: "committed", updatedAt: nowIso(this.now) };
    this.persistOperation(this.pending);
    this.pending = null;
  }

  async writeReceipt(receipt: PromotionReceipt): Promise<void> {
    this.requireJournal();
    const validation = validatePromotionReceipt(receipt);
    if (!validation.valid) fail("production_receipt_invalid");
    atomicWriteOwnerOnly(this.config.manifest.paths.receiptFile, canonical(receipt));
  }

  async consumeApproval(approval: PromotionApprovalReceipt): Promise<{ consumed: true; durable: true; atomic: true } | { consumed: false }> {
    const result = await this.config.approvalReplay.consume({
      keyId: approval.keyId,
      approvalId: approval.approvalId,
      expiresAt: approval.expiresAt,
    });
    if (result.authorizing !== false) fail("approval_replay_port_overclaims_authority");
    if (result.consumed !== true) return { consumed: false };
    if (result.durable !== true || result.atomic !== true) fail("approval_replay_not_durable");
    return { consumed: true, durable: true, atomic: true };
  }

  private async request(input: {
    plane: "cloudflare" | "omniroute";
    method: string;
    path: string;
    body?: unknown;
    step: string;
    resourceName: string;
    ownershipHash: string;
  }): Promise<{ status: number; body: Record<string, unknown>; rawHash: string }> {
    this.requireJournal();
    if (!HASH.test(input.ownershipHash)) fail("production_ownership_hash_invalid");
    let standalone = false;
    if (!this.pending) {
      await this.beforeMutation(input.step);
      standalone = true;
    }
    const pending = this.pending;
    if (!pending || pending.record.step !== input.step) fail("production_operation_step_mismatch");

    const requestDescriptor = {
      plane: input.plane,
      method: input.method,
      path: input.path,
      body: input.body ?? null,
      resourceName: input.resourceName,
      ownershipHash: input.ownershipHash,
    };
    pending.record = {
      ...pending.record,
      state: "prepared",
      updatedAt: nowIso(this.now),
      requestHash: hash(requestDescriptor),
      resourceName: input.resourceName,
      ownershipHash: input.ownershipHash,
    };
    this.persistOperation(pending);

    const tokenPath = input.plane === "cloudflare"
      ? this.config.manifest.paths.cloudflareTokenFile
      : this.config.omniRouteAdminTokenFile;
    const tokenBytes = readOwnerOnlySecretFile(tokenPath, this.config.repositoryRoot);
    const token = tokenBytes.toString("utf8");
    const origin = input.plane === "cloudflare" ? CF_API_ORIGIN : OMNIROUTE_ORIGIN;
    const prefix = input.plane === "cloudflare" ? CF_API_PREFIX : "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.manifest.limits.operationTimeoutMs);
    let response: Response;
    try {
      response = await this.config.fetch({
        url: `${origin}${prefix}${input.path}`,
        init: {
          method: input.method,
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            ...(input.body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(input.body === undefined ? {} : { body: canonical(input.body) }),
        },
      });
    } catch {
      pending.record = { ...pending.record, state: "manual_orphan", updatedAt: nowIso(this.now) };
      this.persistOperation(pending);
      tokenBytes.fill(0);
      clearTimeout(timeout);
      this.pending = null;
      fail(`production_${input.step}_outcome_ambiguous`);
    }
    clearTimeout(timeout);
    tokenBytes.fill(0);
    assertSafeResponseUrl(response, origin);
    const bytes = await responseBytes(response);
    const rawHash = hashBytes(bytes);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (response.status >= 300 && response.status < 400) {
      bytes.fill(0);
      pending.record = { ...pending.record, state: "aborted", updatedAt: nowIso(this.now), responseStatus: response.status, responseHash: rawHash };
      this.persistOperation(pending);
      this.pending = null;
      fail("production_redirect_forbidden");
    }
    if (!contentType.includes("application/json")) {
      const looksLikeAccess = contentType.includes("text/html") || response.status === 401 || response.status === 403;
      bytes.fill(0);
      pending.record = { ...pending.record, state: "aborted", updatedAt: nowIso(this.now), responseStatus: response.status, responseHash: rawHash };
      this.persistOperation(pending);
      this.pending = null;
      fail(looksLikeAccess ? "production_access_auth_failure" : "production_response_not_json");
    }
    const body = parseJsonBytes(bytes, "production_response_json_invalid");
    bytes.fill(0);
    if (!response.ok) {
      pending.record = { ...pending.record, state: "aborted", updatedAt: nowIso(this.now), responseStatus: response.status, responseHash: rawHash };
      this.persistOperation(pending);
      this.pending = null;
      fail(input.plane === "cloudflare" ? "cloudflare_api_failure" : "omniroute_api_failure");
    }
    pending.record = { ...pending.record, updatedAt: nowIso(this.now), responseStatus: response.status, responseHash: rawHash };
    this.persistOperation(pending);
    if (standalone) {
      // The resource reference is attached by finishResource before commit.
    }
    return { status: response.status, body, rawHash };
  }

  private finishResource(kind: ResourceKind, name: string, ownershipHash: string, id: string, stable: unknown): ResourceRef {
    if (!this.pending || this.pending.record.state !== "prepared") fail("production_operation_missing");
    const ref: ResourceRef = { kind, id, name, ownershipHash, stateHash: stateHash(kind, stable) };
    this.refs.set(kind, ref);
    this.pending.record = { ...this.pending.record, state: "applied", updatedAt: nowIso(this.now), ref };
    this.persistOperation(this.pending);
    return ref;
  }

  async createRemoteKey(input: { name: string; ownershipHash: string; model?: string; policy?: CloudflarePromotionManifest["remoteKey"]["policy"] }): Promise<ResourceRef> {
    if (!input.model || !input.policy) {
      this.abortPending("aborted");
      fail("omniroute_policy_missing");
    }
    const plan = buildOmniRouteKeyPlan({ name: input.name, model: input.model, policy: input.policy });
    // OmniRoute 3.8.48 cannot enforce the manifest's session request/duration,
    // burst, or exact-path boundary. Do not create a weaker key and label it exact.
    if (!plan.supported) {
      this.abortPending("aborted");
      fail(plan.code);
    }
    return fail("omniroute_policy_unreachable");
  }

  async createServiceToken(input: { name: string; ownershipHash: string }): Promise<ResourceRef> {
    const result = await this.request({
      plane: "cloudflare",
      method: "POST",
      path: `/accounts/${this.config.manifest.accountId}/access/service_tokens`,
      body: { name: input.name, duration: "8760h" },
      step: "serviceToken",
      resourceName: input.name,
      ownershipHash: input.ownershipHash,
    });
    const value = record(cloudflareResult(result.body), "cloudflare_service_token_result_invalid");
    const id = identifier(value.id, "cloudflare_service_token_id_invalid");
    const clientId = identifier(value.client_id, "cloudflare_service_token_client_id_invalid");
    if (typeof value.client_secret !== "string" || value.client_secret.length < 16) fail("cloudflare_service_token_secret_invalid");
    const secret = Buffer.from(canonical({ clientId, clientSecret: value.client_secret }), "utf8");
    writeSecretSink(this.config.accessServiceTokenSinkFile, secret, this.config.repositoryRoot);
    delete value.client_secret;
    return this.finishResource("serviceToken", input.name, input.ownershipHash, id, stableCloudflare("serviceToken", value));
  }

  async createAccessApplication(input: { name: string; ownershipHash: string; hostname?: string }): Promise<ResourceRef> {
    if (input.hostname !== this.config.manifest.hostname) fail("cloudflare_access_hostname_invalid");
    const result = await this.request({
      plane: "cloudflare",
      method: "POST",
      path: `/accounts/${this.config.manifest.accountId}/access/apps`,
      body: { name: input.name, domain: input.hostname, type: "self_hosted", app_launcher_visible: false },
      step: "accessApplication",
      resourceName: input.name,
      ownershipHash: input.ownershipHash,
    });
    const value = record(cloudflareResult(result.body), "cloudflare_access_application_result_invalid");
    const id = identifier(value.id, "cloudflare_access_application_id_invalid");
    return this.finishResource("accessApplication", input.name, input.ownershipHash, id, stableCloudflare("accessApplication", value));
  }

  async createAccessPolicy(input: { name: string; ownershipHash: string; decision: string; include: unknown }): Promise<ResourceRef> {
    if (input.decision !== "non_identity" || !Array.isArray(input.include) || canonical(input.include).includes("everyone") || canonical(input.include).includes("bypass")) {
      fail("cloudflare_access_policy_invalid");
    }
    const application = this.refs.get("accessApplication");
    if (!application) fail("cloudflare_access_application_missing");
    const result = await this.request({
      plane: "cloudflare",
      method: "POST",
      path: `/accounts/${this.config.manifest.accountId}/access/apps/${application.id}/policies`,
      body: { name: input.name, decision: "non_identity", include: input.include, precedence: 1 },
      step: "accessPolicy",
      resourceName: input.name,
      ownershipHash: input.ownershipHash,
    });
    const value = record(cloudflareResult(result.body), "cloudflare_access_policy_result_invalid");
    const id = identifier(value.id, "cloudflare_access_policy_id_invalid");
    return this.finishResource("accessPolicy", input.name, input.ownershipHash, id, stableCloudflare("accessPolicy", value));
  }

  async verifyAccessBoundary(): Promise<boolean> {
    const application = this.refs.get("accessApplication");
    const policy = this.refs.get("accessPolicy");
    const token = this.refs.get("serviceToken");
    if (!application || !policy || !token) return false;
    return this.config.canaries.verifyAccessBoundary({
      hostname: this.config.manifest.hostname,
      applicationId: application.id,
      policyId: policy.id,
      serviceTokenId: token.id,
    });
  }

  async createTunnel(input: { name: string; ownershipHash: string }): Promise<ResourceRef> {
    const result = await this.request({
      plane: "cloudflare",
      method: "POST",
      path: `/accounts/${this.config.manifest.accountId}/cfd_tunnel`,
      body: { name: input.name, config_src: "cloudflare" },
      step: "tunnel",
      resourceName: input.name,
      ownershipHash: input.ownershipHash,
    });
    const value = record(cloudflareResult(result.body), "cloudflare_tunnel_result_invalid");
    const id = identifier(value.id, "cloudflare_tunnel_id_invalid");
    return this.finishResource("tunnel", input.name, input.ownershipHash, id, stableCloudflare("tunnel", value));
  }

  async putTunnelConfiguration(input: { tunnelId: string; ownershipHash: string; configuration: ReturnType<typeof import("./omniroute-cloudflare-promotion").tunnelConfiguration> }): Promise<ResourceRef> {
    const result = await this.request({
      plane: "cloudflare",
      method: "PUT",
      path: `/accounts/${this.config.manifest.accountId}/cfd_tunnel/${input.tunnelId}/configurations`,
      body: input.configuration,
      step: "tunnelConfiguration",
      resourceName: "remote-managed",
      ownershipHash: input.ownershipHash,
    });
    cloudflareResult(result.body);
    this.tunnelConfigurationValue = structuredClone(input.configuration);
    return this.finishResource("tunnelConfiguration", "remote-managed", input.ownershipHash, input.tunnelId, input.configuration);
  }

  async verifyTunnelConfiguration(): Promise<boolean> {
    const tunnel = this.refs.get("tunnel");
    const ref = this.refs.get("tunnelConfiguration");
    if (!tunnel || !ref || this.tunnelConfigurationValue === null) return false;
    const result = await this.request({
      plane: "cloudflare",
      method: "GET",
      path: `/accounts/${this.config.manifest.accountId}/cfd_tunnel/${tunnel.id}/configurations`,
      step: "tunnelConfigurationReadback",
      resourceName: "remote-managed",
      ownershipHash: ref.ownershipHash,
    });
    const value = cloudflareResult(result.body);
    if (this.pending) {
      this.pending.record = { ...this.pending.record, state: "aborted", updatedAt: nowIso(this.now) };
      this.persistOperation(this.pending);
      this.pending = null;
    }
    return hash(value) === hash(this.tunnelConfigurationValue);
  }

  async materializeConnectorToken(input: { tunnelId: string; path: string; ownershipHash: string }): Promise<ResourceRef> {
    if (input.path !== this.config.manifest.paths.connectorTokenFile) fail("connector_token_sink_mismatch");
    const result = await this.request({
      plane: "cloudflare",
      method: "GET",
      path: `/accounts/${this.config.manifest.accountId}/cfd_tunnel/${input.tunnelId}/token`,
      step: "connectorTokenFile",
      resourceName: basename(input.path),
      ownershipHash: input.ownershipHash,
    });
    const token = cloudflareResult(result.body);
    if (typeof token !== "string" || token.length < 32) fail("cloudflare_tunnel_token_invalid");
    const metadata = writeSecretSink(input.path, Buffer.from(token, "utf8"), this.config.repositoryRoot);
    return this.finishResource("connectorTokenFile", basename(input.path), input.ownershipHash, input.tunnelId, metadata);
  }

  async startConnector(input: { argv: readonly string[]; ownershipHash: string }): Promise<ResourceRef> {
    if (canonical(input.argv) !== canonical(["cloudflared", "tunnel", "run", "--token-file", this.config.manifest.paths.connectorTokenFile, this.refs.get("tunnel")?.id])) {
      fail("connector_argv_invalid");
    }
    this.prepareLocalMutation("connector", this.config.manifest.names.connector, input.ownershipHash, {
      argv: input.argv,
      ownershipHash: input.ownershipHash,
      name: this.config.manifest.names.connector,
    });
    let result: Awaited<ReturnType<ConnectorPort["start"]>>;
    try {
      result = await this.config.connector.start({ argv: input.argv, ownershipHash: input.ownershipHash, name: this.config.manifest.names.connector });
    } catch {
      this.abortPending("manual_orphan");
      fail("production_connector_outcome_ambiguous");
    }
    const id = identifier(result.id, "connector_id_invalid");
    return this.finishResource("connector", this.config.manifest.names.connector, input.ownershipHash, id, result.state);
  }

  async waitForConnector(): Promise<boolean> { return this.config.connector.connected(); }

  async createDns(input: { target: string; proxied: true; ownershipHash: string }): Promise<ResourceRef> {
    const tunnel = this.refs.get("tunnel");
    if (!tunnel || input.target !== `${tunnel.id}.cfargotunnel.com` || input.proxied !== true) fail("cloudflare_dns_target_invalid");
    const result = await this.request({
      plane: "cloudflare",
      method: "POST",
      path: `/zones/${this.config.manifest.zoneId}/dns_records`,
      body: {
        type: "CNAME",
        name: this.config.manifest.hostname,
        content: input.target,
        proxied: true,
        ttl: 1,
        comment: `temperance-owner=${input.ownershipHash}`,
        tags: [`temperance_owner:${input.ownershipHash.slice("sha256:".length)}`],
      },
      step: "dns",
      resourceName: this.config.manifest.hostname,
      ownershipHash: input.ownershipHash,
    });
    const value = record(cloudflareResult(result.body), "cloudflare_dns_result_invalid");
    const id = identifier(value.id, "cloudflare_dns_id_invalid");
    return this.finishResource("dns", this.config.manifest.hostname, input.ownershipHash, id, stableCloudflare("dns", value));
  }

  async runCanaries(): Promise<CanaryObservations> { return this.config.canaries.run(); }

  private async inspectCloudflare(ref: ResourceRef): Promise<ResourceRef | null> {
    let path: string;
    if (ref.kind === "serviceToken") path = `/accounts/${this.config.manifest.accountId}/access/service_tokens/${ref.id}`;
    else if (ref.kind === "accessApplication") path = `/accounts/${this.config.manifest.accountId}/access/apps/${ref.id}`;
    else if (ref.kind === "accessPolicy") {
      const app = this.refs.get("accessApplication");
      if (!app) return null;
      path = `/accounts/${this.config.manifest.accountId}/access/apps/${app.id}/policies/${ref.id}`;
    } else if (ref.kind === "tunnel") path = `/accounts/${this.config.manifest.accountId}/cfd_tunnel/${ref.id}`;
    else if (ref.kind === "dns") path = `/zones/${this.config.manifest.zoneId}/dns_records/${ref.id}`;
    else return null;
    const result = await this.request({
      plane: "cloudflare",
      method: "GET",
      path,
      step: `${ref.kind}Inspect`,
      resourceName: ref.name,
      ownershipHash: ref.ownershipHash,
    });
    const value = record(cloudflareResult(result.body), "cloudflare_inspect_result_invalid");
    if (this.pending) {
      this.pending.record = { ...this.pending.record, state: "aborted", updatedAt: nowIso(this.now) };
      this.persistOperation(this.pending);
      this.pending = null;
    }
    return {
      ...ref,
      stateHash: stateHash(ref.kind, stableCloudflare(ref.kind, value)),
    };
  }

  async inspectResource(ref: ResourceRef): Promise<ResourceRef | null> {
    if (ref.kind === "connector") {
      const value = await this.config.connector.inspect(ref.id);
      return value === null ? null : { ...ref, stateHash: stateHash("connector", value) };
    }
    if (ref.kind === "connectorTokenFile") {
      try {
        const bytes = readOwnerOnlySecretFile(this.config.manifest.paths.connectorTokenFile, this.config.repositoryRoot);
        const stable = { hash: hashBytes(bytes), size: bytes.length };
        bytes.fill(0);
        return { ...ref, stateHash: stateHash("connectorTokenFile", stable) };
      } catch { return null; }
    }
    if (ref.kind === "tunnelConfiguration") {
      const tunnel = this.refs.get("tunnel");
      if (!tunnel) return null;
      const result = await this.request({ plane: "cloudflare", method: "GET", path: `/accounts/${this.config.manifest.accountId}/cfd_tunnel/${tunnel.id}/configurations`, step: "tunnelConfigurationInspect", resourceName: ref.name, ownershipHash: ref.ownershipHash });
      const value = cloudflareResult(result.body);
      if (this.pending) { this.pending.record = { ...this.pending.record, state: "aborted", updatedAt: nowIso(this.now) }; this.persistOperation(this.pending); this.pending = null; }
      return { ...ref, stateHash: stateHash("tunnelConfiguration", value) };
    }
    if (ref.kind === "remoteKey") return null;
    return this.inspectCloudflare(ref);
  }

  async stopConnector(): Promise<void> { await this.config.connector.stop(); }

  private async deleteCloudflare(kind: ResourceKind, path: string): Promise<void> {
    const ref = this.refs.get(kind);
    if (!ref) return;
    await this.request({ plane: "cloudflare", method: "DELETE", path, step: `${kind}Delete`, resourceName: ref.name, ownershipHash: ref.ownershipHash });
    if (this.pending) { this.pending.record = { ...this.pending.record, state: "committed", updatedAt: nowIso(this.now) }; this.persistOperation(this.pending); this.pending = null; }
    this.refs.delete(kind);
  }

  async deleteDns(): Promise<void> {
    const ref = this.refs.get("dns");
    if (ref) await this.deleteCloudflare("dns", `/zones/${this.config.manifest.zoneId}/dns_records/${ref.id}`);
  }

  async cleanupConnections(): Promise<void> {
    const tunnel = this.refs.get("tunnel");
    if (tunnel) await this.config.connector.cleanupConnections(tunnel.id);
  }

  async connectionCount(): Promise<number> {
    const tunnel = this.refs.get("tunnel");
    return tunnel ? this.config.connector.connectionCount(tunnel.id) : 0;
  }

  async wait(milliseconds = this.config.manifest.limits.connectionPollIntervalMs): Promise<void> {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
  }

  async deleteTunnel(): Promise<void> {
    const ref = this.refs.get("tunnel");
    if (ref) await this.deleteCloudflare("tunnel", `/accounts/${this.config.manifest.accountId}/cfd_tunnel/${ref.id}?cascade=true`);
    this.refs.delete("tunnelConfiguration");
  }

  async deleteAccessPolicy(): Promise<void> {
    const ref = this.refs.get("accessPolicy");
    const app = this.refs.get("accessApplication");
    if (ref && app) await this.deleteCloudflare("accessPolicy", `/accounts/${this.config.manifest.accountId}/access/apps/${app.id}/policies/${ref.id}`);
  }

  async deleteAccessApplication(): Promise<void> {
    const ref = this.refs.get("accessApplication");
    if (ref) await this.deleteCloudflare("accessApplication", `/accounts/${this.config.manifest.accountId}/access/apps/${ref.id}`);
  }

  async deleteServiceToken(): Promise<void> {
    const ref = this.refs.get("serviceToken");
    if (ref) await this.deleteCloudflare("serviceToken", `/accounts/${this.config.manifest.accountId}/access/service_tokens/${ref.id}`);
  }

  async deleteRemoteKey(): Promise<void> {
    const ref = this.refs.get("remoteKey");
    if (!ref) return;
    await this.request({ plane: "omniroute", method: "DELETE", path: `/api/keys/${ref.id}`, step: "remoteKeyDelete", resourceName: ref.name, ownershipHash: ref.ownershipHash });
    if (this.pending) { this.pending.record = { ...this.pending.record, state: "committed", updatedAt: nowIso(this.now) }; this.persistOperation(this.pending); this.pending = null; }
    this.refs.delete("remoteKey");
  }

  async deleteOwnedSecrets(): Promise<void> {
    for (const path of [
      this.config.manifest.paths.connectorTokenFile,
      this.config.accessServiceTokenSinkFile,
      this.config.omniRouteRemoteKeySinkFile,
    ]) removeOwnedSecret(path, this.config.repositoryRoot);
  }

  async discoverPrepared(): Promise<PromotionReceipt> {
    this.requireJournal();
    const bytes = readOwnerOnlyRegularFile(this.config.manifest.paths.receiptFile, MAX_JOURNAL_BYTES, "receipt");
    try {
      const value = parseStrictJsonDocument(bytes.toString("utf8")) as PromotionReceipt;
      const validation = validatePromotionReceipt(value);
      if (!validation.valid) fail("production_recovery_receipt_invalid");
      for (const ref of Object.values(value.resources)) if (ref) this.refs.set(ref.kind, ref);
      return value;
    } catch (error) {
      if (error instanceof ProductionAdapterFailure) throw error;
      fail("production_recovery_receipt_invalid");
    } finally {
      bytes.fill(0);
    }
  }

  async discoverResource(kind: ResourceKind, deterministicName: string): Promise<ResourceRef | null> {
    this.requireJournal();
    const candidates = readdirSync(this.config.manifest.paths.journalDirectory)
      .filter((name) => name.startsWith("operation-") && name.endsWith(".json"))
      .sort()
      .reverse();
    for (const name of candidates) {
      const path = join(this.config.manifest.paths.journalDirectory, name);
      const parsed = parseOperationRecord(readOwnerOnlyRegularFile(path, MAX_JOURNAL_BYTES, "operation"), name);
      if (parsed.kind !== "temperance.cloudflare-production-operation" || parsed.step !== kind || parsed.resourceName !== deterministicName) continue;
      if (parsed.state === "manual_orphan" || parsed.state === "prepared" || parsed.state === "announced") {
        fail(`production_manual_orphan_${kind}`);
      }
      if ((parsed.state === "applied" || parsed.state === "committed") && parsed.ref) {
        if (parsed.ref.kind !== kind || parsed.ref.name !== deterministicName || parsed.ref.ownershipHash !== parsed.ownershipHash) fail("production_operation_ref_invalid");
        this.refs.set(kind, parsed.ref);
        return parsed.ref;
      }
      return null;
    }
    // No durable exact-ID provenance exists. Never query or adopt by name.
    return null;
  }
}

/**
 * No default composition root exists. Importing this module performs no I/O,
 * reads no credential, starts no connector, and issues no request.
 */
export function createOmniRouteCloudflareProductionAdapter(config: ProductionAdapterConfig): OmniRouteCloudflareProductionAdapter {
  return new OmniRouteCloudflareProductionAdapter(config);
}

export const PRODUCTION_ADAPTER_OPEN_CLAIMS = [
  "UNVERIFIED-CF: hostname DNS, TLS termination, and origin routing",
  "UNVERIFIED-CF: exact Access application and service-token admission",
  "UNVERIFIED-CF: real error shapes, rate limits, retry timing, and partitions",
  "UNVERIFIED-OMNIROUTE: exact session request and duration enforcement",
  "UNVERIFIED-OMNIROUTE: exact path enforcement beyond endpoint categories",
] as const;

export function createChallengeLedgerApprovalReplayPort(config: ChallengeLedgerApprovalReplayConfig): ApprovalReplayPort {
  const now = config.now ?? Date.now;
  return {
    async consume(input) {
      if (!/^[a-f0-9]{64}$/u.test(input.approvalId)) fail("approval_replay_id_invalid");
      const expiresAt = Date.parse(input.expiresAt);
      const nowMs = now();
      if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) fail("approval_replay_expired");
      const { consumeProbeChallenge } = await import("./signed-probe-challenge-ledger");
      try {
        const result = await consumeProbeChallenge({
          ledgerPath: config.ledgerPath,
          receiptDirectory: config.receiptDirectory,
          keyId: input.keyId,
          challenge: input.approvalId,
          nowMs,
          ...(config.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: config.lockTimeoutMs }),
        });
        if (
          result.authorizing !== false ||
          result.operation !== "consume" ||
          result.status !== "consumed" ||
          result.keyId !== input.keyId ||
          result.challenge !== input.approvalId ||
          result.expiresAt !== input.expiresAt
        ) {
          fail("approval_replay_result_binding_invalid");
        }
        return { consumed: true, durable: true, atomic: true, authorizing: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message === "challenge-ledger-challenge-consumed") return { consumed: false, authorizing: false };
        throw error;
      }
    },
  };
}

export function sanitizedFailure(error: unknown, secrets: readonly string[] = []): { code: string } {
  const code = error instanceof ProductionAdapterFailure ? error.code : "production_adapter_failure";
  const redacted = redactText(code, secrets);
  return { code: redacted };
}
