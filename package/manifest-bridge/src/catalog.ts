import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeEvent } from './contract';
import { LEGACY_PROJECT_ID, type ProjectIdentity } from './project';
import { ManifestStore, STALE_AFTER_MS } from './store';
import type { ManifestEvent, ManifestState } from './types';

export interface ProjectSummary {
  project_id: string;
  name: string;
  cwd: string | null;
  initialized: boolean;
  visibility: ProjectVisibility;
  history_deleted_at?: string;
  event_count: number;
  last_event_at: string | null;
  freshness: ManifestState['freshness'];
}

export type ProjectVisibility = 'active' | 'archived' | 'unregistered';

interface RegistryRecord {
  project_id: string;
  name: string;
  cwd: string | null;
  initialized: boolean;
  visibility?: ProjectVisibility;
  history_deleted_at?: string;
}

type Listener = (event: ManifestEvent) => void;

export class ManifestCatalog {
  private readonly registryFile: string;
  private readonly projectsDir: string;
  private readonly retentionDir: string;
  private readonly records = new Map<string, RegistryRecord>();
  private readonly stores = new Map<string, ManifestStore>();
  private readonly listeners = new Set<Listener>();

  constructor(readonly root: string) {
    this.projectsDir = join(root, 'projects');
    this.retentionDir = join(root, 'retention');
    this.registryFile = join(root, 'projects.json');
    mkdirSync(this.projectsDir, { recursive: true });
    this.loadRegistry();
    if (existsSync(join(root, 'events.jsonl'))) {
      this.records.set(LEGACY_PROJECT_ID, { project_id: LEGACY_PROJECT_ID, name: 'Legacy / Unscoped', cwd: null, initialized: false, visibility: 'active' });
    }
    this.discoverProjectDirs();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ensureProject(identity: Pick<ProjectIdentity, 'project_id' | 'name'> & { cwd: string | null; schema?: ProjectIdentity['schema'] }, options: { reactivate?: boolean } = {}): ProjectSummary {
    if (!/^[a-zA-Z0-9._-]+$/.test(identity.project_id)) throw new Error(`unsafe project_id: ${identity.project_id}`);
    return this.withRegistryLock(() => {
      const previous = this.records.get(identity.project_id);
      if (previous?.history_deleted_at && !options.reactivate) throw new Error(`project history has been deleted; explicitly register the project again: ${identity.project_id}`);
      const record: RegistryRecord = {
        project_id: identity.project_id,
        name: identity.name || previous?.name || identity.project_id,
        cwd: identity.cwd || previous?.cwd || null,
        initialized: Boolean(identity.schema) || previous?.initialized === true,
        visibility: options.reactivate ? 'active' : previous?.visibility || 'active',
        history_deleted_at: options.reactivate ? undefined : previous?.history_deleted_at,
      };
      this.records.set(identity.project_id, record);
      this.persistRegistryUnlocked();
      return this.summary(record);
    });
  }

  ingest(input: unknown): { accepted: boolean; event?: ManifestEvent; error?: string } {
    try {
      const event = normalizeEvent(input);
      const projectId = event.project_id || LEGACY_PROJECT_ID;
      this.ensureProject({ project_id: projectId, name: typeof event.payload.project_name === 'string' ? event.payload.project_name : projectId, cwd: typeof event.payload.project_cwd === 'string' ? event.payload.project_cwd : null });
      const result = this.storeFor(projectId).ingest(event);
      if (result.accepted && result.event) for (const listener of this.listeners) {
        try { listener(result.event); } catch { /* observers are fail-open */ }
      }
      return result;
    } catch (error) {
      return { accepted: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  snapshot(projectId?: string): ManifestState {
    this.refresh();
    if (projectId && projectId !== 'all') return this.storeFor(projectId).state;
    return this.aggregate();
  }

  listProjects(): ProjectSummary[] {
    return this.listVisibleProjects();
  }

  listVisibleProjects(includeHidden = false): ProjectSummary[] {
    this.refresh();
    return [...this.records.values()]
      .filter((record) => includeHidden || (record.visibility || 'active') !== 'unregistered')
      .map((record) => this.summary(record))
      .sort((a, b) => (b.last_event_at || '').localeCompare(a.last_event_at || '') || a.name.localeCompare(b.name));
  }

  project(projectId: string, includeHidden = true): ProjectSummary | null {
    this.refresh();
    const record = this.records.get(projectId);
    if (!record || (!includeHidden && (record.visibility || 'active') === 'unregistered')) return null;
    return this.summary(record);
  }

  setVisibility(projectId: string, visibility: ProjectVisibility): ProjectSummary {
    return this.withRegistryLock(() => {
      const record = this.records.get(projectId);
      if (!record) throw new Error(`project not found: ${projectId}`);
      record.visibility = visibility;
      this.records.set(projectId, record);
      this.persistRegistryUnlocked();
      return this.summary(record);
    });
  }

  deleteManifestHistory(projectId: string, confirmation: string): { project_id: string; deleted_path: string } {
    if (!/^[a-zA-Z0-9._-]+$/.test(projectId) || projectId === LEGACY_PROJECT_ID) throw new Error('only a registered project manifest history can be deleted');
    if (confirmation !== projectId) throw new Error('delete confirmation must exactly match project_id');
    return this.withRegistryLock(() => {
      const record = this.records.get(projectId);
      if (!record) throw new Error(`project not found: ${projectId}`);
      if (record.visibility !== 'unregistered') throw new Error('project must be removed from the UI before its manifest history can be forgotten');
      const projectDir = join(this.projectsDir, projectId);
      mkdirSync(this.retentionDir, { recursive: true });
      const retainedPath = join(this.retentionDir, `${projectId}-${Date.now()}`);
      if (existsSync(projectDir)) renameSync(projectDir, retainedPath);
      record.history_deleted_at = new Date().toISOString();
      record.visibility = 'unregistered';
      this.records.set(projectId, record);
      this.stores.delete(projectId);
      this.persistRegistryUnlocked();
      return { project_id: projectId, deleted_path: retainedPath };
    });
  }

  get state(): ManifestState { this.refresh(); return this.aggregate(); }

  /** Reload registry metadata written by a separate `manifest-bridge init`. */
  refresh(): void {
    this.loadRegistry();
    this.discoverProjectDirs();
    if (existsSync(join(this.root, 'events.jsonl')) && !this.records.has(LEGACY_PROJECT_ID)) {
      this.records.set(LEGACY_PROJECT_ID, { project_id: LEGACY_PROJECT_ID, name: 'Legacy / Unscoped', cwd: null, initialized: false, visibility: 'active' });
    }
    for (const store of this.stores.values()) {
      for (const event of store.replay()) for (const listener of this.listeners) {
        try { listener(event); } catch { /* observers are fail-open */ }
      }
    }
  }

  private storeFor(projectId: string): ManifestStore {
    if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) throw new Error(`unsafe project_id: ${projectId}`);
    const existing = this.stores.get(projectId);
    if (existing) return existing;
    const file = projectId === LEGACY_PROJECT_ID ? join(this.root, 'events.jsonl') : join(this.projectsDir, projectId, 'events.jsonl');
    const store = new ManifestStore(file, projectId === LEGACY_PROJECT_ID ? undefined : projectId);
    this.stores.set(projectId, store);
    return store;
  }

  private summary(record: RegistryRecord): ProjectSummary {
    const state = this.storeFor(record.project_id).state;
    return { ...record, visibility: record.visibility || 'active', event_count: state.event_count, last_event_at: state.last_event_at, freshness: state.freshness };
  }

  private aggregate(): ManifestState {
    const states = [...this.records.keys()].map((id) => this.storeFor(id).state);
    const merged: ManifestState = {
      schema: 'temperance.manifest.state.v1', generated_at: new Date().toISOString(), last_event_at: null, event_count: 0,
      freshness: { status: 'empty', age_ms: null, stale_after_ms: STALE_AFTER_MS }, projects: {}, sessions: {}, agents: {}, waves: {}, plans: {}, approvals: {}, skills: {}, dispatches: {}, reports: {}, routes: {}, codegraph: {}, workflows: {}, evidence: {}, alerts: [], recent_events: [],
    };
    for (const state of states) {
      merged.event_count += state.event_count;
      if (!merged.last_event_at || (state.last_event_at && state.last_event_at > merged.last_event_at)) merged.last_event_at = state.last_event_at;
      Object.assign(merged.projects, state.projects); Object.assign(merged.sessions, state.sessions); Object.assign(merged.agents, state.agents); Object.assign(merged.waves, state.waves); Object.assign(merged.plans, state.plans); Object.assign(merged.approvals, state.approvals); Object.assign(merged.skills, state.skills); Object.assign(merged.dispatches, state.dispatches); Object.assign(merged.reports, state.reports); Object.assign(merged.routes, state.routes); Object.assign(merged.codegraph, state.codegraph); Object.assign(merged.workflows, state.workflows); Object.assign(merged.evidence, state.evidence);
      merged.alerts.push(...state.alerts); merged.recent_events.push(...state.recent_events);
    }
    merged.recent_events.sort((a, b) => a.ts.localeCompare(b.ts)); merged.recent_events = merged.recent_events.slice(-200); merged.alerts = merged.alerts.sort((a, b) => String(a.ts).localeCompare(String(b.ts))).slice(-100);
    const last = merged.last_event_at ? Date.parse(merged.last_event_at) : null;
    const age = last === null ? null : Math.max(0, Date.now() - last);
    merged.freshness = { status: age === null ? 'empty' : age > STALE_AFTER_MS ? 'stale' : 'fresh', age_ms: age, stale_after_ms: STALE_AFTER_MS };
    return merged;
  }

  private loadRegistry(): void {
    try {
      const values = JSON.parse(readFileSync(this.registryFile, 'utf8')) as RegistryRecord[];
      if (Array.isArray(values)) for (const value of values) if (value?.project_id && /^[a-zA-Z0-9._-]+$/.test(value.project_id)) this.records.set(value.project_id, { ...value, visibility: value.visibility || 'active' });
    } catch { /* first run */ }
  }

  private discoverProjectDirs(): void {
    try {
      for (const name of readdirSync(this.projectsDir)) if (!this.records.has(name)) this.records.set(name, { project_id: name, name, cwd: null, initialized: false, visibility: 'active' });
    } catch { /* first run */ }
  }

  private persistRegistryUnlocked(): void {
    mkdirSync(this.root, { recursive: true });
    const temporary = `${this.registryFile}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify([...this.records.values()], null, 2)}\n`, 'utf8');
    renameSync(temporary, this.registryFile);
  }

  private withRegistryLock<T>(work: () => T): T {
    const lock = `${this.registryFile}.lock`;
    const deadline = Date.now() + 2000;
    const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
    while (true) {
      try {
        mkdirSync(lock);
        break;
      } catch {
        try {
          if (Date.now() - statSync(lock).mtimeMs > 10000) rmSync(lock, { recursive: true, force: true });
        } catch { /* another writer may be replacing the lock */ }
        if (Date.now() >= deadline) throw new Error(`manifest registry lock timeout: ${lock}`);
        Atomics.wait(waitBuffer, 0, 0, 10);
      }
    }
    try {
      this.loadRegistry();
      this.discoverProjectDirs();
      return work();
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }
}
