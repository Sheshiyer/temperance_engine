import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ManifestCatalog, type ProjectVisibility } from './catalog';
import { ATTESTATION_REQUEST_SCHEMA, SwarmControlLedger, fingerprint, type ApprovalAttestationRequestV1, type ClaimRequest } from './control-ledger';
import { LEGACY_PROJECT_ID, identityForCwd, initProject, readProjectIdentity } from './project';
import { ManifestStore } from './store';
import { ManifestDiagnostics } from './diagnostics';
import { RuntimeWatcher } from './watcher';
import { projectCapabilities, scopeBindingFromProject, type CapabilityOptions } from './capabilities';
import { PRODUCT_GUIDE_WORKFLOW_ID, projectSkillWorkflow } from './workflow-projection';
import type { ManifestEvent, ManifestState } from './types';

const MAX_BODY = 1_000_000;
const DEFAULT_CONSOLE_URL = 'http://127.0.0.1:5173';
const WORKFLOW_REQUEST_SCHEMA = 'temperance.manifest.workflow-request.v2';
const WORKFLOW_REQUEST_KEYS = ['approval_id', 'git_head', 'option_id', 'plan_id', 'policy_hash', 'request_id', 'run_kind', 'schema', 'scope_hash', 'source_fingerprint', 'task_fingerprint'] as const;
const BOUNDED_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const LOWER_SHA256 = /^[a-f0-9]{64}$/;
const GIT_OBJECT_ID = /^[a-f0-9]{40,64}$/;

type ControlLedger = Pick<SwarmControlLedger, 'migrate' | 'close' | 'attest'> & Partial<Pick<SwarmControlLedger, 'recordApproval' | 'claim'>>;
type DiagnosticSink = Pick<ManifestDiagnostics, 'request'> & Partial<Pick<ManifestDiagnostics, 'event'>>;
interface ManifestServerDependencies { controlLedger?: ControlLedger | null; capabilityOptions?: CapabilityOptions; diagnostics?: DiagnosticSink }

function headers(contentType: string): Record<string, string> {
  return { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'http://127.0.0.1:5173', 'Access-Control-Allow-Headers': 'Content-Type' };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, headers('application/json; charset=utf-8'));
  res.end(JSON.stringify(body));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function closedRequestHash(request: Record<string, unknown>): string {
  const closed = Object.fromEntries(WORKFLOW_REQUEST_KEYS.map((key) => [key, request[key]]));
  return createHash('sha256').update(stableJson(closed), 'utf8').digest('hex');
}

function diagnosticRoute(pathname: string): string {
  if (/^\/control\/approvals\/[^/]+\/attestation$/.test(pathname)) return '/control/approvals/:approval_id/attestation';
  if (/^\/projects\/[^/]+\/workflows\/[^/]+\/requests$/.test(pathname)) return '/projects/:project_id/workflows/:workflow_id/requests';
  if (/^\/projects\/[^/]+\/capabilities$/.test(pathname)) return '/projects/:project_id/capabilities';
  if (/^\/projects\/[^/]+\/actions$/.test(pathname)) return '/projects/:project_id/actions';
  if (/^\/projects\/[^/]+\/(sync|archive|unregister)$/.test(pathname)) return '/projects/:project_id/:action';
  if (/^\/projects\/[^/]+$/.test(pathname)) return '/projects/:project_id';
  return pathname;
}

