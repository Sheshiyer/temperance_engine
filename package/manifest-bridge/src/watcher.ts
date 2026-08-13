import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { ManifestStore } from './store';
import { identityForCwd } from './project';

interface WatchOptions { cwd: string; home: string; cwds?: string[]; intervalMs?: number; }

function fingerprint(path: string): string | null {
  try { const stat = statSync(path); return `${stat.mtimeMs}:${stat.size}`; } catch { return null; }
}

function readJson(path: string): Record<string, unknown> | null {
  try { const value = JSON.parse(readFileSync(path, 'utf8')); return value && typeof value === 'object' ? value : null; } catch { return null; }
}

const ALGORITHM_PHASES = new Set(['OBSERVE', 'THINK', 'PLAN', 'BUILD', 'EXECUTE', 'VERIFY', 'LEARN']);

function canonicalPhase(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const phase = value.trim().toUpperCase();
  return ALGORITHM_PHASES.has(phase) ? phase : undefined;
}

function observationId(source: string, path: string, fingerprintValue: string, projectId: string): string {
  const digest = createHash('sha256').update(`${source}\0${path}\0${fingerprintValue}\0${projectId}`).digest('hex').slice(0, 24);
  return `evt_watch_${digest}`;
}

export class RuntimeWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private fingerprints = new Map<string, string>();

  constructor(private readonly store: Pick<ManifestStore, 'ingest'>, private readonly options: WatchOptions) {}

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.options.intervalMs || 1000);
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  sync(): Promise<void> { return this.poll(); }

  private async poll(): Promise<void> {
    await this.pollAlgorithmStates();
    await this.pollNextWave(join(this.options.home, '.temperance_engine', 'state', 'next-wave.json'), 'temperance-router');
    for (const cwd of this.projectCwds()) {
      await this.pollNextWave(join(cwd, '.planning', 'NEXT-WAVE.json'), 'project-artifact', cwd);
      await this.pollOrchestration(join(cwd, '.planning', 'ORCHESTRATION.json'), cwd);
    }
  }

  private async pollAlgorithmStates(): Promise<void> {
    const dir = join(this.options.home, '.claude', 'MEMORY', 'STATE', 'algorithms');
    if (!existsSync(dir)) return;
    let names: string[] = [];
    try { names = readdirSync(dir).filter((name) => name.endsWith('.json')).slice(0, 200); } catch { return; }
    for (const name of names) {
      const path = join(dir, name);
      const fp = fingerprint(path);
      if (!fp || this.fingerprints.get(path) === fp) continue;
      this.fingerprints.set(path, fp);
      const value = readJson(path);
      if (!value) continue;
      const sessionId = typeof value.sessionId === 'string' ? value.sessionId : basename(name, '.json');
      const declaredCwd = typeof value.cwd === 'string' ? value.cwd : typeof value.project_cwd === 'string' ? value.project_cwd : null;
      if (!declaredCwd && this.projectCwds().length > 1) continue;
      const cwd = declaredCwd || this.options.cwd;
      const project = identityForCwd(cwd);
      const currentPhase = canonicalPhase(value.currentPhase);
      this.store.ingest({
        id: observationId('algorithm-state', path, fp, project.project_id),
        source: 'pai-hook', kind: 'phase.changed', status: 'observed', actor: 'algorithm-state',
        session_id: sessionId, phase: currentPhase, project_id: project.project_id,
        payload: { active: value.active === true, criteria_count: value.criteriaCount || 0, agent_count: value.agentCount || 0, current_phase: value.currentPhase, project_name: project.name, project_cwd: project.cwd },
        evidence: [{ label: 'algorithm-state', path }],
      });
    }
  }

  private async pollNextWave(path: string, source: 'temperance-router' | 'project-artifact', cwd = this.options.cwd): Promise<void> {
    const fp = fingerprint(path);
    if (!fp || this.fingerprints.get(path) === fp) return;
    this.fingerprints.set(path, fp);
    const value = readJson(path);
    if (!value) return;
    const result = value.wave && typeof value.wave === 'object' ? value.wave as Record<string, unknown> : value;
    const declaredCwd = typeof value.cwd === 'string' ? value.cwd : typeof value.project_cwd === 'string' ? value.project_cwd : null;
    if (!declaredCwd && source === 'temperance-router' && this.projectCwds().length > 1) return;
    const projectCwd = declaredCwd ? resolve(declaredCwd) : cwd;
    const project = identityForCwd(projectCwd);
    const phase = canonicalPhase(result.phase);
    this.store.ingest({
      id: observationId(source, path, fp, project.project_id),
      source, kind: 'wave.updated', status: 'observed', actor: source,
      project_id: project.project_id, phase,
      correlation_id: typeof result.phase === 'string' ? `${project.project_id}:${result.phase}` : undefined,
      payload: { ...result, phase_label: typeof result.phase === 'string' ? result.phase : undefined, wave_id: `${project.project_id}:${result.phase || 'current'}`, project_name: project.name, project_cwd: project.cwd, source_file: path },
      evidence: [{ label: 'next-wave', path }],
    });
  }

  private async pollOrchestration(path: string, cwd: string): Promise<void> {
    const fp = fingerprint(path);
    if (!fp || this.fingerprints.get(path) === fp) return;
    this.fingerprints.set(path, fp);
    const value = readJson(path);
    if (!value || value.schema !== 'temperance.orchestration.v1') return;
    const project = identityForCwd(cwd);
    const planId = typeof value.plan_id === 'string' ? value.plan_id : `${project.project_id}:current`;
    const evidence = [{ label: 'orchestration', path }];
    const approval = value.approval && typeof value.approval === 'object' ? value.approval as Record<string, unknown> : null;
    const freshUntil = typeof approval?.expires_at === 'string' ? approval.expires_at : undefined;
    const ingest = (kind: string, payload: Record<string, unknown>, status: 'observed' | 'stale' = 'observed') => this.store.ingest({
      id: observationId(kind, path, `${fp}:${kind}`, project.project_id), source: 'project-artifact', kind, status,
      actor: 'orchestration-watcher', project_id: project.project_id, correlation_id: planId, phase: 'PLAN', fresh_until: freshUntil, payload: { ...payload, plan_id: planId, project_name: project.name, project_cwd: project.cwd }, evidence,
    });
    ingest('plan.updated', { state: value.state, mapping: value.mapping, source_fingerprints: value.source_fingerprints });
    for (const option of Array.isArray(value.options) ? value.options : []) if (option && typeof option === 'object') ingest('plan.option.proposed', { ...(option as Record<string, unknown>) });
    for (const item of Array.isArray(value.research) ? value.research : []) if (item && typeof item === 'object') ingest('research.collected', { ...(item as Record<string, unknown>) });
    if (approval) ingest('approval.requested', { ...approval });
    if (value.execution && typeof value.execution === 'object') ingest('dispatch.readiness', { ...(value.readiness as Record<string, unknown> || {}), ...(value.execution as Record<string, unknown>) });
    if (value.reporting && typeof value.reporting === 'object') ingest('report.expected', { ...(value.reporting as Record<string, unknown>) });
  }

  private projectCwds(): string[] {
    return [...new Set([this.options.cwd, ...(this.options.cwds || [])])];
  }
}
