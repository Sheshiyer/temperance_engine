import { createHash } from "node:crypto";
import { constants as fsConstants, fstatSync, lstatSync, mkdirSync, openSync, closeSync, fsyncSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const S_TIER_OUTCOMES = [
  "FALSIFIED",
  "CONSISTENT_UNPROVEN",
  "ENV_UNAVAILABLE",
  "QUOTA_BLOCKED",
  "TRANSPORT_FAIL",
  "PINNING_UNVERIFIED",
  "STRUCTURALLY_UNVERIFIABLE",
] as const;

export type STierOutcome = (typeof S_TIER_OUTCOMES)[number];
export const CONTROL_EVIDENCE_CODES = [
  "expected_404",
  "transport_timeout",
  "transport_network",
  "unexpected_status",
  "invalid_response_shape",
  "nonce_missing",
  "value_missing",
  "attribution_missing",
  "unexpected_attribution",
  "expected_mismatch",
] as const;
export type ControlEvidenceCode = (typeof CONTROL_EVIDENCE_CODES)[number];
export type EvidenceMode = "fixture" | "live";
export type ProbeKind = "content" | "tool";
export type ScheduleKind = "pin_before" | "mismatch" | "candidate" | "pin_after";

export interface CandidatePrerequisite {
  kind: "executable";
  name: string;
}

export interface STierCandidate {
  id: string;
  provider: string;
  model: string;
  owner: string;
  expected_serving_provider: string;
  expected_serving_model: string;
  explicit_pin: true;
  reasoning_capable: true;
  prerequisite?: CandidatePrerequisite;
}

export interface STierManifest {
  schema_version: 1;
  kind: "temperance.omniroute-s-tier-falsification-plan";
  mode: "falsification-only";
  endpoint: "http://127.0.0.1:20128/v1/chat/completions";
  limits: {
    per_request_timeout_ms: number;
    total_timeout_ms: number;
    max_tokens: number;
    max_requests: number;
    receipt_lifetime_ms: number;
    max_response_bytes: number;
  };
  probe_contract: {
    compression: "off";
    stream: false;
    temperature: 0;
    tool_name: "te_probe_noop";
    content_value: "CONTENT_OK";
    tool_value: "TOOL_OK";
  };
  controls: {
    pin_denial: {
      provider: string;
      model: string;
      expected_http_status: 404;
      positions: ["before", "after"];
    };
    attribution_mismatch: {
      provider: "auto";
      model: "claude-opus";
      expected_serving_provider: "nebius";
      expected_serving_model: "meta-llama/Llama-3.3-70B-Instruct";
    };
  };
  candidates: STierCandidate[];
}

export interface ProbeScheduleEntry {
  ordinal: number;
  kind: ScheduleKind;
  provider: string;
  model: string;
  candidateId?: string;
  probe: ProbeKind;
}

export interface SanitizedObservation {
  ordinal: number;
  kind: ScheduleKind;
  candidateId?: string;
  probe: ProbeKind;
  transport: "http" | "timeout" | "network";
  httpStatus: number | null;
  typedErrorCode: "insufficient_quota" | null;
  observedProvider: string | null;
  observedModel: string | null;
  responseShape: "valid" | "invalid";
  noncePresent: boolean;
  valuePresent: boolean;
  refusalPresent: boolean;
  finishReason: "stop" | "tool_calls" | "length" | "other" | null;
  toolNameValid: boolean;
  normalized: boolean;
}

export interface FixtureEvidence {
  schema_version: 1;
  kind: "temperance.omniroute-s-tier-fixture";
  executable_presence: Record<string, boolean>;
  observations: SanitizedObservation[];
}

export interface CandidateTelemetry {
  candidateId: string;
  requestedProvider: string;
  requestedModel: string;
  owner: string;
  outcome: STierOutcome;
  requestsAttempted: number;
  evidenceCodes: string[];
}

export interface STierTelemetryReceipt {
  schemaVersion: 1;
  kind: "temperance.omniroute-s-tier-falsification-telemetry";
  evidenceMode: EvidenceMode;
  integrityScope: "unauthenticated_local_telemetry";
  doesNotEstablish: ["identity", "readiness", "authorization", "promotion"];
  issuedAt: string;
  expiresAt: string;
  manifestCanonicalSha256: string;
  probeSourceSha256: string;
  nonceSha256: string;
  requestCount: number;
  requestCeiling: number;
  controls: {
    pinBefore: "EXPECTED" | "UNEXPECTED_PINNING" | "UNEXPECTED_STRUCTURE";
    mismatch: "EXPECTED" | "UNEXPECTED_PINNING" | "UNEXPECTED_STRUCTURE";
    pinAfter: "EXPECTED" | "UNEXPECTED_PINNING" | "UNEXPECTED_STRUCTURE";
  };
  controlEvidenceCodes: {
    pinBefore: ControlEvidenceCode[];
    mismatch: ControlEvidenceCode[];
    pinAfter: ControlEvidenceCode[];
  };
  candidates: CandidateTelemetry[];
}

const EXPECTED_CANDIDATES = new Set([
  "aug\0claude-opus-4.6\0auggie\0claude-opus-4.6\0auggie\0auggie",
  "tllm\0CLAUDE_4_6_OPUS\0theoldllm\0CLAUDE_4_6_OPUS\0theoldllm\0",
  "tllm\0claude_opus_4\0theoldllm\0claude_opus_4\0theoldllm\0",
]);
const FORBIDDEN_CANDIDATE_TOKEN = /(^|[-_/.])(?:codex|sol(?:-max)?|auto|no[-_]?think)(?=$|[-_/.])/iu;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_ATTRIBUTION = /^[^\u0000-\u0020\u007f]{1,256}$/u;

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  if (Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) throw new Error(code);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(code);
  return value as number;
}

