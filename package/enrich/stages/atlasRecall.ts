// package/enrich/stages/atlasRecall.ts — SP0 enrichment stage (owner: unit-atlasRecall).
// PURE over ResolvedContext; never throws. Emits an atlas-recall instruction line when
// the prompt matches session-history keywords AND atlas metadata is available.
// Format: "atlas-recall: mount <mountCmd> | sessions at <workDir> | tool <sessionProgressToolPath>"
// Returns empty line (omitted from block) when no match or no atlas context.
import type { Stage } from '../contract';

const RECALL_KEYWORDS = [
  'previous session',
  'past work',
  'what did we work on',
  'session history',
  'verify previous',
  'earlier session',
] as const;

function matchesRecall(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return RECALL_KEYWORDS.some((kw) => lower.includes(kw));
}

export const atlasRecall: Stage = (ctx) => {
  try {
    const meta = ctx?.atlasMetadata;
    if (!meta || meta.containsTranscript) {
      return { line: '', degraded: false };
    }
    const prompt = ctx?.input?.prompt ?? '';
    if (!matchesRecall(prompt)) {
      return { line: '', degraded: false };
    }
    // Only emit recall when atlas metadata is present AND prompt matches.
    // No session content, no transcripts — operational pointers only.
    const parts: string[] = [];
    if (meta.mountCommand) parts.push(`mount ${meta.mountCommand}`);
    if (meta.workDir) parts.push(`sessions at ${meta.workDir}`);
    if (meta.sessionProgressToolPath) parts.push(`tool ${meta.sessionProgressToolPath}`);
    const line = `atlas-recall: ${parts.join(' | ')}`;
    return { line, degraded: false };
  } catch {
    return { line: '', degraded: true };
  }
};
