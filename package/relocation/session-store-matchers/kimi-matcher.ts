import { existsSync, readFileSync } from "node:fs";

import type { ToolMatchResult } from "../project-session-map";

const KIMI_JSON_PATH = "/Users/sheshnarayaniyer/.kimi/kimi.json";

export function matchKimi(
  path: string,
  kimiJsonPath: string = KIMI_JSON_PATH,
): ToolMatchResult {
  if (!existsSync(kimiJsonPath)) {
    return { tool: "kimi", mechanism: "workspace-root-index-match", matched: false, error: "kimi_json_not_found" };
  }
  try {
    const state = JSON.parse(readFileSync(kimiJsonPath, "utf8")) as { work_dirs?: unknown };
    if (Array.isArray(state.work_dirs) && state.work_dirs.includes(path)) {
      return { tool: "kimi", mechanism: "workspace-root-index-match", matched: true, locator: "kimi.json: work_dirs" };
    }
    return { tool: "kimi", mechanism: "workspace-root-index-match", matched: false };
  } catch (error) {
    return {
      tool: "kimi",
      mechanism: "workspace-root-index-match",
      matched: false,
      error: `kimi_json_parse_failed:${(error as Error).message}`,
    };
  }
}
