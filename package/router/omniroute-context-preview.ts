import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const OMNIROUTE_CONTEXT_PREVIEW_ENDPOINT =
  "http://127.0.0.1:20128/api/compression/preview" as const;
export const OMNIROUTE_CONTEXT_PREVIEW_SCHEMA =
  "temperance.omniroute.context-preview.v2" as const;
export const OMNIROUTE_NATIVE_SNAPSHOT_SCHEMA =
  "temperance.omniroute.native-control-plane.v1" as const;
export const SUPPORTED_OMNIROUTE_PREVIEW_VERSION = "3.8.48" as const;

export const CONTEXT_PREVIEW_CANDIDATES = ["lite", "headroom", "rtk-minimal"] as const;
export const CONTEXT_PREVIEW_HELD_ENGINES = [
  "session-dedup",
  "ccr",
  "relevance",
  "caveman",
  "aggressive",
  "ultra",
  "llmlingua",
  "omniglyph",
] as const;

export type ContextPreviewCandidate = (typeof CONTEXT_PREVIEW_CANDIDATES)[number];
export type HeldContextEngine = (typeof CONTEXT_PREVIEW_HELD_ENGINES)[number];

const MAX_STATUS_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 10_000;
const STATUS_TIMEOUT_MS = 15_000;
const MAX_SNAPSHOT_LIFETIME_MS = 30_000;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const ANONYMOUS_DENIAL_CANARY = "OMNIROUTE_ANONYMOUS_PREVIEW_CANARY_V1";

const STAGE_MARKERS = [
  { id: "pai-stage-observe", value: "PAI_STAGE_01=observe" },
  { id: "pai-stage-think", value: "PAI_STAGE_02=think" },
  { id: "pai-stage-plan", value: "PAI_STAGE_03=plan" },
  { id: "pai-stage-build", value: "PAI_STAGE_04=build" },
  { id: "pai-stage-execute", value: "PAI_STAGE_05=execute" },
  { id: "pai-stage-verify", value: "PAI_STAGE_06=verify" },
  { id: "pai-stage-learn", value: "PAI_STAGE_07=learn" },
] as const;

const TOOL_SCHEMA_MARKER =
  'TOOL_SCHEMA={"name":"temperance_probe","input_schema":{"type":"object","required":["fixture_id"],"properties":{"fixture_id":{"type":"string"}}}}';
const CODE_TOKEN_MARKER = 'const TEMPERANCE_CODE_TOKEN = "TE_CODE_CANARY_8D1F";';
const CODE_BLOCK_MARKER = `CODE_BLOCK_START
\`\`\`ts
${CODE_TOKEN_MARKER}
\`\`\`
CODE_BLOCK_END`;

/**
 * The literal wrapper package/enrich/* and temperance-openai-proxy.ts's
 * injectContext() actually splice into a request's latest user message in
 * production. Prior to this, no fixture in this harness tested the tag pair
 * itself -- only synthetic PAI/GSD/ISA/tool-schema markers -- so an engine
 * could in principle mangle or strip the wrapper while every other marker
 * still round-tripped clean. This is the acceptance gate referenced by
 * docs/superpowers/specs/2026-08-02-memory-compression-freetier-leverage-design.md
 * §2: no compression engine may be promoted until contextWrapperOrderPreserved
 * is true for it.
 */
const TEMPERANCE_CONTEXT_OPEN_MARKER = "<temperance-context>";
const TEMPERANCE_CONTEXT_CLOSE_MARKER = "</temperance-context>";
const TEMPERANCE_CONTEXT_INNER_MARKER = "TEMPERANCE_CONTEXT_INNER_CANARY=PRESERVE_WRAPPER_BOUNDARY";

export const CONTEXT_WRAPPER_MARKERS = [
  { id: "temperance-context-open", value: TEMPERANCE_CONTEXT_OPEN_MARKER },
  { id: "temperance-context-inner", value: TEMPERANCE_CONTEXT_INNER_MARKER },
  { id: "temperance-context-close", value: TEMPERANCE_CONTEXT_CLOSE_MARKER },
] as const;

