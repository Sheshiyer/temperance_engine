import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  OMNIROUTE_PACKAGE,
  type CapabilityProbe,
  type CapabilityRequirement,
  type OnboardingProfileV1,
} from "../src/onboarding/contracts.ts";
import { createCoreOnboardingCatalog, createCoreOnboardingProfile, createLegacyNineRouterCatalog } from "../src/onboarding/core-catalog.ts";
import { projectOnboardingDoctorSection } from "../src/onboarding/doctor.ts";
import { createOnboardingPlan, requiredModuleIds } from "../src/onboarding/planner.ts";
import { createOnboardingViewModel, renderOnboardingText } from "../src/onboarding/presentation.ts";
import { validateOnboardingCatalog, validateOnboardingProfile } from "../src/onboarding/schema.ts";
import { createSystemProbeAdapter, type OnboardingProbeIO } from "../src/onboarding/system-adapter.ts";
import { toggleOnboardingModuleSelection } from "../src/onboarding/tui.ts";
import { retiredIdsOutsideCatalog, retiredModuleNotice, withoutRetiredModules } from "../src/onboarding/profile-selection.ts";
import { nineRouterKeychainReference } from "../src/onboarding/nine-router-guided-setup.ts";
import { projectOperatorHealth } from "../src/onboarding/operator-health.ts";
import { completeOnboardingWizard, createOnboardingWizardState, createOnboardingWizardView, handleOnboardingWizardKey } from "../src/onboarding/wizard.ts";

const profile = (overrides: Partial<OnboardingProfileV1> = {}): OnboardingProfileV1 => ({
  ...createCoreOnboardingProfile(),
  id: "organ-test",
  ...overrides,
});

function allAvailable(overrides: Record<string, Partial<CapabilityProbe>> = {}) {
  return {
    probe: async (capability: { id: string }): Promise<CapabilityProbe> => ({
      capability_id: capability.id,
      available: true,
      reason_code: "AVAILABLE",
      evidence: [],
      ...overrides[capability.id],
    }),
  };
}

function io(overrides: Partial<OnboardingProbeIO> = {}): OnboardingProbeIO {
  return {
    platform: "darwin",
    which: async () => "/opt/example/bin/tool",
    execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    pathInfo: async () => ({ exists: true, type: "directory", readable: true, writable: true, mode: 0o700 }),
    fetch: async () => new Response(null, { status: 200 }),
    tcpConnect: async () => true,
    uid: 501,
    ...overrides,
  };
}

async function probeWith(requirement: CapabilityRequirement, ioOverrides: Partial<OnboardingProbeIO> = {}, variables: Record<string, string> = {}) {
  return await createSystemProbeAdapter({ io: io(ioOverrides) })
    .probe(requirement, { profile: profile({ variables }), signal: new AbortController().signal });
}

