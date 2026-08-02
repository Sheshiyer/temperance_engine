import { describe, expect, test } from "bun:test";

import { resolveWorkflow, workflowManifest, type PlannerQuotaState } from "./temperance-workflows";

const liveFleet = [
  "github/gpt-5.4",
  "codex/gpt-5.6-sol-max",
  "codex/gpt-5.6-terra",
  "codex/gpt-5.3-codex-spark",
  "command-code/deepseek/deepseek-v4-flash",
  "command-code/moonshotai/Kimi-K2.7-Code",
  "command-code/MiniMaxAI/MiniMax-M2.7",
  "nebius/moonshotai/Kimi-K2.6",
  "grok-cli/grok-build",
  "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
  "kimi-coding-apikey/k3",
  "command-code/deepseek/deepseek-v4-pro",
  "opencode/deepseek-v4-flash-free",
  "command-code/poolside/laguna-s-2.1-free",
  "command-code/zai-org/GLM-5.2",
  "antigravity/claude-opus-4-6-thinking",
  "command-code/moonshotai/Kimi-K3",
  "trae/gpt-5.4",
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

  test("dispatch fleet round-robins Spark, Command Code, Kimi, Grok, and Nebius", () => {
    const resolution = resolveWorkflow("dispatch", liveFleet);
    expect(resolution.selected.map(({ provider }) => provider)).toEqual([
      "codex",
      "command-code",
      "command-code",
      "grok-cli",
      "nebius",
    ]);
    expect(workflowManifest.dispatch.strategy).toBe("round-robin");
    expect(resolution.selected[0]).toMatchObject({
      role: "spark-fast-worker",
      model: "codex/gpt-5.3-codex-spark",
      capability: "low-latency-targeted-coding",
      cost_posture: "separate-codex-spark-preview-rate-limit",
    });
    expect(workflowManifest.dispatch.direct_cli_fallbacks.map(({ backend }) => backend)).toEqual([
      "command-code",
      "kimi",
      "grok",
    ]);
  });

  test("dispatch omits Spark when its exact catalog identifier is unavailable", () => {
    const withoutSpark = liveFleet.filter((model) => model !== "codex/gpt-5.3-codex-spark");
    const resolution = resolveWorkflow("dispatch", withoutSpark);
    expect(resolution.selected.map(({ model }) => model)).not.toContain("codex/gpt-5.3-codex-spark");
    expect(resolution.omitted.map(({ model }) => model)).toContain("codex/gpt-5.3-codex-spark");
    expect(workflowManifest.dispatch.direct_cli_fallbacks.map(({ backend }) => backend)).toEqual([
      "command-code",
      "kimi",
      "grok",
    ]);
  });

  test("Spark remains scoped to dispatch rather than planning or validation roles", () => {
    const spark = "codex/gpt-5.3-codex-spark";
    expect(workflowManifest.planner.primary.model).not.toBe(spark);
    expect(workflowManifest.planner.escalation.map(({ model }) => model)).not.toContain(spark);
    expect(workflowManifest.creative.planner_models).not.toContain(spark);
    expect(workflowManifest.writing.drafting_models).not.toContain(spark);
    expect(workflowManifest.writing.critique.models).not.toContain(spark);
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

  test("bulk role resolves the zero-cost burst lane to its two live-catalog models", () => {
    const resolution = resolveWorkflow("bulk", liveFleet);
    expect(resolution.role).toBe("bulk");
    expect(resolution.portfolio).toBe("te-free-burst");
    expect(resolution.selected.map(({ model }) => model)).toEqual([
      "opencode/deepseek-v4-flash-free",
      "command-code/poolside/laguna-s-2.1-free",
    ]);
    expect(resolution.native_providers).toEqual([]);
  });

  test("bulk role omits its models when neither is in the live catalog", () => {
    const withoutBulkModels = liveFleet.filter(
      (model) => model !== "opencode/deepseek-v4-flash-free" && model !== "command-code/poolside/laguna-s-2.1-free",
    );
    const resolution = resolveWorkflow("bulk", withoutBulkModels);
    expect(resolution.selected).toEqual([]);
    expect(resolution.omitted.map(({ model }) => model)).toEqual([
      "opencode/deepseek-v4-flash-free",
      "command-code/poolside/laguna-s-2.1-free",
    ]);
    expect(resolution.source).toBe("direct");
  });

  test("review role resolves the code review lane to its three live-catalog models", () => {
    const resolution = resolveWorkflow("review", liveFleet);
    expect(resolution.role).toBe("review");
    expect(resolution.portfolio).toBe("te-review");
    expect(resolution.selected.map(({ model }) => model)).toEqual([
      "codex/gpt-5.6-sol-max",
      "trae/gpt-5.4",
      "command-code/zai-org/GLM-5.2",
    ]);
    expect(resolution.native_providers).toEqual([]);
  });

  test("review role omits its models when none is in the live catalog", () => {
    const withoutReviewModels = liveFleet.filter(
      (model) =>
        model !== "codex/gpt-5.6-sol-max" &&
        model !== "trae/gpt-5.4" &&
        model !== "command-code/zai-org/GLM-5.2",
    );
    const resolution = resolveWorkflow("review", withoutReviewModels);
    expect(resolution.selected).toEqual([]);
    expect(resolution.omitted.map(({ model }) => model)).toEqual([
      "codex/gpt-5.6-sol-max",
      "trae/gpt-5.4",
      "command-code/zai-org/GLM-5.2",
    ]);
    expect(resolution.source).toBe("direct");
  });

  test("swarm role resolves the S-tier swarm lane to its three live-catalog models", () => {
    const resolution = resolveWorkflow("swarm", liveFleet);
    expect(resolution.role).toBe("swarm");
    expect(resolution.portfolio).toBe("te-swarm-s");
    expect(resolution.selected.map(({ model }) => model)).toEqual([
      "antigravity/claude-opus-4-6-thinking",
      "kimi-coding-apikey/k3",
      "command-code/moonshotai/Kimi-K3",
    ]);
    expect(resolution.native_providers).toEqual([]);
  });

  test("swarm role omits its models when none is in the live catalog", () => {
    const withoutSwarmModels = liveFleet.filter(
      (model) =>
        model !== "antigravity/claude-opus-4-6-thinking" &&
        model !== "kimi-coding-apikey/k3" &&
        model !== "command-code/moonshotai/Kimi-K3",
    );
    const resolution = resolveWorkflow("swarm", withoutSwarmModels);
    expect(resolution.selected).toEqual([]);
    expect(resolution.omitted.map(({ model }) => model)).toEqual([
      "antigravity/claude-opus-4-6-thinking",
      "kimi-coding-apikey/k3",
      "command-code/moonshotai/Kimi-K3",
    ]);
    expect(resolution.source).toBe("direct");
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
    expect(workflowManifest.writing.chat_combo_boundary).toMatch(/never draft/i);
    expect(workflowManifest.writing.chat_combo_boundary).toMatch(/client-side/i);
  });

  test("writing workflow keeps image generation client-side and maps transmutation stages", () => {
    expect(workflowManifest.writing.skill).toBe("noesis-writer-skill");
    expect(workflowManifest.writing.workflow).toContain("plan-images-with-te-write-media");
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

  test("writing research council grounds claims via a distinct model panel and never drafts", () => {
    const resolution = resolveWorkflow("writing", liveFleet);
    expect(resolution.research?.portfolio).toBe("te-write-research");
    expect(resolution.research?.judge_model).toBe("codex/gpt-5.6-terra");
    expect(resolution.research?.selected.map(({ model }) => model)).toEqual([
      "command-code/deepseek/deepseek-v4-pro",
      "github/gpt-5.4",
      "codex/gpt-5.6-terra",
    ]);
    expect(workflowManifest.writing.research.strategy).toBe("fusion");
    expect(workflowManifest.writing.research.claim_modes).toContain("HOUSE-MODEL");
    expect(workflowManifest.writing.research.chat_combo_boundary).toMatch(/never drafts/i);
  });

  test("writing media planner writes text briefs only, distinct from te-creative", () => {
    const resolution = resolveWorkflow("writing", liveFleet);
    expect(resolution.media?.portfolio).toBe("te-write-media");
    expect(resolution.media?.selected.map(({ model }) => model)).toEqual([
      "github/gpt-5.4",
      "codex/gpt-5.6-sol-max",
      "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507",
    ]);
    expect(workflowManifest.writing.media.strategy).toBe("priority");
    expect(workflowManifest.writing.media.chat_combo_boundary).toMatch(/text only/i);
    expect(workflowManifest.writing.media.portfolio).not.toBe(workflowManifest.creative.portfolio);
  });

  test("writing workflow sequences research before drafting and media planning by name", () => {
    expect(workflowManifest.writing.workflow).toContain("ground-and-classify-claims-on-te-write-research");
    expect(workflowManifest.writing.workflow).toContain("plan-images-with-te-write-media");
    const researchIndex = workflowManifest.writing.workflow.indexOf("ground-and-classify-claims-on-te-write-research");
    const draftIndex = workflowManifest.writing.workflow.indexOf("draft-section-on-te-write");
    expect(researchIndex).toBeLessThan(draftIndex);
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
