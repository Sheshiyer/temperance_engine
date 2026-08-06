import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendReconciledTransition,
  appendReconcilingTransition,
  assertNoCompetingRegistryClaim,
  assertRegistryHostClean,
  listRegistryEntryIdentities,
  projectStatus,
  registryEntryPath,
  registryRootFor,
  relocationEvidenceRef,
  writeRegistryEntry,
  type ReconciliationTransition,
  type RegistryEntryRecord,
} from "./project-registry";

function fixtureEntryDir(): string {
  return join(mkdtempSync(join(tmpdir(), "project-registry-fixture-")), "entry");
}

describe("registryRootFor", () => {
  test("resolves the ratified Thoughtseed registry root (ISC-730)", () => {
    expect(registryRootFor("thoughtseed")).toBe(
      "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/cambium/docs/project-management/relocation-registry/thoughtseed",
    );
  });

  test("resolves the ratified Tryambakam registry root (ISC-731)", () => {
    expect(registryRootFor("tryambakam-noesis")).toBe(
      "/Volumes/madara/2026/twc-vault/_System/10865xseed/projects",
    );
  });
});

describe("registryEntryPath", () => {
  test("joins the Thoughtseed root with the repository name", () => {
    expect(registryEntryPath("thoughtseed", "thoughtseed-brand-atlas")).toBe(
      "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/cambium/docs/project-management/relocation-registry/thoughtseed/thoughtseed-brand-atlas",
    );
  });

  test("joins the Tryambakam root with the repository name", () => {
    expect(registryEntryPath("tryambakam-noesis", "example-repository")).toBe(
      "/Volumes/madara/2026/twc-vault/_System/10865xseed/projects/example-repository",
    );
  });

  test("fails closed for a repository basename that violates the ratified grammar", () => {
    expect(() => registryEntryPath("thoughtseed", "Thoughtseed_Repo")).toThrow(
      "repository_basename_invalid",
    );
  });
});

const VALID_DIGEST = "a".repeat(64);

