import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OnboardingPlanV1, OnboardingProfileV1 } from "../src/onboarding/contracts.ts";
import {
  OnboardingOperationError,
  createFileOperationReceiptSink,
  executeOnboardingOperation,
  type OnboardingEffector,
} from "../src/onboarding/operation-executor.ts";
import type { OperationReceiptV1 } from "../src/onboarding/public-contracts.ts";
import { calculateOnboardingPlanDigest } from "../src/onboarding/planner.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const planBase: Omit<OnboardingPlanV1, "generated_at" | "plan_digest"> = {
  schema: "temperance.onboarding.plan.v1", version: { major: 1, minor: 0 }, profile_id: "test",
  dry_run: true, operating_mode: "ready", install_order: ["base", "provider.9router"],
  project_enrollments: [], project_candidates: [], project_discovery_findings: [], modules: [],
};
const plan: OnboardingPlanV1 = {
  ...planBase,
  generated_at: "2026-09-17T00:00:00.000Z",
  plan_digest: calculateOnboardingPlanDigest(planBase),
};
const profile: OnboardingProfileV1 = {
  schema: "temperance.onboarding.profile.v1", version: { major: 1, minor: 0 }, id: "test",
  variables: {}, secret_references: { GATEWAY_KEY: { store: "macos-keychain", service: "temperance.gateway", account: "default" } },
  preselected_modules: [], routing_aliases: [], project_enrollments: [],
};
const confirmation = { confirmed: true as const, plan_digest: plan.plan_digest, confirmed_at: "2026-09-17T00:00:01.000Z" };

function effector(id: string, calls: string[], fail = false): OnboardingEffector {
  return {
    module_id: id,
    async apply() {
      calls.push(`apply:${id}`);
      if (fail) throw new OnboardingOperationError("SYNTHETIC_APPLY_FAILED");
      return id === "provider.9router" ? { resolved_executables: [{ id: "9router", path: "/managed/bin/9router", version: "0.5.75" }] } : {};
    },
    async rollback() { calls.push(`rollback:${id}`); },
  };
}

describe("confirmed onboarding operation executor", () => {
  test("rejects missing or stale confirmation before any effect or receipt", async () => {
    const calls: string[] = [];
    const receipts: OperationReceiptV1[] = [];
    await expect(executeOnboardingOperation({
      plan, profile,
      confirmation: { ...confirmation, plan_digest: `sha256:${"b".repeat(64)}` },
      effectors: [effector("base", calls), effector("provider.9router", calls)],
      receiptSink: { write: async (receipt) => { receipts.push(receipt); } },
    })).rejects.toThrow("OPERATION_CONFIRMATION_MISMATCH");
    expect(calls).toEqual([]);
    expect(receipts).toEqual([]);
  });

  test("applies in confirmed order and records the resolved router executable", async () => {
    const calls: string[] = [];
    const receipts: OperationReceiptV1[] = [];
    const receipt = await executeOnboardingOperation({
      plan, profile, confirmation,
      operationId: "operation-success",
      now: (() => { const times = [new Date("2026-09-17T00:00:02.000Z"), new Date("2026-09-17T00:00:03.000Z")]; return () => times.shift()!; })(),
      effectors: [effector("provider.9router", calls), effector("base", calls)],
      receiptSink: { write: async (value) => { receipts.push(value); } },
    });
    expect(calls).toEqual(["apply:base", "apply:provider.9router"]);
    expect(receipts).toEqual([receipt]);
    expect(receipt).toMatchObject({
      status: "committed", rollback_status: "not-required", secret_reference_ids: ["GATEWAY_KEY"],
      resolved_executables: [{ id: "9router", path: "/managed/bin/9router", version: "0.5.75" }],
    });
    expect(JSON.stringify(receipt)).not.toContain("temperance.gateway");
  });

  test("rolls back prior effects and writes a failure receipt", async () => {
    const calls: string[] = [];
    const receipts: OperationReceiptV1[] = [];
    const receipt = await executeOnboardingOperation({
      plan, profile, confirmation, operationId: "operation-failure",
      effectors: [effector("base", calls), effector("provider.9router", calls, true)],
      receiptSink: { write: async (value) => { receipts.push(value); } },
    });
    expect(calls).toEqual(["apply:base", "apply:provider.9router", "rollback:provider.9router", "rollback:base"]);
    expect(receipt).toMatchObject({ status: "failed", rollback_status: "completed", failure_code: "SYNTHETIC_APPLY_FAILED" });
    expect(receipts).toEqual([receipt]);
  });

  test("writes owner-only immutable receipt files", async () => {
    const root = mkdtempSync(join(tmpdir(), "temperance-operation-receipts-"));
    roots.push(root);
    const directory = join(root, "receipts");
    const oneModuleBase = { ...planBase, install_order: ["base"] };
    const oneModulePlan: OnboardingPlanV1 = { ...oneModuleBase, generated_at: plan.generated_at, plan_digest: calculateOnboardingPlanDigest(oneModuleBase) };
    const oneModuleConfirmation = { ...confirmation, plan_digest: oneModulePlan.plan_digest };
    const receipt = await executeOnboardingOperation({
      plan: oneModulePlan, profile, confirmation: oneModuleConfirmation, operationId: "operation-file",
      effectors: [effector("base", [])], receiptSink: createFileOperationReceiptSink(directory),
    });
    const path = join(directory, "operation-file.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(receipt);
    await expect(executeOnboardingOperation({
      plan: oneModulePlan, profile, confirmation: oneModuleConfirmation, operationId: "operation-file",
      effectors: [effector("base", [])], receiptSink: createFileOperationReceiptSink(directory),
    })).rejects.toThrow();
  });
});
