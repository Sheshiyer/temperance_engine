/**
 * Shared sigil-formatted rail announce for OpenCode + Codex (no emojis).
 * Lists OmniRoute combo stack with providers from live storage.sqlite.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { execFileSync } from "node:child_process"

export type Mode = "MINIMAL" | "NATIVE" | "ALGORITHM"

export type PhaseMeta = {
  step: number
  total: number
  stage: string
  label: string
  sigil: string
}

export type StackRow = { i: number; provider: string; rest: string; mid: string }

export function loadPhaseMap(home = homedir()): any {
  const p =
    process.env.TEMPERANCE_PHASE_COMBO_MAP ||
    join(home, ".temperance_engine", "router", "phase-combo-map.json")
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

export function classifyTaskType(prompt: string, home = homedir()): string {
  const script =
    process.env.TEMPERANCE_CLASSIFY ||
    join(home, ".temperance_engine", "router", "classify-task.sh")
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
  if (/\b(plan|roadmap|spec|architecture)\b/.test(v)) {
    // Mirror classify-task.sh plan-max signals (complexity → te-plan-max)
    if (
      /\/e([345]|5)\b/i.test(v) ||
      /\b(plan-max|te-plan-max|architecture decision|system design|re-?architect|multi-?milestone|cross-?cutting|strategic (plan|roadmap)|pai algorithm|ideal state|deep pass|task graph|deploy swarm|te-swarm|settings audit|screenshot)\b/.test(
        v,
      ) ||
      (v.split(/\s+/).length >= 90 &&
        /\b(plan|roadmap|architecture|spec|milestone)\b/.test(v))
    ) {
      return "plan-max"
    }
    return "plan"
  }
  if (/\b(dispatch|parallel|fleet|workers)\b/.test(v)) return "dispatch"
  if (/\b(refactor|migrate|multi.?file|entire)\b/.test(v)) return "long-horizon"
  if (/\b(debug|analyze|reason|diagnose)\b/.test(v)) return "reasoning"
  if (/\b(validate|verify|review|audit|test)\b/.test(v)) return "validation"
  if (/\b(quick|simple|typo|minor)\b/.test(v)) return "fast"
  return "balanced"
}

export function classifyMode(prompt: string): Mode {
  if (/(?:^|\s)\/e([1-5])\b/i.test(prompt)) return "ALGORITHM"
  const v = prompt.toLowerCase().trim()
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|yep|nope|cool|nice)$/.test(v)) {
    return "MINIMAL"
  }
  const multi =
    /(build|create|implement|refactor|migrate|integrate|upgrade|debug|fix|investigate|design|plan|audit|review|multiple|all files|algorithm|isa|pai)/i
  if (!multi.test(prompt) && v.split(/\s+/).length <= 16) return "NATIVE"
  return "ALGORITHM"
}

export function phaseForTaskType(tt: string): string {
  switch (tt) {
    case "plan":
    case "planning":
    case "plan-max":
      return "Plan"
    case "long-horizon":
      return "Build"
    case "dispatch":
    case "parallel-worker":
      return "Execute"
    case "validation":
      return "Verify"
    case "reasoning":
      return "Think"
    case "fast":
    case "balanced":
    case "creative":
    case "inline":
      return "Observe"
    default:
      return "Plan"
  }
}

export function phaseMeta(phase: string): PhaseMeta {
  const key = phase.toLowerCase()
  const table: Record<string, PhaseMeta> = {
    observe: { step: 1, total: 7, stage: "NIGREDO", label: "OBSERVE", sigil: "♄" },
    think: { step: 2, total: 7, stage: "ALBEDO", label: "THINK", sigil: "☿" },
    plan: { step: 3, total: 7, stage: "ALBEDO", label: "PLAN", sigil: "☉" },
    build: { step: 4, total: 7, stage: "CITRINITAS", label: "BUILD", sigil: "♃" },
    execute: { step: 5, total: 7, stage: "RUBEDO", label: "EXECUTE", sigil: "♂" },
    verify: { step: 6, total: 7, stage: "RUBEDO", label: "VERIFY", sigil: "♀" },
    learn: { step: 7, total: 7, stage: "MULTIPLICATIO", label: "LEARN", sigil: "☽" },
  }
  return (
    table[key] || {
      step: 0,
      total: 7,
      stage: "PROCESS",
      label: phase.toUpperCase(),
      sigil: "◇",
    }
  )
}

export function loadComboStack(combo: string, home = homedir()): StackRow[] {
  const db = process.env.OMNIROUTE_DB || join(home, ".omniroute", "storage.sqlite")
  if (!existsSync(db)) return []
  try {
    const raw = execFileSync(
      "sqlite3",
      [db, `SELECT data FROM combos WHERE name='${combo.replace(/'/g, "''")}' LIMIT 1;`],
      { encoding: "utf8", timeout: 800 },
    ).trim()
    if (!raw) return []
    const data = JSON.parse(raw)
    const rows: StackRow[] = []
    for (const [idx, m] of (data.models || []).entries()) {
      const mid = String(m.model || "")
      const provider = String(
        m.providerId || (mid.includes("/") ? mid.split("/")[0] : "omniroute"),
      )
      const rest = mid.includes("/") ? mid.slice(mid.indexOf("/") + 1) : mid
      rows.push({ i: idx + 1, provider, rest, mid })
    }
    return rows
  } catch {
    return []
  }
}

function pad(label: string, n = 10): string {
  return (label + " ".repeat(n)).slice(0, n)
}

/** Canonical multi-line header for a phase (Codex + OpenCode parity). */
export function formatRailHeader(meta: PhaseMeta): string {
  return `${meta.sigil} RAIL · ${meta.stage} · ${meta.label} · ${meta.step}/${meta.total}`
}

