// package/enrich/adapters/claude.ts -- Claude Code UserPromptSubmit adapter (thin, SHARED).
// Reads the hook JSON from stdin (fd 0), builds the <temperance-context> block via enrich(),
// and emits the Claude hook envelope on stdout. NEVER throws: on any failure it emits a
// minimal classify-only additionalContext so the hook always returns valid JSON.
//
// Run:  bun package/enrich/adapters/claude.ts < event.json
import { enrich } from '../index';
import type { EnrichInput } from '../contract';

const EVENT_NAME = 'UserPromptSubmit';

function emit(additionalContext: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: EVENT_NAME, additionalContext },
    }),
  );
}

// Fail-safe block matching index.ts's fallback shape; used when we cannot even reach enrich().
function fallbackBlock(): string {
  return [
    '<temperance-context>',
    'mode/tier: NATIVE | reason: enrichment adapter error | source: fail-safe',
    '</temperance-context>',
  ].join('\n');
}

async function readStdin(): Promise<string> {
  // Bun exposes stdin as a Web ReadableStream; fall back to node stream if needed.
  const anyStdin = Bun?.stdin as unknown as { text?: () => Promise<string> } | undefined;
  if (anyStdin && typeof anyStdin.text === 'function') {
    return await anyStdin.text();
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin as AsyncIterable<Uint8Array>) {
    chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  try {
    const raw = await readStdin();
    let prompt = '';
    try {
      const parsed = JSON.parse(raw || '{}') as { prompt?: string; user_prompt?: string };
      prompt = parsed.prompt ?? parsed.user_prompt ?? '';
    } catch {
      prompt = '';
    }
    const input: EnrichInput = { prompt, cwd: process.cwd(), surface: 'claude' };
    const block = await enrich(input);
    emit(block);
  } catch {
    emit(fallbackBlock());
  }
}

void main();
