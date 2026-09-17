import { describe, expect, test } from "bun:test";

import {
  NINE_ROUTER_PROVIDER_CAPABILITIES,
  createNineRouterRoutingSurface,
} from "../src/onboarding/nine-router-provider-capabilities.ts";

describe("version-bound 9router provider capabilities", () => {
  test("maps every exact 0.5.75 built-in provider without claiming model authority", () => {
    expect(NINE_ROUTER_PROVIDER_CAPABILITIES.map(({ id }) => id)).toEqual([
      "claude", "codex", "gemini-cli", "github", "antigravity", "iflow", "qwen", "kiro",
      "openrouter", "glm", "minimax", "kimi", "openai", "anthropic", "gemini",
    ]);
    expect(NINE_ROUTER_PROVIDER_CAPABILITIES.filter(({ auth_kind }) => auth_kind === "oauth-device-code").map(({ id }) => id)).toEqual(["github", "qwen", "kiro"]);
    expect(JSON.stringify(NINE_ROUTER_PROVIDER_CAPABILITIES)).not.toContain("model");
  });

  test("marks connected providers while holding unresolved authentication dependencies", () => {
    const surface = createNineRouterRoutingSurface({
      routerVersion: "0.5.75",
      requiredAliases: ["noesis-plan"],
      catalog: {
        providers: [{ id: "cx-1", name: "Codex", provider: "codex", active: true }],
        combos: [],
      },
      availableModels: [{ id: "cx/gpt-codex", owner: "cx", kind: "provider" }],
      declaredSecretReferenceIds: ["PROVIDER_API_KEY"],
    });
    expect(surface.provider_options.find(({ id }) => id === "codex")).toMatchObject({ state: "connected", connection_ids: ["cx-1"] });
    expect(surface.provider_options.find(({ id }) => id === "openai")).toMatchObject({
      state: "held", hold_reason: "PROVIDER_CREDENTIAL_REFERENCE_SELECTION_REQUIRED",
    });
    expect(surface.provider_options.find(({ id }) => id === "claude")).toMatchObject({
      state: "held", hold_reason: "NINE_ROUTER_OAUTH_REQUIRED",
    });
    expect(surface.alias_seats).toEqual([{ alias: "noesis-plan", selected_model_ids: [], state: "unseated" }]);
    expect(surface.live_model_count).toBe(1);
  });

  test("fails closed across router-version drift and an empty live catalog", () => {
    const drifted = createNineRouterRoutingSurface({
      routerVersion: "0.5.76",
      requiredAliases: ["noesis-build"],
      catalog: {
        providers: [{ id: "cx-1", name: "Codex", provider: "codex", active: true }],
        combos: [],
      },
      availableModels: [{ id: "cx/gpt-codex", owner: "cx", kind: "provider" }],
    });
    expect(drifted.compatible).toBe(false);
    expect(drifted.provider_options.every(({ hold_reason }) => hold_reason === "NINE_ROUTER_PROVIDER_CATALOG_VERSION_MISMATCH")).toBe(true);
    expect(drifted.alias_seats).toEqual([{
      alias: "noesis-build", selected_model_ids: [], state: "held", hold_reason: "LIVE_PROVIDER_MODELS_UNAVAILABLE",
    }]);
    expect(drifted.live_model_count).toBe(0);
  });

  test("keeps portable-core onboarding valid before any semantic alias is selected", () => {
    const surface = createNineRouterRoutingSurface({
      routerVersion: "0.5.75",
      requiredAliases: [],
      availableModels: [{ id: "cx/gpt-codex", owner: "cx", kind: "provider" }],
    });
    expect(surface.alias_seats).toEqual([]);
    expect(surface.live_model_count).toBe(1);
    expect(surface.provider_options).toHaveLength(15);
  });
});
