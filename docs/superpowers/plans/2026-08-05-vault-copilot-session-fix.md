# Copilot Session Fix (Piece D, first slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given an already-relocated project, on-demand fix GitHub Copilot
CLI's `~/.copilot/data.db` so its session/workspace history follows the
project's new path — read-only `plan` always available, a real `apply`
only on separate, explicit invocation.

**Architecture:** One new module, `package/relocation/copilot-session-fix.ts`,
built in three layers: a pure plan-builder that reads the real database
read-only and returns an exact, typed description of what would change (or
why nothing can safely change); precondition checks (process running, WAL
file active) gating any real write; and an apply function that revalidates
the plan inside its own write transaction, executes every change, verifies
the result by re-reading, and writes a durable receipt. A new CLI
subcommand, `session-fix`, wires this into `scripts/vault-project-relocation.ts`,
reusing the exact portfolio/repository/old-path derivation the existing
`session-map` subcommand already established.

**Tech Stack:** TypeScript, Bun (`bun:sqlite`, `bun:test`), the existing
`scripts/vault-project-relocation.ts` CLI script.

## Global Constraints

- Every table/column touched matches the real schema verified by direct
  read-only inspection of `~/.copilot/data.db` on 2026-08-05 (see the
  design doc, §1.3, §5): `projects.main_repo_path` (`TEXT NOT NULL UNIQUE`),
  `worktrees.path` (`TEXT NOT NULL`, FK `project_id` → `projects.id`
  `ON DELETE CASCADE`), `workspace_checkout_bindings.repo_path` /
  `.checkout_path` (composite PK `(workspace_id, repo_path)`).
  `workspaces.source_path` is never touched — NULL in every real row,
  nothing to fix.
- All mutating logic is tested exclusively against fixture SQLite
  databases created fresh per test (real `bun:sqlite`, real schema
  matching the bullet above, synthetic rows) — never against the real
  `~/.copilot/data.db`. This is a hard rule, not a preference, matching
  every prior piece in this codebase.
- Exactly one real-data proof step is permitted anywhere in this plan: a
  **read-only** `plan` call against the real database (Task 5). No
  automated test ever calls `applyCopilotSessionFix` against real data.
- A real `apply` is built and tested here but never proactively invoked
  against the real `~/.copilot/data.db` by any task in this plan — same
  approval-boundary posture as piece A's own `apply` command.
- Nothing in this plan imports from or modifies `package/router/*`,
  OmniRoute's routing code, or the `ISA.md:178` ownership boundary.
- Nothing in this plan touches OpenCode, Codex, Kimi, or Craft Agent —
  Copilot only, per the design doc's explicit scope decision (D-D3).
- Every path-string comparison for "is this path the target, or a child
  of it" uses exact-match-or-prefix-then-`/` — never a bare
  `startsWith()` — to avoid a real risk the design doc flagged (§10): a
  sibling path like `.../repo-backup` must never be treated as a child
  of `.../repo`.

---

### Task 1: Types + `planCopilotSessionFix` (read-only plan builder)

**Files:**
- Create: `package/relocation/copilot-session-fix.ts`
- Test: `package/relocation/copilot-session-fix.test.ts`

**Interfaces:**
- Produces: `CopilotSessionFixChange` (discriminated union by `table`),
  `CopilotSessionFixStatus` (`"fixable" | "already-fixed" | "not-found" | "held"`),
  `CopilotSessionFixPlan`, `PlanCopilotSessionFixInput`,
  `planCopilotSessionFix(input: PlanCopilotSessionFixInput, dbPath?: string): CopilotSessionFixPlan`,
  and an internal (non-exported from the module's public surface, but
  exported for Task 3 to import directly) `planCopilotSessionFixCore(db: Database, input: PlanCopilotSessionFixInput): CopilotSessionFixPlan`
  that does the same work against an already-open `Database` handle —
  Task 3's `apply` needs to re-run this exact logic inside its own write
  transaction without opening a second connection.
- Consumes: nothing from earlier tasks (this is the first task).

- [ ] **Step 1: Write the failing tests**

