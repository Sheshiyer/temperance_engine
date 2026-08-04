import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CapsuleInput } from "./project-capsule";
import { appendReconcilingTransition, type RegistryEntryRecord } from "./project-registry";
import {
  acquireExclusiveLock,
  captureDeviceInode,
  performGuardedRename,
  recordPostRenameArtifacts,
  releaseLock,
  runPreflight,
  type PreflightInput,
} from "./project-relocation-transaction";

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), "relocation-transaction-fixture-"));
}

describe("acquireExclusiveLock / releaseLock — fixture paths only", () => {
  test("acquires a lock file that did not previously exist", () => {
    const lockPath = join(fixtureDir(), "relocation.lock");
    const lock = acquireExclusiveLock(lockPath);
    expect(existsSync(lockPath)).toBe(true);
    expect(lock.lockFilePath).toBe(lockPath);
  });

  test("refuses a second concurrent acquire on the same lock path", () => {
    const lockPath = join(fixtureDir(), "relocation.lock");
    acquireExclusiveLock(lockPath);
    expect(() => acquireExclusiveLock(lockPath)).toThrow("relocation_lock_held");
  });

  test("releaseLock removes the lock file, allowing a subsequent acquire", () => {
    const lockPath = join(fixtureDir(), "relocation.lock");
    const lock = acquireExclusiveLock(lockPath);
    releaseLock(lock);
    expect(existsSync(lockPath)).toBe(false);
    expect(() => acquireExclusiveLock(lockPath)).not.toThrow();
  });

  test("creates missing parent directories for the lock path", () => {
    const lockPath = join(fixtureDir(), "nested", "dir", "relocation.lock");
    expect(() => acquireExclusiveLock(lockPath)).not.toThrow();
    expect(existsSync(lockPath)).toBe(true);
  });
});

const VALID_PREFLIGHT_INPUT: PreflightInput = {
  repositoryKind: "standalone-repository",
  sourceDevice: 1,
  destinationParentDevice: 1,
  destinationExists: false,
  manifestExpectedDigest: "a".repeat(64),
  manifestActualDigest: "a".repeat(64),
  packetValidation: { valid: true },
  unresolvedPathConsumers: [],
  competingRegistryClaimError: null,
};

describe("runPreflight — pure gate composition, no I/O", () => {
  test("is ready with no hold reasons when every gate passes", () => {
    expect(runPreflight(VALID_PREFLIGHT_INPUT)).toEqual({ ready: true, holdReasons: [] });
  });

  test("holds a non-standalone repository", () => {
    const result = runPreflight({ ...VALID_PREFLIGHT_INPUT, repositoryKind: "nested-repository" });
    expect(result.ready).toBe(false);
    expect(result.holdReasons.some((r) => r.includes("not_standalone_repository"))).toBe(true);
  });

  test("holds a cross-device rename attempt", () => {
    const result = runPreflight({ ...VALID_PREFLIGHT_INPUT, destinationParentDevice: 2 });
    expect(result.ready).toBe(false);
    expect(result.holdReasons).toContain("cross_device_rename_not_permitted");
  });

  test("holds when the destination already exists", () => {
    const result = runPreflight({ ...VALID_PREFLIGHT_INPUT, destinationExists: true });
    expect(result.ready).toBe(false);
    expect(result.holdReasons).toContain("destination_exists");
  });

  test("holds on a manifest digest mismatch", () => {
    const result = runPreflight({ ...VALID_PREFLIGHT_INPUT, manifestActualDigest: "b".repeat(64) });
    expect(result.ready).toBe(false);
    expect(result.holdReasons).toContain("manifest_digest_mismatch");
  });

  test("holds when the packet failed schema validation", () => {
    const result = runPreflight({
      ...VALID_PREFLIGHT_INPUT,
      packetValidation: { valid: false, errors: ["repository must be canonical"] },
    });
    expect(result.ready).toBe(false);
    expect(result.holdReasons).toContain("packet_not_valid");
  });

  test("holds when the packet was never validated", () => {
    const result = runPreflight({ ...VALID_PREFLIGHT_INPUT, packetValidation: null });
    expect(result.ready).toBe(false);
    expect(result.holdReasons).toContain("packet_not_valid");
  });

  test("holds when unresolved path consumers remain", () => {
    const result = runPreflight({ ...VALID_PREFLIGHT_INPUT, unresolvedPathConsumers: [{ file: "x" }] });
    expect(result.ready).toBe(false);
    expect(result.holdReasons.some((r) => r.includes("unresolved_path_consumers"))).toBe(true);
  });

  test("holds on a competing registry claim", () => {
    const result = runPreflight({
      ...VALID_PREFLIGHT_INPUT,
      competingRegistryClaimError: "competing_registry_claim:stable_id:thoughtseed-brand-atlas",
    });
    expect(result.ready).toBe(false);
    expect(result.holdReasons.some((r) => r.includes("competing_registry_claim"))).toBe(true);
  });

  test("reports every failing gate at once, not just the first", () => {
    const result = runPreflight({
      ...VALID_PREFLIGHT_INPUT,
      destinationExists: true,
      manifestActualDigest: "b".repeat(64),
      unresolvedPathConsumers: [{ file: "x" }],
    });
    expect(result.holdReasons.length).toBe(3);
  });
});

