import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBareComposition, digestValue, inspectCompositionV2, invokeModuleV2, readOwnerActionStatus, type CompositionV2, type ModuleHandler, type OwnerAdapter, type OwnerResultV1, type WorkLedgerV2, type WorkReceiptV2, type WorkRequestV2 } from "../src/engine.ts";
import { createFileWorkLedger } from "../src/composition/file-ledger-v2.ts";
import { validateDescriptor } from "../src/composition/v2.ts";
import { createOrganPack, ORGAN_ROLES, pinOrganDescriptors } from "../src/modules/organs.ts";

const NOW = Date.parse("2026-11-04T00:00:00.000Z");
const SOURCE = digestValue({ fixture: "module-source" });
const OWNER = digestValue({ fixture: "owner-source" });
const AUTH = digestValue({ fixture: "authorization-source" });
const iso = (offset = 0) => new Date(NOW + offset).toISOString();

function ledger(): WorkLedgerV2 {
  const claims = new Set<string>(), receipts = new Map<string, Readonly<WorkReceiptV2>>();
  return { async claim(key) { if (receipts.has(key)) return "replay"; if (claims.has(key)) return "in-progress"; claims.add(key); return "claimed"; }, async commit(key, receipt) { receipts.set(key, receipt); } };
}
function fixture(write = false) {
  const descriptor = validateDescriptor({ schema: "temperance.module-descriptor.v1", id: "module.editorial", implementation_ref: "fixture.editorial", source_digest: SOURCE, requires: [], operations: [{ id: "triage", capability: "editing.inspect", mode: write ? "write" : "read" }] });
  const manifest: CompositionV2 = { ...createBareComposition("fixture-plant", "fixture.owner"), coordinator: { adapter_ref: "adapter.unlisted-client", source_digest: SOURCE }, flow: { owner_ref: "workflow.editorial", definition_ref: "flow.revision" }, planning_owner_ref: "planner.external", acceptance_owner_ref: "review.external", authorization_owner: { ref: "authority.fixture", source_digest: AUTH }, modules: [{ id: descriptor.id, descriptor_digest: digestValue(descriptor) }], bindings: [{ capability: "editing.inspect", owner_ref: "owner.fixture", source_digest: OWNER }] };
  const observations = { schema: "temperance.composition-observations.v2", plant_id: manifest.plant.id, source_manifest_digest: digestValue(manifest), observed_at: iso(), expires_at: iso(10000), capabilities: manifest.bindings.map(binding => ({ ...binding, state: "healthy" })) };
  const request: WorkRequestV2 = { schema: "temperance.work-request.v2", plant_id: manifest.plant.id, run_id: "fixture-run", occurrence_id: "fixture-occurrence", task_digest: digestValue({ fixture: "task" }), source_manifest_digest: digestValue(manifest), flow_ref: "workflow.editorial", step_ref: "publish.review", module_id: descriptor.id, operation_id: "triage", occurred_at: iso(), input: { fixture_body: "DO_NOT_RECORD_FIXTURE_BODY" } };
  let calls = 0;
  let lastPlan: any;
  const owner: OwnerAdapter = { ref: "owner.fixture", source_digest: OWNER, async invoke(plan) { calls++; lastPlan = plan; return { schema: "temperance.owner-action-result.v1", plan_digest: plan.plan_digest, status: "completed", receipt_ref: "fixture.receipt", artifact_refs: ["fixture.artifact"], value: { fixture: true } }; }, async status(plan) { return { schema: "temperance.owner-action-result.v1", plan_digest: plan.plan_digest, status: "completed", receipt_ref: "fixture.readback", artifact_refs: ["fixture.artifact"], value: null }; } };
  const handler: ModuleHandler = { source_digest: SOURCE, async invoke(context) { const result = await context.perform(context.request.input); return { status: result.status === "completed" ? "completed" : "held", artifact_refs: [...result.artifact_refs], reason_code: "FIXTURE_RESULT" }; } };
  const options = { manifest, descriptors: [descriptor], observations, request, handlers: { [descriptor.id]: handler }, owners: [owner], ledger: ledger(), now: () => NOW, authorization: { ref: "authority.fixture", source_digest: AUTH, async authorize(plan: any) { return { authorized: true, plan_digest: plan.plan_digest, task_digest: plan.task_digest, expires_at: iso(5000), receipt_ref: "fixture.approval" }; } } };
  return { options, descriptor, owner, calls: () => calls, lastPlan: () => lastPlan };
}

