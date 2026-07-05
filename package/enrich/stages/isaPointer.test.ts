// package/enrich/stages/isaPointer.test.ts -- bun test for the isaPointer stage.
import { expect, test } from 'bun:test';
import { isaPointer } from './isaPointer';
import type { ResolvedContext } from '../contract';

const baseInput = { prompt: 'x', cwd: '/tmp/proj', surface: 'claude' as const };

function ctxWith(isaPath: string | null): ResolvedContext {
  return {
    input: baseInput,
    isaPath,
    isa: null,
    memory: { worked: null, failed: null, open: null },
    planningPresent: false,
    planningState: null,
  };
}

test('emits the resolved ISA path and is not degraded when a path is present', () => {
  const r = isaPointer(ctxWith('/tmp/proj/ISA.md'));
  expect(r.line).toBe('isa: /tmp/proj/ISA.md');
  expect(r.degraded).toBe(false);
});

test('emits "isa: none" and degrades when isaPath is null', () => {
  const r = isaPointer(ctxWith(null));
  expect(r.line).toBe('isa: none');
  expect(r.degraded).toBe(true);
});

test('treats a blank/whitespace path as absent (degraded none)', () => {
  const r = isaPointer(ctxWith('   '));
  expect(r.line).toBe('isa: none');
  expect(r.degraded).toBe(true);
});

test('emits only a path pointer, never a file body (no newlines)', () => {
  const r = isaPointer(ctxWith('/home/tester/.claude/MEMORY/WORK/20260701_slug/ISA.md'));
  expect(r.line).toBe('isa: /home/tester/.claude/MEMORY/WORK/20260701_slug/ISA.md');
  expect(r.line.includes('\n')).toBe(false);
  expect(r.degraded).toBe(false);
});
