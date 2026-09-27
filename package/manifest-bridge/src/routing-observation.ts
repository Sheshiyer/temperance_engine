import { types } from 'node:util';
import { validateReceipt, type ReceiptPolicy, type RoutingObservationReceipt } from './contracts/routing-observation-receipt.v1';
import { EVENT_SCHEMA, type ManifestEvent } from './types';

export const ROUTING_OBSERVATION_KIND = 'routing.observation.recorded';
export const MAX_OBSERVATION_EVENT_BYTES = 8192;
export const MAX_EVENT_INPUT_BYTES = 1_000_000;
export const OBSERVATION_CODES = ['observation_disabled', 'invalid_envelope', 'unsupported_observation', 'invalid_receipt', 'invalid_policy', 'invalid_time', 'project_not_registered', 'receipt_conflict', 'writer_busy', 'persistence_failed', 'input_too_large', 'invalid_json', 'invalid_encoding', 'duplicate_key'] as const;
export type ObservationCode = typeof OBSERVATION_CODES[number];
export interface RoutingObservationPolicy {
  receipt_policy: ReceiptPolicy;
  /** Trusted registration binding, never inferred from payload or filesystem directory. */
  project_bindings: readonly { project_id: string; project_ref: string }[];
  max_clock_skew_ms: number;
  now: () => number;
  isProjectRegistered?: (projectId: string, projectRef: string) => boolean;
}
export interface RoutingObservationProjection {
  receipt: RoutingObservationReceipt;
  freshness: 'fresh' | 'stale';
  conflict_count: number;
}
export type ObservationAdmission =
  | { special: false }
  | { special: true; ok: false; code: ObservationCode }
  | { special: true; ok: true; event: ManifestEvent; receipt: RoutingObservationReceipt; key: string };

/** Descriptor-only classification: a hostile object never reaches the generic normalizer. */
export function observationLike(input: unknown): boolean {
  let nodes = 0;
  const visited = new Set<object>();
  function scan(value: unknown, depth: number): boolean {
    if (++nodes > 10_000 || depth > 20) return true;
    if (typeof value === 'string') return false;
    if (!value || typeof value !== 'object') return false;
    if (types.isProxy(value)) return true;
    if (visited.has(value)) return true;
    visited.add(value);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null && proto !== Array.prototype) return true;
    for (const key of Reflect.ownKeys(value)) {
      const d = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in d)) return true;
      if (typeof key === 'symbol') return true;
      if (typeof d.value === 'string' && ((key === 'schema' && /temperance\.routing-observation/i.test(d.value)) || (key === 'kind' && /^routing[.-]observation/i.test(d.value.trim().slice(0, 300))) || (key === 'id' && d.value.trim().slice(0, 300).startsWith('evt_ro_')))) return true;
      if (scan(d.value, depth + 1)) return true;
    }
    visited.delete(value);
    return false;
  }
  try { return scan(input, 0); } catch { return true; }
}

function ownObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || types.isProxy(input)) return null;
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return null;
  const output: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    const d = Object.getOwnPropertyDescriptor(input, key)!;
    if (typeof key !== 'string' || !d.enumerable || !('value' in d)) return null;
    output[key] = d.value;
  }
  return output;
}
export function observationKey(receipt: RoutingObservationReceipt): string {
  return `${receipt.project_ref}:${receipt.observation_id}`;
}
export function observationEventId(receiptId: string): string { return `evt_${receiptId}`; }

