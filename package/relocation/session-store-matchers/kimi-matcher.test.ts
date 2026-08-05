import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { matchKimi } from "./kimi-matcher";

describe("matchKimi", () => {
  test("matched: true when the path appears in work_dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "kimi-json-"));
    const kimiJsonPath = join(dir, "kimi.json");
    writeFileSync(kimiJsonPath, JSON.stringify({ work_dirs: ["/Volumes/fixture/thoughtseed/some-repo"] }));

    const result = matchKimi("/Volumes/fixture/thoughtseed/some-repo", kimiJsonPath);

    expect(result).toEqual({
      tool: "kimi",
      mechanism: "workspace-root-index-match",
      matched: true,
      locator: "kimi.json: work_dirs",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false when the path is absent from work_dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "kimi-json-"));
    const kimiJsonPath = join(dir, "kimi.json");
    writeFileSync(kimiJsonPath, JSON.stringify({ work_dirs: ["/other/path"] }));

    const result = matchKimi("/Volumes/fixture/thoughtseed/some-repo", kimiJsonPath);

    expect(result).toEqual({ tool: "kimi", mechanism: "workspace-root-index-match", matched: false });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false with error when kimi.json does not exist", () => {
    const result = matchKimi("/Volumes/fixture/thoughtseed/some-repo", "/nonexistent/kimi.json");

    expect(result.matched).toBe(false);
    expect(result.error).toBe("kimi_json_not_found");
  });

  test("matched: false with error when the state file is not valid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "kimi-json-"));
    const kimiJsonPath = join(dir, "kimi.json");
    writeFileSync(kimiJsonPath, "{not valid json");

    const result = matchKimi("/Volumes/fixture/thoughtseed/some-repo", kimiJsonPath);

    expect(result.matched).toBe(false);
    expect(result.error).toContain("kimi_json_parse_failed");
    rmSync(dir, { recursive: true, force: true });
  });
});
