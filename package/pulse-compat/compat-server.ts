#!/usr/bin/env bun
/**
 * Temperance Engine Pulse compatibility server (peon-ping only).
 *
 * Mirrors the peon-ping voice mechanism: it resolves a phase from a
 * notify message, maps the phase to a pack, loads that pack's manifest
 * (openpeon.json or manifest.json), picks a sound file for the phase's
 * preferred categories with path-sandboxed resolution, and plays it via
 * the platform `afplay` binary. It reads peon-ping's own config.json for
 * volume. It exposes /, /health, /healthz (status) and /notify (POST).
 *
 * It deliberately omits, versus prior/adjacent variants:
 *   - Any invocation of peon.sh. peon.sh is a CONTROL surface only
 *     (pause|resume|mute|unmute|toggle|status|volume|rotation|notifications)
 *     and has no "play a pack" command; this server plays sounds directly.
 *   - Forwarding to any other notification service (e.g. a :8888 service).
 *   - Honoring peon-ping's own pause/mute/rotation state — playback here
 *     is unconditional once a phase/pack/sound resolves. (Tracked as a
 *     follow-up; see docs/peon-ping-packs.md.)
 *   - Spoken TTS. Only canned pack sounds are played.
 *   - Any private/absolute host path. All paths are derived from
 *     homedir() or environment variables so this file is safe to publish.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = Number(process.env.TEMPERANCE_PULSE_PORT || 31337);
const PEON_DIR = process.env.PEON_PING_DIR || join(homedir(), '.claude', 'hooks', 'peon-ping');
const PEON_CONFIG = join(PEON_DIR, 'config.json');

const PHASE_PACKS: Record<string, string> = {
  algorithm: 'nier-2b',
  native: 'nier-2b',
  observe: 'glados',
  think: 'hal_2001',
  plan: 'jarvis-mk2',
  build: 'peon',
  execute: 'nier-2b',
  verify: 'cortana',
  learn: 'sc_kerrigan',
};

const PHASE_CATEGORY_ORDER: Record<string, string[]> = {
  algorithm: ['session.start', 'task.acknowledge', 'task.complete'],
  native: ['task.acknowledge', 'session.start', 'task.complete'],
  observe: ['session.start', 'task.acknowledge', 'task.complete'],
  think: ['task.acknowledge', 'task.progress', 'session.start', 'task.complete'],
  plan: ['task.acknowledge', 'task.progress', 'session.start', 'task.complete'],
  build: ['task.acknowledge', 'task.progress', 'session.start', 'task.complete'],
  execute: ['task.acknowledge', 'task.progress', 'session.start', 'task.complete'],
  verify: ['task.complete', 'task.acknowledge', 'session.start'],
  learn: ['task.complete', 'task.acknowledge', 'session.start'],
};

interface NotifyPayload {
  message?: string;
  voice_enabled?: boolean;
  [key: string]: unknown;
}

interface PeonPlayResult {
  phase: string;
  pack: string;
  category?: string;
  file?: string;
  played: boolean;
  error?: string;
}

function readVolume(): number {
  try {
    const config = JSON.parse(readFileSync(PEON_CONFIG, 'utf-8'));
    const volume = Number(config.volume ?? 0.5);
    return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.5;
  } catch {
    return 0.5;
  }
}

function phaseFromMessage(message: string): string | null {
  const normalized = message.toLowerCase();
  if (normalized.includes('entering the algorithm')) return 'algorithm';
  if (normalized.includes('executing using') && normalized.includes('native mode')) return 'native';
  for (const phase of Object.keys(PHASE_PACKS)) {
    if (normalized.includes(`entering the ${phase} phase`)) return phase;
  }
  return null;
}

function loadManifest(pack: string): Record<string, any> | null {
  const packDir = join(PEON_DIR, 'packs', pack);
  for (const name of ['openpeon.json', 'manifest.json']) {
    const path = join(packDir, name);
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  }
  return null;
}

function pickSound(pack: string, phase: string): { category: string; file: string } | null {
  const manifest = loadManifest(pack);
  if (!manifest) return null;

  for (const category of PHASE_CATEGORY_ORDER[phase] || ['task.acknowledge', 'session.start']) {
    const sounds = manifest.categories?.[category]?.sounds;
    if (!Array.isArray(sounds) || sounds.length === 0) continue;
    const pick = sounds[Math.floor(Math.random() * sounds.length)];
    const fileRef = String(pick?.file || '');
    if (!fileRef) continue;

    const packDir = resolve(PEON_DIR, 'packs', pack);
    const candidate = resolve(packDir, fileRef.includes('/') ? fileRef : join('sounds', fileRef));
    if (!candidate.startsWith(packDir + '/') || !existsSync(candidate)) continue;
    return { category, file: candidate };
  }

  return null;
}

async function playPeonPhase(phase: string): Promise<PeonPlayResult> {
  const pack = PHASE_PACKS[phase];
  if (!pack) return { phase, pack: '', played: false, error: 'no pack mapping' };

  const sound = pickSound(pack, phase);
  if (!sound) return { phase, pack, played: false, error: 'no sound found' };

  if (process.platform !== 'darwin') {
    return { phase, pack, category: sound.category, file: sound.file, played: false, error: 'playback currently supports macOS afplay only' };
  }

  const child = spawn('afplay', ['-v', String(readVolume()), sound.file], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return { phase, pack, category: sound.category, file: sound.file, played: true };
}

async function handleNotify(req: Request): Promise<Response> {
  let payload: NotifyPayload = {};
  try {
    payload = await req.json() as NotifyPayload;
  } catch {
    return Response.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const phase = phaseFromMessage(String(payload.message || ''));
  if (!phase) {
    return Response.json({ ok: true, compatibility: true, played: false });
  }

  const peon = await playPeonPhase(phase);
  return Response.json({ ok: true, compatibility: true, phase, peon });
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/healthz') {
      return Response.json({ ok: true, service: 'temperance-pulse-compat', port: PORT });
    }
    if (url.pathname === '/notify' && req.method === 'POST') return handleNotify(req);
    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  },
});

console.log(`temperance pulse compatibility server listening on http://${server.hostname}:${server.port}`);
