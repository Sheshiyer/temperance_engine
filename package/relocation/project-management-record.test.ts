import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  renderNewProjectManagementRecord,
  upsertFrontmatter,
  upsertProjectManagementRecord,
  upsertRelocationSection,
  writeProjectManagementRecord,
  type ProjectManagementRecordInput,
} from "./project-management-record";

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), "project-management-record-fixture-"));
}

const BASE_INPUT: ProjectManagementRecordInput = {
  stableId: "thoughtseed-brand-atlas",
  portfolio: "thoughtseed",
  repository: "thoughtseed-brand-atlas",
  githubIdentity: "Sheshiyer/thoughtseed-brand-atlas",
  currentPath: "/Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas",
  lifecycleStatus: "active",
  registryEntryRelativePath: "../relocation-registry/thoughtseed/thoughtseed-brand-atlas/",
  created: "2026-08-05",
  updated: "2026-08-05",
};

describe("renderNewProjectManagementRecord — pure, no I/O", () => {
  test("renders the required frontmatter fields in the decided schema", () => {
    const content = renderNewProjectManagementRecord(BASE_INPUT);

    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("type: project-record");
    expect(content).toContain("doc_type: project-repo-context");
    expect(content).toContain("project_id: thoughtseed-brand-atlas");
    expect(content).toContain("portfolio: thoughtseed");
    expect(content).toContain("repository: thoughtseed-brand-atlas");
    expect(content).toContain("github_repository: Sheshiyer/thoughtseed-brand-atlas");
    expect(content).toContain(
      "current_path: /Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas",
    );
    expect(content).toContain("lifecycle_status: active");
    expect(content).toContain("owner: ceo");
    expect(content).toContain("status: active");
    expect(content).toContain("created: 2026-08-05");
    expect(content).toContain("updated: 2026-08-05");
    expect(content).toContain("source_of_truth: vault");
    expect(content).toContain("sync_status: mapped");
    expect(content).toContain("founder_visibility: both-founders");
    expect(content).toContain("tags: [project, repo-context, relocation]");
    expect(content).toContain("related:\n  - ../relocation-registry/thoughtseed/thoughtseed-brand-atlas/");
  });

  test("omits github_repository entirely when no GitHub identity is known", () => {
    const { githubIdentity, ...withoutGithub } = BASE_INPUT;
    const content = renderNewProjectManagementRecord(withoutGithub);
    expect(content).not.toContain("github_repository:");
  });

  test("omits relocation evidence frontmatter fields when the record predates closure", () => {
    const content = renderNewProjectManagementRecord(BASE_INPUT);
    expect(content).not.toContain("relocation_evidence_ref:");
    expect(content).not.toContain("relocation_evidence_path:");
  });

  test("includes relocation evidence frontmatter fields when supplied", () => {
    const content = renderNewProjectManagementRecord({
      ...BASE_INPUT,
      relocationEvidenceRef: `sha256:${"a".repeat(64)}`,
      relocationEvidencePath: "../relocation-registry/thoughtseed/thoughtseed-brand-atlas/",
    });
    expect(content).toContain(`relocation_evidence_ref: sha256:${"a".repeat(64)}`);
    expect(content).toContain(
      "relocation_evidence_path: ../relocation-registry/thoughtseed/thoughtseed-brand-atlas/",
    );
  });

  test("reuses the real vault template's body sections", () => {
    const content = renderNewProjectManagementRecord(BASE_INPUT);
    for (const heading of [
      "## Context snapshot",
      "## Current read",
      "## Verified live surfaces",
      "## Repo inventory",
      "## Implementation signals",
      "## Knowledge gaps",
      "## Next write-back actions",
      "## Relocation",
    ]) {
      expect(content).toContain(heading);
    }
  });

  test("fills known Context snapshot fields, leaves unknown ones as blank template placeholders", () => {
    const content = renderNewProjectManagementRecord(BASE_INPUT);
    expect(content).toContain("**Project / client label:** thoughtseed-brand-atlas");
    expect(content).toContain("**Lifecycle status:** active");
    expect(content).toContain("**Last audit date:** 2026-08-05");
    // Left blank — no machine source for these, never fabricated:
    expect(content).toMatch(/\*\*Canonical vault note\(s\):\*\*\s*\n/);
    expect(content).toMatch(/\*\*Audited by:\*\*\s*\n/);
  });

  test("the Relocation section reports pending, not fabricated evidence, before closure", () => {
    const content = renderNewProjectManagementRecord(BASE_INPUT);
    expect(content).toContain("Current repository path: /Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas");
    expect(content).toContain("Verified GitHub identity: Sheshiyer/thoughtseed-brand-atlas");
    expect(content).toContain("Relocation evidence ref: pending");
    expect(content).toContain("Relocation evidence path: pending");
    expect(content).toContain("Closure manifest digest: pending");
  });

  test("the Relocation section reports real evidence once supplied", () => {
    const content = renderNewProjectManagementRecord({
      ...BASE_INPUT,
      relocationEvidenceRef: `sha256:${"a".repeat(64)}`,
      relocationEvidencePath: "../relocation-registry/thoughtseed/thoughtseed-brand-atlas/",
      closureManifestDigest: "b".repeat(64),
    });
    expect(content).toContain(`Relocation evidence ref: sha256:${"a".repeat(64)}`);
    expect(content).toContain("Relocation evidence path: ../relocation-registry/thoughtseed/thoughtseed-brand-atlas/");
    expect(content).toContain(`Closure manifest digest: ${"b".repeat(64)}`);
  });
});

