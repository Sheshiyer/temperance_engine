#!/usr/bin/env node
/** Safe automatic swarm launcher; PostgreSQL claims precede every worker. */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const requestPath = value('--request');
const bridgeUrl = (value('--bridge-url') || process.env.TEMPERANCE_MANIFEST_BRIDGE_URL || 'http://127.0.0.1:8766').replace(/\/$/, '');
const dryRun = args.includes('--dry-run');

if (!requestPath) {
  console.error('usage: temperance-swarm-dispatch --request <frozen-claim.json> [--bridge-url URL] [--dry-run]');
  process.exit(2);
}
let request;
try { request = JSON.parse(readFileSync(requestPath, 'utf8')); } catch { console.error('frozen claim request must be valid JSON'); process.exit(2); }
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const required = ['approval_id', 'project_id', 'project_cwd', 'plan_id', 'option_id', 'policy_hash', 'git_head', 'source_fingerprint', 'task_fingerprint', 'quota_observed_at', 'tasks_path', 'quota_snapshot_path'];
if (required.some((key) => typeof request[key] !== 'string') || request.combo !== 'te-dispatch-paid' || !request.worktree_required || !Array.isArray(request.tasks) || !Array.isArray(request.source_fingerprints) || request.concurrency < 1 || request.concurrency > 4 || request.tasks.length < 1 || request.tasks.some((task) => !task || typeof task.id !== 'string' || task.backend !== 'omniroute' || task.model !== 'te-dispatch-paid')) {
  console.error('frozen claim violates bounded paid-fleet contract'); process.exit(2);
}
const currentHead = spawnSync('git', ['-C', request.project_cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
let taskFile;
try { taskFile = JSON.parse(readFileSync(request.tasks_path, 'utf8')); } catch { console.error('approved task file is missing or malformed'); process.exit(3); }
if (currentHead.status !== 0 || currentHead.stdout.trim() !== request.git_head || hash(request.tasks) !== request.task_fingerprint || hash(taskFile) !== request.task_fingerprint) {
  console.error('frozen claim drifted before database claim'); process.exit(3);
}
try {
  for (const source of request.source_fingerprints) {
    if (!source || typeof source.path !== 'string' || typeof source.fingerprint !== 'string') throw new Error('invalid source fingerprint');
    if (createHash('sha256').update(readFileSync(`${request.project_cwd}/${source.path}`, 'utf8')).digest('hex') !== source.fingerprint) throw new Error(`source drift: ${source.path}`);
  }
  if (hash(request.source_fingerprints) !== request.source_fingerprint) throw new Error('source fingerprint bundle drift');
  const quota = JSON.parse(readFileSync(request.quota_snapshot_path, 'utf8'));
  const observedAt = quota.observed_at || quota.generated_at;
  const eligible = quota.eligible === true || quota.quota_eligible === true;
  if (observedAt !== request.quota_observed_at || eligible !== request.quota_eligible) throw new Error('quota snapshot drift');
} catch (error) { console.error(error instanceof Error ? error.message : 'preflight failed'); process.exit(3); }
const response = await fetch(`${bridgeUrl}/dispatches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
const claim = await response.json();
if (!response.ok || !claim.ok) { console.error(JSON.stringify({ launch: 'blocked', claim }, null, 2)); process.exit(3); }
if (dryRun || process.env.TEMPERANCE_SWARM_AUTOLAUNCH !== '1') {
  console.log(JSON.stringify({ launch: 'claimed_not_started', reason: dryRun ? 'dry-run' : 'TEMPERANCE_SWARM_AUTOLAUNCH is not enabled', claim }, null, 2));
  process.exit(0);
}
const batch = spawnSync('temperance-batch', ['--foreground', '--tasks', request.tasks_path, '--concurrency', String(request.concurrency), '--worktree', '--control-claim', claim.claim_id], {
  cwd: request.project_cwd, env: { ...process.env, TEMPERANCE_REQUIRE_CONTROL_CLAIM: '1' }, encoding: 'utf8',
});
console.log(JSON.stringify({ launch: batch.status === 0 ? 'started' : 'failed', claim, status: batch.status, stdout: batch.stdout?.slice(-2000), stderr: batch.stderr?.slice(-2000) }, null, 2));
process.exit(batch.status || 0);
