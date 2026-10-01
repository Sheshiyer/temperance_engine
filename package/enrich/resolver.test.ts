// package/enrich/resolver.test.ts -- unit tests for the ONLY I/O stage.
// Builds a throwaway fixture home + cwd on disk, exercises the resolution chain against real
// files, and asserts the fail-open contract. Run: bun test package/enrich/resolver.ts
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import * as fs from 'node:fs';
import * as childProcess from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EnrichInput } from './contract';
import { resolve } from './resolver';

// --- fixture layout ----------------------------------------------------------
let root: string;          // throwaway sandbox root
let cwd: string;           // fake project dir (holds ISA.md + MEMORY.md)
let planningCwd: string;   // fake project dir with .planning present
let emptyPlanningCwd: string; // fake project dir with an empty .planning dir
let filePlanningCwd: string;  // fake project dir with .planning as a file
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
  planningCwd = join(root, 'proj-with-planning');
  emptyPlanningCwd = join(root, 'proj-with-empty-planning');
  filePlanningCwd = join(root, 'proj-with-file-planning');
  home = join(root, 'home');

  // Project dir: ISA.md + a project MEMORY.md index.
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'ISA.md'), ISA_MD, 'utf8');
  writeFileSync(join(cwd, 'MEMORY.md'), '# index\n- pointer only\n', 'utf8');
  mkdirSync(planningCwd, { recursive: true });
  writeFileSync(join(planningCwd, 'ISA.md'), ISA_MD, 'utf8');
  writeFileSync(join(planningCwd, 'MEMORY.md'), '# index\n- pointer only\n', 'utf8');
  mkdirSync(emptyPlanningCwd, { recursive: true });
  writeFileSync(join(emptyPlanningCwd, 'ISA.md'), ISA_MD, 'utf8');
  writeFileSync(join(emptyPlanningCwd, 'MEMORY.md'), '# index\n- pointer only\n', 'utf8');
  mkdirSync(filePlanningCwd, { recursive: true });
  writeFileSync(join(filePlanningCwd, 'ISA.md'), ISA_MD, 'utf8');
  writeFileSync(join(filePlanningCwd, 'MEMORY.md'), '# index\n- pointer only\n', 'utf8');

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

  // .planning dir in a separate fixture so absent and present are distinct contracts.
  const planning = join(planningCwd, '.planning');
  mkdirSync(planning, { recursive: true });
  const phase1 = join(planning, 'phase-1.md');
  const phase2 = join(planning, 'phase-2.md');
  writeFileSync(phase1, 'old state\n', 'utf8');
  writeFileSync(phase2, 'newest state body must not leak\n', 'utf8');
  utimesSync(phase1, t('2026-06-01T00:00:00Z'), t('2026-06-01T00:00:00Z'));
  utimesSync(phase2, t('2026-06-30T00:00:00Z'), t('2026-06-30T00:00:00Z'));
  mkdirSync(join(emptyPlanningCwd, '.planning'), { recursive: true });
  writeFileSync(join(filePlanningCwd, '.planning'), 'not a directory\n', 'utf8');
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

  test('ignores private metadata for both default and explicit homes without reading its body', async () => {
    const privateDir = join(home, '.claude', 'MEMORY', 'STATE');
    mkdirSync(privateDir, { recursive: true });
    const privateFile = join(privateDir, 'atlas-context.json');
    writeFileSync(privateFile, JSON.stringify({
      containerPath: '/PRIVATE_CONTAINER_MARKER', containsTranscript: false,
      mountCommand: 'PRIVATE_MOUNT_COMMAND', sessionProgressToolPath: '/PRIVATE_SESSION_TOOL',
      body: 'PRIVATE_BODY_AND_SESSION_MARKER',
    }));
    const readPaths: string[] = [];
    const original = fs.readFileSync;
    const spy = spyOn(fs, 'readFileSync').mockImplementation(((path: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) => {
      readPaths.push(String(path));
      return (original as Function)(path, ...args);
    }) as typeof fs.readFileSync);
    const priorHome = process.env.HOME;
    process.env.HOME = home;
    try {
      for (const options of [undefined, { home }]) {
        const ctx = await resolve(mk({ prompt: 'recall previous atlas session' }), options);
        expect(ctx.contextSources?.atlas).toBeNull();
        expect(Object.hasOwn(ctx, 'atlasMetadata')).toBe(false);
        expect(JSON.stringify(ctx)).not.toContain('PRIVATE_');
        expect(JSON.stringify(ctx)).not.toContain(privateFile);
        expect(ctx.isaPath).toBe(join(cwd, 'ISA.md'));
      }
      expect(readPaths).not.toContain(privateFile);
      expect(readPaths).toContain(join(cwd, 'ISA.md'));
    } finally {
      spy.mockRestore();
      if (priorHome === undefined) delete process.env.HOME;
      else process.env.HOME = priorHome;
    }
  });

  test('next-wave uses only the fixture helper and returns a summary without executing its instruction', async () => {
    const fixtureHome = join(root, 'wave-home');
    const helper = join(fixtureHome, '.temperance_engine', 'router', 'temperance-next-wave.mjs');
    mkdirSync(join(fixtureHome, '.temperance_engine', 'router'), { recursive: true });
    writeFileSync(helper, '// synthetic helper; process execution is intercepted');
    const run = spyOn(childProcess, 'execFileSync').mockReturnValue(JSON.stringify({
      wave: { action: 'dispatch', reason: 'pending work', mode: 'parallel', phase: '7',
        combo: 'noesis-execute', tasks: [{ id: 'task-7' }] },
      agent_instruction: 'DO_NOT_EXECUTE_THIS_FIXTURE_INSTRUCTION',
    }));
    try {
      const ctx = await resolve(mk(), { home: fixtureHome });
      expect(ctx.nextWave?.action).toBe('dispatch');
      expect(ctx.nextWave?.taskIds).toEqual(['task-7']);
      expect(ctx.planningPresent).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0]?.[0]).toBe('node');
      expect(run.mock.calls[0]?.[1]).toEqual([helper, '--cwd', cwd, '--json']);
    } finally {
      run.mockRestore();
    }
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

  test('omits planning state when .planning is absent from cwd', async () => {
    const ctx = await resolve(mk(), { home });

    expect(ctx.isaPath).toBe(join(cwd, 'ISA.md'));
    expect(ctx.memory.open).toBe(join(cwd, 'MEMORY.md'));
    expect(ctx.planningPresent).toBe(false);
    expect(ctx.planningState).toBeNull();
  });

  test('detects the .planning dir near cwd when present', async () => {
    const ctx = await resolve(mk({ cwd: planningCwd }), { home });

    expect(ctx.planningPresent).toBe(true);
    expect(ctx.planningState).toBe('phase-2.md');
    expect(ctx.planningState).not.toContain(planningCwd);
    expect(ctx.planningState).not.toContain('newest state body');
  });

  test('treats an empty .planning dir as absent planning state', async () => {
    const ctx = await resolve(mk({ cwd: emptyPlanningCwd }), { home });

    expect(ctx.isaPath).toBe(join(emptyPlanningCwd, 'ISA.md'));
    expect(ctx.planningPresent).toBe(false);
    expect(ctx.planningState).toBeNull();
  });

  test('treats a .planning file as absent planning state', async () => {
    const ctx = await resolve(mk({ cwd: filePlanningCwd }), { home });

    expect(ctx.isaPath).toBe(join(filePlanningCwd, 'ISA.md'));
    expect(ctx.planningPresent).toBe(false);
    expect(ctx.planningState).toBeNull();
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
