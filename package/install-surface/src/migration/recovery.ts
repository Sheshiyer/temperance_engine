/** Narrow migration projection over the existing lifecycle transaction engine.
 * Trusted ports are issued by the owning controller, never deserialized from a
 * plan. They bind the one owning lifecycle state namespace, authenticate final
 * review/ownership and independently read approved
 * evidence. No provider, shell, credential, native-store or rendering dependency.
 * Mutation recovery is supported only while the original source, review and
 * required evidence remain fresh and unchanged. After expiry, a fresh separately
 * issued owner context permits only verified terminal/unpublished claim release.
 * Incomplete effects, foreign custody and unknown ownership remain held for human
 * owner reconciliation; this API has no force, takeover or recompile path.
 */
import { canonical } from "../canonical-json.ts";
import { assessMigrationCompatibility } from "./contracts.ts";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { ALLOWED_ROOT_TOKENS, type RootToken } from "../path-policy.ts";
import { sha256 } from "../lifecycle/copy-tree.ts";
import { executePlan, preparedPreimageDigest, type PreparedTransactionResult, type PreparedReleaseEvidence } from "../lifecycle/executor.ts";
import { generateTxId, type LifecycleIO, type TransactionBinding } from "../lifecycle/journal.ts";
import type { PreparedSurface } from "../lifecycle/prepared-surface.ts";
import { assertMigrationPlanContext, calculateMigrationInputDigests, type MigrationPlannerInputs,
  type MigrationPlanV1, type MigrationPlanReviewContext } from "./planner.ts";

export type MigrationRecoveryAction = "apply" | "resume" | "rollback" | "status" | "release";
export interface MigrationOperationRef { txid: string; claim_nonce: string }
/** Separately issued by the owner. Possessing JSON or matching its digest grants
 * no permission: authorize must authenticate this exact capability independently.
 * It permits claim release only; it never extends the mutation recovery window.
 */
export interface MigrationTerminalReleaseContext {
  schema: "temperance.migration.terminal-release.v1";
  authorization_id: string;
  plan_digest: string;
  review_digest: string;
  txid: string;
  claim_nonce: string;
  lifecycle_state_root: string;
  evidence_digest: string;
  issued_at: string;
  expires_at: string;
}
export const migrationReleaseEvidenceDigest = (evidence: PreparedReleaseEvidence): string => `sha256:${sha256(canonical(evidence))}`;
export const migrationReviewDigest = (review: MigrationPlanReviewContext): string => `sha256:${sha256(canonical(review))}`;
export interface MigrationRecoveryAuthority {
  /** Must authenticate a separately issued final review, exact action, operation,
   * and existing destination ownership. A digest comparison is not authorization.
   * release_authorized may be true only after authenticating an independently
   * issued release_context, including its exact original review, operation and
   * namespace. When release_evidence is supplied, compare it with the owner's
   * independently approved disk facts. Never mint approval by echoing the request.
   * Unknown remote outcomes must return unknown; they are never replayed here.
   */
  authorize(request: { action: MigrationRecoveryAction; operation: MigrationOperationRef; plan: MigrationPlanV1; review: MigrationPlanReviewContext; release_context?: MigrationTerminalReleaseContext; release_evidence?: PreparedReleaseEvidence }): Promise<{ authorized: boolean; release_authorized?: boolean; owned_step_ids: string[]; lifecycle_state_root: string; remote_outcome: "none" | "unknown" }>;
  /** Independently read the current approved source/lock/snapshot/selection,
   * device observation and private binding through bounded IO. Never echo caller
   * plan/context objects. This port is a trusted owner adapter, not a JSON input.
   */
  readFreshInputs(io: LifecycleIO): Promise<MigrationPlannerInputs>;
}
export interface MigrationRecoveryOptions {
  action: MigrationRecoveryAction;
  operation: MigrationOperationRef;
  plan: MigrationPlanV1;
  review: MigrationPlanReviewContext;
  stateRoot: string;
  /** Optional fresh owner capability for release after original evidence expires. */
  release_context?: MigrationTerminalReleaseContext;
  io: LifecycleIO;
  authority: MigrationRecoveryAuthority;
  /** Explicit bridge from planner logical roots to existing lifecycle tokens. */
  root_tokens: Record<string, RootToken>;
  /** Only apply consumes immutable already-reviewed text. Resume reads artifacts. */
  prepared?: ReadonlyMap<string, string>;
  signal?: AbortSignal;
}
export interface MigrationRecoveryView extends PreparedTransactionResult {
  schema: "temperance.migration.recovery.v1";
  plan_digest: string;
  external_signins_preserved: true;
}
export function createMigrationOperation(): MigrationOperationRef {
  return { txid: generateTxId(), claim_nonce: randomBytes(16).toString("hex") };
}
/** Review tooling uses this exact descriptor; null/null means absent. */
export const migrationPreimageDigest = preparedPreimageDigest;

