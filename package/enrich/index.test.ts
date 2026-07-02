// package/enrich/index.test.ts -- assembler integration tests for enrich().
// Exercises the real resolver + all six real stages end-to-end (no stage/resolver mocking here),
// asserting the shape of the <temperance-context> block for representative prompts, plus a
// latency smoke check. The fail-open (resolve throws) case lives in index.failopen.test.ts so its
// module mock cannot leak into these assertions.
import { describe, expect, spyOn, test } from 'bun:test';
import { enrich } from './index';
import * as resolverModule from './resolver';
import type { EnrichInput } from './contract';

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
