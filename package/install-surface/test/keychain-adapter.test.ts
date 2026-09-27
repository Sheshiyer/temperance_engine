import { describe, expect, test } from "bun:test";

import { KeychainAdapterError, MacOsKeychainAdapter, type KeychainIO } from "../src/onboarding/keychain-adapter.ts";

const reference = { store: "macos-keychain" as const, service: "temperance.9router.gateway", account: "default" };

describe("macOS Keychain adapter", () => {
  test("uses references for lookup and keeps the secret out of return metadata", async () => {
    const calls: string[][] = [];
    const io: KeychainIO = {
      platform: "darwin",
      exec: async (argv) => {
        calls.push([...argv]);
        return argv.includes("-w") && argv.includes("find-generic-password")
          ? { exitCode: 0, stdout: "secret-value\n" }
          : { exitCode: 0, stdout: "" };
      },
    };
    const adapter = new MacOsKeychainAdapter(io);
    expect(await adapter.has(reference)).toBe(true);
    expect(await adapter.read(reference)).toBe("secret-value");
    await adapter.put(reference, "replacement-value");
    expect(calls[0]).toEqual(["/usr/bin/security", "find-generic-password", "-s", reference.service, "-a", reference.account]);
    expect(calls[2]?.slice(0, 4)).toEqual(["/usr/bin/security", "add-generic-password", "-U", "-s"]);
  });

  test("classifies non-macOS hosts as unsupported before executing", async () => {
    let called = false;
    const adapter = new MacOsKeychainAdapter({ platform: "linux", exec: async () => { called = true; return { exitCode: 0, stdout: "" }; } });
    await expect(adapter.has(reference)).rejects.toEqual(expect.objectContaining({ code: "KEYCHAIN_UNSUPPORTED_PLATFORM" }));
    expect(called).toBe(false);
  });

  test("rejects invalid references and multiline secret values", async () => {
    const adapter = new MacOsKeychainAdapter({ platform: "darwin", exec: async () => ({ exitCode: 0, stdout: "" }) });
    await expect(adapter.has({ ...reference, service: "bad\nservice" })).rejects.toBeInstanceOf(KeychainAdapterError);
    await expect(adapter.put(reference, "bad\nsecret")).rejects.toBeInstanceOf(KeychainAdapterError);
  });
});
