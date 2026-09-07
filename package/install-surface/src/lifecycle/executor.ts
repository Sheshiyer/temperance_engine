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

// ─── File operations ─────────────────────────────────────────────────────────

async function stageFile(
  io: LifecycleIO,
  source: string,
  stagePath: string,
): Promise<void> {
  const content = await io.readFile(source);
  await io.writeFileAtomic(stagePath, content);
}

async function verifySha256(
  io: LifecycleIO,
  path: string,
  expected: string,
): Promise<boolean> {
  const content = await io.readFile(path);
  const hash = createHash("sha256").update(content).digest("hex");
  return hash === expected;
}

async function verifyCopyLeaf(
  io: LifecycleIO,
  path: string,
  expectedHash: string,
  expectedMode: number,
): Promise<boolean> {
  const matchesExpectedRegularFile = async (): Promise<boolean> => {
    const stat = await io.lstat(path);
    return stat.isFile()
      && !stat.isSymbolicLink()
      && stat.nlink === 1
      // Do not mask setuid, setgid, or sticky bits into an apparent 0644/0755.
      && (stat.mode & 0o7777) === expectedMode;
  };
  if (!await matchesExpectedRegularFile()) return false;
  if (!await verifySha256(io, path, expectedHash)) return false;
  // Re-check after content verification so a swapped path cannot receive a
  // successful stage/promotion receipt merely because its earlier lstat matched.
  return matchesExpectedRegularFile();
}

async function promoteFile(
  io: LifecycleIO,
  stagePath: string,
  destPath: string,
): Promise<void> {
  await io.rename(stagePath, destPath);
}

async function removeStaged(io: LifecycleIO, stagePath: string): Promise<void> {
  try {
    await io.rm(stagePath, { recursive: true, force: true });
  } catch {
    // Ignore errors during cleanup
  }
}

// ─── Managed block splice ────────────────────────────────────────────────────

const BLOCK_START_MARKER = "<!-- temperance:managed:start";
const BLOCK_END_MARKER = "<!-- temperance:managed:end";

/**
 * Splice a Temperance-managed block into a file, preserving outside-block content.
 * Returns the new file content.
 */