describe("organ registry catalog", () => {
  test("ships OmniRoute as the required default router and no 9Router module", () => {
    const core = createCoreOnboardingCatalog();
    expect(validateOnboardingCatalog(core)).toBe(true);
    expect(core.modules.some(({ id }) => id === "provider.9router")).toBe(false);
    const router = core.modules.find(({ id }) => id === "provider.omniroute");
    // The router may be hosted, so it is probed only by its health endpoint.
    expect(router?.organ).toEqual({ tier: "required", group: "router", host_role: "operator-mac", host_role_variable: "OMNIROUTE_HOST_ROLE", public_url_variable: "OMNIROUTE_PUBLIC_URL" });
    expect(router?.requires).toEqual([{ id: "omniroute-health", kind: "http-health", url_variable: "OMNIROUTE_HEALTH_URL", method: "GET", accept_status: [200, 401] }]);
    const local = core.modules.find(({ id }) => id === "provider.omniroute-local");
    expect(local?.organ).toEqual({ tier: "modular", group: "router", host_role: "operator-mac" });
    expect(local?.requires).toContainEqual({ id: "omniroute-launch-agent", kind: "launch-agent", label: OMNIROUTE_PACKAGE.launch_agent_label });
    expect(local?.requires.find(({ kind }) => kind === "binary")).toMatchObject({ executable: "omniroute", version: { exact: OMNIROUTE_PACKAGE.version } });
    expect(local?.guided_installs.map(({ id }) => id)).toEqual(["install-omniroute", "omniroute-launch-agent"]);
    expect(local?.requires).toContainEqual({ id: "omniroute-local-health", kind: "http-health", url_variable: "OMNIROUTE_LOCAL_HEALTH_URL", method: "GET", accept_status: [200, 401] });
  });

  test("installs only the OmniRoute release the router compatibility gates qualify", async () => {
    const { SUPPORTED_OMNIROUTE_NATIVE_CLI_VERSION } = await import("../../router/omniroute-native-cli-readiness.ts");
    const { SUPPORTED_OMNIROUTE_PREVIEW_VERSION } = await import("../../router/omniroute-context-preview.ts");
    expect(OMNIROUTE_PACKAGE.version).toBe(SUPPORTED_OMNIROUTE_NATIVE_CLI_VERSION);
    expect(OMNIROUTE_PACKAGE.version).toBe(SUPPORTED_OMNIROUTE_PREVIEW_VERSION);
    const controlPlane = readFileSync(resolve(import.meta.dir, "../../router/omniroute-native-control-plane.ts"), "utf8");
    expect(controlPlane).toContain(`const SUPPORTED_TOPOLOGY_VERSION = "${OMNIROUTE_PACKAGE.version}";`);
    const local = createCoreOnboardingCatalog().modules.find(({ id }) => id === "provider.omniroute-local")!;
    expect(local.guided_installs[0]).toMatchObject({ argv: ["bun", "add", "--global", `omniroute@${OMNIROUTE_PACKAGE.version}`] });
  });

  test("assigns the operator's tiers: memory required, A2A modular, Obsidian/mail optional", () => {
    const core = createCoreOnboardingCatalog();
    const tiers = Object.fromEntries(core.modules.map(({ id, organ }) => [id, organ?.tier]));
    expect(tiers).toMatchObject({
      "provider.omniroute": "required",
      "provider.omniroute-local": "modular",
      "memory.temperance": "required",
      "integration.hermes-a2a": "modular",
      "tunnel.hermes-a2a": "modular",
      "integration.obsidian-rest": "optional",
      "tunnel.obsidian-rest": "optional",
      "integration.mail-mcp": "optional",
    });
    expect(core.modules.find(({ id }) => id === "tunnel.obsidian-rest")?.depends_on).toEqual(["integration.obsidian-rest"]);
    expect(core.modules.find(({ id }) => id === "tunnel.hermes-a2a")?.depends_on).toEqual(["integration.hermes-a2a"]);
  });

  test("drops the retired company router and the router-owned A2A organ", () => {
    const ids = createCoreOnboardingCatalog().modules.map(({ id }) => id);
    expect(ids).not.toContain("integration.company-omniroute");
    expect(ids).not.toContain("integration.omniroute-a2a");
    expect(JSON.stringify(createCoreOnboardingCatalog()).toLowerCase()).not.toContain("company");
  });

  test("stays portable: no private paths, hostnames or volume names", () => {
    const serialized = JSON.stringify(createCoreOnboardingCatalog());
    for (const forbidden of ["/Users/", "/Volumes/", "madara", "thoughtseed", ".space"]) expect(serialized).not.toContain(forbidden);
  });

  test("keeps the retired 9Router module only in the legacy catalog", () => {
    const legacy = createLegacyNineRouterCatalog();
    expect(validateOnboardingCatalog(legacy)).toBe(true);
    expect(legacy.modules.map(({ id }) => id)).toEqual(["provider.9router"]);
  });

  test("schema rejects ambiguous LaunchAgent labels and unknown organ tiers", () => {
    const core = createCoreOnboardingCatalog();
    const withBothLabels = structuredClone(core);
    withBothLabels.modules[0]!.requires.push({ id: "both", kind: "launch-agent", label: "a.b", label_variable: "LABEL" });
    expect(validateOnboardingCatalog(withBothLabels)).toBe(false);
    const withBadTier = structuredClone(core) as any;
    withBadTier.modules[0].organ.tier = "critical";
    expect(validateOnboardingCatalog(withBadTier)).toBe(false);
  });

  test("profile accepts host-specific required_modules", () => {
    expect(validateOnboardingProfile(profile({ required_modules: ["storage.knowledge-volume"] }))).toBe(true);
  });
});

