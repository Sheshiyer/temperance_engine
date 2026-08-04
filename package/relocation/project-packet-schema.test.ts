import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

import { validateProjectYaml } from "./project-packet-schema";

const THOUGHTSEED_BRAND_ATLAS_REPO =
  "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-brand-atlas";

const APPROVED_LANES = ["te-plan", "te-review", "te-build"];

const VALID_THOUGHTSEED_PACKET = {
  schema_version: 1,
  packet_status: "reviewed-held",
  project_id: "thoughtseed-brand-atlas",
  identity_status: "verified-teamforge",
  portfolio: "thoughtseed",
  repository: "thoughtseed-brand-atlas",
  github_repository: "Sheshiyer/thoughtseed-brand-atlas",
  knowledge_ref: "thoughtseed-labs/10-brand-essence/visual-identity-2026-08/",
  governance: {
    default_interactive_client: "codex",
    approval_profile: "founder-gated",
  },
  routing: {
    authority: "temperance-omniroute",
    deployment_profile: "thoughtseed-brand-atlas",
    verification_state: "unverified",
    credential_scope_ref: "thoughtseed-founder-local-config",
    plan_lane: "te-plan",
    review_lane: "te-review",
  },
  commands: {
    setup: "bun install",
    test: "bun run build",
    verify: "bun run build",
  },
  context: [
    "PROJECT.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".project/CONTEXT.md",
    ".project/project.yaml",
    ".project/HANDOFF.md",
  ],
};

function withOverrides(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...VALID_THOUGHTSEED_PACKET, ...overrides };
}

function withoutKey(key: string): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...VALID_THOUGHTSEED_PACKET };
  delete clone[key];
  return clone;
}

function withNestedOverride(
  section: "governance" | "routing" | "commands",
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...VALID_THOUGHTSEED_PACKET,
    [section]: { ...VALID_THOUGHTSEED_PACKET[section], ...overrides },
  };
}

function withoutNestedSection(section: "governance" | "routing" | "commands"): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...VALID_THOUGHTSEED_PACKET };
  delete clone[section];
  return clone;
}

function errorsOf(result: ReturnType<typeof validateProjectYaml>): string[] {
  return result.valid ? [] : result.errors;
}

