// package/enrich/stages/dispatch.ts -- SP0 enrichment stage (owner: unit-dispatch).
// Emits: "dispatch: <state>" ONLY when ctx.planningPresent; otherwise empty line (omitted).
// Pure over ResolvedContext; fail-open (never throws out of the function).
import type { Stage } from '../contract';

export const dispatch: Stage = (ctx) => {
  try {
    if (!ctx.planningPresent) {
      return { line: '', degraded: false };
    }
    const raw = ctx.planningState;
    const state =
      typeof raw === 'string' && raw.trim().length > 0
        ? raw.trim()
        : '.planning present';
    return { line: `dispatch: ${state}`, degraded: false };
  } catch {
    // Fail-open: never throw out of a stage. Omit the line on any surprise.
    return { line: '', degraded: true };
  }
};
