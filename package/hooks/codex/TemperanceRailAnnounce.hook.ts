#!/usr/bin/env bun
/** Thin, fail-open Codex adapter. The shared router projection owns all phase metadata. */
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { homedir } from "node:os"
import { createRequire } from "node:module"

const requireModule = createRequire(import.meta.url)

function projectionModule(): { buildCodexRail(prompt: string): string } {
  const candidates = [
    process.env.TEMPERANCE_ROUTER_DIR && join(process.env.TEMPERANCE_ROUTER_DIR, "rail-announce.ts"),
    resolve(import.meta.dir, "../../router/rail-announce.ts"), // source tree
    join(process.env.TEMPERANCE_STATE || join(homedir(), ".temperance"), "router", "rail-announce.ts"),
    process.env.TEMPERANCE_ENGINE_ROOT && join(process.env.TEMPERANCE_ENGINE_ROOT, "package", "router", "rail-announce.ts"),
    join(homedir(), ".temperance_engine", "package", "router", "rail-announce.ts"),
  ]
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue
    try {
      const module = requireModule(candidate)
      if (typeof module.buildCodexRail === "function") return module
    } catch { /* A stale archive must not hide the installed managed projection. */ }
  }
  throw new Error("shared V4 rail projection unavailable")
}

export function buildContext(prompt: string): string {
  if (!prompt.trim()) return ""
  try { return projectionModule().buildCodexRail(prompt) }
  catch {
    return "## Temperance rail\n  ·  projection UNAVAILABLE\n  ·  worker UNVERIFIED · no actual-attempt evidence\n  ·  native independent of routed worker; model/context not reported"
  }
}

function main(): void {
  let input: any = {}
  try { input = JSON.parse(readFileSync(0, "utf8")) } catch { /* Empty input fails open. */ }
  const prompt = String(input.prompt || input.user_prompt || "").trim()
  const context = buildContext(prompt)
  // PromptProcessing owns emitted context during normal installed operation.
  // Explicit preview supports diagnostics without duplicate prompt injection.
  if (process.argv.includes("--preview")) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } }))
    return
  }
  if (!context || process.env.TEMPERANCE_RAIL_LOG === "0") return
  try {
    const dir = join(process.env.PAI_HOME || join(homedir(), ".claude"), "MEMORY", "OBSERVABILITY")
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, "temperance-rail.jsonl"), JSON.stringify({ timestamp: new Date().toISOString(), surface: "codex", context_excerpt: context.slice(0, 500) }) + "\n")
  } catch { /* Observability is optional and never blocks a prompt. */ }
}

if (import.meta.main) main()
