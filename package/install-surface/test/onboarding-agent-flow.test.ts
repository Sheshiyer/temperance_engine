import { describe, expect, test } from "bun:test";
import type { OnboardingPlanV1 } from "../src/onboarding/contracts.ts";
import { createNineRouterRoutingSurface } from "../src/onboarding/nine-router-provider-capabilities.ts";
import { AgentFlowError, projectAgentFlow, type AgentFlowOptions } from "../src/onboarding/agent-flow.ts";
import { ONBOARDING_WIZARD_STEPS, createOnboardingWizardState, createOnboardingWizardView, handleOnboardingWizardKey } from "../src/onboarding/wizard.ts";

function readyPlan(): OnboardingPlanV1 {
  return {
    schema: "temperance.onboarding.plan.v1", version: { major: 1, minor: 0 }, profile_id: "portable", generated_at: "2026-01-01T00:00:00.000Z", dry_run: true,
    operating_mode: "ready", install_order: ["provider.9router"], plan_digest: `sha256:${"a".repeat(64)}`,
    modules: [
      { id: "provider.9router", title: "9Router", requested: true, status: "eligible", holds: [], guided_installs: [], advisories: [] },
      { id: "delegate.hands", title: "Hands", requested: false, status: "not-selected", holds: [], guided_installs: [], advisories: [] },
    ],
    project_candidates: [true, false].map((available, index) => ({ schema: "temperance.project-capsule.v1", version: { major: 1, minor: 0 }, id: `project.${index}`, repository_identity: `github.com/example/project-${index}`, root_variable: "PROJECT_ROOT", relative_path: `project-${index}`, access: "read-only", approved: false, discovery_source: "portfolio", display_name: `Project ${index}`, path_present: available, selectable: available })),
  };
}
const options: AgentFlowOptions = {
  allowProjectCapsuleSave: true, allowModuleReplan: true, allowRoutingAuthorization: true, allowRoutingSeating: true,
  routing: createNineRouterRoutingSurface({ routerVersion: "0.5.75", requiredAliases: ["noesis-plan"], availableModels: [{ id: "cx/test-model", owner: "cx", kind: "provider" }] }),
};
function expectStableError(action: () => unknown, code: string): void {
  try { action(); throw new Error("EXPECTED_AGENT_ERROR"); }
  catch (error) { expect(error).toBeInstanceOf(AgentFlowError); expect((error as AgentFlowError).code).toBe(code); expect((error as Error).message).toBe(code); }
}