describe("organ planning", () => {
  test("required organs are always planned, even when an explicit selection omits them", async () => {
    const plan = await createOnboardingPlan({
      catalog: createCoreOnboardingCatalog(),
      profile: profile({ secret_references: { OMNIROUTE_ADMIN: { store: "macos-keychain", service: "svc", account: "acct" } } }),
      adapter: allAvailable(),
      selections: new Set(["integration.mail-mcp"]),
    });
    const requested = plan.modules.filter(({ requested }) => requested).map(({ id }) => id).sort();
    expect(requested).toEqual(["integration.mail-mcp", "memory.temperance", "provider.omniroute"]);
    expect(plan.operating_mode).toBe("ready");
  });

  test("a host profile escalates organs to required and resolves private titles and endpoints", async () => {
    const catalog = createCoreOnboardingCatalog();
    const hostProfile = profile({
      required_modules: ["storage.knowledge-volume"],
      variables: {
        ...createCoreOnboardingProfile().variables,
        KNOWLEDGE_VOLUME_NAME: "Vault Drive",
        MEMORY_TUNNEL_PUBLIC_URL: "https://memory.example.test",
      },
    });
    expect(requiredModuleIds(catalog, hostProfile)).toContain("storage.knowledge-volume");
    const plan = await createOnboardingPlan({ catalog, profile: hostProfile, adapter: allAvailable() });
    const volume = plan.modules.find(({ id }) => id === "storage.knowledge-volume")!;
    expect(volume.requested).toBe(true);
    expect(volume.organ?.tier).toBe("required");
    expect(volume.title).toBe("Vault Drive · Knowledge volume");
    expect(plan.modules.find(({ id }) => id === "tunnel.temperance-memory")?.organ?.public_url).toBe("https://memory.example.test");
  });

  test("rejects profile display values that are long or carry control characters", async () => {
    const catalog = createCoreOnboardingCatalog();
    const base = createCoreOnboardingProfile().variables;
    const ok = await createOnboardingPlan({ catalog, profile: profile({ variables: { ...base, KNOWLEDGE_VOLUME_NAME: "Vault Drive" } }), adapter: allAvailable() });
    expect(ok.modules.find(({ id }) => id === "storage.knowledge-volume")?.title).toBe("Vault Drive · Knowledge volume");
    for (const [variable, value] of [
      ["KNOWLEDGE_VOLUME_NAME", "Vault\nDrive"],
      ["KNOWLEDGE_VOLUME_NAME", "Vault\u001b[31mDrive"],
      ["KNOWLEDGE_VOLUME_NAME", "Vault\u202eDrive"],
      ["KNOWLEDGE_VOLUME_NAME", "V".repeat(65)],
      ["OBSIDIAN_PUBLIC_URL", "https://vault.example.test/\u0007"],
    ] as const) {
      await expect(createOnboardingPlan({ catalog, profile: profile({ variables: { ...base, [variable]: value } }), adapter: allAvailable() }))
        .rejects.toThrow(`ONBOARDING_DISPLAY_VARIABLE_INVALID:${variable}`);
    }
  });

  test("a hosted router moves the router and memory organs to the cloud runner", async () => {
    const catalog = createCoreOnboardingCatalog();
    const variables = { ...createCoreOnboardingProfile().variables, OMNIROUTE_HOST_ROLE: "cloud-runner", OMNIROUTE_PUBLIC_URL: "https://router.example.test" };
    const plan = await createOnboardingPlan({ catalog, profile: profile({ variables }), adapter: allAvailable() });
    const organ = (id: string) => plan.modules.find((module) => module.id === id)?.organ;
    expect(organ("provider.omniroute")).toMatchObject({ host_role: "cloud-runner", public_url: "https://router.example.test" });
    expect(organ("memory.temperance")?.host_role).toBe("cloud-runner");
    expect(organ("provider.omniroute-local")?.host_role).toBe("operator-mac");
    await expect(createOnboardingPlan({ catalog, profile: profile({ variables: { ...variables, OMNIROUTE_HOST_ROLE: "laptop" } }), adapter: allAvailable() }))
      .rejects.toThrow("ONBOARDING_HOST_ROLE_INVALID:OMNIROUTE_HOST_ROLE");
  });

  test("an unplugged knowledge volume degrades to read-only instead of blocking", async () => {
    const plan = await createOnboardingPlan({
      catalog: createCoreOnboardingCatalog(),
      profile: profile({
        required_modules: ["storage.knowledge-volume"],
        secret_references: { OMNIROUTE_ADMIN: { store: "macos-keychain", service: "svc", account: "acct" } },
        variables: { ...createCoreOnboardingProfile().variables, KNOWLEDGE_VOLUME_ROOT: "/mnt/vault", KNOWLEDGE_VOLUME_UUID: "U", KNOWLEDGE_VAULT_RELATIVE_PATH: "v" },
      }),
      adapter: allAvailable({ "knowledge-volume-mount": { available: false, reason_code: "MOUNT_ABSENT" } }),
    });
    expect(plan.operating_mode).toBe("read-only-degraded");
  });

  test("a required organ held by the unplugged volume and by another failure stays blocked", async () => {
    const catalog = createCoreOnboardingCatalog();
    catalog.modules.find(({ id }) => id === "storage.knowledge-volume")!.requires.push({ id: "volume-tool", kind: "binary", executable: "volume-tool" });
    const vaultProfile = profile({
      required_modules: ["storage.knowledge-volume"],
      secret_references: { OMNIROUTE_ADMIN: { store: "macos-keychain", service: "svc", account: "acct" } },
      variables: { ...createCoreOnboardingProfile().variables, KNOWLEDGE_VOLUME_ROOT: "/mnt/vault", KNOWLEDGE_VOLUME_UUID: "U", KNOWLEDGE_VAULT_RELATIVE_PATH: "v" },
    });
    const unplugged = { "knowledge-volume-mount": { available: false, reason_code: "MOUNT_ABSENT" as const } };
    expect((await createOnboardingPlan({ catalog, profile: vaultProfile, adapter: allAvailable(unplugged) })).operating_mode).toBe("read-only-degraded");
    const plan = await createOnboardingPlan({ catalog, profile: vaultProfile, adapter: allAvailable({ ...unplugged, "volume-tool": { available: false, reason_code: "BINARY_MISSING" } }) });
    expect(plan.operating_mode).toBe("blocked");
  });

  test("a required organ blocked through the volume and by its own connector stays blocked", async () => {
    const vaultProfile = profile({
      required_modules: ["tunnel.knowledge-vault"],
      secret_references: { OMNIROUTE_ADMIN: { store: "macos-keychain", service: "svc", account: "acct" } },
      variables: { ...createCoreOnboardingProfile().variables, KNOWLEDGE_VOLUME_ROOT: "/mnt/vault", KNOWLEDGE_VOLUME_UUID: "U", KNOWLEDGE_VAULT_RELATIVE_PATH: "v", KNOWLEDGE_VAULT_SERVER_AGENT: "a.server", KNOWLEDGE_VAULT_TUNNEL_AGENT: "a.tunnel" },
    });
    const unplugged = { "knowledge-volume-mount": { available: false, reason_code: "MOUNT_ABSENT" as const } };
    const catalog = createCoreOnboardingCatalog();
    expect((await createOnboardingPlan({ catalog, profile: vaultProfile, adapter: allAvailable(unplugged) })).operating_mode).toBe("read-only-degraded");
    const plan = await createOnboardingPlan({ catalog, profile: vaultProfile, adapter: allAvailable({ ...unplugged, "knowledge-vault-tunnel-agent": { available: false, reason_code: "LAUNCH_AGENT_ABSENT" } }) });
    expect(plan.operating_mode).toBe("blocked");
  });

  test("health keeps a held optional organ out of the required holds", async () => {
    const plan = await createOnboardingPlan({
      catalog: createCoreOnboardingCatalog(),
      profile: profile({ secret_references: { OMNIROUTE_ADMIN: { store: "macos-keychain", service: "svc", account: "acct" } } }),
      adapter: allAvailable({ "obsidian-application": { available: false, reason_code: "APPLICATION_MISSING" } }),
      selections: new Set(["integration.obsidian-rest"]),
    });
    expect(plan.modules.find(({ id }) => id === "integration.obsidian-rest")?.status).toBe("blocked");
    const report = projectOperatorHealth({ plan, observedAt: "2026-10-04T00:00:00.000Z" });
    const held = report.checks.filter(({ id }) => id.startsWith("dependencies.integration.obsidian-rest."));
    expect(held.length).toBeGreaterThan(0);
    expect(held.every(({ status, required }) => status === "HOLD" && !required)).toBe(true);
    expect(report.checks.find(({ id }) => id === "dependencies.provider.omniroute")).toMatchObject({ status: "PASS", required: true });
  });

  test("doctor reports unselected organs as off without failing the section", async () => {
    const plan = await createOnboardingPlan({
      catalog: createCoreOnboardingCatalog(),
      profile: profile({ secret_references: { OMNIROUTE_ADMIN: { store: "macos-keychain", service: "svc", account: "acct" } } }),
      adapter: allAvailable(),
    });
    const section = projectOnboardingDoctorSection(plan);
    const off = section.checks.find(({ id }) => id === "onboarding-integration.mail-mcp");
    expect(off).toMatchObject({ condition: "SKIPPED", reason_code: "ORGAN_OFF", severity: "info", actionable: false, destination: "organ:optional:integration.mail-mcp" });
    const organIds = createCoreOnboardingCatalog().modules.filter(({ organ }) => organ).map(({ id }) => `onboarding-${id}`);
    expect(section.checks.map(({ id }) => id)).toEqual(expect.arrayContaining(organIds));
    expect(section.condition).toBe("PASS");
  });

  test("health keeps the precise reason for organ probe holds", async () => {
    const reasons = ["PORT_CLOSED", "LAUNCH_AGENT_ABSENT", "LAUNCH_AGENT_STOPPED", "ORIGIN_OFFLINE", "ORIGIN_UNVERIFIED"] as const;
    for (const reason_code of reasons) {
      const plan = await createOnboardingPlan({
        catalog: createCoreOnboardingCatalog(),
        profile: profile({ secret_references: { OMNIROUTE_ADMIN: { store: "macos-keychain", service: "svc", account: "acct" } } }),
        adapter: allAvailable({ "mail-mcp-port": { available: false, reason_code } }),
        selections: new Set(["integration.mail-mcp"]),
      });
      const report = projectOperatorHealth({ plan, observedAt: "2026-10-04T00:00:00.000Z" });
      const held = report.checks.filter(({ id }) => id.startsWith("dependencies.integration.mail-mcp."));
      expect(held.map(({ reason_code: reason }) => reason)).toEqual([reason_code]);
      expect(held[0]!.next_action).not.toBe("Review the selected module's setup and rerun its prerequisite checks.");
    }
  });

  test("the TUI toggle refuses to turn off a required organ but toggles optional ones", async () => {
    const plan = await createOnboardingPlan({ catalog: createCoreOnboardingCatalog(), profile: profile(), adapter: allAvailable() });
    const selected = new Set(plan.modules.filter(({ requested }) => requested).map(({ id }) => id));
    expect(() => toggleOnboardingModuleSelection(plan, selected, "provider.omniroute")).toThrow("ONBOARDING_MODULE_REQUIRED:provider.omniroute");
    const on = toggleOnboardingModuleSelection(plan, selected, "integration.obsidian-rest");
    expect(on.has("integration.obsidian-rest")).toBe(true);
    expect(toggleOnboardingModuleSelection(plan, on, "integration.obsidian-rest").has("integration.obsidian-rest")).toBe(false);
  });
});

