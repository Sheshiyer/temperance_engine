import { describe, expect, test } from "bun:test";

import type { OnboardingHold, OnboardingModuleResolution, OnboardingPlanV1 } from "../src/onboarding/contracts.ts";
import { createNineRouterRoutingSurface, type NineRouterRoutingSurface } from "../src/onboarding/nine-router-provider-capabilities.ts";
import {
  OPERATOR_HEALTH_SCHEMA,
  projectOperatorHealth,
  renderOperatorHealth,
  type OperatorHealthReport,
  type OperatorInstallObservation,
} from "../src/onboarding/operator-health.ts";

const observedAt = "2026-09-19T14:00:00.000Z";
const privateMarker = "private-token-do-not-copy";

function module(id: string, overrides: Partial<OnboardingModuleResolution> = {}): OnboardingModuleResolution {
  return { id, title: privateMarker, requested: true, status: "eligible", holds: [], guided_installs: [], advisories: [], ...overrides };
}

function plan(modules = [module("core.tools")]): OnboardingPlanV1 {
  return {
    schema: "temperance.onboarding.plan.v1", version: { major: 1, minor: 0 },
    profile_id: privateMarker, generated_at: observedAt, dry_run: true, operating_mode: "ready",
    install_order: modules.filter(({ requested }) => requested).map(({ id }) => id), modules, plan_digest: "sha256:fixture",
    configuration_inputs: [{ id: privateMarker, digest: "sha256:fixture", details: [privateMarker] }],
  };
}

function hold(reason_code: OnboardingHold["reason_code"]): OnboardingHold {
  return { reason_code, message: privateMarker, remediation: [privateMarker], evidence: [privateMarker], capability_id: privateMarker, dependency_id: privateMarker };
}

function routing(): NineRouterRoutingSurface {
  return createNineRouterRoutingSurface({
    routerVersion: "0.5.75", requiredAliases: ["phase.build"],
    catalog: { providers: [{ id: privateMarker, name: privateMarker, provider: "codex", active: true }], combos: [] },
    availableModels: [{ id: `cx/${privateMarker}`, owner: "codex", kind: "provider" }],
  });
}

function check(report: OperatorHealthReport, id: string) {
  const result = report.checks.find((entry) => entry.id === id);
  expect(result).toBeDefined();
  return result!;
}

