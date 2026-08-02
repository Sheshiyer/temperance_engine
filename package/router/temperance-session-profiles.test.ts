import { describe, expect, test } from "bun:test";

import {
  CANDIDATE_ONLY_ALIAS,
  CURATED_OPENCODE_ALIASES,
  REQUIRED_HELPER_MODELS,
  REQUIRED_PROFILE_MODELS,
  sessionProfileManifest,
  validateSessionProfileManifest,
  validateWorkerTierTransition,
  type SessionProfileManifest,
} from "./temperance-session-profiles";

function copyManifest(): SessionProfileManifest {
  return structuredClone(sessionProfileManifest);
}

describe("Temperance session profile manifest", () => {
  test("accepts the governed manifest and keeps capability separate from readiness", () => {
    expect(validateSessionProfileManifest(sessionProfileManifest)).toEqual({
      valid: true,
      errors: [],
    });
    expect(Object.keys(sessionProfileManifest.capability_tiers)).toEqual(["S", "A", "B"]);
    expect(Object.keys(sessionProfileManifest.fallback_readiness)).toEqual([
      "ready",
      "degraded",
      "candidate",
    ]);
    expect(sessionProfileManifest.capability_tiers).not.toBe(
      sessionProfileManifest.fallback_readiness,
    );
  });

  test("pins the required profiles and helper agents", () => {
    expect(
      Object.fromEntries(
        Object.entries(sessionProfileManifest.profiles).map(([name, profile]) => [
          name,
          profile.default_model,
        ]),
      ),
    ).toEqual(REQUIRED_PROFILE_MODELS);
    expect(
      Object.fromEntries(
        Object.entries(sessionProfileManifest.helper_agents).map(([name, helper]) => [
          name,
          helper.default_model,
        ]),
      ),
    ).toEqual(REQUIRED_HELPER_MODELS);
  });

  test("rejects any silent S-tier algorithm downgrade", () => {
    const manifest = copyManifest();
    manifest.profiles["temperance-algorithm"].fallback_models = ["omniroute/te-build"];
    manifest.profiles["temperance-algorithm"].allow_silent_downgrade = true;

    const result = validateSessionProfileManifest(manifest);
    expect(result.valid).toBeFalse();
    expect(result.errors).toContain(
      "profile-silent-downgrade-forbidden:temperance-algorithm",
    );
    expect(result.errors).toContain("algorithm-profile-fallback-must-be-explicit-continuity");
  });

  test("rejects candidate-only aliases in defaults and fallbacks", () => {
    const defaultManifest = copyManifest();
    defaultManifest.profiles["temperance-native"].default_model = CANDIDATE_ONLY_ALIAS;
    const defaultResult = validateSessionProfileManifest(defaultManifest);
    expect(defaultResult.valid).toBeFalse();
    expect(
      defaultResult.errors.some((error) =>
        error.startsWith("candidate-only-alias-in-operational-path:profile:temperance-native:default")
      ),
    ).toBeTrue();

    const fallbackManifest = copyManifest();
    fallbackManifest.profiles["temperance-continuity"].fallback_models = [
      CANDIDATE_ONLY_ALIAS,
    ];
    const fallbackResult = validateSessionProfileManifest(fallbackManifest);
    expect(fallbackResult.valid).toBeFalse();
    expect(
      fallbackResult.errors.some((error) =>
        error.startsWith(
          "candidate-only-alias-in-operational-path:profile:temperance-continuity:fallback",
        )
      ),
    ).toBeTrue();
  });

  test("rejects invalid fallback/escalation transitions and invalid depth", () => {
    const manifest = copyManifest();
    manifest.max_subagent_depth = 2;
    manifest.tier_policy.fallback_transitions = [
      { from: "S", to: "A", requires_log: true },
    ];
    manifest.tier_policy.worker.escalation_edges = [
      { from: "A", to: "B" },
      { from: "A", to: "S" },
    ];

    const result = validateSessionProfileManifest(manifest);
    expect(result.valid).toBeFalse();
    expect(result.errors).toContain("max-subagent-depth-invalid");
    expect(result.errors).toContain("fallback-tier-transition-not-allowlisted:S:A");
    expect(result.errors).toContain("worker-escalation-tier-transition-invalid:A:B");
  });

  test("rejects aliases without finite context/output limits", () => {
    const manifest = copyManifest();
    delete (manifest.aliases[0] as { limits?: unknown }).limits;
    manifest.aliases[1].limits.output = Number.POSITIVE_INFINITY;

    const result = validateSessionProfileManifest(manifest);
    expect(result.valid).toBeFalse();
    expect(result.errors).toContain("alias-limits-missing:temperance/temperance-auto");
    expect(result.errors).toContain("alias-limit-invalid:omniroute/te-fast:output");
  });

  test("requires content, tool, health, and receipt evidence before promotion", () => {
    const manifest = copyManifest();
    manifest.models["omniroute/te-algorithm"].promotion.evidence.tool = null;
    delete (
      manifest.models["omniroute/te-build"].promotion.evidence as {
        receipt?: string | null;
      }
    ).receipt;

    const result = validateSessionProfileManifest(manifest);
    expect(result.valid).toBeFalse();
    expect(result.errors).toContain(
      "model-promotion-evidence-missing:omniroute/te-algorithm:tool",
    );
    expect(result.errors).toContain(
      "model-promotion-evidence-field-missing:omniroute/te-build:receipt",
    );
  });

  test("detects required failure-domain independence collisions", () => {
    const manifest = copyManifest();
    manifest.models["omniroute/te-build"].failure_domain =
      manifest.models["omniroute/te-algorithm"].failure_domain;

    const result = validateSessionProfileManifest(manifest);
    expect(result.valid).toBeFalse();
    expect(result.errors).toContain(
      "failure-domain-collision:algorithm-continuity:codex-sol-oauth",
    );
  });

  test("fails closed on unresolved models and providers", () => {
    const manifest = copyManifest();
    manifest.aliases[0].model = "temperance/missing";
    manifest.models["omniroute/te-fast"].provider = "missing-provider";

    const result = validateSessionProfileManifest(manifest);
    expect(result.valid).toBeFalse();
    expect(result.errors).toContain(
      "alias-model-unresolved:temperance/temperance-auto:temperance/missing",
    );
    expect(result.errors).toContain(
      "model-provider-unresolved:omniroute/te-fast:missing-provider",
    );
  });

  test("exposes exactly the fourteen curated aliases and keeps orchestrate candidate-only", () => {
    expect(sessionProfileManifest.aliases.map(({ id }) => id)).toEqual(
      CURATED_OPENCODE_ALIASES,
    );
    expect(sessionProfileManifest.aliases).toHaveLength(14);
    expect(sessionProfileManifest.aliases.map(({ id }) => id)).not.toContain(
      CANDIDATE_ONLY_ALIAS,
    );
    expect(sessionProfileManifest.candidate_aliases).toEqual([
      expect.objectContaining({ id: CANDIDATE_ONLY_ALIAS, status: "candidate-only" }),
    ]);

    const manifest = copyManifest();
    manifest.aliases.pop();
    const result = validateSessionProfileManifest(manifest);
    expect(result.valid).toBeFalse();
    expect(result.errors).toContain("curated-alias-set-mismatch");
  });

  test("keeps new provider routes candidate-only", () => {
    for (const modelId of [
      "agy/gemini-3.5-flash-low",
      "ollama-cloud/qwen3.5:397b",
      "opencode-zen/claude-sonnet-4-6",
    ]) {
      expect(sessionProfileManifest.models[modelId]).toMatchObject({
        fallback_readiness: "candidate",
        promotion: { state: "candidate" },
      });
      expect(sessionProfileManifest.aliases.map(({ model }) => model)).not.toContain(modelId);
    }
  });

  test("allows only B to A to S worker escalation and rejects same-task downgrade", () => {
    expect(validateWorkerTierTransition("B", "A", true)).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateWorkerTierTransition("A", "S", true)).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateWorkerTierTransition("B", "S", true)).toEqual({
      valid: false,
      errors: ["worker-escalation-edge-not-allowed:B:S"],
    });
    expect(validateWorkerTierTransition("S", "A", true)).toEqual({
      valid: false,
      errors: ["worker-downgrade-within-task-rejected:S:A"],
    });
    expect(validateWorkerTierTransition("S", "A", false)).toEqual({
      valid: true,
      errors: [],
    });
  });
});
