// package/enrich/stages/routing.test.ts -- unit tests for the routing stage.
import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'child_process';
import { writeFileSync, chmodSync, mkdirSync } from 'fs';
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

  it('uses the shared classifier ordering: "quick refactor" -> long-horizon (forced backend via shim)', () => {
    // routing.ts must defer to classify-task.sh, whose MBR-ordering classifies
    // "quick refactor" as long-horizon (its OLD local classifier said "fast").
    const shimDir = '/tmp/temperance-routing-test-shim-bin';
    execFileSync('mkdir', ['-p', shimDir]);
    execFileSync('bash', [
      '-c',
      `printf '#!/bin/sh\\nexit 0\\n' > ${shimDir}/command-code && chmod +x ${shimDir}/command-code`,
    ]);
    const r = runRoutingWithEnv('quick refactor the module', `${shimDir}:/usr/bin:/bin`);
    expect(r.line).toContain('| task=long-horizon');
    expect(r.line).toContain('preferred=command-code:moonshotai/Kimi-K2.7-Code');
    expect(r.line.endsWith('| skill=temperance-parallel-dispatch')).toBe(true);
  });

  it('honors TEMPERANCE_ROUTER_DIR when the sibling classify-task.sh is not co-located', () => {
    // Simulates enrich installed somewhere without a sibling router/ dir: the
    // override env var must point routing.ts at the shared classifier. The stub
    // always classifies as "reasoning", distinct from the repo's
    // "refactor"->long-horizon, so a pass proves the override dir was used.
    const shimDir = '/tmp/temperance-routing-test-shim-bin';
    const routerDir = '/tmp/temperance-routerdir-test';
    mkdirSync(shimDir, { recursive: true });
    mkdirSync(routerDir, { recursive: true });
    writeFileSync(`${shimDir}/command-code`, '#!/bin/sh\nexit 0\n');
    chmodSync(`${shimDir}/command-code`, 0o755);
    writeFileSync(`${routerDir}/classify-task.sh`, '#!/bin/sh\nprintf "reasoning\\tcommand-code:claude-fable-5\\n"\n');
    chmodSync(`${routerDir}/classify-task.sh`, 0o755);

    const script = `
      import { routing } from ${JSON.stringify(join(__dirname, 'routing.ts'))};
      const ctx = ${JSON.stringify({ ...base, input: { ...base.input, prompt: 'refactor the auth module' } })};
      process.stdout.write(JSON.stringify(routing(ctx)));
    `;
    const out = execFileSync(BUN_BIN, ['-e', script], {
      env: {
        PATH: `${shimDir}:/usr/bin:/bin`,
        HOME: '/tmp/temperance-routing-test-fake-home',
        TEMPERANCE_ROUTER_DIR: routerDir,
      },
      encoding: 'utf8',
    });
    const r = JSON.parse(out);
    expect(r.line).toContain('| task=reasoning');
    expect(r.line).toContain('preferred=command-code:claude-fable-5');
    expect(r.line.endsWith('| skill=temperance-parallel-dispatch')).toBe(true);
  });
});
