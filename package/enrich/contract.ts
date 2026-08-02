// package/enrich/contract.ts -- frozen SP0 enrichment contract. Do not fork.
export type Surface = 'claude' | 'codex' | 'opencode' | 'kimi' | 'command-code';
export type Mode = 'MINIMAL' | 'NATIVE' | 'ALGORITHM';

export interface EnrichInput { prompt: string; cwd: string; surface: Surface; }

export interface ContextSourcePointers {
  pai: string | null;
  gsd: string | null;
  skills: string | null;
}

/** Resolved by the I/O resolver from live files; stages are PURE over this. */
export interface ResolvedContext {
  input: EnrichInput;
  isaPath: string | null;
  isa: { principles: string; constraints: string; outOfScope: string; antiCriteria: string } | null;
  memory: { worked: string | null; failed: string | null; open: string | null };
  planningPresent: boolean;
  planningState: string | null;
  /** Optional for backwards-compatible pure-stage fixtures; resolver always supplies it. */
  contextSources?: ContextSourcePointers;
}

/** A stage returns one context line. Empty line => omitted from the block. */
export interface FieldResult { line: string; degraded: boolean; }
export type Stage = (ctx: ResolvedContext) => FieldResult;