export function parseSTierManifest(value: unknown): STierManifest {
  const root = record(value, "manifest_not_object");
  exactKeys(root, ["schema_version", "kind", "mode", "endpoint", "limits", "probe_contract", "controls", "candidates"], "manifest_keys_invalid");
  if (root.schema_version !== 1 || root.kind !== "temperance.omniroute-s-tier-falsification-plan" || root.mode !== "falsification-only") {
    throw new Error("manifest_identity_invalid");
  }
  if (root.endpoint !== "http://127.0.0.1:20128/v1/chat/completions") throw new Error("manifest_endpoint_not_exact_loopback");

  const limits = record(root.limits, "manifest_limits_invalid");
  exactKeys(limits, ["per_request_timeout_ms", "total_timeout_ms", "max_tokens", "max_requests", "receipt_lifetime_ms", "max_response_bytes"], "manifest_limit_keys_invalid");
  const parsedLimits = {
    per_request_timeout_ms: boundedInteger(limits.per_request_timeout_ms, 100, 30_000, "per_request_timeout_invalid"),
    total_timeout_ms: boundedInteger(limits.total_timeout_ms, 500, 120_000, "total_timeout_invalid"),
    max_tokens: boundedInteger(limits.max_tokens, 1, 256, "max_tokens_invalid"),
    max_requests: boundedInteger(limits.max_requests, 1, 9, "max_requests_invalid"),
    receipt_lifetime_ms: boundedInteger(limits.receipt_lifetime_ms, 1_000, 300_000, "receipt_lifetime_invalid"),
    max_response_bytes: boundedInteger(limits.max_response_bytes, 1_024, 65_536, "response_bytes_invalid"),
  };
  if (parsedLimits.total_timeout_ms <= parsedLimits.per_request_timeout_ms) throw new Error("total_timeout_not_greater_than_request_timeout");

  const probe = record(root.probe_contract, "probe_contract_invalid");
  exactKeys(probe, ["compression", "stream", "temperature", "tool_name", "content_value", "tool_value"], "probe_contract_keys_invalid");
  if (probe.compression !== "off" || probe.stream !== false || probe.temperature !== 0 || probe.tool_name !== "te_probe_noop" || probe.content_value !== "CONTENT_OK" || probe.tool_value !== "TOOL_OK") {
    throw new Error("probe_contract_values_invalid");
  }

  const controls = record(root.controls, "controls_invalid");
  exactKeys(controls, ["pin_denial", "attribution_mismatch"], "control_keys_invalid");
  const pin = record(controls.pin_denial, "pin_control_invalid");
  exactKeys(pin, ["provider", "model", "expected_http_status", "positions"], "pin_control_keys_invalid");
  if (pin.provider !== "nebius" || pin.model !== "temperance-probe-nonexistent" || pin.expected_http_status !== 404 || JSON.stringify(pin.positions) !== '["before","after"]') {
    throw new Error("pin_control_values_invalid");
  }
  const mismatch = record(controls.attribution_mismatch, "mismatch_control_invalid");
  exactKeys(mismatch, ["provider", "model", "expected_serving_provider", "expected_serving_model"], "mismatch_control_keys_invalid");
  if (mismatch.provider !== "auto" || mismatch.model !== "claude-opus" || mismatch.expected_serving_provider !== "nebius" || mismatch.expected_serving_model !== "meta-llama/Llama-3.3-70B-Instruct") {
    throw new Error("mismatch_control_values_invalid");
  }

  if (!Array.isArray(root.candidates) || root.candidates.length !== EXPECTED_CANDIDATES.size) throw new Error("candidate_count_invalid");
  const candidates: STierCandidate[] = [];
  const ids = new Set<string>();
  const pins = new Set<string>();
  const tuples = new Set<string>();
  for (const unknownCandidate of root.candidates) {
    const candidate = record(unknownCandidate, "candidate_invalid");
    const allowedKeys = candidate.prerequisite === undefined
      ? ["id", "provider", "model", "owner", "expected_serving_provider", "expected_serving_model", "explicit_pin", "reasoning_capable"]
      : ["id", "provider", "model", "owner", "expected_serving_provider", "expected_serving_model", "explicit_pin", "reasoning_capable", "prerequisite"];
    exactKeys(candidate, allowedKeys, "candidate_keys_invalid");
    if (![candidate.id, candidate.provider, candidate.model, candidate.owner, candidate.expected_serving_provider, candidate.expected_serving_model].every((item) => typeof item === "string" && SAFE_ID.test(item))) throw new Error("candidate_identifier_invalid");
    if (candidate.explicit_pin !== true || candidate.reasoning_capable !== true) throw new Error("candidate_not_explicit_reasoning");
    if (FORBIDDEN_CANDIDATE_TOKEN.test(`${candidate.provider}/${candidate.model}`)) throw new Error("candidate_family_forbidden");
    let prerequisite: CandidatePrerequisite | undefined;
    if (candidate.prerequisite !== undefined) {
      const prereq = record(candidate.prerequisite, "candidate_prerequisite_invalid");
      exactKeys(prereq, ["kind", "name"], "candidate_prerequisite_keys_invalid");
      if (prereq.kind !== "executable" || prereq.name !== "auggie") throw new Error("candidate_prerequisite_values_invalid");
      prerequisite = { kind: "executable", name: "auggie" };
    }
    const id = candidate.id as string;
    const provider = candidate.provider as string;
    const model = candidate.model as string;
    const owner = candidate.owner as string;
    const expectedServingProvider = candidate.expected_serving_provider as string;
    const expectedServingModel = candidate.expected_serving_model as string;
    const pinKey = `${provider}\0${model}`;
    const tuple = `${provider}\0${model}\0${expectedServingProvider}\0${expectedServingModel}\0${owner}\0${prerequisite?.name ?? ""}`;
    if (ids.has(id) || pins.has(pinKey)) throw new Error("candidate_duplicate");
    if (!EXPECTED_CANDIDATES.has(tuple)) throw new Error("candidate_not_preregistered");
    ids.add(id);
    pins.add(pinKey);
    tuples.add(tuple);
    candidates.push({ id, provider, model, owner, expected_serving_provider: expectedServingProvider, expected_serving_model: expectedServingModel, explicit_pin: true, reasoning_capable: true, ...(prerequisite ? { prerequisite } : {}) });
  }
  if (tuples.size !== EXPECTED_CANDIDATES.size || [...EXPECTED_CANDIDATES].some((tuple) => !tuples.has(tuple))) throw new Error("candidate_set_mismatch");

  const manifest: STierManifest = {
    schema_version: 1,
    kind: "temperance.omniroute-s-tier-falsification-plan",
    mode: "falsification-only",
    endpoint: "http://127.0.0.1:20128/v1/chat/completions",
    limits: parsedLimits,
    probe_contract: { compression: "off", stream: false, temperature: 0, tool_name: "te_probe_noop", content_value: "CONTENT_OK", tool_value: "TOOL_OK" },
    controls: {
      pin_denial: { provider: "nebius", model: "temperance-probe-nonexistent", expected_http_status: 404, positions: ["before", "after"] },
      attribution_mismatch: { provider: "auto", model: "claude-opus", expected_serving_provider: "nebius", expected_serving_model: "meta-llama/Llama-3.3-70B-Instruct" },
    },
    candidates,
  };
  if (maximumScheduledRequests(manifest) !== parsedLimits.max_requests) throw new Error("request_ceiling_not_exact");
  return manifest;
}

