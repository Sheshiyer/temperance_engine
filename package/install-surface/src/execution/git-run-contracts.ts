// Portable contextual lineage; no runtime issuer, capacity or dispatch authority.
import { createHash } from "node:crypto";
import { canonical } from "../canonical-json.ts";
import { snapshotGitContractInput, normalizeGitDeliveryTicket, normalizeGitExecutionGrant, normalizeGitAdmissionContext, gitDeliveryTicketFingerprint, gitExecutionGrantFingerprint, gitAdmissionContextFingerprint } from "./git-authority-contracts.ts";
export const GIT_RUN_LINEAGE_SCHEMA = "temperance.git-run-lineage.v1" as const;
export const GIT_RUN_CLAIM_RECEIPT_SCHEMA = "temperance.git-run-claim-receipt.v1" as const;
const FLAGS = { execution_authorized: false, capacity_authorization: false, lease_authorized: false } as const;
const INPUT_KEYS = ["run_id", "claimed_at", "lease_expires_at", "deadline_at", "context_fingerprint", "ticket", "grant", "admission"];
function invalid(): never { throw new Error("GIT_RUN_INVALID_INPUT"); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(k => !keys.includes(k))) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, pattern: RegExp): string { if (typeof value !== "string" || !pattern.test(value)) invalid(); return value; }
function utc(value: unknown): string {
  const s = text(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s) invalid();
  return s;
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function digest(value: unknown): string { return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }
/** Actual portable references are normalized; contextual fingerprints never authenticate an issuer. */
function constructGitRunLineage(input: unknown) {
  const v = exact(snapshotGitContractInput(input), INPUT_KEYS);
  const ticket = normalizeGitDeliveryTicket(v.ticket), grant = normalizeGitExecutionGrant(v.grant), admission = normalizeGitAdmissionContext(v.admission);
  const claimed = utc(v.claimed_at), lease = utc(v.lease_expires_at), deadline = utc(v.deadline_at);
  const now = Date.parse(claimed), expiry = Date.parse(grant.expires_at), end = Date.parse(deadline), tf = gitDeliveryTicketFingerprint(ticket);
  if (canonical(ticket.workspace) !== canonical(grant.workspace) || canonical(ticket.workspace) !== canonical(admission.workspace)
    || grant.ticket_fingerprint !== tf || admission.status !== "context-verified" || !ticket.outstanding_work
    || !grant.allowed_phases.includes(ticket.phase) || !grant.allowed_lanes.includes(ticket.lane)
    || Date.parse(grant.issued_at) < Date.parse(ticket.created_at)
    || now < Date.parse(ticket.created_at) || now < Date.parse(grant.issued_at) || now < Date.parse(admission.observed_at)
    || now >= expiry || now >= Date.parse(admission.expires_at)
    || end <= now || end > expiry || end - now > grant.time_budget_ms
    || Date.parse(lease) <= now || Date.parse(lease) > end || Date.parse(lease) > Date.parse(admission.expires_at)) invalid();
  return freeze({ schema: GIT_RUN_LINEAGE_SCHEMA, state: "claimed" as const,
    run_id: text(v.run_id, /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/), claimed_at: claimed, lease_expires_at: lease, deadline_at: deadline,
    context_fingerprint: text(v.context_fingerprint, /^sha256:[a-f0-9]{64}$/), ticket, grant, admission,
    ticket_id: ticket.ticket_id, grant_id: grant.grant_id, project_id: ticket.workspace.project_id,
    phase: ticket.phase, lane: ticket.lane, effort: ticket.effort, workspace: ticket.workspace,
    ticket_fingerprint: tf, grant_fingerprint: gitExecutionGrantFingerprint(grant), admission_context_fingerprint: gitAdmissionContextFingerprint(admission),
    workspace_fingerprint: ticket.workspace.workspace_fingerprint, source_fingerprint: ticket.workspace.source_fingerprint, ...FLAGS });
}
export type GitRunLineage = ReturnType<typeof constructGitRunLineage>;
export function buildGitRunLineage(input: unknown): GitRunLineage { return constructGitRunLineage(input); }
const LINEAGE_KEYS = [...INPUT_KEYS, "schema", "state", "ticket_id", "grant_id", "project_id", "phase", "lane", "effort", "workspace", "ticket_fingerprint", "grant_fingerprint", "admission_context_fingerprint", "workspace_fingerprint", "source_fingerprint", ...Object.keys(FLAGS)];
/** Validates original historical claim time, without renewing the recorded lease. */
export function normalizeGitRunLineage(input: unknown): GitRunLineage {
  const v = exact(snapshotGitContractInput(input), LINEAGE_KEYS);
  const normalized = buildGitRunLineage(Object.fromEntries(INPUT_KEYS.map(k => [k, v[k]])));
  if (canonical(v) !== canonical(normalized)) invalid();
  return normalized;
}
export function gitRunLineageFingerprint(input: unknown): string { return digest(normalizeGitRunLineage(input)); }
function constructGitRunClaimReceipt(input: unknown) {
  const v = exact(snapshotGitContractInput(input), ["status", "lineage"]);
  if (v.status !== "claimed" && v.status !== "replay") invalid();
  const lineage = normalizeGitRunLineage(v.lineage);
  return freeze({ schema: GIT_RUN_CLAIM_RECEIPT_SCHEMA, status: v.status, lineage, lineage_fingerprint: digest(lineage), issuer_authentication: "unproved-by-source-fixture" as const, ...FLAGS });
}
export type GitRunClaimReceipt = ReturnType<typeof constructGitRunClaimReceipt>;
export function buildGitRunClaimReceipt(input: unknown): GitRunClaimReceipt { return constructGitRunClaimReceipt(input); }
export function normalizeGitRunClaimReceipt(input: unknown): GitRunClaimReceipt {
  const v = exact(snapshotGitContractInput(input), ["schema", "status", "lineage", "lineage_fingerprint", "issuer_authentication", ...Object.keys(FLAGS)]);
  const receipt = buildGitRunClaimReceipt({ status: v.status, lineage: v.lineage });
  if (canonical(v) !== canonical(receipt)) invalid();
  return receipt;
}
