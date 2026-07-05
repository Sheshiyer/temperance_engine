// package/enrich/stages/isaPointer.ts -- SP0 enrichment stage (owner: unit-isaPointer).
// PURE over ResolvedContext; never throws. Emits the ISA-pointer line.
// Format: "isa: <ctx.isaPath or \"none\">"  (path only, never file body).
// degraded=true when no ISA path was resolved.
import type { Stage } from '../contract';

export const isaPointer: Stage = (ctx) => {
  const path = ctx?.isaPath;
  if (typeof path === 'string' && path.trim() !== '') {
    return { line: `isa: ${path}`, degraded: false };
  }
  return { line: 'isa: none', degraded: true };
};
