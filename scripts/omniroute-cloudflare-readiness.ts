#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  loadProbeVerificationBundleFromEnv,
  verifySignedProbeReceipt,
  type ProbeVerificationOptions,
  type SignedProbeReceipt,
} from "../package/router/signed-probe-receipt";

export type MachineAuth = "service-token" | "mtls";

export interface WranglerWhoami {
  loggedIn?: boolean;
  authType?: string;
  accounts?: Array<{ id?: string }>;
  tokenPermissions?: string[];
}

export interface CloudflareReadinessOptions {
  accountId?: string;
  hostname?: string;
  zoneId?: string;
  tunnelId?: string;
  machineAuth?: MachineAuth;
  evidenceSource?: "live-wrangler" | "fixture";
  signedProbeReceipt?: SignedProbeReceipt;
  probeVerification?: ProbeVerificationOptions;
}

export interface ReadinessGate {
  ready: boolean;
  reason: string;
}

export interface CloudflareReadiness {
  schemaVersion: 1;
  kind: "temperance.cloudflare.readiness";
  mode: "read-only";
  ready: false;
  permissionClaimsPass: boolean;
  evidenceSource: "live-wrangler" | "fixture";
  signedProbeState: "absent" | "invalid" | "integrity-only";
  signedProbeIntegrity: boolean;
  signedProbeBindingsValid: boolean;
  authenticated: boolean;
  authType: string | null;
  accountCount: number;
  accountSelection: "none" | "single" | "explicit" | "ambiguous" | "not-found";
  hostname: string | null;
  machineAuth: MachineAuth | null;
  permissionsObservable: boolean;
  gates: {
    authentication: ReadinessGate;
    account: ReadinessGate;
    hostname: ReadinessGate;
    tunnelWrite: ReadinessGate;
    dnsWrite: ReadinessGate;
    accessPolicyWrite: ReadinessGate;
    machineIdentityWrite: ReadinessGate;
    liveEvidence: ReadinessGate;
    signedProbeIntegrity: ReadinessGate;
    signedProbeBindings: ReadinessGate;
    readOnlyProbe: ReadinessGate;
    resourceScope: ReadinessGate;
    hostnameZoneAuthority: ReadinessGate;
  };
  blockers: string[];
}

const PERMISSION_ALIASES = {
  tunnelWrite: new Set([
    "connectivity:admin",
    "cloudflare_tunnel:write",
    "cloudflare_one_connectors:write",
    "cloudflared:write",
  ]),
  dnsWrite: new Set(["dns:write", "zone_dns:write"]),
  accessPolicyWrite: new Set([
    "access:apps_and_policies:write",
    "access_apps_and_policies:write",
  ]),
  serviceTokenWrite: new Set([
    "access:service_tokens:write",
    "access_service_tokens:write",
  ]),
  mtlsWrite: new Set([
    "access:mtls_certificates:write",
    "access_mtls_certificates:write",
  ]),
} as const;

function permissionPresent(permissions: Set<string>, aliases: Set<string>): boolean {
  return [...aliases].some((permission) => permissions.has(permission));
}

function probePayloadState(
  receipt: SignedProbeReceipt | undefined,
  integrityValid: boolean,
  expected: { accountId?: string; zoneId?: string; hostname?: string; tunnelId?: string },
): { bindingsValid: boolean; readOnly: boolean; bindingReason: string; readOnlyReason: string } {
  if (!receipt) {
    return {
      bindingsValid: false,
      readOnly: false,
      bindingReason: "signed_probe_missing",
      readOnlyReason: "signed_probe_missing",
    };
  }
  if (!integrityValid) {
    return {
      bindingsValid: false,
      readOnly: false,
      bindingReason: "signed_probe_integrity_invalid",
      readOnlyReason: "signed_probe_integrity_invalid",
    };
  }
  const payload = receipt.payload;
  const endpoints = Array.isArray(payload.endpointsTouched) ? payload.endpointsTouched : [];
  const readOnly =
    endpoints.length > 0 &&
    endpoints.every(
      (endpoint) =>
        Boolean(endpoint) &&
        typeof endpoint === "object" &&
        !Array.isArray(endpoint) &&
        (endpoint as Record<string, unknown>).method === "GET" &&
        typeof (endpoint as Record<string, unknown>).path === "string" &&
        String((endpoint as Record<string, unknown>).path).startsWith("/"),
    );
  const expectationsComplete = Boolean(expected.accountId && expected.zoneId && expected.hostname && expected.tunnelId);
  const bindingsValid =
    expectationsComplete &&
    payload.accountId === expected.accountId &&
    payload.zoneId === expected.zoneId &&
    payload.hostname === expected.hostname &&
    payload.tunnelId === expected.tunnelId;
  return {
    bindingsValid,
    readOnly,
    bindingReason: bindingsValid ? "signed_probe_exact_resource_bindings" : "signed_probe_resource_binding_mismatch",
    readOnlyReason: readOnly ? "signed_probe_get_only" : "signed_probe_non_get_or_missing_endpoints",
  };
}

