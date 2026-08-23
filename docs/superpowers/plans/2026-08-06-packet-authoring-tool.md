> **Historical record** (unredacted original maintained privately): this document describes
> work executed against a specific operator machine. Machine-specific paths appear as
> symbolic placeholders (`<OPERATOR_HOME>`, `<PROJECT_VOLUME>`, `<SESSION_STORE>`); the
> narrative and decisions are unchanged.

# Packet-Authoring Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draft the six-file relocation packet for the 23 remaining depth-0 candidates under `thoughtseed/`, registry-first, as `packet_status: draft-held`, so a human can review, commit, and approve each one toward relocation.

**Architecture:** Two pure modules (`packet-evidence.ts` gathers registry + git-remote + package.json evidence into a `PacketEvidence` object; `packet-draft.ts` renders that into the exact text of all 6 packet files) plus a thin `draft-packets` CLI subcommand that writes the files and a consolidated review summary — matching this package's existing pure-logic/I/O split.

**Tech Stack:** Bun/TypeScript, `node:test` via `bun test`, the existing `scripts/vault-project-relocation.ts` CLI shape.

## Global Constraints

- Packet files: `PROJECT.md`, `AGENTS.md`, `CLAUDE.md`, `.project/CONTEXT.md`, `.project/project.yaml`, `.project/HANDOFF.md` — exact set from `REQUIRED_PACKET_FILES` in `package/relocation/project-packet-schema.ts`.
- `.project/project.yaml` must pass `validateProjectYaml()` unchanged — every field name, enum value, and nesting shape in this plan is copied verbatim from `package/relocation/project-packet-schema.ts`.
- `githubIdentity` comes only from the candidate's own git remote — registry `repo:` sourceRefs are bare repository names (e.g. `repo:brandmint-v2`), never `owner/name` GitHub identities (confirmed against the real registry).
- `identity_status` is never `verified-teamforge` from this tool — that status is reserved for explicit human confirmation (as it was for the canary). Use `pending-teamforge-verification` when a git-remote-derived `githubIdentity` exists, else `unknown`.
- `commands.verify` must never be `"not-applicable"` and must never be empty — when no `build` or `test` script can be found, use the literal safe placeholder `"true"` and flag `commands.verify` in `needsReview`.
- `commands.setup`/`commands.test` may legitimately be `"not-applicable"` — the schema only forbids that literal value for `commands.verify`.
- Never fabricate narrative content this tool has no evidence for — `PROJECT.md`'s project description is a factual bullet list sourced from the registry (`name`, `kind`, `workId`, `lifecycle`), not an invented prose paragraph.
- Every mutating test in this package uses fixture directories only, never the real vault — same discipline as every other module in `package/relocation/`.

---

### Task 1: Registry matching, evidence types, and `gatherPacketEvidence`

**Files:**
- Create: `package/relocation/packet-evidence.ts`
- Test: `package/relocation/packet-evidence.test.ts`

**Interfaces:**
- Produces: `interface RegistryWorkObject { workId: string; name: string; kind: "sapling" | "program"; programKind?: "client" | "company" | "capability" | "operations"; accountId?: string; lifecycle?: string; sourceRefs: string[] }`, `interface RegistrySourceInventoryEntry { path: string; workRefs: string[] }`, `interface CanonicalRegistry { workObjects: RegistryWorkObject[]; sourceInventory: RegistrySourceInventoryEntry[] }`, `interface PacketEvidence { projectId: string; portfolio: "thoughtseed" | "tryambakam-noesis"; repository: string; workObjectId: string; workObjectName: string; workObjectKind: "sapling" | "program"; githubIdentity?: string; identityStatus: "pending-teamforge-verification" | "unknown"; knowledgeRef: string; knowledgeRefIsPlaceholder: boolean; setupCommand: string; testCommand: string; verifyCommand: string; needsReview: string[] }`, `function matchCandidateToWorkObject(candidateName: string, registry: CanonicalRegistry): RegistryWorkObject`, `function gatherPacketEvidence(input: { candidateName: string; portfolio: "thoughtseed" | "tryambakam-noesis"; registry: CanonicalRegistry; gitRemoteUrl: string | null; packageJsonScripts: Record<string, string> | null; hasBunLock: boolean }): PacketEvidence`

- [ ] **Step 1: Write the failing tests**

