import { describe, expect, test } from "bun:test";

import { resolveWorkflow, workflowManifest } from "./temperance-workflows";

const liveFleet = [
  "github/gpt-5.4",
  "codex/gpt-5.6-sol-max",
  "command-code/deepseek/deepseek-v4-flash",
  "command-code/moonshotai/Kimi-K2.7-Code",
  "grok-cli/grok-build",
  "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
];

describe("Temperance workflow roles", () => {
  test("keeps GitHub as planner primary and Codex as escalation", () => {
    expect(workflowManifest.planner.primary.model).toBe("github/gpt-5.4");
    expect(workflowManifest.planner.escalation.map(({ model }) => model)).toContain(
      "codex/gpt-5.6-sol-max",
    );
    expect(resolveWorkflow("planner", liveFleet).selected.map(({ model }) => model)).toEqual([
      "github/gpt-5.4",
      "codex/gpt-5.6-sol-max",
      "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
    ]);
  });

  test("dispatch fleet contains Command Code, Kimi, Grok, and Nebius roles", () => {
    const resolution = resolveWorkflow("dispatch", liveFleet);
    expect(resolution.selected.map(({ provider }) => provider)).toEqual([
      "command-code",
      "command-code",
      "grok-cli",
      "nebius",
    ]);
    expect(workflowManifest.dispatch.direct_cli_fallbacks.map(({ backend }) => backend)).toEqual([
      "command-code",
      "kimi",
      "grok",
    ]);
  });

  test("creative role retains native media providers outside chat combos", () => {
    const resolution = resolveWorkflow("creative", liveFleet);
    expect(resolution.portfolio).toBe("te-creative");
    expect(resolution.native_providers).toEqual(["elevenlabs", "runwayml"]);
    expect(workflowManifest.creative.native_providers.map(({ endpoint }) => endpoint)).toEqual([
      "/v1/audio/speech",
      "/v1/videos/generations",
    ]);
    expect(workflowManifest.creative.chat_combo_boundary).toMatch(/media/i);
  });

  test("unknown role fails safe into dispatch rather than classifying prompts", () => {
    expect(resolveWorkflow("new-task-type", liveFleet).role).toBe("dispatch");
  });
});
