import type { NineRouterAvailableModel, NineRouterCatalogSnapshot } from "./nine-router-api.ts";
import { createNineRouterSeatingDraft, type NineRouterAliasSeat } from "./nine-router-seating.ts";

export const NINE_ROUTER_PROVIDER_CAPABILITY_VERSION = "0.5.75" as const;

export type NineRouterProviderAuthKind = "api-key" | "oauth-authorization-code" | "oauth-device-code";

export interface NineRouterProviderCapability {
  id: string;
  alias: string;
  display_name: string;
  auth_kind: NineRouterProviderAuthKind;
}

export interface NineRouterProviderOption extends NineRouterProviderCapability {
  preference: "recommended" | "optional" | "available";
  state: "connected" | "held";
  connection_ids: string[];
  hold_reason?:
    | "NINE_ROUTER_PROVIDER_CATALOG_VERSION_MISMATCH"
    | "PROVIDER_CREDENTIAL_REFERENCE_UNDECLARED"
    | "PROVIDER_CREDENTIAL_REFERENCE_SELECTION_REQUIRED"
    | "NINE_ROUTER_OAUTH_REQUIRED"
    | "NINE_ROUTER_DEVICE_AUTH_REQUIRED";
  guidance: string[];
}

export interface NineRouterRoutingSurface {
  router_version: string;
  compatible: boolean;
  provider_source: "temperance-versioned-9router-adapter";
  provider_options: NineRouterProviderOption[];
  alias_seats: NineRouterAliasSeat[];
  live_model_count: number;
}

/**
 * This is a version-bound adapter capability table, not a model catalog.
 * Concrete model availability remains exclusively owned by live /v1/models.
 */
export const NINE_ROUTER_PROVIDER_CAPABILITIES: readonly NineRouterProviderCapability[] = Object.freeze([
  { id: "claude", alias: "cc", display_name: "Claude Code", auth_kind: "oauth-authorization-code" },
  { id: "codex", alias: "cx", display_name: "OpenAI Codex", auth_kind: "oauth-authorization-code" },
  { id: "gemini-cli", alias: "gc", display_name: "Gemini CLI", auth_kind: "oauth-authorization-code" },
  { id: "github", alias: "gh", display_name: "GitHub Copilot", auth_kind: "oauth-device-code" },
  { id: "antigravity", alias: "ag", display_name: "Antigravity", auth_kind: "oauth-authorization-code" },
  { id: "iflow", alias: "if", display_name: "iFlow AI", auth_kind: "oauth-authorization-code" },
  { id: "qwen", alias: "qw", display_name: "Qwen Code", auth_kind: "oauth-device-code" },
  { id: "kiro", alias: "kr", display_name: "Kiro AI", auth_kind: "oauth-device-code" },
  { id: "openrouter", alias: "openrouter", display_name: "OpenRouter", auth_kind: "api-key" },
  { id: "glm", alias: "glm", display_name: "GLM Coding", auth_kind: "api-key" },
  { id: "minimax", alias: "minimax", display_name: "Minimax Coding", auth_kind: "api-key" },
  { id: "kimi", alias: "kimi", display_name: "Kimi", auth_kind: "api-key" },
  { id: "openai", alias: "openai", display_name: "OpenAI", auth_kind: "api-key" },
  { id: "anthropic", alias: "anthropic", display_name: "Anthropic", auth_kind: "api-key" },
  { id: "gemini", alias: "gemini", display_name: "Gemini", auth_kind: "api-key" },
]);