Create `package/relocation/packet-evidence.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { gatherPacketEvidence, matchCandidateToWorkObject } from "./packet-evidence";

const REGISTRY = {
  workObjects: [
    {
      workId: "sapling:hostscale",
      name: "HostScale",
      kind: "sapling" as const,
      lifecycle: undefined,
      sourceRefs: ["repo:hostscalev0", "vault:10-brand-essence/hostscale-overview.md"],
    },
    {
      workId: "program:paperclip-retired",
      name: "Paperclip Retired Execution Plane",
      kind: "program" as const,
      programKind: "operations" as const,
      lifecycle: "retired",
      sourceRefs: ["vault:00-meta/system-of-records.md", "repo:thoughtseed-paperclip"],
    },
  ],
  sourceInventory: [
    { path: "/vault/thoughtseed/hostscalev0", workRefs: ["sapling:hostscale"] },
    { path: "/vault/thoughtseed/thoughtseed-paperclip", workRefs: ["program:paperclip-retired"] },
    { path: "/vault/thoughtseed/no-work-refs", workRefs: [] },
    { path: "/vault/thoughtseed/two-work-refs", workRefs: ["sapling:hostscale", "program:paperclip-retired"] },
  ],
};

describe("matchCandidateToWorkObject", () => {
  test("matches a candidate to its single workObject via sourceInventory", () => {
    const workObject = matchCandidateToWorkObject("hostscalev0", REGISTRY);
    expect(workObject.workId).toBe("sapling:hostscale");
  });

  test("throws naming the candidate when sourceInventory has no match", () => {
    expect(() => matchCandidateToWorkObject("nonexistent-folder", REGISTRY)).toThrow(
      "nonexistent-folder: no sourceInventory match",
    );
  });

  test("throws naming the candidate when workRefs is empty", () => {
    expect(() => matchCandidateToWorkObject("no-work-refs", REGISTRY)).toThrow(
      "no-work-refs: sourceInventory entry has no workRefs",
    );
  });

  test("throws naming the candidate when workRefs has more than one entry", () => {
    expect(() => matchCandidateToWorkObject("two-work-refs", REGISTRY)).toThrow(
      "two-work-refs: sourceInventory entry has multiple workRefs (sapling:hostscale, program:paperclip-retired)",
    );
  });
});

describe("gatherPacketEvidence", () => {
  test("full confident match: vault knowledge ref, GitHub identity, build script, bun lockfile", () => {
    const evidence = gatherPacketEvidence({
      candidateName: "hostscalev0",
      portfolio: "thoughtseed",
      registry: REGISTRY,
      gitRemoteUrl: "https://github.com/Sheshiyer/hostscalev0.git",
      packageJsonScripts: { build: "next build", dev: "next dev" },
      hasBunLock: false,
    });
    expect(evidence.projectId).toBe("hostscalev0");
    expect(evidence.workObjectId).toBe("sapling:hostscale");
    expect(evidence.workObjectName).toBe("HostScale");
    expect(evidence.githubIdentity).toBe("Sheshiyer/hostscalev0");
    expect(evidence.identityStatus).toBe("pending-teamforge-verification");
    expect(evidence.knowledgeRef).toBe("10-brand-essence/hostscale-overview.md");
    expect(evidence.knowledgeRefIsPlaceholder).toBe(false);
    expect(evidence.setupCommand).toBe("npm install");
    expect(evidence.testCommand).toBe("not-applicable");
    expect(evidence.verifyCommand).toBe("npm run build");
    expect(evidence.needsReview).toEqual([]);
  });

  test("bun lockfile present selects bun as the runner", () => {
    const evidence = gatherPacketEvidence({
      candidateName: "thoughtseed-paperclip",
      portfolio: "thoughtseed",
      registry: REGISTRY,
      gitRemoteUrl: "https://github.com/Sheshiyer/thoughtseed-paperclip.git",
      packageJsonScripts: { start: "./scripts/babysitter.sh start" },
      hasBunLock: true,
    });
    expect(evidence.setupCommand).toBe("bun install");
    expect(evidence.knowledgeRef).toBe("00-meta/system-of-records.md");
  });

  test("no package.json: setup and test are not-applicable, verify is the flagged placeholder", () => {
    const evidence = gatherPacketEvidence({
      candidateName: "hostscalev0",
      portfolio: "thoughtseed",
      registry: REGISTRY,
      gitRemoteUrl: "https://github.com/Sheshiyer/hostscalev0.git",
      packageJsonScripts: null,
      hasBunLock: false,
    });
    expect(evidence.setupCommand).toBe("not-applicable");
    expect(evidence.testCommand).toBe("not-applicable");
    expect(evidence.verifyCommand).toBe("true");
    expect(evidence.needsReview).toContain("commands.verify");
  });

  test("package.json exists but has no build or test script: verify falls back and is flagged", () => {
    const evidence = gatherPacketEvidence({
      candidateName: "thoughtseed-paperclip",
      portfolio: "thoughtseed",
      registry: REGISTRY,
      gitRemoteUrl: "https://github.com/Sheshiyer/thoughtseed-paperclip.git",
      packageJsonScripts: { standup: "./scripts/standup.sh" },
      hasBunLock: true,
    });
    expect(evidence.verifyCommand).toBe("true");
    expect(evidence.needsReview).toContain("commands.verify");
    expect(evidence.testCommand).toBe("not-applicable");
  });

  test("test script present but no build script: verify uses the test command", () => {
    const evidence = gatherPacketEvidence({
      candidateName: "hostscalev0",
      portfolio: "thoughtseed",
      registry: REGISTRY,
      gitRemoteUrl: "https://github.com/Sheshiyer/hostscalev0.git",
      packageJsonScripts: { test: "vitest run" },
      hasBunLock: false,
    });
    expect(evidence.testCommand).toBe("npm run test");
    expect(evidence.verifyCommand).toBe("npm run test");
    expect(evidence.needsReview).not.toContain("commands.verify");
  });

  test("no vault: sourceRef: knowledge_ref falls back to a flagged placeholder", () => {
    const registryNoVaultRef = {
      workObjects: [
        {
          workId: "sapling:hostscale",
          name: "HostScale",
          kind: "sapling" as const,
          sourceRefs: ["repo:hostscalev0"],
        },
      ],
      sourceInventory: [{ path: "/vault/thoughtseed/hostscalev0", workRefs: ["sapling:hostscale"] }],
    };
    const evidence = gatherPacketEvidence({
      candidateName: "hostscalev0",
      portfolio: "thoughtseed",
      registry: registryNoVaultRef,
      gitRemoteUrl: "https://github.com/Sheshiyer/hostscalev0.git",
      packageJsonScripts: { build: "next build" },
      hasBunLock: false,
    });
    expect(evidence.knowledgeRefIsPlaceholder).toBe(true);
    expect(evidence.needsReview).toContain("knowledge_ref");
  });

  test("no git remote: githubIdentity omitted, identityStatus unknown", () => {
    const evidence = gatherPacketEvidence({
      candidateName: "hostscalev0",
      portfolio: "thoughtseed",
      registry: REGISTRY,
      gitRemoteUrl: null,
      packageJsonScripts: { build: "next build" },
      hasBunLock: false,
    });
    expect(evidence.githubIdentity).toBeUndefined();
    expect(evidence.identityStatus).toBe("unknown");
  });

  test("git remote that doesn't parse as owner/name: githubIdentity omitted, identityStatus unknown", () => {
    const evidence = gatherPacketEvidence({
      candidateName: "hostscalev0",
      portfolio: "thoughtseed",
      registry: REGISTRY,
      gitRemoteUrl: "https://gitlab.com/some/nested/path/hostscalev0.git",
      packageJsonScripts: { build: "next build" },
      hasBunLock: false,
    });
    expect(evidence.githubIdentity).toBeUndefined();
    expect(evidence.identityStatus).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd <PROJECT_VOLUME>/2026/twc-vault/01-Projects/thoughtseed/temperance_engine/.worktrees/packet-authoring && bun test package/relocation/packet-evidence.test.ts`
