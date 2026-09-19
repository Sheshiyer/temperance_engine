import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { OnboardingPlanV1 } from "../src/onboarding/contracts.ts";
import { calculateOnboardingPlanDigest } from "../src/onboarding/planner.ts";
import { advanceNineRouterSetupReview, createNineRouterSetupReviewOptions, nineRouterSetupReviewHolds, runNineRouterSetupReviewTui, type NineRouterSetupReviewState } from "../src/onboarding/nine-router-setup-review-tui.ts";

function plan(overrides: Partial<Omit<OnboardingPlanV1, "generated_at" | "plan_digest">> = {}): OnboardingPlanV1 {
  const base: Omit<OnboardingPlanV1, "generated_at" | "plan_digest"> = {
    schema: "temperance.onboarding.plan.v1", version: { major: 1, minor: 0 }, profile_id: "fixture", dry_run: false, operating_mode: "ready", install_order: ["provider.9router"],
    modules: [{ id: "provider.9router", title: "9Router", requested: true, status: "eligible", holds: [], guided_installs: [], advisories: [] }],
    configuration_inputs: [{ id: "9router-guided-setup", digest: `sha256:${"a".repeat(64)}`, details: ["combo custom-plan: [\"provider/model\"]", "gateway key: Keychain reference only", "runtime health: http://127.0.0.1:20128"] }],
    ...overrides,
  };
  return { ...base, generated_at: "2026-09-19T00:00:00.000Z", plan_digest: calculateOnboardingPlanDigest(base) };
}
const state = (value: OnboardingPlanV1): NineRouterSetupReviewState => ({ status: "reviewing", confirmed: false, plan_digest: value.plan_digest });

describe("9Router final exact-plan review", () => {
  test("shows every configuration detail and exact digest, followed by explicit final actions", () => {
    const value = plan();
    const rows = createNineRouterSetupReviewOptions(value);
    expect(rows.slice(-2).map(row => row.value)).toEqual(["apply", "cancel"]);
    expect(rows.slice(-2).map(row => row.name)).toEqual(["Apply 9Router", "Cancel — return without applying"]);
    const text = rows.map(row => row.name).join("");
    expect(text).toContain(value.plan_digest);
    for (const detail of value.configuration_inputs![0]!.details) expect(text).toContain(detail);
    expect(rows.every(row => Array.from(row.name).length <= 72)).toBe(true);
  });

  test("confirms once with exact digest and cancellation never authorizes", () => {
    const value = plan();
    const initial = state(value);
    expect(advanceNineRouterSetupReview(value, initial, "detail")).toBe(initial);
    const confirmed = advanceNineRouterSetupReview(value, initial, "apply", () => new Date("2026-09-19T01:00:00.000Z"));
    expect(confirmed).toEqual({ status: "confirmed", confirmed: true, plan_digest: value.plan_digest, confirmed_at: "2026-09-19T01:00:00.000Z" });
    expect(advanceNineRouterSetupReview(value, confirmed, "apply")).toBe(confirmed);
    expect(advanceNineRouterSetupReview(value, initial, "cancel").confirmed).toBe(false);
  });

  test("refuses dry-run, blocked, degraded, wider scope, missing input, and changed digest", () => {
    const invalid = [
      plan({ dry_run: true }), plan({ operating_mode: "blocked" }), plan({ operating_mode: "read-only-degraded" }),
      plan({ install_order: ["provider.9router", "delegate.hands"] }), plan({ configuration_inputs: [] }),
      plan({ modules: [] }), { ...plan(), profile_id: "changed-after-digest" },
    ];
    for (const value of invalid) {
      expect(nineRouterSetupReviewHolds(value).length).toBeGreaterThan(0);
      expect(advanceNineRouterSetupReview(value, state(value), "apply").confirmed).toBe(false);
      expect(createNineRouterSetupReviewOptions(value).at(-2)?.name).toContain("BLOCKED");
    }
  });

  test("real 80x24 review scrolls and y only confirms the final Apply row", async () => {
    const screen = await createTestRenderer({ width: 80, height: 24 });
    try {
      const value = plan();
      const outcome = runNineRouterSetupReviewTui(value, { renderer: screen.renderer, now: () => new Date("2026-09-19T01:00:00.000Z") });
      await screen.renderOnce();
      expect(screen.captureCharFrame()).toContain("Final configuration review");
      expect(screen.captureCharFrame()).toContain("Enter/y on Apply 9Router confirms once");
      screen.mockInput.pressKey("y"); // A detail row is not consent.
      await screen.renderOnce();
      expect(screen.captureCharFrame()).toContain("Final configuration review");
      screen.mockInput.pressKey("END");
      await screen.renderOnce();
      expect(screen.captureCharFrame()).toContain("Apply 9Router");
      expect(screen.captureCharFrame()).toContain("Cancel — return without applying");
      screen.mockInput.pressKey("y");
      expect(await outcome).toEqual({ confirmed: true, plan_digest: value.plan_digest, confirmed_at: "2026-09-19T01:00:00.000Z" });
    } finally { screen.renderer.destroy(); }
  });

  test("blocked terminal review ignores Enter on Apply and Escape returns no confirmation", async () => {
    const screen = await createTestRenderer({ width: 80, height: 24 });
    try {
      const value = plan({ dry_run: true });
      const outcome = runNineRouterSetupReviewTui(value, { renderer: screen.renderer });
      await screen.renderOnce();
      screen.mockInput.pressKey("END");
      screen.mockInput.pressEnter();
      await screen.renderOnce();
      expect(screen.captureCharFrame()).toContain("Apply 9Router — BLOCKED");
      screen.mockInput.pressEscape();
      expect(await outcome).toEqual({ confirmed: false, plan_digest: value.plan_digest });
    } finally { screen.renderer.destroy(); }
  });
});