describe("organ probes", () => {
  test("tcp-port reports open, closed, and honours a profile port override", async () => {
    const requirement: CapabilityRequirement = { id: "port", kind: "tcp-port", port: 1000, port_variable: "PORT" };
    let seenPort = 0;
    expect((await probeWith(requirement, { tcpConnect: async (_h, port) => { seenPort = port; return true; } }, { PORT: "2000" })).available).toBe(true);
    expect(seenPort).toBe(2000);
    expect((await probeWith(requirement, { tcpConnect: async () => false })).reason_code).toBe("PORT_CLOSED");
    expect((await probeWith(requirement, {}, { PORT: "not-a-port" })).reason_code).toBe("VARIABLE_INVALID");
  });

  test("launch-agent distinguishes running, stopped and absent without leaking the label", async () => {
    const requirement: CapabilityRequirement = { id: "agent", kind: "launch-agent", label_variable: "AGENT" };
    const variables = { AGENT: "private.example.agent" };
    const running = await probeWith(requirement, { execFile: async () => ({ stdout: "\tstate = running\n", stderr: "", exitCode: 0 }) }, variables);
    expect(running.reason_code).toBe("AVAILABLE");
    expect(JSON.stringify(running)).not.toContain("private.example.agent");
    const stopped = await probeWith(requirement, { execFile: async () => ({ stdout: "\tstate = not running\n", stderr: "", exitCode: 0 }) }, variables);
    expect(stopped.reason_code).toBe("LAUNCH_AGENT_STOPPED");
    const absent = await probeWith(requirement, { execFile: async () => ({ stdout: "", stderr: "Could not find service", exitCode: 113 }) }, variables);
    expect(absent.reason_code).toBe("LAUNCH_AGENT_ABSENT");
    expect((await probeWith(requirement, { platform: "linux" }, variables)).reason_code).toBe("UNSUPPORTED_PLATFORM");
  });

  test("http-health accepts listed statuses and names an offline tunnel origin", async () => {
    const requirement: CapabilityRequirement = { id: "memory", kind: "http-health", url_variable: "URL", accept_status: [200, 401] };
    const variables = { URL: "http://127.0.0.1:1/api/memory" };
    expect((await probeWith(requirement, { fetch: async () => new Response(null, { status: 401 }) }, variables)).available).toBe(true);
    expect((await probeWith(requirement, { fetch: async () => new Response(null, { status: 530 }) }, variables)).reason_code).toBe("ORIGIN_OFFLINE");
    expect((await probeWith(requirement, { fetch: async () => new Response(null, { status: 404 }) }, variables)).reason_code).toBe("HTTP_UNAVAILABLE");
  });

  test("the planner reports a missing private LaunchAgent label as a configuration hold", async () => {
    const plan = await createOnboardingPlan({
      catalog: createCoreOnboardingCatalog(),
      profile: profile(),
      adapter: allAvailable(),
      selections: new Set(["tunnel.temperance-memory"]),
    });
    const tunnel = plan.modules.find(({ id }) => id === "tunnel.temperance-memory")!;
    expect(tunnel.holds.map(({ reason_code }) => reason_code)).toContain("VARIABLE_MISSING");
  });
});

