import { existsSync, readFileSync } from "node:fs";

import type { ToolMatchResult } from "../project-session-map";

const CODEX_GLOBAL_STATE_PATH = "/Users/sheshnarayaniyer/.codex/.codex-global-state.json";
const CODEX_WORKSPACE_ROOT_KEYS = ["active-workspace-roots", "electron-saved-workspace-roots", "project-order"];

export function matchCodex(
  path: string,
  globalStatePath: string = CODEX_GLOBAL_STATE_PATH,
): ToolMatchResult {
  if (!existsSync(globalStatePath)) {
    return {
      tool: "codex",
      mechanism: "workspace-root-index-match",
      matched: false,
      error: "codex_global_state_not_found",
    };
  }
  try {
    const state = JSON.parse(readFileSync(globalStatePath, "utf8")) as Record<string, unknown>;
    for (const key of CODEX_WORKSPACE_ROOT_KEYS) {
      const value = state[key];
      if (Array.isArray(value) && value.includes(path)) {
        return {
          tool: "codex",
          mechanism: "workspace-root-index-match",
          matched: true,
          locator: `.codex-global-state.json: ${key}`,
        };
      }
    }
    return { tool: "codex", mechanism: "workspace-root-index-match", matched: false };
  } catch (error) {
    return {
      tool: "codex",
      mechanism: "workspace-root-index-match",
      matched: false,
      error: `codex_global_state_parse_failed:${(error as Error).message}`,
    };
  }
}