type Canonical = null | boolean | number | string | Canonical[] | { [key: string]: Canonical };

function canonical(value: unknown): Canonical {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  const object = record(value, "canonical_value_invalid");
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonical(object[key])])) as { [key: string]: Canonical };
}

export function canonicalManifestBytes(manifest: STierManifest): Buffer {
  return Buffer.from(JSON.stringify(canonical(manifest)), "utf8");
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function maximumScheduledRequests(manifest: STierManifest): number {
  return 3 + manifest.candidates.length * 2;
}

export function buildProbeSchedule(manifest: STierManifest, executablePresence: Readonly<Record<string, boolean>>): ProbeScheduleEntry[] {
  const entries: Omit<ProbeScheduleEntry, "ordinal">[] = [
    { kind: "pin_before", provider: manifest.controls.pin_denial.provider, model: manifest.controls.pin_denial.model, probe: "content" },
    { kind: "mismatch", provider: manifest.controls.attribution_mismatch.provider, model: manifest.controls.attribution_mismatch.model, probe: "content" },
  ];
  for (const candidate of manifest.candidates) {
    if (candidate.prerequisite && executablePresence[candidate.prerequisite.name] !== true) continue;
    entries.push({ kind: "candidate", candidateId: candidate.id, provider: candidate.provider, model: candidate.model, probe: "content" });
    entries.push({ kind: "candidate", candidateId: candidate.id, provider: candidate.provider, model: candidate.model, probe: "tool" });
  }
  entries.push({ kind: "pin_after", provider: manifest.controls.pin_denial.provider, model: manifest.controls.pin_denial.model, probe: "content" });
  if (entries.length > manifest.limits.max_requests) throw new Error("request_ceiling_exceeded");
  return entries.map((entry, ordinal) => ({ ordinal, ...entry }));
}

export function createProbeRequest(manifest: STierManifest, entry: ProbeScheduleEntry, nonce: string): Record<string, unknown> {
  if (!/^[a-f0-9]{32}$/u.test(nonce)) throw new Error("nonce_invalid");
  const base: Record<string, unknown> = {
    model: `${entry.provider}/${entry.model}`,
    messages: [{ role: "user", content: `Return the nonce ${nonce} and ${manifest.probe_contract.content_value}.` }],
    stream: false,
    temperature: 0,
    max_tokens: manifest.limits.max_tokens,
  };
  if (entry.probe === "tool") {
    base.messages = [{ role: "user", content: `Call te_probe_noop with nonce ${nonce} and value ${manifest.probe_contract.tool_value}. Do not perform any other action.` }];
    base.tools = [{ type: "function", function: { name: "te_probe_noop", description: "Inert evidence shape; never executed.", parameters: { type: "object", additionalProperties: false, required: ["nonce", "value"], properties: { nonce: { type: "string" }, value: { type: "string" } } } } }];
    base.tool_choice = { type: "function", function: { name: "te_probe_noop" } };
  }
  return base;
}

function safeAttribution(value: string | null): string | null {
  return value && SAFE_ATTRIBUTION.test(value) ? value : null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(value), "json_not_object");
  } catch {
    return null;
  }
}

