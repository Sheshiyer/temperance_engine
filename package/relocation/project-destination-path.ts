/**
 * Pure projection from a vault-relative candidate path to its canonical
 * destination path.
 *
 * This module is the single place that decides the *shape* of a relocated
 * project's destination. It has no filesystem, Git, registry, or network
 * seam — it neither reads nor creates anything; callers that can see the
 * filesystem remain responsible for collision and device checks.
 *
 * Shape: `<destinationRoot>/<portfolio>/<candidate path relative to the
 * portfolio's source root>`, each segment canonicalized.
 *
 * Mirroring the source-relative path is what preserves the tenant grouping.
 * The previous rule used only the candidate's basename, which flattened
 * every nested repository into a sibling of every standalone one — so all
 * 12 `klear-karma` repos and all 11 `Tirak` repos would have lost their
 * container. A depth-0 candidate has no container segment, so its
 * destination under this rule is byte-identical to the old rule's; that is
 * what keeps the already-relocated canary in place.
 */

import { isAbsolute, resolve, sep } from "node:path";

import {
  isCanonicalRepositoryBasename,
  projectCanonicalizedSegments,
  type CanonicalizedSegmentProjection,
} from "./project-relocation-grammar";

export interface DestinationProjectionInput {
  destinationRoot: string;
  portfolio: string;
  sourceRoot: string;
  sourcePath: string;
  /** Canonical names already claimed beside these segments. */
  reservedIdentityKeys?: Iterable<string>;
}

export interface DestinationProjection {
  destination: string;
  /** Raw, on-disk segments relative to the portfolio source root. */
  sourceSegments: string[];
  /** Canonicalized counterparts, in the same order. */
  relativeSegments: string[];
  /** Container path above the repository, canonical; null at depth 0. */
  tenant: string | null;
  /** Every segment canonicalization changed, for the approval boundary. */
  rewritten: CanonicalizedSegmentProjection["rewritten"];
}

/**
 * Containment test on resolved path segments rather than string prefixes, so
 * a sibling root that merely shares a prefix (`…/thoughtseed-labs` against
 * `…/thoughtseed`) is correctly rejected.
 */
function relativeSegmentsWithin(sourceRoot: string, sourcePath: string): string[] {
  const rootSegments = resolve(sourceRoot).split(sep).filter(Boolean);
  const pathSegments = resolve(sourcePath).split(sep).filter(Boolean);
  if (pathSegments.length <= rootSegments.length) return [];
  for (const [index, segment] of rootSegments.entries()) {
    if (pathSegments[index] !== segment) return [];
  }
  return pathSegments.slice(rootSegments.length);
}

export function projectDestinationPath(input: DestinationProjectionInput): DestinationProjection {
  if (!isAbsolute(input.destinationRoot)) throw new Error("destination_root_not_absolute");
  if (!isAbsolute(input.sourceRoot)) throw new Error("source_root_not_absolute");
  if (!isCanonicalRepositoryBasename(input.portfolio)) {
    throw new Error(`portfolio_not_canonical:${JSON.stringify(input.portfolio)}`);
  }

  const sourceSegments = relativeSegmentsWithin(input.sourceRoot, input.sourcePath);
  if (sourceSegments.length === 0) {
    throw new Error(`source_not_under_source_root:${JSON.stringify(input.sourcePath)}`);
  }

  const { segments, rewritten } = projectCanonicalizedSegments(
    sourceSegments,
    input.reservedIdentityKeys ?? [],
  );

  const containerSegments = segments.slice(0, -1);
  return {
    destination: [resolve(input.destinationRoot), input.portfolio, ...segments].join("/"),
    sourceSegments,
    relativeSegments: segments,
    tenant: containerSegments.length === 0 ? null : containerSegments.join("/"),
    rewritten,
  };
}
