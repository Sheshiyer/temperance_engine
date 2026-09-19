import type { OnboardingCatalogV1, OnboardingPlanV1, OnboardingProbeAdapter, OnboardingProfileV1 } from "./contracts.ts";
import { NineRouterApiError, type NineRouterAvailableModel } from "./nine-router-api.ts";
import {
  createNineRouterGuidedSetupPlanInput,
  NineRouterGuidedSetupError,
  prepareNineRouterGuidedSetupCatalog,
  type NineRouterGuidedSetupApi,
  type NineRouterGuidedSetupKeychain,
} from "./nine-router-guided-setup.ts";
import { executeConfirmedNineRouterRepair, NineRouterRepairError } from "./nine-router-repair.ts";
import { compileNineRouterGuidedSetup, createNineRouterSeatingDraft, NineRouterSeatingError } from "./nine-router-seating.ts";
import { OnboardingOperationError, type OperationConfirmationV1, type OperationReceiptSink, type ResolvedExecutable } from "./operation-executor.ts";
import { createOnboardingPlan } from "./planner.ts";
import { NINE_ROUTER_SETUP_INTENT_SCHEMA, type OperationReceiptV1 } from "./public-contracts.ts";
import { createSystemProbeAdapter } from "./system-adapter.ts";

export interface WizardRouterSetupOptions {
  catalog: OnboardingCatalogV1;
  profile: OnboardingProfileV1;
  /** Actual 9Router combo names, after resolving semantic profile mappings. */
  requiredAliases: readonly string[];
  gatewayReferenceId: string;
  gatewayKeyName?: string;
  api: NineRouterGuidedSetupApi;
  keychain: NineRouterGuidedSetupKeychain;
  executable: ResolvedExecutable;
  receiptSink: OperationReceiptSink;
  selectSeats(options: { requiredAliases: readonly string[]; availableModels: readonly NineRouterAvailableModel[] }): Promise<{
    confirmed: boolean;
    combos: Array<{ alias: string; models: string[] }>;
  }>;
  confirmReview(plan: OnboardingPlanV1): Promise<{ confirmed: boolean; plan_digest: string; confirmed_at?: string }>;
  probeAdapter?: OnboardingProbeAdapter;
}

export interface WizardRouterSetupResult {
  status: "cancelled" | "held" | "committed" | "failed";
  reason_code?: string;
  receipt?: OperationReceiptV1;
}

function safeReason(error: unknown): string {
  if ((error instanceof NineRouterApiError || error instanceof NineRouterGuidedSetupError
    || error instanceof NineRouterRepairError || error instanceof NineRouterSeatingError || error instanceof OnboardingOperationError)
    && /^(?:NINE_ROUTER|OPERATION)_[A-Z0-9_]{1,120}$/u.test(error.code)) return error.code;
  return "NINE_ROUTER_WIZARD_UNAVAILABLE";
}

/**
 * Fresh combo setup using already authenticated 9Router connections. The UI
 * callbacks own their renderers sequentially; this coordinator owns no TUI,
 * setup file, credentials, provider creation intent, or session-route permit.
 */