export function sanitizeHttpObservation(entry: ProbeScheduleEntry, status: number, headers: Headers, bodyText: string, nonce: string): SanitizedObservation {
  const payload = parseJsonObject(bodyText);
  const error = payload && payload.error && typeof payload.error === "object" && !Array.isArray(payload.error) ? payload.error as Record<string, unknown> : null;
  const typedErrorCode = status === 403 && error?.code === "insufficient_quota" ? "insufficient_quota" : null;
  const choices = payload && Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] && typeof choices[0] === "object" && !Array.isArray(choices[0]) ? choices[0] as Record<string, unknown> : null;
  const message = first?.message && typeof first.message === "object" && !Array.isArray(first.message) ? first.message as Record<string, unknown> : null;
  const content = typeof message?.content === "string" ? message.content : "";
  const refusalPresent = typeof message?.refusal === "string" && message.refusal.length > 0;
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const firstCall = toolCalls[0] && typeof toolCalls[0] === "object" && !Array.isArray(toolCalls[0]) ? toolCalls[0] as Record<string, unknown> : null;
  const fn = firstCall?.function && typeof firstCall.function === "object" && !Array.isArray(firstCall.function) ? firstCall.function as Record<string, unknown> : null;
  const args = typeof fn?.arguments === "string" ? parseJsonObject(fn.arguments) : null;
  const finish = first?.finish_reason;
  const finishReason = finish === "stop" || finish === "tool_calls" || finish === "length" ? finish : typeof finish === "string" ? "other" : null;
  const isTool = entry.probe === "tool";
  return {
    ordinal: entry.ordinal,
    kind: entry.kind,
    ...(entry.candidateId ? { candidateId: entry.candidateId } : {}),
    probe: entry.probe,
    transport: "http",
    httpStatus: status,
    typedErrorCode,
    observedProvider: safeAttribution(headers.get("x-omniroute-provider")),
    observedModel: safeAttribution(headers.get("x-omniroute-model")),
    responseShape: payload ? "valid" : "invalid",
    noncePresent: isTool ? args?.nonce === nonce : content.includes(nonce),
    valuePresent: isTool ? args?.value === "TOOL_OK" : content.includes("CONTENT_OK"),
    refusalPresent,
    finishReason,
    toolNameValid: isTool ? fn?.name === "te_probe_noop" : true,
    normalized: typeof bodyText === "string" && bodyText === bodyText.normalize("NFC"),
  };
}

