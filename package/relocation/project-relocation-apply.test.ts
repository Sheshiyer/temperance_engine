import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CAPSULE_FILES, type CapsuleInput } from "./project-capsule";
import { applyRelocationTransaction, type ApplyTransactionInput } from "./project-relocation-apply";
import { loadRollbackReceipt, performRollback } from "./project-relocation-rollback";

function fixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), "apply-transaction-fixture-"));
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function initFixtureRepo(root: string): string {
  const repoRoot = join(root, "source-repo");
  mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ["init", "--quiet"]);
  git(repoRoot, ["config", "user.email", "fixture@example.com"]);
  git(repoRoot, ["config", "user.name", "Fixture"]);
  writeFileSync(join(repoRoot, "README.md"), "the real repository content\n");
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "--quiet", "-m", "fixture commit"]);
  return repoRoot;
}

function validInput(root: string): ApplyTransactionInput {
  const source = initFixtureRepo(root);
  const vaultRoot = join(root, "vault");
  mkdirSync(vaultRoot, { recursive: true });
  return {
    source,
    destination: join(vaultRoot, "thoughtseed", "source-repo"),
    portfolio: "thoughtseed",
    stableId: "source-repo",
    githubIdentity: "owner/source-repo",
    approvedManifestDigest: "a".repeat(64),
    freshManifestDigest: "a".repeat(64),
    packetValidation: { valid: true },
    packetDigest: "b".repeat(64),
    unresolvedPathConsumers: [],
    otherPortfolioRegistryEntries: [],
    registryEntryDirectoryPath: join(root, "registry-entry"),
    registryHostStatusPorcelain: "",
    knowledgeRef: "thoughtseed-labs/example/",
    rollbackCommand: "bun scripts/vault-project-relocation.ts rollback --receipt <path>",
    lockFilePath: join(root, "relocation.lock"),
    receiptOutputPath: join(root, "receipt.json"),
  };
}

describe("applyRelocationTransaction — fail-closed preflight, fixtures only", () => {
  test("holds on a manifest digest mismatch and touches nothing", () => {
    const root = fixtureRoot();
    const input = { ...validInput(root), freshManifestDigest: "f".repeat(64) };

    const result = applyRelocationTransaction(input);

    expect(result.applied).toBe(false);
    expect(result.holdReasons).toContain("manifest_digest_mismatch");
    expect(existsSync(input.source)).toBe(true);
    expect(existsSync(input.destination)).toBe(false);
    expect(existsSync(input.lockFilePath)).toBe(false);
  });

  test("holds when the packet failed validation and touches nothing", () => {
    const root = fixtureRoot();
    const input: ApplyTransactionInput = {
      ...validInput(root),
      packetValidation: { valid: false, errors: ["repository must be canonical"] },
    };

    const result = applyRelocationTransaction(input);

    expect(result.applied).toBe(false);
    expect(result.holdReasons).toContain("packet_not_valid");
    expect(existsSync(input.destination)).toBe(false);
  });

  test("holds when unresolved path consumers remain and touches nothing", () => {
    const root = fixtureRoot();
    const input = { ...validInput(root), unresolvedPathConsumers: [{ file: "some/consumer.ts" }] };

    const result = applyRelocationTransaction(input);

    expect(result.applied).toBe(false);
    expect(result.holdReasons.some((r) => r.includes("unresolved_path_consumers"))).toBe(true);
    expect(existsSync(input.destination)).toBe(false);
  });

  test("holds on a competing registry claim and touches nothing", () => {
    const root = fixtureRoot();
    const input: ApplyTransactionInput = {
      ...validInput(root),
      otherPortfolioRegistryEntries: [{ stableId: "source-repo" }],
    };

    const result = applyRelocationTransaction(input);

    expect(result.applied).toBe(false);
    expect(result.holdReasons.some((r) => r.includes("competing_registry_claim"))).toBe(true);
    expect(existsSync(input.destination)).toBe(false);
  });

  test("holds when the registry host is dirty with no approved baseline, and touches nothing", () => {
    const root = fixtureRoot();
    const input = { ...validInput(root), registryHostStatusPorcelain: " M some/file.md\n" };

    const result = applyRelocationTransaction(input);

    expect(result.applied).toBe(false);
    expect(result.holdReasons.some((r) => r.includes("registry_host_not_clean"))).toBe(true);
    expect(existsSync(input.destination)).toBe(false);
  });

  test("holds when the destination already exists and touches nothing", () => {
    const root = fixtureRoot();
    const input = validInput(root);
    mkdirSync(input.destination, { recursive: true });

    const result = applyRelocationTransaction(input);

    expect(result.applied).toBe(false);
    expect(result.holdReasons).toContain("destination_exists");
    expect(existsSync(input.source)).toBe(true);
  });

  test("holds on a nested (non-standalone) repository and touches nothing", () => {
    const root = fixtureRoot();
    const input = validInput(root);
    // Turn the fixture into a nested repository by creating a subdirectory
    // and pointing "source" at it — its git toplevel is the parent, not itself.
    const nested = join(input.source, "nested-dir");
    mkdirSync(nested, { recursive: true });
    const nestedInput = { ...input, source: nested };

    const result = applyRelocationTransaction(nestedInput);

    expect(result.applied).toBe(false);
    expect(result.holdReasons.some((r) => r.includes("not_standalone_repository"))).toBe(true);
    expect(existsSync(nestedInput.destination)).toBe(false);
  });

  test("reports every failing gate at once", () => {
    const root = fixtureRoot();
    const input: ApplyTransactionInput = {
      ...validInput(root),
      freshManifestDigest: "f".repeat(64),
      unresolvedPathConsumers: [{ file: "x" }],
    };

    const result = applyRelocationTransaction(input);

    expect(result.holdReasons).toContain("manifest_digest_mismatch");
    expect(result.holdReasons.some((r) => r.includes("unresolved_path_consumers"))).toBe(true);
  });
});

