import { readFileSync } from "node:fs";
import { test, expect } from "bun:test";
import {
  validateGitPhaseLane, isCanonicalGitRepositoryIdentity, GIT_TICKET_SCHEMA, GIT_GRANT_SCHEMA, GIT_ADMISSION_SCHEMA, GIT_PHASE_LANES,
  normalizeGitDeliveryTicket, normalizeGitExecutionGrant, normalizeGitAdmissionContext,
  gitDeliveryTicketFingerprint, gitExecutionGrantFingerprint, gitAdmissionContextFingerprint,
  evaluateGitAuthorityEligibility,
} from "../src/execution/git-authority-contracts.ts";
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
  return { ticket, grant, admission, expected_grant_fingerprint: gitExecutionGrantFingerprint(grant), now, retries_used: 0, elapsed_ms: 0 };
}
const reject = (work: () => unknown) => expect(work).toThrow("GIT_AUTHORITY_INVALID_INPUT");
function rebind(f: ReturnType<typeof fixture>) { f.grant.ticket_fingerprint = gitDeliveryTicketFingerprint(f.ticket); reviewGrant(f); }
function reviewGrant(f: ReturnType<typeof fixture>) { f.expected_grant_fingerprint = gitExecutionGrantFingerprint(f.grant); }

test("valid context eligibility keeps actual claim and all authority held", () => {
  const f = fixture(), before = JSON.stringify(f);
  const result = evaluateGitAuthorityEligibility(f);
  expect(result.context_eligible).toBe(true);
  expect(result.reason_code).toBe("context-eligible");
  expect(result.claim_status).toBe("held-authority-migration");
  expect(result.execution_authorized).toBe(false); expect(result.capacity_authorization).toBe(false); expect(result.lease_authorized).toBe(false);
  expect(JSON.stringify(f)).toBe(before);
  expect(Object.isFrozen(result)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/superset|\/Users\/|\/Volumes\//i);
});

test("normalization detaches and recursively freezes contracts", () => {
  const f = fixture();
  const ticket = normalizeGitDeliveryTicket(f.ticket), grant = normalizeGitExecutionGrant(f.grant), admission = normalizeGitAdmissionContext(f.admission);
  expect(Object.isFrozen(ticket.workspace)).toBe(true); expect(Object.isFrozen(grant.allowed_lanes)).toBe(true);
  expect(Object.isFrozen(admission.workspace)).toBe(true); expect(ticket.workspace).not.toBe(f.ticket.workspace);
  f.ticket.workspace.project_id = "mutated"; expect(ticket.workspace.project_id).toBe("project.test");
});

test("all canonical fingerprints remain stable across object and permission permutations", () => {
  const f = fixture(); f.grant.allowed_phases = ["Execute", "Build"]; f.grant.allowed_lanes = ["noesis-execute", "noesis-build"];
  const first = gitExecutionGrantFingerprint(f.grant);
  f.grant.allowed_phases.reverse(); f.grant.allowed_lanes.reverse();
  expect(gitExecutionGrantFingerprint(f.grant)).toBe(first);
  const reordered = Object.fromEntries(Object.entries(f.ticket).reverse());
  expect(gitDeliveryTicketFingerprint(reordered)).toBe(gitDeliveryTicketFingerprint(f.ticket));
  expect(gitAdmissionContextFingerprint(f.admission)).toMatch(/^sha256:[a-f0-9]{64}$/);
});

for (const key of ["project_id", "repository_identity", "capsule_id", "admission_fingerprint", "workspace_fingerprint", "root_fingerprint", "source_commit", "source_fingerprint"] as const) {
  test(`exact ${key} binding rejects grant and admission drift`, () => {
    for (const target of ["grant", "admission"] as const) {
      const f = fixture();
      (f[target].workspace as Record<string,string>)[key] = key.endsWith("fingerprint") ? hash("f") : key === "repository_identity" ? "github.com/example/other" : key === "source_commit" ? "f".repeat(40) : "other";
      expect(evaluateGitAuthorityEligibility(f).reason_code).toBe("workspace-binding-mismatch");
    }
  });
}

test("ticket task, plan, identity and phase drift require exact regrant", () => {
  for (const key of ["ticket_id", "plan_id", "task_id"] as const) {
    const f = fixture(); f.ticket[key] = "changed"; expect(evaluateGitAuthorityEligibility(f).reason_code).toBe("ticket-fingerprint-mismatch");
    rebind(f); expect(evaluateGitAuthorityEligibility(f).context_eligible).toBe(true);
  }
  const phase = fixture(); phase.ticket.phase = "Build"; phase.ticket.lane = "noesis-build";
  expect(evaluateGitAuthorityEligibility(phase).reason_code).toBe("ticket-fingerprint-mismatch");
  rebind(phase); expect(evaluateGitAuthorityEligibility(phase).reason_code).toBe("phase-not-allowed");
});

test("exclusive grant and admission timing, future ticket and grant ordering", () => {
  const grant = fixture(); grant.now = Date.parse(grant.grant.expires_at); expect(evaluateGitAuthorityEligibility(grant).reason_code).toBe("grant-expired");
  const admission = fixture(); admission.now = Date.parse(admission.admission.expires_at); expect(evaluateGitAuthorityEligibility(admission).reason_code).toBe("admission-expired");
  const future = fixture(); future.grant.issued_at = new Date(now + 1).toISOString(); reviewGrant(future); expect(evaluateGitAuthorityEligibility(future).reason_code).toBe("grant-not-active");
  const futureAdmission = fixture(); futureAdmission.admission.observed_at = new Date(now + 1).toISOString(); expect(evaluateGitAuthorityEligibility(futureAdmission).reason_code).toBe("admission-not-active");
  const ticket = fixture(); ticket.ticket.created_at = new Date(now + 1).toISOString(); rebind(ticket); expect(evaluateGitAuthorityEligibility(ticket).reason_code).toBe("ticket-future");
  const oldGrant = fixture(); oldGrant.grant.issued_at = new Date(now - 1001).toISOString(); reviewGrant(oldGrant); expect(evaluateGitAuthorityEligibility(oldGrant).reason_code).toBe("grant-before-ticket");
});

test("held admission, retries, elapsed time and zero outstanding work", () => {
  const held = fixture(); held.admission.status = "held"; expect(evaluateGitAuthorityEligibility(held).reason_code).toBe("admission-held");
  const retry = fixture(); retry.retries_used = 2; expect(evaluateGitAuthorityEligibility(retry).context_eligible).toBe(true);
  retry.retries_used = 3; expect(evaluateGitAuthorityEligibility(retry).reason_code).toBe("retry-budget-exhausted");
  const elapsed = fixture(); elapsed.elapsed_ms = 9999; expect(evaluateGitAuthorityEligibility(elapsed).context_eligible).toBe(true);
  elapsed.elapsed_ms = 10000; expect(evaluateGitAuthorityEligibility(elapsed).reason_code).toBe("time-budget-exhausted");
  const empty = fixture(); empty.ticket.outstanding_work = 0; rebind(empty); expect(evaluateGitAuthorityEligibility(empty).reason_code).toBe("no-outstanding-work");
});

test("allowed phases must include selected pair and cannot invent permission lanes", () => {
  const f = fixture(); f.grant.allowed_phases = ["Observe", "Learn"]; f.grant.allowed_lanes = ["noesis-observe"]; reviewGrant(f);
  expect(evaluateGitAuthorityEligibility(f).reason_code).toBe("phase-not-allowed");
  reject(() => normalizeGitExecutionGrant({ ...f.grant, allowed_lanes: ["noesis-execute"] }));
  reject(() => normalizeGitExecutionGrant({ ...f.grant, allowed_phases: ["Observe", "Observe"] }));
  reject(() => normalizeGitExecutionGrant({ ...f.grant, allowed_lanes: ["noesis-observe", "noesis-observe"] }));
  reject(() => normalizeGitExecutionGrant({ ...f.grant, allowed_lanes: ["sol"] }));
});

test("legacy contracts and fake Superset identities cannot become Git context", () => {
  const f = fixture();
  reject(() => normalizeGitDeliveryTicket({ ...f.ticket, schema: "temperance.delivery-ticket.v1" }));
  reject(() => normalizeGitExecutionGrant({ ...f.grant, schema: "temperance.execution-grant.v1" }));
  reject(() => normalizeGitAdmissionContext({ ...f.admission, schema: "temperance.project-admission-envelope.v1" }));
  reject(() => normalizeGitDeliveryTicket({ ...f.ticket, superset_project_id: "fake", workspace_id: "fake" }));
  reject(() => normalizeGitDeliveryTicket({ ...f.ticket, workspace: { ...f.ticket.workspace, kind: "superset" } }));
});

test("strict shape/privacy boundaries reject malformed primitives and unknown fields", () => {
  const f = fixture();
  for (const value of [null, undefined, [], true, 1, "text", Object.create(null)]) reject(() => normalizeGitDeliveryTicket(value));
  for (const patch of [{ extra: false }, { ticket_id: "/private/path" }, { ticket_id: "user@example.com" }, { outstanding_work: NaN }, { outstanding_work: -1 }, { outstanding_work: 1.5 }, { created_at: "2026-02-30T00:00:00.000Z" }, { created_at: "2026-10-05T12:00:00Z" }, { lane: "wrong" }, { ticket_id: "x".repeat(65537) }]) reject(() => normalizeGitDeliveryTicket({ ...f.ticket, ...patch }));
  reject(() => normalizeGitDeliveryTicket({ ...f.ticket, workspace: { ...f.ticket.workspace, path: "/private/root" } }));
  reject(() => normalizeGitDeliveryTicket({ ...f.ticket, workspace: { ...f.ticket.workspace, root_fingerprint: "raw-private" } }));
  reject(() => normalizeGitDeliveryTicket({ ...f.ticket, workspace: { ...f.ticket.workspace, repository_identity: "github.com/Example/Project" } }));
  for (const key of ["execution_authorized", "capacity_authorization", "lease_authorized"]) reject(() => normalizeGitAdmissionContext({ ...f.admission, [key]: true }));
  reject(() => normalizeGitAdmissionContext({ ...f.admission, expires_at: f.admission.observed_at }));
  reject(() => normalizeGitAdmissionContext({ ...f.admission, expires_at: new Date(now + 300001).toISOString() }));
  reject(() => normalizeGitExecutionGrant({ ...f.grant, expires_at: f.grant.issued_at }));
  for (const patch of [{ retry_budget: 101 }, { retry_budget: -1 }, { time_budget_ms: 0 }, { time_budget_ms: 604800001 }]) reject(() => normalizeGitExecutionGrant({ ...f.grant, ...patch }));
  for (const patch of [{ now: NaN }, { now: -1 }, { retries_used: -1 }, { elapsed_ms: 1.5 }, { extra: false }]) reject(() => evaluateGitAuthorityEligibility({ ...f, ...patch }));
});

test("root/nested proxies and accessors are rejected without invoking caller code", () => {
  const f = fixture(); let traps = 0;
  const proxy = (value: object) => new Proxy(value, { getPrototypeOf() { traps++; throw new Error("private"); }, ownKeys() { traps++; throw new Error("private"); }, get() { traps++; throw new Error("private"); } });
  reject(() => normalizeGitDeliveryTicket(proxy(f.ticket)));
  reject(() => normalizeGitDeliveryTicket({ ...f.ticket, workspace: proxy(f.ticket.workspace) }));
  reject(() => normalizeGitExecutionGrant({ ...f.grant, allowed_phases: proxy(f.grant.allowed_phases) }));
  reject(() => evaluateGitAuthorityEligibility(proxy(f)));
  const getter = { ...f.ticket }; Object.defineProperty(getter, "ticket_id", { enumerable: true, get() { traps++; throw new Error("private"); } });
  reject(() => normalizeGitDeliveryTicket(getter));
  expect(traps).toBe(0);
  const hidden = { ...f.ticket }; Object.defineProperty(hidden, "hidden", { value: false }); reject(() => normalizeGitDeliveryTicket(hidden));
  const symbol = { ...f.ticket, [Symbol("private")]: false }; reject(() => normalizeGitDeliveryTicket(symbol));
  const sparse = new Array(1); reject(() => normalizeGitExecutionGrant({ ...f.grant, allowed_phases: sparse }));
  const custom = ["Execute"]; Object.assign(custom, { extra: false }); reject(() => normalizeGitExecutionGrant({ ...f.grant, allowed_phases: custom }));
  const cyclic = { ...f.ticket }; cyclic.workspace = cyclic as never; reject(() => normalizeGitDeliveryTicket(cyclic));
});

test("repeat eligibility remains evidence and does not pretend to reject consumed grants", () => {
  const f = fixture(); const first = evaluateGitAuthorityEligibility(f), second = evaluateGitAuthorityEligibility(f);
  expect(second).toEqual(first); expect(second.claim_status).toBe("held-authority-migration");
  const changedTask = fixture(); changedTask.ticket.task_id = "other";
  expect(evaluateGitAuthorityEligibility(changedTask).reason_code).toBe("ticket-fingerprint-mismatch");
});

test("phase/lane policy is frozen and cannot be expanded by a caller", () => {
  expect(Object.isFrozen(GIT_PHASE_LANES)).toBe(true);
  expect(Object.isFrozen(GIT_PHASE_LANES.Execute)).toBe(true);
  expect(() => (GIT_PHASE_LANES.Execute as unknown as string[]).push("other")).toThrow();
  expect(() => normalizeGitDeliveryTicket({ ...fixture().ticket, lane: "other" })).toThrow("GIT_AUTHORITY_INVALID_INPUT");
});

test("reviewed grant fingerprint binds timestamps permissions and budgets", () => {
  for (const patch of [{issued_at:new Date(now-499).toISOString()}, {expires_at:new Date(now+60001).toISOString()}, {retry_budget:3}, {time_budget_ms:10001}, {allowed_phases:["Execute","Build"],allowed_lanes:["noesis-execute","noesis-build"]}]) {
    const f=fixture(); Object.assign(f.grant,patch); expect(evaluateGitAuthorityEligibility(f).reason_code).toBe("grant-fingerprint-mismatch");
    reviewGrant(f); expect(evaluateGitAuthorityEligibility(f).context_eligible).toBe(true);
  }
  const f=fixture(); f.ticket.created_at=new Date(now-999).toISOString(); expect(evaluateGitAuthorityEligibility(f).reason_code).toBe("ticket-fingerprint-mismatch");
  rebind(f); expect(evaluateGitAuthorityEligibility(f).context_eligible).toBe(true);
});
test("PlanMax effort and public map parity", () => {
 const map=JSON.parse(readFileSync(new URL("../../router/phase-combo-map.json",import.meta.url),"utf8"));
 for(const [phase,lane] of Object.entries(map.algorithm_phases)) expect(validateGitPhaseLane(phase,lane,"E3")).toBe(true);
 expect(GIT_PHASE_LANES.Plan).toContain(map.temperance_modes.complexity.simple_plan);
 expect(GIT_PHASE_LANES.Plan).toContain(map.temperance_modes.complexity.complex_plan);
 for(const effort of ["E1","E2","E3","E4","E5"]) {
  const f=fixture(); Object.assign(f.ticket,{phase:"Plan",lane:"noesis-plan-max",effort});
  expect(validateGitPhaseLane("Plan","noesis-plan-max",effort)).toBe(["E4","E5"].includes(effort));
  if(["E4","E5"].includes(effort)) expect(normalizeGitDeliveryTicket(f.ticket).lane).toBe("noesis-plan-max"); else reject(()=>normalizeGitDeliveryTicket(f.ticket));
 }
 expect(validateGitPhaseLane("Execute","noesis-plan-max","E5")).toBe(false);
});
test("repository identity exactly accepts producer dotted and long owner shape", () => {
 for(const identity of ["github.com/team.name/repo",`github.com/${"a".repeat(100)}/${"b".repeat(100)}`]) {
  const f=fixture(); f.ticket.workspace.repository_identity=identity; expect(normalizeGitDeliveryTicket(f.ticket).workspace.repository_identity).toBe(identity);
 }
 expect(isCanonicalGitRepositoryIdentity(`github.com/${"a".repeat(245)}/b`)).toBe(false);
 expect(isCanonicalGitRepositoryIdentity("github.com/Upper/repo")).toBe(false);
});
