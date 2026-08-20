import { useEffect, useState, type FormEvent } from 'react'
import { useCompact } from './useViewport'
import { Archive, ChevronRight, DatabaseZap, FolderPlus, RefreshCw, ShieldAlert, Trash2, UserMinus } from 'lucide-react'
import type { ProjectAction, ProjectSummary } from './manifest'

interface ProjectActionRailProps {
  projects: ProjectSummary[]
  activeProjectId: string
  refreshing?: boolean
  onRefresh: () => Promise<void>
  onRegister: (cwd: string) => Promise<ProjectSummary>
  onAction: (input: { project_id: string; action: Exclude<ProjectAction['id'], 'refresh'>; confirmation?: string }) => Promise<void>
}

export function ProjectActionRail({ projects, activeProjectId, refreshing, onRefresh, onRegister, onAction }: ProjectActionRailProps) {
  const compact = useCompact()
  const [open, setOpen] = useState(false)
  const [lifecycleOpen, setLifecycleOpen] = useState(() => typeof window !== 'undefined' && window.sessionStorage.getItem('manifest.lifecycleOpen') === '1')
  const [cwd, setCwd] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const project = projects.find((candidate) => candidate.project_id === activeProjectId)
  const locked = busy !== null || Boolean(refreshing)

  useEffect(() => {
    window.sessionStorage.setItem('manifest.lifecycleOpen', lifecycleOpen ? '1' : '0')
  }, [lifecycleOpen])

  const run = async (action: Exclude<ProjectAction['id'], 'refresh'>, value?: string) => {
    if (!project) return
    setBusy(action)
    setError(null)
    setMessage(null)
    try {
      await onAction({ project_id: project.project_id, action, confirmation: value })
      setMessage(action === 'delete-manifest' ? 'Manifest history forgotten · source checkout preserved.' : `${action.replace('-', ' ')} complete.`)
      setConfirmation('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'project action failed')
    } finally {
      setBusy(null)
    }
  }

  const register = async (event: FormEvent) => {
    event.preventDefault()
    if (!cwd.trim()) return
    setBusy('register')
    setError(null)
    setMessage(null)
    try {
      const registered = await onRegister(cwd.trim())
      setCwd('')
      setOpen(false)
      setMessage(`${registered.name} registered.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'project registration failed')
    } finally {
      setBusy(null)
    }
  }

  return <section className={`project-actions panel ${lifecycleOpen ? 'open' : 'collapsed'}`} aria-label="Project actions">
    <div className="project-actions-head">
      <button type="button" className="project-actions-toggle" aria-expanded={lifecycleOpen} onClick={() => setLifecycleOpen((value) => !value)}>
        <span className="section-kicker"><span className="kicker-rule"></span>PROJECT LIFECYCLE</span>
        <strong>{project ? project.name : 'NO BOUND PROJECT'}</strong>
        <small>{lifecycleOpen ? 'COLLAPSE' : 'EXPAND'} · {project ? `${project.visibility || 'active'} · ${compact ? 'compact' : 'wide'}` : 'Select a project scope for project-specific actions.'}</small>
      </button>
      <div className="project-actions-tools">
        <button type="button" className="action-button quiet" onClick={() => void onRefresh()} disabled={locked} aria-busy={refreshing}>
          <RefreshCw size={13} className={refreshing ? 'spin' : undefined} /> {refreshing ? 'REFRESHING…' : 'REFRESH'}
        </button>
        <button type="button" className="action-button" aria-expanded={open} aria-controls="project-register-form" onClick={() => setOpen((value) => !value)}>
          <FolderPlus size={13} /> ADD PROJECT
        </button>
      </div>
    </div>
    {open ? <form id="project-register-form" className="project-register-form" onSubmit={(event) => void register(event)}><label htmlFor="project-cwd">PROJECT ROOT / EXISTING DIRECTORY</label><div><input id="project-cwd" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/Volumes/.../project" spellCheck={false} /><button type="submit" className="action-button" disabled={!cwd.trim() || locked}>{busy === 'register' ? 'REGISTERING…' : 'REGISTER'}<ChevronRight size={13} /></button></div><small>Registration writes only the project manifest and registry entry; it does not run code or delete files.</small></form> : null}
    {lifecycleOpen && project ? <div className="project-action-grid">
      <div className="project-action-group">
        <span className="project-action-group-label">OBSERVE / READ</span>
        <button type="button" className="action-button compact" onClick={() => void run('sync')} disabled={locked || !project.cwd}><DatabaseZap size={13} /> {busy === 'sync' ? 'SYNCING…' : 'SYNC'}</button>
      </div>
      <div className="project-action-group">
        <span className="project-action-group-label">MANAGE / VISIBILITY</span>
        <div className="project-action-row">
          <button type="button" className="action-button compact" onClick={() => void run('archive')} disabled={locked || project.visibility === 'archived'}><Archive size={13} /> ARCHIVE</button>
          <button type="button" className="action-button compact" onClick={() => void run('unregister')} disabled={locked || project.visibility === 'unregistered'}><UserMinus size={13} /> REMOVE</button>
        </div>
      </div>
      <details className="project-danger-zone">
        <summary><ShieldAlert size={13} /> DANGEROUS / FORGET MANIFEST HISTORY <ChevronRight size={13} /></summary>
        <div className="project-delete-control"><label htmlFor="delete-confirmation">TYPE PROJECT ID TO CONFIRM</label><div><input id="delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={project.project_id} spellCheck={false} /><button type="button" className="action-button danger" onClick={() => void run('delete-manifest', confirmation)} disabled={locked || confirmation !== project.project_id}><Trash2 size={13} /> FORGET</button></div><small>Recoverable bridge-history retention only. The source checkout remains untouched.</small></div>
      </details>
    </div> : null}
    {message ? <div className="project-action-feedback success" role="status">{message}</div> : null}
    {error ? <div className="project-action-feedback error" role="alert">{error}</div> : null}
  </section>
}
