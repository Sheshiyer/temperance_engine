import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { resolve } from "node:path";

import {
  CANARY_CONTRACT,
  FORWARD_PLAN,
  PromotionFailure,
  approvalPublicKeySpkiHash,
  approvalSigningBytes,
  canaryContractHash,
  connectorCommand,
  createPreparedApproval,
  manifestHash,
  parseCloudflarePromotionManifest,
  parseStrictJsonDocument,
  prepareCloudflarePromotion,
  previewCloudflarePromotion,
  promoteCloudflarePromotion,
  recoverCloudflarePromotion,
  remoteKeyPolicyHash,
  rollbackCloudflarePromotion,
  tunnelConfiguration,
  validatePromotionReceipt,
  type CloudflarePromotionAdapter,
  type CloudflarePromotionManifest,
  type PromotionApprovalReceipt,
  type PromotionPreflight,
  type PromotionReceipt,
  type ResourceKind,
  type ResourceRef,
} from "./omniroute-cloudflare-promotion";

const NOW = Date.parse("2026-08-02T04:00:00.000Z");
const ROOT = resolve(import.meta.dir, "../..");
const CLI = resolve(ROOT, "scripts/omniroute-cloudflare-promotion.ts");
const EXAMPLE = resolve(ROOT, "package/router/omniroute-cloudflare-promotion.example.json");
const APPROVAL_KEYS = generateKeyPairSync("ed25519");
const APPROVAL_OPTIONS = { nowMs: NOW, approvalPublicKey: APPROVAL_KEYS.publicKey };

const MANIFEST_VALUE = {
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
  approval: {
    keyId: "operator-approval-2026",
    publicKeySpkiSha256: approvalPublicKeySpkiHash(APPROVAL_KEYS.publicKey),
  },
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
    cloudflareTokenFile: "/var/lib/temperance-secrets/cloudflare-api-token",
    connectorTokenFile: "/var/lib/temperance-secrets/cloudflared-tunnel-token",
    journalDirectory: "/var/lib/temperance-engine/cloudflare-promotion",
    receiptFile: "/var/lib/temperance-engine/cloudflare-promotion/receipt.json",
  },
  limits: {
    operationTimeoutMs: 10_000,
    connectionPollIntervalMs: 100,
    connectionPollAttempts: 5,
    approvalMaxAgeMs: 300_000,
  },
};

function manifest(): CloudflarePromotionManifest {
  return parseCloudflarePromotionManifest(structuredClone(MANIFEST_VALUE), "/repo");
}

function signedApproval(
  receipt: PromotionReceipt,
  input: Pick<PromotionApprovalReceipt, "approvalId" | "issuedAt" | "expiresAt">,
): PromotionApprovalReceipt {
  const draft = createPreparedApproval(receipt, { ...input, signature: `ed25519:${"A".repeat(86)}==` });
  const signature = sign(null, approvalSigningBytes(draft), APPROVAL_KEYS.privateKey).toString("base64");
  return { ...draft, signature: `ed25519:${signature}` };
}

function preflight(overrides: Partial<PromotionPreflight> = {}): PromotionPreflight {
  return {
    schemaVersion: 1,
    kind: "temperance.cloudflare-promotion-preflight",
    observedAt: "2026-08-02T03:59:30.000Z",
    authority: {
      schemaVersion: 1,
      kind: "temperance.cloudflare-exact-resource-authority",
      independent: true,
      signatureValid: true,
      issuer: "operator-authority",
      accountId: MANIFEST_VALUE.accountId,
      zoneId: MANIFEST_VALUE.zoneId,
      zone: MANIFEST_VALUE.zone,
      hostname: MANIFEST_VALUE.hostname,
      permissions: ["access:write", "dns:write", "service_tokens:write", "tunnel:write"],
      issuedAt: "2026-08-02T03:58:00.000Z",
      expiresAt: "2026-08-02T04:03:00.000Z",
      nonce: "a".repeat(64),
      signature: `ed25519:${"A".repeat(86)}==`,
    },
    localAuth: { requireApiKey: true, claudeKeychain: true, codexKeychain: true },
    quickTunnel: { state: "stopped", residuePaths: [] },
    listener: { addresses: ["127.0.0.1:20128"] },
    collisions: {
      accessApplication: false,
      accessPolicy: false,
      serviceToken: false,
      tunnel: false,
      dns: false,
      remoteKey: false,
      connector: false,
    },
    dnsCoverage: { exactRecord: false, wildcardRecord: false, apexFlattening: false },
    certPemPaths: [],
    ...overrides,
  };
}

