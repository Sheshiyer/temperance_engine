import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { ManifestCatalog } from './catalog';
import { canonicalCwd, identityForCwd, projectManifestPath, projectRootForCwd, readProjectIdentity, stateRoot, type ProjectIdentity } from './project';
import type { ManifestEvent } from './types';

export const ACTIVATION_POLICY_SCHEMA = 'temperance.manifest.activation-policy.v1' as const;
export const ACTIVE_RUN_SCHEMA = 'temperance.manifest.active-run.v1' as const;

export interface ActivationPolicy {
  schema?: typeof ACTIVATION_POLICY_SCHEMA;
  allowed_roots: string[];
  enabled?: boolean;
}

export interface AlgorithmActivationInput {
  mode?: string;
  tier?: string;
  cwd: string;
  session_id?: string;
  surface?: 'claude' | 'codex' | 'opencode';
}

export interface ActiveAlgorithmRun {
  schema: typeof ACTIVE_RUN_SCHEMA;
  run_id: string;
  session_id: string;
  project_id: string;
  project_cwd: string;
  enrollment: 'enrolled' | 'observed-only';
  mode: 'ALGORITHM';
  tier?: string;
  surface: 'claude' | 'codex' | 'opencode';
  activated_at: string;
}

export interface ActivationDecision {
  accepted: boolean;
  reason: 'accepted' | 'mode_not_algorithm' | 'missing_session_id' | 'not_git_repository' | 'outside_allowlist' | 'invalid_manifest' | 'policy_disabled';
  project?: ProjectIdentity;
  enrollment?: ActiveAlgorithmRun['enrollment'];
  root?: string;
}

export interface ActivationResult extends ActivationDecision {
  run?: ActiveAlgorithmRun;
  event?: ManifestEvent;
}

export interface ActivationOptions extends Partial<ActivationPolicy> {
  state_dir?: string;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function policyRoots(options: ActivationOptions): string[] {
  return (options.allowed_roots || []).map(canonicalCwd);
}

/** Load host-owned scope configuration. An absent or malformed file is deny-all. */
export function loadActivationPolicy(directory = stateRoot()): ActivationOptions {
  const fromEnv = process.env.TEMPERANCE_MANIFEST_ALLOWED_ROOTS?.split(delimiter).filter(Boolean);
  if (fromEnv?.length) return { allowed_roots: fromEnv.map(canonicalCwd), enabled: process.env.TEMPERANCE_MANIFEST_ACTIVATION_ENABLED !== '0', state_dir: directory };
  try {
    const value = JSON.parse(readFileSync(join(directory, 'activation-policy.json'), 'utf8')) as Partial<ActivationPolicy>;
    if (value.schema !== ACTIVATION_POLICY_SCHEMA || !Array.isArray(value.allowed_roots)) return { allowed_roots: [], enabled: false, state_dir: directory };
    return { allowed_roots: value.allowed_roots.filter((root): root is string => typeof root === 'string').map(canonicalCwd), enabled: value.enabled !== false, state_dir: directory };
  } catch {
    return { allowed_roots: [], enabled: false, state_dir: directory };
  }
}

function isWithin(root: string, allowedRoot: string): boolean {
  return root === allowedRoot || root.startsWith(`${allowedRoot}/`);
}

function runPath(sessionId: string, root: string): string {
  return join(root, 'active-runs', `${hash(sessionId)}.json`);
}

function readRun(path: string): ActiveAlgorithmRun | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<ActiveAlgorithmRun>;
    if (value.schema !== ACTIVE_RUN_SCHEMA || typeof value.session_id !== 'string' || typeof value.project_id !== 'string' || typeof value.project_cwd !== 'string') return null;
    return value as ActiveAlgorithmRun;
  } catch { return null; }
}

