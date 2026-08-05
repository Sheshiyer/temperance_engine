export interface CandidateIdentity {
  path: string;
  repositoryName: string;
  remotes: string[];
}

/**
 * Extracts a normalized "owner/repo" identity from a GitHub remote URL in
 * either https or ssh form. Returns null for anything that isn't a
 * recognizable GitHub remote (no attempt to handle other hosts -- nothing
 * in this codebase relocates non-GitHub-hosted repositories today).
 */
function normalizeGithubIdentity(remoteUrl: string): string | null {
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`.toLowerCase();
}

/**
 * Groups candidates by repository basename and by normalized GitHub remote
 * identity. Any group with 2+ members means every member of that group is
 * held -- no automatic preference, no default winner (owner decision E4,
 * design doc). Returns a map keyed by candidate path (repositoryName is
 * deliberately not unique -- sharing it is exactly what's being detected)
 * to the new hold-reason strings for that candidate; candidates with no
 * collision are absent from the map.
 */
export function findCandidateCollisions(candidates: CandidateIdentity[]): Map<string, string[]> {
  const holdsByPath = new Map<string, string[]>();
  const addHold = (path: string, reason: string) => {
    const existing = holdsByPath.get(path) ?? [];
    existing.push(reason);
    holdsByPath.set(path, existing);
  };

  const pathsByBasename = new Map<string, string[]>();
  for (const candidate of candidates) {
    const list = pathsByBasename.get(candidate.repositoryName) ?? [];
    list.push(candidate.path);
    pathsByBasename.set(candidate.repositoryName, list);
  }
  for (const [repositoryName, paths] of pathsByBasename) {
    if (paths.length > 1) {
      for (const path of paths) addHold(path, `competing_candidate_claim:basename:${repositoryName}`);
    }
  }

  const pathsByIdentity = new Map<string, string[]>();
  for (const candidate of candidates) {
    for (const remote of candidate.remotes) {
      const identity = normalizeGithubIdentity(remote);
      if (!identity) continue;
      const list = pathsByIdentity.get(identity) ?? [];
      if (!list.includes(candidate.path)) list.push(candidate.path);
      pathsByIdentity.set(identity, list);
    }
  }
  for (const [identity, paths] of pathsByIdentity) {
    if (paths.length > 1) {
      for (const path of paths) addHold(path, `competing_candidate_claim:github_identity:${identity}`);
    }
  }

  return holdsByPath;
}
