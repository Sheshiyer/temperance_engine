import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { matchCodex } from "./codex-matcher";

describe("matchCodex", () => {
  test("matched: true when the path appears in active-workspace-roots", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-state-"));
    const statePath = join(dir, ".codex-global-state.json");
    writeFileSync(
      statePath,
      JSON.stringify({ "active-workspace-roots": ["/Volumes/fixture/thoughtseed/some-repo"] }),
    );

    const result = matchCodex("/Volumes/fixture/thoughtseed/some-repo", statePath);

    expect(result).toEqual({
      tool: "codex",
      mechanism: "workspace-root-index-match",
      matched: true,
      locator: ".codex-global-state.json: active-workspace-roots",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false when the path appears in none of the known keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-state-"));
    const statePath = join(dir, ".codex-global-state.json");
    writeFileSync(statePath, JSON.stringify({ "active-workspace-roots": ["/other/path"] }));

    const result = matchCodex("/Volumes/fixture/thoughtseed/some-repo", statePath);

    expect(result).toEqual({ tool: "codex", mechanism: "workspace-root-index-match", matched: false });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false with error when the state file does not exist", () => {
    const result = matchCodex("/Volumes/fixture/thoughtseed/some-repo", "/nonexistent/.codex-global-state.json");

    expect(result.matched).toBe(false);
    expect(result.error).toBe("codex_global_state_not_found");
  });

  test("matched: false with error when the state file is not valid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-state-"));
    const statePath = join(dir, ".codex-global-state.json");
    writeFileSync(statePath, "{not valid json");

    const result = matchCodex("/Volumes/fixture/thoughtseed/some-repo", statePath);

    expect(result.matched).toBe(false);
    expect(result.error).toContain("codex_global_state_parse_failed");
    rmSync(dir, { recursive: true, force: true });
  });
});
