import { describe, expect, test } from "bun:test";
import type { Stats } from "node:fs";

import type { KeychainSecretReference } from "../install-surface/src/onboarding/contracts.ts";
import type { V4CutoverVerification, V4ReplacementProof } from "./v4-cutover-executor.ts";
import { MacOsV4CutoverAdapter, type V4MacOsHostIO, type V4ReplacementLifecycle } from "./v4-macos-host-adapter.ts";
import type { BinaryObservation, ManagedPathObservation, PortObservation } from "./v4-cutover-plan.ts";

function stat(kind: "file" | "directory" | "symlink"): Stats {
  return {
    isFile: () => kind === "file",
    isDirectory: () => kind === "directory",
    isSymbolicLink: () => kind === "symlink",
  } as Stats;
}

class MemoryIO implements V4MacOsHostIO {
  platform: NodeJS.Platform = "darwin";
  readonly files = new Map<string, "file" | "directory" | "symlink">();
  readonly realpaths = new Map<string, string>();
  readonly contents = new Map<string, string>();
  readonly commands: string[][] = [];
  readonly removed: Array<{ path: string; recursive: boolean }> = [];
  readonly loaded = new Set<string>();

  async lstat(path: string): Promise<Stats> {
    const kind = this.files.get(path);
    if (!kind) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return stat(kind);
  }
  async realpath(path: string): Promise<string> { return this.realpaths.get(path) ?? path; }
  async readFile(path: string): Promise<string> {
    const value = this.contents.get(path);
    if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return value;
  }
  async rm(path: string, options: { recursive: boolean }): Promise<void> {
    this.removed.push({ path, recursive: options.recursive });
    this.files.delete(path);
  }
  async exec(argv: readonly string[]): Promise<{ exitCode: number }> {
    this.commands.push([...argv]);
    if (argv[1] === "print") return { exitCode: this.loaded.has(String(argv[2])) ? 0 : 113 };
    if (argv[1] === "bootout") {
      this.loaded.delete(String(argv[2]));
      return { exitCode: 0 };
    }
    if (argv[1] === "bootstrap") {
      const label = String(argv[3]).split("/").at(-1)!.replace(/\.plist$/u, "");
      this.loaded.add(`${argv[2]}/${label}`);
      return { exitCode: 0 };
    }
    return { exitCode: 0 };
  }
}

class MemoryReplacement implements V4ReplacementLifecycle {
  readonly calls: string[] = [];
  async preflight(): Promise<void> { this.calls.push("preflight"); }
  async stage(): Promise<void> { this.calls.push("stage"); }
  async promoteRuntime(): Promise<void> { this.calls.push("promote"); }
  async installRouter(): Promise<void> { this.calls.push("install-router"); }
  async installLaunchAgents(): Promise<void> { this.calls.push("install-agents"); }
  async activate(): Promise<void> { this.calls.push("activate"); }
  async verify(): Promise<V4CutoverVerification> {
    this.calls.push("verify");
    return {
      router_version: "0.5.75", listener_owner: "replacement-9router", listener_port: 20128,
      loopback_only: true, legacy_state_absent: true, legacy_launch_agents_absent: true, doctor_passed: true,
    };
  }
  async discardStage(): Promise<void> { this.calls.push("discard"); }
  async recover(): Promise<void> { this.calls.push("recover"); }
}

const home = "/fixture/home";
const agents = `${home}/Library/LaunchAgents`;
const signal = new AbortController().signal;
const reference: KeychainSecretReference = { store: "macos-keychain", service: "fixture.gateway", account: "operator" };

function adapter(io = new MemoryIO(), replacement = new MemoryReplacement()): { adapter: MacOsV4CutoverAdapter; io: MemoryIO; replacement: MemoryReplacement } {
  return {
    adapter: new MacOsV4CutoverAdapter({
      homeDirectory: home,
      launchAgentsDirectory: agents,
      legacyCredentialReferences: { LEGACY_GATEWAY: reference },
      replacement,
      io,
      uid: 501,
    }),
    io,
    replacement,
  };
}