describe("neutral composition and externally owned flows", () => {
  test("action digests preserve caller array order and exact text bytes", () => {
    expect(digestValue([{ id: "first" }, { id: "second" }])).not.toBe(digestValue([{ id: "second" }, { id: "first" }]));
    expect(digestValue({ target: "e\u0301" })).not.toBe(digestValue({ target: "\u00e9" }));
  });
  test("starts without a client, personal profile, flow, router or memory owner", () => {
    const report = inspectCompositionV2(createBareComposition());
    expect(report.readiness).toBe("core-available");
    expect(report.coordinator).toBeNull(); expect(report.flow).toBeNull();
    expect(report.planning_owner_ref).toBeNull(); expect(report.acceptance_owner_ref).toBeNull();
    expect(report.modules).toEqual([]); expect(report.acceptance_asserted).toBe(false);
  });
  test("a standalone CLI runs from an empty directory without writing host state", async () => {
    const root = await mkdtemp(join(tmpdir(), "neutral-engine-"));
    try {
      const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../src/composition/engine-cli.ts"), "doctor", "--json"], { cwd: root, stdin: new Uint8Array(), env: { PATH: process.env.PATH ?? "" } });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString()).readiness).toBe("core-available");
      expect(await readdir(root)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test("unlisted clients and non-Alchemy steps use the same core", async () => {
    const f = fixture();
    expect((await invokeModuleV2(f.options)).status).toBe("completed");
    const other = fixture();
    other.options.manifest.coordinator!.adapter_ref = "adapter.headless-pipeline";
    other.options.manifest.flow!.owner_ref = "workflow.incident";
    other.options.manifest.flow!.definition_ref = "flow.external-controller";
    other.options.request.flow_ref = "workflow.incident";
    other.options.request.step_ref = "recover.approved";
    other.options.request.source_manifest_digest = digestValue(other.options.manifest);
    other.options.observations.source_manifest_digest = digestValue(other.options.manifest);
    expect((await invokeModuleV2(other.options)).status).toBe("completed");
    expect(other.calls()).toBe(1);
  });
  test("the engine does not infer a next step or enforce phase order", async () => {
    const f = fixture();
    expect((await invokeModuleV2(f.options)).step_ref).toBe("publish.review");
    f.options.request = { ...f.options.request, step_ref: "intake", occurrence_id: "fixture-second" };
    expect((await invokeModuleV2(f.options)).status).toBe("completed");
    expect(f.calls()).toBe(2);
  });
  test("missing capabilities remain held with no callback effects", async () => {
    const f = fixture(); f.options.observations.capabilities[0]!.state = "unavailable";
    expect((await invokeModuleV2(f.options)).status).toBe("held"); expect(f.calls()).toBe(0);
  });
  test("stale observations remain held", async () => {
    const f = fixture(); f.options.observations.observed_at = iso(-2000); f.options.observations.expires_at = iso(-1);
    expect((await invokeModuleV2(f.options)).status).toBe("held"); expect(f.calls()).toBe(0);
  });
  test("changed module operations cannot reuse an earlier descriptor pin", async () => {
    const f = fixture(); f.options.descriptors = [{ ...f.descriptor, operations: [{ id: "triage", capability: "editing.inspect", mode: "write" }] } as any];
    expect((await invokeModuleV2(f.options)).status).toBe("held"); expect(f.calls()).toBe(0);
  });
  test("missing handler and owner source pins are refused", async () => {
    const f = fixture(); f.options.handlers[f.descriptor.id] = { ...f.options.handlers[f.descriptor.id]!, source_digest: OWNER };
    expect((await invokeModuleV2(f.options)).reason_code).toBe("HANDLER_UNAVAILABLE_OR_PIN_MISMATCH"); expect(f.calls()).toBe(0);
    const second = fixture(); second.owner.source_digest = SOURCE;
    expect((await invokeModuleV2(second.options)).reason_code).toBe("OWNER_UNAVAILABLE_OR_PIN_MISMATCH");
  });
  test("work cannot cross a plant or flow owner", async () => {
    const f = fixture(); f.options.request.plant_id = "other-plant";
    await expect(invokeModuleV2(f.options)).rejects.toThrow("ENGINE_WORK_IDENTITY_MISMATCH");
    f.options.request.plant_id = "fixture-plant"; f.options.request.flow_ref = "workflow.other";
    await expect(invokeModuleV2(f.options)).rejects.toThrow("ENGINE_FLOW_OWNER_MISMATCH");
    expect(f.calls()).toBe(0);
  });
  test("accessors and proxies are rejected before evaluation", async () => {
    const f = fixture(); let evaluated = false;
    Object.defineProperty(f.options.request, "input", { get() { evaluated = true; return {}; }, enumerable: true });
    await expect(invokeModuleV2(f.options)).rejects.toThrow(); expect(evaluated).toBe(false);
    await expect(invokeModuleV2({ ...fixture().options, request: new Proxy({}, { get() { evaluated = true; } }) })).rejects.toThrow(); expect(evaluated).toBe(false);
  });
  test("receipt captures digests and provenance, not input or response bodies", async () => {
    const receipt = await invokeModuleV2(fixture().options);
    expect(JSON.stringify(receipt)).not.toContain("DO_NOT_RECORD_FIXTURE_BODY");
    expect(receipt.actions[0]!.receipt_ref).toBe("fixture.receipt");
    expect(receipt.acceptance_asserted).toBe(false); expect(receipt.persisted).toBe(true);
  });
});

describe("owner authority, replay and unsettled work", () => {
  test("handler registry is snapshotted before an asynchronous claim", async () => {
    const f = fixture(); let getter = false;
    f.options.ledger.claim = async () => { Object.defineProperty(f.options.handlers[f.descriptor.id]!, "invoke", { enumerable: true, get() { getter = true; throw new Error("late accessor"); } }); return "claimed"; };
    expect((await invokeModuleV2(f.options)).status).toBe("completed"); expect(getter).toBe(false); expect(f.calls()).toBe(1);
  });
  test("observation snapshots cannot be extended while a claim is pending", async () => {
    const f = fixture(); let delayed = false;
    f.options.observations.expires_at = iso(1);
    f.options.now = () => delayed ? NOW + 2 : NOW;
    f.options.ledger.claim = async () => { f.options.observations.expires_at = iso(1000); delayed = true; return "claimed"; };
    const receipt = await invokeModuleV2(f.options);
    expect(receipt.status).toBe("held"); expect(f.calls()).toBe(0);
  });
  test("write requires a matching owner approval, then records the actual action", async () => {
    const f = fixture(true); const receipt = await invokeModuleV2(f.options);
    expect(receipt.status).toBe("completed"); expect(receipt.actions[0]!.mode).toBe("write"); expect(f.calls()).toBe(1);
  });
  test("owner refusal and a substituted approval cannot execute", async () => {
    const f = fixture(true); f.options.authorization.authorize = async plan => ({ authorized: false, plan_digest: plan.plan_digest, task_digest: plan.task_digest, expires_at: iso(5000), receipt_ref: "fixture.denied" });
    expect((await invokeModuleV2(f.options)).status).toBe("held"); expect(f.calls()).toBe(0);
    const other = fixture(true); other.options.authorization.authorize = async plan => ({ authorized: true, plan_digest: SOURCE, task_digest: plan.task_digest, expires_at: iso(5000), receipt_ref: "fixture.wrong-plan" });
    expect((await invokeModuleV2(other.options)).status).toBe("held"); expect(other.calls()).toBe(0);
  });
  test("approval expiring between validation and dispatch is refused", async () => {
    const f = fixture(true); let afterApproval = false, reads = 0;
    f.options.now = () => afterApproval && ++reads >= 2 ? NOW + 2 : NOW;
    f.options.authorization.authorize = async plan => { afterApproval = true; return { authorized: true, plan_digest: plan.plan_digest, task_digest: plan.task_digest, expires_at: iso(1), receipt_ref: "fixture.expiring" }; };
    expect((await invokeModuleV2(f.options)).status).toBe("held"); expect(f.calls()).toBe(0);
  });
  test("a different occurrence cannot replay an already completed step", async () => {
    const f = fixture(); expect((await invokeModuleV2(f.options)).status).toBe("completed");
    f.options.request = { ...f.options.request, occurrence_id: "different-occurrence" };
    expect((await invokeModuleV2(f.options)).status).toBe("replay"); expect(f.calls()).toBe(1);
  });
  test("concurrent claims invoke only one callback", async () => {
    const f = fixture(); const receipts = await Promise.all([invokeModuleV2(f.options), invokeModuleV2(f.options)]);
    expect(receipts.map(receipt => receipt.status).sort()).toEqual(["completed", "in-progress"]); expect(f.calls()).toBe(1);
  });
  test("an unsettled owner times out as indeterminate and stays claimed", async () => {
    const f = fixture(true); let cancelled = false;
    f.owner.invoke = async (_plan, _input, signal) => { signal.addEventListener("abort", () => { cancelled = true; }); return await new Promise<OwnerResultV1>(() => {}); };
    const receipt = await invokeModuleV2({ ...f.options, timeout_ms: 5 });
    expect(receipt.status).toBe("indeterminate"); expect(receipt.callback_settled).toBe(false); expect(cancelled).toBe(true);
    expect((await invokeModuleV2(f.options)).status).toBe("replay");
  });
  test("an already cancelled request cannot reach an owner", async () => {
    const f = fixture(true); const controller = new AbortController(); controller.abort();
    const receipt = await invokeModuleV2({ ...f.options, signal: controller.signal });
    expect(receipt.status).toBe("held"); expect(receipt.reason_code).toBe("WORK_CANCELLED");
    expect(receipt.cancellation_requested).toBe(true); expect(f.calls()).toBe(0);
  });
  test("caller cancellation reaches an unsettled owner and cannot replay it", async () => {
    const f = fixture(true); const controller = new AbortController(); let cancelled = false;
    f.owner.invoke = async (_plan, _input, signal) => {
      signal.addEventListener("abort", () => { cancelled = true; });
      controller.abort();
      return await new Promise<OwnerResultV1>(() => {});
    };
    const receipt = await invokeModuleV2({ ...f.options, signal: controller.signal });
    expect(cancelled).toBe(true); expect(receipt.cancellation_requested).toBe(true);
    expect(receipt.status).toBe("indeterminate"); expect(receipt.callback_settled).toBe(false);
    expect((await invokeModuleV2(f.options)).status).toBe("replay");
  });
  test("wrong owner readback identity remains indeterminate", async () => {
    const f = fixture(true); f.owner.invoke = async () => ({ schema: "temperance.owner-action-result.v1", plan_digest: SOURCE, status: "completed", receipt_ref: "fixture.wrong", artifact_refs: [], value: null });
    expect((await invokeModuleV2(f.options)).status).toBe("indeterminate");
  });
  test("commit failure stays uncertain without retrying the effect", async () => {
    const f = fixture(true); f.options.ledger.commit = async () => { throw new Error("fixture disk failure"); };
    const receipt = await invokeModuleV2(f.options);
    expect(receipt.status).toBe("persistence-failed"); expect(receipt.persisted).toBe(false);
    expect((await invokeModuleV2(f.options)).status).toBe("in-progress"); expect(f.calls()).toBe(1);
  });
  test("readback asks the same owner for status without invoking again", async () => {
    const f = fixture(true); await invokeModuleV2(f.options);
    expect((await readOwnerActionStatus(f.owner, f.lastPlan())).receipt_ref).toBe("fixture.readback"); expect(f.calls()).toBe(1);
    await expect(readOwnerActionStatus(f.owner, { ...f.lastPlan(), step_ref: "tampered" })).rejects.toThrow("ENGINE_ACTION_IDENTITY_MISMATCH");
  });
  test("durable file claims survive adapter restart and refuse takeover", async () => {
    const root = await mkdtemp(join(tmpdir(), "engine-ledger-"));
    try {
      const identity = digestValue({ fixture: "interrupted" });
      expect(await createFileWorkLedger(root).claim(identity)).toBe("claimed");
      expect(await createFileWorkLedger(root).claim(identity)).toBe("in-progress");
      const f = fixture(); f.options.ledger = createFileWorkLedger(root);
      const receipt = await invokeModuleV2(f.options);
      expect(receipt.persisted).toBe(true);
      expect(await createFileWorkLedger(root).claim(receipt.identity_digest)).toBe("replay");
      const persisted = await readFile(join(root, receipt.identity_digest.slice(7) + ".json"), "utf8");
      expect(persisted).not.toContain("DO_NOT_RECORD_FIXTURE_BODY");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

function organFixture(role: typeof ORGAN_ROLES[number]) {
  const pack = createOrganPack(SOURCE);
  const bindings = [...new Set(pack.descriptors.flatMap(d => d.operations.map(op => op.capability)))].map(capability => ({ capability, owner_ref: "owner.fixture", source_digest: OWNER }));
  const manifest: CompositionV2 = { ...createBareComposition("fixture-plant", "fixture.owner"), flow: { owner_ref: "workflow.custom", definition_ref: "flow.external" }, authorization_owner: { ref: "authority.fixture", source_digest: AUTH }, modules: pinOrganDescriptors(pack.descriptors), bindings };
  const descriptor = pack.descriptors.find(d => d.id === "organ." + role)!;
  const selected = descriptor.operations.find(op => op.mode === "write")!.id;
  let invoked = 0;
  const owner: OwnerAdapter = { ref: "owner.fixture", source_digest: OWNER, async invoke(plan, raw) {
    invoked++; const input = raw as any;
    const disposition = selected === "harvest" ? "verified-recorded" : selected === "recover" ? "recovered" : ["propose", "draft"].includes(selected) ? "proposed" : "observed";
    return { schema: "temperance.owner-action-result.v1", plan_digest: plan.plan_digest, status: "completed", receipt_ref: "fixture.receipt", artifact_refs: ["fixture.role-result"], value: { kind: role, subject_ref: input.subject_ref, evidence_refs: input.evidence_refs, planes: [{ plane_ref: "fixture.source-plane", evidence_refs: input.evidence_refs }], proposal_ref: input.proposal_ref, action_ref: input.action_ref, disposition } };
  } };
  const request: WorkRequestV2 = { schema: "temperance.work-request.v2", plant_id: manifest.plant.id, run_id: "fixture-organ-run", occurrence_id: "fixture-organ-occurrence", task_digest: SOURCE, source_manifest_digest: digestValue(manifest), flow_ref: "workflow.custom", step_ref: "step." + role, module_id: descriptor.id, operation_id: selected, occurred_at: iso(), input: { subject_ref: "fixture.subject", evidence_refs: ["fixture.signed-outcome"], proposal_ref: "fixture.reviewed-proposal", action_ref: role === "auspex" ? "recovery.named-action" : null } };
  const observations = { schema: "temperance.composition-observations.v2", plant_id: manifest.plant.id, source_manifest_digest: digestValue(manifest), observed_at: iso(), expires_at: iso(10000), capabilities: bindings.map(binding => ({ ...binding, state: "healthy" })) };
  const options = { manifest, descriptors: pack.descriptors, observations, request, handlers: pack.handlers, owners: [owner], authorization: fixture(true).options.authorization, ledger: ledger(), now: () => NOW };
  return { options, owner, calls: () => invoked };
}

describe("optional six-organ package", () => {
  for (const role of ORGAN_ROLES) {
    test(role + " invokes its configured owner and retains provenance", async () => {
      const f = organFixture(role); const receipt = await invokeModuleV2(f.options);
      expect(receipt.status).toBe("completed"); expect(f.calls()).toBe(1);
      expect(receipt.artifact_refs).toEqual(["fixture.role-result"]); expect(receipt.acceptance_asserted).toBe(false);
    });
    test(role + " holds absent dependencies and stale evidence", async () => {
      const absent = organFixture(role); absent.options.observations.capabilities = [];
      expect((await invokeModuleV2(absent.options)).status).toBe("held"); expect(absent.calls()).toBe(0);
      const stale = organFixture(role); stale.options.observations.expires_at = iso(-1); stale.options.observations.observed_at = iso(-2000);
      expect((await invokeModuleV2(stale.options)).status).toBe("held"); expect(stale.calls()).toBe(0);
    });
    test(role + " refuses wrong identities, cancellation and owner refusal", async () => {
      const wrong = organFixture(role); wrong.options.request.plant_id = "other-plant";
      await expect(invokeModuleV2(wrong.options)).rejects.toThrow("ENGINE_WORK_IDENTITY_MISMATCH"); expect(wrong.calls()).toBe(0);
      const cancelled = organFixture(role); const controller = new AbortController(); controller.abort();
      expect((await invokeModuleV2({ ...cancelled.options, signal: controller.signal })).status).toBe("held"); expect(cancelled.calls()).toBe(0);
      const refused = organFixture(role); const approve = refused.options.authorization.authorize;
      refused.options.authorization.authorize = async plan => ({ ...await approve(plan), authorized: false });
      expect((await invokeModuleV2(refused.options)).status).toBe("held"); expect(refused.calls()).toBe(0);
    });
    test(role + " holds concurrent replay, persistence failure and uncertain owner results", async () => {
      const f = organFixture(role); const results = await Promise.all([invokeModuleV2(f.options), invokeModuleV2(f.options)]);
      expect(results.map(r => r.status).sort()).toEqual(["completed", "in-progress"]); expect(f.calls()).toBe(1);
      const failed = organFixture(role); failed.options.ledger.commit = async () => { throw new Error("FIXTURE_DISK_UNAVAILABLE"); };
      expect((await invokeModuleV2(failed.options)).status).toBe("persistence-failed"); expect(failed.calls()).toBe(1);
      const unknown = organFixture(role); unknown.owner.invoke = async plan => ({ schema: "temperance.owner-action-result.v1", plan_digest: plan.plan_digest, status: "indeterminate", receipt_ref: null, artifact_refs: [], value: null });
      expect((await invokeModuleV2(unknown.options)).status).toBe("indeterminate");
    });
  }
  test("promotion readback binds the exact proposal and recovery names its action", async () => {
    const promotion = organFixture("praeceptor"); promotion.options.request.operation_id = "promote";
    const original = promotion.owner.invoke;
    promotion.owner.invoke = async (...args) => { const r = await original(...args); return { ...r, value: { ...(r.value as any), proposal_ref: "different.proposal", disposition: "reviewed-promoted" } }; };
    expect((await invokeModuleV2(promotion.options)).status).toBe("indeterminate");
    const recovery = organFixture("auspex"); (recovery.options.request.input as any).action_ref = null;
    expect((await invokeModuleV2(recovery.options)).reason_code).toBe("NAMED_RECOVERY_REQUIRED"); expect(recovery.calls()).toBe(0);
  });
  test("unverified learning cannot be treated as verified delivery", async () => {
    const f = organFixture("nutrix"); const original = f.owner.invoke;
    f.owner.invoke = async (...args) => { const r = await original(...args); return { ...r, value: { ...(r.value as any), disposition: "proposed" } }; };
    expect((await invokeModuleV2(f.options)).status).toBe("indeterminate");
  });
});
