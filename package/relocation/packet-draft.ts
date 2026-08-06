/**
 * Renders a PacketEvidence into the exact text of the six required packet
 * files. AGENTS.md and CLAUDE.md are near-identical boilerplate by design
 * (the operating contract doesn't change per-project) — only the
 * repository name varies. PROJECT.md and .project/CONTEXT.md state only
 * what the evidence actually supports; they never invent narrative
 * description this tool has no basis for.
 */

import type { PacketEvidence } from "./packet-evidence";

function renderProjectMd(evidence: PacketEvidence): string {
  const githubLine = evidence.githubIdentity
    ? `- GitHub: \`${evidence.githubIdentity}\` (identity_status: ${evidence.identityStatus})`
    : `- GitHub: not found from the local git remote (identity_status: ${evidence.identityStatus})`;
  return `# ${evidence.workObjectName}

## Packet status

This is the canonical project entry point for the \`${evidence.repository}\`
repository. This packet is **draft-held** — drafted from registry and
repository evidence, not yet reviewed by a human. No path move, registry
write, session migration, or provider change is implied by this packet.

## Registry evidence

- Portfolio: \`${evidence.portfolio}\`
- Repository: \`${evidence.repository}\`
- Registry WorkObject: \`${evidence.workObjectId}\` (\`${evidence.workObjectName}\`, kind: ${evidence.workObjectKind})
${githubLine}
- Knowledge authority: \`${evidence.knowledgeRef}\`${evidence.knowledgeRefIsPlaceholder ? " (placeholder — no vault: sourceRef found, needs review)" : ""}
- Current packet checkpoint: \`.project/HANDOFF.md\`

## Authority and pickup

Codex is the default interactive governor for this repository. Claude,
OpenCode, and Kimi may pick up the bounded files listed in
\`.project/project.yaml\`. OmniRoute may route model calls beneath that
control rail; it does not own project identity, repository history, native
sessions, or vault knowledge.

Read \`AGENTS.md\`, \`CLAUDE.md\`, \`.project/CONTEXT.md\`, and
\`.project/HANDOFF.md\` before changing the repository. Native client
sessions, Paseo workspaces, provider stores, and credentials are
intentionally outside this packet.

## Local commands

\`\`\`bash
${evidence.setupCommand}
${evidence.verifyCommand}
\`\`\`

\`${evidence.verifyCommand}\` is the current deterministic verification
command.
`;
}

function renderAgentsMd(evidence: PacketEvidence): string {
  return `# Agent operating contract

This repository is \`${evidence.repository}\`.

1. Read \`PROJECT.md\` and \`.project/HANDOFF.md\` before starting work.
2. Treat the Thoughtseed Labs vault as referenced knowledge, never as a
   runtime dependency or a place to copy private notes, transcripts, or
   seed corpora.
3. Preserve the existing tooling and deployment boundaries. Use the
   commands declared in \`PROJECT.md\` and keep generated output ignored.
4. Keep changes scoped to this repository. Do not edit vault registries,
   native client stores, Paseo, OmniRoute configuration, provider
   credentials, or external deployment state without a separate
   owner-approved task.
5. Never add secrets, \`.env\` material, native session identifiers, prompt
   or response bodies, or machine-local absolute checkout paths.
6. Record a bounded checkpoint in \`.project/HANDOFF.md\` when a reviewed
   change is ready for another client to pick up.

This packet is draft-held. Identity recording does not authorize
relocation, registry writes, session migration, or deployment changes;
those remain manifest-gated and require this packet to first be reviewed
and moved to \`reviewed-held\`.
`;
}

function renderClaudeMd(evidence: PacketEvidence): string {
  return `# Claude pickup adapter

Use this repository as \`${evidence.repository}\`. Start with
\`PROJECT.md\`, then read \`.project/CONTEXT.md\` and
\`.project/HANDOFF.md\`. Follow \`AGENTS.md\` as the shared operating
contract.

The vault is the knowledge authority, not an application dependency. Keep
client sessions, Paseo state, provider stores, credentials, and OmniRoute
configuration outside this repository. Use the commands declared in
\`PROJECT.md\`.

This packet is draft-held. Do not perform relocation, registry, session, or
deployment mutations from this adapter; those actions require a separately
approved, reviewed manifest.
`;
}