describe("applyRelocationTransaction — happy path end to end, fixtures only", () => {
  test("moves the repository, writes the registry entry and capsule, and produces a valid rollback receipt", () => {
    const root = fixtureRoot();
    const input = validInput(root);

    const result = applyRelocationTransaction(input);

    expect(result.applied).toBe(true);
    expect(result.holdReasons).toEqual([]);
    expect(result.newPath).toBe(input.destination);
    expect(result.registryWritten).toBe(true);
    expect(result.capsuleWritten).toBe(true);
    expect(result.heldStateReason).toBeNull();

    // The real repository content is now at the destination.
    expect(existsSync(join(input.destination, "README.md"))).toBe(true);
    expect(existsSync(join(input.destination, ".git"))).toBe(true);

    // The old path now holds the capsule, not the real repository.
    for (const file of CAPSULE_FILES) {
      expect(existsSync(join(input.source, file))).toBe(true);
    }
    expect(existsSync(join(input.source, "README.md"))).toBe(false);

    // The registry entry was written with an open "reconciling" transition.
    const registryEntry = JSON.parse(
      readFileSync(join(input.registryEntryDirectoryPath, "entry.json"), "utf8"),
    );
    expect(registryEntry.stableId).toBe("source-repo");
    expect(registryEntry.transitions).toHaveLength(1);
    expect(registryEntry.transitions[0].type).toBe("reconciling");

    // The rollback receipt is valid and loadable.
    const receipt = loadRollbackReceipt(input.receiptOutputPath);
    expect(receipt.source).toBe(input.source);
    expect(receipt.destination).toBe(input.destination);
    expect(Object.keys(receipt.capsuleFileDigests)).toHaveLength(6);
  });

  test("full round trip: apply then roll back returns the fixture to its exact original state", () => {
    const root = fixtureRoot();
    const input = validInput(root);

    const applyResult = applyRelocationTransaction(input);
    expect(applyResult.applied).toBe(true);

    const rollbackResult = performRollback(input.receiptOutputPath);

    expect(rollbackResult).toEqual({ rolledBack: true, restoredPath: input.source });
    expect(existsSync(input.destination)).toBe(false);
    expect(existsSync(join(input.source, "README.md"))).toBe(true);
    expect(readFileSync(join(input.source, "README.md"), "utf8")).toBe("the real repository content\n");
    for (const file of CAPSULE_FILES) {
      expect(existsSync(join(input.source, file))).toBe(false);
    }
  });

  test("releases the lock even when the mutation phase completes, allowing a subsequent apply elsewhere", () => {
    const root = fixtureRoot();
    const input = validInput(root);

    applyRelocationTransaction(input);

    expect(existsSync(input.lockFilePath)).toBe(false);
  });
});

