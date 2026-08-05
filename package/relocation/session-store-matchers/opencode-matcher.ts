import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";

import type { ToolMatchResult } from "../project-session-map";

const OPENCODE_DB_PATH = "/Users/sheshnarayaniyer/.local/share/opencode/opencode.db";

export function matchOpenCode(
  path: string,
  dbPath: string = OPENCODE_DB_PATH,
): ToolMatchResult {
  if (!existsSync(dbPath)) {
    return { tool: "opencode", mechanism: "db-query-match", matched: false, error: "opencode_db_not_found" };
  }
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query("SELECT project_id FROM session WHERE directory = ? LIMIT 1")
        .get(path) as { project_id: string } | null;
      return row
        ? {
            tool: "opencode",
            mechanism: "db-query-match",
            matched: true,
            locator: `opencode.db: session.project_id=${row.project_id}`,
          }
        : { tool: "opencode", mechanism: "db-query-match", matched: false };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      tool: "opencode",
      mechanism: "db-query-match",
      matched: false,
      error: `opencode_db_query_failed:${(error as Error).message}`,
    };
  }
}