Expected: FAIL with "Cannot find module './packet-evidence'"

- [ ] **Step 3: Implement `packet-evidence.ts`**

Create `package/relocation/packet-evidence.ts`:

```ts
/**
 * Gathers real, sourced evidence for one candidate's relocation packet —
 * never a guess. Every field is either sourced (registry, git remote,
 * package.json) or explicitly flagged in `needsReview`. The canonical
 * registry is the primary evidence source (already-verified data from the
 * portfolio classification work), not raw repository re-investigation.
 */

export interface RegistryWorkObject {
  workId: string;
  name: string;
  kind: "sapling" | "program";
  programKind?: "client" | "company" | "capability" | "operations";
  accountId?: string;
  lifecycle?: string;
  sourceRefs: string[];
}

export interface RegistrySourceInventoryEntry {
  path: string;
  workRefs: string[];
}

export interface CanonicalRegistry {
  workObjects: RegistryWorkObject[];
  sourceInventory: RegistrySourceInventoryEntry[];
}

export interface PacketEvidence {
  projectId: string;
  portfolio: "thoughtseed" | "tryambakam-noesis";
  repository: string;
  workObjectId: string;
  workObjectName: string;
  workObjectKind: "sapling" | "program";
  githubIdentity?: string;
  identityStatus: "pending-teamforge-verification" | "unknown";
  knowledgeRef: string;
  knowledgeRefIsPlaceholder: boolean;
  setupCommand: string;
  testCommand: string;
  verifyCommand: string;
  needsReview: string[];
}

export function matchCandidateToWorkObject(
  candidateName: string,
  registry: CanonicalRegistry,
): RegistryWorkObject {
  const matches = registry.sourceInventory.filter(
    (entry) => entry.path.split("/").filter(Boolean).pop() === candidateName,
  );
  if (matches.length === 0) {
    throw new Error(`${candidateName}: no sourceInventory match`);
  }
  if (matches.length > 1) {
    throw new Error(`${candidateName}: multiple sourceInventory matches`);
  }
  const workRefs = matches[0].workRefs;
  if (workRefs.length === 0) {
    throw new Error(`${candidateName}: sourceInventory entry has no workRefs`);
  }
  if (workRefs.length > 1) {
    throw new Error(
      `${candidateName}: sourceInventory entry has multiple workRefs (${workRefs.join(", ")})`,
    );
  }
  const workObject = registry.workObjects.find((entry) => entry.workId === workRefs[0]);
  if (!workObject) {
    throw new Error(`${candidateName}: workRefs[0] "${workRefs[0]}" not found in workObjects`);
  }
  return workObject;
}

function extractGithubIdentity(remoteUrl: string | null): string | undefined {
  if (!remoteUrl) return undefined;
  const match = remoteUrl.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  return match ? match[1] : undefined;
}

function extractKnowledgeRef(sourceRefs: string[]): { value: string; isPlaceholder: boolean } {
  const vaultRef = sourceRefs.find((ref) => ref.startsWith("vault:"));
  if (vaultRef) return { value: vaultRef.slice("vault:".length), isPlaceholder: false };
  return {
    value: "00-meta/system-of-records.md",
    isPlaceholder: true,
  };
}

function selectCommands(
  packageJsonScripts: Record<string, string> | null,
  hasBunLock: boolean,
  needsReview: string[],
): { setupCommand: string; testCommand: string; verifyCommand: string } {
  if (!packageJsonScripts) {
    needsReview.push("commands.verify");
    return { setupCommand: "not-applicable", testCommand: "not-applicable", verifyCommand: "true" };
  }
  const runner = hasBunLock ? "bun" : "npm";
  const setupCommand = hasBunLock ? "bun install" : "npm install";
  const testCommand = packageJsonScripts.test ? `${runner} run test` : "not-applicable";
  let verifyCommand: string;
  if (packageJsonScripts.build) {
    verifyCommand = `${runner} run build`;
  } else if (packageJsonScripts.test) {
    verifyCommand = `${runner} run test`;
  } else {
    needsReview.push("commands.verify");
    verifyCommand = "true";
  }
  return { setupCommand, testCommand, verifyCommand };
}

export function gatherPacketEvidence(input: {
  candidateName: string;
  portfolio: "thoughtseed" | "tryambakam-noesis";
  registry: CanonicalRegistry;
  gitRemoteUrl: string | null;
  packageJsonScripts: Record<string, string> | null;
  hasBunLock: boolean;
}): PacketEvidence {
  const workObject = matchCandidateToWorkObject(input.candidateName, input.registry);
  const needsReview: string[] = [];

  const githubIdentity = extractGithubIdentity(input.gitRemoteUrl);
  const identityStatus = githubIdentity ? "pending-teamforge-verification" : "unknown";

  const { value: knowledgeRef, isPlaceholder: knowledgeRefIsPlaceholder } = extractKnowledgeRef(
    workObject.sourceRefs,
  );
  if (knowledgeRefIsPlaceholder) needsReview.push("knowledge_ref");

  const { setupCommand, testCommand, verifyCommand } = selectCommands(
    input.packageJsonScripts,
    input.hasBunLock,
    needsReview,
  );

  return {
    projectId: input.candidateName,
    portfolio: input.portfolio,
    repository: input.candidateName,
    workObjectId: workObject.workId,
    workObjectName: workObject.name,
    workObjectKind: workObject.kind,
    githubIdentity,
    identityStatus,
    knowledgeRef,
    knowledgeRefIsPlaceholder,
    setupCommand,
    testCommand,
    verifyCommand,
    needsReview,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/packet-evidence.test.ts`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add package/relocation/packet-evidence.ts package/relocation/packet-evidence.test.ts
