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
