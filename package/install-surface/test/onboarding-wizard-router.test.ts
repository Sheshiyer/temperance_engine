import { describe, expect, test } from "bun:test";

import { createCoreOnboardingCatalog, createCoreOnboardingProfile } from "../src/onboarding/core-catalog.ts";
import type { OnboardingPlanV1 } from "../src/onboarding/contracts.ts";
import type { NineRouterAvailableModel, NineRouterCatalogSnapshot, NineRouterComboDetail } from "../src/onboarding/nine-router-api.ts";
import type { NineRouterGuidedSetupApi } from "../src/onboarding/nine-router-guided-setup.ts";
import type { OperationReceiptV1 } from "../src/onboarding/public-contracts.ts";
import { runWizardRouterSetup, type WizardRouterSetupOptions } from "../src/onboarding/wizard-router-setup.ts";

function fixture() {
  const profile = createCoreOnboardingProfile();
  profile.id = "wizard-fixture";
  profile.variables = {
    NINE_ROUTER_DATA_DIR: "/example/router",
    NINE_ROUTER_HEALTH_URL: "http://127.0.0.1:20128/health",
    NINE_ROUTER_CLI_ENTRYPOINT: "/example/router/cli.js",
  };
  profile.routing_aliases = [{ alias: "phase.build", combo: "work-build" }];
  profile.secret_references = { GATEWAY: { store: "macos-keychain", service: "fixture.gateway", account: "fixture" } };
  const catalog = createCoreOnboardingCatalog();
  catalog.modules.push({ id: "unrelated", title: "Unrelated", summary: "Must not be applied", preselection: "selected", depends_on: [],
    requires: [{ id: "unrelated-path", kind: "path", path_variable: "MISSING", path_type: "directory", access: "readable" }], guided_installs: [] });
  const providers: NineRouterCatalogSnapshot["providers"] = [{ id: "oauth-existing", name: "Existing OAuth", provider: "codex", active: true }];
  const combos: NineRouterCatalogSnapshot["combos"] = [];
  const keys: Array<{ id: string; name: string }> = [];
  const details = new Map<string, NineRouterComboDetail>();
  const calls: string[] = [];
  const models: NineRouterAvailableModel[] = [{ id: "cx/model-one", owner: "codex", kind: "provider" }, { id: "cx/model-two", owner: "codex", kind: "provider" }];
  const receipts: OperationReceiptV1[] = [];
  let reviewed: OnboardingPlanV1 | undefined;
  let approved = false;
  let gatewaySecret: string | undefined;
  let distortReadback = false;
  const mutation = (name: string): void => { expect(approved).toBe(true); calls.push(name); };
  const api: NineRouterGuidedSetupApi = {
    readCatalog: async () => { calls.push("read-catalog"); return structuredClone({ providers, combos }); },
    readAvailableModels: async () => { calls.push("read-models"); return structuredClone(models); },
    readGatewayKeys: async () => { calls.push("read-keys"); return structuredClone(keys); },
    createProviderConnection: async () => { throw new Error("MUST_NOT_CREATE_PROVIDER"); },
    deleteProviderConnection: async () => { throw new Error("MUST_NOT_DELETE_PROVIDER"); },
    createCombo: async ({ name, models: members }) => {
      mutation("create-combo");
      const created = { id: "created-combo", name };
      combos.push({ id: created.id, alias: name, model_count: members.length });
      details.set(created.id, { id: created.id, alias: name, models: [...members] });
      return created;
    },
    readCombo: async (id) => {
      calls.push("read-combo");
      const detail = structuredClone(details.get(id)!);
      if (distortReadback) detail.models.reverse();
      return detail;
    },
    deleteCombo: async (id) => {
      mutation("delete-combo");
      const index = combos.findIndex((combo) => combo.id === id);
      if (index >= 0) combos.splice(index, 1);
      details.delete(id);
    },
    createGatewayKey: async (name, capture) => {
      mutation("create-key");
      const created = { id: "created-key", name };
      keys.push(created);
      await capture("fixture-not-real-secret");
      return { ...created, captured: true };
    },
    deleteGatewayKey: async (id) => {
      mutation("delete-key");
      const index = keys.findIndex((key) => key.id === id);
      if (index >= 0) keys.splice(index, 1);
    },
  };
  const options: WizardRouterSetupOptions = {
    catalog, profile, requiredAliases: ["work-build"], gatewayReferenceId: "GATEWAY", api,
    keychain: {
      has: async () => { calls.push("keychain-has"); return gatewaySecret !== undefined; },
      read: async () => { throw new Error("MUST_NOT_READ_EXISTING_SECRET"); },
      put: async (_reference, secret) => { mutation("keychain-put"); gatewaySecret = secret; },
      delete: async () => { mutation("keychain-delete"); gatewaySecret = undefined; return true; },
    },
    executable: { id: "9router", path: "/example/router/cli.js", version: "0.5.75" },
    receiptSink: { write: async (receipt) => { mutation("receipt"); receipts.push(receipt); } },
    probeAdapter: {
      probe: async ({ id }) => { calls.push(`probe:${id}`); return { capability_id: id, available: true, reason_code: "AVAILABLE", evidence: [] }; },
    },
    selectSeats: async ({ requiredAliases, availableModels }) => {
      calls.push("select-seats");
      expect(requiredAliases).toEqual(["work-build"]);
      expect(availableModels.map(({ id }) => id)).toEqual(["cx/model-one", "cx/model-two"]);
      expect(calls.some((call) => /^(create|delete|keychain-put|receipt)/u.test(call))).toBe(false);
      return { confirmed: true, combos: [{ alias: "work-build", models: ["cx/model-two", "cx/model-one"] }] };
    },
    confirmReview: async (plan) => {
      calls.push("review"); reviewed = plan;
      expect(calls.some((call) => /^(create|delete|keychain-put|receipt)/u.test(call))).toBe(false);
      approved = true;
      return { confirmed: true, plan_digest: plan.plan_digest, confirmed_at: "2026-09-19T10:00:00Z" };
    },
  };
  return { options, calls, models, providers, combos, keys, details, receipts,
    reviewed: () => reviewed,
    gatewaySecret: () => gatewaySecret,
    occupyGateway: () => { gatewaySecret = "existing-secret"; },
    distortReadback: () => { distortReadback = true; },
  };
}