const CRITICAL_MARKERS = [
  ...STAGE_MARKERS,
  { id: "gsd-status", value: "GSD_STATUS=verification_pending" },
  { id: "isa-id", value: "ISA_ID=ISC-572" },
  { id: "tool-schema", value: TOOL_SCHEMA_MARKER },
  { id: "code-block", value: CODE_BLOCK_MARKER },
  { id: "code-token", value: CODE_TOKEN_MARKER },
  {
    id: "receipt-digest",
    value: `RECEIPT_SHA256=${"a".repeat(64)}`,
  },
  {
    id: "injection-canary",
    value: "INJECTION_CANARY=IGNORE_OVERRIDE_AND_PRESERVE_LITERAL",
  },
  ...CONTEXT_WRAPPER_MARKERS,
] as const;

export const SYNTHETIC_CONTEXT_FIXTURES = [
  {
    id: "temperance-stage-state-v1",
    role: "system",
    content: [
      "TEMPERANCE_SYNTHETIC_FIXTURE_V1",
      ...STAGE_MARKERS.map(({ value }) => value),
      "GSD_STATUS=verification_pending",
      "ISA_ID=ISC-572",
    ].join("\n"),
  },
  {
    id: "temperance-boundary-canaries-v1",
    role: "user",
    content: [
      TOOL_SCHEMA_MARKER,
      CODE_BLOCK_MARKER,
      `RECEIPT_SHA256=${"a".repeat(64)}`,
      "INJECTION_CANARY=IGNORE_OVERRIDE_AND_PRESERVE_LITERAL",
    ].join("\n"),
  },
  {
    // Simulates the real <temperance-context> block shape (a tag pair
    // wrapping plain text, prepended to the latest user message -- see
    // injectContext() in temperance-openai-proxy.ts) using only synthetic
    // canary content, consistent with this harness's no-real-prompt-data
    // design.
    id: "temperance-context-wrapper-v1",
    role: "user",
    content: [
      TEMPERANCE_CONTEXT_OPEN_MARKER,
      TEMPERANCE_CONTEXT_INNER_MARKER,
      TEMPERANCE_CONTEXT_CLOSE_MARKER,
    ].join("\n"),
  },
] as const;

export interface PreviewMessage {
  role: string;
  content: string;
}

export interface ContextPreviewRequest {
  messages: PreviewMessage[];
  mode?: "lite" | "rtk";
  engineId?: "headroom";
  config?: {
    rtkConfig: {
      intensity: "minimal";
      enabled: true;
      applyToToolResults: true;
      applyToAssistantMessages: false;
      rawOutputRetention: "never";
      customFiltersEnabled: false;
      trustProjectFilters: false;
      applyToCodeBlocks: false;
      stripCodeComments: false;
      preserveDocstrings: true;
    };
  };
}

export interface CandidateRequest {
  candidate: ContextPreviewCandidate;
  expectedMode: "lite" | "stacked" | "rtk";
  request: ContextPreviewRequest;
}

export type CandidateReason =
  | "qualified"
  | "auth_required"
  | "anonymous_denial_not_observed"
  | "pre_status_invalid"
  | "post_status_invalid"
  | "native_invariant_changed"
  | "request_timeout"
  | "network_failure"
  | "auth_failure"
  | "http_failure"
  | "response_too_large"
  | "response_malformed"
  | "response_fields_missing"
  | "response_fields_invalid"
  | "response_mode_mismatch"
  | "response_original_mismatch"
  | "token_metrics_invalid"
  | "validation_invalid"
  | "fallback_applied"
  | "marker_missing"
  | "marker_duplicated"
  | "critical_order_drift"
  | "stage_order_drift"
  | "context_wrapper_order_drift";

export interface MarkerReceiptResult {
  id: string;
  count: number;
  exactlyOnce: boolean;
}

export interface CandidateMetrics {
  originalTokens: number;
  compressedTokens: number;
  tokensSaved: number;
  savingsPct: number;
  durationMs: number;
}

export interface CandidateDecision {
  candidate: ContextPreviewCandidate;
  disposition: "qualified" | "held";
  reasons: CandidateReason[];
  expectedMode: "lite" | "stacked" | "rtk";
  observedMode: string | null;
  httpStatus: number | null;
  metrics: CandidateMetrics | null;
  markers: MarkerReceiptResult[];
  criticalOrderPreserved: boolean;
  stageOrderPreserved: boolean;
  contextWrapperOrderPreserved: boolean;
}

export interface NativeInvariantReceipt {
  preValid: boolean;
  postValid: boolean;
  equal: boolean;
  preCode: string | null;
  postCode: string | null;
  preSha256: string | null;
  postSha256: string | null;
  changedFields: string[];
}

