import { createHash } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";

import defaultDenyPolicy from "../deny-policy.v1.json" with { type: "json" };
import { assertAuthority, type AuthorityInputs } from "./authority.ts";
import { canonical } from "./canonical-json.ts";
import { assertDenyPolicy, type DenyPolicy } from "./deny-policy.ts";
import { MAX_FRAGMENT_BYTES, validateFragment, validateLock } from "./schema.ts";
import { assertSemanticValidity } from "./semantic-validation.ts";
import {
  LOCK_SCHEMA,
  type InstallSurfaceLockV1,
  type SurfaceRecord,
} from "./types.ts";

export interface FragmentInput {
  name: string;
  contents: string;
}

export interface CompileOptions extends AuthorityInputs {
  denyPolicy?: DenyPolicy;
  priorLock?: InstallSurfaceLockV1;
}

export interface CompileResult {
  lockObject: InstallSurfaceLockV1;
  canonicalBytes: string;
  digest: `sha256:${string}`;
  semanticIds: string[];
}

export class CompileError extends Error {
  constructor(readonly code: string, readonly fragmentName?: string) {
    super(fragmentName ? `${code}:${fragmentName}` : code);
    this.name = "CompileError";
  }
}

function stringOrder(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function normalizeRecord(record: SurfaceRecord): SurfaceRecord {
  const normalized = {
    ...record,
    authority: {
      ...record.authority,
      requirement_ids: [...record.authority.requirement_ids].sort(stringOrder),
    },
    eligibility: {
      ...record.eligibility,
      platforms: [...record.eligibility.platforms].sort(stringOrder),
      profiles: [...record.eligibility.profiles].sort(stringOrder),
    },
  } as SurfaceRecord;
  if (record.depends_on) normalized.depends_on = [...record.depends_on].sort(stringOrder);
  return normalized;
}

function parseFragment(input: FragmentInput): SurfaceRecord[] {
  if (Buffer.byteLength(input.contents, "utf8") > MAX_FRAGMENT_BYTES) {
    throw new CompileError("MANIFEST_FRAGMENT_TOO_LARGE", input.name);
  }
  let value: unknown;
  try {
    value = JSON.parse(input.contents);
  } catch {
    throw new CompileError("MANIFEST_JSON_INVALID", input.name);
  }
  if (!validateFragment(value)) throw new CompileError("MANIFEST_SCHEMA_INVALID", input.name);
  return value.records;
}

export function compileFragments(
  inputs: readonly FragmentInput[],
  options: CompileOptions,
): CompileResult {
  const records = inputs.flatMap(parseFragment).map(normalizeRecord);
  assertSemanticValidity(records, options.priorLock);
  assertDenyPolicy(records, options.denyPolicy ?? defaultDenyPolicy as DenyPolicy);
  assertAuthority(records, options);

  const lockObject: InstallSurfaceLockV1 = {
    schema: LOCK_SCHEMA,
    schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1",
    version: { major: 1, minor: 0 },
    records: [...records].sort((left, right) => stringOrder(left.id, right.id)),
  };
  if (!validateLock(lockObject)) throw new CompileError("COMPILED_LOCK_SCHEMA_INVALID");
  const canonicalBytes = canonical(lockObject);
  const digest = `sha256:${createHash("sha256").update(canonicalBytes, "utf8").digest("hex")}` as const;
  return {
    lockObject,
    canonicalBytes,
    digest,
    semanticIds: lockObject.records.map((record) => record.id),
  };
}

export function writeLock(path: string, canonicalBytes: string): void {
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, canonicalBytes, { encoding: "utf8", flag: "wx", mode: 0o644 });
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temp file may not have been created; preserve the original error.
    }
    throw error;
  }
}