function resource(kind: ResourceKind, name: string, suffix = kind, ownershipHash = "sha256:" + "1".repeat(64)): ResourceRef {
  return {
    kind,
    id: `${suffix}-id`,
    name,
    ownershipHash,
    stateHash: "sha256:" + "2".repeat(64),
  };
}

class FakeAdapter implements CloudflarePromotionAdapter {
  calls: string[] = [];
  journalState: PromotionReceipt | null = null;
  receiptHistory: PromotionReceipt[] = [];
  discoveredResources: Partial<Record<ResourceKind, ResourceRef>> = {};
  connectionCounts = [1, 0];
  approvalConsumed = false;
  driftKind: ResourceKind | null = null;

  async openControlPlane(): Promise<void> { this.calls.push("credential:open"); }
  async beginJournal(): Promise<void> { this.calls.push("journal:begin"); }
  async beforeMutation(step: string): Promise<void> { this.calls.push(`journal:before:${step}`); }
  async afterMutation(step: string): Promise<void> { this.calls.push(`journal:after:${step}`); }
  async writeReceipt(receipt: PromotionReceipt): Promise<void> {
    this.calls.push(`receipt:${receipt.state}:0600`);
    this.journalState = structuredClone(receipt);
    this.receiptHistory.push(structuredClone(receipt));
  }
  async consumeApproval(): Promise<{ consumed: true; durable: true; atomic: true } | { consumed: false }> {
    this.calls.push("approval:consume");
    if (this.approvalConsumed) return { consumed: false };
    this.approvalConsumed = true;
    return { consumed: true, durable: true, atomic: true };
  }
  async createRemoteKey(input: { name: string; ownershipHash: string }): Promise<ResourceRef> {
    this.calls.push("create:remoteKey");
    return resource("remoteKey", input.name, "remoteKey", input.ownershipHash);
  }
  async createServiceToken(input: { name: string; ownershipHash: string }): Promise<ResourceRef> {
    this.calls.push("create:serviceToken:sink-only");
    return resource("serviceToken", input.name, "serviceToken", input.ownershipHash);
  }
  async createAccessApplication(input: { name: string; ownershipHash: string }): Promise<ResourceRef> {
    this.calls.push("create:accessApplication");
    return resource("accessApplication", input.name, "accessApplication", input.ownershipHash);
  }
  async createAccessPolicy(input: { name: string; ownershipHash: string; decision: string; include: unknown }): Promise<ResourceRef> {
    this.calls.push(`create:accessPolicy:${input.decision}:${JSON.stringify(input.include)}`);
    return resource("accessPolicy", input.name, "accessPolicy", input.ownershipHash);
  }
  async verifyAccessBoundary(): Promise<boolean> { this.calls.push("verify:access-specific-token"); return true; }
  async createTunnel(input: { name: string; ownershipHash: string }): Promise<ResourceRef> {
    this.calls.push("create:tunnel:sink-only");
    return resource("tunnel", input.name, "tunnel", input.ownershipHash);
  }
  async putTunnelConfiguration(input: { ownershipHash: string }): Promise<ResourceRef> {
    this.calls.push("put:tunnelConfiguration");
    return resource("tunnelConfiguration", "remote-managed", "tunnelConfiguration", input.ownershipHash);
  }
  async verifyTunnelConfiguration(): Promise<boolean> { this.calls.push("verify:tunnelConfiguration"); return true; }
  async materializeConnectorToken(input: { ownershipHash: string }): Promise<ResourceRef> {
    this.calls.push("secret:materialize-connector-token:0600");
    return resource("connectorTokenFile", "cloudflared-tunnel-token", "connectorTokenFile", input.ownershipHash);
  }
  async startConnector(input: { argv: readonly string[]; ownershipHash: string }): Promise<ResourceRef> {
    this.calls.push(`start:connector:${input.argv.join(" ")}`);
    return resource("connector", MANIFEST_VALUE.names.connector, "connector", input.ownershipHash);
  }
  async waitForConnector(): Promise<boolean> { this.calls.push("verify:connector-connected"); return true; }
  async createDns(input: { target: string; proxied: true; ownershipHash: string }): Promise<ResourceRef> {
    this.calls.push(`create:dns:${input.target}:${input.proxied}`);
    return resource("dns", MANIFEST_VALUE.hostname, "dns", input.ownershipHash);
  }
  async runCanaries() {
    this.calls.push("verify:canaries");
    return CANARY_CONTRACT.map((item) => ({
      id: item.id,
      status: item.status,
      routed: item.routed,
      transport: "http" as const,
      hostnameResolved: true,
      accessDecision: item.accessDecision,
      accessEvidence: item.accessDecision === "denied" ? "cloudflare_access_denial" as const : "jwt_binding_verified" as const,
      ...(item.accessDecision === "allowed" ? {
        accessAud: MANIFEST_VALUE.access.audTag,
        accessIssuer: `https://${MANIFEST_VALUE.access.teamName}.cloudflareaccess.com`,
        accessPrincipal: `service-token:${MANIFEST_VALUE.names.serviceToken}`,
      } : {}),
      ...(item.id === "exact_model_success" ? { model: MANIFEST_VALUE.remoteKey.model } : {}),
    }));
  }
  async inspectResource(ref: ResourceRef): Promise<ResourceRef | null> {
    this.calls.push(`inspect:${ref.kind}`);
    if (ref.kind === this.driftKind) return { ...ref, stateHash: "sha256:" + "9".repeat(64) };
    return ref;
  }
  async stopConnector(): Promise<void> { this.calls.push("delete:connector"); }
  async deleteDns(): Promise<void> { this.calls.push("delete:dns"); }
  async cleanupConnections(): Promise<void> { this.calls.push("delete:connections"); }
  async connectionCount(): Promise<number> { this.calls.push("inspect:connections"); return this.connectionCounts.shift() ?? 0; }
  async wait(): Promise<void> { this.calls.push("wait:connections"); }
  async deleteTunnel(): Promise<void> { this.calls.push("delete:tunnel"); }
  async deleteAccessPolicy(): Promise<void> { this.calls.push("delete:accessPolicy"); }
  async deleteAccessApplication(): Promise<void> { this.calls.push("delete:accessApplication"); }
  async deleteServiceToken(): Promise<void> { this.calls.push("delete:serviceToken"); }
  async deleteRemoteKey(): Promise<void> { this.calls.push("delete:remoteKey"); }
  async deleteOwnedSecrets(): Promise<void> { this.calls.push("delete:secrets"); }
  async discoverPrepared(): Promise<PromotionReceipt> {
    this.calls.push("recover:discover-prepared");
    if (!this.journalState) throw new Error("fixture_missing_prepared_state");
    return this.journalState;
  }
  async discoverResource(kind: ResourceKind, deterministicName: string): Promise<ResourceRef | null> {
    this.calls.push(`recover:discover-resource:${kind}:${deterministicName}`);
    const ref = this.discoveredResources[kind] ?? this.journalState?.resources[kind] ?? null;
    return ref && ref.name === deterministicName ? structuredClone(ref) : null;
  }
}

