/**
 * Machine-independent path aliasing for artifacts that get committed.
 *
 * Records, closure manifests, and registry entries are committed to public
 * repositories. Absolute paths in them publish the operator's drive name and
 * vault layout, and they break the moment the vault is mounted anywhere
 * else. Both problems have the same fix: store `$VAULT/...` / `$PROJECTS/...`
 * and resolve the real roots locally.
 *
 * Pure: no filesystem, Git, or network seam. Resolution is string-level and
 * segment-aware, so it never touches disk and never depends on what happens
 * to exist.
 *
 * NOTE ON SCOPE: this prevents *new* disclosure. It does not undo what is
 * already committed -- the absolute roots appear in tracked source and plan
 * docs across public repositories, which is a separate remediation.
 */

import { isAbsolute } from "node:path";

export interface PortablePathRoots {
  vault: string;
  projects: string;
}

const ALIAS_BY_ROOT_KEY = {
  vault: "$VAULT",
  projects: "$PROJECTS",
} as const;

type RootKey = keyof PortablePathRoots;

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** Segment-aware containment, so `twc-vault-archive` never matches `twc-vault`. */
function relativeIfWithin(root: string, path: string): string | null {
  const rootSegments = segments(root);
  const pathSegments = segments(path);
  if (pathSegments.length < rootSegments.length) return null;
  for (const [index, segment] of rootSegments.entries()) {
    if (pathSegments[index] !== segment) return null;
  }
  return pathSegments.slice(rootSegments.length).join("/");
}

export function toPortablePath(absolutePath: string, roots: PortablePathRoots): string {
  if (!isAbsolute(absolutePath)) throw new Error(`path_not_absolute:${JSON.stringify(absolutePath)}`);

  // Longest root first, so a root nested inside another still wins.
  const ordered = (Object.keys(ALIAS_BY_ROOT_KEY) as RootKey[]).sort(
    (a, b) => segments(roots[b]).length - segments(roots[a]).length,
  );

  for (const key of ordered) {
    const rest = relativeIfWithin(roots[key], absolutePath);
    if (rest === null) continue;
    return rest === "" ? ALIAS_BY_ROOT_KEY[key] : `${ALIAS_BY_ROOT_KEY[key]}/${rest}`;
  }
  throw new Error(`path_not_under_any_portable_root:${JSON.stringify(absolutePath)}`);
}

export function fromPortablePath(portablePath: string, roots: PortablePathRoots): string {
  if (!portablePath.startsWith("$")) {
    throw new Error(`portable_path_missing_alias:${JSON.stringify(portablePath)}`);
  }
  const slash = portablePath.indexOf("/");
  const alias = slash === -1 ? portablePath : portablePath.slice(0, slash);
  const rest = slash === -1 ? "" : portablePath.slice(slash + 1);

  for (const key of Object.keys(ALIAS_BY_ROOT_KEY) as RootKey[]) {
    if (ALIAS_BY_ROOT_KEY[key] !== alias) continue;
    return rest === "" ? roots[key] : `${roots[key]}/${rest}`;
  }
  throw new Error(`unknown_portable_alias:${alias}`);
}
