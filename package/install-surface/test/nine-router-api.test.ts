import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { NineRouterApiClient, NineRouterApiError, type NineRouterApiIO } from "../src/onboarding/nine-router-api.ts";

function mockIo(responses: Record<string, unknown>, observed: Array<{ url: string; init: RequestInit }>): NineRouterApiIO {
  return {
    readFile: async (path) => path.endsWith("machine-id") ? "machine-123\n" : "secret-456\n",
    mode: async () => 0o600,
    fetch: async (url, init) => {
      observed.push({ url, init });
      const path = new URL(url).pathname;
      const key = `${init.method} ${path}`;
      return new Response(JSON.stringify(responses[key] ?? {}), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}

describe("9router management adapter", () => {
  test("derives the upstream-compatible token in memory and returns a redacted catalog", async () => {
    const observed: Array<{ url: string; init: RequestInit }> = [];
    const client = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({
        "GET /api/providers": { connections: [{ id: "p1", name: "Primary", provider: "anthropic", isActive: true, apiKey: "must-not-return" }] },
        "GET /api/combos": { combos: [{ id: "c1", name: "noesis-plan", models: ["anthropic/m1"] }] },
      }, observed),
    });
    const catalog = await client.readCatalog();
    expect(catalog).toEqual({
      providers: [{ id: "p1", name: "Primary", provider: "anthropic", active: true }],
      combos: [{ id: "c1", alias: "noesis-plan", model_count: 1 }],
    });
    const expected = createHash("sha256").update("machine-1239r-cli-authsecret-456").digest("hex").slice(0, 16);
    expect(new Headers(observed[0]?.init.headers).get("x-9r-cli-token")).toBe(expected);
    expect(JSON.stringify(catalog)).not.toContain("must-not-return");
  });

  test("reads exact ordered string membership from an upstream combo", async () => {
    const client = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({
        "GET /api/combos/combo-1": {
          combo: { id: "combo-1", name: "noesis-build", models: ["anthropic/claude-build"] },
        },
      }, []),
    });
    expect(await client.readCombo("combo-1")).toEqual({
      id: "combo-1", alias: "noesis-build", models: ["anthropic/claude-build"],
    });
  });

  test("reads live model dropdown choices from 9router without a copied provider catalog", async () => {
    const client = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({
        "GET /api/providers": { connections: [
          { id: "p1", name: "Claude", provider: "claude", isActive: true },
          { id: "p2", name: "Codex", provider: "codex", isActive: true },
        ] },
        "GET /api/combos": { combos: [{ id: "c1", name: "noesis-build", models: ["cx/gpt-codex"] }] },
        "GET /v1/models": {
          object: "list",
          data: [
            { id: "noesis-build", owned_by: "combo", ignored: "value" },
            { id: "cc/claude-sonnet", owned_by: "cc", apiKey: "must-not-return" },
            { id: "cx/gpt-codex", owned_by: "cx" },
            { id: "gc/gemini-pro", owned_by: "gc" },
          ],
        },
      }, []),
    });
    expect(await client.readAvailableModels()).toEqual([
      { id: "noesis-build", owner: "combo", kind: "combo" },
      { id: "cc/claude-sonnet", owner: "cc", kind: "provider" },
      { id: "cx/gpt-codex", owner: "cx", kind: "provider" },
    ]);
  });

  test("does not offer static models before a live provider is admitted", async () => {
    const client = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({
        "GET /api/providers": { connections: [] },
        "GET /api/combos": { combos: [] },
        "GET /v1/models": { data: [{ id: "cx/gpt-codex", owned_by: "cx" }] },
      }, []),
    });
    expect(await client.readAvailableModels()).toEqual([]);
  });

  test("completes a one-shot authorization-code flow without returning verifier, state, code, or tokens", async () => {
    const observed: Array<{ url: string; init: RequestInit }> = [];
    const client = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({
        "GET /api/oauth/codex/authorize": {
          authUrl: "https://auth.example.test/authorize?request=opaque",
          codeVerifier: "verifier-secret",
          state: "state-secret",
          redirectUri: "http://localhost:1455/auth/callback",
        },
        "POST /api/oauth/codex/exchange": {
          success: true,
          connection: { id: "connection-1", accessToken: "upstream-token" },
        },
      }, observed),
    });

    const session = await client.beginOAuthAuthorization("codex");
    expect(session).toEqual({
      kind: "authorization-code",
      provider: "codex",
      authorization_url: "https://auth.example.test/authorize?request=opaque",
      callback_url: "http://localhost:1455/auth/callback",
    });
    expect(Object.isFrozen(session)).toBe(true);
    expect(JSON.parse(JSON.stringify(session))).toEqual({ kind: "authorization-code", provider: "codex", opaque: true });
    expect(JSON.stringify(session)).not.toContain("auth.example.test");
    expect(new URL(observed[0]?.url ?? "").searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");

    const receipt = await client.completeOAuthAuthorization(
      session,
      "http://localhost:1455/auth/callback?code=authorization-code&state=state-secret",
    );
    expect(receipt).toEqual({ provider: "codex", connected: true });
    expect(JSON.stringify(receipt)).not.toContain("upstream-token");
    expect(JSON.parse(String(observed[1]?.init.body))).toEqual({
      code: "authorization-code",
      redirectUri: "http://localhost:1455/auth/callback",
      codeVerifier: "verifier-secret",
      state: "state-secret",
    });
    await expect(client.completeOAuthAuthorization(
      session,
      "http://localhost:1455/auth/callback?code=authorization-code&state=state-secret",
    )).rejects.toThrow("NINE_ROUTER_OAUTH_SESSION_INVALID");
  });

  test("rejects forged callbacks and providers whose declared flow does not match", async () => {
    const observed: Array<{ url: string; init: RequestInit }> = [];
    const client = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({
        "GET /api/oauth/claude/authorize": {
          authUrl: "https://auth.example.test/authorize",
          codeVerifier: "verifier-secret",
          state: "state-secret",
          redirectUri: "http://localhost:20128/callback",
        },
      }, observed),
    });
    await expect(client.beginOAuthAuthorization("openai")).rejects.toThrow("NINE_ROUTER_OAUTH_PROVIDER_INVALID");
    await expect(client.beginOAuthAuthorization("github")).rejects.toThrow("NINE_ROUTER_OAUTH_FLOW_INVALID");
    await expect(client.beginOAuthDevice("claude")).rejects.toThrow("NINE_ROUTER_OAUTH_FLOW_INVALID");
    const session = await client.beginOAuthAuthorization("claude");
    await expect(client.completeOAuthAuthorization(
      session,
      "http://localhost:20128/callback?code=authorization-code&state=wrong-state",
    )).rejects.toThrow("NINE_ROUTER_OAUTH_CALLBACK_INVALID");
    expect(observed).toHaveLength(1);
  });

  test("polls a device flow once per call while keeping device proof out of the view model", async () => {
    const observed: Array<{ url: string; init: RequestInit }> = [];
    const pollResponses = [
      { error: "slow_down" },
      { success: true, accessToken: "upstream-token" },
    ];
    const io = mockIo({}, observed);
    io.fetch = async (url, init) => {
      observed.push({ url, init });
      const pathname = new URL(url).pathname;
      const value = pathname.endsWith("/device-code")
        ? {
          device_code: "device-code-secret",
          user_code: "ABCD-EFGH",
          verification_uri: "https://device.example.test/activate",
          codeVerifier: "device-verifier-secret",
          interval: 5,
          expires_in: 300,
          extraData: { _clientId: "provider-client-secret" },
        }
        : pollResponses.shift();
      return new Response(JSON.stringify(value ?? {}), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new NineRouterApiClient({ dataDirectory: "/example/.9router", io });

    const session = await client.beginOAuthDevice("github");
    expect(session).toEqual({
      kind: "device-code",
      provider: "github",
      verification_url: "https://device.example.test/activate",
      user_code: "ABCD-EFGH",
      poll_interval_seconds: 5,
      expires_in_seconds: 300,
    });
    expect(Object.isFrozen(session)).toBe(true);
    const serialized = JSON.stringify(session);
    expect(JSON.parse(serialized)).toEqual({ kind: "device-code", provider: "github", opaque: true });
    expect(serialized).not.toContain("ABCD-EFGH");
    expect(serialized).not.toContain("device-code-secret");
    expect(serialized).not.toContain("device-verifier-secret");
    expect(serialized).not.toContain("provider-client-secret");

    expect(await client.pollOAuthDevice(session)).toEqual({ status: "pending", retry_after_seconds: 10 });
    expect(await client.pollOAuthDevice(session)).toEqual({ status: "connected", provider: "github" });
    const pollBody = JSON.parse(String(observed[1]?.init.body));
    expect(pollBody).toEqual({
      deviceCode: "device-code-secret",
      codeVerifier: "device-verifier-secret",
      extraData: { _clientId: "provider-client-secret" },
    });
    await expect(client.pollOAuthDevice(session)).rejects.toThrow("NINE_ROUTER_OAUTH_SESSION_INVALID");
  });

  test("fails closed when 9router returns a remote-insecure OAuth URL or a changed redirect", async () => {
    const insecure = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({
        "GET /api/oauth/claude/authorize": {
          authUrl: "http://auth.example.test/authorize",
          codeVerifier: "verifier",
          state: "state",
          redirectUri: "http://localhost:20128/callback",
        },
      }, []),
    });
    await expect(insecure.beginOAuthAuthorization("claude")).rejects.toThrow("NINE_ROUTER_OAUTH_AUTHORIZATION_URL_INVALID");

    const redirectChanged = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({
        "GET /api/oauth/codex/authorize": {
          authUrl: "https://auth.example.test/authorize",
          codeVerifier: "verifier",
          state: "state",
          redirectUri: "http://localhost:20128/callback",
        },
      }, []),
    });
    await expect(redirectChanged.beginOAuthAuthorization("codex")).rejects.toThrow("NINE_ROUTER_OAUTH_REDIRECT_MISMATCH");
  });

  test("rejects malformed live model choices instead of rendering unsafe dropdown text", async () => {
    const client = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({ "GET /v1/models": { data: [{ id: "bad\nmodel", owned_by: "cc" }] } }, []),
    });
    await expect(client.readAvailableModels()).rejects.toThrow("NINE_ROUTER_RESPONSE_INVALID");
  });

  test("captures a new gateway key once and never returns the secret", async () => {
    const observed: Array<{ url: string; init: RequestInit }> = [];
    let captured = "";
    const client = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({ "POST /api/keys": { key: { id: "key-1", name: "Temperance", key: "gateway-secret" } } }, observed),
    });
    const receipt = await client.createGatewayKey("Temperance", async (secret) => { captured = secret; });
    expect(captured).toBe("gateway-secret");
    expect(receipt).toEqual({ id: "key-1", name: "Temperance", captured: true });
    expect(JSON.stringify(receipt)).not.toContain("gateway-secret");
  });

  test("reads gateway key metadata without returning key material", async () => {
    const client = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({ "GET /api/keys": { keys: [{ id: "key-1", name: "Temperance", key: "must-not-return" }] } }, []),
    });
    const keys = await client.readGatewayKeys();
    expect(keys).toEqual([{ id: "key-1", name: "Temperance" }]);
    expect(JSON.stringify(keys)).not.toContain("must-not-return");
  });

  test("deletes newly created resources through bounded item endpoints", async () => {
    const observed: Array<{ url: string; init: RequestInit }> = [];
    const client = new NineRouterApiClient({ dataDirectory: "/example/.9router", io: mockIo({}, observed) });
    await client.deleteProviderConnection("provider-1");
    await client.deleteCombo("combo-1");
    await client.deleteGatewayKey("key-1");
    expect(observed.map(({ url, init }) => `${init.method} ${new URL(url).pathname}`)).toEqual([
      "DELETE /api/providers/provider-1",
      "DELETE /api/combos/combo-1",
      "DELETE /api/keys/key-1",
    ]);
  });

  test("fails closed for remote URLs, unsafe secret modes, and malformed combo model identifiers", async () => {
    expect(() => new NineRouterApiClient({ dataDirectory: "/example/.9router", baseUrl: "https://router.example.com:20128" })).toThrow("NINE_ROUTER_BASE_URL_NOT_LOOPBACK");
    const unsafeIo = mockIo({}, []);
    unsafeIo.mode = async () => 0o644;
    const unsafe = new NineRouterApiClient({ dataDirectory: "/example/.9router", io: unsafeIo });
    await expect(unsafe.readCatalog()).rejects.toEqual(expect.objectContaining({ code: "NINE_ROUTER_CLI_SECRET_MODE_UNSAFE" }));
    const observed: Array<{ url: string; init: RequestInit }> = [];
    const client = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({ "POST /api/combos": { combo: { id: "combo-safe", name: "noesis-plan" } } }, observed),
    });
    await expect(client.createCombo({ name: "noesis-plan", models: ["bad\nmodel"] })).rejects.toBeInstanceOf(NineRouterApiError);
    await expect(client.createCombo({ name: "noesis-plan", models: ["example/model", "example/model"] })).rejects.toBeInstanceOf(NineRouterApiError);
    await expect(client.createCombo({ name: "noesis-plan", models: ["example/token-efficient-model"] })).resolves.toEqual(expect.objectContaining({ name: "noesis-plan" }));
    expect(JSON.parse(String(observed[0]?.init.body))).toEqual({ name: "noesis-plan", models: ["example/token-efficient-model"] });
  });

  test("strips credential-shaped CLI settings fields from API readback", async () => {
    const client = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({ "GET /api/cli-tools/codex-settings": { data: { installed: true, has9Router: true, apiKey: "hidden", nested: { accessToken: "hidden-too", mode: "direct" } } } }, []),
    });
    expect(await client.readCliToolSettings("codex")).toEqual({ installed: true, has9Router: true, nested: { mode: "direct" } });
  });
});
