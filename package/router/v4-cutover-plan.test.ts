import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseV4CutoverPlanArguments } from "../../scripts/v4-cutover-plan.ts";
import {
  MANAGED_LAUNCH_AGENTS,
  ROUTER_VERSION,
  V4_CUTOVER_PLAN_SCHEMA,
  createV4CutoverPlan,
} from "./v4-cutover-plan.ts";

const temporaryRoots: string[] = [];

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
      inspectPort: (port) => ({ port, owner: "legacy-omniroute", pid: 1438, process: "node", listener_host: "127.0.0.1", loopback_only: true }),
    });

    expect(plan.schema).toBe(V4_CUTOVER_PLAN_SCHEMA);
    expect(plan.target).toEqual({ package: "9router", version: ROUTER_VERSION });
    expect(plan.paths.map(({ id }) => id)).toEqual(["runtime", "legacy-omniroute", "legacy-omnirouter", "router-state"]);
    expect(plan.launch_agents).toHaveLength(MANAGED_LAUNCH_AGENTS.length);
    expect(plan.binaries).toEqual([
      { package: "omniroute", path: "/managed/bin/omniroute", version: "3.8.49", disposition: "remove" },
      { package: "9router", path: "/managed/bin/9router", version: "0.5.69", disposition: "install-exact" },
    ]);
    expect(plan.router_port.owner).toBe("legacy-omniroute");
    expect(plan.activation_blocked).toBe(false);
    expect(plan.actions.map(({ order }) => order)).toEqual([...plan.actions.map(({ order }) => order)].sort((a, b) => a - b));
    expect(plan.policy).toEqual({ runnable_backup: false, secret_values_recorded: false, destructive_execution_authorized: false });
    expect(JSON.stringify(plan)).not.toContain("SUPER_SECRET_VALUE_MUST_NOT_ESCAPE");
    expect(plan.plan_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
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
