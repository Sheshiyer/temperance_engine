import { randomBytes } from "node:crypto";
import { chmod, link, lstat, mkdir, open, realpath, rename, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

import {
  V4CutoverExecutionError,
  validateV4CutoverReceipt,
  type V4CutoverJournal,
  type V4CutoverJournalEvent,
  type V4CutoverReceipt,
} from "./v4-cutover-executor.ts";

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalAbsolute(path: string): boolean {
  return path.length > 1 && isAbsolute(path) && normalize(path) === path && !path.includes("\0");
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); }
  finally { await handle.close(); }
}

async function writeAtomic(path: string, data: string): Promise<void> {
  const temporary = `${path}.${randomBytes(16).toString("hex")}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  let exists = true;
  try {
    await handle.chmod(0o600);
    await handle.writeFile(data, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
    exists = false;
    await syncDirectory(dirname(path));
  } finally {
    try { await handle.close(); } catch { /* The descriptor may already be closed. */ }
    if (exists) await rm(temporary, { force: true });
  }
}

async function writeImmutable(path: string, data: string): Promise<void> {
  const temporary = `${path}.${randomBytes(16).toString("hex")}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  let exists = true;
  try {
    await handle.chmod(0o600);
    await handle.writeFile(data, "utf8");
    await handle.sync();
    await handle.close();
    await link(temporary, path);
    await unlink(temporary);
    exists = false;
    await syncDirectory(dirname(path));
  } finally {
    try { await handle.close(); } catch { /* The descriptor may already be closed. */ }
    if (exists) await rm(temporary, { force: true });
  }
}

type BeginInput = Parameters<V4CutoverJournal["begin"]>[0];
type JournalRecord = ({ kind: "BEGIN" } & BeginInput)
  | ({ kind: "ACTION" } & V4CutoverJournalEvent)
  | { kind: "COMPLETE"; status: V4CutoverReceipt["status"]; receipt: "receipt.json" };

/** Owner-only, fsynced cutover journal with an immutable final receipt. */
export class FileV4CutoverJournal implements V4CutoverJournal {
  private root: string;
  private transactionRoot: string | undefined;
  private beginInput: BeginInput | undefined;
  private records: JournalRecord[] = [];
  private completed = false;
  private lastSequence = 0;

  constructor(receiptDirectory: string) {
    if (!canonicalAbsolute(receiptDirectory)) {
      throw new V4CutoverExecutionError("CUTOVER_JOURNAL_ROOT_INVALID");
    }
    this.root = resolve(receiptDirectory);
  }

  get transactionDirectory(): string | undefined {
    return this.transactionRoot;
  }

  private async assertDirectory(path: string, expectedRealpath: string): Promise<void> {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== expectedRealpath) {
      throw new V4CutoverExecutionError("CUTOVER_JOURNAL_DIRECTORY_UNSAFE");
    }
  }

  private async persistJournal(): Promise<void> {
    if (!this.transactionRoot) throw new V4CutoverExecutionError("CUTOVER_JOURNAL_NOT_STARTED");
    await this.assertDirectory(this.transactionRoot, this.transactionRoot);
    await writeAtomic(join(this.transactionRoot, "journal.json"), `${canonical(this.records)}\n`);
  }

  async begin(input: BeginInput): Promise<void> {
    if (this.transactionRoot) throw new V4CutoverExecutionError("CUTOVER_JOURNAL_ALREADY_STARTED");
    if (!SAFE_ID.test(input.operation_id)
      || !DIGEST.test(input.operation_digest)
      || !DIGEST.test(input.plan_digest)
      || !DIGEST.test(input.proof_digest)
      || !Number.isFinite(Date.parse(input.started_at))) {
      throw new V4CutoverExecutionError("CUTOVER_JOURNAL_BEGIN_INVALID");
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const rootRealpath = await realpath(this.root);
    await this.assertDirectory(this.root, rootRealpath);
    // Resolve benign ancestor aliases (for example macOS /var -> /private/var)
    // once, after rejecting a symlink at the receipt root itself.
    this.root = rootRealpath;
    await chmod(this.root, 0o700);
    const transactionRoot = join(this.root, input.operation_id);
    try { await mkdir(transactionRoot, { recursive: false, mode: 0o700 }); }
    catch { throw new V4CutoverExecutionError("CUTOVER_JOURNAL_TRANSACTION_EXISTS"); }
    await chmod(transactionRoot, 0o700);
    await this.assertDirectory(transactionRoot, transactionRoot);
    this.transactionRoot = transactionRoot;
    this.beginInput = structuredClone(input);
    this.records = [{ kind: "BEGIN", ...structuredClone(input) }];
    try { await this.persistJournal(); }
    catch (error) {
      this.transactionRoot = undefined;
      this.beginInput = undefined;
      this.records = [];
      await rm(transactionRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async append(event: V4CutoverJournalEvent): Promise<void> {
    if (!this.transactionRoot || !this.beginInput) throw new V4CutoverExecutionError("CUTOVER_JOURNAL_NOT_STARTED");
    if (this.completed) throw new V4CutoverExecutionError("CUTOVER_JOURNAL_COMPLETE");
    if (!Number.isInteger(event.sequence) || event.sequence !== this.lastSequence + 1
      || !SAFE_ID.test(event.action_id)
      || !["started", "completed", "failed"].includes(event.status)
      || !Number.isFinite(Date.parse(event.recorded_at))
      || (event.failure_code !== undefined && !/^[A-Z][A-Z0-9_]{2,127}$/u.test(event.failure_code))) {
      throw new V4CutoverExecutionError("CUTOVER_JOURNAL_EVENT_INVALID");
    }
    this.records.push({ kind: "ACTION", ...structuredClone(event) });
    try { await this.persistJournal(); }
    catch (error) {
      this.records.pop();
      throw error;
    }
    this.lastSequence = event.sequence;
  }

  async complete(receipt: V4CutoverReceipt): Promise<void> {
    if (!this.transactionRoot || !this.beginInput) throw new V4CutoverExecutionError("CUTOVER_JOURNAL_NOT_STARTED");
    if (this.completed) throw new V4CutoverExecutionError("CUTOVER_JOURNAL_COMPLETE");
    if (!validateV4CutoverReceipt(receipt)
      || receipt.operation_id !== this.beginInput.operation_id
      || receipt.operation_digest !== this.beginInput.operation_digest
      || receipt.plan_digest !== this.beginInput.plan_digest
      || receipt.proof_digest !== this.beginInput.proof_digest) {
      throw new V4CutoverExecutionError("CUTOVER_JOURNAL_RECEIPT_INVALID");
    }
    await this.assertDirectory(this.transactionRoot, this.transactionRoot);
    await writeImmutable(join(this.transactionRoot, "receipt.json"), `${canonical(receipt)}\n`);
    this.records.push({ kind: "COMPLETE", status: receipt.status, receipt: "receipt.json" });
    await this.persistJournal();
    this.completed = true;
  }
}
