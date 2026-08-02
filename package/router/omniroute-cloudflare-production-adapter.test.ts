import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  parseCloudflarePromotionManifest,
  prepareCloudflarePromotion,
  type CloudflarePromotionManifest,
  type PromotionPreflight,
} from "./omniroute-cloudflare-promotion";
import { issueProbeChallenge } from "./signed-probe-challenge-ledger";
import {
  ProductionAdapterFailure,
  buildOmniRouteKeyPlan,
  createChallengeLedgerApprovalReplayPort,
  createOmniRouteCloudflareProductionAdapter,
  readOwnerOnlySecretFile,
  sanitizedFailure,
  type ApprovalReplayPort,
  type CanaryPort,
  type ConnectorPort,
  type FetchRequest,
} from "./omniroute-cloudflare-production-adapter";

const REPOSITORY = resolve(import.meta.dir, "../..");
const OWNERSHIP = `sha256:${"1".repeat(64)}`;
const CF_SECRET = "cloudflare-test-token-never-log-123456";
const OMNI_SECRET = "oma_test_admin_token_never_log_123456";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  manifest: CloudflarePromotionManifest;
  cloudflareToken: string;
  omniRouteToken: string;
  serviceSink: string;
  remoteKeySink: string;
  connectorToken: string;
  journal: string;
  receipt: string;
}

function ownerFile(path: string, value: string): void {
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function fixture(): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "temperance-prod-adapter-")));
  roots.push(root);
  chmodSync(root, 0o700);
  const cloudflareToken = join(root, "cloudflare-token");
  const omniRouteToken = join(root, "omniroute-token");
  const serviceSink = join(root, "access-service-token");
  const remoteKeySink = join(root, "omniroute-remote-key");
  const connectorToken = join(root, "connector-token");
  const receipt = join(root, "receipt.json");
  ownerFile(cloudflareToken, `${CF_SECRET}\n`);
  ownerFile(omniRouteToken, `${OMNI_SECRET}\n`);
  const manifest = parseCloudflarePromotionManifest({
    schemaVersion: 1,
    kind: "temperance.omniroute-cloudflare-promotion",
    accountId: "account-1234567890",
    zoneId: "zone-1234567890",
    zone: "example.com",
    hostname: "ai.example.com",
    origin: "http://127.0.0.1:20128",
    names: {
      tunnel: "temperance-ai-example-com",
      accessApplication: "temperance-ai-example-com",
      accessPolicy: "temperance-ai-example-com-service-auth",
      serviceToken: "temperance-ai-example-com-client",
      remoteKey: "temperance-ai-example-com",
      connector: "temperance-ai-example-com",
    },
    access: { teamName: "thoughtseed", audTag: "aud-1234567890" },
    approval: { keyId: "operator-approval-2026", publicKeySpkiSha256: `sha256:${"2".repeat(64)}` },
    remoteKey: {
      model: "gh/claude-sonnet-5",
      probePassed: true,
      policy: {
        logging: "disabled",
        endpoints: ["/v1/chat/completions"],
        session: { maxRequests: 64, maxDurationSeconds: 3600 },
        rate: { requestsPerMinute: 30, burst: 5 },
        spendUsd: { daily: 5, weekly: 20 },
      },
    },
    paths: {
      cloudflareTokenFile: cloudflareToken,
      connectorTokenFile: connectorToken,
      journalDirectory: root,
      receiptFile: receipt,
    },
    limits: {
      operationTimeoutMs: 1_000,
      connectionPollIntervalMs: 25,
      connectionPollAttempts: 2,
      approvalMaxAgeMs: 300_000,
    },
  }, REPOSITORY);
  return { root, manifest, cloudflareToken, omniRouteToken, serviceSink, remoteKeySink, connectorToken, journal: root, receipt };
}

function replayPort(): ApprovalReplayPort & { calls: string[] } {
  const consumed = new Set<string>();
  const calls: string[] = [];
  return {
    calls,
    async consume(input) {
      const key = `${input.keyId}:${input.approvalId}`;
      calls.push(key);
      if (consumed.has(key)) return { consumed: false, authorizing: false };
      consumed.add(key);
      return { consumed: true, durable: true, atomic: true, authorizing: false };
    },
  };
}

function connectorPort(): ConnectorPort {
  return {
    async start() { return { id: "connector-id", state: { loaded: true } }; },
    async stop() {},
    async connected() { return true; },
    async cleanupConnections() {},
    async connectionCount() { return 0; },
    async inspect() { return { loaded: true }; },
  };
}

