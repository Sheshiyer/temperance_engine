// package/enrich/stages/routing.test.ts -- unit tests for the routing stage.
import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { ResolvedContext } from '../contract';
import { routing } from './routing';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUN_BIN = process.execPath; // bun's own binary path when run under `bun test`

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
function runRoutingWithEnv(prompt: string, path: string): { line: string; degraded: boolean } {
  const script = `
    import { routing } from ${JSON.stringify(join(__dirname, 'routing.ts'))};
    const ctx = ${JSON.stringify({ ...base, input: { ...base.input, prompt } })};
    process.stdout.write(JSON.stringify(routing(ctx)));
  `;
  const out = execFileSync(BUN_BIN, ['-e', script], {
    env: {
      PATH: path,
      HOME: '/tmp/temperance-routing-test-fake-home',
    },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

describe('routing stage', () => {
  it('emits backends/task/preferred when at least one backend is available', () => {
    const r = routing(base);

    // This repo's dev/CI environment is expected to have at least one
    // backend detectable (command-code / kimi / grok / NVIDIA_API_KEY).
    // If none are available here, skip rather than false-fail on host
    // differences -- the zero-backends branch is covered deterministically
    // below via a clean-env subprocess.
    if (r.line === '') {
      return;
    }

    expect(r.line.startsWith('routing: backends=')).toBe(true);
    expect(r.line).toContain('| task=');
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
    const shimDir = '/tmp/temperance-routing-test-shim-bin';
    execFileSync('mkdir', ['-p', shimDir]);
    execFileSync('bash', [
      '-c',
      `printf '#!/bin/sh\\nexit 0\\n' > ${shimDir}/command-code && chmod +x ${shimDir}/command-code`,
    ]);

    const r = runRoutingWithEnv('refactor the auth module', `${shimDir}:/usr/bin:/bin`);

    expect(r.line).not.toBe('');
    expect(r.line).toContain('backends=command-code');
    expect(r.line).toContain('| skill=temperance-parallel-dispatch');
    expect(r.line.endsWith('| skill=temperance-parallel-dispatch')).toBe(true);
    expect(r.degraded).toBe(false);
  });
});
