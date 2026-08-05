import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSessionMap, attemptClaudeCodeRelink, applyClaudeCodeRelink, writeSessionMap } from "./project-session-map";
import { encodeClaudeCodeProjectPath } from "./session-store-matchers/claude-code-matcher";
import type { ToolMatchResult, SessionMapRecord, SessionMapEntry } from "./project-session-map";

describe("buildSessionMap", () => {
  test("prefers an oldPath match over a newPath match", () => {
    const matcherOld: (path: string) => ToolMatchResult = (path) =>
      path === "old"
        ? { tool: "fixture-tool", mechanism: "path-derived", matched: true, locator: "found-at-old" }
        : { tool: "fixture-tool", mechanism: "path-derived", matched: false };

    const record = buildSessionMap(
      {
        stableId: "stable-1",
        portfolio: "thoughtseed",
        repository: "some-repo",
        oldPath: "old",
        newPath: "new",
      },
      "2026-08-05T00:00:00.000Z",
      [matcherOld],
    );

    expect(record).toEqual({
      stableId: "stable-1",
      portfolio: "thoughtseed",
      repository: "some-repo",
      oldPath: "old",
      newPath: "new",
      generatedAt: "2026-08-05T00:00:00.000Z",
      tools: [{ tool: "fixture-tool", mechanism: "path-derived", matched: true, locator: "found-at-old" }],
    });
  });

  test("falls back to newPath when oldPath does not match", () => {
    const matcherNew: (path: string) => ToolMatchResult = (path) =>
      path === "new"
        ? { tool: "fixture-tool", mechanism: "path-derived", matched: true, locator: "found-at-new" }
        : { tool: "fixture-tool", mechanism: "path-derived", matched: false };

    const record = buildSessionMap(
      {
        stableId: "stable-1",
        portfolio: "thoughtseed",
        repository: "some-repo",
        oldPath: "old",
        newPath: "new",
      },
      "2026-08-05T00:00:00.000Z",
      [matcherNew],
    );

    expect(record.tools).toEqual([
      { tool: "fixture-tool", mechanism: "path-derived", matched: true, locator: "found-at-new" },
    ]);
  });

  test("reports the oldPath result (including error/unsupported) when neither path matches", () => {
    const matcherUnsupported: (path: string) => ToolMatchResult = () => ({
      tool: "fixture-tool",
      mechanism: "unsupported",
      matched: null,
    });

    const record = buildSessionMap(
      {
        stableId: "stable-1",
        portfolio: "thoughtseed",
        repository: "some-repo",
        oldPath: "old",
        newPath: "new",
      },
      "2026-08-05T00:00:00.000Z",
      [matcherUnsupported],
    );

    expect(record.tools).toEqual([{ tool: "fixture-tool", mechanism: "unsupported", matched: null }]);
  });

  test("defaults to all six production matchers when none are injected", () => {
    const record = buildSessionMap(
      {
        stableId: "stable-1",
        portfolio: "thoughtseed",
        repository: "some-repo",
        oldPath: "/nonexistent/old",
        newPath: "/nonexistent/new",
      },
      "2026-08-05T00:00:00.000Z",
    );

    expect(record.tools.map((entry) => entry.tool)).toEqual([
      "claude-code",
      "opencode",
      "copilot",
      "codex",
      "kimi",
      "craft-agent",
    ]);
  });
});

describe("attemptClaudeCodeRelink", () => {
  test("creates a symlink when the old dir exists and the new dir does not", () => {
    const dir = mkdtempSync(join(tmpdir(), "relink-"));
    const oldDir = join(dir, "old-session");
    const newDir = join(dir, "new-session");
    mkdirSync(oldDir);

    const action = attemptClaudeCodeRelink(oldDir, newDir);

    expect(action).toBe("created");
    expect(statSync(newDir).isSymbolicLink() || statSync(newDir).isDirectory()).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("skips when the new dir already exists — never clobbers", () => {
    const dir = mkdtempSync(join(tmpdir(), "relink-"));
    const oldDir = join(dir, "old-session");
    const newDir = join(dir, "new-session");
    mkdirSync(oldDir);
    mkdirSync(newDir);

    const action = attemptClaudeCodeRelink(oldDir, newDir);

    expect(action).toBe("skipped-destination-exists");
    expect(statSync(newDir).isSymbolicLink()).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("skips when the old dir does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "relink-"));
    const oldDir = join(dir, "old-session");
    const newDir = join(dir, "new-session");

    const action = attemptClaudeCodeRelink(oldDir, newDir);

    expect(action).toBe("skipped-source-missing");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("applyClaudeCodeRelink", () => {
  function baseRecord(overrides: Partial<SessionMapEntry>): SessionMapRecord {
    return {
      stableId: "stable-1",
      portfolio: "thoughtseed",
      repository: "some-repo",
      oldPath: "/Volumes/fixture/thoughtseed/some-repo",
      newPath: "/Volumes/fixture2/thoughtseed/some-repo",
      generatedAt: "2026-08-05T00:00:00.000Z",
      tools: [
        { tool: "claude-code", mechanism: "path-derived", matched: true, locator: "irrelevant", ...overrides },
      ],
    };
  }

  test("relinks and stamps relinkAction: created when claude-code matched at oldPath", () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), "claude-projects-"));
    const record = baseRecord({});
    mkdirSync(join(projectsRoot, encodeClaudeCodeProjectPath(record.oldPath)));

    const result = applyClaudeCodeRelink(record, projectsRoot);

    expect(result.tools[0].relinkAction).toBe("created");
    rmSync(projectsRoot, { recursive: true, force: true });
  });

  test("does not attempt a relink when claude-code did not match", () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), "claude-projects-"));
    const record = baseRecord({ matched: false, locator: undefined });

    const result = applyClaudeCodeRelink(record, projectsRoot);

    expect(result.tools[0].relinkAction).toBeUndefined();
    rmSync(projectsRoot, { recursive: true, force: true });
  });
});

describe("writeSessionMap", () => {
  test("writes the record as mode-0600 JSON, creating parent directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "session-map-out-"));
    const filePath = join(dir, "thoughtseed", "some-repo", "map.json");
    const record: SessionMapRecord = {
      stableId: "stable-1",
      portfolio: "thoughtseed",
      repository: "some-repo",
      oldPath: "/old",
      newPath: "/new",
      generatedAt: "2026-08-05T00:00:00.000Z",
      tools: [],
    };

    writeSessionMap(filePath, record);

    const written = JSON.parse(readFileSync(filePath, "utf8"));
    expect(written).toEqual(record);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    rmSync(dir, { recursive: true, force: true });
  });
});
