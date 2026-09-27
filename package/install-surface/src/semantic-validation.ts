import {
  assertDestination,
  assertRepositoryRelativeSource,
  sameRoot,
  segmentRelationship,
} from "./path-policy.ts";
import type { InstallSurfaceLockV1, SurfaceRecord } from "./types.ts";

const SHA256_EXPECTATION = /^sha256:[a-f0-9]{64}$/;
const COPY_FILE_MODE = /^(0644|0755)$/;

export const ALLOWED_TRANSFORM_ADAPTERS = [
  "managed-template-v1",
  "command-wrapper-v1",
] as const;

export const ALLOWED_GENERATORS = [
  "manifest-zone-v1",
  "skill-cluster-index-v1",
] as const;

export class SemanticValidationError extends Error {
  constructor(readonly codes: readonly string[]) {
    super([...new Set(codes)].sort().join(","));
    this.name = "SemanticValidationError";
  }
}

function destinationIdentity(record: SurfaceRecord): string {
  const ownership = record.destination.ownership;
  return [
    record.destination.root_token,
    ...assertDestination(record.destination),
    ownership.kind,
    ownership.marker_id ?? "",
  ].join("\u0000");
}

function validateClass(record: SurfaceRecord, errors: string[]): void {
  const hasSource = "source" in record && typeof record.source === "string";
  switch (record.class) {
    case "COPY":
      if (!hasSource || record.verification.method !== "sha256") {
        errors.push("CLASS_CONTRACT_INVALID");
      }
      break;
    case "TRANSFORM":
      if (
        !hasSource
        || record.verification.method !== "adapter"
        || !ALLOWED_TRANSFORM_ADAPTERS.some((id) => id === record.verification.adapter_id)
      ) {
        errors.push("ADAPTER_COMBINATION_UNSAFE");
      }
      break;
    case "REGENERATE":
      if (
        hasSource
        || record.verification.method !== "semantic-probe"
        || !ALLOWED_GENERATORS.some((id) => id === record.verification.generator_id)
      ) {
        errors.push("ADAPTER_COMBINATION_UNSAFE");
      }
      break;
    case "NEVER-SHIP":
      if (
        hasSource
        || !["symbolic-exclusion", "presence-only"].some((method) => method === record.verification.method)
      ) {
        errors.push("CLASS_CONTRACT_INVALID");
      }
      break;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCopyExpectation(record: SurfaceRecord, errors: string[]): void {
  const rawExpected = (record.verification as Record<string, unknown>).expected;
  if (record.class !== "COPY" && record.class !== "TRANSFORM") {
    if (rawExpected !== undefined) errors.push("COPY_EXPECTATION_INVALID");
    return;
  }
  // v1 records remain readable and compilable. Lifecycle execution decides
  // whether an expectation is required for the requested operation.
  if (rawExpected === undefined) return;
  if (!isObject(rawExpected) || typeof rawExpected.kind !== "string") {
    errors.push("COPY_EXPECTATION_INVALID");
    return;
  }
  if (rawExpected.kind === "file") {
    if (
      (Object.keys(rawExpected).length !== 2 && Object.keys(rawExpected).length !== 3)
      || typeof rawExpected.sha256 !== "string"
      || !SHA256_EXPECTATION.test(rawExpected.sha256)
      || (rawExpected.mode !== undefined && (typeof rawExpected.mode !== "string" || !COPY_FILE_MODE.test(rawExpected.mode)))
    ) {
      errors.push("COPY_EXPECTATION_INVALID");
    }
    return;
  }
  if (record.class === "TRANSFORM") {
    errors.push("TRANSFORM_SOURCE_EXPECTATION_INVALID");
    return;
  }
  if (
    rawExpected.kind !== "tree"
    || (Object.keys(rawExpected).length !== 2 && Object.keys(rawExpected).length !== 3)
    || !isObject(rawExpected.files)
    || (rawExpected.modes !== undefined && !isObject(rawExpected.modes))
  ) {
    errors.push("COPY_EXPECTATION_INVALID");
    return;
  }

  const canonicalPaths = new Set<string>();
  const canonicalDirectories = new Set<string>();
  const renderedPrefixes = new Map<string, string>();
  const entries = Object.entries(rawExpected.files);
  const modes = rawExpected.modes as Record<string, unknown> | undefined;
  if (entries.length === 0 || entries.length > 4096) {
    errors.push("COPY_EXPECTATION_INVALID");
    return;
  }
  if (modes && Object.keys(modes).length !== entries.length) errors.push("COPY_EXPECTATION_INVALID");
  for (const [path, hash] of entries) {
    let segments: readonly string[];
    try {
      segments = assertRepositoryRelativeSource(path);
    } catch {
      errors.push("COPY_EXPECTATION_INVALID");
      continue;
    }
    if (path.normalize("NFC") !== path || !SHA256_EXPECTATION.test(String(hash))) {
      errors.push("COPY_EXPECTATION_INVALID");
    }
    if (modes && (typeof modes[path] !== "string" || !COPY_FILE_MODE.test(modes[path] as string))) {
      errors.push("COPY_EXPECTATION_INVALID");
    }
    for (let index = 0; index < segments.length; index += 1) {
      const prefix = segments.slice(0, index + 1).join("/");
      const collisionKey = prefix.normalize("NFC").toLocaleLowerCase("en-US");
      const rendered = renderedPrefixes.get(collisionKey);
      if (rendered !== undefined && rendered !== prefix) errors.push("COPY_EXPECTATION_INVALID");
      renderedPrefixes.set(collisionKey, prefix);
      if (index === segments.length - 1) {
        if (canonicalPaths.has(collisionKey)) errors.push("COPY_EXPECTATION_INVALID");
        canonicalPaths.add(collisionKey);
      } else {
        canonicalDirectories.add(collisionKey);
      }
    }
  }
  for (const path of canonicalPaths) {
    if (canonicalDirectories.has(path)) errors.push("COPY_EXPECTATION_INVALID");
  }
  if (modes) {
    for (const path of Object.keys(modes)) {
      if (!Object.hasOwn(rawExpected.files, path)) errors.push("COPY_EXPECTATION_INVALID");
    }
  }
}

function validateOwnership(records: readonly SurfaceRecord[], errors: string[]): void {
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    const left = records[leftIndex];
    const leftSegments = assertDestination(left.destination);
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const right = records[rightIndex];
      if (!sameRoot(left.destination, right.destination)) continue;
      const relation = segmentRelationship(leftSegments, assertDestination(right.destination));
      if (relation === "disjoint") continue;

      // The current transaction manifest has one verified output/preimage per
      // destination. A second managed block on the same file would compile but
      // cannot be installed or rolled back as one atomic surface yet, so reject
      // it at the source boundary rather than defer a runtime collision.
      errors.push("OWNERSHIP_OVERLAP");
    }
  }
}

