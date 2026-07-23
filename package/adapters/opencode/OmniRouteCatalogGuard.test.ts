import { describe, expect, test } from "bun:test";
import { assertLiveModel, fetchLiveModelIds } from "./OmniRouteCatalogGuard";

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
  });
});
