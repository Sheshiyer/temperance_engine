import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runHostSection } from "../src/doctor/sections/host.ts";
import type { DoctorContextV2 } from "../src/doctor/model.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function makeContext(overrides?: Partial<DoctorContextV2>): DoctorContextV2 {
  const repositoryRoot = tempRoot("host-repo-");
  const stateRoot = tempRoot("host-state-");
  return {
    repositoryRoot,
    stateRoot,
    platform: "darwin" as NodeJS.Platform,
    rootBindings: {},
    runtimeUrls: {
      bridge: "http://127.0.0.1:8766",
      omniroute: "http://127.0.0.1:20128",
      console: "http://127.0.0.1:5173",
      auto_proxy: "http://127.0.0.1:20129",
      pulse: "http://127.0.0.1:31337",
    },
    io: {
      readFile: async (path: string) => { throw new Error(`ENOENT: ${path}`); },
      lstat: async (path: string) => { throw new Error(`ENOENT: ${path}`); },
      realpath: async (path: string) => path,
      fetch: async () => { throw new Error("fetch failed"); },
      execFile: async () => { throw new Error("exec failed"); },
      now: () => new Date(),
    },
    signal: AbortSignal.timeout(5000),
    inventory: {
      lockObject: { schema: "temperance.install-surface.lock.v1", schema_uri: "", version: { major: 1, minor: 0 }, records: [] },
      canonicalBytes: new Uint8Array(),
      digest: "sha256:" + "a".repeat(64),
      semanticIds: [],
    },
    ...overrides,
  };
}

