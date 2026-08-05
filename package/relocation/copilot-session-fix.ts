// package/relocation/copilot-session-fix.ts
import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
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

/**
 * True when a real Copilot CLI process (the `copilot` binary itself) is
 * currently running.
 *
 * The process-match pattern was empirically verified on the implementing
 * machine per the Task 2 brief (design doc §10 explicitly deferred this to
 * implementation time):
 *
 *   - `which copilot` resolved to `/opt/homebrew/bin/copilot`, confirming
 *     the real binary/invocation name is literally `copilot` — so matching
 *     the whole word `copilot` (case-insensitive) against each `ps aux`
 *     line is correct.
 *   - `ps aux | grep -i copilot` found no actual running Copilot CLI
 *     process at verification time (expected/allowed by the brief — this
 *     is a live check, not a fixture).
 *   - The check DID surface a real false-positive risk beyond the brief's
 *     starter exclusion list (`grep`, `bun test`, `bun run`): a clean
 *     `ps aux` snapshot (captured to a file before any filtering ran
 *     against it) showed no self-matches, but filtering `ps aux` output
 *     live via a pipe reliably reintroduces the filtering command itself
 *     into a *concurrent* `ps aux` snapshot — and on this machine that
 *     included a `ugrep` process (a grep-family search tool whose name
 *     does not satisfy `\bgrep\b`, since "grep" isn't preceded by a word
 *     boundary inside "ugrep"). A grep-family tool searching for the
 *     literal string "copilot" is definitionally not the Copilot CLI
 *     itself. The exclusion list below is broadened accordingly to cover
 *     common grep-family tool names explicitly, not just literal `grep`.
 */
export function isCopilotCliRunning(
  psOutput: string = execFileSync("ps", ["aux"], { encoding: "utf8" }),
): boolean {
  return psOutput
    .split("\n")
    .some(
      (line) =>
        /\bcopilot\b/i.test(line) &&
        !/\b(grep|egrep|fgrep|zgrep|pgrep|ugrep|rg|bun test|bun run)\b/i.test(line),
    );
}

export function hasActiveWalFile(dbPath: string = COPILOT_DB_PATH): boolean {
  const walPath = `${dbPath}-wal`;
  if (!existsSync(walPath)) return false;
  return statSync(walPath).size > 0;
}

export { COPILOT_DB_PATH };
