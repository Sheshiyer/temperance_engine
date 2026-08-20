import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, LockKeyhole, Radio, ShieldCheck } from 'lucide-react'
import type { ProjectCapabilities, CapabilityReadiness, SkillWorkflowProjection } from './manifest'
import { SkillWorkflowDeck, type PaiSessionMode } from './SkillWorkflowDeck'
import { useCompact } from './useViewport'
import './capabilityDeck.css'

function Readiness({ state }: { state: CapabilityReadiness }) {
  const Icon = state === 'ready' ? CheckCircle2 : state === 'gated' ? LockKeyhole : AlertCircle
  return <span className={`capability-readiness ${state}`}><Icon size={12} /> {state.toUpperCase()}</span>
}

export function CapabilityDeck({ capabilities, error, activeProjectId, sessionMode = 'ALGORITHM' }: { capabilities: ProjectCapabilities | null; error: string | null; activeProjectId: string; sessionMode?: PaiSessionMode }) {
  const compact = useCompact()
  const [open, setOpen] = useState(() => !compact)
  const [workflow, setWorkflow] = useState<SkillWorkflowProjection | null>(null)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const loadWorkflow = useCallback(async () => {
    if (activeProjectId === 'all') { setWorkflow(null); setWorkflowError(null); return }
    try {
      const bridge = (import.meta.env.VITE_MANIFEST_BRIDGE_URL || 'http://127.0.0.1:8766').replace(/\/$/, '')
      const response = await fetch(`${bridge}/projects/${encodeURIComponent(activeProjectId)}/workflows/product-guide-production/requests`, { headers: { Accept: 'application/json' } })
      const value = await response.json().catch(() => ({})) as SkillWorkflowProjection & { error?: string }
      if (!response.ok) throw new Error(value.error || `workflow read returned HTTP ${response.status}`)
      setWorkflow(value); setWorkflowError(null)
    } catch (cause) { setWorkflow(null); setWorkflowError(cause instanceof Error ? cause.message : 'workflow read unavailable') }
  }, [activeProjectId])
  useEffect(() => {
    let cancelled = false
    if (activeProjectId === 'all') return () => { cancelled = true }
    const bridge = (import.meta.env.VITE_MANIFEST_BRIDGE_URL || 'http://127.0.0.1:8766').replace(/\/$/, '')
    void fetch(`${bridge}/projects/${encodeURIComponent(activeProjectId)}/workflows/product-guide-production/requests`, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const value = await response.json().catch(() => ({})) as SkillWorkflowProjection & { error?: string }
        if (!response.ok) throw new Error(value.error || `workflow read returned HTTP ${response.status}`)
        if (!cancelled) { setWorkflow(value); setWorkflowError(null) }
      })
      .catch((cause: unknown) => { if (!cancelled) { setWorkflow(null); setWorkflowError(cause instanceof Error ? cause.message : 'workflow read unavailable') } })
    return () => { cancelled = true }
  }, [activeProjectId])
  const requestWorkflow = useCallback(async (input: { project_id: string; workflow_id: string; request_id: string; approval_id: string }) => {
    const bridge = (import.meta.env.VITE_MANIFEST_BRIDGE_URL || 'http://127.0.0.1:8766').replace(/\/$/, '')
    const response = await fetch(`${bridge}/projects/${encodeURIComponent(input.project_id)}/workflows/${encodeURIComponent(input.workflow_id)}/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: input.request_id, approval_id: input.approval_id }) })
    const value = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(value.error || `workflow request returned HTTP ${response.status}`)
    await loadWorkflow()
  }, [loadWorkflow])
  return <>
    <SkillWorkflowDeck workflow={workflow} error={workflowError} activeProjectId={activeProjectId} sessionMode={sessionMode} onRequest={requestWorkflow} />
    {activeProjectId === 'all' && <section className="panel capability-panel"><div className="capability-empty"><Radio size={18} /><strong>SELECT A PROJECT SCOPE</strong><span>Moosh readiness is derived from one canonical project checkout at a time. Choose a project in the operator bar to inspect its capture gates.</span></div></section>}
    {error && <section className="panel capability-panel"><div className="capability-empty warning"><AlertCircle size={18} /><strong>CAPABILITY READ MODEL UNAVAILABLE</strong><span>{error}. The rest of the Manifest projection remains available; no guide operation was started.</span></div></section>}
    {!error && activeProjectId !== 'all' && !capabilities && <section className="panel capability-panel"><div className="capability-empty"><Radio size={18} /><strong>READING CAPABILITY CONTRACT</strong><span>Waiting for project-scoped readiness from the Manifest bridge.</span></div></section>}
    {capabilities && <section className={`panel capability-panel ${open ? 'open' : 'collapsed'}`}>
      <button type="button" className="capability-heading toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <div>
          <span className="section-kicker">SKILL CLUSTERS / PRODUCT GUIDES</span>
          <h2>Run only when the project is ready.</h2>
          <p>Moosh is a project-scoped capability surface. Readiness is observable; capture stays explicit.</p>
        </div>
        <div className="capability-contract">
          <ShieldCheck size={14} />
          <span>{capabilities.schema}</span>
          <small>{open ? 'HIDE DETAILS' : 'SHOW DETAILS'} · {capabilities.source}</small>
        </div>
      </button>
      {open && <div className="capability-grid">
        <div className="capability-column">
          <span className="capability-column-label">CAPABILITIES</span>
          {capabilities.capabilities.map((capability) => <article className={`capability-card ${capability.state}`} key={capability.id}>
            <div className="capability-card-top">
              <div>
                <span className="capability-id">{capability.cluster} · {capability.tier}</span>
                <h3>{capability.label}</h3>
              </div>
              <Readiness state={capability.state} />
            </div>
            <p>{capability.summary}</p>
            <div className="requirement-list">{capability.requirements.map((requirement) => <div className="requirement-row" key={requirement.id}><Readiness state={requirement.state} /><div><strong>{requirement.label}</strong><small>{requirement.provenance}</small>{requirement.state !== 'ready' && requirement.next_action && <em>{requirement.next_action}</em>}</div></div>)}</div>
            <div className="capability-footer"><span>EXECUTION</span><strong>{capability.execution}</strong></div>
          </article>)}
        </div>
        <div className="capability-column">
          <span className="capability-column-label">CONNECTED PROVIDERS</span>
          <div className="provider-list">{capabilities.providers.map((provider) => <article className="provider-row" key={provider.id}><div className="provider-icon"><Radio size={13} /></div><div><strong>{provider.label}</strong><span>{provider.role}</span><small>{provider.detail}</small><em>{provider.credential === 'none' ? 'NO CREDENTIAL' : 'HOST-MANAGED CREDENTIAL'}</em></div><Readiness state={provider.state} /></article>)}</div>
          <div className="execution-gate"><span className="section-kicker">PROJECT EXECUTION GATE</span><strong>{capabilities.execution.state.toUpperCase()}</strong><p>{capabilities.execution.detail}</p><small>{capabilities.execution.next_action}</small></div>
        </div>
      </div>}
    </section>}
  </>
}
