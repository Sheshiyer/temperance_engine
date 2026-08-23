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
import { join } from "node:path";

// ─── IO seam ──────────────────────────────────────────────────────────────────

export interface LifecycleIO {
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  lstat(path: string): Promise<Stats>;
  rename(oldPath: string, newPath: string): Promise<void>;
  realpath(path: string): Promise<string>;
  now(): Date;
  /** Atomic write + fsync: data is durable on disk before the promise resolves. */
  writeFileAtomic(path: string, data: string): Promise<void>;
  fetch(url: string, options: { signal: AbortSignal }): Promise<Response>;
  execFile(
    file: string,
    args: readonly string[],
    options: { signal: AbortSignal },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

// ─── Entry types ──────────────────────────────────────────────────────────────

export type JournalEntryKind =
  | "BEGIN"
  | "STAGE"
  | "COMMIT_STEP"
  | "COMPENSATE"
  | "ABORT"
  | "COMPLETE";

interface JournalEntryBase {
  kind: JournalEntryKind;
  ts: string;
}

export interface BeginEntry extends JournalEntryBase {
  kind: "BEGIN";
  verb: string;
  profile: string;
  inventory_digest: string;
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

export type JournalEntry =
  | BeginEntry
  | StageEntry
  | CommitStepEntry
  | CompensateEntry
  | AbortEntry
  | CompleteEntry;

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
  private entries: JournalEntry[] = [];
  private loaded = false;

  constructor(txDir: string, io: LifecycleIO) {
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
  static open(txDir: string, io: LifecycleIO): Journal {
    return new Journal(txDir, io);
  }

  private journalPath(): string {
    return join(this.txDir, "journal.json");
  }

  /**
   * Load entries from disk if not yet loaded.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.io.readFile(this.journalPath());
      this.entries = JSON.parse(raw) as JournalEntry[];
    } catch {
      this.entries = [];
    }
    this.loaded = true;
  }

  /**
   * Append an entry to the journal. The entry is fsynced to disk BEFORE
   * the promise resolves — callers may safely mutate after await.
   */
  async append(entry: JournalEntry): Promise<void> {
    await this.ensureLoaded();
    this.entries.push(entry);
    const data = JSON.stringify(this.entries, null, 2) + "\n";
    await this.io.writeFileAtomic(this.journalPath(), data);
  }

  /**
   * Read all journal entries.
   */
  async readEntries(): Promise<JournalEntry[]> {
    await this.ensureLoaded();
    return [...this.entries];
  }

  /**
   * Determine transaction status from journal contents.
   */
  async getStatus(): Promise<TxStatus> {
    await this.ensureLoaded();
    if (this.entries.some((e) => e.kind === "COMPLETE")) return "complete";
    if (this.entries.some((e) => e.kind === "ABORT")) return "aborted";
    return "incomplete";
  }

  /**
   * For crash recovery: return the list of step_ids that have STAGE
   * entries but no corresponding COMMIT_STEP.
   */
  async pendingSteps(): Promise<string[]> {
    await this.ensureLoaded();
    const staged = new Set<string>();
    const committed = new Set<string>();
    for (const entry of this.entries) {
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
    await this.ensureLoaded();
    const committed: string[] = [];
    for (const entry of this.entries) {
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
