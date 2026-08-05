export type MatchMechanism =
  | "path-derived"
  | "db-query-match"
  | "workspace-root-index-match"
  | "unsupported";

export interface ToolMatchResult {
  tool: string;
  mechanism: MatchMechanism;
  matched: boolean | null;
  locator?: string;
  error?: string;
}

export type ClaudeCodeRelinkAction =
  | "created"
  | "skipped-destination-exists"
  | "skipped-source-missing";

export interface SessionMapEntry extends ToolMatchResult {
  relinkAction?: ClaudeCodeRelinkAction;
}

export interface SessionMapRecord {
  stableId: string;
  portfolio: string;
  repository: string;
  oldPath: string;
  newPath: string;
  generatedAt: string;
  tools: SessionMapEntry[];
}

export interface BuildSessionMapInput {
  stableId: string;
  portfolio: string;
  repository: string;
  oldPath: string;
  newPath: string;
}

import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { matchClaudeCode, encodeClaudeCodeProjectPath } from "./session-store-matchers/claude-code-matcher";
import { matchOpenCode } from "./session-store-matchers/opencode-matcher";
import { matchCopilot } from "./session-store-matchers/copilot-matcher";
import { matchCodex } from "./session-store-matchers/codex-matcher";
import { matchKimi } from "./session-store-matchers/kimi-matcher";
import { matchCraftAgent } from "./session-store-matchers/craft-agent-matcher";

const DEFAULT_MATCHERS: Array<(path: string) => ToolMatchResult> = [
  matchClaudeCode,
  matchOpenCode,
  matchCopilot,
  matchCodex,
  matchKimi,
  matchCraftAgent,
];

export function buildSessionMap(
  input: BuildSessionMapInput,
  generatedAt: string,
  matchers: Array<(path: string) => ToolMatchResult> = DEFAULT_MATCHERS,
): SessionMapRecord {
  const tools: SessionMapEntry[] = matchers.map((matcher) => {
    const oldResult = matcher(input.oldPath);
    if (oldResult.matched === true) return oldResult;
    const newResult = matcher(input.newPath);
    return newResult.matched === true ? newResult : oldResult;
  });
  return {
    stableId: input.stableId,
    portfolio: input.portfolio,
    repository: input.repository,
    oldPath: input.oldPath,
    newPath: input.newPath,
    generatedAt,
    tools,
  };
}

const CLAUDE_CODE_PROJECTS_ROOT = "/Users/sheshnarayaniyer/.claude/projects";

export function attemptClaudeCodeRelink(oldSessionDir: string, newSessionDir: string): ClaudeCodeRelinkAction {
  if (!existsSync(oldSessionDir)) return "skipped-source-missing";
  if (existsSync(newSessionDir)) return "skipped-destination-exists";
  symlinkSync(oldSessionDir, newSessionDir, "dir");
  return "created";
}

export function applyClaudeCodeRelink(
  record: SessionMapRecord,
  projectsRoot: string = CLAUDE_CODE_PROJECTS_ROOT,
): SessionMapRecord {
  const claudeCodeEntry = record.tools.find((entry) => entry.tool === "claude-code");
  if (!claudeCodeEntry || claudeCodeEntry.matched !== true) return record;

  const oldSessionDir = join(projectsRoot, encodeClaudeCodeProjectPath(record.oldPath));
  const newSessionDir = join(projectsRoot, encodeClaudeCodeProjectPath(record.newPath));
  const relinkAction = attemptClaudeCodeRelink(oldSessionDir, newSessionDir);

  return {
    ...record,
    tools: record.tools.map((entry) => (entry.tool === "claude-code" ? { ...entry, relinkAction } : entry)),
  };
}
