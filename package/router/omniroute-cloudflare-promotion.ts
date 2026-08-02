import { createHash, createPublicKey, KeyObject, randomUUID, verify as verifySignature, type KeyLike } from "node:crypto";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export class PromotionFailure extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "PromotionFailure";
    this.code = code;
  }
}

export const FORWARD_PLAN = [
  "remoteKey",
  "serviceToken",
  "accessApplication",
  "accessPolicy",
  "accessVerification",
  "tunnel",
  "tunnelConfiguration",
  "connectorTokenFile",
  "connector",
  "connectorConnection",
  "dns",
  "canaries",
] as const;

export const CANARY_CONTRACT = [
  { id: "anonymous_access_denial", status: 403, routed: false, accessDecision: "denied" },
  { id: "invalid_machine_identity_denial", status: 403, routed: false, accessDecision: "denied" },
  { id: "invalid_origin_bearer_denial", status: 401, routed: false, accessDecision: "allowed" },
  { id: "exact_model_success", status: 200, routed: true, accessDecision: "allowed" },
  { id: "disallowed_model_denial", status: 403, routed: false, accessDecision: "allowed" },
  { id: "anonymous_management_denial", status: 403, routed: false, accessDecision: "denied" },
] as const;

export type ResourceKind =
  | "remoteKey"
  | "serviceToken"
  | "accessApplication"
  | "accessPolicy"
  | "tunnel"
  | "tunnelConfiguration"
  | "connectorTokenFile"
  | "connector"
  | "dns";

export interface ResourceRef {
  kind: ResourceKind;
  id: string;
  name: string;
  ownershipHash: string;
  stateHash: string;
}

export interface CloudflarePromotionManifest {
  schemaVersion: 1;
  kind: "temperance.omniroute-cloudflare-promotion";
  accountId: string;
  zoneId: string;
  zone: string;
  hostname: string;
  origin: "http://127.0.0.1:20128";
  names: {
    tunnel: string;
    accessApplication: string;
    accessPolicy: string;
    serviceToken: string;
    remoteKey: string;
    connector: string;
  };
  access: { teamName: string; audTag: string };
  approval: { keyId: string; publicKeySpkiSha256: string };
  remoteKey: {
    model: string;
    probePassed: true;
    policy: {
      logging: "disabled";
      endpoints: ["/v1/chat/completions"];
      session: { maxRequests: number; maxDurationSeconds: number };
      rate: { requestsPerMinute: number; burst: number };
      spendUsd: { daily: number; weekly: number };
    };
  };
  paths: {
    cloudflareTokenFile: string;
    connectorTokenFile: string;
    journalDirectory: string;
    receiptFile: string;
  };
  limits: {
    operationTimeoutMs: number;
    connectionPollIntervalMs: number;
    connectionPollAttempts: number;
    approvalMaxAgeMs: number;
  };
}

export interface ExactResourceAuthority {
  schemaVersion: 1;
  kind: "temperance.cloudflare-exact-resource-authority";
  independent: boolean;
  signatureValid: boolean;
  issuer: string;
  accountId: string;
  zoneId: string;
  zone: string;
  hostname: string;
  permissions: string[];
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  signature: string;
}

export interface PromotionPreflight {
  schemaVersion: 1;
  kind: "temperance.cloudflare-promotion-preflight";
  observedAt: string;
  authority: ExactResourceAuthority;
  localAuth: { requireApiKey: boolean; claudeKeychain: boolean; codexKeychain: boolean };
  quickTunnel: { state: string; residuePaths: string[] };
  listener: { addresses: string[] };
  collisions: Record<"accessApplication" | "accessPolicy" | "serviceToken" | "tunnel" | "dns" | "remoteKey" | "connector", boolean>;
  dnsCoverage: { exactRecord: boolean; wildcardRecord: boolean; apexFlattening: boolean };
  certPemPaths: string[];
}

export interface PromotionReceipt {
  schemaVersion: 1;
  kind: "temperance.omniroute-cloudflare-promotion-receipt";
  state: "preparing" | "prepared" | "promoting" | "promoted" | "rolling_back" | "rolled_back" | "stuck_open";
  issuedAt: string;
  updatedAt: string;
  transactionId: string;
  manifestHash: string;
  preparedStateHash: string;
  hostname: string;
  tunnelName: string;
  accessApplicationName: string;
  remoteKeyPolicyHash: string;
  canaryContractHash: string;
  approvalKeyId: string;
  approvalPublicKeySpkiSha256: string;
  resources: Partial<Record<ResourceKind, ResourceRef>>;
  approvalId?: string;
  failureCode?: "PROMOTION_STUCK_OPEN";
  doesNotEstablish: ["cloudflare_authority", "hostname_ownership", "operator_approval"];
}

export interface PromotionApprovalReceipt {
  schemaVersion: 1;
  kind: "temperance.omniroute-cloudflare-promotion-approval";
  approvalId: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
  keyId: string;
  preparedStateHash: string;
  hostname: string;
  tunnelName: string;
  accessApplicationName: string;
  remoteKeyPolicyHash: string;
  canaryContractHash: string;
}

