import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  createV4CutoverPlan,
  type BinaryObservation,
  type LaunchAgentObservation,
  type ManagedPathObservation,
  type PortObservation,
  type V4CutoverPlan,
} from "./v4-cutover-plan.ts";
import {
  V4CutoverExecutionError,
  createV4CutoverReview,
  createV4ReplacementProof,
  executeV4Cutover,
  validateV4CutoverReceipt,
  verifyV4ReplacementProof,
  type V4CutoverAdapter,
  type V4CutoverJournal,
  type V4CutoverJournalEvent,
  type V4CutoverReceipt,
  type V4CutoverVerification,
  type V4ReplacementProof,
} from "./v4-cutover-executor.ts";

const roots: string[] = [];
const NOW = new Date("2026-09-17T06:30:00.000Z");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { home: string; launchAgents: string; plan: V4CutoverPlan } {
  const home = mkdtempSync(resolve(tmpdir(), "temperance-cutover-executor-"));
  roots.push(home);
  const launchAgents = join(home, "Library", "LaunchAgents");
  mkdirSync(join(home, ".temperance_engine"), { recursive: true });
  mkdirSync(join(home, ".omniroute"), { recursive: true });
  mkdirSync(join(home, ".9router"), { recursive: true });
  mkdirSync(launchAgents, { recursive: true });
  writeFileSync(join(home, ".temperance_engine", "legacy.ts"), "export {};\n");
  writeFileSync(join(home, ".omniroute", "state.sqlite"), "legacy\n");
  writeFileSync(join(home, ".9router", "state.sqlite"), "old\n");
  writeFileSync(join(launchAgents, "com.temperance.engine.omniroute.plist"), "redacted fixture\n");
  const options = {
    homeDirectory: home,
    launchAgentsDirectory: launchAgents,
    platform: "darwin" as const,
    now: () => NOW,
    findBinary: (name: string) => `/managed/bin/${name}`,
    readVersion: (binary: string) => binary.endsWith("/9router") ? "9router 0.5.69" : "omniroute 3.8.49",
    inspectPort: (port: number): PortObservation => ({
      port,
      owner: "legacy-omniroute",
      pid: 1438,
      process: "node",
      listener_host: "127.0.0.1",
      loopback_only: true,
      managed_service_label: "com.temperance.engine.omniroute",
    }),
  };
  return { home, launchAgents, plan: createV4CutoverPlan(options) };
}

function proof(overrides: Partial<Omit<V4ReplacementProof, "schema" | "proof_digest">> = {}): V4ReplacementProof {
  return createV4ReplacementProof({
    generated_at: NOW.toISOString(),
    temperance_revision: "a".repeat(40),
    temperance_tree: "b".repeat(40),
    router: { package: "9router", version: "0.5.75" },
    artifact_digest: `sha256:${"c".repeat(64)}`,
    verification: {
      install_surface: `sha256:${"d".repeat(64)}`,
      cutover_contract: `sha256:${"e".repeat(64)}`,
    },
    ...overrides,
  });
}

class MemoryJournal implements V4CutoverJournal {
  readonly calls: string[] = [];
  readonly events: V4CutoverJournalEvent[] = [];
  receipt: V4CutoverReceipt | undefined;
  failComplete = false;

  async begin(input: { operation_id: string }): Promise<void> {
    this.calls.push(`begin:${input.operation_id}`);
  }
  async append(event: V4CutoverJournalEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }
  async complete(receipt: V4CutoverReceipt): Promise<void> {
    this.calls.push(`complete:${receipt.status}`);
    if (this.failComplete) throw new V4CutoverExecutionError("FIXTURE_JOURNAL_FAILURE");
    this.receipt = structuredClone(receipt);
  }
}

class MemoryAdapter implements V4CutoverAdapter {
  readonly calls: string[] = [];
  failAt: string | undefined;
  invalidVerification = false;

  private call(value: string): void {
    this.calls.push(value);
    if (value === this.failAt) throw new V4CutoverExecutionError("FIXTURE_FAILURE");
  }