```typescript
// package/relocation/copilot-session-fix.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { planCopilotSessionFix } from "./copilot-session-fix";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test package/relocation/copilot-session-fix.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// package/relocation/copilot-session-fix.ts
import { existsSync, statSync } from "node:fs";
import { Database } from "bun:sqlite";

const COPILOT_DB_PATH = "/Users/sheshnarayaniyer/.copilot/data.db";

export type CopilotSessionFixChange =
  | { table: "projects"; column: "main_repo_path"; id: string; from: string; to: string }
  | { table: "worktrees"; column: "path"; id: string; from: string; to: string }
  | {
      table: "workspace_checkout_bindings";
      column: "repo_path" | "checkout_path";
      workspaceId: string;
      repoPathAtPlanTime: string;
      from: string;
      to: string;
    };

export type CopilotSessionFixStatus = "fixable" | "already-fixed" | "not-found" | "held";

export interface CopilotSessionFixPlan {
  portfolio: string;
  repository: string;
  oldPath: string;
  newPath: string;
  generatedAt: string;
  status: CopilotSessionFixStatus;
  holdReason: string | null;
  changes: CopilotSessionFixChange[];
}

export interface PlanCopilotSessionFixInput {
  portfolio: string;
  repository: string;
  oldPath: string;
  newPath: string;
  generatedAt: string;
}

function isExactOrPrefixedChild(candidate: string, prefix: string): boolean {
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function rewrittenPath(candidate: string, oldPrefix: string, newPrefix: string): string {
  return candidate === oldPrefix ? newPrefix : newPrefix + candidate.slice(oldPrefix.length);
}

export function planCopilotSessionFixCore(
  db: Database,
  input: PlanCopilotSessionFixInput,
): CopilotSessionFixPlan {
  const base = {
    portfolio: input.portfolio,
    repository: input.repository,
    oldPath: input.oldPath,
    newPath: input.newPath,
    generatedAt: input.generatedAt,
  };

  const oldProject = db
    .query("SELECT id FROM projects WHERE main_repo_path = ? LIMIT 1")
    .get(input.oldPath) as { id: string } | null;
  if (!oldProject) {
    return { ...base, status: "already-fixed", holdReason: null, changes: [] };
  }

  const newProject = db
    .query("SELECT id FROM projects WHERE main_repo_path = ? LIMIT 1")
    .get(input.newPath) as { id: string } | null;
  if (newProject) {
    return {
      ...base,
      status: "held",
      holdReason: `new_path_project_already_exists:${newProject.id}`,
      changes: [],
    };
  }

  const changes: CopilotSessionFixChange[] = [
    { table: "projects", column: "main_repo_path", id: oldProject.id, from: input.oldPath, to: input.newPath },
  ];

  const worktreeRows = db
    .query("SELECT id, path FROM worktrees WHERE project_id = ?")
    .all(oldProject.id) as Array<{ id: string; path: string }>;
  for (const row of worktreeRows) {
    if (isExactOrPrefixedChild(row.path, input.oldPath)) {
      changes.push({
        table: "worktrees",
        column: "path",
        id: row.id,
        from: row.path,
        to: rewrittenPath(row.path, input.oldPath, input.newPath),
      });
    }
  }

  const bindingRows = db
    .query(
      "SELECT workspace_id, repo_path, checkout_path FROM workspace_checkout_bindings WHERE repo_path = ? OR checkout_path LIKE ?",
    )
    .all(input.oldPath, `${input.oldPath}%`) as Array<{
    workspace_id: string;
    repo_path: string;
    checkout_path: string | null;
  }>;
  for (const row of bindingRows) {
    if (row.repo_path === input.oldPath) {
      changes.push({
        table: "workspace_checkout_bindings",
        column: "repo_path",
        workspaceId: row.workspace_id,
        repoPathAtPlanTime: row.repo_path,
        from: row.repo_path,
        to: input.newPath,
      });
    }
    if (row.checkout_path !== null && isExactOrPrefixedChild(row.checkout_path, input.oldPath)) {
      changes.push({
        table: "workspace_checkout_bindings",
        column: "checkout_path",
        workspaceId: row.workspace_id,
        repoPathAtPlanTime: row.repo_path,
        from: row.checkout_path,
        to: rewrittenPath(row.checkout_path, input.oldPath, input.newPath),
      });
    }
  }

  return { ...base, status: "fixable", holdReason: null, changes };
}

export function planCopilotSessionFix(
  input: PlanCopilotSessionFixInput,
  dbPath: string = COPILOT_DB_PATH,
): CopilotSessionFixPlan {
  if (!existsSync(dbPath)) {
    return {
      portfolio: input.portfolio,
      repository: input.repository,
      oldPath: input.oldPath,
      newPath: input.newPath,
      generatedAt: input.generatedAt,
      status: "not-found",
      holdReason: null,
      changes: [],
    };
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    return planCopilotSessionFixCore(db, input);
  } finally {
    db.close();
  }
}

export { COPILOT_DB_PATH };
```

