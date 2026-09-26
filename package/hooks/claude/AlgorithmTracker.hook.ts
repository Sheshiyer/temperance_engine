#!/usr/bin/env bun
/**
 * AlgorithmTracker.hook.ts — Consolidated Algorithm State Tracker (PostToolUse)
 *
 * Single hook replaces CriteriaTracker + SessionReactivator. Four responsibilities:
 * 1. Phase tracking:    Detects voice curls in Bash tool_input → phaseTransition()
 * 2. Criteria tracking: Intercepts TaskCreate for ISC criteria → criteriaAdd()
 * 3. Criteria updates:  Intercepts TaskUpdate status changes → criteriaUpdate()
 * 4. Agent tracking:    Intercepts Task tool for agent spawns → agentAdd()
 *
 * Session activation is folded in: on any matched tool call, checks if session
 * needs activation (replaces SessionReactivator.hook.ts).
 *
 * TRIGGER: PostToolUse (matcher: Bash, TaskCreate, TaskUpdate, Task)
 * PERFORMANCE: ~3ms. Never blocks — outputs continue immediately.
 *
 * NO transcript scanning. NO regex on output text. All data from structured tool_input.
 */

import {
  readState, writeState, phaseTransition, criteriaAdd, criteriaUpdate, agentAdd, effortLevelUpdate,
} from './lib/algorithm-state';
import type { AlgorithmCriterion, AlgorithmPhase, AlgorithmState } from './lib/algorithm-state';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { setPhaseTab } from './lib/tab-setter';

// manifest-bridge is an optional capability module (RAIL-04 / 36-01): this hook must load
// and function (phase tracking, criteria tracking, agent tracking, tab coloring) with zero
// manifest-bridge install. activeRunFor is resolved lazily on first use so a missing or
// relocated bridge tree never breaks module load — it only silences the optional
// publishManifestPhase() telemetry call below. Never a hardcoded absolute dev-machine path.
type ActiveRunFor = (sessionId: string, stateDir: string) => any;
let _activeRunFor: ActiveRunFor | null | undefined;

async function resolveActiveRunFor(): Promise<ActiveRunFor | null> {
  if (_activeRunFor !== undefined) return _activeRunFor;
  const candidates = [
    process.env.TEMPERANCE_MANIFEST_ACTIVATION_MODULE,
    join(process.env.HOME || '', '.temperance_engine', 'manifest-bridge', 'src', 'activation.ts'),
    join(process.env.HOME || '', '.temperance_engine', 'package', 'manifest-bridge', 'src', 'activation.ts'),
  ].filter((p): p is string => !!p);
  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);
      if (typeof mod?.activeRunFor === 'function') {
        _activeRunFor = mod.activeRunFor;
        return _activeRunFor;
      }
    } catch { /* manifest-bridge not available at this candidate — try the next / fall through */ }
  }
  _activeRunFor = null;
  return null;
}

// ── Phase Detection from Voice Curls ──

const PHASE_MAP: Record<string, AlgorithmPhase> = {
  'entering the observe phase': 'OBSERVE',
  'entering the think phase': 'THINK',
  'entering the plan phase': 'PLAN',
  'entering the build phase': 'BUILD',
  'entering the execute phase': 'EXECUTE',
  'entering the verify phase': 'VERIFY',
  'entering the learn phase': 'LEARN',
  // Also match with period at end
  'entering the verify phase.': 'VERIFY',
};

const ALGORITHM_ENTRY = 'entering the pai algorithm';

// ── Alchemical Step Sidecar ──
// Lightweight file for statusline to read current phase without scanning all algorithm state files.
const ALCHEMICAL_STEP_PATH = join(process.env.PAI_DIR || join(process.env.HOME!, '.claude'), 'MEMORY', 'STATE', 'alchemical-step.json');

function writeAlchemicalStep(phase: AlgorithmPhase, sessionId: string): void {
  try {
    const dir = join(process.env.PAI_DIR || join(process.env.HOME!, '.claude'), 'MEMORY', 'STATE');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(ALCHEMICAL_STEP_PATH, JSON.stringify({
      phase,
      sessionId,
      updatedAt: new Date().toISOString(),
    }));
  } catch {}
}

function detectPhaseFromBash(command: string): { phase: AlgorithmPhase | null; isAlgorithmEntry: boolean } {
  // Accept the current PAI voice endpoint and the legacy endpoint during migration.
  if (!(/(?:localhost|127\.0\.0\.1):(31337|8888)/.test(command)) || !command.includes('/notify')) {
    return { phase: null, isAlgorithmEntry: false };
  }

  // Extract the message field from the curl -d JSON body
  const messageMatch = command.match(/"message"\s*:\s*"([^"]+)"/);
  if (!messageMatch) return { phase: null, isAlgorithmEntry: false };

  const message = messageMatch[1].toLowerCase();

  // Check for algorithm entry
  if (message.includes(ALGORITHM_ENTRY)) {
    return { phase: null, isAlgorithmEntry: true };
  }

  // Check for phase transitions
  for (const [pattern, phase] of Object.entries(PHASE_MAP)) {
    if (message.includes(pattern)) {
      return { phase, isAlgorithmEntry: false };
    }
  }

  return { phase: null, isAlgorithmEntry: false };
}

