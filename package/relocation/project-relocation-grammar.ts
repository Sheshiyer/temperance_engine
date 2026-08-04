/**
 * Pure policy oracle for canonical local repository basenames.
 *
 * This module intentionally has no filesystem, Git, registry, client-session,
 * or network seam. It validates before identity normalization; the ratified
 * normalization policy is identity for the admitted ASCII repertoire.
 */

export const CANONICAL_REPOSITORY_BASENAME = /^(?:-|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/u;

export interface RepositoryNameProjection {
  rawName: string;
  normalizedName: string;
  identityKey: string;
  presentationName: string;
}

export function isCanonicalRepositoryBasename(rawName: string): boolean {
  return typeof rawName === "string" && CANONICAL_REPOSITORY_BASENAME.test(rawName);
}

export function validateRepositoryBasename(rawName: string): void {
  if (!isCanonicalRepositoryBasename(rawName)) {
    throw new Error(`repository_basename_invalid:${JSON.stringify(rawName)}`);
  }
}

/**
 * Decision 21: validation precedes identity normalization, and normalization
 * is identity for the already-validated ASCII basename.
 */
export function normalizeRepositoryBasename(rawName: string): string {
  validateRepositoryBasename(rawName);
  return rawName;
}

export function projectRepositoryName(rawName: string): RepositoryNameProjection {
  const normalizedName = normalizeRepositoryBasename(rawName);
  return {
    rawName,
    normalizedName,
    identityKey: normalizedName,
    presentationName: normalizedName,
  };
}

export function assertNoIdentityCollision(
  rawName: string,
  existingIdentityKeys: Iterable<string>,
): RepositoryNameProjection {
  const projection = projectRepositoryName(rawName);
  for (const existingIdentityKey of existingIdentityKeys) {
    if (existingIdentityKey === projection.identityKey) {
      throw new Error(`repository_identity_collision:${projection.identityKey}`);
    }
  }
  return projection;
}
