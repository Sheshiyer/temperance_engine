import { describe, expect, test } from "bun:test";

import {
  NINE_ROUTER_PACKAGE,
  ONBOARDING_CATALOG_SCHEMA,
  ONBOARDING_PROFILE_SCHEMA,
  type CapabilityProbe,
  type OnboardingCatalogV1,
  type OnboardingProfileV1,
} from "../src/onboarding/contracts.ts";
import { createCoreOnboardingCatalog } from "../src/onboarding/core-catalog.ts";
import { createOnboardingPlan } from "../src/onboarding/planner.ts";
import { validateOnboardingCatalog, validateOnboardingProfile } from "../src/onboarding/schema.ts";
import { projectOnboardingDoctorSection } from "../src/onboarding/doctor.ts";

const profile = (overrides: Partial<OnboardingProfileV1> = {}): OnboardingProfileV1 => ({
  schema: ONBOARDING_PROFILE_SCHEMA,
  version: { major: 1, minor: 0 },
  id: "portable-test",
  variables: {},
  secret_references: {},
  preselected_modules: [],
  routing_aliases: [],
  project_enrollments: [],
  ...overrides,
});

const catalog = (overrides: Partial<OnboardingCatalogV1> = {}): OnboardingCatalogV1 => ({
  schema: ONBOARDING_CATALOG_SCHEMA,
  version: { major: 1, minor: 0 },
  modules: [],
  ...overrides,
});

function probe(results: Record<string, CapabilityProbe>) {
  return {
    probe: async (capability: { id: string }) => results[capability.id] ?? {
      capability_id: capability.id,
      available: true,
      reason_code: "AVAILABLE" as const,
      evidence: [],
    },
  };
}

describe("onboarding contracts", () => {
  test("pins 9router and declares fresh state separate from OmniRoute legacy state", () => {
    expect(NINE_ROUTER_PACKAGE).toEqual({
      name: "9router",
      version: "0.5.75",
      executable: "9router",
      current_state_directory: ".9router",
      legacy_state_directory: ".omniroute",
    });
    const router = createCoreOnboardingCatalog().modules.find((module) => module.id === "provider.9router");
    expect(router?.state_transition).toEqual({
      from_relative_path: ".omniroute",
      to_relative_path: ".9router",
      policy: "fresh-rebuild",
      copy_legacy_state: false,
    });
    expect(router?.guided_installs[0]?.argv).toEqual(["bun", "add", "--global", "9router@0.5.75"]);
    expect(router?.guided_installs[0]).toMatchObject({ environment: { DATA_DIR: "${NINE_ROUTER_DATA_DIR}" } });
    expect(router?.runtime_contract).toMatchObject({
      owner: "temperance",
      launch_agent_label: "com.temperance.engine.9router",
      listen_host: "127.0.0.1",
      listen_port: 20128,
      data_dir_variable: "NINE_ROUTER_DATA_DIR",
      node_executable_variable: "NINE_ROUTER_NODE_EXECUTABLE",
      cli_entrypoint_variable: "NINE_ROUTER_CLI_ENTRYPOINT",
      path_variable: "NINE_ROUTER_PATH",
      log_directory_variable: "NINE_ROUTER_LOG_DIR",
      argv: ["--tray", "--host", "127.0.0.1", "--no-browser", "--skip-update"],
      run_at_load: true,
      keep_alive: true,
      forbidden_launch_agent_label: "com.9router.autostart",
      management_auth: {
        header: "x-9r-cli-token",
        derivation: "data-dir-machine-secret",
        persist_derived_token: false,
      },
      api_contract: {
        keys: { collection: "/api/keys", item: "/api/keys/{id}" },
        cli_tool_settings: "/api/cli-tools/{tool}-settings",
        providers: "/api/providers",
        combos: "/api/combos",
        gateway_key_policy: {
          capture: "one-time-to-keychain",
          profile_storage: "reference-only",
          receipt_storage: "redacted",
        },
      },
    });
  });

  test("accepts Keychain references but rejects plaintext secret shapes", () => {
    const valid = profile({
      secret_references: {
        ROUTER_ADMIN: { store: "macos-keychain", service: "temperance.9router", account: "admin" },
      },
    });
    expect(validateOnboardingProfile(valid)).toBe(true);
    expect(validateOnboardingProfile({
      ...valid,
      secret_references: { ROUTER_ADMIN: { store: "plaintext", value: "leaked" } },
    })).toBe(false);
  });

  test("validates a portable catalog without personal values", () => {
    const core = createCoreOnboardingCatalog();
    expect(validateOnboardingCatalog(core)).toBe(true);
    const serialized = JSON.stringify(core);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("/Volumes/");
    expect(serialized).not.toContain("madara");
  });

  test("forbids command guidance that omits an isolated 9router DATA_DIR", () => {
    const core = createCoreOnboardingCatalog();
    const router = core.modules[0]!;
    const unsafe = {
      ...core,
      modules: [{
        ...router,
        guided_installs: [{ id: "unsafe", label: "unsafe", kind: "command", argv: ["bun", "add", "--global", "9router@0.5.75"] }],
      }],
    };
    expect(validateOnboardingCatalog(unsafe)).toBe(false);
  });
});

