import { createHash } from "node:crypto";
import { isAbsolute, normalize } from "node:path";

import { canonical } from "../canonical-json.ts";
import type { OnboardingCatalogV1, OnboardingPlanV1, OnboardingProfileV1 } from "./contracts.ts";
import { validateNineRouterGuidedSetupV1 } from "./contract-schema.ts";
import type { MacOsKeychainAdapter } from "./keychain-adapter.ts";
import type {
  NineRouterApiClient,
  NineRouterAvailableModel,
  NineRouterCatalogSnapshot,
  NineRouterComboDetail,
  NineRouterCreatedObject,
  NineRouterGatewayKeyReceipt,
  NineRouterGatewayKeySummary,
} from "./nine-router-api.ts";
import type { OnboardingEffector, ResolvedExecutable } from "./operation-executor.ts";
import { NINE_ROUTER_GUIDED_SETUP_SCHEMA, type NineRouterGuidedSetupV1 } from "./public-contracts.ts";
export { NINE_ROUTER_GUIDED_SETUP_SCHEMA, type NineRouterGuidedSetupV1 } from "./public-contracts.ts";

export interface NineRouterGuidedSetupApi {
  readCatalog(): Promise<NineRouterCatalogSnapshot>;
  readAvailableModels(): Promise<NineRouterAvailableModel[]>;
  createProviderConnection(input: { provider: string; name: string; apiKey: string }): Promise<NineRouterCreatedObject>;
  deleteProviderConnection(id: string): Promise<void>;
  createCombo(input: { name: string; models: readonly string[] }): Promise<NineRouterCreatedObject>;
  readCombo(id: string): Promise<NineRouterComboDetail>;
  deleteCombo(id: string): Promise<void>;
  createGatewayKey(name: string, capture: (secret: string) => Promise<void>): Promise<NineRouterGatewayKeyReceipt>;
  readGatewayKeys(): Promise<NineRouterGatewayKeySummary[]>;
  deleteGatewayKey(id: string): Promise<void>;
}

export interface NineRouterGuidedSetupKeychain {
  has: MacOsKeychainAdapter["has"];
  read: MacOsKeychainAdapter["read"];
  put: MacOsKeychainAdapter["put"];
  delete: MacOsKeychainAdapter["delete"];
}

export class NineRouterGuidedSetupError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "NineRouterGuidedSetupError";
  }
}

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const REFERENCE_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;

function text(value: string, code: string, maxLength = 256): string {
  if (!value || value.length > maxLength || value.trim() !== value || value.includes("\0") || /[\r\n]/u.test(value)) {
    throw new NineRouterGuidedSetupError(code);
  }
  return value;
}

function safeId(value: string, code: string): string {
  if (!SAFE_ID.test(value)) throw new NineRouterGuidedSetupError(code);
  return value;
}

function referenceId(value: string, code: string): string {
  if (!REFERENCE_ID.test(value)) throw new NineRouterGuidedSetupError(code);
  return value;
}

function unique(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) throw new NineRouterGuidedSetupError(code);
}

