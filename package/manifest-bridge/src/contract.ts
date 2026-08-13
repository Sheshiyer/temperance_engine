import { createHash, randomUUID } from 'node:crypto';
import { EVENT_SCHEMA, type AlgorithmPhase, type EvidencePointer, type EventSource, type EventStatus, type ManifestEvent } from './types';

const SECRET_KEY = /(api[_-]?key|authorization|bearer|cookie|password|passwd|secret|token|private[_-]?key|credential)/i;
const MAX_STRING = 500;
const MAX_DEPTH = 5;
const VALID_PHASES = new Set<AlgorithmPhase>(['OBSERVE', 'THINK', 'PLAN', 'BUILD', 'EXECUTE', 'VERIFY', 'LEARN']);
const VALID_SOURCES = new Set<EventSource>(['pai-hook', 'temperance-router', 'omniroute', 'project-artifact', 'manifest']);
const VALID_STATUS = new Set<EventStatus>(['observed', 'derived', 'synthetic', 'stale', 'failed']);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function redact(value: unknown, depth = 0, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (value === undefined) return undefined;
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([k, v]) => [k, redact(v, depth + 1, k)]));
  }
  return String(value).slice(0, MAX_STRING);
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : undefined;
}

function evidence(input: unknown): EvidencePointer[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 20).flatMap((item) => {
    if (!isRecord(item) || typeof item.label !== 'string') return [];
    const pointer: EvidencePointer = { label: item.label.slice(0, 120) };
    if (typeof item.path === 'string') pointer.path = item.path.slice(0, 500);
    if (typeof item.url === 'string') pointer.url = item.url.slice(0, 500);
    if (typeof item.line === 'number') pointer.line = Math.max(1, Math.floor(item.line));
    return [pointer];
  });
}

function generatedId(input: Record<string, unknown>): string {
  const stable = JSON.stringify({
    ts: input.ts,
    source: input.source,
    kind: input.kind,
    project_id: input.project_id,
    task_id: input.task_id,
    session_id: input.session_id,
    payload: input.payload,
  });
  return `evt_${createHash('sha256').update(stable).digest('hex').slice(0, 20)}_${randomUUID().slice(0, 8)}`;
}

export function normalizeEvent(input: unknown, defaults: Partial<ManifestEvent> = {}): ManifestEvent {
  if (!isRecord(input)) throw new Error('event must be a JSON object');
  const source = stringField(input, 'source') || defaults.source;
  const kind = stringField(input, 'kind');
  const status = stringField(input, 'status') || defaults.status || 'observed';
  if (!source || !VALID_SOURCES.has(source as EventSource)) throw new Error(`invalid event source: ${source || '<missing>'}`);
  if (!kind) throw new Error('event kind is required');
  if (!VALID_STATUS.has(status as EventStatus)) throw new Error(`invalid event status: ${status}`);
  const phase = stringField(input, 'phase')?.toUpperCase();
  if (phase && !VALID_PHASES.has(phase as AlgorithmPhase)) throw new Error(`invalid algorithm phase: ${phase}`);
  const ts = stringField(input, 'ts') || new Date().toISOString();
  if (Number.isNaN(Date.parse(ts))) throw new Error('event ts must be an ISO timestamp');
  const payload = isRecord(input.payload) ? redact(input.payload) as Record<string, unknown> : {};
  const freshUntil = stringField(input, 'fresh_until');
  return {
    schema: EVENT_SCHEMA,
    id: stringField(input, 'id') || generatedId({ ...input, payload }),
    ts: new Date(ts).toISOString(),
    source: source as EventSource,
    kind,
    status: status as EventStatus,
    project_id: stringField(input, 'project_id'),
    task_id: stringField(input, 'task_id'),
    session_id: stringField(input, 'session_id'),
    agent_id: stringField(input, 'agent_id'),
    correlation_id: stringField(input, 'correlation_id'),
    phase: phase as AlgorithmPhase | undefined,
    actor: stringField(input, 'actor') || defaults.actor || 'bridge',
    payload,
    evidence: evidence(input.evidence),
    redaction: 'bounded-preview',
    fresh_until: freshUntil && !Number.isNaN(Date.parse(freshUntil)) ? new Date(freshUntil).toISOString() : undefined,
  };
}
