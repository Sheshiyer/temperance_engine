/**
 * Compensation journal for transactional lifecycle (LIFE-01, LIFE-05).
 *
 * Transaction layout under TEMPERANCE_STATE:
 *   transactions/<txid>/{journal.json, preimage/, receipt.json, manifest-before.json, manifest-after.json}
 *
 * INVARIANT: Journal.append(entry) fsyncs THEN returns.
 * Callers mutate only after append() resolves — ordering enforced by API shape.
 *
 * Crash recovery: opening a tx dir whose journal lacks COMPLETE/ABORT
 * offers roll-forward (resume pending steps) or rollback from the journal alone.
 *
 * Retention: keep last N COMPLETE tx dirs (default 5), prune oldest first;
 * never touch incomplete ones.
 */

import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ─── IO seam ──────────────────────────────────────────────────────────────────

export interface LifecycleIO {
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  lstat(path: string): Promise<Stats>;
  chmod(path: string, mode: number): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  /** Optional actual OS atomic exclusive rename: destination existence MUST
   * prevent replacement for files AND directories. No check+rename or link+unlink
   * emulation. The caller
   * still reconciles rejection from disk; this alone is not power-loss fsync.
   */
  renameNoReplace?(oldPath: string, newPath: string): Promise<void>;
  realpath(path: string): Promise<string>;
  now(): Date;
  /** Atomic write + fsync: data is durable on disk before the promise resolves. */
  /** Atomic replacement with a caller-selected safe mode for staged outputs. */
  writeFileAtomic(path: string, data: string, options?: { mode?: number }): Promise<void>;
  fetch(url: string, options: { signal: AbortSignal }): Promise<Response>;
  execFile(
    file: string,
    args: readonly string[],
    options: { signal: AbortSignal },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/** Bounded metadata read: reject linked ancestors/leaves before content access. */
export async function readLifecycleMetadata(io: LifecycleIO, root: string, path: string, privateMode = false): Promise<string | null> {
  const { safePath } = await import("./copy-tree.ts");
  await safePath(io, root, path, "file");
  let before;
  try { before = await io.lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (privateMode && (before.mode & 0o7777) !== 0o600)) throw new Error("METADATA_UNSAFE");
  const content = await io.readFile(path);
  await safePath(io, root, path, "file");
  const after = await io.lstat(path);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.mode !== after.mode || after.nlink !== 1) throw new Error("METADATA_DRIFT");
  return content;
}
/** Independent origin markers prevent a damaged BEGIN from downgrading authority.
 * Unreadable markers conservatively hold; a true legacy transaction has none.
 */
export async function hasGuardedTransactionOrigin(txDir: string, io: LifecycleIO, entries: JournalEntry[]): Promise<boolean> {
  if (entries.some(e => e?.kind === "BEGIN" && (e.verb === "migrate" || Object.hasOwn(e, "transaction_binding")))) return true;
  const stateRoot = dirname(dirname(txDir));
  try {
    for (const path of [join(stateRoot, "prepared-transaction-claim", "owner.json"), join(txDir, "released-claim", "owner.json"), join(txDir, "prepared-claim", "owner.json")]) {
      const raw = await readLifecycleMetadata(io, stateRoot, path, true);
      if (raw !== null) { const claim = JSON.parse(raw); if (!claim || typeof claim.txid !== "string" || claim.txid === txDir.split("/").at(-1)) return true; }
    }
    const raw = await readLifecycleMetadata(io, stateRoot, join(txDir, "receipt.json"));
    if (raw !== null) { const receipt = JSON.parse(raw); if (!receipt || receipt.verb === "migrate" || Object.hasOwn(receipt, "transaction_binding") || Object.hasOwn(receipt, "recovery_outcome")) return true; }
    return false;
  } catch { return true; }
}
// Process-local serialization is shared by every Journal instance. Cross-process
// migration writers additionally require the executor's exclusive owned claim.
const journalQueues = new Map<string, Promise<void>>();

// ─── Entry types ──────────────────────────────────────────────────────────────

export type JournalEntryKind =
  | "BEGIN"
  | "STAGE"
  | "COMMIT_STEP"
  | "COMPENSATE"
  | "ABORT"
  | "COMPLETE"
  | "CUSTODY"
  | "CUSTODY_HOLD";

interface JournalEntryBase {
  kind: JournalEntryKind;
  ts: string;
}

/** Immutable reviewed transaction binding; no private paths or credentials. */
export interface TransactionBinding {
  plan_digest: `sha256:${string}`;
  context: Record<string, string | string[]>;
  claim_nonce: string;
  destinations_digest: string;
}

export interface BeginEntry extends JournalEntryBase {
  transaction_binding?: TransactionBinding;
  kind: "BEGIN";
  verb: string;
  profile: string;
  inventory_digest: string;
  /** Binds COPY recovery paths and declared hashes before the first mutation. */
  copy_manifest_sha256?: string;
  /** Binds all newly prepared COPY/TRANSFORM output and preimage evidence. */
  surface_manifest_sha256?: string;
}

export interface StageEntry extends JournalEntryBase {
  kind: "STAGE";
  step_id: string;
  destination_symbolic: string;
  mode: string;
}

export interface CommitStepEntry extends JournalEntryBase {
  kind: "COMMIT_STEP";
  step_id: string;
}

export interface CompensateEntry extends JournalEntryBase {
  kind: "COMPENSATE";
  step_id: string;
  method: string;
}

export interface AbortEntry extends JournalEntryBase {
  kind: "ABORT";
  reason: string;
}

export interface CompleteEntry extends JournalEntryBase {
  kind: "COMPLETE";
  receipt_ref: string;
}

export interface CustodyEntry extends JournalEntryBase {
  kind: "CUSTODY";
  step_id: string;
  phase: "apply" | "rollback";
  custody_ref: string;
  expected_hash: string;
  expected_mode: number;
}
export interface CustodyHoldEntry extends JournalEntryBase {
  kind: "CUSTODY_HOLD";
  step_id: string;
  custody_ref: string;
  observed_hash: string;
  observed_mode: number;
  returned: boolean;
}
export type JournalEntry =
  | BeginEntry
  | StageEntry
  | CommitStepEntry
  | CompensateEntry
  | AbortEntry
  | CompleteEntry
  | CustodyEntry
  | CustodyHoldEntry;

// ─── TxId generation ──────────────────────────────────────────────────────────

/**
 * Monotonic counter (Date.now hex) + 4-byte random suffix.
 * Lexicographically sortable by creation time.
 */
export function generateTxId(): string {
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const random = randomBytes(4).toString("hex");
  return `${timestamp}-${random}`;
}

// ─── Journal ──────────────────────────────────────────────────────────────────

export type TxStatus = "incomplete" | "complete" | "aborted";

export class Journal {
  readonly txDir: string;
  private readonly io: LifecycleIO;
  private pending: Promise<void> = Promise.resolve();

