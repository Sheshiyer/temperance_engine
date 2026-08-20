#!/usr/bin/env bun
/**
 * After the native AskUserQuestion / option-tile picker, persist the PAI mode
 * and record a bounded Manifest observation. Does not open an external browser.
 * The model then opens ChatGPT's in-app browser (iab) to the LCARS console.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MODES = ['MINIMAL', 'NATIVE', 'ALGORITHM'] as const;
type Mode = typeof MODES[number];

function stateDir(): string {
  return join(homedir(), '.temperance_engine', 'state', 'manifest', 'session-mode');
}

function pathFor(sessionId: string): string {
  return join(stateDir(), `${createHash('sha256').update(sessionId).digest('hex').slice(0, 24)}.json`);
}

function cwdModeDir(): string {
  return join(homedir(), '.temperance_engine', 'state', 'manifest', 'cwd-mode');
}

function cwdPath(cwd: string): string {
  return join(cwdModeDir(), `${createHash('sha256').update(cwd).digest('hex').slice(0, 24)}.json`);
}

export function readCwdMode(cwd?: string): Mode | null {
  if (!cwd) return null;
  try {
    const value = JSON.parse(readFileSync(cwdPath(cwd), 'utf8')) as { mode?: string };
    const mode = String(value.mode || '').toUpperCase();
    return (MODES as readonly string[]).includes(mode) ? mode as Mode : null;
  } catch {
    return null;
  }
}

export function persistSessionMode(sessionId: string | undefined, mode: Mode, cwd?: string, source = 'picker'): void {
  const now = new Date().toISOString();
  if (sessionId) {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(pathFor(sessionId), `${JSON.stringify({ mode, session_id: sessionId, source, chosen_at: now }, null, 2)}\n`);
  }
  const root = cwd || process.cwd();
  mkdirSync(cwdModeDir(), { recursive: true });
  writeFileSync(cwdPath(root), `${JSON.stringify({ mode, cwd: root, session_id: sessionId || null, source, chosen_at: now }, null, 2)}\n`);
}

export function readSessionMode(sessionId?: string, cwd?: string): Mode | null {
  if (sessionId) {
    try {
      const value = JSON.parse(readFileSync(pathFor(sessionId), 'utf8')) as { mode?: string };
      const mode = String(value.mode || '').toUpperCase();
      if ((MODES as readonly string[]).includes(mode)) return mode as Mode;
    } catch { /* fall through to cwd */ }
  }
  return readCwdMode(cwd || process.cwd());
}

function extractMode(blob: string): Mode | null {
  const upper = blob.toUpperCase();
  for (const mode of [...MODES].sort((a, b) => b.length - a.length)) {
    if (upper.includes(mode)) return mode;
  }
  return null;
}

async function main() {
  let input: any = {};
  try { input = JSON.parse(await Bun.stdin.text()); } catch { process.exit(0); }
  const sessionId = String(input.session_id || input.sessionID || '').trim();
  const packed = JSON.stringify(input.tool_input || input.tool_response || input.tool_output || input);
  const mode = extractMode(packed);
  if (!sessionId || !mode) process.exit(0);

  const cwd = String(input.cwd || process.cwd());
  persistSessionMode(sessionId, mode, cwd, 'picker');

  const projectId = String(input.cwd || process.cwd()).split('/').filter(Boolean).pop() || 'project';
  const event = {
    id: `evt_mode_${createHash('sha256').update(`${sessionId}\0${mode}`).digest('hex').slice(0, 16)}`,
    source: 'pai-hook',
    kind: 'mode.requested',
    status: 'observed',
    actor: 'manifest-mode-commit',
    session_id: sessionId,
    payload: { mode, surface: 'codex-picker' },
    evidence: [],
  };
  try {
    await fetch('http://127.0.0.1:8766/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(400),
    });
  } catch { /* bridge may be stale; session file is enough */ }

  console.error(`[ManifestModeCommit] ${mode} recorded for ${sessionId} (${projectId})`);
  process.exit(0);
}

if (import.meta.main) {
  main().catch(() => process.exit(0));
}
