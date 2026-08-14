import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeEvent } from '../src/contract';
import { ManifestCatalog } from '../src/catalog';
import { canonicalCwd, initProject, projectIdForCwd, projectManifestPath } from '../src/project';
import { ManifestServer } from '../src/server';
import { ManifestStore } from '../src/store';
import { RuntimeWatcher } from '../src/watcher';
import { hookInputToEvent } from '../src/hook-adapter';
import { activateAlgorithmRun, activeRunFor, classificationFromContext, closeAlgorithmRun, loadActivationPolicy, publishActivationEvent, resolveAlgorithmActivation } from '../src/activation';
import { formatManifestRuntimeContext, manifestRuntimeReceipt } from '../src/runtime-status';
import { formatDoctorReport, repairDuplicateEvents, runManifestDoctor } from '../src/doctor';
import { ManifestDiagnostics } from '../src/diagnostics';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixtureStore(): ManifestStore {
  const dir = mkdtempSync(join(tmpdir(), 'temperance-manifest-'));
  dirs.push(dir);
  return new ManifestStore(join(dir, 'events.jsonl'));
}

describe('manifest event plane', () => {
  test('accepts only an allowlisted Algorithm run at its Git worktree root', () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-activation-root-'));
    dirs.push(root);
    const portfolio = join(root, 'thoughtseed');
    const project = join(portfolio, 'cambium');
    mkdirSync(join(project, 'packages', 'web'), { recursive: true });
    Bun.spawnSync(['git', 'init', project]);
    const registered = initProject(project).identity;

    const decision = resolveAlgorithmActivation({
      mode: 'ALGORITHM', tier: 'E4', cwd: join(project, 'packages', 'web'), session_id: 'session-a',
    }, { allowed_roots: [portfolio] });

    expect(decision.accepted).toBe(true);
    expect(decision.enrollment).toBe('enrolled');
    expect(decision.project?.project_id).toBe(registered.project_id);
    expect(decision.project?.cwd).toBe(canonicalCwd(project));
  });

  test('rejects Native mode and project roots outside the policy', () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-activation-deny-'));
    dirs.push(root);
    const allowed = join(root, 'thoughtseed');
    const outside = join(root, 'other', 'repo');
    mkdirSync(allowed, { recursive: true });
    mkdirSync(outside, { recursive: true });
    Bun.spawnSync(['git', 'init', outside]);

    expect(resolveAlgorithmActivation({ mode: 'NATIVE', cwd: outside, session_id: 'session-n' }, { allowed_roots: [allowed] }).reason).toBe('mode_not_algorithm');
    expect(resolveAlgorithmActivation({ mode: 'ALGORITHM', cwd: outside, session_id: 'session-o' }, { allowed_roots: [allowed] }).reason).toBe('outside_allowlist');
  });

  test('persists an observed-only active run without writing to its project', () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-activation-candidate-'));
    dirs.push(root);
    const portfolio = join(root, 'tryambakam-noesis');
    const project = join(portfolio, 'new-repo');
    const state = join(root, 'state');
    mkdirSync(project, { recursive: true });
    Bun.spawnSync(['git', 'init', project]);

    const result = activateAlgorithmRun({ mode: 'ALGORITHM', tier: 'E3', cwd: project, session_id: 'session-c' }, { allowed_roots: [portfolio], state_dir: state });

    expect(result.accepted).toBe(true);
    expect(result.enrollment).toBe('observed-only');
    expect(existsSync(join(project, '.temperance', 'manifest.json'))).toBe(false);
    expect(activeRunFor('session-c', state)?.project_cwd).toBe(canonicalCwd(project));
    const catalog = new ManifestCatalog(state);
    expect(catalog.snapshot(result.project!.project_id).sessions['session-c'].mode).toBe('ALGORITHM');
  });

  test('stops observing lifecycle events once an Algorithm run closes', () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-activation-close-'));
    dirs.push(root);
    const portfolio = join(root, 'thoughtseed');
    const project = join(portfolio, 'repo');
    const state = join(root, 'state');
    mkdirSync(project, { recursive: true });
    Bun.spawnSync(['git', 'init', project]);
    activateAlgorithmRun({ mode: 'ALGORITHM', cwd: project, session_id: 'session-z' }, { allowed_roots: [portfolio], state_dir: state });

    expect(closeAlgorithmRun('session-z', state)?.run_id).toBe('session-z');
    expect(activeRunFor('session-z', state)).toBeNull();
  });

  test('loads a versioned host policy and parses both PAI classifier formats', () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-activation-policy-'));
    dirs.push(root);
    const state = join(root, 'state');
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, 'activation-policy.json'), JSON.stringify({ schema: 'temperance.manifest.activation-policy.v1', allowed_roots: [join(root, 'thoughtseed')] }));

    expect(loadActivationPolicy(state).allowed_roots).toEqual([canonicalCwd(join(root, 'thoughtseed'))]);
    expect(classificationFromContext('MODE: ALGORITHM | TIER: E4').tier).toBe('E4');
    expect(classificationFromContext('mode/tier: ALGORITHM / E3 | reason: policy').mode).toBe('ALGORITHM');
  });

  test('refreshes a direct activation before accepting its HTTP retry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-activation-sse-'));
    dirs.push(root);
    const portfolio = join(root, 'thoughtseed');
    const project = join(portfolio, 'repo');
    const state = join(root, 'state');
    mkdirSync(project, { recursive: true });
    Bun.spawnSync(['git', 'init', project]);
    const catalog = new ManifestCatalog(state);
    const server = new ManifestServer(catalog);
    const address = await server.listen(0);
    const activation = activateAlgorithmRun({ mode: 'ALGORITHM', cwd: project, session_id: 'session-sse' }, { allowed_roots: [portfolio], state_dir: state });

    const retry = await publishActivationEvent(activation, `http://${address.host}:${address.port}`);

    expect(retry).toBe(true);
    expect(catalog.snapshot(activation.project!.project_id).event_count).toBe(1);
    expect((await (await fetch(`http://${address.host}:${address.port}/snapshot?project_id=${activation.project!.project_id}`)).json() as ManifestState).event_count).toBe(1);
    await server.close();
  });

  test('renders a bounded runtime receipt from verified loopback services', async () => {
    const store = fixtureStore();
    const server = new ManifestServer(store);
    const address = await server.listen(0);
    const gateway = Bun.serve({ port: 0, fetch: () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } }) });
    const receipt = await manifestRuntimeReceipt({ bridge_url: `http://${address.host}:${address.port}`, omniroute_url: `http://127.0.0.1:${gateway.port}` });
    const context = formatManifestRuntimeContext(receipt);
    expect(receipt.manifest.state).toBe('ready');
    expect(receipt.omniroute.state).toBe('ready');
    expect(context).toContain('☿ MANIFEST · READY');
    expect(context).toContain('auth protected');
    gateway.stop(); await server.close();
  });

  test('keeps an offline bridge explicit instead of inventing a healthy receipt', async () => {
    const receipt = await manifestRuntimeReceipt({ bridge_url: 'http://127.0.0.1:1', omniroute_url: 'http://127.0.0.1:1' });
    expect(receipt.manifest.state).toBe('offline');
    expect(formatManifestRuntimeContext(receipt)).toContain('☿ MANIFEST · OFFLINE');
  });

  test('doctor validates event integrity, runtime reachability, and safe persisted reports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-doctor-'));
    dirs.push(root);
    writeFileSync(join(root, 'activation-policy.json'), JSON.stringify({ schema: 'temperance.manifest.activation-policy.v1', enabled: true, allowed_roots: ['/portfolio'] }));
    const catalog = new ManifestCatalog(root);
    catalog.ingest({ source: 'manifest', kind: 'doctor.fixture', status: 'synthetic', project_id: 'fixture', payload: {} });
    const server = new ManifestServer(catalog); const address = await server.listen(0);
    const gateway = Bun.serve({ port: 0, fetch: () => new Response('{}', { status: 401 }) });
    const console = Bun.serve({ port: 0, fetch: () => new Response('<html><div id="root"></div></html>') });
    const report = await runManifestDoctor({ state_dir: root, bridge_url: `http://${address.host}:${address.port}`, omniroute_url: `http://127.0.0.1:${gateway.port}`, console_url: `http://127.0.0.1:${console.port}`, home: root, platform: 'linux', record: true });
    expect(report.overall).toBe('warn');
    expect(report.checks.find((check) => check.id === 'event-log')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'console-health')?.status).toBe('pass');
    expect(formatDoctorReport(report, true)).toContain('MANIFEST DOCTOR · WARN');
    expect(readdirSync(join(root, 'diagnostics')).some((name) => name.startsWith('doctor-'))).toBe(true);
    gateway.stop(); console.stop(); await server.close();
  });

  test('doctor fails closed on malformed persisted event records', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-doctor-corrupt-'));
    dirs.push(root); writeFileSync(join(root, 'events.jsonl'), '{not-json}\n');
    const report = await runManifestDoctor({ state_dir: root, bridge_url: 'http://127.0.0.1:1', omniroute_url: 'http://127.0.0.1:1', home: root, platform: 'linux' });
    expect(report.overall).toBe('fail');
    expect(report.exit_code).toBe(2);
    expect(report.checks.find((check) => check.id === 'event-log')?.status).toBe('fail');
  });

  test('repairs only exact duplicate event IDs after taking a recoverable backup', () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-doctor-repair-'));
    dirs.push(root); const file = join(root, 'events.jsonl');
    writeFileSync(file, `${JSON.stringify({ id: 'same', source: 'manifest', kind: 'fixture', status: 'synthetic', payload: {} })}\n${JSON.stringify({ id: 'same', source: 'manifest', kind: 'fixture', status: 'synthetic', payload: {} })}\n`);
    const repaired = repairDuplicateEvents(root);
    expect(repaired.removed).toBe(1);
    expect(repaired.backups).toHaveLength(1);
    expect(readFileSync(file, 'utf8').match(/"same"/g)).toHaveLength(1);
    expect(readFileSync(repaired.backups[0], 'utf8').match(/"same"/g)).toHaveLength(2);
  });

  test('writes only allowlisted metadata to opt-in rotating debug telemetry', () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-diagnostics-'));
    dirs.push(root); const diagnostics = new ManifestDiagnostics(root, 'debug');
    diagnostics.request({ method: 'POST', path: '/events', status: 201, duration_ms: 4 });
    diagnostics.event({ kind: 'algorithm.activated', project_id: 'fixture', accepted: true, outcome: 'accepted' });
    const log = readFileSync(join(root, 'logs', 'bridge-debug.jsonl'), 'utf8');
    expect(log).toContain('http.request');
    expect(log).toContain('algorithm.activated');
    expect(log).toContain('"outcome":"accepted"');
    expect(log).not.toContain('prompt');
    expect(log).not.toContain('authorization');
  });

  test('normalizes, bounds, and redacts payloads', () => {
    const event = normalizeEvent({ source: 'pai-hook', kind: 'prompt.classified', payload: { api_key: 'secret', prompt: 'x'.repeat(800) } });
    expect(event.schema).toBe('temperance.manifest.event.v1');
    expect(event.payload.api_key).toBe('[REDACTED]');
    expect(String(event.payload.prompt).length).toBeLessThanOrEqual(501);
  });

  test('turns hook input into a safe summary event', () => {
    const event = hookInputToEvent({
      hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1',
      tool_input: { description: 'worker one', prompt: 'private prompt', token: 'secret' },
      tool_response: 'private output', transcript_path: '/tmp/transcript.jsonl',
    }, '/repo');
    expect(event.kind).toBe('agent.started');
    expect(event.project_id).toBe(projectIdForCwd('/repo'));
    expect(event.payload.prompt_present).toBe(true);
    expect(event.payload.tool_response_present).toBe(true);
    expect(event.payload).not.toHaveProperty('token');
    expect(event.payload).not.toHaveProperty('prompt');
    expect(event.evidence[0].path).toBe('/tmp/transcript.jsonl');
  });

  test('captures classifier mode and tier from PAI context without prompt content', () => {
    const event = hookInputToEvent({
      hook_event_name: 'UserPromptSubmit',
      additionalContext: 'MODE: ALGORITHM\nTIER: E4\nREASON: cross-cutting integration',
      prompt: 'private request',
    }, '/repo');
    expect(event.payload.mode).toBe('ALGORITHM');
    expect(event.payload.tier).toBe('E4');
    expect(event.payload).not.toHaveProperty('prompt');
  });

  test('replays and deduplicates events into projections', () => {
    const store = fixtureStore();
    const event = { id: 'evt-fixed', source: 'pai-hook', kind: 'phase.changed', status: 'observed', project_id: 'demo', session_id: 's1', phase: 'PLAN', payload: {} };
    expect(store.ingest(event).accepted).toBe(true);
    expect(store.ingest(event).accepted).toBe(false);
    const replayed = new ManifestStore(store.file);
    expect(replayed.state.event_count).toBe(1);
    expect(replayed.state.sessions.s1.phase).toBe('PLAN');
  });

  test('serves snapshot and streams accepted events over SSE', async () => {
    const store = fixtureStore();
    const server = new ManifestServer(store);
    const address = await server.listen(0);
    const base = `http://${address.host}:${address.port}`;
    const snapshot = await fetch(`${base}/snapshot`);
    expect(snapshot.status).toBe(200);
    const response = await fetch(`${base}/events`);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('event: snapshot');
    const posted = await fetch(`${base}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'evt-sse', source: 'manifest', kind: 'test.pulse', status: 'synthetic', payload: { ok: true } }) });
    expect(posted.status).toBe(201);
    const second = new TextDecoder().decode((await reader.read()).value);
    expect(second).toContain('evt-sse');
    await reader.cancel();
    await server.close();
  });

  test('redirects browser and HEAD root requests to the visual operator console', async () => {
    const server = new ManifestServer(fixtureStore());
    const address = await server.listen(0);
    const response = await fetch(`http://${address.host}:${address.port}/`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://127.0.0.1:5173');
    const head = await fetch(`http://${address.host}:${address.port}/`, { method: 'HEAD', redirect: 'manual' });
    expect(head.status).toBe(302);
    expect(head.headers.get('location')).toBe('http://127.0.0.1:5173');
    await server.close();
  });

  test('replays external project-log sync into a live catalog and SSE stream', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-external-sync-'));
    const project = initProject(join(root, 'cambium')).identity;
    const catalog = new ManifestCatalog(root);
    catalog.ensureProject(project);
    const server = new ManifestServer(catalog);
    const address = await server.listen(0);
    const base = `http://${address.host}:${address.port}`;
    const response = await fetch(`${base}/events?project_id=${project.project_id}`);
    const reader = response.body!.getReader();
    await reader.read();
    const external = new ManifestStore(join(root, 'projects', project.project_id, 'events.jsonl'), project.project_id);
    external.ingest({ source: 'project-artifact', kind: 'wave.updated', status: 'observed', project_id: project.project_id, payload: { wave_id: 'external-sync' } });
    const snapshot = await fetch(`${base}/snapshot?project_id=${project.project_id}`);
    const state = await snapshot.json() as ManifestState;
    expect(state.event_count).toBe(1);
    const packet = new TextDecoder().decode((await reader.read()).value);
    expect(packet).toContain('external-sync');
    await reader.cancel(); await server.close();
  });

  test('polls algorithm and next-wave source files without mutating them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-runtime-'));
    dirs.push(root);
    const cwd = join(root, 'project');
    mkdirSync(join(root, '.claude', 'MEMORY', 'STATE', 'algorithms'), { recursive: true });
    mkdirSync(join(cwd, '.planning'), { recursive: true });
    const algorithmPath = join(root, '.claude', 'MEMORY', 'STATE', 'algorithms', 'session-1.json');
    const wavePath = join(cwd, '.planning', 'NEXT-WAVE.json');
    writeFileSync(algorithmPath, JSON.stringify({ sessionId: 'session-1', active: true, currentPhase: 'EXECUTE', criteriaCount: 3, agentCount: 1 }));
    writeFileSync(wavePath, JSON.stringify({ cwd, wave: { phase: 'EXECUTE', mode: 'parallel', tasks: [{ id: 'T1' }] } }));
    const store = new ManifestStore(join(root, 'events.jsonl'));
    const watcher = new RuntimeWatcher(store, { home: root, cwd, intervalMs: 10 });
    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    watcher.stop();
    expect(store.state.sessions['session-1'].phase).toBe('EXECUTE');
    expect(Object.keys(store.state.waves).length).toBe(1);
    expect(readFileSafe(algorithmPath)).toContain('EXECUTE');
    expect(readFileSafe(wavePath)).toContain('T1');
  });

  test('keeps human next-wave phase labels and makes watcher sync idempotent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-watcher-idempotent-'));
    dirs.push(root);
    const cwd = join(root, 'project');
    mkdirSync(join(root, '.claude', 'MEMORY', 'STATE', 'algorithms'), { recursive: true });
    mkdirSync(join(cwd, '.planning'), { recursive: true });
    writeFileSync(join(cwd, '.planning', 'NEXT-WAVE.json'), JSON.stringify({ cwd, wave: { action: 'complete', phase: '2 of 2 (Telegram Operator Intake)', tasks: [] } }));
    const store = new ManifestStore(join(root, 'events.jsonl'));
    await new RuntimeWatcher(store, { home: root, cwd, intervalMs: 1 }).sync();
    const firstCount = store.state.event_count;
    await new RuntimeWatcher(store, { home: root, cwd, intervalMs: 1 }).sync();
    const secondState = store.state;
    expect(firstCount).toBe(1);
    expect(secondState.event_count).toBe(1);
    const wave = Object.values(secondState.waves)[0];
    expect(wave.phase).toBeNull();
    expect(wave.phase_label).toBe('2 of 2 (Telegram Operator Intake)');
  });

  test('isolates two initialized projects in one catalog and aggregate view', () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-catalog-'));
    const projectA = join(root, 'alpha');
    const projectB = join(root, 'beta');
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    const a = initProject(projectA);
    const b = initProject(projectB);
    expect(readFileSafe(projectManifestPath(projectA))).toContain(a.identity.project_id);
    expect(a.identity.project_id).not.toBe(b.identity.project_id);
    const catalog = new ManifestCatalog(root);
    catalog.ensureProject(a.identity);
    catalog.ensureProject(b.identity);
    expect(catalog.ingest({ source: 'pai-hook', kind: 'phase.changed', status: 'observed', project_id: a.identity.project_id, session_id: 'a-session', phase: 'PLAN', payload: { project_name: a.identity.name } }).accepted).toBe(true);
    expect(catalog.ingest({ source: 'pai-hook', kind: 'phase.changed', status: 'observed', project_id: b.identity.project_id, session_id: 'b-session', phase: 'EXECUTE', payload: { project_name: b.identity.name } }).accepted).toBe(true);
    expect(catalog.snapshot(a.identity.project_id).event_count).toBe(1);
    expect(catalog.snapshot(a.identity.project_id).sessions['b-session']).toBeUndefined();
    expect(catalog.snapshot(b.identity.project_id).sessions['a-session']).toBeUndefined();
    expect(catalog.state.event_count).toBe(2);
    expect(catalog.listProjects().map((project) => project.project_id)).toEqual(expect.arrayContaining([a.identity.project_id, b.identity.project_id]));
  });

  test('refreshes project registry written after server construction', () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-catalog-refresh-'));
    const project = initProject(join(root, 'late-project')).identity;
    const catalog = new ManifestCatalog(root);
    const external = new ManifestCatalog(root);
    external.ensureProject(project);
    expect(catalog.listProjects().map((entry) => entry.project_id)).toContain(project.project_id);
    expect(catalog.snapshot().event_count).toBe(0);
  });

  test('preserves concurrent registry writers with stale catalog instances', () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-catalog-lock-'));
    const alpha = initProject(join(root, 'alpha')).identity;
    const beta = initProject(join(root, 'beta')).identity;
    const first = new ManifestCatalog(root);
    const second = new ManifestCatalog(root);
    first.ensureProject(alpha);
    second.ensureProject(beta);
    const reloaded = new ManifestCatalog(root);
    expect(reloaded.listProjects().map((entry) => entry.project_id)).toEqual(expect.arrayContaining([alpha.project_id, beta.project_id]));
  });

  test('filters SSE delivery by project without port duplication', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-sse-projects-'));
    const projectA = initProject(join(root, 'alpha')).identity;
    const projectB = initProject(join(root, 'beta')).identity;
    const catalog = new ManifestCatalog(root);
    catalog.ensureProject(projectA); catalog.ensureProject(projectB);
    const server = new ManifestServer(catalog);
    const address = await server.listen(0);
    const base = `http://${address.host}:${address.port}`;
    const response = await fetch(`${base}/events?project_id=${projectA.project_id}`);
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('event: snapshot');
    const other = await fetch(`${base}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'pai-hook', kind: 'agent.completed', status: 'observed', project_id: projectB.project_id, payload: {} }) });
    expect(other.status).toBe(201);
    const own = await fetch(`${base}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'pai-hook', kind: 'agent.completed', status: 'observed', project_id: projectA.project_id, payload: {} }) });
    expect(own.status).toBe(201);
    const second = new TextDecoder().decode((await reader.read()).value);
    expect(second).toContain(projectA.project_id);
    expect(second).not.toContain(projectB.project_id);
    await reader.cancel(); await server.close();
  });

  test('does not attribute cwd-less host algorithm state to an arbitrary project in all-project mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-watcher-scope-'));
    const alpha = join(root, 'alpha');
    const beta = join(root, 'beta');
    mkdirSync(join(root, '.claude', 'MEMORY', 'STATE', 'algorithms'), { recursive: true });
    mkdirSync(alpha, { recursive: true }); mkdirSync(beta, { recursive: true });
    writeFileSync(join(root, '.claude', 'MEMORY', 'STATE', 'algorithms', 'ambiguous.json'), JSON.stringify({ sessionId: 'ambiguous', active: true, currentPhase: 'EXECUTE' }));
    const catalog = new ManifestCatalog(join(root, 'state'));
    const watcher = new RuntimeWatcher(catalog, { cwd: alpha, cwds: [alpha, beta], home: root, intervalMs: 5 });
    await watcher.sync();
    expect(catalog.state.sessions.ambiguous).toBeUndefined();
  });

  test('projects orchestration options, approval gates, and stale receipt evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-orchestration-'));
    const cwd = join(root, 'project');
    const project = initProject(cwd).identity;
    mkdirSync(join(cwd, '.planning'), { recursive: true });
    writeFileSync(join(cwd, '.planning', 'ORCHESTRATION.json'), JSON.stringify({
      schema: 'temperance.orchestration.v1', plan_id: 'plan-a', state: 'awaiting_approval', mapping: { policy_hash: 'policy-a' },
      options: [{ option_id: 'opt-a', label: 'Safe option', combo: 'te-build' }], research: [{ label: 'research-note', finding: 'evidence' }],
      approval: { approval_id: 'apr-a', status: 'required', expires_at: new Date(Date.now() + 60_000).toISOString() },
      readiness: { status: 'blocked' }, execution: { status: 'blocked' }, reporting: { status: 'pending' },
    }));
    const catalog = new ManifestCatalog(join(root, 'state'));
    catalog.ensureProject(project);
    const watcher = new RuntimeWatcher(catalog, { cwd, cwds: [cwd], home: root, intervalMs: 5 });
    await watcher.sync();
    const snapshot = catalog.snapshot(project.project_id);
    expect(snapshot.plans['plan-a'].state).toBe('awaiting_approval');
    expect(snapshot.plans['plan-a'].options).toHaveProperty('opt-a');
    expect(snapshot.approvals['apr-a'].status).toBe('required');
    expect(snapshot.dispatches['plan-a'].status).toBe('observed');
    const expired = fixtureStore();
    expired.ingest({ source: 'manifest', kind: 'plan.updated', status: 'observed', fresh_until: new Date(Date.now() - 1).toISOString(), payload: { plan_id: 'old' } });
    expect(expired.state.alerts).toHaveLength(1);
    expect(expired.state.alerts[0].status).toBe('stale');
  });

  test('records a valid local approval and rejects reserved generic approval events', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-approval-command-'));
    const cwd = join(root, 'project');
    const project = initProject(cwd).identity;
    const catalog = new ManifestCatalog(join(root, 'state'));
    catalog.ensureProject(project);
    catalog.ingest({ source: 'project-artifact', kind: 'plan.updated', status: 'observed', project_id: project.project_id, correlation_id: 'plan-a', payload: { plan_id: 'plan-a', mapping: { policy_hash: 'policy-a' } } });
    catalog.ingest({ source: 'project-artifact', kind: 'plan.option.proposed', status: 'observed', project_id: project.project_id, correlation_id: 'plan-a', payload: { plan_id: 'plan-a', option_id: 'opt-a' } });
    catalog.ingest({ source: 'project-artifact', kind: 'approval.requested', status: 'observed', project_id: project.project_id, correlation_id: 'plan-a', payload: { plan_id: 'plan-a', approval_id: 'apr-a', status: 'required', expires_at: new Date(Date.now() + 60_000).toISOString() } });
    const server = new ManifestServer(catalog);
    const address = await server.listen(0);
    const base = `http://${address.host}:${address.port}`;
    const reserved = await fetch(`${base}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'manifest', kind: 'approval.granted', payload: {} }) });
    expect(reserved.status).toBe(400);
    const response = await fetch(`${base}/approvals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project_id: project.project_id, plan_id: 'plan-a', option_id: 'opt-a', approval_id: 'apr-a' }) });
    expect(response.status).toBe(201);
    expect(readFileSafe(join(cwd, '.planning', 'APPROVALS.json'))).toContain('apr-a');
    expect(catalog.snapshot(project.project_id).approvals['apr-a'].status).toBe('granted');
    await server.close();
  });
});

function readFileSafe(path: string): string {
  return readFileSync(path, 'utf8');
}
