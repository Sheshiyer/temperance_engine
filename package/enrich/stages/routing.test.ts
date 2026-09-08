// package/enrich/stages/routing.test.ts -- unit tests for the routing stage.
import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'child_process';
import { writeFileSync, chmodSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { ResolvedContext } from '../contract';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUN_BIN = process.execPath; // bun's own binary path when run under `bun test`
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function temporaryDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

function commandCodeShim(): string {
  const path = temporaryDirectory('temperance-routing-shim-');
  writeFileSync(join(path, 'command-code'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(path, 'command-code'), 0o755);
  return path;
}

const base: ResolvedContext = {
  input: { prompt: 'refactor the auth module', cwd: '/tmp/proj', surface: 'claude' },
  isaPath: null,
  isa: null,
  memory: { worked: null, failed: null, open: null },
  planningPresent: false,
  planningState: null,
};

/**
 * Runs the routing stage in a child bun process with a stripped-down
 * PATH/HOME/env so that NO backends (command-code, kimi, grok, nvidia)
 * can be detected. This gives a deterministic zero-backends case
 * regardless of what happens to be installed on the host running the
 * test suite.
 */
function runRoutingWithEnv(
  prompt: string,
  path: string,
  additionalEnvironment: Record<string, string> = {},
): { line: string; degraded: boolean } {
  const script = `
    import { routing } from ${JSON.stringify(join(__dirname, 'routing.ts'))};
    const ctx = ${JSON.stringify({ ...base, input: { ...base.input, prompt } })};
    process.stdout.write(JSON.stringify(routing(ctx)));
  `;
  const out = execFileSync(BUN_BIN, ['-e', script], {
    env: {
      PATH: path,
      HOME: temporaryDirectory('temperance-routing-home-'),
      ...additionalEnvironment,
    },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

describe('routing stage', () => {
  it('emits backends/task/preferred when a synthetic backend is available', () => {
    const shimDir = commandCodeShim();
    const r = runRoutingWithEnv('refactor the auth module', `${shimDir}:/usr/bin:/bin`);

    expect(r.line.startsWith('routing: backends=')).toBe(true);
    expect(r.line).toContain('| task=');
    expect(r.line).toContain('| portfolio=');
    expect(r.line).toContain('| portfolio_source=');
    expect(r.line).toContain('| preferred=');
    expect(r.line).toContain('| skill=temperance-parallel-dispatch');
    expect(r.line.endsWith('| skill=temperance-parallel-dispatch')).toBe(true);
    expect(r.degraded).toBe(false);
  });

  it('does NOT append the skill pointer when no backends are available (clean env)', () => {
    const r = runRoutingWithEnv('refactor the auth module', '/usr/bin:/bin');
    expect(r.line).toBe('');
    expect(r.degraded).toBe(false);
    expect(r.line).not.toContain('skill=temperance-parallel-dispatch');
  });

  it('appends the skill pointer only on the available-backend branch (forced via PATH shim)', () => {
    // Force a deterministic "backend available" case by shimming a fake
    // `command-code` onto PATH inside an otherwise clean env, so this
    // assertion does not depend on what's installed on the host.
    const shimDir = commandCodeShim();

    const r = runRoutingWithEnv('refactor the auth module', `${shimDir}:/usr/bin:/bin`);

    expect(r.line).not.toBe('');
    expect(r.line).toContain('backends=command-code');
    expect(r.line).toContain('| skill=temperance-parallel-dispatch');
    expect(r.line.endsWith('| skill=temperance-parallel-dispatch')).toBe(true);
    expect(r.degraded).toBe(false);
  });

  it('uses the shared classifier ordering: "quick refactor" -> long-horizon (forced backend via shim)', () => {
    // The direct runtime dependency retains the reviewed ordering: refactor
    // wins over quick, so the result stays long-horizon.
    const shimDir = commandCodeShim();
    const r = runRoutingWithEnv('quick refactor the module', `${shimDir}:/usr/bin:/bin`);
    expect(r.line).toContain('| task=long-horizon');
    expect(r.line).toContain('| portfolio=noesis-build');
    expect(r.line).toContain('preferred=combo:noesis-build');
    expect(r.line.endsWith('| skill=temperance-parallel-dispatch')).toBe(true);
  });

  it('honors TEMPERANCE_ROUTER_DIR when the sibling classify-task.sh is not co-located', () => {
    // Simulates enrich installed somewhere without a sibling router/ dir: the
    // override env var must point routing.ts at the shared classifier. The stub
    // always classifies as "reasoning", distinct from the repo's
    // "refactor"->long-horizon, so a pass proves the override dir was used.
    const shimDir = commandCodeShim();
    const routerDir = temporaryDirectory('temperance-routerdir-');
    writeFileSync(join(routerDir, 'classify-task.sh'), '#!/bin/sh\nprintf "reasoning\\tcommand-code:claude-fable-5\\n"\n');
    chmodSync(join(routerDir, 'classify-task.sh'), 0o755);
    const r = runRoutingWithEnv('refactor the auth module', `${shimDir}:/usr/bin:/bin`, {
      TEMPERANCE_ROUTER_DIR: routerDir,
    });
    expect(r.line).toContain('| task=reasoning');
    expect(r.line).toContain('preferred=command-code:claude-fable-5');
    expect(r.line.endsWith('| skill=temperance-parallel-dispatch')).toBe(true);
  });
});