export interface CloudflarePromotionAdapter {
  openControlPlane(): Promise<void>;
  beginJournal(): Promise<void>;
  beforeMutation(step: string): Promise<void>;
  afterMutation(step: string): Promise<void>;
  writeReceipt(receipt: PromotionReceipt): Promise<void>;
  consumeApproval(approval: PromotionApprovalReceipt): Promise<{ consumed: true; durable: true; atomic: true } | { consumed: false }>;
  createRemoteKey(input: { name: string; ownershipHash: string; model?: string; policy?: CloudflarePromotionManifest["remoteKey"]["policy"] }): Promise<ResourceRef>;
  createServiceToken(input: { name: string; ownershipHash: string }): Promise<ResourceRef>;
  createAccessApplication(input: { name: string; ownershipHash: string; hostname?: string }): Promise<ResourceRef>;
  createAccessPolicy(input: { name: string; ownershipHash: string; decision: string; include: unknown }): Promise<ResourceRef>;
  verifyAccessBoundary(): Promise<boolean>;
  createTunnel(input: { name: string; ownershipHash: string }): Promise<ResourceRef>;
  putTunnelConfiguration(input: { tunnelId: string; ownershipHash: string; configuration: ReturnType<typeof tunnelConfiguration> }): Promise<ResourceRef>;
  verifyTunnelConfiguration(): Promise<boolean>;
  materializeConnectorToken(input: { tunnelId: string; path: string; ownershipHash: string }): Promise<ResourceRef>;
  startConnector(input: { argv: readonly string[]; ownershipHash: string }): Promise<ResourceRef>;
  waitForConnector(): Promise<boolean>;
  createDns(input: { target: string; proxied: true; ownershipHash: string }): Promise<ResourceRef>;
  runCanaries(): Promise<readonly CanaryObservation[]>;
  inspectResource(ref: ResourceRef): Promise<ResourceRef | null>;
  stopConnector(): Promise<void>;
  deleteDns(): Promise<void>;
  cleanupConnections(): Promise<void>;
  connectionCount(): Promise<number>;
  wait(milliseconds?: number): Promise<void>;
  deleteTunnel(): Promise<void>;
  deleteAccessPolicy(): Promise<void>;
  deleteAccessApplication(): Promise<void>;
  deleteServiceToken(): Promise<void>;
  deleteRemoteKey(): Promise<void>;
  deleteOwnedSecrets(): Promise<void>;
  discoverPrepared(): Promise<PromotionReceipt>;
  discoverResource(kind: ResourceKind, deterministicName: string): Promise<ResourceRef | null>;
}

interface CanaryObservation {
  id: string;
  status: number;
  routed: boolean;
  model?: string;
  transport: "http" | "dns_error" | "network_error";
  hostnameResolved: boolean;
  accessDecision: "denied" | "allowed" | "unknown";
  accessEvidence: "cloudflare_access_denial" | "jwt_binding_verified" | "none";
  accessAud?: string;
  accessIssuer?: string;
  accessPrincipal?: string;
}

interface OperationOptions {
  nowMs: number;
  repositoryRoot?: string;
  approvalPublicKey?: KeyLike;
}

const HASH = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/u;
const DNS_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const REQUIRED_PERMISSIONS = ["access:write", "dns:write", "service_tokens:write", "tunnel:write"] as const;
const RECEIPT_NONCLAIMS = ["cloudflare_authority", "hostname_ownership", "operator_approval"] as const;

function fail(code: string): never {
  throw new PromotionFailure(code);
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], code: string): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail(code);
}

function integer(value: unknown, minimum: number, maximum: number, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail(code);
  return value as number;
}

function finite(value: unknown, minimum: number, maximum: number, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail(code);
  return value;
}

function safeId(value: unknown, code: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail(code);
  return value;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const input = object(value, "canonical_value_invalid");
  return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${canonical(input[key])}`).join(",")}}`;
}

export function parseStrictJsonDocument(text: string): unknown {
  if (Buffer.byteLength(text, "utf8") > 65_536) fail("manifest_document_too_large");
  const stack: Array<Set<string> | null> = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") {
      stack.push(new Set<string>());
      continue;
    }
    if (character === "[") {
      stack.push(null);
      continue;
    }
    if (character === "}" || character === "]") {
      stack.pop();
      continue;
    }
    if (character !== '"') continue;
    const start = index;
    index += 1;
    for (; index < text.length; index += 1) {
      if (text[index] === "\\") {
        index += 1;
        continue;
      }
      if (text[index] === '"') break;
    }
    if (index >= text.length) fail("manifest_json_invalid");
    let cursor = index + 1;
    while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
    const objectKeys = stack.at(-1);
    if (text[cursor] === ":" && objectKeys instanceof Set) {
      let key: unknown;
      try {
        key = JSON.parse(text.slice(start, index + 1));
      } catch {
        fail("manifest_json_invalid");
      }
      if (typeof key !== "string" || objectKeys.has(key)) fail("manifest_duplicate_key");
      objectKeys.add(key);
    }
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail("manifest_json_invalid");
  }
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function externalAbsolutePath(value: unknown, repositoryRoot: string, code: string): string {
  if (typeof value !== "string" || !isAbsolute(value) || /[\0${}]/u.test(value)) fail(code);
  const absolute = resolve(value);
  const repository = resolve(repositoryRoot);
  const rel = relative(repository, absolute);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) fail(code);
  return absolute;
}

function iso(value: unknown, code: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(code);
  return value;
}

function signatureShape(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^ed25519:[A-Za-z0-9+/]{86}==$/u.test(value)) fail(code);
  const bytes = Buffer.from(value.slice("ed25519:".length), "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value.slice("ed25519:".length)) fail(code);
  return value;
}