async function body(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += String(chunk);
      if (data.length > MAX_BODY) reject(new Error('request body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export class ManifestServer {
  private readonly diagnostics: DiagnosticSink;
  private server = createServer((req, res) => {
    const started = Date.now();
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    res.once('finish', () => this.diagnostics.request({ method: req.method, path: diagnosticRoute(url.pathname), status: res.statusCode, duration_ms: Date.now() - started }));
    void this.handle(req, res);
  });
  private clients = new Map<ServerResponse, string | undefined>();
  private unsubscribe: (() => void) | null = null;
  private readonly controlLedger: ControlLedger | null;
  private readonly capabilityOptions: CapabilityOptions;

  constructor(private readonly store: ManifestStore | ManifestCatalog, dependencies: ManifestServerDependencies = {}) {
    this.diagnostics = dependencies.diagnostics || new ManifestDiagnostics();
    this.controlLedger = Object.prototype.hasOwnProperty.call(dependencies, 'controlLedger')
      ? dependencies.controlLedger || null
      : process.env.TEMPERANCE_SWARM_CONTROL_ENABLED === '1' && process.env.TEMPERANCE_CONTROL_DATABASE_URL ? SwarmControlLedger.fromUrl() : null;
    this.capabilityOptions = dependencies.capabilityOptions || {};
    this.unsubscribe = store.subscribe((event) => {
      const packet = `event: manifest\ndata: ${JSON.stringify(event)}\n\n`;
      const eventProject = event.project_id || LEGACY_PROJECT_ID;
      for (const [client, projectId] of this.clients) {
        if (projectId && projectId !== eventProject) continue;
        try { client.write(packet); } catch { this.clients.delete(client); }
      }
    });
  }

  async listen(port = 8766, host = '127.0.0.1'): Promise<{ port: number; host: string }> {
    await this.controlLedger?.migrate();
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => resolve());
    });
    const address = this.server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    return { port: actualPort, host };
  }

  async close(): Promise<void> {
    this.unsubscribe?.();
    for (const client of this.clients.keys()) client.end();
    this.clients.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await this.controlLedger?.close();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'OPTIONS') { res.writeHead(204, headers('text/plain')); res.end(); return; }
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/') {
      // The bridge is an API/SSE plane. A browser address should lead to the
      // visual operator console rather than an opaque JSON 404.
      res.writeHead(302, { ...headers('text/plain; charset=utf-8'), Location: process.env.TEMPERANCE_MANIFEST_CONSOLE_URL || DEFAULT_CONSOLE_URL });
      res.end(req.method === 'HEAD' ? undefined : 'Manifest console');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      const snapshot = this.store.state;
      json(res, 200, { ok: true, service: 'temperance-manifest-bridge', ...snapshot.freshness, event_count: snapshot.event_count });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/projects') {
      const projects = 'listVisibleProjects' in this.store ? this.store.listVisibleProjects(url.searchParams.get('include_hidden') === 'true') : [];
      json(res, 200, { projects });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/projects') {
      try {
        if (!('ensureProject' in this.store)) throw new Error('project registry is unavailable');
        const request = JSON.parse(await body(req)) as Record<string, unknown>;
        const cwd = typeof request.cwd === 'string' ? request.cwd.trim() : '';
        if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('cwd must be an existing directory');
        const expected = identityForCwd(cwd);
        const existing = readProjectIdentity(cwd);
        if (existing && existing.project_id !== expected.project_id) throw new Error(`project manifest identity does not match canonical cwd: expected ${expected.project_id}`);
        const result = initProject(cwd);
        const project = this.store.ensureProject(result.identity, { reactivate: true });
        json(res, 201, { action: 'register', created: result.created, project, manifest_path: result.path });
      } catch (error) { json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    const capabilityMatch = /^\/projects\/([^/]+)\/capabilities$/.exec(url.pathname);
    if (req.method === 'GET' && capabilityMatch) {
      try {
        if (!('project' in this.store)) throw new Error('project registry is unavailable');
        const projectId = decodeURIComponent(capabilityMatch[1]);
        const project = this.store.project(projectId, true);
        if (!project) { json(res, 404, { error: 'project_not_found' }); return; }
        const snapshot = this.snapshot(projectId);
        const route = Object.values(snapshot.routes).find((value) => value.project_id === projectId || value.route_id === `${projectId}:latest`);
        json(res, 200, await projectCapabilities(project, route, this.capabilityOptions));
      } catch { json(res, 400, { ok: false, code: 'capability_unavailable' }); }
      return;
    }
    const workflowMatch = /^\/projects\/([^/]+)\/workflows\/([^/]+)\/requests$/.exec(url.pathname);
    if (workflowMatch && (req.method === 'GET' || req.method === 'POST')) {
      try {
        if (!('project' in this.store)) throw new Error('project registry is unavailable');
        const projectId = decodeURIComponent(workflowMatch[1]);
        const workflowId = decodeURIComponent(workflowMatch[2]);
        if (workflowId !== PRODUCT_GUIDE_WORKFLOW_ID) { json(res, 404, { error: 'workflow_not_found' }); return; }
        const project = this.store.project(projectId, true);
        if (!project) { json(res, 404, { error: 'project_not_found' }); return; }
        const snapshot = this.snapshot(projectId);
        const route = Object.values(snapshot.routes).find((value) => value.project_id === projectId || value.route_id === `${projectId}:latest`);
        const capabilities = await projectCapabilities(project, route, this.capabilityOptions);
        const projection = projectSkillWorkflow(project, snapshot, capabilities);
        if (req.method === 'GET') { json(res, 200, projection); return; }
        const request = JSON.parse((await body(req)) || '{}') as Record<string, unknown>;
        const requestId = typeof request.request_id === 'string' ? request.request_id.trim() : '';
        const approvalId = typeof request.approval_id === 'string' ? request.approval_id.trim() : '';
        const runKind = request.run_kind;
        if (request.schema !== WORKFLOW_REQUEST_SCHEMA || (runKind !== 'guide' && runKind !== 'video')) { json(res, 409, { accepted: false, code: 'invalid_run_kind' }); return; }
        const existing = snapshot.recent_events.find((event) => event.kind === 'workflow.trigger.requested' && event.project_id === projectId && event.payload.request_id === requestId);
        if (!existing && runKind === 'video' && capabilities.run_kinds.video.state === 'out_of_scope') { json(res, 409, { accepted: false, code: 'run_kind_out_of_scope' }); return; }
        const requestKeys = Object.keys(request).sort();
        const expectedKeys = [...WORKFLOW_REQUEST_KEYS].sort();
        if (requestKeys.length !== expectedKeys.length || requestKeys.some((key, index) => key !== expectedKeys[index]) || !BOUNDED_ID.test(requestId) || !BOUNDED_ID.test(approvalId)
          || !BOUNDED_ID.test(String(request.plan_id || '')) || !BOUNDED_ID.test(String(request.option_id || ''))
          || !['policy_hash', 'source_fingerprint', 'task_fingerprint', 'scope_hash'].every((key) => LOWER_SHA256.test(String(request[key] || '')))
          || !GIT_OBJECT_ID.test(String(request.git_head || ''))) {
          json(res, 409, { accepted: false, code: 'invalid_request' }); return;
        }
        const requestHash = closedRequestHash(request);
        if (existing && existing.payload.request_hash !== requestHash) { json(res, 409, { accepted: false, code: 'request_id_conflict' }); return; }
        if (runKind === 'video' && capabilities.run_kinds.video.state === 'out_of_scope') { json(res, 409, { accepted: false, code: 'run_kind_out_of_scope' }); return; }
        if (!capabilities.run_kinds[runKind].requestable || !this.controlLedger) { json(res, 409, { accepted: false, code: 'workflow_trigger_gated', trigger: projection.trigger }); return; }
        const planId = typeof request.plan_id === 'string' ? request.plan_id : '';
        const optionId = typeof request.option_id === 'string' ? request.option_id : '';
        const plan = snapshot.plans[planId];
        const options = plan?.options as Record<string, Record<string, unknown>> | undefined;
        const option = options?.[optionId];
        if (!plan || !option || !project.cwd) { json(res, 409, { accepted: false, code: 'binding_mismatch' }); return; }
        const policyHash = plan.mapping && typeof plan.mapping === 'object' ? String((plan.mapping as Record<string, unknown>).policy_hash || '') : '';
        let gitHead: string;
        try { gitHead = execFileSync('git', ['-C', project.cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000, maxBuffer: 8192, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
        catch { json(res, 409, { accepted: false, code: 'request_failed' }); return; }
        let scopeHash: string;
        try { scopeHash = scopeBindingFromProject(project).scope_hash; }
        catch { json(res, 409, { accepted: false, code: 'scope_binding_unavailable' }); return; }
        const current = {
          schema: ATTESTATION_REQUEST_SCHEMA,
          approval_id: approvalId,
          project_id: projectId,
          project_cwd: project.cwd,
          plan_id: planId,
          option_id: optionId,
          policy_hash: policyHash,
          git_head: gitHead,
          source_fingerprint: fingerprint(plan.source_fingerprints || []),
          task_fingerprint: fingerprint(option.tasks || []),
          scope_hash: scopeHash,
        } satisfies ApprovalAttestationRequestV1;
        for (const key of ['plan_id', 'option_id', 'policy_hash', 'git_head', 'source_fingerprint', 'task_fingerprint', 'scope_hash'] as const) {
          if (request[key] !== current[key]) { json(res, 409, { accepted: false, code: 'binding_mismatch' }); return; }
        }
        const attestation = await this.controlLedger.attest(current, approvalId);
        if (!attestation.ok) { json(res, 409, { accepted: false, code: attestation.code }); return; }
        if (existing) { json(res, 200, { accepted: false, idempotent: true, request_id: requestId, workflow_id: workflowId }); return; }
        const result = this.store.ingest({ id: `workflow.trigger.requested:${projectId}:${requestId}`, source: 'manifest', kind: 'workflow.trigger.requested', status: 'observed', actor: 'local-operator', project_id: projectId, correlation_id: requestId, payload: { schema: 'temperance.manifest.workflow-request.receipt.v2', workflow_id: workflowId, request_id: requestId, request_hash: requestHash, run_kind: runKind, request_only: true, executed: false, authority: 'attested', attestation_id: attestation.attestation_id }, evidence: [] });
        json(res, result.error ? 409 : 201, { ...result, request_only: true, workflow_id: workflowId, request_id: requestId });
      } catch { json(res, 409, { accepted: false, code: 'request_failed' }); }
      return;
    }
    const attestationMatch = /^\/control\/approvals\/([^/]+)\/attestation$/.exec(url.pathname);
    if (req.method === 'POST' && attestationMatch) {
      if (!this.controlLedger) { json(res, 503, { schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'control_unavailable' }); return; }
      try {
        const approvalId = decodeURIComponent(attestationMatch[1]);
        const request = JSON.parse((await body(req)) || '{}') as unknown;
        const result = await this.controlLedger.attest(request, approvalId);
        json(res, result.ok ? 200 : result.code === 'invalid_request' ? 400 : result.code === 'control_unavailable' ? 503 : 409, result);
      } catch { json(res, 400, { schema: 'temperance.approval-attestation.response.v1', ok: false, code: 'invalid_request' }); }
      return;
    }
    const actionMatch = /^\/projects\/([^/]+)\/actions$/.exec(url.pathname);
    if (req.method === 'GET' && actionMatch) {
      try {
        if (!('project' in this.store)) throw new Error('project registry is unavailable');
        const projectId = decodeURIComponent(actionMatch[1]);
        const project = this.store.project(projectId, true);
        if (!project) { json(res, 404, { error: 'project_not_found' }); return; }
        json(res, 200, { project_id: projectId, actions: [
          { id: 'refresh', label: 'Refresh telemetry', available: true, destructive: false },
          { id: 'sync', label: 'Sync observations', available: Boolean(project.cwd), destructive: false },
          { id: 'archive', label: 'Archive project', available: project.visibility !== 'archived', destructive: false },
          { id: 'unregister', label: 'Remove from UI', available: project.visibility !== 'unregistered', destructive: false },
          { id: 'delete-manifest', label: 'Forget manifest history', available: projectId !== LEGACY_PROJECT_ID, destructive: true, requires_confirmation: true, source_preserved: true },
        ] });
      } catch (error) { json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    const projectActionMatch = /^\/projects\/([^/]+)\/(sync|archive|unregister)$/.exec(url.pathname);
    if (req.method === 'POST' && projectActionMatch) {
      try {
        if (!('project' in this.store) || !('setVisibility' in this.store)) throw new Error('project registry is unavailable');
        const projectId = decodeURIComponent(projectActionMatch[1]);
        const action = projectActionMatch[2] as 'sync' | 'archive' | 'unregister';
        const project = this.store.project(projectId, true);
        if (!project) { json(res, 404, { error: 'project_not_found' }); return; }
        if (action === 'sync') {
          if (!project.cwd) throw new Error('project has no registered cwd');
          const request = JSON.parse((await body(req)) || '{}') as Record<string, unknown>;
          const before = this.snapshot(projectId);
          const watcher = new RuntimeWatcher(this.store, {
            cwd: project.cwd, home: homedir(), intervalMs: 1,
            codegraph: request.codegraph !== false, gsd: request.gsd !== false,
            skillIndexPath: request.skill_clusters === false ? undefined : join(homedir(), '.agents', 'skill-clusters', 'skill-index.json'),
          });
          await watcher.sync();
          watcher.stop();
          const after = this.snapshot(projectId);
          const completionId = `project.sync.completed:${projectId}:${before.event_count}:${after.event_count}:${after.last_event_at || 'none'}`;
          const result = this.store.ingest({ id: completionId, source: 'manifest', kind: 'project.sync.completed', status: 'observed', actor: 'local-operator', project_id: projectId, payload: { action, before_event_count: before.event_count, after_event_count: after.event_count, before_freshness: before.freshness.status, after_freshness: after.freshness.status, codegraph: request.codegraph !== false, gsd: request.gsd !== false, skill_clusters: request.skill_clusters !== false }, evidence: [{ label: 'project-root', path: project.cwd }] });
          json(res, result.error ? 409 : 200, { action, project: this.store.project(projectId, true), before, after: this.snapshot(projectId), accepted: result.accepted });
          return;
        }
        const visibility: ProjectVisibility = action === 'archive' ? 'archived' : 'unregistered';
        const next = this.store.setVisibility(projectId, visibility);
        const result = this.store.ingest({ source: 'manifest', kind: 'project.visibility.changed', status: 'observed', actor: 'local-operator', project_id: projectId, payload: { action, visibility }, evidence: project.cwd ? [{ label: 'project-root', path: project.cwd }] : [] });
        json(res, result.error ? 409 : 200, { action, project: next, accepted: result.accepted });
      } catch (error) { json(res, 409, { ok: false, error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    const deleteProjectMatch = /^\/projects\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'DELETE' && deleteProjectMatch) {
      try {
        if (!('project' in this.store) || !('deleteManifestHistory' in this.store)) throw new Error('project registry is unavailable');
        const projectId = decodeURIComponent(deleteProjectMatch[1]);
        const request = JSON.parse((await body(req)) || '{}') as Record<string, unknown>;
        const confirmation = typeof request.confirm_project_id === 'string' ? request.confirm_project_id : '';
        if (request.delete_mode !== 'manifest-history') throw new Error('delete_mode must be manifest-history; source checkout deletion is not supported');
        const project = this.store.project(projectId, true);
        if (!project) { json(res, 404, { error: 'project_not_found' }); return; }
        const result = this.store.deleteManifestHistory(projectId, confirmation);
        json(res, 200, { action: 'delete-manifest', ...result, source_preserved: true });
      } catch (error) { json(res, 409, { ok: false, error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/snapshot') { json(res, 200, this.snapshot(url.searchParams.get('project_id') || undefined)); return; }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { ...headers('text/event-stream; charset=utf-8'), Connection: 'keep-alive' });
      const projectId = url.searchParams.get('project_id') || undefined;
      this.clients.set(res, projectId === 'all' ? undefined : projectId);
      res.write(`event: snapshot\ndata: ${JSON.stringify(this.snapshot(projectId))}\n\n`);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/events') {
      try {
        const input = JSON.parse(await body(req)) as Record<string, unknown>;
        const kind = typeof input.kind === 'string' ? input.kind : '';
        if (/^(approval|dispatch)\./.test(kind)) throw new Error('approval and dispatch lifecycle events are reserved for controlled local endpoints');
        // Activation hooks persist first so the event survives a bridge outage.
        // Reload that durable append before retrying the same event over HTTP;
        // otherwise a long-lived server can write a second copy of its ID.
        if ('refresh' in this.store) this.store.refresh();
        const result = this.store.ingest(input);
        this.diagnostics.event?.({ kind, project_id: typeof input.project_id === 'string' ? input.project_id : undefined, accepted: result.accepted, outcome: result.error ? 'rejected' : result.accepted ? 'accepted' : 'deduplicated', error: result.error });
        json(res, result.error ? 400 : result.accepted ? 201 : 200, result);
      } catch (error) { json(res, 400, { accepted: false, error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/approvals') {
      try {
        const request = JSON.parse(await body(req)) as Record<string, unknown>;
        const projectId = typeof request.project_id === 'string' ? request.project_id : '';
        const planId = typeof request.plan_id === 'string' ? request.plan_id : '';
        const optionId = typeof request.option_id === 'string' ? request.option_id : '';
        const approvalId = typeof request.approval_id === 'string' ? request.approval_id : '';
        if (!projectId || !planId || !optionId || !approvalId || !('listProjects' in this.store)) throw new Error('project_id, plan_id, option_id, and approval_id are required');
        const project = this.store.listProjects().find((candidate) => candidate.project_id === projectId);
        const snapshot = this.snapshot(projectId);
        const plan = snapshot.plans[planId];
        const options = plan?.options as Record<string, Record<string, unknown>> | undefined;
        const approval = Object.values(snapshot.approvals).find((candidate) => candidate.approval_id === approvalId);
        const expiresAt = typeof approval?.expires_at === 'string' ? approval.expires_at : '';
        if (!project?.cwd || !plan || !options?.[optionId] || !approval || !['required', 'granted'].includes(String(approval.status)) || (expiresAt && Date.parse(expiresAt) <= Date.now())) throw new Error('approval is invalid, expired, or no longer matches the current proposal');
        const option = options[optionId];
        const policyHash = plan.mapping && typeof plan.mapping === 'object' ? String((plan.mapping as Record<string, unknown>).policy_hash || '') : '';
        const gitHead = this.controlLedger ? execFileSync('git', ['-C', project.cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000, maxBuffer: 8192, stdio: ['ignore', 'pipe', 'ignore'] }).trim() : '';
        const sourceFingerprint = fingerprint(plan.source_fingerprints || []);
        const taskFingerprint = fingerprint(option.tasks || []);
        const receipt = { approval_id: approvalId, plan_id: planId, option_id: optionId, policy_hash: policyHash, expires_at: expiresAt, approved_at: new Date().toISOString(), actor: 'local-operator' };
        let scopeHash = '';
        if (this.controlLedger) {
          try { scopeHash = scopeBindingFromProject(project).scope_hash; }
          catch { json(res, 409, { accepted: false, code: 'approval_scope_unavailable' }); return; }
        }
        if (this.controlLedger?.recordApproval) await this.controlLedger.recordApproval({ approval_id: approvalId, project_id: projectId, project_cwd: project.cwd, plan_id: planId, option_id: optionId, policy_hash: policyHash, git_head: gitHead, source_fingerprint: sourceFingerprint, task_fingerprint: taskFingerprint, scope_hash: scopeHash, combo: String(option.combo || ''), concurrency: Number(option.concurrency || 0), worktree_required: option.worktree_required === true, expires_at: expiresAt || new Date(Date.now() + 60_000).toISOString() });
        const path = join(project.cwd, '.planning', 'APPROVALS.json');
        let receipts: Record<string, unknown>[] = [];
        try { const value = JSON.parse(readFileSync(path, 'utf8')); receipts = Array.isArray(value) ? value : Array.isArray(value.approvals) ? value.approvals : []; } catch { /* first local approval */ }
        receipts = [...receipts.filter((candidate) => candidate.approval_id !== approvalId), receipt];
        mkdirSync(join(project.cwd, '.planning'), { recursive: true });
        writeFileSync(path, `${JSON.stringify({ schema: 'temperance.approvals.v1', approvals: receipts }, null, 2)}\n`, 'utf8');
        const result = this.store.ingest({ source: 'manifest', kind: 'approval.granted', status: 'observed', project_id: projectId, correlation_id: planId, actor: 'local-operator', payload: receipt, evidence: [{ label: 'approval-receipt', path }] });
        json(res, result.error ? 400 : 201, { ...result, receipt });
      } catch { json(res, 409, { accepted: false, code: 'approval_request_failed' }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dispatches') {
      try {
        if (!this.controlLedger) throw new Error('automatic swarm control is disabled: TEMPERANCE_CONTROL_DATABASE_URL is not configured');
        const request = JSON.parse(await body(req)) as ClaimRequest;
        if (!this.controlLedger.claim) throw new Error('automatic swarm claim is unavailable');
        const result = await this.controlLedger.claim(request);
        if (result.ok) this.store.ingest({ source: 'manifest', kind: 'dispatch.claimed', status: 'observed', project_id: request.project_id, correlation_id: result.dispatch_id, actor: 'swarm-control', payload: { ...result, plan_id: request.plan_id, option_id: request.option_id, approval_id: request.approval_id }, evidence: [] });
        json(res, result.ok ? 201 : 409, result);
      } catch (error) { json(res, 503, { ok: false, error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    json(res, 404, { error: 'not_found' });
  }

  private snapshot(projectId?: string): ManifestState {
    return 'snapshot' in this.store ? this.store.snapshot(projectId) : this.store.state;
  }
}
