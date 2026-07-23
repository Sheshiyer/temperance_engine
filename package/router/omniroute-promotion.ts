#!/usr/bin/env bun

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import manifestJson from "./omniroute-portfolios.json";

export const PROMOTION_SCHEMA_VERSION = 1 as const;
export const PROMOTABLE_PORTFOLIO = "te-fast";
export const PROMOTION_POLICY_VERSION = "temperance-routing-v1";
export const MIN_SAMPLE_COUNT = 50;
export const MIN_SUCCESS_RATE = 0.95;
export const MAX_COST_USD = 1;
export const MAX_LATENCY_P95_MS = 10_000;

export interface PromotionReceipt {
  schema_version: number;
  portfolio: string;
  suite_id: string;
  run_id: string;
  run_status: string;
  sample_count: number;
  success_rate: number;
  cost_usd: number;
  latency_p95_ms: number;
  created_at: string;
  expires_at: string;
  manifest_hash: string;
  nonce: string;
  runtime_version: string;
  policy_version: string;
  signature: string;
}

export interface PromotionValidation {
  authorized: boolean;
  reasons: string[];
}

export interface PromotionValidationOptions {
  nowMs?: number;
  manifest_hash?: string;
  allowed_portfolio?: string;
  min_sample_count?: number;
  min_success_rate?: number;
  max_cost_usd?: number;
  max_latency_p95_ms?: number;
  signing_key?: string;
  runtime_version?: string;
  policy_version?: string;
  consumed_nonces?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function manifestHash(manifest: unknown = manifestJson): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(manifest)))
    .digest("hex")}`;
}

function signedPayload(value: unknown): string {
  if (!isRecord(value)) return "";
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "signature"));
  return JSON.stringify(canonicalize(unsigned));
}

export function signPromotionReceipt(value: unknown, signingKey: string): string {
  return `hmac-sha256:${createHmac("sha256", signingKey).update(signedPayload(value)).digest("hex")}`;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validatePromotionReceipt(
  value: unknown,
  options: PromotionValidationOptions = {},
): PromotionValidation {
  const reasons: string[] = [];
  const receipt = isRecord(value) ? value : null;
  const nowMs = options.nowMs ?? Date.now();
  const allowedPortfolio = options.allowed_portfolio ?? PROMOTABLE_PORTFOLIO;
  const minSampleCount = options.min_sample_count ?? MIN_SAMPLE_COUNT;
  const minSuccessRate = options.min_success_rate ?? MIN_SUCCESS_RATE;
  const maxCostUsd = options.max_cost_usd ?? MAX_COST_USD;
  const maxLatencyP95Ms = options.max_latency_p95_ms ?? MAX_LATENCY_P95_MS;
  const signingKey = options.signing_key;
  const expectedRuntimeVersion = options.runtime_version;
  const expectedPolicyVersion = options.policy_version ?? PROMOTION_POLICY_VERSION;

  if (!receipt) {
    return { authorized: false, reasons: ["receipt-missing-or-not-an-object"] };
  }

  if (receipt.schema_version !== PROMOTION_SCHEMA_VERSION) reasons.push("schema-version-mismatch");
  if (receipt.portfolio !== allowedPortfolio) reasons.push("portfolio-not-allowlisted");
  if (!nonEmptyString(receipt.suite_id)) reasons.push("suite-id-missing");
  if (!nonEmptyString(receipt.run_id)) reasons.push("run-id-missing");
  if (receipt.run_status !== "completed") reasons.push("run-not-completed");

  if (!Number.isInteger(receipt.sample_count) || receipt.sample_count < minSampleCount) {
    reasons.push("sample-count-below-minimum");
  }
  if (!finiteNumber(receipt.success_rate) || receipt.success_rate < minSuccessRate || receipt.success_rate > 1) {
    reasons.push("success-rate-below-minimum-or-invalid");
  }
  if (!finiteNumber(receipt.cost_usd) || receipt.cost_usd < 0 || receipt.cost_usd > maxCostUsd) {
    reasons.push("cost-limit-exceeded-or-invalid");
  }
  if (!finiteNumber(receipt.latency_p95_ms) || receipt.latency_p95_ms < 0 || receipt.latency_p95_ms > maxLatencyP95Ms) {
    reasons.push("latency-limit-exceeded-or-invalid");
  }

  const createdMs = nonEmptyString(receipt.created_at) ? Date.parse(receipt.created_at) : Number.NaN;
  const expiresMs = nonEmptyString(receipt.expires_at) ? Date.parse(receipt.expires_at) : Number.NaN;
  if (!Number.isFinite(createdMs)) reasons.push("created-at-invalid");
  if (!Number.isFinite(expiresMs)) reasons.push("expires-at-invalid");
  if (Number.isFinite(createdMs) && createdMs > nowMs) reasons.push("receipt-created-in-the-future");
  if (Number.isFinite(expiresMs) && expiresMs <= nowMs) reasons.push("receipt-expired");
  if (Number.isFinite(createdMs) && Number.isFinite(expiresMs) && expiresMs <= createdMs) {
    reasons.push("receipt-expiry-precedes-creation");
  }

  if (receipt.manifest_hash !== (options.manifest_hash ?? manifestHash())) {
    reasons.push("manifest-hash-mismatch");
  }
  if (!nonEmptyString(receipt.nonce)) reasons.push("nonce-missing");
  if (!nonEmptyString(receipt.runtime_version)) reasons.push("runtime-version-missing");
  if (expectedRuntimeVersion && receipt.runtime_version !== expectedRuntimeVersion) {
    reasons.push("runtime-version-mismatch");
  }
  if (receipt.policy_version !== expectedPolicyVersion) reasons.push("policy-version-mismatch");
  if (Array.isArray(options.consumed_nonces) && options.consumed_nonces.includes(String(receipt.nonce))) {
    reasons.push("nonce-replayed");
  }
  if (!nonEmptyString(receipt.signature)) {
    reasons.push("signature-missing");
  } else if (!signingKey) {
    reasons.push("signing-key-missing");
  } else {
    const expected = signPromotionReceipt(receipt, signingKey);
    const actualBytes = Buffer.from(String(receipt.signature));
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
      reasons.push("signature-invalid");
    }
  }

  return { authorized: reasons.length === 0, reasons };
}

export function validatePromotionReceiptFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: PromotionValidationOptions = {},
): PromotionValidation {
  const receiptPath = env.TEMPERANCE_OMNIROUTE_PROMOTION_RECEIPT;
  if (!receiptPath) return validatePromotionReceipt(null, options);
  const consumedNoncesPath = env.TEMPERANCE_OMNIROUTE_PROMOTION_CONSUMED_NONCES;
  let consumedNonces: string[] | undefined;
  if (consumedNoncesPath) {
    try {
      const parsed = JSON.parse(readFileSync(consumedNoncesPath, "utf8")) as unknown;
      if (Array.isArray(parsed) && parsed.every((nonce) => typeof nonce === "string")) {
        consumedNonces = parsed;
      }
    } catch {
      consumedNonces = undefined;
    }
  }
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as unknown;
    return validatePromotionReceipt(receipt, {
      ...options,
      signing_key: options.signing_key ?? env.TEMPERANCE_OMNIROUTE_PROMOTION_SIGNING_KEY,
      runtime_version: options.runtime_version ?? env.TEMPERANCE_OMNIROUTE_RUNTIME_VERSION,
      consumed_nonces: options.consumed_nonces ?? consumedNonces,
    });
  } catch {
    return { authorized: false, reasons: ["receipt-unreadable-or-malformed"] };
  }
}

if (import.meta.main) {
  const command = Bun.argv[2] ?? "validate";
  if (command === "manifest-hash") {
    process.stdout.write(`${manifestHash()}\n`);
    process.exit(0);
  }
  if (command !== "validate") {
    console.error("usage: omniroute-promotion.ts [validate|manifest-hash]");
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(validatePromotionReceiptFromEnv())}\n`);
}