export function parseCloudflarePromotionManifest(value: unknown, repositoryRoot: string): CloudflarePromotionManifest {
  const root = object(value, "manifest_not_object");
  exactKeys(root, ["schemaVersion", "kind", "accountId", "zoneId", "zone", "hostname", "origin", "names", "access", "approval", "remoteKey", "paths", "limits"], "manifest_keys_invalid");
  if (root.schemaVersion !== 1 || root.kind !== "temperance.omniroute-cloudflare-promotion") fail("manifest_identity_invalid");
  const accountId = safeId(root.accountId, "account_id_invalid");
  const zoneId = safeId(root.zoneId, "zone_id_invalid");
  if (typeof root.zone !== "string" || !DNS_NAME.test(root.zone)) fail("zone_invalid");
  const zone = root.zone;
  if (typeof root.hostname !== "string" || !DNS_NAME.test(root.hostname) || root.hostname === zone || !root.hostname.endsWith(`.${zone}`)) fail("hostname_invalid");
  const hostname = root.hostname;
  if (root.origin !== "http://127.0.0.1:20128") fail("origin_invalid");

  const namesValue = object(root.names, "names_invalid");
  exactKeys(namesValue, ["tunnel", "accessApplication", "accessPolicy", "serviceToken", "remoteKey", "connector"], "name_keys_invalid");
  const expectedBase = `temperance-${hostname.replaceAll(".", "-")}`;
  const expectedNames = {
    tunnel: expectedBase,
    accessApplication: expectedBase,
    accessPolicy: `${expectedBase}-service-auth`,
    serviceToken: `${expectedBase}-client`,
    remoteKey: expectedBase,
    connector: expectedBase,
  };
  const names = Object.fromEntries(Object.entries(expectedNames).map(([key, expected]) => {
    const actual = safeId(namesValue[key], `name_${key}_invalid`);
    if (actual !== expected) fail(`name_${key}_not_deterministic`);
    return [key, actual];
  })) as CloudflarePromotionManifest["names"];

  const accessValue = object(root.access, "access_invalid");
  exactKeys(accessValue, ["teamName", "audTag"], "access_keys_invalid");
  const access = {
    teamName: safeId(accessValue.teamName, "team_name_invalid"),
    audTag: safeId(accessValue.audTag, "aud_tag_invalid"),
  };

  const approvalValue = object(root.approval, "approval_config_invalid");
  exactKeys(approvalValue, ["keyId", "publicKeySpkiSha256"], "approval_config_keys_invalid");
  const approval = {
    keyId: safeId(approvalValue.keyId, "approval_key_id_invalid"),
    publicKeySpkiSha256: typeof approvalValue.publicKeySpkiSha256 === "string" && HASH.test(approvalValue.publicKeySpkiSha256)
      ? approvalValue.publicKeySpkiSha256
      : fail("approval_public_key_hash_invalid"),
  };

  const remoteKeyValue = object(root.remoteKey, "remote_key_invalid");
  exactKeys(remoteKeyValue, ["model", "probePassed", "policy"], "remote_key_keys_invalid");
  if (typeof remoteKeyValue.model !== "string" || remoteKeyValue.model.length > 192 || !/^[A-Za-z0-9][A-Za-z0-9._/-]+$/u.test(remoteKeyValue.model)) fail("remote_model_invalid");
  const model = remoteKeyValue.model;
  if (/(^|[-_/.])(?:sol(?:-max)?|auto)(?=$|[-_/.])/iu.test(model)) fail("remote_model_forbidden");
  if (remoteKeyValue.probePassed !== true) fail("remote_model_probe_missing");
  const policyValue = object(remoteKeyValue.policy, "remote_key_policy_invalid");
  exactKeys(policyValue, ["logging", "endpoints", "session", "rate", "spendUsd"], "remote_key_policy_keys_invalid");
  if (policyValue.logging !== "disabled" || JSON.stringify(policyValue.endpoints) !== '["/v1/chat/completions"]') fail("remote_key_policy_boundary_invalid");
  const sessionValue = object(policyValue.session, "remote_key_session_invalid");
  exactKeys(sessionValue, ["maxRequests", "maxDurationSeconds"], "remote_key_session_keys_invalid");
  const rateValue = object(policyValue.rate, "remote_key_rate_invalid");
  exactKeys(rateValue, ["requestsPerMinute", "burst"], "remote_key_rate_keys_invalid");
  const spendValue = object(policyValue.spendUsd, "remote_key_spend_invalid");
  exactKeys(spendValue, ["daily", "weekly"], "remote_key_spend_keys_invalid");
  const daily = finite(spendValue.daily, 0.01, 100, "remote_key_daily_spend_invalid");
  const weekly = finite(spendValue.weekly, daily, 500, "remote_key_weekly_spend_invalid");
  const policy: CloudflarePromotionManifest["remoteKey"]["policy"] = {
    logging: "disabled",
    endpoints: ["/v1/chat/completions"],
    session: {
      maxRequests: integer(sessionValue.maxRequests, 1, 1_000, "remote_key_session_requests_invalid"),
      maxDurationSeconds: integer(sessionValue.maxDurationSeconds, 60, 86_400, "remote_key_session_duration_invalid"),
    },
    rate: {
      requestsPerMinute: integer(rateValue.requestsPerMinute, 1, 120, "remote_key_rate_invalid"),
      burst: integer(rateValue.burst, 1, 30, "remote_key_burst_invalid"),
    },
    spendUsd: { daily, weekly },
  };
  if (policy.rate.burst > policy.rate.requestsPerMinute) fail("remote_key_burst_exceeds_rate");

  const pathsValue = object(root.paths, "paths_invalid");
  exactKeys(pathsValue, ["cloudflareTokenFile", "connectorTokenFile", "journalDirectory", "receiptFile"], "path_keys_invalid");
  const paths = {
    cloudflareTokenFile: externalAbsolutePath(pathsValue.cloudflareTokenFile, repositoryRoot, "cloudflare_token_path_invalid"),
    connectorTokenFile: externalAbsolutePath(pathsValue.connectorTokenFile, repositoryRoot, "connector_token_path_invalid"),
    journalDirectory: externalAbsolutePath(pathsValue.journalDirectory, repositoryRoot, "journal_path_invalid"),
    receiptFile: externalAbsolutePath(pathsValue.receiptFile, repositoryRoot, "receipt_path_invalid"),
  };
  if (new Set(Object.values(paths)).size !== Object.values(paths).length) fail("path_collision");
  const receiptRelative = relative(paths.journalDirectory, paths.receiptFile);
  if (receiptRelative.startsWith(`..${sep}`) || receiptRelative === ".." || isAbsolute(receiptRelative)) fail("receipt_not_within_journal");

  const limitsValue = object(root.limits, "limits_invalid");
  exactKeys(limitsValue, ["operationTimeoutMs", "connectionPollIntervalMs", "connectionPollAttempts", "approvalMaxAgeMs"], "limit_keys_invalid");
  const limits = {
    operationTimeoutMs: integer(limitsValue.operationTimeoutMs, 1_000, 30_000, "operation_timeout_invalid"),
    connectionPollIntervalMs: integer(limitsValue.connectionPollIntervalMs, 25, 5_000, "connection_poll_interval_invalid"),
    connectionPollAttempts: integer(limitsValue.connectionPollAttempts, 1, 60, "connection_poll_attempts_invalid"),
    approvalMaxAgeMs: integer(limitsValue.approvalMaxAgeMs, 1_000, 300_000, "approval_max_age_invalid"),
  };

  return {
    schemaVersion: 1,
    kind: "temperance.omniroute-cloudflare-promotion",
    accountId,
    zoneId,
    zone,
    hostname,
    origin: "http://127.0.0.1:20128",
    names,
    access,
    approval,
    remoteKey: { model, probePassed: true, policy },
    paths,
    limits,
  };
}

