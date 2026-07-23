#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import manifestJson from "./temperance-workflows.json";

export type WorkflowRole = "planner" | "dispatch" | "creative" | "writing";

export interface WorkflowCandidate {
  provider?: string;
  backend?: string;
  model: string;
  role?: string;
  capability?: string;
  cost_posture?: string;
}

export interface CritiqueResolution {
  portfolio: string;
  judge_model: string;
  selected: WorkflowCandidate[];
  omitted: WorkflowCandidate[];
}

export interface ResearchResolution {
  portfolio: string;
  judge_model: string;
  selected: WorkflowCandidate[];
  omitted: WorkflowCandidate[];
}

export interface MediaResolution {
  portfolio: string;
  selected: WorkflowCandidate[];
  omitted: WorkflowCandidate[];
}

export interface WorkflowResolution {
  role: WorkflowRole;
  portfolio: string;
  source: "catalog" | "direct";
  selected: WorkflowCandidate[];
  omitted: WorkflowCandidate[];
  native_providers: string[];
  workflow: string[];
  critique?: CritiqueResolution;
  research?: ResearchResolution;
  media?: MediaResolution;
  substitutions?: PlannerSubstitution[];
}

/**
 * Live per-provider quota, as written by
 * scripts/omniroute-temperance-planner-quota.sh (schema temperance-planner-quota-v1).
 * `remaining` is a 0-100 percentage from `omniroute usage quota`; `state`
 * mirrors that command's own state field (e.g. "available").
 */
export interface PlannerQuotaProviderState {
  remaining: number | null;
  state: string;
}

export interface PlannerQuotaState {
  schema_version?: string;
  checked_at?: string;
  threshold_percent?: number;
  providers?: Record<string, PlannerQuotaProviderState>;
}

export interface PlannerSubstitution {
  slot: string;
  from: string;
  to: string;
  reason: string;
}

const KIMI_QUOTA_MODEL = "kimi-coding-apikey/k3";
const KIMI_QUOTA_PROVIDER = "kimi-coding-apikey";
/** Only the planner's github/codex candidates are quota-guarded; the Nebius
 * escalation fallback is never substituted -- it stays the final safety net. */
const GUARDED_PLANNER_PROVIDERS = new Set(["github", "codex"]);
const DEFAULT_QUOTA_THRESHOLD_PERCENT = 30;

function belowThreshold(state: PlannerQuotaProviderState | undefined, thresholdPercent: number): boolean {
  // Missing/unknown quota data fails open: never trigger a switch on absent data.
  if (!state || state.remaining == null) return false;
  if (state.state !== "available") return true;
  return state.remaining < thresholdPercent;
}

/**
 * Mirrors scripts/omniroute-temperance-planner-quota.sh's substitution logic:
 * each guarded slot (github, codex) independently substitutes to kimi-k3 when
 * its own remaining quota drops below the threshold, unless kimi's own quota
 * is also below the threshold (fail through to the original model, letting
 * OmniRoute's existing reactive failover to Nebius apply instead). Both slots
 * triggering dedupes to a single kimi-k3 entry.
 */
function applyPlannerQuota(
  candidates: WorkflowCandidate[],
  quota: PlannerQuotaState | undefined,
): { candidates: WorkflowCandidate[]; substitutions: PlannerSubstitution[] } {
  if (!quota?.providers) return { candidates, substitutions: [] };
  const thresholdPercent = quota.threshold_percent ?? DEFAULT_QUOTA_THRESHOLD_PERCENT;
  const kimiOk = !belowThreshold(quota.providers[KIMI_QUOTA_PROVIDER], thresholdPercent);
  const substitutions: PlannerSubstitution[] = [];
  let usedKimi = false;
  const result: WorkflowCandidate[] = [];
  for (const candidate of candidates) {
    const provider = candidate.provider;
    if (!provider || !GUARDED_PLANNER_PROVIDERS.has(provider) || !kimiOk || !belowThreshold(quota.providers[provider], thresholdPercent)) {
      result.push(candidate);
      continue;
    }
    if (usedKimi) continue; // dedupe: both slots triggered, keep a single kimi-k3 entry
    usedKimi = true;
    const remaining = quota.providers[provider]?.remaining;
    substitutions.push({
      slot: provider,
      from: candidate.model,
      to: KIMI_QUOTA_MODEL,
      reason: `remaining ${remaining ?? "?"}% < ${thresholdPercent}%`,
    });
    result.push({ provider: KIMI_QUOTA_PROVIDER, model: KIMI_QUOTA_MODEL, reason: "quota-substitution" });
  }
  return { candidates: result, substitutions };
}

function loadPlannerQuotaState(): PlannerQuotaState | undefined {
  const path = process.env.TEMPERANCE_PLANNER_QUOTA_STATE
    || join(process.env.TEMPERANCE_STATE_DIR || join(homedir(), ".temperance_engine"), "state", "omniroute-planner-quota.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed as PlannerQuotaState;
  } catch {
    return undefined; // Missing/malformed cache fails open to unmodified candidates.
  }
}

