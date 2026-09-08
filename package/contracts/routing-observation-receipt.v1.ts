// Canonical product source. Generated RO-02 repository copies must remain byte-for-byte identical;
// edit package/contracts/routing-observation-receipt.v1.ts, then run scripts/sync-routing-observation-contract.mjs --write.
import { createHash } from "node:crypto";
import { types } from "node:util";

/** Source-only boundary: declarations and content integrity are not evidence authentication. */
export const ROUTING_OBSERVATION_RECEIPT_SCHEMA = "temperance.routing-observation-receipt.v1" as const;
export const ROUTING_OBSERVATION_MAX_BYTES = 4096;
export const ROUTING_OBSERVATION_MAX_COUNT = 10_000;
export const ROUTING_OBSERVATION_REJECTION_CODES = Object.freeze([
  "INVALID_POLICY", "INVALID_RECEIPT", "INVALID_ENCODING", "INPUT_TOO_LARGE",
  "INVALID_JSON", "DUPLICATE_KEY", "DIGEST_MISMATCH",
] as const);
export const SCHEMA = ROUTING_OBSERVATION_RECEIPT_SCHEMA;
export const MAX_RECEIPT_BYTES = ROUTING_OBSERVATION_MAX_BYTES;
export interface ReceiptPolicy {
  /** Trusted caller owns registration and review; membership cannot prove an identifier public. */
  registered_projects: readonly string[];
  catalog: readonly { provider: string; model: string }[];
  max_freshness_ms: number;
}
export type Attribution =
  | { state: "observed"; provider: string; model: string; successful_attempt_ordinal: number; evidence_basis: "terminal-attempt-record" }
  | { state: "unavailable"; reason_code: "no_successful_attempt" | "missing_attribution" | "evidence_unavailable" | "unsupported_identity" }
  | { state: "ambiguous"; reason_code: "conflicting_attribution" | "multiple_successful_bindings" };
type Counts = { started_count: number; completed_count: number; failed_count: number };
export type ToolState =
  | ({ state: "completed" } & Counts)
  | ({ state: "incomplete"; reason_code: "open_tools" | "tool_failed" | "coverage_incomplete" } & Counts)
  | { state: "unavailable"; reason_code: "not_instrumented" | "evidence_unavailable" };
export interface ReceiptContent {
  schema: typeof SCHEMA;
  observation_id: string;
  project_ref: string;
  observed_at: string;
  fresh_until: string;
  source: "product-routing-adapter";
  evidence_mode: "synthetic" | "local-observation";
  provenance: { product_source_commit: string; closure_sha256: string; contract_sha256: string };
  request: { outcome: "succeeded" | "failed" | "unavailable" };
  attribution: Attribution;
  tools: ToolState;
}
export interface RoutingObservationReceipt extends ReceiptContent { receipt_id: string }
export type RejectionCode = (typeof ROUTING_OBSERVATION_REJECTION_CODES)[number];
export type ReceiptResult =
  | { ok: true; receipt: RoutingObservationReceipt; canonical: string }
  | { ok: false; code: RejectionCode };

class Rejection extends Error {
  constructor(readonly code: RejectionCode) { super(code); }
}
function fail(code: RejectionCode = "INVALID_RECEIPT"): never { throw new Rejection(code); }
function check(value: unknown): asserts value { if (!value) fail(); }
type Plain = Record<string, any>;
const PROJECT = /^prj_[a-z0-9-]{8,60}$/;
const PROVIDER = /^[a-z][a-z0-9_-]{0,63}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();

function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