describe("shared onboarding planner", () => {
  test("selects eligible preselected modules in dependency order", async () => {
    const input = catalog({ modules: [
      { id: "base", title: "Base", summary: "base", preselection: "available", depends_on: [], requires: [], guided_installs: [] },
      { id: "hands", title: "Hands", summary: "hands", preselection: "available", depends_on: ["base"], requires: [], guided_installs: [] },
    ] });
    const plan = await createOnboardingPlan({
      catalog: input,
      profile: profile({ preselected_modules: ["hands", "base"] }),
      adapter: probe({}),
    });
    expect(plan.install_order).toEqual(["base", "hands"]);
    expect(plan.modules.find((module) => module.id === "hands")?.status).toBe("eligible");
    expect(plan.dry_run).toBe(true);
  });

  test("blocks a module and dependent modules with stable reasons", async () => {
    const input = catalog({ modules: [
      {
        id: "obsidian",
        title: "Obsidian",
        summary: "vault integration",
        preselection: "selected",
        depends_on: [],
        requires: [{ id: "obsidian-app", kind: "application", bundle_id: "md.obsidian" }],
        guided_installs: [{ id: "install-obsidian", label: "Install Obsidian", kind: "open-url", url: "https://obsidian.md/download" }],
      },
      { id: "tunnel", title: "Tunnel", summary: "tunnel", preselection: "selected", depends_on: ["obsidian"], requires: [], guided_installs: [] },
    ] });
    const plan = await createOnboardingPlan({
      catalog: input,
      profile: profile(),
      adapter: probe({
        "obsidian-app": { capability_id: "obsidian-app", available: false, reason_code: "APPLICATION_MISSING", evidence: [] },
      }),
    });
    expect(plan.install_order).toEqual([]);
    expect(plan.modules.find((module) => module.id === "obsidian")?.holds[0]).toMatchObject({
      reason_code: "APPLICATION_MISSING",
      capability_id: "obsidian-app",
    });
    expect(plan.modules.find((module) => module.id === "tunnel")?.holds[0]).toMatchObject({
      reason_code: "DEPENDENCY_BLOCKED",
      dependency_id: "obsidian",
    });
  });

  test("exact 9router version mismatch is blocked and keeps the guided repair", async () => {
    const core = createCoreOnboardingCatalog();
    const plan = await createOnboardingPlan({
      catalog: core,
      profile: profile({ preselected_modules: ["provider.9router"] }),
      adapter: probe({
        "9router-binary": {
          capability_id: "9router-binary",
          available: false,
          reason_code: "VERSION_MISMATCH",
          evidence: ["observed version differs from required version"],
        },
      }),
    });
    const router = plan.modules.find((module) => module.id === "provider.9router");
    expect(router?.status).toBe("blocked");
    expect(router?.guided_installs[0]?.argv).toEqual(["bun", "add", "--global", "9router@0.5.75"]);
  });

  test("missing mounted volume degrades safely without blocking unrelated modules", async () => {
    const input = catalog({ modules: [
      {
        id: "external-projects",
        title: "External projects",
        summary: "external",
        preselection: "selected",
        depends_on: [],
        requires: [{ id: "project-volume", kind: "mount", mount_path_variable: "PROJECT_VOLUME", expected_uuid_variable: "PROJECT_VOLUME_UUID" }],
        guided_installs: [],
      },
      { id: "local", title: "Local", summary: "local", preselection: "selected", depends_on: [], requires: [], guided_installs: [] },
    ] });
    const plan = await createOnboardingPlan({
      catalog: input,
      profile: profile({ variables: { PROJECT_VOLUME: "/example/external", PROJECT_VOLUME_UUID: "example-uuid" } }),
      adapter: probe({
        "project-volume": { capability_id: "project-volume", available: false, reason_code: "MOUNT_ABSENT", evidence: [] },
      }),
    });
    expect(plan.operating_mode).toBe("read-only-degraded");
    expect(plan.install_order).toEqual(["local"]);
    expect(plan.modules.find((module) => module.id === "external-projects")?.status).toBe("blocked");
  });

  test("probes an absent mount before requiring its optional identity binding", async () => {
    const input = catalog({ modules: [{
      id: "external-projects",
      title: "External projects",
      summary: "external",
      preselection: "selected",
      depends_on: [],
      requires: [{
        id: "project-volume",
        kind: "mount",
        mount_path_variable: "PROJECT_VOLUME",
        expected_uuid_variable: "PROJECT_VOLUME_UUID",
        required_relative_path_variable: "PROJECT_SUBTREE",
      }],
      guided_installs: [],
    }] });
    const plan = await createOnboardingPlan({
      catalog: input,
      profile: profile({ variables: {
        PROJECT_VOLUME: "/example/external",
        PROJECT_SUBTREE: "2026/Projects/thoughtseed",
      } }),
      adapter: probe({
        "project-volume": { capability_id: "project-volume", available: false, reason_code: "MOUNT_ABSENT", evidence: [] },
      }),
    });
    expect(plan.operating_mode).toBe("read-only-degraded");
    expect(plan.modules[0]?.holds[0]?.reason_code).toBe("MOUNT_ABSENT");
  });

  test("doctor projection uses the same holds and plan digest", async () => {
    const input = catalog({ modules: [{
      id: "needs-secret",
      title: "Needs secret",
      summary: "secret",
      preselection: "selected",
      depends_on: [],
      requires: [{ id: "admin-secret", kind: "keychain-secret", secret_reference: "ADMIN" }],
      guided_installs: [],
    }] });
    const plan = await createOnboardingPlan({ catalog: input, profile: profile(), adapter: probe({}) });
    const section = projectOnboardingDoctorSection(plan);
    expect(section.condition).toBe("FAIL");
    expect(section.checks[0]?.reason_code).toBe("SECRET_REFERENCE_MISSING");
    expect(section.checks[0]?.evidence).toContain(plan.plan_digest);
  });

  test("offline router health does not erase healthy local-core evidence", async () => {
    const input = catalog({ modules: [
      { id: "local-core", title: "Local core", summary: "offline-safe", preselection: "selected", depends_on: [], requires: [], guided_installs: [] },
      {
        id: "network-dependent", title: "Network dependent", summary: "gateway", preselection: "selected", depends_on: [],
        requires: [{ id: "router-health", kind: "http-health", url_variable: "ROUTER_URL" }], guided_installs: [],
      },
    ] });
    const plan = await createOnboardingPlan({
      catalog: input,
      profile: profile({ variables: { ROUTER_URL: "http://127.0.0.1:20128/v1/models" } }),
      adapter: probe({ "router-health": { capability_id: "router-health", available: false, reason_code: "HTTP_UNAVAILABLE", evidence: [] } }),
    });
    const section = projectOnboardingDoctorSection(plan);
    expect(section.condition).toBe("FAIL");
    expect(section.checks.find((check) => check.destination === "module:local-core")).toMatchObject({ condition: "PASS", reason_code: "MODULE_ELIGIBLE" });
    expect(section.checks.find((check) => check.destination === "module:network-dependent")).toMatchObject({ condition: "FAIL", reason_code: "HTTP_UNAVAILABLE" });
  });
});
