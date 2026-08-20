#!/usr/bin/env bun
/**
 * claude-prompthook.ts -- Claude Code UserPromptSubmit adapter for the
 * Temperance enrichment core. Installed live as ~/.claude/hooks/PromptProcessing.hook.ts
 * (mirrors package/hooks/codex/PromptProcessing.hook.ts, surface set to 'claude').
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
 *
 * Compose envelope (UPS last-wins): classifier + temperance-rail + gsd-rail +
 * pai-mode-offer. Persist /gsd:* mode so the next turn skips the picker.
 */

import { readFileSync, appendFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { persistSessionMode, readSessionMode } from './ManifestModeCommit.hook.ts';
import { buildContext as formatTemperanceRail } from './TemperanceRailAnnounce.hook.ts';
import { gsdAdditionalContext, loadGsdMap, parseCommand } from './GsdCommand.hook.ts';

function resolveEngineRoot(): string {
  if (process.env.TEMPERANCE_ENGINE_ROOT) return process.env.TEMPERANCE_ENGINE_ROOT;
  const product = join(homedir(), '.temperance_engine', 'product');
  try {
    if (existsSync(product)) return realpathSync(product);
  } catch { /* fall through */ }
  return join(homedir(), '.temperance_engine');
}

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
  const engineRoot = resolveEngineRoot();
  process.env.TEMPERANCE_ENGINE_ROOT ||= engineRoot;
  process.env.TEMPERANCE_ROUTER_DIR ||= join(engineRoot, 'package', 'router');
  process.env.TEMPERANCE_OMNIROUTE_PORTFOLIO_RESOLVER ||= join(engineRoot, 'package', 'router', 'omniroute-portfolios.ts');

  let additionalContext: string;
  try {
    const enrichDir = process.env.TEMPERANCE_ENRICH_DIR || join(homedir(), '.claude', 'PAI', 'enrich');
    const mod: any = await import(join(enrichDir, 'index.ts'));
    additionalContext = await mod.enrich({ prompt, cwd: process.cwd(), surface: 'claude' });
    if (typeof additionalContext !== 'string' || !additionalContext.trim()) throw new Error('empty');
  } catch {
    additionalContext = classifyLine(prompt); // never worse than the old shim
  }

  // Emit only after this adapter has the authoritative classifier result.
  try {
    const bridge = join(engineRoot, 'package', 'manifest-bridge', 'src');
    const { activateAlgorithmRun, classificationFromContext, loadActivationPolicy, publishActivationEvent } = await import(`${bridge}/activation.ts`);
    const { formatManifestRuntimeContext, formatPaiModeOffer, manifestRuntimeReceipt } = await import(`${bridge}/runtime-status.ts`);
    const classification = classificationFromContext(additionalContext);
    const activation = activateAlgorithmRun({ ...classification, cwd: process.cwd(), session_id: input.session_id, surface: 'claude' }, loadActivationPolicy());
    await publishActivationEvent(activation);
    if (classification.mode === 'ALGORITHM') {
      additionalContext = `${additionalContext}\n\n${formatManifestRuntimeContext(await manifestRuntimeReceipt({ activation, session_id: input.session_id }))}`;
    }
    const cwd = process.cwd();
    const parsed = parseCommand(prompt);
    const map = loadGsdMap();
    const boundRaw = parsed ? map.commands?.[parsed.name]?.mode : null;
    const bound = boundRaw === 'MINIMAL' || boundRaw === 'NATIVE' || boundRaw === 'ALGORITHM' ? boundRaw : null;
    if (bound && bound !== 'MINIMAL') persistSessionMode(input.session_id, bound, cwd, `gsd:${parsed?.name || 'command'}`);
    else if (!readSessionMode(input.session_id, cwd) && classification.mode === 'ALGORITHM') {
      persistSessionMode(input.session_id, 'ALGORITHM', cwd, 'classifier');
    }
    const chosen = readSessionMode(input.session_id, cwd);
    additionalContext = `${additionalContext}\n\n${formatTemperanceRail(prompt)}`;
    const gsd = gsdAdditionalContext(prompt, input.session_id, cwd);
    if (gsd) additionalContext = `${additionalContext}\n\n${gsd}`;
    additionalContext = `${additionalContext}\n\n${formatPaiModeOffer({
      session_id: input.session_id,
      project_id: activation.project?.project_id || activation.run?.project_id,
      chosen,
      bound,
      classifier: classification.mode,
      surface: 'claude',
    })}`;
    try {
      await fetch('http://127.0.0.1:8766/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `evt_hook_pp_${Date.now().toString(36)}`,
          source: 'pai-hook',
          kind: 'hook.receipt',
          status: 'observed',
          actor: 'PromptProcessing',
          session_id: input.session_id,
          payload: {
            hook: 'PromptProcessing',
            mode: classification.mode,
            envelopes: ['classifier', 'temperance-rail', gsd ? 'gsd-rail' : null, 'pai-mode-offer'].filter(Boolean),
          },
          evidence: [],
        }),
        signal: AbortSignal.timeout(400),
      });
    } catch { /* bridge optional */ }
  } catch {}

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
