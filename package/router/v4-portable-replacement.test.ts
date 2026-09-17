import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";

import { createV4ReplacementProof } from "./v4-cutover-executor.ts";
import {
  PortableV4ReplacementLifecycle,
  V4_ROUTER_RUNTIME_DEPENDENCIES,
  nodePortableV4ReplacementIO,
  type PortableV4ReplacementIO,
  type PortableV4ReplacementServices,
  type PortableV4ServiceVerification,
  type PortableV4ServiceInput,
} from "./v4-portable-replacement.ts";
import { ROUTER_VERSION } from "./v4-cutover-plan.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sha256(...parts: Uint8Array[]): `sha256:${string}` {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return `sha256:${hash.digest("hex")}`;
}

function git(cwd: string, args: string[]): Uint8Array {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  return result.stdout;
}

function createSourceRepository(root: string) {
  const source = join(root, "source");
  mkdirSync(join(source, "package", "install-surface"), { recursive: true });
  mkdirSync(join(source, "package", "router"), { recursive: true });
  writeFileSync(join(source, "VERSION"), "0.5.4\n");
  writeFileSync(join(source, "package", "install-surface", "package.json"), '{"scripts":{"verify":"true"}}\n');
  writeFileSync(join(source, "package", "install-surface", "bun.lock"), "lockfileVersion = 1\n");
  writeFileSync(join(source, "package", "router", "fixture.ts"), "export {};\n");
  git(source, ["init", "-q"]);
  git(source, ["config", "user.name", "Temperance Test"]);
  git(source, ["config", "user.email", "temperance@example.invalid"]);
  git(source, ["add", "."]);
  git(source, ["commit", "-qm", "fixture"]);
  const revision = new TextDecoder().decode(git(source, ["rev-parse", "HEAD"])).trim();
  const tree = new TextDecoder().decode(git(source, ["rev-parse", "HEAD^{tree}"])).trim();
  const archive = Bun.spawnSync(["git", "archive", "--format=tar", "HEAD"], { cwd: source, stdout: "pipe", stderr: "pipe" });
  if (archive.exitCode !== 0) throw new Error("archive failed");
  const proof = createV4ReplacementProof({
    generated_at: "2026-09-17T00:00:00.000Z",
    temperance_revision: revision,
    temperance_tree: tree,
    router: { package: "9router", version: ROUTER_VERSION },
    artifact_digest: sha256(archive.stdout, Uint8Array.of(0), archive.stderr),
    verification: {
      install_surface: sha256(new TextEncoder().encode("install-surface")),
      cutover_contract: sha256(new TextEncoder().encode("cutover-contract")),
    },
  });
  return { source, proof };
}

function writePackage(root: string, name: string, version: string): void {
  const packageRoot = join(root, "node_modules", name);
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(join(packageRoot, "package.json"), `${JSON.stringify({ name, version })}\n`);
}

function createHarness(options: { wrongRouterVersion?: boolean; nodeMajor?: number; doctorPassed?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "temperance-v4-portable-"));
  roots.push(root);
  const { source, proof } = createSourceRepository(root);
  const staging = join(root, "staging");
  const runtime = join(root, "runtime");
  const data = join(root, "data");
  const logs = join(runtime, "logs");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, "legacy.txt"), "must disappear\n");
  const calls: string[][] = [];
  const io: PortableV4ReplacementIO = {
    ...nodePortableV4ReplacementIO,
    exec: async (argv, cwd, signal) => {
      calls.push([...argv]);
      if (argv[0] !== "bun") return nodePortableV4ReplacementIO.exec(argv, cwd, signal);
      if (argv[1] === "add" && argv.some((item) => item.startsWith("9router@"))) {
        writePackage(cwd, "9router", options.wrongRouterVersion ? "0.5.74" : ROUTER_VERSION);
        writeFileSync(join(cwd, "node_modules", "9router", "cli.js"), "#!/usr/bin/env node\n");
      }
      if (argv[1] === "add" && argv.some((item) => item.startsWith("sql.js@"))) {
        for (const [name, version] of Object.entries(V4_ROUTER_RUNTIME_DEPENDENCIES)) writePackage(cwd, name, version);
        mkdirSync(join(cwd, "node_modules", "sql.js", "dist"), { recursive: true });
        writeFileSync(join(cwd, "node_modules", "sql.js", "dist", "sql-wasm.wasm"), "wasm");
        mkdirSync(join(cwd, "node_modules", "better-sqlite3", "prebuilds"), { recursive: true });
        writeFileSync(join(cwd, "node_modules", "better-sqlite3", "prebuilds", "darwin-arm64.node"), "native");
        mkdirSync(join(cwd, "node_modules", "systray2", "traybin"), { recursive: true });
        writeFileSync(join(cwd, "node_modules", "systray2", "traybin", "tray_darwin_release"), "tray");
      }
      return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
    },
  };
  const serviceCalls: string[] = [];
  const inputs: PortableV4ServiceInput[] = [];
  const serviceVerification: PortableV4ServiceVerification = {
    router_version: ROUTER_VERSION,
    listener_owner: "replacement-9router",
    listener_port: 20128,
    loopback_only: true,
    doctor_passed: options.doctorPassed ?? true,
  };
  const services: PortableV4ReplacementServices = {
    install: async (input) => { serviceCalls.push("install"); inputs.push(input); },
    activate: async (input) => { serviceCalls.push("activate"); inputs.push(input); },
    verify: async (input) => { serviceCalls.push("verify"); inputs.push(input); return serviceVerification; },
  };
  const lifecycle = new PortableV4ReplacementLifecycle({
    sourceRepository: source,
    stagingRoot: staging,
    runtimeRoot: runtime,
    dataDirectory: data,
    logDirectory: logs,
    nodeExecutable: "/opt/homebrew/bin/node",
    executablePath: "/opt/homebrew/bin:/usr/bin:/bin",
    services,
    io,
    nodeMajor: options.nodeMajor ?? 26,
    platform: "darwin",
    architecture: "arm64",
  });
  return { root, source, staging, runtime, data, proof, calls, serviceCalls, inputs, lifecycle, serviceVerification };
}