describe("pure operator health projection", () => {
  test("portable core stays eligible without Noesis or optional service observations", () => {
    const report = projectOperatorHealth({ plan: plan([
      module("core.tools"), module("integration.obsidian", { requested: false, status: "not-selected" }),
    ]) });
    expect(report.schema).toBe(OPERATOR_HEALTH_SCHEMA);
    expect(report.version).toEqual({ major: 1, minor: 0 });
    expect(report.overall_status).toBe("PASS");
    expect(report.readiness_scope).toBe("configuration-only");
    expect(report.context_capacity).toBe("unverified");
    expect(report.counts).toMatchObject({ modules_requested: 1, modules_eligible: 1, modules_not_selected: 1,
      active_modules_verified: 0, provider_records_connected: null, live_provider_models: null, required_holds: 0, required_unavailable: 0 });
    expect(check(report, "dependencies.core.tools").summary).toContain("runtime activation is unverified");
    expect(check(report, "dependencies.integration.obsidian")).toMatchObject({ status: "UNAVAILABLE", required: false });
    for (const id of ["routing.connectivity", "installation.observation", "session.admission"]) {
      expect(check(report, id)).toMatchObject({ status: "UNAVAILABLE", required: false });
    }
  });

  test("compatible binary cannot establish management connectivity or provider health", () => {
    const report = projectOperatorHealth({ plan: plan([module("provider.9router")]), routing: routing(), routingObserved: false });
    expect(report.overall_status).toBe("HOLD");
    expect(check(report, "routing.adapter")).toMatchObject({ status: "PASS", reason_code: "ROUTER_ADAPTER_COMPATIBLE" });
    expect(check(report, "routing.connectivity")).toMatchObject({ status: "HOLD", reason_code: "ROUTING_MANAGEMENT_UNAVAILABLE" });
    expect(check(report, "routing.providers").status).toBe("UNAVAILABLE");
    expect(check(report, "routing.models").status).toBe("UNAVAILABLE");
    expect(report.counts.provider_records_connected).toBeNull();
    expect(report.counts.live_provider_models).toBeNull();
  });

  test("omitted routing observation is unverified, never inferred from catalog data", () => {
    const report = projectOperatorHealth({ plan: plan([module("provider.9router")]), routing: routing() });
    expect(report.overall_status).toBe("UNAVAILABLE");
    expect(check(report, "routing.connectivity").reason_code).toBe("ROUTING_CONNECTIVITY_UNVERIFIED");
    expect(report.counts.provider_records_connected).toBeNull();
    expect(report.counts.live_provider_models).toBeNull();
  });

  test("catalog and ready seat drafts do not prove live aliases or 1M sessions", () => {
    const surface = routing();
    surface.alias_seats[0] = { alias: privateMarker, state: "ready", selected_model_ids: [privateMarker] };
    surface.provider_options.find(({ id }) => id === "codex")!.connection_ids.push("second-private-record");
    const report = projectOperatorHealth({ plan: plan([module("provider.9router")]), routing: surface, routingObserved: true });
    expect(report.overall_status).toBe("PASS");
    for (const id of ["routing.connectivity", "routing.providers", "routing.models"]) expect(check(report, id).status).toBe("PASS");
    expect(check(report, "routing.aliases")).toMatchObject({ status: "UNAVAILABLE", reason_code: "ALIAS_SELECTION_DRAFT_ONLY", verification_scope: "unverified" });
    expect(report.counts).toMatchObject({ provider_records_connected: 2, provider_options_unconnected: 14,
      live_provider_models: 1, alias_drafts: 1, alias_drafts_ready: 1, active_modules_verified: 0 });
    expect(report.context_capacity).toBe("unverified");
    expect(JSON.stringify(report)).not.toContain(privateMarker);
    expect(renderOperatorHealth(report)).not.toContain(privateMarker);
    expect(renderOperatorHealth(report)).toContain("Context capacity and active sessions remain unverified.");
  });

  test("selected routing holds on missing provider records, models, or incompatible adapter", () => {
    const surface = createNineRouterRoutingSurface({ routerVersion: "0.5.75", requiredAliases: ["phase.build"] });
    const report = projectOperatorHealth({ plan: plan([module("provider.9router")]), routing: surface, routingObserved: true });
    expect(report.overall_status).toBe("HOLD");
    expect(check(report, "routing.providers").reason_code).toBe("PROVIDER_CONNECTION_REQUIRED");
    expect(check(report, "routing.models").reason_code).toBe("LIVE_PROVIDER_MODELS_UNAVAILABLE");
    expect(report.counts.alias_drafts_held).toBe(1);
    surface.compatible = false;
    expect(check(projectOperatorHealth({ plan: plan([module("provider.9router")]), routing: surface, routingObserved: true }), "routing.adapter").status).toBe("HOLD");
  });

  test("unselected unavailable routing does not block a generic installation", () => {
    const surface = createNineRouterRoutingSurface({ routerVersion: "not-supported", requiredAliases: [] });
    const report = projectOperatorHealth({ plan: plan(), routing: surface, routingObserved: false });
    expect(report.overall_status).toBe("PASS");
    expect(report.checks.filter(({ group }) => group === "routing").every(({ required }) => !required)).toBe(true);
  });

  test("incompatible adapter counts are unknown, not fabricated zeroes", () => {
    const surface = { ...routing(), compatible: false, live_model_count: 0 };
    const report = projectOperatorHealth({ plan: plan([module("provider.9router")]), routing: surface, routingObserved: true });
    expect(check(report, "routing.connectivity").status).toBe("PASS");
    expect(report.counts.provider_records_connected).toBeNull();
    expect(report.counts.live_provider_models).toBeNull();
    expect(check(report, "routing.providers").reason_code).toBe("PROVIDER_RECORDS_UNVERIFIED");
    expect(check(report, "routing.models").verification_scope).toBe("unverified");
  });

  test("module holds retain exact known codes only and make actual alias admission authoritative", () => {
    const modules = [module("organ.hands", { status: "blocked", holds: [hold("ROUTING_COMBO_MISSING"), hold("ROUTING_COMBO_MISSING"), hold("SECRET_UNAVAILABLE")] }), module("app.obsidian")];
    const report = projectOperatorHealth({ plan: plan(modules), routing: routing(), routingObserved: true });
    expect(report.overall_status).toBe("HOLD");
    expect(report.counts).toMatchObject({ modules_held: 1, modules_eligible: 1, active_modules_verified: 0 });
    expect(report.checks.filter(({ group, status }) => group === "dependencies" && status === "HOLD").map(({ reason_code }) => reason_code))
      .toEqual(["ROUTING_COMBO_MISSING", "SECRET_UNAVAILABLE"]);
    expect(check(report, "dependencies.app.obsidian").verification_scope).toBe("prerequisites");
    expect(JSON.stringify(report)).not.toContain(privateMarker);
    expect(renderOperatorHealth(report)).not.toContain(privateMarker);
  });

  test("unsafe identifiers and unknown raw errors are redacted with stable fallback codes", () => {
    const report = projectOperatorHealth({
      plan: plan([module(`/private/${privateMarker}`, { status: "blocked", holds: [hold(privateMarker as OnboardingHold["reason_code"])] })]),
      sessionAdmission: { ok: false, reasonCode: `HTTP failed: ${privateMarker}` },
      install: { trustworthy: true, overall_condition: "FAIL", sections: [{ id: "install", condition: "FAIL", checks: [
        { id: `/private/${privateMarker}`, condition: "FAIL", reason_code: privateMarker },
      ] }] },
    });
    expect(report.checks.find(({ group }) => group === "dependencies")!.reason_code).toBe("MODULE_PREREQUISITES_UNVERIFIED");
    expect(report.checks.find(({ group }) => group === "dependencies")!.id).toMatch(/^dependencies\.redacted-[a-f0-9]{16}\./u);
    expect(check(report, "session.admission").reason_code).toBe("SESSION_ADMISSION_HELD");
    expect(JSON.stringify(report)).not.toContain(privateMarker);
    expect(renderOperatorHealth(report)).not.toContain(privateMarker);
  });

  test("install-scoped checks ignore optional host failures without copying doctor details", () => {
    const install = {
      trustworthy: true, overall_condition: "FAIL" as const,
      sections: [{ id: "install", condition: "PASS" as const, checks: [{ id: "managed-copy", condition: "PASS" as const, reason_code: privateMarker, destination: privateMarker, evidence: [privateMarker] }] },
        { id: "host", condition: "FAIL" as const, checks: [{ id: privateMarker, condition: "FAIL" as const, reason_code: privateMarker }] }],
    };
    const report = projectOperatorHealth({ plan: plan(), install });
    expect(report.overall_status).toBe("PASS");
    expect(check(report, "installation.summary").status).toBe("PASS");
    expect(check(report, "installation.check.managed-copy").reason_code).toBe("INSTALLATION_CHECK_PASSED");
    expect(JSON.stringify(report)).not.toContain(privateMarker);
    install.sections.shift();
    expect(check(projectOperatorHealth({ plan: plan(), install }), "installation.observation").reason_code).toBe("INSTALLATION_NOT_OBSERVED");
  });

  test("installation drift and untrustworthy observations hold, absent optional evidence does not", () => {
    for (const overall_condition of ["DRIFT", "FAIL"] as const) {
      expect(projectOperatorHealth({ plan: plan(), install: { trustworthy: true, overall_condition } }).overall_status).toBe("HOLD");
    }
    expect(projectOperatorHealth({ plan: plan(), install: { trustworthy: false, overall_condition: "PASS" } }).overall_status).toBe("HOLD");
    for (const overall_condition of ["WARN", "SKIPPED", "UNSUPPORTED", "PRIVATE", "UNAVAILABLE"] as const) {
      const install: OperatorInstallObservation = { trustworthy: true, overall_condition };
      expect(projectOperatorHealth({ plan: plan(), install }).overall_status).toBe("PASS");
    }
  });

  test("optional policy absence is portable core, not long-context admission", () => {
    const report = projectOperatorHealth({ plan: plan(), sessionAdmission: { ok: true, reasonCode: "OPTIONAL_SESSION_POLICY_NOT_SELECTED" } });
    expect(check(report, "session.admission")).toMatchObject({ status: "PASS", required: false, reason_code: "OPTIONAL_SESSION_POLICY_NOT_SELECTED" });
    expect(check(report, "session.admission").summary).toContain("long-context readiness is not implied");
    expect(report.context_capacity).toBe("unverified");
  });

  test("managed admission remains held despite otherwise eligible router observations", () => {
    const report = projectOperatorHealth({ plan: plan([module("provider.9router")]), routing: routing(), routingObserved: true,
      sessionAdmission: { ok: false, reasonCode: "GATEWAY_ATTEMPT_ADMISSION_UNAVAILABLE" } });
    expect(report.overall_status).toBe("HOLD");
    expect(check(report, "session.admission")).toMatchObject({ status: "HOLD", required: true, reason_code: "GATEWAY_ATTEMPT_ADMISSION_UNAVAILABLE" });
    expect(check(report, "routing.models").status).toBe("PASS");
  });

  test("an accepted gate never establishes active operation or verified context capacity", () => {
    const report = projectOperatorHealth({ plan: plan(), sessionAdmission: { ok: true, reasonCode: "accepted" } });
    expect(check(report, "session.admission")).toMatchObject({ status: "PASS", required: true, reason_code: "SESSION_ADMISSION_ACCEPTED" });
    expect(report.context_capacity).toBe("unverified");
    expect(report.counts.active_modules_verified).toBe(0);
  });

  test("stable snapshot and text are pure, counts and groups agree, and timestamp is explicit", () => {
    const input = { plan: plan([module("z.last"), module("a.first", { status: "blocked", holds: [hold("MOUNT_ABSENT")] })]), routing: routing(), routingObserved: true };
    const before = structuredClone(input);
    const report = projectOperatorHealth(input);
    expect(input).toEqual(before);
    expect(report).toEqual(projectOperatorHealth(input));
    expect(renderOperatorHealth(report)).toBe(renderOperatorHealth(projectOperatorHealth(input)));
    expect(report.checks).toEqual(projectOperatorHealth({ ...input, plan: { ...input.plan, modules: [...input.plan.modules].reverse() } }).checks);
    expect(new Set(report.checks.map(({ id }) => id)).size).toBe(report.checks.length);
    expect(report.counts.checks).toBe(report.counts.pass + report.counts.hold + report.counts.unavailable);
    expect(report.groups.flatMap(({ check_ids }) => check_ids)).toEqual(report.checks.map(({ id }) => id));
    expect(report.groups.find(({ id }) => id === "dependencies")!.status).toBe("HOLD");
    expect(renderOperatorHealth(report)).toContain("Next: Check the selected volume");
    expect(projectOperatorHealth({ ...input, observedAt: "2026-09-20T15:00:00+02:00" }).observed_at).toBe("2026-09-20T13:00:00.000Z");
    expect(() => projectOperatorHealth({ ...input, observedAt: privateMarker })).toThrow("OPERATOR_HEALTH_OBSERVED_AT_INVALID");
  });
});
