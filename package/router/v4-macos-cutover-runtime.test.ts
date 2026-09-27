import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";

import { createMacOsV4CutoverRuntime } from "./v4-macos-cutover-runtime.ts";
import type { V4MacOsHostIO } from "./v4-macos-host-adapter.ts";
import type { MacOsV4ReplacementServicesIO } from "./v4-macos-replacement-services.ts";
import type { PortableV4ReplacementIO } from "./v4-portable-replacement.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "temperance-v4-runtime-composition-"));
  roots.push(root);
  const home = join(root, "home");
  const source = join(root, "source");
  const node = join(root, "bin", "node");
  const env = join(root, "bin", "env");
  const unavailable = async (): Promise<never> => { throw new Error("not invoked during composition"); };
  const hostIO: V4MacOsHostIO = {
    platform: "darwin",
    lstat: unavailable,
    realpath: unavailable,
    readFile: unavailable,
    rm: unavailable,
    exec: unavailable,
  };
  const replacementIO: PortableV4ReplacementIO = {
    lstat: unavailable,
    mkdir: unavailable,
    readFile: unavailable,
    writeFile: unavailable,
    chmod: unavailable,
    rename: unavailable,
    rm: unavailable,
    exec: unavailable,
  };
  const servicesIO: MacOsV4ReplacementServicesIO = {
    platform: "darwin",
    exec: unavailable,
    wait: unavailable,
  };
  return { root, home, source, node, env, hostIO, replacementIO, servicesIO };
}

describe("macOS V4 cutover composition root", () => {
  test("wires fresh replacement boundaries without touching host state", () => {
    const context = fixture();
    const runtime = createMacOsV4CutoverRuntime({
      homeDirectory: context.home,
      sourceRepository: context.source,
      envExecutable: context.env,
      nodeExecutable: context.node,
      executablePath: `${join(context.root, "bin")}:/usr/bin:/bin`,
      legacyCredentialReferences: {
        legacy_gateway: { store: "macos-keychain", service: "legacy.gateway", account: "default" },
      },
      doctor: { run: async () => true },
      uid: process.getuid?.() ?? 501,
      hostIO: context.hostIO,
      replacementIO: context.replacementIO,
      servicesIO: context.servicesIO,
    });
    expect(runtime.paths).toEqual({
      runtime: join(context.home, ".temperance_engine"),
      router_data: join(context.home, ".9router"),
      logs: join(context.home, ".temperance_engine", "logs"),
      launch_agents: join(context.home, "Library", "LaunchAgents"),
      application_support: join(context.home, "Library", "Application Support", "Temperance"),
      staging: join(context.home, "Library", "Application Support", "Temperance", "staging", "v4-cutover"),
      receipts: join(context.home, "Library", "Application Support", "Temperance", "receipts", "v4-cutover"),
    });
    expect(runtime.journal.transactionDirectory).toBeUndefined();
    expect(existsSync(runtime.paths.application_support)).toBe(false);
    expect(runtime.paths.receipts.startsWith(runtime.paths.runtime)).toBe(false);
    expect(runtime.paths.staging.startsWith(runtime.paths.runtime)).toBe(false);
  });

  test("rejects a source checkout nested inside the runtime replacement target", () => {
    const context = fixture();
    expect(() => createMacOsV4CutoverRuntime({
      homeDirectory: context.home,
      sourceRepository: join(context.home, ".temperance_engine", "source"),
      envExecutable: context.env,
      nodeExecutable: context.node,
      executablePath: `${join(context.root, "bin")}:/usr/bin:/bin`,
      legacyCredentialReferences: {},
      doctor: { run: async () => true },
      uid: process.getuid?.() ?? 501,
      hostIO: context.hostIO,
      replacementIO: context.replacementIO,
      servicesIO: context.servicesIO,
    })).toThrow("REPLACEMENT_PATH_SCOPE_INVALID");
  });
});