git commit -m "feat(relocation): add gatherPacketEvidence — registry-first packet evidence gathering"
```

---

### Task 2: `renderPacket` — the six packet file templates

**Files:**
- Create: `package/relocation/packet-draft.ts`
- Test: `package/relocation/packet-draft.test.ts`

**Interfaces:**
- Consumes: `PacketEvidence` from Task 1 (`package/relocation/packet-evidence.ts`).
- Produces: `function renderPacket(evidence: PacketEvidence): Record<string, string>` — keys are the 6 packet-relative paths (`PROJECT.md`, `AGENTS.md`, `CLAUDE.md`, `.project/CONTEXT.md`, `.project/project.yaml`, `.project/HANDOFF.md`).

- [ ] **Step 1: Write the failing tests**

Create `package/relocation/packet-draft.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { renderPacket } from "./packet-draft";
import type { PacketEvidence } from "./packet-evidence";

const CONFIDENT_EVIDENCE: PacketEvidence = {
  projectId: "hostscalev0",
  portfolio: "thoughtseed",
  repository: "hostscalev0",
  workObjectId: "sapling:hostscale",
  workObjectName: "HostScale",
  workObjectKind: "sapling",
  githubIdentity: "Sheshiyer/hostscalev0",
  identityStatus: "pending-teamforge-verification",
  knowledgeRef: "10-brand-essence/hostscale-overview.md",
  knowledgeRefIsPlaceholder: false,
  setupCommand: "npm install",
  testCommand: "not-applicable",
  verifyCommand: "npm run build",
  needsReview: [],
};

const FLAGGED_EVIDENCE: PacketEvidence = {
  ...CONFIDENT_EVIDENCE,
  githubIdentity: undefined,
  identityStatus: "unknown",
  knowledgeRefIsPlaceholder: true,
  verifyCommand: "true",
  needsReview: ["knowledge_ref", "commands.verify"],
};

