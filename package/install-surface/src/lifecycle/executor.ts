/**
 * Lifecycle executor — executes planned steps with journaling and atomic promotion.
 *
 * Ordering per step: hazards → journal.STAGE → stage → verify → journal.COMMIT_STEP → promote.
 * Preimage of displaced bytes → preimage/<step_id>.
 * Verify failure mid-run: ABORT, staged removed, preimages intact, exit 1.
 */

import { createHash, randomBytes } from "node:crypto";
import { canonical } from "../canonical-json.ts";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { prepareCopies, captureCopyManifest, assertCopyPrior, declaredCopyHashesForSteps, loadCopyManifest, rollbackCopies, safePath, sha256, type CopyManifest } from "./copy-tree.ts";
import { prepareNonCopy, producerAvailability } from "./non-copy.ts";
import {
  assertSurfacePrior,
  captureSurfaceManifest,
  loadSurfaceManifest,
  validateSurfaceManifest,
  rollbackSurface,
  verifySurfaceOutput,
  type PreparedSurface,
  type SurfaceManifest,
} from "./prepared-surface.ts";

import type { CompileResult } from "../compile.ts";
import type { SurfaceRecord, LaunchAgentSurfaceRecord } from "../types.ts";
import {
  renderPlist,
  isLoaded as laIsLoaded,
  loadAgent,
  unloadAgent,
  probeHealth,
  sha256Hex,
} from "./launchagent.ts";
import { assertDestination } from "../path-policy.ts";
import {
  type PlannedStep,
  preflight,
  recheckBeforeMutation,
  HazardError,
} from "./hazards.ts";
import {
  Journal,
  hasGuardedTransactionOrigin,
  readLifecycleMetadata,
  generateTxId,
  type LifecycleIO,
  type JournalEntry,
  type TransactionBinding,
} from "./journal.ts";
import { createPlan, type PlanResult, type PlanOptions, type StepOutcome } from "./planner.ts";
import { readReceipt, writeReceipt, type Receipt } from "./receipts.ts";

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
  HOME: () => process.env.HOME || homedir(),
  CODEX_HOME: () => process.env.CODEX_HOME || join(process.env.HOME || homedir(), ".codex"),
  CLAUDE_CONFIG_DIR: () => process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || homedir(), ".claude"),
};

