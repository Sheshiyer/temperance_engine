import { describe, expect, test } from "bun:test";
import { assertLiveModel, createCatalogCache, fetchLiveModelIds } from "./OmniRouteCatalogGuardCore";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OmniRouteCatalogGuard", () => {
  test("reads live model IDs from the authenticated catalog endpoint", async () => {
    const ids = await fetchLiveModelIds("http://127.0.0.1:20128/v1", async (url) => {
      expect(String(url)).toBe("http://127.0.0.1:20128/v1/models");
      return response({ data: [{ id: "temperance-coding" }, { id: "auto/best-coding" }] });
    });

    expect(ids).toEqual(new Set(["temperance-coding", "auto/best-coding"]));
  });

  test("allows a live model and denies a stale picker ID", () => {
    const ids = new Set(["temperance-coding"]);
    expect(() => assertLiveModel("temperance-coding", ids)).not.toThrow();
    expect(() => assertLiveModel("auto/removed", ids)).toThrow(
      "absent from the live /v1/models catalog",
    );
  });

  test("fails closed when the catalog endpoint is unavailable or malformed", async () => {
    await expect(
      fetchLiveModelIds("http://127.0.0.1:20128/v1", async () => response({}, 503)),
    ).rejects.toThrow("catalog unavailable");
    await expect(
      fetchLiveModelIds("http://127.0.0.1:20128/v1", async () => response({ models: [] })),
    ).rejects.toThrow("catalog response is malformed");
    await expect(
      fetchLiveModelIds("http://127.0.0.1:20128/v1", async () => response({ data: [] })),
    ).rejects.toThrow("contains no model IDs");
  });

  test("does not reuse stale catalog data after the TTL expires", async () => {
    let now = 0;
    let calls = 0;
    const getIds = createCatalogCache({
      ttlMs: 100,
      now: () => now,
      fetchIds: async () => {
        calls += 1;
        if (calls === 1) return new Set(["te-fast"]);
        throw new Error("catalog unavailable");
      },
    });

    expect(await getIds("http://127.0.0.1:20128/v1")).toEqual(new Set(["te-fast"]));
    now = 50;
    expect(await getIds("http://127.0.0.1:20128/v1")).toEqual(new Set(["te-fast"]));
    now = 101;
    await expect(getIds("http://127.0.0.1:20128/v1")).rejects.toThrow("catalog unavailable");
  });

  test("isolates direct OmniRoute and synthetic relay catalogs", async () => {
    const calls: string[] = [];
    const getIds = createCatalogCache({
      fetchIds: async (baseUrl) => {
        calls.push(baseUrl);
        return baseUrl.includes("20129")
          ? new Set(["temperance-auto"])
          : new Set(["te-algorithm"]);
      },
    });

    expect(await getIds("http://127.0.0.1:20128/v1")).toEqual(new Set(["te-algorithm"]));
    expect(await getIds("http://127.0.0.1:20129/v1")).toEqual(new Set(["temperance-auto"]));
    expect(await getIds("http://127.0.0.1:20128/v1")).toEqual(new Set(["te-algorithm"]));
    expect(calls).toEqual([
      "http://127.0.0.1:20128/v1",
      "http://127.0.0.1:20129/v1",
    ]);
  });
});
