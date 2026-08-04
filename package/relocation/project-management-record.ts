/**
 * The canonical Thoughtseed main project-management record (decided
 * 2026-08-05, see docs/vault-project-relocation.md). Reuses the vault's own
 * existing `80-templates/project-repo-context-template.md` structure — this
 * module does not invent a new format, it extends a real, already-used one
 * with the fields the relocation reconciliation flow requires.
 *
 * SAFETY BOUNDARY, same as every other mutating module in this package:
 * this file's tests only ever write to temp fixture files, never the real
 * thoughtseed-labs vault. The upsert path is deliberately conservative —
 * line-level, order-preserving splices, never a full re-serialization —
 * because unlike every other file this package writes, this one can carry
 * real human-authored narrative prose that must never be silently reflowed
 * or reordered.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Portfolio } from "./project-registry";

export interface ProjectManagementRecordInput {
  stableId: string;
  portfolio: Portfolio;
  repository: string;
  githubIdentity?: string;
  currentPath: string;
  lifecycleStatus: "active" | "paused" | "completed" | "archived";
  relocationEvidenceRef?: string;
  relocationEvidencePath?: string;
  closureManifestDigest?: string;
  registryEntryRelativePath: string;
  created: string;
  updated: string;
}

function frontmatterLines(input: ProjectManagementRecordInput): string[] {
  const lines = [
    "type: project-record",
    "doc_type: project-repo-context",
    `project_id: ${input.stableId}`,
    `portfolio: ${input.portfolio}`,
    `repository: ${input.repository}`,
  ];
  if (input.githubIdentity !== undefined) {
    lines.push(`github_repository: ${input.githubIdentity}`);
  }
  lines.push(`current_path: ${input.currentPath}`, `lifecycle_status: ${input.lifecycleStatus}`);
  if (input.relocationEvidenceRef !== undefined) {
    lines.push(`relocation_evidence_ref: ${input.relocationEvidenceRef}`);
  }
  if (input.relocationEvidencePath !== undefined) {
    lines.push(`relocation_evidence_path: ${input.relocationEvidencePath}`);
  }
  lines.push(
    "owner: ceo",
    "status: active",
    `created: ${input.created}`,
    `updated: ${input.updated}`,
    "source_of_truth: vault",
    "sync_status: mapped",
    "founder_visibility: both-founders",
    "tags: [project, repo-context, relocation]",
    "related:",
    `  - ${input.registryEntryRelativePath}`,
  );
  return lines;
}

function relocationSectionLines(input: ProjectManagementRecordInput): string[] {
  return [
    "## Relocation",
    "",
    `- Current repository path: ${input.currentPath}`,
    `- Verified GitHub identity: ${input.githubIdentity ?? "unknown"}`,
    `- Relocation evidence ref: ${input.relocationEvidenceRef ?? "pending"}`,
    `- Relocation evidence path: ${input.relocationEvidencePath ?? "pending"}`,
    `- Closure manifest digest: ${input.closureManifestDigest ?? "pending"}`,
  ];
}

interface FrontmatterBlock {
  key: string;
  lines: string[];
}

function parseFrontmatterBlocks(frontmatterText: string): FrontmatterBlock[] {
  const blocks: FrontmatterBlock[] = [];
  for (const line of frontmatterText.split("\n")) {
    const keyMatch = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (keyMatch && !line.startsWith(" ")) {
      blocks.push({ key: keyMatch[1], lines: [line] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].lines.push(line);
    }
  }
  return blocks;
}

function serializeFrontmatterBlocks(blocks: FrontmatterBlock[]): string {
  return blocks
    .flatMap((block) => block.lines)
    .join("\n")
    .replace(/\n+$/, "");
}

/**
 * Fields that are genuine machine-derived facts about current state — these
 * are replaced in place on every write, new or existing.
 */
function alwaysOwnedBlocks(input: ProjectManagementRecordInput): FrontmatterBlock[] {
  const blocks: FrontmatterBlock[] = [
    { key: "project_id", lines: [`project_id: ${input.stableId}`] },
    { key: "portfolio", lines: [`portfolio: ${input.portfolio}`] },
    { key: "repository", lines: [`repository: ${input.repository}`] },
    { key: "current_path", lines: [`current_path: ${input.currentPath}`] },
    { key: "lifecycle_status", lines: [`lifecycle_status: ${input.lifecycleStatus}`] },
    { key: "updated", lines: [`updated: ${input.updated}`] },
  ];
  if (input.githubIdentity !== undefined) {
    blocks.push({ key: "github_repository", lines: [`github_repository: ${input.githubIdentity}`] });
  }
  if (input.relocationEvidenceRef !== undefined) {
    blocks.push({
      key: "relocation_evidence_ref",
      lines: [`relocation_evidence_ref: ${input.relocationEvidenceRef}`],
    });
  }
  if (input.relocationEvidencePath !== undefined) {
    blocks.push({
      key: "relocation_evidence_path",
      lines: [`relocation_evidence_path: ${input.relocationEvidencePath}`],
    });
  }
  return blocks;
}

/**
 * Non-destructive splice: always-owned keys are replaced in place (or
 * appended if absent); every other key — including human-editorial fields
 * like status/tags/owner/created, and any future unrecognized key — is left
 * completely untouched, in its original position. `related` gets its own
 * append-only treatment: the registry link is added only if not already
 * present, and no existing entry is ever removed or reordered.
 */
