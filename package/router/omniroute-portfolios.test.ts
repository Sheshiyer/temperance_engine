import { describe, expect, test } from "bun:test";

import manifest from "./omniroute-portfolios.json";
import { resolvePortfolio } from "./omniroute-portfolios";

const expectedMappings = {
  fast: "te-fast",
  "long-horizon": "te-build",
  reasoning: "te-reason",
  validation: "te-validate",
  creative: "te-creative",
  balanced: "te-build",
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
      requested_portfolio: "te-validate",
      selected_model: "temperance-coding",
      source: "compatibility",
      enforcement: "shadow",
    });
  });

  test("returns direct when neither named nor compatibility combo exists", () => {
    expect(resolvePortfolio("balanced", [])).toEqual({
      task_type: "balanced",
      requested_portfolio: "te-build",
      selected_model: null,
      source: "direct",
      enforcement: "shadow",
    });
  });

  test("normalizes unknown types to balanced without classifying prompt text", () => {
    expect(resolvePortfolio("invent-a-new-type", ["te-build"]).task_type).toBe("balanced");
  });

  test("manifest stores combo names but no provider or model membership", () => {
    expect(manifest.enforcement).toBe("shadow");
    expect(manifest.required_portfolios).toEqual(["te-fast", "te-build", "te-reason", "te-validate", "te-creative"]);
    expect(manifest.reserved_portfolios).toEqual(["te-batch", "te-vision"]);
    expect(JSON.stringify(manifest)).not.toMatch(/provider|members|targets/);
  });
});
