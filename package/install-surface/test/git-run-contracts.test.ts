import { test, expect } from "bun:test";
import { GIT_TICKET_SCHEMA, GIT_GRANT_SCHEMA, GIT_ADMISSION_SCHEMA, gitDeliveryTicketFingerprint, snapshotGitContractInput, normalizeGitDeliveryTicket } from "../src/execution/git-authority-contracts.ts";
import { buildGitRunLineage, normalizeGitRunLineage, gitRunLineageFingerprint, buildGitRunClaimReceipt, normalizeGitRunClaimReceipt } from "../src/execution/git-run-contracts.ts";
const now = Date.parse("2026-10-05T12:00:00.000Z");
const hash = (character: string) => `sha256:${character.repeat(64)}`;
function fixture() {
  const workspace = { kind: "git", project_id: "project.test", repository_identity: "github.com/example/project", capsule_id: "capsule.test",
    admission_fingerprint: hash("a"), workspace_fingerprint: hash("b"), root_fingerprint: hash("c"), source_commit: "d".repeat(40), source_fingerprint: hash("e") };
  const ticket = { schema: GIT_TICKET_SCHEMA, workspace, ticket_id: "ticket.test", plan_id: "plan.test", task_id: "task.test",
    phase: "Execute", effort: "E3", lane: "noesis-execute", outstanding_work: 1, created_at: new Date(now - 1000).toISOString() };
  const grant = { schema: GIT_GRANT_SCHEMA, workspace: structuredClone(workspace), grant_id: "grant.test", ticket_fingerprint: gitDeliveryTicketFingerprint(ticket),
    allowed_phases: ["Execute"], allowed_lanes: ["noesis-execute"], issued_at: new Date(now - 500).toISOString(), expires_at: new Date(now + 60000).toISOString(), retry_budget: 2, time_budget_ms: 10000 };
  const admission = { schema: GIT_ADMISSION_SCHEMA, mode: "context-only", workspace: structuredClone(workspace), status: "context-verified",
    observed_at: new Date(now - 100).toISOString(), expires_at: new Date(now + 1000).toISOString(), execution_authorized: false, capacity_authorization: false, lease_authorized: false };
  return { ticket, grant, admission, run_id: "run.test", claimed_at: new Date(now).toISOString(), lease_expires_at: new Date(now + 500).toISOString(), deadline_at: new Date(now + 10000).toISOString(), context_fingerprint: hash("f") };
}

