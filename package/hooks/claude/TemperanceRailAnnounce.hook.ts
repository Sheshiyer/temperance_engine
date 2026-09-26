#!/usr/bin/env bun
/**
 * TemperanceRailAnnounce.hook.ts — UserPromptSubmit (Codex)
 *
 * Injects sigil-formatted rail context (no emojis):
 *   ☿ RAIL · ALBEDO · THINK · 2/7
 *   · native / combo / head provider · stack with providers
 *
 * Fail-open. Complements PromptProcessing.hook.ts.
 */
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { execFileSync } from "node:child_process"

type Mode = "MINIMAL" | "NATIVE" | "ALGORITHM"

type PhaseMeta = {
  step: number
  total: number
  stage: string
  label: string
  sigil: string
}

function promptText(input: any): string {
  return String(input?.prompt || input?.user_prompt || "").trim()
}

function loadMap(): any {
  const p =
    process.env.TEMPERANCE_PHASE_COMBO_MAP ||
    join(homedir(), ".temperance_engine", "router", "phase-combo-map.json")
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

function loadPortfolioManifest(): any {
  const p =
    process.env.TEMPERANCE_PORTFOLIO_MANIFEST ||
    join(homedir(), ".temperance_engine", "router", "omniroute-portfolios.json")
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

function classifyTaskType(prompt: string): string {
  const script =
    process.env.TEMPERANCE_CLASSIFY ||
    join(homedir(), ".temperance_engine", "router", "classify-task.sh")
  try {
    if (existsSync(script)) {
      const out = execFileSync(script, [prompt], {
        encoding: "utf8",
        timeout: 1500,
        env: process.env,
      }).trim()
      const tt = out.split("\t")[0]?.trim()
      if (tt) return tt
    }
  } catch {
    /* fall through */
  }
  const v = prompt.toLowerCase()
  if (/\b(plan|roadmap|spec|architecture)\b/.test(v)) return "plan"
  if (/\b(dispatch|parallel|fleet|workers)\b/.test(v)) return "dispatch"
  if (/\b(refactor|migrate|multi.?file|entire)\b/.test(v)) return "long-horizon"
  if (/\b(debug|analyze|reason|diagnose)\b/.test(v)) return "reasoning"
  if (/\b(validate|verify|review|audit|test)\b/.test(v)) return "validation"
  if (/\b(quick|simple|typo|minor)\b/.test(v)) return "fast"
  return "balanced"
}

function classifyMode(prompt: string): Mode {
  if (/(?:^|\s)\/e([1-5])\b/i.test(prompt)) return "ALGORITHM"
  const v = prompt.toLowerCase().trim()
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|yep|nope|cool|nice)$/.test(v)) {
    return "MINIMAL"
  }
  const multi =
    /(build|create|implement|refactor|migrate|integrate|upgrade|debug|fix|investigate|design|plan|audit|review|multiple|all files|algorithm|isa|pai|proceed|continue|go ahead|resume)/i
  if (!multi.test(prompt) && v.split(/\s+/).length <= 16) return "NATIVE"
  return "ALGORITHM"
}

// RAIL-02/36-02: the displayed phase is this session's actual rail state, never a taskType
// keyword guess (the old phaseForTaskType(taskType) here made "audit the config" render as
// VERIFY 6/7 regardless of where the Algorithm actually was). Mirrors
// router/session-rail-state.ts's getCurrentPhase() read order — own state file > AlgorithmTracker
// per-session state > RailContinuity rail — but is inlined rather than imported so this hook
// keeps working once installed standalone to ~/.claude/hooks/, matching phaseOntology()'s own
// inline-fallback pattern below (a relative import into router/ would not resolve there).
const SESSION_PHASE_TITLE: Record<string, string> = {
  OBSERVE: "Observe", THINK: "Think", PLAN: "Plan", BUILD: "Build",
  EXECUTE: "Execute", VERIFY: "Verify", LEARN: "Learn",
}

function normalizeSessionPhase(raw: unknown): string | null {
  const key = String(raw ?? "").trim().toUpperCase()
  return SESSION_PHASE_TITLE[key] || null
}

function readJSONQuiet(path: string): any | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function resolveSessionId(): string {
  return process.env.TEMPERANCE_SESSION_ID || process.env.CLAUDE_SESSION_ID || "default"
}

