import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as ed25519Sign,
  verify as ed25519Verify,
  type KeyLike,
  type KeyObject,
} from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";

export const SIGNED_PROBE_SCHEMA_VERSION = 1 as const;
export const SIGNED_PROBE_KIND = "temperance.signed-probe-receipt" as const;
export const SIGNED_PROBE_CLAIM_SCOPE = "signer_integrity_only" as const;
export const SIGNED_PROBE_DISCLAIMER_SCHEMA_VERSION = 1 as const;
export const SIGNED_PROBE_MAX_LIFETIME_MS = 300_000;
export const SIGNED_PROBE_MAX_CLOCK_SKEW_MS = 30_000;
export const SIGNED_PROBE_MAX_CANONICAL_BYTES = 65_536;
export const SIGNED_PROBE_MAX_DEPTH = 32;
export const SIGNED_PROBE_MAX_NODES = 10_000;
export const SIGNED_PROBE_DOES_NOT_ASSERT = [
  "cloudflare_resource_authority",
  "a2a_handler_safety",
  "write_capability",
] as const;

export type SignedProbeSurface = "cloudflare" | "a2a";

const DOMAIN_SEPARATORS: Record<SignedProbeSurface, string> = {
  cloudflare: "temperance.signed-probe.cloudflare.v1",
  a2a: "temperance.signed-probe.a2a.v1",
};

export interface UnsignedProbeReceipt {
  schemaVersion: 1;
  kind: typeof SIGNED_PROBE_KIND;
  surface: SignedProbeSurface;
  claimScope: typeof SIGNED_PROBE_CLAIM_SCOPE;
  disclaimerSchemaVersion: 1;
  doesNotAssert: string[];
  issuer: string;
  keyId: string;
  audience: string;
  challenge: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  payload: Record<string, unknown>;
}

export interface SignedProbeReceipt extends UnsignedProbeReceipt {
  signature: string;
}

export interface ProbeVerificationOptions {
  surface: SignedProbeSurface;
  audience: string;
  challenge: string;
  issuer: string;
  keyId: string;
  publicKey: KeyLike;
  issuedChallenges: readonly string[];
  consumedChallenges: readonly string[];
  nowMs?: number;
  maxLifetimeMs?: number;
  maxClockSkewMs?: number;
}

export interface ProbeVerificationResult {
  integrityValid: boolean;
  signatureValid: boolean;
  claimBoundaryValid: boolean;
  challengeBound: boolean;
  replayState: {
    status: "open" | "unissued" | "consumed" | "missing";
    observedAt: string;
    authorizing: false;
  };
  fresh: boolean;
  reasons: string[];
}

export interface ProbeVerificationBundle {
  receipt: SignedProbeReceipt;
  verification: ProbeVerificationOptions;
}

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizedString(value: string): boolean {
  return value === value.normalize("NFC") && !/[\uD800-\uDFFF]/u.test(value);
}

function normalizeCanonical(value: unknown, depth: number, state: { nodes: number }): CanonicalValue {
  if (depth > SIGNED_PROBE_MAX_DEPTH) throw new Error("canonical-depth-limit-exceeded");
  state.nodes += 1;
  if (state.nodes > SIGNED_PROBE_MAX_NODES) throw new Error("canonical-node-limit-exceeded");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (!normalizedString(value)) throw new Error("canonical-string-invalid");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("canonical-number-not-safe-integer");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((child) => normalizeCanonical(child, depth + 1, state));
  if (!isRecord(value)) throw new Error("canonical-value-unsupported");
  const entries = Object.entries(value)
    .map(([key, child]) => {
      if (!normalizedString(key)) throw new Error("canonical-key-invalid");
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        throw new Error("canonical-key-forbidden");
      }
      return [key, normalizeCanonical(child, depth + 1, state)] as const;
    })
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.fromEntries(entries);
}

export function canonicalProbeJson(value: unknown): string {
  const serialized = JSON.stringify(normalizeCanonical(value, 0, { nodes: 0 }));
  if (Buffer.byteLength(serialized, "utf8") > SIGNED_PROBE_MAX_CANONICAL_BYTES) {
    throw new Error("canonical-byte-limit-exceeded");
  }
  return serialized;
}

function frame(value: string): Buffer {
  const body = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(body.byteLength, 0);
  return Buffer.concat([length, body]);
}

