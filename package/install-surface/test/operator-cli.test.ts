import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseOnboardingArgs } from "../src/onboarding/cli-args.ts";
import { createCoreOnboardingCatalog, createCoreOnboardingProfile } from "../src/onboarding/core-catalog.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "te-operator-cli-"))); roots.push(root);
  const state = join(root, "state");
  const env = { ...process.env, HOME: root, CODEX_HOME: join(root, "codex"), CLAUDE_CONFIG_DIR: join(root, "claude"), TEMPERANCE_STATE: state, TEMPERANCE_SESSION_POLICY: undefined };
  const catalog = createCoreOnboardingCatalog();
  // CLI contract tests must not spawn the live global 9Router executable.
  catalog.modules[0]!.requires = [];
  catalog.modules.push({ id: "core.tools", title: "Tools", summary: "Portable tools", preselection: "available", depends_on: [], requires: [], guided_installs: [] });
  writeFileSync(join(root, "catalog.json"), JSON.stringify(catalog));
  writeFileSync(join(root, "profile.json"), JSON.stringify(createCoreOnboardingProfile()));
  const run = (args: string[]) => Bun.spawnSync([process.execPath, "--no-env-file", "--config=/dev/null", resolve(import.meta.dir, "../src/cli.ts"), "onboard", ...(args.includes("--logs") ? [] : ["--catalog", join(root, "catalog.json"), "--profile", join(root, "profile.json")]), ...args], { env, cwd: root });
  return { root, state, run };
}

describe("operator command arguments", () => {
  test("headless, health and bounded log views are explicit", () => {
    expect(parseOnboardingArgs(["--agent", "--step", "projects", "--action", "continue", "--telemetry"])).toMatchObject({ agent: true, step: "projects", actionId: "continue", telemetry: true });
    expect(parseOnboardingArgs(["--health", "--json"])).toMatchObject({ health: true, json: true });
    expect(parseOnboardingArgs(["--logs", "--limit", "20"])).toMatchObject({ logs: true, logLimit: 20 });
  });
  test.each([
    ["--agent", "--tui"], ["--agent", "--repair"], ["--health", "--doctor"], ["--health", "--step", "host"],
    ["--action", "continue"], ["--agent", "--step", "unknown"], ["--limit", "10"],
    ["--logs", "--limit", "201"], ["--logs", "--limit", "0"], ["--logs", "--telemetry"],
    ["--logs", "--profile", "private.json"], ["--telemetry", "--json"],
  ])("invalid combinations fail closed: %j", (...args) => {
    expect(() => parseOnboardingArgs(args as string[])).toThrow("ONBOARDING_ARGUMENT_INVALID");
  });
});

test("headless navigation runs without terminal and does not write", () => {
  const { run, state } = fixture();
  const result = run(["--agent", "--step", "host", "--action", "continue"]);
  expect(result.exitCode).toBe(0);
  const flow = JSON.parse(result.stdout.toString());
  expect(flow).toMatchObject({ schema: "temperance.onboarding.agent-flow.v1", step: "projects", runtime_activation: "not-performed", context_readiness: "unverified", telemetry: { enabled: false, status: "disabled" } });
  expect(flow.steps).toHaveLength(7);
  expect(flow.steps.map((step: { id: string }) => step.id)).toEqual(["host", "projects", "providers", "combos", "modules", "integrations", "review"]);
  expect(flow.actions[0].id).toBe("continue");
  expect(flow.actions.some((action: { id: string }) => action.id === "health")).toBe(true);
  expect(existsSync(state)).toBe(false);
});

test("unknown action exposes only a stable error", () => {
  const { run, state } = fixture();
  const result = run(["--agent", "--action", "token-honey-secret"]);
  expect(result.exitCode).toBe(64);
  expect(result.stderr.toString()).toContain("AGENT_FLOW_ACTION_UNKNOWN");
  expect(result.stderr.toString()).not.toContain("token-honey-secret");
  expect(existsSync(state)).toBe(false);
});

