export const EVENT_SCHEMA = 'temperance.manifest.event.v1' as const;
export const STATE_SCHEMA = 'temperance.manifest.state.v1' as const;

export type EventStatus = 'observed' | 'derived' | 'synthetic' | 'stale' | 'failed';
export type EventSource = 'pai-hook' | 'temperance-router' | 'omniroute' | 'project-artifact' | 'codegraph' | 'manifest';
export type AlgorithmPhase = 'OBSERVE' | 'THINK' | 'PLAN' | 'BUILD' | 'EXECUTE' | 'VERIFY' | 'LEARN';

export interface EvidencePointer {
  label: string;
  path?: string;
  url?: string;
  line?: number;
}

export interface ManifestEvent {
  schema: typeof EVENT_SCHEMA;
  id: string;
  ts: string;
  source: EventSource;
  kind: string;
  status: EventStatus;
  project_id?: string;
  task_id?: string;
  session_id?: string;
  agent_id?: string;
  correlation_id?: string;
  phase?: AlgorithmPhase;
  actor?: string;
  payload: Record<string, unknown>;
  evidence: EvidencePointer[];
  redaction: 'bounded-preview';
  fresh_until?: string;
  seq?: number;
}

export interface ManifestState {
  schema: typeof STATE_SCHEMA;
  generated_at: string;
  last_event_at: string | null;
  event_count: number;
  freshness: {
    status: 'empty' | 'fresh' | 'stale';
    age_ms: number | null;
    stale_after_ms: number;
  };
  projects: Record<string, Record<string, unknown>>;
  sessions: Record<string, Record<string, unknown>>;
  agents: Record<string, Record<string, unknown>>;
  waves: Record<string, Record<string, unknown>>;
  plans: Record<string, Record<string, unknown>>;
  approvals: Record<string, Record<string, unknown>>;
  skills: Record<string, Record<string, unknown>>;
  dispatches: Record<string, Record<string, unknown>>;
  reports: Record<string, Record<string, unknown>>;
  routes: Record<string, Record<string, unknown>>;
  codegraph: Record<string, Record<string, unknown>>;
  workflows: Record<string, Record<string, unknown>>;
  evidence: Record<string, Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  recent_events: ManifestEvent[];
}
