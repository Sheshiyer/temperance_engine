import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  evaluateCloudflareReadiness,
  validHostname,
  type WranglerWhoami,
} from "../scripts/omniroute-cloudflare-readiness";
import {
  SIGNED_PROBE_CLAIM_SCOPE,
  SIGNED_PROBE_DOES_NOT_ASSERT,
  SIGNED_PROBE_KIND,
  generateProbeKeyPairForFixture,
  probeChallengeLedgerKey,
  signProbeReceipt,
  type UnsignedProbeReceipt,
} from "../package/router/signed-probe-receipt";

const ROOT = resolve(import.meta.dir, "..");
const SCRIPT = join(ROOT, "scripts", "omniroute-cloudflare-readiness.ts");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function whoami(permissions: string[], accounts = [{ id: "account-one" }]): WranglerWhoami {
  return {
    loggedIn: true,
    authType: "OAuth Token",
    accounts,
    tokenPermissions: permissions,
  };
}

const fullPermissions = [
  "connectivity:admin",
  "dns:write",
  "access:apps_and_policies:write",
  "access:service_tokens:write",
  "access:mtls_certificates:write",
];

const probeChallenge = "12".repeat(32);

function cloudflareProbe(method = "GET"): UnsignedProbeReceipt {
  return {
    schemaVersion: 1,
    kind: SIGNED_PROBE_KIND,
    surface: "cloudflare",
    claimScope: SIGNED_PROBE_CLAIM_SCOPE,
    disclaimerSchemaVersion: 1,
    doesNotAssert: [...SIGNED_PROBE_DOES_NOT_ASSERT],
    issuer: "temperance-cloudflare-collector",
    keyId: "cloudflare-fixture-key",
    audience: "temperance-cloudflare-readiness",
    challenge: probeChallenge,
    issuedAt: "2026-08-01T16:00:00.000Z",
    notBefore: "2026-08-01T16:00:00.000Z",
    expiresAt: "2026-08-01T16:05:00.000Z",
    payload: {
      accountId: "account-one",
      zoneId: "zone-one",
      hostname: "inference.example.com",
      tunnelId: "tunnel-one",
      endpointsTouched: [
        { method, path: "/user/tokens/verify" },
        { method, path: "/zones/zone-one" },
        { method, path: "/accounts/account-one/cfd_tunnel/tunnel-one" },
      ],
    },
  };
}

