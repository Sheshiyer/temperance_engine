import { afterEach, describe, expect, test } from "bun:test";
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { V4_CUTOVER_RECEIPT_SCHEMA, type V4CutoverReceipt } from "./v4-cutover-executor.ts";
import { FileV4CutoverJournal } from "./v4-cutover-journal.ts";

const roots: string[] = [];
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function root(): string {
  const value = mkdtempSync(resolve(tmpdir(), "temperance-cutover-journal-"));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

function receipt(): V4CutoverReceipt {
  return {
    schema: V4_CUTOVER_RECEIPT_SCHEMA,
    version: { major: 1, minor: 0 },
    operation_id: "cutover-test",
    operation_digest: digest("a"),
    plan_digest: digest("b"),
    proof_digest: digest("c"),
    status: "committed",
    completed_action_ids: ["preflight-replacement"],
    secret_reference_ids: ["LEGACY_GATEWAY"],
    redacted_fields: ["apiKey", "authorization", "credential", "password", "secret", "token"],
    recovery_status: "not-required",
    started_at: "2026-09-17T06:30:00.000Z",
    finished_at: "2026-09-17T06:31:00.000Z",
  };
}

describe("file V4 cutover journal", () => {
  test("requires an explicit canonical absolute receipt root", () => {
    expect(() => new FileV4CutoverJournal("relative/receipts")).toThrow("CUTOVER_JOURNAL_ROOT_INVALID");
    expect(() => new FileV4CutoverJournal(`${root()}/../receipts`)).toThrow("CUTOVER_JOURNAL_ROOT_INVALID");
  });

  test("fsyncs owner-only action history and publishes one immutable receipt", async () => {
    const directory = join(root(), "receipts");
    const journal = new FileV4CutoverJournal(directory);
    await journal.begin({
      operation_id: "cutover-test",
      operation_digest: digest("a"),
      plan_digest: digest("b"),
      proof_digest: digest("c"),
      started_at: "2026-09-17T06:30:00.000Z",
    });
    await journal.append({ sequence: 1, action_id: "preflight-replacement", status: "started", recorded_at: "2026-09-17T06:30:01.000Z" });
    await journal.append({ sequence: 2, action_id: "preflight-replacement", status: "completed", recorded_at: "2026-09-17T06:30:02.000Z" });
    await journal.complete(receipt());
    const transaction = journal.transactionDirectory!;
    const journalPath = join(transaction, "journal.json");
    const receiptPath = join(transaction, "receipt.json");
    expect(lstatSync(directory).mode & 0o777).toBe(0o700);
    expect(lstatSync(transaction).mode & 0o777).toBe(0o700);
    expect(lstatSync(journalPath).mode & 0o777).toBe(0o600);
    expect(lstatSync(receiptPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(journalPath, "utf8")).map(({ kind }: { kind: string }) => kind)).toEqual(["BEGIN", "ACTION", "ACTION", "COMPLETE"]);
    expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toEqual(receipt());
    await expect(journal.complete(receipt())).rejects.toThrow("CUTOVER_JOURNAL_COMPLETE");
  });

  test("rejects sequence gaps and a receipt not bound to the begin record", async () => {
    const journal = new FileV4CutoverJournal(join(root(), "receipts"));
    await journal.begin({
      operation_id: "cutover-test",
      operation_digest: digest("a"),
      plan_digest: digest("b"),
      proof_digest: digest("c"),
      started_at: "2026-09-17T06:30:00.000Z",
    });
    await expect(journal.append({ sequence: 2, action_id: "skip", status: "started", recorded_at: "2026-09-17T06:30:01.000Z" })).rejects.toThrow("CUTOVER_JOURNAL_EVENT_INVALID");
    await expect(journal.complete({ ...receipt(), plan_digest: digest("d") })).rejects.toThrow("CUTOVER_JOURNAL_RECEIPT_INVALID");
  });

  test("rejects a symlinked receipt root", async () => {
    const base = root();
    const target = root();
    const link = join(base, "receipts");
    symlinkSync(target, link);
    const journal = new FileV4CutoverJournal(link);
    await expect(journal.begin({
      operation_id: "cutover-test",
      operation_digest: digest("a"),
      plan_digest: digest("b"),
      proof_digest: digest("c"),
      started_at: "2026-09-17T06:30:00.000Z",
    })).rejects.toThrow("CUTOVER_JOURNAL_DIRECTORY_UNSAFE");
  });
});