function defaultResolveRoot(token: string, stateRoot: string): string {
  // A transaction's destination, journal, and recovery must share one root,
  // even when its explicit root differs from the current environment.
  if (token === "TEMPERANCE_STATE") return stateRoot;
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
export function executePlan(options: ExecutorOptions): Promise<ExecutorResult>;
export function executePlan(options: PreparedTransactionOptions): Promise<PreparedTransactionResult>;
export async function executePlan(options: ExecutorOptions | PreparedTransactionOptions): Promise<ExecutorResult | PreparedTransactionResult> {
  if ("prepared_transaction" in options) return executePreparedTransaction(options);
  const {
    stateRoot,
    io,
    plan,
    compileResult,
    verb,
    profile,
    dryRun = false,
    force = false,
    signal = new AbortController().signal,
  } = options;
  const explicitSelections = new Set([...(options.explicitSelections ?? []), ...(plan.scope?.record_ids ?? [])]);

  const resolveRoot = options.resolveRoot ?? ((token: string) => defaultResolveRoot(token, stateRoot));
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

      if (record.class === "LAUNCHAGENT") {
        // LAUNCHAGENT: render plist, launchctl load/unload, verify, health probe
        const laRecord = record as LaunchAgentSurfaceRecord;
        const plistContent = renderPlist(laRecord.plist_template, laRecord.bindings);
        const plistSha256 = sha256Hex(plistContent);

        if (step.mode === "uninstall") {
          // Uninstall: unload if loaded, then remove plist
          try {
            const loaded = await laIsLoaded(laRecord.label, io, signal);
            if (loaded) {
              await unloadAgent(laRecord.label, io, signal);
            }
          } catch {
            // launchctl not available or unload failed — continue to remove plist
          }
          try {
            await io.rm(destPath, { recursive: false, force: true });
          } catch {
            // File doesn't exist — idempotent
          }
        } else {
          // Install/Update: check if already loaded, render plist, load, verify
          let alreadyLoaded = false;
          try {
            alreadyLoaded = await laIsLoaded(laRecord.label, io, signal);
          } catch {
            // Not darwin or launchctl error — treat as not loaded
          }

          if (step.mode === "install" && alreadyLoaded) {
            // Idempotent: already loaded, skip
            await journal.append({
              kind: "COMMIT_STEP",
              ts: new Date().toISOString(),
              step_id: step.step_id,
            });
            committedSteps.push(step.step_id);
            continue;
          }

          if (step.mode === "update" && alreadyLoaded) {
            // Update: check if plist content changed
            try {
              const existingContent = await io.readFile(destPath);
              const existingSha256 = sha256Hex(existingContent);
              if (existingSha256 === plistSha256) {
                // Unchanged — skip
                await journal.append({
                  kind: "COMMIT_STEP",
                  ts: new Date().toISOString(),
                  step_id: step.step_id,
                });
                committedSteps.push(step.step_id);
                continue;
              }
            } catch {
              // Can't read existing — proceed with update
            }

            // Content changed: unload → write → load
            try {
              await unloadAgent(laRecord.label, io, signal);
            } catch {
              // Unload failed — continue anyway
            }
          }

          // Save preimage (plist bytes + loaded state) for rollback
          const preimageDir = join(txDir, "preimage");
          const preimageData = JSON.stringify({
            plistBytes: null as string | null,
            wasLoaded: alreadyLoaded,
          });
          try {
            const existingPlist = await io.readFile(destPath);
            const preimageJson = JSON.stringify({
              plistBytes: existingPlist,
              wasLoaded: alreadyLoaded,
            });
            const preimagePath = join(preimageDir, `${step.step_id}.preimage`);
            await io.writeFileAtomic(preimagePath, preimageJson);
          } catch {
            // No existing plist — preimage has null bytes
            const preimagePath = join(preimageDir, `${step.step_id}.preimage`);
            await io.writeFileAtomic(preimagePath, preimageData);
          }

          // Write plist
          await io.writeFileAtomic(destPath, plistContent);

          // Load agent
          try {
            await loadAgent(destPath, io, signal);
          } catch (error) {
            // Load failed — abort and restore preimage
            await journal.append({
              kind: "ABORT",
              ts: new Date().toISOString(),
              reason: `launchctl load failed for ${step.step_id}: ${error}`,
            });

            // Restore preimage
            try {
              const preimagePath = join(preimageDir, `${step.step_id}.preimage`);
              const preimageRaw = await io.readFile(preimagePath);
              const preimage = JSON.parse(preimageRaw) as { plistBytes: string | null; wasLoaded: boolean };
              if (preimage.plistBytes) {
                await io.writeFileAtomic(destPath, preimage.plistBytes);
              } else {
                await io.rm(destPath, { recursive: false, force: true });
              }
            } catch {
              // Preimage restore failed
            }

            return {
              txid,
              status: "failed",
              outcomes: plan.outcomes.map((o) => ({
                ...o,
                status: o.step_id === step.step_id ? "failed" : o.status,
                reason: o.step_id === step.step_id ? "launchctl load failed" : o.reason,
              })),
              exitCode: 1,
            };
          }

          // Verify plist sha256
          try {
            const installedContent = await io.readFile(destPath);
            const installedSha256 = sha256Hex(installedContent);
            if (installedSha256 !== plistSha256) {
              await journal.append({
                kind: "ABORT",
                ts: new Date().toISOString(),
                reason: `Plist verification failed for ${step.step_id}: sha256 mismatch`,
              });
              return {
                txid,
                status: "failed",
                outcomes: plan.outcomes.map((o) => ({
                  ...o,
                  status: o.step_id === step.step_id ? "failed" : o.status,
                  reason: o.step_id === step.step_id ? "Plist sha256 mismatch" : o.reason,
                })),
                exitCode: 1,
              };
            }
          } catch {
            // Can't read installed plist — verification failed
          }

          // Health probe (non-fatal — log but don't abort)
          try {
            const health = await probeHealth(laRecord.label, io, signal);
            if (!health.healthy) {
              // Health probe failed — log but continue (service may need time to start)
            }
          } catch {
            // Health probe error — non-fatal
          }
        }
      } else if (step.mode === "uninstall") {
        // Uninstall: remove the destination file
        try {
          await io.rm(destPath, { recursive: false, force: true });
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
  const resolveRoot = options.resolveRoot ?? ((token: string) => defaultResolveRoot(token, stateRoot));
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
    if (!begin || begin.kind !== "BEGIN" || await hasGuardedTransactionOrigin(txDir, io, entries)) throw new Error("TRANSACTION_GUARD_REQUIRED");
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

/** Reviewed prepared intent uses the same transaction artifacts and Journal as
 * legacy execution. There is deliberately no compilation/re-rendering on resume.
 * All participants for a destination must share its owning lifecycle stateRoot.
 */
export interface PreparedReleaseEvidence {
  kind: "terminal" | "unpublished";
  binding: TransactionBinding;
  capture_started: boolean;
  artifacts: Array<{ path: string; mode: number; hash: string | null }>;
  destinations: Array<{ step_id: string; hash: string | null; mode: number | null }>;
}
export interface PreparedTransactionOptions {
  prepared_transaction: true;
  action: "apply" | "resume" | "rollback" | "status" | "release";
  stateRoot: string;
  io: LifecycleIO;
  txid: string;
  binding: TransactionBinding;
  profile: string;
  resolveRoot: (token: string) => string;
  prepared?: Map<string, PreparedSurface>;
  intent: Array<{ step: PlannedStep; expected_hash: string; expected_mode: number; preimage_digest: string }>;
  /** Trusted authority checks fresh external evidence. Never supplied by a plan. */
  assertAuthority: () => Promise<void>;
  /** Fresh owner release approval binds the independently observed retained facts. */
  assertReleaseEvidence?: (evidence: PreparedReleaseEvidence) => Promise<void>;
  /** Independently authenticated ownership; matching bytes alone are insufficient. */
  assertOwnedPreimage: (stepId: string) => Promise<void>;
  signal?: AbortSignal;
}
export interface PreparedTransactionResult {
  txid: string;
  status: "committed" | "incomplete" | "rolled-back" | "manual-recovery" | "unknown-effect" | "released";
  reason: "VERIFIED" | "INTERRUPTED" | "RECOVERY_REQUIRED" | "OWNER_RECONCILIATION_REQUIRED" | "ATOMIC_CUSTODY_UNSUPPORTED" | "FOREIGN_CUSTODY_HELD";
}
const transactionEqual = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
/** Validate only the retained writer language of a foreign migration. A valid
 * prefix is not completion, ownership, fresh source evidence, or permission to
 * act on that transaction. No foreign output/preimage/destination is opened.
 * Apply emits each leaf in manifest order; rollback restores in reverse order,
 * then compensates every leaf in manifest order, including untouched leaves.
 * COMPLETE(apply) may legitimately be followed by ABORT and COMPLETE(rollback).
 */
function assertForeignMigrationHistory(entries: unknown[], manifest: SurfaceManifest): void {
  const keys: Record<string, readonly string[]> = {
    BEGIN: ["kind", "ts", "verb", "profile", "inventory_digest", "surface_manifest_sha256", "transaction_binding"],
    STAGE: ["kind", "ts", "step_id", "destination_symbolic", "mode"],
    COMMIT_STEP: ["kind", "ts", "step_id"], COMPENSATE: ["kind", "ts", "step_id", "method"],
    ABORT: ["kind", "ts", "reason"], COMPLETE: ["kind", "ts", "receipt_ref"],
    CUSTODY: ["kind", "ts", "step_id", "phase", "custody_ref", "expected_hash", "expected_mode"],
    CUSTODY_HOLD: ["kind", "ts", "step_id", "custody_ref", "observed_hash", "observed_mode", "returned"],
  };
  const fail = (): never => { throw new Error("PUBLICATION_AMBIGUOUS"); };
  const leafKeys = ["step_id", "record_id", "root_token", "relative_path", "surface_class", "producer_id", "source_hash", "ownership", "expected_hash", "expected_mode", "output", "prior_hash", "prior_mode", "preimage"];
  const safeRef = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value) && !value.includes("..") && !/localhost|127\.0\.0\.1|https?:/i.test(value);
  if (Object.keys(manifest).length !== 2 || manifest.leaves.some(leaf => Object.keys(leaf).length !== leafKeys.length
    || leafKeys.some(key => !Object.hasOwn(leaf, key)) || !safeRef(leaf.step_id) || !safeRef(leaf.record_id)
    || leaf.relative_path.length > 512 || !leaf.relative_path.split("/").every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)))) fail();
  const staged = new Set<string>(), committed = new Set<string>(), compensated = new Set<string>();
  const custody = new Map<string, Extract<JournalEntry, { kind: "CUSTODY" }>>();
  let aborted = false, complete = false, rollbackComplete = false, held = false;
  let rollbackIndex = manifest.leaves.length;
  if (!entries.length || !manifest.leaves.length || manifest.leaves.some(leaf => leaf.ownership !== "exclusive-path")) fail();
  for (const [index, value] of entries.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail();
    const entry = value as JournalEntry, fields = Object.hasOwn(keys, entry.kind) ? keys[entry.kind] : undefined;
    if (!fields || Object.keys(entry).length !== fields.length || fields.some(key => !Object.hasOwn(entry, key))
      || typeof entry.ts !== "string" || !Number.isFinite(Date.parse(entry.ts)) || new Date(entry.ts).toISOString() !== entry.ts) fail();
    if (held || rollbackComplete || (complete && entry.kind !== "ABORT")) fail();
    if (entry.kind === "BEGIN") { if (index !== 0) fail(); continue; }
    if (index === 0) fail();
    const leafIndex = "step_id" in entry ? manifest.leaves.findIndex(leaf => leaf.step_id === entry.step_id) : -1;
    const leaf = manifest.leaves[leafIndex];
    if ("step_id" in entry && (!leaf || typeof entry.step_id !== "string")) fail();
    switch (entry.kind) {
      case "STAGE":
        if (aborted || staged.has(entry.step_id) || leafIndex !== committed.size || staged.size !== committed.size
          || entry.mode !== "install" || entry.destination_symbolic !== `$${leaf!.root_token}/${leaf!.relative_path}`) fail();
        staged.add(entry.step_id); break;
      case "COMMIT_STEP":
        if (aborted || !staged.has(entry.step_id) || committed.has(entry.step_id) || leafIndex !== committed.size) fail();
        committed.add(entry.step_id); break;
      case "ABORT":
        if (aborted || entry.reason !== "ROLLBACK_REQUESTED") fail();
        aborted = true; complete = false; break;
      case "COMPENSATE":
        if (!aborted || compensated.has(entry.step_id) || leafIndex !== compensated.size || entry.method !== "verified-surface-leaf") fail();
        compensated.add(entry.step_id); break;
      case "COMPLETE":
        if (entry.receipt_ref !== "receipt.json" || (aborted ? compensated.size : committed.size) !== manifest.leaves.length) fail();
        complete = true; rollbackComplete = aborted; break;
      case "CUSTODY": {
        if (!["apply", "rollback"].includes(entry.phase) || custody.has(entry.custody_ref) || !staged.has(entry.step_id)
          || entry.custody_ref !== `preimage/custody-${entry.phase}-${sha256(entry.step_id)}.txt`
          || entry.expected_hash !== (entry.phase === "apply" ? leaf!.prior_hash : leaf!.expected_hash)
          || entry.expected_mode !== (entry.phase === "apply" ? leaf!.prior_mode : leaf!.expected_mode)
          || typeof entry.expected_hash !== "string" || !/^[a-f0-9]{64}$/.test(entry.expected_hash)
          || !Number.isInteger(entry.expected_mode) || entry.expected_mode < 0 || entry.expected_mode > 0o777) fail();
        if (entry.phase === "apply") {
          if (aborted || committed.has(entry.step_id) || leafIndex !== committed.size) fail();
        } else {
          if (!aborted || compensated.size || leafIndex >= rollbackIndex) fail();
          rollbackIndex = leafIndex;
        }
        custody.set(entry.custody_ref, entry); break;
      }
      case "CUSTODY_HOLD": {
        const intent = custody.get(entry.custody_ref), previous = entries[index - 1] as JournalEntry;
        if (!intent || intent.step_id !== entry.step_id || previous.kind !== "CUSTODY" || previous.custody_ref !== entry.custody_ref
          || typeof entry.observed_hash !== "string" || !/^[a-f0-9]{64}$/.test(entry.observed_hash)
          || !Number.isInteger(entry.observed_mode) || entry.observed_mode < 0 || entry.observed_mode > 0o7777 || typeof entry.returned !== "boolean"
          || (entry.observed_hash === intent.expected_hash && entry.observed_mode === intent.expected_mode)) fail();
        held = true; break;
      }
    }
  }
}
/** Canonical preimage descriptor. Content is never copied into a public plan. */
export function preparedPreimageDigest(hash: string | null, mode: number | null): string {
  return `sha256:${sha256(JSON.stringify({ hash, mode }))}`;
}
async function executePreparedTransaction(options: PreparedTransactionOptions): Promise<PreparedTransactionResult> {
  const { io, stateRoot, txid, binding, resolveRoot, action } = options;
  const result = (status: PreparedTransactionResult["status"], reason: PreparedTransactionResult["reason"]): PreparedTransactionResult => ({ txid, status, reason });
  const txDir = join(stateRoot, "transactions", txid);
  // A coarse exclusive claim also prevents partially overlapping destination sets.
  // Retain it through completion/compensation for authenticated recovery. Releasing
  // or taking over a stale claim requires separate owner handling, never a timeout.
  const claim = join(stateRoot, "prepared-transaction-claim");
  const privateClaim = join(txDir, "prepared-claim");
  let currentClaim = claim;
  let activePath = join(claim, "active");
  const activeNonce = randomBytes(16).toString("hex");
  let activeOwnerPath = join(activePath, "owner.json");
  const selectClaim = (path: string) => { currentClaim = path; activePath = join(path, "active"); activeOwnerPath = join(activePath, "owner.json"); };
  const owner = JSON.stringify({ txid, binding });
  let active = false;
  let released = false;
  let captureStarted = false;
  let unpublishedRelease = false;
  const releasedClaim = join(txDir, "released-claim");
  let assertArtifacts = async (): Promise<void> => {};
  let assertCustody = async (): Promise<void> => {};
  const assertRoots = async () => {
    const facts: unknown[] = [];
    for (const item of options.intent) {
      const root = resolve(resolveRoot(item.step.destination.root_token));
      await safePath(io, root, root, "directory");
      const stat = await io.lstat(root);
      facts.push([item.step.step_id, await io.realpath(root), stat.dev, stat.ino, resolve(root, item.step.destination.relative_path).normalize("NFC").toLowerCase()]);
    }
    if (sha256(JSON.stringify(facts)) !== binding.destinations_digest) throw new Error("DESTINATION_BINDING_DRIFT");
  };
  const assertClaim = async () => {
    const actual = await readLifecycleMetadata(io, stateRoot, join(currentClaim, "owner.json"), true);
    if (actual !== owner) throw new Error("CLAIM_INVALID");
  };
  const guard = async () => {
    await options.assertAuthority();
    await assertClaim();
    if (captureStarted && await readLifecycleMetadata(io, stateRoot, join(currentClaim, "capture.json"), true) !== owner) throw new Error("CAPTURE_BINDING_DRIFT");
    await assertRoots();
    await assertArtifacts();
    await assertCustody();
    if (active && await readLifecycleMetadata(io, stateRoot, activeOwnerPath, true) !== activeNonce) throw new Error("CLAIM_INVALID");
    if (options.signal?.aborted) throw new Error("CANCELLED");
  };
  const guarded = new Proxy(io, { get(target, key: keyof LifecycleIO) {
    const value = target[key];
    if (["mkdir", "writeFile", "writeFileAtomic", "rm", "chmod", "rename", "renameNoReplace"].includes(key)) {
      return async (...args: unknown[]) => { await guard(); return (value as (...args: unknown[]) => unknown).apply(target, args); };
    }
    return typeof value === "function" ? value.bind(target) : value;
  } }) as LifecycleIO;
  try {
    const contextKeys = ["snapshot_digest", "source_release_digest", "module_lock_digest", "selection_digest", "destination_identity_digest", "destination_observation_digest", "binding_digest", "configuration_generation_digest", "prepared_intent_digest", "preimage_digest", "destination_id", "issued_device_ref", "profile", "backend", "selected_modules"];
    if (!binding || Object.keys(binding).length !== 4 || !/^sha256:[a-f0-9]{64}$/.test(binding.plan_digest) || !/^[a-f0-9]{64}$/.test(binding.destinations_digest)
      || !binding.context || Object.keys(binding.context).length !== contextKeys.length || contextKeys.some(key => !Object.hasOwn(binding.context,key))
      || contextKeys.slice(0,10).some(key => typeof binding.context[key] !== "string" || !/^sha256:[a-f0-9]{64}$/.test(binding.context[key] as string))
      || !["workstation", "always-on-node"].includes(binding.context.profile as string) || !["none", "9router", "omniroute"].includes(binding.context.backend as string)
      || !Array.isArray(binding.context.selected_modules) || binding.context.selected_modules.some(id => typeof id !== "string")
      || typeof binding.context.destination_id !== "string" || typeof binding.context.issued_device_ref !== "string") throw new Error("TRANSACTION_INVALID");
    if (!/^[a-f0-9]{12}-[a-f0-9]{8}$/.test(txid) || !/^[a-f0-9]{32}$/.test(binding.claim_nonce) || !options.intent.length) throw new Error("TRANSACTION_INVALID");
    await options.assertAuthority();
    if (action !== "status" && !io.renameNoReplace) throw new Error("ATOMIC_CUSTODY_UNSUPPORTED");
    // Resolve the complete path set, rejecting aliases and transaction overlap.
    const paths: string[] = [];
    const rootFacts: unknown[] = [];
    for (const item of options.intent) {
      assertDestination(item.step.destination);
      const root = resolve(resolveRoot(item.step.destination.root_token));
      const path = resolve(root, item.step.destination.relative_path);
      await safePath(io, root, path, "file");
      const stat = await io.lstat(root);
      rootFacts.push([item.step.step_id, await io.realpath(root), stat.dev, stat.ino, path.normalize("NFC").toLowerCase()]);
      const key = path.normalize("NFC").toLowerCase();
      const stateKey = resolve(stateRoot).normalize("NFC").toLowerCase();
      if (paths.some(p => p === key || p.startsWith(`${key}/`) || key.startsWith(`${p}/`)) || key === stateKey || key.startsWith(`${stateKey}/`) || stateKey.startsWith(`${key}/`)) throw new Error("DESTINATION_COLLISION");
      paths.push(key);
    }
    if (sha256(JSON.stringify(rootFacts)) !== binding.destinations_digest) throw new Error("DESTINATION_BINDING_DRIFT");
    if (action === "apply") {
      // Refuse reusing an existing transaction, including orphan artifacts.
      try { await io.lstat(txDir); throw new Error("TRANSACTION_EXISTS"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (!options.prepared || options.prepared.size !== options.intent.length) throw new Error("PREPARED_INTENT_MISSING");
      for (const item of options.intent) {
        const output = options.prepared.get(item.step.step_id);
        if (!output || !transactionEqual(output.step, item.step) || output.expected_hash !== item.expected_hash || output.expected_mode !== item.expected_mode || sha256(output.content) !== item.expected_hash || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/u.test(output.content)) throw new Error("PREPARED_INTENT_DRIFT");
        const root = resolveRoot(item.step.destination.root_token), path = join(root, item.step.destination.relative_path);
        let stat; try { stat = await io.lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (stat) await options.assertOwnedPreimage(item.step.step_id);
        const hash = stat ? sha256(await io.readFile(path)) : null;
        if (preparedPreimageDigest(hash, stat ? stat.mode & 0o7777 : null) !== item.preimage_digest) throw new Error("PREIMAGE_DRIFT");
      }
      await io.mkdir(stateRoot, { recursive: true });
      await safePath(io, stateRoot, claim, "directory");
      // Bootstrap privately in the existing transaction store. Only a complete
      // captured BEGIN is published. Failure cannot strand an empty global claim.
      await Journal.create(stateRoot, io, txid);
      await io.chmod(txDir, 0o700);
      await io.chmod(join(txDir, "preimage"), 0o700);
      await io.mkdir(privateClaim, { recursive: false });
      await io.chmod(privateClaim, 0o700);
      await io.writeFileAtomic(join(privateClaim, "owner.json"), owner, { mode: 0o600 });
      selectClaim(privateClaim);
    }
    if (action === "release") {
      const releasedOwner = await readLifecycleMetadata(io, stateRoot, join(releasedClaim, "owner.json"), true);
      if (releasedOwner !== null) { if (releasedOwner !== owner) throw new Error("RELEASE_BINDING_DRIFT"); released = true; selectClaim(releasedClaim); }
      else if (await readLifecycleMetadata(io, stateRoot, join(privateClaim, "owner.json"), true) === owner) selectClaim(privateClaim);
    }
    if (action !== "apply") {
      const marker = await readLifecycleMetadata(io, stateRoot, join(currentClaim, "capture.json"), true);
      if (marker !== null && marker !== owner) throw new Error("CAPTURE_BINDING_DRIFT");
      captureStarted = marker !== null;
    }
    await guard();
    const acquireActive = async () => {
      await io.mkdir(activePath, { recursive: false });
      await io.writeFileAtomic(activeOwnerPath, activeNonce, { mode: 0o600 });
      active = true;
      await guard();
    };
    if (action !== "apply" && action !== "status" && !released) await acquireActive();
    const releaseEvidence = async (): Promise<PreparedReleaseEvidence> => {
      const artifacts: PreparedReleaseEvidence["artifacts"] = [];
      const walk = async (relative: string): Promise<void> => {
        const path = join(txDir, relative);
        await safePath(io, stateRoot, path, "directory");
        const stat = await io.lstat(path);
        artifacts.push({ path: relative, mode: stat.mode & 0o7777, hash: null });
        for (const name of (await io.readdir(path)).sort()) {
          if (!relative && ["prepared-claim", "released-claim"].includes(name)) continue;
          const child = relative ? `${relative}/${name}` : name, full = join(txDir, child);
          const st = await io.lstat(full);
          if (st.isDirectory() && !st.isSymbolicLink()) await walk(child);
          else {
            const content = await readLifecycleMetadata(io, stateRoot, full);
            if (content === null) throw new Error("RELEASE_EVIDENCE_DRIFT");
            artifacts.push({ path: child, mode: (await io.lstat(full)).mode & 0o7777, hash: sha256(content) });
          }
        }
      };
      await walk("");
      const destinations: PreparedReleaseEvidence["destinations"] = [];
      for (const item of options.intent) {
        const root = resolveRoot(item.step.destination.root_token), path = join(root, item.step.destination.relative_path);
        const content = await readLifecycleMetadata(io, root, path);
        destinations.push({ step_id: item.step.step_id, hash: content === null ? null : sha256(content), mode: content === null ? null : (await io.lstat(path)).mode & 0o7777 });
      }
      return { kind: unpublishedRelease ? "unpublished" : "terminal", binding, capture_started: captureStarted, artifacts, destinations };
    };
    const releaseClaim = async () => {
      await guard();
      const before = await releaseEvidence();
      await options.assertReleaseEvidence?.(before);
      if (released) return result("released", "VERIFIED");
      if (unpublishedRelease) {
        const path = join(currentClaim, "unpublished-release.json"), marker = await readLifecycleMetadata(io, stateRoot, path, true);
        if (marker !== null && marker !== owner) throw new Error("RELEASE_BINDING_DRIFT");
        if (marker === null) await guarded.writeFileAtomic(path, owner, { mode: 0o600 });
      }
      const claimNames = ["active", "owner.json", ...(captureStarted ? ["capture.json"] : []), ...(unpublishedRelease ? ["unpublished-release.json"] : [])].sort();
      if (!transactionEqual((await io.readdir(currentClaim)).sort(), claimNames)) throw new Error("CLAIM_CONTENT_UNKNOWN");
      if (!transactionEqual(await io.readdir(activePath), ["owner.json"])) throw new Error("CLAIM_CONTENT_UNKNOWN");
      // Atomically move the exact authenticated claim, retaining its provenance
      // in the existing transaction store. No deletion or silent takeover.
      const after = await releaseEvidence();
      if (!transactionEqual(before, after)) throw new Error("RELEASE_EVIDENCE_DRIFT");
      await options.assertReleaseEvidence?.(after);
      await guarded.renameNoReplace!(currentClaim, releasedClaim);
      active = false;
      released = true;
      selectClaim(releasedClaim);
      await assertClaim();
      return result("released", "VERIFIED");
    };
    if (action === "release" && released) {
      const marker = await readLifecycleMetadata(io, stateRoot, join(releasedClaim, "unpublished-release.json"), true);
      if (marker !== null && marker !== owner) throw new Error("RELEASE_BINDING_DRIFT");
      unpublishedRelease = marker === owner;
    }
    if (action === "release" && (currentClaim === privateClaim || unpublishedRelease)) {
      unpublishedRelease = true;
      // Exclusive publication consumes prepared-claim. Retained private capture
      // can be released against a winner's CURRENT bytes only with separately
      // authenticated release evidence and an intact, purely preparatory BEGIN.
      // No destination ownership is inferred and no winner state is mutated.
      let foreignPublication: string | undefined;
      assertArtifacts = async () => {
        let globalPresent = false;
        try { await io.lstat(claim); globalPresent = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        let observedPublication = "absent";
        if (globalPresent) {
          const closed = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
            && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
          const digest = (value: unknown): boolean => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
          const ref = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value)
            && !value.includes("..") && !/localhost|127\.0\.0\.1|https?:/i.test(value);
          const raw = await readLifecycleMetadata(io, stateRoot, join(claim, "owner.json"), true);
          const globalOwner: unknown = raw === null ? null : JSON.parse(raw);
          if (!closed(globalOwner, ["txid", "binding"]) || typeof globalOwner.txid !== "string" || !/^[a-f0-9]{12}-[a-f0-9]{8}$/.test(globalOwner.txid)
            || !closed(globalOwner.binding, ["plan_digest", "context", "claim_nonce", "destinations_digest"])) throw new Error("PUBLICATION_AMBIGUOUS");
          const foreign = globalOwner.binding, context = foreign.context;
          if (!digest(foreign.plan_digest) || typeof foreign.claim_nonce !== "string" || !/^[a-f0-9]{32}$/.test(foreign.claim_nonce)
            || typeof foreign.destinations_digest !== "string" || !/^[a-f0-9]{64}$/.test(foreign.destinations_digest) || !closed(context, contextKeys)
            || contextKeys.slice(0, 10).some(key => !digest(context[key])) || !ref(context.destination_id) || !ref(context.issued_device_ref)
            || !["workstation", "always-on-node"].includes(context.profile as string) || !["none", "9router", "omniroute"].includes(context.backend as string)
            || !Array.isArray(context.selected_modules) || context.selected_modules.length > 4096 || !context.selected_modules.every(ref)
            || new Set(context.selected_modules).size !== context.selected_modules.length || globalOwner.txid === txid || foreign.claim_nonce === binding.claim_nonce) throw new Error("PUBLICATION_AMBIGUOUS");
          // A published migration claim always has captured BEGIN first. This
          // checks retained structural consistency, NOT another owner's authority
          // or current source freshness, and never permits acting on their state.
          const foreignTx = join(stateRoot, "transactions", globalOwner.txid);
          const history = await readLifecycleMetadata(io, stateRoot, join(foreignTx, "journal.json"), true);
          const entries: unknown = history === null ? null : JSON.parse(history);
          const kinds = ["BEGIN", "STAGE", "COMMIT_STEP", "COMPENSATE", "ABORT", "COMPLETE", "CUSTODY", "CUSTODY_HOLD"];
          if (!Array.isArray(entries) || !entries.length || entries.some(entry => !entry || typeof entry !== "object" || Array.isArray(entry) || !kinds.includes(entry.kind))
            || entries.filter(entry => entry.kind === "BEGIN").length !== 1) throw new Error("PUBLICATION_AMBIGUOUS");
          const begin = entries[0];
          if (!closed(begin, ["kind", "ts", "verb", "profile", "inventory_digest", "surface_manifest_sha256", "transaction_binding"])
            || begin.kind !== "BEGIN" || typeof begin.ts !== "string" || !Number.isFinite(Date.parse(begin.ts)) || begin.verb !== "migrate"
            || begin.profile !== context.profile || begin.inventory_digest !== context.source_release_digest || typeof begin.surface_manifest_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(begin.surface_manifest_sha256)
            || !transactionEqual(begin.transaction_binding, foreign)) throw new Error("PUBLICATION_AMBIGUOUS");
          const capture = await readLifecycleMetadata(io, stateRoot, join(claim, "capture.json"), true);
          const manifest = await readLifecycleMetadata(io, stateRoot, join(foreignTx, "surface-manifest.json"), true);
          if (capture !== raw || manifest === null || sha256(manifest) !== begin.surface_manifest_sha256) throw new Error("PUBLICATION_AMBIGUOUS");
          const foreignManifest = validateSurfaceManifest(JSON.parse(manifest));
          if (foreignManifest.leaves.some(leaf => !(context.selected_modules as string[]).includes(leaf.record_id))) throw new Error("PUBLICATION_AMBIGUOUS");
          assertForeignMigrationHistory(entries, foreignManifest);
          observedPublication = sha256(canonical([raw, history, capture, manifest]));
        }
        if (foreignPublication !== undefined && foreignPublication !== observedPublication) throw new Error("PUBLICATION_DRIFT");
        foreignPublication = observedPublication;
        const raw = await readLifecycleMetadata(io, stateRoot, join(txDir, "journal.json"), true);
        const entries = raw === null ? [] : JSON.parse(raw);
        const keys = ["kind", "ts", "verb", "profile", "inventory_digest", "surface_manifest_sha256", "transaction_binding"];
        if (!Array.isArray(entries) || entries.length > 1) throw new Error("UNPUBLISHED_HISTORY_AMBIGUOUS");
        const begin = entries[0];
        if (entries.length && (!begin || typeof begin !== "object")) throw new Error("UNPUBLISHED_HISTORY_AMBIGUOUS");
        if (begin && (Object.keys(begin).length !== keys.length || keys.some(key => !Object.hasOwn(begin, key)) || begin.kind !== "BEGIN"
          || typeof begin.ts !== "string" || !Number.isFinite(Date.parse(begin.ts)) || begin.verb !== "migrate" || begin.profile !== options.profile || begin.inventory_digest !== binding.context.source_release_digest
          || !transactionEqual(begin.transaction_binding, binding) || !captureStarted)) throw new Error("UNPUBLISHED_HISTORY_AMBIGUOUS");
        const evidence = await releaseEvidence();
        const allowed = new Set(["", "output", "preimage", "surface-manifest.json", "journal.json"]);
        for (const item of options.intent) for (const dir of ["output", "preimage"]) allowed.add(`${dir}/surface-${sha256(item.step.step_id)}.txt`);
        if (evidence.artifacts.some(artifact => !allowed.has(artifact.path))) throw new Error("UNPUBLISHED_EFFECT_EVIDENCE");
        if (begin) {
          const manifestBytes = await readLifecycleMetadata(io, stateRoot, join(txDir, "surface-manifest.json"), true);
          const manifest = await loadSurfaceManifest(io, txDir);
          if (manifestBytes === null || sha256(manifestBytes) !== begin.surface_manifest_sha256 || !manifest || manifest.leaves.length !== options.intent.length) throw new Error("SURFACE_MANIFEST_DRIFT");
          const expected = new Set(["", "output", "preimage", "surface-manifest.json", "journal.json"]);
          for (const leaf of manifest.leaves) {
            const intent = options.intent.find(item => item.step.step_id === leaf.step_id);
            if (!intent || leaf.root_token !== intent.step.destination.root_token || leaf.relative_path !== intent.step.destination.relative_path || leaf.record_id !== intent.step.record_id || leaf.ownership !== "exclusive-path"
              || leaf.expected_hash !== intent.expected_hash || leaf.expected_mode !== intent.expected_mode || preparedPreimageDigest(leaf.prior_hash, leaf.prior_mode) !== intent.preimage_digest) throw new Error("SURFACE_INTENT_DRIFT");
            expected.add(leaf.output);
            const output = evidence.artifacts.find(artifact => artifact.path === leaf.output);
            if (output?.hash !== leaf.expected_hash || output.mode !== leaf.expected_mode) throw new Error("SURFACE_OUTPUT_DRIFT");
            if (leaf.preimage) {
              expected.add(leaf.preimage);
              const prior = evidence.artifacts.find(artifact => artifact.path === leaf.preimage);
              if (prior?.hash !== leaf.prior_hash || prior.mode !== 0o600) throw new Error("PREIMAGE_DRIFT");
            }
          }
          if (expected.size !== evidence.artifacts.length || evidence.artifacts.some(artifact => !expected.has(artifact.path))) throw new Error("UNPUBLISHED_EFFECT_EVIDENCE");
        }
        for (const [index, current] of evidence.destinations.entries()) {
          const item = options.intent[index]!;
          if (preparedPreimageDigest(current.hash, current.mode) !== item.preimage_digest) {
            if (!options.assertReleaseEvidence || !begin) throw new Error("PREIMAGE_DRIFT");
          } else if (current.hash !== null) await options.assertOwnedPreimage(item.step.step_id);
        }
      };
      await assertArtifacts();
      return await releaseClaim();
    }
    if (action === "release") {
      let names: string[] | null = null;
      try { names = await io.readdir(txDir); } catch(error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      // Only an authenticated no-artifact claim can use this pre-BEGIN exit.
      // A partial output/preimage capture remains an explicit recovery hold.
      if (names === null || names.length === 0 || (released && transactionEqual(names, ["released-claim"]))) {
        if (captureStarted) throw new Error("CAPTURE_HISTORY_MISSING");
        for (const item of options.intent) {
          const root = resolveRoot(item.step.destination.root_token), path = join(root, item.step.destination.relative_path);
          const content = await readLifecycleMetadata(io, root, path);
          if (content !== null) await options.assertOwnedPreimage(item.step.step_id);
          const mode = content === null ? null : (await io.lstat(path)).mode & 0o7777;
          if (preparedPreimageDigest(content === null ? null : sha256(content), mode) !== item.preimage_digest) throw new Error("PREIMAGE_DRIFT");
        }
        if (!released && names === null) { await guarded.mkdir(join(stateRoot, "transactions"), { recursive: true }); await guarded.mkdir(txDir, { recursive: false }); }
        return await releaseClaim();
      }
    }
    if (action !== "apply" && !captureStarted) throw new Error("CAPTURE_BINDING_MISSING");
    let journal = Journal.open(txDir, guarded, true);
    if (action === "apply") {
      await guarded.writeFileAtomic(join(currentClaim, "capture.json"), owner, { mode: 0o600 });
      captureStarted = true;
      const manifest = await captureSurfaceManifest(guarded, txDir, options.prepared!, resolveRoot);
      for (const leaf of manifest.leaves) {
        const intent = options.intent.find(i => i.step.step_id === leaf.step_id)!;
        if (preparedPreimageDigest(leaf.prior_hash, leaf.prior_mode) !== intent.preimage_digest) throw new Error("PREIMAGE_DRIFT");
      }
      await journal.append({ kind: "BEGIN", ts: io.now().toISOString(), verb: "migrate", profile: options.profile, inventory_digest: binding.context.source_release_digest as string,
        surface_manifest_sha256: sha256(await io.readFile(join(txDir, "surface-manifest.json"))), transaction_binding: binding });
      await guarded.renameNoReplace!(privateClaim, claim);
      selectClaim(claim);
      await guard();
      await acquireActive();
    }
    // Disk, not the preceding calls' outcome or cache, is recovery authority.
    journal = Journal.open(txDir, guarded, true);
    const entries = await journal.readEntries();
    const entryKeys: Record<string, string[]> = {
      CUSTODY: ["kind", "ts", "step_id", "phase", "custody_ref", "expected_hash", "expected_mode"],
      CUSTODY_HOLD: ["kind", "ts", "step_id", "custody_ref", "observed_hash", "observed_mode", "returned"],
      BEGIN: ["kind", "ts", "verb", "profile", "inventory_digest", "surface_manifest_sha256", "transaction_binding"],
      STAGE: ["kind", "ts", "step_id", "destination_symbolic", "mode"], COMMIT_STEP: ["kind", "ts", "step_id"],
      COMPENSATE: ["kind", "ts", "step_id", "method"], ABORT: ["kind", "ts", "reason"], COMPLETE: ["kind", "ts", "receipt_ref"],
    };
    const seenStages = new Set<string>(), seenCommits = new Set<string>(), seenCompensates = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      const keys = entry && entryKeys[entry.kind];
      if (!keys || Object.keys(entry).length !== keys.length || keys.some(key => !Object.hasOwn(entry, key)) || !Number.isFinite(Date.parse(entry.ts))) throw new Error("JOURNAL_INVALID");
      if (entry.kind === "BEGIN" && (index !== 0 || entry.verb !== "migrate" || entry.profile !== options.profile || entry.inventory_digest !== binding.context.source_release_digest)) throw new Error("JOURNAL_INVALID");
      if (entry.kind === "STAGE") {
        const item = options.intent.find(i => i.step.step_id === entry.step_id);
        if (!item || entry.mode !== "install" || entry.destination_symbolic !== `$${item.step.destination.root_token}/${item.step.destination.relative_path}`) throw new Error("JOURNAL_INVALID");
        seenStages.add(entry.step_id);
      }
      if (entry.kind === "COMMIT_STEP") { if (!seenStages.has(entry.step_id)) throw new Error("JOURNAL_INVALID"); seenCommits.add(entry.step_id); }
      if (entry.kind === "COMPENSATE") { if (entry.method !== "verified-surface-leaf") throw new Error("JOURNAL_INVALID"); seenCompensates.add(entry.step_id); }
      if (entry.kind === "ABORT" && entry.reason !== "ROLLBACK_REQUESTED") throw new Error("JOURNAL_INVALID");
      if (entry.kind === "COMPLETE" && (entry.receipt_ref !== "receipt.json" || (seenCommits.size !== options.intent.length && seenCompensates.size !== options.intent.length))) throw new Error("JOURNAL_INVALID");
    }
    const begins = entries.filter(e => e.kind === "BEGIN");
    const begin = begins[0];
    if (begins.length !== 1 || !begin || !transactionEqual(begin.transaction_binding, binding)) throw new Error("TRANSACTION_UNBOUND");
    await safePath(io, txDir, join(txDir, "surface-manifest.json"), "file");
    if ((await io.lstat(join(txDir, "surface-manifest.json"))).mode % 0o10000 !== 0o600) throw new Error("MANIFEST_MODE_DRIFT");
    const manifest = await loadSurfaceManifest(io, txDir);
    if (!manifest || manifest.leaves.length !== options.intent.length || sha256(await io.readFile(join(txDir, "surface-manifest.json"))) !== begin.surface_manifest_sha256) throw new Error("SURFACE_MANIFEST_DRIFT");
    assertArtifacts = async () => {
      const manifestPath = join(txDir, "surface-manifest.json");
      await safePath(io, txDir, manifestPath, "file");
      if (((await io.lstat(manifestPath)).mode & 0o7777) !== 0o600 || sha256(await io.readFile(manifestPath)) !== begin.surface_manifest_sha256) throw new Error("SURFACE_MANIFEST_DRIFT");
      for (const leaf of manifest.leaves) {
        await verifySurfaceOutput(io, leaf, join(txDir, leaf.output), txDir);
        if (leaf.preimage) {
          const preimage = join(txDir, leaf.preimage);
          await safePath(io, txDir, preimage, "file");
          if (((await io.lstat(preimage)).mode & 0o7777) !== 0o600 || sha256(await io.readFile(preimage)) !== leaf.prior_hash) throw new Error("PREIMAGE_DRIFT");
        }
      }
    };
    const custodyRef = (id: string, phase: "apply" | "rollback") => `preimage/custody-${phase}-${sha256(id)}.txt`;
    const fileState = async (root: string, path: string) => {
      const content = await readLifecycleMetadata(io, root, path);
      return content === null ? null : { content, hash: sha256(content), mode: (await io.lstat(path)).mode & 0o7777 };
    };
    const custodyIntents = new Set<string>();
    const capturedRefs = new Set<string>();
    let returningForeign: { ref: string; hash: string; mode: number } | null = null;
    for (const entry of entries) {
      if (entry.kind === "CUSTODY_HOLD") throw new Error("FOREIGN_CUSTODY_HELD");
      if (entry.kind !== "CUSTODY") continue;
      const leaf = manifest.leaves.find(l => l.step_id === entry.step_id);
      if (!leaf || !["apply", "rollback"].includes(entry.phase) || entry.custody_ref !== custodyRef(entry.step_id, entry.phase)
        || entry.expected_hash !== (entry.phase === "apply" ? leaf.prior_hash : leaf.expected_hash) || entry.expected_mode !== (entry.phase === "apply" ? leaf.prior_mode : leaf.expected_mode)) throw new Error("CUSTODY_INVALID");
      custodyIntents.add(entry.custody_ref);
      const captured = await fileState(txDir, join(txDir, entry.custody_ref));
      if (captured && (captured.hash !== entry.expected_hash || captured.mode !== entry.expected_mode)) throw new Error("FOREIGN_CUSTODY_HELD");
      if (captured) capturedRefs.add(entry.custody_ref);
      if (!captured && entry.phase === "apply" && seenCommits.has(entry.step_id)) throw new Error("CUSTODY_MISSING");
    }
    // Custody paths are bound to a durable intent before a public path can move.
    for (const leaf of manifest.leaves) for (const phase of ["apply", "rollback"] as const) {
      const ref = custodyRef(leaf.step_id, phase);
      if (!custodyIntents.has(ref) && await fileState(txDir, join(txDir, ref))) throw new Error("UNBOUND_CUSTODY");
    }
    assertCustody = async () => {
      for (const leaf of manifest.leaves) for (const phase of ["apply", "rollback"] as const) {
        const ref = custodyRef(leaf.step_id, phase);
        if (!custodyIntents.has(ref)) continue;
        const captured = await fileState(txDir, join(txDir, ref));
        if (returningForeign?.ref === ref) {
          if (captured && (captured.hash !== returningForeign.hash || captured.mode !== returningForeign.mode)) throw new Error("FOREIGN_CUSTODY_DRIFT");
          continue;
        }
        if (!captured) { if (capturedRefs.has(ref)) throw new Error("CUSTODY_MISSING"); continue; }
        if (captured.hash !== (phase === "apply" ? leaf.prior_hash : leaf.expected_hash) || captured.mode !== (phase === "apply" ? leaf.prior_mode : leaf.expected_mode)) throw new Error("CUSTODY_DRIFT");
        capturedRefs.add(ref);
      }
    };
    const states = new Map<string, "prior" | "expected" | "both" | "vacant">();
    const observeLeaf = async (leaf: SurfaceManifest["leaves"][number]): Promise<"prior" | "expected" | "both" | "vacant"> => {
      const root = resolveRoot(leaf.root_token), path = join(root, leaf.relative_path);
      await safePath(io, root, path, "file");
      let stat; try { stat = await io.lstat(path); } catch(error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const hash = stat ? sha256(await io.readFile(path)) : null, mode = stat ? stat.mode & 0o7777 : null;
      await safePath(io, root, path, "file");
      if (stat) { const after = await io.lstat(path); if (after.dev !== stat.dev || after.ino !== stat.ino || after.mode !== stat.mode || after.mtimeMs !== stat.mtimeMs || after.size !== stat.size) throw new Error("DESTINATION_READ_DRIFT"); }
      if (hash === leaf.prior_hash && mode === leaf.prior_mode && hash === leaf.expected_hash && mode === leaf.expected_mode) return "both";
      if (hash === leaf.prior_hash && mode === leaf.prior_mode) return "prior";
      if (hash === leaf.expected_hash && mode === leaf.expected_mode) return "expected";
      if (hash === null) for (const phase of ["apply", "rollback"] as const) {
        const ref = custodyRef(leaf.step_id, phase);
        if (custodyIntents.has(ref) && await fileState(txDir, join(txDir, ref))) return "vacant";
      }
      throw new Error("DESTINATION_DRIFT");
    };
    for (const leaf of manifest.leaves) {
      const intent = options.intent.find(i => i.step.step_id === leaf.step_id);
      if (!intent || leaf.root_token !== intent.step.destination.root_token || leaf.relative_path !== intent.step.destination.relative_path || leaf.record_id !== intent.step.record_id || leaf.ownership !== "exclusive-path" || leaf.expected_hash !== intent.expected_hash || leaf.expected_mode !== intent.expected_mode || preparedPreimageDigest(leaf.prior_hash, leaf.prior_mode) !== intent.preimage_digest) throw new Error("SURFACE_INTENT_DRIFT");
      await verifySurfaceOutput(io, leaf, join(txDir, leaf.output), txDir);
      if (leaf.preimage) {
        await options.assertOwnedPreimage(leaf.step_id);
        const path = join(txDir, leaf.preimage);
        await safePath(io, txDir, path, "file");
        if (sha256(await io.readFile(path)) !== leaf.prior_hash || ((await io.lstat(path)).mode & 0o7777) !== 0o600) throw new Error("PREIMAGE_DRIFT");
      }
      const observed = await observeLeaf(leaf);
      for (const phase of ["apply", "rollback"] as const) {
        const ref = custodyRef(leaf.step_id, phase);
        if (custodyIntents.has(ref) && ((phase === "apply" && observed === "expected") || (phase === "rollback" && observed === "prior")) && !capturedRefs.has(ref)) throw new Error("CUSTODY_MISSING");
      }
      states.set(leaf.step_id, observed);
    }
    if (entries.some(e => "step_id" in e && !states.has(e.step_id))) throw new Error("JOURNAL_SCOPE_DRIFT");
    const receipt = await readReceipt(txid, stateRoot, io, true);
    if (receipt && (!transactionEqual(receipt.transaction_binding, binding) || receipt.surface_manifest_sha256 !== begin.surface_manifest_sha256 || receipt.txid !== txid)) throw new Error("RECEIPT_DRIFT");
    if (receipt) {
      const keys = ["schema", "txid", "verb", "profile", "inventory_digest", "started_at", "finished_at", "status", "steps", "user_content_preserved", "transaction_binding", "surface_manifest_sha256", "recovery_outcome"];
      if (Object.keys(receipt).length !== keys.length || keys.some(key => !Object.hasOwn(receipt, key)) || receipt.verb !== "migrate" || receipt.profile !== options.profile || receipt.status !== "committed" || receipt.inventory_digest !== binding.context.source_release_digest || receipt.started_at !== begin.ts || !Number.isFinite(Date.parse(receipt.finished_at)) || !["applied", "rolled-back"].includes(receipt.recovery_outcome!) || !transactionEqual(receipt.user_content_preserved, []) || !transactionEqual(receipt.steps, manifest.leaves.map(leaf => ({ id: leaf.step_id, record_id: leaf.record_id, destination_symbolic: `$${leaf.root_token}/${leaf.relative_path}`, outcome: "installed" })))) throw new Error("RECEIPT_DRIFT");
    }
    const compensated = new Set(entries.filter(e => e.kind === "COMPENSATE").map(e => e.step_id));
    const staged = new Set(entries.filter(e => e.kind === "STAGE").map(e => e.step_id));
    // Expected bytes without a durable stage are not ownership evidence.
    if (manifest.leaves.some(leaf => states.get(leaf.step_id) === "expected" && !staged.has(leaf.step_id))) throw new Error("OWNERSHIP_UNPROVEN");
    const terminalComplete = entries.at(-1)?.kind === "COMPLETE";
    const rolledBack = terminalComplete && compensated.size === manifest.leaves.length && [...states.values()].every(s => s === "prior" || s === "both") && receipt?.recovery_outcome === "rolled-back";
    const committed = terminalComplete && receipt?.recovery_outcome === "applied" && [...states.values()].every(s => s === "expected" || s === "both");
    if (action === "status") return rolledBack ? result("rolled-back", "VERIFIED") : committed ? result("committed", "VERIFIED") : result("incomplete", "INTERRUPTED");
    if (action === "release") {
      if (!rolledBack && !committed) throw new Error("RELEASE_REQUIRES_TERMINAL_PROOF");
      return await releaseClaim();
    }
    if (rolledBack) return result("rolled-back", "VERIFIED");
    if (committed && action === "resume") return result("committed", "VERIFIED");
    if (action !== "rollback" && (entries.some(e => e.kind === "ABORT") || compensated.size || receipt?.recovery_outcome === "rolled-back")) {
      if (rolledBack) return result("rolled-back", "VERIFIED");
      throw new Error("COMPENSATION_INCOMPLETE");
    }
    const holdForeign = async (leaf: SurfaceManifest["leaves"][number], ref: string, captured: { hash: string; mode: number }) => {
      let returned = false;
      returningForeign = { ref, ...captured };
      // Actual exclusive rename preserves a concurrently inserted destination.
      // If vacant, return the foreign file; otherwise retain authenticated custody.
      try { await guarded.renameNoReplace!(join(txDir, ref), join(resolveRoot(leaf.root_token), leaf.relative_path)); returned = true; } catch { /* preserved in custody or uncertain: reread below */ }
      const stillCaptured = await fileState(txDir, join(txDir, ref));
      if (!stillCaptured) {
        const current = await fileState(resolveRoot(leaf.root_token), join(resolveRoot(leaf.root_token), leaf.relative_path));
        returned = current?.hash === captured.hash && current.mode === captured.mode;
      }
      await journal.append({ kind: "CUSTODY_HOLD", ts: io.now().toISOString(), step_id: leaf.step_id, custody_ref: ref, observed_hash: captured.hash, observed_mode: captured.mode, returned });
      throw new Error("FOREIGN_CUSTODY_HELD");
    };
    const takeCustody = async (leaf: SurfaceManifest["leaves"][number], phase: "apply" | "rollback") => {
      const root = resolveRoot(leaf.root_token), path = join(root, leaf.relative_path), ref = custodyRef(leaf.step_id, phase), capturedPath = join(txDir, ref);
      const hash = phase === "apply" ? leaf.prior_hash : leaf.expected_hash;
      const mode = phase === "apply" ? leaf.prior_mode : leaf.expected_mode;
      if (hash === null) return; // absent preimage: the final exclusive rename is the fence.
      if (!custodyIntents.has(ref)) {
        await journal.append({ kind: "CUSTODY", ts: io.now().toISOString(), step_id: leaf.step_id, phase, custody_ref: ref, expected_hash: hash, expected_mode: mode! });
        custodyIntents.add(ref);
      }
      let captured = await fileState(txDir, capturedPath);
      if (!captured) {
        await guarded.renameNoReplace!(path, capturedPath);
        captured = await fileState(txDir, capturedPath);
      }
      if (!captured) throw new Error("CUSTODY_UNOBSERVABLE");
      if (captured.hash !== hash || captured.mode !== mode) await holdForeign(leaf, ref, captured);
      capturedRefs.add(ref);
    };
    if (action === "rollback") {
      if (!entries.some(e => e.kind === "ABORT")) await journal.append({ kind: "ABORT", ts: io.now().toISOString(), reason: "ROLLBACK_REQUESTED" });
      await guard();
      for (const leaf of [...manifest.leaves].reverse()) {
        const state = await observeLeaf(leaf);
        if (state === "prior" || state === "both") continue;
        const root = resolveRoot(leaf.root_token), path = join(root, leaf.relative_path);
        if (state !== "vacant") await takeCustody(leaf, "rollback");
        if (leaf.preimage) {
          const stage = join(root, `.temperance-stage-restore-${txid}-${sha256(leaf.step_id)}`);
          const prior = await fileState(txDir, join(txDir, leaf.preimage));
          if (!prior || prior.hash !== leaf.prior_hash) throw new Error("PREIMAGE_DRIFT");
          const existing = await fileState(root, stage);
          if (!existing) await guarded.writeFileAtomic(stage, prior.content, { mode: leaf.prior_mode! });
          const staged = await fileState(root, stage);
          if (staged?.hash !== leaf.prior_hash || staged.mode !== leaf.prior_mode) throw new Error("RESTORE_STAGE_DRIFT");
          await guarded.renameNoReplace!(stage, path);
        }
        await assertSurfacePrior(io, leaf, resolveRoot);
      }
      for (const leaf of manifest.leaves) {
        await assertSurfacePrior(io, leaf, resolveRoot);
        if (!compensated.has(leaf.step_id)) await journal.append({ kind: "COMPENSATE", ts: io.now().toISOString(), step_id: leaf.step_id, method: "verified-surface-leaf" });
      }
    } else {
      for (const leaf of manifest.leaves) {
        await guard();
        if (!staged.has(leaf.step_id)) await journal.append({ kind: "STAGE", ts: io.now().toISOString(), step_id: leaf.step_id, destination_symbolic: `$${leaf.root_token}/${leaf.relative_path}`, mode: "install" });
        const observed = await observeLeaf(leaf);
        if (observed === "prior" || observed === "vacant") {
          const root = resolveRoot(leaf.root_token), path = join(root, leaf.relative_path);
          const stage = join(root, `.temperance-stage-${txid}-${sha256(leaf.step_id)}`);
          await safePath(io, root, stage, "file");
          let present = false; try { await io.lstat(stage); present = true; } catch(error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          if (!present) await guarded.writeFileAtomic(stage, await io.readFile(join(txDir, leaf.output)), { mode: leaf.expected_mode });
          await verifySurfaceOutput(io, leaf, stage, root);
          await guarded.mkdir(dirname(path), { recursive: true });
          if (observed !== "vacant") await assertSurfacePrior(io, leaf, resolveRoot);
          await verifySurfaceOutput(io, leaf, stage, root);
          await takeCustody(leaf, "apply");
          await guarded.renameNoReplace!(stage, path);
          await verifySurfaceOutput(io, leaf, path, root);
        }
        await verifySurfaceOutput(io, leaf, join(resolveRoot(leaf.root_token), leaf.relative_path), resolveRoot(leaf.root_token));
        if (!entries.some(e => e.kind === "COMMIT_STEP" && e.step_id === leaf.step_id)) await journal.append({ kind: "COMMIT_STEP", ts: io.now().toISOString(), step_id: leaf.step_id });
      }
    }
    await guard();
    await writeReceipt({ txid, verb: "migrate", profile: options.profile, inventory_digest: binding.context.source_release_digest as `sha256:${string}`,
      started_at: begin.ts, finished_at: io.now().toISOString(), status: "committed", steps: manifest.leaves.map(leaf => ({ id: leaf.step_id, record_id: leaf.record_id, destination_symbolic: `$${leaf.root_token}/${leaf.relative_path}`, outcome: "installed" })), user_content_preserved: [],
      transaction_binding: binding, surface_manifest_sha256: begin.surface_manifest_sha256, recovery_outcome: action === "rollback" ? "rolled-back" : "applied" }, txDir, guarded);
    await journal.append({ kind: "COMPLETE", ts: io.now().toISOString(), receipt_ref: "receipt.json" });
    return result(action === "rollback" ? "rolled-back" : "committed", "VERIFIED");
  } catch (error) {
    // No cleanup or compensation is inferred from an uncertain mutation result.
    // Reopening with fresh IO reconciles the persisted intent and actual bytes.
    if ((error as Error).message === "ATOMIC_CUSTODY_UNSUPPORTED") return result("manual-recovery", "ATOMIC_CUSTODY_UNSUPPORTED");
    if ((error as Error).message === "FOREIGN_CUSTODY_HELD") return result("manual-recovery", "FOREIGN_CUSTODY_HELD");
    if ((error as Error).message === "OWNER_RECONCILIATION_REQUIRED") return result("unknown-effect", "OWNER_RECONCILIATION_REQUIRED");
    if (options.signal?.aborted) return result("incomplete", "INTERRUPTED");
    return result("manual-recovery", "RECOVERY_REQUIRED");
  } finally {
    if (active) try {
      await assertClaim();
      if (await readLifecycleMetadata(io, stateRoot, activeOwnerPath, true) === activeNonce && transactionEqual(await io.readdir(activePath), ["owner.json"])) await io.rm(activePath, { recursive: true, force: false });
    } catch { /* stale/unobservable claims are retained for explicit owner recovery */ }
  }
}
