import { describe, expect, test } from "bun:test";

import { buildSessionMap } from "./project-session-map";
import type { ToolMatchResult } from "./project-session-map";

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
