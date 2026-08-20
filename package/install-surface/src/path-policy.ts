import { isAbsolute } from "node:path";

import type { InstallDestination } from "./types.ts";

export const ALLOWED_ROOT_TOKENS = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "HOME",
  "TEMPERANCE_STATE",
] as const;

export type RootToken = (typeof ALLOWED_ROOT_TOKENS)[number];

export class PathPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PathPolicyError";
  }
}

function assertRelativeSegments(value: string, code: string): readonly string[] {
  if (
    !value
    || value !== value.normalize("NFC")
    || value.includes("\\")
    || value.includes("\0")
    || isAbsolute(value)
  ) {
    throw new PathPolicyError(code);
  }

  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new PathPolicyError(code);
  }
  return segments;
}

export function assertRepositoryRelativeSource(path: string): readonly string[] {
  return assertRelativeSegments(path, "SOURCE_PATH_INVALID");
}

export function assertDestination(dest: InstallDestination): readonly string[] {
  if (!ALLOWED_ROOT_TOKENS.some((token) => token === dest.root_token)) {
    throw new PathPolicyError("DESTINATION_ROOT_UNKNOWN");
  }
  return assertRelativeSegments(dest.relative_path, "DESTINATION_PATH_INVALID");
}

export function sameRoot(left: InstallDestination, right: InstallDestination): boolean {
  return left.root_token === right.root_token;
}

export function segmentRelationship(
  left: readonly string[],
  right: readonly string[],
): "equal" | "ancestor" | "descendant" | "disjoint" {
  const common = Math.min(left.length, right.length);
  for (let index = 0; index < common; index += 1) {
    if (left[index] !== right[index]) return "disjoint";
  }
  if (left.length === right.length) return "equal";
  return left.length < right.length ? "ancestor" : "descendant";
}
