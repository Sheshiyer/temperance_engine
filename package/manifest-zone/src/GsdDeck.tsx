import type { ManifestEvent, ManifestSnapshot } from './manifest'
import { useCompact } from './useViewport'

import railMap from './gsd-rail-map.json'

type CommandSpec = { mode?: string; combo?: string | null; view?: string; alchemy?: string | null; group?: string }

const GROUPS = ['init', 'plan', 'execute', 'verify', 'ops'] as const

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function firstString(record: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!record) return ''
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  const nested = asRecord(record.state)
  if (nested) {
    for (const key of keys) {
      const value = nested[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    }
  }
  return ''
}

function latestGsdEvent(events: ManifestEvent[]): ManifestEvent | null {
  return [...events].reverse().find((event) => event.kind.startsWith('gsd.') || event.kind.includes('gsd')) || null
}

function artifactEvents(snapshot: ManifestSnapshot): ManifestEvent[] {
  return snapshot.recent_events.filter((event) => event.kind === 'workflow.gsd.artifact')
}

function matchesArtifact(record: Record<string, unknown>, token: string): boolean {
  const artifact = firstString(record, ['artifact', 'name', 'file']).toUpperCase()
  return artifact.includes(token)
}

function latestGoalPayload(snapshot: ManifestSnapshot): Record<string, unknown> | null {
  const event = [...snapshot.recent_events].reverse().find((item) => item.kind.startsWith('goal.'))
  if (!event) return null
  return { ...event.payload, observed_at: event.ts, artifact: 'GOAL', status: event.payload.status || event.kind }
}

function livePayload(snapshot: ManifestSnapshot, token: string): Record<string, unknown> | null {
  const fromEvent = [...artifactEvents(snapshot)].reverse().find((event) => matchesArtifact(event.payload, token))
  if (fromEvent) return { ...fromEvent.payload, observed_at: fromEvent.ts, evidence_path: fromEvent.evidence?.[0]?.path }
  const fromWorkflow = Object.values(snapshot.workflows || {}).find((record) => matchesArtifact(record, token) || (token === 'STATE' && Boolean(asRecord(record.state))))
  return fromWorkflow || null
}

function phaseLabels(record: Record<string, unknown>): string[] {
  const raw = record.phases ?? asRecord(record.state)?.phases
  if (Array.isArray(raw)) return raw.map((item) => String(item).trim()).filter(Boolean)
  if (typeof raw === 'string' && raw.trim()) return raw.split(/[/,>|]+/).map((item) => item.trim()).filter(Boolean)
  return []
}

function samePhase(left: string, right: string): boolean {
  const a = left.trim().toLowerCase()
  const b = right.trim().toLowerCase()
  if (a === b) return true
  return a.replace(/^0+/, '') === b.replace(/^0+/, '')
}

function writeGsdHistory(name: string): void {
  const url = new URL(window.location.href)
  url.searchParams.set('view', 'PLANNING')
  url.searchParams.set('gsd', name)
  window.history.pushState({ view: 'PLANNING', gsd: name }, '', url)
}

function LiveArtifact({ title, payload }: { title: string; payload: Record<string, unknown> | null }) {
  if (!payload) {
    return <div className="gsd-live-card">
      <span>{title}</span>
      <strong>NOT OBSERVED</strong>
      <small>No {title} artifact event yet</small>
    </div>
  }
  const milestone = firstString(payload, ['milestone', 'milestone_name', 'milestoneName', 'text'])
  const status = firstString(payload, ['status'])
  const phase = firstString(payload, ['phase', 'current_phase', 'currentPhase'])
  const next = firstString(payload, ['next_command', 'nextCommand', 'next', 'command'])
  const progress = firstString(payload, ['progress'])
  const focus = firstString(payload, ['focus'])
  const artifact = firstString(payload, ['artifact', 'name'])
  const path = firstString(payload, ['evidence_path', 'project_cwd', 'source_file'])
  const labels = phaseLabels(payload)
  const strip = labels.length ? labels : phase ? [phase] : []
  return <div className="gsd-live-card">
    <span>{title}</span>
    <strong>{milestone || artifact || title}</strong>
    <small>{[status || 'observed', focus, path].filter(Boolean).join(' · ')}</small>
    <div className="gsd-live-meta">
      {status && <span>STATUS <strong>{status}</strong></span>}
      {phase && <span>PHASE <strong>{phase}</strong></span>}
      {next && <span>NEXT <strong>{next}</strong></span>}
      {progress && <span>PROGRESS <strong>{progress}</strong></span>}
      {milestone && <span>MILESTONE <strong>{milestone}</strong></span>}
    </div>
    {strip.length > 0 && <div className="gsd-phase-strip" aria-label={`${title} phases`}>
      {strip.map((label) => <span className={`gsd-phase-chip ${phase && samePhase(phase, label) ? 'current' : ''}`} key={`${title}-${label}`}>{label}</span>)}
    </div>}
  </div>
}

