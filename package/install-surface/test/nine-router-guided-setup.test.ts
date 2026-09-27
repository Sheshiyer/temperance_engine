import { describe, expect, test } from "bun:test";

import { ONBOARDING_PROFILE_SCHEMA, type OnboardingPlanV1, type OnboardingProfileV1 } from "../src/onboarding/contracts.ts";
import { createCoreOnboardingCatalog } from "../src/onboarding/core-catalog.ts";
import {
  NINE_ROUTER_GUIDED_SETUP_SCHEMA,
  NineRouterGuidedSetupError,
  createNineRouterGuidedSetupEffector,
  createNineRouterGuidedSetupPlanInput,
  prepareNineRouterGuidedSetupCatalog,
  type NineRouterGuidedSetupApi,
  type NineRouterGuidedSetupKeychain,
  type NineRouterGuidedSetupV1,
} from "../src/onboarding/nine-router-guided-setup.ts";
import type { NineRouterCatalogSnapshot } from "../src/onboarding/nine-router-api.ts";
import { executeConfirmedNineRouterRepair } from "../src/onboarding/nine-router-repair.ts";
import { calculateOnboardingPlanDigest } from "../src/onboarding/planner.ts";
import type { OperationReceiptV1 } from "../src/onboarding/public-contracts.ts";

const profile: OnboardingProfileV1 = {
  schema: ONBOARDING_PROFILE_SCHEMA,
  version: { major: 1, minor: 0 },
  id: "guided-setup-test",
  variables: {
    NINE_ROUTER_DATA_DIR: "/example/.9router",
    NINE_ROUTER_HEALTH_URL: "http://127.0.0.1:20128/v1/models",
    NINE_ROUTER_CLI_ENTRYPOINT: "/example/bin/9router-cli.js",
  },
  secret_references: {
    PROVIDER_PRIMARY: { store: "macos-keychain", service: "temperance.provider", account: "primary" },
    GATEWAY_KEY: { store: "macos-keychain", service: "temperance.gateway", account: "default" },
  },
  preselected_modules: ["provider.9router"],
  routing_aliases: [{ alias: "noesis-build", combo: "noesis-build" }],
  project_enrollments: [],
};

const desired: NineRouterGuidedSetupV1 = {
  schema: NINE_ROUTER_GUIDED_SETUP_SCHEMA,
  version: { major: 1, minor: 0 },
  providers: [{
    selection_id: "primary",
    provider: "anthropic",
    connection_name: "Primary Anthropic",
    credential_reference_id: "PROVIDER_PRIMARY",
  }],
  combos: [{ alias: "noesis-build", models: ["anthropic/claude-build"] }],
  required_aliases: ["noesis-build"],
  gateway_key: { name: "Temperance", secret_reference_id: "GATEWAY_KEY" },
};

class MemoryApi implements NineRouterGuidedSetupApi {
  readonly calls: string[] = [];
  readonly providers: NineRouterCatalogSnapshot["providers"] = [];
  readonly combos: NineRouterCatalogSnapshot["combos"] = [];
  readonly comboModels = new Map<string, string[]>();
  readonly keys: Array<{ id: string; name: string }> = [];
  distortReadback = false;
  failAfterCreate: "provider" | "combo" | "gateway" | undefined;
  availableModelKind: "provider" | "combo" | "absent" = "provider";
  availableModelsOverride: Array<{ id: string; owner: string; kind: "provider" | "combo" }> | undefined;

  async readCatalog(): Promise<NineRouterCatalogSnapshot> {
    this.calls.push("read-catalog");
    return {
      providers: structuredClone(this.providers),
      combos: this.combos.map((combo) => ({ ...combo, model_count: this.distortReadback ? 0 : combo.model_count })),
    };
  }

  async createProviderConnection(input: { provider: string; name: string; apiKey: string }) {
    this.calls.push(`create-provider:${input.provider}:${input.name}:[redacted]`);
    if (input.apiKey !== "provider-secret") throw new Error("wrong provider secret");
    const created = { id: `provider-${this.providers.length + 1}`, name: input.name };
    this.providers.push({ ...created, provider: input.provider, active: true });
    if (this.failAfterCreate === "provider") throw new Error("MALFORMED_PROVIDER_SUCCESS");
    return created;
  }