/** Current session phase: own rail state > AlgorithmTracker > RailContinuity > Observe. */
function currentSessionPhase(): string {
  const sessionId = resolveSessionId()
  const runtimeRoot = process.env.TEMPERANCE_ENGINE_ROOT || join(homedir(), ".temperance_engine")

  const own = readJSONQuiet(join(runtimeRoot, "state", "session-rail", `${sessionId}.json`))
  const ownPhase = normalizeSessionPhase(own?.phase)
  if (ownPhase) return ownPhase

  const tracker = readJSONQuiet(join(homedir(), ".claude", "MEMORY", "STATE", "algorithms", `${sessionId}.json`))
  const trackerPhase = normalizeSessionPhase(tracker?.currentPhase)
  if (trackerPhase) return trackerPhase

  const rail = readJSONQuiet(join(homedir(), ".claude", "MEMORY", "STATE", "rail", `${sessionId}.json`))
  const railPhase = normalizeSessionPhase(rail?.phase)
  if (railPhase) return railPhase

  return "Observe"
}

// BEGIN GENERATED phase-ontology-fallback d33d16b941d6 — do not edit
const PHASE_ONTOLOGY_FALLBACK = {
  schema: "temperance.phase-ontology.v1",
  phases: [
    { id: "observe", ordinal: 1, total: 7, stage: "NIGREDO", label: "OBSERVE", sigil: "♄", operation: "NIGREDO", kosha: "MANOMAYA", kosha_label: "memory", lane: "noesis-observe", max_turns: 1 },
    { id: "think", ordinal: 2, total: 7, stage: "ALBEDO", label: "THINK", sigil: "☿", operation: "ALBEDO", kosha: "VIJNANAMAYA", kosha_label: "intellect", lane: "noesis-observe", max_turns: 3 },
    { id: "plan", ordinal: 3, total: 7, stage: "CITRINITAS", label: "PLAN", sigil: "☉", operation: "CITRINITAS", kosha: "VIJNANAMAYA", kosha_label: "intellect", lane: "noesis-plan", max_turns: 5 },
    { id: "build", ordinal: 4, total: 7, stage: "CITRINITAS", label: "BUILD", sigil: "♃", operation: "CALCINATIO", kosha: "ANNAMAYA", kosha_label: "substrate", lane: "noesis-build", max_turns: 20 },
    { id: "execute", ordinal: 5, total: 7, stage: "RUBEDO", label: "EXECUTE", sigil: "♂", operation: "SOLUTIO", kosha: "PRANAMAYA", kosha_label: "telemetry", lane: "noesis-execute", max_turns: 30 },
    { id: "verify", ordinal: 6, total: 7, stage: "RUBEDO", label: "VERIFY", sigil: "♀", operation: "COAGULATIO", kosha: "VIJNANAMAYA", kosha_label: "intellect", lane: "noesis-verify", max_turns: 3 },
    { id: "learn", ordinal: 7, total: 7, stage: "RUBEDO", label: "LEARN", sigil: "☽", operation: "RUBEDO", kosha: "ANANDAMAYA", kosha_label: "purpose", lane: "noesis-observe", max_turns: 5 },
  ],
} as const
// END GENERATED phase-ontology-fallback

let _ontCache: { path: string; data: any } | null = null

function phaseOntology(): any {
  const path = process.env.TEMPERANCE_PHASE_ONTOLOGY ||
    join(homedir(), ".temperance_engine", "router", "phase-ontology.generated.json")
  if (_ontCache?.path === path) return _ontCache.data
  try {
    const raw = readFileSync(path, "utf8")
    const parsed = JSON.parse(raw)
    if (parsed?.schema === "temperance.phase-ontology.v1" && Array.isArray(parsed.phases) && parsed.phases.length === 7) {
      _ontCache = { path, data: parsed }
      return parsed
    }
  } catch { /* fall through */ }
  _ontCache = { path, data: PHASE_ONTOLOGY_FALLBACK }
  return PHASE_ONTOLOGY_FALLBACK
}

/** Planetary sigils + alchemical stage names (no emoji). */
function phaseMeta(phase: string): PhaseMeta {
  const key = phase.toLowerCase()
  const ont = phaseOntology()
  const entry = ont.phases.find((p: any) => p.id === key)
  if (!entry) return { step: 0, total: 7, stage: "PROCESS", label: phase.toUpperCase(), sigil: "◇" }
  return { step: entry.ordinal, total: entry.total, stage: entry.stage, label: entry.label, sigil: entry.sigil }
}

type StackRow = { i: number; provider: string; rest: string; mid: string }