/** Inspect descriptors before values. No getter, proxy trap, coercion or toJSON is invoked. */
function detached(input: unknown, policy = false): any {
  const active = new Set<object>();
  let nodes = 0;
  function copy(value: unknown, depth: number): any {
    check(++nodes <= (policy ? 50_000 : 256) && depth <= 8);
    if (typeof value === "string") {
      check(value.length <= MAX_RECEIPT_BYTES && wellFormed(value) && !/[\u0000-\u001f\u007f-\u009f]/.test(value));
      return value;
    }
    if (typeof value === "number") { check(Number.isFinite(value)); return value; }
    if (typeof value === "boolean" || value === null) return value;
    check(typeof value === "object" && value !== null && !types.isProxy(value));
    check(!active.has(value));
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    check(array ? policy && proto === Array.prototype : proto === Object.prototype || proto === null);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    check(keys.every(key => typeof key === "string"));
    active.add(value);
    let result: any;
    if (array) {
      const length = descriptors.length?.value;
      check(Number.isInteger(length) && length >= 0 && length <= 10_000 && keys.length === length + 1);
      result = [];
      for (let i = 0; i < length; i++) {
        const d = descriptors[String(i)];
        check(d && "value" in d && d.enumerable);
        result.push(copy(d.value, depth + 1));
      }
    } else {
      result = Object.create(null);
      for (const key of keys as string[]) {
        const d = descriptors[key];
        check(d.enumerable && "value" in d && /^[a-z_][a-z0-9_]*$/.test(key));
        result[key] = copy(d.value, depth + 1);
      }
    }
    active.delete(value);
    return result;
  }
  return copy(input, 0);
}
function object(value: any, fields: readonly string[]): asserts value is Plain {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  const keys = Object.keys(value);
  check(keys.length === fields.length && fields.every(key => Object.hasOwn(value, key)));
}
function member(value: unknown, values: readonly string[]): void { check(typeof value === "string" && values.includes(value)); }
function matches(value: unknown, pattern: RegExp): void { check(typeof value === "string" && pattern.test(value)); }
function count(value: unknown, minimum = 0): void {
  check(typeof value === "number" && Number.isInteger(value) && !Object.is(value, -0) && value >= minimum && value <= ROUTING_OBSERVATION_MAX_COUNT);
}
function trustedPolicy(input: unknown): ReceiptPolicy {
  try {
    const p = detached(input, true);
    object(p, ["registered_projects", "catalog", "max_freshness_ms"]);
    check(Array.isArray(p.registered_projects) && p.registered_projects.length > 0);
    check(Array.isArray(p.catalog) && p.catalog.length > 0);
    check(typeof p.max_freshness_ms === "number" && Number.isInteger(p.max_freshness_ms) && p.max_freshness_ms > 0 && p.max_freshness_ms <= 86_400_000);
    const projects = new Set<string>();
    for (const ref of p.registered_projects) { matches(ref, PROJECT); check(!projects.has(ref)); projects.add(ref); }
    const pairs = new Set<string>();
    for (const pair of p.catalog) {
      object(pair, ["provider", "model"]); matches(pair.provider, PROVIDER); matches(pair.model, MODEL);
      const key = JSON.stringify([pair.provider, pair.model]); check(!pairs.has(key)); pairs.add(key);
    }
    return p as ReceiptPolicy;
  } catch { fail("INVALID_POLICY"); }
}
function timestamp(value: unknown): number {
  matches(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const time = Date.parse(value as string);
  check(Number.isFinite(time) && new Date(time).toISOString() === value);
  return time;
}
const FIELDS = ["schema", "observation_id", "project_ref", "observed_at", "fresh_until", "source", "evidence_mode", "provenance", "request", "attribution", "tools"];
function validateContent(c: any, p: ReceiptPolicy, hasId: boolean): void {
  object(c, hasId ? [...FIELDS, "receipt_id"] : FIELDS);
  check(c.schema === SCHEMA && c.source === "product-routing-adapter");
  if (hasId) matches(c.receipt_id, /^ro_[a-f0-9]{64}$/);
  matches(c.observation_id, /^obs_[a-f0-9]{32}$/);
  matches(c.project_ref, PROJECT); check(p.registered_projects.includes(c.project_ref));
  member(c.evidence_mode, ["synthetic", "local-observation"]);
  const duration = timestamp(c.fresh_until) - timestamp(c.observed_at);
  check(duration > 0 && duration <= p.max_freshness_ms);
  object(c.provenance, ["product_source_commit", "closure_sha256", "contract_sha256"]);
  matches(c.provenance.product_source_commit, HEX40); matches(c.provenance.closure_sha256, HEX64); matches(c.provenance.contract_sha256, HEX64);
  object(c.request, ["outcome"]); member(c.request.outcome, ["succeeded", "failed", "unavailable"]);
  const a = c.attribution;
  check(a !== null && typeof a === "object");
  if (a.state === "observed") {
    object(a, ["state", "provider", "model", "successful_attempt_ordinal", "evidence_basis"]);
    matches(a.provider, PROVIDER); matches(a.model, MODEL); count(a.successful_attempt_ordinal, 1);
    check(a.evidence_basis === "terminal-attempt-record" && p.catalog.some(pair => pair.provider === a.provider && pair.model === a.model));
  } else {
    object(a, ["state", "reason_code"]);
    if (a.state === "unavailable") member(a.reason_code, ["no_successful_attempt", "missing_attribution", "evidence_unavailable", "unsupported_identity"]);
    else { check(a.state === "ambiguous"); member(a.reason_code, ["conflicting_attribution", "multiple_successful_bindings"]); }
  }
  const t = c.tools;
  check(t !== null && typeof t === "object");
  if (t.state === "unavailable") {
    object(t, ["state", "reason_code"]); member(t.reason_code, ["not_instrumented", "evidence_unavailable"]);
  } else {
    member(t.state, ["completed", "incomplete"]);
    object(t, ["state", "started_count", "completed_count", "failed_count", ...(t.state === "incomplete" ? ["reason_code"] : [])]);
    count(t.started_count); count(t.completed_count); count(t.failed_count);
    check(t.completed_count + t.failed_count <= t.started_count);
    if (t.state === "completed") check(t.started_count === t.completed_count && t.failed_count === 0);
    else {
      member(t.reason_code, ["open_tools", "tool_failed", "coverage_incomplete"]);
      if (t.reason_code === "open_tools") check(t.started_count > t.completed_count + t.failed_count);
      if (t.reason_code === "tool_failed") check(t.failed_count > 0);
    }
  }
}
/** Only called with detached validated content whose keys are ASCII. */
function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
}
function protect(operation: () => ReceiptResult): ReceiptResult {
  try { return operation(); }
  catch (error) { return { ok: false, code: error instanceof Rejection ? error.code : "INVALID_RECEIPT" }; }
}
function finish(input: unknown, policy: unknown, hasId: boolean): ReceiptResult {
  const p = trustedPolicy(policy);
  const c = detached(input);
  validateContent(c, p, hasId);
  const suppliedId = c.receipt_id;
  delete c.receipt_id;
  const id = "ro_" + createHash("sha256").update(canonical(c), "utf8").digest("hex");
  if (hasId && suppliedId !== id) fail("DIGEST_MISMATCH");
  c.receipt_id = id;
  const serialized = canonical(c);
  if (encoder.encode(serialized).byteLength > MAX_RECEIPT_BYTES) fail("INPUT_TOO_LARGE");
  return { ok: true, receipt: c as RoutingObservationReceipt, canonical: serialized };
}
/** Build a declaration from exact content fields; receipt_id is not accepted here. */
export function buildReceipt(content: unknown, policy: unknown): ReceiptResult {
  return protect(() => finish(content, policy, false));
}
/** Verify a supplied ID. Result owns every object and never retains caller references. */
export function validateReceipt(receipt: unknown, policy: unknown): ReceiptResult {
  return protect(() => finish(receipt, policy, true));
}