describe("renderPacket", () => {
  test("produces exactly the six required files", () => {
    const files = renderPacket(CONFIDENT_EVIDENCE);
    expect(Object.keys(files).sort()).toEqual(
      ["AGENTS.md", "CLAUDE.md", "PROJECT.md", ".project/CONTEXT.md", ".project/HANDOFF.md", ".project/project.yaml"].sort(),
    );
  });

  test("PROJECT.md is a factual bullet list, includes workObject name and workId", () => {
    const files = renderPacket(CONFIDENT_EVIDENCE);
    expect(files["PROJECT.md"]).toContain("HostScale");
    expect(files["PROJECT.md"]).toContain("sapling:hostscale");
    expect(files["PROJECT.md"]).toContain("hostscalev0");
    expect(files["PROJECT.md"]).toContain("draft-held");
  });

  test("project.yaml round-trips through the real validator cleanly", () => {
    const files = renderPacket(CONFIDENT_EVIDENCE);
    const yaml = files[".project/project.yaml"];
    expect(yaml).toContain("schema_version: 1");
    expect(yaml).toContain("packet_status: draft-held");
    expect(yaml).toContain("project_id: hostscalev0");
    expect(yaml).toContain("identity_status: pending-teamforge-verification");
    expect(yaml).toContain("portfolio: thoughtseed");
    expect(yaml).toContain("repository: hostscalev0");
    expect(yaml).toContain("github_repository: Sheshiyer/hostscalev0");
    expect(yaml).toContain("knowledge_ref: 10-brand-essence/hostscale-overview.md");
    expect(yaml).toContain("default_interactive_client: codex");
    expect(yaml).toContain("approval_profile: founder-gated");
    expect(yaml).toContain("authority: temperance-omniroute");
    expect(yaml).toContain("deployment_profile: hostscalev0");
    expect(yaml).toContain("verification_state: unverified");
    expect(yaml).toContain("credential_scope_ref: thoughtseed-founder-local-config");
    expect(yaml).toContain("plan_lane: te-plan");
    expect(yaml).toContain("review_lane: te-review");
    expect(yaml).toContain("setup: npm install");
    expect(yaml).toContain("test: not-applicable");
    expect(yaml).toContain("verify: npm run build");
    expect(yaml).toMatch(/context:\n {2}- PROJECT\.md\n {2}- AGENTS\.md\n {2}- CLAUDE\.md\n {2}- \.project\/CONTEXT\.md\n {2}- \.project\/project\.yaml\n {2}- \.project\/HANDOFF\.md/);
  });

  test("project.yaml omits github_repository when no GitHub identity was found", () => {
    const files = renderPacket(FLAGGED_EVIDENCE);
    expect(files[".project/project.yaml"]).not.toContain("github_repository:");
    expect(files[".project/project.yaml"]).toContain("identity_status: unknown");
  });

  test("AGENTS.md and CLAUDE.md are identical boilerplate across different evidence, except the repository name", () => {
    const filesA = renderPacket(CONFIDENT_EVIDENCE);
    const filesB = renderPacket({ ...CONFIDENT_EVIDENCE, projectId: "wtfmedia", repository: "wtfmedia" });
    const normalize = (text: string) => text.replaceAll("hostscalev0", "<repo>").replaceAll("wtfmedia", "<repo>");
    expect(normalize(filesA["AGENTS.md"])).toBe(normalize(filesB["AGENTS.md"]));
    expect(normalize(filesA["CLAUDE.md"])).toBe(normalize(filesB["CLAUDE.md"]));
  });

  test("HANDOFF.md always points to the review summary, never invents a project-specific narrative", () => {
    const files = renderPacket(CONFIDENT_EVIDENCE);
    expect(files[".project/HANDOFF.md"]).toContain("draft-held");
    expect(files[".project/HANDOFF.md"]).toContain("Review this draft packet");
    expect(files[".project/HANDOFF.md"]).toContain("reviewed-held");
  });

  test("CONTEXT.md surfaces flagged fields when evidence has needsReview items", () => {
    const files = renderPacket(FLAGGED_EVIDENCE);
    expect(files[".project/CONTEXT.md"]).toContain("knowledge_ref");
    expect(files[".project/CONTEXT.md"]).toContain("commands.verify");
    expect(files[".project/CONTEXT.md"]).toContain("needs review");
  });

  test("CONTEXT.md states no open items when needsReview is empty", () => {
    const files = renderPacket(CONFIDENT_EVIDENCE);
    expect(files[".project/CONTEXT.md"]).toContain("No fields were flagged");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test package/relocation/packet-draft.test.ts`
Expected: FAIL with "Cannot find module './packet-draft'"

- [ ] **Step 3: Implement `packet-draft.ts`**

Create `package/relocation/packet-draft.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/packet-draft.test.ts`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add package/relocation/packet-draft.ts package/relocation/packet-draft.test.ts
git commit -m "feat(relocation): add renderPacket — six packet file templates from evidence"
```

---

### Task 3: `draft-packets` CLI subcommand and review summary

**Files:**
- Modify: `scripts/vault-project-relocation.ts`
- Test: `tests/vault-project-relocation-draft-packets.test.ts`

**Interfaces:**
- Consumes: `gatherPacketEvidence`/`PacketEvidence`/`CanonicalRegistry` from Task 1, `renderPacket` from Task 2.
- Produces: CLI subcommand `bun scripts/vault-project-relocation.ts draft-packets --vault-root <path> --portfolio thoughtseed|tryambakam-noesis --registry-path <path> --candidate <name>... --output <path>` that writes 6 files into each candidate repo and one review summary markdown to `--output`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/vault-project-relocation-draft-packets.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "draft-packets-fixture-"));

  const vaultRoot = join(fixtureRoot, "thoughtseed");
  mkdirSync(join(vaultRoot, "example-app"), { recursive: true });
  execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: join(vaultRoot, "example-app") });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example-owner/example-app.git"], {
    cwd: join(vaultRoot, "example-app"),
  });
  writeFileSync(
    join(vaultRoot, "example-app", "package.json"),
    JSON.stringify({ name: "example-app", scripts: { build: "next build" } }),
  );

  mkdirSync(join(vaultRoot, "no-evidence-repo"), { recursive: true });
  execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: join(vaultRoot, "no-evidence-repo") });

  const registryDir = join(fixtureRoot, "thoughtseed-labs", "00-meta");
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(
    join(registryDir, "work-object-registry.v1.json"),
    JSON.stringify({
      workObjects: [
        {
          workId: "sapling:example",
          name: "Example App",
          kind: "sapling",
          sourceRefs: ["repo:example-app", "vault:10-brand-essence/example-overview.md"],
        },
        {
          workId: "program:no-evidence",
          name: "No Evidence Program",
          kind: "program",
          programKind: "capability",
          sourceRefs: ["repo:no-evidence-repo"],
        },
      ],
      sourceInventory: [
        { path: `${vaultRoot}/example-app`, workRefs: ["sapling:example"] },
        { path: `${vaultRoot}/no-evidence-repo`, workRefs: ["program:no-evidence"] },
      ],
    }),
  );
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("draft-packets CLI subcommand", () => {
  test("writes all six packet files into each candidate and a review summary", () => {
    const outputPath = join(fixtureRoot, "review-summary.md");
    execFileSync(
      "bun",
      [
        join(import.meta.dir, "..", "scripts", "vault-project-relocation.ts"),
        "draft-packets",
        "--vault-root",
        join(fixtureRoot, "thoughtseed"),
        "--portfolio",
        "thoughtseed",
        "--registry-path",
        join(fixtureRoot, "thoughtseed-labs", "00-meta", "work-object-registry.v1.json"),
        "--candidate",
        "example-app",
        "--candidate",
        "no-evidence-repo",
        "--output",
        outputPath,
      ],
      { encoding: "utf8" },
    );

    const exampleProjectMd = readFileSync(
      join(fixtureRoot, "thoughtseed", "example-app", "PROJECT.md"),
      "utf8",
    );
    expect(exampleProjectMd).toContain("Example App");
    expect(existsSync(join(fixtureRoot, "thoughtseed", "example-app", ".project", "project.yaml"))).toBe(true);
    expect(existsSync(join(fixtureRoot, "thoughtseed", "no-evidence-repo", ".project", "HANDOFF.md"))).toBe(true);

    const summary = readFileSync(outputPath, "utf8");
    expect(summary).toContain("example-app");
    expect(summary).toContain("no-evidence-repo");
    expect(summary).toContain("commands.verify");
  });

  test("a candidate that fails evidence-gathering is reported and doesn't block the others", () => {
    const outputPath = join(fixtureRoot, "review-summary-2.md");
    execFileSync(
      "bun",
      [
        join(import.meta.dir, "..", "scripts", "vault-project-relocation.ts"),
        "draft-packets",
        "--vault-root",
        join(fixtureRoot, "thoughtseed"),
        "--portfolio",
        "thoughtseed",
        "--registry-path",
        join(fixtureRoot, "thoughtseed-labs", "00-meta", "work-object-registry.v1.json"),
        "--candidate",
        "example-app",
        "--candidate",
        "unmatched-folder",
        "--output",
        outputPath,
      ],
      { encoding: "utf8" },
    );

    expect(existsSync(join(fixtureRoot, "thoughtseed", "example-app", "PROJECT.md"))).toBe(true);
    const summary = readFileSync(outputPath, "utf8");
    expect(summary).toContain("FAILED: unmatched-folder");
    expect(summary).toContain("no sourceInventory match");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/vault-project-relocation-draft-packets.test.ts`
Expected: FAIL with "unknown_argument:draft-packets" (the subcommand doesn't exist yet)

- [ ] **Step 3: Add the `draft-packets` subcommand**

In `scripts/vault-project-relocation.ts`, add these imports near the existing relocation-package imports (after the `project-registry` import block):

```ts
import { gatherPacketEvidence, type CanonicalRegistry } from "../package/relocation/packet-evidence";
import { renderPacket } from "../package/relocation/packet-draft";
```

Add this function near `approvedLanes()` (it reads the git remote the same way other CLI code in this file already uses `spawnSync`):

```ts
function gitRemoteUrlFor(repositoryPath: string): string | null {
  const result = spawnSync("git", ["-C", repositoryPath, "remote", "get-url", "origin"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function packageJsonScriptsFor(repositoryPath: string): Record<string, string> | null {
  const packageJsonPath = join(repositoryPath, "package.json");
  if (!existsSync(packageJsonPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return typeof parsed.scripts === "object" && parsed.scripts !== null ? parsed.scripts : {};
  } catch {
    return {};
  }
}

function hasBunLockFor(repositoryPath: string): boolean {
  return existsSync(join(repositoryPath, "bun.lock")) || existsSync(join(repositoryPath, "bun.lockb"));
}

function writePacketFiles(repositoryPath: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(repositoryPath, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf8");
  }
}

// writeOwnerOnly (pre-existing) JSON.stringifies its second argument — fine
// for InventoryReport/PlanReport, but running the review summary markdown
// through it would collapse the whole document into one JSON-escaped
// string. Same owner-only permission handling, plain text instead.
function writeOwnerOnlyText(output: string, text: string): void {
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  chmodSync(dirname(output), 0o700);
  writeFileSync(output, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600, flag: "w" });
  chmodSync(output, 0o600);
}
```

Add the subcommand handler to the `usage()` function's text block:

```
  bun scripts/vault-project-relocation.ts draft-packets \
    --vault-root <absolute-portfolio-root> \
    --portfolio thoughtseed|tryambakam-noesis \
    --registry-path <absolute-registry-json-path> \
    --candidate <folder-name> [--candidate <folder-name> ...] \
    --output <owner-only-review-summary.md>
```

Add the handler in the main `try` block, as a new `else if` branch before the final `else { usage(); }`. `--portfolio` is taken explicitly (matching the existing `inventory` subcommand's own pattern) rather than inferred from `--vault-root` — `inferPortfolio()` expects a *repository* path (it checks `dirname(path) === root`), not a portfolio root itself, and an explicit flag is also what makes this testable against a fixture directory tree that can never match the real, hardcoded `PORTFOLIO_ROOTS` paths:

```ts
  } else if (argv[0] === "draft-packets") {
    let vaultRoot = "";
    let portfolio: Portfolio | "" = "";
    let registryPath = "";
    let output = "";
    const candidates: string[] = [];
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--vault-root") vaultRoot = argv[++i] ?? "";
      else if (arg === "--portfolio") {
        const value = argv[++i];
        if (value !== "thoughtseed" && value !== "tryambakam-noesis") {
          throw new Error(`portfolio_not_allowed:${value ?? ""}`);
        }
        portfolio = value;
      } else if (arg === "--registry-path") registryPath = argv[++i] ?? "";
      else if (arg === "--output") output = argv[++i] ?? "";
      else if (arg === "--candidate") candidates.push(argv[++i] ?? "");
      else throw new Error(`unknown_argument:${arg}`);
    }
    if (!vaultRoot || !portfolio || !registryPath || !output || candidates.length === 0) {
      throw new Error(
        "draft_packets_requires_vault_root_portfolio_registry_path_output_and_at_least_one_candidate",
      );
    }
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as CanonicalRegistry;
    const summaryLines: string[] = ["# Packet draft summary", ""];
    let draftedCount = 0;
    let failedCount = 0;
    for (const candidateName of candidates) {
      const repositoryPath = join(vaultRoot, candidateName);
      try {
        const evidence = gatherPacketEvidence({
          candidateName,
          portfolio,
          registry,
          gitRemoteUrl: gitRemoteUrlFor(repositoryPath),
          packageJsonScripts: packageJsonScriptsFor(repositoryPath),
          hasBunLock: hasBunLockFor(repositoryPath),
        });
        const files = renderPacket(evidence);
        writePacketFiles(repositoryPath, files);
        draftedCount += 1;
        summaryLines.push(`## ${candidateName}`, "");
        summaryLines.push(`- WorkObject: \`${evidence.workObjectId}\` (${evidence.workObjectName})`);
        summaryLines.push(
          evidence.needsReview.length === 0
            ? "- All fields sourced confidently."
            : `- Needs review: ${evidence.needsReview.join(", ")}`,
        );
        summaryLines.push("");
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        summaryLines.push(`## ${candidateName}`, "", `FAILED: ${candidateName}: ${message}`, "");
      }
    }
    summaryLines.unshift(`Drafted: ${draftedCount}. Failed: ${failedCount}.`, "");
    writeOwnerOnlyText(resolve(output), summaryLines.join("\n"));
    console.log(JSON.stringify({ output: resolve(output), drafted: draftedCount, failed: failedCount }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/vault-project-relocation-draft-packets.test.ts`
Expected: PASS, both tests

- [ ] **Step 5: Commit**

```bash
git add scripts/vault-project-relocation.ts tests/vault-project-relocation-draft-packets.test.ts
git commit -m "feat(relocation): wire draft-packets CLI subcommand"
```

---

### Task 4: Wire into verify-all.sh, update docs, real vault proof

**Files:**
- Modify: `scripts/verify-all.sh` (or the project's equivalent test-aggregation script — locate it first with `grep -rl "portfolio-catalog.test\|vault-project-relocation" scripts/*.sh` if the name differs)
- Modify: `docs/vault-project-relocation.md`

- [ ] **Step 1: Locate and update the test-aggregation script**

Run: `grep -n "vault-project-relocation" scripts/verify-all.sh`

Add `package/relocation/packet-evidence.test.ts`, `package/relocation/packet-draft.test.ts`, and `tests/vault-project-relocation-draft-packets.test.ts` to the same list pattern the file already uses for this package's other test files (match the existing line format exactly — read a few lines of context around the existing `package/relocation/*.test.ts` entries before editing).

- [ ] **Step 2: Run the full scoped test suite**

Run: `bun test package/relocation/ tests/vault-project-relocation-draft-packets.test.ts`
Expected: PASS, all tests across every file in this package plus the new ones

- [ ] **Step 3: Document the new subcommand**

In `docs/vault-project-relocation.md`, add a section after the existing subcommand documentation (match the existing subcommand doc format — read the file's structure first):

```markdown
### `draft-packets`

Drafts the six required packet files (`packet_status: draft-held`) for one
or more candidate repositories, sourcing evidence primarily from the
canonical registry (`work-object-registry.v1.json`) via each candidate's
`sourceInventory` match, falling back to the candidate's git remote and
`package.json` for fields the registry doesn't cover. Writes the files
directly into each candidate's working tree — never commits. Produces one
consolidated review summary listing every candidate's flagged fields.

```bash
bun scripts/vault-project-relocation.ts draft-packets \
  --vault-root <absolute-portfolio-root> \
  --portfolio thoughtseed|tryambakam-noesis \
  --registry-path <absolute-registry-json-path> \
  --candidate <folder-name> [--candidate <folder-name> ...] \
  --output <owner-only-review-summary.md>
```

A drafted packet is not ready for `plan`/`apply` until a human reviews it,
resolves every flagged field, commits the six files, and updates
`packet_status` to `reviewed-held` — the same review gate the canary packet
went through before its own relocation.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-all.sh docs/vault-project-relocation.md
git commit -m "docs(relocation): wire draft-packets tests into verify-all.sh, document the subcommand"
```

---

### Task 5: Real vault proof

**Files:** none modified — this task only runs the tool against the real vault and reports results.

- [ ] **Step 1: Run `draft-packets` against the 23 real candidates**

Run:

```bash
bun scripts/vault-project-relocation.ts draft-packets \
  --vault-root <PROJECT_VOLUME>/2026/twc-vault/01-Projects/thoughtseed \
  --portfolio thoughtseed \
  --registry-path <PROJECT_VOLUME>/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-labs/00-meta/work-object-registry.v1.json \
  --candidate brandmint-showcase --candidate brandmint-v2 --candidate bwssb \
  --candidate cambium --candidate explee-skills --candidate fitcheck-landing \
  --candidate fmrl --candidate github-next-wave-orchestrator --candidate gram-cli \
  --candidate hostscalev0 --candidate manifest-skill-cluster --candidate monthlymealprep \
  --candidate motionsites-export --candidate newsense --candidate newsense-launch \
  --candidate ratan-pitch --candidate ratandevelopers --candidate rssfeedscrapper \
  --candidate swarm-architect-skill --candidate synchronized-universe-blog \
  --candidate thoughtseed-paperclip --candidate virtualtryon-3d --candidate wtfmedia \
  --output ~/.temperance_engine/receipts/vault-project-relocation-draft-packets/$(date -u +%Y%m%dT%H%M%SZ)/summary.md
```

Expected: exits 0, prints `{"output": "...", "drafted": <N>, "failed": <N>}`.

- [ ] **Step 2: Confirm every candidate got its 6 files, uncommitted**

Run, for a sample of 4-5 candidates spread across the list (e.g. `cambium`, `hostscalev0`, `thoughtseed-paperclip`, `wtfmedia`):

```bash
for name in cambium hostscalev0 thoughtseed-paperclip wtfmedia; do
  echo "=== $name ==="
  git -C "<PROJECT_VOLUME>/2026/twc-vault/01-Projects/thoughtseed/$name" status --porcelain
done
```

Expected: each shows the 6 new/modified files as untracked/uncommitted, nothing else.

- [ ] **Step 3: Spot-check 3-4 drafted packets by hand for accuracy**

Read the drafted `PROJECT.md` and `.project/project.yaml` for 3-4 candidates directly and compare against the real registry entries and each repo's actual `package.json` to confirm the evidence-gathering was accurate, not just schema-valid.

- [ ] **Step 4: Confirm `packet_missing` clears on a now-packeted candidate**

Run:

```bash
cd <PROJECT_VOLUME>/2026/twc-vault/01-Projects/thoughtseed/temperance_engine
bun scripts/vault-project-relocation.ts plan \
  --repository <PROJECT_VOLUME>/2026/twc-vault/01-Projects/thoughtseed/hostscalev0 \
  --dry-run \
  --output /tmp/plan-hostscalev0-check.json
```

Expected: `holdReasons` no longer includes `"packet_missing:..."` (whatever else remains — `working_tree_not_clean`, etc. — is expected and unrelated to this piece).

- [ ] **Step 5: Report the review summary's needsReview totals**

Read the written summary file and report, in plain text (not a commit): how many candidates drafted cleanly (`needsReview: []`) vs. how many have flagged fields, and which fields are most common across the flagged set — this is the founder-facing signal for how much manual work remains before any of these 23 could move to `reviewed-held`.