export function transportObservation(entry: ProbeScheduleEntry, transport: "timeout" | "network"): SanitizedObservation {
  return { ordinal: entry.ordinal, kind: entry.kind, ...(entry.candidateId ? { candidateId: entry.candidateId } : {}), probe: entry.probe, transport, httpStatus: null, typedErrorCode: null, observedProvider: null, observedModel: null, responseShape: "invalid", noncePresent: false, valuePresent: false, refusalPresent: false, finishReason: null, toolNameValid: false, normalized: true };
}

function pinControlEvidence(observation: SanitizedObservation | undefined): ControlEvidenceCode[] {
  if (!observation) return ["invalid_response_shape"];
  if (observation.transport === "timeout") return ["transport_timeout"];
  if (observation.transport === "network") return ["transport_network"];
  if (observation.observedProvider || observation.observedModel) return ["unexpected_attribution"];
  return observation.httpStatus === 404 ? ["expected_404"] : ["unexpected_status"];
}

function pinControl(observation: SanitizedObservation | undefined): "EXPECTED" | "UNEXPECTED_PINNING" | "UNEXPECTED_STRUCTURE" {
  const evidence = pinControlEvidence(observation);
  if (evidence.includes("expected_404")) return "EXPECTED";
  return evidence.includes("unexpected_attribution") ? "UNEXPECTED_PINNING" : "UNEXPECTED_STRUCTURE";
}

function mismatchControlEvidence(manifest: STierManifest, observation: SanitizedObservation | undefined): ControlEvidenceCode[] {
  if (!observation) return ["invalid_response_shape"];
  if (observation.transport === "timeout") return ["transport_timeout"];
  if (observation.transport === "network") return ["transport_network"];
  const evidence: ControlEvidenceCode[] = [];
  if (observation.httpStatus !== 200) evidence.push("unexpected_status");
  if (observation.responseShape !== "valid") evidence.push("invalid_response_shape");
  if (!observation.noncePresent) evidence.push("nonce_missing");
  if (!observation.valuePresent) evidence.push("value_missing");
  if (!observation.observedProvider || !observation.observedModel) evidence.push("attribution_missing");
  else if (observation.observedProvider !== manifest.controls.attribution_mismatch.expected_serving_provider || observation.observedModel !== manifest.controls.attribution_mismatch.expected_serving_model) evidence.push("unexpected_attribution");
  if (evidence.length === 0) evidence.push("expected_mismatch");
  return evidence;
}

function mismatchControl(manifest: STierManifest, observation: SanitizedObservation | undefined): "EXPECTED" | "UNEXPECTED_PINNING" | "UNEXPECTED_STRUCTURE" {
  const evidence = mismatchControlEvidence(manifest, observation);
  if (evidence.includes("expected_mismatch")) return "EXPECTED";
  if (evidence.some((code) => ["transport_timeout", "transport_network", "unexpected_status", "invalid_response_shape", "nonce_missing", "value_missing"].includes(code))) return "UNEXPECTED_STRUCTURE";
  if (evidence.includes("attribution_missing") || evidence.includes("unexpected_attribution")) return "UNEXPECTED_PINNING";
  return "UNEXPECTED_STRUCTURE";
}

