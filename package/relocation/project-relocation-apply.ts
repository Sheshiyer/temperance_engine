/**
 * The end-to-end apply transaction — the single entrypoint that assembles
 * every previously-isolated relocation module into one callable operation.
 *
 * SAFETY BOUNDARY, same as every other mutating module in this package:
 * this file's tests only ever invoke it against temp fixture directories,
 * never a real portfolio repository or registry host. Building and testing
 * this orchestrator is not the same action as pointing it at a real
 * repository — that is a separate, explicitly-approved step (design doc
 * §Approval Boundary B), not an implicit consequence of this file existing.
 *
 * Evidence this function does NOT gather itself — the caller supplies it,
 * keeping this orchestrator free of duplicated policy: packet validation
 * (project-packet.ts / project-packet-schema.ts), the bounded old-path
 * consumer audit (project-path-consumers.ts), and the fresh manifest digest
 * (the CLI's own existing plan-building logic, recomputed immediately
 * before calling this function). What it does gather itself: repository
 * classification and device identity (read-only git/fs plumbing identical
 * in spirit to the CLI's own classifyRepository), and Git HEAD plus a refs
 * snapshot before and after the rename — the "after" values cannot exist
 * before the rename runs, so they can never be meaningful caller input.
 */

import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";

import { CAPSULE_FILES, renderCapsuleFiles, type CapsuleInput } from "./project-capsule";
import { classifyRepositoryByGitToplevel } from "./project-repository-classification";
import {
  appendReconcilingTransition,
  assertNoCompetingRegistryClaim,
  assertRegistryHostClean,
  type Portfolio,
  type RegistryClaimIdentity,
  type RegistryEntryRecord,
} from "./project-registry";
import type { ProjectYamlValidationResult } from "./project-packet-schema";
import { writeRollbackReceipt, type RollbackReceipt } from "./project-relocation-rollback";
import {
  acquireExclusiveLock,
  captureDeviceInode,
  performGuardedRename,
  recordPostRenameArtifacts,
  releaseLock,
  runPreflight,
} from "./project-relocation-transaction";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

const TRANSACTION_ACTOR = "vault-project-relocation-apply";

function readGitHead(path: string): string | null {
  const result = spawnSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * A simple, real (not fabricated) refs snapshot: sha256 of `git show-ref`'s
 * output. Computed both before and after the rename internally — the
 * "after" value cannot exist before the rename runs, so unlike
 * refsDigestBefore this can never be meaningful caller-supplied input.
 */
function readGitRefsDigest(path: string): string {
  const result = spawnSync("git", ["-C", path, "show-ref"], { encoding: "utf8" });
  return sha256Text(result.status === 0 ? result.stdout : "");
}

function deviceOfNearestExistingAncestor(path: string): number {
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) throw new Error("no_existing_ancestor_found");
    current = parent;
  }
  return captureDeviceInode(current).device;
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface ApplyTransactionInput {
  source: string;
  destination: string;
  portfolio: Portfolio;
  stableId: string;
  githubIdentity?: string;
  approvedManifestDigest: string;
  freshManifestDigest: string;
  packetValidation: ProjectYamlValidationResult;
  packetDigest: string;
  unresolvedPathConsumers: unknown[];
  otherPortfolioRegistryEntries: RegistryClaimIdentity[];
  registryEntryDirectoryPath: string;
  registryHostStatusPorcelain: string;
  approvedRegistryHostBaselineDigest?: string;
  /** Portable (`$VAULT/...`) form of `source` for the committed registry entry. */
  registryOldPath?: string;
  knowledgeRef: string;
  rollbackCommand: string;
  lockFilePath: string;
  receiptOutputPath: string;
}

export interface ApplyTransactionResult {
  applied: boolean;
  holdReasons: string[];
  newPath?: string;
  receiptPath?: string;
  registryWritten?: boolean;
  capsuleWritten?: boolean;
  heldStateReason?: string | null;
}

