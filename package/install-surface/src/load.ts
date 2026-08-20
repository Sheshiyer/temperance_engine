import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { MAX_LOCK_BYTES, validateLock } from "./schema.ts";
import type { InstallSurfaceLockV1 } from "./types.ts";

export interface LoadedLock {
  lockObject: InstallSurfaceLockV1;
  canonicalBytes: string;
  digest: `sha256:${string}`;
}

export function loadLock(path: string): LoadedLock {
  const canonicalBytes = readFileSync(path, "utf8");
  if (Buffer.byteLength(canonicalBytes, "utf8") > MAX_LOCK_BYTES) {
    throw new Error("LOCK_BYTES_TOO_LARGE");
  }
  let value: unknown;
  try {
    value = JSON.parse(canonicalBytes);
  } catch {
    throw new Error("LOCK_JSON_INVALID");
  }
  if (!validateLock(value)) throw new Error("LOCK_SCHEMA_INVALID");
  const digest = `sha256:${createHash("sha256").update(canonicalBytes, "utf8").digest("hex")}` as const;
  return { lockObject: value, canonicalBytes, digest };
}