export function earlyControlsExpected(manifest: STierManifest, observations: readonly SanitizedObservation[]): boolean {
  return pinControl(observations.find((item) => item.kind === "pin_before")) === "EXPECTED"
    && mismatchControl(manifest, observations.find((item) => item.kind === "mismatch")) === "EXPECTED";
}

function evaluateCandidate(candidate: STierCandidate, observations: SanitizedObservation[], executablePresence: Readonly<Record<string, boolean>>): CandidateTelemetry {
  if (candidate.prerequisite && executablePresence[candidate.prerequisite.name] !== true) {
    return { candidateId: candidate.id, requestedProvider: candidate.provider, requestedModel: candidate.model, owner: candidate.owner, outcome: "ENV_UNAVAILABLE", requestsAttempted: 0, evidenceCodes: ["prerequisite_executable_absent"] };
  }
  const own = observations.filter((item) => item.kind === "candidate" && item.candidateId === candidate.id).sort((left, right) => left.ordinal - right.ordinal);
  if (own.length !== 2 || own[0]?.probe !== "content" || own[1]?.probe !== "tool") {
    return { candidateId: candidate.id, requestedProvider: candidate.provider, requestedModel: candidate.model, owner: candidate.owner, outcome: "STRUCTURALLY_UNVERIFIABLE", requestsAttempted: own.length, evidenceCodes: ["candidate_schedule_incomplete"] };
  }
  if (own.some((item) => item.transport !== "http")) return { candidateId: candidate.id, requestedProvider: candidate.provider, requestedModel: candidate.model, owner: candidate.owner, outcome: "TRANSPORT_FAIL", requestsAttempted: 2, evidenceCodes: ["transport_failure"] };
  if (own.some((item) => item.httpStatus === 403 && item.typedErrorCode === "insufficient_quota")) return { candidateId: candidate.id, requestedProvider: candidate.provider, requestedModel: candidate.model, owner: candidate.owner, outcome: "QUOTA_BLOCKED", requestsAttempted: 2, evidenceCodes: ["typed_quota_block"] };
  if (own.some((item) => item.httpStatus === null || item.httpStatus < 200 || item.httpStatus >= 300)) return { candidateId: candidate.id, requestedProvider: candidate.provider, requestedModel: candidate.model, owner: candidate.owner, outcome: "TRANSPORT_FAIL", requestsAttempted: 2, evidenceCodes: ["http_failure_unclassified"] };
  const explicitContradiction = own.some((item) => item.observedProvider !== null && item.observedModel !== null && (item.observedProvider !== candidate.expected_serving_provider || item.observedModel !== candidate.expected_serving_model));
  if (explicitContradiction) return { candidateId: candidate.id, requestedProvider: candidate.provider, requestedModel: candidate.model, owner: candidate.owner, outcome: "FALSIFIED", requestsAttempted: 2, evidenceCodes: ["explicit_serving_attribution_contradiction"] };
  const attributionExact = own.every((item) => item.observedProvider === candidate.expected_serving_provider && item.observedModel === candidate.expected_serving_model);
  const shapeAgreement = own.every((item) => item.responseShape === "valid" && item.noncePresent && item.valuePresent && !item.refusalPresent && item.finishReason !== "length" && item.normalized) && own[1].toolNameValid;
  if (!attributionExact) return { candidateId: candidate.id, requestedProvider: candidate.provider, requestedModel: candidate.model, owner: candidate.owner, outcome: "PINNING_UNVERIFIED", requestsAttempted: 2, evidenceCodes: ["serving_attribution_missing"] };
  if (!shapeAgreement) return { candidateId: candidate.id, requestedProvider: candidate.provider, requestedModel: candidate.model, owner: candidate.owner, outcome: "STRUCTURALLY_UNVERIFIABLE", requestsAttempted: 2, evidenceCodes: ["content_tool_evidence_incomplete"] };
  return { candidateId: candidate.id, requestedProvider: candidate.provider, requestedModel: candidate.model, owner: candidate.owner, outcome: "CONSISTENT_UNPROVEN", requestsAttempted: 2, evidenceCodes: ["content_tool_agreement_non_authoritative"] };
}