/** Stack lines matching rail-format.sh (► marks head). */
export function formatStackLines(stack: StackRow[], indent = "     "): string[] {
  if (!stack.length) return [`${indent}·  (live stack unavailable)`]
  return stack.map((row) => {
    const mark = row.i === 1 ? "►" : " "
    return `${indent}${mark} ${String(row.i).padStart(1, " ")}  ${pad(row.provider, 14)}${row.rest}`
  })
}

/**
 * Visible assistant prefix — multi-line Codex parity.
 * Never single-line mash. Never put NOESIS inside this block.
 */
export function formatVisibleAnnounce(opts: {
  mode: Mode
  taskType: string
  phase: string
  combo: string
  surface: "opencode" | "codex"
  stack: StackRow[]
  agent?: string
  sessionModel?: string
  nativeModel?: string
}): string {
  const meta = phaseMeta(opts.phase)
  const head = opts.stack[0]
  const lines: string[] = [formatRailHeader(meta)]

  if (opts.surface === "codex") {
    lines.push(
      `  ·  ${pad("native")}${opts.nativeModel || "gpt-5.6"}  (orchestrator · babysit)`,
    )
  } else {
    lines.push(`  ·  ${pad("surface")}opencode`)
    if (opts.agent) lines.push(`  ·  ${pad("agent")}${opts.agent}`)
    lines.push(`  ·  ${pad("mode")}${opts.mode}`)
    lines.push(`  ·  ${pad("task")}${opts.taskType}`)
    if (opts.sessionModel) lines.push(`  ·  ${pad("session")}${opts.sessionModel}`)
  }

  lines.push(`  ·  ${pad("combo")}${opts.combo}`)
  if (head) {
    lines.push(`  ·  ${pad("head")}${head.provider} · ${head.rest}`)
  } else {
    lines.push(`  ·  ${pad("head")}(stack unavailable)`)
  }
  lines.push(`  ·  ${pad("stack")}`)
  lines.push(...formatStackLines(opts.stack))
  return lines.join("\n")
}

const RAIL_SIGIL_CLASS = "[♄☿☉♃♂♀☽◇◆●○■□▲△◆]"
const MALFORMED_STAGE_PHASE =
  /CITRINITAS\s*·\s*PLAN|NIGREDO\s*·\s*THINK|ALBEDO\s*·\s*BUILD|RUBEDO\s*·\s*PLAN|CALCINATIO|SOLUTIO|COAGULATIO|MULTIPLICATIO\s*·\s*PLAN/i

