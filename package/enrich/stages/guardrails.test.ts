// package/enrich/stages/guardrails.test.ts -- bun test for the guardrails stage.
import { test, expect } from 'bun:test';
import type { ResolvedContext } from '../contract';
import { guardrails } from './guardrails';
import ctxFull from '../fixtures/ctx-full.json';
import ctxEmpty from '../fixtures/ctx-empty.json';

test('populated isa surfaces first principle + first anti, not degraded', () => {
  const r = guardrails(ctxFull as ResolvedContext);
  expect(r.line).toBe(
    'guardrails: - Paths must be generalized through $HOME and environment variables. | anti: Anti: never scan ~/.agents/skill-clusters/skills wholesale at startup.',
  );
  expect(r.degraded).toBe(false);
});

test('null isa => degraded with none/none line', () => {
  const r = guardrails(ctxEmpty as ResolvedContext);
  expect(r.line).toBe('guardrails: none | anti: none');
  expect(r.degraded).toBe(true);
});

test('falls back to constraints then outOfScope when earlier fields blank', () => {
  const base = ctxEmpty as ResolvedContext;

  const constraintsOnly: ResolvedContext = {
    ...base,
    isa: { principles: '   \n', constraints: '- Installer must create backups.', outOfScope: '', antiCriteria: '' },
  };
  const rc = guardrails(constraintsOnly);
  expect(rc.line).toBe('guardrails: - Installer must create backups. | anti: none');
  expect(rc.degraded).toBe(false);

  const scopeOnly: ResolvedContext = {
    ...base,
    isa: { principles: '', constraints: '', outOfScope: 'Bundling private memory is out of scope.', antiCriteria: '' },
  };
  const rs = guardrails(scopeOnly);
  expect(rs.line).toBe('guardrails: Bundling private memory is out of scope. | anti: none');
});

test('isa object present but every section empty => none/none and degraded', () => {
  const emptySections: ResolvedContext = {
    ...(ctxEmpty as ResolvedContext),
    isa: { principles: '', constraints: '', outOfScope: '', antiCriteria: '' },
  };
  const r = guardrails(emptySections);
  expect(r.line).toBe('guardrails: none | anti: none');
  expect(r.degraded).toBe(true);
});
