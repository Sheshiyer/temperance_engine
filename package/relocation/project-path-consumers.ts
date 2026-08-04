/**
 * Bounded old-path consumer audit for the vault relocation transaction.
 *
 * This module never walks an arbitrary directory. Checked-in content is
 * discovered only through `git ls-files` against explicitly supplied
 * repository roots; host configuration surfaces are read only from an
 * explicit list of exact file paths the caller supplies. There is no
 * provider-transcript, session-store, credential, cache, or dependency-tree
 * traversal anywhere in this module.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export type PathConsumerCategory =
  | "repository-config-or-script"
  | "git-worktree-administration"
  | "submodule"
  | "mcp-client-project-config"
  | "hook"
  | "launchd-or-systemd"
  | "deploy-script"
  | "sync-job"
  | "documentation"
  | "cross-repository-reference";

const MCP_CLIENT_CONFIG_BASENAMES = new Set([
  "mcp.json",
  ".mcp.json",
  "claude_desktop_config.json",
  ".claude.json",
]);

const DOCUMENTATION_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst"]);

function basenameOf(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? "";
}

function extensionOf(basename: string): string {
  const dotIndex = basename.lastIndexOf(".");
  return dotIndex <= 0 ? "" : basename.slice(dotIndex);
}

export function classifyConsumerPath(path: string): PathConsumerCategory {
  const basename = basenameOf(path);

  if (/(^|\/)\.git\/worktrees\/[^/]+\/gitdir$/.test(path)) return "git-worktree-administration";
  if (basename === ".gitmodules") return "submodule";
  if (/(^|\/)\.git\/hooks\//.test(path)) return "hook";
  if (/\.hook\.(ts|js|py|sh)$/.test(basename)) return "hook";
  if (MCP_CLIENT_CONFIG_BASENAMES.has(basename)) return "mcp-client-project-config";
  if (basename === "launch.json" && /(^|\/)\.(claude|codex|cursor|vscode)\//.test(path)) {
    return "mcp-client-project-config";
  }
  if (basename.endsWith(".plist")) return "launchd-or-systemd";
  if (/(^|\/)(LaunchAgents|LaunchDaemons)\//.test(path)) return "launchd-or-systemd";
  if (/(^|\/)systemd\//.test(path) && (basename.endsWith(".service") || basename.endsWith(".timer"))) {
    return "launchd-or-systemd";
  }
  if (/(^|\/)\.github\/workflows\//.test(path)) return "deploy-script";
  if (/^deploy[-_.]/i.test(basename) || basename === "Procfile") return "deploy-script";
  if (/sync/i.test(basename) && /\.(sh|ts|js|py)$/.test(basename)) return "sync-job";
  if (basename === "crontab") return "sync-job";
  if (DOCUMENTATION_EXTENSIONS.has(extensionOf(basename))) return "documentation";

  return "repository-config-or-script";
}

export interface PatternTextMatch {
  line: number;
  matchedPattern: string;
}

export function findPatternMatches(text: string, patterns: string[]): PatternTextMatch[] {
  if (text.length === 0 || patterns.length === 0) return [];
  const matches: PatternTextMatch[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of patterns) {
      if (pattern.length > 0 && line.includes(pattern)) {
        matches.push({ line: index + 1, matchedPattern: pattern });
      }
    }
  }
  return matches;
}

export interface PathConsumerMatch {
  root: string;
  file: string;
  line: number;
  matchedPattern: string;
  category: PathConsumerCategory;
}

export interface PathConsumerAuditInput {
  canonicalPath: string;
  approvedAliases?: string[];
  repositorySearchRoots: string[];
  candidateRepositoryRoot: string;
  hostConfigSurfaces?: string[];
}

export interface PathConsumerAuditReport {
  canonicalPath: string;
  approvedAliases: string[];
  repositorySearchRoots: string[];
  candidateRepositoryRoot: string;
  hostConfigSurfaces: string[];
  patterns: string[];
  matches: PathConsumerMatch[];
  unresolvedConsumers: PathConsumerMatch[];
}

function gitTrackedFiles(repoRoot: string): string[] {
  const result = spawnSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.split("\0").filter(Boolean);
}

function categoryForMatch(
  relativeFile: string,
  isCrossRepository: boolean,
): PathConsumerCategory {
  const category = classifyConsumerPath(relativeFile);
  const isGenericDefault = category === "repository-config-or-script" || category === "documentation";
  return isCrossRepository && isGenericDefault ? "cross-repository-reference" : category;
}

function scanRepositoryRoot(
  root: string,
  candidateRepositoryRoot: string,
  patterns: string[],
): PathConsumerMatch[] {
  const matches: PathConsumerMatch[] = [];
  const isCrossRepository = resolve(root) !== resolve(candidateRepositoryRoot);
  for (const relativeFile of gitTrackedFiles(root)) {
    const absoluteFile = join(root, relativeFile);
    let content: string;
    try {
      content = readFileSync(absoluteFile, "utf8");
    } catch {
      continue;
    }
    for (const { line, matchedPattern } of findPatternMatches(content, patterns)) {
      matches.push({
        root,
        file: absoluteFile,
        line,
        matchedPattern,
        category: categoryForMatch(relativeFile, isCrossRepository),
      });
    }
  }
  return matches;
}

/**
 * Bounded to exactly the candidate repository's own `.git/worktrees/` admin
 * directory. Each `gitdir` pointer file names one specific linked-worktree
 * `.git` file; only that discovered, exact path is read next — this never
 * becomes a general directory walk.
 */
