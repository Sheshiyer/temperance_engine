// package/relocation/project-repository-classification.ts
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

export type RepositoryKind = "standalone-repository" | "nested-repository" | "not-a-repository";

export interface RepositoryToplevelClassification {
  repositoryKind: RepositoryKind;
  gitTopLevel: string | null;
}

/**
 * The one comparison duplicated between scripts/vault-project-relocation.ts
 * and package/relocation/project-relocation-apply.ts before this module
 * existed: does `git rev-parse --show-toplevel` from this exact path equal
 * the path itself? realpath both sides first -- git resolves symlinks in
 * its own output (e.g. macOS /tmp -> /private/tmp), and comparing against
 * a non-realpath'd input would misclassify anything reached through a
 * symlinked ancestor as nested.
 */
export function classifyRepositoryByGitToplevel(path: string): RepositoryToplevelClassification {
  const result = spawnSync("git", ["-C", path, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (result.status !== 0) {
    return { repositoryKind: "not-a-repository", gitTopLevel: null };
  }
  const gitTopLevel = realpathSync(result.stdout.trim());
  const canonicalPath = realpathSync(path);
  return {
    repositoryKind: gitTopLevel === canonicalPath ? "standalone-repository" : "nested-repository",
    gitTopLevel,
  };
}
