import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { evaluateA2AReadiness, type A2AProbeReceipt } from "../scripts/omniroute-a2a-readiness";
import {
  SIGNED_PROBE_CLAIM_SCOPE,
  SIGNED_PROBE_DOES_NOT_ASSERT,
  SIGNED_PROBE_KIND,
  generateProbeKeyPairForFixture,
  probeChallengeLedgerKey,
  signProbeReceipt,
  type UnsignedProbeReceipt,
} from "../package/router/signed-probe-receipt";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const routes = {
  rpc: ["dist/.build/next/server/app/a2a/route.js", "/a2a/route"],
  status: ["dist/.build/next/server/app/api/a2a/status/route.js", "/api/a2a/status/route"],
  tasks: ["dist/.build/next/server/app/api/a2a/tasks/route.js", "/api/a2a/tasks/route"],
  task: ["dist/.build/next/server/app/api/a2a/tasks/[id]/route.js", "/api/a2a/tasks/[id]/route"],
  cancel: ["dist/.build/next/server/app/api/a2a/tasks/[id]/cancel/route.js", "/api/a2a/tasks/[id]/cancel/route"],
} as const;

function write(root: string, relative: string, body: string): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

function createFixture(secure: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "temperance-a2a-ready-"));
  temporaryRoots.push(root);
  write(root, "package.json", '{"version":"9.9.9"}\n');

  const scopedGuard =
    'const authorization=request.headers.get("authorization"); const token=authorization.replace(/^Bearer /,""); authenticateA2ARequest(token,{requiredScopes:["a2a"]});';
  for (const [name, [path, page]] of Object.entries(routes)) {
    let body = `page:"${page}";`;
    if (secure) body += scopedGuard;
    if (!secure && name === "rpc") {
      body += 'const envKey=process.env.OMNIROUTE_API_KEY; request.headers.get("authorization"); /^Bearer /;';
    }
    if (secure && name === "rpc") {
      body += 'const allowedSkills=A2A_ALLOWED_SKILLS; if(!allowedSkills.has(skill)) throw new Error("Unknown skill");';
    }
    if (name === "tasks" && secure) {
      body += 'export async function POST(){}; method:"POST"; const rpcMethod="tasks.create";';
    } else if (name === "tasks") {
      body += 'export async function GET(){};';
    }
    write(root, path, body);
  }

  write(
    root,
    "src/lib/db/apiKeys.ts",
    secure ? 'return {scopes:["a2a"]};' : 'return {scopes: ["manage"]};',
  );
  write(
    root,
    "src/lib/a2a/taskManager.ts",
    secure
      ? "interface Task { ownerId: string }; function assertTaskOwner(ownerId:string, principalId:string){}; assertTaskOwner(ownerId, principalId);"
      : "const tasks = new Map();",
  );
  write(
    root,
    "bin/cli/commands/a2a.mjs",
    'const method="tasks.create"; apiFetch("/api/a2a/tasks", { method: "POST" });',
  );
  return root;
}

function passingReceipt(sourceDigest: string, overrides: Record<string, boolean> = {}): A2AProbeReceipt {
  return {
    schemaVersion: 1,
    packageVersion: "9.9.9",
    sourceDigest,
    issuedAt: "2026-08-01T16:00:00.000Z",
    expiresAt: "2026-08-01T16:05:00.000Z",
    serverInstanceId: "fixture-instance",
    promotionClaim: false,
    humanSignoffRequired: true,
    checks: {
      anonymousDenied: true,
      invalidBearerDenied: true,
      authenticatedCapabilitiesBounded: true,
      forbiddenSkillDenied: true,
      cliCreateSucceeded: true,
      crossPrincipalReadDenied: true,
      crossPrincipalCancelDenied: true,
      ...overrides,
    },
  };
}

const signedChallenge = "34".repeat(32);

function signedA2AProbe(sourceDigest: string, safetyEvidence: Record<string, boolean> | undefined = {
  declaredCapabilitiesBounded: true,
  timeoutObserved: true,
  idempotencyVerified: true,
  errorTaxonomyConformant: true,
}): UnsignedProbeReceipt {
  return {
    schemaVersion: 1,
    kind: SIGNED_PROBE_KIND,
    surface: "a2a",
    claimScope: SIGNED_PROBE_CLAIM_SCOPE,
    disclaimerSchemaVersion: 1,
    doesNotAssert: [...SIGNED_PROBE_DOES_NOT_ASSERT],
    issuer: "temperance-a2a-probe-runner",
    keyId: "a2a-fixture-key",
    audience: "temperance-a2a-readiness",
    challenge: signedChallenge,
    issuedAt: "2026-08-01T16:00:00.000Z",
    notBefore: "2026-08-01T16:00:00.000Z",
    expiresAt: "2026-08-01T16:05:00.000Z",
    payload: {
      packageVersion: "9.9.9",
      sourceDigest,
      serverInstanceId: "fixture-instance",
      isolatedInstance: true,
      checks: passingReceipt(sourceDigest).checks,
      ...(safetyEvidence ? { safetyEvidence } : {}),
    },
  };
}

