import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CAPSULE_FILES, renderCapsuleFiles, writeCapsule, type CapsuleInput } from "./project-capsule";
import {
  appendReconciledTransition,
  appendReconcilingTransition,
  writeRegistryEntry,
  type RegistryEntryRecord,
} from "./project-registry";
import { existsSync } from "node:fs";

import { captureDeviceInode } from "./project-relocation-transaction";
import {
  assertRollbackAllowed,
  loadRollbackReceipt,
  performRollback,
  verifyCapsuleAgainstReceipt,
  verifyRegistryEntryAgainstReceipt,
  writeRollbackReceipt,
  type RollbackReceipt,
} from "./project-relocation-rollback";

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), "relocation-rollback-fixture-"));
}

const VALID_DIGEST = "a".repeat(64);

const CAPSULE_INPUT: CapsuleInput = {
  stableId: "thoughtseed-brand-atlas",
  portfolio: "thoughtseed",
  repository: "thoughtseed-brand-atlas",
  oldPath: "/fixture/old/thoughtseed-brand-atlas",
  newPath: "/fixture/new/thoughtseed-brand-atlas",
  githubIdentity: "Sheshiyer/thoughtseed-brand-atlas",
  registryEntryPath: "/fixture/registry/thoughtseed-brand-atlas",
  packetDigest: VALID_DIGEST,
  knowledgeRef: "thoughtseed-labs/10-brand-essence/visual-identity-2026-08/",
  rollbackCommand: "bun scripts/vault-project-relocation.ts rollback --repository thoughtseed-brand-atlas",
  integrityManifest: {
    headBefore: "b".repeat(40),
    headAfter: "b".repeat(40),
    refsDigestBefore: "c".repeat(64),
    refsDigestAfter: "c".repeat(64),
  },
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function writeFixtureCapsule(root: string): Record<string, string> {
  const files = renderCapsuleFiles(CAPSULE_INPUT);
  writeCapsule(root, files);
  const digests: Record<string, string> = {};
  for (const file of CAPSULE_FILES) digests[file] = sha256(files[file]);
  return digests;
}

describe("verifyCapsuleAgainstReceipt — fixture directories only", () => {
  test("reports ok with no reasons when every capsule file matches its recorded digest", () => {
    const root = fixtureDir();
    const digests = writeFixtureCapsule(root);
    expect(verifyCapsuleAgainstReceipt(root, digests)).toEqual({ ok: true, reasons: [] });
  });

  test("detects a capsule file whose content drifted from its recorded digest", () => {
    const root = fixtureDir();
    const digests = writeFixtureCapsule(root);
    writeFileSync(join(root, "PROJECT.md"), "someone edited this after the transaction wrote it");

    const result = verifyCapsuleAgainstReceipt(root, digests);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("capsule_file_drifted:PROJECT.md");
  });

  test("detects a missing capsule file", () => {
    const root = fixtureDir();
    const digests = writeFixtureCapsule(root);
    unlinkSync(join(root, "handoffs/rollback.md"));

    const result = verifyCapsuleAgainstReceipt(root, digests);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("capsule_file_missing:handoffs/rollback.md");
  });

  test("detects an unexpected extra file at the capsule root", () => {
    const root = fixtureDir();
    const digests = writeFixtureCapsule(root);
    writeFileSync(join(root, "NOTES.md"), "not part of the capsule");

    const result = verifyCapsuleAgainstReceipt(root, digests);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("unexpected_file:NOTES.md");
  });
});

function baseRegistryRecord(): RegistryEntryRecord {
  return {
    stableId: "thoughtseed-brand-atlas",
    portfolio: "thoughtseed",
    githubIdentity: "Sheshiyer/thoughtseed-brand-atlas",
    oldPath: "/fixture/old/thoughtseed-brand-atlas",
    packetDigest: VALID_DIGEST,
    transitions: appendReconcilingTransition([], { at: "t0", actor: "relocation-transaction" }),
  };
}

function entryJsonDigest(registryEntryDirectoryPath: string): string {
  const raw = readFileSync(join(registryEntryDirectoryPath, "entry.json"), "utf8");
  return sha256(raw);
}

describe("verifyRegistryEntryAgainstReceipt — fixture directories only", () => {
  test("treats a registry entry that was never written as an acceptable no-op state", () => {
    const root = fixtureDir();
    const registryEntryDirectoryPath = join(root, "registry-entry");
    expect(verifyRegistryEntryAgainstReceipt(registryEntryDirectoryPath, VALID_DIGEST)).toEqual({
      ok: true,
      reasons: [],
    });
  });

  test("reports ok when the entry.json content matches the recorded digest and is still open (reconciling)", () => {
    const root = fixtureDir();
    const registryEntryDirectoryPath = join(root, "registry-entry");
    writeRegistryEntry(registryEntryDirectoryPath, baseRegistryRecord());
    const expectedDigest = entryJsonDigest(registryEntryDirectoryPath);

    expect(verifyRegistryEntryAgainstReceipt(registryEntryDirectoryPath, expectedDigest)).toEqual({
      ok: true,
      reasons: [],
    });
  });

  test("detects registry entry content drift from the recorded digest", () => {
    const root = fixtureDir();
    const registryEntryDirectoryPath = join(root, "registry-entry");
    writeRegistryEntry(registryEntryDirectoryPath, baseRegistryRecord());
    const staleExpectedDigest = "f".repeat(64);

    const result = verifyRegistryEntryAgainstReceipt(registryEntryDirectoryPath, staleExpectedDigest);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("registry_entry_drifted");
  });

  test("refuses a registry entry that has already been closed (reconciled/committed)", () => {
    const root = fixtureDir();
    const registryEntryDirectoryPath = join(root, "registry-entry");
    const opened = baseRegistryRecord();
    const closed: RegistryEntryRecord = {
      ...opened,
      transitions: appendReconciledTransition(opened.transitions, {
        at: "t1",
        actor: "relocation-transaction",
        ownerRatifier: "sheshnarayan-iyer",
        closedAt: "t1",
        canonicalProjectRecord: "thoughtseed-brand-atlas",
        closureManifestDigest: VALID_DIGEST,
      }),
    };
    writeRegistryEntry(registryEntryDirectoryPath, closed);
    const expectedDigest = entryJsonDigest(registryEntryDirectoryPath);

    const result = verifyRegistryEntryAgainstReceipt(registryEntryDirectoryPath, expectedDigest);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("registry_entry_already_reconciled_committed");
  });
});

describe("loadRollbackReceipt", () => {
  test("throws rollback_receipt_missing when the receipt file does not exist", () => {
    const receiptPath = join(fixtureDir(), "receipt.json");
    expect(() => loadRollbackReceipt(receiptPath)).toThrow("rollback_receipt_missing");
  });

  test("parses a valid receipt file", () => {
    const root = fixtureDir();
    const receiptPath = join(root, "receipt.json");
    const receipt: RollbackReceipt = {
      source: join(root, "old", "example-repo"),
      destination: join(root, "new", "example-repo"),
      destinationIdentityAfterRename: { device: 1, inode: 2 },
      capsuleFileDigests: {},
      registryEntryDirectoryPath: join(root, "registry-entry"),
      registryEntryDigestAtWriteTime: VALID_DIGEST,
    };
    writeFileSync(receiptPath, JSON.stringify(receipt));
    expect(loadRollbackReceipt(receiptPath)).toEqual(receipt);
  });
});

function setUpAllowedFixture(): { root: string; receipt: RollbackReceipt } {
  const root = fixtureDir();
  const source = join(root, "old", "example-repo");
  const destination = join(root, "new", "example-repo");
  const registryEntryDirectoryPath = join(root, "registry-entry");

  const capsuleFileDigests = writeFixtureCapsule(source);
  writeRegistryEntry(registryEntryDirectoryPath, baseRegistryRecord());
  const registryEntryDigestAtWriteTime = entryJsonDigest(registryEntryDirectoryPath);

  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, "repo-marker.txt"), "the real repository content");
  const destinationIdentityAfterRename = captureDeviceInode(destination);

  return {
    root,
    receipt: {
      source,
      destination,
      destinationIdentityAfterRename,
      capsuleFileDigests,
      registryEntryDirectoryPath,
      registryEntryDigestAtWriteTime,
    },
  };
}

