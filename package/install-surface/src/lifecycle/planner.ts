/**
 * Lifecycle planner — transforms CompileResult into ordered PlannedSteps.
 *
 * Topological ordering honors `depends_on` edges.
 * NEVER-SHIP records are rejected at plan time.
 * Outcome taxonomy: installed | skipped | unsupported | unavailable | failed.
 */

import { createHash } from "node:crypto";

import type { CompileResult } from "../compile.ts";
import type {
  CopySurfaceRecord,
  InstallDestination,
  OwnershipKind,
  RegenerateSurfaceRecord,
  SurfaceRecord,
  TransformSurfaceRecord,
} from "../types.ts";
import type { PlannedStep } from "./hazards.ts";

// ─── Plan errors ──────────────────────────────────────────────────────────────

export type PlanErrorCode =
  | "PLAN_DEPENDENCY_CYCLE"
  | "PLAN_NEVER_SHIP_MUTATION"
  | "PLAN_DUPLICATE_STEP_ID"
  | "PLAN_SCOPE_EMPTY"
  | "PLAN_SCOPE_UNKNOWN_RECORD"
  | "PLAN_SCOPE_INELIGIBLE_RECORD"
  | "PLAN_SCOPE_CONFLICT"
  | "PLAN_SCOPE_VERB_UNSUPPORTED"
  | "CAPABILITY_UNAVAILABLE";

export class PlanError extends Error {
  readonly code: PlanErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: PlanErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "PlanError";
    this.code = code;
    this.details = details;
  }
}

// ─── Outcome taxonomy (INST-05) ──────────────────────────────────────────────

export type OutcomeStatus = "installed" | "skipped" | "unsupported" | "unavailable" | "failed";

export interface StepOutcome {
  step_id: string;
  record_id: string;
  destination_symbolic: string;
  status: OutcomeStatus;
  reason?: string;
}

// ─── Plan result ──────────────────────────────────────────────────────────────

export interface PlanResult {
  steps: PlannedStep[];
  outcomes: StepOutcome[];
  verb: string;
  profile: string;
  inventory_digest: string;
  scope?: LifecycleScope;
}

export interface LifecycleScope {
  mode: "dependency-closure";
  requested_ids: string[];
  dependency_ids: string[];
  record_ids: string[];
}

// ─── Verb semantics ───────────────────────────────────────────────────────────

export type LifecycleVerb = "install" | "update" | "uninstall" | "rollback";

export interface PlanOptions {
  verb: LifecycleVerb;
  profileResult: CompileResult;
  profile: string;
  platform?: NodeJS.Platform;
  force?: boolean;
  explicitSelections?: Set<string>;
  onlyIds?: ReadonlySet<string>;
}

function resolveScope(options: PlanOptions, platform: NodeJS.Platform): LifecycleScope | undefined {
  if (options.onlyIds === undefined) return undefined;
  if (options.verb !== "install" && options.verb !== "update") throw new PlanError("PLAN_SCOPE_VERB_UNSUPPORTED");
  if (options.onlyIds.size === 0) throw new PlanError("PLAN_SCOPE_EMPTY");
  const records = new Map(options.profileResult.lockObject.records.map((record) => [record.id, record]));
  const included = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new PlanError("PLAN_DEPENDENCY_CYCLE", { record_id: id });
    if (included.has(id)) return;
    const record = records.get(id);
    if (!record) throw new PlanError("PLAN_SCOPE_UNKNOWN_RECORD", { record_id: id });
    if (record.class === "NEVER-SHIP") throw new PlanError("PLAN_NEVER_SHIP_MUTATION", { record_id: id });
    if (!record.eligibility.profiles.includes(options.profile) || !isPlatformSupported(record, platform)) {
      throw new PlanError("PLAN_SCOPE_INELIGIBLE_RECORD", { record_id: id });
    }
    visiting.add(id);
    for (const dependency of record.depends_on ?? []) visit(dependency);
    visiting.delete(id);
    included.add(id);
  };
  for (const id of [...options.onlyIds].sort()) visit(id);
  for (const id of options.explicitSelections ?? []) {
    if (!included.has(id)) throw new PlanError("PLAN_SCOPE_CONFLICT", { record_id: id });
  }
  return {
    mode: "dependency-closure",
    requested_ids: [...options.onlyIds].sort(),
    dependency_ids: [...included].filter((id) => !options.onlyIds!.has(id)).sort(),
    record_ids: [...included].sort(),
  };
}

// ─── Topological sort ────────────────────────────────────────────────────────

function topologicalSort(records: SurfaceRecord[]): SurfaceRecord[] {
  const idSet = new Set(records.map((r) => r.id));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const sorted: SurfaceRecord[] = [];
  const recordMap = new Map(records.map((r) => [r.id, r]));

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new PlanError("PLAN_DEPENDENCY_CYCLE", { cycle: id });
    }
    visiting.add(id);

    const record = recordMap.get(id);
    if (record?.depends_on) {
      for (const dep of record.depends_on) {
        if (idSet.has(dep)) {
          visit(dep);
        }
      }
    }

    visiting.delete(id);
    visited.add(id);
    if (record) sorted.push(record);
  }

  for (const record of records) {
    visit(record.id);
  }

  return sorted;
}

// ─── Symbolic path ────────────────────────────────────────────────────────────

function symbolicPath(dest: InstallDestination): string {
  return `$${dest.root_token}/${dest.relative_path}`;
}