describe("Cloudflare readiness evaluator", () => {
  test("distinguishes authenticated connector access from deploy readiness", () => {
    const result = evaluateCloudflareReadiness(whoami(["connectivity:admin", "zone:read", "ssl_certs:write"]));
    expect(result.authenticated).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.gates.tunnelWrite.ready).toBe(true);
    expect(result.gates.dnsWrite.reason).toBe("dns_write_missing");
    expect(result.gates.accessPolicyWrite.reason).toBe("access_policy_write_missing");
    expect(result.gates.machineIdentityWrite.reason).toBe("machine_auth_unselected");
    expect(result.gates.hostname.reason).toBe("hostname_missing");
  });

  test("permission labels can pass while resource-scoped authority remains unproven", () => {
    const result = evaluateCloudflareReadiness(whoami(fullPermissions), {
      hostname: "inference.example.com",
      machineAuth: "service-token",
      evidenceSource: "live-wrangler",
    });
    expect(result.permissionClaimsPass).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.gates.liveEvidence.ready).toBe(true);
    expect(result.gates.resourceScope.reason).toBe("token_resource_scope_unobservable");
    expect(result.gates.hostnameZoneAuthority.reason).toBe("hostname_zone_authority_unverified");
  });

  test("fails closed when scopes are unobservable", () => {
    const result = evaluateCloudflareReadiness(
      { loggedIn: true, authType: "API Token", accounts: [{ id: "account-one" }] },
      { hostname: "inference.example.com", machineAuth: "service-token" },
    );
    expect(result.ready).toBe(false);
    expect(result.permissionsObservable).toBe(false);
    expect(result.gates.tunnelWrite.reason).toBe("permissions_unobservable");
  });

  test("requires an explicit account when multiple are visible", () => {
    const accounts = [{ id: "account-one" }, { id: "account-two" }];
    expect(
      evaluateCloudflareReadiness(whoami(fullPermissions, accounts), {
        hostname: "inference.example.com",
        machineAuth: "service-token",
      }).accountSelection,
    ).toBe("ambiguous");
    expect(
      evaluateCloudflareReadiness(whoami(fullPermissions, accounts), {
        accountId: "account-two",
        hostname: "inference.example.com",
        machineAuth: "service-token",
      }).accountSelection,
    ).toBe("explicit");
  });

  test("rejects URLs, wildcards, ports, uppercase, localhost, and IPs", () => {
    expect(validHostname("inference.example.com")).toBe(true);
    for (const value of [
      "https://inference.example.com",
      "*.example.com",
      "example.com:443",
      "Inference.example.com",
      "localhost",
      "127.0.0.1",
    ]) {
      expect(validHostname(value)).toBe(false);
    }
  });

  test("CLI invokes only wrangler whoami --json and redacts identity fields", () => {
    const root = mkdtempSync(join(tmpdir(), "temperance-cloudflare-ready-"));
    temporaryRoots.push(root);
    const fakeWrangler = join(root, "wrangler");
    const log = join(root, "args.txt");
    writeFileSync(
      fakeWrangler,
      `#!/bin/sh
printf '%s\n' "$@" > "$WRANGLER_LOG"
printf '%s\n' '{"loggedIn":true,"authType":"OAuth Token","email":"operator@example.test","accounts":[{"id":"sensitive-account-id","name":"Sensitive Account"}],"tokenPermissions":["connectivity:admin","dns:write","access:apps_and_policies:write","access:service_tokens:write"]}'
`,
    );
    chmodSync(fakeWrangler, 0o755);
    const result = spawnSync(
      "bun",
      [SCRIPT, "--wrangler-bin", fakeWrangler, "--hostname", "inference.example.com", "--machine-auth", "service-token"],
      { cwd: ROOT, encoding: "utf8", env: { ...process.env, WRANGLER_LOG: log } },
    );
    expect(result.status).toBe(3);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["whoami", "--json"]);
    expect(result.stdout).not.toContain("operator@example.test");
    expect(result.stdout).not.toContain("sensitive-account-id");
    expect(result.stdout).not.toContain("Sensitive Account");
    const output = JSON.parse(result.stdout);
    expect(output.permissionClaimsPass).toBe(true);
    expect(output.ready).toBe(false);
    expect(output.evidenceSource).toBe("live-wrangler");
  });

  test("CLI distinguishes incomplete signed trust inputs as evidence error exit 2", () => {
    const root = mkdtempSync(join(tmpdir(), "temperance-cloudflare-trust-error-"));
    temporaryRoots.push(root);
    const fixture = join(root, "whoami.json");
    const receipt = join(root, "receipt.json");
    writeFileSync(fixture, JSON.stringify(whoami(fullPermissions)));
    writeFileSync(receipt, "{}\n");
    chmodSync(receipt, 0o600);
    const result = spawnSync("bun", [SCRIPT, "--whoami-file", fixture], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, TEMPERANCE_SIGNED_PROBE_RECEIPT: receipt },
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("signed-probe-trust-inputs-incomplete");
  });

  test("a fixture can never masquerade as live or zone-bound authority", () => {
    const result = evaluateCloudflareReadiness(whoami(fullPermissions), {
      hostname: "inference.example.com",
      machineAuth: "service-token",
      evidenceSource: "fixture",
    });
    expect(result.permissionClaimsPass).toBe(true);
    expect(result.gates.liveEvidence.reason).toBe("fixture_not_live_evidence");
    expect(result.gates.resourceScope.ready).toBe(false);
    expect(result.gates.hostnameZoneAuthority.ready).toBe(false);
    expect(result.ready).toBe(false);
  });

  test("signed exact GET bindings prove integrity without proving Cloudflare authority", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const receipt = signProbeReceipt(cloudflareProbe(), privateKey);
    const result = evaluateCloudflareReadiness(whoami(fullPermissions), {
      hostname: "inference.example.com",
      zoneId: "zone-one",
      tunnelId: "tunnel-one",
      machineAuth: "service-token",
      evidenceSource: "live-wrangler",
      signedProbeReceipt: receipt,
      probeVerification: {
        surface: "cloudflare",
        issuer: "temperance-cloudflare-collector",
        keyId: "cloudflare-fixture-key",
        audience: "temperance-cloudflare-readiness",
        challenge: probeChallenge,
        publicKey,
        issuedChallenges: [probeChallengeLedgerKey("cloudflare-fixture-key", probeChallenge)],
        consumedChallenges: [],
        nowMs: Date.parse("2026-08-01T16:02:00.000Z"),
      },
    });
    expect(result.permissionClaimsPass).toBe(true);
    expect(result.signedProbeState).toBe("integrity-only");
    expect(result.signedProbeIntegrity).toBe(true);
    expect(result.signedProbeBindingsValid).toBe(true);
    expect(result.gates.readOnlyProbe.ready).toBe(true);
    expect(result.gates.resourceScope.ready).toBe(false);
    expect(result.gates.hostnameZoneAuthority.ready).toBe(false);
    expect(result.ready).toBe(false);
  });

  test("a signed non-GET probe cannot satisfy the read-only binding gate", () => {
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const receipt = signProbeReceipt(cloudflareProbe("POST"), privateKey);
    const result = evaluateCloudflareReadiness(whoami(fullPermissions), {
      hostname: "inference.example.com",
      zoneId: "zone-one",
      tunnelId: "tunnel-one",
      machineAuth: "service-token",
      signedProbeReceipt: receipt,
      probeVerification: {
        surface: "cloudflare",
        issuer: "temperance-cloudflare-collector",
        keyId: "cloudflare-fixture-key",
        audience: "temperance-cloudflare-readiness",
        challenge: probeChallenge,
        publicKey,
        issuedChallenges: [probeChallengeLedgerKey("cloudflare-fixture-key", probeChallenge)],
        consumedChallenges: [],
        nowMs: Date.parse("2026-08-01T16:02:00.000Z"),
      },
    });
    expect(result.signedProbeIntegrity).toBe(true);
    expect(result.gates.signedProbeBindings.ready).toBe(true);
    expect(result.gates.readOnlyProbe.reason).toBe("signed_probe_non_get_or_missing_endpoints");
    expect(result.signedProbeBindingsValid).toBe(false);
    expect(result.ready).toBe(false);
  });
});
