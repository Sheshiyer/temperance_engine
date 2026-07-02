// package/enrich/resolver.ts -- the ONLY I/O in the SP0 enrichment pipeline.
// Reads live files and returns a ResolvedContext. Every field is probed inside its own
// try/catch; a failing probe yields null/empty for THAT field only. The function itself
// MUST NEVER throw -- an outer guard converts any unexpected error into the all-empty context.
//
// Resolution (fail-open at every step):
//   isaPath  : (1) <cwd>/ISA.md if present; else (2) newest ~/.claude/MEMORY/WORK/<ts>_<slug>/
//              dir containing ISA.md or PRD.md; else (3) null.
//   isa      : slice ## Principles / ## Constraints / ## Out of Scope sections; antiCriteria =
//              lines under ## Criteria beginning with 'Anti:' (or '- [ ] ISC-N (Anti: ...)').
//              Any absent section => '' (repo ISA.md legitimately lacks ## Principles).
//   memory   : PATHS ONLY, never file bodies. failed => newest record dir under
//              ~/.claude/MEMORY/LEARNING/FAILURES/. worked/open => project MEMORY.md near cwd/work
//              dir + newest REFLECTIONS|SIGNALS file. null when nothing is found.
//   planning : planningPresent/planningState from a `.planning` dir near cwd (else false/null).
// `home` override (default process.env.HOME) lets tests point resolution at a fixture home.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { EnrichInput, ResolvedContext } from './contract';

export interface ResolveOptions { home?: string; }

const EMPTY_MEMORY = { worked: null, failed: null, open: null } as const;

/** All-empty, fail-open context. Used as the base and as the outer-guard fallback. */
function emptyContext(input: EnrichInput): ResolvedContext {
  return {
    input,
    isaPath: null,
    isa: null,
    memory: { ...EMPTY_MEMORY },
    planningPresent: false,
    planningState: null,
  };
}

