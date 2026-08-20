import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ManifestCatalog } from './catalog';
import { ACTIVE_RUN_SCHEMA, ACTIVATION_POLICY_SCHEMA } from './activation';
import { normalizeEvent } from './contract';
import { manifestRuntimeReceipt } from './runtime-status';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface DoctorReport {
  schema: 'temperance.manifest.doctor.v1';
  generated_at: string;
  overall: DoctorStatus;
  exit_code: number;
  state_dir: string;
  bridge_url: string;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  state_dir: string;
  bridge_url?: string;
  console_url?: string;
  omniroute_url?: string;
  home?: string;
  platform?: NodeJS.Platform;
}

function add(checks: DoctorCheck[], id: string, status: DoctorStatus, summary: string, detail?: Record<string, unknown>): void {
  checks.push({ id, status, summary, ...(detail ? { detail } : {}) });
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function eventFiles(root: string): Array<{ file: string; project_id?: string }> {
  const files: Array<{ file: string; project_id?: string }> = [];
  const legacy = join(root, 'events.jsonl');
  if (existsSync(legacy)) files.push({ file: legacy });
  const projects = join(root, 'projects');
  try {
    for (const projectId of readdirSync(projects)) {
      const file = join(projects, projectId, 'events.jsonl');
      if (existsSync(file)) files.push({ file, project_id: projectId });
    }
  } catch { /* an empty state root has no projects directory */ }
  return files;
}

function scanEvents(root: string, checks: DoctorCheck[]): void {
  const files = eventFiles(root);
  let count = 0; let malformed = 0; let mismatches = 0; let duplicates = 0;
  for (const entry of files) {
    const ids = new Set<string>();
    for (const line of readFileSync(entry.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = normalizeEvent(JSON.parse(line));
        count += 1;
        if (ids.has(event.id)) duplicates += 1; else ids.add(event.id);
        if (entry.project_id && event.project_id !== entry.project_id) mismatches += 1;
      } catch { malformed += 1; }
    }
  }
  if (!files.length) add(checks, 'event-log', 'warn', 'No event logs exist yet.', { files: 0 });
  else if (malformed || mismatches || duplicates) add(checks, 'event-log', 'fail', 'Event logs contain malformed, duplicate, or cross-project records.', { files: files.length, events: count, malformed, mismatches, duplicates });
  else add(checks, 'event-log', 'pass', 'All persisted event records normalize and remain project-scoped.', { files: files.length, events: count });
}

function checkPolicy(root: string, checks: DoctorCheck[]): void {
  const path = join(root, 'activation-policy.json');
  if (!existsSync(path)) { add(checks, 'activation-policy', 'warn', 'Activation policy is absent; Algorithm activation is deny-all.', { path }); return; }
  try {
    const policy = json(path) as Record<string, unknown>;
    const roots = Array.isArray(policy.allowed_roots) ? policy.allowed_roots.filter((value) => typeof value === 'string') : [];
    if (policy.schema !== ACTIVATION_POLICY_SCHEMA || !roots.length) add(checks, 'activation-policy', 'fail', 'Activation policy is malformed or contains no allowed roots.', { path });
    else add(checks, 'activation-policy', policy.enabled === false ? 'warn' : 'pass', policy.enabled === false ? 'Activation policy is intentionally disabled.' : 'Activation policy is enabled with explicit roots.', { path, allowed_roots: roots.length });
  } catch { add(checks, 'activation-policy', 'fail', 'Activation policy is not valid JSON.', { path }); }
}

function checkRuns(root: string, checks: DoctorCheck[]): void {
  const directory = join(root, 'active-runs');
  let invalid = 0; let active = 0;
  try {
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.json')) continue;
      try {
        const run = json(join(directory, name)) as Record<string, unknown>;
        if (run.schema !== ACTIVE_RUN_SCHEMA || run.mode !== 'ALGORITHM' || typeof run.run_id !== 'string' || typeof run.project_id !== 'string') invalid += 1;
        else active += 1;
      } catch { invalid += 1; }
    }
  } catch { /* no active runs is normal */ }
  if (invalid) add(checks, 'active-runs', 'fail', 'Active Algorithm run receipts are malformed.', { active, invalid });
  else add(checks, 'active-runs', active ? 'pass' : 'warn', active ? 'Active Algorithm run receipts are well-formed.' : 'No active Algorithm run receipts exist.', { active });
}