describe("assertRollbackAllowed — fixture directories only, composes every gate before any mutation", () => {
  test("is allowed with no reasons when every gate passes", () => {
    const { receipt } = setUpAllowedFixture();
    expect(assertRollbackAllowed(receipt)).toEqual({ allowed: true, reasons: [] });
  });

  test("holds on capsule drift", () => {
    const { receipt } = setUpAllowedFixture();
    writeFileSync(join(receipt.source, "PROJECT.md"), "tampered");
    const result = assertRollbackAllowed(receipt);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("capsule_file_drifted:PROJECT.md");
  });

  test("holds on registry entry drift", () => {
    const { receipt } = setUpAllowedFixture();
    const tampered: RollbackReceipt = { ...receipt, registryEntryDigestAtWriteTime: "f".repeat(64) };
    const result = assertRollbackAllowed(tampered);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("registry_entry_drifted");
  });

  test("holds when the destination is missing entirely", () => {
    const { receipt } = setUpAllowedFixture();
    rmSync(receipt.destination, { recursive: true });
    const result = assertRollbackAllowed(receipt);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("destination_missing");
  });

  test("holds when the destination's identity has drifted since the rename", () => {
    const { receipt } = setUpAllowedFixture();
    rmSync(receipt.destination, { recursive: true });
    mkdirSync(receipt.destination, { recursive: true });
    writeFileSync(join(receipt.destination, "decoy.txt"), "not the real repository");

    const result = assertRollbackAllowed(receipt);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("destination_identity_drifted");
  });

  test("holds when the destination has linked worktrees", () => {
    const { receipt } = setUpAllowedFixture();
    const worktreesDir = join(receipt.destination, ".git", "worktrees", "some-worktree");
    mkdirSync(worktreesDir, { recursive: true });
    writeFileSync(join(worktreesDir, "gitdir"), "/somewhere/else/.git");

    const result = assertRollbackAllowed(receipt);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("destination_has_linked_worktrees");
  });

  test("reports every failing gate at once", () => {
    const { receipt } = setUpAllowedFixture();
    writeFileSync(join(receipt.source, "PROJECT.md"), "tampered");
    const tampered: RollbackReceipt = { ...receipt, registryEntryDigestAtWriteTime: "f".repeat(64) };
    const result = assertRollbackAllowed(tampered);
    expect(result.reasons).toContain("capsule_file_drifted:PROJECT.md");
    expect(result.reasons).toContain("registry_entry_drifted");
  });
});

