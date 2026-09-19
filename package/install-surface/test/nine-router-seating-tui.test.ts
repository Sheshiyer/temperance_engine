import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";

import { createNineRouterSeatingDraft, toggleNineRouterSeatModel } from "../src/onboarding/nine-router-seating.ts";
import { advanceNineRouterSeatingFlow, canConfirmNineRouterSeating, createNineRouterSeatingTuiView, nineRouterSeatingFlowOptions, runNineRouterSeatingTui, type NineRouterSeatingFlowState } from "../src/onboarding/nine-router-seating-tui.ts";

const aliases = ["noesis-observe", "noesis-plan"];
const models = [
  { id: "cc/claude", owner: "cc", kind: "provider" as const },
  { id: "cx/codex", owner: "cx", kind: "provider" as const },
  { id: "existing-combo", owner: "combo", kind: "combo" as const },
];

describe("9router seating TUI projection", () => {
  test("renders every semantic alias and only live provider choices", () => {
    const draft = createNineRouterSeatingDraft(aliases, models);
    const view = createNineRouterSeatingTuiView(draft);
    expect(view.alias_options.map(({ value }) => value)).toEqual(aliases);
    expect(view.model_options.map(({ value }) => value)).toEqual(["cc/claude", "cx/codex"]);
    expect(view.detail).toContain("Only live provider models are selectable");
    expect(view.confirmable).toBe(false);
  });

  test("shows exact selection order and confirms only complete drafts", () => {
    let draft = createNineRouterSeatingDraft(aliases, models);
    draft = toggleNineRouterSeatModel(draft, "noesis-observe", "cx/codex");
    draft = toggleNineRouterSeatModel(draft, "noesis-observe", "cc/claude");
    let view = createNineRouterSeatingTuiView(draft, "noesis-observe");
    expect(view.model_options.map(({ name }) => name)).toEqual(["✓ 2. cc/claude", "✓ 1. cx/codex"]);
    expect(view.detail).toContain("1. cx/codex\n2. cc/claude");
    expect(canConfirmNineRouterSeating(draft)).toBe(false);
    draft = toggleNineRouterSeatModel(draft, "noesis-plan", "cc/claude");
    view = createNineRouterSeatingTuiView(draft, "noesis-plan");
    expect(view.confirmable).toBe(true);
    expect(canConfirmNineRouterSeating(draft)).toBe(true);
  });

  test("renders a dependency-smart hold when no provider models exist", () => {
    const view = createNineRouterSeatingTuiView(createNineRouterSeatingDraft(aliases, []));
    expect(view.alias_options[0]?.description).toBe("LIVE_PROVIDER_MODELS_UNAVAILABLE");
    expect(view.model_options).toEqual([]);
    expect(view.detail).toContain("Admit at least one provider");
    expect(view.confirmable).toBe(false);
  });
});

describe("9Router sequential seating", () => {
  const initial = (): NineRouterSeatingFlowState => ({ draft: createNineRouterSeatingDraft(aliases, models), alias_index: 0, status: "editing" });

  test("Continue requires a seat and advances one alias, never confirming all prematurely", () => {
    let state = initial();
    state = advanceNineRouterSeatingFlow(state, { kind: "continue" });
    expect(state.alias_index).toBe(0);
    expect(state.status).toBe("editing");
    expect(state.notice).toContain("Choose at least one");
    state = advanceNineRouterSeatingFlow(state, { kind: "model", id: "cc/claude" });
    expect(state.status).toBe("editing");
    state = advanceNineRouterSeatingFlow(state, { kind: "continue" });
    expect(state.alias_index).toBe(1);
    expect(state.status).toBe("editing");
    state = advanceNineRouterSeatingFlow(state, { kind: "model", id: "cx/codex" });
    state = advanceNineRouterSeatingFlow(state, { kind: "continue" });
    expect(state.status).toBe("confirmed");
    expect(advanceNineRouterSeatingFlow(state, { kind: "back" })).toBe(state);
  });

  test("Back preserves selections; visible ordering actions change only selected priority", () => {
    let state = initial();
    state = advanceNineRouterSeatingFlow(state, { kind: "model", id: "cc/claude" });
    state = advanceNineRouterSeatingFlow(state, { kind: "model", id: "cx/codex" });
    state = advanceNineRouterSeatingFlow(state, { kind: "move", direction: -1 });
    expect(state.draft.seats[0]?.selected_model_ids).toEqual(["cx/codex", "cc/claude"]);
    state = advanceNineRouterSeatingFlow(state, { kind: "continue" });
    state = advanceNineRouterSeatingFlow(state, { kind: "back" });
    expect(state.alias_index).toBe(0);
    expect(state.draft.seats[0]?.selected_model_ids).toEqual(["cx/codex", "cc/claude"]);
    const names = nineRouterSeatingFlowOptions(state).map(option => option.name).join("\n");
    expect(names).toContain("Continue to next alias");
    expect(names).toContain("Back to provider setup");
    expect(names).toContain("Move highlighted model earlier");
    expect(advanceNineRouterSeatingFlow(state, { kind: "back" }).status).toBe("cancelled");
  });

  test("real keyboard flow fits 80x24 and Enter toggles then continues sequentially", async () => {
    const screen = await createTestRenderer({ width: 80, height: 24 });
    try {
      const result = runNineRouterSeatingTui({ requiredAliases: aliases, availableModels: models, renderer: screen.renderer, now: () => new Date("2026-09-19T00:00:00.000Z") });
      await screen.renderOnce();
      let frame = screen.captureCharFrame();
      expect(frame).toContain("Alias 1/2");
      expect(frame).toContain("Enter toggles model or activates action");
      expect(frame).toContain("Back to provider setup");
      expect(frame).not.toContain("switch pane");
      screen.mockInput.pressEnter();
      await screen.renderOnce();
      expect(screen.captureCharFrame()).toContain("✓ 1. cc/claude");
      screen.mockInput.pressKey("HOME");
      screen.mockInput.pressEnter();
      await screen.renderOnce();
      frame = screen.captureCharFrame();
      expect(frame).toContain("Alias 2/2");
      expect(frame).toContain("Continue to final 9Router review");
      screen.mockInput.pressEnter();
      screen.mockInput.pressKey("HOME");
      screen.mockInput.pressEnter();
      expect(await result).toEqual({ confirmed: true, confirmed_at: "2026-09-19T00:00:00.000Z", combos: aliases.map(alias => ({ alias, models: ["cc/claude"] })) });
    } finally { screen.renderer.destroy(); }
  });
});