export interface AnonymousProbeReceipt {
  attempted: boolean;
  httpStatus: number | null;
  denialObserved: boolean;
  observation: "auth_required" | "anonymous_denial_not_observed" | "not_attempted";
}

export interface ContextPreviewReceipt {
  schema: typeof OMNIROUTE_CONTEXT_PREVIEW_SCHEMA;
  createdAt: string;
  endpoint: typeof OMNIROUTE_CONTEXT_PREVIEW_ENDPOINT;
  installedContractVersion: typeof SUPPORTED_OMNIROUTE_PREVIEW_VERSION;
  mode: "synthetic-preview-qualification";
  result: "qualified" | "held";
  authorization: false;
  promotionAuthorized: false;
  settingsMutationAuthorized: false;
  tokenSupplied: false;
  authState: "anonymous_denied" | "anonymous_not_denied" | "not_attempted";
  candidateOrder: ContextPreviewCandidate[];
  heldEngines: HeldContextEngine[];
  fixtures: Array<{ id: string; sha256: string }>;
  anonymousProbe: AnonymousProbeReceipt | null;
  candidates: CandidateDecision[];
  nativeInvariants: NativeInvariantReceipt;
}

export interface ContextPreviewRunResult {
  result: "qualified" | "held";
  receiptPath: string;
  receipt: ContextPreviewReceipt;
}

export type PreviewFetch = (url: string, init: RequestInit) => Promise<Response>;
export type NativeStatusProbe = () => Promise<unknown> | unknown;
export type ContextPreviewReceiptWriter = (
  root: string,
  receipt: ContextPreviewReceipt,
) => Promise<string> | string;

export interface ContextPreviewHooks {
  fetchImpl?: PreviewFetch;
  statusProbe?: NativeStatusProbe;
  receiptWriter?: ContextPreviewReceiptWriter;
  now?: () => Date;
  requestTimeoutMs?: number;
}

export interface ContextPreviewRunOptions {
  receiptRoot?: string;
  hooks?: ContextPreviewHooks;
}

export class ContextPreviewError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ContextPreviewError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new ContextPreviewError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cloneMessages(): PreviewMessage[] {
  return SYNTHETIC_CONTEXT_FIXTURES.map(({ role, content }) => ({ role, content }));
}

export function syntheticPreviewOriginal(): string {
  return SYNTHETIC_CONTEXT_FIXTURES.map(({ role, content }) => `${role}: ${content}`).join("\n");
}

export function buildContextPreviewRequests(): CandidateRequest[] {
  return [
    {
      candidate: "lite",
      expectedMode: "lite",
      request: { mode: "lite", messages: cloneMessages() },
    },
    {
      candidate: "headroom",
      expectedMode: "stacked",
      request: { engineId: "headroom", messages: cloneMessages() },
    },
    {
      candidate: "rtk-minimal",
      expectedMode: "rtk",
      request: {
        mode: "rtk",
        messages: cloneMessages(),
        config: {
          rtkConfig: {
            intensity: "minimal",
            enabled: true,
            applyToToolResults: true,
            applyToAssistantMessages: false,
            rawOutputRetention: "never",
            customFiltersEnabled: false,
            trustProjectFilters: false,
            applyToCodeBlocks: false,
            stripCodeComments: false,
            preserveDocstrings: true,
          },
        },
      },
    },
  ];
}

function emptyMarkers(): MarkerReceiptResult[] {
  return CRITICAL_MARKERS.map(({ id }) => ({ id, count: 0, exactlyOnce: false }));
}

function heldDecision(candidate: CandidateRequest, reason: CandidateReason): CandidateDecision {
  return {
    candidate: candidate.candidate,
    disposition: "held",
    reasons: [reason],
    expectedMode: candidate.expectedMode,
    observedMode: null,
    httpStatus: null,
    metrics: null,
    markers: emptyMarkers(),
    criticalOrderPreserved: false,
    stageOrderPreserved: false,
    contextWrapperOrderPreserved: false,
  };
}

function addReason(decision: CandidateDecision, reason: CandidateReason): CandidateDecision {
  return {
    ...decision,
    disposition: "held",
    reasons: decision.reasons.includes(reason) ? decision.reasons : [...decision.reasons, reason],
  };
}

function countOccurrences(text: string, value: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= text.length - value.length) {
    const found = text.indexOf(value, offset);
    if (found < 0) break;
    count += 1;
    offset = found + value.length;
  }
  return count;
}

