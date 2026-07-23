import { describe, expect, test } from "bun:test";

import { resolveWorkflow, workflowManifest, type PlannerQuotaState } from "./temperance-workflows";

const liveFleet = [
  "github/gpt-5.4",
  "codex/gpt-5.6-sol-max",
  "codex/gpt-5.6-terra",
  "command-code/deepseek/deepseek-v4-flash",
  "command-code/moonshotai/Kimi-K2.7-Code",
  "command-code/MiniMaxAI/MiniMax-M2.7",
  "nebius/moonshotai/Kimi-K2.6",
  "grok-cli/grok-build",
  "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
  "kimi-coding-apikey/k3",
];

function quota(providers: Record<string, { remaining: number | null; state?: string }>): PlannerQuotaState {
  return {
    threshold_percent: 30,
    providers: Object.fromEntries(
      Object.entries(providers).map(([id, { remaining, state }]) => [id, { remaining, state: state ?? "available" }]),
    ),
  };
}

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
      "nebius/moonshotai/Kimi-K2.6",
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

  test("planner resolution is unchanged and reports no substitutions with no quota state", () => {
    const resolution = resolveWorkflow("planner", liveFleet);
    expect(resolution.selected.map(({ model }) => model)).toEqual([
      "github/gpt-5.4",
      "codex/gpt-5.6-sol-max",
      "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
    ]);
    expect(resolution.substitutions).toEqual([]);
  });

  test("planner substitutes kimi-k3 for github alone when only github is below threshold", () => {
    const resolution = resolveWorkflow("planner", liveFleet, quota({
      github: { remaining: 22 },
      codex: { remaining: 95 },
      "kimi-coding-apikey": { remaining: 80 },
    }));
    expect(resolution.selected.map(({ model }) => model)).toEqual([
      "kimi-coding-apikey/k3",
      "codex/gpt-5.6-sol-max",
      "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
    ]);
    expect(resolution.substitutions).toEqual([
      { slot: "github", from: "github/gpt-5.4", to: "kimi-coding-apikey/k3", reason: "remaining 22% < 30%" },
    ]);
  });

  test("planner dedupes to a single kimi-k3 entry when both github and codex are below threshold", () => {
    const resolution = resolveWorkflow("planner", liveFleet, quota({
      github: { remaining: 15 },
      codex: { remaining: 10 },
      "kimi-coding-apikey": { remaining: 60 },
    }));
    expect(resolution.selected.map(({ model }) => model)).toEqual([
      "kimi-coding-apikey/k3",
      "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
    ]);
    expect(resolution.substitutions).toHaveLength(1);
    expect(resolution.substitutions?.[0].slot).toBe("github");
  });

  test("planner never substitutes when kimi's own quota is also below threshold", () => {
    const resolution = resolveWorkflow("planner", liveFleet, quota({
      github: { remaining: 15 },
      codex: { remaining: 95 },
      "kimi-coding-apikey": { remaining: 5 },
    }));
    expect(resolution.selected.map(({ model }) => model)).toEqual([
      "github/gpt-5.4",
      "codex/gpt-5.6-sol-max",
      "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
    ]);
    expect(resolution.substitutions).toEqual([]);
  });

  test("planner never substitutes the Nebius escalation fallback itself", () => {
    const resolution = resolveWorkflow("planner", liveFleet, quota({
      github: { remaining: 95 },
      codex: { remaining: 95 },
      "kimi-coding-apikey": { remaining: 95 },
      nebius: { remaining: 1 },
    }));
    expect(resolution.selected.map(({ model }) => model)).toContain("nebius/Qwen/Qwen3-235B-A22B-Instruct-2507");
    expect(resolution.substitutions).toEqual([]);
  });

  test("planner fails open (no substitution) when a provider is missing from quota data entirely", () => {
    const resolution = resolveWorkflow("planner", liveFleet, quota({
      codex: { remaining: 95 },
      "kimi-coding-apikey": { remaining: 80 },
    }));
    expect(resolution.selected.map(({ model }) => model)).toEqual([
      "github/gpt-5.4",
      "codex/gpt-5.6-sol-max",
      "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
    ]);
    expect(resolution.substitutions).toEqual([]);
  });

  test("planner treats a non-available state as below threshold regardless of remaining value", () => {
    const resolution = resolveWorkflow("planner", liveFleet, quota({
      github: { remaining: 99, state: "banned" },
      codex: { remaining: 95 },
      "kimi-coding-apikey": { remaining: 80 },
    }));
    expect(resolution.selected.map(({ model }) => model)).toEqual([
      "kimi-coding-apikey/k3",
      "codex/gpt-5.6-sol-max",
      "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
    ]);
  });
});
