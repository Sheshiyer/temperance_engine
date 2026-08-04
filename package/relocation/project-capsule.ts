/**
 * The six-file old-path knowledge capsule left behind after a verified
 * same-volume rename. renderCapsuleFiles() is pure — every byte comes from
 * the structured input, never a copy of arbitrary repository content, so
 * .git internals, provider state, and transcripts can never end up inside
 * it by construction. The only I/O this module performs is writeCapsule(),
 * which always takes an explicit caller-supplied path.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { looksLikeSecret } from "./project-packet-schema";
import type { Portfolio } from "./project-registry";

export const CAPSULE_FILES = [
  "PROJECT.md",
  "project-links.md",
  "data/project.yaml",
  "handoffs/relocation.md",
  "handoffs/integrity-manifest.json",
  "handoffs/rollback.md",
] as const;

export interface CapsuleIntegrityManifest {
  headBefore: string;
  headAfter: string;
  refsDigestBefore: string;
  refsDigestAfter: string;
}

export interface CapsuleInput {
  stableId: string;
  portfolio: Portfolio;
  repository: string;
  oldPath: string;
  newPath: string;
  githubIdentity?: string;
  registryEntryPath: string;
  packetDigest: string;
  knowledgeRef: string;
  rollbackCommand: string;
  integrityManifest: CapsuleIntegrityManifest;
}

/**
 * Only scans fields meant to be human-authored identifiers/paths/references.
 * packetDigest and every integrityManifest field are legitimately hex
 * digests by design — scanning them for "looks like a secret" would flag
 * the expected shape of a real digest as a false positive.
 */
function assertNoSecretsInInput(input: CapsuleInput): void {
  const stringValues = [
    input.stableId,
    input.portfolio,
    input.repository,
    input.oldPath,
    input.newPath,
    input.githubIdentity ?? "",
    input.registryEntryPath,
    input.knowledgeRef,
    input.rollbackCommand,
  ];
  for (const value of stringValues) {
    if (looksLikeSecret(value)) {
      throw new Error("capsule_input_looks_like_a_credential");
    }
  }
}

export function renderCapsuleFiles(input: CapsuleInput): Record<string, string> {
  assertNoSecretsInInput(input);
  const githubIdentity = input.githubIdentity ?? "unknown";

  const projectMd = [
    `# ${input.repository} — Relocated`,
    "",
    `- Stable ID: ${input.stableId}`,
    `- Portfolio: ${input.portfolio}`,
    `- New path: ${input.newPath}`,
    `- GitHub: ${githubIdentity}`,
    `- Registry record: ${input.registryEntryPath}`,
    `- Packet digest: sha256:${input.packetDigest}`,
    "",
    "See project-links.md and handoffs/ for full detail.",
    "",
  ].join("\n");

  const projectLinksMd = [
    "# Project Links",
    "",
    `- New checkout: ${input.newPath}`,
    `- Registry record: ${input.registryEntryPath}`,
    `- Knowledge reference: ${input.knowledgeRef}`,
    "",
  ].join("\n");

  const dataProjectYaml = [
    `stable_id: ${input.stableId}`,
    `portfolio: ${input.portfolio}`,
    `repository: ${input.repository}`,
    `old_path: ${input.oldPath}`,
    `new_path: ${input.newPath}`,
    `github_repository: ${githubIdentity}`,
    `registry_entry: ${input.registryEntryPath}`,
    `packet_digest: ${input.packetDigest}`,
    "",
  ].join("\n");

  const relocationMd = [
    "# Relocation Handoff",
    "",
    `- Old path: ${input.oldPath}`,
    `- New path: ${input.newPath}`,
    `- Registry record: ${input.registryEntryPath}`,
    `- Packet digest: sha256:${input.packetDigest}`,
    "",
  ].join("\n");

  const integrityManifestJson = `${JSON.stringify(
    { ...input.integrityManifest, packetDigest: input.packetDigest },
    null,
    2,
  )}\n`;

  const rollbackMd = [
    "# Rollback",
    "",
    "Command:",
    "",
    `    ${input.rollbackCommand}`,
    "",
    "Refuses on any capsule/destination drift, old-path collision, unexpected file, or committed registry change.",
    "",
  ].join("\n");

  return {
    "PROJECT.md": projectMd,
    "project-links.md": projectLinksMd,
    "data/project.yaml": dataProjectYaml,
    "handoffs/relocation.md": relocationMd,
    "handoffs/integrity-manifest.json": integrityManifestJson,
    "handoffs/rollback.md": rollbackMd,
  };
}

/**
 * The only I/O in this module — always takes an explicit caller-supplied
 * path so tests write to a fixture directory, never a real old-project
 * address. The six-file list is closed on both sides: every required file
 * must be present, and nothing outside that list may be written — this is
 * what keeps `.git`, provider state, and transcripts structurally
 * impossible to end up inside a capsule.
 */
export function writeCapsule(capsuleRootPath: string, files: Record<string, string>): void {
  for (const relativePath of CAPSULE_FILES) {
    if (files[relativePath] === undefined) {
      throw new Error(`capsule_file_missing_from_render:${relativePath}`);
    }
  }
  for (const relativePath of Object.keys(files)) {
    if (!(CAPSULE_FILES as readonly string[]).includes(relativePath)) {
      throw new Error(`capsule_file_not_in_closed_list:${relativePath}`);
    }
  }
  for (const relativePath of CAPSULE_FILES) {
    const absolute = join(capsuleRootPath, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, files[relativePath]);
  }
}

export function verifyCapsuleFiles(capsuleRootPath: string): { present: string[]; missing: string[] } {
  const present = CAPSULE_FILES.filter((relativePath) => existsSync(join(capsuleRootPath, relativePath)));
  const missing = CAPSULE_FILES.filter((relativePath) => !present.includes(relativePath));
  return { present: [...present], missing: [...missing] };
}