function validateDesiredState(desired: NineRouterGuidedSetupV1, profile: OnboardingProfileV1): NineRouterGuidedSetupV1 {
  if (!validateNineRouterGuidedSetupV1(desired) || desired.schema !== NINE_ROUTER_GUIDED_SETUP_SCHEMA) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_SCHEMA_INVALID");
  }
  if (desired.providers.length < 1 || desired.providers.length > 64) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_PROVIDERS_INVALID");
  }
  if (desired.combos.length < 1 || desired.combos.length > 128) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_COMBOS_INVALID");
  }
  if (desired.required_aliases.length < 1 || desired.required_aliases.length > 128) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_REQUIRED_ALIASES_INVALID");
  }
  for (const name of ["NINE_ROUTER_DATA_DIR", "NINE_ROUTER_CLI_ENTRYPOINT"] as const) {
    const value = profile.variables[name];
    if (!value || !isAbsolute(value) || normalize(value) !== value || value.includes("\0")) {
      throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_RUNTIME_BINDING_INVALID");
    }
  }
  let healthUrl: URL;
  try { healthUrl = new URL(profile.variables.NINE_ROUTER_HEALTH_URL ?? ""); }
  catch { throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_RUNTIME_BINDING_INVALID"); }
  if (healthUrl.protocol !== "http:" || !["127.0.0.1", "::1", "localhost"].includes(healthUrl.hostname.replace(/^\[|\]$/gu, "")) || (healthUrl.port || "80") !== "20128") {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_RUNTIME_BINDING_INVALID");
  }

  for (const provider of desired.providers) {
    safeId(provider.selection_id, "NINE_ROUTER_SETUP_SELECTION_ID_INVALID");
    safeId(provider.provider, "NINE_ROUTER_SETUP_PROVIDER_INVALID");
    text(provider.connection_name, "NINE_ROUTER_SETUP_CONNECTION_NAME_INVALID");
    referenceId(provider.credential_reference_id, "NINE_ROUTER_SETUP_CREDENTIAL_REFERENCE_INVALID");
    if (!profile.secret_references[provider.credential_reference_id]) {
      throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_CREDENTIAL_REFERENCE_MISSING");
    }
  }
  unique(desired.providers.map(({ selection_id }) => selection_id), "NINE_ROUTER_SETUP_SELECTION_DUPLICATE");
  unique(desired.providers.map(({ connection_name }) => connection_name), "NINE_ROUTER_SETUP_CONNECTION_NAME_DUPLICATE");

  for (const combo of desired.combos) {
    safeId(combo.alias, "NINE_ROUTER_SETUP_ALIAS_INVALID");
    if (combo.models.length < 1 || combo.models.length > 256) {
      throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_MODELS_INVALID");
    }
    for (const model of combo.models) text(model, "NINE_ROUTER_SETUP_MODEL_INVALID", 512);
    if (combo.models.some((model) => /[\u0000-\u001f\u007f]/u.test(model))) {
      throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_MODEL_CONTROL_CHARACTER");
    }
    unique(combo.models, "NINE_ROUTER_SETUP_MODEL_DUPLICATE");
  }
  unique(desired.combos.map(({ alias }) => alias), "NINE_ROUTER_SETUP_ALIAS_DUPLICATE");
  for (const alias of desired.required_aliases) {
    safeId(alias, "NINE_ROUTER_SETUP_REQUIRED_ALIAS_INVALID");
    if (!desired.combos.some((combo) => combo.alias === alias)) {
      throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_REQUIRED_ALIAS_UNDECLARED");
    }
  }
  unique(desired.required_aliases, "NINE_ROUTER_SETUP_REQUIRED_ALIAS_DUPLICATE");
  const boundCombos = profile.routing_aliases.map(({ combo }) => combo);
  if (desired.required_aliases.some((alias) => !boundCombos.includes(alias))) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_REQUIRED_ALIAS_UNBOUND");
  }
  if (boundCombos.some((combo) => !desired.required_aliases.includes(combo))) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_PROFILE_ALIAS_UNDECLARED");
  }

  text(desired.gateway_key.name, "NINE_ROUTER_SETUP_GATEWAY_KEY_NAME_INVALID");
  referenceId(desired.gateway_key.secret_reference_id, "NINE_ROUTER_SETUP_GATEWAY_REFERENCE_INVALID");
  if (!profile.secret_references[desired.gateway_key.secret_reference_id]) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_GATEWAY_REFERENCE_MISSING");
  }
  if (desired.providers.some(({ credential_reference_id }) => credential_reference_id === desired.gateway_key.secret_reference_id)) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_SECRET_REFERENCE_CONFLICT");
  }
  return structuredClone(desired);
}

