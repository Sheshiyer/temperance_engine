import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";

import type { ToolMatchResult } from "../project-session-map";

const COPILOT_DB_PATH = "/Users/sheshnarayaniyer/.copilot/data.db";

export function matchCopilot(
  path: string,
  dbPath: string = COPILOT_DB_PATH,
): ToolMatchResult {
  if (!existsSync(dbPath)) {
    return { tool: "copilot", mechanism: "db-query-match", matched: false, error: "copilot_db_not_found" };
  }
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query("SELECT main_repo_path FROM projects WHERE main_repo_path = ? LIMIT 1")
        .get(path) as { main_repo_path: string } | null;
      return row
        ? {
            tool: "copilot",
            mechanism: "db-query-match",
            matched: true,
            locator: `data.db: projects.main_repo_path=${row.main_repo_path}`,
          }
        : { tool: "copilot", mechanism: "db-query-match", matched: false };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      tool: "copilot",
      mechanism: "db-query-match",
      matched: false,
      error: `copilot_db_query_failed:${(error as Error).message}`,
    };
  }
}
