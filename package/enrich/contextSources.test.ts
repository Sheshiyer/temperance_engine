import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveContextSources } from './contextSources';

const roots: string[] = [];

type Fixture = {
  root: string;
  home: string;
  cwd: string;
  paiTarget: string;
  gsdTarget: string;
  skillsTarget: string;
  atlasTarget: string;
  paiReal: string;
  skillsReal: string;
};

function fixture(label = 'normal'): Fixture {
  const root = mkdtempSync(join(tmpdir(), `temperance-context-${label}-`));
  roots.push(root);
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  const paiReal = join(root, 'pai-real');
  const skillsReal = join(root, 'skills-real');
  const paiTarget = join(paiReal, 'Algorithm', 'LATEST');
  const gsdTarget = join(cwd, '.planning', 'STATE.md');
  const skillsTarget = join(skillsReal, 'skill-index.json');
  // atlas-context.json lives under .claude/MEMORY/STATE
  const atlasDir = join(home, '.claude', 'MEMORY', 'STATE');
  const atlasTarget = join(atlasDir, 'atlas-context.json');

  mkdirSync(join(home, '.Codex'), { recursive: true });
  mkdirSync(join(home, '.agents'), { recursive: true });
  mkdirSync(atlasDir, { recursive: true });
  mkdirSync(dirname(paiTarget), { recursive: true });
  mkdirSync(dirname(gsdTarget), { recursive: true });
  mkdirSync(dirname(skillsTarget), { recursive: true });
  symlinkSync(paiReal, join(home, '.Codex', 'PAI'));
  symlinkSync(skillsReal, join(home, '.agents', 'skill-clusters'));
  writeFileSync(paiTarget, 'v6.3.0\nBODY_CANARY_PAI', 'utf8');
  writeFileSync(gsdTarget, 'BODY_CANARY_GSD', 'utf8');
  writeFileSync(skillsTarget, '{"body":"BODY_CANARY_SKILLS"}', 'utf8');
  writeFileSync(atlasTarget, '{"containerPath":"/tmp/test.sparsebundle","containsTranscript":false}', 'utf8');
  return {
    root,
    home,
    cwd,
    paiTarget: realpathSync(paiTarget),
    gsdTarget: realpathSync(gsdTarget),
    skillsTarget: realpathSync(skillsTarget),
    atlasTarget: realpathSync(atlasTarget),
    paiReal: realpathSync(paiReal),
    skillsReal: realpathSync(skillsReal),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('resolveContextSources()', () => {
  test('admits exact files beneath symlinked PAI/skill roots and a real repo planning root', () => {
    const f = fixture();
    expect(resolveContextSources({ home: f.home, cwd: f.cwd })).toEqual({
      pai: f.paiTarget,
      gsd: f.gsdTarget,
      skills: f.skillsTarget,
      atlas: null,
    });
  });

  test('never probes the nearby private metadata path', () => {
    const f = fixture();
    const probes: string[] = [];
    const original = fs.lstatSync;
    const spy = spyOn(fs, 'lstatSync').mockImplementation(((path: Parameters<typeof fs.lstatSync>[0], ...args: unknown[]) => {
      probes.push(String(path));
      return (original as Function)(path, ...args);
    }) as typeof fs.lstatSync);
    try {
      const pointers = resolveContextSources({ home: f.home, cwd: f.cwd });
      expect(pointers.atlas).toBeNull();
      expect(probes.some((path) => path.includes('atlas-context.json') || path.includes('/MEMORY/STATE'))).toBe(false);
      expect(pointers.pai).toBe(f.paiTarget);
      expect(pointers.gsd).toBe(f.gsdTarget);
      expect(pointers.skills).toBe(f.skillsTarget);
    } finally {
      spy.mockRestore();
    }
  });

  test('degrades each missing source independently', () => {
    const f = fixture();
    unlinkSync(f.paiTarget);
    unlinkSync(f.gsdTarget);
    expect(resolveContextSources({ home: f.home, cwd: f.cwd })).toEqual({
      pai: null,
      gsd: null,
      skills: f.skillsTarget,
      atlas: null,
    });
  });

  test('contains an unexpected source getter failure without suppressing a safe peer', () => {
    const f = fixture();
    const hostile = new Proxy({ home: f.home, cwd: f.cwd }, {
      get(target, property, receiver) {
        if (property === 'home') throw new Error('forced home getter failure');
        return Reflect.get(target, property, receiver);
      },
    });
    expect(resolveContextSources(hostile)).toEqual({
      pai: null,
      gsd: f.gsdTarget,
      skills: null,
      atlas: null,
    });
  });

  test('rejects target symlinks and intermediate escapes without suppressing safe peers', () => {
    const f = fixture();
    const outside = join(f.root, 'outside');
    mkdirSync(outside, { recursive: true });
    const outsidePai = join(outside, 'LATEST');
    writeFileSync(outsidePai, 'OUTSIDE_BODY', 'utf8');
    unlinkSync(f.paiTarget);
    symlinkSync(outsidePai, f.paiTarget);

    const escapedSkills = join(f.root, 'escaped-skills');
    mkdirSync(escapedSkills, { recursive: true });
    writeFileSync(join(escapedSkills, 'skill-index.json'), '{}', 'utf8');
    unlinkSync(join(f.home, '.agents', 'skill-clusters'));
    symlinkSync(escapedSkills, join(f.home, '.agents', 'skill-clusters'));

    expect(resolveContextSources({ home: f.home, cwd: f.cwd })).toEqual({
      pai: null,
      gsd: f.gsdTarget,
      skills: realpathSync(join(escapedSkills, 'skill-index.json')),
      atlas: null,
    });
  });

  test('rejects descendant intermediate symlinks and sibling-prefix containment tricks', () => {
    const f = fixture();
    const sibling = `${f.paiReal}-sibling`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'LATEST'), 'OUTSIDE', 'utf8');
    rmSync(join(f.paiReal, 'Algorithm'), { recursive: true, force: true });
    symlinkSync(sibling, join(f.paiReal, 'Algorithm'));

    expect(resolveContextSources({ home: f.home, cwd: f.cwd }).pai).toBeNull();
  });

  test('rejects a symlinked .planning trust root even when STATE.md is regular', () => {
    const f = fixture();
    const externalPlanning = join(f.root, 'external-planning');
    mkdirSync(externalPlanning, { recursive: true });
    writeFileSync(join(externalPlanning, 'STATE.md'), 'OUTSIDE', 'utf8');
    rmSync(join(f.cwd, '.planning'), { recursive: true, force: true });
    symlinkSync(externalPlanning, join(f.cwd, '.planning'));

    const pointers = resolveContextSources({ home: f.home, cwd: f.cwd });
    expect(pointers.gsd).toBeNull();
    expect(pointers.pai).toBe(f.paiTarget);
    expect(pointers.skills).toBe(f.skillsTarget);
    expect(pointers.atlas).toBeNull();
  });

  test('rejects directory and FIFO candidates', () => {
    const f = fixture();
    unlinkSync(f.paiTarget);
    mkdirSync(f.paiTarget);
    unlinkSync(f.skillsTarget);
    execFileSync('/usr/bin/mkfifo', [f.skillsTarget]);

    const pointers = resolveContextSources({ home: f.home, cwd: f.cwd });
    expect(pointers.pai).toBeNull();
    expect(pointers.skills).toBeNull();
    expect(pointers.gsd).toBe(f.gsdTarget);
  });

  test('rejects unsafe root characters and never returns body canaries', () => {
    const f = fixture('unsafe\u2028root');
    const pointers = resolveContextSources({ home: f.home, cwd: f.cwd });
    expect(pointers).toEqual({ pai: null, gsd: null, skills: null, atlas: null });
    const serialized = JSON.stringify(pointers);
    expect(serialized).not.toContain('BODY_CANARY');
    expect(serialized).not.toContain('\u2028');
  });

  test('fails open to four nulls for absent, relative, or traversal-shaped roots', () => {
    expect(resolveContextSources({ home: '/definitely/absent', cwd: '/also/absent' })).toEqual({
      pai: null,
      gsd: null,
      skills: null,
      atlas: null,
    });
    expect(resolveContextSources({ home: 'relative/home', cwd: '../relative/project' })).toEqual({
      pai: null,
      gsd: null,
      skills: null,
      atlas: null,
    });
  });

  test('the pointer resolver has no body-read, write, network, runtime, or dispatch dependency', () => {
    const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'contextSources.ts');
    const source = readFileSync(sourcePath, 'utf8');
    for (const forbidden of [
      /readFile/i,
      /writeFile/i,
      /createHash/i,
      /child_process/i,
      /\bfetch\b/i,
      /sqlite/i,
      /omniroute/i,
      /obsidian/i,
      /notion/i,
      /hermes/i,
      /cloudflare/i,
      /\bmcp\b/i,
      /\ba2a\b/i,
      /dispatch/i,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });
});