async function publishManifestPhase(sessionId: string, phase: AlgorithmPhase): Promise<void> {
  const activeRunFor = await resolveActiveRunFor();
  if (!activeRunFor) return; // manifest-bridge unavailable — phase tracking above still ran
  const stateDir = process.env.TEMPERANCE_MANIFEST_STATE_DIR || join(process.env.HOME || '', '.temperance_engine', 'state', 'manifest');
  const run = activeRunFor(sessionId, stateDir);
  if (!run) return;
  void fetch(`${process.env.TEMPERANCE_MANIFEST_BRIDGE_URL || 'http://127.0.0.1:8766'}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'pai-hook', kind: 'phase.changed', status: 'observed', actor: 'algorithm-tracker',
      project_id: run.project_id, session_id: run.session_id, correlation_id: run.run_id, phase,
      payload: { run_id: run.run_id, project_cwd: run.project_cwd, phase_source: 'voice-notification' },
      evidence: [{ label: 'algorithm-state', path: join(process.env.HOME || '', '.claude', 'MEMORY', 'STATE', 'algorithms', `${sessionId}.json`) }],
    }),
    signal: AbortSignal.timeout(300),
  }).catch(() => {});
}

// ── Criteria Detection ──

const CRITERION_PATTERNS = [
  /ISC-(C\d+):\s*(.+)/,
  /ISC-(A\d+):\s*(.+)/,
  // Domain-named ISC: ISC-Hooks-1, ISC-A-Integration-1, etc.
  /ISC-([\w]+-\d+):\s*(.+)/,
  /ISC-(A-[\w]+-\d+):\s*(.+)/,
  /^(C\d+):\s*(.+)/,
  /^(A\d+):\s*(.+)/,
];
const TASK_NUMBER = /Task\s+#(\d+)\s+created successfully/;

function parseCriterion(text: string): { id: string; description: string } | null {
  for (const p of CRITERION_PATTERNS) {
    const m = text.match(p);
    if (m) return { id: m[1], description: m[2].trim() };
  }
  return null;
}

// ── Session Activation (replaces SessionReactivator) ──

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, '.claude');

function getSessionName(sid: string): string {
  try {
    const snPath = join(BASE_DIR, 'MEMORY', 'STATE', 'session-names.json');
    if (existsSync(snPath)) {
      const names = JSON.parse(readFileSync(snPath, 'utf-8'));
      if (names[sid]) return names[sid];
    }
  } catch {}
  // Return session ID prefix instead of "Starting..." to avoid phantom dashboard entries
  return sid.slice(0, 8);
}

function ensureSessionActive(sessionId: string): void {
  const existing = readState(sessionId);
  if (existing && existing.active) return; // Already active

  const now = Date.now();

  if (!existing) {
    // New session — create state
    writeState({
      active: true,
      sessionId,
      taskDescription: getSessionName(sessionId),
      currentPhase: 'OBSERVE',
      phaseStartedAt: now,
      algorithmStartedAt: now,
      sla: 'Standard',
      criteria: [],
      agents: [],
      capabilities: ['Task Tool'],
      phaseHistory: [{ phase: 'OBSERVE', startedAt: now, criteriaCount: 0, agentCount: 0 }],
    } as AlgorithmState);
  } else {
    // Completed session — reactivate
    existing.active = true;
    delete existing.completedAt;
    delete existing.summary;
    writeState(existing);
  }
}

// ── Main ──

async function main() {
  // Output continue immediately — never block
  console.log(JSON.stringify({ continue: true }));

  let input: any;
  try {
    const reader = Bun.stdin.stream().getReader();
    let raw = '';
    const read = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += new TextDecoder().decode(value, { stream: true });
      }
    })();
    await Promise.race([read, new Promise<void>(r => setTimeout(r, 200))]);
    if (!raw.trim()) return;
    input = JSON.parse(raw);
  } catch { return; }

  const { tool_name, tool_input, tool_result, session_id } = input;
  if (!session_id) return;

  // ── 1. Bash → Phase detection from voice curls ──
  if (tool_name === 'Bash' && tool_input?.command) {
    const { phase, isAlgorithmEntry } = detectPhaseFromBash(tool_input.command);

    if (isAlgorithmEntry) {
      ensureSessionActive(session_id);
      writeAlchemicalStep('OBSERVE', session_id);
      process.stderr.write(`[AlgorithmTracker] algorithm entry detected\n`);
    }

    if (phase) {
      // Check for rework BEFORE transition (need pre-transition state)
      const preState = readState(session_id);
      const wasCompleteOrLearned = preState && (
        preState.currentPhase === 'COMPLETE' || preState.currentPhase === 'LEARN' || preState.currentPhase === 'IDLE'
      );
      const hadWork = preState && (preState.criteria.length > 0 || !!preState.summary);
      const isReworkTransition = phase === 'OBSERVE' && wasCompleteOrLearned && hadWork;

      ensureSessionActive(session_id);
      phaseTransition(session_id, phase);
      void publishManifestPhase(session_id, phase); // fire-and-forget; optional bridge telemetry
      writeAlchemicalStep(phase, session_id);
      // Emit peon event for stage transition (fire-and-forget)
      try {
        const { spawnSync } = require('child_process');
        spawnSync(
          (process.env.HOME || '') + '/.temperance_engine/bin/te-peon-event.sh',
          ['task.acknowledge', '', 'Stage: ' + phase],
          { stdio: 'ignore', detached: true }
        );
      } catch (_e) { /* best effort */ }

      // Fire rework voice notification if this is a rework cycle
      if (isReworkTransition) {
        const postState = readState(session_id);
        const reworkNum = postState?.reworkCount ?? 1;
        try {
          // Non-blocking voice notification for rework
          fetch('http://localhost:31337/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: `Re-entering algorithm. Rework iteration ${reworkNum}.`,
              voice_id: process.env.PAI_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
            }),
          }).catch(() => {});
        } catch {}
        process.stderr.write(`[AlgorithmTracker] REWORK detected — iteration ${reworkNum}\n`);
      }

      // Update tab with phase-specific color and title
      // Format: "{symbol} {ONE_WORD} | {PHASE}" with per-phase background color
      setPhaseTab(phase, session_id);

      process.stderr.write(`[AlgorithmTracker] phase: ${phase}\n`);
    }
  }

  // ── 2. TaskCreate → Criteria tracking ──
  else if (tool_name === 'TaskCreate') {
    let criterion: { id: string; description: string } | null = null;
    let taskNumber: string | undefined;

    if (tool_result) {
      const m = tool_result.match(TASK_NUMBER);
      if (m) taskNumber = m[1];
    }
    if (tool_input?.subject) criterion = parseCriterion(tool_input.subject);
    if (!criterion && tool_result) {
      const after = tool_result.match(/created successfully:\s*(.+)/);
      if (after) criterion = parseCriterion(after[1]);
    }

    if (criterion) {
      ensureSessionActive(session_id);
      const state = readState(session_id);
      const c: AlgorithmCriterion = {
        id: criterion.id,
        description: criterion.description,
        type: criterion.id.startsWith('A') ? 'anti-criterion' : 'criterion',
        status: 'pending',
        createdInPhase: state?.currentPhase || 'OBSERVE',
        ...(taskNumber && { taskId: taskNumber }),
      };
      criteriaAdd(session_id, c);

      // Real-time effort level inference from criteria count
      // Only upgrades when still at default 'Standard'
      const updated = readState(session_id);
      if (updated && updated.sla === 'Standard') {
        const count = updated.criteria.length;
        let inferred: typeof updated.sla | null = null;
        if (count >= 40) inferred = 'Deep';
        else if (count >= 20) inferred = 'Advanced';
        else if (count >= 12) inferred = 'Extended';
        if (inferred) {
          effortLevelUpdate(session_id, inferred);
          process.stderr.write(`[AlgorithmTracker] effort level inferred: ${inferred} (${count} criteria)\n`);
        }
      }
    }
  }

  // ── 3. TaskUpdate → Criteria status updates ──
  else if (tool_name === 'TaskUpdate' && tool_input?.taskId && tool_input?.status) {
    const statusMap: Record<string, AlgorithmCriterion['status']> = {
      pending: 'pending', in_progress: 'in_progress', completed: 'completed', deleted: 'failed',
    };
    const mapped = statusMap[tool_input.status];
    if (mapped) criteriaUpdate(session_id, tool_input.taskId, mapped);
  }

  // ── 4. Task → Agent spawn tracking ──
  else if (tool_name === 'Task' && tool_input) {
    const agentName = tool_input.name || tool_input.description || 'unnamed';
    const agentType = tool_input.subagent_type || 'general-purpose';
    const task = tool_input.description || tool_input.prompt?.slice(0, 80);

    agentAdd(session_id, {
      name: agentName,
      agentType,
      task,
    });
    process.stderr.write(`[AlgorithmTracker] agent spawned: ${agentName} (${agentType})\n`);
  }
}

main().catch(() => {});
