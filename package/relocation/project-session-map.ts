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
