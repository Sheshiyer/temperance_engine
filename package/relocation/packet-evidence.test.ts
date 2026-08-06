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
  test("full confident match: vault knowledge ref, GitHub identity, build script, npm project", () => {
    const evidence = gatherPacketEvidence({
      candidateName: "hostscalev0",
      portfolio: "thoughtseed",
      registry: REGISTRY,
      gitRemoteUrl: "https://github.com/Sheshiyer/hostscalev0.git",
      packageJsonScripts: { build: "next build", dev: "next dev" },
      packageManager: "npm",
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

  test("bun package manager selects bun as the runner", () => {
    const evidence = gatherPacketEvidence({
      candidateName: "thoughtseed-paperclip",
      portfolio: "thoughtseed",
      registry: REGISTRY,
      gitRemoteUrl: "https://github.com/Sheshiyer/thoughtseed-paperclip.git",
      packageJsonScripts: { start: "./scripts/babysitter.sh start" },
      packageManager: "bun",
    });
    expect(evidence.setupCommand).toBe("bun install");
    expect(evidence.knowledgeRef).toBe("00-meta/system-of-records.md");
  });

  test("pnpm package manager selects pnpm as the runner for both setup and verify", () => {
    const evidence = gatherPacketEvidence({
      candidateName: "hostscalev0",
      portfolio: "thoughtseed",
      registry: REGISTRY,
      gitRemoteUrl: "https://github.com/Sheshiyer/hostscalev0.git",
      packageJsonScripts: { build: "vite build", test: "vitest run" },
      packageManager: "pnpm",
    });
    expect(evidence.setupCommand).toBe("pnpm install");
    expect(evidence.testCommand).toBe("pnpm run test");
    expect(evidence.verifyCommand).toBe("pnpm run build");
  });

  test("no package.json: setup and test are not-applicable, verify is the flagged placeholder", () => {
    const evidence = gatherPacketEvidence({
      candidateName: "hostscalev0",
      portfolio: "thoughtseed",
      registry: REGISTRY,
      gitRemoteUrl: "https://github.com/Sheshiyer/hostscalev0.git",
      packageJsonScripts: null,
      packageManager: "npm",
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
      packageManager: "bun",
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
      packageManager: "npm",
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
      packageManager: "npm",
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
      packageManager: "npm",
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
      packageManager: "npm",
    });
    expect(evidence.githubIdentity).toBeUndefined();
    expect(evidence.identityStatus).toBe("unknown");
  });
});

describe("matchCandidateToWorkObject — nested candidates resolve via their container", () => {
  const registry = {
    workObjects: [
      { workId: "sapling:klear-karma", name: "Klear Karma", kind: "sapling" },
      { workId: "branch:heyzack", name: "HeyZack", kind: "program" },
    ],
    sourceInventory: [
      { path: "/v/thoughtseed/klear-karma", disposition: "work-source", workRefs: ["sapling:klear-karma"] },
      { path: "/v/thoughtseed/HeyZack", disposition: "work-source", workRefs: ["branch:heyzack", "branch:heyzack-crm"] },
      { path: "/v/thoughtseed/Archive", disposition: "excluded", workRefs: [] },
    ],
  } as never;

  test("a nested repo resolves to its nearest catalogued ancestor", () => {
    // The registry catalogues containers, not every repo inside them. All four
    // klear-karma repos belong to the one sapling; nothing lists them
    // individually, so without this they cannot be drafted at all.
    expect(
      matchCandidateToWorkObject("kkv2-admin-panel", registry, "klear-karma/kkv2-admin-panel").workId,
    ).toBe("sapling:klear-karma");
    expect(
      matchCandidateToWorkObject("fullscreen-clip-base", registry, "klear-karma/klearkarma-landing/fullscreen-clip-base").workId,
    ).toBe("sapling:klear-karma");
  });

  test("FAILS CLOSED when the ancestor owns more than one WorkObject", () => {
    // HeyZack's container covers 11 client branches. Nothing in the tree says
    // which one a given repo delivers, and picking is a commercial-boundary
    // decision — so refuse rather than attach the packet to a guess.
    expect(() =>
      matchCandidateToWorkObject("react-native-tuya", registry, "HeyZack/react-native-tuya"),
    ).toThrow("multiple workRefs");
  });

  test("FAILS CLOSED under a deliberately excluded container", () => {
    expect(() =>
      matchCandidateToWorkObject("lettheratout", registry, "Archive/lettheratout"),
    ).toThrow("no workRefs");
  });

  test("an exact match still wins over any ancestor", () => {
    expect(matchCandidateToWorkObject("klear-karma", registry, "klear-karma").workId).toBe(
      "sapling:klear-karma",
    );
  });

  test("depth-0 behaviour is unchanged when no relative path is given", () => {
    expect(matchCandidateToWorkObject("klear-karma", registry).workId).toBe("sapling:klear-karma");
    expect(() => matchCandidateToWorkObject("nope", registry)).toThrow("no sourceInventory match");
  });
});