function writeRun(path: string, run: ActiveAlgorithmRun): void {
  mkdirSync(join(path, '..'), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

function configured(options: ActivationOptions): boolean {
  return options.enabled !== false && policyRoots(options).length > 0;
}

export function resolveAlgorithmActivation(input: AlgorithmActivationInput, options: ActivationOptions = {}): ActivationDecision {
  if (String(input.mode || '').toUpperCase() !== 'ALGORITHM') return { accepted: false, reason: 'mode_not_algorithm' };
  if (!input.session_id?.trim()) return { accepted: false, reason: 'missing_session_id' };
  if (!configured(options)) return { accepted: false, reason: 'policy_disabled' };
  const cwd = canonicalCwd(input.cwd);
  const root = projectRootForCwd(cwd);
  if (root === cwd && !existsSync(join(root, '.git'))) return { accepted: false, reason: 'not_git_repository', root };
  if (!policyRoots(options).some((allowed) => isWithin(root, allowed))) return { accepted: false, reason: 'outside_allowlist', root };
  const registered = readProjectIdentity(root);
  if (existsSync(projectManifestPath(root)) && !registered) return { accepted: false, reason: 'invalid_manifest', root };
  return { accepted: true, reason: 'accepted', root, project: registered || identityForCwd(root), enrollment: registered ? 'enrolled' : 'observed-only' };
}

export function activeRunFor(sessionId: string | undefined, directory = stateRoot()): ActiveAlgorithmRun | null {
  if (!sessionId?.trim()) return null;
  return readRun(runPath(sessionId, directory));
}

export function activateAlgorithmRun(input: AlgorithmActivationInput, options: ActivationOptions = {}): ActivationResult {
  const decision = resolveAlgorithmActivation(input, options);
  if (!decision.accepted || !decision.project || !decision.enrollment || !input.session_id) return decision;
  const directory = options.state_dir || stateRoot();
  const existing = activeRunFor(input.session_id, directory);
  if (existing?.project_id === decision.project.project_id) return { ...decision, run: existing };
  const run: ActiveAlgorithmRun = {
    schema: ACTIVE_RUN_SCHEMA,
    run_id: input.session_id,
    session_id: input.session_id,
    project_id: decision.project.project_id,
    project_cwd: decision.project.cwd,
    enrollment: decision.enrollment,
    mode: 'ALGORITHM',
    tier: input.tier?.toUpperCase(),
    surface: input.surface || 'claude',
    activated_at: new Date().toISOString(),
  };
  writeRun(runPath(input.session_id, directory), run);
  const event = {
    id: `evt_algorithm_${hash(`${run.run_id}\0${run.project_id}`)}`,
    source: 'pai-hook' as const,
    kind: 'algorithm.activated',
    status: 'observed' as const,
    actor: 'activation-hook',
    project_id: run.project_id,
    session_id: run.session_id,
    correlation_id: run.run_id,
    phase: 'OBSERVE' as const,
    payload: { project_name: decision.project.name, project_cwd: run.project_cwd, run_id: run.run_id, enrollment: run.enrollment, mode: run.mode, tier: run.tier, surface: run.surface },
    evidence: [],
  };
  const result = new ManifestCatalog(directory).ingest(event);
  if (!result.accepted && !result.event) throw new Error(result.error || 'unable to persist Algorithm activation');
  return { ...decision, run, event: result.event };
}

/**
 * Nudge a live bridge after the durable local write. The bridge replays the
 * append before accepting this idempotent retry, which also wakes SSE clients.
 */
export async function publishActivationEvent(result: ActivationResult, bridgeUrl = process.env.TEMPERANCE_MANIFEST_BRIDGE_URL || 'http://127.0.0.1:8766'): Promise<boolean> {
  if (!result.event) return false;
  try {
    const response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result.event), signal: AbortSignal.timeout(350),
    });
    return response.ok;
  } catch { return false; }
}

export function closeAlgorithmRun(sessionId: string | undefined, directory = stateRoot()): ActiveAlgorithmRun | null {
  const run = activeRunFor(sessionId, directory);
  if (!run || !sessionId) return null;
  rmSync(runPath(sessionId, directory), { force: true });
  return run;
}

export function classificationFromContext(context: string): Pick<AlgorithmActivationInput, 'mode' | 'tier'> {
  const normalized = String(context || '');
  const standard = normalized.match(/MODE:\s*(MINIMAL|NATIVE|ALGORITHM)(?:\s*\|\s*TIER:\s*(E[1-5]))?/i);
  if (standard) return { mode: standard[1].toUpperCase(), tier: standard[2]?.toUpperCase() };
  const enrich = normalized.match(/mode\/tier:\s*(MINIMAL|NATIVE|ALGORITHM)(?:\s*\/\s*(E[1-5]))?/i);
  return { mode: enrich?.[1]?.toUpperCase(), tier: enrich?.[2]?.toUpperCase() };
}
