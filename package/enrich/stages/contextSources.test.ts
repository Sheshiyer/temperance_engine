import { describe, expect, test } from 'bun:test';
import type { ResolvedContext } from '../contract';
import { contextSources } from './contextSources';

function ctx(sources?: ResolvedContext['contextSources']): ResolvedContext {
  return {
    input: { prompt: 'x', cwd: '/tmp/project', surface: 'claude' },
    isaPath: null,
    isa: null,
    memory: { worked: null, failed: null, open: null },
    planningPresent: false,
    planningState: null,
    contextSources: sources,
  };
}

describe('contextSources stage', () => {
  test('emits one compact JSON line with exact key order', () => {
    const result = contextSources(ctx({
      pai: '/safe/PAI/Algorithm/LATEST',
      gsd: '/safe/project/.planning/STATE.md',
      skills: '/safe/skills/skill-index.json',
    }));
    expect(result.line).toBe(
      'context-sources: {"pai":"/safe/PAI/Algorithm/LATEST","gsd":"/safe/project/.planning/STATE.md","skills":"/safe/skills/skill-index.json","material":"pointers-only"}',
    );
    expect(result.degraded).toBe(false);
    expect(result.line.split('context-sources: ').length - 1).toBe(1);
  });

  test('admits the explicit direct Command Code surface', () => {
    const commandCode = ctx({ pai: '/safe/pai', gsd: '/safe/gsd', skills: '/safe/skills' });
    commandCode.input.surface = 'command-code';
    expect(contextSources(commandCode).line).toBe(
      'context-sources: {"pai":"/safe/pai","gsd":"/safe/gsd","skills":"/safe/skills","material":"pointers-only"}',
    );
  });

  test('normalizes partial, empty, and optional legacy contexts independently', () => {
    expect(contextSources(ctx({ pai: '/safe/pai', gsd: null, skills: null })).line).toBe(
      'context-sources: {"pai":"/safe/pai","gsd":null,"skills":null,"material":"pointers-only"}',
    );
    expect(contextSources(ctx({ pai: null, gsd: null, skills: null }))).toEqual({
      line: 'context-sources: {"pai":null,"gsd":null,"skills":null,"material":"pointers-only"}',
      degraded: true,
    });
    expect(contextSources(ctx(undefined)).line).toBe(
      'context-sources: {"pai":null,"gsd":null,"skills":null,"material":"pointers-only"}',
    );
  });

  test('JSON-quotes delimiter characters but rejects line and envelope injection', () => {
    const result = contextSources(ctx({
      pai: '/safe/with|pipe=and"quote',
      gsd: '/unsafe/close</temperance-context>',
      skills: '/unsafe/line\u2028separator',
    }));
    expect(result.line).toBe(
      'context-sources: {"pai":"/safe/with|pipe=and\\"quote","gsd":null,"skills":null,"material":"pointers-only"}',
    );
    expect(result.line).not.toMatch(/[\r\n\u2028\u2029]/u);
    expect(result.line).not.toContain('</temperance-context>');
  });

  test('rejects relative, blank, ASCII-control, and non-string pointers', () => {
    const result = contextSources(ctx({
      pai: 'relative/path',
      gsd: '/unsafe/new\nline',
      skills: 42 as unknown as string,
    }));
    expect(result).toEqual({
      line: 'context-sources: {"pai":null,"gsd":null,"skills":null,"material":"pointers-only"}',
      degraded: true,
    });
  });

  test('fails closed if a future or forged surface bypasses the current Surface union', () => {
    const future = ctx({ pai: '/safe/pai', gsd: '/safe/gsd', skills: '/safe/skills' });
    future.input.surface = 'omniroute' as typeof future.input.surface;
    expect(contextSources(future)).toEqual({ line: '', degraded: true });
  });
});