const UPDATED_INPUT: ProjectManagementRecordInput = {
  ...BASE_INPUT,
  currentPath: "/Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas",
  lifecycleStatus: "active",
  updated: "2026-09-01",
  relocationEvidenceRef: `sha256:${"c".repeat(64)}`,
  relocationEvidencePath: "20-operations/project-management/relocation-registry/thoughtseed/thoughtseed-brand-atlas/",
};

const HUMAN_AUTHORED_FRONTMATTER = [
  "type: project-record",
  "doc_type: project-repo-context",
  "project_id: thoughtseed-brand-atlas",
  "portfolio: thoughtseed",
  "repository: thoughtseed-brand-atlas",
  "current_path: /Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-brand-atlas",
  "lifecycle_status: active",
  "owner: sheshiyer",
  "status: paused",
  "created: 2026-01-01",
  "updated: 2026-01-15",
  "source_of_truth: mixed",
  "sync_status: local-only",
  "founder_visibility: both-founders",
  "tags: [project, custom-human-tag, brand]",
  "related:",
  "  - ../../00-meta/entity-registry.md",
  "  - portfolio-source-of-truth-review.md",
].join("\n");

describe("upsertFrontmatter — non-destructive, order-preserving splice", () => {
  test("replaces always-owned machine-fact keys in place, at their original position", () => {
    const result = upsertFrontmatter(HUMAN_AUTHORED_FRONTMATTER, UPDATED_INPUT);
    expect(result).toContain(
      "current_path: /Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas",
    );
    expect(result).not.toContain(
      "current_path: /Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-brand-atlas",
    );
    expect(result).toContain("updated: 2026-09-01");
    expect(result).toContain(`relocation_evidence_ref: sha256:${"c".repeat(64)}`);

    const lines = result.split("\n");
    const currentPathIndex = lines.findIndex((l) => l.startsWith("current_path:"));
    const lifecycleIndex = lines.findIndex((l) => l.startsWith("lifecycle_status:"));
    // current_path still comes before lifecycle_status, same relative order as the original.
    expect(currentPathIndex).toBeLessThan(lifecycleIndex);
  });

  test("never overwrites human-editorial keys: owner, status, created, tags, source_of_truth, sync_status", () => {
    const result = upsertFrontmatter(HUMAN_AUTHORED_FRONTMATTER, UPDATED_INPUT);
    expect(result).toContain("owner: sheshiyer");
    expect(result).toContain("status: paused");
    expect(result).toContain("created: 2026-01-01");
    expect(result).toContain("source_of_truth: mixed");
    expect(result).toContain("sync_status: local-only");
    expect(result).toContain("tags: [project, custom-human-tag, brand]");
  });

  test("appends the registry link to an existing related list without disturbing human-added entries", () => {
    const result = upsertFrontmatter(HUMAN_AUTHORED_FRONTMATTER, UPDATED_INPUT);
    expect(result).toContain("  - ../../00-meta/entity-registry.md");
    expect(result).toContain("  - portfolio-source-of-truth-review.md");
    expect(result).toContain(`  - ${UPDATED_INPUT.registryEntryRelativePath}`);
  });

  test("does not duplicate the registry link if it is already present in related", () => {
    const alreadyLinked = `${HUMAN_AUTHORED_FRONTMATTER}\n  - ${UPDATED_INPUT.registryEntryRelativePath}`;
    const result = upsertFrontmatter(alreadyLinked, UPDATED_INPUT);
    const occurrences = result.split(UPDATED_INPUT.registryEntryRelativePath).length - 1;
    expect(occurrences).toBe(1);
  });

  test("appends a missing always-owned key (e.g. github_repository) rather than requiring it pre-exist", () => {
    const withoutGithub = HUMAN_AUTHORED_FRONTMATTER; // never had github_repository
    const result = upsertFrontmatter(withoutGithub, {
      ...UPDATED_INPUT,
      githubIdentity: "Sheshiyer/thoughtseed-brand-atlas",
    });
    expect(result).toContain("github_repository: Sheshiyer/thoughtseed-brand-atlas");
  });

  test("preserves an unrecognized custom key untouched, in its original position", () => {
    const withCustomKey = `${HUMAN_AUTHORED_FRONTMATTER}\ncustom_future_field: keep-me-exactly`;
    const result = upsertFrontmatter(withCustomKey, UPDATED_INPUT);
    expect(result).toContain("custom_future_field: keep-me-exactly");
  });
});