function findWorktreeAdministrationMatches(
  candidateRepositoryRoot: string,
  patterns: string[],
): PathConsumerMatch[] {
  const worktreesDir = join(candidateRepositoryRoot, ".git", "worktrees");
  if (!existsSync(worktreesDir)) return [];
  const matches: PathConsumerMatch[] = [];
  for (const name of readdirSync(worktreesDir)) {
    const gitdirPointer = join(worktreesDir, name, "gitdir");
    if (!existsSync(gitdirPointer)) continue;
    const linkedGitFile = readFileSync(gitdirPointer, "utf8").trim();
    if (!linkedGitFile || !existsSync(linkedGitFile)) continue;
    const content = readFileSync(linkedGitFile, "utf8");
    for (const { line, matchedPattern } of findPatternMatches(content, patterns)) {
      matches.push({
        root: candidateRepositoryRoot,
        file: linkedGitFile,
        line,
        matchedPattern,
        category: "git-worktree-administration",
      });
    }
  }
  return matches;
}

const HOST_CONFIG_SURFACE_ROOT = "host-config-surface";

/**
 * Reads only the exact file paths the caller supplied — no directory
 * listing, no glob, no recursion. A missing path or a path that is not a
 * regular file (e.g. a directory) is skipped rather than erroring, matching
 * `scanRepositoryRoot`'s tolerance for unreadable entries.
 */
function scanHostConfigSurfaces(surfaces: string[], patterns: string[]): PathConsumerMatch[] {
  const matches: PathConsumerMatch[] = [];
  for (const surface of surfaces) {
    let content: string;
    try {
      content = readFileSync(surface, "utf8");
    } catch {
      continue;
    }
    for (const { line, matchedPattern } of findPatternMatches(content, patterns)) {
      matches.push({
        root: HOST_CONFIG_SURFACE_ROOT,
        file: surface,
        line,
        matchedPattern,
        category: classifyConsumerPath(surface),
      });
    }
  }
  return matches;
}

export function auditPathConsumers(input: PathConsumerAuditInput): PathConsumerAuditReport {
  const approvedAliases = input.approvedAliases ?? [];
  const hostConfigSurfaces = input.hostConfigSurfaces ?? [];
  const patterns = [input.canonicalPath, ...approvedAliases];
  const matches: PathConsumerMatch[] = [];
  for (const root of input.repositorySearchRoots) {
    matches.push(...scanRepositoryRoot(root, input.candidateRepositoryRoot, patterns));
  }
  matches.push(...findWorktreeAdministrationMatches(input.candidateRepositoryRoot, patterns));
  matches.push(...scanHostConfigSurfaces(hostConfigSurfaces, patterns));
  return {
    canonicalPath: input.canonicalPath,
    approvedAliases,
    repositorySearchRoots: input.repositorySearchRoots,
    candidateRepositoryRoot: input.candidateRepositoryRoot,
    hostConfigSurfaces,
    patterns,
    matches,
    unresolvedConsumers: matches,
  };
}
