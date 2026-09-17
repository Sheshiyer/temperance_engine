import { describe, expect, test } from "bun:test";

import { createNineRouterSeatingDraft, toggleNineRouterSeatModel } from "../src/onboarding/nine-router-seating.ts";
import { canConfirmNineRouterSeating, createNineRouterSeatingTuiView } from "../src/onboarding/nine-router-seating-tui.ts";

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