function checkRegistry(root: string, checks: DoctorCheck[]): void {
  const file = join(root, 'projects.json');
  if (!existsSync(file)) { add(checks, 'project-registry', 'warn', 'Project registry is absent; it will be created on first event.', { file }); return; }
  try {
    const records = json(file);
    if (!Array.isArray(records)) throw new Error('not array');
    const ids = records.map((record) => record && typeof record === 'object' ? String((record as Record<string, unknown>).project_id || '') : '');
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) add(checks, 'project-registry', 'fail', 'Project registry has missing or duplicate identities.', { file, records: records.length });
    else add(checks, 'project-registry', 'pass', 'Project registry identities are unique.', { file, records: records.length });
  } catch { add(checks, 'project-registry', 'fail', 'Project registry is not valid JSON.', { file }); }
}

function checkHooks(home: string, checks: DoctorCheck[]): void {
  const paths = [join(home, '.codex', 'hooks', 'PromptProcessing.hook.ts'), join(home, '.claude', 'hooks', 'PromptProcessing.hook.ts')];
  let ready = 0; let missing = 0;
  for (const path of paths) {
    try {
      const text = readFileSync(path, 'utf8');
      if (text.includes('manifestRuntimeReceipt') && text.includes('formatManifestRuntimeContext')) ready += 1; else missing += 1;
    } catch { missing += 1; }
  }
  add(checks, 'prompt-hooks', ready ? (missing ? 'warn' : 'pass') : 'warn', ready ? 'Installed PromptProcessing hook(s) inject a Manifest runtime receipt.' : 'No installed PromptProcessing hook injects a Manifest runtime receipt.', { ready, missing });
}

function checkCanonicalSource(home: string, checks: DoctorCheck[]): void {
  const expectedCli = join(import.meta.dir, 'cli.ts');
  const plist = join(home, 'Library', 'LaunchAgents', 'com.temperance.engine.manifest-bridge.plist');
  if (!existsSync(plist)) {
    add(checks, 'bridge-source', 'warn', 'Manifest bridge LaunchAgent source cannot be compared because its plist is absent.', { expected_cli: expectedCli, plist });
    return;
  }
  try {
    const launchdSource = readFileSync(plist, 'utf8').includes(expectedCli);
    add(checks, 'bridge-source', launchdSource ? 'pass' : 'fail', launchdSource ? 'LaunchAgent points at the canonical bridge source.' : 'LaunchAgent points at a different bridge copy; runtime/source parity is unsafe.', { expected_cli: expectedCli, plist });
  } catch { add(checks, 'bridge-source', 'warn', 'Manifest bridge LaunchAgent plist could not be read.', { expected_cli: expectedCli, plist }); }
}

function checkLaunchd(platform: NodeJS.Platform, checks: DoctorCheck[], id: 'bridge' | 'console', label: string): void {
  if (platform !== 'darwin') { add(checks, `${id}-launchd`, 'warn', 'launchd check is macOS-only.', { platform }); return; }
  try {
    execFileSync('launchctl', ['print', `gui/${process.getuid?.() || 0}/${label}`], { stdio: 'ignore', timeout: 700 });
    add(checks, `${id}-launchd`, 'pass', `Manifest ${id} LaunchAgent is loaded.`);
  } catch { add(checks, `${id}-launchd`, id === 'bridge' ? 'warn' : 'fail', `Manifest ${id} LaunchAgent is not loaded.`); }
}