function payloadHash(payload: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(canonicalProbeJson(payload)).digest("hex")}`;
}

function signingMessage(receipt: UnsignedProbeReceipt): Buffer {
  const metadata = {
    schemaVersion: receipt.schemaVersion,
    kind: receipt.kind,
    surface: receipt.surface,
    claimScope: receipt.claimScope,
    disclaimerSchemaVersion: receipt.disclaimerSchemaVersion,
    doesNotAssert: receipt.doesNotAssert,
    issuer: receipt.issuer,
    keyId: receipt.keyId,
    audience: receipt.audience,
    challenge: receipt.challenge,
    issuedAt: receipt.issuedAt,
    notBefore: receipt.notBefore,
    expiresAt: receipt.expiresAt,
    payloadHash: payloadHash(receipt.payload),
  };
  return Buffer.concat([frame(DOMAIN_SEPARATORS[receipt.surface]), frame(canonicalProbeJson(metadata))]);
}

function unsigned(receipt: SignedProbeReceipt): UnsignedProbeReceipt {
  const { signature: _signature, ...value } = receipt;
  return value;
}

function exactTopLevelKeys(value: Record<string, unknown>): boolean {
  const expected = [
    "audience",
    "challenge",
    "claimScope",
    "disclaimerSchemaVersion",
    "doesNotAssert",
    "expiresAt",
    "issuedAt",
    "issuer",
    "keyId",
    "kind",
    "notBefore",
    "payload",
    "schemaVersion",
    "signature",
    "surface",
  ].sort();
  return Object.keys(value).sort().join("\0") === expected.join("\0");
}

function nonEmptyNormalized(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && normalizedString(value);
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function trustedEd25519PublicKey(value: KeyLike): KeyObject | null {
  try {
    if (typeof value === "string" && /PRIVATE KEY/.test(value)) return null;
    if (Buffer.isBuffer(value) && /PRIVATE KEY/.test(value.toString("utf8"))) return null;
    if (typeof value === "object" && value !== null && "d" in value) return null;
    const key = value instanceof Object && "type" in value && (value as KeyObject).type
      ? value as KeyObject
      : createPublicKey(value);
    return key.type === "public" && key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

function exactDisclaimers(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === SIGNED_PROBE_DOES_NOT_ASSERT.length &&
    SIGNED_PROBE_DOES_NOT_ASSERT.every((claim, index) => value[index] === claim)
  );
}

function validChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function decodeSignature(value: unknown): Buffer | null {
  if (typeof value !== "string" || !value.startsWith("ed25519:")) return null;
  const encoded = value.slice("ed25519:".length);
  if (!/^[A-Za-z0-9+/]{86}==$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, "base64");
  return bytes.byteLength === 64 && bytes.toString("base64") === encoded ? bytes : null;
}

export function generateProbeChallenge(): string {
  return randomBytes(32).toString("hex");
}

export function probeChallengeLedgerKey(keyId: string, challenge: string): string {
  return `${keyId}:${challenge}`;
}

function ownerOnlyFile(path: string): boolean {
  return (statSync(path).mode & 0o077) === 0;
}

function boundedFile(path: string, limit: number): boolean {
  const stat = lstatSync(path);
  return stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit;
}

function parseCanonicalJsonFile(path: string): unknown {
  const raw = readFileSync(path, "utf8").trim();
  const parsed = JSON.parse(raw) as unknown;
  if (canonicalProbeJson(parsed) !== raw) throw new Error("signed-probe-json-not-canonical");
  return parsed;
}

function challengeListsFromLedger(value: unknown): {
  issuedChallenges: string[];
  consumedChallenges: string[];
} {
  if (!isRecord(value)) throw new Error("signed-probe-ledger-invalid");
  if (
    Array.isArray(value.issuedChallenges) &&
    value.issuedChallenges.every((entry) => typeof entry === "string") &&
    Array.isArray(value.consumedChallenges) &&
    value.consumedChallenges.every((entry) => typeof entry === "string")
  ) {
    return {
      issuedChallenges: value.issuedChallenges as string[],
      consumedChallenges: value.consumedChallenges as string[],
    };
  }
  const topLevelKeys = [
    "entries",
    "generation",
    "kind",
    "lastOperationId",
    "schemaVersion",
    "updatedAt",
  ].sort();
  if (
    Object.keys(value).sort().join("\0") !== topLevelKeys.join("\0") ||
    value.schemaVersion !== 1 ||
    value.kind !== "temperance.signed-probe-challenge-ledger" ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 1 ||
    typeof value.lastOperationId !== "string" ||
    !canonicalTimestamp(value.updatedAt) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 128
  ) {
    throw new Error("signed-probe-ledger-invalid");
  }
  const issuedChallenges: string[] = [];
  const consumedChallenges: string[] = [];
  for (const entry of value.entries) {
    const entryKeys = [
      "challenge",
      "consumedAt",
      "expiresAt",
      "issuedAt",
      "keyId",
      "retainUntil",
      "revokedAt",
      "status",
    ].sort();
    if (
      !isRecord(entry) ||
      Object.keys(entry).sort().join("\0") !== entryKeys.join("\0") ||
      !nonEmptyNormalized(entry.keyId) ||
      !/^[A-Za-z0-9._/@-]{1,128}$/.test(entry.keyId) ||
      !validChallenge(entry.challenge) ||
      !["issued", "consumed", "revoked"].includes(String(entry.status)) ||
      !canonicalTimestamp(entry.issuedAt) ||
      !canonicalTimestamp(entry.expiresAt) ||
      !canonicalTimestamp(entry.retainUntil)
    ) {
      throw new Error("signed-probe-ledger-invalid");
    }
    if (
      (entry.status === "issued" && (entry.consumedAt !== null || entry.revokedAt !== null)) ||
      (entry.status === "consumed" && (!canonicalTimestamp(entry.consumedAt) || entry.revokedAt !== null)) ||
      (entry.status === "revoked" && (!canonicalTimestamp(entry.revokedAt) || entry.consumedAt !== null))
    ) {
      throw new Error("signed-probe-ledger-invalid");
    }
    const key = probeChallengeLedgerKey(entry.keyId, entry.challenge);
    issuedChallenges.push(key);
    if (entry.status !== "issued") consumedChallenges.push(key);
  }
  if (new Set(issuedChallenges).size !== issuedChallenges.length) {
    throw new Error("signed-probe-ledger-invalid");
  }
  return { issuedChallenges, consumedChallenges };
}

export function loadProbeVerificationBundleFromEnv(
  surface: SignedProbeSurface,
  env: Record<string, string | undefined> = process.env,
): ProbeVerificationBundle | undefined {
  const receiptPath = env.TEMPERANCE_SIGNED_PROBE_RECEIPT;
  if (!receiptPath) return undefined;
  const publicKeyPath = env.TEMPERANCE_SIGNED_PROBE_PUBLIC_KEY;
  const ledgerPath = env.TEMPERANCE_SIGNED_PROBE_LEDGER;
  const issuer = env.TEMPERANCE_SIGNED_PROBE_ISSUER;
  const keyId = env.TEMPERANCE_SIGNED_PROBE_KEY_ID;
  const audience = env.TEMPERANCE_SIGNED_PROBE_AUDIENCE;
  const challenge = env.TEMPERANCE_SIGNED_PROBE_CHALLENGE;
  if (!publicKeyPath || !ledgerPath || !issuer || !keyId || !audience || !challenge) {
    throw new Error("signed-probe-trust-inputs-incomplete");
  }
  if (!ownerOnlyFile(receiptPath) || !ownerOnlyFile(ledgerPath)) {
    throw new Error("signed-probe-private-input-mode-invalid");
  }
  if (
    !boundedFile(receiptPath, SIGNED_PROBE_MAX_CANONICAL_BYTES) ||
    !boundedFile(ledgerPath, SIGNED_PROBE_MAX_CANONICAL_BYTES) ||
    !boundedFile(publicKeyPath, 16_384)
  ) {
    throw new Error("signed-probe-input-file-invalid-or-oversized");
  }
  const receipt = parseCanonicalJsonFile(receiptPath) as SignedProbeReceipt;
  const ledger = challengeListsFromLedger(parseCanonicalJsonFile(ledgerPath));
  return {
    receipt,
    verification: {
      surface,
      issuer,
      keyId,
      audience,
      challenge,
      publicKey: readFileSync(publicKeyPath, "utf8"),
      issuedChallenges: ledger.issuedChallenges,
      consumedChallenges: ledger.consumedChallenges,
    },
  };
}

export function signProbeReceipt(receipt: UnsignedProbeReceipt, privateKey: KeyLike): SignedProbeReceipt {
  const signature = ed25519Sign(null, signingMessage(receipt), privateKey);
  return { ...receipt, signature: `ed25519:${signature.toString("base64")}` };
}

export function verifySignedProbeReceipt(
  value: unknown,
  options: ProbeVerificationOptions,
): ProbeVerificationResult {
  const reasons: string[] = [];
  const nowMs = options.nowMs ?? Date.now();
  const observedAt = new Date(nowMs).toISOString();
  const receipt = isRecord(value) && exactTopLevelKeys(value) ? (value as unknown as SignedProbeReceipt) : null;
  if (!receipt) {
    return {
      integrityValid: false,
      signatureValid: false,
      claimBoundaryValid: false,
      challengeBound: false,
      replayState: { status: "missing", observedAt, authorizing: false },
      fresh: false,
      reasons: ["receipt-missing-malformed-or-extra-fields"],
    };
  }

  if (receipt.schemaVersion !== SIGNED_PROBE_SCHEMA_VERSION) reasons.push("schema-version-mismatch");
  if (receipt.kind !== SIGNED_PROBE_KIND) reasons.push("kind-mismatch");
  if (receipt.surface !== options.surface) reasons.push("surface-mismatch");
  if (!nonEmptyNormalized(receipt.issuer) || receipt.issuer !== options.issuer) reasons.push("issuer-mismatch");
  if (!nonEmptyNormalized(receipt.keyId) || receipt.keyId !== options.keyId) reasons.push("key-id-mismatch");
  if (!nonEmptyNormalized(receipt.audience) || receipt.audience !== options.audience) reasons.push("audience-mismatch");
  if (!isRecord(receipt.payload)) reasons.push("payload-missing-or-invalid");

  const claimBoundaryValid =
    receipt.claimScope === SIGNED_PROBE_CLAIM_SCOPE &&
    receipt.disclaimerSchemaVersion === SIGNED_PROBE_DISCLAIMER_SCHEMA_VERSION &&
    exactDisclaimers(receipt.doesNotAssert);
  if (!claimBoundaryValid) reasons.push("claim-boundary-invalid");

  const challengeBound = validChallenge(receipt.challenge) && receipt.challenge === options.challenge;
  if (!challengeBound) reasons.push("challenge-mismatch-or-invalid");
  const ledgerKey = probeChallengeLedgerKey(options.keyId, options.challenge);
  const replayStatePresent = Array.isArray(options.issuedChallenges) && Array.isArray(options.consumedChallenges);
  const replayStatus: ProbeVerificationResult["replayState"]["status"] = !replayStatePresent
    ? "missing"
    : options.consumedChallenges.includes(ledgerKey)
      ? "consumed"
      : options.issuedChallenges.includes(ledgerKey)
        ? "open"
        : "unissued";
  if (replayStatus !== "open") {
    reasons.push(replayStatePresent ? "challenge-unissued-or-replayed" : "challenge-ledger-missing");
  }

  const maxLifetimeMs = options.maxLifetimeMs ?? SIGNED_PROBE_MAX_LIFETIME_MS;
  const maxClockSkewMs = options.maxClockSkewMs ?? SIGNED_PROBE_MAX_CLOCK_SKEW_MS;
  const issuedAt = canonicalTimestamp(receipt.issuedAt) ? Date.parse(receipt.issuedAt) : Number.NaN;
  const notBefore = canonicalTimestamp(receipt.notBefore) ? Date.parse(receipt.notBefore) : Number.NaN;
  const expiresAt = canonicalTimestamp(receipt.expiresAt) ? Date.parse(receipt.expiresAt) : Number.NaN;
  const fresh =
    Number.isFinite(issuedAt) &&
    Number.isFinite(notBefore) &&
    Number.isFinite(expiresAt) &&
    issuedAt <= notBefore &&
    issuedAt <= nowMs + maxClockSkewMs &&
    notBefore <= nowMs + maxClockSkewMs &&
    expiresAt > nowMs &&
    expiresAt > notBefore &&
    expiresAt - issuedAt <= maxLifetimeMs;
  if (!fresh) reasons.push("receipt-time-window-invalid");

  let signatureValid = false;
  const signature = decodeSignature(receipt.signature);
  const trustedPublicKey = trustedEd25519PublicKey(options.publicKey);
  if (!signature) {
    reasons.push("signature-missing-or-malformed");
  } else if (!trustedPublicKey) {
    reasons.push("trusted-ed25519-public-key-invalid");
  } else {
    try {
      signatureValid = ed25519Verify(null, signingMessage(unsigned(receipt)), trustedPublicKey, signature);
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) reasons.push("signature-invalid");
  }

  return {
    integrityValid: reasons.length === 0,
    signatureValid,
    claimBoundaryValid,
    challengeBound,
    replayState: { status: replayStatus, observedAt, authorizing: false },
    fresh,
    reasons,
  };
}

// Test and fixture convenience only. Production collectors should own their
// private key outside this repository and expose only a pinned public key.
export function generateProbeKeyPairForFixture(): ReturnType<typeof generateKeyPairSync> {
  return generateKeyPairSync("ed25519");
}
