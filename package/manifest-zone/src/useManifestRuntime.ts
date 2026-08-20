import { useCallback, useEffect, useState } from 'react'
import { EMPTY_CAPABILITIES, EMPTY_HEALTH, EMPTY_SNAPSHOT, type BridgeHealth, type ConnectionState, type ManifestSnapshot, type ProjectAction, type ProjectCapabilities, type ProjectSummary } from './manifest'
import { boundProjects, defaultBoundId } from './boundProjects'
import { isRealProjectId, scopeQuery, scopeSnapshot } from './scopeSnapshot'

const BRIDGE_URL = (import.meta.env.VITE_MANIFEST_BRIDGE_URL || 'http://127.0.0.1:8766').replace(/\/$/, '')

export interface ManifestRuntime {
  bridgeUrl: string
  snapshot: ManifestSnapshot
  projects: ProjectSummary[]
  health: BridgeHealth
  capabilities: ProjectCapabilities | null
  capabilitiesError: string | null
  connection: ConnectionState
  connectionError: string | null
  activeProjectId: string
  setActiveProjectId: (projectId: string) => void
  refresh: () => Promise<void>
  refreshing: boolean
  loadProjectActions: (projectId: string) => Promise<ProjectAction[]>
  registerProject: (cwd: string) => Promise<ProjectSummary>
  runProjectAction: (input: { project_id: string; action: Exclude<ProjectAction['id'], 'refresh'>; confirmation?: string }) => Promise<void>
  approve: (input: { project_id: string; plan_id: string; option_id: string; approval_id: string }) => Promise<void>
}

