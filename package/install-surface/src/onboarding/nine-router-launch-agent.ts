import { basename, isAbsolute, join, normalize } from "node:path";

export interface NineRouterLaunchAgentInput {
  env_executable: string;
  node_executable: string;
  cli_entrypoint: string;
  data_directory: string;
  log_directory: string;
  path: string;
}

export interface NineRouterLaunchAgent {
  Label: "com.temperance.engine.9router";
  ProgramArguments: [
    string,
    "-i",
    string,
    string,
    string,
    string,
    "--tray",
    "--host",
    "127.0.0.1",
    "--no-browser",
    "--skip-update",
  ];
  StandardOutPath: string;
  StandardErrorPath: string;
  RunAtLoad: true;
  KeepAlive: true;
  ThrottleInterval: 10;
  ProcessType: "Interactive";
}

function canonicalAbsolute(value: string): boolean {
  return value.length > 1 && isAbsolute(value) && normalize(value) === value && !value.includes("\0");
}

export function createNineRouterLaunchAgent(input: NineRouterLaunchAgentInput): NineRouterLaunchAgent {
  if (![input.env_executable, input.node_executable, input.cli_entrypoint, input.data_directory, input.log_directory].every(canonicalAbsolute)) {
    throw new Error("NINE_ROUTER_LAUNCH_PATH_INVALID");
  }
  if (basename(input.env_executable) !== "env") throw new Error("NINE_ROUTER_ENV_EXECUTABLE_INVALID");
  if (basename(input.cli_entrypoint) !== "cli.js") throw new Error("NINE_ROUTER_CLI_ENTRYPOINT_INVALID");
  const pathEntries = input.path.split(":");
  if (pathEntries.length === 0 || pathEntries.some((entry) => !canonicalAbsolute(entry))) throw new Error("NINE_ROUTER_LAUNCH_PATH_ENV_INVALID");
  return {
    Label: "com.temperance.engine.9router",
    ProgramArguments: [
      input.env_executable,
      "-i",
      `PATH=${input.path}`,
      `DATA_DIR=${input.data_directory}`,
      input.node_executable,
      input.cli_entrypoint,
      "--tray",
      "--host",
      "127.0.0.1",
      "--no-browser",
      "--skip-update",
    ],
    StandardOutPath: join(input.log_directory, "9router.stdout.log"),
    StandardErrorPath: join(input.log_directory, "9router.stderr.log"),
    RunAtLoad: true,
    KeepAlive: true,
    ThrottleInterval: 10,
    ProcessType: "Interactive",
  };
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** Serialize only the closed, secret-free LaunchAgent shape above. */
export function renderNineRouterLaunchAgentPlist(agent: NineRouterLaunchAgent): string {
  const args = agent.ProgramArguments.map((argument) => `      <string>${xml(argument)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${agent.Label}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StandardOutPath</key><string>${xml(agent.StandardOutPath)}</string>
  <key>StandardErrorPath</key><string>${xml(agent.StandardErrorPath)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>${agent.ThrottleInterval}</integer>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`;
}