export function GsdDeck({ snapshot, selectedGsd, onSelectGsd }: { snapshot: ManifestSnapshot; selectedGsd?: string | null; onSelectGsd?: (name: string) => void }) {
  const commands = (railMap as { commands: Record<string, CommandSpec>; groups: Record<string, string[]> }).commands
  const groups = (railMap as { groups: Record<string, string[]> }).groups
  const last = latestGsdEvent(snapshot.recent_events)
  const artifacts = artifactEvents(snapshot)
  const compact = useCompact()
  const selected = selectedGsd || new URLSearchParams(window.location.search).get('gsd')
  const selectCommand = (name: string) => {
    if (onSelectGsd) onSelectGsd(name)
    else writeGsdHistory(name)
  }
  return <section className="panel">
    <div className="panel-heading">
      <div>
        <span className="section-kicker">GSD / SLASH SPINE</span>
        <h2>Planning to execute, as commands</h2>
      </div>
      <span className="observed-tag">{Object.keys(commands).length} /gsd:*</span>
    </div>
    <div className="gsd-deck">
      <div className="gsd-last">
        <span>LAST COMMAND</span>
        <strong>{last ? String(last.payload.command || last.kind) : 'NONE YET'}</strong>
        <small>{last ? `${String(last.payload.mode || '—')} · ${String(last.payload.combo || '—')}` : 'Type /gsd:help in Claude, Codex, OpenCode, Cursor, or Grok.'}</small>
      </div>
      <div className="gsd-live" aria-label="Live GSD state, roadmap, and goal">
        <LiveArtifact title="STATE" payload={livePayload(snapshot, 'STATE')} />
        <LiveArtifact title="ROADMAP" payload={livePayload(snapshot, 'ROADMAP')} />
        <LiveArtifact title="GOAL" payload={latestGoalPayload(snapshot)} />
      </div>
      {selected === 'goal' && <div className="gsd-goal-bind" role="note">
        <span>SESSION LOOP</span>
        <strong>/gsd:goal is already ALGORITHM</strong>
        <small>No mode picker. Done-text comes from ISA Goal when active_planner=isa. Pass → stop. Fail → same /gsd:*. Manifest does not approve or launch.</small>
      </div>}
      {GROUPS.map((group) => {
        const names = groups[group] || []
        const selectedHere = Boolean(selected && names.includes(selected))
        return <details className="gsd-group" key={group} open={selectedHere || !compact}>
          <summary className="gsd-group-label">{group.toUpperCase()} <small>{names.length}</small></summary>
          <div className="gsd-chip-list">
            {names.map((name) => {
              const spec = commands[name]
              if (!spec) return null
              return <button type="button" className={`gsd-chip ${selected === name ? 'selected' : ''}`} key={name} onClick={() => selectCommand(name)}>
                <strong>/{name}</strong>
                <small>{spec.combo || spec.mode}</small>
              </button>
            })}
          </div>
        </details>
      })}
      <div className="gsd-artifacts">
        <span>OBSERVED ARTIFACTS</span>
        <strong>{artifacts.length}</strong>
        <small>STATE / ROADMAP fingerprints from the bridge</small>
      </div>
    </div>
  </section>
}