function orderedExactlyOnce(text: string, markers: readonly { value: string }[]): boolean {
  let previous = -1;
  for (const marker of markers) {
    if (countOccurrences(text, marker.value) !== 1) return false;
    const index = text.indexOf(marker.value);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function safeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const REQUIRED_PREVIEW_FIELDS = [
  "encoderComparison",
  "original",
  "compressed",
  "originalTokens",
  "compressedTokens",
  "tokensSaved",
  "savingsPct",
  "techniquesUsed",
  "engineBreakdown",
  "riskGate",
  "quantumLock",
  "durationMs",
  "mode",
  "intensity",
  "outputMode",
  "skippedReasons",
  "diff",
  "preservedBlocks",
  "ruleRemovals",
  "rulesApplied",
  "validation",
  "validationWarnings",
  "validationErrors",
  "fallbackApplied",
  "fallbackReason",
  "fallbackReasons",
] as const;

interface ValidationResult {
  reasons: CandidateReason[];
  observedMode: string | null;
  metrics: CandidateMetrics | null;
  markers: MarkerReceiptResult[];
  criticalOrderPreserved: boolean;
  stageOrderPreserved: boolean;
  contextWrapperOrderPreserved: boolean;
}

function pushReason(reasons: CandidateReason[], reason: CandidateReason): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function validatePreviewPayload(payload: unknown, candidate: CandidateRequest): ValidationResult {
  const reasons: CandidateReason[] = [];
  if (!isRecord(payload)) {
    return {
      reasons: ["response_malformed"],
      observedMode: null,
      metrics: null,
      markers: emptyMarkers(),
      criticalOrderPreserved: false,
      stageOrderPreserved: false,
      contextWrapperOrderPreserved: false,
    };
  }
  if (REQUIRED_PREVIEW_FIELDS.some((key) => !Object.prototype.hasOwnProperty.call(payload, key))) {
    pushReason(reasons, "response_fields_missing");
  }

  const observedMode = typeof payload.mode === "string" ? payload.mode : null;
  if (observedMode !== candidate.expectedMode) pushReason(reasons, "response_mode_mismatch");
  if (payload.original !== syntheticPreviewOriginal()) pushReason(reasons, "response_original_mismatch");

  const metricValues = [
    payload.originalTokens,
    payload.compressedTokens,
    payload.tokensSaved,
    payload.savingsPct,
    payload.durationMs,
  ];
  const metricsValid = metricValues.every(safeNonNegativeInteger);
  let metrics: CandidateMetrics | null = null;
  if (metricsValid) {
    metrics = {
      originalTokens: payload.originalTokens as number,
      compressedTokens: payload.compressedTokens as number,
      tokensSaved: payload.tokensSaved as number,
      savingsPct: payload.savingsPct as number,
      durationMs: payload.durationMs as number,
    };
    const expectedSaved = metrics.originalTokens - metrics.compressedTokens;
    const expectedPct =
      metrics.originalTokens > 0 ? Math.round((expectedSaved / metrics.originalTokens) * 100) : 0;
    if (
      expectedSaved < 0 ||
      metrics.tokensSaved !== expectedSaved ||
      metrics.savingsPct !== expectedPct ||
      metrics.savingsPct > 100
    ) {
      pushReason(reasons, "token_metrics_invalid");
    }
  } else {
    pushReason(reasons, "response_fields_invalid");
  }

  const arrayFields = [
    payload.techniquesUsed,
    payload.engineBreakdown,
    payload.skippedReasons,
    payload.diff,
    payload.preservedBlocks,
    payload.ruleRemovals,
    payload.rulesApplied,
    payload.validationWarnings,
    payload.validationErrors,
    payload.fallbackReasons,
  ];
  if (arrayFields.some((value) => !Array.isArray(value))) pushReason(reasons, "response_fields_invalid");
  if (!stringArray(payload.skippedReasons) || !stringArray(payload.validationWarnings)) {
    pushReason(reasons, "response_fields_invalid");
  }
  const validationErrors = stringArray(payload.validationErrors) ? payload.validationErrors : [];
  const fallbackReasons = stringArray(payload.fallbackReasons) ? payload.fallbackReasons : [];
  if (!stringArray(payload.validationErrors) || !stringArray(payload.fallbackReasons)) {
    pushReason(reasons, "response_fields_invalid");
  }

  const validation = payload.validation;
  if (
    !isRecord(validation) ||
    typeof validation.valid !== "boolean" ||
    !stringArray(validation.errors) ||
    !stringArray(validation.warnings) ||
    typeof validation.fallbackApplied !== "boolean"
  ) {
    pushReason(reasons, "response_fields_invalid");
  } else if (!validation.valid || validation.errors.length > 0 || validationErrors.length > 0) {
    pushReason(reasons, "validation_invalid");
  }

  if (typeof payload.fallbackApplied !== "boolean") pushReason(reasons, "response_fields_invalid");
  const fallbackReasonValid = payload.fallbackReason === null || typeof payload.fallbackReason === "string";
  if (!fallbackReasonValid) pushReason(reasons, "response_fields_invalid");
  if (
    payload.fallbackApplied === true ||
    (isRecord(validation) && validation.fallbackApplied === true) ||
    (typeof payload.fallbackReason === "string" && payload.fallbackReason.length > 0) ||
    fallbackReasons.length > 0 ||
    (Array.isArray(payload.skippedReasons) && payload.skippedReasons.length > 0)
  ) {
    pushReason(reasons, "fallback_applied");
  }

  const compressed = typeof payload.compressed === "string" ? payload.compressed : "";
  if (typeof payload.compressed !== "string") pushReason(reasons, "response_fields_invalid");
  const markers = CRITICAL_MARKERS.map(({ id, value }) => {
    const count = countOccurrences(compressed, value);
    if (count === 0) pushReason(reasons, "marker_missing");
    if (count > 1) pushReason(reasons, "marker_duplicated");
    return { id, count, exactlyOnce: count === 1 };
  });
  const criticalOrderPreserved = orderedExactlyOnce(compressed, CRITICAL_MARKERS);
  const stageOrderPreserved = orderedExactlyOnce(compressed, STAGE_MARKERS);
  const contextWrapperOrderPreserved = orderedExactlyOnce(compressed, CONTEXT_WRAPPER_MARKERS);
  if (!criticalOrderPreserved) pushReason(reasons, "critical_order_drift");
  if (!stageOrderPreserved) pushReason(reasons, "stage_order_drift");
  if (!contextWrapperOrderPreserved) pushReason(reasons, "context_wrapper_order_drift");

  return {
    reasons,
    observedMode,
    metrics,
    markers,
    criticalOrderPreserved,
    stageOrderPreserved,
    contextWrapperOrderPreserved,
  };
}

async function boundedResponseText(
  response: Response,
  limit: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let abortListener: (() => void) | null = null;
  const abortPromise = signal
    ? new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(new ContextPreviewError("request_timeout"));
        if (signal.aborted) abortListener();
        else signal.addEventListener("abort", abortListener, { once: true });
      })
    : null;
  try {
    while (true) {
      const next = abortPromise
        ? await Promise.race([reader.read(), abortPromise])
        : await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => undefined);
        throw new ContextPreviewError("response_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    if (signal?.aborted) void reader.cancel().catch(() => undefined);
    else reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(output);
  } catch {
    throw new ContextPreviewError("response_malformed");
  }
}

async function timedFetch(
  fetchImpl: PreviewFetch,
  init: RequestInit,
  timeoutMs: number,
): Promise<{
  response: Response | null;
  reason: CandidateReason | null;
  signal: AbortSignal;
  finish: () => void;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
  };
  try {
    const response = await fetchImpl(OMNIROUTE_CONTEXT_PREVIEW_ENDPOINT, {
      ...init,
      signal: controller.signal,
    });
    return { response, reason: null, signal: controller.signal, finish };
  } catch (error) {
    const timeout = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    finish();
    return {
      response: null,
      reason: timeout ? "request_timeout" : "network_failure",
      signal: controller.signal,
      finish,
    };
  }
}

