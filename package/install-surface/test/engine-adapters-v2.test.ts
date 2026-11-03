import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { digestValue, type Digest } from "../src/composition/boundary.ts";
import { guideClientInstallation, normalizeClientSignal } from "../src/modules/clients.ts";
import { createOnboardingOperationOwner } from "../src/modules/installation.ts";
import { createFileOperationReceiptSink } from "../src/onboarding/operation-executor.ts";
import { calculateOnboardingPlanDigest } from "../src/onboarding/planner.ts";
import type { OnboardingPlanV1, OnboardingProfileV1 } from "../src/onboarding/contracts.ts";
import type { ActionPlanV1 } from "../src/composition/runtime-v2.ts";

const SOURCE = digestValue({ fixture: "source" });
const SIGNAL = new AbortController().signal;
const integrity = "sha512-" + "a".repeat(86) + "==";

describe("optional primary client adapters", () => {
  test("vendor installation and upgrade guidance requires exact versions and integrity", () => {
    expect(guideClientInstallation("codex-cli", "0.166.0", integrity, "install").argv).toEqual(["npm", "install", "--global", "@openai/codex@0.166.0"]);
    expect(guideClientInstallation("claude-code", "2.1.316", integrity, "update").version_probe).toEqual(["claude", "--version"]);
    expect(() => guideClientInstallation("codex-cli", "latest", integrity, "install")).toThrow("CLIENT_INSTALL_PIN_REQUIRED");
    expect(() => guideClientInstallation("codex-cli", "0.166.0", "", "install")).toThrow();
  });
  test("both clients accept an external event mapping without imposing a flow", () => {
    for (const client of ["codex-cli", "claude-code"] as const) {
      const signal = normalizeClientSignal(client, { event_name: "SessionStart", run_ref: "fixture.run", occurrence_ref: "fixture.start" }, { SessionStart: "editorial.open" }, SOURCE);
      expect(signal.signal_ref).toBe("editorial.open"); expect(signal.effect_authorized).toBe(false);
      expect(normalizeClientSignal(client, { event_name: "SessionEnd", run_ref: "fixture.run", occurrence_ref: "fixture.end" }, {}, SOURCE).status).toBe("unmapped");
    }
  });
  test("untranslated native envelopes and private fields are refused", () => {
    expect(() => normalizeClientSignal("codex-cli", { event_name: "SessionStart", run_ref: "fixture.run", occurrence_ref: "fixture.start", session_id: "fixture-native-id" }, {}, SOURCE)).toThrow();
  });
});

