#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  loadProbeVerificationBundleFromEnv,
  verifySignedProbeReceipt,
  type ProbeVerificationOptions,
  type SignedProbeReceipt,
} from "../package/router/signed-probe-receipt";

export interface A2AProbeReceipt {
  schemaVersion?: number;
  packageVersion?: string;
  sourceDigest?: string;
  issuedAt?: string;
  expiresAt?: string;
  serverInstanceId?: string;
  promotionClaim?: boolean;
  humanSignoffRequired?: boolean;
  checks?: Record<string, boolean>;
}

export interface A2AGate {
  ready: boolean;
  reason: string;
}

export interface A2AReadiness {
  schemaVersion: 1;
  kind: "temperance.a2a.readiness";
  mode: "read-only";
  packageVersion: string | null;
  sourceDigest: string | null;
  sourceIndicatorsPass: boolean;
  receiptClaimsValid: boolean;
  signedProbeState: "absent" | "invalid" | "integrity-only";
  signedProbeIntegrity: boolean;
  signedProbeBindingsValid: boolean;
  safetyEvidenceState: "pass" | "fail" | "indeterminate";
  sourceReady: false;
  liveReceiptReady: false;
  technicalReady: false;
  promotionAuthorized: false;
  promotionReady: boolean;
  gates: Record<string, A2AGate>;
  blockers: string[];
  promotionBlockers: string[];
}

export interface A2AReadinessOptions {
  now?: Date;
  receiptMode?: number;
  signedProbeReceipt?: SignedProbeReceipt;
  probeVerification?: ProbeVerificationOptions;
  expectedServerInstanceId?: string;
}

const ROUTES = {
  rpc: { entry: "dist/.build/next/server/app/a2a/route.js", page: "/a2a/route" },
  status: { entry: "dist/.build/next/server/app/api/a2a/status/route.js", page: "/api/a2a/status/route" },
  tasks: { entry: "dist/.build/next/server/app/api/a2a/tasks/route.js", page: "/api/a2a/tasks/route" },
  task: { entry: "dist/.build/next/server/app/api/a2a/tasks/[id]/route.js", page: "/api/a2a/tasks/[id]/route" },
  cancel: {
    entry: "dist/.build/next/server/app/api/a2a/tasks/[id]/cancel/route.js",
    page: "/api/a2a/tasks/[id]/cancel/route",
  },
} as const;

const LIVE_CHECKS = [
  "anonymousDenied",
  "invalidBearerDenied",
  "authenticatedCapabilitiesBounded",
  "forbiddenSkillDenied",
  "cliCreateSucceeded",
  "crossPrincipalReadDenied",
  "crossPrincipalCancelDenied",
] as const;

const SAFETY_EVIDENCE_CHECKS = [
  "declaredCapabilitiesBounded",
  "timeoutObserved",
  "idempotencyVerified",
  "errorTaxonomyConformant",
] as const;

