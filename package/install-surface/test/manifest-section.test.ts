import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runManifestSection } from "../src/doctor/sections/manifest.ts";
import type { DoctorContextV2 } from "../src/doctor/model.ts";
import type { CompileResult } from "../src/compile.ts";
import type { DoctorCheck } from "../src/types.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function makeContext(stateRoot: string, overrides?: Partial<DoctorContextV2>): DoctorContextV2 {
  const repositoryRoot = tempRoot("manifest-repo-");
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
      readFile: async (path: string) => readFileSync(path, "utf8"),
      lstat: async (path: string) => lstatSync(path),
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

describe("manifest section parity", () => {
  test("produces all 12 bridge check ids", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const ids = section.checks.map((c) => c.id).sort();
    const expected = [
      "activation-policy", "active-runs", "bridge-health", "bridge-launchd",
      "bridge-source", "console-health", "console-launchd", "event-log",
      "omniroute", "project-registry", "prompt-hooks", "state-root",
    ].sort();
    expect(ids).toEqual(expected);
  });

  test("state-root FAIL when directory missing", async () => {
    const stateRoot = join(tmpdir(), "nonexistent-manifest-state-" + Date.now());
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "state-root")!;
    expect(check.condition).toBe("FAIL");
  });

  test("state-root PASS when directory exists", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "state-root")!;
    expect(check.condition).toBe("PASS");
  });

  test("event-log WARN when no event file", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "event-log")!;
    expect(check.condition).toBe("WARN");
  });

  test("event-log PASS with valid events", async () => {
    const stateRoot = tempRoot("manifest-state-");
    writeFileSync(join(stateRoot, "events.jsonl"), '{"id":"e1","type":"test"}\n{"id":"e2","type":"test"}\n');
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "event-log")!;
    expect(check.condition).toBe("PASS");
  });

  test("event-log FAIL with malformed events", async () => {
    const stateRoot = tempRoot("manifest-state-");
    writeFileSync(join(stateRoot, "events.jsonl"), '{"id":"e1"}\nnot json\n');
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "event-log")!;
    expect(check.condition).toBe("FAIL");
  });

  test("activation-policy WARN when missing", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "activation-policy")!;
    expect(check.condition).toBe("WARN");
  });

  test("activation-policy PASS when enabled", async () => {
    const stateRoot = tempRoot("manifest-state-");
    writeFileSync(join(stateRoot, "activation-policy.json"), JSON.stringify({ enabled: true }));
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "activation-policy")!;
    expect(check.condition).toBe("PASS");
  });

  test("activation-policy WARN when disabled", async () => {
    const stateRoot = tempRoot("manifest-state-");
    writeFileSync(join(stateRoot, "activation-policy.json"), JSON.stringify({ enabled: false }));
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "activation-policy")!;
    expect(check.condition).toBe("WARN");
  });

  test("activation-policy FAIL when malformed", async () => {
    const stateRoot = tempRoot("manifest-state-");
    writeFileSync(join(stateRoot, "activation-policy.json"), JSON.stringify({ bad: true }));
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "activation-policy")!;
    expect(check.condition).toBe("FAIL");
  });

  test("active-runs WARN when directory missing", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "active-runs")!;
    expect(check.condition).toBe("WARN");
  });

  test("active-runs PASS when directory exists", async () => {
    const stateRoot = tempRoot("manifest-state-");
    mkdirSync(join(stateRoot, "active-runs"));
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "active-runs")!;
    expect(check.condition).toBe("PASS");
  });

  test("project-registry WARN when missing", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "project-registry")!;
    expect(check.condition).toBe("WARN");
  });

  test("project-registry PASS with valid registry", async () => {
    const stateRoot = tempRoot("manifest-state-");
    writeFileSync(join(stateRoot, "projects.json"), JSON.stringify([{ project_id: "p1" }]));
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "project-registry")!;
    expect(check.condition).toBe("PASS");
  });

  test("project-registry FAIL when not array", async () => {
    const stateRoot = tempRoot("manifest-state-");
    writeFileSync(join(stateRoot, "projects.json"), JSON.stringify({ bad: true }));
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "project-registry")!;
    expect(check.condition).toBe("FAIL");
  });

  test("bridge-health FAIL when unreachable", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "bridge-health")!;
    expect(check.condition).toBe("FAIL");
  });

  test("bridge-health PASS when healthy", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot, {
      io: {
        readFile: async () => { throw new Error("ENOENT"); },
        lstat: async () => { throw new Error("ENOENT"); },
        realpath: async (p: string) => p,
        fetch: async () => new Response(null, { status: 200 }),
        execFile: async () => { throw new Error("exec failed"); },
        now: () => new Date(),
      },
    });
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "bridge-health")!;
    expect(check.condition).toBe("PASS");
  });

  test("omniroute WARN when unreachable", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "omniroute")!;
    expect(check.condition).toBe("WARN");
  });

  test("omniroute PASS when healthy", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot, {
      io: {
        readFile: async () => { throw new Error("ENOENT"); },
        lstat: async () => { throw new Error("ENOENT"); },
        realpath: async (p: string) => p,
        fetch: async () => new Response(null, { status: 200 }),
        execFile: async () => { throw new Error("exec failed"); },
        now: () => new Date(),
      },
    });
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "omniroute")!;
    expect(check.condition).toBe("PASS");
  });

  test("console-health FAIL when unreachable", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "console-health")!;
    expect(check.condition).toBe("FAIL");
  });

  test("console-health PASS with valid HTML", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot, {
      io: {
        readFile: async () => { throw new Error("ENOENT"); },
        lstat: async () => { throw new Error("ENOENT"); },
        realpath: async (p: string) => p,
        fetch: async () => new Response('<html><body><div id="root"></div></body></html>', { status: 200 }),
        execFile: async () => { throw new Error("exec failed"); },
        now: () => new Date(),
      },
    });
    const section = await runManifestSection(context);
    const check = section.checks.find((c) => c.id === "console-health")!;
    expect(check.condition).toBe("PASS");
  });

  test("launchd checks WARN on non-darwin", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot, { platform: "linux" as NodeJS.Platform });
    const section = await runManifestSection(context);
    const bridgeCheck = section.checks.find((c) => c.id === "bridge-launchd")!;
    const consoleCheck = section.checks.find((c) => c.id === "console-launchd")!;
    expect(bridgeCheck.condition).toBe("WARN");
    expect(consoleCheck.condition).toBe("WARN");
  });

  test("evidence symbolizer strips absolute paths", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    for (const check of section.checks) {
      for (const e of check.evidence) {
        expect(e).not.toMatch(/^\/(Users|Volumes)\//);
      }
    }
  });

  test("overall condition is FAIL when any check fails", async () => {
    const stateRoot = tempRoot("manifest-state-");
    const context = makeContext(stateRoot);
    const section = await runManifestSection(context);
    expect(section.condition).toBe("FAIL");
  });

  test("overall condition is PASS when all checks pass", async () => {
    const stateRoot = tempRoot("manifest-state-");
    mkdirSync(join(stateRoot, "active-runs"));
    writeFileSync(join(stateRoot, "events.jsonl"), '{"id":"e1"}\n');
    writeFileSync(join(stateRoot, "activation-policy.json"), JSON.stringify({ enabled: true }));
    writeFileSync(join(stateRoot, "projects.json"), JSON.stringify([{ project_id: "p1" }]));
    const context = makeContext(stateRoot, {
      io: {
        readFile: async (path: string) => {
          if (path.includes("events.jsonl")) return '{"id":"e1"}\n';
          if (path.includes("activation-policy.json")) return JSON.stringify({ enabled: true });
          if (path.includes("projects.json")) return JSON.stringify([{ project_id: "p1" }]);
          if (path.includes("PromptProcessing.hook.ts")) return "manifestRuntimeReceipt";
          if (path.includes("manifest-bridge.plist")) return "manifest-bridge";
          throw new Error(`ENOENT: ${path}`);
        },
        lstat: async () => ({ isDirectory: () => true } as any),
        realpath: async (p: string) => p,
        fetch: async () => new Response('<html><body><div id="root"></div></body></html>', { status: 200 }),
        execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        now: () => new Date(),
      },
    });
    const section = await runManifestSection(context);
    expect(section.condition).toBe("PASS");
  });
});
