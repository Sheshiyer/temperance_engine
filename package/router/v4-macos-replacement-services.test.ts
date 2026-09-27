import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";

import {
  MacOsV4ReplacementServices,
  type MacOsV4ReplacementServicesIO,
} from "./v4-macos-replacement-services.ts";
import type { PortableV4ServiceInput } from "./v4-portable-replacement.ts";

const roots: string[] = [];
const testUid = process.getuid?.() ?? 501;
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createHarness(options: {
  platform?: NodeJS.Platform;
  loaded?: boolean;
  listener?: "loopback" | "exposed" | "absent";
  listenerParent?: number;
  doctorPassed?: boolean;
  routerVersion?: string;
  definitionDrift?: boolean;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "temperance-v4-macos-services-"));
  roots.push(root);
  const launchAgents = join(root, "Library", "LaunchAgents");
  const runtime = join(root, ".temperance_engine");
  const data = join(root, ".9router");
  const logs = join(runtime, "logs");
  const node = join(root, "bin", "node");
  const env = join(root, "bin", "env");
  const cliRoot = join(runtime, "providers", "9router", "node_modules", "9router");
  const cli = join(cliRoot, "cli.js");
  mkdirSync(launchAgents, { recursive: true, mode: 0o700 });
  mkdirSync(cliRoot, { recursive: true });
  mkdirSync(data, { recursive: true, mode: 0o700 });
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(node, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(env, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  chmodSync(node, 0o755);
  chmodSync(env, 0o755);
  writeFileSync(cli, "#!/usr/bin/env node\n");
  writeFileSync(join(cliRoot, "package.json"), `${JSON.stringify({ name: "9router", version: options.routerVersion ?? "0.5.75" })}\n`);

  let loaded = options.loaded ?? false;
  const calls: string[][] = [];
  const io: MacOsV4ReplacementServicesIO = {
    platform: options.platform ?? "darwin",
    wait: async () => {},
    exec: async (argv) => {
      calls.push([...argv]);
      if (argv[0] === "/bin/launchctl" && argv[1] === "print") {
        return loaded
          ? {
            exitCode: 0,
            stdout: options.definitionDrift
              ? `state = running\npid = 400\nprogram = ${node}\nargument = /foreign/cli.js\nargument = 0.0.0.0\nDATA_DIR => ${data}\n`
              : `state = running\npid = 400\nprogram = ${env}\nargument = -i\nargument = PATH=${join(root, "bin")}:/usr/bin:/bin\nargument = DATA_DIR=${data}\nargument = ${node}\nargument = ${cli}\nargument = 127.0.0.1\n`,
            stderr: "",
          }
          : { exitCode: 113, stdout: "", stderr: "not found" };
      }
      if (argv[0] === "/bin/launchctl" && argv[1] === "bootout") {
        loaded = false;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (argv[0] === "/bin/launchctl" && argv[1] === "bootstrap") {
        loaded = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (argv[0] === "/usr/sbin/lsof") {
        const listener = options.listener ?? "loopback";
        if (listener === "absent") return { exitCode: 1, stdout: "", stderr: "" };
        return {
          exitCode: 0,
          stdout: `p401\ncnode\nn${listener === "exposed" ? "*:20128" : "127.0.0.1:20128"}\n`,
          stderr: "",
        };
      }
      if (argv[0] === "/bin/ps") {
        return { exitCode: 0, stdout: `${options.listenerParent ?? 400}\n`, stderr: "" };
      }
      return { exitCode: 127, stdout: "", stderr: "unexpected" };
    },
  };
  const doctorInputs: PortableV4ServiceInput[] = [];
  const services = new MacOsV4ReplacementServices({
    launchAgentsDirectory: launchAgents,
    runtimeRoot: runtime,
    dataDirectory: data,
    logDirectory: logs,
    envExecutable: env,
    nodeExecutable: node,
    executablePath: `${join(root, "bin")}:/usr/bin:/bin`,
    doctor: {
      run: async (input) => {
        doctorInputs.push(input);
        return options.doctorPassed ?? true;
      },
    },
    io,
    uid: testUid,
    listenerAttempts: 2,
    pollIntervalMs: 0,
  });
  const input: PortableV4ServiceInput = {
    node_executable: node,
    cli_entrypoint: cli,
    data_directory: data,
    log_directory: logs,
    path: `${join(root, "bin")}:/usr/bin:/bin`,
  };
  return {
    root, launchAgents, runtime, data, logs, node, env, cliRoot, input, services, calls, doctorInputs,
    plist: join(launchAgents, "com.temperance.engine.9router.plist"),
  };
}

describe("macOS V4 replacement services", () => {
  test("publishes one secret-free plist, restarts its exact label, and proves loopback ownership", async () => {
    const context = createHarness({ loaded: true });
    const signal = new AbortController().signal;
    await context.services.install(context.input, signal);
    const plist = readFileSync(context.plist, "utf8");
    expect(plist).toContain("com.temperance.engine.9router");
    expect(plist).toContain("127.0.0.1");
    expect(plist).toContain(`<string>${context.env}</string>`);
    expect(plist).toContain("<string>-i</string>");
    expect(plist).not.toContain("<key>EnvironmentVariables</key>");
    expect(plist).not.toMatch(/api.?key|authorization|credential|omniroute|password|secret|token/iu);
    expect(statSync(context.plist).mode & 0o777).toBe(0o644);

    await context.services.activate(context.input, signal);
    expect(await context.services.verify(context.input, signal)).toEqual({
      router_version: "0.5.75",
      listener_owner: "replacement-9router",
      listener_port: 20128,
      loopback_only: true,
      doctor_passed: true,
    });
    expect(context.calls).toContainEqual(["/bin/launchctl", "bootout", `gui/${testUid}/com.temperance.engine.9router`]);
    expect(context.calls).toContainEqual(["/bin/launchctl", "bootstrap", `gui/${testUid}`, context.plist]);
    expect(context.calls).toContainEqual(["/bin/ps", "-o", "ppid=", "-p", "401"]);
    expect(context.doctorInputs).toEqual([context.input]);
  });

  test("accepts identical recovery publication but rejects conflicting or linked plists", async () => {
    const context = createHarness();
    const signal = new AbortController().signal;
    await context.services.install(context.input, signal);
    await context.services.install(context.input, signal);
    writeFileSync(context.plist, "conflict\n");
    await expect(context.services.install(context.input, signal)).rejects.toThrow("REPLACEMENT_SERVICE_PLIST_CONFLICT");

    const linked = createHarness();
    await linked.services.install(linked.input, signal);
    const second = join(linked.launchAgents, "linked.plist");
    linkSync(linked.plist, second);
    await expect(linked.services.install(linked.input, signal)).rejects.toThrow("REPLACEMENT_SERVICE_PLIST_UNSAFE");
  });

  test("refuses a symlinked LaunchAgents directory before publishing", async () => {
    const context = createHarness();
    rmSync(context.launchAgents, { recursive: true, force: true });
    const redirected = join(context.root, "redirected-agents");
    mkdirSync(redirected);
    symlinkSync(redirected, context.launchAgents);
    await expect(context.services.install(context.input, new AbortController().signal)).rejects.toThrow("REPLACEMENT_SERVICE_LAUNCH_AGENTS_UNSAFE");
    expect(readFileSync(join(context.cliRoot, "package.json"), "utf8")).toContain("0.5.75");
  });

  test("rejects service-definition drift and non-private state directories", async () => {
    const drifted = createHarness({ definitionDrift: true });
    const signal = new AbortController().signal;
    await drifted.services.install(drifted.input, signal);
    await expect(drifted.services.activate(drifted.input, signal)).rejects.toThrow("REPLACEMENT_SERVICE_DEFINITION_DRIFTED");

    const unsafe = createHarness();
    chmodSync(unsafe.data, 0o755);
    await expect(unsafe.services.install(unsafe.input, signal)).rejects.toThrow("REPLACEMENT_SERVICE_DATA_DIR_INVALID");
  });

  test("rejects exposed and foreign listeners instead of trusting a healthy process name", async () => {
    for (const [kind, expected] of [
      ["exposed", "REPLACEMENT_SERVICE_LISTENER_EXPOSED"],
      ["foreign", "REPLACEMENT_SERVICE_LISTENER_OWNER_MISMATCH"],
    ] as const) {
      const context = createHarness(kind === "exposed" ? { listener: "exposed" } : { listenerParent: 999 });
      const signal = new AbortController().signal;
      await context.services.install(context.input, signal);
      await context.services.activate(context.input, signal);
      await expect(context.services.verify(context.input, signal)).rejects.toThrow(expected);
    }
  });

  test("reports doctor failure but rejects package drift and non-macOS construction", async () => {
    const unhealthy = createHarness({ doctorPassed: false });
    const signal = new AbortController().signal;
    await unhealthy.services.install(unhealthy.input, signal);
    await unhealthy.services.activate(unhealthy.input, signal);
    expect((await unhealthy.services.verify(unhealthy.input, signal)).doctor_passed).toBe(false);

    const drifted = createHarness({ routerVersion: "0.5.74" });
    await drifted.services.install(drifted.input, signal);
    await drifted.services.activate(drifted.input, signal);
    await expect(drifted.services.verify(drifted.input, signal)).rejects.toThrow("REPLACEMENT_SERVICE_ROUTER_VERSION_MISMATCH");

    expect(() => createHarness({ platform: "linux" })).toThrow("REPLACEMENT_SERVICE_MACOS_REQUIRED");
  });
});
