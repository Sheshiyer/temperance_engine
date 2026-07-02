// package/enrich/stages/memory.ts -- memory pointer stage (owner: unit-memory).
// Emits: "memory: worked=<ptr|none> failed=<ptr|none> open=<ptr|none>" (PATHS only, never file bodies)
// Pure over ResolvedContext; never throws. degraded=true when all three pointers are null.
import type { Stage } from '../contract';

const ptr = (v: string | null | undefined): string => {
  if (typeof v !== 'string') return 'none';
  const t = v.trim();
  return t.length > 0 ? t : 'none';
};

export const memory: Stage = (ctx) => {
  const mem = ctx?.memory ?? { worked: null, failed: null, open: null };
  const worked = ptr(mem.worked);
  const failed = ptr(mem.failed);
  const open = ptr(mem.open);
  const degraded = worked === 'none' && failed === 'none' && open === 'none';
  return {
    line: `memory: worked=${worked} failed=${failed} open=${open}`,
    degraded,
  };
};
