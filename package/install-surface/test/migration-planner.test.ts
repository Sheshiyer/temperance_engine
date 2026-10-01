import { describe, expect, test } from "bun:test";
import { createCoreOnboardingCatalog } from "../src/onboarding/core-catalog.ts";
import { workstationSnapshot, makeExpectedContext, fakeDigest } from "./migration-fixtures.ts";
import {
  createMigrationPlan, calculateMigrationDigest, calculateMigrationPlanDigest,
  calculateMigrationInputDigests, calculateMigrationEffectDigests, validateMigrationPlan, verifyMigrationPlanDigest,
  assertMigrationPlanContext,
  type CreateMigrationPlanOptions, type MigrationPlanV1, type MigrationPlanReviewContext,
} from "../src/migration/planner.ts";

function fixture(profile: "workstation" | "always-on-node" = "workstation"): CreateMigrationPlanOptions {
  const base: Omit<CreateMigrationPlanOptions, "source_context"> = {
    snapshot: structuredClone(workstationSnapshot),
    target: { schema: "temperance.migration.target.v1" as const, version: { major: 1, minor: 0 }, target_profile: profile,
      destination_id: "destination:fixture", compatibility_check_only: true, requested_modules: ["core.fixture"], held_requirements: [] },
    profile, selected_modules: ["core.fixture"], backend: "none" as const,
    catalog: { ...createCoreOnboardingCatalog(), modules: [{ id: "core.fixture", title: "Fixture", summary: "Owned fixture", preselection: "available" as const,
      depends_on: [], requires: [], guided_installs: [] }, ...createCoreOnboardingCatalog().modules] },
    host_profile: { schema: "temperance.host-profile.v1" as const, version: { major: 1 as const, minor: 0 as const }, id: "fixture",
      variables: [{ name: "STATE_ROOT", kind: "absolute-path" as const, required: true }], secret_references: [],
      preselected_modules: ["provider.9router"], required_routing_aliases: [] },
    private_binding: { schema: "temperance.host-binding.v1" as const, version: { major: 1 as const, minor: 0 as const }, profile_id: "fixture",
      variables: { STATE_ROOT: ["", "private", "fixture", "temperance"].join("/") }, secret_references: {}, routing_aliases: [], volume_bindings: [] },
    module_bindings: [{ module_id: "core.fixture", owner: "temperance", version: "1.0.0", source_digest: fakeDigest("fixture-module"),
      destinations: [{ id: "config.fixture", root_ref: "STATE_ROOT", relative_path: "config/fixture.json", effect: "configuration-create" as const,
        prepared_digest: fakeDigest("prepared"), preimage_digest: fakeDigest("absent"), mode: 384 }], runtime_requirements: [] }],
    destination: { destination_id: "destination:fixture", issued_device_ref: "device:fixture-issued", identity_digest: fakeDigest("destination-identity"),
      platform: "darwin", architecture: "arm64", free_bytes: 8192, required_bytes: 1024, port_20128: "free" as const,
      roots: [{ root_ref: "STATE_ROOT", owner: "temperance", identity_digest: fakeDigest("root-identity"), state: "available" as const }], runtime_environments: [] },
    observations: [], expected_context: makeExpectedContext({ required_work_ids: ["work:modular-mac-phase-a"], required_organ_ids: [] }),
    now: "2026-10-01T00:00:02Z",
  };
  const digests = calculateMigrationInputDigests(base);
  return { ...base, source_context: { ...digests, destination_id: base.destination.destination_id, issued_device_ref: base.destination.issued_device_ref,
    profile, backend: base.backend, selected_modules: [...base.selected_modules], pinned_at: "2026-10-01T00:00:01Z", expires_at: "2026-10-02T00:00:00Z" } };
}
function rebind(options: CreateMigrationPlanOptions): void {
  Object.assign(options.source_context, calculateMigrationInputDigests(options), {
    profile: options.profile, backend: options.backend, selected_modules: [...options.selected_modules],
    destination_id: options.destination.destination_id, issued_device_ref: options.destination.issued_device_ref,
  });
}
// Synthetic independent review is issued only after the final plan exists.
function reviewAfterPlan(options: CreateMigrationPlanOptions, plan: MigrationPlanV1): MigrationPlanReviewContext {
  const { pinned_at: _pinned, expires_at: _sourceExpiry, ...bindings } = options.source_context;
  return { ...bindings, plan_digest: plan.plan_digest, reviewed_at: "2026-10-01T00:00:03Z", expires_at: "2026-10-03T00:00:00Z" };
}
async function held(options: CreateMigrationPlanOptions, reason: string) {
  const plan = await createMigrationPlan(options);
  expect(plan.holds.some((hold) => hold.reason === reason)).toBe(true);
  expect(plan.steps).toEqual([]);
  expect(plan.execution_authorized).toBe(false);
  return plan;
}