  constructor(txDir: string, io: LifecycleIO, private readonly privateMetadata = false) {
    this.txDir = txDir;
    this.io = io;
  }

  /**
   * Create a new transaction directory and return a Journal bound to it.
   */
  static async create(
    stateRoot: string,
    io: LifecycleIO,
    txid?: string,
  ): Promise<Journal> {
    const id = txid ?? generateTxId();
    const txDir = join(stateRoot, "transactions", id);
    await io.mkdir(join(txDir, "preimage"), { recursive: true });
    return new Journal(txDir, io);
  }

  /**
   * Open an existing transaction directory for crash recovery.
   */
  static open(txDir: string, io: LifecycleIO, privateMetadata = false): Journal {
    return new Journal(txDir, io, privateMetadata);
  }

  private journalPath(): string {
    return join(this.txDir, "journal.json");
  }

  /**
   * Load entries from disk if not yet loaded.
   */
  private async readDisk(): Promise<JournalEntry[]> {
    const raw = await readLifecycleMetadata(this.io, dirname(dirname(this.txDir)), this.journalPath(), this.privateMetadata);
    const entries: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(entries)) throw new Error("JOURNAL_INVALID");
    return entries as JournalEntry[];
  }

  /**
   * Append an entry to the journal. The entry is fsynced to disk BEFORE
   * the promise resolves — callers may safely mutate after await.
   * The queue serializes this process only. Cross-process callers MUST hold the
   * existing executor's exclusive owner claim; direct uncoordinated multi-process
   * appends are unsupported, not protected by this JavaScript queue.
   */
  async append(entry: JournalEntry): Promise<void> {
    const key = resolve(this.journalPath());
    const detached = structuredClone(entry);
    const operation = (journalQueues.get(key) ?? Promise.resolve()).then(async () => {
      const candidate = [...await this.readDisk(), detached];
      try {
        await this.io.writeFileAtomic(this.journalPath(), JSON.stringify(candidate, null, 2) + "\n", { mode: 0o600 });
      } catch (error) {
        // Atomic replacement may have persisted before reporting failure. Never
        // infer its outcome from the rejection or retain an optimistic cache.
        throw error;
      }
    });
    this.pending = operation.catch(() => {});
    journalQueues.set(key, this.pending);
    const settled = this.pending;
    void settled.then(() => { if (journalQueues.get(key) === settled) journalQueues.delete(key); });
    return operation;
  }