export function manifestHash(manifest: CloudflarePromotionManifest): string {
  return hash(manifest);
}

export function remoteKeyPolicyHash(manifest: CloudflarePromotionManifest): string {
  return hash({ model: manifest.remoteKey.model, policy: manifest.remoteKey.policy });
}

export function canaryContractHash(): string {
  return hash(CANARY_CONTRACT);
}

export function approvalPublicKeySpkiHash(publicKey: KeyLike): string {
  const key = publicKey instanceof KeyObject && publicKey.type === "public" ? publicKey : createPublicKey(publicKey);
  const der = key.export({ type: "spki", format: "der" });
  return `sha256:${createHash("sha256").update(der).digest("hex")}`;
}

export function approvalSigningBytes(approval: PromotionApprovalReceipt): Buffer {
  const { signature: _signature, ...payload } = approval;
  return Buffer.from(`temperance.omniroute-cloudflare-promotion-approval.v1\0${canonical(payload)}`, "utf8");
}

export function tunnelConfiguration(manifest: CloudflarePromotionManifest) {
  return {
    config: {
      ingress: [
        {
          hostname: manifest.hostname,
          service: manifest.origin,
          originRequest: {
            access: {
              required: true,
              teamName: manifest.access.teamName,
              audTag: [manifest.access.audTag],
            },
          },
        },
        { service: "http_status:404" },
      ],
    },
  };
}

export function connectorCommand(manifest: CloudflarePromotionManifest, tunnelId: string): readonly string[] {
  if (!SAFE_ID.test(tunnelId)) fail("tunnel_id_invalid");
  return ["cloudflared", "tunnel", "run", "--token-file", manifest.paths.connectorTokenFile, tunnelId];
}

function receiptStateHash(receipt: Pick<PromotionReceipt, "transactionId" | "manifestHash" | "hostname" | "tunnelName" | "accessApplicationName" | "remoteKeyPolicyHash" | "canaryContractHash" | "approvalKeyId" | "approvalPublicKeySpkiSha256" | "resources">): string {
  return hash({
    transactionId: receipt.transactionId,
    manifestHash: receipt.manifestHash,
    hostname: receipt.hostname,
    tunnelName: receipt.tunnelName,
    accessApplicationName: receipt.accessApplicationName,
    remoteKeyPolicyHash: receipt.remoteKeyPolicyHash,
    canaryContractHash: receipt.canaryContractHash,
    approvalKeyId: receipt.approvalKeyId,
    approvalPublicKeySpkiSha256: receipt.approvalPublicKeySpkiSha256,
    resources: receipt.resources,
  });
}

function expectedResourceOwnershipHash(receipt: Pick<PromotionReceipt, "transactionId" | "manifestHash">, kind: ResourceKind, name: string): string {
  return hash({
    domain: "temperance.omniroute-cloudflare-promotion-resource.v1",
    transactionId: receipt.transactionId,
    manifestHash: receipt.manifestHash,
    kind,
    name,
  });
}

function newReceipt(manifest: CloudflarePromotionManifest, nowMs: number): PromotionReceipt {
  const value: PromotionReceipt = {
    schemaVersion: 1,
    kind: "temperance.omniroute-cloudflare-promotion-receipt",
    state: "preparing",
    issuedAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    transactionId: randomUUID(),
    manifestHash: manifestHash(manifest),
    preparedStateHash: "sha256:" + "0".repeat(64),
    hostname: manifest.hostname,
    tunnelName: manifest.names.tunnel,
    accessApplicationName: manifest.names.accessApplication,
    remoteKeyPolicyHash: remoteKeyPolicyHash(manifest),
    canaryContractHash: canaryContractHash(),
    approvalKeyId: manifest.approval.keyId,
    approvalPublicKeySpkiSha256: manifest.approval.publicKeySpkiSha256,
    resources: {},
    doesNotEstablish: [...RECEIPT_NONCLAIMS],
  };
  value.preparedStateHash = receiptStateHash(value);
  return value;
}

function updateReceipt(receipt: PromotionReceipt, state: PromotionReceipt["state"], nowMs: number): PromotionReceipt {
  const next: PromotionReceipt = { ...receipt, state, updatedAt: new Date(nowMs).toISOString(), resources: { ...receipt.resources } };
  next.preparedStateHash = receiptStateHash(next);
  return next;
}

