import { admitRoutingObservation, decodeEventInput, ROUTING_OBSERVATION_KIND, type ObservationAdmission, type ObservationCode, type RoutingObservationPolicy } from './routing-observation';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmdirSync } from 'node:fs';
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
    projects: {}, sessions: {}, agents: {}, waves: {}, plans: {}, approvals: {}, skills: {}, dispatches: {}, reports: {}, routes: {}, routing_observations: {}, codegraph: {}, workflows: {}, evidence: {}, alerts: [], recent_events: [],
  };
}

function keyFor(event: ManifestEvent, fallback: string): string {
  return event.session_id || event.agent_id || event.correlation_id || event.project_id || fallback;
}

function projectId(event: ManifestEvent): string {
  return event.project_id || String(event.payload.project_id || 'global');
}

/** Trusted filesystem seam for failure tests; omitted in runtime construction. */
export interface RoutingObservationStoreIO {
  read?: (file: string) => string;
  release?: (lock: string) => void;
}

export class ManifestStore {
  readonly file: string;
  private stateValue = emptyState();
  private seen = new Set<string>();
  private listeners = new Set<(event: ManifestEvent) => void>();
  private sequence = 0;
  private replayReadFailed = false;
  private replayNeedsSeparator = false;
  private readonly observations = new Map<string, ManifestEvent>();
  private readonly liveConflicts = new Map<string, number>();
  private readonly rejections: Partial<Record<ObservationCode, number>> = {};

  get observationRejections(): Partial<Record<ObservationCode, number>> { return { ...this.rejections }; }
  private rejected(code: ObservationCode): { accepted: false; error: ObservationCode } {
    this.rejections[code] = Math.min(10_000, (this.rejections[code] || 0) + 1);
    return { accepted: false, error: code };
  }

  constructor(file: string, private readonly projectId?: string, private readonly observationPolicy?: RoutingObservationPolicy, private readonly observationIO: RoutingObservationStoreIO = {}) {
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
    const snapshot = structuredClone(this.stateValue);
    const now = this.observationPolicy?.now() ?? Date.now();
    for (const projection of Object.values(snapshot.routing_observations || {})) {
      projection.freshness = Date.parse(projection.receipt.fresh_until) <= now ? 'stale' : 'fresh';
    }
    return snapshot;
  }

  subscribe(listener: (event: ManifestEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ingest(input: unknown): { accepted: boolean; event?: ManifestEvent; error?: string } {
    const observation = admitRoutingObservation(input, this.observationPolicy, { projectId: this.projectId });
    if (observation.special) {
      if (!observation.ok) return this.rejected(observation.code);
      return this.ingestObservation(observation);
    }
    try {
      const event = normalizeEvent(input);
      if (event.id.startsWith('evt_ro_')) return this.rejected('unsupported_observation');
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

  /** Synchronous critical section shared by every opt-in writer, including separate processes.
   * No timeout-based lock stealing: an abandoned lock requires separate operator recovery. */
  private ingestObservation(admission: Extract<ObservationAdmission, { ok: true }>): { accepted: boolean; event?: ManifestEvent; error?: string } {
    const lock = `${this.file}.routing-observation.lock`;
    try { mkdirSync(dirname(this.file), { recursive: true }); } catch { return this.rejected('persistence_failed'); }
    try { mkdirSync(lock); } catch { return this.rejected('writer_busy'); }
    let result: { accepted: boolean; event?: ManifestEvent; error?: string };
    try {
      // Rebuild inside the lock; an instance-local seen set is not writer authority.
      this.replay();
      if (this.replayReadFailed) throw new Error('persistence_failed');
      const existing = this.observations.get(admission.key);
      if (existing) {
        if (existing.id !== admission.event.id) {
          this.markConflict(admission.key, true);
          result = this.rejected('receipt_conflict');
        } else result = { accepted: false, event: structuredClone(existing) };
      } else if (this.seen.has(admission.event.id)) result = this.rejected('receipt_conflict');
      else {
        const event = admission.event;
        event.seq = this.sequence + 1;
        // Preserve an unterminated historical tail as its own line; never merge an
        // accepted receipt into corrupt bytes or rewrite the existing content.
        appendFileSync(this.file, `${this.replayNeedsSeparator ? '\n' : ''}${JSON.stringify(event)}\n`, 'utf8');
        this.sequence++;
        this.applyObservation(admission);
        result = { accepted: true, event: structuredClone(event) };
      }
    } catch { result = this.rejected('persistence_failed'); }
    finally { try { (this.observationIO.release || rmdirSync)(lock); } catch { result = this.rejected('persistence_failed'); } }
    if (result.accepted && result.event) for (const listener of this.listeners) {
      try { listener(structuredClone(result.event)); } catch { /* observers are fail-open */ }
    }
    return result;
  }

  private markConflict(key: string, live = false): void {
    if (live) this.liveConflicts.set(key, Math.min(10_000, (this.liveConflicts.get(key) || 0) + 1));
    const projection = this.stateValue.routing_observations?.[key];
    if (projection) projection.conflict_count = Math.min(10_000, projection.conflict_count + 1);
  }

  private applyObservation(admission: Extract<ObservationAdmission, { ok: true }>): void {
    this.observations.set(admission.key, admission.event);
    this.stateValue.routing_observations![admission.key] = {
      receipt: structuredClone(admission.receipt), freshness: 'fresh', conflict_count: this.liveConflicts.get(admission.key) || 0,
    };
    this.apply(admission.event);
  }

  replay(): ManifestEvent[] {
    this.replayReadFailed = false;
    this.replayNeedsSeparator = false;
    let lines = '';
    if (existsSync(this.file)) {
      try { lines = this.observationIO.read ? this.observationIO.read(this.file) : readFileSync(this.file, 'utf8'); }
      catch { this.replayReadFailed = true; return []; }
    }
    this.replayNeedsSeparator = lines.length > 0 && !lines.endsWith('\n');
    const previousSeen = new Set(this.seen);
    this.stateValue = emptyState();
    this.seen.clear();
    this.observations.clear();
    this.sequence = 0;
    const newEvents: ManifestEvent[] = [];
    for (const line of lines.split('\n')) {
      if (!line.trim()) continue;
      try {
        const decoded = decodeEventInput(line);
        if (!decoded.ok) { this.rejected(decoded.error); continue; }
        const admission = admitRoutingObservation(decoded.input, this.observationPolicy, { replay: true, projectId: this.projectId });
        if (admission.special) {
          if (!admission.ok) { this.rejected(admission.code); continue; }
          const previous = this.observations.get(admission.key);
          if (previous) {
            if (previous.id !== admission.event.id) { this.markConflict(admission.key); this.rejected('receipt_conflict'); }
            continue;
          }
          if (this.seen.has(admission.event.id)) { this.rejected('receipt_conflict'); continue; }
          admission.event.seq = ++this.sequence;
          this.applyObservation(admission);
          if (!previousSeen.has(admission.event.id)) newEvents.push(structuredClone(admission.event));
          continue;
        }
        const event = normalizeEvent(decoded.input);
        if (event.id.startsWith('evt_ro_')) { this.rejected('unsupported_observation'); continue; }
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
    if (event.kind === ROUTING_OBSERVATION_KIND) return;
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
