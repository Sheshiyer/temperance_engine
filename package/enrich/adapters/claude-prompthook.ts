#!/usr/bin/env bun
/**
 * claude-prompthook.ts -- Claude Code UserPromptSubmit adapter for the
 * Temperance enrichment core. Installed live as ~/.claude/hooks/PromptProcessing.hook.ts.
 *
 * Thin nerve: normalize stdin -> call the shared enrich core -> emit the
 * UserPromptSubmit additionalContext envelope. Contains NO enrichment logic
 * of its own beyond a classify-only FALLBACK that is byte-behaviorally the
 * old shim, so this hook can never be worse than what it replaces and can
 * never break a session:
 *   - core resolved at runtime (TEMPERANCE_ENRICH_DIR or ~/.claude/PAI/enrich),
 *     dynamically imported inside try/catch -> if the core is missing or
 *     throws, we fall back to the inline classifier.
 *   - always emits valid JSON, always exit 0.
 */

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

type Mode = 'MINIMAL' | 'NATIVE' | 'ALGORITHM';

function promptText(input: any): string {
  return String(input?.prompt || input?.user_prompt || '').trim();
}

// ---- Fallback classifier: verbatim behavior of the pre-SP0 shim ----
function explicitTier(prompt: string): number | null {
  const m = prompt.match(/(?:^|\s)\/e([1-5])\b/i);
  return m ? Number(m[1]) : null;
}
function classifyLine(prompt: string): string {
  const forced = explicitTier(prompt);
  if (forced) return `MODE: ALGORITHM | TIER: E${forced} | REASON: explicit /e${forced} tier override | SOURCE: fail-safe`;
  const v = prompt.toLowerCase().trim();
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|yep|nope|cool|nice)$/.test(v) || /^(10|[1-9])(?:\s*[-:]\s*)?$/.test(v))
    return `MODE: MINIMAL | REASON: short acknowledgement, greeting, or rating | SOURCE: fail-safe`;
  const multiStep = /(build|create|implement|refactor|migrate|integrate|upgrade|debug|fix|investigate|design|plan|audit|review|multiple|all files|hook|algorithm|isa|pai|opencode|codex)/i;
  if (!multiStep.test(prompt) && v.split(/\s+/).length <= 16 && /^(what|when|where|who|which|show|list|run|read|tell)\b/.test(v))
    return `MODE: NATIVE | REASON: single-step lookup or command-shaped request | SOURCE: fail-safe`;
  let tier = 3;
  if (/(algorithm|isa|pai|hook|system prompt|claude\.md|opencode|codex|upgrade|migration|pulse)/i.test(prompt)) tier = 4;
  if (/(comprehensive|all of|full|everything|end-to-end)/i.test(prompt)) tier = 5;
  if (/(quick|small|tiny|simple)/i.test(prompt)) tier = Math.min(tier, 2);
  return `MODE: ALGORITHM | TIER: E${tier} | REASON: multi-step or system-affecting request | SOURCE: fail-safe`;
}

async function main() {
  let input: any = {};
  try { input = JSON.parse(readFileSync(0, 'utf-8')); } catch {}
  const prompt = promptText(input);

  let additionalContext: string;
  try {
    const enrichDir = process.env.TEMPERANCE_ENRICH_DIR || join(homedir(), '.claude', 'PAI', 'enrich');
    const mod: any = await import(join(enrichDir, 'index.ts'));
    additionalContext = await mod.enrich({ prompt, cwd: process.cwd(), surface: 'claude' });
    if (typeof additionalContext !== 'string' || !additionalContext.trim()) throw new Error('empty');
  } catch {
    additionalContext = classifyLine(prompt); // never worse than the old shim
  }

  // best-effort telemetry (never fatal)
  try {
    const dir = join(homedir(), '.claude', 'MEMORY', 'OBSERVABILITY');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'mode-classifier.jsonl'),
      JSON.stringify({ timestamp: new Date().toISOString(), prompt_excerpt: prompt.slice(0, 200), source: 'temperance-enrich' }) + '\n');
  } catch {}

  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }));
}

main().catch(() => {
  // absolute last resort: emit a minimal valid envelope, never exit non-zero
  try { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'MODE: NATIVE | REASON: enrich hook error | SOURCE: fail-safe' } })); } catch {}
});