Note: the `LIKE` query for `workspace_checkout_bindings` is a deliberately
broad, cheap pre-filter (it can over-match a sibling path like
`/old/repo-backup`); the precise `isExactOrPrefixedChild` guard applied
per-row afterward is what actually decides whether a change is produced —
never trust the `LIKE` match alone. This is the fix for the exact risk
the design doc flagged in §10.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/copilot-session-fix.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/copilot-session-fix.ts package/relocation/copilot-session-fix.test.ts
git commit -m "feat(relocation): add read-only Copilot session-fix plan builder"
```

---

### Task 2: Precondition checks (process running, active WAL)

**Files:**
- Modify: `package/relocation/copilot-session-fix.ts`
- Modify: `package/relocation/copilot-session-fix.test.ts`

**Interfaces:**
- Consumes: `COPILOT_DB_PATH` (Task 1).
- Produces: `isCopilotCliRunning(psOutput?: string): boolean`,
  `hasActiveWalFile(dbPath?: string): boolean`. Both take their real data
  source as an optional, injectable parameter (real `ps aux` output /
  real filesystem stat by default) so tests never need a real running
  process or a real WAL file — exactly the same injectable-default
  pattern `copilot-matcher.ts` already uses for its DB path (Task 1
  followed the same pattern for `dbPath`).

**Before writing code:** the design doc (§10) explicitly deferred the
exact Copilot CLI process-name match pattern to implementation time —
"needs one empirical confirmation... before the implementation task can
write the exact match string." Do this confirmation for real, on this
machine, before finalizing the regex:

```bash
which copilot
ps aux | grep -i copilot
```

Use whatever the real command name/binary path turns out to be. If
Copilot CLI genuinely cannot be found running on this machine at
implementation time (it wasn't running during the design doc's own
reconnaissance either), match conservatively on the literal substring
`copilot` in the process command column (case-insensitive), explicitly
excluding any line that is itself a `grep`/`ps`/`bun test` invocation —
report in your implementation notes exactly what you tried and why you
landed on the final pattern, since this is a real, flagged-uncertain
decision, not a settled fact.

- [ ] **Step 1: Write the failing tests**

```typescript
// append to package/relocation/copilot-session-fix.test.ts
import { isCopilotCliRunning, hasActiveWalFile } from "./copilot-session-fix";
import { writeFileSync } from "node:fs";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test package/relocation/copilot-session-fix.test.ts`
Expected: FAIL — `isCopilotCliRunning`/`hasActiveWalFile` not defined.

- [ ] **Step 3: Write the implementation**

Add to `package/relocation/copilot-session-fix.ts` (alongside the
existing `node:fs` import, add `execFileSync` from `node:child_process`):

```typescript
import { execFileSync } from "node:child_process";

export function isCopilotCliRunning(
  psOutput: string = execFileSync("ps", ["aux"], { encoding: "utf8" }),
): boolean {
  return psOutput
    .split("\n")
    .some(
      (line) =>
        /\bcopilot\b/i.test(line) &&
        !/\b(grep|bun test|bun run)\b/i.test(line),
    );
}

