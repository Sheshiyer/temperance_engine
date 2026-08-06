/**
 * Synthesizes PacketEvidence for a project that doesn't exist yet, rather
 * than reading one from an existing repository (which is what
 * gatherPacketEvidence, in packet-evidence.ts, does). Every field the
 * scaffold operation cannot actually know yet is an explicit,
 * needsReview-flagged placeholder — the caller-supplied identity fields
 * are the only thing not flagged, since those really are known at
 * scaffold time.
 */

import type { PacketEvidence } from "./packet-evidence";

export interface ScaffoldInput {
  projectId: string;
  portfolio: "thoughtseed" | "tryambakam-noesis";
  repository: string;
  workObjectId: string;
  workObjectName: string;
  workObjectKind: "sapling" | "program";
}

export function synthesizeScaffoldEvidence(input: ScaffoldInput): PacketEvidence {
  return {
    projectId: input.projectId,
    portfolio: input.portfolio,
    repository: input.repository,
    workObjectId: input.workObjectId,
    workObjectName: input.workObjectName,
    workObjectKind: input.workObjectKind,
    githubIdentity: undefined,
    identityStatus: "pending-teamforge-verification",
    knowledgeRef: "00-meta/system-of-records.md",
    knowledgeRefIsPlaceholder: true,
    setupCommand: "not-applicable",
    testCommand: "not-applicable",
    verifyCommand: "true",
    needsReview: ["knowledge_ref", "commands.setup", "commands.test", "commands.verify"],
  };
}