function renderContextMd(evidence: PacketEvidence): string {
  const reviewSection =
    evidence.needsReview.length === 0
      ? "No fields were flagged during drafting — every field in this packet came from a real, sourced value."
      : `This packet needs review for the following fields before moving to
\`reviewed-held\`, since this tool could not confidently source them:

${evidence.needsReview.map((field) => `- \`${field}\``).join("\n")}`;
  return `# Bounded project context

## Registry evidence

- Registry WorkObject: \`${evidence.workObjectId}\` (\`${evidence.workObjectName}\`)
- Knowledge pointer: \`${evidence.knowledgeRef}\`${evidence.knowledgeRefIsPlaceholder ? " — placeholder, not a confirmed vault reference" : ""}
- Repository: \`${evidence.repository}\`

## Operating invariants

- Use Codex as the default local approval governor; other clients consume
  the same packet rather than creating competing project state.
- OmniRoute is a model-call transport beneath the project rail, not a
  project or session store.

## Fields needing review

${reviewSection}

## Relocation boundary

This packet is draft-held. The move to a new destination outside the vault
remains blocked until this packet is reviewed, any flagged fields are
resolved, the packet change is committed, an exact manifest is approved,
and a separate live-apply approval exists.
`;
}

function renderHandoffMd(evidence: PacketEvidence): string {
  return `# Project handoff

## Checkpoint

- Status: \`draft-held\`
- Portfolio: \`${evidence.portfolio}\`
- Repository: \`${evidence.repository}\`
- Registry WorkObject: \`${evidence.workObjectId}\`
${evidence.githubIdentity ? `- GitHub: \`${evidence.githubIdentity}\`` : "- GitHub: not found from the local git remote"}

This packet was drafted by the packet-authoring tool from registry and
repository evidence. It has not been reviewed by a human and is not
committed.

## Completed

- Registry WorkObject matched via \`sourceInventory\`.
- Packet drafted: all six files present.
${evidence.needsReview.length > 0 ? `- ${evidence.needsReview.length} field(s) flagged for review — see \`.project/CONTEXT.md\`.` : "- No fields were flagged for review."}

## Next action

Review this draft packet, resolve any items flagged in the review summary,
commit the six files as a single repository change, and move
\`packet_status\` to \`reviewed-held\`. A relocation manifest approval and a
live-apply approval both remain separate, later steps.

## Verification

\`\`\`bash
${evidence.setupCommand}
${evidence.verifyCommand}
git status --short
\`\`\`

No registry, capsule, relocation, session, Paseo, provider, or deployment
mutation has been performed by drafting this packet.
`;
}

function renderProjectYaml(evidence: PacketEvidence): string {
  const lines = [
    "schema_version: 1",
    "packet_status: draft-held",
    `project_id: ${evidence.projectId}`,
    `identity_status: ${evidence.identityStatus}`,
    `portfolio: ${evidence.portfolio}`,
    `repository: ${evidence.repository}`,
  ];
  if (evidence.githubIdentity) lines.push(`github_repository: ${evidence.githubIdentity}`);
  lines.push(
    `knowledge_ref: ${evidence.knowledgeRef}`,
    "governance:",
    "  default_interactive_client: codex",
    "  approval_profile: founder-gated",
    "routing:",
    "  authority: temperance-omniroute",
    `  deployment_profile: ${evidence.repository}`,
    "  verification_state: unverified",
    "  credential_scope_ref: thoughtseed-founder-local-config",
    "  plan_lane: te-plan",
    "  review_lane: te-review",
    "commands:",
    `  setup: ${evidence.setupCommand}`,
    `  test: ${evidence.testCommand}`,
    `  verify: ${evidence.verifyCommand}`,
    "context:",
    "  - PROJECT.md",
    "  - AGENTS.md",
    "  - CLAUDE.md",
    "  - .project/CONTEXT.md",
    "  - .project/project.yaml",
    "  - .project/HANDOFF.md",
  );
  return lines.join("\n") + "\n";
}

export function renderPacket(evidence: PacketEvidence): Record<string, string> {
  return {
    "PROJECT.md": renderProjectMd(evidence),
    "AGENTS.md": renderAgentsMd(evidence),
    "CLAUDE.md": renderClaudeMd(evidence),
    ".project/CONTEXT.md": renderContextMd(evidence),
    ".project/project.yaml": renderProjectYaml(evidence),
    ".project/HANDOFF.md": renderHandoffMd(evidence),
  };
}