export function hasActiveWalFile(dbPath: string = COPILOT_DB_PATH): boolean {
  const walPath = `${dbPath}-wal`;
  if (!existsSync(walPath)) return false;
  return statSync(walPath).size > 0;
}
```

Replace the process-match regex with whatever your real §"Before writing
code" verification found if it differs from `\bcopilot\b`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/copilot-session-fix.test.ts`
Expected: PASS, 13 tests total (7 from Task 1 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add package/relocation/copilot-session-fix.ts package/relocation/copilot-session-fix.test.ts
git commit -m "feat(relocation): add Copilot CLI running / active-WAL precondition checks"
```

---

### Task 3: `applyCopilotSessionFix` — in-transaction revalidation, write, receipt

**Files:**
- Modify: `package/relocation/copilot-session-fix.ts`
- Modify: `package/relocation/copilot-session-fix.test.ts`

**Interfaces:**
- Consumes: `planCopilotSessionFixCore` (Task 1), `isCopilotCliRunning`,
  `hasActiveWalFile` (Task 2).
- Produces: `CopilotSessionFixReceipt`,
  `applyCopilotSessionFix(plan: CopilotSessionFixPlan, dbPath?: string, receiptPath?: string): CopilotSessionFixReceipt`,
  `CopilotSessionFixPreconditionError`, `CopilotSessionFixStalePlanError`
  (both `extends Error`), `writeCopilotSessionFixReceipt(path: string, receipt: CopilotSessionFixReceipt): void`,
  `loadCopilotSessionFixReceipt(path: string): CopilotSessionFixReceipt`,
  `receiptPathFor(plan: CopilotSessionFixPlan): string` (the real,
  auto-derived default path — Task 4's CLI wiring calls this directly to
  report the receipt location, same pattern as `writeSessionMap`'s fixed
  output path).

A `workspace_checkout_bindings` row can appear in `plan.changes` as **two
separate entries** (one for `repo_path`, one for `checkout_path`) — Task
1 produces them that way deliberately (see its Step 3 note). Applying
them as two independent `UPDATE ... WHERE workspace_id = ? AND repo_path = ?`
statements is unsafe: `repo_path` is part of this table's primary key, so
updating it first would make the second statement's `WHERE` clause
(still keyed on the old `repo_path`) fail to find the row. **Group both
changes for the same `(workspaceId, repoPathAtPlanTime)` row into one
`UPDATE` statement that sets whichever columns changed, in a single
call**, exactly as shown in Step 3 below — do not issue two statements
against the same row.

- [ ] **Step 1: Write the failing tests**

```typescript
// append to package/relocation/copilot-session-fix.test.ts
import {
  applyCopilotSessionFix,
  loadCopilotSessionFixReceipt,
  writeCopilotSessionFixReceipt,
  CopilotSessionFixPreconditionError,
  CopilotSessionFixStalePlanError,
  receiptPathFor,
} from "./copilot-session-fix";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test package/relocation/copilot-session-fix.test.ts`
Expected: FAIL — `applyCopilotSessionFix` and friends not defined.

- [ ] **Step 3: Write the implementation**

Add to `package/relocation/copilot-session-fix.ts` (new imports:
`mkdirSync, chmodSync, writeFileSync, readFileSync` from `node:fs`,
`dirname, join` from `node:path`):

```typescript
import { mkdirSync, chmodSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export class CopilotSessionFixPreconditionError extends Error {}
export class CopilotSessionFixStalePlanError extends Error {}

export interface CopilotSessionFixReceipt {
  plan: CopilotSessionFixPlan;
  appliedAt: string;
  verifiedChanges: CopilotSessionFixChange[];
}

export function receiptPathFor(plan: CopilotSessionFixPlan): string {
  const timestamp = plan.generatedAt.replace(/[:.]/g, "-");
  return join(
    "/Users/sheshnarayaniyer/.temperance_engine",
    "session-maps",
    plan.portfolio,
    plan.repository,
    "copilot-fix-receipts",
    `${timestamp}.json`,
  );
}

export function writeCopilotSessionFixReceipt(path: string, receipt: CopilotSessionFixReceipt): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function loadCopilotSessionFixReceipt(path: string): CopilotSessionFixReceipt {
  return JSON.parse(readFileSync(path, "utf8")) as CopilotSessionFixReceipt;
}

interface ApplyPreconditionOverrides {
  isRunning?: () => boolean;
  hasWal?: () => boolean;
}

function verifyAppliedChanges(db: Database, changes: CopilotSessionFixChange[]): CopilotSessionFixChange[] {
  for (const change of changes) {
    if (change.table === "projects") {
      const row = db.query("SELECT main_repo_path FROM projects WHERE id = ?").get(change.id) as
        | { main_repo_path: string }
        | null;
      if (!row || row.main_repo_path !== change.to) {
        throw new Error(`post_apply_verification_failed:projects:${change.id}`);
      }
    } else if (change.table === "worktrees") {
      const row = db.query("SELECT path FROM worktrees WHERE id = ?").get(change.id) as { path: string } | null;
      if (!row || row.path !== change.to) {
        throw new Error(`post_apply_verification_failed:worktrees:${change.id}`);
      }
    } else {
      const currentRepoPath = change.column === "repo_path" ? change.to : change.repoPathAtPlanTime;
      const row = db
        .query(
          `SELECT ${change.column === "repo_path" ? "repo_path" : "checkout_path"} AS value
           FROM workspace_checkout_bindings WHERE workspace_id = ? AND repo_path = ?`,
        )
        .get(change.workspaceId, currentRepoPath) as { value: string } | null;
      if (!row || row.value !== change.to) {
        throw new Error(`post_apply_verification_failed:workspace_checkout_bindings:${change.workspaceId}`);
      }
    }
  }
  return changes;
}

export function applyCopilotSessionFix(
  plan: CopilotSessionFixPlan,
  dbPath: string = COPILOT_DB_PATH,
  receiptPath: string = receiptPathFor(plan),
  overrides: ApplyPreconditionOverrides = {},
): CopilotSessionFixReceipt {
  if (plan.status !== "fixable") {
    throw new CopilotSessionFixPreconditionError(`plan_not_fixable:${plan.status}`);
  }
  const isRunning = overrides.isRunning ?? isCopilotCliRunning;
  const hasWal = overrides.hasWal ?? (() => hasActiveWalFile(dbPath));
  if (isRunning()) {
    throw new CopilotSessionFixPreconditionError("copilot_cli_is_running");
  }
  if (hasWal()) {
    throw new CopilotSessionFixPreconditionError("copilot_db_has_active_wal");
  }

  const db = new Database(dbPath, { readonly: false });
  try {
    const applyTxn = db.transaction(() => {
      const revalidated = planCopilotSessionFixCore(db, {
        portfolio: plan.portfolio,
        repository: plan.repository,
        oldPath: plan.oldPath,
        newPath: plan.newPath,
        generatedAt: plan.generatedAt,
      });
      if (revalidated.status !== "fixable") {
        throw new CopilotSessionFixStalePlanError(`plan_stale:${revalidated.status}`);
      }

      for (const change of plan.changes) {
        if (change.table === "projects") {
          db.query("UPDATE projects SET main_repo_path = ? WHERE id = ?").run(change.to, change.id);
        } else if (change.table === "worktrees") {
          db.query("UPDATE worktrees SET path = ? WHERE id = ?").run(change.to, change.id);
        }
      }

      const bindingUpdates = new Map<
        string,
        { workspaceId: string; repoPathAtPlanTime: string; repoPathTo?: string; checkoutPathTo?: string }
      >();
      for (const change of plan.changes) {
        if (change.table !== "workspace_checkout_bindings") continue;
        const key = `${change.workspaceId}::${change.repoPathAtPlanTime}`;
        const entry = bindingUpdates.get(key) ?? {
          workspaceId: change.workspaceId,
          repoPathAtPlanTime: change.repoPathAtPlanTime,
        };
        if (change.column === "repo_path") entry.repoPathTo = change.to;
        else entry.checkoutPathTo = change.to;
        bindingUpdates.set(key, entry);
      }
      for (const entry of bindingUpdates.values()) {
        const setClauses: string[] = [];
        const params: unknown[] = [];
        if (entry.repoPathTo !== undefined) {
          setClauses.push("repo_path = ?");
          params.push(entry.repoPathTo);
        }
        if (entry.checkoutPathTo !== undefined) {
          setClauses.push("checkout_path = ?");
          params.push(entry.checkoutPathTo);
        }
        params.push(entry.workspaceId, entry.repoPathAtPlanTime);
        db.query(
          `UPDATE workspace_checkout_bindings SET ${setClauses.join(", ")} WHERE workspace_id = ? AND repo_path = ?`,
        ).run(...(params as [string, ...unknown[]]));
      }
    });
    applyTxn();

    const verifiedChanges = verifyAppliedChanges(db, plan.changes);
    const receipt: CopilotSessionFixReceipt = {
      plan,
      appliedAt: new Date().toISOString(),
      verifiedChanges,
    };
    writeCopilotSessionFixReceipt(receiptPath, receipt);
    return receipt;
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/copilot-session-fix.test.ts`
Expected: PASS, 19 tests total (13 from Tasks 1-2 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add package/relocation/copilot-session-fix.ts package/relocation/copilot-session-fix.test.ts
git commit -m "feat(relocation): add applyCopilotSessionFix — transactional apply, revalidation, receipt"
```

---

### Task 4: Wire `session-fix` into the CLI

**Files:**
- Modify: `scripts/vault-project-relocation.ts`
- Modify: `tests/vault-project-relocation.test.ts`

**Interfaces:**
- Consumes: `planCopilotSessionFix`, `applyCopilotSessionFix`,
  `receiptPathFor` (Tasks 1-3); the existing (already-defined in this
  file) `inferPortfolio(path: string): Portfolio | null`; the existing
  `registryEntryPath(portfolio, repository)` from
  `package/relocation/project-registry.ts`.
- Produces: a new `session-fix` branch in the CLI's dispatch, following
  the exact same portfolio/repository/registry-lookup pattern the
  existing `session-map` branch already uses (read it first —
  `scripts/vault-project-relocation.ts`, the `else if (argv[0] === "session-map")` block — before writing this task's code, so the two
  subcommands stay structurally consistent).

- [ ] **Step 1: Write the failing tests**

```typescript
// append to tests/vault-project-relocation.test.ts, inside the existing
// "CLI argument validation — never touches the filesystem" describe block
  test("session-fix without --repository fails closed", () => {
    const result = runCli(["session-fix", "--tool", "copilot"]);
    expect(result.status).not.toBe(0);
  });

  test("session-fix with an unsupported --tool fails closed", () => {
    const result = runCli(["session-fix", "--repository", "/Volumes/madara/2026/Projects/thoughtseed/some-repo", "--tool", "opencode"]);
    expect(result.status).not.toBe(0);
  });

  test("session-fix with a relative --repository fails closed", () => {
    const result = runCli(["session-fix", "--repository", "relative/path", "--tool", "copilot"]);
    expect(result.status).not.toBe(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/vault-project-relocation.test.ts`
Expected: FAIL — `session-fix` is an unrecognized argument today.

- [ ] **Step 3: Write the implementation**

Add the import alongside the existing ones in
`scripts/vault-project-relocation.ts`:

```typescript
import {
  planCopilotSessionFix,
  applyCopilotSessionFix,
  receiptPathFor,
} from "../package/relocation/copilot-session-fix";
```

Add a new dispatch branch, placed after the existing `session-map`
branch and before the final `else { usage(); }`:

```typescript
  } else if (argv[0] === "session-fix") {
    let repository = "";
    let tool = "";
    let dryRun = false;
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--repository") repository = argv[++i] ?? "";
      else if (arg === "--tool") tool = argv[++i] ?? "";
      else if (arg === "--dry-run") dryRun = true;
    }
    if (!repository || !isAbsolute(repository)) usage();
    if (tool !== "copilot") throw new Error(`session_fix_tool_not_supported:${JSON.stringify(tool)}`);

    const portfolio = inferPortfolio(repository);
    if (!portfolio) throw new Error(`session_fix_portfolio_not_inferred:${repository}`);
    const repositoryName = basename(repository);

    const entryPath = registryEntryPath(portfolio, repositoryName);
    const entryFilePath = join(entryPath, "entry.json");
    if (!existsSync(entryFilePath)) {
      throw new Error(`session_fix_registry_entry_not_found:${entryFilePath}`);
    }
    const registryEntry = JSON.parse(readFileSync(entryFilePath, "utf8"));

    const plan = planCopilotSessionFix({
      portfolio,
      repository: repositoryName,
      oldPath: registryEntry.oldPath,
      newPath: repository,
      generatedAt: new Date().toISOString(),
    });

    if (dryRun || plan.status !== "fixable") {
      console.log(JSON.stringify({ plan, applied: false }, null, 2));
      if (!dryRun && plan.status !== "fixable") process.exit(1);
    } else {
      const receipt = applyCopilotSessionFix(plan);
      console.log(JSON.stringify({ plan, applied: true, receiptPath: receiptPathFor(plan), receipt }, null, 2));
    }
  } else {
```

Update `usage()`'s help text (append after the existing `session-map`
block):

```
  bun scripts/vault-project-relocation.ts session-fix \
    --repository <new-absolute-path> \
    --tool copilot \
    [--dry-run]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/vault-project-relocation.test.ts`
Expected: PASS, including the 3 new tests and every pre-existing test
(modulo the one already-documented, pre-existing live-vault
`working_tree_not_clean` dirty-canary failure — see the ledger from the
nested-repo-discovery plan for full history on that failure; it is
unrelated to this plan's code).

- [ ] **Step 5: Commit**

```bash
git add scripts/vault-project-relocation.ts tests/vault-project-relocation.test.ts
git commit -m "feat(relocation): wire Copilot session-fix into the CLI as session-fix"
```

---

### Task 5: Real vault proof, `verify-all.sh` wiring, docs

**Files:**
- Modify: `tests/vault-project-relocation.test.ts`
- Modify: `scripts/verify-all.sh`
- Modify: `docs/vault-project-relocation.md`

**Interfaces:**
- Consumes: nothing new — this task is real-data verification,
  integration, and documentation, matching the same shape as the final
  task of the nested-repo-discovery plan.

- [ ] **Step 1: Write the real, read-only proof test**

This is read-only — it calls `planCopilotSessionFix` only, never
`applyCopilotSessionFix` — directly proving the design doc's real
reconnaissance claim (§1.3) against live data. Append to the existing
`"CLI inventory — real, read-only run against the actual vault"`
describe block (or an equivalently-named real-data block already present
in the file — read the file first to match its exact existing
structure):

```typescript
  test("real Copilot data.db: Selemene-engine classifies as fixable, matching 2026-08-05 reconnaissance", () => {
    const plan = planCopilotSessionFix({
      portfolio: "tryambakam-noesis",
      repository: "Selemene-engine",
      oldPath: "/Users/sheshnarayaniyer/Selemene-engine",
      newPath: "/Volumes/madara/2026/twc-vault/01-Projects/tryambakam-noesis/Selemene-engine",
      generatedAt: new Date().toISOString(),
    });

    // If this fails, treat it as a real finding to investigate (real
    // Copilot CLI database state may have changed since 2026-08-05's
    // reconnaissance -- e.g. the project may have already been opened at
    // the new path since then) -- do not weaken this assertion to force
    // a pass.
    expect(["fixable", "already-fixed"]).toContain(plan.status);
    if (plan.status === "fixable") {
      expect(plan.changes.some((c) => c.table === "projects" && c.to.includes("Selemene-engine"))).toBe(true);
    }
  });
```

Import `planCopilotSessionFix` from
`"../package/relocation/copilot-session-fix"` at the top of the test
file if not already imported.

- [ ] **Step 2: Run to verify it passes against the real database**

Run: `bun test tests/vault-project-relocation.test.ts -t "Selemene-engine"`
Expected: PASS with `status: "fixable"` (matching 2026-08-05
reconnaissance: this project's `main_repo_path` row was found stale,
still pointing at the pre-move `$HOME` path, with no independent row yet
at the new vault path). If it instead reports `"already-fixed"`, that is
still a legitimate pass (the real database state moved on since
reconnaissance) — only a `"held"` or unexpected `"not-found"` result
should be investigated as a real finding.

- [ ] **Step 3: Wire the new test file into `verify-all.sh`**

Add this line alongside the existing `package/relocation` lines:

```bash
run bun test package/relocation/copilot-session-fix.test.ts
```

- [ ] **Step 4: Document `session-fix` in `docs/vault-project-relocation.md`**

Add a new `## Copilot session fix` section, after the existing
`## Inventory` section (read the existing doc's section ordering and
heading style first, and match it exactly):

```markdown
## Copilot session fix

`bun scripts/vault-project-relocation.ts session-fix --repository <new-absolute-path> --tool copilot [--dry-run]`

On-demand, read-only-by-default fix for GitHub Copilot CLI's local
`~/.copilot/data.db` after a project has been relocated: rewrites
`projects.main_repo_path`, every matching `worktrees.path`, and every
matching `workspace_checkout_bindings.repo_path`/`.checkout_path` from
the project's old path to its new one, across all four real
path-bearing tables Copilot CLI actually uses (verified by direct
schema inspection, 2026-08-05 — `workspaces.source_path` is excluded,
it is unpopulated in every real row).

Deliberately on-demand, not proactive: run this only when you're about
to reopen a specific already-moved project in Copilot CLI, not as a
batch pass over every historical relocation. `--dry-run` (or omitting
it entirely — every real write requires `apply`'s preconditions to pass
first) shows exactly what would change; a real write only happens when
Copilot CLI is not currently running and its database has no active WAL
file, and is revalidated against the live database inside its own write
transaction immediately before writing, in case the database changed
between `plan` and `apply`.

If a project row already exists independently at the new path (Copilot
CLI creates one automatically once you actually reopen a moved project
there), the fix holds and reports rather than attempting an automatic
merge — same no-auto-preference collision philosophy as the inventory
command's cross-candidate collision detection. Full design:
[`docs/superpowers/specs/2026-08-05-vault-copilot-session-fix-design.md`](superpowers/specs/2026-08-05-vault-copilot-session-fix-design.md).

Only Copilot CLI is covered. OpenCode, Codex, Kimi, and Craft Agent
remain record-only (see the session-map's own `## Session map` section
above) — each needs its own dedicated design given real, materially
different risk profiles found during reconnaissance (no unique path key
for OpenCode, index-only granularity for Codex/Kimi, no per-project
storage convention at all for Craft Agent).
```

- [ ] **Step 5: Run the full scoped suite one more time and commit**

Run: `bun test package/relocation/ && bun test tests/vault-project-relocation.test.ts`
Expected: PASS across every relocation file including this plan's new
file, modulo the one already-documented pre-existing live-vault
`working_tree_not_clean` failure.

```bash
git add tests/vault-project-relocation.test.ts scripts/verify-all.sh docs/vault-project-relocation.md
git commit -m "docs(relocation): wire Copilot session-fix into verify-all.sh, prove it against the real database, document session-fix"
```

---

## Self-Review

**Spec coverage:** Design §1.3/§5 (real schema, four tables) → Task 1.
§7.4 (preconditions) → Task 2. §7.1/§7.3 (apply, in-transaction
revalidation, held-not-merged collision) → Task 3. §7.5 (CLI surface) →
Task 4, corrected against the real `session-map` subcommand's actual
argument shape (`--repository <new-absolute-path>` with portfolio
inferred, not a separate `--portfolio` flag — the design doc's CLI
example was illustrative; this plan grounds it in the real, existing
convention rather than inventing a divergent one). §6.2 (receipt) → Task
3, with one correction versus the design doc's phrasing: the design doc
described the receipt path as matching "the existing receipt convention
used by piece A's rollback receipts... `~/.temperance_engine/receipts/`"
— direct reading of `project-relocation-apply.ts`/`-rollback.ts` during
plan-writing found that convention doesn't actually exist as a fixed
path; piece A's receipts are always an explicit, caller-supplied
`--receipt-output` path. This plan instead follows piece C's
`session-map` own real, fixed-path convention
(`~/.temperance_engine/session-maps/<portfolio>/<repository>/...`),
since `session-fix` extends session-map, not piece A's apply/rollback
transaction. §8 (testing) → Tasks 1-3 (fixture-only) and Task 5 (the one
real, read-only proof). §9 (relationship to existing system) → confirmed
by Task 4 only reading the existing registry entry, never writing to it,
and never calling anything under `package/router/`.

**Placeholder scan:** none found — every claim about existing file
contents (`inferPortfolio`, `registryEntryPath`, the `session-map`
dispatch branch's exact structure, `copilot-matcher.ts`'s existing
default-path-parameter pattern) was read directly from the real files
during plan-writing, not assumed.

**Type consistency:** `CopilotSessionFixChange`, `CopilotSessionFixPlan`,
`CopilotSessionFixReceipt` are each defined once (Tasks 1 and 3) and
referenced identically wherever consumed (Task 4's CLI branch). Function
names match exactly between "Produces" and "Consumes" blocks across
tasks: `planCopilotSessionFixCore`, `planCopilotSessionFix`,
`isCopilotCliRunning`, `hasActiveWalFile`, `applyCopilotSessionFix`,
`receiptPathFor` — no renames.

**Scope check:** every task after Task 1 depends on the one before it —
this is a purely sequential plan, like the nested-repo-discovery plan
before it, not the session-map plan's parallel-dispatch-eligible middle
tasks (there is no independent-matcher-per-tool structure here; Copilot
is the only tool in scope).
