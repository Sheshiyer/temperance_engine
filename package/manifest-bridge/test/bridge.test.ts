import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { normalizeEvent } from '../src/contract';
import { ManifestCatalog } from '../src/catalog';
import { canonicalCwd, initProject, projectIdForCwd, projectManifestPath } from '../src/project';
import { ManifestServer } from '../src/server';
import { ManifestStore } from '../src/store';
import { RuntimeWatcher } from '../src/watcher';
import { hookInputToEvent } from '../src/hook-adapter';
import { activateAlgorithmRun, activeRunFor, classificationFromContext, closeAlgorithmRun, loadActivationPolicy, publishActivationEvent, resolveAlgorithmActivation } from '../src/activation';
import { formatManifestRuntimeContext, formatPaiModeOffer, manifestRuntimeReceipt } from '../src/runtime-status';
import { formatDoctorReport, repairDuplicateEvents, runManifestDoctor } from '../src/doctor';
import { ManifestDiagnostics } from '../src/diagnostics';
import { readCodeGraphStatus } from '../src/codegraph';
import * as capabilityModule from '../src/capabilities';
import { fingerprint } from '../src/control-ledger';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixtureStore(): ManifestStore {
  const dir = mkdtempSync(join(tmpdir(), 'temperance-manifest-'));
  dirs.push(dir);
  return new ManifestStore(join(dir, 'events.jsonl'));
}

const GUIDE_SCOPE_PATHS = [
  '.temperance/guide/capture.config.json',
  '.temperance/guide/capture.scope.json',
  '.temperance/guide/coverage-matrix.json',
  'scripts/product-guides/claim-evidence-map.json',
] as const;

const VALIDATOR_IDS = {
  capture: 'product-guides.capture-contract@1.0.0',
  coverage: 'parkarea.coverage-contract@1.0.0',
  guide: 'product-guides.validate-guide-py@1.0.0',
  film: 'product-guides.film-spec-closed@1.0.0',
} as const;

const PARKAREA_REQUIREMENTS = ['SCOPE-01', 'SCOPE-02', 'SCOPE-03', 'SCOPE-04', 'SCOPE-05', 'SCOPE-06', 'AUTH-01', 'AUTH-02', 'AUTH-03', 'CAP-01', 'CAP-02', 'CAP-03', 'CAP-04', 'CAP-05', 'CAP-06', 'CAP-07', 'CAP-08', 'CAP-09', 'DATA-02', 'DATA-03', 'DATA-04', 'DATA-05', 'GUIDE-01'];
const PARKAREA_EDITION_REQUIREMENTS = ['SCOPE-01', 'SCOPE-04', 'SCOPE-05', 'SCOPE-06', 'AUTH-02', 'AUTH-03', 'CAP-01', 'CAP-02', 'GUIDE-01'];
const PARKAREA_FORBIDDEN_EFFECTS = ['booking', 'payment', 'ledger', 'notification', 'audit', 'request_log', 'payout', 'transactional_email', 'external_provider'];
const PARKAREA_PROOF_FILE = 'server/__tests__/postgres/guide-claim-evidence.pg.test.ts';
const PARKAREA_COVERAGE_FIXTURE = [
  {
    evidenceId: 'seeker-search-results', route: '/parkplatz-suchen?lat=__W1A_LAT__&lng=__W1A_LNG__&radius_km=__W1A_RADIUS_KM__', persona: 'seeker', checkpointKind: 'seeker', minimumBodyTextChars: 250,
    requirementIds: ['SCOPE-02', 'AUTH-01', 'CAP-03', 'CAP-05', 'DATA-04'],
    claim: { de: 'Authentifizierte Suchergebnisse zeigen nicht leere Parkmöglichkeiten im freigegebenen Demo-Szenario.', en: 'Authenticated discovery shows nonempty parking results in the approved demo scenario.' },
    selectors: ['[data-testid="parkarea-app-shell"]', '[data-testid="page-parkplatz-suchen"]', '[data-testid="text-result-count"]', '[data-testid^="card-result-"]', '[data-testid^="text-result-name-"]'],
    sideEffect: { kind: 'search_analytics', status: 'blocked_pending_w1a' }, claimRoute: '/api/v1/search', claimClassification: 'isolated', claimAllowed: ['search_analytics:+1'],
    claimTestName: 'authenticated seeker search returns nonempty tenant-scoped PostGIS ordered active results',
  },
  {
    evidenceId: 'seeker-listing-readiness', route: '/parkplatz/__W1A_APPROVED_LISTING_ID__', persona: 'seeker', checkpointKind: 'seeker', minimumBodyTextChars: 400,
    requirementIds: ['CAP-04', 'CAP-06', 'CAP-07', 'DATA-03', 'DATA-05'],
    claim: { de: 'Ein aktives Inserat zeigt Verfügbarkeit, Preisangebot, Gesamtpreis und Buchungsbereitschaft ohne Buchung.', en: 'An active listing shows availability, quote, total, and booking readiness without creating a booking.' },
    selectors: ['[data-testid="parkarea-app-shell"]', '[data-testid="page-parkplatz-detail"]', '[data-testid="text-parking-name"]', '[data-testid="badge-availability"]', '[data-testid="listing-availability-summary"]', '[data-testid="card-booking"]', '[data-testid="calendar-booking"]', '[data-testid="text-total-price"]', '[data-testid="button-book-now"]', '[data-booking-readiness="settled"]'],
    sideEffect: { kind: 'listing_view_telemetry', status: 'blocked_pending_w1a' }, claimRoute: '/api/v1/listings/:id | /api/v1/listings/:id/availability-calendar | /api/v1/listings/:id/quote', claimClassification: 'isolated', claimAllowed: ['listing_view_events:view:+1'],
    claimTestName: 'active listing detail, calendar, and quote are tenant-scoped and do not create a booking',
  },
  {
    evidenceId: 'seeker-existing-bookings', route: '/dashboard?tab=bookings', persona: 'seeker', checkpointKind: 'seeker', minimumBodyTextChars: 250,
    requirementIds: ['CAP-08', 'DATA-02'],
    claim: { de: 'Die Buchungsansicht zeigt eine vorhandene mandantensichere Buchung des Suchenden.', en: 'The bookings view shows an existing tenant-safe Seeker booking.' },
    selectors: ['[data-testid="parkarea-app-shell"]', '[data-testid="dashboard-sidebar"]', '[data-testid="button-nav-bookings"]', '[data-testid="bookings-view"]', '[data-testid="input-search-bookings"]', '[data-testid^="button-booking-details-"]', '[data-recurring-bookings-state="settled"]'],
    sideEffect: { kind: 'bookings_read', status: 'read_only_pending_w1a' }, claimRoute: '/api/v1/me/bookings', claimClassification: 'read-only', claimAllowed: [],
    claimTestName: 'seeker booking history reads persisted tenant-owned bookings and excludes another tenant',
  },
  {
    evidenceId: 'admin-listing-readiness', route: '/admin/listings', persona: 'admin', checkpointKind: 'admin_read_only', minimumBodyTextChars: 300,
    requirementIds: ['SCOPE-03', 'CAP-09'],
    claim: { de: 'Der Moderationsverlauf zeigt die Freigabe desselben aktiven Inserats ohne Änderung.', en: 'Moderation history shows approval of the same active listing without changing it.' },
    selectors: ['[data-testid="parkarea-app-shell"]', '[data-testid="moderation-history-list"]', '[data-admin-evidence-state="settled"]', '[data-audit-state="settled"]', '[data-queue-state="settled"]', '[data-imports-state="settled"]', '[data-testid="moderation-history-row-__W1A_APPROVED_LISTING_ID__"][data-audit-action="listing.approve"]', '[data-testid="moderation-history-approval-label-__W1A_APPROVED_LISTING_ID__"][data-listing-id="__W1A_APPROVED_LISTING_ID__"]'],
    sideEffect: { kind: 'admin_audit_read', status: 'read_only_pending_w1a' }, claimRoute: '/api/v1/admin/listings | /api/v1/admin/audit-log', claimClassification: 'read-only', claimAllowed: [],
    claimTestName: 'admin listing readiness and persisted approval audit are readable for the same tenant without mutation',
  },
] as const;

