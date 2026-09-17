import { describe, expect, test } from "bun:test";

import type { NineRouterAvailableModel } from "../src/onboarding/nine-router-api.ts";
import {
  NineRouterSeatingError,
  compileNineRouterGuidedSetup,
  compileNineRouterSeatCombos,
  createNineRouterSeatingDraft,
  moveNineRouterSeatModel,
  toggleNineRouterSeatModel,
} from "../src/onboarding/nine-router-seating.ts";

const aliases = [
  "noesis-orchestrator",
  "noesis-observe",
  "noesis-plan",
  "noesis-build",
  "noesis-execute",
  "noesis-verify",
];

const liveModels: NineRouterAvailableModel[] = [
  { id: "cx/gpt-codex", owner: "cx", kind: "provider" },
  { id: "noesis-legacy", owner: "combo", kind: "combo" },
  { id: "cc/claude-sonnet", owner: "cc", kind: "provider" },
  { id: "gemini/gemini-flash", owner: "gemini", kind: "provider" },
];

describe("9router semantic seat drafting", () => {
  test("derives provider-only dropdown choices from the live catalog", () => {
    const draft = createNineRouterSeatingDraft(aliases, liveModels);
    expect(draft.choices).toEqual([
      { id: "cc/claude-sonnet", owner: "cc" },
      { id: "cx/gpt-codex", owner: "cx" },
      { id: "gemini/gemini-flash", owner: "gemini" },
    ]);
    expect(draft.seats.map(({ alias, state, selected_model_ids }) => ({ alias, state, selected_model_ids }))).toEqual(
      aliases.map((alias) => ({ alias, state: "unseated", selected_model_ids: [] })),
    );
    expect(JSON.stringify(draft)).not.toContain("noesis-legacy");
  });

  test("holds every alias when providers expose no live model choices", () => {
    const draft = createNineRouterSeatingDraft(aliases, []);
    expect(draft.seats.every(({ state, hold_reason }) => state === "held" && hold_reason === "LIVE_PROVIDER_MODELS_UNAVAILABLE")).toBe(true);
    expect(() => compileNineRouterSeatCombos(draft)).toThrow("NINE_ROUTER_SEATING_INCOMPLETE");
  });

  test("selects, orders, reorders, and removes models immutably", () => {
    const original = createNineRouterSeatingDraft(["noesis-build"], liveModels);
    const one = toggleNineRouterSeatModel(original, "noesis-build", "cx/gpt-codex");
    const two = toggleNineRouterSeatModel(one, "noesis-build", "cc/claude-sonnet");
    const reordered = moveNineRouterSeatModel(two, "noesis-build", "cc/claude-sonnet", -1);
    expect(original.seats[0]?.selected_model_ids).toEqual([]);
    expect(two.seats[0]).toMatchObject({ state: "ready", selected_model_ids: ["cx/gpt-codex", "cc/claude-sonnet"] });
    expect(compileNineRouterSeatCombos(reordered)).toEqual([{
      alias: "noesis-build",
      models: ["cc/claude-sonnet", "cx/gpt-codex"],
    }]);
    expect(toggleNineRouterSeatModel(reordered, "noesis-build", "cc/claude-sonnet").seats[0]).toMatchObject({
      state: "ready", selected_model_ids: ["cx/gpt-codex"],
    });
  });

  test("validates initial selections against exact live provider identifiers", () => {
    const draft = createNineRouterSeatingDraft(["noesis-plan"], liveModels, {
      "noesis-plan": ["gemini/gemini-flash", "cc/claude-sonnet"],
    });
    expect(compileNineRouterSeatCombos(draft)).toEqual([{
      alias: "noesis-plan",
      models: ["gemini/gemini-flash", "cc/claude-sonnet"],
    }]);
    expect(() => createNineRouterSeatingDraft(["noesis-plan"], liveModels, {
      "noesis-plan": ["noesis-legacy"],
    })).toThrow("NINE_ROUTER_SEATING_MODEL_UNAVAILABLE");
  });

  test("compiles selected seats with provider and gateway intent into the reviewed setup", () => {
    let draft = createNineRouterSeatingDraft(["noesis-build"], liveModels);
    draft = toggleNineRouterSeatModel(draft, "noesis-build", "cx/gpt-codex");
    expect(compileNineRouterGuidedSetup({
      schema: "temperance.9router-setup-intent.v1",
      version: { major: 1, minor: 0 },
      providers: [{ selection_id: "codex", provider: "cx", connection_name: "Codex", credential_reference_id: "PROVIDER_CODEX" }],
      gateway_key: { name: "Temperance", secret_reference_id: "NINE_ROUTER_GATEWAY_KEY" },
    }, draft)).toEqual({
      schema: "temperance.9router-guided-setup.v1",
      version: { major: 1, minor: 0 },
      providers: [{ selection_id: "codex", provider: "cx", connection_name: "Codex", credential_reference_id: "PROVIDER_CODEX" }],
      combos: [{ alias: "noesis-build", models: ["cx/gpt-codex"] }],
      required_aliases: ["noesis-build"],
      gateway_key: { name: "Temperance", secret_reference_id: "NINE_ROUTER_GATEWAY_KEY" },
    });
  });

  test("rejects ambiguous, duplicate, malformed, and undeclared inputs", () => {
    expect(() => createNineRouterSeatingDraft(["Noesis Build"], liveModels)).toThrow(NineRouterSeatingError);
    expect(() => createNineRouterSeatingDraft(["noesis-build", "noesis-build"], liveModels)).toThrow("NINE_ROUTER_SEATING_ALIAS_DUPLICATE");
    expect(() => createNineRouterSeatingDraft(["noesis-build"], [liveModels[0]!, liveModels[0]!])).toThrow("NINE_ROUTER_SEATING_MODEL_DUPLICATE");
    expect(() => createNineRouterSeatingDraft(["noesis-build"], [{ id: "bad\nmodel", owner: "cx", kind: "provider" }])).toThrow("NINE_ROUTER_SEATING_MODEL_INVALID");
    const draft = createNineRouterSeatingDraft(["noesis-build"], liveModels);
    expect(() => toggleNineRouterSeatModel(draft, "noesis-plan", "cx/gpt-codex")).toThrow("NINE_ROUTER_SEATING_ALIAS_UNKNOWN");
    expect(() => toggleNineRouterSeatModel(draft, "noesis-build", "noesis-legacy")).toThrow("NINE_ROUTER_SEATING_MODEL_UNAVAILABLE");
  });
});
