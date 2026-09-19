import { expect, test } from "bun:test";
import { loadSurfaceContract, validateSurfaceContract } from "./surface-convergence-contract.ts";

test("phase admission accepts a coherent non-personal alias namespace", () => {
  const loaded = loadSurfaceContract();
  if (!loaded.ok) throw new Error(loaded.reasonCode);
  const sources = JSON.parse(JSON.stringify(loaded.contract).replaceAll("noesis-", "work-"));
  sources.phaseComboMap.coordinator.provider = "9router";
  const result = validateSurfaceContract(sources);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.contract.phaseComboMap.coordinator.lane).toBe("work-orchestrator");
  sources.phaseComboMap.coordinator.lane = "../unsafe";
  expect(validateSurfaceContract(sources).ok).toBe(false);
});
