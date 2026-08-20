import { useEffect, useState } from 'react'
import { useCompact } from './useViewport'
import { Activity, ChevronRight, Eye, Menu, Network, Radio, RefreshCw, ShieldCheck, Target, X, Zap } from 'lucide-react'
import './App.css'
import './projectActions.css'
import { PHASES, currentPhase, phaseIndex, projectScopeLabel, type ManifestEvent, type Phase, type ViewId } from './manifest'
import type { PaiSessionMode } from './SkillWorkflowDeck'
import { EvidencePage, ExecutionPage, GraphDeckPage, OpsDeliveryPage, OverviewPage, PlanningPage } from './pages'
import { useManifestRuntime } from './useManifestRuntime'
import { ProjectActionRail } from './ProjectActionRail'

const NAV_ITEMS: Array<{ id: ViewId; icon: typeof Eye; label: string }> = [
  { id: 'OVERVIEW', icon: Eye, label: 'OVERVIEW' },
  { id: 'GRAPH DECK', icon: Network, label: 'GRAPH DECK' },
  { id: 'PLANNING', icon: Target, label: 'PLANNING' },
  { id: 'EXECUTION', icon: Zap, label: 'EXECUTION' },
  { id: 'EVIDENCE', icon: ShieldCheck, label: 'EVIDENCE' },
  { id: 'OPS / DELIVERY', icon: Radio, label: 'OPS / DELIVERY' },
]

const PAGE_META: Record<ViewId, { eyebrow: string; title: string; emphasis: string; subtitle: string }> = {
  OVERVIEW: { eyebrow: 'SPECULUM / OVERVIEW', title: 'Operational reality,', emphasis: 'in view.', subtitle: 'Planning, execution, operations, and delivery joined by evidence.' },
  'GRAPH DECK': { eyebrow: 'SPECULUM / GRAPH', title: 'See the system,', emphasis: 'as it connects.', subtitle: 'Architecture, phases, execution, evidence, and delivery on one live projection model.' },
  PLANNING: { eyebrow: 'SPECULUM / PLANNING', title: 'Make the next move,', emphasis: 'legible.', subtitle: 'Project rails, waves, phases, and session intent from observed artifacts.' },
  EXECUTION: { eyebrow: 'SPECULUM / EXECUTION', title: 'See the fleet,', emphasis: 'as it moves.', subtitle: 'Agents, sessions, routes, and lifecycle signals without invented health.' },
  EVIDENCE: { eyebrow: 'SPECULUM / EVIDENCE', title: 'Trust the trace,', emphasis: 'not the story.', subtitle: 'Every visible claim resolves to a bounded event or source pointer.' },
  'OPS / DELIVERY': { eyebrow: 'SPECULUM / OPS', title: 'Keep the plane,', emphasis: 'honest.', subtitle: 'Freshness, source mix, alerts, and delivery readiness for the operator.' },
}

const PHASE_VIEWS: Record<Phase, ViewId> = {
  OBSERVE: 'OVERVIEW', THINK: 'GRAPH DECK', PLAN: 'PLANNING', BUILD: 'GRAPH DECK', EXECUTE: 'EXECUTION', VERIFY: 'EVIDENCE', LEARN: 'OPS / DELIVERY',
}

const PAI_MODES: Array<{ id: PaiSessionMode; label: string; note: string }> = [
  { id: 'MINIMAL', label: 'MINIMAL', note: 'ack only' },
  { id: 'NATIVE', label: 'NATIVE', note: 'one spoke' },
  { id: 'ALGORITHM', label: 'ALGORITHM', note: 'full cluster' },
]

