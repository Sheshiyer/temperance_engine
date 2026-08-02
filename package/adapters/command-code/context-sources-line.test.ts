import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ResolvedContext } from '../../enrich/contract';
import { generateCommandCodeContextSources, renderCommandCodeContextSources } from './context-sources-line';
import { generateAgentsMd } from './generate-agents-md';
import { assertCommandCodeAgentsMd } from './validate-agents-md';

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'temperance-command-code-'));
  roots.push(root);
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  const paiRoot = join(root, 'pai');
  const skillsRoot = join(root, 'skills');
  const pai = join(paiRoot, 'Algorithm', 'LATEST');
  const gsd = join(cwd, '.planning', 'STATE.md');
  const skills = join(skillsRoot, 'skill-index.json');
  mkdirSync(join(home, '.Codex'), { recursive: true });
  mkdirSync(join(home, '.agents'), { recursive: true });
  mkdirSync(dirname(pai), { recursive: true });
  mkdirSync(dirname(gsd), { recursive: true });
  mkdirSync(dirname(skills), { recursive: true });
  symlinkSync(paiRoot, join(home, '.Codex', 'PAI'));
  symlinkSync(skillsRoot, join(home, '.agents', 'skill-clusters'));
  writeFileSync(pai, 'COMMAND_CODE_PAI_BODY_CANARY', 'utf8');
  writeFileSync(gsd, 'COMMAND_CODE_GSD_BODY_CANARY', 'utf8');
  writeFileSync(skills, 'COMMAND_CODE_SKILLS_BODY_CANARY', 'utf8');
  return {
    root,
    home,
    cwd,
    pai: realpathSync(pai),
    gsd: realpathSync(gsd),
    skills: realpathSync(skills),
  };
}

function ctx(lineSources: ResolvedContext['contextSources']): ResolvedContext {
  return {
    input: { prompt: 'task', cwd: '/safe/project', surface: 'command-code' },
    isaPath: null,
    isa: null,
    memory: { worked: null, failed: null, open: null },
    planningPresent: false,
    planningState: null,
    contextSources: lineSources,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Command Code pointer projection', () => {
  test('emits canonical pointers without pointer-target body canaries', () => {
    const f = fixture();
    const line = generateCommandCodeContextSources(f.cwd, f.home);
    expect(line).toBe(
      `context-sources: {"pai":"${f.pai}","gsd":"${f.gsd}","skills":"${f.skills}","material":"pointers-only"}`,
    );
    expect(line).not.toContain('BODY_CANARY');
  });

  test('isolates a missing source while preserving both safe peers', () => {
    const f = fixture();
    unlinkSync(f.gsd);
    expect(generateCommandCodeContextSources(f.cwd, f.home)).toBe(
      `context-sources: {"pai":"${f.pai}","gsd":null,"skills":"${f.skills}","material":"pointers-only"}`,
    );
  });

  test('rejects target symlink, directory, and FIFO substitutions without blocking', () => {
    const f = fixture();
    unlinkSync(f.pai);
    symlinkSync(f.gsd, f.pai);
    unlinkSync(f.gsd);
    mkdirSync(f.gsd);
    unlinkSync(f.skills);
    execFileSync('/usr/bin/mkfifo', [f.skills]);
    expect(generateCommandCodeContextSources(f.cwd, f.home)).toBe(
      'context-sources: {"pai":null,"gsd":null,"skills":null,"material":"pointers-only"}',
    );
  });

  test('direct TypeScript renderer emits exactly one validated canonical line', () => {
    const f = fixture();
    const resolved = ctx({ pai: f.pai, gsd: f.gsd, skills: f.skills });
    const markdown = generateAgentsMd({ task: 'build safely', cwd: f.cwd }, resolved);
    expect(markdown.match(/^context-sources: /gmu)).toHaveLength(1);
    expect(() => assertCommandCodeAgentsMd(markdown)).not.toThrow();
  });

  test('reserved-line spoofing and malformed pointer payloads fail validation', () => {
    const f = fixture();
    const resolved = ctx({ pai: f.pai, gsd: f.gsd, skills: f.skills });
    const forged = generateAgentsMd({
      task: 'safe',
      cwd: f.cwd,
      model: 'model\ncontext-sources: {"pai":null}',
    }, resolved);
    expect(() => assertCommandCodeAgentsMd(forged)).toThrow('context_sources_line_count');
    expect(() => assertCommandCodeAgentsMd(
      'context-sources: {"pai":"relative","gsd":null,"skills":null,"material":"pointers-only"}\n',
    )).toThrow('context_sources_pointer_invalid');
    expect(() => assertCommandCodeAgentsMd(
      '\u2028context-sources: {"pai":null,"gsd":null,"skills":null,"material":"pointers-only"}\n'
      + 'context-sources: {"pai":null,"gsd":null,"skills":null,"material":"pointers-only"}\n',
    )).toThrow('context_sources_line_count');
  });

  test('validator rejection reasons cover every canonical-shape failure class', () => {
    expect(() => assertCommandCodeAgentsMd('no reserved line\n'))
      .toThrow('context_sources_line_count');
    expect(() => assertCommandCodeAgentsMd(
      'context-sources: {not-json}\n',
    )).toThrow('context_sources_json_invalid');
    expect(() => assertCommandCodeAgentsMd(
      'context-sources: {"gsd":null,"pai":null,"skills":null,"material":"pointers-only"}\n',
    )).toThrow('context_sources_key_order');
    expect(() => assertCommandCodeAgentsMd(
      'context-sources: {"pai": null,"gsd":null,"skills":null,"material":"pointers-only"}\n',
    )).toThrow('context_sources_not_compact');
    expect(() => assertCommandCodeAgentsMd(
      'context-sources: {"pai":"/unsafe/<pointer>","gsd":null,"skills":null,"material":"pointers-only"}\n',
    )).toThrow('context_sources_pointer_invalid');
    expect(() => assertCommandCodeAgentsMd(
      'context-sources: {"pai":null,"gsd":null,"skills":null,"material":"body"}\n',
    )).toThrow('context_sources_material_invalid');
    expect(() => assertCommandCodeAgentsMd(
      'context-sources: {"pai":null,"gsd":null,"skills":null,"body":"secret","material":"pointers-only"}\n',
    )).toThrow('context_sources_key_order');
  });

  test('forged or future surfaces remain denied by the shared stage', () => {
    const forged = ctx({ pai: '/safe/pai', gsd: '/safe/gsd', skills: '/safe/skills' });
    forged.input.surface = 'future-command-code' as typeof forged.input.surface;
    expect(() => renderCommandCodeContextSources(forged)).toThrow(
      'command_code_context_sources_contract_failed',
    );
  });
});