function heldOption(
  capability: NineRouterProviderCapability,
  compatible: boolean,
  declaredSecretReferenceIds: readonly string[],
  preference: NineRouterProviderOption["preference"],
): NineRouterProviderOption {
  if (!compatible) return {
    ...capability,
    preference,
    state: "held",
    connection_ids: [],
    hold_reason: "NINE_ROUTER_PROVIDER_CATALOG_VERSION_MISMATCH",
    guidance: [`Install exact 9router@${NINE_ROUTER_PROVIDER_CAPABILITY_VERSION} before selecting provider adapters.`],
  };
  if (capability.auth_kind === "api-key") {
    const holdReason = declaredSecretReferenceIds.length === 0
      ? "PROVIDER_CREDENTIAL_REFERENCE_UNDECLARED"
      : "PROVIDER_CREDENTIAL_REFERENCE_SELECTION_REQUIRED";
    return {
      ...capability,
      preference,
      state: "held",
      connection_ids: [],
      hold_reason: holdReason,
      guidance: declaredSecretReferenceIds.length === 0
        ? ["Declare a provider credential reference in the private host binding; never place the credential value in a profile."]
        : [
          `Choose one declared Keychain reference in private provider intent: ${declaredSecretReferenceIds.join(", ")}.`,
          "The provider remains held until that reference resolves and the reviewed transaction creates the connection.",
        ],
    };
  }
  const device = capability.auth_kind === "oauth-device-code";
  return {
    ...capability,
    preference,
    state: "held",
    connection_ids: [],
    hold_reason: device ? "NINE_ROUTER_DEVICE_AUTH_REQUIRED" : "NINE_ROUTER_OAUTH_REQUIRED",
    guidance: [
      device
        ? "Complete 9Router's device-code authorization, then refresh onboarding."
        : "Complete 9Router's authorization-code flow, then refresh onboarding.",
      "Temperance does not copy, mint, or persist the provider's OAuth tokens.",
    ],
  };
}

export function createNineRouterRoutingSurface(options: {
  routerVersion: string;
  requiredAliases: readonly string[];
  catalog?: NineRouterCatalogSnapshot;
  availableModels?: readonly NineRouterAvailableModel[];
  declaredSecretReferenceIds?: readonly string[];
  providerPreferences?: readonly { provider: string; tier: "recommended" | "optional" }[];
}): NineRouterRoutingSurface {
  const compatible = options.routerVersion === NINE_ROUTER_PROVIDER_CAPABILITY_VERSION;
  const declaredSecretReferenceIds = [...new Set(options.declaredSecretReferenceIds ?? [])].sort();
  const preferenceIds = (options.providerPreferences ?? []).map(({ provider }) => provider);
  if (new Set(preferenceIds).size !== preferenceIds.length
    || preferenceIds.some((provider) => !NINE_ROUTER_PROVIDER_CAPABILITIES.some(({ id }) => id === provider))) {
    throw new Error("NINE_ROUTER_PROVIDER_PREFERENCE_INVALID");
  }
  const preferences = new Map((options.providerPreferences ?? []).map(({ provider, tier }, index) => [provider, { tier, index }]));
  const providerOptions = NINE_ROUTER_PROVIDER_CAPABILITIES.map((capability): NineRouterProviderOption => {
    const preference = preferences.get(capability.id)?.tier ?? "available";
    const connections = compatible
      ? (options.catalog?.providers ?? []).filter(({ provider }) => provider === capability.id)
      : [];
    if (connections.length === 0) return heldOption(capability, compatible, declaredSecretReferenceIds, preference);
    return {
      ...capability,
      preference,
      state: "connected",
      connection_ids: connections.map(({ id }) => id).sort(),
      guidance: [`${connections.length} live 9Router connection${connections.length === 1 ? "" : "s"} available for catalog refresh.`],
    };
  }).sort((left, right) => {
    const leftRank = preferences.get(left.id)?.index ?? Number.MAX_SAFE_INTEGER;
    const rightRank = preferences.get(right.id)?.index ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
  const models = compatible ? [...(options.availableModels ?? [])] : [];
  const draft = options.requiredAliases.length > 0
    ? createNineRouterSeatingDraft(options.requiredAliases, models)
    : { choices: models.filter(({ kind }) => kind === "provider"), seats: [] };
  return {
    router_version: options.routerVersion,
    compatible,
    provider_source: "temperance-versioned-9router-adapter",
    provider_options: providerOptions,
    alias_seats: draft.seats,
    live_model_count: draft.choices.length,
  };
}
