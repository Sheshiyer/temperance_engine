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
        "GET /v1/models": {
          object: "list",
          data: [
            { id: "noesis-build", owned_by: "combo", ignored: "value" },
            { id: "cc/claude-sonnet", owned_by: "cc", apiKey: "must-not-return" },
            { id: "cx/gpt-codex", owned_by: "cx" },
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
