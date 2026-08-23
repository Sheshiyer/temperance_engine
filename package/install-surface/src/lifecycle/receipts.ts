/**
 * Lifecycle receipts — redaction-safe, digest-linked transaction records.
 *
 * Receipt schema: temperance.lifecycle.receipt.v1
 * Redaction: symbolic paths only ($HOME/..., $TEMPERANCE_STATE/...)
 * Digest linkage: inventory_digest == CompileResult.digest == doctor v2 inventory_digest
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

import { canonical } from "../canonical-json.ts";
import type { LifecycleIO } from "./journal.ts";

// ─── Receipt schema ──────────────────────────────────────────────────────────

export const RECEIPT_SCHEMA = "temperance.lifecycle.receipt.v1" as const;

export interface ReceiptStep {
  id: string;
  record_id: string;
  destination_symbolic: string;
  outcome: "installed" | "skipped" | "unsupported" | "failed";
}

export interface Receipt {
  schema: typeof RECEIPT_SCHEMA;
  txid: string;
  verb: string;
  profile: string;
  inventory_digest: `sha256:${string}`;
  started_at: string;
  finished_at: string;
  status: "committed" | "failed";
  steps: ReceiptStep[];
  user_content_preserved: string[];
  manifest_after_digest?: `sha256:${string}`;
}

// ─── Redaction ────────────────────────────────────────────────────────────────

const PRIVATE_PATTERNS = [
  /\/Users\/[A-Za-z0-9_.-]+/g,
  /\/Volumes\/[A-Za-z0-9_.-]+/g,
  /\.craft-agent/g,
  /sqlite/gi,
];

/**
 * Assert that a receipt contains no private values.
 * Throws if any private pattern is found.
 */
export function assertRedactionClean(receipt: Receipt): void {
  const serialized = JSON.stringify(receipt);

  for (const pattern of PRIVATE_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new Error(
        `REDACTION_VIOLATION: Receipt contains private pattern: ${pattern.source}`,
      );
    }
  }
}

/**
 * Replace private paths with symbolic equivalents.
 */
export function redactPath(path: string): string {
  const home = process.env.HOME || "/tmp";
  const temperanceState = process.env.TEMPERANCE_STATE || "/tmp/temperance-state";

  return path
    .replace(home, "$HOME")
    .replace(temperanceState, "$TEMPERANCE_STATE");
}

// ─── Receipt creation ────────────────────────────────────────────────────────

export interface ReceiptInput {
  txid: string;
  verb: string;
  profile: string;
  inventory_digest: `sha256:${string}`;
  started_at: string;
  finished_at: string;
  status: "committed" | "failed";
  steps: ReceiptStep[];
  user_content_preserved: string[];
  manifest_after_digest?: `sha256:${string}`;
}

/**
 * Write a receipt to the transaction directory.
 * Asserts redaction-clean before writing.
 */
export async function writeReceipt(
  input: ReceiptInput,
  txDir: string,
  io: LifecycleIO,
): Promise<Receipt> {
  const receipt: Receipt = {
    schema: RECEIPT_SCHEMA,
    ...input,
  };

  // Assert redaction-clean
  assertRedactionClean(receipt);

  // Write receipt
  const receiptPath = join(txDir, "receipt.json");
  await io.writeFileAtomic(receiptPath, canonical(receipt));

  return receipt;
}

// ─── Receipt reading ─────────────────────────────────────────────────────────

/**
 * Read a receipt from a transaction directory.
 * Returns null if receipt doesn't exist.
 */
export async function readReceipt(
  txid: string,
  stateRoot: string,
  io: LifecycleIO,
): Promise<Receipt | null> {
  const txDir = join(stateRoot, "transactions", txid);
  const receiptPath = join(txDir, "receipt.json");

  try {
    const content = await io.readFile(receiptPath);
    const receipt = JSON.parse(content) as Receipt;

    // Validate schema
    if (receipt.schema !== RECEIPT_SCHEMA) {
      throw new Error(`Invalid receipt schema: ${receipt.schema}`);
    }

    return receipt;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * List all receipts in the state root.
 * Returns array of {txid, receipt} pairs.
 */
export async function listReceipts(
  stateRoot: string,
  io: LifecycleIO,
): Promise<Array<{ txid: string; receipt: Receipt }>> {
  const txRoot = join(stateRoot, "transactions");

  let dirNames: string[];
  try {
    dirNames = await io.readdir(txRoot);
  } catch {
    return [];
  }

  const receipts: Array<{ txid: string; receipt: Receipt }> = [];

  for (const name of dirNames) {
    const receipt = await readReceipt(name, stateRoot, io);
    if (receipt) {
      receipts.push({ txid: name, receipt });
    }
  }

  return receipts;
}

// ─── Digest verification ─────────────────────────────────────────────────────

/**
 * Verify that a receipt's inventory_digest matches the expected digest.
 * Used to prove linkage between receipt and doctor v2 report.
 */
export function verifyDigestLinkage(
  receipt: Receipt,
  expectedDigest: `sha256:${string}`,
): boolean {
  return receipt.inventory_digest === expectedDigest;
}
