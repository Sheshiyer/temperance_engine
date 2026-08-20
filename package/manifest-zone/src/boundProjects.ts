import type { ProjectSummary } from './manifest'

const DROP_CWD = /\/Library\/Application Support\/CodexBar|\/\.temperance_engine\/manifest-bridge/i

export function isBoundProject(project: ProjectSummary): boolean {
  const cwd = project.cwd || ''
  if (!cwd) return false
  if (!project.initialized) return false
  if (DROP_CWD.test(cwd)) return false
  if (project.project_id === 'legacy-unscoped' || project.project_id === 'smoke-project') return false
  if (/^\/Users\/[^/]+$/.test(cwd) || /^\/home\/[^/]+$/.test(cwd)) return false
  return true
}

export function boundProjects(projects: ProjectSummary[]): ProjectSummary[] {
  return projects.filter(isBoundProject)
}

export function defaultBoundId(projects: ProjectSummary[], query?: string | null): string {
  const bound = boundProjects(projects)
  if (query && query !== 'all' && bound.some((project) => project.project_id === query)) return query
  const glove = bound.find((project) => {
    const cwd = (project.cwd || '').replace(/\/$/, '')
    return cwd.endsWith('/temperance_engine')
      || /^temperance-engine(-|$)/.test(project.project_id)
      || project.project_id === 'temperance_engine'
  })
  if (glove) return glove.project_id
  return bound[0]?.project_id || ''
}
