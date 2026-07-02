// package/enrich/index.ts -- SP0 enrichment assembler (SHARED, frozen wiring). Do not fork.
// Contract: enrich() runs resolve() then the six pure stages in fixed order, drops empty lines,
// and wraps the survivors in a <temperance-context> block. It NEVER throws.
//
// Block shape (stubs emit mostly-empty lines, so early output is sparse -- that is expected):
//   <temperance-context>
//   mode/tier: ... | reason: ... | source: ...
//   intent: ... | not: ...
//   guardrails: ... | anti: ...
//   isa: ...
//   memory: worked=... failed=... open=...
//   dispatch: ...        # only when planningPresent
//   </temperance-context>
import type { EnrichInput, FieldResult, Stage } from './contract';
import { resolve } from './resolver';
import { classify } from './stages/classify';
import { intent } from './stages/intent';
import { guardrails } from './stages/guardrails';
import { isaPointer } from './stages/isaPointer';
import { memory } from './stages/memory';
import { dispatch } from './stages/dispatch';

// Fixed stage order. Implementers own one entry each; the order is frozen here.
const STAGES: Stage[] = [classify, intent, guardrails, isaPointer, memory, dispatch];

const OPEN = '<temperance-context>';
const CLOSE = '</temperance-context>';

function wrap(lines: string[]): string {
  const body = lines.filter((l) => l && l.trim().length > 0);
  return [OPEN, ...body, CLOSE].join('\n');
}

/** Minimal fallback block used when resolve() throws: classify-only, fail-safe source. */
function fallbackBlock(input: EnrichInput): string {
  // Classify is a pure function over ResolvedContext, but the resolver just failed, so we cannot
  // trust a resolved context. Emit an explicit fail-safe marker line instead of running stages.
  void input;
  return wrap(['mode/tier: NATIVE | reason: enrichment resolve failed | source: fail-safe']);
}

export async function enrich(input: EnrichInput): Promise<string> {
  try {
    const ctx = await resolve(input);
    const results: FieldResult[] = STAGES.map((stage) => {
      try {
        return stage(ctx);
      } catch {
        // A stage must never take down the block; treat a throwing stage as an omitted line.
        return { line: '', degraded: true };
      }
    });
    return wrap(results.map((r) => r.line));
  } catch {
    // resolve() failed-open contract-breach or any other error: never throw out of enrich().
    return fallbackBlock(input);
  }
}