function locationQuery(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

function parseView(value: string | null | undefined): ViewId | null {
  if (!value) return null
  let raw = value.trim()
  try { raw = decodeURIComponent(raw) } catch { /* keep raw */ }
  raw = raw.replace(/^\//, '').replace(/\+/g, ' ').trim().toUpperCase()
  return NAV_ITEMS.find((item) => item.id === raw)?.id ?? null
}

function parseMode(value: string | null | undefined): PaiSessionMode | null {
  const mode = value?.trim().toUpperCase()
  return mode === 'MINIMAL' || mode === 'NATIVE' || mode === 'ALGORITHM' ? mode : null
}

function viewFromLocation(): ViewId | null {
  return parseView(locationQuery().get('view')) || parseView(window.location.hash.replace(/^#\/?/, ''))
}

function writeLocation(patch: { view?: ViewId; mode?: PaiSessionMode; project?: string; gsd?: string | null }, historyMode: 'push' | 'replace'): void {
  const url = new URL(window.location.href)
  if (patch.view) url.searchParams.set('view', patch.view)
  if (patch.mode) url.searchParams.set('mode', patch.mode)
  if (patch.project !== undefined) {
    if (patch.project && patch.project !== 'all') url.searchParams.set('project', patch.project)
    else url.searchParams.delete('project')
  }
  if (patch.gsd !== undefined) {
    if (patch.gsd) url.searchParams.set('gsd', patch.gsd)
    else url.searchParams.delete('gsd')
  }
  const next = `${url.pathname}${url.search}${url.hash}`
  const state = { view: url.searchParams.get('view'), mode: url.searchParams.get('mode'), project: url.searchParams.get('project'), gsd: url.searchParams.get('gsd') }
  if (historyMode === 'push') window.history.pushState(state, '', next)
  else window.history.replaceState(state, '', next)
}

function ModeStrip({ mode }: { mode: PaiSessionMode }) {
  const compact = useCompact()
  const [expanded, setExpanded] = useState(false)
  const showAll = !compact || expanded
  return <div className={`mode-strip bound ${compact && !expanded ? 'compact' : ''}`} role="status" aria-label={`PAI mode ${mode} already bound`}>
    {PAI_MODES.filter((item) => showAll || item.id === mode).map((item) => <span className={`mode-segment ${item.id === mode ? 'selected' : ''}`} key={item.id}><span className="mode-label">{item.label}</span><small>{item.note}</small></span>)}
    <small className="mode-bind-note">/{mode === 'ALGORITHM' ? 'gsd:goal' : 'gsd:*'} already binds {mode}. Not a picker.</small>
    {compact && <button type="button" className="mode-expand" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? 'HIDE MODES' : 'ALL MODES'}</button>}
  </div>
}

function PhaseStrip({ phase, focusedPhase, onSelect, expanded, onToggle }: { phase: Phase; focusedPhase: Phase; onSelect: (phase: Phase) => void; expanded: boolean; onToggle: () => void }) {
  const position = phaseIndex(phase)
  return <div className={`phase-strip ${expanded ? 'expanded' : 'compact'}`} role="tablist" aria-label="Algorithm phase workspaces">
    {PHASES.map((item, index) => {
      const state = index < position ? 'complete' : index === position ? 'current' : 'pending'
      const salient = item === phase || item === focusedPhase
      return <button type="button" role="tab" aria-selected={item === focusedPhase} aria-current={item === phase ? 'step' : undefined} className={`phase-segment ${state} ${item === focusedPhase ? 'focused' : ''} ${salient ? 'salient' : ''}`} key={item} onClick={() => onSelect(item)}><span className="phase-index">0{index + 1}</span><span>{item}</span>{state === 'current' && <span className="phase-live">NOW</span>}{item === focusedPhase && item !== phase && <span className="phase-focus">FOCUS</span>}</button>
    })}
    <button type="button" className="phase-expand" aria-expanded={expanded} onClick={onToggle}>{expanded ? 'COLLAPSE PHASES' : 'ALL 7 PHASES'}</button>
  </div>
}

function RailPhaseContext({ phase, focusedPhase }: { phase: Phase; focusedPhase: Phase }) {
  return <section className="rail-phase-context" aria-label="Runtime phase context"><div className="rail-section-label phase-label">RUNTIME STATE</div><div className="rail-phase-card"><div><span>NOW</span><strong>{phase}</strong></div><div><span>FOCUS</span><strong>{focusedPhase}</strong></div></div><small className="rail-phase-hint">Use the top phase strip to navigate.</small></section>
}

export default function ManifestCircuit() {
  const runtime = useManifestRuntime()
  const [activeView, setActiveView] = useState<ViewId>(() => viewFromLocation() || 'PLANNING')
  const [focusedPhase, setFocusedPhase] = useState<Phase | null>(null)
  const [sessionMode, setSessionMode] = useState<PaiSessionMode>(() => parseMode(locationQuery().get('mode')) || 'NATIVE')
  const [selectedGsd, setSelectedGsd] = useState<string | null>(() => locationQuery().get('gsd'))
  const [mobileMenu, setMobileMenu] = useState(false)
  const [phasesExpanded, setPhasesExpanded] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<ManifestEvent | null>(null)
  const compact = useCompact()
  const meta = PAGE_META[activeView]
  const phase = currentPhase(runtime.snapshot)
  const selectedPhase = focusedPhase || phase

  const setActiveProjectId = runtime.setActiveProjectId

  useEffect(() => {
    const onPopState = () => {
      const query = locationQuery()
      const view = viewFromLocation()
      const mode = parseMode(query.get('mode'))
      const project = query.get('project')
      const gsd = query.get('gsd')
      if (view) setActiveView(view)
      else if (gsd) setActiveView('PLANNING')
      if (mode) setSessionMode(mode)
      if (project && project !== 'all') setActiveProjectId(project)
      setSelectedGsd(gsd)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [setActiveProjectId])

  const navigate = (view: ViewId) => {
    setActiveView(view)
    setMobileMenu(false)
    writeLocation({ view }, 'push')
  }
  const selectProject = (projectId: string) => {
    runtime.setActiveProjectId(projectId)
    setSelectedEvent(null)
    writeLocation({ project: projectId }, 'replace')
  }
  const selectGsd = (name: string) => {
    setSelectedGsd(name)
    setActiveView('PLANNING')
    setMobileMenu(false)
    writeLocation({ view: 'PLANNING', gsd: name }, 'push')
  }
  const selectPhase = (nextPhase: Phase) => {
    setFocusedPhase(nextPhase)
    navigate(PHASE_VIEWS[nextPhase])
  }

  const pageProps = {
    snapshot: runtime.snapshot,
    projects: runtime.projects,
    activeProjectId: runtime.activeProjectId,
    onScopeChange: selectProject,
    onNavigate: navigate,
    onSelectEvent: setSelectedEvent,
    onApprove: runtime.approve,
    capabilities: runtime.capabilities,
    capabilitiesError: runtime.capabilitiesError,
    selectedEvent,
    sessionMode,
    selectedGsd,
    onSelectGsd: selectGsd,
  }

  return <div className={`manifest-shell ${compact ? 'viewport-compact' : ''}`}><a className="skip-link" href="#main-content">Skip to live console</a><aside className={`command-rail ${mobileMenu ? 'open' : ''}`}><div className="rail-brand"><span className="brand-mark"><span></span><span></span><span></span></span><span><strong>SPECULUM</strong><small>PROJECTION GLASS</small></span></div><button type="button" className="rail-close" aria-label="Close navigation" onClick={() => setMobileMenu(false)}><X size={16} /></button><div className="rail-section-label">WORKSPACES</div><nav className="rail-nav" aria-label="Operator pages">{NAV_ITEMS.map(({ id, icon: Icon, label }) => <button type="button" key={id} className={activeView === id ? 'selected' : ''} aria-current={activeView === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={15} /><span>{label}</span>{activeView === id && <ChevronRight size={13} className="nav-caret" />}</button>)}</nav><RailPhaseContext phase={phase} focusedPhase={selectedPhase} /><div className="rail-foot"><div className="rail-foot-line"><Radio size={13} /> LOCAL EVENT PLANE</div><small>Projection only · source ownership remains with the runtime.</small></div></aside><section className="manifest-workspace"><header className="topbar"><button type="button" className="mobile-menu" aria-label="Open navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}><Menu size={18} /></button><div className="topbar-context"><span className="topbar-kicker">OPERATOR VIEW</span><select className="project-selector" value={runtime.activeProjectId} onChange={(event) => selectProject(event.target.value)} aria-label="Project scope">{runtime.projects.map((project) => <option value={project.project_id} key={project.project_id}>{project.name}{project.initialized ? '' : ' · UNINITIALIZED'}</option>)}</select><ChevronRight size={13} /><span className="topbar-muted">LOCAL RUNTIME</span></div><div className="topbar-actions"><span className={`connection-chip ${runtime.connection.toLowerCase()}`} aria-live="polite" aria-atomic="true"><span className="connection-dot"></span>{runtime.connection}</span><span className="topbar-event-count"><Activity size={13} /> {String(runtime.snapshot.event_count).padStart(3, '0')} EVENTS</span><button type="button" className="icon-button" aria-label="Refresh live telemetry" aria-busy={runtime.refreshing} disabled={runtime.refreshing} onClick={() => void runtime.refresh()}><RefreshCw size={14} className={runtime.refreshing ? 'spin' : undefined} /></button></div></header><main id="main-content" className="content-area"><div className="page-intro"><div><div className="section-kicker"><span className="kicker-rule"></span>{meta.eyebrow} / {projectScopeLabel(runtime.activeProjectId, runtime.projects)}</div><h1>{meta.title} <em>{meta.emphasis}</em></h1><p>{meta.subtitle}</p></div><div className="freshness-card" aria-live="polite" aria-atomic="true"><span className="section-kicker">LAST OBSERVED</span><strong>{runtime.snapshot.last_event_at ? new Date(runtime.snapshot.last_event_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'NO SAMPLE'}</strong><small>{runtime.connectionError || `${runtime.connection} · ${runtime.bridgeUrl}`}</small></div></div><ModeStrip mode={sessionMode} /><PhaseStrip phase={phase} focusedPhase={selectedPhase} onSelect={selectPhase} expanded={phasesExpanded} onToggle={() => setPhasesExpanded((value) => !value)} /><div className="phase-focus-note" role="status"><span>FOCUS / {selectedPhase}</span><small>NOW / {phase} · navigation does not change runtime phase</small></div>{selectedGsd === 'goal' && <div className="gsd-goal-bind" role="note"><span>SESSION LOOP</span><strong>/gsd:goal is already ALGORITHM</strong><small>No mode picker. Done-text from ISA Goal when active_planner=isa. Pass → stop. Manifest does not approve or launch.</small></div>}
      <ProjectActionRail key={runtime.activeProjectId} projects={runtime.projects} activeProjectId={runtime.activeProjectId} refreshing={runtime.refreshing} onRefresh={runtime.refresh} onRegister={runtime.registerProject} onAction={runtime.runProjectAction} />{activeView === 'OVERVIEW' && <OverviewPage {...pageProps} />} {activeView === 'GRAPH DECK' && <GraphDeckPage {...pageProps} />} {activeView === 'PLANNING' && <PlanningPage {...pageProps} />} {activeView === 'EXECUTION' && <ExecutionPage {...pageProps} />} {activeView === 'EVIDENCE' && <EvidencePage {...pageProps} />} {activeView === 'OPS / DELIVERY' && <OpsDeliveryPage {...pageProps} />}</main><footer className="workspace-footer"><span><span className="footer-led"></span> MANIFEST BRIDGE / {runtime.connection}</span><span>PROJECTION LAYER · SOURCE OWNERSHIP REMAINS WITH RUNTIME</span><span>HEALTH {runtime.health.status.toUpperCase()} · LAST UPDATE {runtime.snapshot.generated_at ? new Date(runtime.snapshot.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'NO SAMPLE'}</span></footer></section></div>
}
