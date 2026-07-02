// package/enrich/stages/classify.test.ts -- branch coverage for the ported classifier.
import { describe, expect, it } from 'bun:test';
import type { ResolvedContext } from '../contract';
import { classify } from './classify';

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

describe('classify stage', () => {
  it('explicit /e4 override => ALGORITHM / E4', () => {
    const r = classify(ctx('/e4 do the thing'));
    expect(r.line).toBe(
      'mode/tier: ALGORITHM / E4 | reason: explicit /e4 tier override | source: classifier',
    );
    expect(r.degraded).toBe(false);
  });

  it('greeting => MINIMAL (no tier)', () => {
    const r = classify(ctx('hello'));
    expect(r.line).toBe(
      'mode/tier: MINIMAL | reason: short acknowledgement, greeting, or rating | source: classifier',
    );
    expect(r.degraded).toBe(false);
  });

  it('short lookup => NATIVE (no tier)', () => {
    const r = classify(ctx('what is x'));
    expect(r.line).toBe(
      'mode/tier: NATIVE | reason: single-step lookup or command-shaped request | source: classifier',
    );
  });

  it('"refactor the auth" => ALGORITHM / E4 (multi-step verb, no system keyword)', () => {
    // "refactor" is a multi-step verb (not NATIVE); "auth" hits no tier-4/5 keyword,
    // so this exercises the base ALGORITHM tier -> E3.
    const r = classify(ctx('refactor the auth'));
    expect(r.line).toBe(
      'mode/tier: ALGORITHM / E3 | reason: multi-step or system-affecting request | source: classifier',
    );
  });

  it('system-affecting multi-step => ALGORITHM / E4', () => {
    const r = classify(ctx('refactor the pai hook system prompt'));
    expect(r.line).toBe(
      'mode/tier: ALGORITHM / E4 | reason: multi-step or system-affecting request | source: classifier',
    );
    expect(r.degraded).toBe(false);
  });
});
