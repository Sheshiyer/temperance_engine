// Context-only slice of the 2026-10-05 Git Hands authority migration design.
// This public module has no private Noesis imports or owning runtime claim writer.
import { createHash } from "node:crypto";
import { types } from "node:util";
import { canonical } from "../canonical-json.ts";

export const GIT_TICKET_SCHEMA = "temperance.git-delivery-ticket.v2" as const;
export const GIT_GRANT_SCHEMA = "temperance.git-execution-grant.v2" as const;
export const GIT_ADMISSION_SCHEMA = "temperance.git-project-admission-envelope.v2" as const;
export const GIT_PHASE_LANES = freeze({
  Observe: ["noesis-observe"], Think: ["noesis-observe"], Plan: ["noesis-plan", "noesis-plan-max"],
  Build: ["noesis-build"], Execute: ["noesis-execute"], Verify: ["noesis-verify"], Learn: ["noesis-observe"],
} as const);
export type GitEffort = "E1" | "E2" | "E3" | "E4" | "E5";
export type GitPhase = keyof typeof GIT_PHASE_LANES;
export interface GitWorkspaceBinding {
  readonly kind: "git";
  readonly project_id: string;
  readonly repository_identity: string;
  readonly capsule_id: string;
  readonly admission_fingerprint: string;
  readonly workspace_fingerprint: string;
  readonly root_fingerprint: string;
  readonly source_commit: string;
  readonly source_fingerprint: string;
}
export interface GitDeliveryTicketV2 {
  readonly schema: typeof GIT_TICKET_SCHEMA;
  readonly workspace: GitWorkspaceBinding;
  readonly ticket_id: string;
  readonly plan_id: string;
  readonly task_id: string;
  readonly phase: GitPhase;
  readonly effort: GitEffort;
  readonly lane: string;
  readonly outstanding_work: number;
  readonly created_at: string;
}
export interface GitExecutionGrantV2 {
  readonly schema: typeof GIT_GRANT_SCHEMA;
  readonly workspace: GitWorkspaceBinding;
  readonly grant_id: string;
  readonly ticket_fingerprint: string;
  readonly allowed_phases: readonly GitPhase[];
  readonly allowed_lanes: readonly string[];
  readonly issued_at: string;
  readonly expires_at: string;
  readonly retry_budget: number;
  readonly time_budget_ms: number;
}
/** Caller-reviewed fingerprints only. This is not an authenticated admission receipt. */
export interface GitAdmissionContextV2 {
  readonly schema: typeof GIT_ADMISSION_SCHEMA;
  readonly mode: "context-only";
  readonly workspace: GitWorkspaceBinding;
  readonly status: "context-verified" | "held";
  readonly observed_at: string;
  readonly expires_at: string;
  readonly execution_authorized: false;
  readonly capacity_authorization: false;
  readonly lease_authorized: false;
}
const MAX_BYTES = 65536;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const REPO = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/;
export function isCanonicalGitRepositoryIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256 && REPO.test(value);
}
export function validateGitPhaseLane(p: unknown, lane: unknown, effort: unknown): boolean {
  return typeof p === "string" && Object.hasOwn(GIT_PHASE_LANES, p)
    && typeof lane === "string" && typeof effort === "string" && /^E[1-5]$/.test(effort)
    && (GIT_PHASE_LANES[p as GitPhase] as readonly string[]).includes(lane)
    && (lane !== "noesis-plan-max" || effort === "E4" || effort === "E5");
}
const BINDING_KEYS = ["kind", "project_id", "repository_identity", "capsule_id", "admission_fingerprint", "workspace_fingerprint", "root_fingerprint", "source_commit", "source_fingerprint"];
function invalid(): never { throw new Error("GIT_AUTHORITY_INVALID_INPUT"); }
function snapshot(value: unknown, depth = 0, count = { nodes: 0, bytes: 0 }): unknown {
  if (++count.nodes > 1024 || depth > 8) invalid();
  if (typeof value === "string") {
    count.bytes += Buffer.byteLength(value);
    if (value.length > 512 || count.bytes > MAX_BYTES) invalid();
    return value;
  }
  if (typeof value === "boolean" || typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (!value || typeof value !== "object" || types.isProxy(value)) invalid();
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length > 33 || keys.some(key => typeof key !== "string")) invalid();
  if (array) {
    if (value.length > 32 || keys.length !== value.length + 1) invalid();
    const output: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) invalid();
      output.push(snapshot(descriptor.value, depth + 1, count));
    }
    return output;
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    if (key.length > 64 || ["__proto__", "constructor", "prototype"].includes(key)) invalid();
    count.bytes += Buffer.byteLength(key);
    if (count.bytes > MAX_BYTES) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) invalid();
    output[key] = snapshot(descriptor.value, depth + 1, count);
  }
  return output;
}
function boundedSnapshot(value: unknown): unknown {
  const output = snapshot(value);
  if (Buffer.byteLength(JSON.stringify(output)) > MAX_BYTES) invalid();
  return output;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, pattern: RegExp): string { if (typeof value !== "string" || !pattern.test(value)) invalid(); return value; }