describe("reconciliation transition log", () => {
  test("appendReconcilingTransition opens a new entry from an empty log", () => {
    const log = appendReconcilingTransition([], { at: "2026-08-04T13:00:00Z", actor: "relocation-transaction" });
    expect(log).toEqual([
      { type: "reconciling", at: "2026-08-04T13:00:00Z", actor: "relocation-transaction" },
    ]);
  });

  test("appendReconcilingTransition refuses to open a second reconciling event on a non-empty log", () => {
    const log = appendReconcilingTransition([], { at: "2026-08-04T13:00:00Z", actor: "relocation-transaction" });
    expect(() =>
      appendReconcilingTransition(log, { at: "2026-08-04T13:05:00Z", actor: "relocation-transaction" }),
    ).toThrow("reconciling_transition_requires_empty_log");
  });

  test("appendReconciledTransition closes an open reconciling event", () => {
    const opened = appendReconcilingTransition([], {
      at: "2026-08-04T13:00:00Z",
      actor: "relocation-transaction",
    });
    const closed = appendReconciledTransition(opened, {
      at: "2026-08-04T14:00:00Z",
      actor: "relocation-transaction",
      ownerRatifier: "sheshnarayan-iyer",
      closedAt: "2026-08-04T14:00:00Z",
      canonicalProjectRecord: "thoughtseed-brand-atlas",
      closureManifestDigest: VALID_DIGEST,
    });
    expect(closed).toEqual([
      { type: "reconciling", at: "2026-08-04T13:00:00Z", actor: "relocation-transaction" },
      {
        type: "reconciled",
        at: "2026-08-04T14:00:00Z",
        actor: "relocation-transaction",
        ownerRatifier: "sheshnarayan-iyer",
        closedAt: "2026-08-04T14:00:00Z",
        canonicalProjectRecord: "thoughtseed-brand-atlas",
        closureManifestDigest: VALID_DIGEST,
      },
    ]);
  });

  test("appendReconciledTransition refuses to close an empty log — nothing is open", () => {
    expect(() =>
      appendReconciledTransition([], {
        at: "2026-08-04T14:00:00Z",
        actor: "relocation-transaction",
        ownerRatifier: "sheshnarayan-iyer",
        closedAt: "2026-08-04T14:00:00Z",
        canonicalProjectRecord: "thoughtseed-brand-atlas",
        closureManifestDigest: VALID_DIGEST,
      }),
    ).toThrow("reconciled_transition_requires_open_reconciling_event");
  });

  test("appendReconciledTransition refuses to double-close an already-reconciled entry", () => {
    const opened = appendReconcilingTransition([], { at: "t0", actor: "relocation-transaction" });
    const closed = appendReconciledTransition(opened, {
      at: "t1",
      actor: "relocation-transaction",
      ownerRatifier: "sheshnarayan-iyer",
      closedAt: "t1",
      canonicalProjectRecord: "thoughtseed-brand-atlas",
      closureManifestDigest: VALID_DIGEST,
    });
    expect(() =>
      appendReconciledTransition(closed, {
        at: "t2",
        actor: "relocation-transaction",
        ownerRatifier: "sheshnarayan-iyer",
        closedAt: "t2",
        canonicalProjectRecord: "thoughtseed-brand-atlas",
        closureManifestDigest: VALID_DIGEST,
      }),
    ).toThrow("reconciled_transition_requires_open_reconciling_event");
  });

  test("appendReconciledTransition rejects a closureManifestDigest that is not 64-hex sha256", () => {
    const opened = appendReconcilingTransition([], { at: "t0", actor: "relocation-transaction" });
    expect(() =>
      appendReconciledTransition(opened, {
        at: "t1",
        actor: "relocation-transaction",
        ownerRatifier: "sheshnarayan-iyer",
        closedAt: "t1",
        canonicalProjectRecord: "thoughtseed-brand-atlas",
        closureManifestDigest: "not-a-digest",
      }),
    ).toThrow("closure_manifest_digest_must_be_sha256_hex");
  });

  test("appendReconcilingTransition and appendReconciledTransition never mutate their input log", () => {
    const original: ReconciliationTransition[] = [];
    appendReconcilingTransition(original, { at: "t0", actor: "relocation-transaction" });
    expect(original).toEqual([]);

    const opened = appendReconcilingTransition([], { at: "t0", actor: "relocation-transaction" });
    const openedSnapshot = [...opened];
    appendReconciledTransition(opened, {
      at: "t1",
      actor: "relocation-transaction",
      ownerRatifier: "sheshnarayan-iyer",
      closedAt: "t1",
      canonicalProjectRecord: "thoughtseed-brand-atlas",
      closureManifestDigest: VALID_DIGEST,
    });
    expect(opened).toEqual(openedSnapshot);
  });

  test("projectStatus projects unknown for an empty log", () => {
    expect(projectStatus([])).toBe("unknown");
  });

  test("projectStatus projects reconciling while the entry is open", () => {
    const log = appendReconcilingTransition([], { at: "t0", actor: "relocation-transaction" });
    expect(projectStatus(log)).toBe("reconciling");
  });

  test("projectStatus projects reconciled once the entry is closed", () => {
    const opened = appendReconcilingTransition([], { at: "t0", actor: "relocation-transaction" });
    const closed = appendReconciledTransition(opened, {
      at: "t1",
      actor: "relocation-transaction",
      ownerRatifier: "sheshnarayan-iyer",
      closedAt: "t1",
      canonicalProjectRecord: "thoughtseed-brand-atlas",
      closureManifestDigest: VALID_DIGEST,
    });
    expect(projectStatus(closed)).toBe("reconciled");
  });
});

describe("relocationEvidenceRef", () => {
  test("formats a valid 64-hex digest as sha256:<digest> (ISC-745)", () => {
    expect(relocationEvidenceRef(VALID_DIGEST)).toBe(`sha256:${VALID_DIGEST}`);
  });

  test("rejects a digest that is not 64-hex sha256", () => {
    expect(() => relocationEvidenceRef("not-a-digest")).toThrow("digest_must_be_sha256_hex");
  });
});

