import {
  assertDestination,
  assertRepositoryRelativeSource,
  sameRoot,
  segmentRelationship,
} from "./path-policy.ts";
import type { InstallSurfaceLockV1, SurfaceRecord } from "./types.ts";

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

function validateOwnership(records: readonly SurfaceRecord[], errors: string[]): void {
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    const left = records[leftIndex];
    const leftSegments = assertDestination(left.destination);
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const right = records[rightIndex];
      if (!sameRoot(left.destination, right.destination)) continue;
      const relation = segmentRelationship(leftSegments, assertDestination(right.destination));
      if (relation === "disjoint") continue;

      const leftOwnership = left.destination.ownership;
      const rightOwnership = right.destination.ownership;
      const validSharedManagedBlock = relation === "equal"
        && leftOwnership.kind === "managed-block"
        && rightOwnership.kind === "managed-block"
        && Boolean(leftOwnership.marker_id)
        && Boolean(rightOwnership.marker_id)
        && leftOwnership.marker_id !== rightOwnership.marker_id
        && left.class === "TRANSFORM"
        && right.class === "TRANSFORM";
      if (!validSharedManagedBlock) errors.push("OWNERSHIP_OVERLAP");
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
  }
  validateOwnership(records, errors);
  validateDependencies(records, errors);
  validateIdentityMigrations(records, priorLock, errors);
  if (errors.length > 0) throw new SemanticValidationError(errors);
}