function loadProviderClass(): any {
  const p = join(homedir(), ".temperance_engine", "state", "provider-class.json")
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

function inactiveProviders(): Set<string> {
  const out = new Set<string>()
  const db = process.env.OMNIROUTE_DB || join(homedir(), ".omniroute", "storage.sqlite")
  const klass = loadProviderClass()
  for (const p of klass?.hard_exclude?.providers || []) out.add(String(p))
  if (!existsSync(db)) return out
  try {
    const raw = execFileSync(
      "sqlite3",
      [db, "SELECT provider FROM provider_connections WHERE is_active=0;"],
      { encoding: "utf8", timeout: 800 },
    ).trim()
    for (const line of raw.split("\n")) {
      if (line.trim()) out.add(line.trim())
    }
  } catch {
    /* ignore */
  }
  // Operator hard-off: Codex weekly burn / inactive seat must never be announced as native.
  out.add("codex")
  return out
}

function isExcludedModel(mid: string, inactive: Set<string>): boolean {
  if (!mid) return true
  const provider = mid.includes("/") ? mid.split("/")[0] : ""
  if (provider && inactive.has(provider)) return true
  const klass = loadProviderClass()
  for (const prefix of klass?.hard_exclude?.model_prefixes || []) {
    if (mid.startsWith(String(prefix))) return true
  }
  // Stale Sol labels even if somehow still in a template
  if (/gpt-5\.6-sol/i.test(mid) && inactive.has("codex")) return true
  return false
}

function loadComboStack(combo: string): StackRow[] {
  const db = process.env.OMNIROUTE_DB || join(homedir(), ".omniroute", "storage.sqlite")
  if (!existsSync(db)) return []
  const inactive = inactiveProviders()
  try {
    const raw = execFileSync(
      "sqlite3",
      [db, `SELECT data FROM combos WHERE name='${combo.replace(/'/g, "''")}' LIMIT 1;`],
      { encoding: "utf8", timeout: 800 },
    ).trim()
    if (!raw) return []
    const data = JSON.parse(raw)
    const rows: StackRow[] = []
    let i = 0
    for (const m of data.models || []) {
      const mid = String(m.model || "")
      if (isExcludedModel(mid, inactive)) continue
      i += 1
      const provider = String(m.providerId || (mid.includes("/") ? mid.split("/")[0] : "omniroute"))
      const rest = mid.includes("/") ? mid.slice(mid.indexOf("/") + 1) : mid
      rows.push({ i, provider, rest, mid })
    }
    return rows
  } catch {
    return []
  }
}

function isExecutionWorkerContext(taskType: string, phase: string, combo: string): boolean {
  return (
    combo === "noesis-execute" ||
    phase.toLowerCase() === "execute" ||
    taskType === "dispatch" ||
    taskType === "parallel-worker"
  )
}

function resolveExplicitWorkerModel(
  inactive: Set<string>,
  taskType: string,
  phase: string,
  combo: string,
): string | null {
  if (!isExecutionWorkerContext(taskType, phase, combo)) return null
  const requested = String(
    process.env.TEMPERANCE_WORKER_MODEL ||
      process.env.TEMPERANCE_WORKER_LANE ||
      process.env.TEMPERANCE_EXECUTION_MODEL ||
      (combo === "noesis-execute" ? "noesis-execute" : "") ||
      "",
  ).trim()
  if (requested !== "noesis-execute") return null
  if (isExcludedModel(requested, inactive)) return null
  return requested
}

/** Live session pin — never static Sol while Codex is off. */
function resolveNativeModel(
  map: any,
  stack: StackRow[],
  taskType: string,
  phase: string,
  combo: string,
): string {
  const klass = loadProviderClass()
  const fromClass =
    klass?.claude_code_default?.model ||
    klass?.babysit?.standard ||
    klass?.babysit?.model
  const fromMap = map?.native_orchestrator?.model
  const fromEnv = process.env.TEMPERANCE_ORCHESTRATOR_MODEL || process.env.ANTHROPIC_MODEL
  const inactive = inactiveProviders()
  const workerModel = resolveExplicitWorkerModel(inactive, taskType, phase, combo)
  if (workerModel) return workerModel
  for (const candidate of [fromEnv, fromClass, fromMap, stack[0]?.mid, "te-algorithm"]) {
    const mid = String(candidate || "").trim()
    if (!mid) continue
    if (isExcludedModel(mid, inactive)) continue
    if (/gpt-5\.6-sol/i.test(mid) && inactive.has("codex")) continue
    return mid
  }
  return "te-algorithm"
}

function pad(label: string, n = 10): string {
  return (label + " ".repeat(n)).slice(0, n)
}

function formatRailBlock(opts: {
  mode: Mode
  taskType: string
  phase: string
  combo: string
  nativeModel: string
  stack: StackRow[]
}): string {
  const meta = phaseMeta(opts.phase)
  const head = opts.stack[0]
  const lines: string[] = []

  // Match ALBEDO · THINK · 2/7 style already used in the app
  lines.push(
    `${meta.sigil} RAIL · ${meta.stage} · ${meta.label} · ${meta.step}/${meta.total}`,
  )
  lines.push(`  ·  ${pad("mode")}${opts.mode}`)
  lines.push(`  ·  ${pad("task")}${opts.taskType}`)
  lines.push(`  ·  ${pad("native")}${opts.nativeModel}  (orchestrator · babysit)`)
  lines.push(`  ·  ${pad("combo")}${opts.combo}`)
  if (head) {
    lines.push(`  ·  ${pad("head")}${head.provider} · ${head.rest}`)
  }
  lines.push(`  ·  ${pad("stack")}`)
  if (opts.stack.length === 0) {
    lines.push(`     ·  (live stack unavailable)`)
  } else {
    for (const row of opts.stack) {
      const mark = row.i === 1 ? "►" : "·"
      lines.push(
        `     ${mark} ${String(row.i).padStart(2, " ")}  ${pad(row.provider, 14)}${row.rest}`,
      )
    }
  }
  lines.push(`  ·  ${pad("workers")}noesis-execute`)
  lines.push(`  ·  ${pad("capacity")}noesis-fast`)
  lines.push("")
  lines.push("CONTRACT")
  lines.push("  ·  Native session babysits only unless --profile noesis-* is active.")
  lines.push("  ·  Dispatch heavy alchemical work to the combo; do not bulk-code on native.")
  lines.push("  ·  After each worker: announce resolved provider + model (no emojis).")
  lines.push("")
  lines.push("DISPATCH")
  lines.push(
    `  ·  ~/.temperance_engine/router/temperance-phase-dispatch.sh ${opts.phase} "<step>"`,
  )
  lines.push(
    `  ·  ~/.temperance_engine/router/omniroute-codex.sh ${opts.combo} "<step>"`,
  )
  lines.push(`  ·  codex --profile ${opts.combo}`)
  lines.push(
    `  ·  temperance-batch … model noesis-execute  (Execute fleet)`,
  )

  return ["<temperance-rail>", ...lines, "</temperance-rail>"].join("\n")
}

export function buildContext(prompt: string): string {
  const map = loadMap()
  const portfolio = loadPortfolioManifest()
  const mode = classifyMode(prompt)
  const taskType = classifyTaskType(prompt)
  const mapCombo =
    (map?.task_type_to_combo && map.task_type_to_combo[taskType]) ||
    (taskType === "plan" ? "noesis-plan" : "noesis-fast")
  // Keep this display contract aligned with enrichment's portfolio resolver.
  // The phase map is still the fallback for non-portfolio phase labels, but it
  // must not overwrite a current shared task-type portfolio (notably balanced
  // -> noesis-build).
  const combo =
    (portfolio?.task_type_portfolios && portfolio.task_type_portfolios[taskType]) ||
    mapCombo
  const phase = currentSessionPhase()
  const stack = loadComboStack(combo)
  const nativeModel = resolveNativeModel(map, stack, taskType, phase, combo)

  return formatRailBlock({
    mode,
    taskType,
    phase,
    combo,
    nativeModel,
    stack,
  })
}

function emit(additionalContext: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext,
      },
    }),
  )
}

function main(): void {
  let input: any = {}
  try {
    input = JSON.parse(readFileSync(0, "utf8"))
  } catch {
    /* empty */
  }
  const prompt = promptText(input)
  if (!prompt) {
    emit("")
    return
  }
  let ctx = ""
  try {
    ctx = buildContext(prompt)
    try {
      const dir = join(homedir(), ".claude", "MEMORY", "OBSERVABILITY")
      mkdirSync(dir, { recursive: true })
      appendFileSync(
        join(dir, "temperance-rail.jsonl"),
        JSON.stringify({
          timestamp: new Date().toISOString(),
          surface: "codex",
          prompt_excerpt: prompt.slice(0, 160),
          context_excerpt: ctx.slice(0, 500),
        }) + "\n",
      )
    } catch {
      /* optional */
    }
  } catch {
    ctx = [
      "<temperance-rail>",
      "◇ RAIL · PROCESS · FAIL-OPEN · ·/7",
      "  ·  combo      noesis-fast",
      "</temperance-rail>",
    ].join("\n")
  }
  // UPS last-wins: PromptProcessing composes <temperance-rail>. This hook only logs.
}

if (import.meta.main) {
  main()
}
