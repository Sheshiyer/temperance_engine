import { useMemo, useState } from 'react'
import { CircleAlert, GitBranch, Network, ShieldCheck } from 'lucide-react'
import { GraphCanvas, type GraphSelection } from './GraphCanvas'
import { buildGraphViews, type GraphView } from './graphModel'
import { formatTime, projectDisplay, type ManifestEvent, type ManifestSnapshot, type ProjectSummary } from './manifest'

interface GraphDeckProps {
  snapshot: ManifestSnapshot
  projects: ProjectSummary[]
  activeProjectId: string
  selectedEvent: ManifestEvent | null
  onSelectEvent: (event: ManifestEvent | null) => void
}

const VIEW_ICONS = { architecture: Network, phases: GitBranch, execution: Network, evidence: ShieldCheck, ops: CircleAlert }

function SelectionInspector({ selection, view, snapshot, projects, activeProjectId, onClose }: { selection: GraphSelection | null; view: GraphView; snapshot: ManifestSnapshot; projects: ProjectSummary[]; activeProjectId: string; onClose: () => void }) {
  if (!selection) return <div className="graph-inspector-empty"><span className="section-kicker">GRAPH INSPECTOR</span><strong>SELECT A NODE OR RELATIONSHIP</strong><small>Every selection carries its basis, source, and bounded evidence pointers.</small></div>
  const provenance = selection.provenance
  return <div className="graph-inspector"><div className="graph-inspector-head"><div><span className="section-kicker">{selection.type.toUpperCase()} / {view.id.toUpperCase()}</span><strong>{selection.label}</strong></div><button type="button" className="icon-button" aria-label="Close graph inspector" onClick={onClose}>×</button></div><div className="detail-grid"><span>BASIS</span><strong>{provenance.basis}</strong><span>SOURCE</span><strong>{provenance.source}</strong><span>EVENTS</span><strong>{provenance.eventIds.length || 'NONE'}</strong><span>SCOPE</span><strong>{projectDisplay(projects, activeProjectId === 'all' ? undefined : activeProjectId)}</strong><span>FRESHNESS</span><strong>{snapshot.freshness.status}</strong><span>OBSERVED</span><strong>{formatTime(provenance.observedAt)}</strong></div>{provenance.eventIds.length ? <div className="graph-evidence-note">Event-backed selection. Use the Evidence page for the full bounded event payload and source pointers.</div> : <div className="graph-evidence-note">Structural and derived relationships describe the native system; they are not claims of runtime observation.</div>}{provenance.evidence.length ? <div className="source-pointers"><span className="section-kicker">EVIDENCE POINTERS</span>{provenance.evidence.map((evidence) => <div key={`${evidence.label}-${evidence.path || evidence.url}`}><span>{evidence.label}</span><small>{evidence.path || evidence.url || 'unlinked evidence'}</small></div>)}</div> : null}</div>
}

export function GraphDeck({ snapshot, projects, activeProjectId, selectedEvent, onSelectEvent }: GraphDeckProps) {
  const views = useMemo(() => buildGraphViews(snapshot, activeProjectId), [snapshot, activeProjectId])
  const [activeGraphId, setActiveGraphId] = useState('architecture')
  const [selection, setSelection] = useState<GraphSelection | null>(null)
  const view = views.find((candidate) => candidate.id === activeGraphId) || views[0]
  const select = (next: GraphSelection) => {
    setSelection(next)
    const eventId = next.provenance.eventIds[0]
    const event = eventId ? snapshot.recent_events.find((candidate) => candidate.id === eventId) : undefined
    if (event) onSelectEvent(event)
  }
  return <div className="page-stack graph-deck"><section className="panel graph-deck-header"><div><span className="section-kicker">LIVE MANIFEST / GRAPH DECK</span><h2>See the system, <em>as it connects.</em></h2><p>One projection model for architecture, phases, execution, evidence, and delivery surfaces.</p></div><div className="graph-deck-state"><span className={`health-dot ${snapshot.freshness.status}`}></span><strong>{snapshot.freshness.status.toUpperCase()}</strong><small>{snapshot.event_count} accepted events · {selectedEvent ? 'event selected' : 'no event selected'}</small></div></section><section className="panel graph-deck-panel"><div className="graph-tabs" role="tablist" aria-label="Graph projections">{views.map((candidate) => { const Icon = VIEW_ICONS[candidate.id as keyof typeof VIEW_ICONS]; const selected = candidate.id === view.id; return <button type="button" role="tab" aria-selected={selected} className={selected ? 'selected' : ''} key={candidate.id} onClick={() => { setActiveGraphId(candidate.id); setSelection(null) }}><Icon size={14} /><span>{candidate.title}</span></button> })}</div><div className="graph-view-heading"><div><span className="section-kicker">{view.id.toUpperCase()} / {view.completeness.sourceEventCount} SOURCE EVENTS</span><h3>{view.title}</h3><p>{view.description}</p></div><span className={`status-pill ${view.freshness}`}>{view.freshness}</span></div><GraphCanvas view={view} selectedId={selection?.id} onSelect={select} />{view.warnings.length ? <div className="graph-warning"><CircleAlert size={14} /><span>{view.warnings.join(' ')}</span></div> : null}</section><aside className="panel graph-inspector-panel"><SelectionInspector selection={selection} view={view} snapshot={snapshot} projects={projects} activeProjectId={activeProjectId} onClose={() => setSelection(null)} /></aside></div>
}