async function anonymousDenialProbe(
  fetchImpl: PreviewFetch,
  timeoutMs: number,
): Promise<AnonymousProbeReceipt> {
  const transport = await timedFetch(fetchImpl, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "lite",
      messages: [{ role: "user", content: ANONYMOUS_DENIAL_CANARY }],
    }),
  }, timeoutMs);
  if (!transport.response) {
    return {
      attempted: true,
      httpStatus: null,
      denialObserved: false,
      observation: "anonymous_denial_not_observed",
    };
  }
  const response = transport.response;
  try {
    void response.body?.cancel().catch(() => undefined);
    const denialObserved = response.status === 401 || response.status === 403;
    return {
      attempted: true,
      httpStatus: response.status,
      denialObserved,
      observation: denialObserved ? "auth_required" : "anonymous_denial_not_observed",
    };
  } finally {
    transport.finish();
  }
}

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function canonicalValue(value: unknown): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) fail("native_snapshot_projection_invalid");
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

interface NativeProjection {
  compression: CanonicalValue;
  dispatch: CanonicalValue;
  contextSources: CanonicalValue;
  customSystemPrompt: CanonicalValue;
  runtime: CanonicalValue;
  databaseIdentity: CanonicalValue;
  hermes: CanonicalValue;
  cloudflare: CanonicalValue;
}