function assertFreshState(
  catalog: NineRouterCatalogSnapshot,
  gatewayKeys: readonly NineRouterGatewayKeySummary[],
  desired: NineRouterGuidedSetupV1,
): void {
  if (desired.providers.some(({ connection_name }) => catalog.providers.some(({ name }) => name === connection_name))) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_PROVIDER_CONFLICT");
  }
  if (desired.combos.some(({ alias }) => catalog.combos.some((combo) => combo.alias === alias))) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_COMBO_CONFLICT");
  }
  if (gatewayKeys.some(({ name }) => name === desired.gateway_key.name)) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_GATEWAY_KEY_CONFLICT");
  }
  if (catalog.providers.length > 0 || catalog.combos.length > 0 || gatewayKeys.length > 0) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_STATE_NOT_EMPTY");
  }
}

function assertReadback(
  catalog: NineRouterCatalogSnapshot,
  desired: NineRouterGuidedSetupV1,
  providers: readonly NineRouterCreatedObject[],
  combos: readonly NineRouterCreatedObject[],
  comboDetails: readonly NineRouterComboDetail[],
  gatewayKeys: readonly NineRouterGatewayKeySummary[],
): void {
  if (providers.length !== desired.providers.length) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_PROVIDER_READBACK_MISMATCH");
  }
  if (combos.length !== desired.combos.length || comboDetails.length !== desired.combos.length) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_COMBO_READBACK_MISMATCH");
  }
  for (const [index, created] of providers.entries()) {
    const expected = desired.providers[index]!;
    const observed = catalog.providers.find(({ id }) => id === created.id);
    if (!observed || observed.name !== expected.connection_name || observed.provider !== expected.provider) {
      throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_PROVIDER_READBACK_MISMATCH");
    }
  }
  for (const [index, created] of combos.entries()) {
    const expected = desired.combos[index]!;
    const observed = catalog.combos.find(({ id }) => id === created.id);
    if (!observed || observed.alias !== expected.alias || observed.model_count !== expected.models.length) {
      throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_COMBO_READBACK_MISMATCH");
    }
    const detail = comboDetails.find(({ id }) => id === created.id);
    if (!detail || detail.alias !== expected.alias || canonical(detail.models) !== canonical(expected.models)) {
      throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_COMBO_MEMBERSHIP_READBACK_MISMATCH");
    }
  }
  if (desired.required_aliases.some((alias) => !catalog.combos.some((combo) => combo.alias === alias))) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_REQUIRED_ALIAS_MISSING");
  }
  if (gatewayKeys.length !== 1 || gatewayKeys[0]?.name !== desired.gateway_key.name) {
    throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_GATEWAY_KEY_READBACK_MISMATCH");
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_ABORTED");
}

/** Adds selected provider-secret probes to the reviewed plan before TUI confirmation. */
export function prepareNineRouterGuidedSetupCatalog(
  catalog: OnboardingCatalogV1,
  desiredInput: NineRouterGuidedSetupV1,
  profile: OnboardingProfileV1,
): OnboardingCatalogV1 {
  const desired = validateDesiredState(desiredInput, profile);
  const prepared = structuredClone(catalog);
  const router = prepared.modules.find(({ id }) => id === "provider.9router");
  if (!router) throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_MODULE_MISSING");
  for (const provider of desired.providers) {
    const id = `9router-provider-${provider.selection_id}-credential`;
    if (router.requires.some((requirement) => requirement.id === id)) continue;
    router.requires.push({
      id,
      kind: "keychain-secret",
      secret_reference: provider.credential_reference_id,
    });
  }
  return prepared;
}