  async readAvailableModels() {
    this.calls.push("read-available-models");
    if (this.availableModelsOverride) return structuredClone(this.availableModelsOverride);
    return this.availableModelKind === "absent"
      ? []
      : [{ id: "anthropic/claude-build", owner: "anthropic", kind: this.availableModelKind }];
  }

  async deleteProviderConnection(id: string): Promise<void> {
    this.calls.push(`delete-provider:${id}`);
    const index = this.providers.findIndex((provider) => provider.id === id);
    if (index >= 0) this.providers.splice(index, 1);
  }

  async createCombo(input: { name: string; models: readonly string[] }) {
    this.calls.push(`create-combo:${input.name}:${input.models.length}`);
    const created = { id: `combo-${this.combos.length + 1}`, name: input.name };
    this.combos.push({ id: created.id, alias: input.name, model_count: input.models.length });
    this.comboModels.set(created.id, structuredClone(input.models));
    if (this.failAfterCreate === "combo") throw new Error("MALFORMED_COMBO_SUCCESS");
    return created;
  }

  async deleteCombo(id: string): Promise<void> {
    this.calls.push(`delete-combo:${id}`);
    const index = this.combos.findIndex((combo) => combo.id === id);
    if (index >= 0) this.combos.splice(index, 1);
    this.comboModels.delete(id);
  }

  async readCombo(id: string) {
    this.calls.push(`read-combo:${id}`);
    const combo = this.combos.find((item) => item.id === id);
    if (!combo) throw new Error("COMBO_MISSING");
    return { id, alias: combo.alias, models: structuredClone(this.comboModels.get(id) ?? []) };
  }

  async createGatewayKey(name: string, capture: (secret: string) => Promise<void>) {
    this.calls.push(`create-gateway-key:${name}`);
    const created = { id: `key-${this.keys.length + 1}`, name };
    this.keys.push(created);
    await capture("new-gateway-secret");
    if (this.failAfterCreate === "gateway") throw new Error("MALFORMED_GATEWAY_SUCCESS");
    return { ...created, captured: true as const };
  }

  async readGatewayKeys() {
    this.calls.push("read-gateway-keys");
    return structuredClone(this.keys);
  }

  async deleteGatewayKey(id: string): Promise<void> {
    this.calls.push(`delete-gateway-key:${id}`);
    const index = this.keys.findIndex((key) => key.id === id);
    if (index >= 0) this.keys.splice(index, 1);
  }
}

function memoryKeychain(initialGateway?: string): NineRouterGuidedSetupKeychain & { values: Map<string, string>; calls: string[] } {
  const values = new Map<string, string>([["temperance.provider/primary", "provider-secret"]]);
  if (initialGateway) values.set("temperance.gateway/default", initialGateway);
  const calls: string[] = [];
  const key = (reference: { service: string; account: string }) => `${reference.service}/${reference.account}`;
  return {
    values,
    calls,
    async has(reference) { calls.push(`has:${key(reference)}`); return values.has(key(reference)); },
    async read(reference) {
      calls.push(`read:${key(reference)}`);
      const value = values.get(key(reference));
      if (!value) throw new Error("KEYCHAIN_ITEM_UNAVAILABLE");
      return value;
    },
    async put(reference, secret) { calls.push(`put:${key(reference)}:[redacted]`); values.set(key(reference), secret); },
    async delete(reference) { calls.push(`delete:${key(reference)}`); return values.delete(key(reference)); },
  };
}

const executable = { id: "9router", path: "/managed/bin/9router", version: "0.5.75" };