interface StatusCapture {
  valid: boolean;
  code: string | null;
  projection: NativeProjection | null;
}

function nested(record: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = record;
  for (const key of keys) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, key)) {
      fail("native_snapshot_projection_missing");
    }
    current = current[key];
  }
  return current;
}

export function projectNativePreviewInvariants(snapshot: unknown, now: Date): NativeProjection {
  if (!isRecord(snapshot)) fail("native_snapshot_invalid");
  if (snapshot.schema !== OMNIROUTE_NATIVE_SNAPSHOT_SCHEMA) fail("native_snapshot_schema_invalid");
  if (snapshot.fresh !== true || snapshot.promotionAuthorized !== false) fail("native_snapshot_authority_invalid");
  if (!Array.isArray(snapshot.mutationMethods) || snapshot.mutationMethods.length !== 0) {
    fail("native_snapshot_mutation_contract_invalid");
  }
  const installedVersion = nested(snapshot, "evidence", "installedVersion");
  const runtimeVersion = nested(snapshot, "evidence", "runtime", "version");
  if (
    installedVersion !== SUPPORTED_OMNIROUTE_PREVIEW_VERSION ||
    runtimeVersion !== SUPPORTED_OMNIROUTE_PREVIEW_VERSION
  ) {
    fail("native_snapshot_version_invalid");
  }
  if (typeof snapshot.collectedAt !== "string" || typeof snapshot.expiresAt !== "string") {
    fail("native_snapshot_freshness_invalid");
  }
  const collectedAt = Date.parse(snapshot.collectedAt);
  const expiresAt = Date.parse(snapshot.expiresAt);
  const nowMs = now.getTime();
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(collectedAt) ||
    !Number.isFinite(expiresAt) ||
    collectedAt > nowMs + 1_000 ||
    expiresAt <= nowMs ||
    expiresAt <= collectedAt ||
    expiresAt - collectedAt > MAX_SNAPSHOT_LIFETIME_MS
  ) {
    fail("native_snapshot_freshness_invalid");
  }
  return {
    compression: canonicalValue(nested(snapshot, "layers", "policy", "compression")),
    dispatch: canonicalValue(nested(snapshot, "layers", "policy", "dispatch")),
    contextSources: canonicalValue(nested(snapshot, "layers", "policy", "contextSources")),
    customSystemPrompt: canonicalValue(nested(snapshot, "layers", "policy", "customSystemPrompt")),
    runtime: canonicalValue(nested(snapshot, "evidence", "runtime")),
    databaseIdentity: canonicalValue(nested(snapshot, "evidence", "database")),
    hermes: canonicalValue(nested(snapshot, "layers", "execution", "hermes")),
    cloudflare: canonicalValue(nested(snapshot, "layers", "authority", "cloudflare")),
  };
}

async function captureStatus(probe: NativeStatusProbe, now: Date): Promise<StatusCapture> {
  try {
    const snapshot = await probe();
    return { valid: true, code: null, projection: projectNativePreviewInvariants(snapshot, now) };
  } catch (error) {
    return {
      valid: false,
      code: error instanceof ContextPreviewError ? error.code : "native_status_probe_failed",
      projection: null,
    };
  }
}

function compareStatus(pre: StatusCapture, post: StatusCapture): NativeInvariantReceipt {
  const fieldNames: Array<keyof NativeProjection> = [
    "compression",
    "dispatch",
    "contextSources",
    "customSystemPrompt",
    "runtime",
    "databaseIdentity",
    "hermes",
    "cloudflare",
  ];
  const changedFields =
    pre.projection && post.projection
      ? fieldNames.filter((field) => canonicalJson(pre.projection?.[field]) !== canonicalJson(post.projection?.[field]))
      : [];
  const preJson = pre.projection ? canonicalJson(pre.projection) : null;
  const postJson = post.projection ? canonicalJson(post.projection) : null;
  return {
    preValid: pre.valid,
    postValid: post.valid,
    equal: pre.valid && post.valid && changedFields.length === 0,
    preCode: pre.code,
    postCode: post.code,
    preSha256: preJson ? sha256(preJson) : null,
    postSha256: postJson ? sha256(postJson) : null,
    changedFields,
  };
}