/** One validator at every seam. Policy is injected code authority, not producer authentication. */
export function admitRoutingObservation(input: unknown, policy?: RoutingObservationPolicy, options: { replay?: boolean; projectId?: string } = {}): ObservationAdmission {
  if (!observationLike(input)) return { special: false };
  const reject = (code: ObservationCode): ObservationAdmission => ({ special: true, ok: false, code });
  if (!policy) return reject('observation_disabled');
  try {
    if (!Number.isInteger(policy.max_clock_skew_ms) || policy.max_clock_skew_ms < 0 || policy.max_clock_skew_ms > 300_000 || typeof policy.now !== 'function') return reject('invalid_policy');
    const now = policy.now();
    if (!Number.isFinite(now)) return reject('invalid_policy');
    const e = ownObject(input);
    if (!e) return reject('invalid_envelope');
    if (e.kind !== ROUTING_OBSERVATION_KIND || e.schema !== EVENT_SCHEMA) return reject('unsupported_observation');
    const keys = ['schema', 'id', 'ts', 'fresh_until', 'kind', 'source', 'status', 'project_id', 'actor', 'payload', 'evidence', 'redaction'];
    if (options.replay && Object.hasOwn(e, 'seq')) {
      if (!Number.isSafeInteger(e.seq) || (e.seq as number) < 1) return reject('invalid_envelope');
      delete e.seq;
    }
    if (Object.keys(e).length !== keys.length || !keys.every(key => Object.hasOwn(e, key))) return reject('invalid_envelope');
    if (e.source !== 'temperance-router' || e.actor !== 'product-routing-adapter' || e.redaction !== 'bounded-preview') return reject('invalid_envelope');
    if (!e.evidence || typeof e.evidence !== 'object' || types.isProxy(e.evidence) || Object.getPrototypeOf(e.evidence) !== Array.prototype || !Array.isArray(e.evidence) || Reflect.ownKeys(e.evidence).length !== 1 || e.evidence.length !== 0) return reject('invalid_envelope');
    const receiptResult = validateReceipt(e.payload, policy.receipt_policy);
    if (!receiptResult.ok) return reject(receiptResult.code === 'INVALID_POLICY' ? 'invalid_policy' : 'invalid_receipt');
    const receipt = receiptResult.receipt;
    if (!Array.isArray(policy.project_bindings) || !policy.project_bindings.length || policy.project_bindings.some(binding => !/^[A-Za-z0-9._-]{1,120}$/.test(binding.project_id) || !policy.receipt_policy.registered_projects.includes(binding.project_ref)) || new Set(policy.project_bindings.map(binding => binding.project_id)).size !== policy.project_bindings.length || new Set(policy.project_bindings.map(binding => binding.project_ref)).size !== policy.project_bindings.length) return reject('invalid_policy');
    if (!policy.project_bindings.some(binding => binding.project_id === e.project_id && binding.project_ref === receipt.project_ref) || (options.projectId !== undefined && options.projectId !== e.project_id)) return reject('project_not_registered');
    if (policy.isProjectRegistered && !policy.isProjectRegistered(e.project_id as string, receipt.project_ref)) return reject('project_not_registered');
    if (e.id !== observationEventId(receipt.receipt_id) || e.ts !== receipt.observed_at || e.fresh_until !== receipt.fresh_until || e.status !== (receipt.evidence_mode === 'synthetic' ? 'synthetic' : 'observed')) return reject('invalid_envelope');
    // Expired receipts can be replayed/retried; never refresh their immutable timestamps.
    if (Date.parse(receipt.observed_at) > now + policy.max_clock_skew_ms) return reject('invalid_time');
    const event = { schema: EVENT_SCHEMA, id: e.id, ts: e.ts, fresh_until: e.fresh_until, kind: ROUTING_OBSERVATION_KIND, source: 'temperance-router', status: e.status, project_id: e.project_id, actor: 'product-routing-adapter', payload: receipt, evidence: [], redaction: 'bounded-preview' } as unknown as ManifestEvent;
    if (Buffer.byteLength(JSON.stringify(event), 'utf8') > MAX_OBSERVATION_EVENT_BYTES) return reject('input_too_large');
    return { special: true, ok: true, event, receipt, key: observationKey(receipt) };
  } catch { return reject('invalid_envelope'); }
}

export type DecodedEvent = { ok: true; input: unknown; special: boolean } | { ok: false; error: ObservationCode };