export function validHostname(value?: string): boolean {
  if (!value || value !== value.toLowerCase() || value.length > 253) return false;
  if (value.includes("://") || value.includes("/") || value.includes(":") || value.includes("*")) return false;
  if (!value.includes(".")) return false;
  const labels = value.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false;
  if (labels.every((label) => /^\d+$/.test(label))) return false;
  return value !== "localhost";
}

export function evaluateCloudflareReadiness(
  whoami: WranglerWhoami,
  options: CloudflareReadinessOptions = {},
): CloudflareReadiness {
  const accounts = Array.isArray(whoami.accounts) ? whoami.accounts : [];
  const authenticated = whoami.loggedIn === true;
  const permissionsObservable = Array.isArray(whoami.tokenPermissions);
  const permissions = new Set(permissionsObservable ? whoami.tokenPermissions : []);

  let accountSelection: CloudflareReadiness["accountSelection"];
  if (options.accountId) {
    accountSelection = accounts.some((account) => account.id === options.accountId) ? "explicit" : "not-found";
  } else if (accounts.length === 1) {
    accountSelection = "single";
  } else if (accounts.length === 0) {
    accountSelection = "none";
  } else {
    accountSelection = "ambiguous";
  }

  const accountReady = accountSelection === "single" || accountSelection === "explicit";
  const hostnameReady = validHostname(options.hostname);
  const tunnelReady = permissionsObservable && permissionPresent(permissions, PERMISSION_ALIASES.tunnelWrite);
  const dnsReady = permissionsObservable && permissionPresent(permissions, PERMISSION_ALIASES.dnsWrite);
  const accessReady = permissionsObservable && permissionPresent(permissions, PERMISSION_ALIASES.accessPolicyWrite);
  const identityReady =
    options.machineAuth === "service-token"
      ? permissionsObservable && permissionPresent(permissions, PERMISSION_ALIASES.serviceTokenWrite)
      : options.machineAuth === "mtls"
        ? permissionsObservable && permissionPresent(permissions, PERMISSION_ALIASES.mtlsWrite)
        : false;
  const evidenceSource = options.evidenceSource ?? "fixture";
  const signedProbeReceipt = options.signedProbeReceipt;
  const signedProbeVerification =
    signedProbeReceipt && options.probeVerification
      ? verifySignedProbeReceipt(signedProbeReceipt, {
          ...options.probeVerification,
          surface: "cloudflare",
        })
      : null;
  const signedProbeIntegrity = signedProbeVerification?.integrityValid === true;
  const expectedAccountId =
    accountSelection === "explicit"
      ? options.accountId
      : accountSelection === "single"
        ? accounts[0]?.id
        : undefined;
  const probePayload = probePayloadState(signedProbeReceipt, signedProbeIntegrity, {
    accountId: expectedAccountId,
    zoneId: options.zoneId,
    hostname: options.hostname,
    tunnelId: options.tunnelId,
  });

  const gates: CloudflareReadiness["gates"] = {
    authentication: {
      ready: authenticated,
      reason: authenticated ? "wrangler_authenticated" : "wrangler_not_authenticated",
    },
    account: {
      ready: accountReady,
      reason: accountReady ? `account_${accountSelection}` : `account_${accountSelection}`,
    },
    hostname: {
      ready: hostnameReady,
      reason: hostnameReady ? "hostname_valid" : options.hostname ? "hostname_invalid" : "hostname_missing",
    },
    tunnelWrite: {
      ready: tunnelReady,
      reason: tunnelReady
        ? "tunnel_write_observed"
        : permissionsObservable
          ? "tunnel_write_missing"
          : "permissions_unobservable",
    },
    dnsWrite: {
      ready: dnsReady,
      reason: dnsReady ? "dns_write_observed" : permissionsObservable ? "dns_write_missing" : "permissions_unobservable",
    },
    accessPolicyWrite: {
      ready: accessReady,
      reason: accessReady
        ? "access_policy_write_observed"
        : permissionsObservable
          ? "access_policy_write_missing"
          : "permissions_unobservable",
    },
    machineIdentityWrite: {
      ready: identityReady,
      reason: identityReady
        ? `${options.machineAuth}_write_observed`
        : !options.machineAuth
          ? "machine_auth_unselected"
          : permissionsObservable
            ? `${options.machineAuth}_write_missing`
            : "permissions_unobservable",
    },
    liveEvidence: {
      ready: evidenceSource === "live-wrangler",
      reason: evidenceSource === "live-wrangler" ? "live_wrangler_invocation" : "fixture_not_live_evidence",
    },
    signedProbeIntegrity: {
      ready: signedProbeIntegrity,
      reason: !signedProbeReceipt
        ? "signed_probe_missing"
        : !options.probeVerification
          ? "signed_probe_trust_config_missing"
          : signedProbeIntegrity
            ? "signed_probe_integrity_valid"
            : `signed_probe_invalid:${signedProbeVerification?.reasons.join(",") || "unknown"}`,
    },
    signedProbeBindings: {
      ready: probePayload.bindingsValid,
      reason: probePayload.bindingReason,
    },
    readOnlyProbe: {
      ready: probePayload.readOnly,
      reason: probePayload.readOnlyReason,
    },
    resourceScope: {
      ready: false,
      reason: signedProbeIntegrity
        ? "signed_probe_does_not_assert_resource_authority"
        : "token_resource_scope_unobservable",
    },
    hostnameZoneAuthority: {
      ready: false,
      reason: signedProbeIntegrity
        ? "independent_hostname_zone_authority_unverified"
        : "hostname_zone_authority_unverified",
    },
  };

  const permissionClaimsPass = [
    gates.authentication,
    gates.account,
    gates.hostname,
    gates.tunnelWrite,
    gates.dnsWrite,
    gates.accessPolicyWrite,
    gates.machineIdentityWrite,
  ].every((gate) => gate.ready);
  const blockers = Object.entries(gates)
    .filter(([, gate]) => !gate.ready)
    .map(([name, gate]) => `${name}:${gate.reason}`);

  return {
    schemaVersion: 1,
    kind: "temperance.cloudflare.readiness",
    mode: "read-only",
    ready: false,
    permissionClaimsPass,
    evidenceSource,
    signedProbeState: !signedProbeReceipt ? "absent" : signedProbeIntegrity ? "integrity-only" : "invalid",
    signedProbeIntegrity,
    signedProbeBindingsValid: signedProbeIntegrity && probePayload.bindingsValid && probePayload.readOnly,
    authenticated,
    authType: typeof whoami.authType === "string" ? whoami.authType : null,
    accountCount: accounts.length,
    accountSelection,
    hostname: options.hostname ?? null,
    machineAuth: options.machineAuth ?? null,
    permissionsObservable,
    gates,
    blockers,
  };
}