export function validatePromotionReceipt(receipt: PromotionReceipt): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (receipt.schemaVersion !== 1 || receipt.kind !== "temperance.omniroute-cloudflare-promotion-receipt") reasons.push("receipt_identity_invalid");
  if (!SAFE_ID.test(receipt.transactionId)) reasons.push("receipt_transaction_id_invalid");
  if (!["preparing", "prepared", "promoting", "promoted", "rolling_back", "rolled_back", "stuck_open"].includes(receipt.state)) reasons.push("receipt_state_invalid");
  if ((receipt.state === "stuck_open") !== (receipt.failureCode === "PROMOTION_STUCK_OPEN")) reasons.push("receipt_failure_state_invalid");
  if (!HASH.test(receipt.manifestHash) || !HASH.test(receipt.preparedStateHash) || !HASH.test(receipt.remoteKeyPolicyHash) || !HASH.test(receipt.canaryContractHash)) reasons.push("receipt_hash_invalid");
  if (!SAFE_ID.test(receipt.approvalKeyId) || !HASH.test(receipt.approvalPublicKeySpkiSha256)) reasons.push("receipt_approval_key_invalid");
  if (!DNS_NAME.test(receipt.hostname) || !SAFE_ID.test(receipt.tunnelName) || !SAFE_ID.test(receipt.accessApplicationName)) reasons.push("receipt_binding_invalid");
  if (JSON.stringify(receipt.doesNotEstablish) !== JSON.stringify(RECEIPT_NONCLAIMS)) reasons.push("receipt_nonclaims_invalid");
  if (!Number.isFinite(Date.parse(receipt.issuedAt)) || !Number.isFinite(Date.parse(receipt.updatedAt))) reasons.push("receipt_time_invalid");
  const seen = new Set<string>();
  for (const [kind, ref] of Object.entries(receipt.resources)) {
    if (!ref || ref.kind !== kind || !SAFE_ID.test(ref.id) || !SAFE_ID.test(ref.name) || ref.ownershipHash !== expectedResourceOwnershipHash(receipt, kind as ResourceKind, ref.name) || !HASH.test(ref.stateHash)) reasons.push(`receipt_resource_${kind}_invalid`);
    if (ref && seen.has(`${ref.kind}\0${ref.id}`)) reasons.push("receipt_resource_duplicate");
    if (ref) seen.add(`${ref.kind}\0${ref.id}`);
  }
  if (receipt.preparedStateHash !== receiptStateHash(receipt)) reasons.push("receipt_state_hash_invalid");
  return { valid: reasons.length === 0, reasons };
}

function validatePreflight(manifest: CloudflarePromotionManifest, preflight: PromotionPreflight, nowMs: number): void {
  if (preflight.schemaVersion !== 1 || preflight.kind !== "temperance.cloudflare-promotion-preflight") fail("preflight_identity_invalid");
  const observedAt = Date.parse(preflight.observedAt);
  if (!Number.isFinite(observedAt) || observedAt > nowMs + 30_000 || nowMs - observedAt > manifest.limits.approvalMaxAgeMs) fail("preflight_stale");
  const authority = preflight.authority;
  if (authority.schemaVersion !== 1 || authority.kind !== "temperance.cloudflare-exact-resource-authority" || authority.independent !== true || authority.signatureValid !== true) fail("authority_invalid");
  if (authority.accountId !== manifest.accountId || authority.zoneId !== manifest.zoneId || authority.zone !== manifest.zone || authority.hostname !== manifest.hostname) fail("authority_binding_mismatch");
  if ([...authority.permissions].sort().join("\0") !== [...REQUIRED_PERMISSIONS].sort().join("\0")) fail("authority_permissions_invalid");
  if (!SAFE_ID.test(authority.issuer) || !/^[a-f0-9]{64}$/u.test(authority.nonce)) fail("authority_identity_invalid");
  signatureShape(authority.signature, "authority_signature_invalid");
  const issued = Date.parse(authority.issuedAt);
  const expires = Date.parse(authority.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > nowMs || expires <= nowMs || expires - issued > 300_000) fail("authority_time_invalid");
  if (preflight.localAuth.requireApiKey !== true || preflight.localAuth.claudeKeychain !== true || preflight.localAuth.codexKeychain !== true) fail("local_auth_invalid");
  if (preflight.quickTunnel.state !== "stopped" || preflight.quickTunnel.residuePaths.length !== 0) fail("quick_tunnel_not_contained");
  if (preflight.listener.addresses.length === 0 || preflight.listener.addresses.some((address) => !/^(?:127\.0\.0\.1|\[::1\]):20128$/u.test(address))) fail("listener_not_loopback");
  if (Object.keys(preflight.collisions).sort().join("\0") !== ["accessApplication", "accessPolicy", "connector", "dns", "remoteKey", "serviceToken", "tunnel"].sort().join("\0") || Object.values(preflight.collisions).some(Boolean)) fail("resource_collision");
  if (Object.keys(preflight.dnsCoverage).sort().join("\0") !== ["apexFlattening", "exactRecord", "wildcardRecord"].sort().join("\0") || Object.values(preflight.dnsCoverage).some(Boolean)) fail("dns_shadowing_present");
  if (preflight.certPemPaths.length !== 0) fail("account_origin_certificate_forbidden");
}

async function mutate(
  adapter: CloudflarePromotionAdapter,
  receipt: PromotionReceipt,
  step: string,
  expectedName: string,
  action: () => Promise<ResourceRef>,
): Promise<ResourceRef> {
  await adapter.beforeMutation(step);
  const ref = await action();
  if (ref.kind !== step || ref.name !== expectedName || !SAFE_ID.test(ref.id) || ref.ownershipHash !== expectedResourceOwnershipHash(receipt, step as ResourceKind, expectedName) || !HASH.test(ref.stateHash)) fail(`resource_${step}_invalid`);
  receipt.resources[step as ResourceKind] = ref;
  receipt.preparedStateHash = receiptStateHash(receipt);
  await adapter.afterMutation(step);
  await adapter.writeReceipt(receipt);
  return ref;
}

