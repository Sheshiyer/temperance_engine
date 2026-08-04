/**
 * Drift-safe rollback: the inverse of Task 6's transaction. Every check in
 * this module runs to completion and reports every violation before
 * anything is mutated — "fail without removing bytes" is the contract, not
 * an aspiration. Reuses Task 6's captureDeviceInode/performGuardedRename for
 * the reverse rename rather than reimplementing rename semantics.
 *
 * SAFETY BOUNDARY: every mutating function here is exercised in this
 * repository's tests only against temp fixture directories — never a real
 * portfolio repository or registry host.
 */

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CAPSULE_FILES } from "./project-capsule";
import { captureDeviceInode, performGuardedRename, type DeviceInode } from "./project-relocation-transaction";

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sha256File(path: string): string {
  return sha256Text(readFileSync(path, "utf8"));
}

/** Bounded to capsuleRootPath only — never walks outside it. */
function listFilesRecursively(root: string, relativeDir = ""): string[] {
  const absoluteDir = join(root, relativeDir);
  if (!existsSync(absoluteDir)) return [];
  const entries: string[] = [];
  for (const name of readdirSync(absoluteDir)) {
    const relativePath = relativeDir ? `${relativeDir}/${name}` : name;
    const absolutePath = join(root, relativePath);
    if (statSync(absolutePath).isDirectory()) {
      entries.push(...listFilesRecursively(root, relativePath));
    } else {
      entries.push(relativePath);
    }
  }
  return entries;
}

export interface VerificationResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Rollback may only delete a capsule file whose path AND digest match the
 * receipt exactly. A drifted or missing file, or any file present that
 * isn't one of the six canonical capsule files, holds the whole rollback —
 * never a partial delete of just the files that still match.
 */
