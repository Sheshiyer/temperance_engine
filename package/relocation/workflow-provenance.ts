/**
 * Resolves a project type against the skill-clusters delivery-workflow
 * registry (~/.agents/skill-clusters/workflows/registry.json) and digests
 * the exact workflow entry consumed, so a later drift in that external,
 * independently-evolving registry is a provable fact rather than a silent
 * one. Returns null (never an error) when no workflow matches typeId, or
 * when the registry file doesn't exist -- new-project falls back to a
 * fixed-folder-only scaffold in either case.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

interface WorkflowStage {
  id: string;
  label: string;
  search_query: string;
  skills: string[];
  agents_skills?: string[];
}

interface WorkflowEntry {
  id: string;
  title: string;
  summary: string;
  doc: string;
  plan_template: string;
  triggers: Record<string, unknown>;
  stages: WorkflowStage[];
  first_action?: string;
  intensity_note?: string;
}

interface WorkflowRegistryFile {
  workflows: WorkflowEntry[];
}

export interface WorkflowProvenance {
  workflowId: string;
  stages: string[];
  workflowDigest: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function resolveWorkflowProvenance(
  typeId: string,
  workflowRegistryPath: string,
): WorkflowProvenance | null {
  if (!existsSync(workflowRegistryPath)) return null;
  const registry = JSON.parse(readFileSync(workflowRegistryPath, "utf8")) as WorkflowRegistryFile;
  const entry = registry.workflows.find((workflow) => workflow.id === typeId);
  if (!entry) return null;
  return {
    workflowId: entry.id,
    stages: entry.stages.map((stage) => stage.id),
    workflowDigest: sha256(JSON.stringify(entry)),
  };
}

export function renderWorkflowProvenanceMd(provenance: WorkflowProvenance): string {
  return `# Workflow provenance

This project was scaffolded against the \`${provenance.workflowId}\` delivery
workflow defined in \`~/.agents/skill-clusters/workflows/registry.json\`.

## Stages

${provenance.stages.map((stage) => `- \`${stage}/\``).join("\n")}

## Digest

\`${provenance.workflowDigest}\`

This is a sha256 digest of the exact workflow entry consumed at scaffold
time. If the source workflow definition changes later, a fresh
recomputation will no longer match this value -- a provable signal of
drift, not a silent one.

This file is not part of the six-file relocation packet. It records
workflow-provenance only and carries no relocation-readiness meaning of
its own.
`;
}