function fixtureWrite(root: string, relativePath: string, value: string | Record<string, unknown>): void {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`);
}

function validCapture(sourceVersion = 'source-fixture-v1'): Record<string, unknown> {
  return {
    schemaVersion: 1,
    project: 'parkarea-aleph',
    sourceVersion,
    locale: 'de',
    tenant: 'authenticated_session',
    scenario: 'approved-guide-fixture',
    baseUrl: 'http://127.0.0.1:4173',
    outDir: 'evidence',
    viewport: { width: 1440, height: 900 },
    forbiddenSelectors: ['[data-testid="cookie-banner"]'],
    seed: { strategy: 'none' },
    personas: { seeker: 'seeker', admin: 'admin' },
    shots: PARKAREA_COVERAGE_FIXTURE.map((row) => ({ id: row.evidenceId, file: `${row.evidenceId}.png`, route: row.route, persona: row.persona, requiredSelectors: [...row.selectors], minimumBodyTextChars: row.minimumBodyTextChars })),
  };
}

function validCoverage(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    edition: { audience: 'internal_qa_operators', primaryPersona: 'seeker', primaryLocale: 'de', secondaryLocale: 'en', media: 'deterministic_stills', publication: 'private_only', requirementIds: [...PARKAREA_EDITION_REQUIREMENTS] },
    metadata: { freshContextPerShot: true, runnerContract: 'canonical_shared_runner_new_browser_context_per_shot' },
    requirements: [...PARKAREA_REQUIREMENTS],
    steps: PARKAREA_COVERAGE_FIXTURE.map((row, index) => ({
      order: index + 1,
      stepId: row.evidenceId,
      checkpointKind: row.checkpointKind,
      requirementIds: [...row.requirementIds],
      claim: { ...row.claim },
      route: row.route,
      persona: row.persona,
      locales: ['de', 'en'],
      tenantAuthority: 'authenticated_session',
      scenarioClass: 'synthetic_or_approved_demo',
      evidenceId: row.evidenceId,
      requiredSelectors: [...row.selectors],
      minimumBodyTextChars: row.minimumBodyTextChars,
      semanticProof: { kind: 'w1a_postgres_or_read_only_probe', status: 'pending' },
      sideEffects: [{ ...row.sideEffect }],
      admission: 'blocked',
    })),
  };
}

function validClaimMap(): Record<string, unknown> {
  return {
    schema: 'parkarea.guide.claim-evidence-map.v1',
    claims: PARKAREA_COVERAGE_FIXTURE.map((row, index) => ({ order: index + 1, evidenceId: row.evidenceId, proof: { kind: 'postgres_postgis', file: PARKAREA_PROOF_FILE, testName: row.claimTestName }, correlation: { route: row.claimRoute, persona: row.persona, tenantAuthority: 'authenticated_session' }, sideEffects: { classification: row.claimClassification, allowed: [...row.claimAllowed], forbidden: [...PARKAREA_FORBIDDEN_EFFECTS] } })),
  };
}

function writeGuideScope(root: string, sourceVersion = 'source-fixture-v1'): void {
  fixtureWrite(root, GUIDE_SCOPE_PATHS[0], validCapture(sourceVersion));
  fixtureWrite(root, GUIDE_SCOPE_PATHS[1], { schemaVersion: 1, authority: false, sourceVersion });
  fixtureWrite(root, GUIDE_SCOPE_PATHS[2], validCoverage());
  fixtureWrite(root, GUIDE_SCOPE_PATHS[3], validClaimMap());
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function scopeBindingFor(root: string, projectId: string, sourceVersion: string): { binding: Record<string, unknown>; scope_hash: string } {
  const artifacts = Object.fromEntries(GUIDE_SCOPE_PATHS.map((path) => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
  const binding = { schema: 'parkarea.guide.scope-binding.v1', project_id: projectId, source_version: sourceVersion, artifacts };
  return { binding, scope_hash: createHash('sha256').update(stableJson(binding), 'utf8').digest('hex') };
}

type ValidatorOutcome = { ok: boolean; identity: string; code?: string; stdout?: string; stderr?: string };
type ValidatorRegistry = Record<string, (input: { path: string; project_root: string }) => ValidatorOutcome | Promise<ValidatorOutcome>>;

function validatorRegistry(overrides: Partial<ValidatorRegistry> = {}): ValidatorRegistry {
  return {
    [VALIDATOR_IDS.capture]: () => ({ ok: true, identity: VALIDATOR_IDS.capture }),
    [VALIDATOR_IDS.coverage]: () => ({ ok: true, identity: VALIDATOR_IDS.coverage }),
    [VALIDATOR_IDS.guide]: () => ({ ok: true, identity: VALIDATOR_IDS.guide }),
    [VALIDATOR_IDS.film]: () => ({ ok: true, identity: VALIDATOR_IDS.film }),
    ...overrides,
  };
}

async function capabilitiesFor(root: string, options: Record<string, unknown> = {}, projectName = 'parkarea-aleph'): Promise<Record<string, any>> {
  const projectRoot = join(root, projectName);
  mkdirSync(projectRoot, { recursive: true });
  const project = initProject(projectRoot).identity;
  const projectCapabilities = capabilityModule.projectCapabilities as unknown as (
    project: ReturnType<typeof initProject>['identity'],
    route: Record<string, unknown> | undefined,
    options: Record<string, unknown>,
  ) => Record<string, any> | Promise<Record<string, any>>;
  return await projectCapabilities(project as any, undefined, {
    validatorRegistry: validatorRegistry(),
    toolAvailability: { node: true, python: true, playwright: true, ffmpeg: true },
    ...options,
  });
}

function seedGuidePlan(catalog: ManifestCatalog, projectId: string): void {
  catalog.ingest({ source: 'project-artifact', kind: 'plan.updated', status: 'observed', project_id: projectId, correlation_id: 'guide-plan', payload: { plan_id: 'guide-plan', mapping: { policy_hash: 'a'.repeat(64) }, source_fingerprints: [{ path: 'scope' }] } });
  catalog.ingest({ source: 'project-artifact', kind: 'plan.option.proposed', status: 'observed', project_id: projectId, correlation_id: 'guide-plan', payload: { plan_id: 'guide-plan', option_id: 'guide-option', combo: 'te-dispatch-paid', concurrency: 1, worktree_required: true, tasks: [{ id: 'guide' }] } });
  catalog.ingest({ source: 'project-artifact', kind: 'approval.requested', status: 'observed', project_id: projectId, correlation_id: 'guide-plan', payload: { plan_id: 'guide-plan', approval_id: 'apr-guide', status: 'required', expires_at: new Date(Date.now() + 60_000).toISOString() } });
  catalog.ingest({ source: 'manifest', kind: 'approval.granted', status: 'observed', project_id: projectId, correlation_id: 'guide-plan', payload: { plan_id: 'guide-plan', option_id: 'guide-option', approval_id: 'apr-guide', status: 'granted' } });
}

describe('manifest event plane', () => {
  test('reads CodeGraph status without reindexing or exposing command output', () => {
    const result = readCodeGraphStatus('/repo', {
      runner: () => JSON.stringify({ initialized: true, fileCount: 1394, nodeCount: 14845, edgeCount: 32764, dbSizeBytes: 35890000 }),
    });

    expect(result.available).toBe(true);
    expect(result.indexed_files).toBe(1394);
    expect(result.nodes).toBe(14845);
    expect(result.edges).toBe(32764);
    expect(result.sync_requested).toBe(false);
    expect(result).not.toHaveProperty('stdout');
  });

  test('fails open when CodeGraph is unavailable', () => {
    const result = readCodeGraphStatus('/repo', { runner: () => { throw new Error('missing codegraph'); } });

    expect(result.available).toBe(false);
    expect(result.status).toBe('unavailable');
    expect(result.sync_requested).toBe(false);
  });

  test('projects CodeGraph status as derived read-only evidence', () => {
    const store = fixtureStore();
    expect(store.ingest({
      id: 'evt-codegraph', source: 'manifest', kind: 'codegraph.status', status: 'derived', project_id: 'demo',
      payload: { project_path: '/repo', available: true, indexed_files: 10, nodes: 20, edges: 30, sync_requested: false },
    }).accepted).toBe(true);
    expect(store.state.codegraph.demo.available).toBe(true);
    expect(store.state.codegraph.demo.sync_requested).toBe(false);
  });
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

  test('exposes source-safe project lifecycle actions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-project-actions-'));
    dirs.push(root);
    const projectRoot = join(root, 'cambium');
    mkdirSync(projectRoot, { recursive: true });
    const catalog = new ManifestCatalog(join(root, 'state'));
    const server = new ManifestServer(catalog);
    const address = await server.listen(0);
    const base = `http://${address.host}:${address.port}`;

    const registered = await fetch(`${base}/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: projectRoot }) });
    expect(registered.status).toBe(201);
    const registeredBody = await registered.json() as { project: { project_id: string; visibility: string } };
    expect(registeredBody.project.visibility).toBe('active');
    const projectId = registeredBody.project.project_id;

    const actions = await fetch(`${base}/projects/${projectId}/actions`);
    expect(actions.status).toBe(200);
    expect((await actions.json() as { actions: Array<{ id: string }> }).actions.map((action) => action.id)).toContain('delete-manifest');

    const sync = await fetch(`${base}/projects/${projectId}/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codegraph: false, gsd: false, skill_clusters: false }) });
    expect(sync.status).toBe(200);
    expect((await sync.json() as { after: { event_count: number } }).after.event_count).toBeGreaterThanOrEqual(1);

    const unregister = await fetch(`${base}/projects/${projectId}/unregister`, { method: 'POST' });
    expect(unregister.status).toBe(200);
    expect((await (await fetch(`${base}/projects`)).json() as { projects: Array<{ project_id: string }> }).projects.some((project) => project.project_id === projectId)).toBe(false);
    expect((await (await fetch(`${base}/projects?include_hidden=true`)).json() as { projects: Array<{ visibility: string }> }).projects[0].visibility).toBe('unregistered');

    const rejectedDelete = await fetch(`${base}/projects/${projectId}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete_mode: 'manifest-history', confirm_project_id: 'wrong' }) });
    expect(rejectedDelete.status).toBe(409);
    const deleted = await fetch(`${base}/projects/${projectId}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete_mode: 'manifest-history', confirm_project_id: projectId }) });
    expect(deleted.status).toBe(200);
    const deletedBody = await deleted.json() as { deleted_path: string; source_preserved: boolean };
    expect(deletedBody.deleted_path).toContain('/retention/');
    expect(deletedBody.source_preserved).toBe(true);
    expect(existsSync(join(projectRoot, '.temperance', 'manifest.json'))).toBe(true);
    const resurrection = await fetch(`${base}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project_id: projectId, source: 'manifest', kind: 'should.not.resurrect', status: 'observed', payload: {} }) });
    expect(resurrection.status).toBe(400);
    const traversal = await fetch(`${base}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project_id: '../escape', source: 'manifest', kind: 'unsafe', status: 'observed', payload: {} }) });
    expect(traversal.status).toBe(400);
    await server.close();
  });

  test('exposes project-scoped Moosh capability readiness without secrets or mutation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-capabilities-'));
    dirs.push(root);
    const projectRoot = join(root, 'cambium');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ devDependencies: { playwright: '^1.0.0' } }));
    const catalog = new ManifestCatalog(join(root, 'state'));
    const project = initProject(projectRoot).identity;
    catalog.ensureProject(project);
    catalog.ingest({ source: 'omniroute', kind: 'route.health', status: 'observed', project_id: project.project_id, payload: { state: 'ready', route_id: `${project.project_id}:latest` } });
    const server = new ManifestServer(catalog);
    const address = await server.listen(0);
    const response = await fetch(`http://${address.host}:${address.port}/projects/${project.project_id}/capabilities`);
    expect(response.status).toBe(200);
    const value = await response.json() as { schema: string; project_id: string; capabilities: Array<{ id: string }>; providers: Array<Record<string, unknown>> };
    expect(value.schema).toBe('temperance.manifest.capabilities.v2');
    expect(value.project_id).toBe(project.project_id);
    expect(value.capabilities.map((item) => item.id)).toEqual(['build-product-user-guides', 'guide-to-product-video']);
    expect(value.providers.some((provider) => provider.id === 'elevenlabs')).toBe(true);
    expect(JSON.stringify(value)).not.toContain('ELEVENLABS_API_KEY');
    expect(JSON.stringify(value)).not.toContain('OMNIROUTE_API_KEY');
    expect(readFileSafe(join(projectRoot, 'package.json'))).toContain('playwright');
    await server.close();
  });

  test('projects skill clusters and workflow stages, then requires a typed canonical request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-skill-workflow-'));
    dirs.push(root);
    const projectRoot = join(root, 'cambium');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ devDependencies: { playwright: '^1.0.0' } }));
    writeFileSync(join(projectRoot, 'capture.config.json'), JSON.stringify({ schema: 'moosh.capture.v1' }));
    writeFileSync(join(projectRoot, 'film.json'), JSON.stringify({ schema: 'moosh.film.v1' }));
    const catalog = new ManifestCatalog(join(root, 'state'));
    const project = initProject(projectRoot).identity;
    catalog.ensureProject(project);
    catalog.ingest({ source: 'omniroute', kind: 'route.health', status: 'observed', project_id: project.project_id, correlation_id: `${project.project_id}:latest`, payload: { state: 'ready', route_id: `${project.project_id}:latest` } });
    const server = new ManifestServer(catalog);
    const address = await server.listen(0);
    const base = `http://${address.host}:${address.port}`;
    const initial = await fetch(`${base}/projects/${project.project_id}/workflows/product-guide-production/requests`);
    expect(initial.status).toBe(200);
    const projection = await initial.json() as { clusters: Array<{ id: string; usage: string; skills: Array<{ id: string }> }>; workflow: { stages: Array<{ id: string }> }; trigger: { eligible: boolean; blockers: string[] } };
    const resolved = projection.clusters.find((cluster) => cluster.id === 'product-guides');
    expect(resolved?.usage).toBe('resolved');
    expect(resolved?.skills.map((skill) => skill.id)).toEqual(['product-guides-orchestrator', 'product-guides-core', 'build-product-user-guides', 'guide-to-product-video']);
    expect(projection.workflow.stages.map((stage) => stage.id)).toEqual(['observe-project', 'resolve-cluster', 'prepare-guide', 'capture-evidence', 'compose-video', 'validate-report']);
    expect(projection.trigger.eligible).toBe(false);
    expect(projection.trigger.blockers.some((blocker) => blocker.includes('approval'))).toBe(true);
    const unsafe = await fetch(`${base}/projects/${project.project_id}/workflows/product-guide-production/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: 'unsafe', approval_id: 'approval-a', command: 'rm -rf .' }) });
    expect(unsafe.status).toBe(409);
    catalog.ingest({ source: 'project-artifact', kind: 'approval.granted', status: 'observed', project_id: project.project_id, payload: { approval_id: 'approval-a', plan_id: 'guide-plan', option_id: 'guide-option', status: 'granted' } });
    const request = await fetch(`${base}/projects/${project.project_id}/workflows/product-guide-production/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: 'guide-run-1', approval_id: 'approval-a' }) });
    expect(request.status).toBe(409);
    const repeated = await fetch(`${base}/projects/${project.project_id}/workflows/product-guide-production/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: 'guide-run-1', approval_id: 'approval-a' }) });
    expect(repeated.status).toBe(409);
    expect(catalog.snapshot(project.project_id).recent_events.filter((event) => event.kind === 'workflow.trigger.requested')).toHaveLength(0);
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

  test('projects GitHub planning bind and session goal into the local showcase', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-watcher-planning-'));
    dirs.push(root);
    const cwd = join(root, 'project');
    mkdirSync(join(cwd, '.temperance'), { recursive: true });
    mkdirSync(join(cwd, '.planning'), { recursive: true });
    writeFileSync(join(cwd, '.temperance', 'project.json'), JSON.stringify({
      github: 'Sheshiyer/cambium',
      planning: {
        github_project: { owner: 'Sheshiyer', repo: 'cambium', number: 14, url: 'https://github.com/users/Sheshiyer/projects/14' },
        horizons: { short: 'phase 01', long: 'milestone' },
      },
    }));
    writeFileSync(join(cwd, '.temperance', 'goal.json'), JSON.stringify({ text: 'Ship the bind', status: 'active', planner: 'isa' }));
    writeFileSync(join(cwd, '.planning', 'ROADMAP.md'), '- [x] **Phase 1: Bind** - showcase\n');
    const store = new ManifestStore(join(root, 'events.jsonl'));
    await new RuntimeWatcher(store, { home: root, cwd, intervalMs: 1, gsd: true }).sync();
    const kinds = store.state.recent_events.map((event) => event.kind);
    expect(kinds).toContain('planning.bound');
    expect(kinds).toContain('goal.updated');
    expect(kinds).toContain('workflow.gsd.artifact');
    const planning = store.state.workflows[`${Object.keys(store.state.projects)[0]}:planning`];
    expect(planning.github_project_url).toBe('https://github.com/users/Sheshiyer/projects/14');
    expect(planning.enrolled).toBe(true);
  });

  test('optionally projects read-only CodeGraph health during explicit sync', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-watcher-codegraph-'));
    dirs.push(root);
    const cwd = join(root, 'project');
    mkdirSync(cwd, { recursive: true });
    const project = initProject(cwd).identity;
    const store = new ManifestStore(join(root, 'events.jsonl'));
    const watcher = new RuntimeWatcher(store, {
      home: root, cwd, intervalMs: 1, codegraph: true,
      codegraphRunner: () => JSON.stringify({ initialized: true, fileCount: 4, nodeCount: 8, edgeCount: 12, dbSizeBytes: 1000 }),
    });
    await watcher.sync();
    expect(store.state.codegraph[project.project_id].indexed_files).toBe(4);
    expect(store.state.codegraph[project.project_id].sync_requested).toBe(false);
  });

  test('observes GSD artifacts and skill-cluster health without activating either registry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-watcher-workflows-'));
    dirs.push(root);
    const cwd = join(root, 'project');
    mkdirSync(join(cwd, '.planning'), { recursive: true });
    const project = initProject(cwd).identity;
    writeFileSync(join(cwd, '.planning', 'STATE.md'), '# GSD state\nprivate details stay out of telemetry\n');
    writeFileSync(join(cwd, '.planning', 'ROADMAP.md'), '# Roadmap\n');
    const skillIndexPath = join(root, 'skill-index.json');
    writeFileSync(skillIndexPath, JSON.stringify({ total: 804, clusters: 43, skills: { active: 517, deferred: 208, archived: 79 } }));
    const store = new ManifestStore(join(root, 'events.jsonl'));
    const watcher = new RuntimeWatcher(store, { home: root, cwd, intervalMs: 1, gsd: true, skillIndexPath });
    await watcher.sync();
    expect(store.state.workflows[project.project_id].workflow).toBe('gsd');
    expect(store.state.workflows[project.project_id].artifact_count).toBe(2);
    expect(store.state.skills[`${project.project_id}:skill-cluster-registry`].clusters).toBe(43);
    expect(readFileSafe(join(cwd, '.planning', 'STATE.md'))).toContain('private details');
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

describe('capability and workflow request v2', () => {
  test('matches the shared fixed ScopeBindingV1 vector', () => {
    const derive = (capabilityModule as Record<string, unknown>).deriveScopeBindingV1 as undefined | ((input: Record<string, unknown>) => { binding: Record<string, unknown>; scope_hash: string });
    expect(typeof derive).toBe('function');
    const artifactBytes = {
      '.temperance/guide/capture.config.json': Buffer.from('{"capture":1}\n'),
      '.temperance/guide/capture.scope.json': Buffer.from('{"scope":1}\n'),
      '.temperance/guide/coverage-matrix.json': Buffer.from('{"coverage":1}\n'),
      'scripts/product-guides/claim-evidence-map.json': Buffer.from('{"claims":1}\n'),
    };
    const result = derive!({ projectId: 'parkarea-aleph', sourceVersion: 'source-fixture-v1', artifactBytes });
    expect(result.scope_hash).toBe('e9ba11a5c46fd8a68e5db67350cc2df7e0213a581d342744bee66d0963ed47eb');
    expect(result.binding.artifacts).toEqual({
      '.temperance/guide/capture.config.json': '2a30d575c6d6cadd037e7581c166c7acd048365d7207ae6c17755ee0f79b6b0b',
      '.temperance/guide/capture.scope.json': 'c2d806d3ce7dcdc41707e796f4a8a9bfcbf265ec881a7ed802a99a0535779c1f',
      '.temperance/guide/coverage-matrix.json': '08ceaff54fd6382aa91bf19a928db493ba1e616a9937cae1ff99b92f69011bdd',
      'scripts/product-guides/claim-evidence-map.json': '80550b6fdd8a3059bdfd8effb699bff5a869df5805cf7a12e18d45f6491aae0d',
    });
    expect(() => derive!({ projectId: 'parkarea-aleph', sourceVersion: 'source-fixture-v1', artifactBytes: { ...artifactBytes, 'extra.json': Buffer.from('{}') } })).toThrow('scope_binding_incomplete');
  });

  test('reports validated guide readiness without FilmSpec, video, or voice gates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-cap-v2-guide-')); dirs.push(root);
    const projectRoot = join(root, 'parkarea-aleph');
    writeGuideScope(projectRoot);
    const value = await capabilitiesFor(root);
    expect(value.schema).toBe('temperance.manifest.capabilities.v2');
    expect(value.authority).toBe('unchecked_at_request');
    expect(value.artifacts.capture).toMatchObject({ present: true, validated: true, candidate_count: 1, state: 'validated', selected_path: '.temperance/guide/capture.config.json', validator: VALIDATOR_IDS.capture });
    expect(value.artifacts.coverage).toMatchObject({ present: true, validated: true, validator: VALIDATOR_IDS.coverage });
    expect(value.run_kinds.guide).toMatchObject({ requestable: true, state: 'ready', authority: 'unchecked_at_request' });
    expect(JSON.stringify(value.run_kinds.guide)).not.toMatch(/film|ffmpeg|voice|eleven/i);
  });

  test('validates the exact closed ParkArea semantic coverage inventory', () => {
    const validate = (capabilityModule as Record<string, unknown>).validateParkAreaCoverageContract as undefined | ((value: unknown, trusted: { capture: unknown; claimMap: unknown }) => boolean);
    const trusted = { capture: validCapture(), claimMap: validClaimMap() };
    expect(typeof validate).toBe('function');
    expect(validate!(validCoverage(), trusted)).toBe(true);

    const mutations: Array<[string, (value: Record<string, any>) => void]> = [
      ['extra top-level field', (value) => { value.extra = true; }],
      ['wrong audience', (value) => { value.edition.audience = 'customer'; }],
      ['wrong media', (value) => { value.edition.media = 'video'; }],
      ['wrong publication', (value) => { value.edition.publication = 'public'; }],
      ['unordered evidence', (value) => { value.steps.reverse(); }],
      ['mismatched step ID', (value) => { value.steps[0].stepId = 'other'; }],
      ['wrong route', (value) => { value.steps[2].route = '/other'; }],
      ['missing route sentinel', (value) => { value.steps[1].route = '/parkplatz/fixture'; }],
      ['wrong persona', (value) => { value.steps[3].persona = 'seeker'; }],
      ['wrong checkpoint', (value) => { value.steps[3].checkpointKind = 'admin'; }],
      ['broad html selector', (value) => { value.steps[0].requiredSelectors = ['html']; }],
      ['broad body selector', (value) => { value.steps[0].requiredSelectors = ['body']; }],
      ['wildcard selector', (value) => { value.steps[0].requiredSelectors = ['*']; }],
      ['empty step requirements', (value) => { value.steps[0].requirementIds = []; }],
      ['empty edition requirements', (value) => { value.edition.requirementIds = []; }],
      ['empty global requirements', (value) => { value.requirements = []; }],
      ['fabricated German claim', (value) => { value.steps[0].claim.de = 'Erfundene Behauptung.'; }],
      ['fabricated English claim', (value) => { value.steps[0].claim.en = 'Fabricated claim.'; }],
      ['locale drift', (value) => { value.steps[0].locales = ['en', 'de']; }],
      ['missing side effect', (value) => { value.steps[0].sideEffects = []; }],
      ['wrong side-effect status', (value) => { value.steps[2].sideEffects[0].status = 'read_only'; }],
      ['extra step field', (value) => { value.steps[0].command = 'project-local'; }],
    ];
    for (const [name, mutate] of mutations) {
      const candidate = JSON.parse(JSON.stringify(validCoverage())) as Record<string, any>;
      mutate(candidate);
      expect(validate!(candidate, trusted), name).toBe(false);
    }

    const broadCapture = JSON.parse(JSON.stringify(validCapture())) as Record<string, any>;
    broadCapture.shots[0].requiredSelectors = ['html'];
    expect(validate!(validCoverage(), { capture: broadCapture, claimMap: validClaimMap() }), 'capture selector drift').toBe(false);
    const claimVersionDrift = JSON.parse(JSON.stringify(validClaimMap())) as Record<string, any>;
    claimVersionDrift.schema = 'parkarea.guide.claim-evidence-map.v2';
    expect(validate!(validCoverage(), { capture: validCapture(), claimMap: claimVersionDrift }), 'claim registry version drift').toBe(false);
    const claimPersonaDrift = JSON.parse(JSON.stringify(validClaimMap())) as Record<string, any>;
    claimPersonaDrift.claims[3].correlation.persona = 'seeker';
    expect(validate!(validCoverage(), { capture: validCapture(), claimMap: claimPersonaDrift }), 'claim registry persona drift').toBe(false);
    const claimMutations: Array<[string, (value: Record<string, any>) => void]> = [
      ['claim route drift', (value) => { value.claims[0].correlation.route = '/api/v1/fabricated'; }],
      ['claim tenant authority drift', (value) => { value.claims[1].correlation.tenantAuthority = 'caller_supplied'; }],
      ['claim proof file drift', (value) => { value.claims[2].proof.file = 'server/__tests__/fake.test.ts'; }],
      ['claim proof test name drift', (value) => { value.claims[3].proof.testName = 'fabricated passing test'; }],
      ['claim proof kind drift', (value) => { value.claims[0].proof.kind = 'memory_mock'; }],
      ['claim classification drift', (value) => { value.claims[0].sideEffects.classification = 'read-only'; }],
      ['claim allowed envelope drift', (value) => { value.claims[1].sideEffects.allowed = []; }],
      ['claim forbidden envelope empty', (value) => { value.claims[0].sideEffects.forbidden = []; }],
      ['claim forbidden envelope drift', (value) => { value.claims[2].sideEffects.forbidden[0] = 'unknown'; }],
      ['claim registry extra field', (value) => { value.claims[0].trusted = true; }],
    ];
    for (const [name, mutate] of claimMutations) {
      const claimMap = JSON.parse(JSON.stringify(validClaimMap())) as Record<string, any>;
      mutate(claimMap);
      expect(validate!(validCoverage(), { capture: validCapture(), claimMap }), name).toBe(false);
    }
  });

  test('confines every ScopeBindingV1 component before reading artifact bytes', () => {
    const derive = (capabilityModule as Record<string, unknown>).scopeBindingFromProject as undefined | ((project: ReturnType<typeof initProject>['identity']) => unknown);
    expect(typeof derive).toBe('function');

    const outsideRoot = mkdtempSync(join(tmpdir(), 'temperance-scope-outside-')); dirs.push(outsideRoot);
    const outsideProject = join(outsideRoot, 'parkarea-aleph');
    writeGuideScope(outsideProject);
    fixtureWrite(outsideRoot, 'outside-claims.json', validClaimMap());
    rmSync(join(outsideProject, GUIDE_SCOPE_PATHS[3]));
    symlinkSync(join(outsideRoot, 'outside-claims.json'), join(outsideProject, GUIDE_SCOPE_PATHS[3]));
    const outsideIdentity = initProject(outsideProject).identity;
    expect(() => derive!(outsideIdentity)).toThrow('scope_artifact_unsafe');

    const componentRoot = mkdtempSync(join(tmpdir(), 'temperance-scope-component-')); dirs.push(componentRoot);
    const componentProject = join(componentRoot, 'parkarea-aleph');
    writeGuideScope(componentProject);
    fixtureWrite(componentProject, 'actual-product-guides/claim-evidence-map.json', validClaimMap());
    rmSync(join(componentProject, 'scripts', 'product-guides'), { recursive: true, force: true });
    symlinkSync(join(componentProject, 'actual-product-guides'), join(componentProject, 'scripts', 'product-guides'));
    const componentIdentity = initProject(componentProject).identity;
    expect(() => derive!(componentIdentity)).toThrow('scope_artifact_unsafe');
  });

  test('fails closed when an asynchronous trusted validator exceeds its hard deadline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-cap-v2-timeout-')); dirs.push(root);
    writeGuideScope(join(root, 'parkarea-aleph'));
    const stalled = capabilitiesFor(root, {
      validatorDeadlineMs: 25,
      validatorRegistry: validatorRegistry({ [VALIDATOR_IDS.capture]: async () => await new Promise<ValidatorOutcome>(() => {}) }),
    });
    const result = await Promise.race([stalled, new Promise<null>((resolve) => setTimeout(() => resolve(null), 150))]);
    expect(result).not.toBeNull();
    expect(result?.artifacts.capture).toMatchObject({ validated: false, state: 'invalid', reason: 'validator_timeout' });
  });

  test('fails ambiguous capture candidates before selecting a preferred path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-cap-v2-ambiguous-')); dirs.push(root);
    const projectRoot = join(root, 'parkarea-aleph');
    writeGuideScope(projectRoot);
    fixtureWrite(projectRoot, 'capture.config.json', validCapture());
    const value = await capabilitiesFor(root);
    expect(value.artifacts.capture).toMatchObject({ present: true, validated: false, candidate_count: 2, state: 'ambiguous', reason: 'artifact_ambiguous' });
    expect(value.artifacts.capture).not.toHaveProperty('selected_path');
    expect(value.run_kinds.guide.requestable).toBe(false);
  });

  test('rejects malformed capture content with the exact trusted validator identity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-cap-v2-malformed-')); dirs.push(root);
    const projectRoot = join(root, 'parkarea-aleph');
    writeGuideScope(projectRoot);
    const value = await capabilitiesFor(root, { validatorRegistry: validatorRegistry({
      [VALIDATOR_IDS.capture]: () => ({ ok: false, identity: VALIDATOR_IDS.capture, code: 'invalid_content' }),
    }) });
    expect(value.artifacts.capture).toMatchObject({ present: true, validated: false, state: 'invalid', reason: 'invalid_content', validator: VALIDATOR_IDS.capture });
  });

  test('rejects symlinked and project-root-escaping candidates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-cap-v2-symlink-')); dirs.push(root);
    const projectRoot = join(root, 'parkarea-aleph');
    mkdirSync(projectRoot, { recursive: true });
    fixtureWrite(projectRoot, GUIDE_SCOPE_PATHS[1], { schemaVersion: 1, authority: false, sourceVersion: 'source-fixture-v1' });
    fixtureWrite(projectRoot, GUIDE_SCOPE_PATHS[2], validCoverage());
    fixtureWrite(projectRoot, GUIDE_SCOPE_PATHS[3], validClaimMap());
    const outside = join(root, 'outside-capture.json');
    fixtureWrite(root, 'outside-capture.json', validCapture());
    symlinkSync(outside, join(projectRoot, 'capture.config.json'));
    const symlinked = await capabilitiesFor(root);
    expect(symlinked.artifacts.capture).toMatchObject({ validated: false, state: 'unsafe', reason: 'artifact_symlink' });

    rmSync(join(projectRoot, 'capture.config.json'));
    const outsideGuide = join(root, 'outside-guide');
    fixtureWrite(outsideGuide, 'capture.config.json', validCapture());
    mkdirSync(join(projectRoot, '.temperance'), { recursive: true });
    rmSync(join(projectRoot, '.temperance', 'guide'), { recursive: true, force: true });
    symlinkSync(outsideGuide, join(projectRoot, '.temperance', 'guide'));
    const escaped = await capabilitiesFor(root);
    expect(escaped.artifacts.capture).toMatchObject({ validated: false, state: 'unsafe', reason: 'artifact_root_escape' });
  });

  test('rejects validator identity drift, nonzero, overflow, and mutation', async () => {
    const cases: Array<[string, (input: { path: string }) => ValidatorOutcome, string]> = [
      ['identity', () => ({ ok: true, identity: 'project-local@9.9.9' }), 'validator_identity_mismatch'],
      ['nonzero', () => ({ ok: false, identity: VALIDATOR_IDS.capture, code: 'validator_nonzero' }), 'validator_nonzero'],
      ['overflow', () => ({ ok: false, identity: VALIDATOR_IDS.capture, code: 'validator_output_overflow', stdout: 'x'.repeat(9000) }), 'validator_output_overflow'],
      ['mutation', ({ path }) => { writeFileSync(path, '{}'); return { ok: true, identity: VALIDATOR_IDS.capture }; }, 'validator_mutated'],
    ];
    for (const [name, validate, expected] of cases) {
      const root = mkdtempSync(join(tmpdir(), `temperance-cap-v2-${name}-`)); dirs.push(root);
      const projectRoot = join(root, 'parkarea-aleph');
      writeGuideScope(projectRoot);
      const value = await capabilitiesFor(root, { validatorRegistry: validatorRegistry({ [VALIDATOR_IDS.capture]: validate as ValidatorRegistry[string] }) });
      expect(value.artifacts.capture.reason).toBe(expected);
      expect(value.artifacts.capture.validated).toBe(false);
    }
  });

  test('never executes a project-local validator command during capability GET', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-cap-v2-no-project-exec-')); dirs.push(root);
    const projectRoot = join(root, 'parkarea-aleph');
    writeGuideScope(projectRoot);
    fixtureWrite(projectRoot, '.temperance/guide/validate.js', `require('fs').writeFileSync(${JSON.stringify(join(root, 'executed'))}, 'bad')`);
    const value = await capabilitiesFor(root);
    expect(value.run_kinds.guide.requestable).toBe(true);
    expect(existsSync(join(root, 'executed'))).toBe(false);
  });

  test('keeps ParkArea video out of scope while generic video uses distinct validated inventory and FilmSpec', async () => {
    const parkRoot = mkdtempSync(join(tmpdir(), 'temperance-cap-v2-park-video-')); dirs.push(parkRoot);
    writeGuideScope(join(parkRoot, 'parkarea-aleph'));
    fixtureWrite(join(parkRoot, 'parkarea-aleph'), '.temperance/guide/guide.manifest.json', { schema: 'product-guide.manifest.v1' });
    fixtureWrite(join(parkRoot, 'parkarea-aleph'), '.temperance/guide/film.json', { schema: 'product-guide.film-spec.v1' });
    const park = await capabilitiesFor(parkRoot);
    expect(park.run_kinds.video).toMatchObject({ requestable: false, state: 'out_of_scope' });

    const genericRoot = mkdtempSync(join(tmpdir(), 'temperance-cap-v2-generic-video-')); dirs.push(genericRoot);
    const genericProject = join(genericRoot, 'generic-product');
    writeGuideScope(genericProject);
    fixtureWrite(genericProject, '.temperance/guide/guide.manifest.json', { schema: 'product-guide.manifest.v1' });
    fixtureWrite(genericProject, '.temperance/guide/film.json', { schema: 'product-guide.film-spec.v1' });
    const generic = await capabilitiesFor(genericRoot, {}, 'generic-product');
    expect(generic.artifacts.guide_manifest.validator).toBe(VALIDATOR_IDS.guide);
    expect(generic.artifacts.film_spec.validator).toBe(VALIDATOR_IDS.film);
    expect(generic.run_kinds.video).toMatchObject({ requestable: true, state: 'ready', authority: 'unchecked_at_request' });
  });

  test('derives the grant scope from exact bytes before recording canonical approval', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-grant-v2-')); dirs.push(root);
    const projectRoot = join(root, 'parkarea-aleph');
    writeGuideScope(projectRoot);
    Bun.spawnSync(['git', 'init', '--quiet', projectRoot]);
    Bun.spawnSync(['git', '-C', projectRoot, 'config', 'user.email', 'manifest-tests@invalid.example']);
    Bun.spawnSync(['git', '-C', projectRoot, 'config', 'user.name', 'Manifest Tests']);
    Bun.spawnSync(['git', '-C', projectRoot, 'add', ...GUIDE_SCOPE_PATHS]);
    Bun.spawnSync(['git', '-C', projectRoot, 'commit', '--quiet', '-m', 'fixture']);
    const catalog = new ManifestCatalog(join(root, 'state'));
    const project = initProject(projectRoot).identity;
    catalog.ensureProject(project);
    seedGuidePlan(catalog, project.project_id);
    const recorded: Record<string, unknown>[] = [];
    const ledger = { migrate: async () => {}, close: async () => {}, recordApproval: async (value: Record<string, unknown>) => { recorded.push(value); }, attest: async () => ({ schema: 'temperance.approval-attestation.response.v1', ok: true, code: 'attested' }) };
    const Server = ManifestServer as unknown as new (store: ManifestCatalog, dependencies: Record<string, unknown>) => ManifestServer;
    const server = new Server(catalog, { controlLedger: ledger, capabilityOptions: { validatorRegistry: validatorRegistry() } });
    const address = await server.listen(0);
    const response = await fetch(`http://${address.host}:${address.port}/approvals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project_id: project.project_id, plan_id: 'guide-plan', option_id: 'guide-option', approval_id: 'apr-guide' }) });
    expect(response.status).toBe(201);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].scope_hash).toBe(scopeBindingFor(projectRoot, project.project_id, 'source-fixture-v1').scope_hash);
    await server.close();
  });

  test('bounds approval scope failures without returning paths or approval identifiers', async () => {
    const mutations: Array<[string, (root: string, projectRoot: string) => void]> = [
      ['missing', (_root, projectRoot) => { rmSync(join(projectRoot, GUIDE_SCOPE_PATHS[3])); }],
      ['symlink', (root, projectRoot) => { fixtureWrite(root, 'outside-claims.json', validClaimMap()); rmSync(join(projectRoot, GUIDE_SCOPE_PATHS[3])); symlinkSync(join(root, 'outside-claims.json'), join(projectRoot, GUIDE_SCOPE_PATHS[3])); }],
      ['component-escape', (root, projectRoot) => { const outside = join(root, 'outside-guides'); fixtureWrite(outside, 'claim-evidence-map.json', validClaimMap()); rmSync(join(projectRoot, 'scripts', 'product-guides'), { recursive: true, force: true }); symlinkSync(outside, join(projectRoot, 'scripts', 'product-guides')); }],
    ];
    for (const [name, mutate] of mutations) {
      const root = mkdtempSync(join(tmpdir(), `temperance-approval-redaction-${name}-`)); dirs.push(root);
      const projectRoot = join(root, 'parkarea-aleph'); writeGuideScope(projectRoot);
      Bun.spawnSync(['git', 'init', '--quiet', projectRoot]);
      Bun.spawnSync(['git', '-C', projectRoot, 'config', 'user.email', 'manifest-tests@invalid.example']);
      Bun.spawnSync(['git', '-C', projectRoot, 'config', 'user.name', 'Manifest Tests']);
      Bun.spawnSync(['git', '-C', projectRoot, 'add', ...GUIDE_SCOPE_PATHS]);
      Bun.spawnSync(['git', '-C', projectRoot, 'commit', '--quiet', '-m', 'fixture']);
      const catalog = new ManifestCatalog(join(root, 'state'));
      const project = initProject(projectRoot).identity; catalog.ensureProject(project); seedGuidePlan(catalog, project.project_id);
      mutate(root, projectRoot);
      let records = 0;
      const ledger = { migrate: async () => {}, close: async () => {}, attest: async () => ({ schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'approval_not_found' }), recordApproval: async () => { records += 1; } };
      const Server = ManifestServer as unknown as new (store: ManifestCatalog, dependencies: Record<string, unknown>) => ManifestServer;
      const server = new Server(catalog, { controlLedger: ledger }); const address = await server.listen(0);
      const approvalId = 'apr-guide';
      const response = await fetch(`http://${address.host}:${address.port}/approvals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project_id: project.project_id, plan_id: 'guide-plan', option_id: 'guide-option', approval_id: approvalId }) });
      const text = await response.text(); await server.close();
      expect(response.status).toBe(409);
      expect(JSON.parse(text)).toEqual({ accepted: false, code: 'approval_scope_unavailable' });
      expect(text).not.toContain(root); expect(text).not.toContain(projectRoot); expect(text).not.toContain(approvalId); expect(text).not.toMatch(/ENOENT|symlink|driver|scope_artifact/i);
      expect(records).toBe(0);
    }
  });

  test('bounds approval persistence errors without returning driver internals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-approval-driver-redaction-')); dirs.push(root);
    const projectRoot = join(root, 'parkarea-aleph'); writeGuideScope(projectRoot);
    Bun.spawnSync(['git', 'init', '--quiet', projectRoot]);
    Bun.spawnSync(['git', '-C', projectRoot, 'config', 'user.email', 'manifest-tests@invalid.example']);
    Bun.spawnSync(['git', '-C', projectRoot, 'config', 'user.name', 'Manifest Tests']);
    Bun.spawnSync(['git', '-C', projectRoot, 'add', ...GUIDE_SCOPE_PATHS]); Bun.spawnSync(['git', '-C', projectRoot, 'commit', '--quiet', '-m', 'fixture']);
    const catalog = new ManifestCatalog(join(root, 'state')); const project = initProject(projectRoot).identity; catalog.ensureProject(project); seedGuidePlan(catalog, project.project_id);
    const ledger = { migrate: async () => {}, close: async () => {}, attest: async () => ({ schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'approval_not_found' }), recordApproval: async () => { throw new Error(`driver failed at ${projectRoot} for apr-guide`); } };
    const Server = ManifestServer as unknown as new (store: ManifestCatalog, dependencies: Record<string, unknown>) => ManifestServer;
    const server = new Server(catalog, { controlLedger: ledger }); const address = await server.listen(0);
    const response = await fetch(`http://${address.host}:${address.port}/approvals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project_id: project.project_id, plan_id: 'guide-plan', option_id: 'guide-option', approval_id: 'apr-guide' }) });
    const text = await response.text(); await server.close();
    expect(response.status).toBe(409); expect(JSON.parse(text)).toEqual({ accepted: false, code: 'approval_request_failed' });
    expect(text).not.toContain(projectRoot); expect(text).not.toContain('apr-guide'); expect(text).not.toContain('driver failed');
  });

  test('serves bounded non-mutating attestation through the injected ledger', async () => {
    const store = fixtureStore();
    const calls: unknown[] = [];
    const ledger = { migrate: async () => {}, close: async () => {}, attest: async (value: unknown, approvalId: string) => { calls.push([value, approvalId]); return { schema: 'temperance.approval-attestation.response.v1', ok: true, code: 'attested', approval_id: approvalId, attested_at: '2026-08-20T00:00:00.000Z', attestation_id: 'att_fixture' }; } };
    const Server = ManifestServer as unknown as new (store: ManifestStore, dependencies: Record<string, unknown>) => ManifestServer;
    const server = new Server(store, { controlLedger: ledger });
    const address = await server.listen(0);
    const request = { schema: 'temperance.approval-attestation.request.v1', approval_id: 'apr-guide', project_id: 'parkarea', project_cwd: '/fixture', plan_id: 'plan', option_id: 'guide', policy_hash: 'a'.repeat(64), git_head: 'b'.repeat(64), source_fingerprint: 'c'.repeat(64), task_fingerprint: 'd'.repeat(64), scope_hash: 'e'.repeat(64) };
    const response = await fetch(`http://${address.host}:${address.port}/control/approvals/apr-guide/attestation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    const result = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(result.code).toBe('attested');
    expect(result).not.toHaveProperty('canonical');
    await server.close();
  });

  test('reattests current bindings last and appends one sanitized request-only receipt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-request-v2-')); dirs.push(root);
    const projectRoot = join(root, 'parkarea-aleph');
    writeGuideScope(projectRoot);
    fixtureWrite(projectRoot, 'package.json', { devDependencies: { playwright: '^1.0.0' } });
    Bun.spawnSync(['git', 'init', '--quiet', projectRoot]);
    Bun.spawnSync(['git', '-C', projectRoot, 'config', 'user.email', 'manifest-tests@invalid.example']);
    Bun.spawnSync(['git', '-C', projectRoot, 'config', 'user.name', 'Manifest Tests']);
    Bun.spawnSync(['git', '-C', projectRoot, 'add', ...GUIDE_SCOPE_PATHS, 'package.json']);
    Bun.spawnSync(['git', '-C', projectRoot, 'commit', '--quiet', '-m', 'fixture']);
    const gitHead = Bun.spawnSync(['git', '-C', projectRoot, 'rev-parse', 'HEAD']).stdout.toString().trim();
    const catalog = new ManifestCatalog(join(root, 'state'));
    const project = initProject(projectRoot).identity;
    catalog.ensureProject(project);
    seedGuidePlan(catalog, project.project_id);
    const scope = scopeBindingFor(projectRoot, project.project_id, 'source-fixture-v1');
    const calls: Array<Record<string, unknown>> = [];
    const ledger = {
      migrate: async () => {}, close: async () => {},
      attest: async (value: Record<string, unknown>) => {
        expect(catalog.snapshot(project.project_id).recent_events.filter((event) => event.kind === 'workflow.trigger.requested')).toHaveLength(calls.length === 0 ? 0 : 1);
        calls.push(value);
        return { schema: 'temperance.approval-attestation.response.v1', ok: true, code: 'attested', approval_id: 'apr-guide', attested_at: '2026-08-20T00:00:00.000Z', attestation_id: 'att_fixture' };
      },
    };
    const Server = ManifestServer as unknown as new (store: ManifestCatalog, dependencies: Record<string, unknown>) => ManifestServer;
    const server = new Server(catalog, { controlLedger: ledger, capabilityOptions: { validatorRegistry: validatorRegistry(), toolAvailability: { node: true, python: true, playwright: true, ffmpeg: false } } });
    const address = await server.listen(0);
    const base = `http://${address.host}:${address.port}`;
    const request = {
      schema: 'temperance.manifest.workflow-request.v2', request_id: 'guide-run-1', approval_id: 'apr-guide', run_kind: 'guide',
      plan_id: 'guide-plan', option_id: 'guide-option', policy_hash: 'a'.repeat(64), git_head: gitHead,
      source_fingerprint: fingerprint([{ path: 'scope' }]), task_fingerprint: fingerprint([{ id: 'guide' }]), scope_hash: scope.scope_hash,
    };
    const unsafe = await fetch(`${base}/projects/${project.project_id}/workflows/product-guide-production/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, command: 'project-local-script' }) });
    expect(unsafe.status).toBe(409);
    expect((await unsafe.json() as Record<string, unknown>).code).toBe('invalid_request');
    const response = await fetch(`${base}/projects/${project.project_id}/workflows/product-guide-production/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    expect(response.status).toBe(201);
    const repeated = await fetch(`${base}/projects/${project.project_id}/workflows/product-guide-production/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    expect(repeated.status).toBe(200);
    expect(calls).toHaveLength(2);
    const conflicts = [
      { approval_id: 'apr-conflict' }, { run_kind: 'video' }, { plan_id: 'other-plan' }, { option_id: 'other-option' },
      { policy_hash: 'b'.repeat(64) }, { git_head: 'b'.repeat(40) }, { source_fingerprint: 'b'.repeat(64) },
      { task_fingerprint: 'b'.repeat(64) }, { scope_hash: 'b'.repeat(64) },
    ];
    for (const mutation of conflicts) {
      const conflict = await fetch(`${base}/projects/${project.project_id}/workflows/product-guide-production/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, ...mutation }) });
      expect(conflict.status).toBe(409);
      expect((await conflict.json() as Record<string, unknown>).code).toBe('request_id_conflict');
    }
    expect(calls).toHaveLength(2);
    const events = catalog.snapshot(project.project_id).recent_events.filter((event) => event.kind === 'workflow.trigger.requested');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ schema: 'temperance.manifest.workflow-request.receipt.v2', run_kind: 'guide', request_only: true, executed: false });
    expect(events[0].payload.request_hash).toMatch(/^[a-f0-9]{64}$/);
    for (const forbidden of ['project_cwd', 'policy_hash', 'git_head', 'source_fingerprint', 'task_fingerprint', 'approval_id']) expect(events[0].payload).not.toHaveProperty(forbidden);
    await server.close();
  });

  test('returns stable workflow errors and templates diagnostic routes without identifiers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-request-v2-redaction-')); dirs.push(root);
    const projectRoot = join(root, 'parkarea-aleph');
    writeGuideScope(projectRoot);
    fixtureWrite(projectRoot, 'package.json', { devDependencies: { playwright: '^1.0.0' } });
    Bun.spawnSync(['git', 'init', '--quiet', projectRoot]);
    Bun.spawnSync(['git', '-C', projectRoot, 'config', 'user.email', 'manifest-tests@invalid.example']);
    Bun.spawnSync(['git', '-C', projectRoot, 'config', 'user.name', 'Manifest Tests']);
    Bun.spawnSync(['git', '-C', projectRoot, 'add', ...GUIDE_SCOPE_PATHS, 'package.json']);
    Bun.spawnSync(['git', '-C', projectRoot, 'commit', '--quiet', '-m', 'fixture']);
    const gitHead = Bun.spawnSync(['git', '-C', projectRoot, 'rev-parse', 'HEAD']).stdout.toString().trim();
    const catalog = new ManifestCatalog(join(root, 'state'));
    const project = initProject(projectRoot).identity;
    catalog.ensureProject(project); seedGuidePlan(catalog, project.project_id);
    const scope = scopeBindingFor(projectRoot, project.project_id, 'source-fixture-v1');
    rmSync(join(projectRoot, GUIDE_SCOPE_PATHS[3]));
    const paths: string[] = [];
    const diagnostics = { request: (input: { path?: string }) => { if (input.path) paths.push(input.path); } };
    const ledger = { migrate: async () => {}, close: async () => {}, attest: async () => ({ schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'approval_not_found' }) };
    const Server = ManifestServer as unknown as new (store: ManifestCatalog, dependencies: Record<string, unknown>) => ManifestServer;
    const server = new Server(catalog, { controlLedger: ledger, diagnostics, capabilityOptions: { validatorRegistry: validatorRegistry(), toolAvailability: { node: true, python: true, playwright: true, ffmpeg: false } } });
    const address = await server.listen(0);
    const base = `http://${address.host}:${address.port}`;
    const request = { schema: 'temperance.manifest.workflow-request.v2', request_id: 'redacted-run', approval_id: 'apr-secret-value', run_kind: 'guide', plan_id: 'guide-plan', option_id: 'guide-option', policy_hash: 'a'.repeat(64), git_head: gitHead, source_fingerprint: fingerprint([{ path: 'scope' }]), task_fingerprint: fingerprint([{ id: 'guide' }]), scope_hash: scope.scope_hash };
    const response = await fetch(`${base}/projects/${project.project_id}/workflows/product-guide-production/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    const resultText = await response.text();
    await fetch(`${base}/control/approvals/apr-secret-value/attestation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await server.close();
    expect(response.status).toBe(409);
    expect(JSON.parse(resultText).code).toBe('scope_binding_unavailable');
    expect(resultText).not.toContain(projectRoot);
    expect(resultText).not.toContain('apr-secret-value');
    expect(paths).toContain('/projects/:project_id/workflows/:workflow_id/requests');
    expect(paths).toContain('/control/approvals/:approval_id/attestation');
    expect(JSON.stringify(paths)).not.toContain(project.project_id);
    expect(JSON.stringify(paths)).not.toContain('apr-secret-value');
  });

  test('denies missing or unknown run kinds without calling authority or recording a request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'temperance-request-v2-kind-')); dirs.push(root);
    const projectRoot = join(root, 'parkarea-aleph');
    writeGuideScope(projectRoot);
    const catalog = new ManifestCatalog(join(root, 'state'));
    const project = initProject(projectRoot).identity;
    catalog.ensureProject(project);
    seedGuidePlan(catalog, project.project_id);
    let attestations = 0;
    const ledger = { migrate: async () => {}, close: async () => {}, attest: async () => { attestations += 1; return { schema: 'temperance.approval-attestation.response.v1', ok: true, code: 'attested' }; } };
    const Server = ManifestServer as unknown as new (store: ManifestCatalog, dependencies: Record<string, unknown>) => ManifestServer;
    const server = new Server(catalog, { controlLedger: ledger, capabilityOptions: { validatorRegistry: validatorRegistry() } });
    const address = await server.listen(0);
    const endpoint = `http://${address.host}:${address.port}/projects/${project.project_id}/workflows/product-guide-production/requests`;
    for (const runKind of [undefined, 'other', 'video']) {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schema: 'temperance.manifest.workflow-request.v2', request_id: `deny-${String(runKind)}`, approval_id: 'apr-guide', ...(runKind === undefined ? {} : { run_kind: runKind }) }) });
      expect(response.status).toBe(409);
      expect((await response.json() as Record<string, unknown>).code).toBe(runKind === 'video' ? 'run_kind_out_of_scope' : 'invalid_run_kind');
    }
    expect(attestations).toBe(0);
    expect(catalog.snapshot(project.project_id).recent_events.filter((event) => event.kind === 'workflow.trigger.requested')).toHaveLength(0);
    await server.close();
  });

  test('records no request when canonical attestation denies drift, expiry, or revocation', async () => {
    for (const code of ['binding_mismatch', 'approval_expired', 'approval_revoked']) {
      const root = mkdtempSync(join(tmpdir(), `temperance-request-v2-${code}-`)); dirs.push(root);
      const projectRoot = join(root, 'parkarea-aleph');
      writeGuideScope(projectRoot);
      fixtureWrite(projectRoot, 'package.json', { devDependencies: { playwright: '^1.0.0' } });
      Bun.spawnSync(['git', 'init', '--quiet', projectRoot]);
      Bun.spawnSync(['git', '-C', projectRoot, 'config', 'user.email', 'manifest-tests@invalid.example']);
      Bun.spawnSync(['git', '-C', projectRoot, 'config', 'user.name', 'Manifest Tests']);
      Bun.spawnSync(['git', '-C', projectRoot, 'add', ...GUIDE_SCOPE_PATHS, 'package.json']);
      Bun.spawnSync(['git', '-C', projectRoot, 'commit', '--quiet', '-m', 'fixture']);
      const gitHead = Bun.spawnSync(['git', '-C', projectRoot, 'rev-parse', 'HEAD']).stdout.toString().trim();
      const catalog = new ManifestCatalog(join(root, 'state'));
      const project = initProject(projectRoot).identity;
      catalog.ensureProject(project); seedGuidePlan(catalog, project.project_id);
      const scope = scopeBindingFor(projectRoot, project.project_id, 'source-fixture-v1');
      let attestations = 0;
      const ledger = { migrate: async () => {}, close: async () => {}, attest: async () => { attestations += 1; return { schema: 'temperance.approval-attestation.response.v1', ok: false, code }; } };
      const Server = ManifestServer as unknown as new (store: ManifestCatalog, dependencies: Record<string, unknown>) => ManifestServer;
      const server = new Server(catalog, { controlLedger: ledger, capabilityOptions: { validatorRegistry: validatorRegistry(), toolAvailability: { node: true, python: true, playwright: true, ffmpeg: false } } });
      const address = await server.listen(0);
      const request = { schema: 'temperance.manifest.workflow-request.v2', request_id: `deny-${code}`, approval_id: 'apr-guide', run_kind: 'guide', plan_id: 'guide-plan', option_id: 'guide-option', policy_hash: 'a'.repeat(64), git_head: gitHead, source_fingerprint: fingerprint([{ path: 'scope' }]), task_fingerprint: fingerprint([{ id: 'guide' }]), scope_hash: scope.scope_hash };
      const response = await fetch(`http://${address.host}:${address.port}/projects/${project.project_id}/workflows/product-guide-production/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      expect(response.status).toBe(409);
      expect(attestations).toBe(1);
      expect(catalog.snapshot(project.project_id).recent_events.filter((event) => event.kind === 'workflow.trigger.requested')).toHaveLength(0);
      await server.close();
    }
  });
});

describe('pai mode offer', () => {
  test('skips the picker when a /gsd command already bound a mode', () => {
    const text = formatPaiModeOffer({ bound: 'ALGORITHM', surface: 'grok' });
    expect(text).toContain('already bound');
    expect(text).toContain('/gsd:* map');
    expect(text).not.toContain('call the native tool');
    expect(text).toContain('Grok has no ChatGPT in-app browser');
  });

  test('skips the picker when the classifier already chose ALGORITHM', () => {
    const text = formatPaiModeOffer({ classifier: 'ALGORITHM', surface: 'codex' });
    expect(text).toContain('classifier auto');
    expect(text).toContain('in-app browser');
    expect(text).not.toContain('Which PAI path');
  });

  test('on Grok names ask_user_question and forbids a chat-reply quiz', () => {
    const text = formatPaiModeOffer({ surface: 'grok' });
    expect(text).toContain('ask_user_question');
    expect(text).toContain('not a NOESIS bullet list');
    expect(text).toContain('A reply is not a picker');
  });

  test('session pick wins over a later classifier and still skips the card', () => {
    const text = formatPaiModeOffer({ chosen: 'NATIVE', classifier: 'ALGORITHM', surface: 'grok' });
    expect(text).toContain('session pick');
    expect(text).toContain('NATIVE');
    expect(text).not.toContain('call the native tool');
  });
});

function readFileSafe(path: string): string {
  return readFileSync(path, 'utf8');
}