class FailingAdapter extends FakeAdapter {
  constructor(private readonly failure: "tunnelConfiguration" | "canaries") {
    super();
  }

  override async putTunnelConfiguration(input: { ownershipHash: string }): Promise<ResourceRef> {
    if (this.failure === "tunnelConfiguration") {
      this.calls.push("put:tunnelConfiguration:failed");
      throw new Error("injected_tunnel_configuration_failure");
    }
    return super.putTunnelConfiguration(input);
  }

  override async runCanaries() {
    if (this.failure === "canaries") {
      this.calls.push("verify:canaries:failed");
      return CANARY_CONTRACT.map((item) => ({
        id: item.id,
        status: item.id === "anonymous_access_denial" ? 200 : item.status,
        routed: item.id === "anonymous_access_denial" ? true : item.routed,
        transport: "http" as const,
        hostnameResolved: true,
        accessDecision: item.accessDecision,
        accessEvidence: item.accessDecision === "denied" ? "cloudflare_access_denial" as const : "jwt_binding_verified" as const,
        ...(item.accessDecision === "allowed" ? {
          accessAud: MANIFEST_VALUE.access.audTag,
          accessIssuer: `https://${MANIFEST_VALUE.access.teamName}.cloudflareaccess.com`,
          accessPrincipal: `service-token:${MANIFEST_VALUE.names.serviceToken}`,
        } : {}),
        ...(item.id === "exact_model_success" ? { model: MANIFEST_VALUE.remoteKey.model } : {}),
      }));
    }
    return super.runCanaries();
  }
}

