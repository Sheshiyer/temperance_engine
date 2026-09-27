import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { PHASES_V4, phaseMeta, formatRailHeader, configuredPhaseAlias, formatAttemptResolution } from "./phase-projection.v4"
import { formatResolvedLine, resolveOpenCodeRoute, ensureVisibleRailPrefix } from "./rail-announce"

const routerDir = import.meta.dir
const hook = resolve(routerDir, "../hooks/codex/TemperanceRailAnnounce.hook.ts")
let fixture: string
let env: Record<string, string | undefined>

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "temperance-rail-v4-"))
  env = {
    ...process.env,
    TEMPERANCE_PHASE_COMBO_MAP: join(fixture, "no-overlay.json"),
    TEMPERANCE_GSD_RAIL_MAP: join(routerDir, "gsd-rail-map.json"),
    TEMPERANCE_ROUTER_DIR: routerDir,
    TEMPERANCE_NATIVE_SESSION_MODEL: "",
    TEMPERANCE_CLASSIFY: "",
    TEMPERANCE_RAIL_LOG: "0",
  }
})
afterEach(() => rmSync(fixture, { recursive: true, force: true }))

function run(args: string[], input?: unknown, overrides: Record<string, string> = {}) {
  const result = Bun.spawnSync(args, { env: { ...env, ...overrides }, stdin: input === undefined ? "ignore" : Buffer.from(JSON.stringify(input)), stdout: "pipe", stderr: "pipe" })
  const out = result.stdout.toString()
  expect(result.exitCode).toBe(0)
  expect(result.stderr.toString()).toBe("")
  return out
}

describe("one V4 phase projection", () => {
  test("all phases include canonical alchemy and kosha without personal aliases", () => {
    expect(Object.keys(PHASES_V4)).toEqual(["observe", "think", "plan", "build", "execute", "verify", "learn"])
    expect(Object.values(PHASES_V4).map(meta => [meta.stage, meta.kosha])).toEqual([
      ["NIGREDO", "MANOMAYA"], ["ALBEDO", "VIJNANAMAYA"], ["CITRINITAS", "VIJNANAMAYA"],
      ["CITRINITAS", "ANNAMAYA"], ["RUBEDO", "PRANAMAYA"], ["RUBEDO", "VIJNANAMAYA"], ["RUBEDO", "ANANDAMAYA"],
    ])
    expect(JSON.stringify(PHASES_V4)).not.toContain("noesis-")
    expect(phaseMeta("planning")).toEqual(phaseMeta("plan"))
  })

  test("phase aliases are supplied separately in V4 or legacy maps", () => {
    expect(configuredPhaseAlias(null, "Plan", "te-plan")).toBe("te-plan")
    expect(configuredPhaseAlias({ phases: { plan: { lane_intent: "custom-plan" } } }, "Plan", "te-plan")).toBe("custom-plan")
    expect(configuredPhaseAlias({ algorithm_phases: { Plan: "personal-plan" } }, "Plan", "te-plan")).toBe("personal-plan")
  })

  test("header does not infer actual resolution from provider/model strings", () => {
    expect(formatAttemptResolution("custom-plan", { provider: "provider", model: "model" })).toContain("UNVERIFIED")
    const evidence = { source: "actual-attempt", combo: "custom-plan", attemptId: "attempt-1", provider: "provider", connectionId: "private-account-id", model: "model", observedAt: "2026-09-19T00:00:00.000Z" }
    expect(formatAttemptResolution("other-alias", evidence)).toContain("UNVERIFIED")
    const output = formatAttemptResolution("custom-plan", evidence)
    expect(output).toContain("OBSERVED ATTEMPT")
    expect(output).toContain("attempt-1")
    expect(output).not.toContain("private-account-id")
    expect(output).not.toContain("RESOLVED")
  })

  test("OpenCode never promotes the configured head into an actual attempt", () => {
    const route = resolveOpenCodeRoute("implementation plan", "temperance-planner")
    route.head = { i: 1, provider: "configured", rest: "not-observed", mid: "configured/not-observed" }
    expect(formatResolvedLine(route)).toContain("UNVERIFIED")
    expect(formatResolvedLine(route)).not.toContain("configured/not-observed")
    expect(route.systemContract).not.toContain("PLAN = ALBEDO")
    expect(route.visibleAnnounce).toContain("VIJNANAMAYA")
    const normalized = ensureVisibleRailPrefix("☉ RAIL · ALBEDO · PLAN · 3/7\n  ·  combo stale\n\nBody", route)
    expect(normalized).toContain(formatRailHeader(phaseMeta("plan")))
    expect(normalized).not.toContain("ALBEDO · PLAN")
  })
})

