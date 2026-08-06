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

/**
 * Codepoints that may appear in a segment we are willing to canonicalize.
 * Deliberately narrow: only the two real-world deviations observed in the
 * vault (uppercase ASCII, and the underscore) are rescuable. Everything
 * else — dots, spaces, separators, non-ASCII — fails closed, because any
 * repair for those would have to *invent* a destination name the owner
 * never ratified.
 */
const CANONICALIZABLE_REPERTOIRE = /^[A-Za-z0-9_-]+$/u;

function foldSegment(rawName: string): string {
  return rawName.toLowerCase().replaceAll("_", "-");
}

export function isCanonicalizableRepositorySegment(rawName: string): boolean {
  if (typeof rawName !== "string" || !CANONICALIZABLE_REPERTOIRE.test(rawName)) return false;
  return isCanonicalRepositoryBasename(foldSegment(rawName));
}

/**
 * Decision 21 widened: validation still precedes identity normalization, but
 * the admitted repertoire now includes case and underscore deviations, for
 * which normalization is a total, lossless, and reversible fold rather than
 * identity. The source name on disk is never mutated — this only projects
 * the segment a destination path should use.
 */
export function canonicalizeRepositorySegment(rawName: string): string {
  if (!isCanonicalizableRepositorySegment(rawName)) {
    throw new Error(`repository_segment_not_canonicalizable:${JSON.stringify(rawName)}`);
  }
  return foldSegment(rawName);
}

export interface CanonicalizedSegmentProjection {
  segments: string[];
  rewritten: { from: string; to: string; index: number }[];
}

/**
 * Projects an ordered path's segments into canonical form, reporting every
 * segment that changed so an approval boundary can show the rewrite rather
 * than applying it silently.
 *
 * `reservedIdentityKeys` are canonical names already claimed alongside the
 * segments being projected. Only *rewritten* segments are checked against
 * it: a segment that was already canonical and still collides is a genuine
 * duplicate in the source tree, which `destination_exists` catches at a
 * layer that can actually see the filesystem.
 */
export function projectCanonicalizedSegments(
  rawSegments: readonly string[],
  reservedIdentityKeys: Iterable<string> = [],
): CanonicalizedSegmentProjection {
  if (rawSegments.length === 0) throw new Error("repository_segments_empty");
  const reserved = new Set(reservedIdentityKeys);
  const segments: string[] = [];
  const rewritten: CanonicalizedSegmentProjection["rewritten"] = [];
  for (const [index, from] of rawSegments.entries()) {
    const to = canonicalizeRepositorySegment(from);
    if (to !== from) {
      if (reserved.has(to)) throw new Error(`repository_identity_collision:${to}`);
      rewritten.push({ from, to, index });
    }
    segments.push(to);
  }
  return { segments, rewritten };
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
