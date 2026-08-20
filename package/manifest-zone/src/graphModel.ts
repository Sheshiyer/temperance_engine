import { PHASES, currentPhase, type EvidencePointer, type ManifestEvent, type ManifestSnapshot, type Phase } from './manifest'
import { isRealProjectId } from './scopeSnapshot'

export type GraphBasis = 'observed' | 'derived' | 'structural'
export type GraphTone = 'cyan' | 'orange' | 'magenta' | 'violet' | 'mint'

export interface GraphProvenance {
  basis: GraphBasis
  source: string
  eventIds: string[]
  evidence: EvidencePointer[]
  observedAt?: string
}

export interface GraphNode {
  id: string
  kind: string
  label: string
  detail: string
  status: string
  tone: GraphTone
  x: number
  y: number
  width: number
  height: number
  provenance: GraphProvenance
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  kind: string
  label: string
  tone: GraphTone
  provenance: GraphProvenance
}

export interface GraphView {
  id: string
  title: string
  description: string
  accent: GraphTone
  freshness: ManifestSnapshot['freshness']['status']
  completeness: { truncated: boolean; sourceEventCount: number }
  warnings: string[]
  nodes: GraphNode[]
  edges: GraphEdge[]
}

type RecordMap = Record<string, Record<string, unknown>>

const EMPTY_PROVENANCE = (basis: GraphBasis, source: string): GraphProvenance => ({ basis, source, eventIds: [], evidence: [] })

function entries(records: RecordMap): Array<[string, Record<string, unknown>]> {
  return Object.entries(records)
}

