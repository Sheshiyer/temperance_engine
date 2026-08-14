import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export const PROJECT_SCHEMA = 'temperance.manifest.project.v1' as const;
export const LEGACY_PROJECT_ID = 'legacy-unscoped';

export interface ProjectIdentity {
  schema: typeof PROJECT_SCHEMA;
  project_id: string;
  name: string;
  cwd: string;
  bridge_url: string;
  initialized_at: string;
  updated_at: string;
}

export function canonicalCwd(cwd: string): string {
  const resolved = resolve(cwd);
  try { return realpathSync.native(resolved); } catch { return resolved; }
}

/**
 * A project is the checked-out Git worktree, never an arbitrary child cwd.
 * This keeps nested packages and symlinked launch directories on one rail.
 */
export function projectRootForCwd(cwd: string): string {
  const canonical = canonicalCwd(cwd);
  try {
    return canonicalCwd(execFileSync('git', ['-C', canonical, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return canonical;
  }
}

function projectSlug(cwd: string): string {
  const name = basename(cwd).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  const hash = createHash('sha256').update(canonicalCwd(cwd)).digest('hex').slice(0, 10);
  return `${name}-${hash}`;
}

export function projectManifestPath(cwd: string): string {
  return join(projectRootForCwd(cwd), '.temperance', 'manifest.json');
}

export function projectIdForCwd(cwd: string): string {
  return projectSlug(cwd);
}

export function identityForCwd(cwd: string, bridgeUrl = process.env.TEMPERANCE_MANIFEST_BRIDGE_URL || 'http://127.0.0.1:8766'): ProjectIdentity {
  const root = projectRootForCwd(cwd);
  const now = new Date().toISOString();
  return {
    schema: PROJECT_SCHEMA,
    project_id: projectIdForCwd(root),
    name: basename(root) || 'project',
    cwd: root,
    bridge_url: bridgeUrl.replace(/\/$/, ''),
    initialized_at: now,
    updated_at: now,
  };
}

export function readProjectIdentity(cwd: string): ProjectIdentity | null {
  const root = projectRootForCwd(cwd);
  const path = projectManifestPath(root);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<ProjectIdentity>;
    if (value.schema !== PROJECT_SCHEMA || typeof value.project_id !== 'string' || typeof value.cwd !== 'string' || canonicalCwd(value.cwd) !== root) return null;
    return {
      ...identityForCwd(value.cwd, value.bridge_url),
      ...value,
      cwd: root,
      project_id: value.project_id,
      name: typeof value.name === 'string' && value.name.trim() ? value.name : basename(value.cwd),
    };
  } catch {
    return null;
  }
}

export function initProject(cwd: string, bridgeUrl?: string): { identity: ProjectIdentity; path: string; created: boolean } {
  // Materialize a requested non-Git directory before canonicalization. macOS
  // resolves /var through /private only once the path exists; doing this first
  // prevents an initialization-time ID from differing from later hook IDs.
  mkdirSync(resolve(cwd), { recursive: true });
  const root = projectRootForCwd(cwd);
  const path = projectManifestPath(root);
  const existing = readProjectIdentity(root);
  const identity = existing ? { ...existing, updated_at: new Date().toISOString(), bridge_url: (bridgeUrl || existing.bridge_url).replace(/\/$/, '') } : identityForCwd(root, bridgeUrl);
  mkdirSync(join(root, '.temperance'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  return { identity, path, created: !existing };
}

export function stateRoot(): string {
  return process.env.TEMPERANCE_MANIFEST_STATE_DIR || join(homedir(), '.temperance_engine', 'state', 'manifest');
}
