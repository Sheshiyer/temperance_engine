import { describe, expect, test } from "bun:test";

import type { OnboardingProfileV1 } from "../src/onboarding/contracts.ts";
import { ONBOARDING_PROFILE_SCHEMA } from "../src/onboarding/contracts.ts";
import { createSystemProbeAdapter, type OnboardingProbeIO } from "../src/onboarding/system-adapter.ts";

const baseProfile: OnboardingProfileV1 = {
  schema: ONBOARDING_PROFILE_SCHEMA,
  version: { major: 1, minor: 0 },
  id: "adapter-test",
  variables: {},
  secret_references: {},
  preselected_modules: [],
  routing_aliases: [],
  project_enrollments: [],
};

function io(overrides: Partial<OnboardingProbeIO> = {}): OnboardingProbeIO {
  return {
    platform: "darwin",
    which: async () => "/opt/example/bin/tool",
    execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    pathInfo: async () => ({ exists: true, type: "directory", readable: true, writable: true, mode: 0o700 }),
    fetch: async () => new Response(null, { status: 200 }),
    ...overrides,
  };
}

describe("system onboarding probe adapter", () => {
  test("enforces an exact binary version", async () => {
    const adapter = createSystemProbeAdapter({ io: io({
      execFile: async () => ({ stdout: "9router 0.5.69\n", stderr: "", exitCode: 0 }),
    }) });
    const result = await adapter.probe({ id: "router", kind: "binary", executable: "9router", version: { exact: "0.5.75", argv: ["--version"] } }, { profile: baseProfile, signal: new AbortController().signal });
    expect(result.reason_code).toBe("VERSION_MISMATCH");
    expect(result.evidence.join(" ")).not.toContain("token");
  });

  test("probes a private host-bound executable without requiring a global shim", async () => {
    const lookups: string[] = [];
    const executions: string[] = [];
    const adapter = createSystemProbeAdapter({ io: io({
      which: async (executable) => { lookups.push(executable); return executable; },
      execFile: async (file) => { executions.push(file); return { stdout: "0.5.75\n", stderr: "", exitCode: 0 }; },
    }) });
    const profile = { ...baseProfile, variables: { NINE_ROUTER_CLI_ENTRYPOINT: "/private/runtime/9router/cli.js" } };
    const result = await adapter.probe({
      id: "router",
      kind: "binary",
      executable: "9router",
      executable_variable: "NINE_ROUTER_CLI_ENTRYPOINT",
      version: { exact: "0.5.75", argv: ["--version"] },
    }, { profile, signal: new AbortController().signal });
    expect(result.available).toBe(true);
    expect(lookups).toEqual(["/private/runtime/9router/cli.js"]);
    expect(executions).toEqual(["/private/runtime/9router/cli.js"]);
  });

  test("checks Keychain item presence without requesting or emitting its value", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const adapter = createSystemProbeAdapter({ io: io({
      execFile: async (file, args) => {
        calls.push({ file, args });
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    }) });
    const profile = { ...baseProfile, secret_references: { API: { store: "macos-keychain" as const, service: "temperance.provider", account: "primary" } } };
    const result = await adapter.probe({ id: "api", kind: "keychain-secret", secret_reference: "API" }, { profile, signal: new AbortController().signal });
    expect(result.available).toBe(true);
    expect(calls).toEqual([{ file: "security", args: ["find-generic-password", "-s", "temperance.provider", "-a", "primary"] }]);
    expect(calls[0]!.args).not.toContain("-w");
    expect(result.evidence).toEqual(["keychain item is present"]);
  });

  test("checks 9router derived-auth files by metadata only", async () => {
    const paths: string[] = [];
    const adapter = createSystemProbeAdapter({ io: io({
      pathInfo: async (path) => {
        paths.push(path);
        return { exists: true, type: path === "/example/9router" ? "directory" : "file", readable: true, writable: false, mode: path.endsWith("cli-secret") ? 0o600 : 0o644 };
      },
    }) });
    const profile = { ...baseProfile, variables: { NINE_ROUTER_DATA_DIR: "/example/9router" } };
    const result = await adapter.probe({ id: "router-auth", kind: "9router-management", data_dir_variable: "NINE_ROUTER_DATA_DIR" }, { profile, signal: new AbortController().signal });
    expect(result.available).toBe(true);
    expect(paths).toEqual(["/example/9router", "/example/9router/machine-id", "/example/9router/auth/cli-secret"]);
    expect(result.evidence.join(" ")).not.toContain("x-9r-cli-token");
  });

  test("rejects absolute and parent-traversing mount-relative subtrees before filesystem access", async () => {
    const seen: string[] = [];
    const adapter = createSystemProbeAdapter({ io: io({
      pathInfo: async (path) => {
        seen.push(path);
        return { exists: true, type: "directory", readable: true, writable: true, mode: 0o700 };
      },
    }) });
    for (const unsafe of ["/absolute", "../escape", "nested/../../escape"]) {
      seen.length = 0;
      const profile = { ...baseProfile, variables: { MOUNT: "/example/mount", SUBTREE: unsafe } };
      const result = await adapter.probe({ id: "mount", kind: "mount", mount_path_variable: "MOUNT", required_relative_path_variable: "SUBTREE" }, { profile, signal: new AbortController().signal });
      expect(result.reason_code).toBe("VARIABLE_INVALID");
      expect(seen).toEqual([]);
    }
  });
});