  async preflightReplacement(): Promise<void> { this.call("preflight"); }
  async stageReplacement(): Promise<void> { this.call("stage"); }
  async stopRouterPortOwner(owner: PortObservation): Promise<void> { this.call(`stop-router:${owner.owner}`); }
  async unloadLaunchAgent(agent: LaunchAgentObservation): Promise<void> { this.call(`unload:${agent.label}`); }
  async restorePreCutoverServices(): Promise<void> { this.call("restore-services"); }
  async revokeLegacyGatewayCredential(referenceId: string): Promise<void> { this.call(`revoke:${referenceId}`); }
  async removeLaunchAgent(agent: LaunchAgentObservation): Promise<void> { this.call(`remove-agent:${agent.label}`); }
  async removeManagedPath(path: ManagedPathObservation): Promise<void> { this.call(`remove-path:${path.id}`); }
  async removeLegacyPackage(binary: BinaryObservation): Promise<void> { this.call(`remove-package:${binary.package}`); }
  async promoteTemperanceRuntime(path: ManagedPathObservation): Promise<void> { this.call(`promote-runtime:${path.id}`); }
  async installExactRouter(version: "0.5.75"): Promise<void> { this.call(`install-router:${version}`); }
  async installReplacementLaunchAgents(): Promise<void> { this.call("install-agents"); }
  async activateReplacement(): Promise<void> { this.call("activate"); }
  async verifyReplacement(): Promise<V4CutoverVerification> {
    this.call("verify");
    return {
      router_version: "0.5.75",
      listener_owner: "replacement-9router",
      listener_port: 20128,
      loopback_only: true,
      legacy_state_absent: this.invalidVerification ? false as true : true,
      legacy_launch_agents_absent: true,
      doctor_passed: true,
    };
  }
  async discardStagedReplacement(): Promise<void> { this.call("discard-stage"); }
  async recoverFreshReplacement(): Promise<void> { this.call("recover-fresh"); }
}

function executionOptions(plan: V4CutoverPlan, replacement: V4ReplacementProof, adapter = new MemoryAdapter(), journal = new MemoryJournal()) {
  const review = createV4CutoverReview(plan, replacement);
  return {
    options: {
      plan,
      proof: replacement,
      confirmation: { confirmed: true as const, operation_digest: review.operation_digest, confirmed_at: NOW.toISOString() },
      legacyCredentialReferenceId: "LEGACY_GATEWAY",
      reobserve: async () => structuredClone(plan),
      adapter,
      journal,
      now: () => NOW,
      operationId: "cutover-fixture",
    },
    review,
    adapter,
    journal,
  };
}

