/**
 * Lifecycle executor — executes planned steps with journaling and atomic promotion.
 *
 * Ordering per step: hazards → journal.STAGE → stage → verify → journal.COMMIT_STEP → promote.
 * Preimage of displaced bytes → preimage/<step_id>.
 * Verify failure mid-run: ABORT, staged removed, preimages intact, exit 1.
 */

import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { prepareCopies, captureCopyManifest, assertCopyPrior, declaredCopyHashesForSteps, loadCopyManifest, rollbackCopies, safePath, sha256, type CopyManifest } from "./copy-tree.ts";
import { prepareNonCopy, producerAvailability } from "./non-copy.ts";
import {
  assertSurfacePrior,
  captureSurfaceManifest,
  loadSurfaceManifest,
  rollbackSurface,
  verifySurfaceOutput,
  type PreparedSurface,
  type SurfaceManifest,
} from "./prepared-surface.ts";

import type { CompileResult } from "../compile.ts";
import type { SurfaceRecord } from "../types.ts";
import { assertDestination } from "../path-policy.ts";
import {
  type PlannedStep,
  preflight,
  recheckBeforeMutation,
  HazardError,
} from "./hazards.ts";
import {
  Journal,
  generateTxId,
  type LifecycleIO,
  type JournalEntry,
} from "./journal.ts";
import { createPlan, type PlanResult, type PlanOptions, type StepOutcome } from "./planner.ts";
import { writeReceipt, type Receipt } from "./receipts.ts";

export { spliceManagedBlock } from "./non-copy.ts";

// ─── Executor errors ─────────────────────────────────────────────────────────

export type ExecutorErrorCode =
  | "EXECUTOR_VERIFY_FAILED"
  | "EXECUTOR_STAGE_FAILED"
  | "EXECUTOR_PROMOTE_FAILED"
  | "EXECUTOR_HAZARD_DETECTED"
  | "EXECUTOR_CAPABILITY_UNAVAILABLE";

export class ExecutorError extends Error {
  readonly code: ExecutorErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ExecutorErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ExecutorError";
    this.code = code;
    this.details = details;
  }
}

// ─── Executor result ─────────────────────────────────────────────────────────

export interface ExecutorResult {
  txid: string;
  status: "committed" | "failed";
  outcomes: StepOutcome[];
  receipt?: Receipt;
  exitCode: number;
}

// ─── Executor options ────────────────────────────────────────────────────────

export interface ExecutorOptions {
  stateRoot: string;
  /** Binds compiled relative COPY sources to the product checkout. */
  repositoryRoot?: string;
  resolveRoot?: (token: string) => string;
  io: LifecycleIO;
  plan: PlanResult;
  compileResult: CompileResult;
  verb: string;
  profile: string;
  dryRun?: boolean;
  force?: boolean;
  explicitSelections?: Set<string>;
  signal?: AbortSignal;
}

// ─── Root resolution ─────────────────────────────────────────────────────────

const ROOT_PATHS: Record<string, () => string> = {
  HOME: () => process.env.HOME || "/tmp",
  TEMPERANCE_STATE: () => process.env.TEMPERANCE_STATE || "/tmp/temperance-state",
  CODEX_HOME: () => process.env.CODEX_HOME || "/tmp/codex",
  CLAUDE_CONFIG_DIR: () => process.env.CLAUDE_CONFIG_DIR || "/tmp/claude-config",
};

function defaultResolveRoot(token: string): string {
  const resolver = ROOT_PATHS[token];
  if (!resolver) throw new Error(`Unknown root token: ${token}`);
  return resolver();
}

async function promoteFile(
  io: LifecycleIO,
  stagePath: string,
  destPath: string,
): Promise<void> {
  await io.rename(stagePath, destPath);
}

async function verifyCopyLeaf(
  io: LifecycleIO,
  path: string,
  expectedHash: string,
  expectedMode: number,
): Promise<boolean> {
  const valid = async (): Promise<boolean> => {
    const stat = await io.lstat(path);
    return stat.isFile()
      && !stat.isSymbolicLink()
      && stat.nlink === 1
      && (stat.mode & 0o7777) === expectedMode;
  };
  if (!await valid()) return false;
  const hash = createHash("sha256").update(await io.readFile(path)).digest("hex");
  return hash === expectedHash && await valid();
}