export function createNineRouterGuidedSetupPlanInput(
  desiredInput: NineRouterGuidedSetupV1,
  profile: OnboardingProfileV1,
): NonNullable<OnboardingPlanV1["configuration_inputs"]>[number] {
  const desired = validateDesiredState(desiredInput, profile);
  const routingAliases = [...profile.routing_aliases].sort((left, right) => left.alias.localeCompare(right.alias));
  const referenceIds = [...new Set([
    ...desired.providers.map(({ credential_reference_id }) => credential_reference_id),
    desired.gateway_key.secret_reference_id,
  ])].sort();
  const secretReferences = Object.fromEntries(referenceIds.map((id) => [id, profile.secret_references[id]]));
  const runtimeBinding = {
    data_directory: profile.variables.NINE_ROUTER_DATA_DIR ?? "",
    health_url: profile.variables.NINE_ROUTER_HEALTH_URL ?? "",
    cli_entrypoint: profile.variables.NINE_ROUTER_CLI_ENTRYPOINT ?? "",
  };
  return {
    id: "9router-guided-setup",
    digest: `sha256:${createHash("sha256").update(canonical({ desired, routing_aliases: routingAliases, runtime_binding: runtimeBinding, secret_references: secretReferences }), "utf8").digest("hex")}`,
    details: [
      ...desired.providers.map((provider) => {
        const reference = profile.secret_references[provider.credential_reference_id]!;
        return `provider ${provider.selection_id}: ${provider.provider} · ${provider.connection_name} · Keychain ref ${provider.credential_reference_id} (${reference.service}/${reference.account})`;
      }),
      ...desired.combos.map((combo) => `combo ${combo.alias}: ${canonical(combo.models)}`),
      ...routingAliases.map(({ alias, combo }) => `routing alias ${alias} → ${combo}`),
      `required aliases: ${desired.required_aliases.join(", ")}`,
      `gateway key ${desired.gateway_key.name}: Keychain ref ${desired.gateway_key.secret_reference_id} (${profile.secret_references[desired.gateway_key.secret_reference_id]!.service}/${profile.secret_references[desired.gateway_key.secret_reference_id]!.account})`,
      `runtime DATA_DIR: ${runtimeBinding.data_directory}`,
      `runtime health: ${runtimeBinding.health_url}`,
      `runtime entrypoint: ${runtimeBinding.cli_entrypoint}`,
    ],
  };
}

/**
 * Creates only fresh 9Router objects. It never edits pre-existing provider or
 * combo state, making reverse deletion a complete rollback for this effector.
 */
