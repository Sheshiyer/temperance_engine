import { describe, expect, test } from "bun:test";
import type { CompileResult } from "../src/compile.ts";
import { parseLifecycleArgs } from "../src/lifecycle/cli-args.ts";
import { createPlan, type PlanOptions } from "../src/lifecycle/planner.ts";
import type { SurfaceRecord } from "../src/types.ts";

function fixture(): CompileResult {
  const records: SurfaceRecord[] = ["base", "helper", "router", "unrelated"].map((id) => ({
    id, owner: "temperance-engine", class: "COPY", source: `${id}.txt`,
    destination: { root_token: "TEMPERANCE_STATE", relative_path: `${id}.txt`, ownership: { kind: "exclusive-path" } },
    authority: { requirement_ids: ["PROV-02"], isa: "ISC-769" },
    eligibility: { platforms: ["darwin", "linux"], profiles: ["default"], required: true },
    verification: { method: "sha256" }, rollback: { policy: "restore-backup" },
    ...(id === "router" ? { depends_on: ["helper"] } : id === "helper" ? { depends_on: ["base"] } : id === "unrelated" ? { depends_on: ["router"] } : {}),
  }));
  return {
    lockObject: { schema: "temperance.install-surface.lock.v1", schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1", version: { major: 1, minor: 0 }, records },
    canonicalBytes: "full fixture", digest: `sha256:${"a".repeat(64)}`, semanticIds: records.map(({ id }) => id),
  };
}

function options(): PlanOptions {
  return { verb: "update", profileResult: fixture(), profile: "default", platform: "darwin", onlyIds: new Set(["router"]) };
}

describe("bounded lifecycle scope", () => {
  test("includes only requested records and transitive dependencies while preserving the full digest", () => {
    const input = options();
    const before = JSON.stringify(input.profileResult);
    const plan = createPlan(input);
    expect(plan.steps.map(({ record_id }) => record_id)).toEqual(["base", "helper", "router"]);
    expect(plan.outcomes.map(({ record_id }) => record_id)).toEqual(["base", "helper", "router"]);
    expect(plan.scope).toEqual({ mode: "dependency-closure", requested_ids: ["router"], dependency_ids: ["base", "helper"], record_ids: ["base", "helper", "router"] });
    expect(plan.inventory_digest).toBe(input.profileResult.digest);
    expect(JSON.stringify(input.profileResult)).toBe(before);
  });

  test("retains legacy whole-profile planning without --only", () => {
    const plan = createPlan({ ...options(), onlyIds: undefined });
    expect(plan.steps).toHaveLength(4);
    expect(plan.scope).toBeUndefined();
  });

  test("deduplicates overlapping requests and emits deterministic scope", () => {
    const first = createPlan({ ...options(), onlyIds: new Set(["router", "helper"]) });
    const second = createPlan({ ...options(), onlyIds: new Set(["helper", "router"]) });
    expect(first.scope).toEqual(second.scope);
    expect(first.scope?.dependency_ids).toEqual(["base"]);
    expect(first.steps).toHaveLength(3);
  });

  test("rejects an empty scope instead of broadening it", () => {
    expect(() => createPlan({ ...options(), onlyIds: new Set() })).toThrow("PLAN_SCOPE_EMPTY");
  });

  test("rejects unknown requested and dependency IDs", () => {
    expect(() => createPlan({ ...options(), onlyIds: new Set(["typo"]) })).toThrow("PLAN_SCOPE_UNKNOWN_RECORD");
    const input = options();
    input.profileResult.lockObject.records[1]!.depends_on = ["missing"];
    expect(() => createPlan(input)).toThrow("PLAN_SCOPE_UNKNOWN_RECORD");
  });

  test("rejects unavailable profile/platform dependencies rather than skipping them", () => {
    const input = options();
    input.profileResult.lockObject.records[0]!.eligibility.profiles = ["other"];
    expect(() => createPlan(input)).toThrow("PLAN_SCOPE_INELIGIBLE_RECORD");
    input.profileResult.lockObject.records[0]!.eligibility.profiles = ["default"];
    input.profileResult.lockObject.records[0]!.eligibility.platforms = ["win32"];
    expect(() => createPlan(input)).toThrow("PLAN_SCOPE_INELIGIBLE_RECORD");
  });

  test("rejects private dependencies, cycles, and conflicting --select hints", () => {
    const input = options();
    input.profileResult.lockObject.records[0]!.class = "NEVER-SHIP";
    expect(() => createPlan(input)).toThrow("PLAN_NEVER_SHIP_MUTATION");
    const cycle = options();
    cycle.profileResult.lockObject.records[0]!.depends_on = ["router"];
    expect(() => createPlan(cycle)).toThrow("PLAN_DEPENDENCY_CYCLE");
    expect(() => createPlan({ ...options(), explicitSelections: new Set(["unrelated"]) })).toThrow("PLAN_SCOPE_CONFLICT");
  });

  test("refuses scoped removal until reverse-dependency safety has its own contract", () => {
    expect(() => createPlan({ ...options(), verb: "uninstall" })).toThrow("PLAN_SCOPE_VERB_UNSUPPORTED");
  });
});

describe("lifecycle scope arguments", () => {
  test("parses comma-separated IDs independently from --select", () => {
    expect(parseLifecycleArgs(["--profile", "default", "--only", "router,helper,router", "--dry-run", "--json"], "update"))
      .toEqual({ profile: "default", onlyIds: new Set(["router", "helper"]), dryRun: true, force: false, json: true });
  });

  test.each([
    ["--only"], ["--only", ""], ["--only", "router,"], ["--only", ",router"],
    ["--only", "router, helper"], ["--only", "../router"], ["--only", "--dry-run"],
    ["--only", "router", "--only", "helper"], ["--onyl", "router"],
  ].map((args) => ({ args })))("rejects malformed or duplicated scope arguments %j", ({ args }) => {
    expect(() => parseLifecycleArgs(args, "update")).toThrow();
  });

  test.each(["uninstall", "rollback", "receipt"])("does not ignore --only on %s", (command) => {
    expect(() => parseLifecycleArgs(["--only", "router"], command)).toThrow("PLAN_SCOPE_VERB_UNSUPPORTED");
  });
});
