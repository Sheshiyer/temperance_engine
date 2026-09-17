import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  createV4ReplacementProof,
  type V4ReplacementProof,
} from "../../router/v4-cutover-executor.ts";
import {
  createV4CutoverPlan,
  type V4CutoverPlan,
} from "../../router/v4-cutover-plan.ts";
import {
  advanceV4CutoverConfirmation,
  createV4CutoverViewModel,
} from "../src/onboarding/v4-cutover-review.ts";

function proof(): V4ReplacementProof {
  return createV4ReplacementProof({
    generated_at: "2026-09-17T00:00:00.000Z",
    temperance_revision: "a".repeat(40),
    temperance_tree: "b".repeat(40),
    router: { package: "9router", version: "0.5.75" },
    artifact_digest: `sha256:${"c".repeat(64)}`,
    verification: {
      install_surface: `sha256:${"d".repeat(64)}`,
      cutover_contract: `sha256:${"e".repeat(64)}`,
    },
  });
}

function plan(overrides: { inspectPort?: () => ReturnType<NonNullable<Parameters<typeof createV4CutoverPlan>[0]["inspectPort"]>> } = {}): V4CutoverPlan {
  return createV4CutoverPlan({
    homeDirectory: "/Users/example",
    launchAgentsDirectory: "/Users/example/Library/LaunchAgents",
    platform: "darwin",
    now: () => new Date("2026-09-17T00:00:00.000Z"),
    findBinary: () => null,
    readVersion: () => null,
    inspectPort: overrides.inspectPort ?? (() => ({ port: 20128, owner: "free" as const })),
    observeHost: () => ({
      platform: "darwin",
      hardware_model: "Mac16,11",
      chip_model: "Apple M4",
      architecture: "arm64",
      user_id: process.getuid?.() ?? 501,
    }),
  });
}

describe("V4 cutover review surface", () => {
  test("binds a two-step confirmation to the exact plan and proof", () => {
    const view = createV4CutoverViewModel(plan(), proof());
    expect(view.readiness).toBe("ready");
    expect(view.pages.map(({ id }) => id)).toEqual(["overview", "actions", "managed-state", "confirmation"]);
    expect(view.pages.find(({ id }) => id === "confirmation")?.rows[0]?.details.join("\n"))
      .toContain("First confirmation arms this exact operation digest");
    const armed = advanceV4CutoverConfirmation(view, { status: "unarmed" });
    expect(armed.status).toBe("armed");
    const confirmed = advanceV4CutoverConfirmation(view, armed, () => new Date("2026-09-17T01:02:03.000Z"));
    expect(confirmed).toEqual({
      status: "confirmed",
      confirmation: {
        confirmed: true,
        operation_digest: view.operation_digest,
        confirmed_at: "2026-09-17T01:02:03.000Z",
      },
    });
  });

  test("renders activation holds but refuses to arm them", () => {
    const blockedPlan = plan({
      inspectPort: () => ({ port: 20128, owner: "unknown", pid: 999, process: "foreign" }),
    });
    const view = createV4CutoverViewModel(blockedPlan, proof());
    expect(view.readiness).toBe("blocked");
    expect(view.operation_digest).toBeUndefined();
    expect(view.blocking_reasons).toContain("ROUTER_PORT_OWNED_BY_UNMANAGED_PROCESS");
    expect(() => advanceV4CutoverConfirmation(view, { status: "unarmed" })).toThrow("CUTOVER_CONFIRMATION_BLOCKED");
  });

  test("rejects proof or plan drift before rendering", () => {
    const validPlan = plan();
    const validProof = proof();
    expect(() => createV4CutoverViewModel({ ...validPlan, plan_digest: `sha256:${"0".repeat(64)}` }, validProof))
      .toThrow("CUTOVER_REVIEW_PLAN_INVALID");
    expect(() => createV4CutoverViewModel(validPlan, { ...validProof, proof_digest: `sha256:${"0".repeat(64)}` }))
      .toThrow("CUTOVER_REVIEW_PROOF_INVALID");
  });

  test("is reachable from the CLI as a read-only JSON review", () => {
    const root = mkdtempSync(join(tmpdir(), "temperance-v4-review-cli-"));
    try {
      const planPath = join(root, "plan.json");
      const proofPath = join(root, "proof.json");
      writeFileSync(planPath, JSON.stringify(plan()));
      writeFileSync(proofPath, JSON.stringify(proof()));
      const result = Bun.spawnSync([
        "bun", "run", "src/cli.ts", "cutover-review",
        "--plan", planPath, "--proof", proofPath, "--json",
      ], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.toString()) as { readiness?: unknown; operation_digest?: unknown };
      expect(output.readiness).toBe("ready");
      expect(output.operation_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(result.stderr.toString()).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