test("opt-in events can be queried by run without private data", () => {
  const { run, state, root } = fixture();
  const flowRun = run(["--agent", "--telemetry"]);
  expect(flowRun.exitCode).toBe(0);
  const flow = JSON.parse(flowRun.stdout.toString());
  expect(flow.telemetry.status).toBe("local-metadata-only");
  const logs = run(["--logs", "--json", "--run", flow.telemetry.run_id]);
  expect(logs.exitCode).toBe(0);
  const events = JSON.parse(logs.stdout.toString()).events;
  expect(events.map((event: { event_type: string }) => event.event_type)).toEqual(["started", "step", "completed"]);
  const bytes = readFileSync(join(state, "operator-events/events.v1.jsonl"), "utf8");
  expect(bytes).not.toContain(root);
  expect(bytes).not.toContain("provider.9router");
});

test("missing logs are empty and do not create state", () => {
  const { run, state } = fixture();
  const result = run(["--logs", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString()).events).toEqual([]);
  expect(existsSync(state)).toBe(false);
});

test("health is a fresh structured observation, not activation", () => {
  const { run, state } = fixture();
  const result = run(["--health", "--json"]);
  expect([0, 1]).toContain(result.exitCode);
  const health = JSON.parse(result.stdout.toString());
  expect(health).toMatchObject({ schema: "temperance.operator-health.v1", readiness_scope: "configuration-only", context_capacity: "unverified" });
  expect(health.groups.map((group: { id: string }) => group.id).sort()).toEqual(["dependencies", "installation", "routing", "session"]);
  expect(health.counts.active_modules_verified).toBe(0);
  expect(existsSync(state)).toBe(false);
});

test("headless confirmation is a required handoff, never persistence", () => {
  const { run, state } = fixture();
  const result = run(["--agent", "--step", "review", "--action", "confirm"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toMatchObject({ handoff: { kind: "confirm", status: "required", execution: "not-performed" }, runtime_activation: "not-performed" });
  expect(existsSync(state)).toBe(false);
});

test("headless module requests re-probe without persisting preferences", () => {
  const { run, state } = fixture();
  const result = run(["--agent", "--step", "modules", "--action", "module.core.tools"]);
  expect(result.exitCode).toBe(0);
  const flow = JSON.parse(result.stdout.toString());
  expect(flow.state.requested_module_ids).toContain("core.tools");
  expect(flow.handoff).toBeUndefined();
  expect(existsSync(state)).toBe(false);
});

test("health and log actions return completed observations, not unfulfilled handoffs", () => {
  const { run, state } = fixture();
  for (const action of ["health", "logs", "refresh"]) {
    const result = run(["--agent", "--action", action]);
    expect(result.exitCode).toBe(0);
    const flow = JSON.parse(result.stdout.toString());
    expect(flow.handoff).toBeUndefined();
    expect(flow.transition.outcome).toBe("inspected");
    if (action === "health") expect(flow.health.schema).toBe("temperance.operator-health.v1");
    if (action === "logs") expect(flow.events).toEqual([]);
  }
  expect(existsSync(state)).toBe(false);
});

test("unavailable optional logs preserve the agent flow and disclose no raw content", () => {
  const { run, state } = fixture();
  mkdirSync(join(state, "operator-events"), { recursive: true, mode: 0o700 });
  const path = join(state, "operator-events/events.v1.jsonl");
  writeFileSync(path, "malformed-private-honeytoken", { mode: 0o600 });
  const result = run(["--agent", "--step", "projects", "--action", "logs"]);
  expect(result.exitCode).toBe(0);
  const flow = JSON.parse(result.stdout.toString());
  expect(flow).toMatchObject({ step: "projects", inspection_error: "OPERATOR_LOG_UNAVAILABLE" });
  expect(result.stdout.toString()).not.toContain("malformed-private-honeytoken");
  expect(readFileSync(path, "utf8")).toBe("malformed-private-honeytoken");
});