export function previewCloudflarePromotion(value: unknown, repositoryRoot: string) {
  const manifest = parseCloudflarePromotionManifest(value, repositoryRoot);
  return {
    schemaVersion: 1 as const,
    kind: "temperance.omniroute-cloudflare-promotion-preview" as const,
    mode: "preview" as const,
    mutations: 0 as const,
    manifestHash: manifestHash(manifest),
    remoteKeyPolicyHash: remoteKeyPolicyHash(manifest),
    canaryContractHash: canaryContractHash(),
    plan: [...FORWARD_PLAN],
    publicCutoverRequires: "fresh_one_use_prepared_state_approval" as const,
  };
}

export async function prepareCloudflarePromotion(
  manifest: CloudflarePromotionManifest,
  preflight: PromotionPreflight,
  adapter: CloudflarePromotionAdapter,
  options: OperationOptions,
): Promise<PromotionReceipt> {
  validatePreflight(manifest, preflight, options.nowMs);
  const receipt = newReceipt(manifest, options.nowMs);
  await adapter.openControlPlane();
  await adapter.beginJournal();
  await adapter.writeReceipt(receipt);

  try {
    const ownership = (kind: ResourceKind, name: string) => expectedResourceOwnershipHash(receipt, kind, name);
    await mutate(adapter, receipt, "remoteKey", manifest.names.remoteKey, () => adapter.createRemoteKey({ name: manifest.names.remoteKey, ownershipHash: ownership("remoteKey", manifest.names.remoteKey), model: manifest.remoteKey.model, policy: manifest.remoteKey.policy }));
    const serviceToken = await mutate(adapter, receipt, "serviceToken", manifest.names.serviceToken, () => adapter.createServiceToken({ name: manifest.names.serviceToken, ownershipHash: ownership("serviceToken", manifest.names.serviceToken) }));
    await mutate(adapter, receipt, "accessApplication", manifest.names.accessApplication, () => adapter.createAccessApplication({ name: manifest.names.accessApplication, ownershipHash: ownership("accessApplication", manifest.names.accessApplication), hostname: manifest.hostname }));
    await mutate(adapter, receipt, "accessPolicy", manifest.names.accessPolicy, () => adapter.createAccessPolicy({
      name: manifest.names.accessPolicy,
      ownershipHash: ownership("accessPolicy", manifest.names.accessPolicy),
      decision: "non_identity",
      include: [{ service_token: { token_id: serviceToken.id } }],
    }));
    if (!await adapter.verifyAccessBoundary()) fail("access_boundary_verification_failed");
    const tunnel = await mutate(adapter, receipt, "tunnel", manifest.names.tunnel, () => adapter.createTunnel({ name: manifest.names.tunnel, ownershipHash: ownership("tunnel", manifest.names.tunnel) }));
    await mutate(adapter, receipt, "tunnelConfiguration", "remote-managed", () => adapter.putTunnelConfiguration({ tunnelId: tunnel.id, ownershipHash: ownership("tunnelConfiguration", "remote-managed"), configuration: tunnelConfiguration(manifest) }));
    if (!await adapter.verifyTunnelConfiguration()) fail("tunnel_configuration_verification_failed");
    const connectorTokenName = basename(manifest.paths.connectorTokenFile);
    await mutate(adapter, receipt, "connectorTokenFile", connectorTokenName, () => adapter.materializeConnectorToken({ tunnelId: tunnel.id, path: manifest.paths.connectorTokenFile, ownershipHash: ownership("connectorTokenFile", connectorTokenName) }));

    const prepared = updateReceipt(receipt, "prepared", options.nowMs);
    await adapter.writeReceipt(prepared);
    return prepared;
  } catch (error) {
    if (Object.keys(receipt.resources).length > 0) {
      try {
        await rollbackCloudflarePromotion(manifest, receipt, adapter, options);
      } catch (rollbackError) {
        throw new PromotionFailure("prepare_failed_and_rollback_failed", `${String(error)}; rollback: ${String(rollbackError)}`);
      }
    }
    if (error instanceof PromotionFailure) throw error;
    throw new PromotionFailure("prepare_failed", String(error));
  }
}

export function createPreparedApproval(
  receipt: PromotionReceipt,
  input: Pick<PromotionApprovalReceipt, "approvalId" | "issuedAt" | "expiresAt" | "signature">,
): PromotionApprovalReceipt {
  const validation = validatePromotionReceipt(receipt);
  if (!validation.valid || receipt.state !== "prepared") fail("approval_requires_valid_prepared_receipt");
  safeId(input.approvalId, "approval_id_invalid");
  iso(input.issuedAt, "approval_issued_at_invalid");
  iso(input.expiresAt, "approval_expires_at_invalid");
  signatureShape(input.signature, "approval_signature_invalid");
  return {
    schemaVersion: 1,
    kind: "temperance.omniroute-cloudflare-promotion-approval",
    ...input,
    keyId: receipt.approvalKeyId,
    preparedStateHash: receipt.preparedStateHash,
    hostname: receipt.hostname,
    tunnelName: receipt.tunnelName,
    accessApplicationName: receipt.accessApplicationName,
    remoteKeyPolicyHash: receipt.remoteKeyPolicyHash,
    canaryContractHash: receipt.canaryContractHash,
  };
}

