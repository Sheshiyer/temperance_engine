import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseFlatProjectYaml } from "./project-packet";
import {
  CAPSULE_FILES,
  renderCapsuleFiles,
  verifyCapsuleFiles,
  writeCapsule,
  type CapsuleInput,
} from "./project-capsule";

function fixtureCapsuleRoot(): string {
  return mkdtempSync(join(tmpdir(), "project-capsule-fixture-"));
}

const VALID_INPUT: CapsuleInput = {
  stableId: "thoughtseed-brand-atlas",
  portfolio: "thoughtseed",
  repository: "thoughtseed-brand-atlas",
  oldPath: "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-brand-atlas",
  newPath: "/Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas",
  githubIdentity: "Sheshiyer/thoughtseed-brand-atlas",
  registryEntryPath:
    "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/cambium/docs/project-management/relocation-registry/thoughtseed/thoughtseed-brand-atlas",
  packetDigest: "a".repeat(64),
  knowledgeRef: "thoughtseed-labs/10-brand-essence/visual-identity-2026-08/",
  rollbackCommand: "bun scripts/vault-project-relocation.ts rollback --repository thoughtseed-brand-atlas",
  integrityManifest: {
    headBefore: "30e994a00a347e9817a03940c9cf068e7ea4a6a9",
    headAfter: "30e994a00a347e9817a03940c9cf068e7ea4a6a9",
    refsDigestBefore: "b".repeat(64),
    refsDigestAfter: "b".repeat(64),
  },
};

describe("renderCapsuleFiles", () => {
  test("returns exactly the six ratified capsule file paths as keys", () => {
    const files = renderCapsuleFiles(VALID_INPUT);
    expect(Object.keys(files).sort()).toEqual([...CAPSULE_FILES].sort());
  });

  test("PROJECT.md names the stable ID, new path, and GitHub identity", () => {
    const files = renderCapsuleFiles(VALID_INPUT);
    expect(files["PROJECT.md"]).toContain("thoughtseed-brand-atlas");
    expect(files["PROJECT.md"]).toContain(VALID_INPUT.newPath);
    expect(files["PROJECT.md"]).toContain(VALID_INPUT.githubIdentity!);
  });

  test("data/project.yaml round-trips through the existing project.yaml parser", () => {
    const files = renderCapsuleFiles(VALID_INPUT);
    const parsed = parseFlatProjectYaml(files["data/project.yaml"]);
    expect(parsed.stable_id).toBe(VALID_INPUT.stableId);
    expect(parsed.new_path).toBe(VALID_INPUT.newPath);
    expect(parsed.packet_digest).toBe(VALID_INPUT.packetDigest);
  });

  test("handoffs/integrity-manifest.json is valid JSON carrying the integrity manifest fields", () => {
    const files = renderCapsuleFiles(VALID_INPUT);
    const parsed = JSON.parse(files["handoffs/integrity-manifest.json"]);
    expect(parsed.headBefore).toBe(VALID_INPUT.integrityManifest.headBefore);
    expect(parsed.refsDigestAfter).toBe(VALID_INPUT.integrityManifest.refsDigestAfter);
    expect(parsed.packetDigest).toBe(VALID_INPUT.packetDigest);
  });

  test("handoffs/rollback.md contains the exact rollback command", () => {
    const files = renderCapsuleFiles(VALID_INPUT);
    expect(files["handoffs/rollback.md"]).toContain(VALID_INPUT.rollbackCommand);
  });

  test("handles a missing githubIdentity without crashing", () => {
    const { githubIdentity, ...withoutGithub } = VALID_INPUT;
    const files = renderCapsuleFiles(withoutGithub);
    expect(files["PROJECT.md"]).toContain("unknown");
  });

  test("refuses to render when an input field looks like a credential", () => {
    const tampered: CapsuleInput = {
      ...VALID_INPUT,
      registryEntryPath: "ghp_1234567890abcdef1234567890abcdef1234",
    };
    expect(() => renderCapsuleFiles(tampered)).toThrow("capsule_input_looks_like_a_credential");
  });
});

describe("writeCapsule — fixture directories only, never a real old-path location", () => {
  test("writes all six rendered files with their exact content", () => {
    const root = fixtureCapsuleRoot();
    const files = renderCapsuleFiles(VALID_INPUT);
    writeCapsule(root, files);

    for (const relativePath of CAPSULE_FILES) {
      expect(readFileSync(join(root, relativePath), "utf8")).toBe(files[relativePath]);
    }
  });

  test("refuses to write when the files map is missing one of the six required entries", () => {
    const root = fixtureCapsuleRoot();
    const files = renderCapsuleFiles(VALID_INPUT);
    delete (files as Record<string, string>)["handoffs/rollback.md"];
    expect(() => writeCapsule(root, files)).toThrow("capsule_file_missing_from_render:handoffs/rollback.md");
  });

  test("refuses to write when the files map contains a key outside the closed six-file list", () => {
    const root = fixtureCapsuleRoot();
    const files = { ...renderCapsuleFiles(VALID_INPUT), "NOTES.md": "not allowed" };
    expect(() => writeCapsule(root, files)).toThrow("capsule_file_not_in_closed_list:NOTES.md");
  });
});

describe("verifyCapsuleFiles", () => {
  test("reports all six files present after a successful write", () => {
    const root = fixtureCapsuleRoot();
    writeCapsule(root, renderCapsuleFiles(VALID_INPUT));
    expect(verifyCapsuleFiles(root)).toEqual({ present: [...CAPSULE_FILES], missing: [] });
  });

  test("reports every file missing for an empty directory", () => {
    const root = fixtureCapsuleRoot();
    expect(verifyCapsuleFiles(root)).toEqual({ present: [], missing: [...CAPSULE_FILES] });
  });

  test("end to end: render, write, and verify a complete capsule against a fixture directory", () => {
    const root = fixtureCapsuleRoot();
    const files = renderCapsuleFiles(VALID_INPUT);
    writeCapsule(root, files);
    const { present, missing } = verifyCapsuleFiles(root);
    expect(present.length).toBe(6);
    expect(missing).toEqual([]);
  });
});