export const workflowManifest = manifestJson as {
  version: 1;
  planner: {
    portfolio: string;
    primary: WorkflowCandidate;
    escalation: WorkflowCandidate[];
    execution: string;
    protect_from_worker_fanout: boolean;
  };
  dispatch: {
    portfolio: string;
    max_parallel: number;
    omniroute_workers: WorkflowCandidate[];
    direct_cli_fallbacks: WorkflowCandidate[];
    selection_rule: string;
    fail_open: string;
  };
  creative: {
    portfolio: string;
    planner_models: string[];
    native_providers: Array<{
      provider: string;
      models: string[];
      endpoint: string;
      contract: string;
    }>;
    workflow: string[];
    chat_combo_boundary: string;
  };
  writing: {
    portfolio: string;
    purpose: string;
    skill: string;
    drafting_models: string[];
    critique: {
      portfolio: string;
      strategy: "fusion";
      models: string[];
      judge_model: string;
      verdicts: string[];
      scored_dimensions: string[];
    };
    research: {
      portfolio: string;
      strategy: "fusion";
      purpose: string;
      models: string[];
      judge_model: string;
      claim_modes: string[];
      chat_combo_boundary: string;
    };
    media: {
      portfolio: string;
      strategy: "priority";
      purpose: string;
      models: string[];
      chat_combo_boundary: string;
    };
    workflow: string[];
    transmutation_workflow: string[];
    chat_combo_boundary: string;
    acp: { status: "declared-inactive"; note: string };
  };
};

function catalogSet(availableModels: readonly string[]): Set<string> {
  return new Set(availableModels.filter((model) => typeof model === "string"));
}

function splitCandidates(
  candidates: WorkflowCandidate[],
  catalog: Set<string>,
): Pick<WorkflowResolution, "selected" | "omitted" | "source"> {
  const selected = candidates.filter(({ model }) => catalog.has(model));
  return {
    selected,
    omitted: candidates.filter(({ model }) => !catalog.has(model)),
    source: selected.length > 0 ? "catalog" : "direct",
  };
}

export function resolveWorkflow(
  role: string,
  availableModels: readonly string[],
  quotaState?: PlannerQuotaState,
): WorkflowResolution {
  const normalized = (role === "planner" || role === "dispatch" || role === "creative" || role === "writing"
    ? role
    : "dispatch") as WorkflowRole;
  const catalog = catalogSet(availableModels);

  if (normalized === "planner") {
    const baseCandidates = [workflowManifest.planner.primary, ...workflowManifest.planner.escalation];
    const { candidates, substitutions } = applyPlannerQuota(baseCandidates, quotaState);
    return {
      role: normalized,
      portfolio: workflowManifest.planner.portfolio,
      ...splitCandidates(candidates, catalog),
      native_providers: [],
      workflow: ["freeze-plan", "rank-candidates", "hand-off-to-dispatch"],
      substitutions,
    };
  }

  if (normalized === "creative") {
    const candidates = workflowManifest.creative.planner_models.map((model) => ({ model }));
    return {
      role: normalized,
      portfolio: workflowManifest.creative.portfolio,
      ...splitCandidates(candidates, catalog),
      native_providers: workflowManifest.creative.native_providers.map(({ provider }) => provider),
      workflow: workflowManifest.creative.workflow,
    };
  }

  if (normalized === "writing") {
    const drafting = workflowManifest.writing.drafting_models.map((model) => ({ model }));
    const council = workflowManifest.writing.critique.models.map((model) => ({ model }));
    const councilSplit = splitCandidates(council, catalog);
    const researchPanel = workflowManifest.writing.research.models.map((model) => ({ model }));
    const researchSplit = splitCandidates(researchPanel, catalog);
    const mediaPanel = workflowManifest.writing.media.models.map((model) => ({ model }));
    const mediaSplit = splitCandidates(mediaPanel, catalog);
    return {
      role: normalized,
      portfolio: workflowManifest.writing.portfolio,
      ...splitCandidates(drafting, catalog),
      native_providers: [],
      workflow: workflowManifest.writing.workflow,
      critique: {
        portfolio: workflowManifest.writing.critique.portfolio,
        judge_model: workflowManifest.writing.critique.judge_model,
        selected: councilSplit.selected,
        omitted: councilSplit.omitted,
      },
      research: {
        portfolio: workflowManifest.writing.research.portfolio,
        judge_model: workflowManifest.writing.research.judge_model,
        selected: researchSplit.selected,
        omitted: researchSplit.omitted,
      },
      media: {
        portfolio: workflowManifest.writing.media.portfolio,
        selected: mediaSplit.selected,
        omitted: mediaSplit.omitted,
      },
    };
  }

  return {
    role: normalized,
    portfolio: workflowManifest.dispatch.portfolio,
    ...splitCandidates(workflowManifest.dispatch.omniroute_workers, catalog),
    native_providers: [],
    workflow: ["freeze-plan", "shard-independent-tasks", "dispatch-workers", "collect-evidence"],
  };
}

if (import.meta.main) {
  const [command, role, ...availableModels] = Bun.argv.slice(2);
  if (command !== "resolve" || !role) {
    console.error("usage: temperance-workflows.ts resolve ROLE [MODEL ...]");
    process.exit(2);
  }
  const quotaState = role === "planner" ? loadPlannerQuotaState() : undefined;
  process.stdout.write(`${JSON.stringify(resolveWorkflow(role, availableModels, quotaState))}\n`);
}
