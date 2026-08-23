/**
 * Hazard preflight and drift refusal for transactional lifecycle (SAFE-03/05/06, LIFE-06, INST-03).
 *
 * Preflight over the PLANNED step list before journal BEGIN:
 *   - assertDestination then lstat-probe for symlink, hardlink, parent-swap, wrong path type
 *   - Per-step re-check immediately before each mutation (TOCTOU closure)
 *   - Drift refusal: unrecognized drift on exclusive-path destination → OWNERSHIP_AMBIGUOUS
 *   - Removal enumeration: remove ONLY paths enumerated in verified record destinations
 *   - Traversal bound: plan-time rejection of records carrying `..`, absolute, or provider-cache-shaped paths
 *   - Dependency preflight: checks `requires` declarations before journal BEGIN
 *
 * All IO through LifecycleIO seam for testability.
 */

import { isAbsolute } from "node:path";

import { assertDestination, segmentRelationship } from "../path-policy.ts";
import type {
  InstallDestination,
  OwnershipKind,
  RuntimeDependency,
  SurfaceRecord,
} from "../types.ts";
import type { LifecycleIO } from "./journal.ts";

// ─── Hazard codes ─────────────────────────────────────────────────────────────

export type HazardCode =
  | "DEST_SYMLINK"
  | "DEST_HARDLINK"
  | "PARENT_SWAP"
  | "PATH_TYPE_CONFLICT"
  | "OWNERSHIP_AMBIGUOUS"
  | "DEPENDENCY_MISSING"
  | "TRAVERSAL_BOUND"
  | "ANCESTOR_CONFLICT";

export class HazardError extends Error {
  readonly code: HazardCode;
  readonly details: Record<string, unknown>;

  constructor(code: HazardCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "HazardError";
    this.code = code;
    this.details = details;
  }
}

// ─── Step representation ──────────────────────────────────────────────────────

export interface PlannedStep {
  step_id: string;
  record_id: string;
  destination: InstallDestination;
  ownership: OwnershipKind;
  mode: "install" | "update" | "uninstall" | "rollback";
}

// ─── Traversal bound (SAFE-03) ────────────────────────────────────────────────

/** Provider-cache-shaped path patterns that must be rejected. */
const PROVIDER_CACHE_PATTERNS = [
  "node_modules/",
  ".cache/",
  "__pycache__/",
  ".npm/",
  ".yarn/",
  "vendor/",
];

/**
 * Plan-time rejection of records carrying `..`, absolute, or provider-cache-shaped
 * relative paths. Called BEFORE any other checks.
 */
export function assertTraversalBound(record: SurfaceRecord): void {
  const rel = record.destination.relative_path;

  // Absolute paths are always forbidden
  if (isAbsolute(rel)) {
    throw new HazardError("TRAVERSAL_BOUND", {
      record_id: record.id,
      path: rel,
      reason: "absolute path",
    });
  }

  // `..` segments are forbidden
  if (rel.split("/").some((seg) => seg === "..")) {
    throw new HazardError("TRAVERSAL_BOUND", {
      record_id: record.id,
      path: rel,
      reason: "parent traversal (..)",
    });
  }

  // Provider-cache-shaped paths
  for (const pattern of PROVIDER_CACHE_PATTERNS) {
    if (rel.startsWith(pattern) || rel.includes(`/${pattern}`)) {
      throw new HazardError("TRAVERSAL_BOUND", {
        record_id: record.id,
        path: rel,
        reason: `provider-cache path (${pattern})`,
      });
    }
  }
}

// ─── Destination hazard probe ─────────────────────────────────────────────────

/**
 * Probe a destination path for hazards: symlink, hardlink, parent-swap, path-type conflict.
 * Uses assertDestination from path-policy first, then lstat-probes.
 *
 * @param resolveRoot - function that maps root_token to an absolute path
 */