describe("macOS V4 cutover host adapter", () => {
  test("unloads one allowlisted managed router service and restores its exact plist", async () => {
    const context = adapter();
    const label = "com.temperance.engine.omniroute";
    const path = `${agents}/${label}.plist`;
    context.io.files.set(path, "file");
    context.io.loaded.add(`gui/501/${label}`);
    const owner: PortObservation = {
      port: 20128, owner: "legacy-omniroute", managed_service_label: label, listener_present: false,
    };
    await context.adapter.stopRouterPortOwner(owner, signal);
    await context.adapter.unloadLaunchAgent({ label, path, observed: "file", disposition: "remove" }, signal);
    await context.adapter.restorePreCutoverServices(signal);
    expect(context.io.commands).toEqual([
      ["/bin/launchctl", "print", `gui/501/${label}`],
      ["/bin/launchctl", "bootout", `gui/501/${label}`],
      ["/bin/launchctl", "bootstrap", "gui/501", path],
    ]);
  });

  test("uses only a Keychain reference and accepts an already absent item", async () => {
    const context = adapter();
    context.io.exec = async (argv) => {
      context.io.commands.push([...argv]);
      return { exitCode: 44 };
    };
    await context.adapter.revokeLegacyGatewayCredential("LEGACY_GATEWAY", signal);
    expect(context.io.commands).toEqual([[
      "/usr/bin/security", "delete-generic-password", "-s", "fixture.gateway", "-a", "operator",
    ]]);
    expect(JSON.stringify(context.io.commands)).not.toContain("apiKey");
  });

  test("refuses to remove a LaunchAgent that is still loaded", async () => {
    const context = adapter();
    const label = "com.temperance.engine.mini-gateway";
    const path = `${agents}/${label}.plist`;
    context.io.files.set(path, "file");
    context.io.loaded.add(`gui/501/${label}`);
    await expect(context.adapter.removeLaunchAgent({
      label, path, observed: "file", disposition: "remove",
    }, signal)).rejects.toThrow("CUTOVER_LAUNCH_AGENT_STILL_LOADED");
    expect(context.io.removed).toEqual([]);
  });

  test("refuses symlinked state and any unmanaged path", async () => {
    const context = adapter();
    context.io.files.set(`${home}/.omniroute`, "symlink");
    const legacy: ManagedPathObservation = {
      id: "legacy-omniroute", path: `${home}/.omniroute`, observed: "symlink", file_count: 0, disposition: "remove",
    };
    await expect(context.adapter.removeManagedPath(legacy, signal)).rejects.toThrow("CUTOVER_MANAGED_PATH_UNSAFE");
    await expect(context.adapter.removeManagedPath({ ...legacy, path: `${home}/Documents` }, signal)).rejects.toThrow("CUTOVER_MANAGED_PATH_SCOPE_MISMATCH");
    expect(context.io.removed).toEqual([]);
  });

  test("removes only a verified package symlink and its omniroute package root", async () => {
    const context = adapter();
    const binaryPath = "/opt/example/bin/omniroute";
    const packageRoot = "/opt/example/lib/node_modules/omniroute";
    const target = `${packageRoot}/bin/omniroute.mjs`;
    context.io.files.set(binaryPath, "symlink");
    context.io.files.set(packageRoot, "directory");
    context.io.realpaths.set(binaryPath, target);
    context.io.contents.set(`${packageRoot}/package.json`, JSON.stringify({ name: "omniroute", version: "3.8.49" }));
    const binary: BinaryObservation = { package: "omniroute", path: binaryPath, version: "3.8.49", disposition: "remove" };
    await context.adapter.removeLegacyPackage(binary, signal);
    expect(context.io.removed).toEqual([
      { path: binaryPath, recursive: false },
      { path: packageRoot, recursive: true },
    ]);
  });

  test("delegates replacement lifecycle but independently verifies legacy absence", async () => {
    const context = adapter();
    const runtime: ManagedPathObservation = {
      id: "runtime", path: `${home}/.temperance_engine`, observed: "directory", file_count: 1, disposition: "replace",
    };
    const proof = {} as V4ReplacementProof;
    await context.adapter.preflightReplacement(proof, signal);
    await context.adapter.stageReplacement(proof, signal);
    await context.adapter.promoteTemperanceRuntime(runtime, proof, signal);
    await context.adapter.installExactRouter("0.5.75", signal);
    await context.adapter.installReplacementLaunchAgents(signal);
    await context.adapter.activateReplacement(signal);
    const verification = await context.adapter.verifyReplacement(signal);
    await context.adapter.discardStagedReplacement(signal);
    await context.adapter.recoverFreshReplacement(proof, signal);
    expect(verification).toMatchObject({ legacy_state_absent: true, legacy_launch_agents_absent: true });
    expect(context.replacement.calls).toEqual([
      "preflight", "stage", "promote", "install-router", "install-agents", "activate", "verify", "discard", "recover",
    ]);
  });

  test("rejects a successful replacement claim while legacy state remains", async () => {
    const context = adapter();
    context.io.files.set(`${home}/.omniroute`, "directory");
    await expect(context.adapter.verifyReplacement(signal)).rejects.toThrow("CUTOVER_LEGACY_RESIDUE_PRESENT");
  });

  test("rejects non-macOS construction before any replacement access", () => {
    const io = new MemoryIO();
    io.platform = "linux";
    expect(() => adapter(io)).toThrow("CUTOVER_MACOS_ADAPTER_UNSUPPORTED");
  });
});
