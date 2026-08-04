/**
 * The receipt-bound relocation transaction: exclusive locking, preflight
 * gating, and the one atomic same-device POSIX rename with mandatory
 * pre/post identity revalidation.
 *
 * SAFETY BOUNDARY: every mutating function in this module (acquireExclusiveLock,
 * performGuardedRename, recordPostRenameArtifacts) is exercised in this
 * repository's tests only against temp fixture directories — never against a
 * real portfolio repository or registry host. There is deliberately no CLI
 * entrypoint wired to this module yet; assembling one is a separate,
 * explicitly-approved step (Approval Boundary B in the relocation design
 * doc), not an implicit consequence of building and testing this code.
 */

import { closeSync, existsSync, lstatSync, mkdirSync, openSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

import { renderCapsuleFiles, writeCapsule, type CapsuleInput } from "./project-capsule";
import { writeRegistryEntry, type RegistryEntryRecord } from "./project-registry";

export interface RelocationLock {
  lockFilePath: string;
}

/**
 * O_CREAT|O_EXCL is atomic at the OS level: the file is created only if it
 * does not already exist, so two concurrent callers can never both succeed.
 */
export function acquireExclusiveLock(lockFilePath: string): RelocationLock {
  mkdirSync(dirname(lockFilePath), { recursive: true });
  let fd: number;
  try {
    fd = openSync(lockFilePath, "wx");
  } catch {
    throw new Error(`relocation_lock_held:${lockFilePath}`);
  }
  closeSync(fd);
  return { lockFilePath };
}

export function releaseLock(lock: RelocationLock): void {
  if (existsSync(lock.lockFilePath)) unlinkSync(lock.lockFilePath);
}

export interface PreflightInput {
  repositoryKind: string;
  sourceDevice: number;
  destinationParentDevice: number;
  destinationExists: boolean;
  manifestExpectedDigest: string;
  manifestActualDigest: string;
  packetValidation: { valid: true } | { valid: false; errors: string[] } | null;
  unresolvedPathConsumers: unknown[];
  competingRegistryClaimError: string | null;
}

export interface PreflightResult {
  ready: boolean;
  holdReasons: string[];
}

/**
 * Pure composition of every gate the transaction requires before it may
 * mutate anything. Reports every failing gate, not just the first, since a
 * held transaction is reviewed by a human who wants the whole list.
 */
export function runPreflight(input: PreflightInput): PreflightResult {
  const holdReasons: string[] = [];

  if (input.repositoryKind !== "standalone-repository") {
    holdReasons.push(`not_standalone_repository:${input.repositoryKind}`);
  }
  if (input.sourceDevice !== input.destinationParentDevice) {
    holdReasons.push("cross_device_rename_not_permitted");
  }
  if (input.destinationExists) {
    holdReasons.push("destination_exists");
  }
  if (input.manifestExpectedDigest !== input.manifestActualDigest) {
    holdReasons.push("manifest_digest_mismatch");
  }
  if (input.packetValidation === null || input.packetValidation.valid !== true) {
    holdReasons.push("packet_not_valid");
  }
  if (input.unresolvedPathConsumers.length > 0) {
    holdReasons.push(`unresolved_path_consumers:${input.unresolvedPathConsumers.length}`);
  }
  if (input.competingRegistryClaimError !== null) {
    holdReasons.push(`competing_registry_claim:${input.competingRegistryClaimError}`);
  }

  return { ready: holdReasons.length === 0, holdReasons };
}

export interface DeviceInode {
  device: number;
  inode: number;
}

export function captureDeviceInode(path: string): DeviceInode {
  const stats = lstatSync(path);
  return { device: Number(stats.dev), inode: Number(stats.ino) };
}

export interface GuardedRenameInput {
  source: string;
  destination: string;
  expectedSourceIdentity: DeviceInode;
}

export interface GuardedRenameResult {
  renamed: true;
  before: DeviceInode;
  after: DeviceInode;
}

/**
 * The one atomic same-device POSIX rename, bracketed by mandatory identity
 * revalidation. The device/inode re-read immediately before the rename call
 * is what catches source-replacement and parent/path-swap races: a path
 * string alone proves nothing once time has passed since it was first
 * captured, only its (device, inode) pair does. Every failure path here
 * throws before renameSync runs — nothing is mutated on a failed guard.
 */
export function performGuardedRename(input: GuardedRenameInput): GuardedRenameResult {
  let before: DeviceInode;
  try {
    before = captureDeviceInode(input.source);
  } catch {
    throw new Error("source_missing_immediately_before_rename");
  }
  if (
    before.device !== input.expectedSourceIdentity.device ||
    before.inode !== input.expectedSourceIdentity.inode
  ) {
    throw new Error("source_identity_drifted_before_rename");
  }
  if (existsSync(input.destination)) {
    throw new Error("destination_appeared_before_rename");
  }

  mkdirSync(dirname(input.destination), { recursive: true });
  renameSync(input.source, input.destination);

  const after = captureDeviceInode(input.destination);
  if (after.device !== before.device || after.inode !== before.inode) {
    throw new Error("post_rename_identity_mismatch");
  }
  if (existsSync(input.source)) {
    throw new Error("source_still_exists_after_rename");
  }

  return { renamed: true, before, after };
}

export interface RecordPostRenameArtifactsInput {
  registryEntryDirectoryPath: string;
  registryRecord: RegistryEntryRecord;
  capsuleRootPath: string;
  capsuleInput: CapsuleInput;
}

export interface RecordPostRenameArtifactsResult {
  registryWritten: boolean;
  capsuleWritten: boolean;
  heldStateReason: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Design doc step 7 ("Record"): registry entry, then capsule. Never
 * attempts to roll back the already-completed rename on a failure here —
 * that belongs to Task 8's rollback module. Instead this reports an exact,
 * honest held state: what succeeded, what didn't, and why — never a silent
 * loss of the fact that the registry write already happened.
 */
export function recordPostRenameArtifacts(
  input: RecordPostRenameArtifactsInput,
): RecordPostRenameArtifactsResult {
  try {
    writeRegistryEntry(input.registryEntryDirectoryPath, input.registryRecord);
  } catch (error) {
    return {
      registryWritten: false,
      capsuleWritten: false,
      heldStateReason: `registry_write_failed:${errorMessage(error)}`,
    };
  }

  try {
    writeCapsule(input.capsuleRootPath, renderCapsuleFiles(input.capsuleInput));
  } catch (error) {
    return {
      registryWritten: true,
      capsuleWritten: false,
      heldStateReason: `capsule_write_failed_after_registry_written:${errorMessage(error)}`,
    };
  }

  return { registryWritten: true, capsuleWritten: true, heldStateReason: null };
}