function validateApproval(manifest: CloudflarePromotionManifest, receipt: PromotionReceipt, approval: PromotionApprovalReceipt, options: OperationOptions): void {
  const receiptValidation = validatePromotionReceipt(receipt);
  if (!receiptValidation.valid || receipt.state !== "prepared") fail("promotion_receipt_invalid");
  if (receipt.manifestHash !== manifestHash(manifest)) fail("promotion_manifest_mismatch");
  if (approval.schemaVersion !== 1 || approval.kind !== "temperance.omniroute-cloudflare-promotion-approval") fail("approval_identity_invalid");
  safeId(approval.approvalId, "approval_id_invalid");
  signatureShape(approval.signature, "approval_signature_invalid");
  if (approval.keyId !== manifest.approval.keyId || receipt.approvalKeyId !== manifest.approval.keyId || receipt.approvalPublicKeySpkiSha256 !== manifest.approval.publicKeySpkiSha256) fail("approval_key_binding_mismatch");
  const issued = Date.parse(approval.issuedAt);
  const expires = Date.parse(approval.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > options.nowMs || expires <= options.nowMs || options.nowMs - issued > manifest.limits.approvalMaxAgeMs || expires - issued > manifest.limits.approvalMaxAgeMs) fail("approval_time_invalid");
  const exact = approval.preparedStateHash === receipt.preparedStateHash
    && approval.hostname === receipt.hostname
    && approval.tunnelName === receipt.tunnelName
    && approval.accessApplicationName === receipt.accessApplicationName
    && approval.remoteKeyPolicyHash === receipt.remoteKeyPolicyHash
    && approval.canaryContractHash === receipt.canaryContractHash;
  if (!exact) fail("approval_binding_mismatch");
  if (!options.approvalPublicKey) fail("approval_public_key_missing");
  if (approvalPublicKeySpkiHash(options.approvalPublicKey) !== manifest.approval.publicKeySpkiSha256) fail("approval_public_key_mismatch");
  const signature = Buffer.from(approval.signature.slice("ed25519:".length), "base64");
  if (!verifySignature(null, approvalSigningBytes(approval), options.approvalPublicKey, signature)) fail("approval_signature_invalid");
}

function validateCanaries(manifest: CloudflarePromotionManifest, observations: readonly CanaryObservation[]): void {
  if (observations.length !== CANARY_CONTRACT.length) fail("canary_count_invalid");
  for (let index = 0; index < CANARY_CONTRACT.length; index += 1) {
    const expected = CANARY_CONTRACT[index];
    const actual = observations[index];
    if (!actual || actual.id !== expected.id || actual.status !== expected.status || actual.routed !== expected.routed || actual.accessDecision !== expected.accessDecision) fail(`canary_${expected.id}_failed`);
    if (actual.transport !== "http" || actual.hostnameResolved !== true) fail(`canary_${expected.id}_transport_unproven`);
    if (expected.accessDecision === "denied") {
      if (actual.accessEvidence !== "cloudflare_access_denial" || actual.accessAud !== undefined || actual.accessIssuer !== undefined || actual.accessPrincipal !== undefined) fail(`canary_${expected.id}_access_denial_unproven`);
    } else {
      if (actual.accessEvidence !== "jwt_binding_verified"
        || actual.accessAud !== manifest.access.audTag
        || actual.accessIssuer !== `https://${manifest.access.teamName}.cloudflareaccess.com`
        || actual.accessPrincipal !== `service-token:${manifest.names.serviceToken}`) fail(`canary_${expected.id}_access_binding_unproven`);
    }
    if (expected.id === "exact_model_success" && actual.model !== manifest.remoteKey.model) fail("canary_model_attribution_failed");
    if (expected.id !== "exact_model_success" && actual.model !== undefined) fail(`canary_${expected.id}_unexpected_model`);
  }
}

export async function promoteCloudflarePromotion(
  manifest: CloudflarePromotionManifest,
  prepared: PromotionReceipt,
  approval: PromotionApprovalReceipt,
  adapter: CloudflarePromotionAdapter,
  options: OperationOptions,
): Promise<PromotionReceipt> {
  validateApproval(manifest, prepared, approval, options);
  const approvalConsumption = await adapter.consumeApproval(approval);
  if (approvalConsumption.consumed !== true || approvalConsumption.durable !== true || approvalConsumption.atomic !== true) fail("approval_not_durably_consumed");
  let receipt = updateReceipt(prepared, "promoting", options.nowMs);
  receipt.approvalId = approval.approvalId;
  await adapter.writeReceipt(receipt);
  const tunnel = receipt.resources.tunnel;
  if (!tunnel) fail("prepared_tunnel_missing");

  try {
    const connectorOwnership = expectedResourceOwnershipHash(receipt, "connector", manifest.names.connector);
    await mutate(adapter, receipt, "connector", manifest.names.connector, () => adapter.startConnector({ argv: connectorCommand(manifest, tunnel.id), ownershipHash: connectorOwnership }));
    if (!await adapter.waitForConnector()) fail("connector_not_connected");
    await adapter.beforeMutation("dns");
    const dnsOwnership = expectedResourceOwnershipHash(receipt, "dns", manifest.hostname);
    const dns = await adapter.createDns({ target: `${tunnel.id}.cfargotunnel.com`, proxied: true, ownershipHash: dnsOwnership });
    if (dns.kind !== "dns" || dns.name !== manifest.hostname || !SAFE_ID.test(dns.id) || dns.ownershipHash !== dnsOwnership || !HASH.test(dns.stateHash)) fail("resource_dns_invalid");
    receipt.resources.dns = dns;
    receipt.preparedStateHash = receiptStateHash(receipt);
    await adapter.afterMutation("dns");
    await adapter.writeReceipt(receipt);
    validateCanaries(manifest, await adapter.runCanaries());
    receipt = updateReceipt(receipt, "promoted", options.nowMs);
    receipt.approvalId = approval.approvalId;
    await adapter.writeReceipt(receipt);
    return receipt;
  } catch (error) {
    try {
      await rollbackCloudflarePromotion(manifest, receipt, adapter, options);
    } catch (rollbackError) {
      throw new PromotionFailure("promotion_failed_and_rollback_failed", `${String(error)}; rollback: ${String(rollbackError)}`);
    }
    if (error instanceof PromotionFailure) throw error;
    throw new PromotionFailure("promotion_failed", String(error));
  }
}