describe("organ presentation and doctor", () => {
  test("adds an Organs page ordered required → modular → optional and a router-first overview", async () => {
    const plan = await createOnboardingPlan({ catalog: createCoreOnboardingCatalog(), profile: profile(), adapter: allAvailable() });
    const view = createOnboardingViewModel(plan);
    expect(view.pages.map(({ id }) => id)).toEqual(["overview", "organs", "modules", "routing", "projects", "integrations", "review"]);
    const tiers = view.pages.find(({ id }) => id === "organs")!.rows.map(({ title }) => title.split(" · ")[0]);
    expect(tiers).toEqual([...tiers].sort((a, b) => ["required", "modular", "optional"].indexOf(a!) - ["required", "modular", "optional"].indexOf(b!)));
    expect(view.pages[0]!.rows.map(({ id }) => id)).toEqual(["profile", "router", "memory", "mount", "organs"]);
    expect(renderOnboardingText(plan)).toContain("ORGANS");
  });

  test("doctor fails on a held required organ but only warns on a held optional organ", async () => {
    const plan = await createOnboardingPlan({
      catalog: createCoreOnboardingCatalog(),
      profile: profile({ secret_references: { OMNIROUTE_ADMIN: { store: "macos-keychain", service: "svc", account: "acct" } } }),
      adapter: allAvailable({ "obsidian-rest-port": { available: false, reason_code: "PORT_CLOSED" } }),
      selections: new Set(["integration.obsidian-rest"]),
    });
    const optionalOnly = projectOnboardingDoctorSection(plan, "host");
    expect(optionalOnly.condition).toBe("WARN");
    expect(optionalOnly.checks.find(({ reason_code }) => reason_code === "PORT_CLOSED")?.destination).toBe("organ:optional:integration.obsidian-rest");

    const requiredHeld = await createOnboardingPlan({
      catalog: createCoreOnboardingCatalog(),
      profile: profile(),
      adapter: allAvailable(),
    });
    expect(projectOnboardingDoctorSection(requiredHeld).condition).toBe("FAIL");
  });
});

