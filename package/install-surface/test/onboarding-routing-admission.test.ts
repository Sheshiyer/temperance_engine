import { describe, expect, test } from "bun:test";

import {
  ONBOARDING_CATALOG_SCHEMA,
  ONBOARDING_PROFILE_SCHEMA,
  type OnboardingProfileV1,
} from "../src/onboarding/contracts.ts";
import {
  NineRouterApiClient,
  NineRouterApiError,
  type NineRouterAvailableModel,
  type NineRouterCatalogSnapshot,
  type NineRouterComboDetail,
} from "../src/onboarding/nine-router-api.ts";
import { createOnboardingPlan } from "../src/onboarding/planner.ts";
import { createSystemProbeAdapter, type OnboardingRouterApi } from "../src/onboarding/system-adapter.ts";

const requirement = { id: "hands.route", kind: "routing-alias", alias: "worker" } as const;

function profile(): OnboardingProfileV1 {
  return {
    schema: ONBOARDING_PROFILE_SCHEMA,
    version: { major: 1, minor: 0 },
    id: "portable-routing-test",
    variables: { NINE_ROUTER_DATA_DIR: "/example/router", NINE_ROUTER_HEALTH_URL: "http://127.0.0.1:20128/api/health" },
    secret_references: {},
    preselected_modules: [],
    routing_aliases: [{ alias: "worker", combo: "portable-build" }],
    project_enrollments: [],
  };
}

function fixture() {
  const catalog: NineRouterCatalogSnapshot = {
    providers: [{ id: "connection", provider: "test-provider", name: "private name", active: true }],
    combos: [{ id: "combo-id", alias: "portable-build", model_count: 1 }],
  };
  const detail: NineRouterComboDetail = { id: "combo-id", alias: "portable-build", models: ["test-provider/model"] };
  const models: NineRouterAvailableModel[] = [{ id: "test-provider/model", owner: "test-provider", kind: "provider" }];
  const calls: string[] = [];
  const api: OnboardingRouterApi = {
    readCatalog: async () => { calls.push("catalog"); return catalog; },
    readAvailableModels: async () => { calls.push("models"); return models; },
    readCombo: async (id) => { calls.push(`detail:${id}`); return detail; },
  };
  const adapter = createSystemProbeAdapter({ routerApiFactory: (config) => {
    expect(config).toEqual({ dataDirectory: "/example/router", baseUrl: "http://127.0.0.1:20128" });
    calls.push("factory");
    return api;
  } });
  const probe = (input = profile(), signal = new AbortController().signal) => adapter.probe(requirement, { profile: input, signal });
  return { catalog, detail, models, calls, api, adapter, probe };
}

