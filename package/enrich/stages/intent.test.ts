// package/enrich/stages/intent.test.ts
import { expect, test } from 'bun:test';
import { intent } from './intent';
import type { ResolvedContext } from '../contract';

function ctx(prompt: string): ResolvedContext {
  return {
    input: { prompt, cwd: '/tmp/proj', surface: 'claude' },
    isaPath: null,
    isa: null,
    memory: { worked: null, failed: null, open: null },
    planningPresent: false,
    planningState: null,
  };
}

test('echoes a trimmed/collapsed objective and reports no not-wants', () => {
  const r = intent(ctx('  refactor   the   auth  hook  '));
  expect(r.line).toBe('intent: refactor the auth hook | not: none');
  expect(r.degraded).toBe(false);
});

test('surfaces a "don\'t touch X" cue in the not: field (required case)', () => {
  const r = intent(ctx("implement the intent stage; don't touch any other file"));
  // objective is the first clause; the not-want comes from the don't cue.
  expect(r.line).toBe('intent: implement the intent stage | not: touch any other file');
  expect(r.degraded).toBe(false);
});

test('recognizes an "avoid" cue and clause-bounds the phrase', () => {
  const r = intent(ctx('port the classifier. avoid scanning skill-clusters wholesale. thanks'));
  const [, notPart] = r.line.split(' | not: ');
  expect(notPart).toBe('scanning skill-clusters wholesale');
});

test('recognizes a "without" cue', () => {
  const r = intent(ctx('build the block without file bodies'));
  expect(r.line).toBe('intent: build the block without file bodies | not: file bodies');
});

test('is never degraded and always yields an intent: line, even when empty', () => {
  const r = intent(ctx('   '));
  expect(r.degraded).toBe(false);
  expect(r.line.startsWith('intent: ')).toBe(true);
  expect(r.line.endsWith('| not: none')).toBe(true);
});