test("lineage detaches actual references and holds every authority", () => {
  const f=fixture(), r=buildGitRunLineage(f);
  expect(Object.isFrozen(r)).toBe(true); expect(Object.isFrozen(r.ticket.workspace)).toBe(true);
  expect(r.ticket_id).toBe(f.ticket.ticket_id); expect(r.execution_authorized).toBe(false);
  expect(r.capacity_authorization).toBe(false); expect(r.lease_authorized).toBe(false);
  f.ticket.workspace.project_id="changed"; expect(r.project_id).toBe("project.test");
  expect(normalizeGitRunLineage(r)).toEqual(r);
});
test("replay preserves original identity timestamps and fingerprint", () => {
  const r=buildGitRunLineage(fixture()), first=buildGitRunClaimReceipt({status:"claimed",lineage:r}), replay=buildGitRunClaimReceipt({status:"replay",lineage:r});
  expect(first.lineage_fingerprint).toBe(replay.lineage_fingerprint);
  expect(replay.lineage.claimed_at).toBe(r.claimed_at); expect(replay.lineage.lease_expires_at).toBe(r.lease_expires_at);
  expect(normalizeGitRunClaimReceipt(replay)).toEqual(replay);
  expect(replay.issuer_authentication).toBe("unproved-by-source-fixture");
  expect(gitRunLineageFingerprint({...r,run_id:"run.other"})).not.toBe(first.lineage_fingerprint);
});
test("all derived identity and authority fields reject drift", () => {
  const r=buildGitRunLineage(fixture());
  for(const key of ["ticket_id","grant_id","project_id","phase","lane","effort","ticket_fingerprint","grant_fingerprint","admission_context_fingerprint","workspace_fingerprint","source_fingerprint","schema","state"])
    expect(()=>normalizeGitRunLineage({...r,[key]:"changed"})).toThrow();
  for(const key of ["execution_authorized","capacity_authorization","lease_authorized"])
    expect(()=>normalizeGitRunLineage({...r,[key]:true})).toThrow();
  expect(()=>normalizeGitRunClaimReceipt({...buildGitRunClaimReceipt({status:"claimed",lineage:r}),lineage_fingerprint:hash("0")})).toThrow();
});
test("actual nested owner bindings ticket replay and permissions reject", () => {
  for(const target of ["grant","admission"] as const) {
    const f=fixture(); f[target].workspace.root_fingerprint=hash("0"); expect(()=>buildGitRunLineage(f)).toThrow();
  }
  const f=fixture(); f.ticket.task_id="task.other"; expect(()=>buildGitRunLineage(f)).toThrow();
  const g=fixture(); g.grant.allowed_phases=["Build"];g.grant.allowed_lanes=["noesis-build"];expect(()=>buildGitRunLineage(g)).toThrow();
  const h=fixture();h.admission.status="held";expect(()=>buildGitRunLineage(h)).toThrow();
});
test("exclusive claim expiry and original time budgets bind lease", () => {
  for(const patch of [ {claimed_at:new Date(now+1000).toISOString()}, {claimed_at:new Date(now-2000).toISOString()},
    {lease_expires_at:new Date(now).toISOString()}, {lease_expires_at:new Date(now+1001).toISOString()},
    {deadline_at:new Date(now+10001).toISOString()}, {deadline_at:new Date(now).toISOString()}, {claimed_at:"2026-02-30T12:00:00.000Z"} ])
    expect(()=>buildGitRunLineage({...fixture(),...patch})).toThrow();
});
test("unsafe values fail before traps and getters", () => {
  let touched=0; const p=new Proxy(fixture(),{ownKeys(){touched++;throw Error("trap")}});
  expect(()=>buildGitRunLineage(p)).toThrow();expect(touched).toBe(0);
  const f=fixture();Object.defineProperty(f,"run_id",{enumerable:true,get(){touched++;return "run.x"}});
  expect(()=>buildGitRunLineage(f)).toThrow();expect(touched).toBe(0);
  for(const value of [null,1,"x",[],{...fixture(),extra:true},{...fixture(),run_id:"x".repeat(513)}]) expect(()=>buildGitRunLineage(value)).toThrow();
});
test("shared safe snapshots retain ordinary prototypes and normalizer compatibility", () => {
  const f=fixture(), s=snapshotGitContractInput(f.ticket);
  expect(Object.getPrototypeOf(s)).toBe(Object.prototype); expect(Object.isFrozen(s)).toBe(true);
  expect(normalizeGitDeliveryTicket(s)).toEqual(normalizeGitDeliveryTicket(f.ticket));
});
test("nested private inputs and receipt unsafe objects stay rejected", () => {
  let traps=0;
  const f=fixture(); f.ticket.workspace=new Proxy(f.ticket.workspace,{getPrototypeOf(){traps++;throw Error("trap")}});
  expect(()=>buildGitRunLineage(f)).toThrow();expect(traps).toBe(0);
  const r=buildGitRunLineage(fixture());
  expect(()=>buildGitRunClaimReceipt({status:"replay",lineage:new Proxy(r,{ownKeys(){traps++;throw Error("trap")}})})).toThrow();expect(traps).toBe(0);
  expect(()=>buildGitRunLineage({...fixture(),private_path:"/Users/private"})).toThrow();
  expect(()=>buildGitRunClaimReceipt({status:"released",lineage:r})).toThrow();
  expect(()=>normalizeGitRunLineage({...r,ticket:{...r.ticket,created_at:"2026-10-05T11:00:00.000Z"}})).toThrow();
});