function readOptional(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function loadRouteSource(packageRoot: string, entryRelative: string, page: string): string {
  const entryPath = join(packageRoot, entryRelative);
  const entry = readOptional(entryPath);
  if (!entry) return "";
  const chunks: string[] = [];
  for (const match of entry.matchAll(/R\.c\("([^"]+)"\)/g)) {
    const chunk = readOptional(join(packageRoot, "dist/.build/next", match[1]));
    if (chunk.includes(`page:"${page}"`) || chunk.includes(`page: "${page}"`)) chunks.push(chunk);
  }
  return [entry, ...chunks].join("\n");
}

function hasScopedGuard(source: string): boolean {
  return (
    /authorization/i.test(source) &&
    /Bearer/i.test(source) &&
    /authenticateA2ARequest\s*\(/.test(source) &&
    /requiredScopes?\s*:\s*\[[^\]]*["']a2a["']/.test(source) &&
    !/process\.env\.(?:OMNIROUTE_API_KEY|ROUTER_API_KEY)/.test(source)
  );
}

function supportsPostCreate(source: string): boolean {
  return (
    (/(?:export\s+async\s+function\s+POST|e\.s\(\["POST")/.test(source) || /method\s*:\s*["']POST["']/.test(source)) &&
    /tasks\.create/.test(source)
  );
}

function digestSources(sources: Record<string, string>): string | null {
  if (Object.values(sources).some((source) => !source)) return null;
  const hash = createHash("sha256");
  for (const key of Object.keys(sources).sort()) hash.update(`${key}\0${sources[key]}\0`);
  return hash.digest("hex");
}

function signedProbePayloadState(
  receipt: SignedProbeReceipt | undefined,
  integrityValid: boolean,
  expected: { packageVersion: string | null; sourceDigest: string | null; serverInstanceId?: string },
): { bindingsValid: boolean; safetyState: A2AReadiness["safetyEvidenceState"]; bindingReason: string; safetyReason: string } {
  if (!receipt) {
    return {
      bindingsValid: false,
      safetyState: "indeterminate",
      bindingReason: "signed_probe_missing",
      safetyReason: "signed_safety_evidence_missing",
    };
  }
  if (!integrityValid) {
    return {
      bindingsValid: false,
      safetyState: "fail",
      bindingReason: "signed_probe_integrity_invalid",
      safetyReason: "signed_probe_integrity_invalid",
    };
  }
  const payload = receipt.payload;
  const bindingsValid =
    Boolean(expected.packageVersion && expected.sourceDigest && expected.serverInstanceId) &&
    payload.packageVersion === expected.packageVersion &&
    payload.sourceDigest === expected.sourceDigest &&
    payload.serverInstanceId === expected.serverInstanceId &&
    payload.isolatedInstance === true;
  const checks = payload.checks;
  const safetyEvidence = payload.safetyEvidence;
  const checksRecord = checks && typeof checks === "object" && !Array.isArray(checks) ? checks as Record<string, unknown> : null;
  const safetyRecord =
    safetyEvidence && typeof safetyEvidence === "object" && !Array.isArray(safetyEvidence)
      ? safetyEvidence as Record<string, unknown>
      : null;
  const hasAllSafetyFields = Boolean(
    safetyRecord && SAFETY_EVIDENCE_CHECKS.every((check) => typeof safetyRecord[check] === "boolean"),
  );
  const allSafetyPass = Boolean(
    hasAllSafetyFields &&
    safetyRecord &&
    SAFETY_EVIDENCE_CHECKS.every((check) => safetyRecord[check] === true) &&
    checksRecord &&
    LIVE_CHECKS.every((check) => checksRecord[check] === true),
  );
  const safetyState: A2AReadiness["safetyEvidenceState"] = !hasAllSafetyFields
    ? "indeterminate"
    : allSafetyPass
      ? "pass"
      : "fail";
  return {
    bindingsValid,
    safetyState,
    bindingReason: bindingsValid ? "signed_probe_exact_instance_bindings" : "signed_probe_instance_binding_mismatch",
    safetyReason:
      safetyState === "pass"
        ? "signed_safety_claims_complete"
        : safetyState === "fail"
          ? "signed_safety_claims_failed"
          : "signed_safety_evidence_missing",
  };
}

export function evaluateA2AReadiness(
  packageRoot: string,
  receipt?: A2AProbeReceipt,
  options: A2AReadinessOptions = {},
): A2AReadiness {
  const root = resolve(packageRoot);
  const routeSources = Object.fromEntries(
    Object.entries(ROUTES).map(([name, route]) => [name, loadRouteSource(root, route.entry, route.page)]),
  );
  const packageJsonSource = readOptional(join(root, "package.json"));
  const apiKeysSource = readOptional(join(root, "src/lib/db/apiKeys.ts"));
  const taskManagerSource = readOptional(join(root, "src/lib/a2a/taskManager.ts"));
  const cliSource = readOptional(join(root, "bin/cli/commands/a2a.mjs"));
  let packageVersion: string | null = null;
  try {
    packageVersion = packageJsonSource ? JSON.parse(packageJsonSource).version ?? null : null;
  } catch {
    packageVersion = null;
  }

  const digestInput = {
    ...routeSources,
    apiKeys: apiKeysSource,
    taskManager: taskManagerSource,
    cli: cliSource,
  };
  const sourceDigest = digestSources(digestInput);
  const allSourcesPresent = sourceDigest !== null && packageVersion !== null;
  const rpcGuarded = hasScopedGuard(routeSources.rpc);
  const taskRoutesGuarded = ["status", "tasks", "task", "cancel"].every((name) => hasScopedGuard(routeSources[name]));
  const ambientManageAbsent =
    !/process\.env\.(?:OMNIROUTE_API_KEY|ROUTER_API_KEY)/.test(routeSources.rpc) &&
    !/scopes\s*:\s*\[\s*["']manage["']\s*\]/.test(apiKeysSource);
  const ownerBound =
    /assertTaskOwner\s*\(/.test(taskManagerSource) &&
    /(?:ownerId|principalId|subjectId)/.test(taskManagerSource);
  const allowlistBounded =
    /(?:A2A_ALLOWED_SKILLS|allowedSkills|skillAllowlist)/.test(routeSources.rpc) &&
    /(?:Unknown skill|forbidden skill|not allowed)/i.test(routeSources.rpc);
  const cliWantsCreate = /tasks\.create/.test(cliSource) && /\/api\/a2a\/tasks/.test(cliSource) && /method\s*:\s*["']POST["']/.test(cliSource);
  const createCoherent = cliWantsCreate && supportsPostCreate(routeSources.tasks);

  const receiptChecks = receipt?.checks ?? {};
  const now = options.now ?? new Date();
  const issuedAt = receipt?.issuedAt ? Date.parse(receipt.issuedAt) : Number.NaN;
  const expiresAt = receipt?.expiresAt ? Date.parse(receipt.expiresAt) : Number.NaN;
  const receiptLifetime = expiresAt - issuedAt;
  const receiptClaimsValid =
    receipt?.schemaVersion === 1 &&
    receipt.packageVersion === packageVersion &&
    receipt.sourceDigest === sourceDigest &&
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    issuedAt <= now.getTime() &&
    expiresAt > now.getTime() &&
    receiptLifetime > 0 &&
    receiptLifetime <= 300_000 &&
    options.receiptMode === 0o600 &&
    typeof receipt.serverInstanceId === "string" &&
    receipt.serverInstanceId.length > 0 &&
    receipt.promotionClaim === false &&
    receipt.humanSignoffRequired === true &&
    LIVE_CHECKS.every((check) => receiptChecks[check] === true);

  const signedProbeReceipt = options.signedProbeReceipt;
  const signedProbeVerification =
    signedProbeReceipt && options.probeVerification
      ? verifySignedProbeReceipt(signedProbeReceipt, {
          ...options.probeVerification,
          surface: "a2a",
        })
      : null;
  const signedProbeIntegrity = signedProbeVerification?.integrityValid === true;
  const signedProbePayload = signedProbePayloadState(signedProbeReceipt, signedProbeIntegrity, {
    packageVersion,
    sourceDigest,
    serverInstanceId: options.expectedServerInstanceId,
  });

  const gates: Record<string, A2AGate> = {
    sources: { ready: allSourcesPresent, reason: allSourcesPresent ? "sources_complete" : "sources_missing_or_invalid" },
    rpcScopedPrincipal: {
      ready: rpcGuarded,
      reason: rpcGuarded ? "rpc_scoped_principal" : "rpc_scoped_principal_missing",
    },
    taskRoutesScopedPrincipal: {
      ready: taskRoutesGuarded,
      reason: taskRoutesGuarded ? "task_routes_scoped_principal" : "task_route_guard_missing",
    },
    ambientManagePrincipalAbsent: {
      ready: ambientManageAbsent,
      reason: ambientManageAbsent ? "ambient_manage_absent" : "ambient_manage_principal_present",
    },
    taskOwnership: { ready: ownerBound, reason: ownerBound ? "task_owner_bound" : "task_owner_binding_missing" },
    skillAllowlist: {
      ready: allowlistBounded,
      reason: allowlistBounded ? "skill_allowlist_bounded" : "skill_allowlist_unbounded",
    },
    cliServerCreate: {
      ready: createCoherent,
      reason: createCoherent ? "cli_server_create_coherent" : "cli_server_create_mismatch",
    },
    liveProbeReceipt: {
      ready: receiptClaimsValid,
      reason: receiptClaimsValid
        ? "live_probe_receipt_claims_match"
        : receipt
          ? "live_probe_receipt_claims_invalid"
          : "live_probe_receipt_missing",
    },
    handlerDataflowProof: {
      ready: false,
      reason: "handler_dataflow_proof_unavailable",
    },
    receiptAuthenticity: {
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
      ready: signedProbePayload.bindingsValid,
      reason: signedProbePayload.bindingReason,
    },
    signedSafetyClaims: {
      ready: signedProbePayload.safetyState === "pass",
      reason: signedProbePayload.safetyReason,
    },
  };

  const sourceIndicatorNames = Object.keys(gates).filter(
    (name) =>
      ![
        "liveProbeReceipt",
        "handlerDataflowProof",
        "receiptAuthenticity",
        "signedProbeBindings",
        "signedSafetyClaims",
      ].includes(name),
  );
  const sourceIndicatorsPass = sourceIndicatorNames.every((name) => gates[name].ready);
  const blockers = Object.entries(gates)
    .filter(([, gate]) => !gate.ready)
    .map(([name, gate]) => `${name}:${gate.reason}`);

  return {
    schemaVersion: 1,
    kind: "temperance.a2a.readiness",
    mode: "read-only",
    packageVersion,
    sourceDigest,
    sourceIndicatorsPass,
    receiptClaimsValid,
    signedProbeState: !signedProbeReceipt ? "absent" : signedProbeIntegrity ? "integrity-only" : "invalid",
    signedProbeIntegrity,
    signedProbeBindingsValid: signedProbeIntegrity && signedProbePayload.bindingsValid,
    safetyEvidenceState: signedProbePayload.safetyState,
    sourceReady: false,
    liveReceiptReady: false,
    technicalReady: false,
    promotionAuthorized: false,
    promotionReady: false,
    gates,
    blockers,
    promotionBlockers: [...blockers, "operatorAuthorization:operator_authorization_required"],
  };
}

function usage(): never {
  console.error(`Usage: bun scripts/omniroute-a2a-readiness.ts [options]

Read-only options:
  --package-root PATH       Installed OmniRoute package root
  --probe-receipt PATH      Optional mode-600 live denial-probe receipt
  --server-instance ID      Expected isolated server instance identifier

Optional signed-probe trust inputs are read from TEMPERANCE_SIGNED_PROBE_*
environment variables; no signing key is accepted by this verifier.
  -h, --help`);
  process.exit(2);
}

if (import.meta.main) {
  try {
    let packageRoot = process.env.TEMPERANCE_OMNIROUTE_PACKAGE_ROOT || "/opt/homebrew/lib/node_modules/omniroute";
    let receiptPath = process.env.TEMPERANCE_A2A_PROBE_RECEIPT;
    let expectedServerInstanceId = process.env.TEMPERANCE_A2A_SERVER_INSTANCE_ID;
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      const next = () => {
        const value = args[++index];
        if (!value) throw new Error(`${arg} requires a value`);
        return value;
      };
      if (arg === "--package-root") packageRoot = next();
      else if (arg === "--probe-receipt") receiptPath = next();
      else if (arg === "--server-instance") expectedServerInstanceId = next();
      else if (arg === "-h" || arg === "--help") usage();
      else throw new Error(`unknown argument: ${arg}`);
    }
    const receipt = receiptPath ? JSON.parse(readFileSync(receiptPath, "utf8")) : undefined;
    const receiptMode = receiptPath ? statSync(receiptPath).mode & 0o777 : undefined;
    const signedProbe = loadProbeVerificationBundleFromEnv("a2a");
    const readiness = evaluateA2AReadiness(packageRoot, receipt, {
      receiptMode,
      expectedServerInstanceId,
      signedProbeReceipt: signedProbe?.receipt,
      probeVerification: signedProbe?.verification,
    });
    process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);
    process.exitCode = 3;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