const HUMAN_AUTHORED_BODY_NO_RELOCATION = [
  "# thoughtseed-brand-atlas",
  "",
  "## Current read",
  "",
  "- **What this surface is:** a real, hand-written narrative a founder wrote.",
  "- **Why it matters now:** this is exactly the kind of prose that must never",
  "  be silently reflowed, reworded, or reordered by an automated writer.",
  "",
  "## Knowledge gaps",
  "",
  "- **Missing owner / TeamForge mapping:** still pending manual review.",
  "",
].join("\n");

describe("upsertRelocationSection — preserves every other body section byte-identical", () => {
  test("appends a fresh ## Relocation section at the end when none exists yet", () => {
    const result = upsertRelocationSection(HUMAN_AUTHORED_BODY_NO_RELOCATION, UPDATED_INPUT);
    expect(result).toContain(HUMAN_AUTHORED_BODY_NO_RELOCATION.trim());
    expect(result).toContain("## Relocation");
    expect(result).toContain(
      "Current repository path: /Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas",
    );
  });

  test("replaces an existing ## Relocation section's content without touching anything before it", () => {
    const withStaleRelocation = [
      HUMAN_AUTHORED_BODY_NO_RELOCATION,
      "## Relocation",
      "",
      "- Current repository path: /Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-brand-atlas",
      "- Verified GitHub identity: unknown",
      "- Relocation evidence ref: pending",
      "- Relocation evidence path: pending",
      "- Closure manifest digest: pending",
      "",
    ].join("\n");

    const result = upsertRelocationSection(withStaleRelocation, UPDATED_INPUT);

    // Everything before Relocation is untouched, including the exact wording
    // of the human-authored narrative.
    expect(result).toContain(
      "  be silently reflowed, reworded, or reordered by an automated writer.",
    );
    // Stale relocation facts are gone, fresh ones are present.
    expect(result).not.toContain(
      "Current repository path: /Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-brand-atlas",
    );
    expect(result).toContain(
      "Current repository path: /Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas",
    );
    expect(result).toContain(`Relocation evidence ref: sha256:${"c".repeat(64)}`);
  });

  test("preserves a section that comes after ## Relocation untouched", () => {
    const withFollowingSection = [
      "# thoughtseed-brand-atlas",
      "",
      "## Relocation",
      "",
      "- Current repository path: /old/path",
      "- Verified GitHub identity: unknown",
      "- Relocation evidence ref: pending",
      "- Relocation evidence path: pending",
      "- Closure manifest digest: pending",
      "",
      "## Next write-back actions",
      "",
      "- [ ] a real, human-checked checkbox that must survive untouched",
      "",
    ].join("\n");

    const result = upsertRelocationSection(withFollowingSection, UPDATED_INPUT);

    expect(result).toContain("- [ ] a real, human-checked checkbox that must survive untouched");
    expect(result).toContain(
      "Current repository path: /Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas",
    );
    expect(result).not.toContain("Current repository path: /old/path");
  });
});