async function consoleHealth(url: string): Promise<{ ready: boolean; status_code?: number }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    const html = await response.text();
    return { ready: response.ok && html.includes('<div id="root">'), status_code: response.status };
  } catch { return { ready: false }; }
}

export async function runManifestDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const root = options.state_dir;
  const bridgeUrl = options.bridge_url || process.env.TEMPERANCE_MANIFEST_BRIDGE_URL || 'http://127.0.0.1:8766';
  const consoleUrl = options.console_url || process.env.TEMPERANCE_MANIFEST_CONSOLE_URL || 'http://127.0.0.1:5173';
  const checks: DoctorCheck[] = [];
  if (!existsSync(root)) add(checks, 'state-root', 'fail', 'Manifest state root does not exist.', { path: root });
  else add(checks, 'state-root', 'pass', 'Manifest state root is readable.', { path: root });
  checkPolicy(root, checks); checkRegistry(root, checks); checkRuns(root, checks);
  if (existsSync(root)) scanEvents(root, checks);
  const runtime = await manifestRuntimeReceipt({ bridge_url: bridgeUrl, omniroute_url: options.omniroute_url });
  add(checks, 'bridge-health', runtime.manifest.state === 'ready' ? 'pass' : 'fail', runtime.manifest.state === 'ready' ? 'Manifest loopback bridge health verified.' : 'Manifest loopback bridge is offline.', { url: runtime.manifest.url, status_code: runtime.manifest.status_code || null, event_count: runtime.manifest.event_count ?? null });
  add(checks, 'omniroute', runtime.omniroute.state === 'ready' ? 'pass' : 'warn', runtime.omniroute.state === 'ready' ? 'Protected OmniRoute gateway answered.' : 'OmniRoute gateway did not answer.', { url: runtime.omniroute.url, status_code: runtime.omniroute.status_code || null });
  const console = await consoleHealth(consoleUrl);
  add(checks, 'console-health', console.ready ? 'pass' : 'fail', console.ready ? 'Manifest visual console responded with the React root.' : 'Manifest visual console is offline or returned an invalid page.', { url: consoleUrl, status_code: console.status_code || null });
  checkLaunchd(options.platform || process.platform, checks, 'bridge', 'com.temperance.engine.manifest-bridge');
  checkLaunchd(options.platform || process.platform, checks, 'console', 'com.temperance.engine.manifest-console');
  checkHooks(options.home || homedir(), checks);
  checkCanonicalSource(options.home || homedir(), checks);
  const overall: DoctorStatus = checks.some((check) => check.status === 'fail') ? 'fail' : checks.some((check) => check.status === 'warn') ? 'warn' : 'pass';
  const report: DoctorReport = { schema: 'temperance.manifest.doctor.v1', generated_at: new Date().toISOString(), overall, exit_code: overall === 'fail' ? 2 : 0, state_dir: root, bridge_url: bridgeUrl.replace(/\/$/, ''), checks };
  return report;
}

export function formatDoctorReport(report: DoctorReport, verbose = false): string {
  const mark: Record<DoctorStatus, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
  const lines = [`MANIFEST DOCTOR · ${report.overall.toUpperCase()}`, `  state     ${report.state_dir}`, `  bridge    ${report.bridge_url}`];
  for (const check of report.checks) lines.push(`  [${mark[check.status]}] ${check.id} · ${check.summary}${verbose && check.detail ? ` · ${JSON.stringify(check.detail)}` : ''}`);
  return lines.join('\n');
}

export function debugSnapshot(root: string, projectId?: string, limit = 50): Record<string, unknown> {
  const snapshot = new ManifestCatalog(root).snapshot(projectId);
  return { schema: 'temperance.manifest.debug.v1', generated_at: new Date().toISOString(), project_id: projectId || 'all', event_count: snapshot.event_count, freshness: snapshot.freshness, alerts: snapshot.alerts.slice(-limit), recent_events: snapshot.recent_events.slice(-limit) };
}
