import { describe, expect, test } from "bun:test";

import manifest from "./omniroute-portfolios.json";
import phaseComboMap from "./phase-combo-map.json";
import { resolvePortfolio } from "./omniroute-portfolios";

const expectedMappings = {
  fast: "noesis-fast",
  "long-horizon": "noesis-build",
  reasoning: "noesis-observe",
  validation: "noesis-verify",
  creative: "noesis-creative",
  balanced: "noesis-fast",
} as const;

describe("resolvePortfolio", () => {
  test("maps every shared classifier task type to its named portfolio", () => {
    const catalog = [...new Set(Object.values(expectedMappings))];

    for (const [taskType, expectedPortfolio] of Object.entries(expectedMappings)) {
      expect(resolvePortfolio(taskType, catalog)).toEqual({
        task_type: taskType,
        requested_portfolio: expectedPortfolio,
        selected_model: expectedPortfolio,
        source: "portfolio",
        enforcement: "shadow",
      });
    }
  });

  test("uses the compatibility combo when a named portfolio is absent", () => {
    expect(resolvePortfolio("validation", ["temperance-coding"])).toEqual({
      task_type: "validation",
      requested_portfolio: "noesis-verify",
      selected_model: "temperance-coding",
      source: "compatibility",
      enforcement: "shadow",
    });
  });

  test("returns direct when neither named nor compatibility combo exists", () => {
    expect(resolvePortfolio("balanced", [])).toEqual({
      task_type: "balanced",
      requested_portfolio: "noesis-fast",
      selected_model: null,
      source: "direct",
      enforcement: "shadow",
    });
  });

  test("normalizes unknown types to balanced without classifying prompt text", () => {
    expect(resolvePortfolio("invent-a-new-type", ["noesis-fast"]).task_type).toBe("balanced");
  });

  test("keeps shared task portfolios contained by the canonical phase map", () => {
    const taskTypeToCombo = (phaseComboMap as { task_type_to_combo: Record<string, string> }).task_type_to_combo;
    expect(manifest.task_type_portfolios).toEqual(expectedMappings);
    for (const [taskType, portfolio] of Object.entries(expectedMappings)) {
      expect(taskTypeToCombo[taskType]).toBe(portfolio);
    }
  });

  test("manifest stores combo names but no provider or model membership", () => {
    expect(manifest.enforcement).toBe("shadow");
    expect(manifest.required_portfolios).toEqual([
      "noesis-full",
      "noesis-fast",
      "noesis-build",
      "noesis-observe",
      "noesis-verify",
      "noesis-creative",
    ]);
    expect(manifest.reserved_portfolios).toEqual([
      "noesis-swarm",
      "noesis-vision",
      "noesis-write",
      "noesis-write-critique",
      "noesis-research",
      "noesis-media",
      "noesis-full",
      "noesis-free-burst",
      "noesis-review",
    ]);
    expect(JSON.stringify(manifest)).not.toMatch(/provider|members|targets/);
  });
});