export function createTelemetryReceipt(options: { manifest: STierManifest; evidenceMode: EvidenceMode; executablePresence: Readonly<Record<string, boolean>>; observations: SanitizedObservation[]; nonce: string; manifestCanonicalBytes: Uint8Array; probeSourceBytes: Uint8Array; now?: Date }): STierTelemetryReceipt {
  const { manifest } = options;
  const schedule = buildProbeSchedule(manifest, options.executablePresence);
  let previousOrdinal = -1;
  for (const item of options.observations) {
    const expected = schedule[item.ordinal];
    if (item.ordinal <= previousOrdinal || !expected || item.kind !== expected.kind || item.probe !== expected.probe || item.candidateId !== expected.candidateId) throw new Error("observation_schedule_mismatch");
    previousOrdinal = item.ordinal;
  }
  for (const control of ["pin_before", "mismatch", "pin_after"] as const) {
    if (options.observations.filter((item) => item.kind === control).length !== 1) throw new Error("observation_control_missing_or_duplicate");
  }
  const pinBefore = pinControl(options.observations.find((item) => item.kind === "pin_before"));
  const mismatchObservation = options.observations.find((item) => item.kind === "mismatch");
  const mismatch = mismatchControl(manifest, mismatchObservation);
  const pinAfterObservation = options.observations.find((item) => item.kind === "pin_after");
  const pinAfter = pinControl(pinAfterObservation);
  const pinBeforeObservation = options.observations.find((item) => item.kind === "pin_before");
  const controlValues = [pinBefore, mismatch, pinAfter];
  const override: STierOutcome | null = controlValues.some((value) => value === "UNEXPECTED_STRUCTURE") ? "STRUCTURALLY_UNVERIFIABLE" : controlValues.some((value) => value === "UNEXPECTED_PINNING") ? "PINNING_UNVERIFIED" : null;
  const candidates = manifest.candidates.map((candidate) => {
    const result = evaluateCandidate(candidate, options.observations, options.executablePresence);
    const candidateScheduleMissing = result.evidenceCodes.includes("candidate_schedule_incomplete");
    return override && !candidateScheduleMissing ? { ...result, outcome: override, evidenceCodes: [...result.evidenceCodes, "instrument_control_voided_interpretation"] } : result;
  });
  const issuedAt = options.now ?? new Date();
  return {
    schemaVersion: 1,
    kind: "temperance.omniroute-s-tier-falsification-telemetry",
    evidenceMode: options.evidenceMode,
    integrityScope: "unauthenticated_local_telemetry",
    doesNotEstablish: ["identity", "readiness", "authorization", "promotion"],
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + manifest.limits.receipt_lifetime_ms).toISOString(),
    manifestCanonicalSha256: sha256(options.manifestCanonicalBytes),
    probeSourceSha256: sha256(options.probeSourceBytes),
    nonceSha256: sha256(options.nonce),
    requestCount: options.observations.length,
    requestCeiling: manifest.limits.max_requests,
    controls: { pinBefore, mismatch, pinAfter },
    controlEvidenceCodes: {
      pinBefore: pinControlEvidence(pinBeforeObservation),
      mismatch: mismatchControlEvidence(manifest, mismatchObservation),
      pinAfter: pinControlEvidence(pinAfterObservation),
    },
    candidates,
  };
}