export function createNineRouterGuidedSetupEffector(options: {
  desired: NineRouterGuidedSetupV1;
  profile: OnboardingProfileV1;
  api: NineRouterGuidedSetupApi | NineRouterApiClient;
  keychain: NineRouterGuidedSetupKeychain | MacOsKeychainAdapter;
  executable: ResolvedExecutable;
}): OnboardingEffector {
  const desired = validateDesiredState(options.desired, options.profile);
  const createdProviders: NineRouterCreatedObject[] = [];
  const createdCombos: NineRouterCreatedObject[] = [];
  const createdGatewayKeys: NineRouterGatewayKeySummary[] = [];
  let gatewayCaptured = false;
  let gatewayBefore: { present: boolean; secret?: string } | undefined;
  let started = false;

  return {
    module_id: "provider.9router",
    async apply(signal) {
      if (started) throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_ALREADY_STARTED");
      started = true;
      assertNotAborted(signal);
      const [initial, initialGatewayKeys] = await Promise.all([options.api.readCatalog(), options.api.readGatewayKeys()]);
      assertFreshState(initial, initialGatewayKeys, desired);
      const initialProviderIds = new Set(initial.providers.map(({ id }) => id));
      const initialComboIds = new Set(initial.combos.map(({ id }) => id));
      const initialGatewayKeyIds = new Set(initialGatewayKeys.map(({ id }) => id));

      const providerSecrets: string[] = [];
      for (const provider of desired.providers) {
        assertNotAborted(signal);
        providerSecrets.push(await options.keychain.read(options.profile.secret_references[provider.credential_reference_id]!));
      }
      const gatewayReference = options.profile.secret_references[desired.gateway_key.secret_reference_id]!;
      assertNotAborted(signal);
      const gatewayPresent = await options.keychain.has(gatewayReference);
      gatewayBefore = gatewayPresent
        ? { present: true, secret: await options.keychain.read(gatewayReference) }
        : { present: false };

      for (const [index, provider] of desired.providers.entries()) {
        assertNotAborted(signal);
        try {
          createdProviders.push(await options.api.createProviderConnection({
            provider: provider.provider,
            name: provider.connection_name,
            apiKey: providerSecrets[index]!,
          }));
        } catch (error) {
          try {
            const recovery = await options.api.readCatalog();
            createdProviders.push(...recovery.providers
              .filter((item) => !initialProviderIds.has(item.id) && item.name === provider.connection_name && item.provider === provider.provider)
              .map(({ id, name }) => ({ id, name })));
          } catch { /* Preserve the original create failure. */ }
          throw error;
        }
      }
      assertNotAborted(signal);
      const availableModels = await options.api.readAvailableModels();
      const availableProviderModelIds = new Set(availableModels
        .filter(({ kind }) => kind === "provider")
        .map(({ id }) => id));
      if (desired.combos.some(({ models }) => models.some((model) => !availableProviderModelIds.has(model)))) {
        throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_MODEL_UNAVAILABLE");
      }
      for (const combo of desired.combos) {
        assertNotAborted(signal);
        try {
          createdCombos.push(await options.api.createCombo({ name: combo.alias, models: combo.models }));
        } catch (error) {
          try {
            const recovery = await options.api.readCatalog();
            createdCombos.push(...recovery.combos
              .filter((item) => !initialComboIds.has(item.id) && item.alias === combo.alias)
              .map(({ id, alias }) => ({ id, name: alias })));
          } catch { /* Preserve the original create failure. */ }
          throw error;
        }
      }
      assertNotAborted(signal);
      try {
        const created = await options.api.createGatewayKey(desired.gateway_key.name, async (secret) => {
          await options.keychain.put(gatewayReference, secret);
          gatewayCaptured = true;
        });
        createdGatewayKeys.push({ id: created.id, name: created.name });
      } catch (error) {
        try {
          const recovery = await options.api.readGatewayKeys();
          createdGatewayKeys.push(...recovery.filter((item) => !initialGatewayKeyIds.has(item.id) && item.name === desired.gateway_key.name));
        } catch { /* Preserve the original create failure. */ }
        throw error;
      }

      assertNotAborted(signal);
      const [catalog, gatewayKeys, comboDetails] = await Promise.all([
        options.api.readCatalog(),
        options.api.readGatewayKeys(),
        Promise.all(createdCombos.map(({ id }) => options.api.readCombo(id))),
      ]);
      assertReadback(
        catalog,
        desired,
        createdProviders,
        createdCombos,
        comboDetails,
        gatewayKeys.filter(({ id }) => createdGatewayKeys.some((created) => created.id === id)),
      );
      return { resolved_executables: [{ ...options.executable }] };
    },
    async rollback() {
      const failures: string[] = [];
      for (let index = createdGatewayKeys.length - 1; index >= 0; index -= 1) {
        try {
          await options.api.deleteGatewayKey(createdGatewayKeys[index]!.id);
          createdGatewayKeys.splice(index, 1);
        } catch { failures.push("gateway-key"); }
      }
      if (gatewayCaptured && gatewayBefore) {
        const gatewayReference = options.profile.secret_references[desired.gateway_key.secret_reference_id]!;
        try {
          if (gatewayBefore.present) await options.keychain.put(gatewayReference, gatewayBefore.secret!);
          else await options.keychain.delete(gatewayReference);
          gatewayCaptured = false;
          gatewayBefore = undefined;
        } catch { failures.push("keychain"); }
      }
      for (let index = createdCombos.length - 1; index >= 0; index -= 1) {
        try {
          await options.api.deleteCombo(createdCombos[index]!.id);
          createdCombos.splice(index, 1);
        } catch { failures.push("combo"); }
      }
      for (let index = createdProviders.length - 1; index >= 0; index -= 1) {
        try {
          await options.api.deleteProviderConnection(createdProviders[index]!.id);
          createdProviders.splice(index, 1);
        } catch { failures.push("provider"); }
      }
      if (failures.length > 0) throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_ROLLBACK_FAILED");
      started = false;
    },
  };
}