describe("agent flow reuses the guided onboarding wizard", () => {
  test("projects all seven steps, safe current state and honest readiness defaults", () => {
    const output = projectAgentFlow(readyPlan());
    expect(output.schema).toBe("temperance.onboarding.agent-flow.v1");
    expect(output.steps.map(({ id }) => id)).toEqual([...ONBOARDING_WIZARD_STEPS]);
    expect(output.steps.filter(({ current }) => current)).toEqual([{ id: "host", number: 1, current: true }]);
    expect(output.state).toEqual({ step: "host", selected_candidate_ids: [], requested_module_ids: ["provider.9router"] });
    expect(output).toMatchObject({ runtime_activation: "not-performed", context_readiness: "unverified" });
    expect(output).not.toHaveProperty("handoff");
  });

  test("every step exposes exactly the shared wizard's IDs and capability gates", () => {
    const plan = readyPlan();
    for (const step of ONBOARDING_WIZARD_STEPS) {
      const view = createOnboardingWizardView(plan, createOnboardingWizardState(plan, { ...options, initialStep: step }), options);
      const output = projectAgentFlow(plan, { ...options, step });
      expect(output.actions.map(({ id, enabled, reason }) => ({ id, enabled, reason }))).toEqual(view.rows.map((row) => ({ id: row.id, enabled: !row.disabled, reason: row.disabled ? row.description : null })));
    }
  });

  test("navigation and project toggles return resumable state, identical to Enter", () => {
    const plan = readyPlan();
    const next = projectAgentFlow(plan, { ...options, actionId: "continue" });
    expect(next.step).toBe("projects");
    expect(next.transition).toEqual({ action_id: "continue", from_step: "host", to_step: "projects", outcome: "state-updated" });
    const selected = projectAgentFlow(plan, { ...options, step: next.state.step, actionId: "project.project.0", selectedCandidateIds: next.state.selected_candidate_ids });
    const shared = handleOnboardingWizardKey(plan, createOnboardingWizardState(plan, { ...options, initialStep: "projects" }), options, "enter", "project.project.0");
    expect(selected.state.selected_candidate_ids).toEqual(shared.state.selectedCandidateIds);
    expect(selected.state.requested_module_ids).toEqual(shared.state.selectedModuleIds);
    expect(selected).not.toHaveProperty("handoff");
    const resume = projectAgentFlow(plan, { ...options, step: selected.state.step, selectedCandidateIds: selected.state.selected_candidate_ids, actionId: "continue" });
    expect(resume.state).toMatchObject({ step: "providers", selected_candidate_ids: ["project.0"] });
    expect(plan.project_candidates?.[0]?.approved).toBe(false);
  });

  test("module changes request an explicit re-probe without falsely changing observed state", () => {
    const result = projectAgentFlow(readyPlan(), { ...options, step: "modules", actionId: "module.delegate.hands" });
    expect(result.handoff).toEqual({ status: "required", kind: "replan", authority: "request-change", execution: "not-performed", requested_module_ids: ["delegate.hands", "provider.9router"] });
    expect(result.state.requested_module_ids).toEqual(["provider.9router"]);
    expect(result.transition?.outcome).toBe("handoff-required");
  });

  test("blocked optional module deferral also hands off the exact requested selection set", () => {
    const plan = readyPlan();
    plan.operating_mode = "blocked";
    Object.assign(plan.modules[1]!, { requested: true, status: "blocked", holds: [{ reason_code: "SECRET_UNAVAILABLE", message: "Missing gateway", remediation: [], evidence: [] }] });
    const result = projectAgentFlow(plan, { ...options, step: "modules", actionId: "defer-blocked" });
    expect(result.handoff?.requested_module_ids).toEqual(["provider.9router"]);
    expect(result.state.requested_module_ids).toEqual(["delegate.hands", "provider.9router"]);
  });

  test.each([
    { step: "providers", actionId: "provider.claude", kind: "authorize", authority: "provider-sign-in" },
    { step: "combos", actionId: "setup-combos", kind: "seat", authority: "request-change" },
    { step: "projects", actionId: "save-projects", kind: "save", authority: "explicit-confirmation" },
    { step: "review", actionId: "confirm", kind: "confirm", authority: "explicit-confirmation" },
    { step: "host", actionId: "refresh", kind: "refresh", authority: "read-only" },
  ])("$kind returns a REQUIRED handoff and never executes", ({ step, actionId, kind, authority }) => {
    const result = projectAgentFlow(readyPlan(), { ...options, step, actionId, selectedCandidateIds: ["project.0"] });
    expect(result.handoff).toMatchObject({ status: "required", kind, authority, execution: "not-performed" });
    expect(result.state.selected_candidate_ids).toEqual(["project.0"]);
    expect(result.runtime_activation).toBe("not-performed");
    expect(result.context_readiness).toBe("unverified");
    expect(result).not.toHaveProperty("confirmed");
    expect(result).not.toHaveProperty("confirmed_at");
    if (kind === "authorize") expect(result.handoff?.provider_id).toBe("claude");
  });

  test("rejects unknown steps/actions and disabled actions with stable errors", () => {
    expectStableError(() => projectAgentFlow(readyPlan(), { step: "invented" }), "AGENT_FLOW_STEP_INVALID");
    expectStableError(() => projectAgentFlow(readyPlan(), { step: null as never }), "AGENT_FLOW_STEP_INVALID");
    expectStableError(() => projectAgentFlow(readyPlan(), { initialStep: "invented" as never }), "AGENT_FLOW_STEP_INVALID");
    expectStableError(() => projectAgentFlow(readyPlan(), { actionId: "not-an-action" }), "AGENT_FLOW_ACTION_UNKNOWN");
    expectStableError(() => projectAgentFlow(readyPlan(), { ...options, step: "projects", actionId: "project.project.1" }), "AGENT_FLOW_ACTION_DISABLED");
    expectStableError(() => projectAgentFlow(readyPlan(), { ...options, allowRoutingSeating: false, step: "combos", actionId: "setup-combos" }), "AGENT_FLOW_ACTION_DISABLED");
    expectStableError(() => projectAgentFlow({ ...readyPlan(), operating_mode: "blocked" }, { ...options, step: "review", actionId: "confirm" }), "AGENT_FLOW_ACTION_DISABLED");
  });

  test.each(["health", "logs"] as const)("%s is a read-only required handoff, not an inspection result", (actionId) => {
    const result = projectAgentFlow(readyPlan(), { ...options, allowInspection: true, step: "projects", actionId, selectedCandidateIds: ["project.0"] });
    expect(result.actions.find(({ id }) => id === actionId)).toMatchObject({ enabled: true, authority: "read-only" });
    expect(result.handoff).toEqual({ status: "required", kind: actionId, authority: "read-only", execution: "not-performed" });
    expect(result.state).toMatchObject({ step: "projects", selected_candidate_ids: ["project.0"] });
    expect(result).not.toHaveProperty("health");
    expect(result).not.toHaveProperty("telemetry");
    expectStableError(() => projectAgentFlow(readyPlan(), { ...options, allowInspection: false, actionId }), "AGENT_FLOW_ACTION_UNKNOWN");
  });

  test("never silently filters unknown or unavailable supplied project selections", () => {
    expectStableError(() => projectAgentFlow(readyPlan(), { selectedCandidateIds: ["unknown"] }), "AGENT_FLOW_PROJECT_UNKNOWN");
    expectStableError(() => projectAgentFlow(readyPlan(), { selectedCandidateIds: ["project.1"] }), "AGENT_FLOW_PROJECT_UNAVAILABLE");
    expectStableError(() => projectAgentFlow(readyPlan(), { selectedCandidateIds: ["project.0", "project.1"] }), "AGENT_FLOW_PROJECT_UNAVAILABLE");
    expectStableError(() => projectAgentFlow(readyPlan(), { selectedCandidateIds: "project.0" as never }), "AGENT_FLOW_PROJECT_UNKNOWN");
  });

  test("omits host details, notices, credentials, detailed evidence and configuration values", () => {
    const plan = readyPlan();
    plan.configuration_inputs = [{ id: "routing-input", digest: `sha256:${"b".repeat(64)}`, details: ["SECRET_CONFIGURATION_VALUE"] }];
    plan.modules[0]!.guided_installs = [{ id: "private-command", kind: "command", label: "Private", argv: ["tool", "SECRET_ARGUMENT_VALUE"] }];
    const sensitive = { ...options, hostDescription: "/synthetic-home/private-host/SECRET_HOST_VALUE", notice: "SECRET_NOTICE_VALUE" };
    const before = JSON.stringify({ plan, sensitive });
    const serialized = JSON.stringify(ONBOARDING_WIZARD_STEPS.map((step) => projectAgentFlow(plan, { ...sensitive, step })));
    for (const value of ["SECRET_CONFIGURATION_VALUE", "SECRET_ARGUMENT_VALUE", "SECRET_HOST_VALUE", "SECRET_NOTICE_VALUE", "/synthetic-home/private-host/"]) expect(serialized).not.toContain(value);
    expect(JSON.stringify({ plan, sensitive })).toBe(before);
  });
});