describe("fresh 9router guided setup", () => {
  test("adds selected provider Keychain probes to the reviewed plan catalog", () => {
    const original = createCoreOnboardingCatalog();
    const prepared = prepareNineRouterGuidedSetupCatalog(original, desired, profile);
    expect(prepared.modules[0]?.requires).toContainEqual({
      id: "9router-provider-primary-credential",
      kind: "keychain-secret",
      secret_reference: "PROVIDER_PRIMARY",
    });
    expect(original.modules[0]?.requires.some(({ id }) => id === "9router-provider-primary-credential")).toBe(false);
  });

  test("binds exact secret-free provider and combo details into the plan digest input", () => {
    const input = createNineRouterGuidedSetupPlanInput(desired, profile);
    const changed = createNineRouterGuidedSetupPlanInput({
      ...desired,
      combos: [{ alias: "noesis-build", models: ["anthropic/different-model"] }],
    }, profile);
    const changedAlias = createNineRouterGuidedSetupPlanInput(desired, {
      ...profile,
      routing_aliases: [{ alias: "build", combo: "noesis-build" }],
    });
    const changedBinding = createNineRouterGuidedSetupPlanInput(desired, {
      ...profile,
      variables: { ...profile.variables, NINE_ROUTER_CLI_ENTRYPOINT: "/different/bin/9router-cli.js" },
    });
    const changedReference = createNineRouterGuidedSetupPlanInput(desired, {
      ...profile,
      secret_references: {
        ...profile.secret_references,
        PROVIDER_PRIMARY: { store: "macos-keychain", service: "temperance.provider", account: "different" },
      },
    });
    expect(input.digest).not.toBe(changed.digest);
    expect(input.digest).not.toBe(changedAlias.digest);
    expect(input.digest).not.toBe(changedBinding.digest);
    expect(input.digest).not.toBe(changedReference.digest);
    expect(input.details.some((detail) => detail.startsWith("combo noesis-build:") && detail.includes('"anthropic/claude-build"'))).toBe(true);
    expect(JSON.stringify(input)).not.toContain("provider-secret");
    expect(JSON.stringify(input)).not.toContain("new-gateway-secret");
  });

  test("resolves provider credentials, creates fresh state, and verifies aliases by readback", async () => {
    const api = new MemoryApi();
    const keychain = memoryKeychain();
    const effector = createNineRouterGuidedSetupEffector({ desired, profile, api, keychain, executable });
    const result = await effector.apply(new AbortController().signal);
    expect(result).toEqual({ resolved_executables: [executable] });
    expect(api.providers).toEqual([{ id: "provider-1", name: "Primary Anthropic", provider: "anthropic", active: true }]);
    expect(api.combos).toEqual([{ id: "combo-1", alias: "noesis-build", model_count: 1 }]);
    expect(keychain.values.get("temperance.gateway/default")).toBe("new-gateway-secret");
    expect(api.calls).toEqual([
      "read-catalog",
      "read-gateway-keys",
      "create-provider:anthropic:Primary Anthropic:[redacted]",
      "read-available-models",
      "create-combo:noesis-build:1",
      "create-gateway-key:Temperance",
      "read-catalog",
      "read-gateway-keys",
      "read-combo:combo-1",
    ]);
    expect(JSON.stringify({ result, apiCalls: api.calls, keychainCalls: keychain.calls })).not.toContain("provider-secret");
    expect(JSON.stringify({ result, apiCalls: api.calls, keychainCalls: keychain.calls })).not.toContain("new-gateway-secret");
  });

  test("uses existing OAuth providers without owning or deleting their connections", async () => {
    const api = new MemoryApi();
    api.providers.push({ id: "oauth-codex", name: "Codex OAuth", provider: "codex", active: true });
    api.availableModelsOverride = [{ id: "cx/gpt-codex", owner: "cx", kind: "provider" }];
    const oauthDesired: NineRouterGuidedSetupV1 = {
      ...desired,
      providers: [],
      combos: [{ alias: "noesis-build", models: ["cx/gpt-codex"] }],
    };
    const keychain = memoryKeychain();
    const effector = createNineRouterGuidedSetupEffector({ desired: oauthDesired, profile, api, keychain, executable });
    await effector.apply(new AbortController().signal);
    expect(api.providers).toEqual([{ id: "oauth-codex", name: "Codex OAuth", provider: "codex", active: true }]);
    expect(api.calls).not.toContain("create-provider:codex:Codex OAuth:[redacted]");
    expect(keychain.calls).not.toContain("read:temperance.provider/primary");
    await effector.rollback(new AbortController().signal);
    expect(api.providers).toEqual([{ id: "oauth-codex", name: "Codex OAuth", provider: "codex", active: true }]);
    expect(api.calls.some((call) => call.startsWith("delete-provider:"))).toBe(false);
    expect(api.combos).toEqual([]);
    expect(api.keys).toEqual([]);
  });

  test("rolls back gateway, combo, provider, and Keychain state in reverse creation order", async () => {
    const api = new MemoryApi();
    const keychain = memoryKeychain("previous-gateway-secret");
    const effector = createNineRouterGuidedSetupEffector({ desired, profile, api, keychain, executable });
    await effector.apply(new AbortController().signal);
    await effector.rollback(new AbortController().signal);
    expect(api.calls.slice(-3)).toEqual(["delete-gateway-key:key-1", "delete-combo:combo-1", "delete-provider:provider-1"]);
    expect(api.providers).toEqual([]);
    expect(api.combos).toEqual([]);
    expect(api.keys).toEqual([]);
    expect(keychain.values.get("temperance.gateway/default")).toBe("previous-gateway-secret");
  });

  test("readback mismatch fails closed and remains completely rollbackable", async () => {
    const api = new MemoryApi();
    api.distortReadback = true;
    const keychain = memoryKeychain();
    const effector = createNineRouterGuidedSetupEffector({ desired, profile, api, keychain, executable });
    await expect(effector.apply(new AbortController().signal)).rejects.toThrow("NINE_ROUTER_SETUP_COMBO_READBACK_MISMATCH");
    await effector.rollback(new AbortController().signal);
    expect(api.providers).toEqual([]);
    expect(api.combos).toEqual([]);
    expect(api.keys).toEqual([]);
    expect(keychain.values.has("temperance.gateway/default")).toBe(false);
  });

  test("rejects absent and combo-kind live choices before combo creation", async () => {
    for (const availableModelKind of ["absent", "combo"] as const) {
      const api = new MemoryApi();
      api.availableModelKind = availableModelKind;
      const keychain = memoryKeychain();
      const effector = createNineRouterGuidedSetupEffector({ desired, profile, api, keychain, executable });
      await expect(effector.apply(new AbortController().signal)).rejects.toThrow("NINE_ROUTER_SETUP_MODEL_UNAVAILABLE");
      expect(api.calls).toEqual([
        "read-catalog",
        "read-gateway-keys",
        "create-provider:anthropic:Primary Anthropic:[redacted]",
        "read-available-models",
      ]);
      await effector.rollback(new AbortController().signal);
      expect(api.providers).toEqual([]);
      expect(api.combos).toEqual([]);
    }
  });

  test("recovers created identities from malformed success responses before rollback", async () => {
    for (const failAfterCreate of ["provider", "combo", "gateway"] as const) {
      const api = new MemoryApi();
      api.failAfterCreate = failAfterCreate;
      const keychain = memoryKeychain();
      const effector = createNineRouterGuidedSetupEffector({ desired, profile, api, keychain, executable });
      await expect(effector.apply(new AbortController().signal)).rejects.toThrow(`MALFORMED_${failAfterCreate.toUpperCase()}_SUCCESS`);
      await effector.rollback(new AbortController().signal);
      expect(api.providers, failAfterCreate).toEqual([]);
      expect(api.combos, failAfterCreate).toEqual([]);
      expect(api.keys, failAfterCreate).toEqual([]);
      expect(keychain.values.has("temperance.gateway/default"), failAfterCreate).toBe(false);
    }
  });

  test("rejects conflicts and malformed combo model identifiers before any setup mutation", async () => {
    const api = new MemoryApi();
    api.combos.push({ id: "existing", alias: "noesis-build", model_count: 1 });
    const keychain = memoryKeychain();
    const conflict = createNineRouterGuidedSetupEffector({ desired, profile, api, keychain, executable });
    await expect(conflict.apply(new AbortController().signal)).rejects.toThrow("NINE_ROUTER_SETUP_COMBO_CONFLICT");
    expect(api.calls).toEqual(["read-catalog", "read-gateway-keys"]);
    expect(keychain.calls).toEqual([]);

    expect(() => createNineRouterGuidedSetupEffector({
      desired: { ...desired, combos: [{ alias: "noesis-build", models: ["bad\nmodel"] }] },
      profile,
      api: new MemoryApi(),
      keychain,
      executable,
    })).toThrow(NineRouterGuidedSetupError);
    expect(() => createNineRouterGuidedSetupEffector({
      desired,
      profile: { ...profile, routing_aliases: [] },
      api: new MemoryApi(),
      keychain,
      executable,
    })).toThrow("NINE_ROUTER_SETUP_REQUIRED_ALIAS_UNBOUND");
  });

  test("rejects pre-existing combos and gateway keys before reading Keychain", async () => {
    for (const state of ["combo", "key"] as const) {
      const api = new MemoryApi();
      if (state === "combo") api.combos.push({ id: "unrelated-combo", alias: "other", model_count: 1 });
      if (state === "key") api.keys.push({ id: "unrelated-key", name: "Other" });
      const keychain = memoryKeychain();
      const effector = createNineRouterGuidedSetupEffector({ desired, profile, api, keychain, executable });
      await expect(effector.apply(new AbortController().signal)).rejects.toThrow("NINE_ROUTER_SETUP_STATE_NOT_EMPTY");
      expect(api.calls).toEqual(["read-catalog", "read-gateway-keys"]);
      expect(keychain.calls).toEqual([]);
    }
  });

  test("rejects OAuth provider IDs in API-key creation intent", () => {
    expect(() => createNineRouterGuidedSetupEffector({
      desired: {
        ...desired,
        providers: [{
          selection_id: "codex",
          provider: "codex",
          connection_name: "Codex OAuth",
          credential_reference_id: "PROVIDER_PRIMARY",
        }],
      },
      profile,
      api: new MemoryApi(),
      keychain: memoryKeychain(),
      executable,
    })).toThrow("NINE_ROUTER_SETUP_PROVIDER_AUTH_KIND_INVALID");
  });

  test("repair rejects missing or mismatched confirmation before any API mutation", async () => {
    const configurationInput = createNineRouterGuidedSetupPlanInput(desired, profile);
    const base: Omit<OnboardingPlanV1, "generated_at" | "plan_digest"> = {
      schema: "temperance.onboarding.plan.v1",
      version: { major: 1, minor: 0 },
      profile_id: profile.id,
      dry_run: false,
      operating_mode: "ready",
      install_order: ["provider.9router"],
      modules: [],
      configuration_inputs: [configurationInput],
    };
    const plan: OnboardingPlanV1 = {
      ...base,
      generated_at: "2026-09-17T00:00:00.000Z",
      plan_digest: calculateOnboardingPlanDigest(base),
    };
    const api = new MemoryApi();
    const keychain = memoryKeychain();
    const receipts: OperationReceiptV1[] = [];
    const common = {
      plan, profile, desired, api, keychain, executable,
      receiptSink: { write: async (receipt: OperationReceiptV1) => { receipts.push(receipt); } },
    };
    await expect(executeConfirmedNineRouterRepair(common)).rejects.toThrow("NINE_ROUTER_REPAIR_CONFIRMATION_REQUIRED");
    await expect(executeConfirmedNineRouterRepair({
      ...common,
      desired: { ...desired, combos: [{ alias: "noesis-build", models: ["anthropic/different-model"] }] },
      confirmation: { confirmed: true, plan_digest: plan.plan_digest, confirmed_at: "2026-09-17T00:00:01.000Z" },
    })).rejects.toThrow("NINE_ROUTER_REPAIR_CONFIGURATION_MISMATCH");
    expect(api.calls).toEqual([]);
    expect(keychain.calls).toEqual([]);
    expect(receipts).toEqual([]);

    const receipt = await executeConfirmedNineRouterRepair({
      ...common,
      confirmation: { confirmed: true, plan_digest: plan.plan_digest, confirmed_at: "2026-09-17T00:00:01.000Z" },
      operationId: "guided-repair",
    });
    expect(receipt).toMatchObject({
      operation_id: "guided-repair",
      status: "committed",
      module_ids: ["provider.9router"],
      resolved_executables: [executable],
    });
    expect(receipts).toEqual([receipt]);
    expect(api.calls).toContain("create-combo:noesis-build:1");
  });
});