export function upsertFrontmatter(existingFrontmatterText: string, input: ProjectManagementRecordInput): string {
  const existingBlocks = parseFrontmatterBlocks(existingFrontmatterText);
  const owned = alwaysOwnedBlocks(input);
  const ownedByKey = new Map(owned.map((block) => [block.key, block]));
  const applied = new Set<string>();

  const spliced = existingBlocks.map((block) => {
    if (block.key === "related") {
      const registryLine = `  - ${input.registryEntryRelativePath}`;
      if (block.lines.some((line) => line.trim() === registryLine.trim())) {
        return block;
      }
      return { key: "related", lines: [...block.lines, registryLine] };
    }
    if (ownedByKey.has(block.key)) {
      applied.add(block.key);
      return ownedByKey.get(block.key) as FrontmatterBlock;
    }
    return block;
  });

  const hasRelated = existingBlocks.some((block) => block.key === "related");
  const appended = owned.filter((block) => !applied.has(block.key));
  const result = [...spliced, ...appended];
  if (!hasRelated) {
    result.push({ key: "related", lines: ["related:", `  - ${input.registryEntryRelativePath}`] });
  }

  return serializeFrontmatterBlocks(result);
}

/**
 * Replaces an existing "## Relocation" section's content in place, or
 * appends a fresh one at the end if none exists — every other section,
 * including real human-authored narrative prose, is preserved byte-for-byte.
 */
export function upsertRelocationSection(body: string, input: ProjectManagementRecordInput): string {
  const lines = body.split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === "## Relocation");
  const newSection = relocationSectionLines(input);

  if (startIndex === -1) {
    const prefix = body.replace(/\n+$/, "");
    return `${prefix}\n\n${newSection.join("\n")}\n`;
  }

  const rest = lines.slice(startIndex + 1);
  const nextHeadingOffset = rest.findIndex((line) => line.trim().startsWith("## "));
  const afterIndex = nextHeadingOffset === -1 ? lines.length : startIndex + 1 + nextHeadingOffset;

  const before = lines.slice(0, startIndex).join("\n").replace(/\n+$/, "");
  const after = lines.slice(afterIndex).join("\n");
  const afterTrimmedLeadingBlank = after.replace(/^\n+/, "");

  const parts = [before, "", newSection.join("\n"), ""];
  if (afterTrimmedLeadingBlank.length > 0) {
    parts.push(afterTrimmedLeadingBlank);
  }
  return parts.join("\n");
}

export function renderNewProjectManagementRecord(input: ProjectManagementRecordInput): string {
  const lines = [
    "---",
    ...frontmatterLines(input),
    "---",
    "",
    `# ${input.repository}`,
    "",
    "## Context snapshot",
    "",
    `- **Project / client label:** ${input.repository}`,
    "- **Canonical vault note(s):** ",
    `- **Lifecycle status:** ${input.lifecycleStatus}`,
    `- **Last audit date:** ${input.updated}`,
    "- **Audited by:** ",
    "",
    "## Current read",
    "",
    "- **What this surface is:**",
    "- **Why it matters now:**",
    "- **How it fits the wider portfolio:**",
    "",
    "## Verified live surfaces",
    "",
    "| Surface | URL | Evidence |",
    "|---|---|---|",
    "|  |  |  |",
    "",
    "## Repo inventory",
    "",
    "| Surface | Repo / link | State | Current signals |",
    "|---|---|---|---|",
    "|  |  | verified |  |",
    "",
    "## Implementation signals",
    "",
    "- **Frontend / client stack:**",
    "- **Backend / infra stack:**",
    "- **Data / platform dependencies:**",
    "- **Freshness signals:** pushed_at, updated_at, or last live check",
    "",
    "## Knowledge gaps",
    "",
    "- **Missing repo resolution:**",
    "- **Missing live URL resolution:**",
    "- **Missing owner / TeamForge mapping:**",
    "",
    "## Next write-back actions",
    "",
    "- [ ] update the canonical project or product source note",
    "- [ ] update `00-meta/entity-registry.md` if a new tracked surface now exists",
    "- [ ] update active-work / founder-facing navigation if the surface is active",
    "- [ ] register or reconcile the TeamForge slug when the control plane is ready",
    "",
    ...relocationSectionLines(input),
    "",
  ];
  return lines.join("\n");
}

/**
 * Combines the frontmatter and body upserts on a full existing file. Throws
 * rather than guessing when the file doesn't have the expected `---`
 * frontmatter markers — silently reinterpreting an unrecognized file shape
 * is exactly the kind of guess this module is built to avoid.
 */
export function upsertProjectManagementRecord(
  existingFileContent: string,
  input: ProjectManagementRecordInput,
): string {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(existingFileContent);
  if (!match) {
    throw new Error("project_management_record_missing_frontmatter");
  }
  const [, frontmatterText, bodyText] = match;
  const newFrontmatter = upsertFrontmatter(frontmatterText, input);
  const newBody = upsertRelocationSection(bodyText, input);
  return `---\n${newFrontmatter}\n---\n${newBody}`;
}

/**
 * The only I/O in this module. Creates a brand-new record when the target
 * path doesn't exist yet, or non-destructively upserts an existing one.
 * Tests point this only at fixture paths — never the real thoughtseed-labs
 * vault.
 */
export function writeProjectManagementRecord(filePath: string, input: ProjectManagementRecordInput): string {
  const content = existsSync(filePath)
    ? upsertProjectManagementRecord(readFileSync(filePath, "utf8"), input)
    : renderNewProjectManagementRecord(input);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return content;
}