describe("performGuardedRename — fixture directories only, never a real repository", () => {
  test("renames a fixture directory, preserving inode and content, when identity is unchanged", () => {
    const parent = fixtureDir();
    const source = join(parent, "repo");
    mkdirSync(source);
    writeFileSync(join(source, "marker.txt"), "original content");
    const expectedSourceIdentity = captureDeviceInode(source);
    const destination = join(parent, "moved", "repo");

    const result = performGuardedRename({ source, destination, expectedSourceIdentity });

    expect(result.renamed).toBe(true);
    expect(result.after).toEqual(result.before);
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(join(destination, "marker.txt"), "utf8")).toBe("original content");
  });

  test("attack: source-replacement — refuses to rename when the source's identity drifted since capture", () => {
    const parent = fixtureDir();
    const source = join(parent, "repo");
    mkdirSync(source);
    writeFileSync(join(source, "marker.txt"), "the real repository");
    const expectedSourceIdentity = captureDeviceInode(source);

    // Attacker deletes the real source and drops a decoy at the same path
    // between capture and the rename call.
    rmSync(source, { recursive: true });
    mkdirSync(source);
    writeFileSync(join(source, "marker.txt"), "decoy content");

    const destination = join(parent, "moved", "repo");
    expect(() => performGuardedRename({ source, destination, expectedSourceIdentity })).toThrow(
      "source_identity_drifted_before_rename",
    );

    // Refusal must be total: the decoy is untouched, nothing was renamed.
    expect(existsSync(destination)).toBe(false);
    expect(readFileSync(join(source, "marker.txt"), "utf8")).toBe("decoy content");
  });

  test("attack: parent/path-swap — refuses to rename when the parent directory was swapped out from under the same path", () => {
    const parent = fixtureDir();
    const source = join(parent, "repo");
    mkdirSync(source);
    writeFileSync(join(source, "marker.txt"), "the real repository");
    const expectedSourceIdentity = captureDeviceInode(source);

    // Attacker swaps the whole parent directory: the original moves aside,
    // and a freshly created parent with a same-named decoy child takes its
    // place — "repo" resolves to a different inode without ever touching
    // the literal source path directly.
    const parentOriginal = `${parent}-original`;
    renameSync(parent, parentOriginal);
    mkdirSync(parent);
    mkdirSync(join(parent, "repo"));
    writeFileSync(join(parent, "repo", "marker.txt"), "decoy content");

    const destination = join(parent, "moved", "repo");
    expect(() => performGuardedRename({ source, destination, expectedSourceIdentity })).toThrow(
      "source_identity_drifted_before_rename",
    );
    expect(existsSync(destination)).toBe(false);
  });

  test("refuses to rename when the destination appears immediately before the rename call", () => {
    const parent = fixtureDir();
    const source = join(parent, "repo");
    mkdirSync(source);
    const expectedSourceIdentity = captureDeviceInode(source);
    const destination = join(parent, "moved", "repo");
    mkdirSync(destination, { recursive: true });

    expect(() => performGuardedRename({ source, destination, expectedSourceIdentity })).toThrow(
      "destination_appeared_before_rename",
    );
    expect(existsSync(source)).toBe(true);
  });

  test("refuses to rename when the source has disappeared entirely before the rename call", () => {
    const parent = fixtureDir();
    const source = join(parent, "repo");
    mkdirSync(source);
    const expectedSourceIdentity = captureDeviceInode(source);
    rmSync(source, { recursive: true });

    const destination = join(parent, "moved", "repo");
    expect(() => performGuardedRename({ source, destination, expectedSourceIdentity })).toThrow(
      "source_missing_immediately_before_rename",
    );
  });
});

