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
        "GET /api/combos": { combos: [{ id: "c1", name: "noesis-plan", models: [{ providerId: "p1", modelId: "m1" }] }] },
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

  test("fails closed for remote URLs, unsafe secret modes, and credential fields in combos", async () => {
    expect(() => new NineRouterApiClient({ dataDirectory: "/example/.9router", baseUrl: "https://router.example.com:20128" })).toThrow("NINE_ROUTER_BASE_URL_NOT_LOOPBACK");
    const unsafeIo = mockIo({}, []);
    unsafeIo.mode = async () => 0o644;
    const unsafe = new NineRouterApiClient({ dataDirectory: "/example/.9router", io: unsafeIo });
    await expect(unsafe.readCatalog()).rejects.toEqual(expect.objectContaining({ code: "NINE_ROUTER_CLI_SECRET_MODE_UNSAFE" }));
    const client = new NineRouterApiClient({ dataDirectory: "/example/.9router", io: mockIo({}, []) });
    await expect(client.createCombo({ name: "noesis-plan", models: [{ providerId: "p1", apiKey: "forbidden" }] })).rejects.toBeInstanceOf(NineRouterApiError);
  });

  test("strips credential-shaped CLI settings fields from API readback", async () => {
    const client = new NineRouterApiClient({
      dataDirectory: "/example/.9router",
      io: mockIo({ "GET /api/cli-tools/codex-settings": { data: { installed: true, has9Router: true, apiKey: "hidden", nested: { accessToken: "hidden-too", mode: "direct" } } } }, []),
    });
    expect(await client.readCliToolSettings("codex")).toEqual({ installed: true, has9Router: true, nested: { mode: "direct" } });
  });
});
