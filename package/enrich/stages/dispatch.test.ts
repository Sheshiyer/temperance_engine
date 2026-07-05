// package/enrich/stages/dispatch.test.ts -- unit tests for the dispatch stage.
import { describe, expect, it } from 'bun:test';
import type { ResolvedContext } from '../contract';
import { dispatch } from './dispatch';

const base: ResolvedContext = {
  input: { prompt: 'anything', cwd: '/tmp/proj', surface: 'claude' },
  isaPath: null,
  isa: null,
  memory: { worked: null, failed: null, open: null },
  planningPresent: false,
  planningState: null,
};

describe('dispatch stage', () => {
  it('omits the line when planning is absent', () => {
    const r = dispatch({ ...base, planningPresent: false, planningState: null });
    expect(r.line).toBe('');
    expect(r.degraded).toBe(false);
  });

  it('emits the planningState verbatim when planning is present', () => {
    const r = dispatch({
      ...base,
      planningPresent: true,
      planningState: 'phase 2 of 4 in progress',
    });
    expect(r.line).toBe('dispatch: phase 2 of 4 in progress');
    expect(r.degraded).toBe(false);
  });

  it('falls back to ".planning present" when state is null but planning is present', () => {
    const r = dispatch({ ...base, planningPresent: true, planningState: null });
    expect(r.line).toBe('dispatch: .planning present');
    expect(r.degraded).toBe(false);
  });

  it('falls back when state is empty/whitespace, and trims a padded state', () => {
    const empty = dispatch({ ...base, planningPresent: true, planningState: '   ' });
    expect(empty.line).toBe('dispatch: .planning present');

    const padded = dispatch({ ...base, planningPresent: true, planningState: '  wave 1  ' });
    expect(padded.line).toBe('dispatch: wave 1');
  });
});