export async function probeDestination(
  step: PlannedStep,
  resolveRoot: (token: string) => string,
  io: LifecycleIO,
): Promise<void> {
  // Validate destination structure via path-policy
  assertDestination(step.destination);

  const rootPath = resolveRoot(step.destination.root_token);
  const fullPath = `${rootPath}/${step.destination.relative_path}`;

  // Check for symlink at the destination itself
  try {
    const stat = await io.lstat(fullPath);
    if (stat.isSymbolicLink()) {
      throw new HazardError("DEST_SYMLINK", {
        step_id: step.step_id,
        path: fullPath,
      });
    }
    // PATH_TYPE_CONFLICT: expecting to write a file but found a directory (or vice versa)
    // Check before hardlink — directories always have nlink >= 2
    if (stat.isDirectory() && step.mode !== "uninstall") {
      throw new HazardError("PATH_TYPE_CONFLICT", {
        step_id: step.step_id,
        path: fullPath,
        expected: "file",
        actual: "directory",
      });
    }
    // Hardlink check: only for files (directories have nlink >= 2 due to . and ..)
    if (!stat.isDirectory() && stat.nlink > 1) {
      throw new HazardError("DEST_HARDLINK", {
        step_id: step.step_id,
        path: fullPath,
        nlink: stat.nlink,
      });
    }
  } catch (error) {
    // ENOENT is fine — destination doesn't exist yet
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      // ok
    } else if (error instanceof HazardError) {
      throw error;
    } else {
      // Unexpected error — fail closed
      throw new HazardError("PATH_TYPE_CONFLICT", {
        step_id: step.step_id,
        path: fullPath,
        reason: "lstat failed",
      });
    }
  }

  // Check parent directory for symlink (parent-swap risk)
  const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
  if (parentPath && parentPath !== rootPath) {
    try {
      const parentStat = await io.lstat(parentPath);
      if (parentStat.isSymbolicLink()) {
        throw new HazardError("PARENT_SWAP", {
          step_id: step.step_id,
          path: fullPath,
          parent: parentPath,
        });
      }
    } catch (error) {
      if (error instanceof HazardError) throw error;
      // ENOENT for parent is acceptable — will be created
    }
  }
}

// ─── TOCTOU re-check ─────────────────────────────────────────────────────────

/**
 * Per-step re-check immediately before each mutation (TOCTOU closure).
 * Same logic as probeDestination but intended to be called right before write.
 */
export async function recheckBeforeMutation(
  step: PlannedStep,
  resolveRoot: (token: string) => string,
  io: LifecycleIO,
): Promise<void> {
  await probeDestination(step, resolveRoot, io);
}

// ─── Ancestor conflict check ─────────────────────────────────────────────────

/**
 * Reject a step whose destination is an ancestor of another record's destination
 * without a declared dependency edge. Prevents accidental destruction of nested content.
 */
export function assertNoAncestorConflict(steps: PlannedStep[]): void {
  for (let i = 0; i < steps.length; i++) {
    for (let j = 0; j < steps.length; j++) {
      if (i === j) continue;
      const a = steps[i];
      const b = steps[j];
      if (a.destination.root_token !== b.destination.root_token) continue;

      const segsA = a.destination.relative_path.split("/");
      const segsB = b.destination.relative_path.split("/");
      const rel = segmentRelationship(segsA, segsB);

      if (rel === "ancestor" && a.mode === "uninstall") {
        // Step A would remove a directory that contains step B's destination
        throw new HazardError("ANCESTOR_CONFLICT", {
          step_id: a.step_id,
          ancestor_path: a.destination.relative_path,
          descendant_step: b.step_id,
          descendant_path: b.destination.relative_path,
          reason: "uninstall step is ancestor of another record destination without dependency edge",
        });
      }
    }
  }
}

// ─── Drift refusal (LIFE-06) ─────────────────────────────────────────────────

/**
 * For update/uninstall/rollback on exclusive-path destinations:
 * compare destination bytes against the pre-image recorded in the referenced
 * transaction AND the expected managed content.
 *
 * If the file differs from everything we can account for → refuse with
 * OWNERSHIP_AMBIGUOUS listing the drifted paths.
 *
 * Managed-block destinations refuse only when drift exists OUTSIDE the block.
 */
export async function checkDrift(
  step: PlannedStep,
  resolveRoot: (token: string) => string,
  io: LifecycleIO,
  opts: {
    preimageBytes?: Uint8Array | null;
    expectedBytes?: Uint8Array | null;
  },
): Promise<void> {
  if (step.ownership !== "exclusive-path") {
    // Managed-block: drift check is deferred to block-range comparison
    return;
  }

  const rootPath = resolveRoot(step.destination.root_token);
  const fullPath = `${rootPath}/${step.destination.relative_path}`;

  let currentBytes: Uint8Array;
  try {
    const content = await io.readFile(fullPath);
    currentBytes = new TextEncoder().encode(content);
  } catch {
    // File doesn't exist — no drift possible
    return;
  }

  // Compare against pre-image
  const matchesPreimage =
    opts.preimageBytes != null && buffersEqual(currentBytes, opts.preimageBytes);

  // Compare against expected managed content
  const matchesExpected =
    opts.expectedBytes != null && buffersEqual(currentBytes, opts.expectedBytes);

  if (!matchesPreimage && !matchesExpected) {
    throw new HazardError("OWNERSHIP_AMBIGUOUS", {
      step_id: step.step_id,
      path: fullPath,
      reason: "destination differs from both pre-image and expected content",
    });
  }
}

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─── Removal enumeration (SAFE-06) ───────────────────────────────────────────