export async function runWizardRouterSetup(options: WizardRouterSetupOptions): Promise<WizardRouterSetupResult> {
  let applying = false;
  try {
    const profile = structuredClone(options.profile);
    const aliases = [...options.requiredAliases];
    // Reuse the seat contract for alias syntax/uniqueness, even before models exist.
    createNineRouterSeatingDraft(aliases, []);
    const bound = new Set(profile.routing_aliases.map(({ combo }) => combo));
    if (aliases.some((alias) => !bound.has(alias))) return { status: "held", reason_code: "NINE_ROUTER_SETUP_REQUIRED_ALIAS_UNBOUND" };
    if ([...bound].some((alias) => !aliases.includes(alias))) return { status: "held", reason_code: "NINE_ROUTER_SETUP_PROFILE_ALIAS_UNDECLARED" };
    const gatewayReference = profile.secret_references[options.gatewayReferenceId];
    if (!gatewayReference) return { status: "held", reason_code: "NINE_ROUTER_SETUP_GATEWAY_REFERENCE_MISSING" };

    const freshModels = async (): Promise<NineRouterAvailableModel[]> => {
      const [catalog, keys, models] = await Promise.all([
        options.api.readCatalog(), options.api.readGatewayKeys(), options.api.readAvailableModels(),
      ]);
      // Existing objects are never silently replaced or adopted by fresh setup.
      if (catalog.combos.some(({ alias }) => aliases.includes(alias))) throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_COMBO_CONFLICT");
      if (catalog.combos.length > 0 || keys.length > 0) throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_STATE_NOT_EMPTY");
      if (!models.some(({ kind }) => kind === "provider")) throw new NineRouterSeatingError("NINE_ROUTER_SEATING_MODEL_UNAVAILABLE");
      if (await options.keychain.has(gatewayReference)) throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_GATEWAY_REFERENCE_OCCUPIED");
      return models;
    };

    const availableModels = await freshModels();
    createNineRouterSeatingDraft(aliases, availableModels);
    const selected = await options.selectSeats({ requiredAliases: [...aliases], availableModels: structuredClone(availableModels) });
    if (!selected.confirmed) return { status: "cancelled" };
    if (selected.combos.length !== aliases.length || new Set(selected.combos.map(({ alias }) => alias)).size !== aliases.length
      || selected.combos.some(({ alias }) => !aliases.includes(alias))) {
      return { status: "held", reason_code: "NINE_ROUTER_SETUP_REQUIRED_ALIASES_INVALID" };
    }

    // The user may spend time seating models. Re-observe before the apply review
    // and let the existing effector repeat its live checks before every write.
    const currentModels = await freshModels();
    const desired = compileNineRouterGuidedSetup({
      schema: NINE_ROUTER_SETUP_INTENT_SCHEMA,
      version: { major: 1, minor: 0 },
      providers: [],
      gateway_key: { name: options.gatewayKeyName ?? `Temperance ${profile.id}`, secret_reference_id: options.gatewayReferenceId },
    }, createNineRouterSeatingDraft(aliases, currentModels, Object.fromEntries(selected.combos.map(({ alias, models }) => [alias, models]))));
    const catalog = prepareNineRouterGuidedSetupCatalog(options.catalog, desired, profile);
    const plan = await createOnboardingPlan({
      catalog, profile, adapter: options.probeAdapter ?? createSystemProbeAdapter(),
      selections: new Set(["provider.9router"]), dryRun: false,
      configurationInputs: [createNineRouterGuidedSetupPlanInput(desired, profile)],
    });
    if (plan.operating_mode !== "ready" || plan.install_order.length !== 1 || plan.install_order[0] !== "provider.9router") {
      return { status: "held", reason_code: "NINE_ROUTER_WIZARD_PLAN_BLOCKED" };
    }
    const review = await options.confirmReview(structuredClone(plan));
    if (!review.confirmed) return { status: "cancelled" };
    if (review.plan_digest !== plan.plan_digest || !review.confirmed_at || !Number.isFinite(Date.parse(review.confirmed_at))) {
      return { status: "held", reason_code: "OPERATION_CONFIRMATION_MISMATCH" };
    }
    const confirmation: OperationConfirmationV1 = { confirmed: true, plan_digest: plan.plan_digest, confirmed_at: review.confirmed_at };

    // Fresh setup must not overwrite a gateway reference that appeared while
    // the review was open. Presence checks are metadata-only, never secret reads.
    const assertUnoccupied = async (): Promise<false> => {
      if (await options.keychain.has(gatewayReference)) throw new NineRouterGuidedSetupError("NINE_ROUTER_SETUP_GATEWAY_REFERENCE_OCCUPIED");
      return false;
    };
    await assertUnoccupied();
    applying = true;
    const receipt = await executeConfirmedNineRouterRepair({
      plan, profile, confirmation, desired, api: options.api,
      keychain: {
        has: assertUnoccupied,
        read: (reference) => options.keychain.read(reference),
        put: async (reference, secret) => { await assertUnoccupied(); await options.keychain.put(reference, secret); },
        delete: (reference) => options.keychain.delete(reference),
      },
      executable: options.executable, receiptSink: options.receiptSink,
    });
    return { status: receipt.status === "committed" ? "committed" : "failed", ...(receipt.failure_code ? { reason_code: receipt.failure_code } : {}), receipt };
  } catch (error) {
    return { status: applying ? "failed" : "held", reason_code: safeReason(error) };
  }
}