describe("native A2A readiness evaluator", () => {
  test("reports every current unsafe source boundary without enabling A2A", () => {
    const result = evaluateA2AReadiness(createFixture(false));
    expect(result.sourceIndicatorsPass).toBe(false);
    expect(result.sourceReady).toBe(false);
    expect(result.promotionReady).toBe(false);
    expect(result.gates.rpcScopedPrincipal.reason).toBe("rpc_scoped_principal_missing");
    expect(result.gates.taskRoutesScopedPrincipal.reason).toBe("task_route_guard_missing");
    expect(result.gates.ambientManagePrincipalAbsent.reason).toBe("ambient_manage_principal_present");
    expect(result.gates.taskOwnership.reason).toBe("task_owner_binding_missing");
    expect(result.gates.cliServerCreate.reason).toBe("cli_server_create_mismatch");
  });

  test("treats matching source and receipt fields as claims, never technical proof", () => {
    const root = createFixture(true);
    const sourceOnly = evaluateA2AReadiness(root);
    expect(sourceOnly.sourceIndicatorsPass).toBe(true);
    expect(sourceOnly.sourceReady).toBe(false);
    expect(sourceOnly.liveReceiptReady).toBe(false);
    expect(sourceOnly.promotionReady).toBe(false);
    const technical = evaluateA2AReadiness(
      root,
      passingReceipt(sourceOnly.sourceDigest!),
      { now: new Date("2026-08-01T16:02:00.000Z"), receiptMode: 0o600 },
    );
    expect(technical.sourceIndicatorsPass).toBe(true);
    expect(technical.receiptClaimsValid).toBe(true);
    expect(technical.sourceReady).toBe(false);
    expect(technical.liveReceiptReady).toBe(false);
    expect(technical.technicalReady).toBe(false);
    expect(technical.promotionAuthorized).toBe(false);
    expect(technical.promotionReady).toBe(false);
    expect(technical.promotionBlockers).toContain("operatorAuthorization:operator_authorization_required");
  });

  test("rejects a stale digest or any failed cross-principal denial", () => {
    const root = createFixture(true);
    const sourceOnly = evaluateA2AReadiness(root);
    const now = new Date("2026-08-01T16:02:00.000Z");
    const options = { now, receiptMode: 0o600 };
    expect(evaluateA2AReadiness(root, passingReceipt("0".repeat(64)), options).receiptClaimsValid).toBe(false);
    expect(
      evaluateA2AReadiness(
        root,
        passingReceipt(sourceOnly.sourceDigest!, { crossPrincipalCancelDenied: false }),
        options,
      ).receiptClaimsValid,
    ).toBe(false);
  });

  test("rejects stale, long-lived, or self-promoting receipts", () => {
    const root = createFixture(true);
    const sourceOnly = evaluateA2AReadiness(root);
    const now = new Date("2026-08-01T16:10:00.000Z");
    expect(
      evaluateA2AReadiness(root, passingReceipt(sourceOnly.sourceDigest!), { now, receiptMode: 0o600 })
        .receiptClaimsValid,
    ).toBe(false);
    const longLived = passingReceipt(sourceOnly.sourceDigest!);
    longLived.expiresAt = "2026-08-01T16:30:00.000Z";
    expect(
      evaluateA2AReadiness(root, longLived, {
        now: new Date("2026-08-01T16:02:00.000Z"),
        receiptMode: 0o600,
      }).receiptClaimsValid,
    ).toBe(false);
    const selfPromoting = passingReceipt(sourceOnly.sourceDigest!);
    selfPromoting.promotionClaim = true;
    expect(
      evaluateA2AReadiness(root, selfPromoting, {
        now: new Date("2026-08-01T16:02:00.000Z"),
        receiptMode: 0o600,
      }).receiptClaimsValid,
    ).toBe(false);
  });

  test("rejects an otherwise valid receipt with broader file permissions", () => {
    const root = createFixture(true);
    const sourceOnly = evaluateA2AReadiness(root);
    const result = evaluateA2AReadiness(root, passingReceipt(sourceOnly.sourceDigest!), {
      now: new Date("2026-08-01T16:02:00.000Z"),
      receiptMode: 0o644,
    });
    expect(result.receiptClaimsValid).toBe(false);
    expect(result.liveReceiptReady).toBe(false);
    expect(result.technicalReady).toBe(false);
  });

  test("cannot become ready from source keyword co-occurrence or self-authored JSON", () => {
    const root = createFixture(true);
    const sourceOnly = evaluateA2AReadiness(root);
    const result = evaluateA2AReadiness(root, passingReceipt(sourceOnly.sourceDigest!), {
      now: new Date("2026-08-01T16:02:00.000Z"),
      receiptMode: 0o600,
    });
    expect(result.gates.handlerDataflowProof.reason).toBe("handler_dataflow_proof_unavailable");
    expect(result.gates.receiptAuthenticity.reason).toBe("signed_probe_missing");
    expect(result.sourceReady).toBe(false);
    expect(result.liveReceiptReady).toBe(false);
    expect(result.technicalReady).toBe(false);
    expect(result.promotionReady).toBe(false);
  });

  test("signed A2A probe integrity and safety claims cannot satisfy handler proof", () => {
    const root = createFixture(true);
    const sourceOnly = evaluateA2AReadiness(root);
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const signedProbeReceipt = signProbeReceipt(signedA2AProbe(sourceOnly.sourceDigest!), privateKey);
    const result = evaluateA2AReadiness(root, passingReceipt(sourceOnly.sourceDigest!), {
      now: new Date("2026-08-01T16:02:00.000Z"),
      receiptMode: 0o600,
      expectedServerInstanceId: "fixture-instance",
      signedProbeReceipt,
      probeVerification: {
        surface: "a2a",
        issuer: "temperance-a2a-probe-runner",
        keyId: "a2a-fixture-key",
        audience: "temperance-a2a-readiness",
        challenge: signedChallenge,
        publicKey,
        issuedChallenges: [probeChallengeLedgerKey("a2a-fixture-key", signedChallenge)],
        consumedChallenges: [],
        nowMs: Date.parse("2026-08-01T16:02:00.000Z"),
      },
    });
    expect(result.sourceIndicatorsPass).toBe(true);
    expect(result.receiptClaimsValid).toBe(true);
    expect(result.signedProbeState).toBe("integrity-only");
    expect(result.signedProbeBindingsValid).toBe(true);
    expect(result.safetyEvidenceState).toBe("pass");
    expect(result.gates.receiptAuthenticity.ready).toBe(true);
    expect(result.gates.handlerDataflowProof.ready).toBe(false);
    expect(result.liveReceiptReady).toBe(false);
    expect(result.technicalReady).toBe(false);
    expect(result.promotionReady).toBe(false);
  });

  test("missing signed safety evidence is indeterminate rather than passing", () => {
    const root = createFixture(true);
    const sourceOnly = evaluateA2AReadiness(root);
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const signedProbeReceipt = signProbeReceipt(signedA2AProbe(sourceOnly.sourceDigest!, {}), privateKey);
    const result = evaluateA2AReadiness(root, undefined, {
      now: new Date("2026-08-01T16:02:00.000Z"),
      expectedServerInstanceId: "fixture-instance",
      signedProbeReceipt,
      probeVerification: {
        surface: "a2a",
        issuer: "temperance-a2a-probe-runner",
        keyId: "a2a-fixture-key",
        audience: "temperance-a2a-readiness",
        challenge: signedChallenge,
        publicKey,
        issuedChallenges: [probeChallengeLedgerKey("a2a-fixture-key", signedChallenge)],
        consumedChallenges: [],
        nowMs: Date.parse("2026-08-01T16:02:00.000Z"),
      },
    });
    expect(result.signedProbeIntegrity).toBe(true);
    expect(result.safetyEvidenceState).toBe("indeterminate");
    expect(result.gates.signedSafetyClaims.ready).toBe(false);
    expect(result.technicalReady).toBe(false);
    expect(result.promotionReady).toBe(false);
  });

  test("an insecure handler remains closed even under a valid complete signed probe", () => {
    const root = createFixture(false);
    const sourceOnly = evaluateA2AReadiness(root);
    const { privateKey, publicKey } = generateProbeKeyPairForFixture();
    const signedProbeReceipt = signProbeReceipt(signedA2AProbe(sourceOnly.sourceDigest!), privateKey);
    const result = evaluateA2AReadiness(root, undefined, {
      now: new Date("2026-08-01T16:02:00.000Z"),
      expectedServerInstanceId: "fixture-instance",
      signedProbeReceipt,
      probeVerification: {
        surface: "a2a",
        issuer: "temperance-a2a-probe-runner",
        keyId: "a2a-fixture-key",
        audience: "temperance-a2a-readiness",
        challenge: signedChallenge,
        publicKey,
        issuedChallenges: [probeChallengeLedgerKey("a2a-fixture-key", signedChallenge)],
        consumedChallenges: [],
        nowMs: Date.parse("2026-08-01T16:02:00.000Z"),
      },
    });
    expect(result.signedProbeIntegrity).toBe(true);
    expect(result.signedProbeBindingsValid).toBe(true);
    expect(result.safetyEvidenceState).toBe("pass");
    expect(result.sourceIndicatorsPass).toBe(false);
    expect(result.sourceReady).toBe(false);
    expect(result.technicalReady).toBe(false);
    expect(result.promotionReady).toBe(false);
  });

  test("fails closed when the installed layout is incomplete", () => {
    const root = mkdtempSync(join(tmpdir(), "temperance-a2a-missing-"));
    temporaryRoots.push(root);
    write(root, "package.json", '{"version":"9.9.9"}\n');
    const result = evaluateA2AReadiness(root);
    expect(result.sourceDigest).toBeNull();
    expect(result.gates.sources.reason).toBe("sources_missing_or_invalid");
    expect(result.promotionReady).toBe(false);
  });
});
