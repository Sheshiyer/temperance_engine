// package/router/task-model-router.ts
// Routes ISCs (Ideal State Criteria) to optimal executors based on complexity signals.
//
// This is the "cost-aware model router" — the same pattern Claude Code Ultra and
// Copilot Autopilot use internally, but exposed and configurable.
//
// Usage:
//   import { routeTask, executeRouted } from './task-model-router';
//   const decision = routeTask(task, context);
//   const result = await executeRouted(decision, task, context);

import type { ResolvedContext } from '../enrich/contract';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Executor = 
  | 'inline'        // No spawn, handle in current session (lightweight tier)
  | 'subagent'      // Task(subagent_type) — built-in agents
  | 'command-code'  // External CLI — 35 models
  | 'team';         // TeamCreate — coordinated multi-turn

export type Tier = 'lightweight' | 'full';

export type SubagentType = 'Engineer' | 'Architect' | 'Explore' | 'Plan' | 'general-purpose';

export interface RoutingDecision {
  executor: Executor;
  tier: Tier;
  model?: string;           // For command-code: deepseek-v4-flash, kimi-k2.7-code, etc.
  subagentType?: SubagentType;
  reason: string;
  confidence: number;       // 0-1, for escalation decisions
  maxTurns?: number;        // For lightweight tier
  isolation?: 'worktree';   // For parallel file safety
}