describe("live routing-alias admission", () => {
  test("resolves the exact mapped combo and labels the limited membership evidence", async () => {
    const f = fixture();
    const result = await f.probe();
    expect(result.available).toBe(true);
    expect(result.evidence).toEqual([
      "live routing alias and provider-model membership verified",
      "catalog membership only; context, quota, tool use and inference health are not verified",
    ]);
    expect(f.calls).toEqual(["factory", "catalog", "models", "detail:combo-id"]);
    expect(JSON.stringify(result)).not.toContain("private name");
  });

  test("a declared but missing live combo stays held", async () => {
    const f = fixture();
    f.catalog.combos[0]!.alias = "worker"; // Semantic name is not the bound combo name.
    expect((await f.probe()).reason_code).toBe("ROUTING_COMBO_MISSING");
    expect(f.calls).not.toContain("detail:combo-id");
  });

  test("a declared but empty combo stays held", async () => {
    const f = fixture();
    f.catalog.combos[0]!.model_count = 0;
    f.detail.models = [];
    expect((await f.probe()).reason_code).toBe("ROUTING_COMBO_EMPTY");
  });

  test("every fallback member must be in the current provider-model catalog", async () => {
    const f = fixture();
    f.catalog.combos[0]!.model_count = 2;
    f.detail.models.push("disconnected/model");
    expect((await f.probe()).reason_code).toBe("ROUTING_MODEL_UNAVAILABLE");
  });

  test("rejects nested combos even when their names collide with a provider model", async () => {
    for (const via of ["catalog", "models"] as const) {
      const f = fixture();
      if (via === "catalog") f.catalog.combos.push({ id: "nested-id", alias: "test-provider/model", model_count: 1 });
      else f.models[0]!.kind = "combo";
      expect((await f.probe()).reason_code).toBe("ROUTING_MODEL_NESTED");
    }
  });

  test("missing or duplicate profile aliases are held before accessing the API", async () => {
    const f = fixture();
    const missing = profile();
    missing.routing_aliases = [];
    expect((await f.probe(missing)).reason_code).toBe("ROUTING_ALIAS_MISSING");
    const duplicate = profile();
    duplicate.routing_aliases.push({ alias: "worker", combo: "second" });
    expect((await f.probe(duplicate)).reason_code).toBe("ROUTING_ALIAS_AMBIGUOUS");
    expect(f.calls).toEqual([]);
  });

  test("duplicate live combo aliases are held before reading detail", async () => {
    const f = fixture();
    f.catalog.combos.push({ ...f.catalog.combos[0]!, id: "duplicate" });
    expect((await f.probe()).reason_code).toBe("ROUTING_COMBO_AMBIGUOUS");
    expect(f.calls).not.toContain("detail:combo-id");
  });

  test("identity and member-count changes between catalog and detail are held", async () => {
    for (const change of ["id", "alias", "count"] as const) {
      const f = fixture();
      if (change === "count") f.catalog.combos[0]!.model_count = 2;
      else f.detail[change] = "changed";
      expect((await f.probe()).reason_code).toBe("ROUTING_COMBO_CHANGED");
    }
  });

  test("duplicate live model identities and combo members are held", async () => {
    for (const duplicate of ["catalog", "members"] as const) {
      const f = fixture();
      if (duplicate === "catalog") f.models.push({ ...f.models[0]! });
      else { f.detail.models.push(f.detail.models[0]!); f.catalog.combos[0]!.model_count = 2; }
      expect((await f.probe()).reason_code).toBe("ROUTING_RESPONSE_INVALID");
    }
  });

  test("missing or unusable configuration never instantiates the router client", async () => {
    const f = fixture();
    for (const variable of ["NINE_ROUTER_DATA_DIR", "NINE_ROUTER_HEALTH_URL"]) {
      const input = profile();
      delete input.variables[variable];
      expect((await f.probe(input)).reason_code).toBe("VARIABLE_MISSING");
    }
    for (const path of ["relative", "/", "/example/../router", "/example\0/router"]) {
      const input = profile();
      input.variables.NINE_ROUTER_DATA_DIR = path;
      expect((await f.probe(input)).reason_code).toBe("VARIABLE_INVALID");
    }
    for (const url of ["invalid", "http://example.com:20128", "http://127.0.0.1:8080", "https://127.0.0.1:20128", "http://user:secret@127.0.0.1:20128", "http://127.0.0.1:20128/?token=secret"]) {
      const input = profile();
      input.variables.NINE_ROUTER_HEALTH_URL = url;
      expect((await f.probe(input)).reason_code).toBe("VARIABLE_INVALID");
    }
    expect(f.calls).toEqual([]);
  });

  test("network, authentication, and response failures are held without leaking errors", async () => {
    for (const [error, reason] of [
      [new Error("secret=private-credential"), "ROUTING_API_UNAVAILABLE"],
      [new NineRouterApiError("NINE_ROUTER_API_UNAVAILABLE"), "ROUTING_API_UNAVAILABLE"],
      [new NineRouterApiError("NINE_ROUTER_AUTH_METADATA_MISSING"), "ROUTING_AUTH_UNAVAILABLE"],
      [new NineRouterApiError("NINE_ROUTER_CLI_SECRET_MODE_UNSAFE"), "ROUTING_AUTH_UNAVAILABLE"],
      [new NineRouterApiError("NINE_ROUTER_API_HTTP_403"), "ROUTING_AUTH_UNAVAILABLE"],
      [new NineRouterApiError("NINE_ROUTER_RESPONSE_INVALID"), "ROUTING_RESPONSE_INVALID"],
    ] as const) {
      const f = fixture();
      f.api.readCatalog = async () => { throw error; };
      const result = await f.probe();
      expect(result.available).toBe(false);
      expect(result.reason_code).toBe(reason);
      expect(JSON.stringify(result)).not.toContain(error.message);
    }
  });

  test("reprobes current state instead of retaining a successful result", async () => {
    const f = fixture();
    expect((await f.probe()).available).toBe(true);
    f.models.length = 0;
    expect((await f.probe()).reason_code).toBe("ROUTING_MODEL_UNAVAILABLE");
    expect(f.calls.filter((call) => call === "catalog")).toHaveLength(2);
  });

  test("cancellation fails closed without waiting for an unfinished read", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.api.readCatalog = () => new Promise(() => {});
    const result = f.probe(profile(), controller.signal);
    controller.abort();
    expect((await result).reason_code).toBe("PROBE_FAILED");
    expect(f.calls).not.toContain("detail:combo-id");
    f.calls.length = 0;
    expect((await f.probe(profile(), controller.signal)).available).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("portable core does not instantiate or probe 9Router", async () => {
    const f = fixture();
    const input = profile();
    input.variables = {};
    input.routing_aliases = [];
    const plan = await createOnboardingPlan({
      profile: input,
      adapter: f.adapter,
      catalog: {
        schema: ONBOARDING_CATALOG_SCHEMA, version: { major: 1, minor: 0 },
        modules: [{ id: "core", title: "Portable core", summary: "No personal integrations required", preselection: "selected", depends_on: [], requires: [], guided_installs: [] }],
      },
    });
    expect(plan.operating_mode).toBe("ready");
    expect(f.calls).toEqual([]);
  });

  test("blocked alias admission supplies actionable module remediation", async () => {
    const f = fixture();
    f.models.length = 0;
    const plan = await createOnboardingPlan({
      profile: profile(), adapter: f.adapter,
      catalog: {
        schema: ONBOARDING_CATALOG_SCHEMA, version: { major: 1, minor: 0 },
        modules: [{ id: "hands", title: "Hands", summary: "Optional routed worker", preselection: "selected", depends_on: [], requires: [requirement], guided_installs: [] }],
      },
    });
    expect(plan.operating_mode).toBe("blocked");
    expect(plan.install_order).toEqual([]);
    expect(plan.modules[0]!.holds[0]!.reason_code).toBe("ROUTING_MODEL_UNAVAILABLE");
    expect(plan.modules[0]!.holds[0]!.remediation[0]).toContain("live model catalog");
  });

  test("uses the real API client in read-only mode and excludes disconnected provider models", async () => {
    const requests: string[] = [];
    const adapter = createSystemProbeAdapter({ routerApiFactory: (config) => new NineRouterApiClient({ ...config, io: {
      readFile: async (path) => path.endsWith("machine-id") ? "test-machine" : "test-private-secret",
      mode: async () => 0o600,
      fetch: async (url, init) => {
        expect(init.method).toBe("GET");
        const path = new URL(url).pathname;
        requests.push(path);
        const responses: Record<string, unknown> = {
          "/api/providers": { connections: [{ id: "connection", provider: "test-provider", name: "private name", isActive: false }] },
          "/api/combos": { combos: [{ id: "combo-id", name: "portable-build", models: ["test-provider/model"] }] },
          "/api/combos/combo-id": { id: "combo-id", name: "portable-build", models: ["test-provider/model"] },
          "/v1/models": { data: [{ id: "test-provider/model", owned_by: "test-provider" }] },
        };
        return Response.json(responses[path]);
      },
    } }) });
    const result = await adapter.probe(requirement, { profile: profile(), signal: new AbortController().signal });
    expect(result.reason_code).toBe("ROUTING_MODEL_UNAVAILABLE");
    expect(requests).toContain("/api/combos/combo-id");
    expect(requests).toContain("/v1/models");
    expect(JSON.stringify(result)).not.toContain("test-private-secret");
  });
});
