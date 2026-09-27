// package/enrich/contract.ts -- frozen SP0 enrichment contract. Do not fork.
export type Surface = 'claude' | 'codex' | 'opencode' | 'kimi' | 'command-code';
export type Mode = 'MINIMAL' | 'NATIVE' | 'ALGORITHM';

export interface EnrichInput { prompt: string; cwd: string; surface: Surface; }

export interface ContextSourcePointers {
  pai: string | null;
  gsd: string | null;
  skills: string | null;
  atlas: string | null;
}

/** Atlas operational metadata resolved from atlas-context.json. Null when absent/unreadable. */
export interface AtlasMetadata {
  containerPath: string;
  waveStatus: string;
  mountCommand: string;
  unmountCommand: string;
  designPlanPath: string;
  implPlanPath: string;
  isaPath: string;
  sessionProgressToolPath: string;
  workDir: string;
  lastVerified: string;
  containsTranscript: boolean;
}

/** Resolved by the I/O resolver from live files; stages are PURE over this. */
export interface ResolvedContext {
  input: EnrichInput;
  isaPath: string | null;
  isa: { principles: string; constraints: string; outOfScope: string; antiCriteria: string } | null;
  memory: { worked: string | null; failed: string | null; open: string | null };
  planningPresent: boolean;
  planningState: string | null;
  /**
   * Compact next-wave summary from temperance-next-wave (local GSD/spec-kit).
   * Null when absent or probe failed. Optional for pure-stage fixtures.
   */
  nextWave?: {
    action: string;
    reason: string;
    mode: string | null;
    phase: string | null;
    combo: string | null;
    taskIds: string[];
    instruction: string | null;
  } | null;
  /** Optional for backwards-compatible pure-stage fixtures; resolver always supplies it. */
  contextSources?: ContextSourcePointers;
  /** Atlas operational metadata (never session content). Null when unavailable. */
  atlasMetadata?: AtlasMetadata | null;
}

/** A stage returns one context line. Empty line => omitted from the block. */
export interface FieldResult { line: string; degraded: boolean; }
export type Stage = (ctx: ResolvedContext) => FieldResult;
