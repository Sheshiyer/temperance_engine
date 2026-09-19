import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { OnboardingPlanV1 } from "../src/onboarding/contracts.ts";
import type { ProjectCapsuleV1 } from "../src/onboarding/public-contracts.ts";
import { createNineRouterRoutingSurface } from "../src/onboarding/nine-router-provider-capabilities.ts";
import { runOnboardingTui } from "../src/onboarding/tui.ts";
import { ONBOARDING_WIZARD_STEPS, canConfirmOnboardingWizard, completeOnboardingWizard, createOnboardingWizardState, createOnboardingWizardView, handleOnboardingWizardKey, type OnboardingWizardOptions } from "../src/onboarding/wizard.ts";

const ready: OnboardingPlanV1 = {
  schema: "temperance.onboarding.plan.v1", version: { major: 1, minor: 0 }, profile_id: "portable", generated_at: "2026-01-01T00:00:00.000Z", dry_run: true,
  operating_mode: "ready", install_order: ["provider.9router"], plan_digest: `sha256:${"a".repeat(64)}`,
  modules: [{ id: "provider.9router", title: "9Router", requested: true, status: "eligible", holds: [], guided_installs: [], advisories: [] }],
  project_candidates: Array.from({ length: 120 }, (_, index) => ({
    schema: "temperance.project-capsule.v1", version: { major: 1, minor: 0 }, id: `project.${index}`, repository_identity: `github.com/example/project-${index}`,
    root_variable: "PROJECT_ROOT", relative_path: `project-${index}`, access: "read-only", approved: false, discovery_source: "portfolio", display_name: `Project ${index}`, path_present: index !== 119, selectable: index !== 119,
    mapping_status: index === 119 ? "path-missing" : "repository-mapped",
  })),
};
const existing: ProjectCapsuleV1[] = Array.from({ length: 4 }, (_, index) => ({ schema: "temperance.project-capsule.v1", version: { major: 1, minor: 0 }, id: `existing.${index}`, repository_identity: `github.com/example/existing-${index}`, root_variable: "PROJECT_ROOT", relative_path: `existing-${index}`, access: "read-only", approved: true }));
const routing = createNineRouterRoutingSurface({ routerVersion: "0.5.75", requiredAliases: ["noesis-plan"], availableModels: [{ id: "cx/test-model", owner: "cx", kind: "provider" }] });
const options: OnboardingWizardOptions = { existingProjectCapsules: existing, allowProjectCapsuleSave: true, allowModuleReplan: true, routing, allowRoutingAuthorization: true, allowRoutingSeating: true };
const blocked: OnboardingPlanV1 = { ...ready, operating_mode: "blocked", modules: [...ready.modules, { id: "delegate.hands", title: "Hands", requested: true, status: "blocked", holds: [{ reason_code: "SECRET_UNAVAILABLE", message: "Gateway key missing", remediation: ["Connect the gateway"], evidence: [] }], guided_installs: [], advisories: [] }] };