describe("upsertProjectManagementRecord — combines frontmatter and body upserts on a full file", () => {
  test("upserts both frontmatter and body together, preserving human content in both", () => {
    const existingFile = `---\n${HUMAN_AUTHORED_FRONTMATTER}\n---\n${HUMAN_AUTHORED_BODY_NO_RELOCATION}`;
    const result = upsertProjectManagementRecord(existingFile, UPDATED_INPUT);

    // Frontmatter: human-editorial fields preserved, machine facts updated.
    expect(result).toContain("status: paused");
    expect(result).toContain(
      "current_path: /Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas",
    );
    // Body: human narrative preserved, Relocation section appended.
    expect(result).toContain(
      "  be silently reflowed, reworded, or reordered by an automated writer.",
    );
    expect(result).toContain("## Relocation");
    expect(result).toContain(`Relocation evidence ref: sha256:${"c".repeat(64)}`);
  });

  test("throws a clear error rather than guessing when the file has no frontmatter markers", () => {
    expect(() => upsertProjectManagementRecord("# just a heading, no frontmatter\n", UPDATED_INPUT)).toThrow(
      "project_management_record_missing_frontmatter",
    );
  });
});

describe("writeProjectManagementRecord — fixture files only, never the real vault", () => {
  test("creates a brand-new file when none exists yet", () => {
    const filePath = join(fixtureDir(), "projects", "thoughtseed-brand-atlas.md");
    writeProjectManagementRecord(filePath, BASE_INPUT);

    expect(existsSync(filePath)).toBe(true);
    const onDisk = readFileSync(filePath, "utf8");
    expect(onDisk).toContain("project_id: thoughtseed-brand-atlas");
    expect(onDisk).toContain("Relocation evidence ref: pending");
  });

  test("creates missing parent directories", () => {
    const filePath = join(fixtureDir(), "deeply", "nested", "projects", "thoughtseed-brand-atlas.md");
    writeProjectManagementRecord(filePath, BASE_INPUT);
    expect(existsSync(filePath)).toBe(true);
  });

  test("upserts an existing file, preserving its human-authored content", () => {
    const root = fixtureDir();
    const filePath = join(root, "thoughtseed-brand-atlas.md");
    const existingFile = `---\n${HUMAN_AUTHORED_FRONTMATTER}\n---\n${HUMAN_AUTHORED_BODY_NO_RELOCATION}`;
    writeFileSync(filePath, existingFile);

    writeProjectManagementRecord(filePath, UPDATED_INPUT);

    const onDisk = readFileSync(filePath, "utf8");
    expect(onDisk).toContain("status: paused");
    expect(onDisk).toContain(
      "  be silently reflowed, reworded, or reordered by an automated writer.",
    );
    expect(onDisk).toContain(
      "current_path: /Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas",
    );
  });
});