function stringValue(record: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

function numberValue(record: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function statusValue(record: Record<string, unknown> | undefined, fallback: string): string {
  return stringValue(record, 'status', stringValue(record, 'state', fallback)).toLowerCase()
}

function evidenceValue(record: Record<string, unknown> | undefined): EvidencePointer[] {
  const evidence = record?.evidence
  if (!Array.isArray(evidence)) return []
  return evidence.filter((item): item is EvidencePointer => typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).label === 'string')
}

function scoped(record: Record<string, unknown>, activeProjectId: string): boolean {
  if (!isRealProjectId(activeProjectId)) return false
  const projectId = record.project_id
  return typeof projectId !== 'string' || projectId === activeProjectId
}

function bounded<T>(items: T[], limit = 12): T[] {
  return items.slice(0, limit)
}

function node(input: Omit<GraphNode, 'width' | 'height'>): GraphNode {
  return { ...input, width: 176, height: 72 }
}

function eventProvenance(event: ManifestEvent): GraphProvenance {
  return { basis: 'observed', source: event.source, eventIds: [event.id], evidence: event.evidence || [], observedAt: event.ts }
}

function structuralEdge(id: string, from: string, to: string, label: string, tone: GraphTone = 'violet'): GraphEdge {
  return { id, from, to, kind: 'system relationship', label, tone, provenance: EMPTY_PROVENANCE('structural', 'console architecture') }
}

function derivedEdge(id: string, from: string, to: string, label: string, tone: GraphTone, eventIds: string[] = []): GraphEdge {
  return { id, from, to, kind: 'derived relationship', label, tone, provenance: { basis: 'derived', source: 'manifest projection', eventIds, evidence: [] } }
}

function baseView(id: string, title: string, description: string, snapshot: ManifestSnapshot, accent: GraphTone, nodes: GraphNode[], edges: GraphEdge[], warnings: string[] = []): GraphView {
  return { id, title, description, accent, freshness: snapshot.freshness.status, completeness: { truncated: snapshot.recent_events.length >= 200, sourceEventCount: snapshot.event_count }, warnings, nodes, edges }
}

function architectureView(snapshot: ManifestSnapshot): GraphView {
  const nodes: GraphNode[] = [
    node({ id: 'system/pai', kind: 'system', label: 'PAI', detail: 'algorithm substrate', status: 'structural', tone: 'magenta', x: 20, y: 132, provenance: EMPTY_PROVENANCE('structural', 'console architecture') }),
    node({ id: 'system/temperance', kind: 'system', label: 'TEMPERANCE', detail: 'operator engine', status: 'structural', tone: 'violet', x: 220, y: 132, provenance: EMPTY_PROVENANCE('structural', 'console architecture') }),
    node({ id: 'system/bridge', kind: 'system', label: 'MANIFEST BRIDGE', detail: `${snapshot.event_count} accepted events`, status: snapshot.freshness.status, tone: 'cyan', x: 420, y: 132, provenance: { basis: 'derived', source: 'manifest snapshot', eventIds: [], evidence: [], observedAt: snapshot.generated_at } }),
    node({ id: 'system/ui', kind: 'system', label: 'LCARS CONSOLE', detail: 'projection surface', status: 'structural', tone: 'cyan', x: 620, y: 132, provenance: EMPTY_PROVENANCE('structural', 'console architecture') }),
    node({ id: 'system/hooks', kind: 'system', label: 'HOOK PLANE', detail: 'lifecycle signals', status: 'structural', tone: 'mint', x: 220, y: 252, provenance: EMPTY_PROVENANCE('structural', 'console architecture') }),
  ]
  const edges: GraphEdge[] = [
    structuralEdge('edge/pai-temperance', 'system/pai', 'system/temperance', 'drives'),
    structuralEdge('edge/temperance-bridge', 'system/temperance', 'system/bridge', 'projects'),
    structuralEdge('edge/bridge-ui', 'system/bridge', 'system/ui', 'renders', 'cyan'),
    structuralEdge('edge/hooks-pai', 'system/hooks', 'system/pai', 'signals', 'mint'),
  ]
  const addRegistry = (prefix: string, kind: string, label: string, records: RecordMap, tone: GraphTone, source: string) => {
    bounded(entries(records), 4).forEach(([id, record], index) => {
      const nodeId = `${prefix}/${id}`
      nodes.push(node({ id: nodeId, kind, label: stringValue(record, 'project_name', stringValue(record, 'name', id)), detail: `${numberValue(record, 'nodes', numberValue(record, 'artifact_count', 1))} ${label}`, status: statusValue(record, 'observed'), tone, x: 620 + (index % 2) * 190, y: 16 + Math.floor(index / 2) * 76, provenance: { basis: 'observed', source, eventIds: [], evidence: evidenceValue(record), observedAt: stringValue(record, 'last_event_at', snapshot.generated_at) } }))
      edges.push({ id: `edge/bridge-${prefix}-${id}`, from: 'system/bridge', to: nodeId, kind: 'observed source', label, tone, provenance: { basis: 'observed', source, eventIds: [], evidence: evidenceValue(record), observedAt: stringValue(record, 'last_event_at', snapshot.generated_at) } })
    })
  }
  addRegistry('codegraph', 'codegraph', 'graph nodes', snapshot.codegraph || {}, 'violet', 'codegraph')
  addRegistry('gsd', 'workflow', 'artifacts', snapshot.workflows || {}, 'orange', 'gsd')
  addRegistry('skill', 'skill', 'registered skill', snapshot.skills, 'magenta', 'skill-clusters')
  addRegistry('route', 'route', 'route', snapshot.routes, 'mint', 'omniroute')
  return baseView('architecture', 'System architecture', 'Source ownership, projections, and observed integration surfaces.', snapshot, 'violet', nodes, edges, snapshot.freshness.status === 'stale' ? ['Bridge snapshot is stale; observed source nodes are historical.'] : [])
}

function phaseView(snapshot: ManifestSnapshot): GraphView {
  const phase = currentPhase(snapshot)
  const nodes = PHASES.map((item, index) => node({ id: `phase/${item.toLowerCase()}`, kind: 'phase', label: item, detail: index === phaseIndex(phase) ? 'current phase' : index < phaseIndex(phase) ? 'completed' : 'pending', status: index === phaseIndex(phase) ? 'current' : index < phaseIndex(phase) ? 'complete' : 'pending', tone: index === phaseIndex(phase) ? 'cyan' : 'magenta', x: 20 + index * 160, y: 130, provenance: { basis: 'derived', source: 'recent events', eventIds: snapshot.recent_events.filter((event) => event.phase === item).slice(-3).map((event) => event.id), evidence: [], observedAt: snapshot.last_event_at || undefined } }))
  const edges = PHASES.slice(1).map((item, index) => derivedEdge(`edge/phase-${index}`, `phase/${PHASES[index].toLowerCase()}`, `phase/${item.toLowerCase()}`, 'next', 'cyan'))
  return baseView('phases', 'Alchemical phase state', 'Canonical PAI phase order with the current phase derived from observed events.', snapshot, 'cyan', nodes, edges, snapshot.freshness.status === 'empty' ? ['No phase telemetry has been observed.'] : [])
}

function executionView(snapshot: ManifestSnapshot, activeProjectId: string): GraphView {
  const nodes: GraphNode[] = [node({ id: 'execution/bridge', kind: 'system', label: 'EVENT PLANE', detail: `${snapshot.event_count} events`, status: snapshot.freshness.status, tone: 'cyan', x: 20, y: 134, provenance: { basis: 'derived', source: 'manifest snapshot', eventIds: [], evidence: [], observedAt: snapshot.generated_at } })]
  const edges: GraphEdge[] = []
  const add = (prefix: string, kind: string, records: RecordMap, title: string, tone: GraphTone, x: number) => bounded(entries(records).filter(([, record]) => scoped(record, activeProjectId)), 4).forEach(([id, record], index) => { const nodeId = `${prefix}/${id}`; nodes.push(node({ id: nodeId, kind, label: stringValue(record, 'name', stringValue(record, 'agent_id', stringValue(record, 'session_id', id))), detail: `${title} · ${statusValue(record, 'observed')}`, status: statusValue(record, 'observed'), tone, x, y: 28 + index * 82, provenance: { basis: 'observed', source: prefix, eventIds: [], evidence: evidenceValue(record), observedAt: stringValue(record, 'last_event_at', snapshot.generated_at) } })); edges.push({ id: `edge/execution-${prefix}-${id}`, from: 'execution/bridge', to: nodeId, kind: 'observed execution', label: title, tone, provenance: { basis: 'observed', source: prefix, eventIds: [], evidence: evidenceValue(record), observedAt: stringValue(record, 'last_event_at', snapshot.generated_at) } }) })
  add('session', 'session', snapshot.sessions, 'session', 'magenta', 230)
  add('agent', 'agent', snapshot.agents, 'agent', 'mint', 430)
  add('route', 'route', snapshot.routes, 'route', 'violet', 630)
  return baseView('execution', 'Execution and routing', 'Observed sessions, agents, and OmniRoute surfaces connected to the event plane.', snapshot, 'mint', nodes, edges)
}

function evidenceView(snapshot: ManifestSnapshot, activeProjectId: string): GraphView {
  const sourceIds = new Map<string, string>()
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const events = isRealProjectId(activeProjectId)
    ? snapshot.recent_events.filter((event) => event.project_id === activeProjectId)
    : []
  bounded([...events].reverse(), 14).forEach((event, index) => {
    const sourceId = sourceIds.get(event.source) || `evidence/source/${event.source}`
    if (!sourceIds.has(event.source)) { sourceIds.set(event.source, sourceId); nodes.push(node({ id: sourceId, kind: 'source', label: event.source, detail: 'observed source', status: 'observed', tone: 'magenta', x: 20, y: 20 + sourceIds.size * 78, provenance: { basis: 'observed', source: event.source, eventIds: [event.id], evidence: event.evidence || [], observedAt: event.ts } })) }
    const eventId = `evidence/event/${event.id}`
    nodes.push(node({ id: eventId, kind: 'event', label: event.kind.replace(/[._-]+/g, ' ').toUpperCase(), detail: `${event.status} · ${event.ts.slice(11, 19)}`, status: event.status, tone: eventTone(event), x: 300 + (index % 3) * 220, y: 20 + Math.floor(index / 3) * 78, provenance: eventProvenance(event) }))
    edges.push({ id: `edge/evidence-${event.id}`, from: sourceId, to: eventId, kind: 'event evidence', label: 'emitted', tone: eventTone(event), provenance: eventProvenance(event) })
  })
  return baseView('evidence', 'Evidence lineage', 'Recent bounded events connected to their source ownership and evidence pointers.', snapshot, 'magenta', nodes, edges, snapshot.recent_events.length >= 200 ? ['Recent events are bounded to the bridge retention window.'] : [])
}

function opsView(snapshot: ManifestSnapshot): GraphView {
  const registries: Array<[string, string, RecordMap, string, GraphTone]> = [
    ['ops/bridge', 'MANIFEST BRIDGE', {}, 'runtime', 'cyan'],
    ['ops/codegraph', 'CODEGRAPH', snapshot.codegraph || {}, 'projects', 'violet'],
    ['ops/gsd', 'GSD', snapshot.workflows || {}, 'workflows', 'orange'],
    ['ops/skills', 'SKILL CLUSTERS', snapshot.skills, 'skills', 'magenta'],
    ['ops/routes', 'OMNIROUTE', snapshot.routes, 'routes', 'mint'],
  ]
  const nodes = registries.map(([id, label, records, unit, tone], index) => node({ id, kind: 'ops', label, detail: id === 'ops/bridge' ? `${snapshot.freshness.status} · ${snapshot.event_count} events` : `${Object.keys(records).length} ${unit}`, status: id === 'ops/bridge' ? snapshot.freshness.status : Object.keys(records).length ? 'observed' : 'empty', tone, x: 20 + (index % 3) * 250, y: 60 + Math.floor(index / 3) * 120, provenance: { basis: id === 'ops/bridge' ? 'derived' : 'observed', source: label.toLowerCase(), eventIds: [], evidence: [], observedAt: snapshot.generated_at } }))
  const edges = registries.slice(1).map(([id, , , , tone]) => ({ id: `edge/ops-${id}`, from: 'ops/bridge', to: id, kind: 'operational source', label: 'health surface', tone, provenance: EMPTY_PROVENANCE('derived', 'manifest snapshot') }))
  return baseView('ops', 'Operations and delivery', 'Freshness, source registries, and route readiness across the native system.', snapshot, 'orange', nodes, edges)
}

function phaseIndex(phase: Phase): number { return PHASES.indexOf(phase) }
function eventTone(event: ManifestEvent): GraphTone { if (event.status === 'failed' || event.kind.includes('alert')) return 'orange'; if (event.kind.includes('decision') || event.kind.includes('prompt') || event.kind.includes('algorithm')) return 'magenta'; if (event.kind.includes('route') || event.source === 'omniroute') return 'violet'; if (event.kind.includes('agent') || event.kind.includes('wave')) return 'mint'; return 'cyan' }

export function buildGraphViews(snapshot: ManifestSnapshot, activeProjectId: string): GraphView[] {
  return [architectureView(snapshot), phaseView(snapshot), executionView(snapshot, activeProjectId), evidenceView(snapshot, activeProjectId), opsView(snapshot)]
}
