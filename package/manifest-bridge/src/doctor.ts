import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  omniroute_url?: string;
  home?: string;
  platform?: NodeJS.Platform;
  record?: boolean;
  repair_duplicates?: boolean;
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

/**
 * Explicit, backup-first repair for exact duplicate IDs. It never touches a
 * malformed file and keeps the first physical occurrence byte-for-byte.
 */
export function repairDuplicateEvents(root: string): { files: number; removed: number; backups: string[] } {
  let files = 0; let removed = 0; const backups: string[] = [];
  for (const entry of eventFiles(root)) {
    const source = readFileSync(entry.file, 'utf8');
    const lines = source.split('\n'); const seen = new Set<string>(); const retained: string[] = [];
    let fileRemoved = 0;
    for (const line of lines) {
      if (!line.trim()) { retained.push(line); continue; }
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(line) as Record<string, unknown>; } catch { throw new Error(`refusing repair: malformed JSONL at ${entry.file}`); }
      const id = typeof parsed.id === 'string' ? parsed.id : '';
      if (!id) throw new Error(`refusing repair: event without id at ${entry.file}`);
      if (seen.has(id)) { fileRemoved += 1; continue; }
      seen.add(id); retained.push(line);
    }
    if (!fileRemoved) continue;
    const backup = `${entry.file}.bak.doctor-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(entry.file, backup);
    const temporary = `${entry.file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, retained.join('\n'), 'utf8'); renameSync(temporary, entry.file);
    files += 1; removed += fileRemoved; backups.push(backup);
  }
  return { files, removed, backups };
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

function checkLaunchd(platform: NodeJS.Platform, checks: DoctorCheck[]): void {
  if (platform !== 'darwin') { add(checks, 'launchd', 'warn', 'launchd check is macOS-only.', { platform }); return; }
  try {
    execFileSync('launchctl', ['print', `gui/${process.getuid?.() || 0}/com.temperance.engine.manifest-bridge`], { stdio: 'ignore', timeout: 700 });
    add(checks, 'launchd', 'pass', 'Manifest bridge LaunchAgent is loaded.');
  } catch { add(checks, 'launchd', 'warn', 'Manifest bridge LaunchAgent is not loaded; a manual bridge may still be running.'); }
}

export async function runManifestDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const root = options.state_dir;
  const bridgeUrl = options.bridge_url || process.env.TEMPERANCE_MANIFEST_BRIDGE_URL || 'http://127.0.0.1:8766';
  const checks: DoctorCheck[] = [];
  if (options.repair_duplicates) {
    try {
      const repaired = repairDuplicateEvents(root);
      add(checks, 'duplicate-repair', repaired.removed ? 'pass' : 'warn', repaired.removed ? 'Removed exact duplicate event IDs with timestamped backups.' : 'No duplicate event IDs required repair.', { files: repaired.files, removed: repaired.removed, backups: repaired.backups.length });
    } catch (error) { add(checks, 'duplicate-repair', 'fail', error instanceof Error ? error.message : String(error)); }
  }
  if (!existsSync(root)) add(checks, 'state-root', 'fail', 'Manifest state root does not exist.', { path: root });
  else add(checks, 'state-root', 'pass', 'Manifest state root is readable.', { path: root });
  checkPolicy(root, checks); checkRegistry(root, checks); checkRuns(root, checks);
  if (existsSync(root)) scanEvents(root, checks);
  const runtime = await manifestRuntimeReceipt({ bridge_url: bridgeUrl, omniroute_url: options.omniroute_url });
  add(checks, 'bridge-health', runtime.manifest.state === 'ready' ? 'pass' : 'fail', runtime.manifest.state === 'ready' ? 'Manifest loopback bridge health verified.' : 'Manifest loopback bridge is offline.', { url: runtime.manifest.url, status_code: runtime.manifest.status_code || null, event_count: runtime.manifest.event_count ?? null });
  add(checks, 'omniroute', runtime.omniroute.state === 'ready' ? 'pass' : 'warn', runtime.omniroute.state === 'ready' ? 'Protected OmniRoute gateway answered.' : 'OmniRoute gateway did not answer.', { url: runtime.omniroute.url, status_code: runtime.omniroute.status_code || null });
  checkLaunchd(options.platform || process.platform, checks); checkHooks(options.home || homedir(), checks);
  const overall: DoctorStatus = checks.some((check) => check.status === 'fail') ? 'fail' : checks.some((check) => check.status === 'warn') ? 'warn' : 'pass';
  const report: DoctorReport = { schema: 'temperance.manifest.doctor.v1', generated_at: new Date().toISOString(), overall, exit_code: overall === 'fail' ? 2 : 0, state_dir: root, bridge_url: bridgeUrl.replace(/\/$/, ''), checks };
  if (options.record) {
    const directory = join(root, 'diagnostics'); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `doctor-${report.generated_at.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
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