/**
 * Validate that removal steps target ONLY paths enumerated in verified record
 * destinations. Never performs directory scans — takes paths from records only.
 *
 * Returns the list of validated absolute paths to remove.
 */
export async function enumerateRemovals(
  steps: PlannedStep[],
  resolveRoot: (token: string) => string,
): Promise<string[]> {
  const removals: string[] = [];
  for (const step of steps) {
    if (step.mode !== "uninstall") continue;
    assertDestination(step.destination);
    const rootPath = resolveRoot(step.destination.root_token);
    removals.push(`${rootPath}/${step.destination.relative_path}`);
  }
  return removals;
}

// ─── Dependency preflight (INST-03) ──────────────────────────────────────────

/**
 * Check runtime dependencies declared in record `requires` fields.
 * Fails with DEPENDENCY_MISSING + remediation text BEFORE journal BEGIN.
 *
 * - http-health: probes URL token via injectable fetch (HEAD request)
 * - binary: checks command exists on PATH via injectable execFile
 *
 * Doctor v2 host section (Plan 03-01) derives its probes FROM these
 * declarations rather than duplicating them — see spec §3.2 derivation table.
 */
export async function checkDependencies(
  records: SurfaceRecord[],
  resolveRoot: (token: string) => string,
  io: LifecycleIO,
  signal: AbortSignal,
): Promise<void> {
  for (const record of records) {
    if (!record.requires || record.requires.length === 0) continue;

    for (const dep of record.requires) {
      await checkSingleDependency(record.id, dep, resolveRoot, io, signal);
    }
  }
}

async function checkSingleDependency(
  recordId: string,
  dep: RuntimeDependency,
  resolveRoot: (token: string) => string,
  io: LifecycleIO,
  signal: AbortSignal,
): Promise<void> {
  if (dep.kind === "binary") {
    try {
      const result = await io.execFile("which", [dep.name], { signal });
      if (result.exitCode !== 0) {
        throw new HazardError("DEPENDENCY_MISSING", {
          record_id: recordId,
          dependency: dep,
          remediation: `Install '${dep.name}' and ensure it is on PATH.`,
        });
      }
    } catch (error) {
      if (error instanceof HazardError) throw error;
      throw new HazardError("DEPENDENCY_MISSING", {
        record_id: recordId,
        dependency: dep,
        remediation: `Install '${dep.name}' and ensure it is on PATH.`,
      });
    }
    return;
  }

  if (dep.kind === "http-health") {
    const url = resolveRoot(dep.url_token);
    try {
      const response = await io.fetch(url, { signal });
      if (!response.ok) {
        throw new HazardError("DEPENDENCY_MISSING", {
          record_id: recordId,
          dependency: dep,
          remediation: `HTTP health check failed for ${dep.url_token} (status ${response.status}). Ensure the service is running.`,
        });
      }
    } catch (error) {
      if (error instanceof HazardError) throw error;
      throw new HazardError("DEPENDENCY_MISSING", {
        record_id: recordId,
        dependency: dep,
        remediation: `Cannot reach ${dep.url_token} at ${url}. Ensure the service is running and accessible.`,
      });
    }
  }
}

// ─── Full preflight ───────────────────────────────────────────────────────────

/**
 * Run the complete hazard preflight over a planned step list.
 * Called BEFORE journal BEGIN — machine untouched on failure.
 *
 * Checks in order:
 * 1. Traversal bound (SAFE-03)
 * 2. Destination hazards (symlink, hardlink, parent-swap, path-type)
 * 3. Ancestor conflicts
 * 4. Dependency preflight (INST-03)
 */
export async function preflight(
  steps: PlannedStep[],
  records: SurfaceRecord[],
  resolveRoot: (token: string) => string,
  io: LifecycleIO,
  signal: AbortSignal,
): Promise<void> {
  // 1. Traversal bound
  for (const record of records) {
    assertTraversalBound(record);
  }

  // 2. Destination hazards
  for (const step of steps) {
    await probeDestination(step, resolveRoot, io);
  }

  // 3. Ancestor conflicts
  assertNoAncestorConflict(steps);

  // 4. Dependency preflight
  await checkDependencies(records, resolveRoot, io, signal);
}
