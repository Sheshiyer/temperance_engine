import type { OnboardingPlanV1 } from "./contracts.ts";
import {
  ONBOARDING_WIZARD_STEPS,
  createOnboardingWizardState,
  createOnboardingWizardView,
  handleOnboardingWizardKey,
  type OnboardingWizardOptions,
  type OnboardingWizardState,
  type WizardEffect,
  type WizardRow,
  type WizardStepId,
} from "./wizard.ts";

export const ONBOARDING_AGENT_FLOW_SCHEMA = "temperance.onboarding.agent-flow.v1" as const;
export type AgentFlowAuthority = "read-only" | "request-change" | "explicit-confirmation" | "provider-sign-in";
export type AgentFlowErrorCode =
  | "AGENT_FLOW_STEP_INVALID"
  | "AGENT_FLOW_ACTION_UNKNOWN"
  | "AGENT_FLOW_ACTION_DISABLED"
  | "AGENT_FLOW_PROJECT_UNKNOWN"
  | "AGENT_FLOW_PROJECT_UNAVAILABLE";

export class AgentFlowError extends Error {
  constructor(public readonly code: AgentFlowErrorCode) {
    super(code);
    this.name = "AgentFlowError";
  }
}

export interface AgentFlowOptions extends OnboardingWizardOptions {
  step?: WizardStepId | string;
  actionId?: string;
}
export interface AgentFlowState {
  step: WizardStepId;
  selected_candidate_ids: string[];
  requested_module_ids: string[];
}
export interface AgentFlowAction {
  id: string;
  label: string;
  kind: WizardRow["action"]["kind"];
  enabled: boolean;
  reason: string | null;
  authority: AgentFlowAuthority;
}
export interface AgentFlowHandoff {
  status: "required";
  kind: Exclude<WizardEffect["kind"], "cancel">;
  authority: AgentFlowAuthority;
  execution: "not-performed";
  requested_module_ids?: string[];
  provider_id?: string;
}
export interface OnboardingAgentFlowV1 {
  schema: typeof ONBOARDING_AGENT_FLOW_SCHEMA;
  version: { major: 1; minor: 0 };
  plan_digest: OnboardingPlanV1["plan_digest"];
  step: WizardStepId;
  state: AgentFlowState;
  steps: Array<{ id: WizardStepId; number: number; current: boolean }>;
  actions: AgentFlowAction[];
  transition?: {
    action_id: string;
    from_step: WizardStepId;
    to_step: WizardStepId;
    outcome: "state-updated" | "inspected" | "handoff-required";
  };
  handoff?: AgentFlowHandoff;
  runtime_activation: "not-performed";
  context_readiness: "unverified";
}

function authorityFor(row: WizardRow): AgentFlowAuthority {
  switch (row.action.kind) {
    case "authorize": return "provider-sign-in";
    case "save": case "confirm": return "explicit-confirmation";
    case "project": case "module": case "defer": case "seat": return "request-change";
    default: return "read-only";
  }
}

function publicState(state: OnboardingWizardState): AgentFlowState {
  return { step: state.step, selected_candidate_ids: [...state.selectedCandidateIds], requested_module_ids: [...state.selectedModuleIds] };
}

function requiredHandoff(effect: WizardEffect | undefined, row: WizardRow): AgentFlowHandoff | undefined {
  if (!effect || effect.kind === "cancel") return undefined;
  return {
    status: "required",
    kind: effect.kind,
    authority: authorityFor(row),
    execution: "not-performed",
    ...(effect.kind === "replan" ? { requested_module_ids: [...effect.selectedModuleIds] } : {}),
    ...(effect.kind === "authorize" ? { provider_id: effect.providerId } : {}),
  };
}

/**
 * Headless projection of the existing wizard, not a second state machine.
 * This function only returns instructions/state. It never persists approvals,
 * signs in, seats models, re-probes dependencies, or attests runtime readiness.
 */
export function projectAgentFlow(plan: OnboardingPlanV1, options: AgentFlowOptions = {}): OnboardingAgentFlowV1 {
  const chosenStep = options.step !== undefined ? options.step : options.initialStep !== undefined ? options.initialStep : "host";
  if (typeof chosenStep !== "string" || !ONBOARDING_WIZARD_STEPS.includes(chosenStep as WizardStepId)) throw new AgentFlowError("AGENT_FLOW_STEP_INVALID");
  if (options.selectedCandidateIds !== undefined && !Array.isArray(options.selectedCandidateIds)) throw new AgentFlowError("AGENT_FLOW_PROJECT_UNKNOWN");
  const candidates = new Map((plan.project_candidates ?? []).map((candidate) => [candidate.id, candidate]));
  for (const id of options.selectedCandidateIds ?? []) {
    const candidate = typeof id === "string" ? candidates.get(id) : undefined;
    if (!candidate) throw new AgentFlowError("AGENT_FLOW_PROJECT_UNKNOWN");
    if (!candidate.path_present || candidate.selectable === false) throw new AgentFlowError("AGENT_FLOW_PROJECT_UNAVAILABLE");
  }

  // Presentation-only private strings and detailed guidance are not included
  // in the machine response. All capability/action gating stays in the wizard.
  const wizardOptions: OnboardingWizardOptions = { ...options, initialStep: chosenStep as WizardStepId, hostDescription: undefined, notice: undefined };
  let state = createOnboardingWizardState(plan, wizardOptions);
  let transition: OnboardingAgentFlowV1["transition"];
  let handoff: AgentFlowHandoff | undefined;
  if (options.actionId !== undefined) {
    const currentView = createOnboardingWizardView(plan, state, wizardOptions);
    const row = currentView.rows.find(({ id }) => typeof options.actionId === "string" && id === options.actionId);
    if (!row) throw new AgentFlowError("AGENT_FLOW_ACTION_UNKNOWN");
    if (row.disabled) throw new AgentFlowError("AGENT_FLOW_ACTION_DISABLED");
    const fromStep = state.step;
    const result = handleOnboardingWizardKey(plan, state, wizardOptions, "enter", row.id);
    state = result.state;
    handoff = requiredHandoff(result.effect, row);
    transition = {
      action_id: row.id, from_step: fromStep, to_step: state.step,
      outcome: handoff ? "handoff-required" : row.action.kind === "info" ? "inspected" : "state-updated",
    };
  }
  const view = createOnboardingWizardView(plan, state, wizardOptions);
  return {
    schema: ONBOARDING_AGENT_FLOW_SCHEMA,
    version: { major: 1, minor: 0 },
    plan_digest: plan.plan_digest,
    step: state.step,
    state: publicState(state),
    steps: ONBOARDING_WIZARD_STEPS.map((id, index) => ({ id, number: index + 1, current: id === state.step })),
    actions: view.rows.map((row) => ({ id: row.id, label: row.title, kind: row.action.kind, enabled: !row.disabled, reason: row.disabled ? row.description : null, authority: authorityFor(row) })),
    ...(transition ? { transition } : {}),
    ...(handoff ? { handoff } : {}),
    runtime_activation: "not-performed",
    context_readiness: "unverified",
  };
}
