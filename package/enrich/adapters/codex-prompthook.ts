#!/usr/bin/env bun
/**
 * Codex UserPromptSubmit adapter for the shared Temperance enrichment core.
 *
 * This intentionally mirrors claude-prompthook.ts but identifies the client
 * surface as `codex`. It is a thin runtime adapter: the installed enrichment
 * tree remains the single source of context behavior and this hook always
 * emits a valid UserPromptSubmit envelope, even when the tree is unavailable.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

function promptText(input: any): string {
  return String(input?.prompt || input?.user_prompt || "").trim()
}

function explicitTier(prompt: string): number | null {
  const match = prompt.match(/(?:^|\s)\/e([1-5])\b/i)
  return match ? Number(match[1]) : null
}

function fallback(prompt: string): string {
  const forced = explicitTier(prompt)
  if (forced) return `MODE: ALGORITHM | TIER: E${forced} | REASON: explicit /e${forced} tier override | SOURCE: fail-safe`
  const value = prompt.toLowerCase().trim()
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|yep|nope|cool|nice)$/.test(value)) {
    return "MODE: MINIMAL | REASON: short acknowledgement, greeting, or rating | SOURCE: fail-safe"
  }
  return "MODE: ALGORITHM | TIER: E3 | REASON: enrichment unavailable | SOURCE: fail-safe"
}

function emit(additionalContext: string): void {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  }))
}

async function main(): Promise<void> {
  let input: any = {}
  try {
    input = JSON.parse(readFileSync(0, "utf8"))
  } catch {}

  const prompt = promptText(input)
  let additionalContext: string
  try {
    const enrichDir = process.env.TEMPERANCE_ENRICH_DIR || join(homedir(), ".claude", "PAI", "enrich")
    const mod: any = await import(join(enrichDir, "index.ts"))
    additionalContext = await mod.enrich({ prompt, cwd: process.cwd(), surface: "codex" })
    if (typeof additionalContext !== "string" || !additionalContext.trim()) throw new Error("empty enrichment")
  } catch {
    additionalContext = fallback(prompt)
  }

  try {
    const directory = join(homedir(), ".claude", "MEMORY", "OBSERVABILITY")
    mkdirSync(directory, { recursive: true })
    appendFileSync(join(directory, "mode-classifier.jsonl"), `${JSON.stringify({
      timestamp: new Date().toISOString(),
      prompt_excerpt: prompt.slice(0, 200),
      source: "temperance-enrich",
      surface: "codex",
    })}\n`)
  } catch {}

  emit(additionalContext)
}

void main().catch(() => emit("MODE: NATIVE | REASON: Codex enrichment hook error | SOURCE: fail-safe"))
