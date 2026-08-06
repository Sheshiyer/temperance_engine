import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPacketFilesPresent, computePacketDigest } from "./project-packet";
import { resolvePickupBootstrap } from "./project-pickup";

const APPROVED_LANES = ["te-plan", "te-review", "te-build"];

const PROJECT_MD = [
  "# Example Repo",
  "",
  "## Purpose and boundaries",
  "",
  "Example Repo is a fixture project used to prove the pickup resolver works",
  "end to end without any provider or session input.",
  "",
  "- Portfolio: `thoughtseed`",
  "- Repository: `example-repo`",
  "",
].join("\n");

const PROJECT_YAML = [
  "schema_version: 1",
  "packet_status: reviewed-held",
  "project_id: example-repo",
  "identity_status: verified-teamforge",
  "portfolio: thoughtseed",
  "repository: example-repo",
  "github_repository: owner/example-repo",
  "knowledge_ref: thoughtseed-labs/example/",
  "governance:",
  "  default_interactive_client: codex",
  "  approval_profile: founder-gated",
  "routing:",
  "  authority: temperance-omniroute",
  "  deployment_profile: example-repo",
  "  verification_state: unverified",
  "  credential_scope_ref: example-founder-local-config",
  "  plan_lane: te-plan",
  "  review_lane: te-review",
  "commands:",
  "  setup: bun install",
  "  test: bun test",
  "  verify: bun test",
  "context:",
  "  - PROJECT.md",
  "  - AGENTS.md",
  "  - CLAUDE.md",
  "  - .project/CONTEXT.md",
  "  - .project/project.yaml",
  "  - .project/HANDOFF.md",
].join("\n");

function handoffMd(extraSection = ""): string {
  return [
    "# Project handoff",
    "",
    "## Checkpoint",
    "",
    "- Status: `reviewed-held`",
    "- Portfolio: `thoughtseed`",
    "- Repository: `example-repo`",
    "- Branch: `main`",
    "- Base commit: `deadbeefdeadbeefdeadbeefdeadbeefdeadbeef`",
    "- GitHub: `owner/example-repo`",
    "- TeamForge project ID: `example-repo` (owner-supplied)",
    "",
    "The packet was independently committed as a six-file repository change.",
    "",
    "## Completed",
    "",
    "- First completed item.",
    "- Second completed item.",
    "",
    "## Next action",
    "",
    "Review the fresh deterministic dry-run digest and approve the exact canary manifest.",
    "",
    extraSection,
    "## Verification",
    "",
    "```bash",
    "bun install",
    "bun test",
    "```",
    "",
    "No registry, capsule, relocation, session, Paseo, provider, or deployment mutation has been performed by this handoff.",
    "",
  ].join("\n");
}

function writeFixturePacket(root: string, extraHandoffSection = ""): void {
  writeFileSync(join(root, "PROJECT.md"), PROJECT_MD);
  writeFileSync(join(root, "AGENTS.md"), "# Agents\n");
  writeFileSync(join(root, "CLAUDE.md"), "# Claude\n");
  mkdirSync(join(root, ".project"), { recursive: true });
  writeFileSync(join(root, ".project/CONTEXT.md"), "# Context\n");
  writeFileSync(join(root, ".project/project.yaml"), PROJECT_YAML);
  writeFileSync(join(root, ".project/HANDOFF.md"), handoffMd(extraHandoffSection));
}

function fixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), "project-pickup-fixture-"));
}

