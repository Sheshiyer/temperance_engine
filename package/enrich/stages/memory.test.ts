// package/enrich/stages/memory.test.ts -- unit tests for the memory pointer stage.
import { expect, test } from 'bun:test';
import { memory } from './memory';
import type { ResolvedContext } from '../contract';

const base: Omit<ResolvedContext, 'memory'> = {
  input: { prompt: 'x', cwd: '/tmp/proj', surface: 'claude' },
  isaPath: null,
  isa: null,
  planningPresent: false,
  planningState: null,
};

const ctx = (memory: ResolvedContext['memory']): ResolvedContext => ({ ...base, memory });

test('populated: emits all three pointer paths, not degraded', () => {
  const r = memory(ctx({
    worked: '/home/tester/.claude/MEMORY/LEARNING/REFLECTIONS/2026-07-01_enrichment.md',
    failed: '/home/tester/.claude/MEMORY/LEARNING/FAILURES/2026-06-30_hook-timeout.md',
    open: '/tmp/proj/MEMORY.md',
  }));
  expect(r.line).toBe(
    'memory: worked=/home/tester/.claude/MEMORY/LEARNING/REFLECTIONS/2026-07-01_enrichment.md' +
      ' failed=/home/tester/.claude/MEMORY/LEARNING/FAILURES/2026-06-30_hook-timeout.md' +
      ' open=/tmp/proj/MEMORY.md',
  );
  expect(r.degraded).toBe(false);
});

test('all null: emits none for each and is degraded', () => {
  const r = memory(ctx({ worked: null, failed: null, open: null }));
  expect(r.line).toBe('memory: worked=none failed=none open=none');
  expect(r.degraded).toBe(true);
});

test('partial: only one pointer present -> not degraded, others none, order preserved', () => {
  const r = memory(ctx({ worked: null, failed: '/f/only.md', open: null }));
  expect(r.line).toBe('memory: worked=none failed=/f/only.md open=none');
  expect(r.degraded).toBe(false);
});

test('empty/whitespace pointer strings normalize to none (degraded)', () => {
  const r = memory(ctx({ worked: '', failed: '   ', open: null }));
  expect(r.line).toBe('memory: worked=none failed=none open=none');
  expect(r.degraded).toBe(true);
});