async function removeStaged(io: LifecycleIO, stagePath: string): Promise<void> {
  try {
    await io.rm(stagePath, { recursive: true, force: true });
  } catch {
    // Ignore errors during cleanup
  }
}

// ─── Executor ────────────────────────────────────────────────────────────────

/**
 * Execute a lifecycle plan with full journaling and atomic promotion.
 *
 * - Pre-flight hazards before journal BEGIN
 * - Stage → verify → promote per step
 * - Preimage backup for displaced bytes
 * - Verify failure triggers ABORT and cleanup
 * - Receipt written on success
 */
export async function executePlan(options: ExecutorOptions): Promise<ExecutorResult> {
  const {
    stateRoot,
    io,
    plan,
    compileResult,
    verb,
    profile,
    dryRun = false,
    force = false,
    explicitSelections,
    signal = new AbortController().signal,
  } = options;

  const resolveRoot = options.resolveRoot ?? defaultResolveRoot;
  const txid = generateTxId();
  const txDir = join(stateRoot, "transactions", txid);

  // Dry run: print plan without writes
  if (dryRun) {
    return {
      txid,
      status: "committed",
      outcomes: plan.outcomes,
      exitCode: 0,
    };
  }

  // Check explicit selections for unavailable capabilities (INST-04)
  // This must happen BEFORE preflight to provide specific guidance
  if (explicitSelections) {
    for (const selection of explicitSelections) {
      const record = compileResult.lockObject.records.find((r) => r.id === selection);
      if (!record) continue;

      // Check if record has unmet dependencies
      if (record.requires) {
        for (const dep of record.requires) {
          if (dep.kind === "binary") {
            try {
              const result = await io.execFile("which", [dep.name], { signal });
              if (result.exitCode !== 0) {
                return {
                  txid,
                  status: "failed",
                  outcomes: plan.outcomes.map((o) => ({
                    ...o,
                    status: "failed" as const,
                    reason: o.record_id === selection
                      ? `CAPABILITY_UNAVAILABLE: ${dep.name} not found. Install '${dep.name}' and ensure it is on PATH.`
                      : undefined,
                  })),
                  exitCode: 1,
                };
              }
            } catch {
              return {
                txid,
                status: "failed",
                outcomes: plan.outcomes.map((o) => ({
                  ...o,
                  status: "failed" as const,
                  reason: o.record_id === selection
                    ? `CAPABILITY_UNAVAILABLE: ${dep.name} not found. Install '${dep.name}' and ensure it is on PATH.`
                    : undefined,
                })),
                exitCode: 1,
              };
            }
          }
        }
      }
    }
  }

  // No destination mutations until source inventory and hazards pass.

  // Pre-flight hazards (only check records that are in the plan steps)
  const stepRecordIds = new Set(plan.steps.map((s) => s.record_id));
  let stepRecords = compileResult.lockObject.records.filter((r) => stepRecordIds.has(r.id));

  // Filter out optional records with unavailable dependencies
  let filteredSteps: typeof plan.steps = [];
  const filteredRecords: typeof stepRecords = [];
  const skippedOptional: string[] = [];
  const unavailableOptional = new Map<string, string>();

  for (const step of plan.steps) {
    const record = stepRecords.find((r) => r.id === step.record_id);
    if (!record) continue;

    // There is no removal producer for a contextual managed transform. Raw
    // unlink would delete user-owned bytes outside its block, so hold before
    // creating a transaction until a separately reviewed removal contract
    // exists.
    if (step.mode === "uninstall" && record.class === "TRANSFORM") {
      return {
        txid,
        status: "failed",
        outcomes: plan.outcomes.map((outcome) => ({
          ...outcome,
          status: "failed" as const,
          reason: outcome.record_id === record.id
            ? "TRANSFORM_UNINSTALL_UNSUPPORTED: no managed-block removal producer"
            : undefined,
        })),
        exitCode: 1,
      };
    }

    const producer = record.class === "TRANSFORM" || record.class === "REGENERATE"
      ? producerAvailability(record)
      : null;
    if (producer) {
      if (record.eligibility.required || explicitSelections?.has(record.id)) {
        return {
          txid,
          status: "failed",
          outcomes: plan.outcomes.map((outcome) => ({
            ...outcome,
            status: "failed" as const,
            reason: outcome.record_id === record.id ? producer.reason : undefined,
          })),
          exitCode: 1,
        };
      }
      unavailableOptional.set(record.id, producer.reason);
      continue;
    }

    // Check if this is an optional record with unavailable dependencies
    if (record.eligibility.required === false && record.requires) {
      let depsAvailable = true;
      for (const dep of record.requires) {
        if (dep.kind === "binary") {
          try {
            const result = await io.execFile("which", [dep.name], { signal });
            if (result.exitCode !== 0) {
              depsAvailable = false;
              break;
            }
          } catch {
            depsAvailable = false;
            break;
          }
        }
      }

      if (!depsAvailable) {
        skippedOptional.push(record.id);
        continue;
      }
    }

    filteredSteps.push(step);
    filteredRecords.push(record);
  }

  // Update outcomes for skipped optional records
  const finalOutcomes = plan.outcomes.map((o) => {
    const unavailable = unavailableOptional.get(o.record_id);
    if (unavailable) {
      return { ...o, status: "unavailable" as const, reason: unavailable };
    }
    if (skippedOptional.includes(o.record_id)) {
      return {
        ...o,
        status: "skipped" as const,
        reason: "Optional dependency unavailable",
      };
    }
    return o;
  });

  let copies: Awaited<ReturnType<typeof prepareCopies>>["copies"] = new Map();
  const preparedSurfaces = new Map<string, PreparedSurface>();
  const preparedTransformInputs = new Map<string, { hash: string | null; mode: number | null }>();
  try {
    const declaredCopyHashes = declaredCopyHashesForSteps(filteredSteps, filteredRecords);
    const prepared = await prepareCopies(io, filteredSteps, filteredRecords, options.repositoryRoot, declaredCopyHashes);
    filteredSteps = prepared.steps;
    copies = prepared.copies;
    for (const copy of copies.values()) {
      preparedSurfaces.set(copy.step.step_id, {
        step: copy.step,
        surface_class: "COPY",
        content: copy.content,
        expected_hash: copy.expected_hash,
        expected_mode: copy.expected_mode,
      });
    }
    // Check every stage reservation and destination ancestry before journal writes.
    for (const step of filteredSteps) {
      if (!/^[\w.-]+$/.test(step.step_id)) throw new Error("STEP_ID_INVALID");
      const root = resolveRoot(step.destination.root_token);
      await safePath(io, root, join(root, step.destination.relative_path), "file");
      const staged = join(root, `.temperance-stage-${txid}-${sha256(step.step_id)}`);
      try { await io.lstat(staged); throw new Error("STAGE_ALREADY_EXISTS"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  } catch (error) {
    return { txid, status: "failed", exitCode: 1, outcomes: finalOutcomes.map(o => ({ ...o, status: "failed", reason: String(error) })) };
  }

  try {
    await preflight(
      filteredSteps,
      filteredRecords,
      resolveRoot,
      io,
      signal,
    );
  } catch (error) {
    if (error instanceof HazardError) {
      return {
        txid,
        status: "failed",
        outcomes: finalOutcomes.map((o) => ({
          ...o,
          status: "failed" as const,
          reason: `Hazard: ${error.code}`,
        })),
        exitCode: 1,
      };
    }
    throw error;
  }

  try {
    for (const step of filteredSteps) {
      const record = compileResult.lockObject.records.find((candidate) => candidate.id === step.record_id);
      if (!record || record.class !== "TRANSFORM" || step.mode === "uninstall") continue;
      const prepared = await prepareNonCopy(record, { io, repositoryRoot: options.repositoryRoot, resolveRoot });
      if (prepared.status !== "prepared") throw new Error(prepared.reason);
      preparedSurfaces.set(step.step_id, {
        step,
        surface_class: "TRANSFORM",
        producer_id: prepared.producer_id,
        source_hash: prepared.source_hash,
        content: prepared.content,
        expected_hash: sha256(prepared.content),
        expected_mode: "preserve",
      });
      preparedTransformInputs.set(step.step_id, prepared.destination_before);
    }
    // Retain the RO-00 COPY manifest for pure COPY transactions so historic
    // receipts/recovery remain readable. A mixed transaction upgrades as one
    // whole to the prepared surface manifest before its first mutation.
    if (preparedTransformInputs.size === 0) preparedSurfaces.clear();
  } catch (error) {
    return { txid, status: "failed", exitCode: 1, outcomes: finalOutcomes.map((outcome) => ({ ...outcome, status: "failed" as const, reason: String(error) })) };
  }

  const journal = await Journal.create(stateRoot, io, txid);

  const committedSteps: string[] = [];

  const stagedPaths = new Set<string>();
  try {
    const surfaceManifest = preparedSurfaces.size > 0
      ? await captureSurfaceManifest(io, txDir, preparedSurfaces, resolveRoot)
      : null;
    const copyManifest = surfaceManifest === null && copies.size > 0
      ? await captureCopyManifest(io, txDir, copies, resolveRoot)
      : null;
    const surfaceLeaves = new Map((surfaceManifest?.leaves ?? []).map((leaf) => [leaf.step_id, leaf]));
    for (const [stepId, input] of preparedTransformInputs) {
      const leaf = surfaceLeaves.get(stepId);
      if (!leaf || leaf.prior_hash !== input.hash || leaf.prior_mode !== input.mode) {
        throw new Error("TRANSFORM_DESTINATION_RACE");
      }
    }
    await journal.append({
      kind: "BEGIN", ts: io.now().toISOString(), verb, profile, inventory_digest: compileResult.digest,
      ...(surfaceManifest ? { surface_manifest_sha256: sha256(await io.readFile(join(txDir, "surface-manifest.json"))) } : {}),
      ...(copyManifest ? { copy_manifest_sha256: sha256(await io.readFile(join(txDir, "copy-manifest.json"))) } : {}),
    });
    // Execute steps
    for (const step of filteredSteps) {
      const record = compileResult.lockObject.records.find((r) => r.id === step.record_id);
      if (!record) continue;

      const rootPath = resolveRoot(step.destination.root_token);
      const destPath = `${rootPath}/${step.destination.relative_path}`;
      const stagePath = join(rootPath, `.temperance-stage-${txid}-${sha256(step.step_id)}`);
      if (!/^[\w.-]+$/.test(step.step_id)) throw new Error("STEP_ID_INVALID");
      await safePath(io, rootPath, destPath, "file");
      const surface = preparedSurfaces.get(step.step_id);
      const surfaceLeaf = surface ? surfaceLeaves.get(step.step_id) : undefined;
      const copy = copies.get(step.step_id);
      const copyLeaf = copy ? copyManifest?.leaves.find((leaf) => leaf.step_id === step.step_id) : undefined;
      if (surface && !surfaceLeaf) throw new Error("SURFACE_MANIFEST_LEAF_MISSING");
      if (copy && !copyLeaf && !surfaceLeaf) throw new Error("COPY_MANIFEST_LEAF_MISSING");
      if (surfaceLeaf) await assertSurfacePrior(io, surfaceLeaf, resolveRoot);
      if (copyLeaf) await assertCopyPrior(io, copyLeaf, resolveRoot);
      try { await io.lstat(stagePath); throw new Error("STAGE_ALREADY_EXISTS"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      stagedPaths.add(stagePath);

      // Ensure destination parent directory exists (install/update only)
      if (step.mode !== "uninstall") {
        const parentDir = destPath.substring(0, destPath.lastIndexOf("/"));
        await io.mkdir(parentDir, { recursive: true });
      }

      // TOCTOU re-check
      await recheckBeforeMutation(step, resolveRoot, io);

      // Journal STAGE
      await journal.append({
        kind: "STAGE",
        ts: new Date().toISOString(),
        step_id: step.step_id,
        destination_symbolic: `$${step.destination.root_token}/${step.destination.relative_path}`,
        mode: step.mode,
      });

      // Uninstall is not a prepared-output mutation. Retain the legacy
      // preimage path for that separate, older compensation contract.
      if (!surfaceLeaf && !copyLeaf) try {
        const existing = await io.readFile(destPath);
        const preimagePath = join(txDir, "preimage", `${step.step_id}.preimage`);
        await io.writeFileAtomic(preimagePath, existing);
      } catch {
        // A missing destination is an idempotent uninstall.
      }

      if (step.mode === "uninstall") {
        // Uninstall: remove the destination file
        try {
          await io.rm(destPath, { force: true });
        } catch {
          // File doesn't exist — idempotent
        }
      } else {
        // Install/Update: every output is prepared before BEGIN. Pure legacy
        // COPY transactions retain their v2 manifest; mixed transactions use
        // the prepared surface manifest as one recovery unit.
        if (surface && surfaceLeaf) {
          await io.writeFileAtomic(stagePath, surface.content, { mode: surfaceLeaf.expected_mode });
          await safePath(io, rootPath, stagePath, "file");
          await verifySurfaceOutput(io, surfaceLeaf, stagePath, rootPath);
          await assertSurfacePrior(io, surfaceLeaf, resolveRoot);
        } else if (copy && copyLeaf) {
          await io.writeFileAtomic(stagePath, copy.content, { mode: copy.expected_mode });
          await safePath(io, rootPath, stagePath, "file");
          if (!await verifyCopyLeaf(io, stagePath, copy.expected_hash, copy.expected_mode)) throw new Error("COPY_STAGE_VERIFY_FAILED");
          await assertCopyPrior(io, copyLeaf, resolveRoot);
        } else {
          throw new Error("SURFACE_PREPARATION_MISSING");
        }

        // Promote: atomic rename
        try {
          await safePath(io, rootPath, destPath, "file");
          await promoteFile(io, stagePath, destPath);
          stagedPaths.delete(stagePath);
          if (surfaceLeaf) await verifySurfaceOutput(io, surfaceLeaf, destPath, rootPath);
          else if (copy && !await verifyCopyLeaf(io, destPath, copy.expected_hash, copy.expected_mode)) throw new Error("COPY_PROMOTE_VERIFY_FAILED");
        } catch (error) {
          // Promotion failed — abort
          await journal.append({
            kind: "ABORT",
            ts: new Date().toISOString(),
            reason: `Promotion failed for ${step.step_id}: ${error}`,
          });

          // Cleanup staged files
          await removeStaged(io, stagePath);

          return {
            txid,
            status: "failed",
            outcomes: finalOutcomes.map((o) => ({
              ...o,
              status: o.record_id === step.record_id ? "failed" : o.status,
              reason: o.record_id === step.record_id ? "Promotion failed" : o.reason,
            })),
            exitCode: 1,
          };
        }
      }

      // Journal COMMIT_STEP
      await journal.append({
        kind: "COMMIT_STEP",
        ts: new Date().toISOString(),
        step_id: step.step_id,
      });

      committedSteps.push(step.step_id);
    }

    // All steps committed — write receipt
    const receipt = await writeReceipt({
      txid,
      verb,
      profile,
      inventory_digest: compileResult.digest,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "committed",
      steps: finalOutcomes.map((o) => ({
        id: o.step_id,
        record_id: o.record_id,
        destination_symbolic: o.destination_symbolic,
        outcome: o.status,
      })),
      user_content_preserved: [],
      manifest_after_digest: compileResult.digest,
    }, txDir, io);

    // Journal COMPLETE
    await journal.append({
      kind: "COMPLETE",
      ts: new Date().toISOString(),
      receipt_ref: `${txid}/receipt.json`,
    });

    return {
      txid,
      status: "committed",
      outcomes: finalOutcomes,
      receipt,
      exitCode: 0,
    };
  } catch (error) {
    for (const staged of stagedPaths) await removeStaged(io, staged);
    // Unexpected error — abort
    await journal.append({
      kind: "ABORT",
      ts: new Date().toISOString(),
      reason: `Unexpected error: ${error}`,
    });

    return {
      txid,
      status: "failed",
      outcomes: finalOutcomes.map((o) => ({
        ...o,
        status: "failed" as const,
        reason: String(error),
      })),
      exitCode: 1,
    };
  }
}

/**
 * Rollback a transaction by replaying COMPENSATE entries in reverse order.
 */
export async function rollbackTransaction(
  txid: string,
  stateRoot: string,
  io: LifecycleIO,
  options: { resolveRoot?: (token: string) => string } = {},
): Promise<ExecutorResult> {
  const resolveRoot = options.resolveRoot ?? defaultResolveRoot;
  if (!/^[a-f0-9]{12}-[a-f0-9]{8}$/.test(txid)) return { txid, status: "failed", outcomes: [], exitCode: 1 };
  const txDir = join(stateRoot, "transactions", txid);
  const journal = Journal.open(txDir, io);

  let copyManifest: CopyManifest | null = null;
  let surfaceManifest: SurfaceManifest | null = null;
  let entries: JournalEntry[] = [];

  const assertManifestJournalScope = (manifest: SurfaceManifest | CopyManifest): void => {
    const leafIds = new Set(manifest.leaves.map((leaf) => leaf.step_id));
    for (const entry of entries) {
      if (
        (entry.kind === "STAGE" || entry.kind === "COMMIT_STEP" || entry.kind === "COMPENSATE")
        && !leafIds.has(entry.step_id)
      ) {
        throw new Error("MANIFEST_ROLLBACK_UNVERIFIED");
      }
    }
  };

  try {
    entries = await journal.readEntries();
    const begin = entries.find(e => e.kind === "BEGIN");
    surfaceManifest = await loadSurfaceManifest(io, txDir);
    if (surfaceManifest) {
      if (begin?.kind !== "BEGIN" || begin.surface_manifest_sha256 !== sha256(await io.readFile(join(txDir, "surface-manifest.json")))) {
        throw new Error("SURFACE_MANIFEST_DRIFT");
      }
      // A transaction must use one authoritative recovery format. Mixing
      // legacy COPY and prepared output evidence has no all-leaf proof.
      if (await loadCopyManifest(io, txDir)) throw new Error("SURFACE_MANIFEST_FORMAT_CONFLICT");
      assertManifestJournalScope(surfaceManifest);
      await rollbackSurface(io, txDir, surfaceManifest, resolveRoot);
    } else {
      copyManifest = await loadCopyManifest(io, txDir);
      if (copyManifest) {
        if (begin?.kind !== "BEGIN" || begin.copy_manifest_sha256 !== sha256(await io.readFile(join(txDir, "copy-manifest.json")))) throw new Error("COPY_MANIFEST_DRIFT");
        // A manifest owns the complete recovery scope. Do not fall back to
        // journal-provided paths for any unbound stage, commit, or prior retry.
        assertManifestJournalScope(copyManifest);
        await rollbackCopies(io, txDir, copyManifest, resolveRoot);
      } else if (begin?.kind === "BEGIN" && (begin.copy_manifest_sha256 || begin.surface_manifest_sha256)) {
        throw new Error(begin.surface_manifest_sha256 ? "SURFACE_MANIFEST_MISSING" : "COPY_MANIFEST_MISSING");
      }
    }
  } catch {
    return { txid, status: "failed", outcomes: [], exitCode: 1 };
  }
  if (copyManifest) {
    for (const leaf of copyManifest.leaves) await journal.append({ kind: "COMPENSATE", ts: io.now().toISOString(), step_id: leaf.step_id, method: "verified-copy-leaf" });
    return { txid, status: "committed", outcomes: [], exitCode: 0 };
  }
  if (surfaceManifest) {
    for (const leaf of surfaceManifest.leaves) await journal.append({ kind: "COMPENSATE", ts: io.now().toISOString(), step_id: leaf.step_id, method: "verified-surface-leaf" });
    return { txid, status: "committed", outcomes: [], exitCode: 0 };
  }

  const committedSteps = await journal.committedSteps();
  const preimageDir = join(txDir, "preimage");

  // Reverse order compensation
  for (const stepId of committedSteps.reverse()) {
    const preimagePath = join(preimageDir, `${stepId}.preimage`);

    // Try to restore from preimage
    try {
      const preimage = await io.readFile(preimagePath);
      // Find the destination from journal entries
      const entries = await journal.readEntries();
      const stageEntry = entries.find(
        (e) => e.kind === "STAGE" && (e as any).step_id === stepId,
      );

      if (stageEntry && stageEntry.kind === "STAGE") {
        const destPath = stageEntry.destination_symbolic.replace(
          /^\$(\w+)\//,
          (_, token) => resolveRoot(token) + "/",
        );
        await io.writeFileAtomic(destPath, preimage);
      }
    } catch {
      // Preimage doesn't exist — file was newly created, remove it
    }

    // Journal COMPENSATE
    await journal.append({
      kind: "COMPENSATE",
      ts: new Date().toISOString(),
      step_id: stepId,
      method: "restore-preimage",
    });
  }

  return {
    txid,
    status: "committed",
    outcomes: [],
    exitCode: 0,
  };
}
