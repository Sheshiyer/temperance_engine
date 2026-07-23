import { describe, expect, test } from "bun:test";

import { resolveWorkflow, workflowManifest } from "./temperance-workflows";

const liveFleet = [
  "github/gpt-5.4",
  "codex/gpt-5.6-sol-max",
  "codex/gpt-5.6-terra",
  "command-code/deepseek/deepseek-v4-flash",
  "command-code/moonshotai/Kimi-K2.7-Code",
  "command-code/MiniMaxAI/MiniMax-M2.7",
  "kimi/kimi-k2.6",
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
    expect(resolveWorkflow("writing", liveFleet).role).toBe("writing");
  });

  test("writing role drafts on te-write in the decided priority order", () => {
    const resolution = resolveWorkflow("writing", liveFleet);
    expect(resolution.portfolio).toBe("te-write");
    expect(resolution.selected.map(({ model }) => model)).toEqual([
      "command-code/MiniMaxAI/MiniMax-M2.7",
      "kimi/kimi-k2.6",
      "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
    ]);
    expect(resolution.native_providers).toEqual([]);
  });

  test("writing critique council mirrors the validation fusion shape and never drafts", () => {
    const resolution = resolveWorkflow("writing", liveFleet);
    expect(resolution.critique?.portfolio).toBe("te-write-critique");
    expect(resolution.critique?.judge_model).toBe("codex/gpt-5.6-terra");
    expect(resolution.critique?.selected.map(({ model }) => model)).toEqual([
      "github/gpt-5.4",
      "codex/gpt-5.6-terra",
      "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
    ]);
    expect(workflowManifest.writing.critique.strategy).toBe("fusion");
    expect(workflowManifest.writing.chat_combo_boundary).toMatch(/never drafts/i);
    expect(workflowManifest.writing.chat_combo_boundary).toMatch(/client-side/i);
  });

  test("writing workflow keeps image generation client-side and maps transmutation stages", () => {
    expect(workflowManifest.writing.skill).toBe("noesis-writer-skill");
    expect(workflowManifest.writing.workflow).toContain("plan-images-with-te-creative");
    expect(workflowManifest.writing.workflow).toContain("generate-images-client-side-brandmint-fal");
    const transmutation = workflowManifest.writing.transmutation_workflow.join(" ");
    for (const stage of ["nigredo", "albedo", "citrinitas", "rubedo"]) {
      expect(transmutation).toContain(stage);
    }
  });

  test("acp lane is declared but inactive", () => {
    expect(workflowManifest.writing.acp.status).toBe("declared-inactive");
    expect(workflowManifest.writing.acp.note).toMatch(/principal-bound/i);
  });
});