describe("sequential onboarding controller", () => {
  test("Enter advances through exactly seven ordered steps, with visible Back and Continue", () => {
    let state = createOnboardingWizardState(ready, options);
    for (const [index, step] of ONBOARDING_WIZARD_STEPS.entries()) {
      const view = createOnboardingWizardView(ready, state, options);
      expect(state.step).toBe(step);
      expect(view.stepNumber).toBe(index + 1);
      expect(view.rows.some(({ id }) => id === "back")).toBe(index > 0);
      if (step !== "review") state = handleOnboardingWizardKey(ready, state, options, "enter", "continue").state;
    }
    expect(handleOnboardingWizardKey(ready, state, options, "return", "back").state.step).toBe("integrations");
  });
  test("projects show all existing approvals and mapped candidates with honest unavailable reasons", () => {
    const state = createOnboardingWizardState(ready, { ...options, initialStep: "projects" });
    const view = createOnboardingWizardView(ready, state, options);
    expect(view.summary).toContain("4 approved");
    expect(view.summary).toContain("120 candidates");
    expect(view.summary).toContain("120 mapped");
    expect(view.summary).toContain("1 unavailable");
    expect(view.rows.filter(({ id }) => id.startsWith("existing."))).toHaveLength(4);
    expect(view.rows.filter(({ id }) => id.startsWith("project."))).toHaveLength(120);
    expect(view.rows[3]?.id).toBe("existing.existing.0");
    expect(view.rows.find(({ id }) => id === "project.project.119")).toMatchObject({ disabled: true, description: "PROJECT_PATH_UNAVAILABLE · path-missing" });
  });
  test("Enter toggles pending project approval without saving or elevating read-only access", () => {
    const state = createOnboardingWizardState(ready, { ...options, initialStep: "projects" });
    const selected = handleOnboardingWizardKey(ready, state, options, "enter", "project.project.0");
    expect(selected.effect).toBeUndefined();
    expect(selected.state.selectedCandidateIds).toEqual(["project.0"]);
    expect(handleOnboardingWizardKey(ready, selected.state, options, "enter", "project.project.0").state.selectedCandidateIds).toEqual([]);
    expect(completeOnboardingWizard(ready, selected.state, options, { kind: "cancel" }).project_capsules).toEqual(existing);
    const saved = completeOnboardingWizard(ready, selected.state, options, { kind: "save" });
    expect(saved.save_project_capsules).toBe(true);
    expect(saved.project_capsules.find(({ id }) => id === "project.0")).toMatchObject({ approved: true, access: "read-only" });
  });
  test("unavailable projects and missing save destinations cannot be selected", () => {
    const state = createOnboardingWizardState(ready, { ...options, initialStep: "projects" });
    expect(handleOnboardingWizardKey(ready, state, options, "enter", "project.project.119").state.selectedCandidateIds).toEqual([]);
    const noSave = handleOnboardingWizardKey(ready, state, { ...options, allowProjectCapsuleSave: false }, "enter", "project.project.0");
    expect(noSave.state.selectedCandidateIds).toEqual([]);
    expect(noSave.state.notice).toContain("save destination");
  });
  test("module toggles and explicit deferral emit re-probe requests, not enabled state", () => {
    const state = createOnboardingWizardState(blocked, { ...options, initialStep: "modules" });
    const defer = handleOnboardingWizardKey(blocked, state, options, "enter", "defer-blocked");
    expect(defer.effect).toEqual({ kind: "replan", selectedModuleIds: ["provider.9router"] });
    expect(defer.state.selectedModuleIds).toContain("delegate.hands");
    expect(handleOnboardingWizardKey(blocked, state, { ...options, allowModuleReplan: false }, "enter", "module.delegate.hands").effect).toBeUndefined();
    const unrequested = { ...blocked, modules: blocked.modules.map((module) => module.id === "delegate.hands" ? { ...module, requested: false } : module) };
    expect(handleOnboardingWizardKey(unrequested, createOnboardingWizardState(unrequested, { initialStep: "modules" }), options, "enter", "module.delegate.hands").effect).toBeUndefined();
  });
  test("OAuth, seating and refresh handoffs carry the current step and pending candidates without saving", () => {
    for (const [step, row, expected] of [["providers", "provider.claude", "authorize"], ["combos", "setup-combos", "seat"], ["projects", "refresh", "refresh"]] as const) {
      const state = createOnboardingWizardState(ready, { ...options, initialStep: step, selectedCandidateIds: ["project.0"], notice: "Connection completed" });
      const transition = handleOnboardingWizardKey(ready, state, options, "enter", row);
      expect(transition.effect?.kind).toBe(expected);
      const result = completeOnboardingWizard(ready, transition.state, options, transition.effect!);
      expect(result.resume_step).toBe(step);
      expect(result.selected_candidate_ids).toEqual(["project.0"]);
      expect(result.save_project_capsules).toBe(false);
      expect(result.project_capsules).toEqual(existing);
    }
  });
  test("Enter or y confirms in one action and includes project approvals only at explicit confirmation", () => {
    const state = createOnboardingWizardState(ready, { ...options, initialStep: "review", selectedCandidateIds: ["project.0"] });
    for (const key of ["enter", "return", "y"]) {
      const transition = handleOnboardingWizardKey(ready, state, options, key, "confirm");
      expect(transition.effect).toEqual({ kind: "confirm" });
      expect(completeOnboardingWizard(ready, transition.state, options, transition.effect!, "2026-09-19T00:00:00.000Z")).toMatchObject({ confirmed: true, save_project_capsules: true, confirmed_at: "2026-09-19T00:00:00.000Z" });
    }
  });
  test("blocked and requested-held degraded plans cannot confirm", () => {
    for (const plan of [blocked, { ...blocked, operating_mode: "read-only-degraded" as const }]) {
      const state = createOnboardingWizardState(plan, { ...options, initialStep: "review" });
      expect(canConfirmOnboardingWizard(plan)).toBe(false);
      expect(handleOnboardingWizardKey(plan, state, options, "y", "confirm").effect).toBeUndefined();
      expect(() => completeOnboardingWizard(plan, state, options, { kind: "confirm" }, "2026-09-19T00:00:00.000Z")).toThrow("ONBOARDING_CONFIRMATION_BLOCKED");
    }
  });
  test("cancel never saves and no hidden a/s/o keys are required", () => {
    const state = createOnboardingWizardState(ready, { ...options, initialStep: "projects", selectedCandidateIds: ["project.0"] });
    for (const key of ["q", "escape"]) expect(completeOnboardingWizard(ready, state, options, handleOnboardingWizardKey(ready, state, options, key).effect!)).toMatchObject({ confirmed: false, save_project_capsules: false });
    for (const key of ["a", "s", "o"]) expect(handleOnboardingWizardKey(ready, state, options, key, "project.project.0").effect).toBeUndefined();
  });
});

