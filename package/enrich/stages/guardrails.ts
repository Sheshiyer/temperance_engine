// package/enrich/stages/guardrails.ts -- SP0 enrichment guardrails stage (owner: unit-guardrails).
// Emits: "guardrails: <key principle/constraint/out-of-scope, or \"none\"> | anti: <one Anti line or \"none\">"
// Pure over ResolvedContext; never throws. Surfaces the first non-empty of
// principles/constraints/outOfScope (one trimmed line) + the first antiCriteria line.
import type { Stage } from '../contract';

/** First non-empty, trimmed physical line of a multi-line block; '' if none. */
function firstLine(block: string | null | undefined): string {
  if (typeof block !== 'string') return '';
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (line) return line;
  }
  return '';
}

export const guardrails: Stage = (ctx) => {
  const isa = ctx?.isa;
  if (!isa) {
    return { line: 'guardrails: none | anti: none', degraded: true };
  }

  // First non-empty of principles -> constraints -> outOfScope (one trimmed line).
  const guard =
    firstLine(isa.principles) ||
    firstLine(isa.constraints) ||
    firstLine(isa.outOfScope) ||
    'none';

  // First anti-criteria line.
  const anti = firstLine(isa.antiCriteria) || 'none';

  // Degraded only if the ISA object carried nothing usable in either field.
  const degraded = guard === 'none' && anti === 'none';

  return { line: `guardrails: ${guard} | anti: ${anti}`, degraded };
};
