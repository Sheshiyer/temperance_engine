import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SIGNED_PROBE_CLAIM_SCOPE,
  SIGNED_PROBE_DOES_NOT_ASSERT,
  SIGNED_PROBE_KIND,
  canonicalProbeJson,
  generateProbeChallenge,
  generateProbeKeyPairForFixture,
  loadProbeVerificationBundleFromEnv,
  probeChallengeLedgerKey,
  signProbeReceipt,
  verifySignedProbeReceipt,
  type ProbeVerificationOptions,
  type UnsignedProbeReceipt,
} from "./signed-probe-receipt";

const challenge = "ab".repeat(32);
const nowMs = Date.parse("2026-08-01T16:02:00.000Z");

function unsigned(overrides: Partial<UnsignedProbeReceipt> = {}): UnsignedProbeReceipt {
  return {
    schemaVersion: 1,
    kind: SIGNED_PROBE_KIND,
    surface: "cloudflare",
    claimScope: SIGNED_PROBE_CLAIM_SCOPE,
    disclaimerSchemaVersion: 1,
    doesNotAssert: [...SIGNED_PROBE_DOES_NOT_ASSERT],
    issuer: "temperance-probe-collector",
    keyId: "fixture-ed25519-2026-08",
    audience: "temperance-cloudflare-readiness",
    challenge,
    issuedAt: "2026-08-01T16:00:00.000Z",
    notBefore: "2026-08-01T16:00:00.000Z",
    expiresAt: "2026-08-01T16:05:00.000Z",
    payload: {
      accountId: "account-one",
      zoneId: "zone-one",
      hostname: "inference.example.com",
      tunnelId: "tunnel-one",
    },
    ...overrides,
  };
}

function options(publicKey: ProbeVerificationOptions["publicKey"], overrides: Partial<ProbeVerificationOptions> = {}): ProbeVerificationOptions {
  return {
    surface: "cloudflare",
    issuer: "temperance-probe-collector",
    keyId: "fixture-ed25519-2026-08",
    audience: "temperance-cloudflare-readiness",
    challenge,
    publicKey,
    issuedChallenges: [probeChallengeLedgerKey("fixture-ed25519-2026-08", challenge)],
    consumedChallenges: [],
    nowMs,
    ...overrides,
  };
}