function sameResource(expected: ResourceRef, actual: ResourceRef | null): boolean {
  return actual !== null
    && actual.kind === expected.kind
    && actual.id === expected.id
    && actual.name === expected.name
    && actual.ownershipHash === expected.ownershipHash
    && actual.stateHash === expected.stateHash;
}

export async function rollbackCloudflarePromotion(
  manifest: CloudflarePromotionManifest,
  receipt: PromotionReceipt,
  adapter: CloudflarePromotionAdapter,
  options: OperationOptions,
): Promise<PromotionReceipt> {
  if (receipt.state === "rolled_back") return receipt;
  const validation = validatePromotionReceipt(receipt);
  if (!validation.valid || receipt.manifestHash !== manifestHash(manifest)) fail("rollback_receipt_invalid");

  for (const ref of Object.values(receipt.resources)) {
    if (!ref) continue;
    if (!sameResource(ref, await adapter.inspectResource(ref))) fail(`rollback_resource_drift_${ref.kind}`);
  }

  let rolling = updateReceipt(receipt, "rolling_back", options.nowMs);
  await adapter.writeReceipt(rolling);
  const containmentFailures: string[] = [];
  if (rolling.resources.connector) {
    try {
      await adapter.stopConnector();
    } catch {
      containmentFailures.push("connector_stop_failed");
    }
  }
  if (rolling.resources.dns) {
    try {
      await adapter.deleteDns();
    } catch {
      containmentFailures.push("dns_delete_failed");
    }
  }
  if (containmentFailures.length > 0) {
    rolling = updateReceipt(rolling, "stuck_open", options.nowMs);
    rolling.failureCode = "PROMOTION_STUCK_OPEN";
    await adapter.writeReceipt(rolling);
    throw new PromotionFailure("PROMOTION_STUCK_OPEN", containmentFailures.join(","));
  }
  if (rolling.resources.tunnel) {
    await adapter.cleanupConnections();
    let empty = false;
    for (let attempt = 0; attempt < manifest.limits.connectionPollAttempts; attempt += 1) {
      if (await adapter.connectionCount() === 0) {
        empty = true;
        break;
      }
      if (attempt + 1 < manifest.limits.connectionPollAttempts) await adapter.wait(manifest.limits.connectionPollIntervalMs);
    }
    if (!empty) fail("rollback_connections_not_drained");
    await adapter.deleteTunnel();
  }
  if (rolling.resources.accessPolicy) await adapter.deleteAccessPolicy();
  if (rolling.resources.accessApplication) await adapter.deleteAccessApplication();
  if (rolling.resources.serviceToken) await adapter.deleteServiceToken();
  if (rolling.resources.remoteKey) await adapter.deleteRemoteKey();
  if (rolling.resources.connectorTokenFile || rolling.resources.serviceToken || rolling.resources.remoteKey) await adapter.deleteOwnedSecrets();

  rolling = updateReceipt(rolling, "rolled_back", options.nowMs);
  await adapter.writeReceipt(rolling);
  return rolling;
}

export async function recoverCloudflarePromotion(
  manifest: CloudflarePromotionManifest,
  adapter: CloudflarePromotionAdapter,
  options: OperationOptions,
): Promise<PromotionReceipt> {
  let journal = await adapter.discoverPrepared();
  const validation = validatePromotionReceipt(journal);
  if (!validation.valid || journal.manifestHash !== manifestHash(manifest) || !["preparing", "prepared"].includes(journal.state)) fail("recovery_receipt_invalid");
  if (journal.resources.connector || journal.resources.dns) fail("recovery_public_resource_unexpected");

  const expected: ReadonlyArray<readonly [ResourceKind, string]> = [
    ["remoteKey", manifest.names.remoteKey],
    ["serviceToken", manifest.names.serviceToken],
    ["accessApplication", manifest.names.accessApplication],
    ["accessPolicy", manifest.names.accessPolicy],
    ["tunnel", manifest.names.tunnel],
    ["tunnelConfiguration", "remote-managed"],
    ["connectorTokenFile", basename(manifest.paths.connectorTokenFile)],
  ];

  for (const [kind, deterministicName] of expected) {
    const recorded = journal.resources[kind];
    if (recorded) {
      if (recorded.name !== deterministicName || recorded.ownershipHash !== expectedResourceOwnershipHash(journal, kind, deterministicName) || !sameResource(recorded, await adapter.inspectResource(recorded))) fail(`recovery_resource_drift_${kind}`);
      continue;
    }
    const found = await adapter.discoverResource(kind, deterministicName);
    if (!found) continue;
    if (found.kind !== kind || found.name !== deterministicName || !SAFE_ID.test(found.id) || found.ownershipHash !== expectedResourceOwnershipHash(journal, kind, deterministicName) || !HASH.test(found.stateHash)) fail(`recovery_discovered_resource_invalid_${kind}`);
    journal.resources[kind] = found;
    journal.preparedStateHash = receiptStateHash(journal);
    await adapter.writeReceipt(journal);
  }

  const complete = expected.every(([kind]) => journal.resources[kind] !== undefined);
  if (!complete) {
    journal = updateReceipt(journal, "preparing", options.nowMs);
    await adapter.writeReceipt(journal);
    return rollbackCloudflarePromotion(manifest, journal, adapter, options);
  }
  const recovered = updateReceipt(journal, "prepared", options.nowMs);
  await adapter.writeReceipt(recovered);
  return recovered;
}
