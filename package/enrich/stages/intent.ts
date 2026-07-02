// package/enrich/stages/intent.ts -- intent stage (owner: unit-intent).
// Emits: "intent: <one-sentence objective> | not: <not-wants or \"none\">"
// PURE over ResolvedContext. Never throws. Never degraded: always falls back
// to echoing the (normalized) prompt as the objective.
import type { Stage } from '../contract';

/** Collapse all runs of whitespace to single spaces and trim the ends. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * First clause of the objective: cut at the first strong boundary
 * (sentence end . ! ? ; or newline). Keeps commas intact so short
 * comma-joined objectives survive whole. Falls back to the full string.
 */
function firstClause(s: string): string {
  const m = s.match(/^[^.!?;\n]+/);
  const clause = (m ? m[0] : s).trim();
  return clause.length > 0 ? clause : s;
}

/**
 * Extract a "not-wants" phrase from negative cues, if any.
 * Cues (case-insensitive), tried in priority order on the collapsed prompt:
 *   don't / do not / doesn't / does not <x>
 *   avoid <x>
 *   without <x>
 *   no <x>       (noun-ish; skipped when it's a bare yes/no answer)
 *   not <x>      (lowest priority; broadest)
 * Returns the trailing phrase after the cue (trimmed, clause-bounded), or
 * null when no cue fires. Never throws.
 */
function extractNot(prompt: string): string | null {
  const p = collapse(prompt);
  // Ordered so more-specific / stronger cues win over the broad "not".
  const patterns: RegExp[] = [
    /\b(?:do(?:es)?n['’]?t|do(?:es)? not)\s+(.+)/i,
    /\bavoid\s+(.+)/i,
    /\bwithout\s+(.+)/i,
    /\bno\s+(.+)/i,
    /\bnot\s+(.+)/i,
  ];
  for (const re of patterns) {
    const m = p.match(re);
    if (m && m[1]) {
      // Bound the captured phrase to its own clause so we don't drag in
      // unrelated trailing sentences.
      const phrase = firstClause(m[1]).replace(/[.,;:!?]+$/, '').trim();
      if (phrase.length > 0) return phrase;
    }
  }
  return null;
}

export const intent: Stage = (ctx) => {
  const raw = ctx?.input?.prompt;
  const prompt = typeof raw === 'string' ? raw : '';
  const normalized = collapse(prompt);

  // Objective: first clause of the normalized prompt; echo-fallback keeps
  // this stage non-degraded even on odd input.
  const objective = firstClause(normalized) || normalized;

  const notWants = extractNot(prompt);
  const notField = notWants && notWants.length > 0 ? notWants : 'none';

  return {
    line: `intent: ${objective} | not: ${notField}`,
    degraded: false,
  };
};