describe("assertNoCompetingRegistryClaim", () => {
  test("passes when the other portfolio's registry has no entries", () => {
    expect(() =>
      assertNoCompetingRegistryClaim({ stableId: "thoughtseed-brand-atlas", otherPortfolioEntries: [] }),
    ).not.toThrow();
  });

  test("passes when no entry in the other portfolio shares the stable ID or GitHub identity", () => {
    expect(() =>
      assertNoCompetingRegistryClaim({
        stableId: "thoughtseed-brand-atlas",
        githubIdentity: "Sheshiyer/thoughtseed-brand-atlas",
        otherPortfolioEntries: [{ stableId: "tn-example-project", githubIdentity: "owner/other-repo" }],
      }),
    ).not.toThrow();
  });

  test("fails before mutation on a matching stable ID in the other portfolio's registry (ISC-711)", () => {
    expect(() =>
      assertNoCompetingRegistryClaim({
        stableId: "thoughtseed-brand-atlas",
        otherPortfolioEntries: [{ stableId: "thoughtseed-brand-atlas" }],
      }),
    ).toThrow("competing_registry_claim");
  });

  test("fails before mutation on a matching GitHub identity even with a different stable ID", () => {
    expect(() =>
      assertNoCompetingRegistryClaim({
        stableId: "thoughtseed-brand-atlas",
        githubIdentity: "Sheshiyer/thoughtseed-brand-atlas",
        otherPortfolioEntries: [
          { stableId: "some-other-id", githubIdentity: "Sheshiyer/thoughtseed-brand-atlas" },
        ],
      }),
    ).toThrow("competing_registry_claim");
  });
});

describe("assertRegistryHostClean", () => {
  test("passes for a clean registry host", () => {
    expect(() => assertRegistryHostClean({ statusPorcelain: "" })).not.toThrow();
  });

  test("fails closed for a dirty host with no owner-approved baseline", () => {
    expect(() => assertRegistryHostClean({ statusPorcelain: " M some/file.md\n" })).toThrow(
      "registry_host_dirty_without_approved_baseline",
    );
  });

  test("passes for a dirty host whose status digest matches the recorded approved baseline", () => {
    // Mirrors the real thoughtseed-labs baseline decision recorded in
    // docs/plans/2026-08-04-vault-relocation-status-and-sequencing.md.
    const statusPorcelain = "the exact porcelain text captured at approval time";
    const approvedBaselineDigest = createHash("sha256").update(statusPorcelain).digest("hex");
    expect(() => assertRegistryHostClean({ statusPorcelain, approvedBaselineDigest })).not.toThrow();
  });

  test("fails closed when the host has drifted further than the recorded approved baseline", () => {
    const approvedBaselineDigest = createHash("sha256")
      .update("the porcelain text at approval time")
      .digest("hex");
    expect(() =>
      assertRegistryHostClean({ statusPorcelain: "different porcelain text now", approvedBaselineDigest }),
    ).toThrow("registry_host_baseline_drifted");
  });
});

const OPENED_RECORD: RegistryEntryRecord = {
  stableId: "thoughtseed-brand-atlas",
  portfolio: "thoughtseed",
  githubIdentity: "Sheshiyer/thoughtseed-brand-atlas",
  oldPath: "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-brand-atlas",
  packetDigest: VALID_DIGEST,
  transitions: appendReconcilingTransition([], { at: "t0", actor: "relocation-transaction" }),
};