describe("V4 destructive cutover executor", () => {
  test("binds confirmation to both reviewed scope and replacement proof", () => {
    const { plan } = fixture();
    const firstProof = proof();
    const secondProof = proof({ artifact_digest: `sha256:${"f".repeat(64)}` });
    const first = createV4CutoverReview(plan, firstProof);
    const second = createV4CutoverReview(plan, secondProof);
    expect(verifyV4ReplacementProof(firstProof)).toBe(true);
    expect(first.operation_digest).not.toBe(second.operation_digest);
    expect(first.details).toContain("router replacement: 9router@0.5.75");
    expect(JSON.stringify(first)).not.toContain("redacted fixture");
    const tampered = { ...firstProof, temperance_tree: "f".repeat(40) };
    expect(verifyV4ReplacementProof(tampered)).toBe(false);
    expect(() => createV4CutoverReview(plan, tampered)).toThrow("CUTOVER_REPLACEMENT_PROOF_INVALID");
    expect(verifyV4ReplacementProof(null)).toBe(false);
    expect(verifyV4ReplacementProof({ schema: "temperance.v4-replacement-proof.v1" })).toBe(false);
  });

  test("rejects mismatched or expired confirmation before journal or adapter access", async () => {
    const { plan } = fixture();
    const replacement = proof();
    const context = executionOptions(plan, replacement);
    await expect(executeV4Cutover({
      ...context.options,
      confirmation: { ...context.options.confirmation, operation_digest: `sha256:${"0".repeat(64)}` },
    })).rejects.toThrow("CUTOVER_CONFIRMATION_INVALID");
    await expect(executeV4Cutover({
      ...context.options,
      confirmation: { ...context.options.confirmation, confirmed_at: "2026-09-17T06:00:00.000Z" },
    })).rejects.toThrow("CUTOVER_CONFIRMATION_INVALID");
    expect(context.adapter.calls).toEqual([]);
    expect(context.journal.calls).toEqual([]);
  });

  test("rejects observation drift before starting the durable journal", async () => {
    const { plan } = fixture();
    const context = executionOptions(plan, proof());
    const drifted = structuredClone(plan);
    drifted.router_port = { port: 20128, owner: "free" };
    const { calculateV4CutoverPlanDigest } = await import("./v4-cutover-plan.ts");
    drifted.plan_digest = calculateV4CutoverPlanDigest(drifted);
    await expect(executeV4Cutover({ ...context.options, reobserve: async () => drifted })).rejects.toThrow("CUTOVER_PLAN_DRIFTED");
    expect(context.adapter.calls).toEqual([]);
    expect(context.journal.calls).toEqual([]);
  });

  test("executes the allowlisted scrub and fresh replacement in strict order", async () => {
    const { home, plan } = fixture();
    const context = executionOptions(plan, proof());
    const receipt = await executeV4Cutover(context.options);
    expect(receipt.status).toBe("committed");
    expect(validateV4CutoverReceipt(receipt)).toBe(true);
    expect(receipt.recovery_status).toBe("not-required");
    expect(context.adapter.calls).toEqual([
      "preflight",
      "stage",
      "stop-router:legacy-omniroute",
      "unload:com.temperance.engine.omniroute",
      "revoke:LEGACY_GATEWAY",
      "remove-agent:com.temperance.engine.omniroute",
      "remove-path:legacy-omniroute",
      "remove-path:router-state",
      "remove-package:omniroute",
      "promote-runtime:runtime",
      "install-router:0.5.75",
      "install-agents",
      "activate",
      "verify",
    ]);
    expect(context.journal.calls).toEqual(["begin:cutover-fixture", "complete:committed"]);
    expect(context.journal.events[0]).toMatchObject({ action_id: "preflight-replacement", status: "started" });
    expect(context.journal.events.at(-1)).toMatchObject({ action_id: "verify-replacement", status: "completed" });
    expect(JSON.stringify(receipt)).not.toContain(home);
    expect(JSON.stringify(receipt)).not.toContain("redacted fixture");
    expect(validateV4CutoverReceipt({ ...receipt, unexpected: true })).toBe(false);
  });

  test("restores preparation and discards staging before the irreversible boundary", async () => {
    const { plan } = fixture();
    const adapter = new MemoryAdapter();
    adapter.failAt = "unload:com.temperance.engine.omniroute";
    const context = executionOptions(plan, proof(), adapter);
    const receipt = await executeV4Cutover(context.options);
    expect(receipt).toMatchObject({ status: "failed", failure_code: "FIXTURE_FAILURE", recovery_status: "completed" });
    expect(adapter.calls.slice(-2)).toEqual(["restore-services", "discard-stage"]);
    expect(adapter.calls).not.toContain("recover-fresh");
  });

  test("discards partial staging when the staging adapter reports failure", async () => {
    const { plan } = fixture();
    const adapter = new MemoryAdapter();
    adapter.failAt = "stage";
    const context = executionOptions(plan, proof(), adapter);
    const receipt = await executeV4Cutover(context.options);
    expect(receipt).toMatchObject({ status: "failed", failure_code: "FIXTURE_FAILURE", recovery_status: "completed" });
    expect(adapter.calls).toEqual(["preflight", "stage", "discard-stage"]);
  });

  test("recovers only from fresh replacement after irreversible scrub begins", async () => {
    const { plan } = fixture();
    const adapter = new MemoryAdapter();
    adapter.failAt = "remove-path:legacy-omniroute";
    const context = executionOptions(plan, proof(), adapter);
    const receipt = await executeV4Cutover(context.options);
    expect(receipt).toMatchObject({ status: "failed", failure_code: "FIXTURE_FAILURE", recovery_status: "completed" });
    expect(adapter.calls.at(-1)).toBe("recover-fresh");
    expect(adapter.calls).not.toContain("restore-services");
    expect(adapter.calls).not.toContain("discard-stage");
  });

  test("failed final readback triggers fresh recovery and a redacted receipt", async () => {
    const { plan } = fixture();
    const adapter = new MemoryAdapter();
    adapter.invalidVerification = true;
    const context = executionOptions(plan, proof(), adapter);
    const receipt = await executeV4Cutover(context.options);
    expect(receipt).toMatchObject({
      status: "failed",
      failure_code: "CUTOVER_REPLACEMENT_VERIFICATION_FAILED",
      recovery_status: "completed",
      secret_reference_ids: ["LEGACY_GATEWAY"],
    });
    expect(adapter.calls.at(-1)).toBe("recover-fresh");
    expect(context.journal.receipt).toEqual(receipt);
    expect(JSON.stringify(receipt)).not.toContain("state.sqlite");
  });

  test("does not disrupt a verified replacement when receipt finalization fails", async () => {
    const { plan } = fixture();
    const adapter = new MemoryAdapter();
    const journal = new MemoryJournal();
    journal.failComplete = true;
    const context = executionOptions(plan, proof(), adapter, journal);
    await expect(executeV4Cutover(context.options)).rejects.toThrow("CUTOVER_RECEIPT_FINALIZATION_FAILED");
    expect(adapter.calls.at(-1)).toBe("verify");
    expect(adapter.calls).not.toContain("recover-fresh");
    expect(journal.calls).toEqual(["begin:cutover-fixture", "complete:committed"]);
  });
});