function canaryPort(): CanaryPort {
  return {
    async verifyAccessBoundary() { return true; },
    async run() { return [] as never; },
  };
}

function adapter(input: Fixture, fetch: (request: FetchRequest) => Promise<Response>, replay: ApprovalReplayPort = replayPort()) {
  return createOmniRouteCloudflareProductionAdapter({
    manifest: input.manifest,
    repositoryRoot: REPOSITORY,
    omniRouteAdminTokenFile: input.omniRouteToken,
    omniRouteRemoteKeySinkFile: input.remoteKeySink,
    accessServiceTokenSinkFile: input.serviceSink,
    fetch,
    approvalReplay: replay,
    connector: connectorPort(),
    canaries: canaryPort(),
    now: () => Date.parse("2026-08-02T05:00:00.000Z"),
  });
}

function validPreflight(input: Fixture): PromotionPreflight {
  return {
    schemaVersion: 1,
    kind: "temperance.cloudflare-promotion-preflight",
    observedAt: "2026-08-02T04:59:30.000Z",
    authority: {
      schemaVersion: 1,
      kind: "temperance.cloudflare-exact-resource-authority",
      independent: true,
      signatureValid: true,
      issuer: "operator-authority",
      accountId: input.manifest.accountId,
      zoneId: input.manifest.zoneId,
      zone: input.manifest.zone,
      hostname: input.manifest.hostname,
      permissions: ["access:write", "dns:write", "service_tokens:write", "tunnel:write"],
      issuedAt: "2026-08-02T04:58:00.000Z",
      expiresAt: "2026-08-02T05:03:00.000Z",
      nonce: "a".repeat(64),
      signature: `ed25519:${"A".repeat(86)}==`,
    },
    localAuth: { requireApiKey: true, claudeKeychain: true, codexKeychain: true },
    quickTunnel: { state: "stopped", residuePaths: [] },
    listener: { addresses: ["127.0.0.1:20128"] },
    collisions: { accessApplication: false, accessPolicy: false, serviceToken: false, tunnel: false, dns: false, remoteKey: false, connector: false },
    dnsCoverage: { exactRecord: false, wildcardRecord: false, apexFlattening: false },
    certPemPaths: [],
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function operationRecords(root: string): Array<Record<string, unknown>> {
  return readdirSync(root)
    .filter((name) => name.startsWith("operation-") && name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(root, name), "utf8")) as Record<string, unknown>);
}

describe("strict credential and composition boundaries", () => {
  test("reads only canonical owner-only regular files and trims line endings", () => {
    const input = fixture();
    const bytes = readOwnerOnlySecretFile(input.cloudflareToken, REPOSITORY);
    expect(bytes.toString("utf8")).toBe(CF_SECRET);
    bytes.fill(0);

    chmodSync(input.cloudflareToken, 0o644);
    expect(() => readOwnerOnlySecretFile(input.cloudflareToken, REPOSITORY)).toThrow("production_secret_mode_invalid");
  });

  test("rejects symlink and hardlink credential substitution", () => {
    const input = fixture();
    const symlink = join(input.root, "symlink-token");
    symlinkSync(input.cloudflareToken, symlink);
    expect(() => readOwnerOnlySecretFile(symlink, REPOSITORY)).toThrow("production_secret_file_invalid");

    const hardlink = join(input.root, "hardlink-token");
    linkSync(input.omniRouteToken, hardlink);
    expect(() => readOwnerOnlySecretFile(input.omniRouteToken, REPOSITORY)).toThrow("production_secret_hardlink_invalid");
  });

  test("constructing and importing the adapter performs no file or network work", () => {
    const input = fixture();
    const before = readdirSync(input.root).sort();
    let calls = 0;
    adapter(input, async () => { calls += 1; return jsonResponse({}); });
    expect(readdirSync(input.root).sort()).toEqual(before);
    expect(calls).toBe(0);
    const cli = readFileSync(resolve(REPOSITORY, "scripts/omniroute-cloudflare-promotion.ts"), "utf8");
    expect(cli).not.toContain("omniroute-cloudflare-production-adapter");
    const source = readFileSync(resolve(REPOSITORY, "package/router/omniroute-cloudflare-production-adapter.ts"), "utf8");
    expect(source).not.toContain("globalThis.fetch");
    expect(source).not.toMatch(/plane:\s*"omniroute"[\s\S]{0,120}method:\s*"POST"/u);
    expect(source).not.toMatch(/\bstatSync\(path\)/u);
    expect(source).not.toContain("readFileSync(this.config.manifest.paths.receiptFile");
    expect(source).toContain("response = await this.config.fetch");
  });
});