function writeReceiptFile(root: string, receipt: RollbackReceipt): string {
  const receiptPath = join(root, "receipt.json");
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  return receiptPath;
}

describe("performRollback — fixture directories only, end to end", () => {
  test("deletes the capsule, removes generated empty directories, and renames the destination back to source", () => {
    const { root, receipt } = setUpAllowedFixture();
    const receiptPath = writeReceiptFile(root, receipt);

    const result = performRollback(receiptPath);

    expect(result).toEqual({ rolledBack: true, restoredPath: receipt.source });
    expect(existsSync(receipt.destination)).toBe(false);
    expect(readFileSync(join(receipt.source, "repo-marker.txt"), "utf8")).toBe("the real repository content");
    for (const file of CAPSULE_FILES) {
      expect(existsSync(join(receipt.source, file))).toBe(false);
    }
  });

  test("removes the now-empty generated capsule subdirectories, not just their files", () => {
    const { root, receipt } = setUpAllowedFixture();
    const receiptPath = writeReceiptFile(root, receipt);

    performRollback(receiptPath);

    expect(existsSync(join(receipt.source, "handoffs"))).toBe(false);
    expect(existsSync(join(receipt.source, "data"))).toBe(false);
  });

  test("refuses and deletes zero bytes when the rollback gate fails", () => {
    const { root, receipt } = setUpAllowedFixture();
    writeFileSync(join(receipt.source, "PROJECT.md"), "tampered");
    const receiptPath = writeReceiptFile(root, receipt);

    expect(() => performRollback(receiptPath)).toThrow("rollback_not_allowed");

    // Nothing was removed or renamed: every capsule file (including the
    // tampered one) and the destination are exactly as they were.
    for (const file of CAPSULE_FILES) {
      expect(existsSync(join(receipt.source, file))).toBe(true);
    }
    expect(existsSync(receipt.destination)).toBe(true);
  });

  test("refuses when the receipt file itself is missing, before touching anything", () => {
    const { root, receipt } = setUpAllowedFixture();
    const receiptPath = join(root, "never-written-receipt.json");

    expect(() => performRollback(receiptPath)).toThrow("rollback_receipt_missing");
    for (const file of CAPSULE_FILES) {
      expect(existsSync(join(receipt.source, file))).toBe(true);
    }
    expect(existsSync(receipt.destination)).toBe(true);
  });
});

describe("writeRollbackReceipt — fixture paths only, closes the loop with loadRollbackReceipt", () => {
  test("writes a receipt that loadRollbackReceipt reads back byte-for-byte equal", () => {
    const root = fixtureDir();
    const receiptPath = join(root, "receipt.json");
    const receipt: RollbackReceipt = {
      source: join(root, "old", "example-repo"),
      destination: join(root, "new", "example-repo"),
      destinationIdentityAfterRename: { device: 1, inode: 2 },
      capsuleFileDigests: { "PROJECT.md": VALID_DIGEST },
      registryEntryDirectoryPath: join(root, "registry-entry"),
      registryEntryDigestAtWriteTime: VALID_DIGEST,
    };

    writeRollbackReceipt(receiptPath, receipt);

    expect(loadRollbackReceipt(receiptPath)).toEqual(receipt);
  });

  test("creates missing parent directories, mode 0700, receipt file mode 0600", () => {
    const root = fixtureDir();
    const receiptDir = join(root, "nested", "receipts");
    const receiptPath = join(receiptDir, "receipt.json");
    const receipt: RollbackReceipt = {
      source: join(root, "old", "example-repo"),
      destination: join(root, "new", "example-repo"),
      destinationIdentityAfterRename: { device: 1, inode: 2 },
      capsuleFileDigests: {},
      registryEntryDirectoryPath: join(root, "registry-entry"),
      registryEntryDigestAtWriteTime: VALID_DIGEST,
    };

    writeRollbackReceipt(receiptPath, receipt);

    expect((statSync(receiptDir).mode & 0o777).toString(8)).toBe("700");
    expect((statSync(receiptPath).mode & 0o777).toString(8)).toBe("600");
  });
});