describe("pure migration planner", () => {
  for (const profile of ["workstation", "always-on-node"] as const) test(`${profile} composes a minimal owned flow without optionals or Snow Gloves`, async () => {
    const options = fixture(profile);
    const plan = await createMigrationPlan(options);
    expect(plan.holds).toEqual([]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.status).toBe("PROPOSED");
    expect(plan.execution_authorized).toBe(false);
    expect(plan.selected_modules).toEqual(["core.fixture"]);
    expect(plan.observations.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan)).not.toContain(options.private_binding.variables.STATE_ROOT);
    expect(JSON.stringify(plan)).not.toContain("guided_installs");
    expect(validateMigrationPlan(plan)).toBe(true);
    expect(verifyMigrationPlanDigest(plan)).toBe(true);
    expect(calculateMigrationEffectDigests(plan.steps, plan).prepared_intent_digest).toBe(plan.prepared_intent_digest);
    expect(() => assertMigrationPlanContext(plan, reviewAfterPlan(options, plan), "2026-10-01T00:00:04Z")).not.toThrow();
  });

  test("deterministic object key and set ordering, no wall clock dependency", async () => {
    const options = fixture();
    expect(calculateMigrationDigest({ b: 2, a: 1 })).toBe(calculateMigrationDigest({ a: 1, b: 2 }));
    expect(calculateMigrationDigest([1, 2])).not.toBe(calculateMigrationDigest([2, 1]));
    const first = await createMigrationPlan(options);
    options.catalog.modules.reverse();
    options.module_bindings.reverse();
    expect((await createMigrationPlan(options)).plan_digest).toBe(first.plan_digest);
  });

  test("unselected external observations are visible and confer no effects", async () => {
    const options = fixture();
    options.snapshot.external_product_refs = [{ product: "snow-gloves", owner: "snow-gloves", grants_no_install_authority: true }];
    rebind(options);
    const plan = await createMigrationPlan(options);
    expect(plan.holds).toEqual([]);
    expect(plan.steps.every((step) => step.owner === "temperance")).toBe(true);
    expect(plan.observations).toContain("EXTERNAL_PRODUCT_NO_AUTHORITY");
  });

  test("source, lock, private binding, destination, selection and configuration substitutions hold", async () => {
    const mutations: Array<(o: CreateMigrationPlanOptions) => void> = [
      (o) => { o.snapshot.source_release_digest = fakeDigest("other"); },
      (o) => { o.snapshot.module_lock_digest = fakeDigest("other"); },
      (o) => { o.private_binding.variables.STATE_ROOT += "-other"; },
      (o) => { o.destination.identity_digest = fakeDigest("other"); },
      (o) => { o.destination.issued_device_ref = "device:substituted"; },
      (o) => { o.module_bindings[0].destinations[0].prepared_digest = fakeDigest("other"); },
      (o) => { o.module_bindings[0].destinations[0].preimage_digest = fakeDigest("other"); },
      (o) => { o.module_bindings[0].destinations[0].mode = 420; },
    ];
    for (const mutate of mutations) { const options = fixture(); mutate(options); await held(options, "SOURCE_CONTEXT_MISMATCH"); }
  });

  test("expired, future and mismatched evaluation time fail closed", async () => {
    const expired = fixture(); expired.now = "2026-10-03T00:00:00Z"; expired.expected_context.now = expired.now;
    await held(expired, "SOURCE_CONTEXT_EXPIRED");
    const future = fixture(); future.source_context.pinned_at = "2026-10-01T01:00:00Z";
    await held(future, "SOURCE_CONTEXT_NOT_YET_VALID");
    const mismatch = fixture(); mismatch.expected_context.now = "2026-10-01T00:00:03Z";
    await held(mismatch, "EVALUATION_TIME_MISMATCH");
  });

  test("unknown disk capacity, missing root identity, disk and platform block effects", async () => {
    const cases: Array<[string, (o: CreateMigrationPlanOptions) => void]> = [
      ["CAPACITY_UNKNOWN", o => { o.destination.free_bytes = null; }],
      ["CAPACITY_INSUFFICIENT", o => { o.destination.free_bytes = 1; }],
      ["ROOT_IDENTITY_UNKNOWN", o => { o.destination.roots[0].identity_digest = null; }],
      ["ROOT_UNAVAILABLE", o => { o.destination.roots[0].state = "unavailable"; }],
      ["UNSUPPORTED_PLATFORM", o => { o.destination.platform = "linux"; }],
    ];
    for (const [reason, mutate] of cases) { const options = fixture(); mutate(options); rebind(options); await held(options, reason); }
  });

  test("OmniRoute unsupported and occupied router port never select 9router implicitly", async () => {
    const options = fixture(); options.backend = "omniroute"; rebind(options);
    await held(options, "ROUTER_ADAPTER_UNVERIFIED");
    const port = fixture(); port.backend = "9router"; port.destination.port_20128 = "occupied"; rebind(port);
    await held(port, "ROUTER_PORT_CONFLICT");
    expect((await createMigrationPlan(fixture())).steps.some(step => step.module_id === "provider.9router")).toBe(false);
  });

  test("reject duplicate module owners, duplicate logical destinations and path overlaps", async () => {
    const duplicate = fixture(); duplicate.module_bindings.push(structuredClone(duplicate.module_bindings[0])); rebind(duplicate);
    await held(duplicate, "DUPLICATE_MODULE_OWNER");
    const ids = fixture(); ids.module_bindings[0].destinations.push(structuredClone(ids.module_bindings[0].destinations[0])); rebind(ids);
    await held(ids, "DUPLICATE_LOGICAL_ID");
    const overlap = fixture(); overlap.module_bindings[0].destinations.push({ ...overlap.module_bindings[0].destinations[0], id: "second", relative_path: "config" }); rebind(overlap);
    await held(overlap, "DESTINATION_CONFLICT");
  });

  test("onboarding owns dependency cycle and missing-selection admission", async () => {
    const cycle = fixture(); cycle.catalog.modules[0].depends_on = ["core.fixture"]; rebind(cycle);
    await held(cycle, "DEPENDENCY_CYCLE");
    const missing = fixture(); missing.catalog.modules[0].depends_on = ["provider.9router"]; rebind(missing);
    await held(missing, "DEPENDENCY_BLOCKED");
  });

  test("forbidden owner state and services cannot become local fixture effects", async () => {
    for (const owner of ["cambium", "snow-gloves", "hermes", "vault", "d1"]) {
      const owned = fixture(); owned.module_bindings[0].owner = owner; rebind(owned); await held(owned, "OWNER_SCOPE_FORBIDDEN");
      const path = fixture(); path.module_bindings[0].destinations[0].relative_path = `${owner}/state.json`; rebind(path); await held(path, "OWNER_SCOPE_FORBIDDEN");
    }
    const service = fixture(); service.module_bindings[0].destinations[0].effect = "system-service"; rebind(service);
    await held(service, "OWNER_EFFECT_REVIEW_REQUIRED");
  });

  test("Node 22 headless and Node 26 Session Atlas require distinct supplied environments", async () => {
    const options = fixture(); options.module_bindings[0].runtime_requirements = [
      { workspace_ref: "headless", environment_ref: "node-headless", node_major: 22 },
      { workspace_ref: "session-atlas", environment_ref: "node-atlas", node_major: 26 },
    ];
    options.destination.runtime_environments = [{ environment_ref: "node-headless", node_major: 22 }, { environment_ref: "node-atlas", node_major: 26 }]; rebind(options);
    expect((await createMigrationPlan(options)).holds).toEqual([]);
    options.module_bindings[0].runtime_requirements[1].environment_ref = "node-headless"; rebind(options);
    await held(options, "RUNTIME_ENVIRONMENT_CONFLICT");
    const unknown = fixture(); unknown.module_bindings[0].runtime_requirements = [{ workspace_ref: "headless", environment_ref: "isolated", node_major: 22 }]; rebind(unknown);
    await held(unknown, "RUNTIME_UNAVAILABLE");
    unknown.module_bindings[0].runtime_requirements[0].environment_ref = "global"; rebind(unknown); await held(unknown, "GLOBAL_RUNTIME_FORBIDDEN");
  });

  test("closed plan rejects unknown fields, authority flags, malformed hashes, reordered and substituted effects", async () => {
    const options = fixture(); const plan = await createMigrationPlan(options);
    for (const mutate of [
      (p: any) => { p.unrecognized = true; },
      (p: any) => { p.execution_authorized = true; },
      (p: any) => { p.steps[0].raw_path = "private"; },
      (p: any) => { p.steps[0].prepared_digest = "sha256:bad"; },
      (p: any) => { p.steps[0].owner = "cambium"; },
      (p: any) => { p.steps[0].relative_path = "../escape"; },
    ]) { const changed = structuredClone(plan); mutate(changed); changed.plan_digest = calculateMigrationPlanDigest(changed); expect(validateMigrationPlan(changed)).toBe(false); }
    const changed = structuredClone(plan); changed.steps[0].prepared_digest = fakeDigest("substitution"); changed.plan_digest = calculateMigrationPlanDigest(changed);
    expect(() => assertMigrationPlanContext(changed, reviewAfterPlan(options, plan), "2026-10-01T00:00:04Z")).toThrow();
  });

  test("observations are metadata-only and failures never echo private evidence", async () => {
    const options = fixture(); options.catalog.modules[0].requires = [{ id: "fixture-binary", kind: "binary", executable: "fixture" }]; rebind(options);
    await held(options, "PROBE_FAILED");
    options.observations = [{ capability_id: "fixture-binary", available: true }]; rebind(options);
    expect((await createMigrationPlan(options)).holds).toEqual([]);
    const invalid = fixture(); (invalid.observations as unknown[]).push({ capability_id: "secret", available: false, evidence: [invalid.private_binding.variables.STATE_ROOT] });
    await expect(createMigrationPlan(invalid)).rejects.toThrow("MIGRATION_INPUT_INVALID");
  });

  test("ordered dependencies come from the existing catalog and final review pins their order", async () => {
    const options = fixture();
    options.selected_modules.push("core.dependent"); options.target.requested_modules.push("core.dependent");
    options.catalog.modules.push({ id: "core.dependent", title: "Dependent", summary: "Fixture dependency", preselection: "off", depends_on: ["core.fixture"], requires: [], guided_installs: [] });
    options.module_bindings.push({ ...structuredClone(options.module_bindings[0]), module_id: "core.dependent", destinations: [{ ...options.module_bindings[0].destinations[0], id: "config.dependent", relative_path: "config/dependent.json" }] });
    rebind(options);
    const plan = await createMigrationPlan(options);
    expect(plan.steps.map(s => s.id)).toEqual(["config.fixture", "config.dependent"]);
    expect(plan.steps[1].depends_on).toEqual(["config.fixture"]);
    const changed = structuredClone(plan); changed.steps[1].depends_on = []; changed.plan_digest = calculateMigrationPlanDigest(changed);
    expect(validateMigrationPlan(changed)).toBe(true); // integrity alone is not authority
    expect(() => assertMigrationPlanContext(changed, reviewAfterPlan(options, plan), "2026-10-01T00:00:04Z")).toThrow("REVIEW_PLAN_MISMATCH");
    const reordered = structuredClone(plan); reordered.steps.reverse(); reordered.plan_digest = calculateMigrationPlanDigest(reordered);
    expect(validateMigrationPlan(reordered)).toBe(false);
    options.selected_modules.reverse(); options.target.requested_modules.reverse(); options.module_bindings.reverse(); options.catalog.modules.reverse();
    expect((await createMigrationPlan(options)).plan_digest).toBe(plan.plan_digest);
  });

  test("required evidence joins cannot be bypassed by a coherent untrusted snapshot", async () => {
    const options = fixture(); options.expected_context.required_organ_ids = ["adytum"]; rebind(options);
    const plan = await createMigrationPlan(options);
    expect(plan.holds.length).toBeGreaterThan(0); expect(plan.steps).toEqual([]);
    const forged = fixture(); forged.snapshot.work_objects[0].scope = "different-scope";
    await expect(createMigrationPlan(forged)).rejects.toThrow("MIGRATION_INPUT_INVALID");
  });

  test("recovery profile stays read-only and has no implicit router work", async () => {
    const options = fixture(); options.profile = "recovery"; options.target.target_profile = "recovery";
    options.selected_modules = []; options.target.requested_modules = []; rebind(options);
    const plan = await createMigrationPlan(options);
    expect(plan.holds).toEqual([]); expect(plan.steps).toEqual([]); expect(plan.execution_authorized).toBe(false);
    options.selected_modules = ["core.fixture"]; options.target.requested_modules = ["core.fixture"]; rebind(options);
    await held(options, "RECOVERY_READ_ONLY");
  });

  test("aliased private roots, case-insensitive paths and foreign private root bindings are held", async () => {
    const options = fixture(); options.module_bindings[0].destinations.push({ ...options.module_bindings[0].destinations[0], id: "second", relative_path: "CONFIG/Fixture.JSON" }); rebind(options);
    await held(options, "DESTINATION_CONFLICT");
    const foreignRoot = fixture(); foreignRoot.private_binding.variables.STATE_ROOT += "/cambium"; rebind(foreignRoot);
    await held(foreignRoot, "OWNER_SCOPE_FORBIDDEN");
    const alias = fixture(); alias.host_profile.variables.push({ name: "SECOND_ROOT", kind: "absolute-path", required: true });
    alias.private_binding.variables.SECOND_ROOT = alias.private_binding.variables.STATE_ROOT;
    alias.destination.roots.push({ ...alias.destination.roots[0], root_ref: "SECOND_ROOT" });
    alias.module_bindings[0].destinations.push({ ...alias.module_bindings[0].destinations[0], id: "second", root_ref: "SECOND_ROOT" }); rebind(alias);
    await held(alias, "DESTINATION_CONFLICT");
  });


  test("dependency edges survive a prerequisite module with no file effects", async () => {
    const options = fixture();
    for (const [id, dependency] of [["core.middle", "core.fixture"], ["core.leaf", "core.middle"]]) {
      options.selected_modules.push(id); options.target.requested_modules.push(id);
      options.catalog.modules.push({ id, title: "Dependency", summary: "Fixture", preselection: "off", depends_on: [dependency], requires: [], guided_installs: [] });
      options.module_bindings.push({ ...structuredClone(options.module_bindings[0]), module_id: id,
        destinations: id === "core.middle" ? [] : [{ ...options.module_bindings[0].destinations[0], id: "config.leaf", relative_path: "config/leaf.json" }] });
    }
    rebind(options); const plan = await createMigrationPlan(options);
    expect(plan.steps.map(s => s.id)).toEqual(["config.fixture", "config.leaf"]);
    expect(plan.steps[1].depends_on).toEqual(["config.fixture"]);
  });


  test("an independent exact review follows proposal creation without changing the proposal digest", async () => {
    const options = fixture(); const plan = await createMigrationPlan(options);
    expect(plan.generated_at).toBe("2026-10-01T00:00:02Z");
    expect(plan.source_context_pinned_at).toBe("2026-10-01T00:00:01Z");
    expect(plan.source_context_expires_at).toBe("2026-10-02T00:00:00Z");
    expect(plan).not.toHaveProperty("review_expires_at");
    const originalDigest = plan.plan_digest;
    const review = reviewAfterPlan(options, plan);
    expect(() => assertMigrationPlanContext(plan, review, "2026-10-01T00:00:04Z")).not.toThrow();
    expect(plan.plan_digest).toBe(originalDigest);
    expect(plan.execution_authorized).toBe(false);
    expect(() => assertMigrationPlanContext(plan, { ...review, reviewed_at: plan.generated_at }, plan.generated_at)).not.toThrow();
  });

  test("final reviews made before the plan, in the future, expired, or for another digest fail closed", async () => {
    const options = fixture(); const plan = await createMigrationPlan(options); const review = reviewAfterPlan(options, plan);
    const now = "2026-10-01T00:00:04Z";
    expect(() => assertMigrationPlanContext(plan, { ...review, reviewed_at: "2026-10-01T00:00:01Z" }, now)).toThrow("REVIEW_PREDATES_PLAN");
    expect(() => assertMigrationPlanContext(plan, { ...review, reviewed_at: "2026-10-01T00:00:05Z" }, now)).toThrow("REVIEW_NOT_YET_VALID");
    expect(() => assertMigrationPlanContext(plan, { ...review, expires_at: now }, now)).toThrow("REVIEW_EXPIRED");
    expect(() => assertMigrationPlanContext(plan, { ...review, plan_digest: fakeDigest("other-final-plan") }, now)).toThrow("REVIEW_PLAN_MISMATCH");
    expect(() => assertMigrationPlanContext(plan, { ...review, binding_digest: fakeDigest("other-binding") }, now)).toThrow("REVIEW_CONTEXT_MISMATCH");
    expect(() => assertMigrationPlanContext(plan, review, plan.source_context_expires_at)).toThrow("SOURCE_CONTEXT_EXPIRED");
    expect(() => assertMigrationPlanContext(plan, { ...review, extra: "field" } as MigrationPlanReviewContext, now)).toThrow("REVIEW_CONTEXT_INVALID");
  });

  test("final-plan review cannot be substituted for pinned source context during planning", async () => {
    const options = fixture(); const plan = await createMigrationPlan(options);
    const replaced = { ...options, source_context: reviewAfterPlan(options, plan) };
    await expect(createMigrationPlan(replaced as unknown as CreateMigrationPlanOptions)).rejects.toThrow("MIGRATION_INPUT_INVALID");
  });

});