test("80x24 renderer shows projects and native arrows/Enter preserve choices through OAuth handoff", async () => {
  const ui = await createTestRenderer({ width: 80, height: 24 });
  try {
    const running = runOnboardingTui(ready, { ...options, createRenderer: async () => ui.renderer });
    await ui.waitForFrame((frame) => frame.includes("Step 1/7: Host"));
    ui.mockInput.pressEnter();
    const projects = await ui.waitForFrame((frame) => frame.includes("Step 2/7: Projects"));
    expect(projects).toContain("4 approved");
    expect(projects).toContain("120 candidates");
    expect(projects).toContain("Project 0");
    expect(projects).toContain("Enter activate");
    await ui.mockInput.pressKeys(Array(7).fill("ARROW_DOWN"));
    ui.mockInput.pressEnter();
    await ui.waitForFrame((frame) => frame.includes("1 pending"));
    await ui.mockInput.pressKeys(Array(7).fill("ARROW_UP"));
    ui.mockInput.pressEnter();
    await ui.waitForFrame((frame) => frame.includes("Step 3/7: Providers"));
    await ui.mockInput.pressKeys(Array(3).fill("ARROW_DOWN"));
    ui.mockInput.pressEnter();
    const result = await running;
    expect(result.routing_authorization_provider_id).toBe("claude");
    expect(result.resume_step).toBe("providers");
    expect(result.selected_candidate_ids).toEqual(["project.0"]);
    expect(result.save_project_capsules).toBe(false);
  } finally { ui.renderer.destroy(); }
}, 10_000);

test("80x24 renderer closes immediately after one Enter on final confirmation", async () => {
  const ui = await createTestRenderer({ width: 80, height: 24 });
  try {
    const running = runOnboardingTui(ready, { ...options, initialStep: "review", createRenderer: async () => ui.renderer });
    await ui.waitForFrame((frame) => frame.includes("Step 7/7: Review"));
    ui.mockInput.pressEnter();
    expect((await running).confirmed).toBe(true);
  } finally { ui.renderer.destroy(); }
}, 10_000);