  /**
   * Read all journal entries.
   */
  async readEntries(): Promise<JournalEntry[]> {
    await (journalQueues.get(resolve(this.journalPath())) ?? Promise.resolve());
    return this.readDisk();
  }

  /**
   * Determine transaction status from journal contents.
   */
  async getStatus(): Promise<TxStatus> {
    const entries = await this.readEntries();
    if (entries.some((e) => e.kind === "COMPLETE")) return "complete";
    if (entries.some((e) => e.kind === "ABORT")) return "aborted";
    return "incomplete";
  }

  /**
   * For crash recovery: return the list of step_ids that have STAGE
   * entries but no corresponding COMMIT_STEP.
   */
  async pendingSteps(): Promise<string[]> {
    const entries = await this.readEntries();
    const staged = new Set<string>();
    const committed = new Set<string>();
    for (const entry of entries) {
      if (entry.kind === "STAGE") staged.add(entry.step_id);
      if (entry.kind === "COMMIT_STEP") committed.add(entry.step_id);
    }
    return [...staged].filter((id) => !committed.has(id));
  }

  /**
   * For crash recovery: return step_ids that have COMMIT_STEP entries
   * (these need compensation on rollback).
   */
  async committedSteps(): Promise<string[]> {
    const entries = await this.readEntries();
    const committed: string[] = [];
    for (const entry of entries) {
      if (entry.kind === "COMMIT_STEP") committed.push(entry.step_id);
    }
    return committed;
  }
}

// ─── Retention ────────────────────────────────────────────────────────────────

const DEFAULT_RETENTION = 5;

/**
 * Prune old COMPLETE transaction directories, keeping the most recent N.
 * Never touches incomplete (in-progress or aborted) transactions.
 * Directories are sorted lexicographically (txid is time-ordered).
 */
export async function pruneCompletedTransactions(
  stateRoot: string,
  io: LifecycleIO,
  keepCount: number = DEFAULT_RETENTION,
): Promise<string[]> {
  const txRoot = join(stateRoot, "transactions");
  let dirNames: string[];
  try {
    dirNames = await io.readdir(txRoot);
  } catch {
    return [];
  }

  // Sort lexicographically (oldest first due to timestamp prefix)
  dirNames.sort();

  const completed: string[] = [];
  for (const name of dirNames) {
    const txDir = join(txRoot, name);
    const journal = Journal.open(txDir, io);
    // Guarded transactions retain the evidence needed by their owned claim.
    // Legacy retention has no authority to release a migration or erase preimages.
    if (await hasGuardedTransactionOrigin(txDir, io, await journal.readEntries())) continue;
    const status = await journal.getStatus();
    if (status === "complete") {
      completed.push(name);
    }
  }

  // Prune oldest completed, keeping the most recent keepCount
  const toPrune = completed.slice(0, Math.max(0, completed.length - keepCount));
  const pruned: string[] = [];
  for (const name of toPrune) {
    await io.rm(join(txRoot, name), { recursive: true, force: true });
    pruned.push(name);
  }
  return pruned;
}