async function ownerFixture(fresh = false) {
  const root = await mkdtemp(join(tmpdir(), "engine-install-owner-"));
  const target = join(root, "artifact.txt"), receipts = join(root, "receipts");
  if (!fresh) await writeFile(target, "old-bytes");
  const inputDigests: Record<string, Digest> = { "operation.target": digestValue({ target_ref: "fixture.target" }), "operation.versions": digestValue({ before: fresh ? null : "1.0.0", after: "2.0.0" }), "operation.preimages": digestValue(fresh ? { exists: false } : "old-bytes") };
  const base: Omit<OnboardingPlanV1, "generated_at" | "plan_digest"> = { schema: "temperance.onboarding.plan.v1", version: { major: 1, minor: 0 }, profile_id: "fixture-neutral", dry_run: true, operating_mode: "ready", install_order: ["artifact.fixture"], modules: [], project_enrollments: [], project_candidates: [], project_discovery_findings: [], configuration_inputs: Object.entries(inputDigests).map(([id, digest]) => ({ id, digest, details: ["fixture-only"] })) };
  const plan: OnboardingPlanV1 = { ...base, generated_at: "2026-11-04T00:00:00.000Z", plan_digest: calculateOnboardingPlanDigest(base) };
  const profile: OnboardingProfileV1 = { schema: "temperance.onboarding.profile.v1", version: { major: 1, minor: 0 }, id: "fixture-neutral", variables: {}, secret_references: {}, preselected_modules: [], routing_aliases: [], project_enrollments: [] };
  let applies = 0, fail = false, concurrent = false;
  async function preimage() {
    try { return digestValue(await readFile(target, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return digestValue({ exists: false }); throw error; }
  }
  const owner = createOnboardingOperationOwner({
    ref: "owner.installation", source_digest: SOURCE,
    async resolve(_reference, action) {
      if (action.task_digest !== SOURCE) throw new Error("OWNER_TASK_NOT_ADMITTED");
      return { plan, profile, confirmation: { confirmed: true, plan_digest: plan.plan_digest, confirmed_at: plan.generated_at }, receiptSink: createFileOperationReceiptSink(receipts), effectors: [{ module_id: "artifact.fixture", async apply() {
        if (await preimage() !== inputDigests["operation.preimages"]) throw new Error("OWNER_PREIMAGE_CHANGED");
        applies++; await writeFile(target, "new-bytes");
        if (fail) { if (concurrent) await writeFile(target, "concurrent-edit"); throw new Error("FIXTURE_INTERRUPTED_APPLY"); }
      }, async rollback() {
        const current = await readFile(target, "utf8");
        if (current !== "new-bytes") throw new Error("OWNER_ROLLBACK_DRIFT");
        if (fresh) await rm(target); else await writeFile(target, "old-bytes");
      } }] };
    },
    async observeInputs() { return { ...inputDigests, "operation.preimages": await preimage() }; },
    async read(operation_id) {
      try { return JSON.parse(await readFile(join(receipts, operation_id + ".json"), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    },
  });
  const unsigned = { schema: "temperance.owner-action-plan.v1" as const, plant_id: "fixture-plant", run_id: "fixture-run", task_digest: SOURCE, source_manifest_digest: SOURCE, flow_ref: "flow.external", step_ref: "install.selected", module_id: "module.installation", operation_id: "update", capability: "installation.apply", owner_ref: owner.ref, owner_source_digest: SOURCE, mode: "write" as const, input_digest: digestValue({ operation_ref: "fixture.update", plan_digest: plan.plan_digest }) };
  const action: ActionPlanV1 = { ...unsigned, plan_digest: digestValue(unsigned) };
  return { root, target, owner, action, input: { operation_ref: "fixture.update", plan_digest: plan.plan_digest }, applies: () => applies, interrupt: (withConcurrent = false) => { fail = true; concurrent = withConcurrent; } };
}

describe("existing installation owner bridge", () => {
  test("updates a disposable target and reads the existing durable receipt", async () => {
    const f = await ownerFixture();
    try {
      const result = await f.owner.invoke(f.action, f.input, SIGNAL);
      expect(result.status).toBe("completed"); expect(await readFile(f.target, "utf8")).toBe("new-bytes");
      expect((await f.owner.status!(f.action, SIGNAL)).status).toBe("completed");
      expect((await f.owner.invoke(f.action, f.input, SIGNAL)).receipt_ref).toBe(result.receipt_ref);
      expect(f.applies()).toBe(1); expect(JSON.stringify(result)).not.toContain(f.root);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
  test("changed preimages are refused before the first mutation", async () => {
    const f = await ownerFixture();
    try {
      await writeFile(f.target, "concurrent-edit");
      await expect(f.owner.invoke(f.action, f.input, SIGNAL)).rejects.toThrow("INSTALL_OWNER_PRECONDITION_MISMATCH");
      expect(await readFile(f.target, "utf8")).toBe("concurrent-edit"); expect(f.applies()).toBe(0);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
  test("fresh and interrupted installation touch only receipt-owned disposable files", async () => {
    const f = await ownerFixture(true), interrupted = await ownerFixture(true);
    try {
      expect((await f.owner.invoke(f.action, f.input, SIGNAL)).status).toBe("completed");
      expect(await readFile(f.target, "utf8")).toBe("new-bytes");
      interrupted.interrupt();
      expect((await interrupted.owner.invoke(interrupted.action, interrupted.input, SIGNAL)).status).toBe("held");
      await expect(readFile(interrupted.target)).rejects.toHaveProperty("code", "ENOENT");
    } finally { await rm(f.root, { recursive: true, force: true }); await rm(interrupted.root, { recursive: true, force: true }); }
  });
  test("rollback refuses to overwrite a concurrent edit", async () => {
    const f = await ownerFixture();
    try {
      f.interrupt(true); const result = await f.owner.invoke(f.action, f.input, SIGNAL);
      expect(result.status).toBe("indeterminate"); expect(await readFile(f.target, "utf8")).toBe("concurrent-edit");
      expect((result.value as any).rollback_status).toBe("failed");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
  test("an interrupted apply uses the existing compensation path", async () => {
    const f = await ownerFixture();
    try {
      f.interrupt(); const result = await f.owner.invoke(f.action, f.input, SIGNAL);
      expect(result.status).toBe("held"); expect(await readFile(f.target, "utf8")).toBe("old-bytes");
      expect((result.value as any).rollback_status).toBe("completed");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
  test("unadmitted task and substituted operation plan are refused", async () => {
    const f = await ownerFixture();
    try {
      await expect(f.owner.invoke({ ...f.action, task_digest: digestValue("other-task") }, f.input, SIGNAL)).rejects.toThrow("OWNER_TASK_NOT_ADMITTED");
      await expect(f.owner.invoke(f.action, { ...f.input, plan_digest: SOURCE }, SIGNAL)).rejects.toThrow("INSTALL_OWNER_PLAN_MISMATCH");
      expect(f.applies()).toBe(0);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
