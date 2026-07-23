#!/usr/bin/env bun

import manifestJson from "./temperance-workflows.json";

export type WorkflowRole = "planner" | "dispatch" | "creative";

export interface WorkflowCandidate {
  provider?: string;
  backend?: string;
  model: string;
  role?: string;
  capability?: string;
  cost_posture?: string;
}

export interface WorkflowResolution {
  role: WorkflowRole;
  portfolio: string;
  source: "catalog" | "direct";
  selected: WorkflowCandidate[];
  omitted: WorkflowCandidate[];
  native_providers: string[];
  workflow: string[];
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
): WorkflowResolution {
  const normalized = (role === "planner" || role === "dispatch" || role === "creative"
    ? role
    : "dispatch") as WorkflowRole;
  const catalog = catalogSet(availableModels);

  if (normalized === "planner") {
    const candidates = [workflowManifest.planner.primary, ...workflowManifest.planner.escalation];
    return {
      role: normalized,
      portfolio: workflowManifest.planner.portfolio,
      ...splitCandidates(candidates, catalog),
      native_providers: [],
      workflow: ["freeze-plan", "rank-candidates", "hand-off-to-dispatch"],
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
  process.stdout.write(`${JSON.stringify(resolveWorkflow(role, availableModels))}\n`);
}
