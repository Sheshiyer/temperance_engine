import type { ManifestEvent, ManifestSnapshot } from './manifest'

export function isRealProjectId(id: string | null | undefined): boolean {
  return Boolean(id && id !== 'all')
}

export function scopeQuery(id: string | null | undefined): string | null {
  return isRealProjectId(id) ? `?project_id=${encodeURIComponent(id as string)}` : null
}

function pickRecords(records: Record<string, Record<string, unknown>> | undefined, projectId: string): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(records || {}).filter(([, record]) => {
    const value = record?.project_id
    return typeof value !== 'string' || value === projectId
  }))
}

export function scopeSnapshot(snapshot: ManifestSnapshot, projectId: string): ManifestSnapshot {
  if (!isRealProjectId(projectId)) return snapshot
  const recent_events = (snapshot.recent_events || []).filter((event: ManifestEvent) => event.project_id === projectId)
  const leaked = (snapshot.recent_events || []).some((event) => event.project_id !== projectId)
  const projects = snapshot.projects && projectId in snapshot.projects
    ? { [projectId]: snapshot.projects[projectId] }
    : {}
  return {
    ...snapshot,
    recent_events,
    agents: pickRecords(snapshot.agents, projectId),
    plans: pickRecords(snapshot.plans, projectId),
    waves: pickRecords(snapshot.waves, projectId),
    sessions: pickRecords(snapshot.sessions, projectId),
    approvals: pickRecords(snapshot.approvals, projectId),
    projects,
    event_count: leaked ? recent_events.length : snapshot.event_count,
  }
}