describe("resolvePickupBootstrap — happy path against a fixture packet", () => {
  test("resolves every required bootstrap field from a complete, valid packet", () => {
    const root = fixtureRoot();
    writeFixturePacket(root);

    const bootstrap = resolvePickupBootstrap({ repositoryRoot: root, approvedLanes: APPROVED_LANES });

    expect(bootstrap.stableId).toBe("example-repo");
    expect(bootstrap.portfolio).toBe("thoughtseed");
    expect(bootstrap.objective).toContain("Example Repo is a fixture project");
    expect(bootstrap.branch).toBe("main");
    expect(bootstrap.baseCommit).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    expect(bootstrap.completedWork).toEqual(["First completed item.", "Second completed item."]);
    expect(bootstrap.nextAction).toContain("Review the fresh deterministic dry-run digest");
    expect(bootstrap.blocker).toBe("none");
    expect(bootstrap.verificationCommand).toBe("bun test");
    expect(bootstrap.governance).toEqual({ defaultInteractiveClient: "codex", approvalProfile: "founder-gated" });
    expect(bootstrap.packetDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("resolvePickupBootstrap — packet completeness and digest validation", () => {
  test("refuses to resolve an incomplete packet missing a required file", () => {
    const root = fixtureRoot();
    writeFixturePacket(root);
    unlinkSync(join(root, "AGENTS.md"));

    expect(() => resolvePickupBootstrap({ repositoryRoot: root, approvedLanes: APPROVED_LANES })).toThrow(
      "pickup_resolver_incomplete_packet:AGENTS.md",
    );
  });

  test("resolves cleanly when the caller-supplied expected digest matches", () => {
    const root = fixtureRoot();
    writeFixturePacket(root);
    const { present } = checkPacketFilesPresent(root);
    const expectedPacketDigest = computePacketDigest(root, present);

    expect(() =>
      resolvePickupBootstrap({ repositoryRoot: root, approvedLanes: APPROVED_LANES, expectedPacketDigest }),
    ).not.toThrow();
  });

  test("refuses to resolve when the caller-supplied expected digest does not match — the packet drifted or was tampered with", () => {
    const root = fixtureRoot();
    writeFixturePacket(root);

    expect(() =>
      resolvePickupBootstrap({
        repositoryRoot: root,
        approvedLanes: APPROVED_LANES,
        expectedPacketDigest: "f".repeat(64),
      }),
    ).toThrow("pickup_resolver_digest_mismatch");
  });
});

describe("resolvePickupBootstrap — bounded to allowlisted context files only", () => {
  test("an out-of-band file present on disk but not in project.yaml's context list never influences the output", () => {
    const rootWithout = fixtureRoot();
    writeFixturePacket(rootWithout);
    const bootstrapWithout = resolvePickupBootstrap({ repositoryRoot: rootWithout, approvedLanes: APPROVED_LANES });

    const rootWith = fixtureRoot();
    writeFixturePacket(rootWith);
    writeFileSync(
      join(rootWith, "SECRETS.md"),
      "TOKEN=ghp_1234567890abcdef1234567890abcdef1234\nnext action: do something completely different",
    );
    const bootstrapWith = resolvePickupBootstrap({ repositoryRoot: rootWith, approvedLanes: APPROVED_LANES });

    // Byte-identical, including the digest: the packet digest only ever
    // covers the six canonical files, so an out-of-band extra is invisible
    // to every field this resolver produces.
    expect(bootstrapWith).toEqual(bootstrapWithout);
  });

  test("an explicit ## Blockers section overrides the none default", () => {
    const root = fixtureRoot();
    writeFixturePacket(root, "## Blockers\n\nWaiting on owner approval of the exact manifest digest.\n\n");

    const bootstrap = resolvePickupBootstrap({ repositoryRoot: root, approvedLanes: APPROVED_LANES });

    expect(bootstrap.blocker).toBe("Waiting on owner approval of the exact manifest digest.");
  });
});

// Relocated for real on 2026-08-06; the old vault path now holds the capsule.
const THOUGHTSEED_BRAND_ATLAS_REPO =
  "/Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas";

describe("resolvePickupBootstrap — regression against the real committed canary packet", () => {
  test("resolves the actual thoughtseed-brand-atlas packet correctly (read-only — this resolver never writes)", () => {
    const bootstrap = resolvePickupBootstrap({
      repositoryRoot: THOUGHTSEED_BRAND_ATLAS_REPO,
      approvedLanes: APPROVED_LANES,
    });

    expect(bootstrap.stableId).toBe("thoughtseed-brand-atlas");
    expect(bootstrap.portfolio).toBe("thoughtseed");
    expect(bootstrap.branch).toBe("main");
    expect(bootstrap.baseCommit).toBe("66d0b8a9fa6391d7159f746ede288dd3a9ab1d50");
    expect(bootstrap.verificationCommand).toBe("bun run build");
    expect(bootstrap.blocker).toBe("none");
    expect(bootstrap.objective).toContain("Brand Atlas is the deployable Astro + React");
    expect(bootstrap.nextAction).toContain("Review the fresh deterministic dry-run digest");
    expect(bootstrap.completedWork.some((item) => item.includes("66d0b8a9"))).toBe(true);
  });
});
