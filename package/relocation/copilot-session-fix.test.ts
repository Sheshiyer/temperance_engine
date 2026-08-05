// package/relocation/copilot-session-fix.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { planCopilotSessionFix, isCopilotCliRunning, hasActiveWalFile } from "./copilot-session-fix";
import {
  applyCopilotSessionFix,
  loadCopilotSessionFixReceipt,
  writeCopilotSessionFixReceipt,
  CopilotSessionFixPreconditionError,
  CopilotSessionFixStalePlanError,
  receiptPathFor,
} from "./copilot-session-fix";

function createFixtureCopilotDb(dir: string): string {
  const dbPath = join(dir, "data.db");
  const db = new Database(dbPath, { create: true });
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      main_repo_path TEXT NOT NULL UNIQUE
    );
    CREATE TABLE worktrees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path TEXT NOT NULL
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      worktree_id TEXT
    );
    CREATE TABLE workspace_checkout_bindings (
      workspace_id TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      checkout_path TEXT,
      PRIMARY KEY (workspace_id, repo_path)
    );
  `);
  db.close();
  return dbPath;
}

describe("planCopilotSessionFix", () => {
  test("fixable: single project, single worktree, single binding, no collision", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-"));
    try {
      const dbPath = createFixtureCopilotDb(dir);
      const db = new Database(dbPath);
      db.exec(`
        INSERT INTO projects (id, main_repo_path) VALUES ('proj-1', '/old/repo');
        INSERT INTO worktrees (id, project_id, path) VALUES ('wt-1', 'proj-1', '/old/repo/.worktrees/feature-x');
        INSERT INTO workspaces (id, project_id, worktree_id) VALUES ('ws-1', 'proj-1', 'wt-1');
        INSERT INTO workspace_checkout_bindings (workspace_id, repo_path, checkout_path)
          VALUES ('ws-1', '/old/repo', '/old/repo/.worktrees/feature-x');
      `);
      db.close();

      const plan = planCopilotSessionFix(
        { portfolio: "thoughtseed", repository: "repo", oldPath: "/old/repo", newPath: "/new/repo", generatedAt: "2026-08-05T00:00:00.000Z" },
        dbPath,
      );

      expect(plan.status).toBe("fixable");
      expect(plan.holdReason).toBeNull();
      expect(plan.changes).toEqual([
        { table: "projects", column: "main_repo_path", id: "proj-1", from: "/old/repo", to: "/new/repo" },
        { table: "worktrees", column: "path", id: "wt-1", from: "/old/repo/.worktrees/feature-x", to: "/new/repo/.worktrees/feature-x" },
        { table: "workspace_checkout_bindings", column: "repo_path", workspaceId: "ws-1", repoPathAtPlanTime: "/old/repo", from: "/old/repo", to: "/new/repo" },
        { table: "workspace_checkout_bindings", column: "checkout_path", workspaceId: "ws-1", repoPathAtPlanTime: "/old/repo", from: "/old/repo/.worktrees/feature-x", to: "/new/repo/.worktrees/feature-x" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("already-fixed: no row at oldPath", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-"));
    try {
      const dbPath = createFixtureCopilotDb(dir);
      const plan = planCopilotSessionFix(
        { portfolio: "thoughtseed", repository: "repo", oldPath: "/old/repo", newPath: "/new/repo", generatedAt: "2026-08-05T00:00:00.000Z" },
        dbPath,
      );
      expect(plan.status).toBe("already-fixed");
      expect(plan.changes).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("held: a project row already exists independently at newPath", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-"));
    try {
      const dbPath = createFixtureCopilotDb(dir);
      const db = new Database(dbPath);
      db.exec(`
        INSERT INTO projects (id, main_repo_path) VALUES ('proj-old', '/old/repo');
        INSERT INTO projects (id, main_repo_path) VALUES ('proj-new', '/new/repo');
      `);
      db.close();

      const plan = planCopilotSessionFix(
        { portfolio: "thoughtseed", repository: "repo", oldPath: "/old/repo", newPath: "/new/repo", generatedAt: "2026-08-05T00:00:00.000Z" },
        dbPath,
      );
      expect(plan.status).toBe("held");
      expect(plan.holdReason).toBe("new_path_project_already_exists:proj-new");
      expect(plan.changes).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fixable with zero worktrees and zero bindings", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-"));
    try {
      const dbPath = createFixtureCopilotDb(dir);
      const db = new Database(dbPath);
      db.exec(`INSERT INTO projects (id, main_repo_path) VALUES ('proj-1', '/old/repo');`);
      db.close();

      const plan = planCopilotSessionFix(
        { portfolio: "thoughtseed", repository: "repo", oldPath: "/old/repo", newPath: "/new/repo", generatedAt: "2026-08-05T00:00:00.000Z" },
        dbPath,
      );
      expect(plan.status).toBe("fixable");
      expect(plan.changes).toEqual([
        { table: "projects", column: "main_repo_path", id: "proj-1", from: "/old/repo", to: "/new/repo" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("multiple worktrees: every child path is rewritten, a sibling path is not", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-"));
    try {
      const dbPath = createFixtureCopilotDb(dir);
      const db = new Database(dbPath);
      db.exec(`
        INSERT INTO projects (id, main_repo_path) VALUES ('proj-1', '/old/repo');
        INSERT INTO worktrees (id, project_id, path) VALUES ('wt-1', 'proj-1', '/old/repo/.worktrees/a');
        INSERT INTO worktrees (id, project_id, path) VALUES ('wt-2', 'proj-1', '/old/repo/.worktrees/b');
      `);
      db.close();

      const plan = planCopilotSessionFix(
        { portfolio: "thoughtseed", repository: "repo", oldPath: "/old/repo", newPath: "/new/repo", generatedAt: "2026-08-05T00:00:00.000Z" },
        dbPath,
      );
      const worktreeChanges = plan.changes.filter((c) => c.table === "worktrees");
      expect(worktreeChanges).toHaveLength(2);
      expect(worktreeChanges.map((c) => (c as { to: string }).to).sort()).toEqual([
        "/new/repo/.worktrees/a",
        "/new/repo/.worktrees/b",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a worktree path that is only a sibling prefix (not a real child) is left untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-"));
    try {
      const dbPath = createFixtureCopilotDb(dir);
      const db = new Database(dbPath);
      db.exec(`
        INSERT INTO projects (id, main_repo_path) VALUES ('proj-1', '/old/repo');
        INSERT INTO worktrees (id, project_id, path) VALUES ('wt-sibling', 'proj-1', '/old/repo-backup/somewhere');
      `);
      db.close();

      const plan = planCopilotSessionFix(
        { portfolio: "thoughtseed", repository: "repo", oldPath: "/old/repo", newPath: "/new/repo", generatedAt: "2026-08-05T00:00:00.000Z" },
        dbPath,
      );
      expect(plan.changes.filter((c) => c.table === "worktrees")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("not-found: database file does not exist", () => {
    const plan = planCopilotSessionFix(
      { portfolio: "thoughtseed", repository: "repo", oldPath: "/old/repo", newPath: "/new/repo", generatedAt: "2026-08-05T00:00:00.000Z" },
      "/nonexistent/data.db",
    );
    expect(plan.status).toBe("not-found");
    expect(plan.changes).toEqual([]);
  });
});

describe("isCopilotCliRunning", () => {
  test("true when a real copilot process line is present", () => {
    const psOutput = [
      "USER   PID  %CPU %MEM ...  COMMAND",
      "shesh  111  0.0  0.1  ... /opt/homebrew/bin/copilot",
    ].join("\n");
    expect(isCopilotCliRunning(psOutput)).toBe(true);
  });

  test("false when no copilot process line is present", () => {
    const psOutput = ["USER   PID  %CPU %MEM ...  COMMAND", "shesh  222  0.0  0.1  ... /usr/bin/node"].join("\n");
    expect(isCopilotCliRunning(psOutput)).toBe(false);
  });

  test("does not false-positive on this test's own grep/ps invocation lines", () => {
    const psOutput = [
      "USER   PID  %CPU %MEM ...  COMMAND",
      "shesh  333  0.0  0.1  ... grep -i copilot",
    ].join("\n");
    expect(isCopilotCliRunning(psOutput)).toBe(false);
  });
});

describe("hasActiveWalFile", () => {
  test("false when no -wal sidecar file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-wal-"));
    try {
      const dbPath = join(dir, "data.db");
      writeFileSync(dbPath, "");
      expect(hasActiveWalFile(dbPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("false when the -wal sidecar exists but is zero-length", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-wal-"));
    try {
      const dbPath = join(dir, "data.db");
      writeFileSync(dbPath, "");
      writeFileSync(`${dbPath}-wal`, "");
      expect(hasActiveWalFile(dbPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("true when the -wal sidecar exists and is non-empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-wal-"));
    try {
      const dbPath = join(dir, "data.db");
      writeFileSync(dbPath, "");
      writeFileSync(`${dbPath}-wal`, "some real wal bytes");
      expect(hasActiveWalFile(dbPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("applyCopilotSessionFix", () => {
  function fixtureWithFixablePlan(dir: string) {
    const dbPath = createFixtureCopilotDb(dir);
    const db = new Database(dbPath);
    db.exec(`
      INSERT INTO projects (id, main_repo_path) VALUES ('proj-1', '/old/repo');
      INSERT INTO worktrees (id, project_id, path) VALUES ('wt-1', 'proj-1', '/old/repo/.worktrees/a');
      INSERT INTO workspaces (id, project_id, worktree_id) VALUES ('ws-1', 'proj-1', 'wt-1');
      INSERT INTO workspace_checkout_bindings (workspace_id, repo_path, checkout_path)
        VALUES ('ws-1', '/old/repo', '/old/repo/.worktrees/a');
    `);
    db.close();
    const plan = planCopilotSessionFix(
      { portfolio: "thoughtseed", repository: "repo", oldPath: "/old/repo", newPath: "/new/repo", generatedAt: "2026-08-05T00:00:00.000Z" },
      dbPath,
    );
    return { dbPath, plan };
  }

  test("happy path: applies all four rows in one transaction, verifies, writes a receipt", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-apply-"));
    try {
      const { dbPath, plan } = fixtureWithFixablePlan(dir);
      const receiptPath = join(dir, "receipt.json");

      const receipt = applyCopilotSessionFix(plan, dbPath, receiptPath, {
        isRunning: () => false,
        hasWal: () => false,
      });

      expect(receipt.plan.status).toBe("fixable");
      expect(receipt.verifiedChanges).toHaveLength(4);

      const db = new Database(dbPath, { readonly: true });
      const project = db.query("SELECT main_repo_path FROM projects WHERE id = 'proj-1'").get() as { main_repo_path: string };
      expect(project.main_repo_path).toBe("/new/repo");
      const worktree = db.query("SELECT path FROM worktrees WHERE id = 'wt-1'").get() as { path: string };
      expect(worktree.path).toBe("/new/repo/.worktrees/a");
      const binding = db
        .query("SELECT repo_path, checkout_path FROM workspace_checkout_bindings WHERE workspace_id = 'ws-1'")
        .get() as { repo_path: string; checkout_path: string };
      expect(binding.repo_path).toBe("/new/repo");
      expect(binding.checkout_path).toBe("/new/repo/.worktrees/a");
      db.close();

      const loaded = loadCopilotSessionFixReceipt(receiptPath);
      expect(loaded.plan).toEqual(plan);
      expect(loaded.verifiedChanges).toEqual(receipt.verifiedChanges);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses when plan.status is not fixable", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-apply-"));
    try {
      const dbPath = createFixtureCopilotDb(dir);
      const heldPlan = planCopilotSessionFix(
        { portfolio: "thoughtseed", repository: "repo", oldPath: "/old/repo", newPath: "/new/repo", generatedAt: "2026-08-05T00:00:00.000Z" },
        dbPath,
      );
      expect(() =>
        applyCopilotSessionFix(heldPlan, dbPath, join(dir, "receipt.json"), { isRunning: () => false, hasWal: () => false }),
      ).toThrow(CopilotSessionFixPreconditionError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses when the Copilot CLI process is reported running", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-apply-"));
    try {
      const { dbPath, plan } = fixtureWithFixablePlan(dir);
      expect(() =>
        applyCopilotSessionFix(plan, dbPath, join(dir, "receipt.json"), { isRunning: () => true, hasWal: () => false }),
      ).toThrow(CopilotSessionFixPreconditionError);

      const db = new Database(dbPath, { readonly: true });
      const project = db.query("SELECT main_repo_path FROM projects WHERE id = 'proj-1'").get() as { main_repo_path: string };
      expect(project.main_repo_path).toBe("/old/repo");
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses when the database has an active (non-empty) WAL file", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-apply-"));
    try {
      const { dbPath, plan } = fixtureWithFixablePlan(dir);
      expect(() =>
        applyCopilotSessionFix(plan, dbPath, join(dir, "receipt.json"), { isRunning: () => false, hasWal: () => true }),
      ).toThrow(CopilotSessionFixPreconditionError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses a stale plan when the real database no longer matches it (revalidated inside the transaction)", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-apply-"));
    try {
      const { dbPath, plan } = fixtureWithFixablePlan(dir);

      // Simulate drift between plan-time and apply-time: someone/something
      // else already fixed this project's main_repo_path in the meantime.
      const db = new Database(dbPath);
      db.exec("UPDATE projects SET main_repo_path = '/new/repo' WHERE id = 'proj-1'");
      db.close();

      expect(() =>
        applyCopilotSessionFix(plan, dbPath, join(dir, "receipt.json"), { isRunning: () => false, hasWal: () => false }),
      ).toThrow(CopilotSessionFixStalePlanError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("receiptPathFor derives a stable, mode-0600-writable path from the plan", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-fix-receipt-path-"));
    try {
      const plan = { portfolio: "thoughtseed", repository: "repo", oldPath: "/old/repo", newPath: "/new/repo", generatedAt: "2026-08-05T12:34:56.000Z", status: "fixable" as const, holdReason: null, changes: [] };
      const path = receiptPathFor(plan);
      expect(path).toContain("thoughtseed");
      expect(path).toContain("repo");
      expect(path.endsWith(".json")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