export interface ISC {
  id: string;
  description: string;
  files?: string[];         // Files likely touched
  dependencies?: string[];  // Other ISC IDs this depends on
  verification?: string;    // How to verify completion
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Catalog (Command Code models)
// ─────────────────────────────────────────────────────────────────────────────

export const MODEL_CATALOG = {
  // Fast iteration / cheap
  'deepseek-v4-flash': { tier: 'fast', context: '128k', strength: 'speed' },
  'stepfun/Step-3.5-Flash': { tier: 'fast', context: '256k', strength: 'speed' },
  'google/gemini-3.5-flash': { tier: 'fast', context: '1M', strength: 'parallel' },
  
  // Long-horizon / large context
  'moonshotai/Kimi-K2.7-Code': { tier: 'deep', context: '1M', strength: 'long-horizon' },
  'zai-org/GLM-5.2': { tier: 'deep', context: '1M', strength: 'long-horizon' },
  'Qwen/Qwen3.7-Max': { tier: 'deep', context: '128k', strength: 'frontier-coding' },
  
  // Complex reasoning
  'claude-fable-5': { tier: 'premium', context: '200k', strength: 'reasoning' },
  'claude-opus-4-8': { tier: 'premium', context: '200k', strength: 'agents' },
  'gpt-5.5': { tier: 'premium', context: '128k', strength: 'general' },
  
  // Balanced
  'claude-sonnet-5': { tier: 'balanced', context: '200k', strength: 'balanced' },
  'MiniMaxAI/MiniMax-M3': { tier: 'balanced', context: '1M', strength: 'multimodal' },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Complexity Signals
// ─────────────────────────────────────────────────────────────────────────────

interface ComplexitySignals {
  needsToolUse: boolean;
  isExtraction: boolean;
  isLongHorizon: boolean;
  needsCoordination: boolean;
  isArchitectural: boolean;
  isValidation: boolean;
  fileCount: number;
  hasVerification: boolean;
}

function analyzeComplexity(task: ISC): ComplexitySignals {
  const desc = task.description.toLowerCase();
  
  return {
    needsToolUse: /\b(read|search|grep|edit|write|run|execute|test|build|compile)\b/i.test(desc),
    isExtraction: /\b(extract|classify|summarize|list|identify|find|count)\b/i.test(desc),
    isLongHorizon: (
      (task.files?.length ?? 0) > 5 ||
      /\b(refactor|rewrite|migrate|redesign|overhaul|restructure)\b/i.test(desc)
    ),
    needsCoordination: /\b(coordinate|together|shared|sync|parallel|collaborate)\b/i.test(desc),
    isArchitectural: /\b(architect|design|structure|pattern|system|api|schema)\b/i.test(desc),
    isValidation: /\b(validate|verify|review|check|audit|test|ensure)\b/i.test(desc),
    fileCount: task.files?.length ?? 0,
    hasVerification: Boolean(task.verification),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export function routeTask(task: ISC, context?: ResolvedContext): RoutingDecision {
  const signals = analyzeComplexity(task);
  
  // ─────────────────────────────────────────────────────────────────────────
  // Decision tree (order matters — more specific first)
  // ─────────────────────────────────────────────────────────────────────────
  
  // 1. Trivial extraction → inline lightweight
  if (!signals.needsToolUse && signals.isExtraction) {
    return {
      executor: 'inline',
      tier: 'lightweight',
      maxTurns: 3,
      reason: 'one-shot extraction, no tool use needed',
      confidence: 0.95,
    };
  }
  
  // 2. Needs coordination → agent team
  if (signals.needsCoordination) {
    return {
      executor: 'team',
      tier: 'full',
      reason: 'requires multi-agent coordination and shared state',
      confidence: 0.85,
    };
  }
  
  // 3. Architectural → Architect subagent
  if (signals.isArchitectural && !signals.needsToolUse) {
    return {
      executor: 'subagent',
      tier: 'full',
      subagentType: 'Architect',
      reason: 'architectural design, benefits from specialized agent',
      confidence: 0.8,
    };
  }
  
  // 4. Long-horizon coding → Kimi K2.7 (1M context, persistence)
  if (signals.isLongHorizon) {
    return {
      executor: 'command-code',
      tier: 'full',
      model: 'moonshotai/Kimi-K2.7-Code',
      reason: 'long-horizon task benefits from 1M context and coding persistence',
      confidence: 0.85,
    };
  }
  
  // 5. Multi-file with tool use → Engineer subagent with worktree
  if (signals.fileCount > 3 && signals.needsToolUse) {
    return {
      executor: 'subagent',
      tier: 'full',
      subagentType: 'Engineer',
      isolation: 'worktree',
      reason: 'multi-file changes benefit from isolated worktree',
      confidence: 0.8,
    };
  }
  
  // 6. Validation/review → fresh eyes (Gemini)
  if (signals.isValidation && !signals.needsToolUse) {
    return {
      executor: 'command-code',
      tier: 'full',
      model: 'google/gemini-3.5-flash',
      reason: 'validation benefits from fresh perspective and parallel execution',
      confidence: 0.75,
    };
  }
  
  // 7. Standard tool use → fast iteration (DeepSeek)
  if (signals.needsToolUse && !signals.isLongHorizon) {
    return {
      executor: 'command-code',
      tier: 'full',
      model: 'deepseek/deepseek-v4-flash',
      reason: 'standard coding task benefits from fast iteration',
      confidence: 0.8,
    };
  }
  
  // 8. Default → balanced (Sonnet via command-code for cost tracking)
  return {
    executor: 'command-code',
    tier: 'full',
    model: 'claude-sonnet-5',
    reason: 'default balanced routing',
    confidence: 0.7,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch routing (for ISC sets)
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchRoutingResult {
  decisions: Map<string, RoutingDecision>;
  parallelGroups: string[][];  // ISC IDs that can run in parallel
  sequentialChain: string[];   // ISC IDs that must run in order
  summary: {
    inline: number;
    subagent: number;
    commandCode: number;
    team: number;
  };
}

export function routeBatch(tasks: ISC[]): BatchRoutingResult {
  const decisions = new Map<string, RoutingDecision>();
  const summary = { inline: 0, subagent: 0, commandCode: 0, team: 0 };
  
  // Route each task
  for (const task of tasks) {
    const decision = routeTask(task);
    decisions.set(task.id, decision);
    
    switch (decision.executor) {
      case 'inline': summary.inline++; break;
      case 'subagent': summary.subagent++; break;
      case 'command-code': summary.commandCode++; break;
      case 'team': summary.team++; break;
    }
  }
  
  // Build dependency graph
  const hasDeps = new Set<string>();
  const isDep = new Set<string>();
  
  for (const task of tasks) {
    if (task.dependencies?.length) {
      hasDeps.add(task.id);
      for (const dep of task.dependencies) {
        isDep.add(dep);
      }
    }
  }
  
  // Parallel: tasks with no dependencies that aren't depended on by others
  const parallelCandidates = tasks
    .filter(t => !hasDeps.has(t.id))
    .map(t => t.id);
  
  // Sequential: tasks with dependencies (topological order would be better, this is simplified)
  const sequentialChain = tasks
    .filter(t => hasDeps.has(t.id))
    .map(t => t.id);
  
  return {
    decisions,
    parallelGroups: parallelCandidates.length > 0 ? [parallelCandidates] : [],
    sequentialChain,
    summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution helpers (stubs — actual execution in dispatch scripts)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionResult {
  taskId: string;
  executor: Executor;
  model?: string;
  status: 'success' | 'error' | 'timeout';
  output?: string;
  duration_ms: number;
}

/**
 * Generate the shell command to execute a routed task.
 * Returns the command string — caller is responsible for running it.
 */
export function generateExecutionCommand(
  decision: RoutingDecision,
  task: ISC,
  workdir: string,
): string {
  switch (decision.executor) {
    case 'inline':
      // Inline tasks don't generate commands — handled in current session
      return `# INLINE: ${task.description}`;
      
    case 'subagent':
      // Task tool invocation (pseudo-command, actual invocation is via Task tool)
      return `# SUBAGENT: Task(subagent_type="${decision.subagentType}", prompt="${task.description}")`;
      
    case 'command-code':
      // Command Code CLI
      const model = decision.model ?? 'deepseek/deepseek-v4-flash';
      const maxTurns = decision.maxTurns ?? 10;
      return [
        `command-code`,
        `-p "${task.description.replace(/"/g, '\\"')}"`,
        `--model ${model}`,
        `--max-turns ${maxTurns}`,
        `--trust`,
        `--skip-onboarding`,
      ].join(' \\\n  ');
      
    case 'team':
      // Team creation (pseudo-command)
      return `# TEAM: TeamCreate(team_name="${task.id}-team") + TaskCreate + spawn`;
      
    default:
      return `# UNKNOWN executor: ${decision.executor}`;
  }
}

/**
 * Generate a dispatch plan for a batch of ISCs.
 * Returns a shell script that can be executed.
 */
export function generateDispatchScript(
  batch: BatchRoutingResult,
  tasks: ISC[],
  workdir: string,
): string {
  const lines: string[] = [
    '#!/usr/bin/env bash',
    '# Generated by task-model-router',
    '# Temperance Engine multi-model dispatch plan',
    '',
    `set -euo pipefail`,
    '',
    `WORKDIR="${workdir}"`,
    `RESULTS_DIR="$WORKDIR/results/$(date +%Y%m%dT%H%M%S)"`,
    `mkdir -p "$RESULTS_DIR"`,
    '',
    `echo "=== Temperance Engine Dispatch Plan ==="`,
    `echo "Tasks: ${tasks.length}"`,
    `echo "Inline: ${batch.summary.inline}"`,
    `echo "Subagent: ${batch.summary.subagent}"`,
    `echo "Command-Code: ${batch.summary.commandCode}"`,
    `echo "Team: ${batch.summary.team}"`,
    `echo ""`,
    '',
  ];
  
  // Parallel group
  if (batch.parallelGroups.length > 0) {
    lines.push('# === PARALLEL GROUP ===');
    lines.push('echo "Starting parallel tasks..."');
    lines.push('');
    
    for (const group of batch.parallelGroups) {
      for (const taskId of group) {
        const task = tasks.find(t => t.id === taskId);
        const decision = batch.decisions.get(taskId);
        if (!task || !decision) continue;
        
        if (decision.executor === 'command-code') {
          lines.push(`# Task: ${taskId}`);
          lines.push(`(${generateExecutionCommand(decision, task, workdir)} > "$RESULTS_DIR/${taskId}.log" 2>&1) &`);
          lines.push('');
        }
      }
    }
    
    lines.push('wait');
    lines.push('echo "Parallel tasks complete"');
    lines.push('');
  }
  
  // Sequential chain
  if (batch.sequentialChain.length > 0) {
    lines.push('# === SEQUENTIAL CHAIN ===');
    lines.push('echo "Starting sequential tasks..."');
    lines.push('');
    
    for (const taskId of batch.sequentialChain) {
      const task = tasks.find(t => t.id === taskId);
      const decision = batch.decisions.get(taskId);
      if (!task || !decision) continue;
      
      lines.push(`# Task: ${taskId}`);
      lines.push(`echo "Executing: ${taskId}"`);
      if (decision.executor === 'command-code') {
        lines.push(`${generateExecutionCommand(decision, task, workdir)} > "$RESULTS_DIR/${taskId}.log" 2>&1`);
      } else {
        lines.push(generateExecutionCommand(decision, task, workdir));
      }
      lines.push('');
    }
  }
  
  lines.push('echo "=== Dispatch Complete ==="');
  lines.push('echo "Results in: $RESULTS_DIR"');
  
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  routeTask,
  routeBatch,
  generateExecutionCommand,
  generateDispatchScript,
  MODEL_CATALOG,
};
