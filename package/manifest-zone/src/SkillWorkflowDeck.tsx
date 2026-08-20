import { useState } from 'react'
import { CheckCircle2, CircleAlert, GitBranch, LockKeyhole, Play, Radio } from 'lucide-react'
import type { CapabilityReadiness, SkillWorkflowProjection } from './manifest'
import { useCompact } from './useViewport'
import './skillWorkflowDeck.css'

function Readiness({ state }: { state: CapabilityReadiness }) {
  const Icon = state === 'ready' ? CheckCircle2 : state === 'gated' ? LockKeyhole : CircleAlert
  return <span className={`workflow-readiness ${state}`}><Icon size={12} /> {state.toUpperCase()}</span>
}

export type PaiSessionMode = 'MINIMAL' | 'NATIVE' | 'ALGORITHM'

export function SkillWorkflowDeck({ workflow, error, activeProjectId, sessionMode = 'ALGORITHM', onRequest }: { workflow: SkillWorkflowProjection | null; error: string | null; activeProjectId: string; sessionMode?: PaiSessionMode; onRequest: (input: { project_id: string; workflow_id: string; request_id: string; approval_id: string }) => Promise<void> }) {
  const compact = useCompact()
  const [open, setOpen] = useState(() => !compact)
  const [requestId, setRequestId] = useState(() => `guide-run-${Date.now()}`)
  const [approvalId, setApprovalId] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  if (activeProjectId === 'all') return <section className="panel workflow-panel"><div className="workflow-empty"><Radio size={18} /><strong>SELECT A PROJECT TO SEE ITS SKILL FLOW</strong><span>Cluster ownership and workflow stages are resolved against one canonical project checkout at a time.</span></div></section>
  if (error) return <section className="panel workflow-panel"><div className="workflow-empty warning"><CircleAlert size={18} /><strong>SKILL FLOW READ MODEL UNAVAILABLE</strong><span>{error}. No trigger was created.</span></div></section>
  if (!workflow) return <section className="panel workflow-panel"><div className="workflow-empty"><Radio size={18} /><strong>READING SKILL FLOW</strong><span>Waiting for the project-scoped cluster and workflow projection.</span></div></section>

  const resolved = sessionMode === 'MINIMAL'
    ? []
    : sessionMode === 'NATIVE'
      ? workflow.clusters.filter((cluster) => cluster.usage === 'resolved').slice(0, 1)
      : workflow.clusters.filter((cluster) => cluster.usage === 'resolved')
  const triggerEligible = sessionMode === 'ALGORITHM' && workflow.trigger.eligible
  const submit = async () => {
    setBusy(true); setFeedback(null)
    try {
      await onRequest({ project_id: workflow.project_id, workflow_id: workflow.workflow.id, request_id: requestId, approval_id: approvalId })
      setFeedback('bounded run request recorded; execution remains downstream')
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'workflow request failed') } finally { setBusy(false) }
  }
  return <section className={`panel workflow-panel ${open ? 'open' : 'collapsed'}`}>
    <button type="button" className="workflow-heading toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <div>
        <span className="section-kicker">CLUSTERS / SKILLS / WORKFLOW</span>
        <h2>See what will run, before it runs.</h2>
        <p>Resolved skills stay separate from runtime telemetry. The trigger only creates a request receipt.</p>
      </div>
      <div className="workflow-observed">
        <span>OBSERVED REGISTRY</span>
        <strong>{workflow.observed.registry_clusters || '—'} CLUSTERS</strong>
        <small>{open ? 'HIDE DETAILS' : 'SHOW DETAILS'} · {workflow.observed.registry_total || '—'} indexed</small>
      </div>
    </button>
    {open && <>
      <div className="workflow-grid">
        <div className="workflow-clusters">
          <div className="workflow-label">RESOLVED CLUSTERS</div>
          {resolved.map((cluster) => <article className="cluster-card" key={cluster.id}><div className="cluster-card-head"><div><span>{cluster.tier} · {cluster.origin}</span><h3>{cluster.title}</h3></div><Readiness state="ready" /></div><small>{cluster.id} · {cluster.originSource || 'native registry'}</small><div className="skill-chip-list">{cluster.skills.map((skill) => <span className="skill-chip" key={skill.id}>{skill.role.toUpperCase()} · {skill.label}</span>)}</div></article>)}
          {!resolved.length && <div className="workflow-empty compact"><CircleAlert size={15} /><span>No project workflow skills resolved.</span></div>}
          <div className="cluster-summary"><GitBranch size={14} /><span>{workflow.clusters.length} clusters available in the canonical index; {workflow.resolved_cluster_ids.length} selected for this workflow.</span></div>
        </div>
        <div className="workflow-stages">
          <div className="workflow-label">{workflow.workflow.label}</div>
          <div className="stage-list">{workflow.workflow.stages.map((stage, index) => <div className="stage-row" key={stage.id}><span className="stage-number">0{index + 1}</span><div><strong>{stage.label}</strong><small>{stage.gate}</small>{stage.state !== 'ready' && stage.next_action && <em>{stage.next_action}</em>}</div><Readiness state={stage.state} /></div>)}</div>
        </div>
      </div>
      <div className={`trigger-panel ${triggerEligible ? workflow.trigger.state : 'gated'}`}>
        <div>
          <span className="section-kicker">PROJECT TRIGGER / REQUEST ONLY</span>
          <strong>{sessionMode !== 'ALGORITHM' ? `${sessionMode} HIDES THE ALGORITHM TRIGGER` : workflow.trigger.state === 'eligible' ? 'READY FOR APPROVAL-BOUND REQUEST' : workflow.trigger.state.toUpperCase()}</strong>
          <p>{sessionMode === 'MINIMAL' ? 'Minimal keeps the alchemical strip but resolves no clusters.' : sessionMode === 'NATIVE' ? 'Native shows at most one spoke. The bounded run trigger stays gated.' : triggerEligible ? 'This request will enqueue a typed workflow receipt. It will not execute a shell command or choose a checkout.' : workflow.trigger.blockers.join(' ')}</p>
        </div>
        <div className="trigger-controls">
          <label>APPROVAL RECEIPT<input value={approvalId} onChange={(event) => setApprovalId(event.target.value)} placeholder="approval-id" disabled={!triggerEligible || busy} /></label>
          <label>REQUEST ID<input value={requestId} onChange={(event) => setRequestId(event.target.value)} disabled={!triggerEligible || busy} /></label>
          <button type="button" disabled={!triggerEligible || !approvalId || !requestId || busy} onClick={() => void submit()}><Play size={13} /> {busy ? 'REQUESTING…' : 'REQUEST BOUNDED RUN'}</button>
          {feedback && <small className="trigger-feedback">{feedback}</small>}
        </div>
      </div>
      <div className="workflow-footnote">No arbitrary commands, paths, provider keys, or implicit skill activation are accepted by this surface.</div>
    </>}
  </section>
}
