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

import { matchClaudeCode } from "./session-store-matchers/claude-code-matcher";
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
