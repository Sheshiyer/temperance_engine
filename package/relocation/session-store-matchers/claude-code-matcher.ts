import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ToolMatchResult } from "../project-session-map";

/**
 * Confirmed empirically 2026-08-05 against three real, independently-checked
 * paths, and cross-checked against all 166 folder names actually present
 * under ~/.claude/projects on this machine (zero underscores found; only
 * alphanumerics, dots, and dashes appear): every character other than an
 * alphanumeric or a literal `.` — including `/` and `_` — becomes `-`. Dots
 * are preserved literally. Session folders created inside a Git worktree may
 * carry an additional suffix this function does not attempt to reproduce —
 * that case legitimately reports matched: false via matchClaudeCode, it is
 * not a bug in this transform.
 */
export function encodeClaudeCodeProjectPath(path: string): string {
  return path.replace(/[^A-Za-z0-9.]/g, "-");
}

const CLAUDE_CODE_PROJECTS_ROOT = "/Users/sheshnarayaniyer/.claude/projects";

export function matchClaudeCode(
  path: string,
  projectsRoot: string = CLAUDE_CODE_PROJECTS_ROOT,
): ToolMatchResult {
  const candidate = join(projectsRoot, encodeClaudeCodeProjectPath(path));
  const matched = existsSync(candidate) && statSync(candidate).isDirectory();
  return matched
    ? { tool: "claude-code", mechanism: "path-derived", matched: true, locator: candidate }
    : { tool: "claude-code", mechanism: "path-derived", matched: false };
}