describe("required organ semantics (review follow-ups)", () => {
  const admin = { OMNIROUTE_ADMIN: { store: "macos-keychain" as const, service: "svc", account: "acct" } };

  test("required organs pull in their dependencies, and unknown escalations are rejected", () => {
    const catalog = createCoreOnboardingCatalog();
    const ids = requiredModuleIds(catalog, profile({ required_modules: ["tunnel.knowledge-vault"] }));
    expect(ids).toContain("tunnel.knowledge-vault");
    expect(ids).toContain("storage.knowledge-volume");
    expect(() => requiredModuleIds(catalog, profile({ required_modules: ["organ.unknown"] }))).toThrow("ONBOARDING_REQUIRED_MODULE_UNKNOWN:organ.unknown");
  });

  test("a dependency of a required organ cannot be turned off and is marked required", async () => {
    const plan = await createOnboardingPlan({
      catalog: createCoreOnboardingCatalog(),
      profile: profile({ required_modules: ["tunnel.knowledge-vault"] }),
      adapter: allAvailable(),
    });
    const volume = plan.modules.find(({ id }) => id === "storage.knowledge-volume")!;
    expect(volume.required).toBe(true);
    expect(volume.organ?.tier).toBe("required");
    const selected = new Set(plan.modules.filter(({ requested }) => requested).map(({ id }) => id));
    expect(() => toggleOnboardingModuleSelection(plan, selected, "storage.knowledge-volume")).toThrow("ONBOARDING_MODULE_REQUIRED");
  });

  test("a required module without an organ block is still protected from deselection", async () => {
    const catalog = createCoreOnboardingCatalog();
    catalog.modules.push({ id: "custom.plain", title: "Plain", summary: "A module without an organ block.", preselection: "available", depends_on: [], requires: [], guided_installs: [] });
    const plan = await createOnboardingPlan({ catalog, profile: profile({ required_modules: ["custom.plain"] }), adapter: allAvailable() });
    const plain = plan.modules.find(({ id }) => id === "custom.plain")!;
    expect(plain.required).toBe(true);
    expect(() => toggleOnboardingModuleSelection(plan, new Set(plan.modules.filter(({ requested }) => requested).map(({ id }) => id)), "custom.plain"))
      .toThrow("ONBOARDING_MODULE_REQUIRED:custom.plain");
  });

  test("an unplugged volume cannot mask a required organ broken for another reason", async () => {
    // Bind every label so the vault tunnel's only possible hold is its unplugged dependency.
    const variables = { ...createCoreOnboardingProfile().variables, KNOWLEDGE_VOLUME_ROOT: "/mnt/vault", KNOWLEDGE_VOLUME_UUID: "U", KNOWLEDGE_VAULT_RELATIVE_PATH: "v", KNOWLEDGE_VAULT_SERVER_AGENT: "a.server", KNOWLEDGE_VAULT_TUNNEL_AGENT: "a.tunnel" };
    const unplugged = { "knowledge-volume-mount": { available: false, reason_code: "MOUNT_ABSENT" as const } };
    const degraded = await createOnboardingPlan({
      catalog: createCoreOnboardingCatalog(),
      profile: profile({ required_modules: ["tunnel.knowledge-vault"], secret_references: admin, variables }),
      adapter: allAvailable(unplugged),
    });
    // The vault tunnel is held only through its unplugged dependency: still read-only degraded.
    expect(degraded.operating_mode).toBe("read-only-degraded");
    const broken = await createOnboardingPlan({
      catalog: createCoreOnboardingCatalog(),
      profile: profile({ required_modules: ["tunnel.knowledge-vault"], secret_references: admin, variables }),
      adapter: allAvailable({ ...unplugged, "omniroute-health": { available: false, reason_code: "HTTP_UNAVAILABLE" } }),
    });
    expect(broken.operating_mode).toBe("blocked");
  });
});

describe("probe hardening (review follow-ups)", () => {
  test("http-health never follows redirects and treats a cross-host redirect as unverified", async () => {
    const requirement: CapabilityRequirement = { id: "tunnel", kind: "http-health", url_variable: "URL", method: "GET", accept_status: [200, 302, 307] };
    const variables = { URL: "https://memory.example.test/" };
    let redirectMode: string | undefined;
    const crossHost = await probeWith(requirement, {
      fetch: async (_url, options) => { redirectMode = options.redirect; return new Response(null, { status: 302, headers: { location: "https://login.example.net/" } }); },
    }, variables);
    expect(redirectMode).toBe("manual");
    expect(crossHost.reason_code).toBe("ORIGIN_UNVERIFIED");
    const sameHost = await probeWith(requirement, { fetch: async () => new Response(null, { status: 307, headers: { location: "/login" } }) }, variables);
    expect(sameHost.reason_code).toBe("AVAILABLE");
    expect((await probeWith(requirement, {}, { URL: "file:///etc/hosts" })).reason_code).toBe("VARIABLE_INVALID");
  });

  test("launch-agent evidence keeps the full state text and rejects malformed private labels", async () => {
    const requirement: CapabilityRequirement = { id: "agent", kind: "launch-agent", label_variable: "AGENT" };
    const stdout = "gui/501/x = {\n\tstate = not running\n\tendpoints = {\n\t\tstate = active\n\t}\n}\n";
    const stopped = await probeWith(requirement, { execFile: async () => ({ stdout, stderr: "", exitCode: 0 }) }, { AGENT: "valid.label" });
    expect(stopped.evidence).toEqual(["LaunchAgent state is not running"]);
    expect((await probeWith(requirement, {}, { AGENT: "bad label; rm -rf" })).reason_code).toBe("VARIABLE_INVALID");
  });

  test("tcp-port rejects lax numeric overrides", async () => {
    const requirement: CapabilityRequirement = { id: "port", kind: "tcp-port", port: 1000, port_variable: "PORT" };
    for (const value of ["0x50", "1e3", " 80 ", "0", "70000"]) expect((await probeWith(requirement, {}, { PORT: value })).reason_code).toBe("VARIABLE_INVALID");
  });

  test("the real TCP probe sees an open port, a closed port and an aborted signal", async () => {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const requirement: CapabilityRequirement = { id: "port", kind: "tcp-port", port: server.port };
    const adapter = createSystemProbeAdapter({ io: { ...io(), tcpConnect: undefined } });
    const context = { profile: profile(), signal: new AbortController().signal };
    expect((await adapter.probe(requirement, context)).reason_code).toBe("AVAILABLE");
    const aborted = new AbortController(); aborted.abort();
    expect((await adapter.probe(requirement, { ...context, signal: aborted.signal })).reason_code).toBe("PORT_CLOSED");
    server.stop(true);
    expect((await adapter.probe(requirement, context)).reason_code).toBe("PORT_CLOSED");
  });
});