function validateSafeDirectory(path: string, requirePrivate: boolean): void {
  const stat = lstatSync(path);
  const uid = process.getuid?.();
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(path) !== path) {
    fail("receipt_root_not_real_directory");
  }
  if (uid === undefined || stat.uid !== uid) fail("receipt_root_owner_invalid");
  if ((stat.mode & 0o022) !== 0) fail("receipt_root_mode_invalid");
  if (requirePrivate && ((stat.mode & 0o077) !== 0 || (stat.mode & 0o700) !== 0o700)) {
    fail("receipt_root_mode_invalid");
  }
}

function createValidatedDirectoryChain(path: string, target: string): void {
  if (existsSync(path)) {
    validateSafeDirectory(path, path === target);
    return;
  }
  const parent = dirname(path);
  if (parent === path) fail("receipt_root_parent_invalid");
  createValidatedDirectoryChain(parent, target);
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (!existsSync(path)) throw error;
  }
  validateSafeDirectory(path, path === target);
}

function ensurePrivateReceiptRoot(rootInput: string): string {
  if (!isAbsolute(rootInput) || resolve(rootInput) !== rootInput || rootInput !== rootInput.normalize("NFC")) {
    fail("receipt_root_not_absolute_canonical");
  }
  createValidatedDirectoryChain(rootInput, rootInput);
  const root = realpathSync(rootInput);
  validateSafeDirectory(rootInput, true);
  return root;
}

const FORBIDDEN_RECEIPT_KEYS = new Set([
  "token",
  "tokenPath",
  "prompt",
  "prompts",
  "original",
  "compressed",
  "diff",
  "body",
  "bodies",
  "content",
  "messages",
  "request",
  "response",
  "authorizationHeader",
]);

function assertMetadataOnlyReceipt(receipt: ContextPreviewReceipt): string {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_RECEIPT_KEYS.has(key)) fail("receipt_forbidden_key");
      visit(child);
    }
  };
  visit(receipt);
  const serialized = JSON.stringify(receipt);
  if (CRITICAL_MARKERS.some(({ value }) => serialized.includes(value))) fail("receipt_marker_leakage");
  if (SYNTHETIC_CONTEXT_FIXTURES.some(({ content }) => serialized.includes(content))) fail("receipt_fixture_leakage");
  if (serialized.includes(ANONYMOUS_DENIAL_CANARY)) fail("receipt_fixture_leakage");
  return serialized;
}