/** Duplicate keys need a grammar pass: JSON.parse would silently discard the first value. */
function uniqueKeys(raw: string): { duplicate: boolean; special: boolean } {
  let cursor = 0;
  let duplicate = false;
  let special = false;
  function ws(): void { while (/\s/.test(raw[cursor] || '') && cursor < raw.length) cursor++; }
  function string(): string {
    const start = cursor++;
    while (cursor < raw.length) {
      if (raw[cursor] === '"') { cursor++; return JSON.parse(raw.slice(start, cursor)); }
      if (raw[cursor] === '\\') cursor++;
      cursor++;
    }
    throw new Error('invalid_json');
  }
  function value(depth: number, field?: string): void {
    if (depth > 20) throw new Error('invalid_json');
    ws();
    if (raw[cursor] === '"') {
      const text = string();
      if ((field === 'schema' && /temperance\.routing-observation/i.test(text)) || (field === 'kind' && /^routing[.-]observation/i.test(text.trim().slice(0, 300))) || (field === 'id' && text.trim().slice(0, 300).startsWith('evt_ro_'))) special = true;
      return;
    }
    if (raw[cursor] === '{' || raw[cursor] === '[') {
      const object = raw[cursor++] === '{';
      const end = object ? '}' : ']';
      const keys = new Set<string>();
      ws();
      if (raw[cursor] === end) { cursor++; return; }
      while (cursor < raw.length) {
        let key: string | undefined;
        if (object) {
          key = string();
          if (keys.has(key)) duplicate = true;
          keys.add(key); ws(); cursor++;
        }
        value(depth + 1, key); ws();
        if (raw[cursor++] === end) return;
        ws();
      }
      throw new Error('invalid_json');
    }
    while (cursor < raw.length && !/[\s,}\]]/.test(raw[cursor])) cursor++;
  }
  value(0);
  return { duplicate, special };
}

/** Shared byte-preserving CLI/HTTP/replay decode seam. No supplied value appears in errors. */
const byteLengthGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;

export function decodeEventInput(raw: unknown): DecodedEvent {
  try {
    let bytes: Uint8Array | undefined;
    if (typeof raw !== 'string') {
      if (!raw || typeof raw !== 'object' || types.isProxy(raw) || !types.isUint8Array(raw) || (Object.getPrototypeOf(raw) !== Uint8Array.prototype && Object.getPrototypeOf(raw) !== Buffer.prototype)) return { ok: false, error: 'invalid_encoding' };
      const length = byteLengthGetter.call(raw) as number;
      if (length > MAX_EVENT_INPUT_BYTES) return { ok: false, error: 'input_too_large' };
      const descriptors = Object.getOwnPropertyDescriptors(raw);
      if (Reflect.ownKeys(descriptors).length !== length) return { ok: false, error: 'invalid_encoding' };
      bytes = new Uint8Array(length);
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor)) return { ok: false, error: 'invalid_encoding' };
        bytes[index] = descriptor.value;
      }
    }
    const size = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : bytes!.byteLength;
    if (size > MAX_EVENT_INPUT_BYTES) return { ok: false, error: 'input_too_large' };
    let text: string;
    try { text = typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes!); }
    catch { return { ok: false, error: 'invalid_encoding' }; }
    if (text.charCodeAt(0) === 0xfeff) return { ok: false, error: 'invalid_encoding' };
    const input = JSON.parse(text);
    // Check all raw keys even if a later duplicate hides the reserved discriminator.
    const grammar = uniqueKeys(text);
    const special = observationLike(input) || grammar.special;
    if (special && grammar.duplicate) return { ok: false, error: 'duplicate_key' };
    if (special && size > MAX_OBSERVATION_EVENT_BYTES) return { ok: false, error: 'input_too_large' };
    return { ok: true, input, special };
  } catch { return { ok: false, error: 'invalid_json' }; }
}

export interface EventSink { ingest(input: unknown): { accepted: boolean; event?: ManifestEvent; error?: string }; }
export function observationResponse(result: ReturnType<EventSink['ingest']>): Record<string, unknown> {
  if (result.error) return { accepted: false, error: OBSERVATION_CODES.includes(result.error as ObservationCode) ? result.error : 'invalid_envelope' };
  if (!result.event) return { accepted: false, error: 'invalid_envelope' };
  return { accepted: result.accepted, outcome: result.accepted ? 'accepted' : 'duplicate', event_id: result.event.id, receipt_id: result.event.payload.receipt_id };
}

/** Offline CLI emit remains disabled with the default sink; tests inject the approved owner. */
export function emitEventInput(raw: string | Uint8Array, sink: EventSink): { result: Record<string, unknown>; exitCode: number } {
  const decoded = decodeEventInput(raw);
  if (!decoded.ok) return { result: { accepted: false, error: decoded.error }, exitCode: 1 };
  try {
    const result = sink.ingest(decoded.input);
    return { result: decoded.special ? observationResponse(result) : result, exitCode: result.error ? 1 : 0 };
  } catch { return { result: { accepted: false, error: 'persistence_failed' }, exitCode: 1 }; }
}