export function writePrivateReceipt(path: string, receipt: STierTelemetryReceipt): void {
  const target = resolve(path);
  const directory = dirname(target);
  try {
    mkdirSync(directory, { recursive: false, mode: 0o700 });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code !== "EEXIST") throw new Error("receipt_directory_create_failed");
  }
  const directoryStat = lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== process.getuid?.() || (directoryStat.mode & 0o777) !== 0o700) throw new Error("receipt_directory_not_private");
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
  let fd: number | null = null;
  try {
    fd = openSync(target, flags, 0o600);
    const fileStat = fstatSync(fd);
    if (!fileStat.isFile() || fileStat.uid !== process.getuid?.() || (fileStat.mode & 0o777) !== 0o600) throw new Error("receipt_file_not_private");
    writeFileSync(fd, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8" });
    fsyncSync(fd);
  } catch (error) {
    if (error instanceof Error && error.message === "receipt_file_not_private") throw error;
    throw new Error("receipt_exclusive_write_failed");
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function parseFixtureEvidence(value: unknown): FixtureEvidence {
  const root = record(value, "fixture_not_object");
  exactKeys(root, ["schema_version", "kind", "executable_presence", "observations"], "fixture_keys_invalid");
  if (root.schema_version !== 1 || root.kind !== "temperance.omniroute-s-tier-fixture") throw new Error("fixture_identity_invalid");
  const executablePresence = record(root.executable_presence, "fixture_executable_presence_invalid");
  exactKeys(executablePresence, ["auggie"], "fixture_executable_presence_keys_invalid");
  if (Object.values(executablePresence).some((item) => typeof item !== "boolean")) throw new Error("fixture_executable_presence_value_invalid");
  if (!Array.isArray(root.observations) || root.observations.length > 9) throw new Error("fixture_observations_invalid");
  const observations = root.observations.map((unknownObservation) => {
    const observation = record(unknownObservation, "fixture_observation_not_object");
    const candidateIdPresent = Object.hasOwn(observation, "candidateId");
    exactKeys(observation, ["ordinal", "kind", ...(candidateIdPresent ? ["candidateId"] : []), "probe", "transport", "httpStatus", "typedErrorCode", "observedProvider", "observedModel", "responseShape", "noncePresent", "valuePresent", "refusalPresent", "finishReason", "toolNameValid", "normalized"], "fixture_observation_keys_invalid");
    const ordinal = boundedInteger(observation.ordinal, 0, 8, "fixture_observation_ordinal_invalid");
    if (!["pin_before", "mismatch", "candidate", "pin_after"].includes(String(observation.kind))) throw new Error("fixture_observation_kind_invalid");
    if (observation.probe !== "content" && observation.probe !== "tool") throw new Error("fixture_observation_probe_invalid");
    if (!["http", "timeout", "network"].includes(String(observation.transport))) throw new Error("fixture_observation_transport_invalid");
    if (observation.httpStatus !== null && (!Number.isSafeInteger(observation.httpStatus) || (observation.httpStatus as number) < 100 || (observation.httpStatus as number) > 599)) throw new Error("fixture_observation_status_invalid");
    if (observation.typedErrorCode !== null && observation.typedErrorCode !== "insufficient_quota") throw new Error("fixture_observation_error_code_invalid");
    if (observation.typedErrorCode === "insufficient_quota" && (observation.transport !== "http" || observation.httpStatus !== 403)) throw new Error("fixture_observation_quota_binding_invalid");
    if (observation.transport === "http" ? observation.httpStatus === null : observation.httpStatus !== null) throw new Error("fixture_observation_transport_status_mismatch");
    for (const key of ["observedProvider", "observedModel"] as const) {
      if (observation[key] !== null && (typeof observation[key] !== "string" || !SAFE_ATTRIBUTION.test(observation[key] as string))) throw new Error("fixture_observation_attribution_invalid");
    }
    if (observation.responseShape !== "valid" && observation.responseShape !== "invalid") throw new Error("fixture_observation_shape_invalid");
    for (const key of ["noncePresent", "valuePresent", "refusalPresent", "toolNameValid", "normalized"] as const) {
      if (typeof observation[key] !== "boolean") throw new Error("fixture_observation_boolean_invalid");
    }
    if (observation.finishReason !== null && !["stop", "tool_calls", "length", "other"].includes(String(observation.finishReason))) throw new Error("fixture_observation_finish_reason_invalid");
    if (candidateIdPresent && (typeof observation.candidateId !== "string" || !SAFE_ID.test(observation.candidateId))) throw new Error("fixture_observation_candidate_invalid");
    return {
      ordinal,
      kind: observation.kind as ScheduleKind,
      ...(candidateIdPresent ? { candidateId: observation.candidateId as string } : {}),
      probe: observation.probe as ProbeKind,
      transport: observation.transport as SanitizedObservation["transport"],
      httpStatus: observation.httpStatus as number | null,
      typedErrorCode: observation.typedErrorCode as "insufficient_quota" | null,
      observedProvider: observation.observedProvider as string | null,
      observedModel: observation.observedModel as string | null,
      responseShape: observation.responseShape as "valid" | "invalid",
      noncePresent: observation.noncePresent as boolean,
      valuePresent: observation.valuePresent as boolean,
      refusalPresent: observation.refusalPresent as boolean,
      finishReason: observation.finishReason as SanitizedObservation["finishReason"],
      toolNameValid: observation.toolNameValid as boolean,
      normalized: observation.normalized as boolean,
    };
  });
  return { schema_version: 1, kind: "temperance.omniroute-s-tier-fixture", executable_presence: { auggie: executablePresence.auggie as boolean }, observations };
}