describe("signed probe receipt", () => {
  test("verifies a fresh domain-bound signer-integrity receipt", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const result = verifySignedProbeReceipt(signProbeReceipt(unsigned(), privateKey), options(publicKey));
    expect(result).toEqual({
      integrityValid: true,
      signatureValid: true,
      claimBoundaryValid: true,
      challengeBound: true,
      replayState: {
        status: "open",
        observedAt: "2026-08-01T16:02:00.000Z",
        authorizing: false,
      },
      fresh: true,
      reasons: [],
    });
  });

  test("rejects payload tampering under a valid-looking signature", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const receipt = signProbeReceipt(unsigned(), privateKey);
    receipt.payload.hostname = "attacker.example.com";
    const result = verifySignedProbeReceipt(receipt, options(publicKey));
    expect(result.signatureValid).toBe(false);
    expect(result.integrityValid).toBe(false);
  });

  test("rejects cross-surface substitution even with the original signature", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const receipt = signProbeReceipt(unsigned(), privateKey);
    const result = verifySignedProbeReceipt(receipt, options(publicKey, { surface: "a2a" }));
    expect(result.reasons).toContain("surface-mismatch");
    expect(result.integrityValid).toBe(false);
    const mutated = { ...receipt, surface: "a2a" as const };
    const mutatedResult = verifySignedProbeReceipt(
      mutated,
      options(publicKey, { surface: "a2a" }),
    );
    expect(mutatedResult.signatureValid).toBe(false);

    const a2aReceipt = signProbeReceipt(
      unsigned({ surface: "a2a", audience: "temperance-a2a-readiness" }),
      privateKey,
    );
    const a2aMutated = { ...a2aReceipt, surface: "cloudflare" as const };
    const reverse = verifySignedProbeReceipt(
      a2aMutated,
      options(publicKey, { surface: "cloudflare", audience: "temperance-a2a-readiness" }),
    );
    expect(reverse.signatureValid).toBe(false);
  });

  test("rejects wrong audience, issuer, key identity, or challenge", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const receipt = signProbeReceipt(unsigned(), privateKey);
    for (const override of [
      { audience: "other-audience" },
      { issuer: "other-issuer" },
      { keyId: "other-key" },
      { challenge: "cd".repeat(32) },
    ]) {
      expect(verifySignedProbeReceipt(receipt, options(publicKey, override)).integrityValid).toBe(false);
    }
  });

  test("requires verifier-held issued state and rejects replay", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const receipt = signProbeReceipt(unsigned(), privateKey);
    const ledgerKey = probeChallengeLedgerKey("fixture-ed25519-2026-08", challenge);
    expect(verifySignedProbeReceipt(receipt, options(publicKey, { issuedChallenges: [] })).replayState.status).toBe("unissued");
    expect(
      verifySignedProbeReceipt(receipt, options(publicKey, { consumedChallenges: [ledgerKey] })).replayState.status,
    ).toBe("consumed");
  });

  test("rejects expired, not-yet-valid, and overlong receipts", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const expired = signProbeReceipt(unsigned({ expiresAt: "2026-08-01T16:01:00.000Z" }), privateKey);
    const future = signProbeReceipt(
      unsigned({
        issuedAt: "2026-08-01T16:04:00.000Z",
        notBefore: "2026-08-01T16:04:00.000Z",
        expiresAt: "2026-08-01T16:05:00.000Z",
      }),
      privateKey,
    );
    const overlong = signProbeReceipt(unsigned({ expiresAt: "2026-08-01T16:06:00.001Z" }), privateKey);
    for (const receipt of [expired, future, overlong]) {
      expect(verifySignedProbeReceipt(receipt, options(publicKey)).fresh).toBe(false);
    }
  });

  test("rejects missing, truncated, malformed, or wrong-key signatures", () => {
    const first = generateProbeKeyPairForFixture();
    const second = generateProbeKeyPairForFixture();
    const receipt = signProbeReceipt(unsigned(), first.privateKey);
    for (const candidate of [
      { ...receipt, signature: "" },
      { ...receipt, signature: receipt.signature.slice(0, -4) },
      { ...receipt, signature: `hmac-sha256:${"0".repeat(64)}` },
      {
        ...receipt,
        signature: `${receipt.signature.slice(0, 12)}${receipt.signature[12] === "A" ? "B" : "A"}${receipt.signature.slice(13)}`,
      },
    ]) {
      expect(verifySignedProbeReceipt(candidate, options(first.publicKey)).integrityValid).toBe(false);
    }
    expect(verifySignedProbeReceipt(receipt, options(second.publicKey)).signatureValid).toBe(false);
    expect(verifySignedProbeReceipt(receipt, options("" as never)).signatureValid).toBe(false);
  });

  test("cleanly rejects non-Ed25519 trusted key types", () => {
    const signer = generateProbeKeyPairForFixture();
    const receipt = signProbeReceipt(unsigned(), signer.privateKey);
    const wrongTypes = [
      generateKeyPairSync("x25519").publicKey,
      generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey,
      generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey,
    ];
    for (const publicKey of wrongTypes) {
      let result: ReturnType<typeof verifySignedProbeReceipt> | undefined;
      expect(() => {
        result = verifySignedProbeReceipt(receipt, options(publicKey));
      }).not.toThrow();
      expect(result?.signatureValid).toBe(false);
      expect(result?.integrityValid).toBe(false);
    }
    expect(verifySignedProbeReceipt(receipt, options(signer.privateKey)).signatureValid).toBe(false);
    const privatePem = signer.privateKey.export({ type: "pkcs8", format: "pem" });
    expect(verifySignedProbeReceipt(receipt, options(privatePem)).signatureValid).toBe(false);
  });

  test("enforces explicit thirty-second not-before skew boundaries", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const atBoundary = signProbeReceipt(
      unsigned({
        issuedAt: "2026-08-01T16:02:30.000Z",
        notBefore: "2026-08-01T16:02:30.000Z",
        expiresAt: "2026-08-01T16:05:00.000Z",
      }),
      privateKey,
    );
    const beyondBoundary = signProbeReceipt(
      unsigned({
        issuedAt: "2026-08-01T16:02:30.001Z",
        notBefore: "2026-08-01T16:02:30.001Z",
        expiresAt: "2026-08-01T16:05:00.000Z",
      }),
      privateKey,
    );
    expect(verifySignedProbeReceipt(atBoundary, options(publicKey)).fresh).toBe(true);
    expect(verifySignedProbeReceipt(beyondBoundary, options(publicKey)).fresh).toBe(false);
  });

  test("rejects non-canonical timestamp spellings", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const offsetTimestamp = signProbeReceipt(
      unsigned({
        issuedAt: "2026-08-01T16:00:00+00:00",
        notBefore: "2026-08-01T16:00:00+00:00",
      }),
      privateKey,
    );
    expect(verifySignedProbeReceipt(offsetTimestamp, options(publicKey)).fresh).toBe(false);
  });

  test("rejects missing disclaimers or any widened claim scope", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const missing = signProbeReceipt(unsigned({ doesNotAssert: [] }), privateKey);
    const widened = signProbeReceipt(
      unsigned({ claimScope: "resource_authority" as typeof SIGNED_PROBE_CLAIM_SCOPE }),
      privateKey,
    );
    expect(verifySignedProbeReceipt(missing, options(publicKey)).claimBoundaryValid).toBe(false);
    expect(verifySignedProbeReceipt(widened, options(publicKey)).claimBoundaryValid).toBe(false);
  });

  test("canonicalizes key order and whitespace before hashing", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const left = unsigned({ payload: { beta: [2, 3], alpha: "value" } });
    const right = unsigned({ payload: JSON.parse('{ "alpha" : "value", "beta" : [2,3] }') });
    const leftReceipt = signProbeReceipt(left, privateKey);
    const rightReceipt = signProbeReceipt(right, privateKey);
    expect(leftReceipt.signature).toBe(rightReceipt.signature);
    expect(verifySignedProbeReceipt(rightReceipt, options(publicKey)).integrityValid).toBe(true);
  });

  test("rejects Unicode normalization ambiguity and non-integer numbers", () => {
    expect(() => canonicalProbeJson({ value: "e\u0301" })).toThrow("canonical-string-invalid");
    expect(() => canonicalProbeJson({ value: 1.5 })).toThrow("canonical-number-not-safe-integer");
  });

  test("rejects oversized and over-deep canonical payloads", () => {
    expect(() => canonicalProbeJson({ value: "x".repeat(65_536) })).toThrow("canonical-byte-limit-exceeded");
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 34; index += 1) deep = { child: deep };
    expect(() => canonicalProbeJson(deep)).toThrow("canonical-depth-limit-exceeded");
    expect(() => canonicalProbeJson(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow("canonical-key-forbidden");
  });

  test("generates unique 256-bit lowercase-hex challenges", () => {
    const first = generateProbeChallenge();
    const second = generateProbeChallenge();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });

  test("rejects unsigned top-level extensions that could widen semantics", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const receipt = { ...signProbeReceipt(unsigned(), privateKey), resourceAuthority: true };
    const result = verifySignedProbeReceipt(receipt, options(publicKey));
    expect(result.reasons).toContain("receipt-missing-malformed-or-extra-fields");
    expect(result.integrityValid).toBe(false);
  });

  test("loads only public trust material from owner-only receipt and ledger files", () => {
    const root = mkdtempSync(join(tmpdir(), "temperance-probe-trust-"));
    try {
      const { privateKey, publicKey } = generateProbeKeyPairForFixture();
      const receiptPath = join(root, "receipt.json");
      const ledgerPath = join(root, "ledger.json");
      const publicKeyPath = join(root, "public.pem");
      writeFileSync(receiptPath, canonicalProbeJson(signProbeReceipt(unsigned(), privateKey)));
      writeFileSync(
        ledgerPath,
        canonicalProbeJson({
          issuedChallenges: [probeChallengeLedgerKey("fixture-ed25519-2026-08", challenge)],
          consumedChallenges: [],
        }),
      );
      writeFileSync(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }));
      chmodSync(receiptPath, 0o600);
      chmodSync(ledgerPath, 0o600);
      chmodSync(publicKeyPath, 0o644);
      const bundle = loadProbeVerificationBundleFromEnv("cloudflare", {
        TEMPERANCE_SIGNED_PROBE_RECEIPT: receiptPath,
        TEMPERANCE_SIGNED_PROBE_PUBLIC_KEY: publicKeyPath,
        TEMPERANCE_SIGNED_PROBE_LEDGER: ledgerPath,
        TEMPERANCE_SIGNED_PROBE_ISSUER: "temperance-probe-collector",
        TEMPERANCE_SIGNED_PROBE_KEY_ID: "fixture-ed25519-2026-08",
        TEMPERANCE_SIGNED_PROBE_AUDIENCE: "temperance-cloudflare-readiness",
        TEMPERANCE_SIGNED_PROBE_CHALLENGE: challenge,
        TEMPERANCE_SIGNED_PROBE_PRIVATE_KEY: "must-never-be-consumed",
      });
      expect(bundle).toBeDefined();
      expect(JSON.stringify(bundle)).not.toContain("must-never-be-consumed");
      expect(
        verifySignedProbeReceipt(bundle!.receipt, { ...bundle!.verification, nowMs }).integrityValid,
      ).toBe(true);
      writeFileSync(receiptPath, '{"a":1,"a":2}');
      chmodSync(receiptPath, 0o600);
      expect(() =>
        loadProbeVerificationBundleFromEnv("cloudflare", {
          TEMPERANCE_SIGNED_PROBE_RECEIPT: receiptPath,
          TEMPERANCE_SIGNED_PROBE_PUBLIC_KEY: publicKeyPath,
          TEMPERANCE_SIGNED_PROBE_LEDGER: ledgerPath,
          TEMPERANCE_SIGNED_PROBE_ISSUER: "temperance-probe-collector",
          TEMPERANCE_SIGNED_PROBE_KEY_ID: "fixture-ed25519-2026-08",
          TEMPERANCE_SIGNED_PROBE_AUDIENCE: "temperance-cloudflare-readiness",
          TEMPERANCE_SIGNED_PROBE_CHALLENGE: challenge,
        }),
      ).toThrow("signed-probe-json-not-canonical");
      writeFileSync(receiptPath, "x".repeat(65_537));
      expect(() =>
        loadProbeVerificationBundleFromEnv("cloudflare", {
          TEMPERANCE_SIGNED_PROBE_RECEIPT: receiptPath,
          TEMPERANCE_SIGNED_PROBE_PUBLIC_KEY: publicKeyPath,
          TEMPERANCE_SIGNED_PROBE_LEDGER: ledgerPath,
          TEMPERANCE_SIGNED_PROBE_ISSUER: "temperance-probe-collector",
          TEMPERANCE_SIGNED_PROBE_KEY_ID: "fixture-ed25519-2026-08",
          TEMPERANCE_SIGNED_PROBE_AUDIENCE: "temperance-cloudflare-readiness",
          TEMPERANCE_SIGNED_PROBE_CHALLENGE: challenge,
        }),
      ).toThrow("signed-probe-input-file-invalid-or-oversized");
      writeFileSync(receiptPath, canonicalProbeJson(signProbeReceipt(unsigned(), privateKey)));
      chmodSync(receiptPath, 0o644);
      expect(() =>
        loadProbeVerificationBundleFromEnv("cloudflare", {
          TEMPERANCE_SIGNED_PROBE_RECEIPT: receiptPath,
          TEMPERANCE_SIGNED_PROBE_PUBLIC_KEY: publicKeyPath,
          TEMPERANCE_SIGNED_PROBE_LEDGER: ledgerPath,
          TEMPERANCE_SIGNED_PROBE_ISSUER: "temperance-probe-collector",
          TEMPERANCE_SIGNED_PROBE_KEY_ID: "fixture-ed25519-2026-08",
          TEMPERANCE_SIGNED_PROBE_AUDIENCE: "temperance-cloudflare-readiness",
          TEMPERANCE_SIGNED_PROBE_CHALLENGE: challenge,
        }),
      ).toThrow("signed-probe-private-input-mode-invalid");
      expect(() =>
        loadProbeVerificationBundleFromEnv("cloudflare", {
          TEMPERANCE_SIGNED_PROBE_RECEIPT: receiptPath,
        }),
      ).toThrow("signed-probe-trust-inputs-incomplete");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("is absent from current routing promotion inputs and call sites", () => {
    const promotion = readFileSync(join(import.meta.dir, "omniroute-promotion.ts"), "utf8");
    const router = readFileSync(join(import.meta.dir, "multi-backend-router.sh"), "utf8");
    for (const source of [promotion, router]) {
      expect(source).not.toContain("SIGNED_PROBE");
      expect(source).not.toContain("signed-probe-receipt");
      expect(source).not.toContain("TEMPERANCE_SIGNED_PROBE");
    }
    const replayReferences = spawnSync(
      "rg",
      [
        "-l",
        "replayState",
        ".",
        "--glob",
        "*.ts",
        "--glob",
        "!package/router/signed-probe-receipt.ts",
        "--glob",
        "!package/router/signed-probe-receipt.test.ts",
        "--glob",
        "!package/router/signed-probe-challenge-ledger.test.ts",
      ],
      { cwd: join(import.meta.dir, "../.."), encoding: "utf8" },
    );
    expect([0, 1]).toContain(replayReferences.status);
    expect(replayReferences.stdout.trim()).toBe("");
    expect(readFileSync(join(import.meta.dir, "signed-probe-receipt.ts"), "utf8")).toContain("writeUInt32BE(body.byteLength");
  });
});
