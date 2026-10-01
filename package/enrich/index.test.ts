// package/enrich/index.test.ts -- assembler integration tests for enrich().
// Exercises the real resolver + all eight public stages end-to-end (no stage/resolver mocking here),
// asserting the shape of the <temperance-context> block for representative prompts, plus a
// latency smoke check. The fail-open (resolve throws) case lives in index.failopen.test.ts so its
// module mock cannot leak into these assertions.
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as childProcess from 'node:child_process';
import { enrich } from './index';
import * as resolverModule from './resolver';
import type { EnrichInput } from './contract';

let fixtureRoot: string;
let fixtureHome: string;
let fixtureCwd: string;
let priorHome: string | undefined;
beforeAll(() => {
  fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'enrich-assembler-')));
  fixtureHome = join(fixtureRoot, 'home');
  fixtureCwd = join(fixtureRoot, 'project');
  for (const directory of [join(fixtureHome, '.claude/MEMORY/STATE'),
    join(fixtureHome, '.Codex/PAI/Algorithm'), join(fixtureHome, '.agents/skill-clusters'),
    join(fixtureCwd, '.planning')]) mkdirSync(directory, { recursive: true });
  writeFileSync(join(fixtureHome, '.Codex/PAI/Algorithm/LATEST'), 'PAI_BODY_CANARY');
  writeFileSync(join(fixtureHome, '.agents/skill-clusters/skill-index.json'), 'SKILLS_BODY_CANARY');
  writeFileSync(join(fixtureCwd, '.planning/STATE.md'), 'GSD_BODY_CANARY');
  writeFileSync(join(fixtureHome, '.claude/MEMORY/STATE/atlas-context.json'), JSON.stringify({
    containerPath: '/PRIVATE_CONTAINER_MARKER', containsTranscript: false,
    mountCommand: 'PRIVATE_MOUNT_COMMAND', sessionProgressToolPath: '/PRIVATE_SESSION_TOOL',
    body: 'PRIVATE_BODY_AND_SESSION_MARKER',
  }));
  priorHome = process.env.HOME;
  process.env.HOME = fixtureHome;
});
afterAll(() => {
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function baseInput(prompt: string): EnrichInput {
  // Point cwd at an empty temp-ish path with no ISA/.planning so the block stays deterministic:
  // classify + intent always emit; the other stages fail-open to omitted/sparse lines.
  return { prompt, cwd: '/nonexistent/enrich-test-cwd', surface: 'claude' };
}

describe('enrich() assembler integration', () => {
  test('(a) greeting yields a MINIMAL block wrapped in <temperance-context>', async () => {
    const block = await enrich(baseInput('hi'));
    expect(block.startsWith('<temperance-context>')).toBe(true);
    expect(block.trimEnd().endsWith('</temperance-context>')).toBe(true);
    // classify stage must have marked this MINIMAL.
    expect(block).toMatch(/mode\/tier:\s*MINIMAL/);
    expect(block).toContain('source: classifier');
  });

  test('(b) system-affecting negative-constraint prompt yields ALGORITHM + a not: clause', async () => {
    const block = await enrich(baseInput('refactor the auth system without touching the DB'));
    expect(block.startsWith('<temperance-context>')).toBe(true);
    // "refactor" -> multi-step; not native/minimal -> ALGORITHM with a tier.
    expect(block).toMatch(/mode\/tier:\s*ALGORITHM\s*\/\s*E\d/);
    // intent stage must surface the "without touching the DB" negative constraint.
    const intentLine = block.split('\n').find((l) => l.startsWith('intent:'));
    expect(intentLine).toBeDefined();
    expect(intentLine).toMatch(/\|\s*not:\s*touching the DB/i);
  });

  test('block never contains empty body lines (empty stage lines are dropped)', async () => {
    const block = await enrich(baseInput('refactor the auth system without touching the DB'));
    const inner = block.split('\n').slice(1, -1); // drop OPEN/CLOSE
    for (const line of inner) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  test('(c) fail-open: when resolve() throws, enrich() returns a classify-only fail-safe block', async () => {
    // ESM live-binding: index.ts's `resolve` reference resolves through this same module record,
    // so spying here forces the assembler down its outer catch (fallbackBlock) path.
    const spy = spyOn(resolverModule, 'resolve').mockImplementation(async () => {
      throw new Error('forced resolve failure');
    });
    try {
      const block = await enrich(baseInput('refactor the auth system without touching the DB'));
      expect(block.startsWith('<temperance-context>')).toBe(true);
      expect(block.trimEnd().endsWith('</temperance-context>')).toBe(true);
      expect(block).toContain('source: fail-safe');
      expect(block).toContain('enrichment resolve failed');
      // Stages must NOT have run against an untrusted context.
      expect(block).not.toContain('intent:');
      expect(block).not.toContain('guardrails:');
    } finally {
      spy.mockRestore();
    }
  });

  test('(e) kimi surface produces a well-formed block (relay-side injection contract)', async () => {
    const block = await enrich({ ...baseInput('refactor the auth system'), surface: 'kimi' });
    expect(block.startsWith('<temperance-context>')).toBe(true);
    expect(block.trimEnd().endsWith('</temperance-context>')).toBe(true);
    expect(block).toMatch(/mode\/tier:\s*ALGORITHM/);
  });

  test('shared clients and direct Command Code emit exactly one pointer-only source line', async () => {
    for (const surface of ['claude', 'codex', 'opencode', 'kimi', 'command-code'] as const) {
      const block = await enrich({ ...baseInput('refactor the auth system'), surface });
      const lines = block.split('\n').filter((line) => line.startsWith('context-sources: '));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('"material":"pointers-only"');
      expect(lines[0]).not.toMatch(/[\r\u2028\u2029]/u);
    }
  });

  test('public assembler retains non-private pointers and never executes next-wave instructions', async () => {
    const helper = join(fixtureHome, '.temperance_engine/router/temperance-next-wave.mjs');
    mkdirSync(join(fixtureHome, '.temperance_engine/router'), { recursive: true });
    writeFileSync(helper, '// fixture only; execution intercepted');
    const run = spyOn(childProcess, 'execFileSync').mockReturnValue(JSON.stringify({
      wave: { action: 'dispatch', reason: 'pending work', mode: 'parallel', phase: '7',
        combo: 'noesis-execute', tasks: [{ id: 'task-7' }] },
      agent_instruction: 'PRIVATE_EXECUTION_COMMAND',
    }));
    try {
      const block = await enrich({ prompt: 'recall atlas previous session and plan the work', cwd: fixtureCwd, surface: 'codex' });
      const line = block.split('\n').find(line => line.startsWith('context-sources: '))!;
      expect(JSON.parse(line.slice('context-sources: '.length))).toEqual({
        pai: join(fixtureHome, '.Codex/PAI/Algorithm/LATEST'),
        gsd: join(fixtureCwd, '.planning/STATE.md'),
        skills: join(fixtureHome, '.agents/skill-clusters/skill-index.json'),
        atlas: null, material: 'pointers-only',
      });
      expect(block).toContain('NEXT-WAVE PROPOSAL');
      expect(block).toContain('matching approval receipt');
      expect(block).not.toContain('atlas-recall:');
      expect(block).not.toContain('PRIVATE_');
      expect(block).not.toContain('BODY_CANARY');
      expect(block).not.toContain('auto-execute');
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0]?.[1]).toEqual([helper, '--cwd', fixtureCwd, '--json']);
    } finally {
      run.mockRestore();
      rmSync(join(fixtureHome, '.temperance_engine'), { recursive: true, force: true });
    }
  });

  test('(d) latency smoke: enrich() completes well under 500ms', async () => {
    const input = baseInput('refactor the auth system without touching the DB to add SSO');
    // Warm one call, then measure.
    await enrich(input);
    const start = performance.now();
    await enrich(input);
    const elapsedMs = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`[latency] enrich() = ${elapsedMs.toFixed(3)}ms`);
    expect(elapsedMs).toBeLessThan(500);
  });
});
