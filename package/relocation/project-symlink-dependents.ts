/**
 * External symlinks that point AT a repository, or into it.
 *
 * `project-path-consumers.ts` looks inward: which tracked files inside a repo
 * mention its own old path. Nothing looked outward. That asymmetry is how a
 * repository can plan perfectly clean and still take tooling down when it
 * moves -- `~/.agents/skill-clusters` and 62 links under `~/.agents/skills/*`
 * point into Skill-clusters, and `~/.local/bin/temperance-*` plus
 * `~/.claude/PAI/router/*` point into temperance_engine. A relocation leaves
 * every one of them dangling.
 *
 * The cost is not the extra hop -- following a symlink is a syscall. It is the
 * failure: a dangling skill path makes lookup fail, and the fallback is
 * scanning the skills tree, which is both slow and explicitly forbidden.
 *
 * Pure: the caller supplies the (link, target) pairs it discovered, so this
 * module has no filesystem seam and the containment rule stays testable.
 */

import { resolve } from "node:path";

export interface SymlinkCandidate {
  link: string;
  target: string;
}

function segments(path: string): string[] {
  return resolve(path).split("/").filter(Boolean);
}

/**
 * Segment-aware containment. A string prefix test would treat
 * `Skill-clusters.worktrees` and `Skill-clusters-archive` as inside
 * `Skill-clusters` and hold a move that is perfectly safe.
 */
function isAtOrWithin(repoSegments: string[], targetSegments: string[]): boolean {
  if (targetSegments.length < repoSegments.length) return false;
  return repoSegments.every((segment, index) => targetSegments[index] === segment);
}

export function symlinkDependentsOf(
  repositoryPath: string,
  candidates: readonly SymlinkCandidate[],
): SymlinkCandidate[] {
  const repoSegments = segments(repositoryPath);
  return candidates.filter((candidate) =>
    isAtOrWithin(repoSegments, segments(candidate.target)),
  );
}