class DnsDeletionFailureAdapter extends FakeAdapter {
  override async deleteDns(): Promise<void> {
    this.calls.push("delete:dns:failed");
    throw new Error("injected_dns_delete_failure");
  }
}

class VacuousDenialAdapter extends FakeAdapter {
  override async runCanaries() {
    const observations = await super.runCanaries();
    return observations.map((item) => ({ ...item, transport: "dns_error" as const, hostnameResolved: false }));
  }
}

async function prepared(adapter = new FakeAdapter()): Promise<{ adapter: FakeAdapter; receipt: PromotionReceipt }> {
  return { adapter, receipt: await prepareCloudflarePromotion(manifest(), preflight(), adapter, { nowMs: NOW, repositoryRoot: "/repo" }) };
}

describe("strict manifest and immutable contracts", () => {
  test("accepts the exact schema and rejects unknown, missing, unsafe host, origin, and model values", () => {
    expect(manifest().hostname).toBe("ai.example.com");
    for (const mutation of [
      (value: any) => { value.unknown = true; },
      (value: any) => { delete value.zoneId; },
      (value: any) => { value.hostname = "AI.example.com"; },
      (value: any) => { value.hostname = "example.com"; },
      (value: any) => { value.hostname = "*.example.com"; },
      (value: any) => { value.origin = "http://localhost:20128"; },
      (value: any) => { value.remoteKey.model = "auto/claude-opus"; },
      (value: any) => { value.remoteKey.model = "codex/gpt-5.4-sol"; },
      (value: any) => { value.remoteKey.probePassed = false; },
      (value: any) => { value.remoteKey.policy.logging = "enabled"; },
    ]) {
      const value = structuredClone(MANIFEST_VALUE);
      mutation(value);
      expect(() => parseCloudflarePromotionManifest(value, "/repo")).toThrow(PromotionFailure);
    }
  });

  test("rejects duplicate JSON keys before ordinary JSON parsing can overwrite them", () => {
    expect(() => parseStrictJsonDocument('{"schemaVersion":1,"schemaVersion":2}')).toThrow("manifest_duplicate_key");
    expect(() => parseStrictJsonDocument('{"outer":{"name":"first","name":"second"}}')).toThrow("manifest_duplicate_key");
    expect(parseStrictJsonDocument('{"left":{"name":"first"},"right":{"name":"second"}}')).toEqual({ left: { name: "first" }, right: { name: "second" } });
  });

  test("builds exact remote ingress, token-file command, hashes, and deterministic plan", () => {
    const value = manifest();
    expect(tunnelConfiguration(value)).toEqual({
      config: {
        ingress: [
          {
            hostname: "ai.example.com",
            service: "http://127.0.0.1:20128",
            originRequest: { access: { required: true, teamName: "thoughtseed", audTag: ["aud-1234567890"] } },
          },
          { service: "http_status:404" },
        ],
      },
    });
    expect(connectorCommand(value, "tunnel-id")).toEqual([
      "cloudflared", "tunnel", "run", "--token-file", MANIFEST_VALUE.paths.connectorTokenFile, "tunnel-id",
    ]);
    expect(FORWARD_PLAN).toEqual([
      "remoteKey", "serviceToken", "accessApplication", "accessPolicy", "accessVerification",
      "tunnel", "tunnelConfiguration", "connectorTokenFile", "connector", "connectorConnection", "dns", "canaries",
    ]);
    expect(manifestHash(value)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(remoteKeyPolicyHash(value)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(canaryContractHash()).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("the generic CLI previews deterministically and refuses mutation without an injected production adapter", () => {
    const preview = spawnSync("bun", [CLI, "preview", "--manifest", EXAMPLE], { cwd: ROOT, encoding: "utf8" });
    expect(preview.status).toBe(0);
    expect(JSON.parse(preview.stdout)).toMatchObject({ mode: "preview", mutations: 0, publicCutoverRequires: "fresh_one_use_prepared_state_approval" });
    expect(preview.stderr).toBe("");

    const prepare = spawnSync("bun", [CLI, "prepare", "--manifest", EXAMPLE], {
      cwd: ROOT,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", CLOUDFLARE_API_TOKEN: "must-not-be-read" },
    });
    expect(prepare.status).toBe(3);
    expect(JSON.parse(prepare.stdout)).toMatchObject({ ready: false, mutations: 0, code: "production_adapter_and_exact_authority_required" });
    expect(`${prepare.stdout}${prepare.stderr}`).not.toContain("must-not-be-read");
  });
});

describe("preview and prepare", () => {
  test("preview is deterministic and invokes no adapter or secret surface", () => {
    const adapter = new FakeAdapter();
    const result = previewCloudflarePromotion(MANIFEST_VALUE, "/repo");
    expect(result.mode).toBe("preview");
    expect(result.mutations).toBe(0);
    expect(result.plan).toEqual(FORWARD_PLAN);
    expect(adapter.calls).toEqual([]);
  });

  test("every failed preflight causes zero adapter calls", async () => {
    const failures: PromotionPreflight[] = [
      preflight({ localAuth: { requireApiKey: false, claudeKeychain: true, codexKeychain: true } }),
      preflight({ quickTunnel: { state: "stopped", residuePaths: ["quick.json"] } }),
      preflight({ listener: { addresses: ["0.0.0.0:20128"] } }),
      preflight({ collisions: { ...preflight().collisions, tunnel: true } }),
      preflight({ dnsCoverage: { exactRecord: false, wildcardRecord: true, apexFlattening: false } }),
      preflight({ certPemPaths: ["/opt/operator/.cloudflared/cert.pem"] }),
      preflight({ authority: { ...preflight().authority, signatureValid: false } }),
    ];
    for (const fixture of failures) {
      const adapter = new FakeAdapter();
      await expect(prepareCloudflarePromotion(manifest(), fixture, adapter, { nowMs: NOW, repositoryRoot: "/repo" })).rejects.toBeInstanceOf(PromotionFailure);
      expect(adapter.calls).toEqual([]);
    }
  });

  test("prepare creates only private Access-first control-plane resources with write-ahead records", async () => {
    const { adapter, receipt } = await prepared();
    expect(receipt.state).toBe("prepared");
    expect(receipt.resources.dns).toBeUndefined();
    expect(receipt.resources.connector).toBeUndefined();
    expect(adapter.calls).not.toContain(expect.stringContaining("create:dns") as never);
    expect(adapter.calls).not.toContain(expect.stringContaining("start:connector") as never);
    const mutations = adapter.calls.filter((call) => /^(create|put|secret):/.test(call));
    for (const mutation of mutations) {
      const step = mutation.includes("remoteKey") ? "remoteKey"
        : mutation.includes("serviceToken") ? "serviceToken"
          : mutation.includes("accessApplication") ? "accessApplication"
            : mutation.includes("accessPolicy") ? "accessPolicy"
              : mutation.includes("create:tunnel") ? "tunnel"
                : mutation.includes("tunnelConfiguration") ? "tunnelConfiguration"
                  : "connectorTokenFile";
      expect(adapter.calls.indexOf(`journal:before:${step}`)).toBeLessThan(adapter.calls.indexOf(mutation));
    }
    expect(adapter.calls.join("\n")).not.toContain("Everyone");
    expect(adapter.calls.join("\n")).not.toContain("Bypass");
    expect(validatePromotionReceipt(receipt)).toEqual({ valid: true, reasons: [] });
    expect(JSON.stringify(receipt)).not.toContain(MANIFEST_VALUE.paths.connectorTokenFile);
    expect(JSON.stringify(receipt)).not.toMatch(/client_secret|api_token|bearer/iu);
  });

  test("a partial prepare failure compensates every owned resource without public cutover", async () => {
    const adapter = new FailingAdapter("tunnelConfiguration");
    await expect(prepareCloudflarePromotion(manifest(), preflight(), adapter, { nowMs: NOW, repositoryRoot: "/repo" })).rejects.toBeInstanceOf(PromotionFailure);
    expect(adapter.calls.some((call) => call.startsWith("start:connector"))).toBe(false);
    expect(adapter.calls.some((call) => call.startsWith("create:dns"))).toBe(false);
    expect(adapter.calls.filter((call) => call.startsWith("delete:"))).toEqual([
      "delete:connections", "delete:tunnel", "delete:accessPolicy", "delete:accessApplication",
      "delete:serviceToken", "delete:remoteKey", "delete:secrets",
    ]);
  });
});

describe("approval-bound promotion, recovery, and rollback", () => {
  test("rejects stale, mismatched, and replayed approvals before public cutover", async () => {
    const { adapter, receipt } = await prepared();
    const valid = signedApproval(receipt, {
      approvalId: "approval-1",
      issuedAt: "2026-08-02T03:59:00.000Z",
      expiresAt: "2026-08-02T04:04:00.000Z",
    });
    const stale = { ...valid, expiresAt: "2026-08-02T03:59:59.999Z" };
    await expect(promoteCloudflarePromotion(manifest(), receipt, stale, adapter, APPROVAL_OPTIONS)).rejects.toBeInstanceOf(PromotionFailure);
    expect(adapter.calls.some((call) => call.startsWith("start:connector"))).toBe(false);
    const mismatch = { ...valid, hostname: "other.example.com" };
    await expect(promoteCloudflarePromotion(manifest(), receipt, mismatch, adapter, APPROVAL_OPTIONS)).rejects.toBeInstanceOf(PromotionFailure);
    const forged = { ...valid, signature: `${valid.signature.slice(0, 24)}${valid.signature[24] === "A" ? "B" : "A"}${valid.signature.slice(25)}` };
    await expect(promoteCloudflarePromotion(manifest(), receipt, forged, adapter, APPROVAL_OPTIONS)).rejects.toMatchObject({ code: "approval_signature_invalid" });
    expect(adapter.calls).not.toContain("approval:consume");
    const promoted = await promoteCloudflarePromotion(manifest(), receipt, valid, adapter, APPROVAL_OPTIONS);
    expect(promoted.state).toBe("promoted");
    await expect(promoteCloudflarePromotion(manifest(), receipt, valid, adapter, APPROVAL_OPTIONS)).rejects.toBeInstanceOf(PromotionFailure);
  });

  test("starts token-file connector, proves connection, makes DNS final, then runs exact canaries", async () => {
    const { adapter, receipt } = await prepared();
    const approval: PromotionApprovalReceipt = signedApproval(receipt, {
      approvalId: "approval-2",
      issuedAt: "2026-08-02T03:59:00.000Z",
      expiresAt: "2026-08-02T04:04:00.000Z",
    });
    await promoteCloudflarePromotion(manifest(), receipt, approval, adapter, APPROVAL_OPTIONS);
    const start = adapter.calls.findIndex((call) => call.startsWith("start:connector:cloudflared tunnel run --token-file"));
    const connected = adapter.calls.indexOf("verify:connector-connected");
    const dns = adapter.calls.findIndex((call) => call.startsWith("create:dns:tunnel-id.cfargotunnel.com:true"));
    const canaries = adapter.calls.indexOf("verify:canaries");
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(connected);
    expect(connected).toBeLessThan(dns);
    expect(dns).toBeLessThan(canaries);
  });

  test("recovery verifies an already-prepared receipt against exact owned resources", async () => {
    const { adapter, receipt } = await prepared();
    adapter.journalState = receipt;
    const recovered = await recoverCloudflarePromotion(manifest(), adapter, { nowMs: NOW });
    expect(recovered.state).toBe("prepared");
    expect(adapter.calls).toContain("recover:discover-prepared");
    expect(adapter.calls).toContain("receipt:prepared:0600");
  });

  test("recovery discovers and removes a response-before-journal resource by deterministic name", async () => {
    const { adapter } = await prepared();
    const ownedTunnel = structuredClone(adapter.journalState!.resources.tunnel!);
    const priorJournal = adapter.receiptHistory.find((item) => item.state === "preparing" && item.resources.accessPolicy && !item.resources.tunnel);
    expect(priorJournal).toBeDefined();
    adapter.journalState = structuredClone(priorJournal!);
    adapter.discoveredResources.tunnel = ownedTunnel;
    adapter.calls = [];
    const recovered = await recoverCloudflarePromotion(manifest(), adapter, { nowMs: NOW });
    expect(recovered.state).toBe("rolled_back");
    expect(adapter.calls).toContain(`recover:discover-resource:tunnel:${MANIFEST_VALUE.names.tunnel}`);
    expect(adapter.calls).toContain("delete:tunnel");
    expect(adapter.calls).not.toContain(expect.stringContaining("start:connector") as never);
    expect(adapter.calls).not.toContain(expect.stringContaining("create:dns") as never);
  });

  test("recovery refuses a same-name resource without the journal-bound ownership tag", async () => {
    const { adapter } = await prepared();
    const priorJournal = adapter.receiptHistory.find((item) => item.state === "preparing" && item.resources.accessPolicy && !item.resources.tunnel);
    expect(priorJournal).toBeDefined();
    adapter.journalState = structuredClone(priorJournal!);
    adapter.discoveredResources.tunnel = resource("tunnel", MANIFEST_VALUE.names.tunnel);
    adapter.calls = [];
    await expect(recoverCloudflarePromotion(manifest(), adapter, { nowMs: NOW })).rejects.toMatchObject({ code: "recovery_discovered_resource_invalid_tunnel" });
    expect(adapter.calls.some((call) => call.startsWith("delete:"))).toBe(false);
  });

  test("rollback preflights drift before deletion and otherwise uses the exact safe reverse order", async () => {
    const { adapter, receipt } = await prepared();
    const approval = signedApproval(receipt, {
      approvalId: "approval-3",
      issuedAt: "2026-08-02T03:59:00.000Z",
      expiresAt: "2026-08-02T04:04:00.000Z",
    });
    const promoted = await promoteCloudflarePromotion(manifest(), receipt, approval, adapter, APPROVAL_OPTIONS);
    adapter.calls = [];
    await rollbackCloudflarePromotion(manifest(), promoted, adapter, { nowMs: NOW });
    const deletes = adapter.calls.filter((call) => call.startsWith("delete:"));
    expect(deletes).toEqual([
      "delete:connector", "delete:dns", "delete:connections", "delete:tunnel", "delete:accessPolicy",
      "delete:accessApplication", "delete:serviceToken", "delete:remoteKey", "delete:secrets",
    ]);
    expect(adapter.calls.filter((call) => call === "inspect:connections").length).toBe(2);
    const second = await rollbackCloudflarePromotion(manifest(), { ...promoted, state: "rolled_back" }, adapter, { nowMs: NOW });
    expect(second.state).toBe("rolled_back");
  });

  test("rollback refuses any operator-replaced resource before deleting anything", async () => {
    const { adapter, receipt } = await prepared();
    adapter.driftKind = "tunnel";
    await expect(rollbackCloudflarePromotion(manifest(), receipt, adapter, { nowMs: NOW })).rejects.toBeInstanceOf(PromotionFailure);
    expect(adapter.calls.some((call) => call.startsWith("delete:"))).toBe(false);
  });

  test("a canary failure after DNS triggers full reverse rollback", async () => {
    const adapter = new FailingAdapter("canaries");
    const receipt = await prepareCloudflarePromotion(manifest(), preflight(), adapter, { nowMs: NOW, repositoryRoot: "/repo" });
    const approval = signedApproval(receipt, {
      approvalId: "approval-4",
      issuedAt: "2026-08-02T03:59:00.000Z",
      expiresAt: "2026-08-02T04:04:00.000Z",
    });
    adapter.calls = [];
    await expect(promoteCloudflarePromotion(manifest(), receipt, approval, adapter, APPROVAL_OPTIONS)).rejects.toBeInstanceOf(PromotionFailure);
    expect(adapter.calls.filter((call) => call.startsWith("delete:"))).toEqual([
      "delete:connector", "delete:dns", "delete:connections", "delete:tunnel", "delete:accessPolicy",
      "delete:accessApplication", "delete:serviceToken", "delete:remoteKey", "delete:secrets",
    ]);
  });

  test("a DNS or network failure can never masquerade as an Access denial", async () => {
    const adapter = new VacuousDenialAdapter();
    const receipt = await prepareCloudflarePromotion(manifest(), preflight(), adapter, { nowMs: NOW, repositoryRoot: "/repo" });
    const approval = signedApproval(receipt, {
      approvalId: "approval-5",
      issuedAt: "2026-08-02T03:59:00.000Z",
      expiresAt: "2026-08-02T04:04:00.000Z",
    });
    await expect(promoteCloudflarePromotion(manifest(), receipt, approval, adapter, APPROVAL_OPTIONS)).rejects.toMatchObject({ code: "canary_anonymous_access_denial_transport_unproven" });
    expect(adapter.calls).toContain("delete:dns");
  });

  test("failed DNS containment preserves Access and records a stuck-open receipt", async () => {
    const adapter = new DnsDeletionFailureAdapter();
    const receipt = await prepareCloudflarePromotion(manifest(), preflight(), adapter, { nowMs: NOW, repositoryRoot: "/repo" });
    const approval = signedApproval(receipt, {
      approvalId: "approval-6",
      issuedAt: "2026-08-02T03:59:00.000Z",
      expiresAt: "2026-08-02T04:04:00.000Z",
    });
    const promoted = await promoteCloudflarePromotion(manifest(), receipt, approval, adapter, APPROVAL_OPTIONS);
    adapter.calls = [];
    await expect(rollbackCloudflarePromotion(manifest(), promoted, adapter, { nowMs: NOW })).rejects.toMatchObject({ code: "PROMOTION_STUCK_OPEN" });
    expect(adapter.calls).toContain("delete:connector");
    expect(adapter.calls).toContain("delete:dns:failed");
    expect(adapter.calls).not.toContain("delete:accessPolicy");
    expect(adapter.calls).not.toContain("delete:serviceToken");
    expect(adapter.journalState).toMatchObject({ state: "stuck_open", failureCode: "PROMOTION_STUCK_OPEN" });
  });
});