function integer(value: unknown, min: number, max: number): number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid(); return value as number; }
function utc(value: unknown): string {
  const date = text(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date) invalid();
  return date;
}
function phase(value: unknown): GitPhase {
  if (typeof value !== "string" || !Object.hasOwn(GIT_PHASE_LANES, value)) invalid();
  return value as GitPhase;
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function binding(value: unknown): GitWorkspaceBinding {
  const v = exact(value, BINDING_KEYS);
  if (v.kind !== "git") invalid();
  const repository = text(v.repository_identity, REPO);
  if (!isCanonicalGitRepositoryIdentity(repository)) invalid();
  return { kind: "git", project_id: text(v.project_id, ID), repository_identity: repository,
    capsule_id: text(v.capsule_id, ID), admission_fingerprint: text(v.admission_fingerprint, HASH),
    workspace_fingerprint: text(v.workspace_fingerprint, HASH), root_fingerprint: text(v.root_fingerprint, HASH),
    source_commit: text(v.source_commit, COMMIT), source_fingerprint: text(v.source_fingerprint, HASH) };
}
function normalizedSet<T extends string>(value: unknown, validate: (value: unknown) => T, max: number): T[] {
  if (!Array.isArray(value) || !value.length || value.length > max) invalid();
  const set = value.map(validate);
  if (new Set(set).size !== set.length) invalid();
  return set.sort();
}
/** Strict normalizers are pure; no private host adapter or runtime lookup occurs. */
export function normalizeGitDeliveryTicket(input: unknown): Readonly<GitDeliveryTicketV2> {
  const v = exact(boundedSnapshot(input), ["schema", "workspace", "ticket_id", "plan_id", "task_id", "phase", "lane", "effort", "outstanding_work", "created_at"]);
  if (v.schema !== GIT_TICKET_SCHEMA) invalid();
  const p = phase(v.phase), lane = text(v.lane, ID);
  if (!validateGitPhaseLane(p, lane, v.effort)) invalid();
  return freeze({ schema: GIT_TICKET_SCHEMA, workspace: binding(v.workspace), ticket_id: text(v.ticket_id, ID),
    plan_id: text(v.plan_id, ID), task_id: text(v.task_id, ID), phase: p, lane, effort: v.effort as GitEffort,
    outstanding_work: integer(v.outstanding_work, 0, 1000000), created_at: utc(v.created_at) });
}
export function normalizeGitExecutionGrant(input: unknown): Readonly<GitExecutionGrantV2> {
  const v = exact(boundedSnapshot(input), ["schema", "workspace", "grant_id", "ticket_fingerprint", "allowed_phases", "allowed_lanes", "issued_at", "expires_at", "retry_budget", "time_budget_ms"]);
  if (v.schema !== GIT_GRANT_SCHEMA) invalid();
  const phases = normalizedSet(v.allowed_phases, phase, 7);
  const allLanes = new Set<string>(Object.values(GIT_PHASE_LANES).flat());
  const lanes = normalizedSet(v.allowed_lanes, item => { const lane = text(item, ID); if (!allLanes.has(lane)) invalid(); return lane; }, 7);
  // Every listed permission must describe at least one supported phase/lane pair.
  if (phases.some(p => !GIT_PHASE_LANES[p].some(lane => lanes.includes(lane)))
    || lanes.some(lane => !phases.some(p => (GIT_PHASE_LANES[p] as readonly string[]).includes(lane)))) invalid();
  const issued = utc(v.issued_at), expires = utc(v.expires_at);
  if (Date.parse(expires) <= Date.parse(issued)) invalid();
  return freeze({ schema: GIT_GRANT_SCHEMA, workspace: binding(v.workspace), grant_id: text(v.grant_id, ID),
    ticket_fingerprint: text(v.ticket_fingerprint, HASH), allowed_phases: phases, allowed_lanes: lanes,
    issued_at: issued, expires_at: expires, retry_budget: integer(v.retry_budget, 0, 100),
    time_budget_ms: integer(v.time_budget_ms, 1, 604800000) });
}
export function normalizeGitAdmissionContext(input: unknown): Readonly<GitAdmissionContextV2> {
  const v = exact(boundedSnapshot(input), ["schema", "mode", "workspace", "status", "observed_at", "expires_at", "execution_authorized", "capacity_authorization", "lease_authorized"]);
  if (v.schema !== GIT_ADMISSION_SCHEMA || v.mode !== "context-only" || !["context-verified", "held"].includes(v.status as string)
    || v.execution_authorized !== false || v.capacity_authorization !== false || v.lease_authorized !== false) invalid();
  const observed = utc(v.observed_at), expires = utc(v.expires_at);
  if (Date.parse(expires) <= Date.parse(observed) || Date.parse(expires) - Date.parse(observed) > 300000) invalid();
  return freeze({ schema: GIT_ADMISSION_SCHEMA, mode: "context-only", workspace: binding(v.workspace), status: v.status as GitAdmissionContextV2["status"],
    observed_at: observed, expires_at: expires, execution_authorized: false, capacity_authorization: false, lease_authorized: false });
}
function fingerprint(value: unknown): string { return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }
export const gitDeliveryTicketFingerprint = (input: unknown): string => fingerprint(normalizeGitDeliveryTicket(input));
export const gitExecutionGrantFingerprint = (input: unknown): string => fingerprint(normalizeGitExecutionGrant(input));
export const gitAdmissionContextFingerprint = (input: unknown): string => fingerprint(normalizeGitAdmissionContext(input));
export type GitEligibilityReason = "context-eligible" | "admission-held" | "workspace-binding-mismatch" | "ticket-fingerprint-mismatch" | "grant-fingerprint-mismatch" | "ticket-future" | "grant-before-ticket" | "grant-not-active" | "grant-expired" | "admission-not-active" | "admission-expired" | "phase-not-allowed" | "lane-not-allowed" | "retry-budget-exhausted" | "time-budget-exhausted" | "no-outstanding-work";
export interface GitAuthorityEligibility {
  readonly schema: "temperance.git-authority-eligibility.v1";
  readonly mode: "context-only";
  readonly context_eligible: boolean;
  readonly reason_code: GitEligibilityReason;
  readonly claim_status: "held-authority-migration";
  readonly execution_authorized: false;
  readonly capacity_authorization: false;
  readonly lease_authorized: false;
  readonly ticket_fingerprint: string;
  readonly grant_fingerprint: string;
  readonly admission_context_fingerprint: string;
}
/** Reviewed fingerprint/shape eligibility only. expected_grant_fingerprint is caller-reviewed context, not authentication. No replay ledger, capacity or grant authentication.
 * Exact Git producer API integration and actual claim remain separate held migration gates.
 */
export function evaluateGitAuthorityEligibility(input: unknown): Readonly<GitAuthorityEligibility> {
  const v = exact(boundedSnapshot(input), ["ticket", "grant", "admission", "now", "retries_used", "elapsed_ms", "expected_grant_fingerprint"]);
  const ticket = normalizeGitDeliveryTicket(JSON.parse(JSON.stringify(v.ticket)));
  const grant = normalizeGitExecutionGrant(JSON.parse(JSON.stringify(v.grant)));
  const admission = normalizeGitAdmissionContext(JSON.parse(JSON.stringify(v.admission)));
  const now = integer(v.now, 0, 8640000000000000), retries = integer(v.retries_used, 0, 100), elapsed = integer(v.elapsed_ms, 0, 604800000);
  const tf = fingerprint(ticket), gf = fingerprint(grant);
  const expectedGrant = text(v.expected_grant_fingerprint, HASH);
  let reason: GitEligibilityReason = "context-eligible";
  if (admission.status !== "context-verified") reason = "admission-held";
  else if (fingerprint(ticket.workspace) !== fingerprint(grant.workspace) || fingerprint(ticket.workspace) !== fingerprint(admission.workspace)) reason = "workspace-binding-mismatch";
  else if (tf !== grant.ticket_fingerprint) reason = "ticket-fingerprint-mismatch";
  else if (gf !== expectedGrant) reason = "grant-fingerprint-mismatch";
  else if (Date.parse(ticket.created_at) > now) reason = "ticket-future";
  else if (Date.parse(grant.issued_at) < Date.parse(ticket.created_at)) reason = "grant-before-ticket";
  else if (Date.parse(grant.issued_at) > now) reason = "grant-not-active";
  else if (Date.parse(grant.expires_at) <= now) reason = "grant-expired";
  else if (Date.parse(admission.observed_at) > now) reason = "admission-not-active";
  else if (Date.parse(admission.expires_at) <= now) reason = "admission-expired";
  else if (!grant.allowed_phases.includes(ticket.phase)) reason = "phase-not-allowed";
  else if (!grant.allowed_lanes.includes(ticket.lane)) reason = "lane-not-allowed";
  else if (retries > grant.retry_budget) reason = "retry-budget-exhausted";
  else if (elapsed >= grant.time_budget_ms) reason = "time-budget-exhausted";
  else if (!ticket.outstanding_work) reason = "no-outstanding-work";
  return freeze({ schema: "temperance.git-authority-eligibility.v1", mode: "context-only", context_eligible: reason === "context-eligible",
    reason_code: reason, claim_status: "held-authority-migration", execution_authorized: false, capacity_authorization: false,
    lease_authorized: false, ticket_fingerprint: tf, grant_fingerprint: gf, admission_context_fingerprint: fingerprint(admission) });
}
