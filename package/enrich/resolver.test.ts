// package/enrich/resolver.test.ts -- unit tests for the ONLY I/O stage.
// Builds a throwaway fixture home + cwd on disk, exercises the resolution chain against real
// files, and asserts the fail-open contract. Run: bun test package/enrich/resolver.ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EnrichInput } from './contract';
import { resolve } from './resolver';

// --- fixture layout ----------------------------------------------------------
let root: string;          // throwaway sandbox root
let cwd: string;           // fake project dir (holds ISA.md + MEMORY.md)
let home: string;          // fake HOME (holds .claude/MEMORY tree)
let failuresNewest: string; // expected newest failure record dir
let reflectionsFile: string;

const ISA_MD = `---
project: fixture
---

## Problem

Some problem statement. No Principles section on purpose (fail-open to '').

## Constraints

- The resolver must fail-open and never throw.
- Memory fields carry PATHS only, never file contents.

## Out of Scope

Bundling private memory or credentials is out of scope.

## Criteria

- [x] ISC-1: enrich() never throws.
- [ ] ISC-3 (Anti: the block must never contain raw file bodies, only pointers).
Anti: never scan the whole cluster tree at startup.

## Verification

- bun test passes.
`;

function mk(input: Partial<EnrichInput> = {}): EnrichInput {
  return { prompt: 'refactor the thing', cwd, surface: 'claude', ...input };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'resolver-test-'));
  cwd = join(root, 'proj');
  home = join(root, 'home');

  // Project dir: ISA.md + a project MEMORY.md index.
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'ISA.md'), ISA_MD, 'utf8');
  writeFileSync(join(cwd, 'MEMORY.md'), '# index\n- pointer only\n', 'utf8');

  // Fake HOME/.claude/MEMORY/LEARNING tree.
  const learning = join(home, '.claude', 'MEMORY', 'LEARNING');

  // FAILURES: month dir -> two record dirs; assert the newer one is chosen.
  const monthDir = join(learning, 'FAILURES', '2026-06');
  const older = join(monthDir, '2026-06-01_older-failure');
  failuresNewest = join(monthDir, '2026-06-30_newer-failure');
  mkdirSync(older, { recursive: true });
  mkdirSync(failuresNewest, { recursive: true });
  writeFileSync(join(older, 'CONTEXT.md'), 'old', 'utf8');
  writeFileSync(join(failuresNewest, 'CONTEXT.md'), 'new', 'utf8');
  // Force mtimes so "newest" is deterministic regardless of creation order.
  const t = (iso: string) => new Date(iso).getTime() / 1000;
  utimesSync(older, t('2026-06-01T00:00:00Z'), t('2026-06-01T00:00:00Z'));
  utimesSync(failuresNewest, t('2026-06-30T00:00:00Z'), t('2026-06-30T00:00:00Z'));
  utimesSync(monthDir, t('2026-06-30T00:00:00Z'), t('2026-06-30T00:00:00Z'));

  // REFLECTIONS: a single file, taken as the "worked" pointer.
  const reflections = join(learning, 'REFLECTIONS');
  mkdirSync(reflections, { recursive: true });
  reflectionsFile = join(reflections, '2026-06-30_reflection.md');
  writeFileSync(reflectionsFile, '# reflection body (must NOT be returned)\n', 'utf8');

  // .planning dir near cwd, with one phase entry.
  const planning = join(cwd, '.planning');
  mkdirSync(planning, { recursive: true });
  writeFileSync(join(planning, 'phase-2.md'), 'in progress\n', 'utf8');
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// --- tests -------------------------------------------------------------------

describe('resolve()', () => {
  test('parses ISA sections, fails-open on the absent ## Principles, and extracts both anti styles', async () => {
    const ctx = await resolve(mk(), { home });

    expect(ctx.isaPath).toBe(join(cwd, 'ISA.md'));
    expect(ctx.isa).not.toBeNull();
    // Absent section resolves to '' rather than null/throw.
    expect(ctx.isa!.principles).toBe('');
    // Present sections are sliced between '## ' headers (body only, header excluded).
    expect(ctx.isa!.constraints).toContain('Memory fields carry PATHS only');
    expect(ctx.isa!.constraints).not.toContain('## Constraints');
    expect(ctx.isa!.outOfScope).toContain('out of scope');
    // Anti-criteria captures BOTH the embedded '(Anti: ...)' checkbox and the bare 'Anti:' line.
    expect(ctx.isa!.antiCriteria).toContain('only pointers');
    expect(ctx.isa!.antiCriteria).toContain('never scan the whole cluster tree');
    // ...and does NOT swallow ordinary (non-anti) criteria lines.
    expect(ctx.isa!.antiCriteria).not.toContain('enrich() never throws');
  });

  test('memory fields are PATHS under the fixture home, never file bodies', async () => {
    const ctx = await resolve(mk(), { home });

    // failed => the NEWER of the two failure record dirs.
    expect(ctx.memory.failed).toBe(failuresNewest);
    // worked => newest REFLECTIONS file (a path, not its contents).
    expect(ctx.memory.worked).toBe(reflectionsFile);
    // open => the project MEMORY.md index near cwd.
    expect(ctx.memory.open).toBe(join(cwd, 'MEMORY.md'));
    // Hard guarantee: no field carries the reflection file's body.
    for (const v of [ctx.memory.failed, ctx.memory.worked, ctx.memory.open]) {
      expect(v).not.toContain('reflection body');
    }
  });

  test('detects the .planning dir near cwd', async () => {
    const ctx = await resolve(mk(), { home });
    expect(ctx.planningPresent).toBe(true);
    expect(ctx.planningState).toBe('phase-2.md');
  });

  test('fails open: bogus cwd + bogus home never throws and yields the empty context', async () => {
    const ctx = await resolve(
      { prompt: 'x', cwd: '/nonexistent/definitely/not/here', surface: 'codex' },
      { home: '/nonexistent/home/xyz' },
    );
    expect(ctx.isaPath).toBeNull();
    expect(ctx.isa).toBeNull();
    expect(ctx.memory).toEqual({ worked: null, failed: null, open: null });
    expect(ctx.planningPresent).toBe(false);
    expect(ctx.planningState).toBeNull();
    // input is always echoed through untouched.
    expect(ctx.input.surface).toBe('codex');
  });
});
