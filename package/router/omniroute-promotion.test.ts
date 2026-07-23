import { describe, expect, test } from "bun:test";

import {
  manifestHash,
  signPromotionReceipt,
  validatePromotionReceipt,
  validatePromotionReceiptFromEnv,
} from "./omniroute-promotion";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");
const SIGNING_KEY = "fixture-promotion-key";
const VALIDATION_OPTIONS = { nowMs: NOW, signing_key: SIGNING_KEY, runtime_version: "3.8.48" };

function receipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const unsigned = {
    schema_version: 1,
    portfolio: "te-fast",
    suite_id: "suite-fast-v1",
    run_id: "run-20260722-001",
    run_status: "completed",
    sample_count: 100,
    success_rate: 0.98,
    cost_usd: 0.25,
    latency_p95_ms: 800,
    created_at: "2026-07-22T11:00:00.000Z",
    expires_at: "2026-08-22T12:00:00.000Z",
    manifest_hash: manifestHash(),
    nonce: "run-20260722-001-nonce",
    runtime_version: "3.8.48",
    policy_version: "temperance-routing-v1",
    ...overrides,
  };
  return { ...unsigned, signature: signPromotionReceipt(unsigned, SIGNING_KEY) };
}

describe("validatePromotionReceipt", () => {
  test("authorizes one complete low-risk portfolio receipt", () => {
    const result = validatePromotionReceipt(receipt(), VALIDATION_OPTIONS);
    expect(result).toEqual({ authorized: true, reasons: [] });
  });

  test("returns only the stable authorization shape", () => {
    expect(Object.keys(validatePromotionReceipt(receipt(), VALIDATION_OPTIONS)).sort()).toEqual([
      "authorized",
      "reasons",
    ]);
  });

  test("rejects absent, malformed, and wrong-portfolio receipts", () => {
    expect(validatePromotionReceipt(null, VALIDATION_OPTIONS).authorized).toBe(false);
    expect(validatePromotionReceipt({ schema_version: 1 }, VALIDATION_OPTIONS).authorized).toBe(false);
    expect(validatePromotionReceipt(receipt({ portfolio: "te-build" }), VALIDATION_OPTIONS).reasons).toContain(
      "portfolio-not-allowlisted",
    );
  });

  test("rejects incomplete eval runs and below-threshold evidence", () => {
    const result = validatePromotionReceipt(
      receipt({ run_status: "running", sample_count: 49, success_rate: 0.94 }),
      VALIDATION_OPTIONS,
    );
    expect(result.authorized).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "run-not-completed",
        "sample-count-below-minimum",
        "success-rate-below-minimum-or-invalid",
      ]),
    );
  });

  test("rejects cost and latency limit violations", () => {
    const result = validatePromotionReceipt(receipt({ cost_usd: 1.01, latency_p95_ms: 10_001 }), VALIDATION_OPTIONS);
    expect(result.authorized).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["cost-limit-exceeded-or-invalid", "latency-limit-exceeded-or-invalid"]),
    );
  });

  test("rejects future, expired, inverted, and malformed timestamps", () => {
    const future = validatePromotionReceipt(receipt({ created_at: "2026-07-22T13:00:00Z" }), VALIDATION_OPTIONS);
    const expired = validatePromotionReceipt(receipt({ expires_at: "2026-07-22T11:59:59Z" }), VALIDATION_OPTIONS);
    const inverted = validatePromotionReceipt(
      receipt({ created_at: "2026-08-01T00:00:00Z", expires_at: "2026-07-23T00:00:00Z" }),
      VALIDATION_OPTIONS,
    );
    const malformed = validatePromotionReceipt(receipt({ expires_at: "not-a-date" }), VALIDATION_OPTIONS);
    expect(future.reasons).toContain("receipt-created-in-the-future");
    expect(expired.reasons).toContain("receipt-expired");
    expect(inverted.reasons).toContain("receipt-expiry-precedes-creation");
    expect(malformed.reasons).toContain("expires-at-invalid");
  });

  test("rejects a receipt signed against another manifest", () => {
    const result = validatePromotionReceipt(receipt({ manifest_hash: "sha256:" + "0".repeat(64) }), VALIDATION_OPTIONS);
    expect(result.authorized).toBe(false);
    expect(result.reasons).toContain("manifest-hash-mismatch");
  });

  test("fails closed when the configured receipt path is absent or unreadable", () => {
    expect(validatePromotionReceiptFromEnv({}, { nowMs: NOW }).authorized).toBe(false);
    expect(
      validatePromotionReceiptFromEnv(
        { TEMPERANCE_OMNIROUTE_PROMOTION_RECEIPT: "/tmp/temperance-no-such-receipt.json" },
        VALIDATION_OPTIONS,
      ).authorized,
    ).toBe(false);
  });

  test("rejects a replayed nonce and runtime/policy drift", () => {
    const result = validatePromotionReceipt(receipt({ runtime_version: "3.8.49" }), {
      ...VALIDATION_OPTIONS,
      consumed_nonces: ["run-20260722-001-nonce"],
    });
    expect(result.authorized).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["runtime-version-mismatch", "nonce-replayed"]),
    );
  });
});