function validateDependencies(records: readonly SurfaceRecord[], errors: string[]): void {
  const ids = new Set(records.map((record) => record.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(records.map((record) => [record.id, record]));

  const visit = (id: string): void => {
    if (visiting.has(id)) {
      errors.push("DEPENDENCY_CYCLE");
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.depends_on ?? []) {
      if (!ids.has(dependency)) {
        errors.push("DEPENDENCY_UNKNOWN");
        continue;
      }
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of [...ids].sort()) visit(id);
}

function validateIdentityMigrations(
  records: readonly SurfaceRecord[],
  priorLock: InstallSurfaceLockV1 | undefined,
  errors: string[],
): void {
  if (!priorLock) return;
  const currentIds = new Set(records.map((record) => record.id));
  const priorByDestination = new Map(priorLock.records.map((record) => [destinationIdentity(record), record]));
  for (const record of records) {
    const prior = priorByDestination.get(destinationIdentity(record));
    if (!prior || prior.id === record.id || currentIds.has(prior.id)) continue;
    if (
      record.identity_migration?.from_id !== prior.id
      || record.identity_migration.to_id !== record.id
    ) {
      errors.push("IDENTITY_MIGRATION_REQUIRED");
    }
  }
}

export function assertSemanticValidity(
  records: readonly SurfaceRecord[],
  priorLock?: InstallSurfaceLockV1,
): void {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) errors.push("SEMANTIC_ID_DUPLICATE");
    ids.add(record.id);
    assertDestination(record.destination);
    if ("source" in record) assertRepositoryRelativeSource(record.source);
    if (record.destination.ownership.kind === "managed-block" && !record.destination.ownership.marker_id) {
      errors.push("MANAGED_BLOCK_MARKER_REQUIRED");
    }
    validateClass(record, errors);
    validateCopyExpectation(record, errors);
  }
  validateOwnership(records, errors);
  validateDependencies(records, errors);
  validateIdentityMigrations(records, priorLock, errors);
  if (errors.length > 0) throw new SemanticValidationError(errors);
}
