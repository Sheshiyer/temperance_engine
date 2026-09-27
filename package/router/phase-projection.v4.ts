/** Presentation only. Phase metadata cannot admit work or select provider seats. */
export type PhaseMeta = {
  step: number
  total: number
  stage: string
  label: string
  sigil: string
  kosha: string
}

export const PHASES_V4: Readonly<Record<string, Readonly<PhaseMeta>>> = Object.freeze({
  observe: { step: 1, total: 7, stage: "NIGREDO", label: "OBSERVE", sigil: "♄", kosha: "MANOMAYA" },
  think: { step: 2, total: 7, stage: "ALBEDO", label: "THINK", sigil: "☿", kosha: "VIJNANAMAYA" },
  plan: { step: 3, total: 7, stage: "CITRINITAS", label: "PLAN", sigil: "☉", kosha: "VIJNANAMAYA" },
  build: { step: 4, total: 7, stage: "CITRINITAS", label: "BUILD", sigil: "♃", kosha: "ANNAMAYA" },
  execute: { step: 5, total: 7, stage: "RUBEDO", label: "EXECUTE", sigil: "♂", kosha: "PRANAMAYA" },
  verify: { step: 6, total: 7, stage: "RUBEDO", label: "VERIFY", sigil: "♀", kosha: "VIJNANAMAYA" },
  learn: { step: 7, total: 7, stage: "RUBEDO", label: "LEARN", sigil: "☽", kosha: "ANANDAMAYA" },
})

export function phaseMeta(phase: string): PhaseMeta {
  const input = String(phase).toLowerCase()
  const aliases: Record<string, string> = { observing: "observe", thinking: "think", planning: "plan", building: "build", exec: "execute", executing: "execute", verifying: "verify", learning: "learn" }
  const key = aliases[input] || input
  return { ...(PHASES_V4[key] || { step: 0, total: 7, stage: "PROCESS", label: String(phase).toUpperCase(), sigil: "◇", kosha: "UNSPECIFIED" }) }
}

export function formatRailHeader(meta: PhaseMeta): string {
  return `${meta.sigil} RAIL · ${meta.stage} · ${meta.label} · ${meta.step}/${meta.total} · ${meta.kosha}`
}

/** Aliases are optional host policy, never a dependency on a personal profile. */
export function configuredPhaseAlias(map: any, phase: string, fallback: string): string {
  const key = phase.toLowerCase()
  const label = key[0]?.toUpperCase() + key.slice(1)
  const value = map?.phases?.[key]?.lane_intent ?? map?.algorithm_phases?.[label] ?? map?.algorithm_phases?.[key]
  return typeof value === "string" && value.trim() ? value : fallback
}

export type ActualAttemptEvidence = {
  source: "actual-attempt"
  attemptId: string
  combo: string
  provider: string
  connectionId: string
  model: string
  observedAt: string
}

/** Do not elevate configuration, an alias, or a planned seat into actual evidence. */
export function actualAttemptEvidence(value: unknown, combo: string): ActualAttemptEvidence | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  if (v.source !== "actual-attempt" || v.combo !== combo) return null
  for (const key of ["attemptId", "provider", "connectionId", "model", "observedAt"]) {
    if (typeof v[key] !== "string" || !(v[key] as string).trim() || /[\r\n\x00-\x1f]/.test(v[key] as string)) return null
  }
  if (!Number.isFinite(Date.parse(v.observedAt as string))) return null
  return v as ActualAttemptEvidence
}

export function formatAttemptResolution(combo: string, value?: unknown): string {
  const evidence = actualAttemptEvidence(value, combo)
  if (!evidence) return `☿ COMBO · ${combo} · UNVERIFIED\n  ·  worker    no actual-attempt evidence; configured aliases are not resolved seats`
  return [
    `☿ COMBO · ${combo} · OBSERVED ATTEMPT`,
    `  ·  provider  ${evidence.provider}`,
    `  ·  connection [private seat reference]`,
    `  ·  model     ${evidence.model}`,
    `  ·  attempt   ${evidence.attemptId}`,
    `  ·  observed  ${evidence.observedAt}`,
  ].join("\n")
}