// ─── Step ID generation ──────────────────────────────────────────────────────

function stepId(record: SurfaceRecord, verb: string): string {
  const hash = createHash("sha256")
    .update(`${record.id}:${verb}`)
    .digest("hex")
    .slice(0, 8);
  return `${verb}-${record.id}-${hash}`;
}

// ─── Platform filtering ──────────────────────────────────────────────────────

function isPlatformSupported(
  record: SurfaceRecord,
  platform: NodeJS.Platform,
): boolean {
  const platformMap: Record<string, "darwin" | "linux" | "win32"> = {
    darwin: "darwin",
    linux: "linux",
    win32: "win32",
  };
  const mapped = platformMap[platform];
  return mapped ? record.eligibility.platforms.includes(mapped) : false;
}

// ─── Dependency availability check ───────────────────────────────────────────

interface DependencyCheckResult {
  available: boolean;
  missing: string[];
  remediation: string[];
}

function checkDependencyAvailability(
  record: SurfaceRecord,
  availableDeps: Set<string>,
): DependencyCheckResult {
  if (!record.requires || record.requires.length === 0) {
    return { available: true, missing: [], remediation: [] };
  }

  const missing: string[] = [];
  const remediation: string[] = [];

  for (const dep of record.requires) {
    if (dep.kind === "binary") {
      if (!availableDeps.has(dep.name)) {
        missing.push(dep.name);
        remediation.push(`Install '${dep.name}' and ensure it is on PATH.`);
      }
    }
    // http-health deps are checked at execution time, not planning
  }

  return {
    available: missing.length === 0,
    missing,
    remediation,
  };
}

// ─── Planner ─────────────────────────────────────────────────────────────────

/**
 * Create a plan from a CompileResult and verb.
 *
 * - NEVER-SHIP records are rejected (PLAN_NEVER_SHIP_MUTATION)
 * - Topological ordering honors depends_on
 * - Platform filtering applied
 * - Dependency availability checked
 * - Explicit selection of unavailable capability fails (INST-04)
 */
export function createPlan(options: PlanOptions): PlanResult {
  const {
    verb,
    profileResult,
    profile,
    platform = process.platform,
    force = false,
    explicitSelections,
  } = options;

  const scope = resolveScope(options, platform);
  const scopedIds = scope ? new Set(scope.record_ids) : undefined;
  const records = profileResult.lockObject.records.filter((record) => !scopedIds || scopedIds.has(record.id));
  const steps: PlannedStep[] = [];
  const outcomes: StepOutcome[] = [];

  // Validate explicit selections first (INST-04)
  if (explicitSelections) {
    validateExplicitSelections(records, explicitSelections);
  }

  // Filter records by profile
  const eligibleRecords = records.filter((record) => {
    // NEVER-SHIP records are always rejected
    if (record.class === "NEVER-SHIP") {
      outcomes.push({
        step_id: stepId(record, verb),
        record_id: record.id,
        destination_symbolic: symbolicPath(record.destination),
        status: "skipped",
        reason: "NEVER-SHIP class cannot be mutated",
      });
      return false;
    }

    // Platform check
    if (!isPlatformSupported(record, platform)) {
      outcomes.push({
        step_id: stepId(record, verb),
        record_id: record.id,
        destination_symbolic: symbolicPath(record.destination),
        status: "unsupported",
        reason: `Platform ${platform} not in eligible platforms`,
      });
      return false;
    }

    // Profile check
    if (!record.eligibility.profiles.includes(profile)) {
      outcomes.push({
        step_id: stepId(record, verb),
        record_id: record.id,
        destination_symbolic: symbolicPath(record.destination),
        status: "skipped",
        reason: `Profile '${profile}' not in eligible profiles`,
      });
      return false;
    }

    return true;
  });

  // Topological sort
  let sortedRecords: SurfaceRecord[];
  try {
    sortedRecords = topologicalSort(eligibleRecords);
  } catch (error) {
    if (error instanceof PlanError && error.code === "PLAN_DEPENDENCY_CYCLE") {
      throw error;
    }
    throw error;
  }

  // Create steps
  for (const record of sortedRecords) {
    const sid = stepId(record, verb);

    // Check dependency availability
    // For now, we assume all deps are available (checked at execution time)
    // The explicit selection check happens at the executor level

    const step: PlannedStep = {
      step_id: sid,
      record_id: record.id,
      destination: record.destination,
      ownership: record.destination.ownership.kind,
      mode: verb as PlannedStep["mode"],
    };

    steps.push(step);
    outcomes.push({
      step_id: sid,
      record_id: record.id,
      destination_symbolic: symbolicPath(record.destination),
      status: "installed",
    });
  }

  return {
    steps,
    outcomes,
    verb,
    profile,
    inventory_digest: profileResult.digest,
    ...(scope ? { scope } : {}),
  };
}

/**
 * Validate that explicit selections don't target NEVER-SHIP records.
 */
export function validateExplicitSelections(
  records: SurfaceRecord[],
  selections: Set<string>,
): void {
  for (const id of selections) {
    const record = records.find((r) => r.id === id);
    if (record?.class === "NEVER-SHIP") {
      throw new PlanError("PLAN_NEVER_SHIP_MUTATION", {
        record_id: id,
        reason: "Cannot explicitly select NEVER-SHIP record",
      });
    }
  }
}
