import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface DiscoveredGitRoot {
  path: string;
  depth: number;
}

/**
 * Bounded, depth-capped scan for independent Git repositories nested below
 * startPath. Never reads file content -- existence and type (directory vs.
 * file) only. Stops descending the instant it finds a repository boundary
 * (a real .git directory) or a worktree pointer (a .git file) -- neither
 * is ever walked into further. Skips node_modules entirely at every level.
 * Bounded to startPath's own subtree; the caller is responsible for only
 * ever passing an already-approved portfolio-root child as startPath.
 */
export function discoverNestedGitRoots(startPath: string, maxDepth: number): DiscoveredGitRoot[] {
  const found: DiscoveredGitRoot[] = [];
  walk(startPath, 1, maxDepth, found);
  return found;
}

function walk(dir: string, depth: number, maxDepth: number, found: DiscoveredGitRoot[]): void {
  if (depth > maxDepth) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entryName of entries) {
    if (entryName === "node_modules") continue;
    const entryPath = join(dir, entryName);
    let entryStats;
    try {
      entryStats = lstatSync(entryPath);
    } catch {
      continue;
    }
    if (!entryStats.isDirectory()) continue;

    const gitMarkerPath = join(entryPath, ".git");
    let gitMarkerStats;
    try {
      gitMarkerStats = lstatSync(gitMarkerPath);
    } catch {
      gitMarkerStats = null;
    }

    if (gitMarkerStats?.isDirectory()) {
      found.push({ path: entryPath, depth });
      continue;
    }
    if (gitMarkerStats) {
      // .git exists but isn't a directory -- a worktree admin pointer file.
      // Excluded from candidacy; do not descend past it either.
      continue;
    }
    walk(entryPath, depth + 1, maxDepth, found);
  }
}
