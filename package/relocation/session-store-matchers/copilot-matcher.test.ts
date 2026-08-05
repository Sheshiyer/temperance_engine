import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { matchCopilot } from "./copilot-matcher";

describe("matchCopilot", () => {
  function makeFixtureDb(path: string): void {
    const db = new Database(path, { create: true });
    db.run(
      "CREATE TABLE projects (id TEXT PRIMARY KEY, main_repo_path TEXT NOT NULL UNIQUE, github_repo TEXT)",
    );
    db.run("INSERT INTO projects (id, main_repo_path, github_repo) VALUES (?, ?, ?)", [
      "proj-1",
      "/Volumes/fixture/thoughtseed/some-repo",
      "Sheshiyer/some-repo",
    ]);
    db.close();
  }

  test("matched: true when projects.main_repo_path equals the given path", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-db-"));
    const dbPath = join(dir, "data.db");
    makeFixtureDb(dbPath);

    const result = matchCopilot("/Volumes/fixture/thoughtseed/some-repo", dbPath);

    expect(result).toEqual({
      tool: "copilot",
      mechanism: "db-query-match",
      matched: true,
      locator: "data.db: projects.main_repo_path=/Volumes/fixture/thoughtseed/some-repo",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false when no project row has that main_repo_path", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-db-"));
    const dbPath = join(dir, "data.db");
    makeFixtureDb(dbPath);

    const result = matchCopilot("/Volumes/fixture/thoughtseed/other-repo", dbPath);

    expect(result).toEqual({ tool: "copilot", mechanism: "db-query-match", matched: false });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false with error when the db file does not exist", () => {
    const result = matchCopilot("/Volumes/fixture/thoughtseed/some-repo", "/nonexistent/data.db");

    expect(result.matched).toBe(false);
    expect(result.error).toBe("copilot_db_not_found");
  });
});
