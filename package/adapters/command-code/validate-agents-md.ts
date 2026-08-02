#!/usr/bin/env bun
// Validates the reserved Command Code pointer line before generated markdown reaches stdout.

import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const RESERVED_LINE = /(?:^|[\r\n\u2028\u2029])(context-sources: ([^\r\n\u2028\u2029]*))/gu;
const UNSAFE_POINTER_CHARS = /[\u0000-\u001f\u007f<>\u2028\u2029]/u;
const EXPECTED_KEYS = ['pai', 'gsd', 'skills', 'material'];

function validPointer(value: unknown): boolean {
  return value === null
    || (typeof value === 'string' && isAbsolute(value) && !UNSAFE_POINTER_CHARS.test(value));
}

export function assertCommandCodeAgentsMd(markdown: string): void {
  const matches = [...markdown.matchAll(RESERVED_LINE)];
  if (matches.length !== 1) throw new Error('context_sources_line_count');

  const json = matches[0]?.[2];
  if (!json) throw new Error('context_sources_json_missing');

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error('context_sources_json_invalid');
  }

  if (JSON.stringify(Object.keys(payload)) !== JSON.stringify(EXPECTED_KEYS)) {
    throw new Error('context_sources_key_order');
  }
  if (JSON.stringify(payload) !== json) throw new Error('context_sources_not_compact');
  if (!validPointer(payload.pai) || !validPointer(payload.gsd) || !validPointer(payload.skills)) {
    throw new Error('context_sources_pointer_invalid');
  }
  if (payload.material !== 'pointers-only') throw new Error('context_sources_material_invalid');
}

function parseFile(argv: string[]): string {
  if (argv.length === 2 && argv[0] === '--file' && argv[1]) return argv[1];
  throw new Error('usage');
}

if (import.meta.main) {
  try {
    assertCommandCodeAgentsMd(readFileSync(parseFile(process.argv.slice(2)), 'utf8'));
  } catch {
    console.error('Command Code AGENTS.md validation failed');
    process.exitCode = 1;
  }
}
