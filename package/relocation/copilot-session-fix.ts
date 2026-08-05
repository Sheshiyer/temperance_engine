// package/relocation/copilot-session-fix.ts
import { existsSync, statSync, mkdirSync, chmodSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
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
  // A workspace_checkout_bindings row's repo_path is part of its primary
  // key. When both a repo_path change and a checkout_path change target the
  // same (workspaceId, repoPathAtPlanTime) row, apply's grouped UPDATE
  // moves repo_path to its new value in one statement. So by the time we
  // verify the checkout_path change, looking it up by the *old*
  // repoPathAtPlanTime would miss the row entirely. Precompute each row's
  // final (post-apply) repo_path up front so every change in the group
  // looks the row up correctly, the same grouping fix Step 3 applies when
  // writing.
  const finalRepoPathByGroup = new Map<string, string>();
  for (const change of changes) {
    if (change.table !== "workspace_checkout_bindings") continue;
    const key = `${change.workspaceId}::${change.repoPathAtPlanTime}`;
    if (change.column === "repo_path") {
      finalRepoPathByGroup.set(key, change.to);
    } else if (!finalRepoPathByGroup.has(key)) {
      finalRepoPathByGroup.set(key, change.repoPathAtPlanTime);
    }
  }

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
      const key = `${change.workspaceId}::${change.repoPathAtPlanTime}`;
      const currentRepoPath = finalRepoPathByGroup.get(key) ?? change.repoPathAtPlanTime;
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

  const db = new Database(dbPath);
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