function gatherHoldReasons(input: ApplyTransactionInput): string[] {
  const repositoryKind = classifyRepositoryByGitToplevel(input.source).repositoryKind;
  const sourceDevice = existsSync(input.source) ? captureDeviceInode(input.source).device : -1;
  const destinationParentDevice = deviceOfNearestExistingAncestor(input.destination);
  const destinationExists = existsSync(input.destination);

  let competingRegistryClaimError: string | null = null;
  try {
    assertNoCompetingRegistryClaim({
      stableId: input.stableId,
      githubIdentity: input.githubIdentity,
      otherPortfolioEntries: input.otherPortfolioRegistryEntries,
    });
  } catch (error) {
    competingRegistryClaimError = error instanceof Error ? error.message : String(error);
  }

  const preflight = runPreflight({
    repositoryKind,
    sourceDevice,
    destinationParentDevice,
    destinationExists,
    manifestExpectedDigest: input.approvedManifestDigest,
    manifestActualDigest: input.freshManifestDigest,
    packetValidation: input.packetValidation,
    unresolvedPathConsumers: input.unresolvedPathConsumers,
    competingRegistryClaimError,
  });

  const holdReasons = [...preflight.holdReasons];

  try {
    assertRegistryHostClean({
      statusPorcelain: input.registryHostStatusPorcelain,
      approvedBaselineDigest: input.approvedRegistryHostBaselineDigest,
    });
  } catch (error) {
    holdReasons.push(`registry_host_not_clean:${error instanceof Error ? error.message : String(error)}`);
  }

  return holdReasons;
}

export function applyRelocationTransaction(input: ApplyTransactionInput): ApplyTransactionResult {
  const holdReasons = gatherHoldReasons(input);
  if (holdReasons.length > 0) {
    return { applied: false, holdReasons };
  }

  const lock = acquireExclusiveLock(input.lockFilePath);
  try {
    const expectedSourceIdentity = captureDeviceInode(input.source);
    const headBefore = readGitHead(input.source) ?? "";
    const refsDigestBefore = readGitRefsDigest(input.source);

    const renameResult = performGuardedRename({
      source: input.source,
      destination: input.destination,
      expectedSourceIdentity,
    });

    const headAfter = readGitHead(input.destination) ?? "";
    const refsDigestAfter = readGitRefsDigest(input.destination);

    const registryRecord: RegistryEntryRecord = {
      stableId: input.stableId,
      portfolio: input.portfolio,
      githubIdentity: input.githubIdentity,
      // Aliased form when the caller supplies one: the registry entry is a
      // committed artifact in a public repository, unlike the capsule below,
      // which stays absolute because it is a local breadcrumb read by whoever
      // lands on the old path.
      oldPath: input.registryOldPath ?? input.source,
      packetDigest: input.packetDigest,
      transitions: appendReconcilingTransition([], {
        at: new Date().toISOString(),
        actor: TRANSACTION_ACTOR,
      }),
    };

    const capsuleInput: CapsuleInput = {
      stableId: input.stableId,
      portfolio: input.portfolio,
      repository: basename(input.source),
      oldPath: input.source,
      newPath: input.destination,
      githubIdentity: input.githubIdentity,
      registryEntryPath: input.registryEntryDirectoryPath,
      packetDigest: input.packetDigest,
      knowledgeRef: input.knowledgeRef,
      rollbackCommand: input.rollbackCommand,
      integrityManifest: {
        headBefore,
        headAfter,
        refsDigestBefore,
        refsDigestAfter,
      },
    };

    const recordResult = recordPostRenameArtifacts({
      registryEntryDirectoryPath: input.registryEntryDirectoryPath,
      registryRecord,
      capsuleRootPath: input.source,
      capsuleInput,
    });

    const capsuleFileDigests: Record<string, string> = {};
    if (recordResult.capsuleWritten) {
      const rendered = renderCapsuleFiles(capsuleInput);
      for (const file of CAPSULE_FILES) capsuleFileDigests[file] = sha256Text(rendered[file]);
    }

    const registryEntryDigestAtWriteTime = recordResult.registryWritten
      ? sha256Text(`${JSON.stringify(registryRecord, null, 2)}\n`)
      : "";

    const receipt: RollbackReceipt = {
      source: input.source,
      destination: input.destination,
      destinationIdentityAfterRename: renameResult.after,
      capsuleFileDigests,
      registryEntryDirectoryPath: input.registryEntryDirectoryPath,
      registryEntryDigestAtWriteTime,
    };
    writeRollbackReceipt(input.receiptOutputPath, receipt);

    return {
      applied: true,
      holdReasons: [],
      newPath: input.destination,
      receiptPath: input.receiptOutputPath,
      registryWritten: recordResult.registryWritten,
      capsuleWritten: recordResult.capsuleWritten,
      heldStateReason: recordResult.heldStateReason,
    };
  } finally {
    releaseLock(lock);
  }
}
