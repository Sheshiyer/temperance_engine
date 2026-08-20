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
    /(build|create|implement|refactor|migrate|integrate|upgrade|debug|fix|investigate|design|plan|audit|review|multiple|all files|algorithm|isa|pai)/i
  if (!multi.test(prompt) && v.split(/\s+/).length <= 16) return "NATIVE"
  return "ALGORITHM"
}

function phaseForTaskType(tt: string): string {
  switch (tt) {
    case "plan":
    case "planning":
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

/** Planetary sigils + alchemical stage names (no emoji). */
function phaseMeta(phase: string): PhaseMeta {
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

type StackRow = { i: number; provider: string; rest: string; mid: string }

function loadComboStack(combo: string): StackRow[] {
  const db = process.env.OMNIROUTE_DB || join(homedir(), ".omniroute", "storage.sqlite")
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
      const provider = String(m.providerId || (mid.includes("/") ? mid.split("/")[0] : "omniroute"))
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
  lines.push(`  ·  ${pad("workers")}te-dispatch-paid`)
  lines.push(`  ·  ${pad("capacity")}te-fast`)
  lines.push("")
  lines.push("CONTRACT")
  lines.push("  ·  Native session babysits only unless --profile te-* is active.")
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
    `  ·  temperance-batch … model te-dispatch-paid  (Execute fleet)`,
  )
  lines.push("")
  lines.push("ANNOUNCE (paste at phase transitions)")
  lines.push(
    `  ${meta.sigil} RAIL · ${meta.stage} · ${meta.label} · ${meta.step}/${meta.total}`,
  )
  lines.push(
    `  ·  native ${opts.nativeModel} · combo ${opts.combo}` +
      (head ? ` · head ${head.provider}/${head.rest}` : ""),
  )
  lines.push(
    `  ☿ COMBO · ${opts.combo} · RESOLVED`,
  )
  lines.push(`  ·  provider <name> · model <id>`)

  return ["<temperance-rail>", ...lines, "</temperance-rail>"].join("\n")
}

export function buildContext(prompt: string): string {
  const map = loadMap()
  const mode = classifyMode(prompt)
  const taskType = classifyTaskType(prompt)
  const combo =
    (map?.task_type_to_combo && map.task_type_to_combo[taskType]) ||
    (taskType === "plan" ? "te-plan" : "te-fast")
  const phase = phaseForTaskType(taskType)
  const phaseCombo =
    (map?.algorithm_phases && map.algorithm_phases[phase]) || combo
  const nativeModel =
    map?.native_orchestrator?.model ||
    process.env.TEMPERANCE_ORCHESTRATOR_MODEL ||
    "gpt-5.4"
  const stack = loadComboStack(phaseCombo)

  return formatRailBlock({
    mode,
    taskType,
    phase,
    combo: phaseCombo,
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
      "  ·  combo      te-fast",
      "</temperance-rail>",
    ].join("\n")
  }
  // UPS last-wins: PromptProcessing composes <temperance-rail>. This hook only logs.
}

if (import.meta.main) {
  main()
}
