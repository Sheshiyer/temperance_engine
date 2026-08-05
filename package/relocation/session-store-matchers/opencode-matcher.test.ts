import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { matchOpenCode } from "./opencode-matcher";

describe("matchOpenCode", () => {
  function makeFixtureDb(path: string): void {
    const db = new Database(path, { create: true });
    db.run("CREATE TABLE project (id TEXT PRIMARY KEY)");
    db.run(
      "CREATE TABLE session (project_id TEXT NOT NULL, directory TEXT NOT NULL, path TEXT)",
    );
    db.run("INSERT INTO project (id) VALUES (?)", ["proj-1"]);
    db.run("INSERT INTO session (project_id, directory) VALUES (?, ?)", [
      "proj-1",
      "/Volumes/fixture/thoughtseed/some-repo",
    ]);
    db.close();
  }

  test("matched: true when session.directory equals the given path", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-db-"));
    const dbPath = join(dir, "opencode.db");
    makeFixtureDb(dbPath);

    const result = matchOpenCode("/Volumes/fixture/thoughtseed/some-repo", dbPath);

    expect(result).toEqual({
      tool: "opencode",
      mechanism: "db-query-match",
      matched: true,
      locator: "opencode.db: session.project_id=proj-1",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false when no session row has that directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-db-"));
    const dbPath = join(dir, "opencode.db");
    makeFixtureDb(dbPath);

    const result = matchOpenCode("/Volumes/fixture/thoughtseed/other-repo", dbPath);

    expect(result).toEqual({ tool: "opencode", mechanism: "db-query-match", matched: false });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false with error when the db file does not exist", () => {
    const result = matchOpenCode("/Volumes/fixture/thoughtseed/some-repo", "/nonexistent/opencode.db");

    expect(result.matched).toBe(false);
    expect(result.error).toBe("opencode_db_not_found");
  });
});