export function writeContextPreviewReceipt(rootInput: string, receipt: ContextPreviewReceipt): string {
  const root = ensurePrivateReceiptRoot(rootInput);
  const serialized = assertMetadataOnlyReceipt(receipt);
  const stamp = receipt.createdAt.replace(/[-:.]/gu, "").replace("T", "T").replace("Z", "Z");
  const directory = mkdtempSync(join(root, `${stamp}-${process.pid}-`));
  chmodSync(directory, 0o700);
  const receiptPath = join(directory, "receipt.json");
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      receiptPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    writeFileSync(descriptor, `${serialized}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  const stat = statSync(receiptPath);
  const uid = process.getuid?.();
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== uid || (stat.mode & 0o777) !== 0o600) {
    fail("receipt_file_postcondition_invalid");
  }
  return receiptPath;
}

export function defaultContextPreviewReceiptRoot(): string {
  return resolve(homedir(), ".temperance_engine/receipts/omniroute-context-preview");
}

async function readBoundedStream(stream: ReadableStream<Uint8Array>, maximum: number): Promise<string> {
  const response = new Response(stream);
  return boundedResponseText(response, maximum);
}

export function createNativeStatusProbe(
  scriptPath = resolve(import.meta.dir, "../../scripts/omniroute-native-status.ts"),
): NativeStatusProbe {
  if (!isAbsolute(scriptPath) || basename(scriptPath) !== "omniroute-native-status.ts") {
    fail("native_status_script_invalid");
  }
  return async () => {
    const subprocess = Bun.spawn({
      cmd: [process.execPath, scriptPath],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutPromise = readBoundedStream(subprocess.stdout, MAX_STATUS_BYTES);
    const stderrPromise = readBoundedStream(subprocess.stderr, MAX_STATUS_BYTES).catch(() => "");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ContextPreviewError("native_status_timeout")), STATUS_TIMEOUT_MS);
    });
    let exitCode: number;
    try {
      exitCode = await Promise.race([subprocess.exited, timeout]);
    } catch (error) {
      subprocess.kill();
      await subprocess.exited.catch(() => undefined);
      throw error;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    const [stdout] = await Promise.all([stdoutPromise, stderrPromise]);
    if (exitCode !== 0) fail("native_status_nonzero");
    try {
      return JSON.parse(stdout);
    } catch {
      fail("native_status_malformed");
    }
  };
}

function fixtureReceiptMetadata(): Array<{ id: string; sha256: string }> {
  return SYNTHETIC_CONTEXT_FIXTURES.map(({ id, content }) => ({ id, sha256: sha256(content) }));
}

function validateReceiptShape(receipt: ContextPreviewReceipt): void {
  if (receipt.fixtures.some(({ sha256: digest }) => !SHA256_HEX.test(digest))) fail("receipt_hash_invalid");
  assertMetadataOnlyReceipt(receipt);
}

export async function runContextPreviewQualification(
  options: ContextPreviewRunOptions = {},
): Promise<ContextPreviewRunResult> {
  const hooks = options.hooks ?? {};
  const now = hooks.now ?? (() => new Date());
  const created = now();
  if (!Number.isFinite(created.getTime())) fail("clock_invalid");
  const fetchImpl = hooks.fetchImpl ?? ((url, init) => fetch(url, init));
  const requestTimeoutMs = hooks.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > REQUEST_TIMEOUT_MS
  ) {
    fail("request_timeout_invalid");
  }
  const statusProbe = hooks.statusProbe ?? createNativeStatusProbe();
  const receiptWriter = hooks.receiptWriter ?? writeContextPreviewReceipt;
  const receiptRoot = ensurePrivateReceiptRoot(options.receiptRoot ?? defaultContextPreviewReceiptRoot());
  const requests = buildContextPreviewRequests();

  const pre = await captureStatus(statusProbe, now());
  const anonymousProbe: AnonymousProbeReceipt = pre.valid
    ? await anonymousDenialProbe(fetchImpl, requestTimeoutMs)
    : {
        attempted: false,
        httpStatus: null,
        denialObserved: false,
        observation: "not_attempted",
      };
  const post = await captureStatus(statusProbe, now());
  const nativeInvariants = compareStatus(pre, post);
  const initialReason: CandidateReason =
    pre.valid && anonymousProbe.observation !== "not_attempted"
      ? anonymousProbe.observation
      : "pre_status_invalid";
  let candidates = requests.map((candidate) =>
    heldDecision(candidate, initialReason),
  );
  if (!pre.valid) candidates = candidates.map((decision) => addReason(decision, "pre_status_invalid"));
  if (!post.valid) candidates = candidates.map((decision) => addReason(decision, "post_status_invalid"));
  else if (!nativeInvariants.equal) {
    candidates = candidates.map((decision) => addReason(decision, "native_invariant_changed"));
  }

  const receipt: ContextPreviewReceipt = {
    schema: OMNIROUTE_CONTEXT_PREVIEW_SCHEMA,
    createdAt: created.toISOString(),
    endpoint: OMNIROUTE_CONTEXT_PREVIEW_ENDPOINT,
    installedContractVersion: SUPPORTED_OMNIROUTE_PREVIEW_VERSION,
    mode: "synthetic-preview-qualification",
    result: "held",
    authorization: false,
    promotionAuthorized: false,
    settingsMutationAuthorized: false,
    tokenSupplied: false,
    authState: !anonymousProbe.attempted
      ? "not_attempted"
      : anonymousProbe.denialObserved
        ? "anonymous_denied"
        : "anonymous_not_denied",
    candidateOrder: [...CONTEXT_PREVIEW_CANDIDATES],
    heldEngines: [...CONTEXT_PREVIEW_HELD_ENGINES],
    fixtures: fixtureReceiptMetadata(),
    anonymousProbe,
    candidates,
    nativeInvariants,
  };
  validateReceiptShape(receipt);
  const receiptPath = await receiptWriter(receiptRoot, receipt);
  if (typeof receiptPath !== "string" || receiptPath.length === 0) fail("receipt_writer_result_invalid");
  return { result: receipt.result, receiptPath, receipt };
}
