import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCoreOnboardingCatalog, createCoreOnboardingProfile } from "../src/onboarding/core-catalog.ts";
import { createOnboardingPlan } from "../src/onboarding/planner.ts";
import { renderOnboardingText } from "../src/onboarding/presentation.ts";
import { readOnboardingRoutingSnapshot } from "../src/onboarding/routing-snapshot.ts";
import type { HostProfileV1 } from "../src/onboarding/public-contracts.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hostProfile: HostProfileV1 = {
  schema: "temperance.host-profile.v1", version: { major: 1, minor: 0 }, id: "bound-offline",
  variables: [{ name: "NINE_ROUTER_DATA_DIR", kind: "absolute-path", required: true }, { name: "NINE_ROUTER_HEALTH_URL", kind: "url", required: true }],
  secret_references: [], preselected_modules: ["provider.9router"], required_routing_aliases: ["noesis-plan"],
};

async function fixture(bound: boolean) {
  const profile = createCoreOnboardingProfile();
  if (bound) {
    profile.variables = { NINE_ROUTER_DATA_DIR: join(tmpdir(), "missing-routing-fixture"), NINE_ROUTER_HEALTH_URL: "http://127.0.0.1:1/health" };
    profile.routing_aliases = [{ alias: "noesis-plan", combo: "noesis-plan" }];
  }
  const plan = await createOnboardingPlan({ catalog: createCoreOnboardingCatalog(), profile, adapter: {
    probe: async ({ id }) => ({ capability_id: id, available: true, reason_code: "AVAILABLE", evidence: [] }),
  } });
  return { profile, plan };
}

test("bound offline routing is unavailable, never misreported as an unselected host", async () => {
  const input = await fixture(true);
  const snapshot = await readOnboardingRoutingSnapshot({ ...input, hostProfile, observe: async () => { throw new Error("PRIVATE_CONNECTION_FAILURE"); } });
  const text = renderOnboardingText(input.plan, snapshot.routing);
  expect(snapshot.connection).toBeUndefined();
  expect(text).toContain("alias.noesis-plan");
  expect(text).toContain("LIVE_PROVIDER_MODELS_UNAVAILABLE");
  expect(text).not.toContain("HOST_PROFILE_NOT_SELECTED");
  expect(text).not.toContain("PRIVATE_CONNECTION_FAILURE");
});

test("bound profile remains visibly selected even when router bindings are missing", async () => {
  const input = await fixture(false);
  const snapshot = await readOnboardingRoutingSnapshot({ ...input, hostProfile, observe: async () => { throw new Error("MUST_NOT_PROBE"); } });
  expect(renderOnboardingText(input.plan, snapshot.routing)).toContain("LIVE_PROVIDER_MODELS_UNAVAILABLE");
  expect(snapshot.connection).toBeUndefined();
});

test("generic onboarding remains unbound and performs no management request", async () => {
  const input = await fixture(false);
  let calls = 0;
  const snapshot = await readOnboardingRoutingSnapshot({ ...input, observe: async () => { calls++; throw new Error("MUST_NOT_PROBE"); } });
  expect(snapshot).toEqual({});
  expect(calls).toBe(0);
  expect(renderOnboardingText(input.plan, snapshot.routing)).toContain("HOST_PROFILE_NOT_SELECTED");
});

test("an unselected router cannot imply adapter compatibility from absent holds", async () => {
  const input = await fixture(true);
  let probes = 0;
  const plan = await createOnboardingPlan({ catalog: createCoreOnboardingCatalog(), profile: input.profile, selections: new Set(), adapter: {
    probe: async ({ id }) => { probes++; return { capability_id: id, available: true, reason_code: "AVAILABLE", evidence: [] }; },
  } });
  const snapshot = await readOnboardingRoutingSnapshot({ ...input, plan, hostProfile, observe: async () => ({ catalog: { providers: [], combos: [] }, models: [] }) });
  expect(probes).toBe(0);
  expect(snapshot.routing?.compatible).toBe(false);
});

test("successful read-only observations produce the shared live routing projection", async () => {
  const input = await fixture(true);
  let calls = 0;
  const snapshot = await readOnboardingRoutingSnapshot({ ...input, hostProfile, observe: async () => {
    calls++;
    return { catalog: { providers: [{ id: "cx-test", name: "Test", provider: "codex", active: true }], combos: [] }, models: [{ id: "cx/test-model", owner: "cx", kind: "provider" }] };
  } });
  expect(calls).toBe(1);
  expect(snapshot.connection?.baseUrl).toBe("http://127.0.0.1:1");
  expect(snapshot.routing?.live_model_count).toBe(1);
  expect(snapshot.routing?.provider_options.find(({ id }) => id === "codex")?.state).toBe("connected");
  expect(renderOnboardingText(input.plan, snapshot.routing)).not.toContain("HOST_PROFILE_NOT_SELECTED");
});

test("CLI doctor and plain text use bound routing while JSON retains its existing schema", async () => {
  const root = mkdtempSync(join(tmpdir(), "onboarding-routing-cli-"));
  roots.push(root);
  const profilePath = join(root, "profile.json");
  const bindingPath = join(root, "binding.json");
  writeFileSync(profilePath, JSON.stringify(hostProfile));
  writeFileSync(bindingPath, JSON.stringify({
    schema: "temperance.host-binding.v1", version: { major: 1, minor: 0 }, profile_id: hostProfile.id,
    variables: { NINE_ROUTER_DATA_DIR: join(root, "missing-router"), NINE_ROUTER_HEALTH_URL: "http://127.0.0.1:1/health" },
    secret_references: {}, routing_aliases: [{ alias: "noesis-plan", combo: "noesis-plan" }], volume_bindings: [],
  }));
  const invoke = async (extra: string[]) => {
    const child = Bun.spawn([process.execPath, "src/cli.ts", "onboard", "--host-profile", profilePath, "--host-binding", bindingPath, ...extra], {
      cwd: resolve(import.meta.dir, ".."), stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).not.toBe(64);
    expect(stderr).toBe("");
    return stdout;
  };
  for (const flags of [[], ["--doctor"]]) {
    const text = await invoke(flags);
    expect(text).toContain("alias.noesis-plan");
    expect(text).toContain("LIVE_PROVIDER_MODELS_UNAVAILABLE");
    expect(text).not.toContain("HOST_PROFILE_NOT_SELECTED");
  }
  const json = JSON.parse(await invoke(["--json"]));
  expect(json.schema).toBe("temperance.onboarding.plan.v1");
  expect(json).not.toHaveProperty("routing");
});