const mutations = (calls: string[]) => calls.filter((call) => /^(create|delete|keychain-put|keychain-delete|receipt)/u.test(call));

describe("in-process wizard router setup", () => {
  test("reviews exact router-only configuration and preserves authenticated OAuth providers", async () => {
    const f = fixture();
    const result = await runWizardRouterSetup(f.options);
    expect(result.status).toBe("committed");
    expect(result.receipt).toMatchObject({ status: "committed", module_ids: ["provider.9router"], rollback_status: "not-required" });
    const plan = f.reviewed()!;
    expect(plan.dry_run).toBe(false);
    expect(plan.install_order).toEqual(["provider.9router"]);
    expect(plan.modules.find(({ id }) => id === "unrelated")?.status).toBe("not-selected");
    expect(plan.configuration_inputs).toHaveLength(1);
    expect(plan.configuration_inputs![0]!.id).toBe("9router-guided-setup");
    expect(plan.configuration_inputs![0]!.details.some((detail) => detail.startsWith("provider "))).toBe(false);
    const comboReview = plan.configuration_inputs![0]!.details.find((detail) => detail.startsWith("combo work-build: "))!;
    expect(JSON.parse(comboReview.slice("combo work-build: ".length))).toEqual(["cx/model-two", "cx/model-one"]);
    expect(f.providers).toEqual([{ id: "oauth-existing", name: "Existing OAuth", provider: "codex", active: true }]);
    expect(f.details.get("created-combo")?.models).toEqual(["cx/model-two", "cx/model-one"]);
    expect(f.keys).toEqual([{ id: "created-key", name: "Temperance wizard-fixture" }]);
    expect(f.gatewaySecret()).toBe("fixture-not-real-secret");
    expect(f.receipts).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("fixture-not-real-secret");
    expect(mutations(f.calls)).toEqual(["create-combo", "create-key", "keychain-put", "receipt"]);
  });

  test("seat cancellation produces no review, writes, or credential reads", async () => {
    const f = fixture();
    f.options.selectSeats = async () => ({ confirmed: false, combos: [] });
    expect(await runWizardRouterSetup(f.options)).toEqual({ status: "cancelled" });
    expect(f.reviewed()).toBeUndefined();
    expect(mutations(f.calls)).toEqual([]);
  });

  test("review cancellation produces no writes or receipt", async () => {
    const f = fixture();
    f.options.confirmReview = async (plan) => ({ confirmed: false, plan_digest: plan.plan_digest });
    expect(await runWizardRouterSetup(f.options)).toEqual({ status: "cancelled" });
    expect(mutations(f.calls)).toEqual([]);
  });

  test("mismatched or missing confirmation cannot invoke repair", async () => {
    for (const wrong of ["digest", "timestamp"] as const) {
      const f = fixture();
      f.options.confirmReview = async (plan) => ({ confirmed: true, plan_digest: wrong === "digest" ? "sha256:wrong" : plan.plan_digest, ...(wrong === "digest" ? { confirmed_at: "2026-09-19T10:00:00Z" } : {}) });
      expect(await runWizardRouterSetup(f.options)).toEqual({ status: "held", reason_code: "OPERATION_CONFIRMATION_MISMATCH" });
      expect(mutations(f.calls)).toEqual([]);
    }
  });

  test("no current provider model holds before opening seating", async () => {
    for (const modelKind of ["empty", "combo"] as const) {
      const f = fixture();
      if (modelKind === "empty") f.models.length = 0;
      else for (const model of f.models) model.kind = "combo";
      expect(await runWizardRouterSetup(f.options)).toEqual({ status: "held", reason_code: "NINE_ROUTER_SEATING_MODEL_UNAVAILABLE" });
      expect(f.calls).not.toContain("select-seats");
      expect(mutations(f.calls)).toEqual([]);
    }
  });

  test("existing aliases, unrelated combos, and gateway keys hold before review or mutation", async () => {
    for (const object of ["alias", "other-combo", "key"] as const) {
      const f = fixture();
      if (object === "key") f.keys.push({ id: "existing-key", name: "Existing gateway" });
      else f.combos.push({ id: "existing-combo", alias: object === "alias" ? "work-build" : "unrelated", model_count: 1 });
      expect(await runWizardRouterSetup(f.options)).toEqual({ status: "held", reason_code: object === "alias" ? "NINE_ROUTER_SETUP_COMBO_CONFLICT" : "NINE_ROUTER_SETUP_STATE_NOT_EMPTY" });
      expect(f.calls).not.toContain("select-seats");
      expect(f.calls).not.toContain("keychain-has");
      expect(mutations(f.calls)).toEqual([]);
    }
  });

  test("occupied gateway Keychain reference is never overwritten", async () => {
    const f = fixture(); f.occupyGateway();
    expect(await runWizardRouterSetup(f.options)).toEqual({ status: "held", reason_code: "NINE_ROUTER_SETUP_GATEWAY_REFERENCE_OCCUPIED" });
    expect(f.gatewaySecret()).toBe("existing-secret");
    expect(mutations(f.calls)).toEqual([]);
  });

  test("models disappearing during seating hold before the exact apply review", async () => {
    const f = fixture();
    f.options.selectSeats = async () => { f.models.pop(); return { confirmed: true, combos: [{ alias: "work-build", models: ["cx/model-two"] }] }; };
    expect(await runWizardRouterSetup(f.options)).toEqual({ status: "held", reason_code: "NINE_ROUTER_SEATING_MODEL_UNAVAILABLE" });
    expect(f.reviewed()).toBeUndefined();
    expect(mutations(f.calls)).toEqual([]);
  });

  test("requires all mapped combo names and a bound gateway reference", async () => {
    for (const mismatch of ["unknown", "missing", "reference"] as const) {
      const f = fixture();
      if (mismatch === "unknown") f.options.requiredAliases = ["phase.build"];
      if (mismatch === "missing") f.options.profile.routing_aliases.push({ alias: "phase.observe", combo: "work-observe" });
      if (mismatch === "reference") f.options.gatewayReferenceId = "MISSING";
      const result = await runWizardRouterSetup(f.options);
      expect(result.status).toBe("held");
      expect(f.calls).toEqual([]);
    }
  });

  test("forged or incomplete seating cannot skip mapped aliases", async () => {
    for (const combos of [[], [{ alias: "unknown", models: ["cx/model-one"] }], [{ alias: "work-build", models: [] }]]) {
      const f = fixture();
      f.options.selectSeats = async () => ({ confirmed: true, combos });
      expect((await runWizardRouterSetup(f.options)).status).toBe("held");
      expect(f.reviewed()).toBeUndefined();
      expect(mutations(f.calls)).toEqual([]);
    }
  });

  test("blocked runtime requirements never expose an apply confirmation", async () => {
    const f = fixture();
    f.options.probeAdapter = { probe: async ({ id }) => ({ capability_id: id, available: false, reason_code: "BINARY_MISSING", evidence: [] }) };
    expect(await runWizardRouterSetup(f.options)).toEqual({ status: "held", reason_code: "NINE_ROUTER_WIZARD_PLAN_BLOCKED" });
    expect(f.reviewed()).toBeUndefined();
    expect(mutations(f.calls)).toEqual([]);
  });

  test("apply rechecks objects created during review and leaves them untouched", async () => {
    const f = fixture();
    const confirm = f.options.confirmReview;
    f.options.confirmReview = async (plan) => {
      f.combos.push({ id: "concurrent-combo", alias: "work-build", model_count: 1 });
      return confirm(plan);
    };
    const result = await runWizardRouterSetup(f.options);
    expect(result).toMatchObject({ status: "failed", reason_code: "NINE_ROUTER_SETUP_COMBO_CONFLICT", receipt: { rollback_status: "completed" } });
    expect(f.combos).toEqual([{ id: "concurrent-combo", alias: "work-build", model_count: 1 }]);
    expect(mutations(f.calls)).toEqual(["receipt"]);
  });

  test("a gateway reference populated during review holds before API writes", async () => {
    const f = fixture(); const confirm = f.options.confirmReview;
    f.options.confirmReview = async (plan) => { f.occupyGateway(); return confirm(plan); };
    expect(await runWizardRouterSetup(f.options)).toEqual({ status: "held", reason_code: "NINE_ROUTER_SETUP_GATEWAY_REFERENCE_OCCUPIED" });
    expect(mutations(f.calls)).toEqual([]);
    expect(f.gatewaySecret()).toBe("existing-secret");
  });

  test("failed membership readback rolls back only newly created objects, preserving OAuth", async () => {
    const f = fixture(); f.distortReadback();
    expect(await runWizardRouterSetup(f.options)).toMatchObject({ status: "failed", receipt: { failure_code: "NINE_ROUTER_SETUP_COMBO_MEMBERSHIP_READBACK_MISMATCH", rollback_status: "completed" } });
    expect(f.providers).toEqual([{ id: "oauth-existing", name: "Existing OAuth", provider: "codex", active: true }]);
    expect(f.combos).toEqual([]);
    expect(f.keys).toEqual([]);
    expect(f.gatewaySecret()).toBeUndefined();
    expect(f.receipts).toHaveLength(1);
  });

  test("raw connection failures are never exposed in wizard results", async () => {
    const f = fixture();
    f.options.api.readCatalog = async () => { throw new Error("private-token=do-not-return"); };
    const result = await runWizardRouterSetup(f.options);
    expect(result).toEqual({ status: "held", reason_code: "NINE_ROUTER_WIZARD_UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(mutations(f.calls)).toEqual([]);
  });
});