describe("portable V4 replacement lifecycle", () => {
  test("promotes a proved archive and pre-seats every 9router runtime dependency with Bun", async () => {
    const context = createHarness();
    const signal = new AbortController().signal;
    await context.lifecycle.preflight(context.proof, signal);
    await context.lifecycle.stage(context.proof, signal);
    await context.lifecycle.promoteRuntime({
      id: "runtime", path: context.runtime, observed: "directory", file_count: 1, disposition: "replace",
    }, context.proof, signal);
    await context.lifecycle.installRouter(ROUTER_VERSION, signal);
    await context.lifecycle.installLaunchAgents(signal);
    await context.lifecycle.activate(signal);
    expect(await context.lifecycle.verify(signal)).toEqual({
      ...context.serviceVerification,
      legacy_state_absent: false,
      legacy_launch_agents_absent: false,
    });

    expect(await Bun.file(join(context.runtime, "VERSION")).text()).toBe("0.5.4\n");
    expect(readdirSync(context.staging)).toEqual([]);
    expect(await Bun.file(join(context.data, "runtime", "node_modules", "sql.js", "package.json")).json()).toMatchObject({ version: "1.14.1" });
    expect(context.calls.filter(([command]) => command === "bun").some((argv) => argv.includes("9router@0.5.75"))).toBe(true);
    expect(context.calls.flat()).not.toContain("npm");
    expect(context.serviceCalls).toEqual(["install", "activate", "verify"]);
    expect(context.inputs[0]).toEqual({
      node_executable: "/opt/homebrew/bin/node",
      cli_entrypoint: join(context.runtime, "providers", "9router", "node_modules", "9router", "cli.js"),
      data_directory: context.data,
      log_directory: join(context.runtime, "logs"),
      path: "/opt/homebrew/bin:/usr/bin:/bin",
    });
  });

  test("refuses source drift before creating a stage", async () => {
    const context = createHarness();
    writeFileSync(join(context.source, "untracked.txt"), "drift\n");
    await expect(context.lifecycle.preflight(context.proof, new AbortController().signal)).rejects.toThrow("REPLACEMENT_SOURCE_DIRTY");
    expect(existsSync(context.staging)).toBe(false);
  });

  test("rejects unsafe staging ownership and unsupported native Node generations", async () => {
    expect(() => createHarness({ nodeMajor: 20 })).toThrow("REPLACEMENT_NODE_VERSION_UNSUPPORTED");
    const context = createHarness();
    await context.lifecycle.preflight(context.proof, new AbortController().signal);
    symlinkSync(join(context.root, "redirect"), context.staging);
    await expect(context.lifecycle.stage(context.proof, new AbortController().signal)).rejects.toThrow("REPLACEMENT_STAGING_ROOT_UNSAFE");
  });

  test("rejects a package version that does not match the exact router pin", async () => {
    const context = createHarness({ wrongRouterVersion: true });
    const signal = new AbortController().signal;
    await context.lifecycle.preflight(context.proof, signal);
    await context.lifecycle.stage(context.proof, signal);
    await context.lifecycle.promoteRuntime({
      id: "runtime", path: context.runtime, observed: "directory", file_count: 1, disposition: "replace",
    }, context.proof, signal);
    await expect(context.lifecycle.installRouter(ROUTER_VERSION, signal)).rejects.toThrow("REPLACEMENT_PACKAGE_VERSION_MISMATCH");
    expect(context.serviceCalls).toEqual([]);
  });

  test("recovers only by rebuilding the proved fresh replacement", async () => {
    const context = createHarness();
    await context.lifecycle.recover(context.proof, new AbortController().signal);
    expect(context.serviceCalls).toEqual(["install", "activate", "verify"]);
    expect(await Bun.file(join(context.runtime, "VERSION")).text()).toBe("0.5.4\n");
    expect(context.calls.filter((argv) => argv[0] === "git" && argv[1] === "archive").length).toBe(2);
    expect(context.calls.flat().some((value) => /omniroute/u.test(value))).toBe(false);
  });

  test("refuses to report fresh recovery when live verification is unhealthy", async () => {
    const context = createHarness({ doctorPassed: false });
    await expect(context.lifecycle.recover(context.proof, new AbortController().signal))
      .rejects.toThrow("REPLACEMENT_RECOVERY_VERIFICATION_FAILED");
    expect(context.serviceCalls).toEqual(["install", "activate", "verify"]);
  });
});
