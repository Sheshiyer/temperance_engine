import { expect, test } from "bun:test";

import { createNineRouterLaunchAgent, renderNineRouterLaunchAgentPlist } from "../src/onboarding/nine-router-launch-agent.ts";

test("generates a Temperance-owned, loopback-only, secret-free 9router LaunchAgent", () => {
  const agent = createNineRouterLaunchAgent({
    node_executable: "/opt/example/bin/node",
    cli_entrypoint: "/opt/example/lib/node_modules/9router/dist/cli.js",
    data_directory: "/example/state/9router",
    log_directory: "/example/logs",
    path: "/opt/example/bin:/usr/bin:/bin",
  });
  expect(agent.Label).toBe("com.temperance.engine.9router");
  expect(agent.ProgramArguments).toEqual([
    "/opt/example/bin/node",
    "/opt/example/lib/node_modules/9router/dist/cli.js",
    "--tray",
    "--host",
    "127.0.0.1",
    "--no-browser",
    "--skip-update",
  ]);
  expect(agent.EnvironmentVariables).toEqual({ PATH: "/opt/example/bin:/usr/bin:/bin", DATA_DIR: "/example/state/9router" });
  expect(agent.RunAtLoad).toBe(true);
  expect(agent.KeepAlive).toBe(true);
  expect(agent.ThrottleInterval).toBe(10);
  const plist = renderNineRouterLaunchAgentPlist(agent);
  expect(plist).toContain("com.temperance.engine.9router");
  expect(plist).not.toContain("com.9router.autostart");
  expect(plist).not.toContain("x-9r-cli-token");
  expect(plist).not.toMatch(/api.?key/i);
  expect(plist).toContain("<key>ThrottleInterval</key><integer>10</integer>");
});

test("rejects shell-relative launch inputs and a non-cli entrypoint", () => {
  const base = {
    node_executable: "/opt/example/bin/node",
    cli_entrypoint: "/opt/example/lib/node_modules/9router/dist/cli.js",
    data_directory: "/example/state/9router",
    log_directory: "/example/logs",
    path: "/usr/bin:/bin",
  };
  expect(() => createNineRouterLaunchAgent({ ...base, node_executable: "node" })).toThrow("NINE_ROUTER_LAUNCH_PATH_INVALID");
  expect(() => createNineRouterLaunchAgent({ ...base, cli_entrypoint: "/example/not-router.js" })).toThrow("NINE_ROUTER_CLI_ENTRYPOINT_INVALID");
});