export function verifyCapsuleAgainstReceipt(
  capsuleRootPath: string,
  expectedDigests: Record<string, string>,
): VerificationResult {
  const reasons: string[] = [];

  for (const file of CAPSULE_FILES) {
    const expected = expectedDigests[file];
    if (expected === undefined) {
      reasons.push(`receipt_missing_digest_for:${file}`);
      continue;
    }
    const absolute = join(capsuleRootPath, file);
    if (!existsSync(absolute)) {
      reasons.push(`capsule_file_missing:${file}`);
      continue;
    }
    if (sha256File(absolute) !== expected) {
      reasons.push(`capsule_file_drifted:${file}`);
    }
  }

  const knownFiles = new Set<string>(CAPSULE_FILES);
  for (const file of listFilesRecursively(capsuleRootPath)) {
    if (!knownFiles.has(file)) {
      reasons.push(`unexpected_file:${file}`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

export interface RollbackReceipt {
  source: string;
  destination: string;
  destinationIdentityAfterRename: DeviceInode;
  capsuleFileDigests: Record<string, string>;
  registryEntryDirectoryPath: string;
  registryEntryDigestAtWriteTime: string;
}

export function loadRollbackReceipt(receiptPath: string): RollbackReceipt {
  if (!existsSync(receiptPath)) {
    throw new Error("rollback_receipt_missing");
  }
  return JSON.parse(readFileSync(receiptPath, "utf8")) as RollbackReceipt;
}

/** The apply-side counterpart to loadRollbackReceipt — mode 0700 directory, mode 0600 file. */
export function writeRollbackReceipt(receiptPath: string, receipt: RollbackReceipt): void {
  const dir = dirname(receiptPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  chmodSync(receiptPath, 0o600);
}

interface RegistryEntryOnDisk {
  transitions: Array<{ type: string }>;
}

/**
 * A registry entry that was never written is a legitimate, safe-to-rollback
 * state (recordPostRenameArtifacts can fail on its very first write). Once
 * written, its content must match the recorded digest exactly, and it must
 * still be open ("reconciling") — a closed ("reconciled") entry is a
 * permanent historical record per ISC-743 and rollback must refuse it.
 */
export function verifyRegistryEntryAgainstReceipt(
  registryEntryDirectoryPath: string,
  expectedDigest: string,
): VerificationResult {
  const filePath = join(registryEntryDirectoryPath, "entry.json");
  if (!existsSync(filePath)) {
    return { ok: true, reasons: [] };
  }

  const reasons: string[] = [];
  const raw = readFileSync(filePath, "utf8");
  if (sha256Text(raw) !== expectedDigest) {
    reasons.push("registry_entry_drifted");
  }

  const entry = JSON.parse(raw) as RegistryEntryOnDisk;
  const lastTransition = entry.transitions[entry.transitions.length - 1];
  if (lastTransition?.type === "reconciled") {
    reasons.push("registry_entry_already_reconciled_committed");
  }

  return { ok: reasons.length === 0, reasons };
}

export interface RollbackAllowedResult {
  allowed: boolean;
  reasons: string[];
}

/**
 * Composes every gate rollback requires before it may mutate anything:
 * capsule integrity, registry-entry integrity, destination identity
 * (source-replacement/parent-swap protection in reverse, mirroring Task 6),
 * and a bounded check that the destination has no linked worktrees (which
 * renaming back would break). Reports every failing gate, not just the
 * first.
 */
export function assertRollbackAllowed(receipt: RollbackReceipt): RollbackAllowedResult {
  const reasons: string[] = [];

  const capsuleCheck = verifyCapsuleAgainstReceipt(receipt.source, receipt.capsuleFileDigests);
  reasons.push(...capsuleCheck.reasons);

  const registryCheck = verifyRegistryEntryAgainstReceipt(
    receipt.registryEntryDirectoryPath,
    receipt.registryEntryDigestAtWriteTime,
  );
  reasons.push(...registryCheck.reasons);

  let destinationIdentity: DeviceInode | null = null;
  try {
    destinationIdentity = captureDeviceInode(receipt.destination);
  } catch {
    reasons.push("destination_missing");
  }
  if (
    destinationIdentity !== null &&
    (destinationIdentity.device !== receipt.destinationIdentityAfterRename.device ||
      destinationIdentity.inode !== receipt.destinationIdentityAfterRename.inode)
  ) {
    reasons.push("destination_identity_drifted");
  }

  const worktreesDir = join(receipt.destination, ".git", "worktrees");
  if (existsSync(worktreesDir) && readdirSync(worktreesDir).length > 0) {
    reasons.push("destination_has_linked_worktrees");
  }

  return { allowed: reasons.length === 0, reasons };
}

function removeIfEmpty(path: string): void {
  if (existsSync(path) && readdirSync(path).length === 0) {
    rmdirSync(path);
  }
}

export interface RollbackResult {
  rolledBack: true;
  restoredPath: string;
}

/**
 * Loads the receipt, then requires assertRollbackAllowed to pass before
 * mutating anything. Only then: delete the six verified-matching capsule
 * files, remove the now-empty generated subdirectories bottom-up, and reuse
 * performGuardedRename in reverse for the final atomic rename-back — which
 * also gives the old-path-collision race check for free, since that
 * function already refuses if anything exists at its target immediately
 * before renaming.
 */
export function performRollback(receiptPath: string): RollbackResult {
  const receipt = loadRollbackReceipt(receiptPath);

  const gate = assertRollbackAllowed(receipt);
  if (!gate.allowed) {
    throw new Error(`rollback_not_allowed:${gate.reasons.join(",")}`);
  }

  for (const file of CAPSULE_FILES) {
    unlinkSync(join(receipt.source, file));
  }
  removeIfEmpty(join(receipt.source, "handoffs"));
  removeIfEmpty(join(receipt.source, "data"));
  removeIfEmpty(receipt.source);

  performGuardedRename({
    source: receipt.destination,
    destination: receipt.source,
    expectedSourceIdentity: receipt.destinationIdentityAfterRename,
  });

  return { rolledBack: true, restoredPath: receipt.source };
}