describe("writeRegistryEntry — fixture directories only, never a real registry host", () => {
  test("creates a fresh entry with 0700 directory and 0600 file permissions", () => {
    const entryDir = fixtureEntryDir();
    writeRegistryEntry(entryDir, OPENED_RECORD);

    const filePath = join(entryDir, "entry.json");
    expect((statSync(entryDir).mode & 0o777).toString(8)).toBe("700");
    expect((statSync(filePath).mode & 0o777).toString(8)).toBe("600");
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual(OPENED_RECORD);
  });

  test("allows overwriting with an extended transitions log (reconciling -> reconciled)", () => {
    const entryDir = fixtureEntryDir();
    writeRegistryEntry(entryDir, OPENED_RECORD);

    const closedRecord: RegistryEntryRecord = {
      ...OPENED_RECORD,
      transitions: appendReconciledTransition(OPENED_RECORD.transitions, {
        at: "t1",
        actor: "relocation-transaction",
        ownerRatifier: "sheshnarayan-iyer",
        closedAt: "t1",
        canonicalProjectRecord: "thoughtseed-brand-atlas",
        closureManifestDigest: VALID_DIGEST,
      }),
    };
    writeRegistryEntry(entryDir, closedRecord);

    const onDisk = JSON.parse(readFileSync(join(entryDir, "entry.json"), "utf8"));
    expect(onDisk).toEqual(closedRecord);
  });

  test("refuses to shorten an existing entry's transition history", () => {
    const entryDir = fixtureEntryDir();
    const closedRecord: RegistryEntryRecord = {
      ...OPENED_RECORD,
      transitions: appendReconciledTransition(OPENED_RECORD.transitions, {
        at: "t1",
        actor: "relocation-transaction",
        ownerRatifier: "sheshnarayan-iyer",
        closedAt: "t1",
        canonicalProjectRecord: "thoughtseed-brand-atlas",
        closureManifestDigest: VALID_DIGEST,
      }),
    };
    writeRegistryEntry(entryDir, closedRecord);

    expect(() => writeRegistryEntry(entryDir, OPENED_RECORD)).toThrow("registry_entry_history_rewrite_refused");

    const onDisk = JSON.parse(readFileSync(join(entryDir, "entry.json"), "utf8"));
    expect(onDisk).toEqual(closedRecord);
  });

  test("refuses to tamper with an already-written earlier transition", () => {
    const entryDir = fixtureEntryDir();
    writeRegistryEntry(entryDir, OPENED_RECORD);

    const tampered: RegistryEntryRecord = {
      ...OPENED_RECORD,
      transitions: [{ type: "reconciling", at: "tampered-time", actor: "someone-else" }],
    };
    expect(() => writeRegistryEntry(entryDir, tampered)).toThrow("registry_entry_history_rewrite_refused");

    const onDisk = JSON.parse(readFileSync(join(entryDir, "entry.json"), "utf8"));
    expect(onDisk).toEqual(OPENED_RECORD);
  });
});

describe("listRegistryEntryIdentities — fixture registry roots only", () => {
  test("returns an empty array for a registry root that does not exist", () => {
    expect(listRegistryEntryIdentities(join(fixtureEntryDir(), "does-not-exist"))).toEqual([]);
  });

  test("returns an empty array for an empty registry root", () => {
    const registryRoot = mkdtempSync(join(tmpdir(), "project-registry-list-fixture-"));
    expect(listRegistryEntryIdentities(registryRoot)).toEqual([]);
  });

  test("returns the identity of a single entry", () => {
    const registryRoot = mkdtempSync(join(tmpdir(), "project-registry-list-fixture-"));
    writeRegistryEntry(join(registryRoot, "thoughtseed-brand-atlas"), OPENED_RECORD);

    expect(listRegistryEntryIdentities(registryRoot)).toEqual([
      { stableId: OPENED_RECORD.stableId, githubIdentity: OPENED_RECORD.githubIdentity },
    ]);
  });

  test("returns identities for every entry under the registry root", () => {
    const registryRoot = mkdtempSync(join(tmpdir(), "project-registry-list-fixture-"));
    const second: RegistryEntryRecord = {
      ...OPENED_RECORD,
      stableId: "other-repo",
      githubIdentity: "owner/other-repo",
    };
    writeRegistryEntry(join(registryRoot, "thoughtseed-brand-atlas"), OPENED_RECORD);
    writeRegistryEntry(join(registryRoot, "other-repo"), second);

    const identities = listRegistryEntryIdentities(registryRoot);
    expect(identities).toHaveLength(2);
    expect(identities).toContainEqual({ stableId: "thoughtseed-brand-atlas", githubIdentity: OPENED_RECORD.githubIdentity });
    expect(identities).toContainEqual({ stableId: "other-repo", githubIdentity: "owner/other-repo" });
  });

  test("skips a subdirectory that has no entry.json rather than throwing", () => {
    const registryRoot = mkdtempSync(join(tmpdir(), "project-registry-list-fixture-"));
    writeRegistryEntry(join(registryRoot, "thoughtseed-brand-atlas"), OPENED_RECORD);
    mkdirSync(join(registryRoot, "not-a-real-entry"), { recursive: true });

    expect(listRegistryEntryIdentities(registryRoot)).toEqual([
      { stableId: OPENED_RECORD.stableId, githubIdentity: OPENED_RECORD.githubIdentity },
    ]);
  });
});
