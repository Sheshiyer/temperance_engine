/**
 * The pure client-neutral packet resolver (design doc §Portable Project
 * Packet, Task 7). Its signature accepts only a repository root path, the
 * approved routing-lane set, and an optional expected digest — no provider
 * account, native session, or transcript input exists anywhere in this
 * module (ISC-703). It reads exactly PROJECT.md, .project/project.yaml, and
 * .project/HANDOFF.md; any other file on disk, even sitting right next to
 * these three, never influences its output.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checkPacketFilesPresent, computePacketDigest, parseFlatProjectYaml } from "./project-packet";
import { validateProjectYaml, type ValidateProjectYamlOptions } from "./project-packet-schema";
import type { Portfolio } from "./project-registry";

export interface PickupBootstrap {
  stableId: string;
  portfolio: Portfolio;
  objective: string;
  branch: string;
  baseCommit: string;
  completedWork: string[];
  nextAction: string;
  blocker: string;
  verificationCommand: string;
  governance: { defaultInteractiveClient: string; approvalProfile: string };
  packetDigest: string;
}

export interface ResolvePickupBootstrapInput extends ValidateProjectYamlOptions {
  repositoryRoot: string;
  expectedPacketDigest?: string;
}

function extractSection(markdown: string, heading: string): string | null {
  const lines = markdown.split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (startIndex === -1) return null;
  const rest = lines.slice(startIndex + 1);
  const nextHeadingOffset = rest.findIndex((line) => line.trim().startsWith("## "));
  const sectionLines = nextHeadingOffset === -1 ? rest : rest.slice(0, nextHeadingOffset);
  return sectionLines.join("\n").trim();
}

function extractBulletValue(sectionText: string, label: string): string | null {
  const pattern = new RegExp(`^-\\s*${label}:\\s*\`([^\`]*)\``, "m");
  const match = sectionText.match(pattern);
  return match ? match[1] : null;
}

function extractBulletList(sectionText: string): string[] {
  return sectionText
    .split("\n")
    .filter((line) => line.trim().startsWith("- "))
    .map((line) => line.trim().replace(/^-\s*/, ""));
}

function requireField(value: string | null, field: string): string {
  if (value === null) throw new Error(`pickup_resolver_missing_field:${field}`);
  return value;
}

export function resolvePickupBootstrap(input: ResolvePickupBootstrapInput): PickupBootstrap {
  const { present, missing } = checkPacketFilesPresent(input.repositoryRoot);
  if (missing.length > 0) {
    throw new Error(`pickup_resolver_incomplete_packet:${missing.join(",")}`);
  }

  const packetDigest = computePacketDigest(input.repositoryRoot, present);
  if (packetDigest === null) {
    throw new Error("pickup_resolver_digest_unavailable");
  }
  if (input.expectedPacketDigest !== undefined && input.expectedPacketDigest !== packetDigest) {
    throw new Error("pickup_resolver_digest_mismatch");
  }

  const projectYamlRaw = readFileSync(join(input.repositoryRoot, ".project/project.yaml"), "utf8");
  const parsedYaml = parseFlatProjectYaml(projectYamlRaw);
  const validation = validateProjectYaml(parsedYaml, { approvedLanes: input.approvedLanes });
  if (!validation.valid) {
    throw new Error(`pickup_resolver_packet_not_valid:${validation.errors.join(";")}`);
  }
  const yaml = parsedYaml as {
    project_id: string;
    portfolio: Portfolio;
    governance: { default_interactive_client: string; approval_profile: string };
    commands: { verify: string };
  };

  const projectMd = readFileSync(join(input.repositoryRoot, "PROJECT.md"), "utf8");
  const purposeSection = requireField(
    extractSection(projectMd, "Purpose and boundaries"),
    "PROJECT.md#Purpose and boundaries",
  );
  const objective = purposeSection.split(/\n\n/)[0].trim();

  const handoffMd = readFileSync(join(input.repositoryRoot, ".project/HANDOFF.md"), "utf8");
  const checkpoint = requireField(extractSection(handoffMd, "Checkpoint"), "HANDOFF.md#Checkpoint");
  const branch = requireField(extractBulletValue(checkpoint, "Branch"), "HANDOFF.md#Checkpoint.Branch");
  const baseCommit = requireField(
    extractBulletValue(checkpoint, "Base commit"),
    "HANDOFF.md#Checkpoint.Base commit",
  );

  const completedSection = extractSection(handoffMd, "Completed");
  const completedWork = completedSection ? extractBulletList(completedSection) : [];

  const nextAction = requireField(extractSection(handoffMd, "Next action"), "HANDOFF.md#Next action");
  const blocker = extractSection(handoffMd, "Blockers") ?? "none";

  return {
    stableId: yaml.project_id,
    portfolio: yaml.portfolio,
    objective,
    branch,
    baseCommit,
    completedWork,
    nextAction,
    blocker,
    verificationCommand: yaml.commands.verify,
    governance: {
      defaultInteractiveClient: yaml.governance.default_interactive_client,
      approvalProfile: yaml.governance.approval_profile,
    },
    packetDigest,
  };
}