export async function recoverMigration(input: MigrationRecoveryOptions): Promise<MigrationRecoveryView> {
  const plan = structuredClone(input.plan), review = structuredClone(input.review), operation = { ...input.operation };
  const rootTokens = { ...input.root_tokens };
  const releaseContext = input.release_context ? structuredClone(input.release_context) : undefined;
  const view = (result: PreparedTransactionResult): MigrationRecoveryView => ({ ...result,
    txid: /^[a-f0-9]{12}-[a-f0-9]{8}$/.test(result.txid) ? result.txid : "unavailable",
    schema: "temperance.migration.recovery.v1", plan_digest: /^sha256:[a-f0-9]{64}$/.test(plan?.plan_digest) ? plan.plan_digest : "unavailable", external_signins_preserved: true });
  let unknown = false;
  try {
    if (!["apply", "resume", "rollback", "status", "release"].includes(input.action)) throw new Error("ACTION_INVALID");
    const authenticate = async (releaseEvidence?: PreparedReleaseEvidence) => {
      if (releaseContext) {
        const keys = ["schema", "authorization_id", "plan_digest", "review_digest", "txid", "claim_nonce", "lifecycle_state_root", "evidence_digest", "issued_at", "expires_at"];
        if (input.action !== "release" || Object.keys(releaseContext).length !== keys.length || keys.some(key => !Object.hasOwn(releaseContext, key))
          || releaseContext.schema !== "temperance.migration.terminal-release.v1" || !/^[a-zA-Z0-9._:-]{1,128}$/.test(releaseContext.authorization_id)
          || releaseContext.plan_digest !== plan.plan_digest || releaseContext.review_digest !== migrationReviewDigest(review)
          || releaseContext.txid !== operation.txid || releaseContext.claim_nonce !== operation.claim_nonce
          || typeof releaseContext.lifecycle_state_root !== "string" || resolve(releaseContext.lifecycle_state_root) !== resolve(input.stateRoot)
          || !/^sha256:[a-f0-9]{64}$/.test(releaseContext.evidence_digest)
          || !Number.isFinite(Date.parse(releaseContext.issued_at)) || !Number.isFinite(Date.parse(releaseContext.expires_at))
          || !(Date.parse(review.reviewed_at) <= Date.parse(releaseContext.issued_at) && Date.parse(releaseContext.issued_at) <= input.io.now().getTime() && input.io.now().getTime() < Date.parse(releaseContext.expires_at))) throw new Error("RELEASE_CONTEXT_INVALID");
        // Validate the ORIGINAL review at its issuance time. Only separately
        // authenticated release bypasses current source/review freshness.
        assertMigrationPlanContext(plan, review, review.reviewed_at);
        if (releaseEvidence && migrationReleaseEvidenceDigest(releaseEvidence) !== releaseContext.evidence_digest) throw new Error("RELEASE_EVIDENCE_DRIFT");
      } else assertMigrationPlanContext(plan, review, input.io.now().toISOString());
      const answer = await input.authority.authorize({ action: input.action, operation: { ...operation }, plan: structuredClone(plan), review: structuredClone(review),
        ...(releaseContext ? { release_context: structuredClone(releaseContext), ...(releaseEvidence ? { release_evidence: structuredClone(releaseEvidence) } : {}) } : {}) });
      if (releaseContext && answer?.release_authorized !== true) throw new Error("RELEASE_AUTHORITY_REQUIRED");
      if (!answer || answer.authorized !== true || !Array.isArray(answer.owned_step_ids) || answer.owned_step_ids.some(id => typeof id !== "string" || !plan.steps.some(step => step.id === id)) || !["none", "unknown"].includes(answer.remote_outcome) || typeof answer.lifecycle_state_root !== "string" || resolve(answer.lifecycle_state_root) !== resolve(input.stateRoot)) throw new Error("AUTHORITY_REQUIRED");
      if (answer.remote_outcome !== "none") { unknown = true; throw new Error("OWNER_RECONCILIATION_REQUIRED"); }
      return answer;
    };
    await authenticate();
    const original = await input.authority.readFreshInputs(input.io);
    const roots = new Map<string, string>();
    const usedRefs = [...new Set(plan.steps.map(s => s.root_ref))];
    if (Object.keys(rootTokens).length !== usedRefs.length) throw new Error("ROOT_BINDING_INVALID");
    for (const ref of usedRefs) {
      const token = rootTokens[ref], path = original.private_binding.variables[ref];
      if (!ALLOWED_ROOT_TOKENS.includes(token) || !path || !path.startsWith("/") || roots.has(token)) throw new Error("ROOT_BINDING_INVALID");
      roots.set(token, resolve(path));
    }
    const resolveRoot = (token: string) => { const path = roots.get(token); if (!path) throw new Error("ROOT_BINDING_INVALID"); return path; };
    const assertAuthority = async () => {
      await authenticate();
      const current = await input.authority.readFreshInputs(input.io);
      if (releaseContext) {
        for (const ref of usedRefs) if (resolve(current.private_binding.variables[ref]) !== resolveRoot(rootTokens[ref])) throw new Error("ROOT_BINDING_DRIFT");
        return;
      }
      const dynamic = assessMigrationCompatibility(current.snapshot, { ...current.expected_context, now: input.io.now().toISOString() });
      if (!dynamic.structurally_valid || dynamic.holds.length) throw new Error("FRESH_EVIDENCE_INELIGIBLE");
      const digests = calculateMigrationInputDigests(current);
      if (Object.entries(digests).some(([key, digest]) => plan[key as keyof typeof digests] !== digest)
        || current.destination.destination_id !== plan.destination_id || current.destination.issued_device_ref !== plan.issued_device_ref) throw new Error("FRESH_EVIDENCE_DRIFT");
      for (const ref of usedRefs) if (resolve(current.private_binding.variables[ref]) !== resolveRoot(rootTokens[ref])) throw new Error("ROOT_BINDING_DRIFT");
    };
    await assertAuthority();
    const prepared = input.prepared ? new Map<string, PreparedSurface>() : undefined;
    const intent = plan.steps.map(step => {
      const planned = { step_id: step.id, record_id: step.module_id, destination: { root_token: rootTokens[step.root_ref], relative_path: step.relative_path, ownership: { kind: "exclusive-path" as const } }, ownership: "exclusive-path" as const, mode: "install" as const };
      const hash = step.prepared_digest.slice(7);
      if (prepared) {
        const content = input.prepared!.get(step.id);
        if (content === undefined || sha256(content) !== hash) throw new Error("PREPARED_INTENT_DRIFT");
        prepared.set(step.id, { step: planned, content, expected_hash: hash, expected_mode: step.mode, surface_class: "COPY" });
      }
      return { step: planned, expected_hash: hash, expected_mode: step.mode, preimage_digest: step.preimage_digest };
    });
    if (input.prepared && input.prepared.size !== intent.length) throw new Error("PREPARED_INTENT_DRIFT");
    const rootFacts: unknown[] = [];
    for (const item of intent) {
      const root = resolveRoot(item.step.destination.root_token), stat = await input.io.lstat(root);
      rootFacts.push([item.step.step_id, await input.io.realpath(root), stat.dev, stat.ino, resolve(root, item.step.destination.relative_path).normalize("NFC").toLowerCase()]);
    }
    // Stable ordering and closed context are inherited from final review assertion.
    const { plan_digest, reviewed_at: _reviewed, expires_at: _expires, ...context } = review;
    const binding: TransactionBinding = { plan_digest, context: { ...context }, claim_nonce: operation.claim_nonce, destinations_digest: sha256(JSON.stringify(rootFacts)) };
    return view(await executePlan({ prepared_transaction: true, action: input.action, stateRoot: input.stateRoot, io: input.io, txid: operation.txid, binding, profile: plan.profile, resolveRoot, prepared, intent, assertAuthority, assertReleaseEvidence: releaseContext ? async evidence => { await authenticate(evidence); } : undefined,
      assertOwnedPreimage: async id => { if (!(await authenticate()).owned_step_ids.includes(id)) throw new Error("OWNERSHIP_UNPROVEN"); }, signal: input.signal }));
  } catch {
    return view({ txid: operation.txid, status: unknown ? "unknown-effect" : input.signal?.aborted ? "incomplete" : "manual-recovery", reason: unknown ? "OWNER_RECONCILIATION_REQUIRED" : input.signal?.aborted ? "INTERRUPTED" : "RECOVERY_REQUIRED" });
  }
}