/** Small JSON grammar retaining duplicate-key information lost by JSON.parse. */
function parseStrict(raw: string): unknown {
  let i = 0;
  function ws(): void { while (i < raw.length && /[\x20\t\r\n]/.test(raw[i])) i++; }
  function string(): string {
    const start = i++;
    while (i < raw.length) {
      if (raw[i] === '"') {
        i++;
        let s: string;
        try { s = JSON.parse(raw.slice(start, i)); } catch { fail("INVALID_JSON"); }
        if (!wellFormed(s)) fail("INVALID_ENCODING");
        return s;
      }
      if (raw[i] === "\\") i++;
      i++;
    }
    fail("INVALID_JSON");
  }
  function value(depth: number): any {
    if (depth > 8) fail("INVALID_RECEIPT");
    ws();
    if (raw[i] === '"') return string();
    if (raw[i] === "{") {
      i++; ws(); const result = Object.create(null); const seen = new Set<string>();
      if (raw[i] === "}") { i++; return result; }
      while (i < raw.length) {
        if (raw[i] !== '"') fail("INVALID_JSON");
        const key = string();
        if (seen.has(key)) fail("DUPLICATE_KEY");
        seen.add(key); ws();
        if (raw[i++] !== ":") fail("INVALID_JSON");
        result[key] = value(depth + 1); ws();
        if (raw[i] === "}") { i++; return result; }
        if (raw[i++] !== ",") fail("INVALID_JSON");
        ws();
      }
      fail("INVALID_JSON");
    }
    if (raw[i] === "[") fail("INVALID_RECEIPT");
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(i));
    if (!token) fail("INVALID_JSON");
    i += token[0].length;
    return JSON.parse(token[0]);
  }
  const result = value(0); ws();
  if (i !== raw.length) fail("INVALID_JSON");
  return result;
}
const typedArrayLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length")!.get!;
/** External bytes must be a plain Uint8Array; Buffer/subclasses and BOMs are rejected. */
export function parseReceipt(input: unknown, policy: unknown): ReceiptResult {
  return protect(() => {
    let raw: string;
    if (typeof input === "string") {
      if (input.length > MAX_RECEIPT_BYTES) fail("INPUT_TOO_LARGE");
      if (!wellFormed(input)) fail("INVALID_ENCODING");
      if (encoder.encode(input).byteLength > MAX_RECEIPT_BYTES) fail("INPUT_TOO_LARGE");
      raw = input;
    } else {
      // Prototype identity alone can be forged by a wider typed array; check its intrinsic brand.
      if (input === null || typeof input !== "object" || types.isProxy(input) || !types.isUint8Array(input) || Object.getPrototypeOf(input) !== Uint8Array.prototype) fail("INVALID_ENCODING");
      let length: number;
      try { length = typedArrayLength.call(input); } catch { fail("INVALID_ENCODING"); }
      if (length > MAX_RECEIPT_BYTES) fail("INPUT_TOO_LARGE");
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (Reflect.ownKeys(descriptors).length !== length) fail("INVALID_ENCODING");
      const bytes = new Uint8Array(length);
      for (let n = 0; n < length; n++) {
        const d = descriptors[String(n)];
        if (!d || !("value" in d)) fail("INVALID_ENCODING");
        bytes[n] = d.value;
      }
      try { raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { fail("INVALID_ENCODING"); }
    }
    if (raw.charCodeAt(0) === 0xfeff) fail("INVALID_ENCODING");
    return finish(parseStrict(raw), policy, true);
  });
}

/** Descriptive public entry points for later product-owned generators and adapters. */
export const createRoutingObservationReceipt = buildReceipt;
export const validateRoutingObservationReceipt = validateReceipt;
export const parseRoutingObservationReceipt = parseReceipt;
