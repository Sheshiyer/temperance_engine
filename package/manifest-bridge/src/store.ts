import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeEvent } from './contract';
import { STATE_SCHEMA, type ManifestEvent, type ManifestState } from './types';

export const STALE_AFTER_MS = 180_000;
const RECENT_LIMIT = 200;

function emptyState(): ManifestState {
  return {
    schema: STATE_SCHEMA,
    generated_at: new Date().toISOString(),
    last_event_at: null,
    event_count: 0,
    freshness: { status: 'empty', age_ms: null, stale_after_ms: STALE_AFTER_MS },
    projects: {}, sessions: {}, agents: {}, waves: {}, plans: {}, approvals: {}, skills: {}, dispatches: {}, reports: {}, routes: {}, codegraph: {}, workflows: {}, evidence: {}, alerts: [], recent_events: [],
  };
}

function keyFor(event: ManifestEvent, fallback: string): string {
  return event.session_id || event.agent_id || event.correlation_id || event.project_id || fallback;
}

function projectId(event: ManifestEvent): string {
  return event.project_id || String(event.payload.project_id || 'global');
}

export class ManifestStore {
  readonly file: string;
  private stateValue = emptyState();
  private seen = new Set<string>();
  private listeners = new Set<(event: ManifestEvent) => void>();
  private sequence = 0;

  constructor(file: string, private readonly projectId?: string) {
    this.file = file;
    this.replay();
  }

  get state(): ManifestState {
    const last = this.stateValue.last_event_at ? Date.parse(this.stateValue.last_event_at) : null;
    const age = last === null ? null : Math.max(0, Date.now() - last);
    this.stateValue.generated_at = new Date().toISOString();
    this.stateValue.freshness = {
      status: age === null ? 'empty' : age > STALE_AFTER_MS ? 'stale' : 'fresh',
      age_ms: age,
      stale_after_ms: STALE_AFTER_MS,
    };
    return structuredClone(this.stateValue);
  }

