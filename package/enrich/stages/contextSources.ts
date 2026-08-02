import { isAbsolute } from 'node:path';
import type { ContextSourcePointers, Stage } from '../contract';

const UNSAFE_POINTER_CHARS = /[\u0000-\u001f\u007f<>\u2028\u2029]/u;
const SHARED_CLIENT_SURFACES = ['claude', 'codex', 'opencode', 'kimi', 'command-code'] as const;

function pointer(value: unknown): string | null {
  if (typeof value !== 'string' || !isAbsolute(value) || UNSAFE_POINTER_CHARS.test(value)) {
    return null;
  }
  return value;
}

function normalized(value: ContextSourcePointers | undefined): ContextSourcePointers {
  return {
    pai: pointer(value?.pai),
    gsd: pointer(value?.gsd),
    skills: pointer(value?.skills),
  };
}

/** Serialize fixed client-owned pointers as exactly one injection-safe JSON line. */
export const contextSources: Stage = (ctx) => {
  if (!SHARED_CLIENT_SURFACES.includes(ctx?.input?.surface as (typeof SHARED_CLIENT_SURFACES)[number])) {
    return { line: '', degraded: true };
  }
  const sources = normalized(ctx?.contextSources);
  const payload = JSON.stringify({
    pai: sources.pai,
    gsd: sources.gsd,
    skills: sources.skills,
    material: 'pointers-only',
  });
  return {
    line: `context-sources: ${payload}`,
    degraded: sources.pai === null && sources.gsd === null && sources.skills === null,
  };
};