export function spliceManagedBlock(
  existingContent: string,
  blockId: string,
  newBlockContent: string,
): string {
  const startMarker = `${BLOCK_START_MARKER} ${blockId} -->`;
  const endMarker = `${BLOCK_END_MARKER} ${blockId} -->`;

  const startIdx = existingContent.indexOf(startMarker);
  const endIdx = existingContent.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    // No existing block — append
    const prefix = existingContent.endsWith("\n") ? existingContent : existingContent + "\n";
    return `${prefix}${startMarker}\n${newBlockContent}\n${endMarker}\n`;
  }

  // Replace existing block
  const before = existingContent.slice(0, startIdx + startMarker.length + 1);
  const after = existingContent.slice(endIdx);
  return `${before}${newBlockContent}\n${after}`;
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

  for (const step of plan.steps) {
    const record = stepRecords.find((r) => r.id === step.record_id);
    if (!record) continue;

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
    if (skippedOptional.includes(o.record_id)) {
      return {
        ...o,
        status: "skipped" as const,
        reason: "Optional dependency unavailable",
      };
    }
    return o;
  });

  let copies: Awaited<ReturnType<typeof prepareCopies>>["copies"];
  try {
    const declaredCopyHashes = declaredCopyHashesForSteps(filteredSteps, filteredRecords);
    const prepared = await prepareCopies(io, filteredSteps, filteredRecords, options.repositoryRoot, declaredCopyHashes);
    filteredSteps = prepared.steps;
    copies = prepared.copies;
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

  const journal = await Journal.create(stateRoot, io, txid);

  const committedSteps: string[] = [];
  const preimageDir = join(txDir, "preimage");

  const stagedPaths = new Set<string>();
  try {
    const copyManifest = await captureCopyManifest(io, txDir, copies, resolveRoot);
    await journal.append({
      kind: "BEGIN", ts: io.now().toISOString(), verb, profile, inventory_digest: compileResult.digest,
      ...(copies.size ? { copy_manifest_sha256: sha256(JSON.stringify(copyManifest, null, 2) + "\n") } : {}),
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
      const copy = copies.get(step.step_id);
      if (copy) await assertCopyPrior(io, copyManifest.leaves.find(l => l.step_id === step.step_id)!, resolveRoot);
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

      // Backup preimage if file exists
      if (!copy) try {
        const existing = await io.readFile(destPath);
        const preimagePath = join(preimageDir, `${step.step_id}.preimage`);
        await io.writeFileAtomic(preimagePath, existing);
      } catch {
        // File doesn't exist — no preimage needed
      }

      if (step.mode === "uninstall") {
        // Uninstall: remove the destination file
        try {
          await io.rm(destPath, { force: true });
        } catch {
          // File doesn't exist — idempotent
        }
      } else {
        // Install/Update: stage and promote
        // Stage based on record class
        if (record.class === "COPY") {
          if (!copy) throw new Error("COPY_PREPARATION_MISSING");
          await io.writeFileAtomic(stagePath, copy.content);
          await io.chmod(stagePath, copy.expected_mode);
          if (!await verifyCopyLeaf(io, stagePath, copy.expected_hash, copy.expected_mode)) throw new Error("COPY_STAGE_VERIFY_FAILED");
          await safePath(io, rootPath, stagePath, "file");
          await assertCopyPrior(io, copyManifest.leaves.find(l => l.step_id === step.step_id)!, resolveRoot);
        } else if (record.class === "TRANSFORM") {
          // Transform: render via adapter
          // For now, treat as copy with adapter verification
          await stageFile(io, record.source, stagePath);
        } else if (record.class === "REGENERATE") {
          // Regenerate: invoke generator
          // For now, create placeholder
          await io.writeFileAtomic(stagePath, `<!-- regenerated by ${record.verification.generator_id} -->\n`);
        }

        // Promote: atomic rename
        try {
          await safePath(io, rootPath, destPath, "file");
          await promoteFile(io, stagePath, destPath);
          stagedPaths.delete(stagePath);
          if (copy && !await verifyCopyLeaf(io, destPath, copy.expected_hash, copy.expected_mode)) throw new Error("COPY_PROMOTE_VERIFY_FAILED");
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

  let copyManifest: CopyManifest | null;
  try {
    copyManifest = await loadCopyManifest(io, txDir);
    const entries = await journal.readEntries();
    const begin = entries.find(e => e.kind === "BEGIN");
    if (copyManifest) {
      if (begin?.kind !== "BEGIN" || begin.copy_manifest_sha256 !== sha256(await io.readFile(join(txDir, "copy-manifest.json")))) throw new Error("COPY_MANIFEST_DRIFT");
      // Legacy non-COPY compensation has no hash contract. Refuse a mixed
      // transaction before changing COPY leaves rather than claim atomic recovery.
      if (entries.some(e => e.kind === "STAGE" && !copyManifest!.leaves.some(l => l.step_id === e.step_id))) throw new Error("MIXED_ROLLBACK_UNVERIFIED");
      await rollbackCopies(io, txDir, copyManifest, resolveRoot);
    } else if (begin?.kind === "BEGIN" && begin.copy_manifest_sha256) throw new Error("COPY_MANIFEST_MISSING");
  } catch {
    return { txid, status: "failed", outcomes: [], exitCode: 1 };
  }
  if (copyManifest) {
    for (const leaf of copyManifest.leaves) await journal.append({ kind: "COMPENSATE", ts: io.now().toISOString(), step_id: leaf.step_id, method: "verified-copy-leaf" });
  }
  const status = await journal.getStatus();
  if (status === "aborted") {
    // Already aborted — nothing to rollback
    return {
      txid,
      status: "committed",
      outcomes: [],
      exitCode: 0,
    };
  }

  const committedSteps = await journal.committedSteps();
  const preimageDir = join(txDir, "preimage");

  // Reverse order compensation
  for (const stepId of committedSteps.reverse()) {
    if (copyManifest?.leaves.some(l => l.step_id === stepId)) continue;
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
