import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { REQUIRED_PACKET_FILES } from "./project-packet-schema";
import {
  checkPacketFilesPresent,
  computePacketDigest,
  parseFlatProjectYaml,
  readAndValidatePacket,
} from "./project-packet";

// Relocated for real on 2026-08-06. The old vault path still exists but now
// holds the capsule, not the repository -- reading the packet from there
// silently resolves capsule files instead of the real ones.
const THOUGHTSEED_BRAND_ATLAS_REPO =
  "/Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas";
const APPROVED_LANES = ["te-plan", "te-review", "te-build"];

function writeFile(root: string, relativePath: string, content: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), "project-packet-fixture-"));
}

function writeFullPacket(root: string): void {
  for (const file of REQUIRED_PACKET_FILES) {
    writeFile(root, file, `content of ${file}\n`);
  }
}

describe("checkPacketFilesPresent", () => {
  test("reports all six files present when a full packet exists", () => {
    const root = fixtureDir();
    writeFullPacket(root);
    expect(checkPacketFilesPresent(root)).toEqual({
      present: [...REQUIRED_PACKET_FILES],
      missing: [],
    });
  });

  test("splits present and missing correctly for a partial packet", () => {
    const root = fixtureDir();
    writeFile(root, "PROJECT.md", "x");
    writeFile(root, ".project/project.yaml", "x");
    const result = checkPacketFilesPresent(root);
    expect(result.present).toEqual(["PROJECT.md", ".project/project.yaml"]);
    expect(result.missing).toEqual(["AGENTS.md", "CLAUDE.md", ".project/CONTEXT.md", ".project/HANDOFF.md"]);
  });

  test("reports every file missing for an empty repository root", () => {
    const root = fixtureDir();
    expect(checkPacketFilesPresent(root)).toEqual({
      present: [],
      missing: [...REQUIRED_PACKET_FILES],
    });
  });
});

describe("computePacketDigest", () => {
  test("returns null when fewer than all six required files are present", () => {
    const root = fixtureDir();
    writeFile(root, "PROJECT.md", "x");
    expect(computePacketDigest(root, ["PROJECT.md"])).toBeNull();
  });

  test("returns a deterministic sha256 hex digest for a complete packet", () => {
    const root = fixtureDir();
    writeFullPacket(root);
    const first = computePacketDigest(root, [...REQUIRED_PACKET_FILES]);
    const second = computePacketDigest(root, [...REQUIRED_PACKET_FILES]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test("produces a different digest when any file's content changes", () => {
    const root = fixtureDir();
    writeFullPacket(root);
    const before = computePacketDigest(root, [...REQUIRED_PACKET_FILES]);
    writeFile(root, "PROJECT.md", "changed content\n");
    const after = computePacketDigest(root, [...REQUIRED_PACKET_FILES]);
    expect(after).not.toBe(before);
  });

  test("matches the NUL-separated concatenation-then-sha256 algorithm exactly", () => {
    const root = fixtureDir();
    writeFullPacket(root);
    const expected = createHash("sha256")
      .update(REQUIRED_PACKET_FILES.map((f) => `${f}\0content of ${f}\n`).join("\0"))
      .digest("hex");
    expect(computePacketDigest(root, [...REQUIRED_PACKET_FILES])).toBe(expected);
  });
});

describe("parseFlatProjectYaml", () => {
  test("parses top-level scalars, coercing schema_version to a number", () => {
    const parsed = parseFlatProjectYaml(["schema_version: 1", "project_id: example"].join("\n"));
    expect(parsed).toEqual({ schema_version: 1, project_id: "example" });
  });

  test("parses a nested one-level object section", () => {
    const text = ["governance:", "  default_interactive_client: codex", "  approval_profile: founder-gated"].join(
      "\n",
    );
    expect(parseFlatProjectYaml(text)).toEqual({
      governance: { default_interactive_client: "codex", approval_profile: "founder-gated" },
    });
  });

  test("parses a list section into a string array", () => {
    const text = ["context:", "  - PROJECT.md", "  - AGENTS.md"].join("\n");
    expect(parseFlatProjectYaml(text)).toEqual({ context: ["PROJECT.md", "AGENTS.md"] });
  });

  test("parses the real on-disk thoughtseed-brand-atlas project.yaml into a schema-valid object", () => {
    // Reads the packet ON DISK, not the committed blob. The canary checkout
    // is deliberately de-gitted -- every project repository had its history
    // pushed and its .git removed so each session can `git init` fresh -- so
    // `git show HEAD:` returns 128 here. The drift check against *committed*
    // content is genuinely weaker now; what still holds is that the real
    // packet on disk parses and validates.
    const result = { stdout: readFileSync(join(THOUGHTSEED_BRAND_ATLAS_REPO, ".project/project.yaml"), "utf8") };
    const parsed = parseFlatProjectYaml(result.stdout);
    expect(parsed.schema_version).toBe(1);
    expect(parsed.project_id).toBe("thoughtseed-brand-atlas");
    expect((parsed.context as string[]).length).toBe(6);
  });
});

describe("readAndValidatePacket", () => {
  test("returns a full report for a complete, schema-valid packet", () => {
    const root = mkdtempSync(join(tmpdir(), "project-packet-integration-"));
    for (const file of REQUIRED_PACKET_FILES) {
      const absolute = join(root, file);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, file === ".project/project.yaml" ? "" : `content of ${file}\n`);
    }
    const projectYaml = [
      "schema_version: 1",
      "packet_status: reviewed-held",
      "project_id: example-repo",
      "identity_status: unknown",
      "portfolio: thoughtseed",
      "repository: example-repo",
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
    writeFileSync(join(root, ".project/project.yaml"), projectYaml);

    const report = readAndValidatePacket(root, { approvedLanes: APPROVED_LANES });

    expect(report.present).toEqual([...REQUIRED_PACKET_FILES]);
    expect(report.missing).toEqual([]);
    expect(report.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(report.validation).toEqual({ valid: true });
  });

  test("returns null parse/validation when .project/project.yaml is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "project-packet-incomplete-"));
    writeFileSync(join(root, "PROJECT.md"), "x");
    const report = readAndValidatePacket(root, { approvedLanes: APPROVED_LANES });
    expect(report.digest).toBeNull();
    expect(report.parsed).toBeNull();
    expect(report.validation).toBeNull();
  });
});