describe("host section", () => {
  test("produces all 7 check ids", async () => {
    const context = makeContext();
    const section = await runHostSection(context);
    const ids = section.checks.map((c) => c.id).sort();
    const expected = [
      "auto-proxy-health", "bridge-launchd", "console-health",
      "console-launchd", "opencode-config", "pulse-health", "skill-index",
    ].sort();
    expect(ids).toEqual(expected);
  });

  test("console-health FAIL when unreachable", async () => {
    const context = makeContext();
    const section = await runHostSection(context);
    const check = section.checks.find((c) => c.id === "console-health")!;
    expect(check.condition).toBe("FAIL");
  });

  test("console-health PASS when healthy", async () => {
    const context = makeContext({
      io: {
        readFile: async () => { throw new Error("ENOENT"); },
        lstat: async () => { throw new Error("ENOENT"); },
        realpath: async (p: string) => p,
        fetch: async () => new Response(null, { status: 200 }),
        execFile: async () => { throw new Error("exec failed"); },
        now: () => new Date(),
      },
    });
    const section = await runHostSection(context);
    const check = section.checks.find((c) => c.id === "console-health")!;
    expect(check.condition).toBe("PASS");
  });

  test("auto-proxy-health FAIL when unreachable", async () => {
    const context = makeContext();
    const section = await runHostSection(context);
    const check = section.checks.find((c) => c.id === "auto-proxy-health")!;
    expect(check.condition).toBe("FAIL");
  });

  test("auto-proxy-health PASS when healthy", async () => {
    const context = makeContext({
      io: {
        readFile: async () => { throw new Error("ENOENT"); },
        lstat: async () => { throw new Error("ENOENT"); },
        realpath: async (p: string) => p,
        fetch: async () => new Response(null, { status: 200 }),
        execFile: async () => { throw new Error("exec failed"); },
        now: () => new Date(),
      },
    });
    const section = await runHostSection(context);
    const check = section.checks.find((c) => c.id === "auto-proxy-health")!;
    expect(check.condition).toBe("PASS");
  });

  test("pulse-health FAIL when unreachable", async () => {
    const context = makeContext();
    const section = await runHostSection(context);
    const check = section.checks.find((c) => c.id === "pulse-health")!;
    expect(check.condition).toBe("FAIL");
  });

  test("pulse-health PASS when healthy", async () => {
    const context = makeContext({
      io: {
        readFile: async () => { throw new Error("ENOENT"); },
        lstat: async () => { throw new Error("ENOENT"); },
        realpath: async (p: string) => p,
        fetch: async () => new Response(null, { status: 200 }),
        execFile: async () => { throw new Error("exec failed"); },
        now: () => new Date(),
      },
    });
    const section = await runHostSection(context);
    const check = section.checks.find((c) => c.id === "pulse-health")!;
    expect(check.condition).toBe("PASS");
  });

  test("launchd checks UNSUPPORTED on non-darwin", async () => {
    const context = makeContext({ platform: "linux" as NodeJS.Platform });
    const section = await runHostSection(context);
    const bridgeCheck = section.checks.find((c) => c.id === "bridge-launchd")!;
    const consoleCheck = section.checks.find((c) => c.id === "console-launchd")!;
    expect(bridgeCheck.condition).toBe("UNSUPPORTED");
    expect(consoleCheck.condition).toBe("UNSUPPORTED");
  });

  test("launchd checks WARN when label not loaded", async () => {
    const context = makeContext();
    const section = await runHostSection(context);
    const bridgeCheck = section.checks.find((c) => c.id === "bridge-launchd")!;
    const consoleCheck = section.checks.find((c) => c.id === "console-launchd")!;
    expect(bridgeCheck.condition).toBe("WARN");
    expect(consoleCheck.condition).toBe("WARN");
  });

  test("launchd checks PASS when label loaded", async () => {
    const context = makeContext({
      io: {
        readFile: async () => { throw new Error("ENOENT"); },
        lstat: async () => { throw new Error("ENOENT"); },
        realpath: async (p: string) => p,
        fetch: async () => { throw new Error("fetch failed"); },
        execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        now: () => new Date(),
      },
    });
    const section = await runHostSection(context);
    const bridgeCheck = section.checks.find((c) => c.id === "bridge-launchd")!;
    const consoleCheck = section.checks.find((c) => c.id === "console-launchd")!;
    expect(bridgeCheck.condition).toBe("PASS");
    expect(consoleCheck.condition).toBe("PASS");
  });

  test("opencode-config SKIPPED when missing", async () => {
    const context = makeContext();
    const section = await runHostSection(context);
    const check = section.checks.find((c) => c.id === "opencode-config")!;
    expect(check.condition).toBe("SKIPPED");
  });

  test("opencode-config PASS when parseable", async () => {
    const home = process.env.HOME || "";
    const configPath = `${home}/.config/opencode/config.json`;
    const context = makeContext({
      io: {
        readFile: async (path: string) => {
          if (path === configPath) return '{"key":"value"}';
          throw new Error(`ENOENT: ${path}`);
        },
        lstat: async () => { throw new Error("ENOENT"); },
        realpath: async (p: string) => p,
        fetch: async () => { throw new Error("fetch failed"); },
        execFile: async () => { throw new Error("exec failed"); },
        now: () => new Date(),
      },
    });
    const section = await runHostSection(context);
    const check = section.checks.find((c) => c.id === "opencode-config")!;
    expect(check.condition).toBe("PASS");
  });

  test("skill-index WARN when missing", async () => {
    const context = makeContext();
    const section = await runHostSection(context);
    const check = section.checks.find((c) => c.id === "skill-index")!;
    expect(check.condition).toBe("WARN");
  });

  test("skill-index PASS when parseable", async () => {
    const home = process.env.HOME || "";
    const indexPath = `${home}/.agents/skill-index.json`;
    const context = makeContext({
      io: {
        readFile: async (path: string) => {
          if (path === indexPath) return '{"skills":[]}';
          throw new Error(`ENOENT: ${path}`);
        },
        lstat: async () => { throw new Error("ENOENT"); },
        realpath: async (p: string) => p,
        fetch: async () => { throw new Error("fetch failed"); },
        execFile: async () => { throw new Error("exec failed"); },
        now: () => new Date(),
      },
    });
    const section = await runHostSection(context);
    const check = section.checks.find((c) => c.id === "skill-index")!;
    expect(check.condition).toBe("PASS");
  });

  test("evidence symbolizer strips absolute paths", async () => {
    const context = makeContext();
    const section = await runHostSection(context);
    for (const check of section.checks) {
      for (const e of check.evidence) {
        expect(e).not.toMatch(/^\/(Users|Volumes)\//);
      }
    }
  });

  test("overall condition FAIL when any check fails", async () => {
    const context = makeContext();
    const section = await runHostSection(context);
    expect(section.condition).toBe("FAIL");
  });

  test("overall condition PASS when all checks pass", async () => {
    const home = process.env.HOME || "";
    const context = makeContext({
      io: {
        readFile: async (path: string) => {
          if (path.includes("opencode/config.json")) return '{"key":"value"}';
          if (path.includes("skill-index.json")) return '{"skills":[]}';
          throw new Error(`ENOENT: ${path}`);
        },
        lstat: async () => { throw new Error("ENOENT"); },
        realpath: async (p: string) => p,
        fetch: async () => new Response(null, { status: 200 }),
        execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        now: () => new Date(),
      },
    });
    const section = await runHostSection(context);
    expect(section.condition).toBe("PASS");
  });

  test("no private probe implementation leaked", async () => {
    const context = makeContext();
    const section = await runHostSection(context);
    const ids = section.checks.map((c) => c.id);
    expect(ids).not.toContain("sqlite");
    expect(ids).not.toContain("session-store");
    expect(ids).not.toContain("speculum");
    expect(ids).not.toContain("statusline");
  });
});
