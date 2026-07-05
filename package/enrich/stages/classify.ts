// package/enrich/stages/classify.ts -- SP0 mode/tier classifier stage.
// Ports ~/.claude/hooks/PromptProcessing.hook.ts classify() logic VERBATIM:
//   explicit /eN override, MINIMAL greetings/ratings, NATIVE single-step lookups,
//   else ALGORITHM with tier ladder (base 3; 4 system-affecting; 5 comprehensive; min 2 if trivial).
// Emits: "mode/tier: <MODE>[ / E<tier>] | reason: <...> | source: classifier"
// PURE over ResolvedContext, never throws, never degraded.
import type { Mode, Stage } from '../contract';

interface Classification {
  mode: Mode;
  tier: number | null;
  reason: string;
}

/** Explicit /e1../e5 override: preceded by start-or-whitespace, word-bounded. */
function explicitTier(prompt: string): number | null {
  const match = prompt.match(/(?:^|\s)\/e([1-5])\b/i);
  return match ? Number(match[1]) : null;
}

function isMinimal(prompt: string): boolean {
  const value = prompt.toLowerCase().trim();
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|yep|nope|cool|nice)$/.test(value)) return true;
  if (/^(10|[1-9])(?:\s*[-:]\s*)?$/.test(value)) return true;
  return false;
}

function isNative(prompt: string): boolean {
  const value = prompt.toLowerCase();
  const multiStep = /(build|create|implement|refactor|migrate|integrate|upgrade|debug|fix|investigate|design|plan|audit|review|multiple|all files|hook|algorithm|isa|pai|opencode|codex)/i;
  if (multiStep.test(prompt)) return false;
  if (value.split(/\s+/).length <= 16 && /^(what|when|where|who|which|show|list|run|read|tell)\b/.test(value)) return true;
  return false;
}

function classifyPrompt(prompt: string): Classification {
  const forcedTier = explicitTier(prompt);
  if (forcedTier) {
    return { mode: 'ALGORITHM', tier: forcedTier, reason: `explicit /e${forcedTier} tier override` };
  }

  if (isMinimal(prompt)) return { mode: 'MINIMAL', tier: null, reason: 'short acknowledgement, greeting, or rating' };
  if (isNative(prompt)) return { mode: 'NATIVE', tier: null, reason: 'single-step lookup or command-shaped request' };

  let tier = 3;
  if (/(algorithm|isa|pai|hook|system prompt|claude\.md|opencode|codex|upgrade|migration|pulse)/i.test(prompt)) tier = 4;
  if (/(comprehensive|all of|full|everything|end-to-end)/i.test(prompt)) tier = 5;
  if (/(quick|small|tiny|simple)/i.test(prompt)) tier = Math.min(tier, 2);

  return { mode: 'ALGORITHM', tier, reason: 'multi-step or system-affecting request' };
}

export const classify: Stage = (ctx) => {
  const prompt = String(ctx?.input?.prompt ?? '').trim();
  const result = classifyPrompt(prompt);
  const modeTier = result.mode === 'ALGORITHM' && result.tier !== null
    ? `${result.mode} / E${result.tier}`
    : result.mode;
  return {
    line: `mode/tier: ${modeTier} | reason: ${result.reason} | source: classifier`,
    degraded: false,
  };
};