describe("real shell and hook entry points", () => {
  test("CLI announces all seven phases through the shared projection", () => {
    for (const phase of Object.keys(PHASES_V4)) {
      const out = run(["bash", join(routerDir, "rail-format.sh"), "announce", phase, `custom-${phase}`])
      expect(out).toStartWith(formatRailHeader(phaseMeta(phase)))
      expect(out).toContain("UNVERIFIED")
      expect(out).toContain("not a 9Router worker")
      expect(out).not.toContain("gpt-")
    }
  })

  test("legacy resolved CLI cannot assert success from positional strings", () => {
    const out = run(["bash", join(routerDir, "rail-format.sh"), "resolved", "custom-plan", "guessed-provider", "guessed-model"])
    expect(out).toContain("UNVERIFIED")
    expect(out).not.toContain("guessed-model")
  })

  test("synthetic Codex stdin produces real shared kosha projection with no overlay", () => {
    const result = JSON.parse(run([process.execPath, hook, "--preview"], { prompt: "Create an implementation plan" }))
    const context = result.hookSpecificOutput.additionalContext
    expect(context).toContain(formatRailHeader(phaseMeta("plan")))
    expect(context).toContain("te-plan")
    expect(context).toContain("native; not a 9Router worker")
    expect(context).toContain("UNVERIFIED")
    expect(context).not.toContain("noesis-")
    expect(context).not.toContain("provider <name>")
  })

  test("optional personal layer supplies its aliases without changing header metadata", () => {
    const map = join(fixture, "overlay.json")
    writeFileSync(map, JSON.stringify({ phases: { plan: { lane_intent: "noesis-plan" } } }))
    const out = run([process.execPath, hook, "--preview"], { prompt: "Create an implementation plan" }, { TEMPERANCE_PHASE_COMBO_MAP: map })
    expect(out).toContain("noesis-plan")
    expect(out).toContain("CITRINITAS · PLAN · 3/7 · VIJNANAMAYA")
  })

  test("Claude and Codex installed hooks resolve state/router independently of archive layout", () => {
    const state = join(fixture, "state")
    mkdirSync(join(state, "router"), { recursive: true })
    for (const name of ["rail-announce.ts", "phase-projection.v4.ts", "task-classification.ts"]) copyFileSync(join(routerDir, name), join(state, "router", name))
    for (const surface of [".claude", ".codex"]) {
      const hookDir = join(fixture, surface, "hooks")
      const installedHook = join(hookDir, "TemperanceRailAnnounce.hook.ts")
      mkdirSync(hookDir, { recursive: true })
      copyFileSync(hook, installedHook)
      const out = run([process.execPath, installedHook, "--preview"], { prompt: "Create an implementation plan" }, { TEMPERANCE_ROUTER_DIR: "", TEMPERANCE_STATE: state })
      expect(out).toContain("CITRINITAS · PLAN · 3/7 · VIJNANAMAYA")
      expect(out).not.toContain("projection UNAVAILABLE")
    }
  })

  test("GSD CLI uses stage and route declarations, never guessed observed seats", () => {
    const out = run(["bash", join(routerDir, "rail-format.sh"), "gsd-init", "plan-phase"])
    expect(out).toContain("CITRINITAS · PLAN · 3/7 · VIJNANAMAYA")
    expect(out).toContain("/gsd:plan-phase")
    expect(out).toContain("UNVERIFIED")
  })

  test("header entry points contain no legacy SQLite reads or Python runtime", () => {
    for (const file of [hook, join(routerDir, "rail-announce.ts"), join(routerDir, "rail-format.sh")]) {
      const source = readFileSync(file, "utf8")
      expect(source).not.toContain(".omniroute")
      expect(source).not.toContain("sqlite3")
      expect(source).not.toContain("python3")
    }
  })
})
