import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { OnboardingPlanV1 } from "../src/onboarding/contracts.ts";
import type { OperatorEventInput } from "../src/onboarding/operator-events.ts";
import { projectOperatorHealth, renderOperatorHealth } from "../src/onboarding/operator-health.ts";
import { runOperatorReportTui } from "../src/onboarding/operator-report-tui.ts";
import type { ProjectCapsuleV1 } from "../src/onboarding/public-contracts.ts";
import { runOnboardingTui } from "../src/onboarding/tui.ts";
import { createOnboardingWizardState, handleOnboardingWizardKey } from "../src/onboarding/wizard.ts";

const plan: OnboardingPlanV1 = {
  schema: "temperance.onboarding.plan.v1", version: { major: 1, minor: 0 },
  profile_id: "portable", generated_at: "2026-01-01T00:00:00.000Z", dry_run: true,
  operating_mode: "ready", install_order: ["provider.9router"], plan_digest: `sha256:${"a".repeat(64)}`,
  modules: [{ id: "provider.9router", title: "9Router", requested: true, status: "eligible", holds: [], guided_installs: [], advisories: [] }],
  project_candidates: [{
    schema: "temperance.project-capsule.v1", version: { major: 1, minor: 0 }, id: "project.pending",
    repository_identity: "github.com/example/pending", root_variable: "PROJECT_ROOT", relative_path: "pending",
    access: "read-only", approved: false, discovery_source: "portfolio", display_name: "Pending project",
    path_present: true, selectable: true, mapping_status: "repository-mapped",
  }],
};
const existing: ProjectCapsuleV1[] = [{
  schema: "temperance.project-capsule.v1", version: { major: 1, minor: 0 }, id: "project.existing",
  repository_identity: "github.com/example/existing", root_variable: "PROJECT_ROOT", relative_path: "existing",
  access: "read-only", approved: true,
}];

describe("read-only operator report terminal", () => {
  test("80x24 health report keeps read-only scope and Enter return footer visible", async () => {
    const ui = await createTestRenderer({ width: 80, height: 24 });
    const health = projectOperatorHealth({ plan });
    const before = JSON.stringify({ plan, health });
    try {
      const running = runOperatorReportTui("Doctor & health", renderOperatorHealth(health), { renderer: ui.renderer });
      const frame = await ui.waitForFrame((value) => value.includes("Enter/Esc/q returns to setup"));
      expect(frame).toContain("Temperance · Doctor & health");
      expect(frame).toContain("Read-only observation; no repair or activation performed.");
      expect(frame).toContain("configuration-only");
      expect(frame).toContain("Eligibility is not activation.");
      expect(frame).toContain("choices preserved");
      expect(frame.split("\n").slice(-4).join("\n")).toContain("Enter/Esc/q");
      ui.mockInput.pressEnter();
      expect(await running).toBeUndefined();
      expect(JSON.stringify({ plan, health })).toBe(before);
    } finally { ui.renderer.destroy(); }
  }, 10_000);

  test("long telemetry report scrolls without hiding the footer and Escape returns", async () => {
    const ui = await createTestRenderer({ width: 80, height: 24 });
    const report = ["Local metadata only", ...Array.from({ length: 40 }, (_, index) => `event ${index}: read-only observation`), "FINAL_EVENT"].join("\n");
    try {
      const running = runOperatorReportTui("Recent telemetry", report, { renderer: ui.renderer });
      const first = await ui.waitForFrame((value) => value.includes("Local metadata only"));
      expect(first).toContain("Enter/Esc/q returns to setup");
      expect(first).not.toContain("FINAL_EVENT");
      ui.mockInput.pressKey("END");
      const last = await ui.waitForFrame((value) => value.includes("FINAL_EVENT"));
      expect(last).toContain("Read-only observation; no repair or activation performed.");
      expect(last).toContain("Enter/Esc/q returns to setup");
      ui.mockInput.pressEscape();
      expect(await running).toBeUndefined();
    } finally { ui.renderer.destroy(); }
  }, 10_000);
});

describe("guided wizard inspection handoff", () => {
  test.each([{ key: "d", inspection: "health" }, { key: "l", inspection: "logs" }] as const)(
    "80x24 $inspection shortcut preserves projects and the current step without saving",
    async ({ key, inspection }) => {
      const ui = await createTestRenderer({ width: 80, height: 24 });
      const events: OperatorEventInput[] = [];
      const before = JSON.stringify({ plan, existing });
      try {
        const running = runOnboardingTui(plan, {
          initialStep: "projects", selectedCandidateIds: ["project.pending"], existingProjectCapsules: existing,
          allowProjectCapsuleSave: true, allowInspection: true, createRenderer: async () => ui.renderer,
          onEvent: (event) => events.push(event),
        });
        const frame = await ui.waitForFrame((value) => value.includes("Step 2/7: Projects"));
        expect(frame).toContain("1 pending");
        expect(frame).toContain("d health");
        expect(frame).toContain("l logs");
        ui.mockInput.pressKey(key);
        const result = await running;
        expect(result).toMatchObject({
          confirmed: false, save_project_capsules: false, inspection_requested: inspection,
          resume_step: "projects", selected_candidate_ids: ["project.pending"], selected_module_ids: ["provider.9router"],
        });
        expect(result.project_capsules).toEqual(existing);
        expect(result).not.toHaveProperty("confirmed_at");
        expect(events).toContainEqual({ event_type: "action", surface: "tui", step: "projects", action_kind: inspection, outcome: "requested" });
        expect(JSON.stringify({ plan, existing })).toBe(before);
      } finally { ui.renderer.destroy(); }
    }, 10_000,
  );

  test("inspection shortcuts remain inert when inspection is not enabled", () => {
    const options = { initialStep: "projects" as const, selectedCandidateIds: ["project.pending"] };
    const state = createOnboardingWizardState(plan, options);
    for (const key of ["d", "l"]) {
      const transition = handleOnboardingWizardKey(plan, state, options, key, "continue");
      expect(transition.state).toBe(state);
      expect(transition.effect).toBeUndefined();
    }
  });
});
