// package/enrich/stages/dispatch.ts -- SP0 enrichment stage (owner: unit-dispatch).
// Emits: "dispatch: <state>" when planningPresent OR nextWave is actionable.
// Pure over ResolvedContext; fail-open (never throws out of the function).
import type { Stage } from '../contract';

export const dispatch: Stage = (ctx) => {
  try {
    const nw = ctx.nextWave;
    if (nw && nw.action && nw.action !== 'idle') {
      const ids = (nw.taskIds || []).slice(0, 4).join(',') || '—';
      const combo = nw.combo || 'noesis-build';
      const phase = nw.phase || 'wave';
      const mode = nw.mode || 'single';
      // Compact one-liner for the context block; full instruction is separate when present.
      let line =
        `dispatch: NEXT-WAVE PROPOSAL action=${nw.action} mode=${mode} phase="${phase}" ` +
        `combo=${combo} tasks=[${ids}] · held until a matching approval receipt is atomically claimed by the swarm control ledger`;
      if (nw.reason) line += ` · ${nw.reason.slice(0, 120)}`;
      return { line, degraded: false };
    }

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