describe("host profile persistence helpers", () => {
  test("retired modules are dropped from selections and escalations only when the catalog lacks them", () => {
    const legacyProfile = profile({ preselected_modules: ["provider.9router", "integration.mail-mcp"], required_modules: ["provider.9router"] });
    const dropped = withoutRetiredModules(legacyProfile, createCoreOnboardingCatalog());
    expect(dropped.dropped).toEqual(["provider.9router"]);
    expect(dropped.profile.preselected_modules).toEqual(["integration.mail-mcp"]);
    expect(dropped.profile.required_modules).toEqual([]);
    expect(withoutRetiredModules(legacyProfile, createLegacyNineRouterCatalog()).dropped).toEqual([]);
  });

});

describe("organs in the 0.6.0 setup wizard", () => {
  async function corePlan(overrides: Record<string, Partial<CapabilityProbe>> = {}, selections?: Set<string>) {
    return await createOnboardingPlan({
      catalog: createCoreOnboardingCatalog(),
      profile: profile({ secret_references: { OMNIROUTE_ADMIN: { store: "macos-keychain", service: "svc", account: "acct" } } }),
      adapter: allAvailable(overrides),
      selections,
    });
  }

  test("required organs are locked on the Organs & tools step and never deferred", async () => {
    const plan = await corePlan({ "omniroute-health": { available: false, reason_code: "HTTP_UNAVAILABLE" }, "mail-mcp-port": { available: false, reason_code: "PORT_CLOSED" } }, new Set(["integration.mail-mcp"]));
    const options = { allowModuleReplan: true };
    const organs = createOnboardingWizardView(plan, { ...createOnboardingWizardState(plan, options), step: "modules" }, options);
    const router = organs.rows.find(({ id }) => id === "module.provider.omniroute")!;
    expect(router.title.startsWith("● Required")).toBe(true);
    expect(router.disabled).toBe(true);
    // Defer-blocked lists held optional modules only, never a held required organ.
    const integrations = createOnboardingWizardView(plan, { ...createOnboardingWizardState(plan, options), step: "integrations" }, options);
    expect(integrations.rows.find(({ id }) => id === "defer-blocked")?.details).toEqual(["integration.mail-mcp"]);
    expect(organs.rows.some(({ id }) => id === "defer-blocked")).toBe(false);
  });

  test("Save organ selection hands off save_module_selections and is refused without a destination", async () => {
    const plan = await corePlan();
    const allowed = { allowModuleReplan: true, allowModuleSelectionSave: true };
    const state = { ...createOnboardingWizardState(plan, allowed), step: "modules" as const };
    const transition = handleOnboardingWizardKey(plan, state, allowed, "enter", "save-organs");
    expect(transition.effect).toEqual({ kind: "save-organs" });
    expect(completeOnboardingWizard(plan, transition.state, allowed, transition.effect!).save_module_selections).toBe(true);
    expect(() => completeOnboardingWizard(plan, state, { allowModuleReplan: true }, { kind: "save-organs" })).toThrow("ONBOARDING_MODULE_SAVE_UNAVAILABLE");
    const without = createOnboardingWizardView(plan, state, { allowModuleReplan: true });
    expect(without.rows.find(({ id }) => id === "save-organs")?.disabled).toBe(true);
  });

  test("the Host step shows the router, memory and knowledge volume instead of 9Router", async () => {
    const plan = await corePlan();
    const host = createOnboardingWizardView(plan, createOnboardingWizardState(plan), {});
    const ids = host.rows.map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining(["host.provider.omniroute", "host.memory.temperance", "host.storage.knowledge-volume"]));
    expect(ids).not.toContain("host.provider.9router");
  });
});

