import { lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { ContextSourcePointers } from './contract';

const UNSAFE_POINTER_CHARS = /[\u0000-\u001f\u007f<>\u2028\u2029]/u;

type RootPolicy = 'trusted-symlink-root' | 'real-directory';

export interface ResolveContextSourcesInput {
  home: string;
  cwd: string;
}

function isolated(resolve: () => string | null): string | null {
  try {
    return resolve();
  } catch {
    return null;
  }
}

function safeAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value) && !UNSAFE_POINTER_CHARS.test(value);
}

function containedBy(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function canonicalDirectory(path: string, policy: RootPolicy): string | null {
  if (!safeAbsolutePath(path)) return null;
  try {
    const entry = lstatSync(path);
    if (policy === 'real-directory') {
      if (!entry.isDirectory() || entry.isSymbolicLink()) return null;
    } else if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      return null;
    }

    const canonical = realpathSync(path);
    if (!safeAbsolutePath(canonical) || !statSync(canonical).isDirectory()) return null;
    return canonical;
  } catch {
    return null;
  }
}

function fixedFile(rootPath: string, canonicalRoot: string, segments: readonly string[]): string | null {
  const candidate = join(rootPath, ...segments);
  if (!safeAbsolutePath(candidate)) return null;
  try {
    const entry = lstatSync(candidate);
    if (!entry.isFile() || entry.isSymbolicLink()) return null;
    const canonical = realpathSync(candidate);
    if (!safeAbsolutePath(canonical)) return null;
    if (!containedBy(canonicalRoot, canonical)) return null;
    if (!statSync(canonical).isFile()) return null;
    return canonical;
  } catch {
    return null;
  }
}

function homePointer(
  home: string,
  rootSegments: readonly string[],
  targetSegments: readonly string[],
): string | null {
  if (!safeAbsolutePath(home)) return null;
  const rootPath = join(home, ...rootSegments);
  const canonicalRoot = canonicalDirectory(rootPath, 'trusted-symlink-root');
  if (!canonicalRoot) return null;
  return fixedFile(rootPath, canonicalRoot, targetSegments);
}

function gsdPointer(cwd: string): string | null {
  const canonicalCwd = canonicalDirectory(cwd, 'trusted-symlink-root');
  if (!canonicalCwd) return null;

  const planningPath = join(cwd, '.planning');
  const canonicalPlanning = canonicalDirectory(planningPath, 'real-directory');
  if (!canonicalPlanning || !containedBy(canonicalCwd, canonicalPlanning)) return null;
  return fixedFile(planningPath, canonicalPlanning, ['STATE.md']);
}

/**
 * Resolve three fixed, client-owned context pointers. Each source is isolated:
 * an unsafe or absent source becomes null without suppressing its safe peers.
 * This module deliberately performs metadata/path operations only.
 */
export function resolveContextSources(input: ResolveContextSourcesInput): ContextSourcePointers {
  return {
    pai: isolated(() => homePointer(input.home, ['.Codex', 'PAI'], ['Algorithm', 'LATEST'])),
    gsd: isolated(() => gsdPointer(input.cwd)),
    skills: isolated(() => homePointer(input.home, ['.agents', 'skill-clusters'], ['skill-index.json'])),
  };
}