  subscribe(listener: (event: ManifestEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ingest(input: unknown): { accepted: boolean; event?: ManifestEvent; error?: string } {
    try {
      const event = normalizeEvent(input);
      if (event.fresh_until && Date.parse(event.fresh_until) <= Date.now()) event.status = 'stale';
      if (this.projectId && event.project_id && event.project_id !== this.projectId) throw new Error(`event project_id ${event.project_id} does not match store ${this.projectId}`);
      if (this.projectId && !event.project_id) event.project_id = this.projectId;
      if (this.seen.has(event.id)) return { accepted: false, event };
      event.seq = ++this.sequence;
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(event)}\n`, 'utf8');
      this.apply(event);
      for (const listener of this.listeners) {
        try { listener(event); } catch { /* observers are fail-open */ }
      }
      return { accepted: true, event };
    } catch (error) {
      return { accepted: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  replay(): ManifestEvent[] {
    const previousSeen = new Set(this.seen);
    this.stateValue = emptyState();
    this.seen.clear();
    this.sequence = 0;
    if (!existsSync(this.file)) return [];
    let lines = '';
    try { lines = readFileSync(this.file, 'utf8'); } catch { return []; }
    const newEvents: ManifestEvent[] = [];
    for (const line of lines.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = normalizeEvent(JSON.parse(line));
        if (event.fresh_until && Date.parse(event.fresh_until) <= Date.now()) event.status = 'stale';
        if (this.projectId && event.project_id !== this.projectId) continue;
        if (this.seen.has(event.id)) continue;
        event.seq = ++this.sequence;
        this.apply(event);
        if (!previousSeen.has(event.id)) newEvents.push(event);
      } catch { /* corrupt lines do not prevent later replay */ }
    }
    return newEvents;
  }

  private apply(event: ManifestEvent): void {
    this.seen.add(event.id);
    this.stateValue.event_count += 1;
    if (!this.stateValue.last_event_at || Date.parse(event.ts) >= Date.parse(this.stateValue.last_event_at)) {
      this.stateValue.last_event_at = event.ts;
    }
    this.stateValue.recent_events = [...this.stateValue.recent_events, event].slice(-RECENT_LIMIT);
    const pid = projectId(event);
    this.stateValue.projects[pid] = {
      ...(this.stateValue.projects[pid] || {}),
      project_id: pid,
      last_event_at: event.ts,
      last_kind: event.kind,
      source: event.source,
      status: event.status,
      ...(event.kind === 'algorithm.activated' ? { enrollment: event.payload.enrollment, cwd: event.payload.project_cwd } : {}),
    };
    const session = event.session_id;
    if (session) {
      this.stateValue.sessions[session] = {
        ...(this.stateValue.sessions[session] || {}),
        session_id: session,
        project_id: pid,
        phase: event.phase || this.stateValue.sessions[session]?.phase || null,
        last_kind: event.kind,
        last_event_at: event.ts,
        ...((event.kind === 'prompt.classified' || event.kind === 'algorithm.activated') ? { mode: event.payload.mode, tier: event.payload.tier, run_id: event.payload.run_id, enrollment: event.payload.enrollment } : {}),
      };
    }
    const agent = event.agent_id;
    if (agent) {
      this.stateValue.agents[agent] = {
        ...(this.stateValue.agents[agent] || {}),
        agent_id: agent,
        project_id: pid,
        session_id: session || null,
        phase: event.phase || null,
        status: event.kind.endsWith('.stopped') || event.kind.endsWith('.completed') || event.kind.endsWith('.succeeded') || event.status === 'failed' ? 'stopped' : 'active',
        last_event_at: event.ts,
        payload: event.payload,
      };
    }
    if (event.kind.startsWith('wave.')) {
      const wave = String(event.payload.wave_id || event.correlation_id || `${pid}:current`);
      this.stateValue.waves[wave] = { ...event.payload, wave_id: wave, project_id: pid, phase: event.phase || null, last_event_at: event.ts, status: event.status };
    }
    if (event.kind.startsWith('plan.')) {
      const plan = String(event.payload.plan_id || event.correlation_id || `${pid}:current`);
      const previous = this.stateValue.plans[plan] || {};
      const options = event.kind === 'plan.option.proposed'
        ? { ...((previous.options as Record<string, unknown>) || {}), [String(event.payload.option_id || event.id)]: event.payload }
        : previous.options;
      this.stateValue.plans[plan] = { ...previous, ...event.payload, ...(options ? { options } : {}), plan_id: plan, project_id: pid, last_event_at: event.ts, status: event.status };
    }
    if (event.kind.startsWith('approval.')) {
      const approval = String(event.payload.approval_id || event.correlation_id || `${pid}:current`);
      const lifecycle = typeof event.payload.status === 'string' ? event.payload.status : event.kind.slice('approval.'.length);
      this.stateValue.approvals[approval] = { ...(this.stateValue.approvals[approval] || {}), ...event.payload, approval_id: approval, project_id: pid, last_event_at: event.ts, status: lifecycle, event_status: event.status };
    }
    if (event.kind.startsWith('skill.')) {
      const skillBase = String(event.payload.skill_id || event.payload.name || event.correlation_id || 'current');
      const skill = event.kind.startsWith('skill.cluster.') ? `${pid}:${skillBase}` : skillBase;
      this.stateValue.skills[skill] = { ...(this.stateValue.skills[skill] || {}), ...event.payload, skill_id: skill, project_id: pid, last_event_at: event.ts, status: event.status };
    }
    if (event.kind.startsWith('dispatch.')) {
      const dispatch = String(event.payload.dispatch_id || event.correlation_id || `${pid}:current`);
      this.stateValue.dispatches[dispatch] = { ...(this.stateValue.dispatches[dispatch] || {}), ...event.payload, dispatch_id: dispatch, project_id: pid, last_event_at: event.ts, status: event.status };
    }
    if (event.kind.startsWith('report.')) {
      const report = String(event.payload.report_id || event.correlation_id || `${pid}:current`);
      this.stateValue.reports[report] = { ...(this.stateValue.reports[report] || {}), ...event.payload, report_id: report, project_id: pid, last_event_at: event.ts, status: event.status };
    }
    if (event.kind.startsWith('route.') || event.source === 'omniroute') {
      const route = String(event.correlation_id || event.payload.request_id || `${pid}:latest`);
      this.stateValue.routes[route] = { ...event.payload, route_id: route, project_id: pid, phase: event.phase || null, last_event_at: event.ts, status: event.status, source: event.source };
    }
    if (event.kind.startsWith('codegraph.')) {
      this.stateValue.codegraph[pid] = { ...this.stateValue.codegraph[pid], ...event.payload, project_id: pid, last_event_at: event.ts, status: event.status };
    }
    if (event.kind.startsWith('workflow.')) {
      this.stateValue.workflows[pid] = { ...this.stateValue.workflows[pid], ...event.payload, project_id: pid, last_event_at: event.ts, status: event.status };
    }
    if (event.kind.startsWith('planning.') || event.kind.startsWith('goal.')) {
      const key = event.kind.startsWith('goal.') ? `${pid}:goal` : `${pid}:planning`;
      this.stateValue.workflows[key] = { ...this.stateValue.workflows[key], ...event.payload, project_id: pid, last_event_at: event.ts, status: event.status, kind: event.kind };
    }
    for (const pointer of event.evidence) {
      const evidenceId = `${event.id}:${pointer.label}`;
      this.stateValue.evidence[evidenceId] = { ...pointer, event_id: event.id, project_id: pid, ts: event.ts };
    }
    if (event.status === 'failed' || event.status === 'stale' || event.kind.endsWith('.failed')) {
      this.stateValue.alerts = [...this.stateValue.alerts, { id: event.id, kind: event.kind, status: event.status, project_id: pid, ts: event.ts, payload: event.payload }].slice(-100);
    }
  }
}
