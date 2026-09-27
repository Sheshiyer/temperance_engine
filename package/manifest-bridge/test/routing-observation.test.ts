import { afterEach, describe, expect, test } from 'bun:test';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReceipt, type ReceiptContent } from '../src/contracts/routing-observation-receipt.v1';
import { decodeEventInput, emitEventInput, MAX_EVENT_INPUT_BYTES, observationEventId, observationKey, observationLike, ROUTING_OBSERVATION_KIND, type RoutingObservationPolicy } from '../src/routing-observation';
import { handleEventPost } from '../src/event-input';
import { ManifestStore } from '../src/store';
import { ManifestCatalog } from '../src/catalog';
import { normalizeEvent } from '../src/contract';
import { EVENT_SCHEMA } from '../src/types';
import { PROJECT_SCHEMA } from '../src/project';

const roots: string[] = [];
const nowValue = Date.parse('2026-09-07T00:00:00.000Z');
const projectA = 'prj_synthetic-a';
const projectB = 'prj_synthetic-b';
function policy(now = () => nowValue): RoutingObservationPolicy {
  return { receipt_policy: { registered_projects: [projectA, projectB], catalog: [{ provider: 'fixture', model: 'fixture-model' }], max_freshness_ms: 60_000 }, project_bindings: [{ project_id: projectA, project_ref: projectA }, { project_id: projectB, project_ref: projectB }], max_clock_skew_ms: 1000, now };
}
function fixture(p = policy(), overrides: Partial<ReceiptContent> = {}) {
  const built = buildReceipt({ schema: 'temperance.routing-observation-receipt.v1', observation_id: `obs_${'1'.repeat(32)}`, project_ref: projectA, observed_at: '2026-09-07T00:00:00.000Z', fresh_until: '2026-09-07T00:01:00.000Z', source: 'product-routing-adapter', evidence_mode: 'synthetic', provenance: { product_source_commit: 'a'.repeat(40), closure_sha256: 'b'.repeat(64), contract_sha256: 'c'.repeat(64) }, request: { outcome: 'succeeded' }, attribution: { state: 'observed', provider: 'fixture', model: 'fixture-model', successful_attempt_ordinal: 2, evidence_basis: 'terminal-attempt-record' }, tools: { state: 'unavailable', reason_code: 'not_instrumented' }, ...overrides }, p.receipt_policy);
  if (!built.ok) throw new Error(built.code);
  const receipt = built.receipt;
  return { schema: EVENT_SCHEMA, id: observationEventId(receipt.receipt_id), ts: receipt.observed_at, fresh_until: receipt.fresh_until, source: 'temperance-router', kind: ROUTING_OBSERVATION_KIND, status: receipt.evidence_mode === 'synthetic' ? 'synthetic' : 'observed', project_id: receipt.project_ref, actor: 'product-routing-adapter', payload: receipt, evidence: [], redaction: 'bounded-preview' };
}
function root() { const dir = mkdtempSync(join(tmpdir(), 'ro04-synthetic-')); roots.push(dir); return dir; }
function store(p = policy()) { return new ManifestStore(join(root(), 'events.jsonl'), projectA, p); }
function register(c: ManifestCatalog, id = projectA) { c.ensureProject({ schema: PROJECT_SCHEMA, project_id: id, name: id, cwd: null }); }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('routing observation admission (synthetic, no listeners)', () => {
  test('default runtime and offline emit are disabled with no persisted event', () => {
    const s = new ManifestStore(join(root(), 'events.jsonl'), projectA);
    expect(s.ingest(fixture())).toEqual({ accepted: false, error: 'observation_disabled' });
    expect(emitEventInput(JSON.stringify(fixture()), s)).toEqual({ result: { accepted: false, error: 'observation_disabled' }, exitCode: 1 });
    expect(existsSync(s.file)).toBe(false);
  });
  test('exact receipt survives input mutation, subscriber mutation, response mutation and snapshot mutation', () => {
    const s = store(); const event = fixture(); const original = JSON.stringify(event.payload);
    s.subscribe(e => { e.payload.receipt_id = 'mutated'; });
    const result = s.ingest(event); expect(result.accepted).toBe(true);
    event.payload.attribution = { state: 'unavailable', reason_code: 'missing_attribution' };
    result.event!.payload.receipt_id = 'mutated-again';
    const snapshot = s.state; const key = Object.keys(snapshot.routing_observations!)[0];
    expect(JSON.stringify(snapshot.routing_observations![key].receipt)).toBe(original);
    snapshot.routing_observations![key].receipt.receipt_id = 'also-mutated';
    expect(JSON.stringify(s.state.routing_observations![key].receipt)).toBe(original);
    expect(s.state.routes).toEqual({}); expect(s.state.approvals).toEqual({}); expect(s.state.dispatches).toEqual({}); expect(s.state.agents).toEqual({});
  });
  test('expiry is derived with injected clock and never rewrites hash, evidence mode or durable bytes', () => {
    let now = nowValue; const p = policy(() => now); const s = store(p); const event = fixture(p);
    expect(s.ingest(event).accepted).toBe(true); const bytes = readFileSync(s.file, 'utf8');
    now += 60_001;
    expect(s.state.routing_observations![observationKey(event.payload)].freshness).toBe('stale');
    const replayed = new ManifestStore(s.file, projectA, p);
    expect(replayed.state.routing_observations![observationKey(event.payload)].receipt.receipt_id).toBe(event.payload.receipt_id);
    expect(replayed.state.recent_events[0].status).toBe('synthetic');
    expect(replayed.ingest(event).accepted).toBe(false); expect(readFileSync(s.file, 'utf8')).toBe(bytes);
  });
  test('same receipt retry is append/count/SSE no-op before and after restart', () => {
    const s = store(); let delivered = 0; s.subscribe(() => delivered++); const event = fixture();
    expect(s.ingest(event).accepted).toBe(true); const bytes = readFileSync(s.file, 'utf8');
    expect(s.ingest(event)).toMatchObject({ accepted: false, event: { id: event.id } });
    const restarted = new ManifestStore(s.file, projectA, policy());
    expect(restarted.ingest(event)).toMatchObject({ accepted: false, event: { id: event.id } });
    expect(s.state.event_count).toBe(1); expect(restarted.state.event_count).toBe(1); expect(delivered).toBe(1); expect(readFileSync(s.file, 'utf8')).toBe(bytes);
  });
  test('conflicting observation rejects without append or changing original attribution', () => {
    const s = store(); const first = fixture(); const conflict = fixture(policy(), { attribution: { state: 'ambiguous', reason_code: 'conflicting_attribution' } });
    s.ingest(first); const bytes = readFileSync(s.file, 'utf8');
    expect(s.ingest(conflict)).toEqual({ accepted: false, error: 'receipt_conflict' });
    expect(s.state.routing_observations![observationKey(first.payload)]).toMatchObject({ conflict_count: 1, receipt: { attribution: { state: 'observed' } } });
    expect(readFileSync(s.file, 'utf8')).toBe(bytes);
  });
  test('replay retains first valid receipt and bounds conflict diagnostics', () => {
    const s = store(); const first = fixture(); s.ingest(first);
    const conflict = fixture(policy(), { attribution: { state: 'unavailable', reason_code: 'missing_attribution' } });
    appendFileSync(s.file, JSON.stringify({ ...conflict, seq: 99 }) + '\n');
    const restarted = new ManifestStore(s.file, projectA, policy());
    expect(restarted.state.event_count).toBe(1); expect(restarted.state.routing_observations![observationKey(first.payload)].conflict_count).toBe(1);
    expect(restarted.observationRejections).toEqual({ receipt_conflict: 1 });
    expect(restarted.replay()).toEqual([]);
    expect(restarted.state.routing_observations![observationKey(first.payload)].conflict_count).toBe(1);
  });
  test('later valid records survive corrupt, forged, oversized, incompatible and misbound replay lines', () => {
    const s = store(); const event = fixture();
    writeFileSync(s.file, ['{"private":"RAW_PROMPT_MARKER"', JSON.stringify({ ...event, payload: { ...event.payload, receipt_id: `ro_${'0'.repeat(64)}` } }), JSON.stringify({ ...event, schema: 'temperance.manifest.event.v99' }), JSON.stringify({ ...event, seq: 'private-path' }), JSON.stringify({ ...event, project_id: projectB }), ' '.repeat(8193) + JSON.stringify(event), JSON.stringify({ ...event, seq: 600 })].join('\n') + '\n');
    const replayed = new ManifestStore(s.file, projectA, policy());
    expect(replayed.state.event_count).toBe(1); expect(replayed.state.recent_events[0].seq).toBe(1);
    expect(JSON.stringify(replayed.state)).not.toContain('RAW_PROMPT_MARKER'); expect(JSON.stringify(replayed.observationRejections)).not.toContain('private-path');
  });
  test('unterminated corrupt and valid tails cannot absorb a newly accepted receipt', () => {
    for (const tail of ['{"truncated":', JSON.stringify({ ...fixture(policy(), { observation_id: `obs_${'2'.repeat(32)}` }), seq: 1 })]) {
      const file = join(root(), 'events.jsonl'); writeFileSync(file, tail);
      const s = new ManifestStore(file, projectA, policy()); const event = fixture();
      expect(s.ingest(event).accepted).toBe(true);
      expect(readFileSync(file, 'utf8').startsWith(tail + '\n')).toBe(true);
      const replayed = new ManifestStore(file, projectA, policy());
      expect(replayed.state.routing_observations![observationKey(event.payload)].receipt.receipt_id).toBe(event.payload.receipt_id);
      expect(replayed.state.event_count).toBe(tail.startsWith('{"truncated":') ? 1 : 2);
      expect(replayed.ingest(event)).toMatchObject({ accepted: false, event: { id: event.id } });
      expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
    }
  });
  test('disabled replay never converts observation history to generic routes', () => {
    const s = store(); s.ingest(fixture()); const disabled = new ManifestStore(s.file, projectA);
    expect(disabled.state.event_count).toBe(0); expect(disabled.state.routing_observations).toEqual({}); expect(disabled.state.routes).toEqual({});
  });
  test('two stale writer instances serialize retry and conflicts using locked durable replay', async () => {
    const s = store(); const other = new ManifestStore(s.file, projectA, policy()); const event = fixture();
    const results = await Promise.all([Promise.resolve().then(() => s.ingest(event)), Promise.resolve().then(() => other.ingest(event))]);
    expect(results.filter(r => r.accepted)).toHaveLength(1); expect(results.filter(r => r.error)).toHaveLength(0);
    const conflict = fixture(policy(), { tools: { state: 'completed', started_count: 0, completed_count: 0, failed_count: 0 } });
    expect(other.ingest(conflict).error).toBe('receipt_conflict'); expect(readFileSync(s.file, 'utf8').trim().split('\n')).toHaveLength(1);
  });
  test('two separate processes share the lock and converge on one durable observation', async () => {
    const dir = root(); const file = join(dir, 'events.jsonl'); const data = join(dir, 'fixture.json'); writeFileSync(data, JSON.stringify(fixture()));
    const modulePath = new URL('../src/store.ts', import.meta.url).pathname;
    const payload = { receipt_policy: policy().receipt_policy, project_bindings: policy().project_bindings, max_clock_skew_ms: 1000 };
    const run = (index: number) => {
      const script = `import { ManifestStore } from ${JSON.stringify(modulePath)};
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const p = ${JSON.stringify(payload)}; p.now = () => ${nowValue};
const s = new ManifestStore(${JSON.stringify(file)}, ${JSON.stringify(projectA)}, p);
writeFileSync(${JSON.stringify(join(dir, 'ready-'))} + ${index}, 'ready');
const deadline = Date.now() + 4000;
while (!existsSync(${JSON.stringify(join(dir, 'go'))})) { if (Date.now() > deadline) process.exit(2); await new Promise(r => setTimeout(r, 5)); }
process.stdout.write(JSON.stringify(s.ingest(JSON.parse(readFileSync(${JSON.stringify(data)}, 'utf8')))));`;
      return Bun.spawn([process.execPath, '--no-env-file', '-e', script], { env: {}, stdout: 'pipe', stderr: 'pipe' });
    };
    const children = [run(0), run(1)];
    try {
      const deadline = Date.now() + 4000;
      while (!existsSync(join(dir, 'ready-0')) || !existsSync(join(dir, 'ready-1'))) {
        if (Date.now() > deadline) throw new Error('synthetic writer readiness timeout');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      writeFileSync(join(dir, 'go'), 'go');
      const outputs = await Promise.all(children.map(async child => {
        const stdout = await new Response(child.stdout).text(); const stderr = await new Response(child.stderr).text();
        expect(await child.exited).toBe(0); expect(stderr).toBe(''); return JSON.parse(stdout);
      }));
      expect(outputs.filter(result => result.accepted)).toHaveLength(1);
      for (const result of outputs) expect(result.error === undefined || result.error === 'writer_busy').toBe(true);
      const restarted = new ManifestStore(file, projectA, policy()); expect(restarted.ingest(fixture()).error).toBeUndefined();
      expect(restarted.state.event_count).toBe(1); expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
    } finally { for (const child of children) if (child.exitCode === null) child.kill(); }
  });
  test('occupied writer lock fails closed without stealing or append', () => {
    const s = store(); const lock = `${s.file}.routing-observation.lock`; mkdirSync(lock);
    expect(s.ingest(fixture())).toEqual({ accepted: false, error: 'writer_busy' }); expect(existsSync(lock)).toBe(true); expect(existsSync(s.file)).toBe(false);
  });
  test('injected read failure cannot append a retry or forget a previously admitted snapshot', () => {
    const file = join(root(), 'events.jsonl'); let failRead = false;
    const s = new ManifestStore(file, projectA, policy(), { read: file => {
      if (failRead) throw new Error('/private/RAW_READ_MARKER');
      return readFileSync(file, 'utf8');
    } });
    const event = fixture(); s.ingest(event); const bytes = readFileSync(file, 'utf8'); failRead = true;
    expect(s.ingest(event)).toEqual({ accepted: false, error: 'persistence_failed' });
    expect(s.state.event_count).toBe(1); expect(readFileSync(file, 'utf8')).toBe(bytes);
    expect(JSON.stringify(s.observationRejections)).not.toContain('RAW_READ_MARKER');
  });
  test('injected release failure returns fixed error and leaves durable retry identity intact', () => {
    const file = join(root(), 'events.jsonl');
    const s = new ManifestStore(file, projectA, policy(), { release() { throw new Error('/private/RAW_RELEASE_MARKER'); } });
    let delivered = 0; s.subscribe(() => delivered++);
    expect(s.ingest(fixture())).toEqual({ accepted: false, error: 'persistence_failed' });
    expect(s.state.event_count).toBe(1); expect(delivered).toBe(0); expect(existsSync(`${file}.routing-observation.lock`)).toBe(true);
    expect(new ManifestStore(file, projectA, policy()).state.event_count).toBe(1);
  });
  test('live conflict flags survive catalog snapshot refresh and exact retry', () => {
    const c = new ManifestCatalog(root(), policy()); register(c); const event = fixture(); c.ingest(event);
    expect(c.ingest(fixture(policy(), { attribution: { state: 'unavailable', reason_code: 'missing_attribution' } })).error).toBe('receipt_conflict');
    for (let i = 0; i < 3; i++) expect(c.snapshot().routing_observations![observationKey(event.payload)].conflict_count).toBe(1);
    expect(c.ingest(event).accepted).toBe(false); expect(c.snapshot(projectA).routing_observations![observationKey(event.payload)].conflict_count).toBe(1);
  });
  test('persistence failure returns fixed code without filesystem details', () => {
    const path = root(); const file = join(path, 'events.jsonl'); mkdirSync(file); const s = new ManifestStore(file, projectA, policy());
    expect(s.ingest(fixture())).toEqual({ accepted: false, error: 'persistence_failed' }); expect(existsSync(`${file}.routing-observation.lock`)).toBe(false);
  });
  test.each(['schema', 'id', 'ts', 'fresh_until', 'source', 'status', 'actor', 'project_id'])('rejects envelope mismatch at %s', field => {
    const s = store(); const event = fixture();
    expect(s.ingest({ ...event, [field]: 'RAW_TOOL_OUTPUT_MARKER' }).accepted).toBe(false); expect(existsSync(s.file)).toBe(false); expect(JSON.stringify(s.state)).not.toContain('RAW_TOOL_OUTPUT_MARKER');
  });
  test.each(['seq', 'session_id', 'task_id', 'agent_id', 'correlation_id', 'extra'])('rejects extra envelope key %s before any write', field => {
    const s = store(); expect(s.ingest({ ...fixture(), [field]: 'secret@example.invalid' })).toEqual({ accepted: false, error: 'invalid_envelope' }); expect(existsSync(s.file)).toBe(false);
  });
  test('rejects nested secrets, evidence pointers, unknown identities and arbitrary metadata', () => {
    const s = store(); const event = fixture();
    for (const invalid of [{ ...event, evidence: [{ label: 'RAW_PROMPT_MARKER', path: '/private/path' }] }, { ...event, payload: { ...event.payload, metadata: { innocuous: 'credential' } } }, { ...event, payload: { ...event.payload, provenance: { ...event.payload.provenance, extra: 'x' } } }, { ...event, payload: { ...event.payload, attribution: { ...event.payload.attribution, provider: 'https://private.invalid' } } }]) {
      expect(s.ingest(invalid).accepted).toBe(false);
    }
    expect(s.state.event_count).toBe(0); expect(existsSync(s.file)).toBe(false);
  });
  test('rejects getters, proxies, prototypes and cycles without executing caller code', () => {
    const s = store(); let touched = 0; const event = fixture();
    const getter = { ...event }; Object.defineProperty(getter, 'payload', { get() { touched++; throw new Error('secret'); }, enumerable: true });
    const proxy = new Proxy(event, { ownKeys() { touched++; throw new Error('secret'); } });
    const inherited = Object.create(event); const nested = { ...event, payload: { ...event.payload } }; Object.defineProperty(nested.payload, 'extra', { get() { touched++; return 'secret'; }, enumerable: true });
    const cyclic: any = { ...event }; cyclic.payload = cyclic;
    for (const value of [getter, proxy, inherited, nested, cyclic]) expect(s.ingest(value).accepted).toBe(false);
    expect(touched).toBe(0); expect(existsSync(s.file)).toBe(false);
  });
  test('unknown observation versions, aliases and nested schema smuggling cannot use generic normalization', () => {
    const s = store(); const event = fixture();
    for (const input of [{ ...event, kind: 'routing.observation.v2' }, { ...event, kind: 'route.completed', source: 'omniroute' }, { source: 'manifest', kind: 'arbitrary.generic', payload: { nested: event.payload } }]) {
      expect(s.ingest(input).accepted).toBe(false); expect(() => normalizeEvent(input)).toThrow('unsupported_observation');
    }
    expect(s.state.routes).toEqual({}); expect(existsSync(s.file)).toBe(false);
  });
  test('normalization-reachable reserved kinds and ids reject before store or catalog mutation', async () => {
    for (const input of [
      { source: 'manifest', kind: ' routing.observation.recorded ', payload: { private: 'RAW_PROMPT_MARKER' } },
      { source: 'manifest', kind: '\trouting.observation.v2\n', payload: {} },
      { source: 'manifest', kind: 'routing.observation.recorded' + ' '.repeat(400), payload: {} },
      { source: 'manifest', kind: 'generic', id: ' evt_ro_' + 'a'.repeat(400), payload: {} },
      { source: 'manifest', kind: 'generic', payload: { nested: { schema: ' temperance.routing-observation-receipt.v2 ' } } },
    ]) {
      const s = store(); const path = root(); const c = new ManifestCatalog(path, policy());
      expect(s.ingest(input).accepted).toBe(false); expect(c.ingest(input).accepted).toBe(false);
      expect(() => normalizeEvent(input)).toThrow('unsupported_observation');
      expect(existsSync(s.file)).toBe(false); expect(existsSync(join(path, 'projects.json'))).toBe(false); expect(c.listProjects()).toEqual([]);
      let response = ''; await handleEventPost((async function* () { yield Buffer.from(JSON.stringify(input)); })(), { writeHead() {}, end(body) { response = body; } }, c);
      expect(JSON.parse(response).accepted).toBe(false); expect(response).not.toContain('RAW_PROMPT_MARKER'); expect(existsSync(join(path, 'projects.json'))).toBe(false);
    }
    expect(decodeEventInput('{"source":"manifest","kind":" routing.observation.recorded ","kind":"generic","payload":{}}')).toEqual({ ok: false, error: 'duplicate_key' });
  });
  test('legacy route and approval behavior survives ordinary observation-related prose', () => {
    const s = store(); const generic = { id: 'generic', source: 'omniroute', kind: 'route.health', status: 'observed', payload: { summary: 'implement routing-observation support', api_key: 'secret' } };
    expect(observationLike(generic)).toBe(false); expect(s.ingest(generic).accepted).toBe(true);
    expect(s.state.routes[`${projectA}:latest`]).toMatchObject({ summary: 'implement routing-observation support', api_key: '[REDACTED]' });
    expect(s.ingest({ id: 'approval', source: 'manifest', kind: 'approval.granted', payload: { approval_id: 'legacy' } }).accepted).toBe(true);
    expect(s.state.approvals.legacy.status).toBe('granted'); expect(s.state.routing_observations).toEqual({});
  });
  test('future clocks, invalid skew and unknown bindings fail before persistence', () => {
    const event = fixture();
    expect(store(policy(() => nowValue - 1001)).ingest(event).error).toBe('invalid_time');
    const p = policy(); p.max_clock_skew_ms = 300001; expect(store(p).ingest(event).error).toBe('invalid_policy');
    const wrong = new ManifestStore(join(root(), 'events.jsonl'), projectB, policy()); expect(wrong.ingest(event).error).toBe('project_not_registered');
  });
  test('catalog rejects invalid observations before registry creation or SSE delivery', () => {
    const path = root(); const c = new ManifestCatalog(path, policy()); let delivered = 0; c.subscribe(() => delivered++);
    expect(c.ingest(fixture()).error).toBe('project_not_registered');
    expect(c.ingest({ ...fixture(), payload: { ...fixture().payload, extra: 'RAW_PROMPT_MARKER' } }).error).toBe('invalid_receipt');
    expect(existsSync(join(path, 'projects.json'))).toBe(false); expect(c.listProjects()).toEqual([]); expect(delivered).toBe(0);
  });
  test('catalog explicitly aggregates separate projects with the same observation id', () => {
    const c = new ManifestCatalog(root(), policy()); register(c); register(c, projectB);
    const first = fixture(); const second = fixture(policy(), { project_ref: projectB });
    expect(c.ingest(first).accepted).toBe(true); expect(c.ingest(second).accepted).toBe(true);
    expect(Object.keys(c.snapshot().routing_observations!)).toHaveLength(2);
    expect(Object.keys(c.snapshot(projectA).routing_observations!)).toEqual([observationKey(first.payload)]);
    expect(c.snapshot().routes).toEqual({}); expect(c.snapshot().dispatches).toEqual({});
  });
  test('same catalog fails closed on current registry removal, corruption and read failure, then recovers on re-add', () => {
    const dir = root(); const c = new ManifestCatalog(dir, policy()); register(c); const event = fixture(); c.ingest(event);
    const registry = join(dir, 'projects.json'); const registered = readFileSync(registry, 'utf8');
    for (const damage of ['[]', '{"private":"RAW_REGISTRY_MARKER"', 'directory']) {
      if (damage === 'directory') { rmSync(registry); mkdirSync(registry); }
      else writeFileSync(registry, damage);
      const before = readFileSync(join(dir, 'projects', projectA, 'events.jsonl'), 'utf8');
      expect(c.ingest(event)).toEqual({ accepted: false, error: 'project_not_registered' });
      expect(c.snapshot().routing_observations).toEqual({});
      expect(readFileSync(join(dir, 'projects', projectA, 'events.jsonl'), 'utf8')).toBe(before);
      if (damage === 'directory') rmSync(registry, { recursive: true });
      writeFileSync(registry, registered);
      expect(c.ingest(event)).toMatchObject({ accepted: false, event: { id: event.id } });
      expect(c.snapshot().routing_observations![observationKey(event.payload)].receipt.receipt_id).toBe(event.payload.receipt_id);
    }
  });
  test('duplicate registry ids cannot grant observation authority in either order', () => {
    const dir = root(); const c = new ManifestCatalog(dir, policy()); register(c); const registry = join(dir, 'projects.json');
    const active = JSON.parse(readFileSync(registry, 'utf8'))[0]; const removed = { ...active, visibility: 'unregistered' };
    for (const records of [[active, removed], [removed, active], [active, removed, active], [active, active]]) {
      writeFileSync(registry, JSON.stringify(records));
      expect(c.ingest(fixture())).toEqual({ accepted: false, error: 'project_not_registered' });
      expect(c.snapshot().routing_observations).toEqual({});
    }
    expect(existsSync(join(dir, 'projects', projectA, 'events.jsonl'))).toBe(false);
  });
  test('unregistered catalog records and discovered directories cannot admit or replay receipts', () => {
    const path = root(); const c = new ManifestCatalog(path, policy()); register(c); c.ingest(fixture());
    c.setVisibility(projectA, 'unregistered'); expect(c.ingest(fixture()).error).toBe('project_not_registered'); expect(c.snapshot().routing_observations).toEqual({});
    const other = root(); mkdirSync(join(other, 'projects', projectA), { recursive: true }); writeFileSync(join(other, 'projects', projectA, 'events.jsonl'), JSON.stringify({ ...fixture(), seq: 1 }) + '\n');
    const discovered = new ManifestCatalog(other, policy()); expect(discovered.snapshot().routing_observations).toEqual({});
  });
});

describe('byte and transport boundaries (fake HTTP/CLI)', () => {
  test('rejects malformed JSON, invalid UTF-8, BOMs and oversized bytes with fixed codes', () => {
    expect(decodeEventInput('{"private":"RAW_PROMPT_MARKER"')).toEqual({ ok: false, error: 'invalid_json' });
    expect(decodeEventInput(new Uint8Array([0xff]))).toEqual({ ok: false, error: 'invalid_encoding' });
    expect(decodeEventInput('\ufeff{}')).toEqual({ ok: false, error: 'invalid_encoding' });
    expect(decodeEventInput('x'.repeat(MAX_EVENT_INPUT_BYTES + 1))).toEqual({ ok: false, error: 'input_too_large' });
    expect(decodeEventInput(' '.repeat(8193) + JSON.stringify(fixture()))).toEqual({ ok: false, error: 'input_too_large' });
  });
  test('rejects duplicate envelope, escaped duplicate and nested keys before JSON can erase them', () => {
    const raw = JSON.stringify(fixture());
    for (const value of [raw.replace('"schema":', '"schema":"private","schema":'), raw.replace('"schema":', '"\\u0073chema":"private","schema":'), raw.replace('"outcome":', '"outcome":"failed","outcome":')]) expect(decodeEventInput(value)).toEqual({ ok: false, error: 'duplicate_key' });
  });
  test('generic duplicate-key behavior remains compatible but cannot hide a reserved discriminator', () => {
    expect(decodeEventInput('{"source":"manifest","kind":"generic","payload":{"count":1,"count":2}}')).toMatchObject({ ok: true, special: false, input: { payload: { count: 2 } } });
    expect(decodeEventInput('{"source":"manifest","kind":"routing.observation.recorded","kind":"generic","payload":{}}')).toEqual({ ok: false, error: 'duplicate_key' });
  });
  test('hostile byte objects do not invoke accessors or proxy traps', () => {
    let touched = 0; const bytes = new Uint8Array([123, 125]); Object.defineProperty(bytes, 'byteLength', { get() { touched++; throw new Error('secret'); } });
    const proxy = new Proxy(new Uint8Array([123, 125]), { get() { touched++; throw new Error('secret'); } });
    class Subclass extends Uint8Array {}
    for (const value of [bytes, proxy, new Subclass([123, 125]), Object.create(Uint8Array.prototype)]) expect(decodeEventInput(value).ok).toBe(false);
    expect(touched).toBe(0);
  });
  test('CLI emit returns only validated identity for accepted and duplicate observations', () => {
    const s = store(); const raw = JSON.stringify(fixture());
    const accepted = emitEventInput(raw, s); expect(accepted.exitCode).toBe(0); expect(accepted.result).toEqual({ accepted: true, outcome: 'accepted', event_id: fixture().id, receipt_id: fixture().payload.receipt_id });
    expect(emitEventInput(raw, s).result).toMatchObject({ accepted: false, outcome: 'duplicate' });
    expect(emitEventInput(raw.replace('fixture-model', 'secret@example.invalid'), s).result).toEqual({ accepted: false, error: 'invalid_receipt' });
  });
  test('CLI bounds a throwing persistence sink without echoing its exception', () => {
    expect(emitEventInput(JSON.stringify(fixture()), { ingest() { throw new Error('/private/RAW_DRIVER_MARKER'); } })).toEqual({ result: { accepted: false, error: 'persistence_failed' }, exitCode: 1 });
  });
  test('real HTTP seam accepts once, deduplicates, bounds errors, and publishes only validated events', async () => {
    const s = store(); const messages: unknown[] = []; const diagnostics: unknown[] = []; s.subscribe(e => messages.push(e));
    async function post(raw: string | Uint8Array) {
      let status = 0; let body = ''; const bytes = typeof raw === 'string' ? Buffer.from(raw) : raw;
      await handleEventPost((async function* () { yield bytes.slice(0, 17); yield bytes.slice(17); })(), { writeHead(code) { status = code; }, end(value) { body = value; } }, s, { diagnostic: value => diagnostics.push(value) });
      return { status, body: JSON.parse(body) };
    }
    expect((await post(JSON.stringify(fixture()))).status).toBe(201);
    expect((await post(JSON.stringify(fixture()))).status).toBe(200);
    expect(await post(JSON.stringify({ ...fixture(), project_id: 'RAW_PROMPT_MARKER' }))).toEqual({ status: 400, body: { accepted: false, error: 'project_not_registered' } });
    expect(await post('{"secret":"RAW_TOOL_OUTPUT_MARKER"')).toEqual({ status: 400, body: { accepted: false, error: 'invalid_json' } });
    expect(messages).toHaveLength(1); expect(JSON.stringify(diagnostics)).not.toContain('RAW_PROMPT_MARKER'); expect(JSON.stringify(diagnostics)).not.toContain('RAW_TOOL_OUTPUT_MARKER');
    expect(await post(new Uint8Array([0xff]))).toEqual({ status: 400, body: { accepted: false, error: 'invalid_encoding' } });
  });
  test('HTTP oversize and stream exceptions do not disclose raw messages or call sink', async () => {
    let calls = 0; const sink = { ingest() { calls++; return { accepted: true }; } };
    for (const chunks of [(async function* () { yield Buffer.alloc(MAX_EVENT_INPUT_BYTES + 1); })(), (async function* () { throw new Error('/private/RAW_PROMPT_MARKER'); yield Buffer.alloc(0); })()]) {
      let response = ''; await handleEventPost(chunks, { writeHead() {}, end(body) { response = body; } }, sink);
      expect(JSON.parse(response).accepted).toBe(false); expect(response).not.toContain('RAW_PROMPT_MARKER');
    }
    expect(calls).toBe(0);
  });
});
