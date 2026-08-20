import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { ManifestStore } from './store';
import { identityForCwd } from './project';
import { readCodeGraphStatus } from './codegraph';

interface WatchOptions { cwd: string; home: string; cwds?: string[]; intervalMs?: number; codegraph?: boolean; codegraphRunner?: (projectPath: string, sync: boolean) => string; gsd?: boolean; skillIndexPath?: string; }

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
      await this.pollPlanningBind(cwd);
      await this.pollCodeGraph(cwd);
      await this.pollGsdArtifacts(cwd);
    }
    await this.pollSkillClusterHealth();
  }

  private async pollCodeGraph(cwd: string): Promise<void> {
    if (!this.options.codegraph) return;
    const project = identityForCwd(cwd);
    const status = readCodeGraphStatus(project.cwd, { runner: this.options.codegraphRunner });
    const fingerprintValue = JSON.stringify(status);
    const path = `${project.cwd}:codegraph`;
    if (this.fingerprints.get(path) === fingerprintValue) return;
    this.fingerprints.set(path, fingerprintValue);
    this.store.ingest({
      id: observationId('codegraph', project.cwd, fingerprintValue, project.project_id),
      source: 'codegraph', kind: 'codegraph.status', status: 'observed', actor: 'codegraph-observer',
      project_id: project.project_id,
      payload: { ...status, project_name: project.name, project_cwd: project.cwd },
      evidence: [{ label: 'codegraph-status', path: project.cwd }],
    });
  }

  private async pollGsdArtifacts(cwd: string): Promise<void> {
    if (!this.options.gsd) return;
    const project = identityForCwd(cwd);
    const paths = [join(cwd, '.planning', 'STATE.md'), join(cwd, '.planning', 'ROADMAP.md'), join(cwd, '.continue-here.md')];
    const present = paths.filter((path) => fingerprint(path));
    for (const path of present) {
      const fp = fingerprint(path);
      if (!fp || this.fingerprints.get(path) === fp) continue;
      this.fingerprints.set(path, fp);
      const extra: Record<string, unknown> = {};
      if (basename(path) === 'STATE.md') {
        try {
          const text = readFileSync(path, 'utf8');
          const focus = text.match(/\*\*Current focus:\*\*\s*(.+)/)?.[1]?.trim();
          const phase = text.match(/^Phase:\s*(.+)$/m)?.[1]?.trim();
          const status = text.match(/^Status:\s*(.+)$/m)?.[1]?.trim();
          extra.state = { focus, phase, status };
        } catch { /* STATE parse is observational */ }
      }
      if (basename(path) === 'ROADMAP.md') {
        try {
          const text = readFileSync(path, 'utf8');
          const phases: Array<{ n: number; title: string; done: boolean }> = [];
          const re = /^- \[([ xX])\]\s+\*\*Phase\s+(\d+)[:.]\s*([^*]+)\*\*/gm;
          let match: RegExpExecArray | null;
          while ((match = re.exec(text))) {
            phases.push({ n: Number(match[2]), title: match[3].trim(), done: match[1].toLowerCase() === 'x' });
          }
          extra.phases = phases.map((item) => `${item.done ? '*' : '.'} ${String(item.n).padStart(2, '0')} ${item.title}`);
          extra.phase_count = phases.length;
          extra.done_count = phases.filter((item) => item.done).length;
        } catch { /* ROADMAP parse is observational */ }
      }
      this.store.ingest({
        id: observationId('gsd-artifact', path, fp, project.project_id),
        source: 'project-artifact', kind: 'workflow.gsd.artifact', status: 'observed', actor: 'gsd-observer',
        project_id: project.project_id,
        payload: { workflow: 'gsd', artifact: basename(path), artifact_count: present.length, project_name: project.name, project_cwd: project.cwd, ...extra },
        evidence: [{ label: 'gsd-artifact', path }],
      });
    }
  }

  private async pollPlanningBind(cwd: string): Promise<void> {
    const project = identityForCwd(cwd);
    const packetPath = join(cwd, '.temperance', 'project.json');
    const goalPath = join(cwd, '.temperance', 'goal.json');
    const packetFp = fingerprint(packetPath);
    if (packetFp && this.fingerprints.get(packetPath) !== packetFp) {
      this.fingerprints.set(packetPath, packetFp);
      const packet = readJson(packetPath);
      const planning = packet?.planning && typeof packet.planning === 'object' ? packet.planning as Record<string, unknown> : {};
      const github = planning.github_project && typeof planning.github_project === 'object'
        ? planning.github_project as Record<string, unknown>
        : {};
      this.store.ingest({
        id: observationId('planning-bind', packetPath, packetFp, project.project_id),
        source: 'project-artifact', kind: 'planning.bound', status: 'observed', actor: 'planning-observer',
        project_id: project.project_id, phase: 'PLAN',
        payload: {
          artifact: 'PLANNING',
          project_name: project.name,
          project_cwd: project.cwd,
          github: packet?.github || null,
          github_project_url: typeof github.url === 'string' ? github.url : null,
          github_project_number: github.number ?? null,
          enrolled: Boolean(github.number),
          horizons: planning.horizons || { long: '', short: '' },
          teamforge: planning.teamforge || { project_id: null, client_id: null },
          flow: ['intent', 'research', 'options', 'vision', 'goals', 'github-project'],
        },
        evidence: [{ label: 'project-packet', path: packetPath }, ...(typeof github.url === 'string' ? [{ label: 'github-project', url: github.url }] : [])],
      });
    }
    const goalFp = fingerprint(goalPath);
    if (goalFp && this.fingerprints.get(goalPath) !== goalFp) {
      this.fingerprints.set(goalPath, goalFp);
      const goal = readJson(goalPath);
      if (goal) {
        this.store.ingest({
          id: observationId('goal-file', goalPath, goalFp, project.project_id),
          source: 'project-artifact', kind: 'goal.updated', status: 'observed', actor: 'planning-observer',
          project_id: project.project_id, phase: 'PLAN',
          payload: {
            artifact: 'GOAL',
            text: goal.text,
            status: goal.status,
            planner: goal.planner,
            gsd_command: goal.gsd_command,
            project_name: project.name,
            project_cwd: project.cwd,
          },
          evidence: [{ label: 'goal', path: goalPath }],
        });
      }
    }
  }

  private async pollSkillClusterHealth(): Promise<void> {
    const path = this.options.skillIndexPath;
    if (!path) return;
    const fp = fingerprint(path);
    if (!fp || this.fingerprints.get(path) === fp) return;
    this.fingerprints.set(path, fp);
    const value = readJson(path);
    if (!value) return;
    const counts = value.counts && typeof value.counts === 'object' ? value.counts as Record<string, unknown> : {};
    const legacySkills = value.skills && typeof value.skills === 'object' ? value.skills as Record<string, unknown> : {};
    const numberOr = (value: unknown, fallback: number): number => typeof value === 'number' ? value : fallback;
    const activeFallback = numberOr(legacySkills.active, 0);
    const deferredFallback = numberOr(legacySkills.deferred, 0);
    const archivedFallback = numberOr(legacySkills.archived, 0);
    const total = numberOr(counts.total_indexed, numberOr(value.total, Object.keys(legacySkills).length));
    const clusters = numberOr(counts.clusters, numberOr(value.clusters, 0));
    const active = numberOr(counts['active-hub'], 0) + numberOr(counts['active-spoke'], activeFallback);
    const deferred = numberOr(counts['deferred-hub'], 0) + numberOr(counts['deferred-spoke'], deferredFallback);
    const archived = numberOr(counts.archived, archivedFallback);
    const project = identityForCwd(this.options.cwd);
    this.store.ingest({
      id: observationId('skill-cluster-summary-v2', path, fp, project.project_id),
      source: 'manifest', kind: 'skill.cluster.status', status: 'observed', actor: 'skill-cluster-observer',
      project_id: project.project_id,
      payload: {
        skill_id: 'skill-cluster-registry', registry_path: path, activation: 'read-only',
        total, clusters, active, deferred, archived,
        project_name: project.name, project_cwd: project.cwd,
      },
      evidence: [{ label: 'skill-cluster-index', path }],
    });
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