export function useManifestRuntime(): ManifestRuntime {
  const [snapshot, setSnapshot] = useState<ManifestSnapshot>(EMPTY_SNAPSHOT)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [health, setHealth] = useState<BridgeHealth>(EMPTY_HEALTH)
  const [capabilities, setCapabilities] = useState<ProjectCapabilities | null>(EMPTY_CAPABILITIES)
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null)
  const [activeProjectId, setActiveProjectIdState] = useState(() => new URLSearchParams(window.location.search).get('project') || '')
  const [connection, setConnection] = useState<ConnectionState>('OFFLINE')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const setActiveProjectId = useCallback((projectId: string) => {
    const next = projectId === 'all' ? '' : projectId
    setActiveProjectIdState(next)
    if (next) window.localStorage.setItem('manifest.activeProject', next)
    else window.localStorage.removeItem('manifest.activeProject')
  }, [])

  const loadProjects = useCallback(async () => {
    const response = await fetch(`${BRIDGE_URL}/projects`, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`project registry returned HTTP ${response.status}`)
    const value = await response.json() as { projects: ProjectSummary[] }
    const nextProjects = boundProjects(value.projects || [])
    setProjects(nextProjects)
    const fromQuery = new URLSearchParams(window.location.search).get('project')
    const saved = fromQuery || window.localStorage.getItem('manifest.activeProject')
    const nextId = defaultBoundId(nextProjects, saved === 'all' ? fromQuery : saved)
    if (nextId) setActiveProjectIdState(nextId)
    return nextId
  }, [])

  const loadHealth = useCallback(async () => {
    const response = await fetch(`${BRIDGE_URL}/health`, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`bridge health returned HTTP ${response.status}`)
    setHealth(await response.json() as BridgeHealth)
  }, [])

  const loadSnapshotFor = useCallback(async (projectId: string) => {
    const query = scopeQuery(projectId)
    if (!query) {
      setSnapshot(EMPTY_SNAPSHOT)
      return
    }
    const response = await fetch(`${BRIDGE_URL}/snapshot${query}`, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`bridge returned HTTP ${response.status}`)
    const next = await response.json() as ManifestSnapshot
    setSnapshot(scopeSnapshot(next, projectId))
    setConnection(next.freshness.status === 'stale' ? 'STALE' : 'LIVE')
    setConnectionError(null)
  }, [])

  const loadSnapshot = useCallback(async () => {
    await loadSnapshotFor(activeProjectId)
  }, [activeProjectId, loadSnapshotFor])

  const loadCapabilitiesFor = useCallback(async (projectId: string) => {
    if (!isRealProjectId(projectId)) {
      setCapabilities(EMPTY_CAPABILITIES)
      setCapabilitiesError(null)
      return
    }
    try {
      const response = await fetch(`${BRIDGE_URL}/projects/${encodeURIComponent(projectId)}/capabilities`, { headers: { Accept: 'application/json' } })
      const value = await response.json().catch(() => ({})) as ProjectCapabilities & { error?: string }
      if (!response.ok) throw new Error(value.error || `capability read returned HTTP ${response.status}`)
      setCapabilities(value)
      setCapabilitiesError(null)
    } catch (error) {
      setCapabilities(null)
      setCapabilitiesError(error instanceof Error ? error.message : 'capability read unavailable')
      throw error
    }
  }, [])

  const loadCapabilities = useCallback(async () => {
    await loadCapabilitiesFor(activeProjectId)
  }, [activeProjectId, loadCapabilitiesFor])

  const pingConsole = useCallback(async (projectId: string) => {
    if (!isRealProjectId(projectId)) return
    const body = {
      id: `evt_console_refresh_${Date.now().toString(36)}`,
      source: 'manifest',
      kind: 'manifest.console.refresh',
      status: 'observed',
      actor: 'local-operator',
      project_id: projectId,
      payload: { surface: 'manifest-zone', project_id: projectId },
    }
    const response = await fetch(`${BRIDGE_URL}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) {
      const value = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(value.error || `console ping returned HTTP ${response.status}`)
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const projectId = (await loadProjects()) || activeProjectId
      try { await pingConsole(projectId) } catch { /* GET path still tells the truth */ }
      await Promise.all([loadHealth(), loadSnapshotFor(projectId), loadCapabilitiesFor(projectId)])
    } catch (error) {
      setConnection('OFFLINE')
      setConnectionError(error instanceof Error ? error.message : 'bridge down · 8766')
    } finally {
      setRefreshing(false)
    }
  }, [activeProjectId, loadCapabilitiesFor, loadHealth, loadProjects, loadSnapshotFor, pingConsole])

  const approve = useCallback(async (input: { project_id: string; plan_id: string; option_id: string; approval_id: string }) => {
    const response = await fetch(`${BRIDGE_URL}/approvals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
    if (!response.ok) { const value = await response.json().catch(() => ({})) as { error?: string }; throw new Error(value.error || `approval returned HTTP ${response.status}`) }
    await refresh()
  }, [refresh])

  const loadProjectActions = useCallback(async (projectId: string) => {
    const response = await fetch(`${BRIDGE_URL}/projects/${encodeURIComponent(projectId)}/actions`, { headers: { Accept: 'application/json' } })
    const value = await response.json().catch(() => ({})) as { actions?: ProjectAction[]; error?: string }
    if (!response.ok) throw new Error(value.error || `project actions returned HTTP ${response.status}`)
    return value.actions || []
  }, [])

  const registerProject = useCallback(async (cwd: string) => {
    const response = await fetch(`${BRIDGE_URL}/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd }) })
    const value = await response.json().catch(() => ({})) as { project?: ProjectSummary; error?: string }
    if (!response.ok || !value.project) throw new Error(value.error || `project registration returned HTTP ${response.status}`)
    await refresh()
    setActiveProjectId(value.project.project_id)
    return value.project
  }, [refresh, setActiveProjectId])

  const runProjectAction = useCallback(async (input: { project_id: string; action: Exclude<ProjectAction['id'], 'refresh'>; confirmation?: string }) => {
    if (input.action === 'delete-manifest') {
      const removeResponse = await fetch(`${BRIDGE_URL}/projects/${encodeURIComponent(input.project_id)}/unregister`, { method: 'POST' })
      if (!removeResponse.ok) { const value = await removeResponse.json().catch(() => ({})) as { error?: string }; throw new Error(value.error || `project removal returned HTTP ${removeResponse.status}`) }
    }
    const path = input.action === 'delete-manifest'
      ? `${BRIDGE_URL}/projects/${encodeURIComponent(input.project_id)}`
      : `${BRIDGE_URL}/projects/${encodeURIComponent(input.project_id)}/${input.action}`
    const response = await fetch(path, {
      method: input.action === 'delete-manifest' ? 'DELETE' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input.action === 'delete-manifest' ? { delete_mode: 'manifest-history', confirm_project_id: input.confirmation || '' } : input.action === 'sync' ? { codegraph: true, gsd: true, skill_clusters: true } : {}),
    })
    const value = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(value.error || `project action returned HTTP ${response.status}`)
    if (input.action === 'unregister' || input.action === 'delete-manifest') {
      setActiveProjectIdState('')
      window.localStorage.removeItem('manifest.activeProject')
    }
    await refresh()
  }, [refresh])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    const query = scopeQuery(activeProjectId)
    if (!query) return
    const stream = new EventSource(`${BRIDGE_URL}/events${query}`)
    const onSnapshot = (message: MessageEvent<string>) => {
      try {
        const next = JSON.parse(message.data) as ManifestSnapshot
        setSnapshot(scopeSnapshot(next, activeProjectId))
        setConnection(next.freshness.status === 'stale' ? 'STALE' : 'LIVE')
        setConnectionError(null)
      } catch { setConnectionError('invalid bridge snapshot') }
    }
    const onManifest = () => { void Promise.all([loadSnapshot(), loadProjects(), loadHealth(), loadCapabilities()]) }
    const onError = () => setConnection((state) => state === 'STALE' ? state : 'OFFLINE')
    stream.addEventListener('snapshot', onSnapshot as EventListener)
    stream.addEventListener('manifest', onManifest as EventListener)
    stream.addEventListener('error', onError as EventListener)
    return () => {
      stream.removeEventListener('snapshot', onSnapshot as EventListener)
      stream.removeEventListener('manifest', onManifest as EventListener)
      stream.removeEventListener('error', onError as EventListener)
      stream.close()
    }
  }, [activeProjectId, loadCapabilities, loadHealth, loadProjects, loadSnapshot])

  useEffect(() => {
    const interval = window.setInterval(() => { void Promise.all([loadProjects(), loadHealth()]) }, 15_000)
    return () => window.clearInterval(interval)
  }, [loadHealth, loadProjects])

  return { bridgeUrl: BRIDGE_URL, snapshot, projects, health, capabilities, capabilitiesError, connection, connectionError, activeProjectId, setActiveProjectId, refresh, refreshing, loadProjectActions, registerProject, runProjectAction, approve }
}
