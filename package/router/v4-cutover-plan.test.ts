import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseV4CutoverPlanArguments } from "../../scripts/v4-cutover-plan.ts";
import {
  MANAGED_LAUNCH_AGENTS,
  ROUTER_VERSION,
  V4_CUTOVER_PLAN_SCHEMA,
  calculateV4CutoverPlanDigest,
  createV4CutoverPlan as createRawV4CutoverPlan,
  resolveManagedRouterPortObservation,
  verifyV4CutoverPlanDigest,
  type V4CutoverHostObservation,
  type V4CutoverPlanOptions,
} from "./v4-cutover-plan.ts";

const temporaryRoots: string[] = [];
const TEST_HOST: V4CutoverHostObservation = {
  platform: "darwin",
  hardware_model: "Mac16,11",
  chip_model: "Apple M4",
  architecture: "arm64",
  user_id: process.getuid?.() ?? 501,
};

function createV4CutoverPlan(options: V4CutoverPlanOptions = {}) {
  return createRawV4CutoverPlan({ ...options, observeHost: options.observeHost ?? (() => TEST_HOST) });
}

function fixtureRoot(): string {
  const root = mkdtempSync(resolve(tmpdir(), "temperance-v4-cutover-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("V4 cutover plan", () => {
  test("inventories the complete allowlist without reading or emitting a credential value", () => {
    const home = fixtureRoot();
    const launchAgents = join(home, "Library", "LaunchAgents");
    mkdirSync(join(home, ".temperance_engine", "backups"), { recursive: true });
    mkdirSync(join(home, ".omniroute"), { recursive: true });
    mkdirSync(join(home, ".9router"), { recursive: true });
    writeFileSync(join(home, ".temperance_engine", "runtime.ts"), "export {};\n");
    writeFileSync(join(home, ".temperance_engine", "legacy-path.ts"), 'const old = "twc-vault/01-Projects/thoughtseed";\n');
    writeFileSync(join(home, ".omniroute", "state.db"), "not-a-real-db\n");
    mkdirSync(launchAgents, { recursive: true });
    for (const filename of MANAGED_LAUNCH_AGENTS) {
      writeFileSync(join(launchAgents, filename), "SUPER_SECRET_VALUE_MUST_NOT_ESCAPE\n");
    }

    const plan = createV4CutoverPlan({
      homeDirectory: home,
      launchAgentsDirectory: launchAgents,
      platform: "darwin",
      now: () => new Date("2026-09-17T00:00:00.000Z"),
      findBinary: (name) => `/managed/bin/${name}`,
      readVersion: (binary) => binary.endsWith("/9router") ? "9router 0.5.69" : "omniroute 3.8.49",
      inspectPort: (port) => ({
        port,
        owner: "legacy-omniroute",
        pid: 1438,
        process: "node",
        listener_host: "127.0.0.1",
        loopback_only: true,
        managed_service_label: "com.temperance.engine.omniroute",
      }),
    });

    expect(plan.schema).toBe(V4_CUTOVER_PLAN_SCHEMA);
    expect(plan.host).toEqual(TEST_HOST);
    expect(plan.target).toEqual({ package: "9router", version: ROUTER_VERSION });
    expect(plan.paths.map(({ id }) => id)).toEqual(["runtime", "legacy-omniroute", "legacy-omnirouter", "router-state"]);
    expect(plan.launch_agents).toHaveLength(MANAGED_LAUNCH_AGENTS.length);
    expect(plan.binaries).toEqual([
      { package: "omniroute", path: "/managed/bin/omniroute", version: "3.8.49", disposition: "remove" },
      { package: "9router", path: "/managed/bin/9router", version: "0.5.69", disposition: "install-exact" },
    ]);
    expect(plan.router_port.owner).toBe("legacy-omniroute");
    expect(plan.migration_findings).toEqual([{
      code: "LEGACY_PROJECT_ROOT_REFERENCE",
      managed_path_id: "runtime",
      relative_path: "legacy-path.ts",
      occurrence_count: 1,
      remediation: "Migrate this managed runtime reference to a bound V4 project root before activation.",
    }]);
    expect(plan.activation_blocked).toBe(false);
    expect(plan.actions.map(({ order }) => order)).toEqual([...plan.actions.map(({ order }) => order)].sort((a, b) => a - b));
    expect(plan.policy).toEqual({ runnable_backup: false, secret_values_recorded: false, destructive_execution_authorized: false });
    expect(JSON.stringify(plan)).not.toContain("SUPER_SECRET_VALUE_MUST_NOT_ESCAPE");
    expect(JSON.stringify(plan.migration_findings)).not.toContain(home);
    expect(plan.plan_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(verifyV4CutoverPlanDigest(plan)).toBe(true);
    expect(calculateV4CutoverPlanDigest(plan)).toBe(plan.plan_digest);
    expect(plan.actions.slice(0, 2).map(({ id }) => id)).toEqual(["verify-isolated-replacement", "capture-redacted-inventory"]);
  });

  test("fails closed when an unmanaged process owns the replacement port", () => {
    const home = fixtureRoot();
    const plan = createV4CutoverPlan({
      homeDirectory: home,
      platform: "darwin",
      findBinary: () => null,
      readVersion: () => null,
      inspectPort: (port) => ({ port, owner: "unknown", pid: 42, process: "mystery" }),
    });

    expect(plan.activation_blocked).toBe(true);
    expect(plan.blocking_reasons).toContain("ROUTER_PORT_OWNED_BY_UNMANAGED_PROCESS");
    expect(plan.actions.find(({ id }) => id === "activate-replacement-router")?.status).toBe("blocked");
  });

  test("fails closed when a router-like listener has no managed service owner", () => {
    const home = fixtureRoot();
    const plan = createV4CutoverPlan({
      homeDirectory: home,
      platform: "darwin",
      findBinary: () => null,
      readVersion: () => null,
      inspectPort: (port) => ({
        port,
        owner: "legacy-omniroute",
        pid: 42,
        process: "omniroute",
        listener_host: "127.0.0.1",
        loopback_only: true,
      }),
    });

    expect(plan.activation_blocked).toBe(true);
    expect(plan.blocking_reasons).toContain("ROUTER_PORT_OWNER_NOT_MANAGED_SERVICE");
  });

  test("stabilizes a restarting managed router and blocks dual loaded services", () => {
    expect(resolveManagedRouterPortObservation(
      { port: 20128, owner: "free", listener_present: false },
      [{ label: "com.temperance.engine.omniroute", owner: "legacy-omniroute" }],
    )).toEqual({
      port: 20128,
      owner: "legacy-omniroute",
      listener_present: false,
      managed_service_label: "com.temperance.engine.omniroute",
    });
    const home = fixtureRoot();
    const plan = createV4CutoverPlan({
      homeDirectory: home,
      platform: "darwin",
      findBinary: () => null,
      readVersion: () => null,
      inspectPort: (port) => resolveManagedRouterPortObservation(
        { port, owner: "free", listener_present: false },
        [
          { label: "com.temperance.engine.omniroute", owner: "legacy-omniroute" },
          { label: "com.temperance.engine.9router", owner: "replacement-9router" },
        ],
      ),
    });
    expect(plan.blocking_reasons).toContain("MULTIPLE_MANAGED_ROUTER_SERVICES_LOADED");
  });

  test("fails closed when 9router is listening beyond loopback", () => {
    const home = fixtureRoot();
    const plan = createV4CutoverPlan({
      homeDirectory: home,
      platform: "darwin",
      findBinary: () => null,
      readVersion: () => null,
      inspectPort: (port) => ({ port, owner: "replacement-9router", pid: 75, process: "node", listener_host: "*", loopback_only: false }),
    });
    expect(plan.activation_blocked).toBe(true);
    expect(plan.blocking_reasons).toContain("ROUTER_LISTENER_NOT_LOOPBACK_ONLY");
  });

  test("is deterministic apart from its observation timestamp", () => {
    const home = fixtureRoot();
    const options = {
      homeDirectory: home,
      platform: "darwin" as const,
      findBinary: () => null,
      readVersion: () => null,
      inspectPort: (port: number) => ({ port, owner: "free" as const }),
    };
    const first = createV4CutoverPlan({ ...options, now: () => new Date("2026-09-17T00:00:00.000Z") });
    const second = createV4CutoverPlan({ ...options, now: () => new Date("2026-09-18T00:00:00.000Z") });
    expect(first.generated_at).not.toBe(second.generated_at);
    expect(first.plan_digest).toBe(second.plan_digest);
  });

  test("plan confirmation digest excludes volatile managed child process identity", () => {
    const home = fixtureRoot();
    const common = {
      homeDirectory: home,
      platform: "darwin" as const,
      findBinary: () => null,
      readVersion: () => null,
    };
    const first = createV4CutoverPlan({
      ...common,
      inspectPort: (port) => ({
        port,
        owner: "legacy-omniroute",
        pid: 101,
        process: "node-a",
        listener_host: "127.0.0.1",
        loopback_only: true,
        listener_present: true,
        managed_service_label: "com.temperance.engine.omniroute",
      }),
    });
    const second = createV4CutoverPlan({
      ...common,
      inspectPort: (port) => ({
        port,
        owner: "legacy-omniroute",
        pid: 202,
        process: "node-b",
        listener_host: null,
        loopback_only: null,
        listener_present: false,
        managed_service_label: "com.temperance.engine.omniroute",
      }),
    });
    expect(first.plan_digest).toBe(second.plan_digest);
  });

  test("binds confirmation scope to the observed Mac identity", () => {
    const home = fixtureRoot();
    const options = {
      homeDirectory: home,
      platform: "darwin" as const,
      findBinary: () => null,
      readVersion: () => null,
      inspectPort: (port: number) => ({ port, owner: "free" as const }),
    };
    const first = createV4CutoverPlan(options);
    const second = createV4CutoverPlan({
      ...options,
      observeHost: () => ({ ...TEST_HOST, hardware_model: "Mac15,12", chip_model: "Apple M3" }),
    });
    expect(first.plan_digest).not.toBe(second.plan_digest);
    expect(verifyV4CutoverPlanDigest(second)).toBe(true);
  });

  test("always reinstalls the exact router during a full rebuild", () => {
    const home = fixtureRoot();
    const plan = createV4CutoverPlan({
      homeDirectory: home,
      platform: "darwin",
      findBinary: (name) => `/managed/bin/${name}`,
      readVersion: (binary) => binary.endsWith("/9router") ? `9router ${ROUTER_VERSION}` : "omniroute 3.8.49",
      inspectPort: (port) => ({
        port,
        owner: "replacement-9router",
        pid: 75,
        process: "9router",
        listener_host: "127.0.0.1",
        loopback_only: true,
        managed_service_label: "com.temperance.engine.9router",
      }),
    });
    expect(plan.binaries.find(({ package: name }) => name === "9router")?.disposition).toBe("install-exact");
    expect(plan.actions.find(({ id }) => id === "install-exact-router")).toMatchObject({ required: true, status: "ready" });
    expect(plan.actions.find(({ id }) => id === "stop-router-port-owner")).toMatchObject({ required: true, status: "ready" });
  });

  test("reads package metadata without executing a router binary", () => {
    const home = fixtureRoot();
    const prefix = join(home, "prefix");
    const packageRoot = join(prefix, "lib", "node_modules", "9router");
    const binaryDirectory = join(prefix, "bin");
    mkdirSync(packageRoot, { recursive: true });
    mkdirSync(binaryDirectory, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "9router", version: "0.5.75" }));
    writeFileSync(join(packageRoot, "cli.js"), "throw new Error('must never execute');\n");
    symlinkSync(join("..", "lib", "node_modules", "9router", "cli.js"), join(binaryDirectory, "9router"));
    const plan = createV4CutoverPlan({
      homeDirectory: home,
      platform: "darwin",
      findBinary: (name) => name === "9router" ? join(binaryDirectory, "9router") : null,
      inspectPort: (port) => ({ port, owner: "free" }),
    });
    expect(plan.binaries.find(({ package: name }) => name === "9router")?.version).toBe("0.5.75");
  });

  test("does not follow symlinks while counting managed files", () => {
    const home = fixtureRoot();
    const outside = fixtureRoot();
    mkdirSync(join(home, ".omniroute"), { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "outside\n");
    symlinkSync(outside, join(home, ".omniroute", "external"));
    const plan = createV4CutoverPlan({
      homeDirectory: home,
      platform: "darwin",
      findBinary: () => null,
      readVersion: () => null,
      inspectPort: (port) => ({ port, owner: "free" }),
    });
    expect(plan.paths.find(({ id }) => id === "legacy-omniroute")?.file_count).toBe(0);
    expect(plan.activation_blocked).toBe(false);
  });

  test("blocks a symlink at a managed root before destructive execution", () => {
    const home = fixtureRoot();
    const outside = fixtureRoot();
    symlinkSync(outside, join(home, ".omniroute"));
    const plan = createV4CutoverPlan({
      homeDirectory: home,
      platform: "darwin",
      findBinary: () => null,
      readVersion: () => null,
      inspectPort: (port) => ({ port, owner: "free" }),
    });
    expect(plan.activation_blocked).toBe(true);
    expect(plan.blocking_reasons).toContain("MANAGED_PATH_TYPE_UNSAFE:legacy-omniroute");
  });

  test("parses only the two read-only path overrides", () => {
    expect(parseV4CutoverPlanArguments(["--home", "/tmp/home", "--launch-agents", "/tmp/agents"])).toEqual({
      homeDirectory: "/tmp/home",
      launchAgentsDirectory: "/tmp/agents",
    });
    expect(() => parseV4CutoverPlanArguments(["--apply"])).toThrow("CUTOVER_ARGUMENT_INVALID");
    expect(parseV4CutoverPlanArguments(["--help"])).toBe("help");
  });
});