describe("durable request and secret-sink contracts", () => {
  test("persists request intent before service-token creation and never journals its secret", async () => {
    const input = fixture();
    const requests: FetchRequest[] = [];
    const production = adapter(input, async (request) => {
      requests.push(request);
      const records = operationRecords(input.root);
      expect(records.at(-1)).toMatchObject({ step: "serviceToken", state: "prepared", requestHash: expect.stringMatching(/^sha256:/) });
      return jsonResponse({
        success: true,
        result: {
          id: "service-token-id",
          name: input.manifest.names.serviceToken,
          client_id: "client-id-1234567890",
          client_secret: "service-secret-never-journal-1234567890",
        },
      });
    });
    await production.openControlPlane();
    await production.beginJournal();
    await production.beforeMutation("serviceToken");
    const ref = await production.createServiceToken({ name: input.manifest.names.serviceToken, ownershipHash: OWNERSHIP });
    await production.afterMutation("serviceToken");

    expect(ref).toMatchObject({ kind: "serviceToken", id: "service-token-id", name: input.manifest.names.serviceToken, ownershipHash: OWNERSHIP });
    expect(lstatSync(input.serviceSink).mode & 0o777).toBe(0o600);
    expect(readFileSync(input.serviceSink, "utf8")).toContain("service-secret-never-journal");
    const journal = operationRecords(input.root).map((value) => JSON.stringify(value)).join("\n");
    expect(journal).not.toContain("service-secret-never-journal");
    expect(journal).not.toContain(CF_SECRET);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.cloudflare.com/client/v4/accounts/account-1234567890/access/service_tokens");
    expect(requests[0].init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(operationRecords(input.root)).toContainEqual(expect.objectContaining({ step: "serviceToken", state: "committed" }));
  });

  test("classifies HTML and redirects as explicit non-retryable failures without body leakage", async () => {
    const input = fixture();
    const html = adapter(input, async () => new Response(`<html>${CF_SECRET}</html>`, { status: 403, headers: { "content-type": "text/html" } }));
    await html.beginJournal();
    await html.beforeMutation("serviceToken");
    await expect(html.createServiceToken({ name: input.manifest.names.serviceToken, ownershipHash: OWNERSHIP }))
      .rejects.toMatchObject({ code: "production_access_auth_failure", message: "production_access_auth_failure" });
    expect(JSON.stringify(operationRecords(input.root))).not.toContain(CF_SECRET);

    const redirectInput = fixture();
    const redirected = adapter(redirectInput, async () => new Response("", { status: 302, headers: { location: "https://login.example/" } }));
    await redirected.beginJournal();
    await redirected.beforeMutation("tunnel");
    await expect(redirected.createTunnel({ name: redirectInput.manifest.names.tunnel, ownershipHash: OWNERSHIP }))
      .rejects.toMatchObject({ code: "production_redirect_forbidden" });
  });

  test("an ambiguous network outcome becomes a manual orphan and can never be adopted by name", async () => {
    const input = fixture();
    const first = adapter(input, async () => { throw new Error(`network:${CF_SECRET}`); });
    await first.beginJournal();
    await first.beforeMutation("tunnel");
    await expect(first.createTunnel({ name: input.manifest.names.tunnel, ownershipHash: OWNERSHIP }))
      .rejects.toMatchObject({ code: "production_tunnel_outcome_ambiguous" });
    expect(operationRecords(input.root)).toContainEqual(expect.objectContaining({ step: "tunnel", state: "manual_orphan", ref: null }));

    const recovering = adapter(input, async () => jsonResponse({ success: true, result: [] }));
    await recovering.beginJournal();
    await expect(recovering.discoverResource("tunnel", input.manifest.names.tunnel))
      .rejects.toMatchObject({ code: "production_manual_orphan_tunnel" });
  });

  test("recovery rejects symlinked receipts and hardlinked operation records", async () => {
    const receiptInput = fixture();
    const receiptAdapter = adapter(receiptInput, async () => jsonResponse({}));
    await expect(prepareCloudflarePromotion(receiptInput.manifest, validPreflight(receiptInput), receiptAdapter, {
      nowMs: Date.parse("2026-08-02T05:00:00.000Z"),
      repositoryRoot: REPOSITORY,
    })).rejects.toMatchObject({ code: "prepare_failed" });
    const receiptBacking = join(receiptInput.root, "receipt-backing.json");
    renameSync(receiptInput.receipt, receiptBacking);
    symlinkSync(receiptBacking, receiptInput.receipt);
    await expect(receiptAdapter.discoverPrepared()).rejects.toMatchObject({ code: "production_receipt_file_invalid" });

    const operationInput = fixture();
    const first = adapter(operationInput, async () => { throw new Error("ambiguous"); });
    await first.beginJournal();
    await first.beforeMutation("tunnel");
    await expect(first.createTunnel({ name: operationInput.manifest.names.tunnel, ownershipHash: OWNERSHIP }))
      .rejects.toMatchObject({ code: "production_tunnel_outcome_ambiguous" });
    const operationName = readdirSync(operationInput.root).find((name) => name.startsWith("operation-") && name.endsWith(".json"));
    expect(operationName).toBeDefined();
    const operationPath = join(operationInput.root, operationName!);
    const operationBacking = join(operationInput.root, "operation-backing.json");
    renameSync(operationPath, operationBacking);
    linkSync(operationBacking, operationPath);
    const recovering = adapter(operationInput, async () => jsonResponse({ success: true, result: [] }));
    await recovering.beginJournal();
    await expect(recovering.discoverResource("tunnel", operationInput.manifest.names.tunnel))
      .rejects.toMatchObject({ code: "production_operation_hardlink_invalid" });
    unlinkSync(operationPath);
  });

  test("recovery fails closed on malformed operation records", async () => {
    const input = fixture();
    const first = adapter(input, async () => { throw new Error("ambiguous"); });
    await first.beginJournal();
    await first.beforeMutation("tunnel");
    await expect(first.createTunnel({ name: input.manifest.names.tunnel, ownershipHash: OWNERSHIP }))
      .rejects.toMatchObject({ code: "production_tunnel_outcome_ambiguous" });
    const operationName = readdirSync(input.root).find((name) => name.startsWith("operation-") && name.endsWith(".json"));
    expect(operationName).toBeDefined();
    const operationPath = join(input.root, operationName!);
    const malformed = JSON.parse(readFileSync(operationPath, "utf8")) as Record<string, unknown>;
    malformed.unexpected = "forged";
    ownerFile(operationPath, JSON.stringify(malformed));
    const recovering = adapter(input, async () => jsonResponse({ success: true, result: [] }));
    await recovering.beginJournal();
    await expect(recovering.discoverResource("tunnel", input.manifest.names.tunnel))
      .rejects.toMatchObject({ code: "production_operation_record_invalid" });
  });

  test("tunnel and DNS requests use exact official paths and create-time DNS provenance", async () => {
    const input = fixture();
    const requests: FetchRequest[] = [];
    const production = adapter(input, async (request) => {
      requests.push(request);
      if (request.url.endsWith("/cfd_tunnel")) return jsonResponse({ success: true, result: { id: "tunnel-id-123", name: input.manifest.names.tunnel, config_src: "cloudflare" } });
      return jsonResponse({ success: true, result: {
        id: "dns-record-id",
        name: input.manifest.hostname,
        type: "CNAME",
        content: "tunnel-id-123.cfargotunnel.com",
        proxied: true,
        ttl: 1,
        comment: `temperance-owner=${OWNERSHIP}`,
        tags: [`temperance_owner:${OWNERSHIP.slice("sha256:".length)}`],
      } });
    });
    await production.beginJournal();
    await production.beforeMutation("tunnel");
    await production.createTunnel({ name: input.manifest.names.tunnel, ownershipHash: OWNERSHIP });
    await production.afterMutation("tunnel");
    await production.beforeMutation("dns");
    await production.createDns({ target: "tunnel-id-123.cfargotunnel.com", proxied: true, ownershipHash: OWNERSHIP });
    await production.afterMutation("dns");

    expect(requests.map((request) => [request.init.method, new URL(request.url).pathname])).toEqual([
      ["POST", "/client/v4/accounts/account-1234567890/cfd_tunnel"],
      ["POST", "/client/v4/zones/zone-1234567890/dns_records"],
    ]);
    const dnsBody = JSON.parse(String(requests[1].init.body));
    expect(dnsBody).toMatchObject({ type: "CNAME", name: "ai.example.com", proxied: true, comment: `temperance-owner=${OWNERSHIP}` });
  });
});

describe("honest OmniRoute policy and approval boundaries", () => {
  test("refuses the installed OmniRoute key API when exact manifest controls cannot be represented", async () => {
    const input = fixture();
    const plan = buildOmniRouteKeyPlan({
      name: input.manifest.names.remoteKey,
      model: input.manifest.remoteKey.model,
      policy: input.manifest.remoteKey.policy,
    });
    expect(plan).toMatchObject({
      supported: false,
      code: "omniroute_policy_not_exact",
      unmappedControls: ["session.maxRequests", "session.maxDurationSeconds", "rate.burst", "exact_endpoint_path"],
      request: { noLog: true, allowedModels: ["gh/claude-sonnet-5"], allowedEndpoints: ["chat"], scopes: ["chat"] },
    });
    let calls = 0;
    const production = adapter(input, async () => { calls += 1; return jsonResponse({}); });
    await production.beginJournal();
    await production.beforeMutation("remoteKey");
    await expect(production.createRemoteKey({
      name: input.manifest.names.remoteKey,
      ownershipHash: OWNERSHIP,
      model: input.manifest.remoteKey.model,
      policy: input.manifest.remoteKey.policy,
    })).rejects.toMatchObject({ code: "omniroute_policy_not_exact" });
    expect(calls).toBe(0);
    expect(operationRecords(input.root)).toContainEqual(expect.objectContaining({ step: "remoteKey", state: "aborted" }));
  });

  test("the real prepare state machine stops at that policy gate before any external request", async () => {
    const input = fixture();
    let calls = 0;
    const production = adapter(input, async () => { calls += 1; return jsonResponse({}); });
    await expect(prepareCloudflarePromotion(input.manifest, validPreflight(input), production, {
      nowMs: Date.parse("2026-08-02T05:00:00.000Z"),
      repositoryRoot: REPOSITORY,
    })).rejects.toMatchObject({ code: "prepare_failed" });
    expect(calls).toBe(0);
    expect(lstatSync(input.receipt).mode & 0o777).toBe(0o600);
    expect(operationRecords(input.root)).toContainEqual(expect.objectContaining({ step: "remoteKey", state: "aborted" }));
  });

  test("approval replay consumption has exactly one winner and never claims authorization", async () => {
    const input = fixture();
    const replay = replayPort();
    const production = adapter(input, async () => jsonResponse({}), replay);
    const approval = {
      schemaVersion: 1,
      kind: "temperance.omniroute-cloudflare-promotion-approval",
      approvalId: "a".repeat(64),
      issuedAt: "2026-08-02T04:59:00.000Z",
      expiresAt: "2026-08-02T05:04:00.000Z",
      signature: `ed25519:${"A".repeat(86)}==`,
      keyId: input.manifest.approval.keyId,
      preparedStateHash: OWNERSHIP,
      hostname: input.manifest.hostname,
      tunnelName: input.manifest.names.tunnel,
      accessApplicationName: input.manifest.names.accessApplication,
      remoteKeyPolicyHash: OWNERSHIP,
      canaryContractHash: OWNERSHIP,
    } as const;
    const [first, second] = await Promise.all([production.consumeApproval(approval), production.consumeApproval(approval)]);
    expect([first.consumed, second.consumed].sort()).toEqual([false, true]);
    expect(replay.calls).toHaveLength(2);
    expect(JSON.stringify([first, second])).not.toContain("authorizing");
  });

  test("the production replay port consumes the APFS ledger once and preserves its non-authorizing contract", async () => {
    const input = fixture();
    const issuedAt = Date.parse("2026-08-02T05:00:00.000Z");
    const ledgerPath = join(input.root, "approval-ledger.json");
    const receiptDirectory = join(input.root, "approval-receipts");
    const issued = await issueProbeChallenge({
      ledgerPath,
      receiptDirectory,
      keyId: input.manifest.approval.keyId,
      nowMs: issuedAt,
      lifetimeMs: 60_000,
    });
    const replay = createChallengeLedgerApprovalReplayPort({
      ledgerPath,
      receiptDirectory,
      now: () => issuedAt + 1_000,
    });
    const request = {
      keyId: issued.keyId,
      approvalId: issued.challenge,
      expiresAt: issued.expiresAt,
    };
    expect(await replay.consume(request)).toEqual({ consumed: true, durable: true, atomic: true, authorizing: false });
    expect(await replay.consume(request)).toEqual({ consumed: false, authorizing: false });
    expect(lstatSync(ledgerPath).mode & 0o777).toBe(0o600);
  });

  test("public failure serialization contains only a closed redacted code", () => {
    const error = new ProductionAdapterFailure(`bad-${CF_SECRET}`);
    expect(sanitizedFailure(error, [CF_SECRET])).toEqual({ code: "bad-[REDACTED]" });
    expect(JSON.stringify(sanitizedFailure(new Error(CF_SECRET), [CF_SECRET]))).toBe('{"code":"production_adapter_failure"}');
  });
});