/** Read a UTF-8 file, or null on any error (missing, permission, not-a-file). */
function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Immediate child entries of `dir` as absolute paths, newest-first by mtime. [] on any error. */
function childrenNewestFirst(dir: string): string[] {
  try {
    const names = readdirSync(dir);
    const withTime = names.map((name) => {
      const full = join(dir, name);
      let mtime = 0;
      try {
        mtime = statSync(full).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { full, mtime };
    });
    withTime.sort((a, b) => b.mtime - a.mtime);
    return withTime.map((e) => e.full);
  } catch {
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// -- ISA resolution -----------------------------------------------------------

/**
 * Resolve the ISA/PRD path via the fail-open chain.
 * (1) <cwd>/ISA.md; else (2) newest WORK/<ts>_<slug>/ dir containing ISA.md or PRD.md; else null.
 * Returns the path to the ISA.md (or PRD.md) file itself, not the containing dir.
 */
function resolveIsaPath(cwd: string, home: string): string | null {
  try {
    const local = join(cwd, 'ISA.md');
    if (isFile(local)) return local;
  } catch {
    /* fall through to WORK scan */
  }

  try {
    if (!home) return null;
    const workRoot = join(home, '.claude', 'MEMORY', 'WORK');
    // Newest-first so the first dir carrying an ISA.md/PRD.md wins.
    for (const dir of childrenNewestFirst(workRoot)) {
      if (!isDir(dir)) continue;
      const isa = join(dir, 'ISA.md');
      if (isFile(isa)) return isa;
      const prd = join(dir, 'PRD.md');
      if (isFile(prd)) return prd;
    }
  } catch {
    /* fall through to null */
  }

  return null;
}

/**
 * Slice the body of a `## <Heading>` section: everything from the line after the header up to
 * (but not including) the next `## ` header or EOF. Trimmed. Returns '' when the section is absent.
 * Header match is case-insensitive on the heading text and tolerant of trailing whitespace.
 */
function sliceSection(md: string, heading: string): string {
  const lines = md.split(/\r?\n/);
  const target = heading.trim().toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = line.match(/^##\s+(.*?)\s*$/);
    if (m && (m[1] ?? '').trim().toLowerCase() === target) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return '';

  const body: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^##\s+/.test(line)) break;
    body.push(line);
  }
  return body.join('\n').trim();
}

/**
 * Anti-criteria = lines inside the ## Criteria section that assert a negative outcome:
 *   - a line beginning with 'Anti:' (after optional list/checkbox markers), OR
 *   - a checkbox item embedding an anti clause, e.g. '- [ ] ISC-3 (Anti: ...)'.
 * Returns the matching lines joined by newline, trimmed; '' when none / section absent.
 */
function extractAntiCriteria(md: string): string {
  const criteria = sliceSection(md, 'Criteria');
  if (!criteria) return '';
  const out: string[] = [];
  for (const raw of criteria.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Strip leading list / checkbox markers to test for a bare 'Anti:' start.
    const stripped = line.replace(/^[-*]\s*(\[[ xX]\]\s*)?/, '');
    if (/^Anti:/i.test(stripped)) {
      out.push(line);
      continue;
    }
    // Embedded anti clause inside a criterion, e.g. 'ISC-3 (Anti: ...)'.
    if (/\(Anti:/i.test(line)) {
      out.push(line);
    }
  }
  return out.join('\n').trim();
}

/** Parse an ISA/PRD markdown file into the four guardrail sections. null on unreadable file. */
function parseIsa(path: string): ResolvedContext['isa'] {
  const md = readTextOrNull(path);
  if (md === null) return null;
  return {
    principles: sliceSection(md, 'Principles'),
    constraints: sliceSection(md, 'Constraints'),
    outOfScope: sliceSection(md, 'Out of Scope'),
    antiCriteria: extractAntiCriteria(md),
  };
}

// -- Memory resolution (PATHS ONLY) -------------------------------------------

/**
 * Newest failure record under LEARNING/FAILURES. The live tree nests month dirs then record dirs;
 * we descend newest-first through directory levels and return the newest record directory (a dir
 * that is not itself just a container of further dated dirs). Falls back to the newest immediate
 * entry. Returns a PATH (never file contents), or null when the tree is empty/absent.
 */
function newestFailure(home: string): string | null {
  if (!home) return null;
  const root = join(home, '.claude', 'MEMORY', 'LEARNING', 'FAILURES');
  const top = childrenNewestFirst(root);
  if (top.length === 0) return null;

  const newestTop = top[0]!;
  // Direct file at the top level is already a record pointer.
  if (!isDir(newestTop)) return newestTop;

  // Descend one level into the newest month/container dir to reach the record dir.
  const inner = childrenNewestFirst(newestTop);
  if (inner.length === 0) return newestTop; // empty container: point at it rather than nothing.
  return inner[0]!;
}

/**
 * Newest file directly under a LEARNING subdir (e.g. REFLECTIONS, SIGNALS). Returns a PATH or null.
 * These dirs hold files directly (e.g. *.jsonl), so we take the newest immediate file.
 */
function newestLearningFile(home: string, sub: string): string | null {
  if (!home) return null;
  const dir = join(home, '.claude', 'MEMORY', 'LEARNING', sub);
  for (const entry of childrenNewestFirst(dir)) {
    if (isFile(entry)) return entry;
  }
  return null;
}

/**
 * Project-level MEMORY.md index near the work. We check, in order:
 *   - <cwd>/MEMORY.md
 *   - the directory of a resolved WORK-tree ISA/PRD (its sibling MEMORY.md)
 * Returns a PATH or null. Never returns file contents.
 */
function projectMemory(cwd: string, isaPath: string | null): string | null {
  try {
    const local = join(cwd, 'MEMORY.md');
    if (isFile(local)) return local;
  } catch {
    /* continue */
  }
  // If the ISA came from a WORK dir, a sibling MEMORY.md there is the project index.
  if (isaPath) {
    try {
      const idx = isaPath.lastIndexOf('/');
      if (idx > 0) {
        const sibling = join(isaPath.slice(0, idx), 'MEMORY.md');
        if (isFile(sibling)) return sibling;
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

// -- Planning resolution ------------------------------------------------------

/**
 * planningPresent/planningState from a `.planning` directory near cwd. Present when the dir exists
 * and has any entries; state is a short human hint (newest child's basename) or null. Fail-open.
 */
function resolvePlanning(cwd: string): { planningPresent: boolean; planningState: string | null } {
  try {
    const planningDir = join(cwd, '.planning');
    if (!isDir(planningDir)) return { planningPresent: false, planningState: null };
    const entries = childrenNewestFirst(planningDir);
    if (entries.length === 0) return { planningPresent: false, planningState: null };
    const newest = entries[0]!;
    const slash = newest.lastIndexOf('/');
    const base = slash >= 0 ? newest.slice(slash + 1) : newest;
    return { planningPresent: true, planningState: base || null };
  } catch {
    return { planningPresent: false, planningState: null };
  }
}

// -- Public entry point -------------------------------------------------------

export async function resolve(input: EnrichInput, opts: ResolveOptions = {}): Promise<ResolvedContext> {
  try {
    const home = opts.home ?? process.env.HOME ?? '';
    const cwd = input.cwd ?? '';
    const ctx = emptyContext(input);

    // ISA path + parsed sections (each guarded).
    try {
      ctx.isaPath = resolveIsaPath(cwd, home);
    } catch {
      ctx.isaPath = null;
    }
    if (ctx.isaPath) {
      try {
        ctx.isa = parseIsa(ctx.isaPath);
      } catch {
        ctx.isa = null;
      }
    }

    // Memory pointers (paths only), each field independently guarded.
    try {
      ctx.memory.failed = newestFailure(home);
    } catch {
      ctx.memory.failed = null;
    }
    try {
      // "worked" prefers the reflections stream; falls back to the project memory index.
      ctx.memory.worked = newestLearningFile(home, 'REFLECTIONS') ?? projectMemory(cwd, ctx.isaPath);
    } catch {
      ctx.memory.worked = null;
    }
    try {
      // "open" prefers the project memory index; falls back to the newest signals file.
      ctx.memory.open = projectMemory(cwd, ctx.isaPath) ?? newestLearningFile(home, 'SIGNALS');
    } catch {
      ctx.memory.open = null;
    }

    // Planning.
    try {
      const p = resolvePlanning(cwd);
      ctx.planningPresent = p.planningPresent;
      ctx.planningState = p.planningState;
    } catch {
      ctx.planningPresent = false;
      ctx.planningState = null;
    }

    return ctx;
  } catch {
    // Outer guard: the resolver must never throw out of the pipeline.
    return emptyContext(input);
  }
}
