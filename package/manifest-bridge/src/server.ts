import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ManifestCatalog } from './catalog';
import { SwarmControlLedger, fingerprint, type ClaimRequest } from './control-ledger';
import { LEGACY_PROJECT_ID } from './project';
import { ManifestStore } from './store';
import { ManifestDiagnostics } from './diagnostics';
import type { ManifestEvent, ManifestState } from './types';

const MAX_BODY = 1_000_000;

function headers(contentType: string): Record<string, string> {
  return { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'http://127.0.0.1:5173', 'Access-Control-Allow-Headers': 'Content-Type' };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, headers('application/json; charset=utf-8'));
  res.end(JSON.stringify(body));
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
  private readonly diagnostics = new ManifestDiagnostics();
  private server = createServer((req, res) => {
    const started = Date.now();
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    res.once('finish', () => this.diagnostics.request({ method: req.method, path: url.pathname, status: res.statusCode, duration_ms: Date.now() - started }));
    void this.handle(req, res);
  });
  private clients = new Map<ServerResponse, string | undefined>();
  private unsubscribe: (() => void) | null = null;
  private readonly controlLedger = process.env.TEMPERANCE_SWARM_CONTROL_ENABLED === '1' && process.env.TEMPERANCE_CONTROL_DATABASE_URL ? SwarmControlLedger.fromUrl() : null;

  constructor(private readonly store: ManifestStore | ManifestCatalog) {
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
    if (req.method === 'GET' && url.pathname === '/health') {
      const snapshot = this.store.state;
      json(res, 200, { ok: true, service: 'temperance-manifest-bridge', ...snapshot.freshness, event_count: snapshot.event_count });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/projects') {
      const projects = 'listProjects' in this.store ? this.store.listProjects() : [];
      json(res, 200, { projects });
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
        this.diagnostics.event({ kind, project_id: typeof input.project_id === 'string' ? input.project_id : undefined, accepted: result.accepted, outcome: result.error ? 'rejected' : result.accepted ? 'accepted' : 'deduplicated', error: result.error });
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
        if (!project?.cwd || !plan || !options?.[optionId] || !approval || approval.status !== 'required' || Date.parse(expiresAt) <= Date.now()) throw new Error('approval is invalid, expired, or no longer matches the current proposal');
        const option = options[optionId];
        const policyHash = plan.mapping && typeof plan.mapping === 'object' ? String((plan.mapping as Record<string, unknown>).policy_hash || '') : '';
        const gitHead = this.controlLedger ? execFileSync('git', ['-C', project.cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() : '';
        const sourceFingerprint = fingerprint(plan.source_fingerprints || []);
        const taskFingerprint = fingerprint(option.tasks || []);
        const receipt = { approval_id: approvalId, plan_id: planId, option_id: optionId, policy_hash: policyHash, expires_at: expiresAt, approved_at: new Date().toISOString(), actor: 'local-operator' };
        if (this.controlLedger) await this.controlLedger.recordApproval({ approval_id: approvalId, project_id: projectId, project_cwd: project.cwd, plan_id: planId, option_id: optionId, policy_hash: policyHash, git_head: gitHead, source_fingerprint: sourceFingerprint, task_fingerprint: taskFingerprint, combo: String(option.combo || ''), concurrency: Number(option.concurrency || 0), worktree_required: option.worktree_required === true, expires_at: expiresAt });
        const path = join(project.cwd, '.planning', 'APPROVALS.json');
        let receipts: Record<string, unknown>[] = [];
        try { const value = JSON.parse(readFileSync(path, 'utf8')); receipts = Array.isArray(value) ? value : Array.isArray(value.approvals) ? value.approvals : []; } catch { /* first local approval */ }
        receipts = [...receipts.filter((candidate) => candidate.approval_id !== approvalId), receipt];
        mkdirSync(join(project.cwd, '.planning'), { recursive: true });
        writeFileSync(path, `${JSON.stringify({ schema: 'temperance.approvals.v1', approvals: receipts }, null, 2)}\n`, 'utf8');
        const result = this.store.ingest({ source: 'manifest', kind: 'approval.granted', status: 'observed', project_id: projectId, correlation_id: planId, actor: 'local-operator', payload: receipt, evidence: [{ label: 'approval-receipt', path }] });
        json(res, result.error ? 400 : 201, { ...result, receipt });
      } catch (error) { json(res, 409, { accepted: false, error: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dispatches') {
      try {
        if (!this.controlLedger) throw new Error('automatic swarm control is disabled: TEMPERANCE_CONTROL_DATABASE_URL is not configured');
        const request = JSON.parse(await body(req)) as ClaimRequest;
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