/**
 * True when text already starts with the exact multi-line canonical announce
 * for this route (header + combo line; no single-line mash).
 */
export function isCanonicalRailPrefix(text: string, route: OpenCodeRoute): boolean {
  const body = String(text || "").trimStart()
  if (!body) return false
  const expectedHeader = formatRailHeader(route.meta)
  if (!body.startsWith(expectedHeader)) return false

  const firstLine = body.split("\n", 1)[0] || ""
  // Single-line mash: header continued with mode/task/NOESIS on same line
  if (firstLine.length > expectedHeader.length + 2) return false
  if (/\b(mode|task|combo|head|NOESIS)\b/i.test(firstLine.slice(expectedHeader.length))) {
    return false
  }

  const block = body.split("\n").slice(0, 14).join("\n")
  if (!new RegExp(`\\bcombo\\b[^\\n]*\\b${escapeRegExp(route.combo)}\\b`).test(block)) {
    return false
  }
  // Must look multi-line (at least header + one detail line)
  if (!/\n\s*·\s+/.test(block)) return false
  if (MALFORMED_STAGE_PHASE.test(firstLine)) return false
  return true
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Strip leading model-invented rail / phase / diamond-bullet noise and a
 * leading NOESIS so we can re-apply the canonical block.
 */
export function stripMalformedRailPrefix(text: string): string {
  let body = String(text || "")
  // Normalize weird spaces
  body = body.replace(/^\uFEFF/, "")

  // Drop a leading bare NOESIS line (re-added cleanly later)
  body = body.replace(/^\s*NOESIS\s*\n+/i, "")

  // If first line looks like a rail/phase announce (any sigil or RAIL · or STAGE · PHASE), strip
  // the leading rail block: either one mashed line or several · detail lines.
  const lines = body.split("\n")
  let i = 0
  const first = (lines[0] || "").trim()
  const looksRail =
    new RegExp(`^${RAIL_SIGIL_CLASS}`).test(first) ||
    /^RAIL\s*·/i.test(first) ||
    /\bRAIL\s*·/.test(first) ||
    /^(NIGREDO|ALBEDO|CITRINITAS|RUBEDO|MULTIPLICATIO|CALCINATIO|SOLUTIO|COAGULATIO)\b/i.test(
      first,
    ) ||
    MALFORMED_STAGE_PHASE.test(first)

  if (looksRail) {
    i = 1
    // Consume following indented · / ► detail lines and blank lines that belong to the block
    while (i < lines.length) {
      const L = lines[i]
      const t = L.trim()
      if (t === "") {
        // single blank after rail block ends it
        i++
        break
      }
      if (/^[·►\-*]\s/.test(t) || /^\s+[·►]/.test(L) || /^\s+·\s+/.test(L)) {
        i++
        continue
      }
      // Second sigil line still part of invent-noise (e.g. "◇ PLANNING:")
      if (new RegExp(`^${RAIL_SIGIL_CLASS}`).test(t) && t.length < 80) {
        i++
        continue
      }
      break
    }
    body = lines.slice(i).join("\n")
  }

  // Again drop NOESIS if it was right after the stripped rail
  body = body.replace(/^\s*NOESIS\s*\n+/i, "")
  // Strip a mashed "… NOESIS …" residual on first line if still present
  body = body.replace(
    new RegExp(`^\\s*${RAIL_SIGIL_CLASS}[^\\n]*\\bNOESIS\\b[^\\n]*\\n+`, "i"),
    "",
  )
  return body.replace(/^\n+/, "")
}

/**
 * OpenCode agent → fixed combo (when not temperance-auto).
 * temperance-planner is intentional null: complexity-aware te-plan vs te-plan-max
 * from classify-task.sh (linked to ALGORITHM planning).
 */
export function comboForOpenCodeAgent(agent?: string): string | null {
  switch (agent) {
    case "temperance-native":
    case "code-fast":
      return "te-fast"
    case "temperance-algorithm":
      return "te-algorithm"
    case "temperance-continuity":
      return "te-build"
    case "temperance-planner":
      // Dynamic: resolveOpenCodeRoute uses task_type plan | plan-max
      return null
    case "temperance-worker":
      return "te-dispatch-paid"
    case "temperance-validator":
      return "te-validate"
    case "temperance-auto":
    default:
      return null
  }
}

export function phaseForOpenCodeAgent(agent?: string): string | null {
  switch (agent) {
    case "temperance-native":
      return "Observe"
    case "temperance-algorithm":
      return "Plan"
    case "temperance-continuity":
      return "Build"
    case "temperance-planner":
      return "Plan"
    case "temperance-worker":
      return "Execute"
    case "temperance-validator":
      return "Verify"
    default:
      return null
  }
}

export function formatRailBlock(opts: {
  mode: Mode
  taskType: string
  phase: string
  combo: string
  surface: "opencode" | "codex"
  sessionModel: string
  stack: StackRow[]
  agent?: string
}): string {
  const meta = phaseMeta(opts.phase)
  const head = opts.stack[0]
  const lines: string[] = []

  lines.push(
    `${meta.sigil} RAIL · ${meta.stage} · ${meta.label} · ${meta.step}/${meta.total}`,
  )
  lines.push(`  ·  ${pad("surface")}${opts.surface}`)
  if (opts.agent) lines.push(`  ·  ${pad("agent")}${opts.agent}`)
  lines.push(`  ·  ${pad("mode")}${opts.mode}`)
  lines.push(`  ·  ${pad("task")}${opts.taskType}`)
  lines.push(`  ·  ${pad("session")}${opts.sessionModel}`)
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
  lines.push(`  ·  ${pad("workers")}te-dispatch-paid`)
  lines.push(`  ·  ${pad("capacity")}te-fast`)
  lines.push("")
  lines.push("CONTRACT")
  if (opts.surface === "opencode") {
    lines.push("  ·  OpenCode uses single provider temperance (te-* combos + temperance-auto).")
    lines.push("  ·  Announce combo + head provider at each alchemical step (no emojis).")
    lines.push("  ·  Fleet Execute: temperance-worker / temperance-batch on te-dispatch-paid.")
  } else {
    lines.push("  ·  Native Codex babysits; dispatch heavy steps to combos.")
    lines.push("  ·  After each worker: COMBO · RESOLVED with provider + model.")
  }
  lines.push("")
  lines.push("ANNOUNCE (phase transitions — no emojis)")
  lines.push(
    `  ${meta.sigil} RAIL · ${meta.stage} · ${meta.label} · ${meta.step}/${meta.total}`,
  )
  lines.push(
    `  ·  session ${opts.sessionModel} · combo ${opts.combo}` +
      (head ? ` · head ${head.provider}/${head.rest}` : ""),
  )
  lines.push(`  ☿ COMBO · ${opts.combo} · RESOLVED`)
  lines.push(`  ·  provider <name> · model <id>`)

  return ["<temperance-rail>", ...lines, "</temperance-rail>"].join("\n")
}

export type OpenCodeRoute = {
  mode: Mode
  taskType: string
  phase: string
  combo: string
  meta: PhaseMeta
  stack: StackRow[]
  agent: string
  sessionModel: string
  /** True when we pin message.model away from temperance-auto. */
  hardRoute: boolean
  providerID: string
  modelID: string
  head?: StackRow
  railBlock: string
  visibleAnnounce: string
  toastLine: string
  systemContract: string
}

/** Agents / models that should hard-route each turn by mode+task→combo. */
export function isOpenCodeAutoAgent(agent?: string, modelID?: string): boolean {
  if (!agent || agent === "temperance-auto" || agent === "build" || agent === "general") {
    return true
  }
  if (modelID === "temperance-auto" || modelID === "te-auto") return true
  return false
}

/**
 * Full OpenCode route resolution: mode → task type → combo → stack.
 * Used for hard model pin, visible announce, system contract, and toast.
 */
export function resolveOpenCodeRoute(
  prompt: string,
  agent?: string,
  model?: { providerID?: string; modelID?: string },
): OpenCodeRoute {
  const map = loadPhaseMap()
  const agentName = agent || "temperance-auto"
  const agentCombo = comboForOpenCodeAgent(agentName)
  const agentPhase = phaseForOpenCodeAgent(agentName)
  const auto = isOpenCodeAutoAgent(agentName, model?.modelID)

  const mode =
    agentName === "temperance-native"
      ? "NATIVE"
      : auto
        ? classifyMode(prompt)
        : "ALGORITHM"

  const taskType = classifyTaskType(prompt)
  let combo =
    agentCombo ||
    (map?.task_type_to_combo && map.task_type_to_combo[taskType]) ||
    "te-fast"

  // Mode floor: MINIMAL always capacity te-fast; NATIVE prefers te-fast unless agent pinned.
  // te-plan-max is ALGORITHM-only (weekly Sol/Fable burn).
  if (auto && mode === "MINIMAL") combo = "te-fast"
  if (auto && mode === "NATIVE" && !agentCombo) {
    if (taskType === "plan-max" || taskType === "plan") {
      // NATIVE planning stays capacity te-plan (never max seats)
      combo = "te-plan"
    } else {
      combo =
        (map?.task_type_to_combo && map.task_type_to_combo[taskType]) || "te-fast"
    }
  }
  // Planner agent: always plan phase; pick max only on plan-max task type
  if (agentName === "temperance-planner") {
    combo = taskType === "plan-max" ? "te-plan-max" : "te-plan"
  }
  // Algorithm mode + complex plan: prefer te-plan-max even if agent pin is te-algorithm
  // only when the agent is auto (not continuity/native/worker)
  if (
    auto &&
    mode === "ALGORITHM" &&
    taskType === "plan-max" &&
    !agentCombo
  ) {
    combo = "te-plan-max"
  }

  const phase = agentPhase || phaseForTaskType(taskType)
  const meta = phaseMeta(phase)
  const stack = loadComboStack(combo)
  const head = stack[0]
  // Auto classifier + planner agent hard-pin so plan vs plan-max is real
  const hardRoute =
    !!combo && (auto || agentName === "temperance-planner")
  const sessionModel = hardRoute
    ? auto
      ? `temperance-auto → temperance/${combo}`
      : `temperance-planner → temperance/${combo}`
    : agentCombo
      ? `temperance/${agentCombo}`
      : `temperance/${combo}`

  const railBlock = formatRailBlock({
    mode,
    taskType,
    phase,
    combo,
    surface: "opencode",
    sessionModel,
    stack,
    agent: agentName,
  })

  // Multi-line Codex-parity announce (never single-line mash; never embed NOESIS)
  const visibleAnnounce = formatVisibleAnnounce({
    mode,
    taskType,
    phase,
    combo,
    surface: "opencode",
    stack,
    agent: agentName,
    sessionModel,
  })

  const toastLine =
    `${meta.sigil} ${meta.label} · ${combo}` +
    (head ? ` · ${head.provider}/${head.rest}` : "")

  const systemContract = [
    "TEMPERANCE RAIL (HARD — OpenCode parity with Codex multi-line sigils)",
    "",
    "CANONICAL ANNOUNCE (copy this shape — multi-line, sigils only, no emojis):",
    visibleAnnounce,
    "",
    `MODE: ${mode}`,
    `COMBO: ${combo} (provider temperance / model ${combo})`,
    head ? `HEAD: ${head.provider} · ${head.rest}` : "HEAD: (stack unavailable)",
    "",
    "OUTPUT CONTRACT (mandatory):",
    mode === "MINIMAL"
      ? "- MINIMAL: short ack; optional rail header only."
      : mode === "NATIVE"
        ? [
            "- Open with the multi-line RAIL block (header, then indented · lines).",
            "- Then a blank line, then NOESIS on its own line.",
            "- Use NATIVE format. Sigils only — no emojis.",
            "- Never put mode/task/combo/NOESIS on the same line as RAIL.",
            "- Never invent stages (no CITRINITAS for PLAN; PLAN = ALBEDO · ☉).",
          ].join("\n")
        : [
            "- Open with the multi-line RAIL block exactly as shown above.",
            "- Then a blank line, then NOESIS on its own line (never mashed into RAIL).",
            `- Stage map: OBSERVE=NIGREDO ♄, THINK=ALBEDO ☿, PLAN=ALBEDO ☉, BUILD=CITRINITAS ♃, EXECUTE=RUBEDO ♂, VERIFY=RUBEDO ♀, LEARN=MULTIPLICATIO ☽`,
            `- This turn: ${formatRailHeader(meta)} · combo ${combo}` +
              (head ? ` · head ${head.provider}/${head.rest}` : ""),
            "- Follow PAI Algorithm for multi-step work (read LATEST then version).",
            "- Close with multi-line:",
            `  ☿ COMBO · ${combo} · RESOLVED`,
            "    ·  provider <name>",
            "    ·  model <id>",
            "- Sigils only — no emojis. No diamond (◇) phase bullets.",
          ].join("\n"),
    "",
    "STACK:",
    ...(stack.length
      ? stack.map(
          (r) =>
            `  ${r.i === 1 ? "►" : "·"} ${r.i}. ${r.provider} · ${r.rest}`,
        )
      : ["  · (live stack unavailable)"]),
  ].join("\n")

  return {
    mode,
    taskType,
    phase,
    combo,
    meta,
    stack,
    agent: agentName,
    sessionModel,
    hardRoute,
    providerID: "temperance",
    modelID: combo,
    head,
    railBlock,
    visibleAnnounce,
    toastLine,
    systemContract,
  }
}

export function buildOpenCodeRail(prompt: string, agent?: string): string {
  return resolveOpenCodeRoute(prompt, agent).railBlock
}

/**
 * Force canonical multi-line rail. Rewrites model-invented single-line mashes
 * (e.g. "◇ RAIL · CITRINITAS · PLAN · 3/7 · mode ALGORITHM … NOESIS") and
 * wrong stage/sigil pairs. Places NOESIS on its own line after the rail.
 */
export function ensureVisibleRailPrefix(text: string, route: OpenCodeRoute): string {
  const raw = String(text || "")
  const announce = route.visibleAnnounce

  // Fast path: already exact multi-line announce for this route
  if (isCanonicalRailPrefix(raw, route)) {
    if (route.mode === "MINIMAL") return raw.startsWith(announce) ? raw : `${announce}\n\n${raw.trimStart()}`
    // Body after announce
    let after = raw.trimStart()
    if (after.startsWith(announce)) {
      after = after.slice(announce.length).replace(/^\n+/, "")
    } else {
      after = stripMalformedRailPrefix(raw)
    }
    if (after.startsWith("NOESIS")) {
      return `${announce}\n\n${after}`
    }
    return `${announce}\n\nNOESIS\n${after.replace(/^\n+/, "")}`
  }

  // Rewrite path: strip invented rail noise, re-apply canonical block
  const rest = stripMalformedRailPrefix(raw)
  if (route.mode === "MINIMAL") {
    if (!rest.trim()) return `${announce}\n`
    return `${announce}\n\n${rest.replace(/^\n+/, "")}`
  }

  const body = rest.replace(/^\s*NOESIS\s*\n*/i, "").replace(/^\n+/, "")
  if (!body.trim()) return `${announce}\n\nNOESIS\n`
  return `${announce}\n\nNOESIS\n${body}`
}

export function formatResolvedLine(
  route: OpenCodeRoute,
  resolved?: { provider?: string; model?: string },
): string {
  const provider = resolved?.provider || route.head?.provider || "omniroute"
  const model = resolved?.model || route.head?.rest || route.combo
  return [
    `☿ COMBO · ${route.combo} · RESOLVED`,
    `  ·  ${pad("provider")}${provider}`,
    `  ·  ${pad("model")}${model}`,
    `  ·  ${pad("route")}${provider}/${model}`,
  ].join("\n")
}
