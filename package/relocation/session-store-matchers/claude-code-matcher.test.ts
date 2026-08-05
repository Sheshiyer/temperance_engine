import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeClaudeCodeProjectPath, matchClaudeCode } from "./claude-code-matcher";

describe("encodeClaudeCodeProjectPath", () => {
  test("encodes real, independently-verified paths (slash -> dash, dots preserved)", () => {
    expect(encodeClaudeCodeProjectPath("/Users/sheshnarayaniyer")).toBe("-Users-sheshnarayaniyer");
    expect(encodeClaudeCodeProjectPath("/Users/sheshnarayaniyer/.claude/projects/autoresearch")).toBe(
      "-Users-sheshnarayaniyer-.claude-projects-autoresearch",
    );
    expect(
      encodeClaudeCodeProjectPath(
        "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/temperance_engine",
      ),
    ).toBe("-Volumes-madara-2026-twc-vault-01-Projects-thoughtseed-temperance-engine");
  });
});

describe("matchClaudeCode", () => {
  test("matched: true when the encoded session folder exists under the projects root", () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), "claude-projects-"));
    const path = "/Volumes/fixture/thoughtseed/some-repo";
    mkdirSync(join(projectsRoot, encodeClaudeCodeProjectPath(path)));

    const result = matchClaudeCode(path, projectsRoot);

    expect(result).toEqual({
      tool: "claude-code",
      mechanism: "path-derived",
      matched: true,
      locator: join(projectsRoot, "-Volumes-fixture-thoughtseed-some-repo"),
    });
    rmSync(projectsRoot, { recursive: true, force: true });
  });

  test("matched: false when no encoded folder exists", () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), "claude-projects-"));

    const result = matchClaudeCode("/Volumes/fixture/thoughtseed/nonexistent-repo", projectsRoot);

    expect(result).toEqual({ tool: "claude-code", mechanism: "path-derived", matched: false });
    rmSync(projectsRoot, { recursive: true, force: true });
  });
});