describe("organ registry CLI", () => {
  async function onboardAgent(files: { profile: object; preferences?: object }, extra: string[]) {
    const root = mkdtempSync(join(tmpdir(), "organ-cli-"));
    const profilePath = join(root, "profile.json");
    const preferencesPath = join(root, "preferences.json");
    writeFileSync(profilePath, JSON.stringify(files.profile));
    if (files.preferences) writeFileSync(preferencesPath, JSON.stringify(files.preferences), { mode: 0o600 });
    const child = Bun.spawn([process.execPath, "src/cli.ts", "onboard", "--profile", profilePath, "--wizard-state", preferencesPath, "--agent", ...extra], {
      cwd: resolve(import.meta.dir, ".."), stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr, preferencesPath };
  }

  test("saved preferences that name a retired module load with a notice instead of failing", async () => {
    const core = { ...createCoreOnboardingProfile(), id: "organ-cli" };
    const { code, stdout, stderr } = await onboardAgent({
      profile: core,
      preferences: { schema: "temperance.onboarding-preferences.v1", profile_id: core.id, selected_module_ids: ["integration.mail-mcp", "provider.9router"] },
    }, []);
    expect(code).toBe(0);
    expect(stderr).toBe(retiredModuleNotice("provider.9router"));
    expect(JSON.parse(stdout).state.requested_module_ids).toContain("integration.mail-mcp");
    expect(JSON.parse(stdout).state.requested_module_ids).not.toContain("provider.9router");
  }, 60_000);

  test("the agent can request save-organs as an explicit-confirmation handoff without writing", async () => {
    const { code, stdout, preferencesPath } = await onboardAgent({ profile: { ...createCoreOnboardingProfile(), id: "organ-cli" } }, ["--step", "modules", "--action", "save-organs"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).handoff).toMatchObject({ kind: "save-organs", authority: "explicit-confirmation", execution: "not-performed" });
    expect(existsSync(preferencesPath)).toBe(false);
  }, 60_000);

  test("automatic preferences saved under another profile are ignored instead of failing", async () => {
    const root = mkdtempSync(join(tmpdir(), "organ-cli-auto-"));
    const profilePath = join(root, "profile.v1.json");
    writeFileSync(profilePath, JSON.stringify({ ...createCoreOnboardingProfile(), id: "host-profile" }), { mode: 0o600 });
    writeFileSync(join(root, "preferences.v1.json"), JSON.stringify({ schema: "temperance.onboarding-preferences.v1", profile_id: "temperance-portable-core", selected_module_ids: ["integration.mail-mcp"] }), { mode: 0o600 });
    const child = Bun.spawn([process.execPath, "src/cli.ts", "onboard", "--agent"], {
      cwd: resolve(import.meta.dir, ".."), stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, TEMPERANCE_ONBOARDING_PROFILE: profilePath },
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(0);
    expect(stderr).toBe("temperance onboard: ignoring saved organ choices from another profile; the next save replaces them\n");
    expect(JSON.parse(stdout).state.requested_module_ids).not.toContain("integration.mail-mcp");
    expect(JSON.parse(readFileSync(join(root, "preferences.v1.json"), "utf8")).profile_id).toBe("temperance-portable-core");
  }, 60_000);

  test("retired organ ids carry a replacement hint", () => {
    expect(retiredModuleNotice("integration.omniroute-a2a")).toContain("integration.hermes-a2a");
    expect(retiredIdsOutsideCatalog(createCoreOnboardingCatalog())).toEqual(["integration.company-omniroute", "integration.omniroute-a2a", "provider.9router"]);
    expect(retiredIdsOutsideCatalog(createLegacyNineRouterCatalog())).not.toContain("provider.9router");
  });
});

describe("environment secret references (cloud runner)", () => {
  const requirement: CapabilityRequirement = { id: "omniroute-admin-secret", kind: "keychain-secret", secret_reference: "OMNIROUTE_ADMIN" };
  const probeOn = async (platform: NodeJS.Platform, reference: OnboardingProfileV1["secret_references"][string], env: Record<string, string> = {}) =>
    createSystemProbeAdapter({ io: io({ platform, env: (name) => env[name] }) })
      .probe(requirement, { profile: profile({ secret_references: { OMNIROUTE_ADMIN: reference } }), signal: new AbortController().signal });

  test("an environment reference is satisfied on any platform by its presence alone", async () => {
    const reference = { store: "environment" as const, variable: "TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD" };
    const set = await probeOn("linux", reference, { TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD: "not-printed" });
    expect(set).toMatchObject({ available: true, reason_code: "AVAILABLE" });
    expect(JSON.stringify(set)).not.toContain("not-printed");
    expect(await probeOn("linux", reference)).toMatchObject({ available: false, reason_code: "SECRET_UNAVAILABLE" });
  });

  test("a Keychain reference still needs macOS", async () => {
    expect(await probeOn("linux", { store: "macos-keychain", service: "svc", account: "acct" })).toMatchObject({ available: false, reason_code: "UNSUPPORTED_PLATFORM" });
  });

  test("the profile schema accepts an environment reference and rejects a malformed one", () => {
    const withReference = (reference: unknown) => profile({ secret_references: { OMNIROUTE_ADMIN: reference as never } });
    expect(validateOnboardingProfile(withReference({ store: "environment", variable: "TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD" }))).toBe(true);
    expect(validateOnboardingProfile(withReference({ store: "environment", variable: "lower_case" }))).toBe(false);
    expect(validateOnboardingProfile(withReference({ store: "environment", variable: "OK", service: "svc" }))).toBe(false);
    expect(validateOnboardingProfile(withReference({ store: "macos-keychain", service: "svc", account: "acct" }))).toBe(true);
  });

  test("the 9Router flow refuses an environment reference, because it writes Keychain items", () => {
    const envProfile = profile({ secret_references: { GATEWAY: { store: "environment", variable: "GATEWAY_KEY" } } });
    expect(() => nineRouterKeychainReference(envProfile, "GATEWAY", "MISSING")).toThrow("NINE_ROUTER_SETUP_KEYCHAIN_REFERENCE_REQUIRED");
    expect(() => nineRouterKeychainReference(envProfile, "ABSENT", "MISSING")).toThrow("MISSING");
  });
});