interface CliOptions extends CloudflareReadinessOptions {
  whoamiFile?: string;
  wranglerBin: string;
}

function usage(): never {
  console.error(`Usage: bun scripts/omniroute-cloudflare-readiness.ts [options]

Read-only options:
  --whoami-file PATH              Evaluate a saved wrangler whoami fixture
  --wrangler-bin PATH             Wrangler binary (default: wrangler)
  --account-id ID                 Select one account when multiple are visible
  --hostname NAME                 Proposed Cloudflare-owned inference hostname
  --zone-id ID                    Expected Cloudflare zone identifier
  --tunnel-id ID                  Expected named-tunnel identifier
  --machine-auth service-token|mtls

Optional signed-probe trust inputs are read from TEMPERANCE_SIGNED_PROBE_*
environment variables; no signing key is accepted by this verifier.
  -h, --help`);
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    wranglerBin: process.env.TEMPERANCE_WRANGLER_BIN || "wrangler",
    whoamiFile: process.env.TEMPERANCE_CLOUDFLARE_WHOAMI_FILE,
    accountId: process.env.TEMPERANCE_CLOUDFLARE_ACCOUNT_ID,
    hostname: process.env.TEMPERANCE_CLOUDFLARE_HOSTNAME,
    zoneId: process.env.TEMPERANCE_CLOUDFLARE_ZONE_ID,
    tunnelId: process.env.TEMPERANCE_CLOUDFLARE_TUNNEL_ID,
    machineAuth: process.env.TEMPERANCE_CLOUDFLARE_MACHINE_AUTH as MachineAuth | undefined,
  };
  const value = (flag: string, index: number): string => {
    const next = argv[index + 1];
    if (!next) throw new Error(`${flag} requires a value`);
    return next;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--whoami-file":
        options.whoamiFile = value(arg, index++);
        break;
      case "--wrangler-bin":
        options.wranglerBin = value(arg, index++);
        break;
      case "--account-id":
        options.accountId = value(arg, index++);
        break;
      case "--hostname":
        options.hostname = value(arg, index++);
        break;
      case "--zone-id":
        options.zoneId = value(arg, index++);
        break;
      case "--tunnel-id":
        options.tunnelId = value(arg, index++);
        break;
      case "--machine-auth": {
        const selected = value(arg, index++);
        if (selected !== "service-token" && selected !== "mtls") throw new Error("invalid --machine-auth");
        options.machineAuth = selected;
        break;
      }
      case "-h":
      case "--help":
        usage();
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (options.machineAuth && options.machineAuth !== "service-token" && options.machineAuth !== "mtls") {
    throw new Error("invalid TEMPERANCE_CLOUDFLARE_MACHINE_AUTH");
  }
  return options;
}

function loadWhoami(options: CliOptions): WranglerWhoami {
  if (options.whoamiFile) return JSON.parse(readFileSync(options.whoamiFile, "utf8"));
  const result = spawnSync(options.wranglerBin, ["whoami", "--json"], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("wrangler whoami --json failed");
  return JSON.parse(result.stdout);
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    options.evidenceSource = options.whoamiFile ? "fixture" : "live-wrangler";
    const signedProbe = loadProbeVerificationBundleFromEnv("cloudflare");
    options.signedProbeReceipt = signedProbe?.receipt;
    options.probeVerification = signedProbe?.verification;
    const readiness = evaluateCloudflareReadiness(loadWhoami(options), options);
    process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);
    process.exitCode = 3;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