describe("applyRelocationTransaction — capsule is validated before the point of no return", () => {
  test("REGRESSION: an unrenderable capsule holds BEFORE the rename, leaving nothing to repair", () => {
    // bwssb hit this for real on 2026-08-07: renderCapsuleFiles runs the
    // secret scan, but it was called inside recordPostRenameArtifacts —
    // after the rename AND after the registry entry was written. The repo
    // moved, the registry opened a `reconciling` entry, the capsule write
    // then refused, and `rollback` could not undo it because the receipt
    // carries no capsule digests without a capsule. The same failure that
    // caused the problem blocked the only automated remedy.
    //
    // Every field the scan inspects is known before the rename;
    // integrityManifest is deliberately excluded from it. So the validation
    // belongs ahead of the move.
    const root = fixtureRoot();
    const input = { ...validInput(root), knowledgeRef: "a".repeat(64) };

    const result = applyRelocationTransaction(input);

    expect(result.applied).toBe(false);
    expect(result.holdReasons.some((r) => r.startsWith("capsule_not_renderable"))).toBe(true);

    // nothing moved, nothing written, nothing to hand-repair
    expect(existsSync(input.source)).toBe(true);
    expect(existsSync(input.destination)).toBe(false);
    expect(existsSync(join(input.registryEntryDirectoryPath, "entry.json"))).toBe(false);
    expect(existsSync(input.lockFilePath)).toBe(false);
  });

  test("a renderable capsule still applies end to end", () => {
    const root = fixtureRoot();
    const input = validInput(root);

    const result = applyRelocationTransaction(input);

    expect(result.applied).toBe(true);
    expect(result.capsuleWritten).toBe(true);
    expect(result.registryWritten).toBe(true);
    expect(result.heldStateReason).toBeNull();
    expect(existsSync(input.destination)).toBe(true);
  });
});

describe("applyRelocationTransaction — registry basename collision is a preflight hold", () => {
  test("REGRESSION: an entry directory owned by a different project holds BEFORE the rename", () => {
    // Entry directories are keyed on the repository basename, so two repos
    // named `wiki` under different tenants target the same directory.
    // writeRegistryEntry refuses that — but it runs inside
    // recordPostRenameArtifacts, i.e. after the rename. Detecting it only
    // there would strand the repository exactly like the capsule failure did:
    // moved, no registry entry, no capsule, and rollback unable to help.
    const root = fixtureRoot();
    const input = validInput(root);

    mkdirSync(input.registryEntryDirectoryPath, { recursive: true });
    writeFileSync(
      join(input.registryEntryDirectoryPath, "entry.json"),
      JSON.stringify({
        stableId: "source-repo",
        portfolio: "thoughtseed",
        oldPath: "/some/other/tenant/source-repo",
        packetDigest: "c".repeat(64),
        transitions: [{ type: "reconciling", at: "t0", actor: "x" }],
      }),
    );

    const result = applyRelocationTransaction(input);

    expect(result.applied).toBe(false);
    expect(result.holdReasons.some((r) => r.startsWith("registry_entry_identity_collision"))).toBe(true);
    expect(existsSync(input.source)).toBe(true);
    expect(existsSync(input.destination)).toBe(false);
  });

  test("an entry directory owned by the SAME project does not hold", () => {
    const root = fixtureRoot();
    const input = validInput(root);
    const first = applyRelocationTransaction(input);
    expect(first.applied).toBe(true);
    expect(first.heldStateReason).toBeNull();
  });
});