const VALID_DIGEST = "a".repeat(64);

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

function baseCapsuleInput(): CapsuleInput {
  return {
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
}

describe("recordPostRenameArtifacts — fixture directories only, held state on partial failure", () => {
  test("writes both the registry entry and the capsule on the happy path", () => {
    const parent = fixtureDir();
    const registryEntryDirectoryPath = join(parent, "registry-entry");
    const capsuleRootPath = join(parent, "capsule");

    const result = recordPostRenameArtifacts({
      registryEntryDirectoryPath,
      registryRecord: baseRegistryRecord(),
      capsuleRootPath,
      capsuleInput: baseCapsuleInput(),
    });

    expect(result).toEqual({ registryWritten: true, capsuleWritten: true, heldStateReason: null });
    expect(existsSync(join(registryEntryDirectoryPath, "entry.json"))).toBe(true);
    expect(existsSync(join(capsuleRootPath, "PROJECT.md"))).toBe(true);
  });

  test("reports a held state and touches no capsule bytes when the registry write itself fails", () => {
    const parent = fixtureDir();
    const registryEntryDirectoryPath = join(parent, "registry-entry");
    const capsuleRootPath = join(parent, "capsule");

    // First write establishes a longer history; a second attempt with a
    // shorter one trips Task 4's history-rewrite guard.
    const opened = baseRegistryRecord();
    const closedRecord: RegistryEntryRecord = {
      ...opened,
      transitions: [
        ...opened.transitions,
        {
          type: "reconciled",
          at: "t1",
          actor: "relocation-transaction",
          ownerRatifier: "sheshnarayan-iyer",
          closedAt: "t1",
          canonicalProjectRecord: "thoughtseed-brand-atlas",
          closureManifestDigest: VALID_DIGEST,
        },
      ],
    };
    recordPostRenameArtifacts({
      registryEntryDirectoryPath,
      registryRecord: closedRecord,
      capsuleRootPath,
      capsuleInput: baseCapsuleInput(),
    });

    const result = recordPostRenameArtifacts({
      registryEntryDirectoryPath,
      registryRecord: opened,
      capsuleRootPath: join(parent, "capsule-second-attempt"),
      capsuleInput: baseCapsuleInput(),
    });

    expect(result.registryWritten).toBe(false);
    expect(result.capsuleWritten).toBe(false);
    expect(result.heldStateReason).toContain("registry_write_failed");
    expect(existsSync(join(parent, "capsule-second-attempt", "PROJECT.md"))).toBe(false);
  });

  test("reports an explicit held state — not a silent loss — when the capsule write fails after the registry succeeded", () => {
    const parent = fixtureDir();
    const registryEntryDirectoryPath = join(parent, "registry-entry");
    const capsuleRootPath = join(parent, "capsule");

    const tamperedCapsuleInput: CapsuleInput = {
      ...baseCapsuleInput(),
      registryEntryPath: "ghp_1234567890abcdef1234567890abcdef1234",
    };

    const result = recordPostRenameArtifacts({
      registryEntryDirectoryPath,
      registryRecord: baseRegistryRecord(),
      capsuleRootPath,
      capsuleInput: tamperedCapsuleInput,
    });

    expect(result.registryWritten).toBe(true);
    expect(result.capsuleWritten).toBe(false);
    expect(result.heldStateReason).toContain("capsule_write_failed_after_registry_written");
    // The held state must be honest: the registry entry really was written.
    expect(existsSync(join(registryEntryDirectoryPath, "entry.json"))).toBe(true);
  });
});
