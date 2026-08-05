// package/relocation/session-store-matchers/craft-agent-matcher.ts
import type { ToolMatchResult } from "../project-session-map";

export function matchCraftAgent(_path: string): ToolMatchResult {
  return { tool: "craft-agent", mechanism: "unsupported", matched: null };
}