describe("validateProjectYaml — top-level required fields", () => {
  test("accepts the valid baseline packet", () => {
    expect(validateProjectYaml(VALID_THOUGHTSEED_PACKET, { approvedLanes: APPROVED_LANES })).toEqual({
      valid: true,
    });
  });

  test("rejects a missing schema_version", () => {
    const result = validateProjectYaml(withoutKey("schema_version"), { approvedLanes: APPROVED_LANES });
    expect(result.valid).toBe(false);
    expect((result as { errors: string[] }).errors.some((e) => e.includes("schema_version"))).toBe(true);
  });

  test("rejects a schema_version other than 1", () => {
    const result = validateProjectYaml(withOverrides({ schema_version: 2 }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
  });

  test("rejects a packet_status outside the closed vocabulary", () => {
    const result = validateProjectYaml(withOverrides({ packet_status: "approved" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect((result as { errors: string[] }).errors.some((e) => e.includes("packet_status"))).toBe(true);
  });

  test("rejects an empty project_id", () => {
    const result = validateProjectYaml(withOverrides({ project_id: "" }), { approvedLanes: APPROVED_LANES });
    expect(result.valid).toBe(false);
  });

  test("rejects a project_id containing spaces or uppercase letters", () => {
    const result = validateProjectYaml(withOverrides({ project_id: "Thoughtseed Brand Atlas" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
  });

  test("rejects an identity_status outside the closed vocabulary", () => {
    const result = validateProjectYaml(withOverrides({ identity_status: "yes" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect((result as { errors: string[] }).errors.some((e) => e.includes("identity_status"))).toBe(true);
  });

  test("rejects a portfolio outside the exact two-name allowlist", () => {
    const result = validateProjectYaml(withOverrides({ portfolio: "acme-portfolio" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect((result as { errors: string[] }).errors.some((e) => e.includes("portfolio"))).toBe(true);
  });

  test("rejects a repository basename that fails the ratified grammar", () => {
    const result = validateProjectYaml(withOverrides({ repository: "Thoughtseed_Repo" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect((result as { errors: string[] }).errors.some((e) => e.includes("repository"))).toBe(true);
  });

  test("rejects an unknown top-level key", () => {
    const result = validateProjectYaml(withOverrides({ extra_field: "not allowed" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect((result as { errors: string[] }).errors.some((e) => e.includes("extra_field"))).toBe(true);
  });
});

describe("validateProjectYaml — governance", () => {
  test("rejects a default_interactive_client other than codex", () => {
    const result = validateProjectYaml(withNestedOverride("governance", { default_interactive_client: "claude" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("default_interactive_client"))).toBe(true);
  });

  test("rejects an approval_profile outside the closed vocabulary", () => {
    const result = validateProjectYaml(withNestedOverride("governance", { approval_profile: "self-approved" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("approval_profile"))).toBe(true);
  });

  test("rejects a packet with no governance section", () => {
    const result = validateProjectYaml(withoutNestedSection("governance"), { approvedLanes: APPROVED_LANES });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("governance"))).toBe(true);
  });

  test("rejects an unknown key inside governance", () => {
    const result = validateProjectYaml(withNestedOverride("governance", { extra: "x" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("governance.extra"))).toBe(true);
  });
});

describe("validateProjectYaml — routing", () => {
  test("rejects a routing.authority other than temperance-omniroute", () => {
    const result = validateProjectYaml(withNestedOverride("routing", { authority: "direct-omniroute" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("routing.authority"))).toBe(true);
  });

  test("rejects a verification_state outside unverified/verified", () => {
    const result = validateProjectYaml(withNestedOverride("routing", { verification_state: "maybe" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("verification_state"))).toBe(true);
  });

  test("rejects a plan_lane outside the approved te-* lane set", () => {
    const result = validateProjectYaml(withNestedOverride("routing", { plan_lane: "te-unlisted" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("plan_lane"))).toBe(true);
  });

  test("rejects a review_lane outside the approved te-* lane set", () => {
    const result = validateProjectYaml(withNestedOverride("routing", { review_lane: "te-unlisted" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("review_lane"))).toBe(true);
  });

  test("rejects an empty credential_scope_ref", () => {
    const result = validateProjectYaml(withNestedOverride("routing", { credential_scope_ref: "" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("credential_scope_ref"))).toBe(true);
  });

  test("rejects a packet with no routing section", () => {
    const result = validateProjectYaml(withoutNestedSection("routing"), { approvedLanes: APPROVED_LANES });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("routing"))).toBe(true);
  });
});

describe("validateProjectYaml — commands", () => {
  test("rejects an empty verify command — no not-applicable escape for verify", () => {
    const result = validateProjectYaml(withNestedOverride("commands", { verify: "" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("commands.verify"))).toBe(true);
  });

  test("rejects verify set to the literal not-applicable escape", () => {
    const result = validateProjectYaml(withNestedOverride("commands", { verify: "not-applicable" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("commands.verify"))).toBe(true);
  });

  test("accepts setup and test set to the not-applicable escape", () => {
    const result = validateProjectYaml(
      withNestedOverride("commands", { setup: "not-applicable", test: "not-applicable" }),
      { approvedLanes: APPROVED_LANES },
    );
    expect(result).toEqual({ valid: true });
  });

  test("rejects a packet with no commands section", () => {
    const result = validateProjectYaml(withoutNestedSection("commands"), { approvedLanes: APPROVED_LANES });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("commands"))).toBe(true);
  });
});

describe("validateProjectYaml — context", () => {
  test("rejects context missing the required PROJECT.md entry", () => {
    const result = validateProjectYaml(
      withOverrides({ context: VALID_THOUGHTSEED_PACKET.context.filter((f) => f !== "PROJECT.md") }),
      { approvedLanes: APPROVED_LANES },
    );
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("PROJECT.md"))).toBe(true);
  });

  test("rejects context missing the required .project/HANDOFF.md entry", () => {
    const result = validateProjectYaml(
      withOverrides({
        context: VALID_THOUGHTSEED_PACKET.context.filter((f) => f !== ".project/HANDOFF.md"),
      }),
      { approvedLanes: APPROVED_LANES },
    );
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("HANDOFF.md"))).toBe(true);
  });

  test("rejects a context entry outside the six canonical packet files", () => {
    const result = validateProjectYaml(
      withOverrides({ context: [...VALID_THOUGHTSEED_PACKET.context, "NOTES.md"] }),
      { approvedLanes: APPROVED_LANES },
    );
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("NOTES.md"))).toBe(true);
  });

  test("rejects duplicate context entries", () => {
    const result = validateProjectYaml(
      withOverrides({ context: [...VALID_THOUGHTSEED_PACKET.context, "PROJECT.md"] }),
      { approvedLanes: APPROVED_LANES },
    );
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("duplicate"))).toBe(true);
  });

  test("rejects context that is not an array", () => {
    const result = validateProjectYaml(withOverrides({ context: "PROJECT.md" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("context"))).toBe(true);
  });
});

const VALID_TN_PACKET = {
  ...VALID_THOUGHTSEED_PACKET,
  project_id: "tn-example-project",
  identity_status: "unknown",
  portfolio: "tryambakam-noesis",
  repository: "example-repository",
  github_repository: "owner/example-repository",
  knowledge_ref: "_System/10865xseed/projects/example-repository",
  routing: {
    ...VALID_THOUGHTSEED_PACKET.routing,
    deployment_profile: "tn-kimiclaw-omniroute",
    credential_scope_ref: "tn-local-owner-config",
  },
};

describe("validateProjectYaml — anti-patterns", () => {
  test("accepts the valid TN baseline packet", () => {
    expect(validateProjectYaml(VALID_TN_PACKET, { approvedLanes: APPROVED_LANES })).toEqual({ valid: true });
  });

  test("rejects a credential_scope_ref shaped like a GitHub personal access token", () => {
    const result = validateProjectYaml(
      withNestedOverride("routing", { credential_scope_ref: "ghp_1234567890abcdef1234567890abcdef1234" }),
      { approvedLanes: APPROVED_LANES },
    );
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("credential_scope_ref"))).toBe(true);
  });

  test("rejects a credential_scope_ref shaped like a PEM private key", () => {
    const result = validateProjectYaml(
      withNestedOverride("routing", { credential_scope_ref: "-----BEGIN PRIVATE KEY-----\nMIIB..." }),
      { approvedLanes: APPROVED_LANES },
    );
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("credential_scope_ref"))).toBe(true);
  });

  test("rejects a routing.deployment_profile that is a machine-local absolute checkout path", () => {
    const result = validateProjectYaml(
      withNestedOverride("routing", { deployment_profile: "/Users/sheshnarayaniyer/deploy-profile" }),
      { approvedLanes: APPROVED_LANES },
    );
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("deployment_profile"))).toBe(true);
  });

  test("rejects an empty knowledge_ref", () => {
    const result = validateProjectYaml(withOverrides({ knowledge_ref: "" }), { approvedLanes: APPROVED_LANES });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("knowledge_ref"))).toBe(true);
  });

  test("rejects a knowledge_ref that is a machine-local absolute path", () => {
    const result = validateProjectYaml(
      withOverrides({ knowledge_ref: "/Volumes/madara/2026/twc-vault/thoughtseed-labs/foo" }),
      { approvedLanes: APPROVED_LANES },
    );
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("knowledge_ref"))).toBe(true);
  });

  test("rejects a malformed github_repository that is not owner/repo shaped", () => {
    const result = validateProjectYaml(withOverrides({ github_repository: "not-a-valid-identity" }), {
      approvedLanes: APPROVED_LANES,
    });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("github_repository"))).toBe(true);
  });

  test("accepts a packet with github_repository omitted entirely — GitHub identity is only required when available", () => {
    const result = validateProjectYaml(withoutKey("github_repository"), { approvedLanes: APPROVED_LANES });
    expect(result).toEqual({ valid: true });
  });

  test("rejects a Tryambakam packet whose deployment_profile names a Thoughtseed-only authority", () => {
    const tnWithThoughtseedAuthority = {
      ...VALID_TN_PACKET,
      routing: { ...VALID_TN_PACKET.routing, deployment_profile: "tn-hermes-bridge-omniroute" },
    };
    const result = validateProjectYaml(tnWithThoughtseedAuthority, { approvedLanes: APPROVED_LANES });
    expect(result.valid).toBe(false);
    expect(errorsOf(result).some((e) => e.includes("cross-portfolio"))).toBe(true);
  });
});

describe("validateProjectYaml — regression against the real committed canary packet", () => {
  test("the VALID_THOUGHTSEED_PACKET fixture's key fields are drift-checked against the actual committed HEAD content", () => {
    const result = spawnSync("git", ["-C", THOUGHTSEED_BRAND_ATLAS_REPO, "show", "HEAD:.project/project.yaml"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const rawCommittedYaml = result.stdout;

    // This is a plain-text drift detector, not a full YAML parse (the
    // minimal parser lands in project-packet.ts under Task 3's later
    // step) — it proves the fixture below hasn't silently drifted from
    // what's actually committed in the canary repository.
    const expectedLines = [
      "schema_version: 1",
      "packet_status: reviewed-held",
      "project_id: thoughtseed-brand-atlas",
      "identity_status: verified-teamforge",
      "portfolio: thoughtseed",
      "repository: thoughtseed-brand-atlas",
      "github_repository: Sheshiyer/thoughtseed-brand-atlas",
      "default_interactive_client: codex",
      "approval_profile: founder-gated",
      "authority: temperance-omniroute",
      "verification_state: unverified",
      "plan_lane: te-plan",
      "review_lane: te-review",
    ];
    for (const line of expectedLines) {
      expect(rawCommittedYaml.includes(line)).toBe(true);
    }

    expect(validateProjectYaml(VALID_THOUGHTSEED_PACKET, { approvedLanes: APPROVED_LANES })).toEqual({
      valid: true,
    });
  });
});
