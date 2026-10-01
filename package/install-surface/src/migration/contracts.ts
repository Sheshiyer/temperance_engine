/**
 * Task 1 — Migration capability snapshot and compatibility join.
 *
 * Exports MigrationSnapshotV1, MigrationTargetV1, MigrationFindingV1,
 * validateMigrationSnapshot, validateMigrationTarget, makeMigrationFinding,
 * computeWorkBindingDigest.
 *
 * Design constraints:
 * - No credentials, session IDs, raw paths, raw logs, enrollment flags,
 *   approval fields, or issued device identity fields are permitted.
 * - Hardware/UID fields are compatibility observations only; they do not
 *   constitute a device identity or transfer approvals.
 * - External product refs (e.g. Snow Gloves) must explicitly declare
 *   grants_no_install_authority=true; they confer no install authority.
 * - Will role desks are filters on existing organs, not new agents.
 * - Knowledge refs are strictly canonical or derived; no mixing.
 * - Organ relationships carry independent owner/contract/source/version/
 *   digest/input/trigger/scope/plant/artifact/consumer/verdict/freshness.
 * - Cell effects are closed to: extract | feed | read | edit.
 * - Verdict attestation binds exact artifact + criteria/policy digest +
 *   independent verifier reference and freshness when verdict is non-unknown.
 * - Source/released/installed/consumed artifact lineage is modeled distinctly.
 * - Adytum parity requires both owner_contract_digest and consumer_support_digest,
 *   not just equal topic counts. Adytum verification="verified" without parity
 *   evidence must be rejected.
 * - Flags and hardware observations never authorize destination effects.
 * - Symbolic refs must not contain path separators, loopback addresses, or
 *   account identifiers.
 * - Snapshot-held observations with disabled capabilities are valid held evidence.
 * - WorkObject binding_digest pins the full tuple; substitution of any axis
 *   without recalculating the digest is rejected. Absent binding_digest marks
 *   a source-only observation (held, nonauthoritative).
 * - EvidenceDimensions.runtime is stopped|running|unreachable|unknown,
 *   independent of installed status.
 * - Attestation timestamps in the future relative to snapshot observed_at cannot
 *   carry freshness:"fresh".
 * - Calendar dates must be valid (e.g. Feb 30 is rejected).
 * - Capability-hit modes are modeled as source-owned disabled references; the
 *   four known modes are kept disabled with no scheduling/enrollment permission.
 * - All nested objects are validated against closed allowlists; unknown keys
 *   are rejected recursively.
 * - Task 2 and Task 3 may import all exported types and helpers without
 *   modifying this file.
 */

import { createHash } from "node:crypto";

// ─── Schema constants ─────────────────────────────────────────────────────

export const MIGRATION_SNAPSHOT_SCHEMA = "temperance.migration.snapshot.v1" as const;
export const MIGRATION_TARGET_SCHEMA = "temperance.migration.target.v1" as const;

export const SUPPORTED_SNAPSHOT_MAJOR = 1 as const;
export const SUPPORTED_TARGET_MAJOR = 1 as const;

export const MAX_MIGRATION_SNAPSHOT_BYTES = 2_097_152; // 2 MiB
export const MAX_OBJECT_DEPTH = 12;

// ─── Organ registries ─────────────────────────────────────────────────────

/**
 * The five operating organs — canonical per the Cambium growth-ecosystem
 * review (docs/architecture/2026-10-01-growth-ecosystem-review.md:93-118) and
 * the owner organ atlas. Not extensible in v1.
 */
export const OPERATING_ORGAN_IDS = [
  "genesis",
  "taste",
  "hands",
  "will",
  "cortex",
] as const;

/**
 * The six cognitive organs — canonical per the same source review
 * (:139-157). Not extensible in v1. Adytum is one of the six; the
 * eight-vs-nine topic parity hold is modelled separately on the Adytum organ.
 */
export const COGNITIVE_ORGAN_IDS = [
  "vestibule",
  "adytum",
  "nutrix",
  "auspex",
  "circulator",
  "praeceptor",
] as const;

export type OperatingOrganId = (typeof OPERATING_ORGAN_IDS)[number];
export type CognitiveOrganId = (typeof COGNITIVE_ORGAN_IDS)[number];
export type OrganId = OperatingOrganId | CognitiveOrganId;

// ─── Capability-hit modes — source-owned, all disabled ────────────────────

/**
 * The four source-owned capability-hit mode IDs from the
 * thoughtseed-labs growth whitepaper / telegram-capability-hit-system.v1.json.
 * All four are disabled; no scheduling or enrollment permission.
 */
export const CAPABILITY_HIT_MODE_IDS = [
  "capability-hit-on-task-change",
  "capability-hit-founder-morning",
  "capability-hit-organ-spotlight",
  "capability-hit-health-escalation",
] as const;

export type CapabilityHitModeId = (typeof CAPABILITY_HIT_MODE_IDS)[number];

/**
 * Symbolic source reference for the capability-hit mode catalog.
 * This is the bound reference, not a copy of the catalog body.
 */
export const CAPABILITY_HIT_SOURCE_REF =
  "thoughtseed-labs:growth-whitepaper:telegram-capability-hit-system.v1" as const;

/**
 * Per-mode disabled declaration. All modes must carry disabled:true.
 * No scheduling_permission or enrollment_permission allowed.
 */
export interface CapabilityHitModeRef {
  mode_id: CapabilityHitModeId;
  disabled: true;
  source_ref: typeof CAPABILITY_HIT_SOURCE_REF;
  source_digest: `sha256:${string}`;
}

/**
 * Optional field on snapshot declaring the four capability-hit modes.
 * When present, must list exactly the four known disabled modes.
 */
export interface CapabilityHitModesDeclaration {
  modes: CapabilityHitModeRef[];
  catalog_source_ref: typeof CAPABILITY_HIT_SOURCE_REF;
  catalog_source_digest: `sha256:${string}`;
}

// ─── Will role desks (6 roles, not new agents) ────────────────────────────

/**
 * The six Will role desks — canonical per the Cambium growth review
 * (:93-157). These are role filters assigned inside the Will operating organ,
 * not new organs or bots. Each desk assignment must bind to the "will" organ.
 */
export const WILL_ROLE_DESKS = [
  "head-of-marketing",
  "copywriter",
  "creative-strategist",
  "launch-lead",
  "seo-lead",
  "analyst",
] as const;

export type WillRoleDesk = (typeof WILL_ROLE_DESKS)[number];

export interface WillRoleDeskAssignment {
  desk: WillRoleDesk;
  /** Must resolve to the "will" operating organ; desks are role filters inside Will. */
  assigned_to_organ: "will";
}

// ─── Evidence dimensions ─────────────────────────────────────────────────

/**
 * Independent discovered/installed/configured/auth/admission/runtime/
 * verification dimensions — each observed separately, not derived.
 *
 * runtime: stopped | running | unreachable | unknown — independent of
 * installed status. installed:yes + runtime:stopped is a valid observation.
 */
export interface EvidenceDimensions {
  discovered: "yes" | "no" | "unknown";
  installed: "yes" | "no" | "unknown";
  configured: "full" | "partial" | "none" | "unknown";
  auth: "yes" | "no" | "unknown";
  admission: "admitted" | "pending" | "not-admitted" | "unknown";
  runtime: "stopped" | "running" | "unreachable" | "unknown";
  verification: "verified" | "unverified" | "failed" | "unknown";
}

// ─── Organ freshness / verdict ────────────────────────────────────────────

export type FreshnessState = "fresh" | "stale" | "expired" | "unknown";
export type IndependentVerdict = "passed" | "failed" | "unknown";
export type AdmissionState = "admitted" | "pending" | "not-admitted" | "unknown";
/** Runtime state — independent of installed state. */
export type RuntimeState = "stopped" | "running" | "unreachable" | "unknown";
export type VerificationState = "verified" | "unverified" | "failed" | "unknown";

// ─── Verdict attestation ──────────────────────────────────────────────────

/**
 * When independent_verdict is "passed" or "failed", attestation MUST be
 * present and bind the exact artifact, criteria/policy digest, verifier
 * reference and a freshness timestamp.
 * When independent_verdict is "unknown", attestation MUST be absent.
 *
 * attested_at must not be in the future relative to the snapshot's observed_at
 * when freshness is "fresh".
 */
export interface VerdictAttestation {
  artifact_digest: `sha256:${string}`;
  criteria_digest: `sha256:${string}`;
  policy_digest: `sha256:${string}`;
  verifier_ref: string;
  attested_at: string;
  freshness: FreshnessState;
}

// ─── Artifact lineage ─────────────────────────────────────────────────────

/**
 * A single independently-observed provenance stage.
 *
 * Each stage is a typed tuple, not a bare string: it pins the symbolic
 * artifact/stage ref, the associated work/task/owner-contract/version/
 * scope/plant, the artifact and source digests, an observed timestamp with
 * freshness, and (for the consume stage) a consumer acknowledgment ref.
 *
 * A valid internally-coherent stage set proves only that the projection is
 * self-consistent; it never authenticates the caller. The assessor compares
 * every stage tuple against an independently pinned expectation.
 */
export interface ArtifactStage {
  /** Symbolic reference for the artifact observed at this stage. */
  stage_ref: string;
  work_id: string;
  task_id: string;
  owner_contract: string;
  version: string;
  /** Scope of the referenced WorkObject, not the organ selection scope. */
  scope: string;
  plant: string;
  artifact_digest: `sha256:${string}`;
  source_digest: `sha256:${string}`;
  observed_at: string;
  freshness: FreshnessState;
  /** Consumer acknowledgment ref — required on the consume stage only. */
  consumer_ack?: string;
}

/**
 * Source/released/installed/consumed artifact lineage — each stage is an
 * independently-observed typed tuple. No stage implies the next.
 *
 * consumed_ref is retained as the primary symbolic pointer used by the
 * verdict anchor edge; the typed per-stage tuples carry the full join.
 */
export interface ArtifactLineage {
  source: ArtifactStage;
  released: ArtifactStage;
  installed: ArtifactStage;
  consumed: ArtifactStage;
  /** Convenience pointer to consumed.stage_ref for the verdict-anchor edge. */
  consumed_ref: string;
}

// ─── Adytum parity evidence ───────────────────────────────────────────────

/**
 * A single topic entry in an independently-versioned topic set.
 * Topic refs are portable symbolic references; the topic catalog body is
 * never copied into the snapshot.
 */
export interface AdytumTopicRef {
  topic_ref: string;
  version: string;
  digest: `sha256:${string}`;
}

/**
 * Adytum parity is a join between two independently-versioned topic sets:
 *
 *  - owner (Hermes) publishes 9 topics, each with its own ref/version/digest.
 *  - consumer (Cambium) supports 8 topics, each with its own ref/version/digest
 *    plus a per-topic support binding.
 *
 * The Adytum topic is the ninth owner topic the consumer does not yet support,
 * so a correct snapshot is SOURCE-PARITY-HELD by default. Parity is only
 * matched when every owner topic is reconciled against an independently pinned
 * expected context (see MigrationExpectedContext.expected_adytum). A bare
 * equal count, or a single arbitrary topic_count, never promotes Adytum to
 * verified/admitted.
 */
export interface AdytumParityEvidence {
  owner_contract_ref: string;
  owner_contract_version: string;
  owner_contract_digest: `sha256:${string}`;
  owner_topics: AdytumTopicRef[];
  consumer_support_ref: string;
  consumer_support_version: string;
  consumer_support_digest: `sha256:${string}`;
  consumer_topics: AdytumTopicRef[];
}

/** Count of topics the Hermes owner publishes. */
export const ADYTUM_OWNER_TOPIC_COUNT = 9 as const;
/** Count of topics the Cambium consumer currently supports. */
export const ADYTUM_CONSUMER_TOPIC_COUNT = 8 as const;

// ─── Organ evidence ref ───────────────────────────────────────────────────

/**
 * Per-organ owner/contract/source/version/digest/input/trigger/scope/
 * plant/artifact/consumer/independent-verdict/freshness relationships.
 * No catalog bodies, credentials, or operational authority.
 *
 * verdict_attestation: required when independent_verdict is "passed" or
 *   "failed"; must be absent when independent_verdict is "unknown".
 * artifact_lineage: optional; when present all four stage refs are required.
 * adytum_parity: for adytum organ only; when organ_id is "adytum" and
 *   verification is "verified", adytum_parity MUST be present with both
 *   digest fields. Without parity, adytum verification must not be "verified".
 */
/** A bounded input edge, distinct from the consumer's own output lineage.
 * Producer identity is joined through its independent ExpectedVerdictAnchor;
 * work/task/scope is also checked against independently supplied work bindings.
 */
export interface InputDependencyRef {
  input_id: string;
  producer_organ_id: OrganId;
  consumer_organ_id: OrganId;
  artifact_ref: string;
  artifact_digest: `sha256:${string}`;
  source_digest: `sha256:${string}`;
  work_id: string;
  task_id: string;
  scope: string;
}

export interface OrganEvidenceRef {
  organ_id: string;
  input_dependencies: InputDependencyRef[];
  owner: string;
  contract: string;
  source_digest: `sha256:${string}`;
  version: string;
  trigger: "manual-session" | "scheduled" | "event-driven" | "on-demand";
  artifact_ref: string;
  consumer: string;
  independent_verdict: IndependentVerdict;
  freshness: FreshnessState;
  scope: string;
  plant: "mac" | "hermes" | string;
  admission: AdmissionState;
  runtime: RuntimeState;
  verification: VerificationState;
  verdict_attestation?: VerdictAttestation;
  artifact_lineage?: ArtifactLineage;
  adytum_parity?: AdytumParityEvidence;
}

// ─── Knowledge refs ───────────────────────────────────────────────────────

/** Canonical knowledge ref: the authoritative source. No derivation_from. */
export interface CanonicalKnowledgeRef {
  ref_id: string;
  kind: "canonical";
  source_digest: `sha256:${string}`;
  version: string;
  freshness: FreshnessState;
  derived_from?: never;
}

/** Derived knowledge ref: derived from a canonical source. */
export interface DerivedKnowledgeRef {
  ref_id: string;
  kind: "derived";
  source_digest: `sha256:${string}`;
  version: string;
  freshness: FreshnessState;
  derived_from: string;
}

export type KnowledgeRef = CanonicalKnowledgeRef | DerivedKnowledgeRef;

// ─── Cell effect classes ──────────────────────────────────────────────────

/**
 * Closed set: extract | feed | read | edit.
 * No delete, no shell, no arbitrary mutation.
 */
export type CellEffectKind = "extract" | "feed" | "read" | "edit";

/**
 * A closed cell effect declaration. Every allowed property is validated:
 * kind is the closed verb enum, cell_id is a clean symbolic ref, description
 * is a plain non-empty string (never a nested body), and effect is the
 * required scalar outcome class produced by the verb.
 */
export type CellEffectOutcome = "observed" | "staged" | "applied" | "held";

export interface CellEffectClass {
  kind: CellEffectKind;
  cell_id: string;
  description: string;
  effect: CellEffectOutcome;
}

// ─── WorkObject / pack scope ──────────────────────────────────────────────

/**
 * WorkObjectRef with binding_digest that pins the full tuple:
 *   work_id / task_id / pack / plant / scope / owner / contract /
 *   source_digest / version.
 *
 * When binding_digest is present it MUST equal computeWorkBindingDigest(ref).
 * Any axis substitution without recalculating binding_digest is rejected.
 *
 * When binding_digest is absent, the entry is a source-only observation:
 * held as nonauthoritative evidence with no compatibility join established.
 */
export interface WorkObjectRef {
  work_id: string;
  task_id: string;
  pack: string;
  plant: string;
  scope: string;
  owner: string;
  contract: string;
  source_digest: `sha256:${string}`;
  version: string;
  binding_digest?: `sha256:${string}`;
}

// ─── Toolchain requirements ───────────────────────────────────────────────

export interface ToolchainRequirement {
  id: string;
  kind: "binary" | "devtool" | "runtime";
  version_constraint: string;
}

// ─── External product refs ────────────────────────────────────────────────

/**
 * External product references (e.g. Snow Gloves).
 * grants_no_install_authority MUST be true; the reference itself confers
 * no install, update, credential, or enrollment authority.
 */
export interface ExternalProductRef {
  product: string;
  owner: string;
  grants_no_install_authority: true;
}

// ─── Compatibility observations ───────────────────────────────────────────

/**
 * Hardware/OS compatibility observations only.
 * Not a device identity, not an issued UID, not a transfer of approval.
 * These observations must not contain authorization tokens or account paths.
 */
export interface CompatibilityObservations {
  hardware_model: string;
  chip_model: string;
  architecture: string;
  os_version: string;
  note: string;
}

// ─── Independently-pinned expected context (the real owner join) ──────────

/**
 * A small pinned tuple describing the owner-issued expectation for one
 * WorkObject. This is NOT a copy of the owner catalog; it is the minimal
 * contract reference an independent authority supplies out-of-band. The
 * snapshot's self-computed binding_digest proves integrity only; matching
 * compatibility additionally requires this independently supplied tuple.
 */
export interface ExpectedWorkBinding {
  work_id: string;
  task_id: string;
  owner: string;
  contract: string;
  version: string;
  source_digest: `sha256:${string}`;
  pack: string;
  plant: string;
  scope: string;
}

/**
 * Independently-pinned expected verdict anchor for one consumed artifact.
 * Supplied out-of-band by the verifying authority — never derived from the
 * snapshot. Compatibility requires the consumed artifact/criteria/policy and
 * an independent verifier (never the producer/owner) to match.
 */
export interface ExpectedStageAnchor {
  /** Independent freshness policy, bounded to ten years. */
  max_age_days: number;
  stage_ref: string;
  work_id: string;
  task_id: string;
  owner_contract: string;
  version: string;
  /** Scope of the referenced WorkObject, not the organ selection scope. */
  scope: string;
  plant: string;
  artifact_digest: `sha256:${string}`;
  source_digest: `sha256:${string}`;
  /** Consumer acknowledgment ref — pinned for the consume stage only. */
  consumer_ack?: string;
}

export interface ExpectedVerdictAnchor {
  owner: string;
  version: string;
  plant: string;
  trigger: OrganEvidenceRef["trigger"];
  /** Explicit empty list means this organ has no required input edges. */
  input_dependencies: InputDependencyRef[];
  organ_id: OrganId;
  consumed_ref: string;
  artifact_digest: `sha256:${string}`;
  criteria_digest: `sha256:${string}`;
  policy_digest: `sha256:${string}`;
  verifier_ref: string;
  /** Max age in days before a historical attestation is held as stale. */
  max_age_days: number;
  /**
   * The independently pinned organ/work/producer/consumer edge. Compatibility
   * requires the observed organ's artifact_ref/consumer/contract/source_digest/
   * scope and its joined WorkObject to reconcile against these values — a bare
   * digest/ref match never implies the whole edge.
   */
  work_id: string;
  artifact_ref: string;
  consumer: string;
  organ_contract: string;
  source_digest: `sha256:${string}`;
  scope: string;
  /**
   * Independently pinned provenance stage tuples. Absence is a held incomplete
   * expectation; all four stages are needed for compatibility. Every observed
   * stage must match its own tuple and freshness policy.
   */
  stages?: {
    source: ExpectedStageAnchor;
    released: ExpectedStageAnchor;
    installed: ExpectedStageAnchor;
    consumed: ExpectedStageAnchor;
  };
  /**
   * Required successful fresh evidence. When true, a failed verdict or an
   * expired/stale/unknown attestation freshness holds distinctly even if the
   * identity tuples are internally consistent.
   */
  require_fresh_pass?: boolean;
}

/**
 * Independently-pinned expected Adytum parity context. Parity matches only
 * when the owner/consumer refs, versions, digests and the complete topic join
 * all reconcile against this pinned context.
 */
export interface ExpectedTopicTuple {
  topic_ref: string;
  version: string;
  digest: `sha256:${string}`;
}

export interface ExpectedAdytumContext {
  owner_contract_ref: string;
  owner_contract_version: string;
  owner_contract_digest: `sha256:${string}`;
  /** Complete per-topic ref/version/digest tuples (not just names). */
  owner_topics: ExpectedTopicTuple[];
  consumer_support_ref: string;
  consumer_support_version: string;
  consumer_support_digest: `sha256:${string}`;
  consumer_topics: ExpectedTopicTuple[];
}

/**
 * The full independently-supplied expected context for a compatibility
 * assessment. Absent/partial context yields a HELD / nonauthoritative result
 * even when the snapshot is structurally valid and self-consistent.
 */
export interface MigrationExpectedContext {
  expected_work: ExpectedWorkBinding[];
  expected_verdicts?: ExpectedVerdictAnchor[];
  expected_adytum?: ExpectedAdytumContext;
  expected_capability_hit_source_digest?: `sha256:${string}`;
  /**
   * The explicit selected requirement set for an owned base flow. These are a
   * small set of required IDs the independent authority selects — not a new
   * catalog. Every required ID must have a corresponding matched observation,
   * and every claimed required observation must have an anchor (bidirectional).
   * Unselected organs (e.g. Adytum) remain visibly held in the relationship
   * findings but do NOT block an unrelated selected flow.
   */
  required_work_ids?: string[];
  required_organ_ids?: OrganId[];
  /** When true, the capability-hit catalog digest is a selected requirement. */
  require_capability_hit?: boolean;
  /** Injected evaluation "now" for freshness/age policy. */
  now: string;
}

// ─── Migration snapshot v1 ────────────────────────────────────────────────

export interface MigrationSnapshotV1 {
  schema: typeof MIGRATION_SNAPSHOT_SCHEMA;
  version: { major: number; minor: number };
  observed_at: string;
  profile: "workstation" | "always-on-node" | "recovery" | "browser-worker" | "media-worker" | "native-build" | "noesis-personal" | "cambium-ecosystem";
  source_release_digest: `sha256:${string}`;
  module_lock_digest: `sha256:${string}`;
  logical_module_refs: string[];
  external_product_refs?: ExternalProductRef[];
  organs: {
    operating: OrganEvidenceRef[];
    cognitive: OrganEvidenceRef[];
  };
  knowledge_refs: KnowledgeRef[];
  work_objects: WorkObjectRef[];
  cell_effects: CellEffectClass[];
  will_role_desks: WillRoleDeskAssignment[];
  evidence: EvidenceDimensions;
  toolchain_requirements: ToolchainRequirement[];
  data_classifications: string[];
  held_requirements: string[];
  compatibility_observations?: CompatibilityObservations;
  capability_hit_modes?: CapabilityHitModesDeclaration;
}

// ─── Migration target v1 ─────────────────────────────────────────────────

export interface MigrationTargetV1 {
  schema: typeof MIGRATION_TARGET_SCHEMA;
  version: { major: number; minor: number };
  target_profile: MigrationSnapshotV1["profile"];
  destination_id: string;
  compatibility_check_only: boolean;
  requested_modules: string[];
  held_requirements: string[];
}

// ─── Migration finding v1 ─────────────────────────────────────────────────

export interface MigrationFindingV1 {
  code: string;
  severity: "info" | "warning" | "error";
  subject: string;
  message: string;
  remediation?: string;
}

export interface MakeFindingOptions {
  code: string;
  severity: MigrationFindingV1["severity"];
  subject: string;
  message: string;
  remediation?: string;
}

export function makeMigrationFinding(options: MakeFindingOptions): MigrationFindingV1 {
  const finding: MigrationFindingV1 = {
    code: options.code,
    severity: options.severity,
    subject: options.subject,
    message: options.message,
  };
  if (options.remediation !== undefined) {
    finding.remediation = options.remediation;
  }
  return finding;
}

// ─── Validation result ────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string; details?: string[] };

// ─── WorkObject binding digest ─────────────────────────────────────────────

/**
 * Compute the canonical binding digest for a WorkObjectRef tuple.
 * The digest commits to all nine axes: work_id, task_id, pack, plant,
 * scope, owner, contract, source_digest, version.
 *
 * Fixtures must call this to produce a valid binding_digest.
 * Any axis substitution without recalculating invalidates the binding.
 */
export function computeWorkBindingDigest(ref: {
  work_id: string;
  task_id: string;
  pack: string;
  plant: string;
  scope: string;
  owner: string;
  contract: string;
  source_digest: string;
  version: string;
}): `sha256:${string}` {
  const canonical = JSON.stringify([
    ref.work_id,
    ref.task_id,
    ref.pack,
    ref.plant,
    ref.scope,
    ref.owner,
    ref.contract,
    ref.source_digest,
    ref.version,
  ]);
  const hex = createHash("sha256").update(canonical).digest("hex");
  return `sha256:${hex}`;
}

// ─── Allowlisted keys per object type ────────────────────────────────────

const SNAPSHOT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "schema", "version", "observed_at", "profile",
  "source_release_digest", "module_lock_digest", "logical_module_refs",
  "external_product_refs", "organs", "knowledge_refs", "work_objects",
  "cell_effects", "will_role_desks", "evidence", "toolchain_requirements",
  "data_classifications", "held_requirements", "compatibility_observations",
  "capability_hit_modes",
]);

const VERSION_ALLOWED_KEYS: ReadonlySet<string> = new Set(["major", "minor"]);

const ORGAN_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "organ_id", "owner", "contract", "source_digest", "version",
  "trigger", "artifact_ref", "consumer", "independent_verdict", "freshness",
  "scope", "plant", "admission", "runtime", "verification",
  "verdict_attestation", "artifact_lineage", "adytum_parity", "input_dependencies",
]);

const VERDICT_ATTESTATION_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "artifact_digest", "criteria_digest", "policy_digest",
  "verifier_ref", "attested_at", "freshness",
]);

const ARTIFACT_LINEAGE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "source", "released", "installed", "consumed", "consumed_ref",
]);
const ARTIFACT_STAGE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "stage_ref", "work_id", "task_id", "owner_contract", "version",
  "scope", "plant", "artifact_digest", "source_digest",
  "observed_at", "freshness", "consumer_ack",
]);

const ADYTUM_PARITY_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "owner_contract_ref", "owner_contract_version", "owner_contract_digest",
  "owner_topics", "consumer_support_ref", "consumer_support_version",
  "consumer_support_digest", "consumer_topics",
]);
const ADYTUM_TOPIC_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "topic_ref", "version", "digest",
]);

const KNOWLEDGE_REF_ALLOWED_KEYS_CANONICAL: ReadonlySet<string> = new Set([
  "ref_id", "kind", "source_digest", "version", "freshness",
]);
const KNOWLEDGE_REF_ALLOWED_KEYS_DERIVED: ReadonlySet<string> = new Set([
  "ref_id", "kind", "source_digest", "version", "freshness", "derived_from",
]);

const WORK_OBJECT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "work_id", "task_id", "pack", "plant", "scope", "owner", "contract",
  "source_digest", "version", "binding_digest",
]);

const CELL_EFFECT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "kind", "cell_id", "description", "effect",
]);

const WILL_DESK_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "desk", "assigned_to_organ",
]);

const EVIDENCE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "discovered", "installed", "configured", "auth", "admission",
  "runtime", "verification",
]);

const TOOLCHAIN_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "id", "kind", "version_constraint",
]);

const EXTERNAL_PRODUCT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "product", "owner", "grants_no_install_authority",
]);

const COMPATIBILITY_OBS_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "hardware_model", "chip_model", "architecture", "os_version", "note",
]);

const CAPABILITY_HIT_DECLARATION_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "modes", "catalog_source_ref", "catalog_source_digest",
]);

const CAPABILITY_HIT_MODE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "mode_id", "disabled", "source_ref", "source_digest",
]);

const ORGANS_WRAPPER_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "operating", "cognitive",
]);

// ─── Forbidden keys ───────────────────────────────────────────────────────

const FORBIDDEN_CREDENTIAL_KEYS: ReadonlySet<string> = new Set([
  "credential",
  "api_key",
  "apiKey",
  "secret",
  "password",
  "token",
  "session_id",
  "sessionId",
  "raw_log",
  "raw_path",
  "enrollment_flag",
  "enrollmentFlag",
  "approval",
  "issued_device_identity",
  "issuedDeviceIdentity",
  "__proto__",
  "constructor",
  "prototype",
]);

const PROTOTYPE_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const VALID_PROFILES: ReadonlySet<string> = new Set([
  "workstation",
  "always-on-node",
  "recovery",
  "browser-worker",
  "media-worker",
  "native-build",
  "noesis-personal",
  "cambium-ecosystem",
]);

const VALID_CELL_KINDS: ReadonlySet<string> = new Set(["extract", "feed", "read", "edit"]);
const VALID_CELL_OUTCOMES: ReadonlySet<string> = new Set([
  "observed", "staged", "applied", "held",
]);
const VALID_OPERATING_ORGAN_IDS: ReadonlySet<string> = new Set(OPERATING_ORGAN_IDS);
const VALID_COGNITIVE_ORGAN_IDS: ReadonlySet<string> = new Set(COGNITIVE_ORGAN_IDS);
const VALID_WILL_DESKS: ReadonlySet<string> = new Set(WILL_ROLE_DESKS);
const VALID_TRIGGERS: ReadonlySet<string> = new Set([
  "manual-session", "scheduled", "event-driven", "on-demand",
]);
const VALID_FRESHNESS: ReadonlySet<string> = new Set([
  "fresh", "stale", "expired", "unknown",
]);
const VALID_VERDICTS: ReadonlySet<string> = new Set(["passed", "failed", "unknown"]);
const VALID_ADMISSION: ReadonlySet<string> = new Set([
  "admitted", "pending", "not-admitted", "unknown",
]);
const VALID_RUNTIME: ReadonlySet<string> = new Set([
  "stopped", "running", "unreachable", "unknown",
]);
const VALID_VERIFICATION: ReadonlySet<string> = new Set([
  "verified", "unverified", "failed", "unknown",
]);
const VALID_DISCOVERED: ReadonlySet<string> = new Set(["yes", "no", "unknown"]);
const VALID_INSTALLED: ReadonlySet<string> = new Set(["yes", "no", "unknown"]);
const VALID_CONFIGURED: ReadonlySet<string> = new Set([
  "full", "partial", "none", "unknown",
]);
const VALID_AUTH: ReadonlySet<string> = new Set(["yes", "no", "unknown"]);
const VALID_TOOLCHAIN_KINDS: ReadonlySet<string> = new Set([
  "binary", "devtool", "runtime",
]);
const VALID_CAPABILITY_HIT_MODE_IDS: ReadonlySet<string> = new Set(CAPABILITY_HIT_MODE_IDS);

/**
 * Symbolic ref leak patterns: path separators, home-dir shortcuts,
 * loopback addresses, and common account path fragments.
 * Symbolic logical refs must be opaque token strings, not filesystem paths
 * or network addresses.
 *
 * Retained for the loopback/account denials folded into the positive grammar.
 */
const SYMBOLIC_REF_LEAK_RE = /(?:\/|\\|~\/|127\.0\.0\.1|localhost|::1|@[a-z0-9_-]+\/)/i;

// ─── Positive bounded portable-reference grammar ──────────────────────────

/**
 * Bounded maximum length for a single portable symbolic reference.
 * Oversized refs are rejected before any body/account data can hide in them.
 */
const MAX_PORTABLE_REF_LEN = 256;
/** Bounded maximum length for a human-facing non-secret metadata string. */
const MAX_HUMAN_META_LEN = 512;

/**
 * A portable symbolic reference is a bounded, positively-specified token:
 * one or more dot/plus/hyphen/underscore segments, joined by ":" colons.
 * Each segment starts with an alphanumeric and continues with alphanumerics
 * or the bounded punctuation set [._+-]. This admits refs such as
 *   "cambium:work-contract:modular-mac", "provider.9router",
 *   "thoughtseed-labs:growth-whitepaper:telegram-capability-hit-system.v1"
 * while rejecting account emails ("name@example"), serialized bodies
 * ('{"credential":"x"}'), control characters, slash/backslash private paths,
 * loopback addresses, whitespace, and quotes.
 */
const PORTABLE_REF_RE =
  /^[A-Za-z0-9][A-Za-z0-9._+-]*(?::[A-Za-z0-9][A-Za-z0-9._+-]*)*$/;

/** Control characters (C0 + DEL + C1) are never allowed in any field. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1F\x7F-\x9F]/;

/**
 * Positive bounded portable-reference check. A valid reference matches the
 * positive grammar, carries no control characters, stays within the bounded
 * length, and does not trip the retained loopback/account/path deny patterns.
 * This is NOT prose policing: it is applied only to declared reference fields.
 */
function isPortableRef(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_PORTABLE_REF_LEN) return false;
  if (CONTROL_CHAR_RE.test(value)) return false;
  if (!PORTABLE_REF_RE.test(value)) return false;
  // Defense in depth: the positive grammar already excludes these, but the
  // retained deny patterns stay authoritative for loopback/account/path forms.
  if (SYMBOLIC_REF_LEAK_RE.test(value)) return false;
  return true;
}

/**
 * Bounded non-secret human-facing metadata check for free-text fields
 * (descriptions, notes). These are not references, so the character set is
 * broader, but the value must still be a bounded single-line string with no
 * control characters and no embedded serialized object/credential body.
 */
function isBoundedHumanMeta(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_HUMAN_META_LEN) return false;
  if (CONTROL_CHAR_RE.test(value)) return false;
  // Reject serialized-body shapes that smuggle structured payloads into a
  // nominally human-facing string.
  if (/[{}\[\]]/.test(value)) return false;
  if (/["\\]/.test(value)) return false;
  if (SYMBOLIC_REF_LEAK_RE.test(value) || /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/.test(value)) return false;
  return true;
}

// ─── Low-level validators ─────────────────────────────────────────────────

function checkForbiddenKeys(obj: Record<string, unknown>): string | null {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_CREDENTIAL_KEYS.has(key)) {
      return `FORBIDDEN_KEY:${key}`;
    }
  }
  return null;
}

function checkNestedPrototypeKeys(value: unknown, depth: number = 0): boolean {
  if (depth > MAX_OBJECT_DEPTH) return false;
  if (value === null || typeof value !== "object") return true;
  if (Array.isArray(value)) {
    return value.every((item) => checkNestedPrototypeKeys(item, depth + 1));
  }
  const obj = value as Record<string, unknown>;
  if (Object.getPrototypeOf(obj) !== Object.prototype && Object.getPrototypeOf(obj) !== null) return false;
  for (const key of Object.keys(obj)) {
    if (PROTOTYPE_KEYS.has(key)) return false;
    if (!checkNestedPrototypeKeys(obj[key], depth + 1)) return false;
  }
  return true;
}

/**
 * Check that an object's keys are a subset of the allowed set.
 * Returns error reason string or null.
 */
function checkAllowedKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  context: string,
): string | null {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      return `UNKNOWN_KEY:${context}:${key}`;
    }
  }
  return null;
}

function isValidDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && SHA256_RE.test(value);
}

/**
 * Validate a real calendar timestamp: the parsed date's Y/M/D must equal
 * the literal values in the string (prevents JS normalization of Feb-30 etc).
 * Also rejects epoch-zero forms and future timestamps for freshness claims.
 */
function isValidCalendarTimestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (!ISO8601_RE.test(value)) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  // Reject epoch-zero in all forms
  const ms = d.getTime();
  if (ms === 0) return false;
  // Validate calendar: extract year, month, day from the literal string
  const datePart = value.slice(0, 10); // "YYYY-MM-DD"
  const [yearStr, monthStr, dayStr] = datePart.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  // JavaScript normalizes invalid dates (Feb 30 → March 1-2);
  // we verify by re-checking that the parsed UTC components match the literal.
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    return false;
  }
  return true;
}

function isNonEpochValidTimestamp(value: unknown): boolean {
  return isValidCalendarTimestamp(value);
}

/**
 * Check that a symbolic ref string does not contain path separators,
 * home-dir shortcuts, loopback addresses, or account path fragments.
 */
function isCleanSymbolicRef(value: unknown): boolean {
  // Upgraded to the positive bounded portable-reference grammar: a clean
  // symbolic ref must match the positive token grammar, not merely avoid the
  // deny patterns. This closes account-email, serialized-body, control-char
  // and oversized-ref admissions in every reference field.
  return isPortableRef(value);
}

// ─── Nested object validators ─────────────────────────────────────────────

function validateVerdictAttestation(
  attestation: unknown,
  snapshotObservedAt: string,
): string | null {
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
    return "VERDICT_ATTESTATION_INVALID";
  }
  const a = attestation as Record<string, unknown>;
  // Closed allowlist
  const keyErr = checkAllowedKeys(a, VERDICT_ATTESTATION_ALLOWED_KEYS, "verdict_attestation");
  if (keyErr !== null) return keyErr;

  if (!isValidDigest(a["artifact_digest"])) return "VERDICT_ATTESTATION_MISSING_ARTIFACT_DIGEST";
  if (!isValidDigest(a["criteria_digest"])) return "VERDICT_ATTESTATION_MISSING_CRITERIA_DIGEST";
  if (!isValidDigest(a["policy_digest"])) return "VERDICT_ATTESTATION_MISSING_POLICY_DIGEST";
  if (typeof a["verifier_ref"] !== "string" || a["verifier_ref"].length === 0) {
    return "VERDICT_ATTESTATION_MISSING_VERIFIER_REF";
  }
  if (!isCleanSymbolicRef(a["verifier_ref"])) {
    return "VERDICT_ATTESTATION_VERIFIER_REF_LEAK";
  }
  if (!isNonEpochValidTimestamp(a["attested_at"])) return "VERDICT_ATTESTATION_INVALID_TIMESTAMP";
  if (!VALID_FRESHNESS.has(a["freshness"] as string)) return "VERDICT_ATTESTATION_INVALID_FRESHNESS";

  // Future attestation cannot be fresh: attested_at > snapshot observed_at → freshness must not be "fresh"
  const attestedMs = new Date(a["attested_at"] as string).getTime();
  const snapshotMs = new Date(snapshotObservedAt).getTime();
  if (attestedMs > snapshotMs && a["freshness"] === "fresh") {
    return "VERDICT_ATTESTATION_FUTURE_FRESH";
  }
  return null;
}

function validateArtifactStage(
  stage: unknown,
  stageName: string,
  requireConsumerAck: boolean,
): string | null {
  const upper = stageName.toUpperCase();
  if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
    return `ARTIFACT_STAGE_${upper}_INVALID`;
  }
  const st = stage as Record<string, unknown>;
  const keyErr = checkAllowedKeys(st, ARTIFACT_STAGE_ALLOWED_KEYS, `artifact_stage_${stageName}`);
  if (keyErr !== null) return keyErr;
  const forbidErr = checkForbiddenKeys(st);
  if (forbidErr !== null) return `ARTIFACT_STAGE_${upper}_${forbidErr}`;

  for (const refField of ["stage_ref", "work_id", "task_id", "owner_contract", "version", "scope", "plant"] as const) {
    if (!isPortableRef(st[refField])) return `ARTIFACT_STAGE_${upper}_${refField.toUpperCase()}_REF_LEAK`;
  }
  if (!isValidDigest(st["artifact_digest"])) return `ARTIFACT_STAGE_${upper}_INVALID_ARTIFACT_DIGEST`;
  if (!isValidDigest(st["source_digest"])) return `ARTIFACT_STAGE_${upper}_INVALID_SOURCE_DIGEST`;
  if (!isNonEpochValidTimestamp(st["observed_at"])) return `ARTIFACT_STAGE_${upper}_INVALID_OBSERVED_AT`;
  if (!VALID_FRESHNESS.has(st["freshness"] as string)) return `ARTIFACT_STAGE_${upper}_INVALID_FRESHNESS`;

  if (requireConsumerAck) {
    if (!isPortableRef(st["consumer_ack"])) return `ARTIFACT_STAGE_${upper}_INVALID_CONSUMER_ACK`;
  } else if (st["consumer_ack"] !== undefined) {
    return `ARTIFACT_STAGE_${upper}_UNEXPECTED_CONSUMER_ACK`;
  }
  return null;
}

function validateArtifactLineage(lineage: unknown): string | null {
  if (!lineage || typeof lineage !== "object" || Array.isArray(lineage)) {
    return "ARTIFACT_LINEAGE_INVALID";
  }
  const l = lineage as Record<string, unknown>;
  // Closed allowlist
  const keyErr = checkAllowedKeys(l, ARTIFACT_LINEAGE_ALLOWED_KEYS, "artifact_lineage");
  if (keyErr !== null) return keyErr;

  const sourceErr = validateArtifactStage(l["source"], "source", false);
  if (sourceErr !== null) return sourceErr;
  const releasedErr = validateArtifactStage(l["released"], "released", false);
  if (releasedErr !== null) return releasedErr;
  const installedErr = validateArtifactStage(l["installed"], "installed", false);
  if (installedErr !== null) return installedErr;
  // The consume stage carries the consumer acknowledgment.
  const consumedErr = validateArtifactStage(l["consumed"], "consumed", true);
  if (consumedErr !== null) return consumedErr;

  // consumed_ref is the symbolic pointer used by the verdict-anchor edge; it
  // must agree with the typed consume stage ref.
  if (!isCleanSymbolicRef(l["consumed_ref"])) return "ARTIFACT_LINEAGE_INVALID_CONSUMED_REF";
  const consumedStage = l["consumed"] as Record<string, unknown>;
  if (l["consumed_ref"] !== consumedStage["stage_ref"]) {
    return "ARTIFACT_LINEAGE_CONSUMED_REF_MISMATCH";
  }
  return null;
}

function validateAdytumTopic(topic: unknown): string | null {
  if (!topic || typeof topic !== "object" || Array.isArray(topic)) {
    return "ADYTUM_TOPIC_INVALID";
  }
  const t = topic as Record<string, unknown>;
  const keyErr = checkAllowedKeys(t, ADYTUM_TOPIC_ALLOWED_KEYS, "adytum_topic");
  if (keyErr !== null) return keyErr;
  if (!isCleanSymbolicRef(t["topic_ref"])) return "ADYTUM_TOPIC_REF_LEAK";
  if (typeof t["version"] !== "string" || t["version"].length === 0) {
    return "ADYTUM_TOPIC_MISSING_VERSION";
  }
  if (!isValidDigest(t["digest"])) return "ADYTUM_TOPIC_INVALID_DIGEST";
  return null;
}

function validateAdytumParity(parity: unknown): string | null {
  if (!parity || typeof parity !== "object" || Array.isArray(parity)) {
    return "ADYTUM_PARITY_INVALID";
  }
  const p = parity as Record<string, unknown>;
  // Closed allowlist
  const keyErr = checkAllowedKeys(p, ADYTUM_PARITY_ALLOWED_KEYS, "adytum_parity");
  if (keyErr !== null) return keyErr;

  // Owner (Hermes) side — independently versioned 9-topic set.
  if (!isCleanSymbolicRef(p["owner_contract_ref"])) return "ADYTUM_PARITY_OWNER_REF_LEAK";
  if (typeof p["owner_contract_version"] !== "string" || (p["owner_contract_version"] as string).length === 0) {
    return "ADYTUM_PARITY_MISSING_OWNER_VERSION";
  }
  if (!isValidDigest(p["owner_contract_digest"])) {
    return "ADYTUM_PARITY_MISSING_OWNER_CONTRACT_DIGEST";
  }
  if (!Array.isArray(p["owner_topics"])) return "ADYTUM_PARITY_OWNER_TOPICS_NOT_ARRAY";
  const ownerTopics = p["owner_topics"] as unknown[];
  if (ownerTopics.length !== ADYTUM_OWNER_TOPIC_COUNT) {
    return "ADYTUM_PARITY_OWNER_TOPIC_COUNT";
  }
  const ownerSeen = new Set<string>();
  for (const t of ownerTopics) {
    const err = validateAdytumTopic(t);
    if (err !== null) return err;
    const ref = (t as Record<string, unknown>)["topic_ref"] as string;
    if (ownerSeen.has(ref)) return "ADYTUM_PARITY_DUPLICATE_OWNER_TOPIC";
    ownerSeen.add(ref);
  }

  // Consumer (Cambium) side — independently versioned 8-topic set.
  if (!isCleanSymbolicRef(p["consumer_support_ref"])) return "ADYTUM_PARITY_CONSUMER_REF_LEAK";
  if (typeof p["consumer_support_version"] !== "string" || (p["consumer_support_version"] as string).length === 0) {
    return "ADYTUM_PARITY_MISSING_CONSUMER_VERSION";
  }
  if (!isValidDigest(p["consumer_support_digest"])) {
    return "ADYTUM_PARITY_MISSING_CONSUMER_SUPPORT_DIGEST";
  }
  if (!Array.isArray(p["consumer_topics"])) return "ADYTUM_PARITY_CONSUMER_TOPICS_NOT_ARRAY";
  const consumerTopics = p["consumer_topics"] as unknown[];
  if (consumerTopics.length !== ADYTUM_CONSUMER_TOPIC_COUNT) {
    return "ADYTUM_PARITY_CONSUMER_TOPIC_COUNT";
  }
  const consumerSeen = new Set<string>();
  for (const t of consumerTopics) {
    const err = validateAdytumTopic(t);
    if (err !== null) return err;
    const ref = (t as Record<string, unknown>)["topic_ref"] as string;
    if (consumerSeen.has(ref)) return "ADYTUM_PARITY_DUPLICATE_CONSUMER_TOPIC";
    consumerSeen.add(ref);
  }
  return null;
}

function validateOrganRef(
  ref: unknown,
  snapshotObservedAt: string,
  category: "operating" | "cognitive",
): string | null {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return "INVALID_ORGAN_REF";
  const o = ref as Record<string, unknown>;

  // Closed allowlist
  const keyErr = checkAllowedKeys(o, ORGAN_ALLOWED_KEYS, "organ");
  if (keyErr !== null) return keyErr;

  const inputErr = validateInputDependencies(o["input_dependencies"]);
  if (inputErr !== null) return inputErr;

  // Forbidden nested credential keys
  const forbidErr = checkForbiddenKeys(o);
  if (forbidErr !== null) return `ORGAN_${forbidErr}`;

  if (typeof o["organ_id"] !== "string" || o["organ_id"].length === 0) return "ORGAN_MISSING_ID";
  // organ_id must be one of the canonical source-owned organs for its category.
  const allowedIds = category === "operating"
    ? VALID_OPERATING_ORGAN_IDS
    : VALID_COGNITIVE_ORGAN_IDS;
  if (!allowedIds.has(o["organ_id"] as string)) {
    return category === "operating"
      ? "ORGAN_UNKNOWN_OPERATING_ID"
      : "ORGAN_UNKNOWN_COGNITIVE_ID";
  }
  if (typeof o["owner"] !== "string" || o["owner"].length === 0) return "ORGAN_MISSING_OWNER";
  if (!isCleanSymbolicRef(o["owner"])) return "ORGAN_OWNER_REF_LEAK";
  if (typeof o["contract"] !== "string" || o["contract"].length === 0) return "ORGAN_MISSING_CONTRACT";
  if (!isCleanSymbolicRef(o["contract"])) return "ORGAN_CONTRACT_REF_LEAK";
  if (!isValidDigest(o["source_digest"])) return "ORGAN_INVALID_DIGEST";
  if (typeof o["version"] !== "string" || o["version"].length === 0) return "ORGAN_MISSING_VERSION";
  if (!VALID_TRIGGERS.has(o["trigger"] as string)) return "ORGAN_INVALID_TRIGGER";
  if (typeof o["consumer"] !== "string" || o["consumer"].length === 0) return "ORGAN_MISSING_CONSUMER";
  if (!isCleanSymbolicRef(o["consumer"])) return "ORGAN_CONSUMER_REF_LEAK";
  if (!VALID_FRESHNESS.has(o["freshness"] as string)) return "ORGAN_INVALID_FRESHNESS";
  if (typeof o["scope"] !== "string" || o["scope"].length === 0) return "ORGAN_MISSING_SCOPE";
  if (!isCleanSymbolicRef(o["scope"])) return "ORGAN_SCOPE_REF_LEAK";
  if (typeof o["plant"] !== "string" || o["plant"].length === 0) return "ORGAN_MISSING_PLANT";
  if (!isCleanSymbolicRef(o["plant"])) return "ORGAN_PLANT_REF_LEAK";
  if (!isPortableRef(o["version"])) return "ORGAN_VERSION_REF_LEAK";
  if (!VALID_ADMISSION.has(o["admission"] as string)) return "ORGAN_INVALID_ADMISSION";
  if (!VALID_RUNTIME.has(o["runtime"] as string)) return "ORGAN_INVALID_RUNTIME";
  if (!VALID_VERIFICATION.has(o["verification"] as string)) return "ORGAN_INVALID_VERIFICATION";

  // Adytum parity rule: if organ_id is "adytum" and verification is "verified",
  // adytum_parity MUST be present with both digest fields.
  if (
    o["organ_id"] === "adytum" &&
    o["verification"] === "verified" &&
    (o["adytum_parity"] === undefined || o["adytum_parity"] === null)
  ) {
    return "ADYTUM_VERIFIED_WITHOUT_PARITY";
  }

  // Verdict attestation rule: must be present iff verdict is non-unknown
  const verdict = o["independent_verdict"];
  const attestation = o["verdict_attestation"];
  if (verdict === "passed" || verdict === "failed") {
    if (attestation === undefined || attestation === null) {
      return "ORGAN_VERDICT_MISSING_ATTESTATION";
    }
    const err = validateVerdictAttestation(attestation, snapshotObservedAt);
    if (err !== null) return err;
  } else if (verdict === "unknown") {
    if (attestation !== undefined && attestation !== null) {
      return "ORGAN_UNKNOWN_VERDICT_HAS_ATTESTATION";
    }
  } else {
    return "ORGAN_INVALID_VERDICT";
  }

  // artifact_lineage — optional, validated when present
  if (o["artifact_lineage"] !== undefined && o["artifact_lineage"] !== null) {
    const err = validateArtifactLineage(o["artifact_lineage"]);
    if (err !== null) return err;
  }

  // adytum_parity — optional, validated when present
  if (o["adytum_parity"] !== undefined && o["adytum_parity"] !== null) {
    const err = validateAdytumParity(o["adytum_parity"]);
    if (err !== null) return err;
  }

  // artifact_ref must be a clean symbolic ref (no path/loopback leak)
  if (!isCleanSymbolicRef(o["artifact_ref"])) return "ORGAN_ARTIFACT_REF_LEAK";

  return null;
}

function validateKnowledgeRef(ref: unknown): string | null {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return "INVALID_KNOWLEDGE_REF";
  const o = ref as Record<string, unknown>;

  // Closed allowlist depends on kind
  const kind = o["kind"];
  const allowed =
    kind === "canonical"
      ? KNOWLEDGE_REF_ALLOWED_KEYS_CANONICAL
      : KNOWLEDGE_REF_ALLOWED_KEYS_DERIVED;
  const keyErr = checkAllowedKeys(o, allowed, "knowledge_ref");
  if (keyErr !== null) return keyErr;

  if (typeof o["ref_id"] !== "string" || o["ref_id"].length === 0) return "KNOWLEDGE_MISSING_REF_ID";
  if (!isValidDigest(o["source_digest"])) return "KNOWLEDGE_INVALID_DIGEST";
  if (typeof o["version"] !== "string" || o["version"].length === 0) return "KNOWLEDGE_MISSING_VERSION";
  if (!VALID_FRESHNESS.has(o["freshness"] as string)) return "KNOWLEDGE_INVALID_FRESHNESS";

  // ref_id must be a clean symbolic ref
  if (!isCleanSymbolicRef(o["ref_id"])) return "KNOWLEDGE_REF_ID_LEAK";

  if (kind === "canonical") {
    if ("derived_from" in o && o["derived_from"] !== undefined) return "CANONICAL_HAS_DERIVED_FROM";
  } else if (kind === "derived") {
    if (typeof o["derived_from"] !== "string" || o["derived_from"].length === 0) {
      return "DERIVED_MISSING_DERIVED_FROM";
    }
    if (!isCleanSymbolicRef(o["derived_from"])) return "DERIVED_FROM_REF_LEAK";
  } else {
    return "KNOWLEDGE_INVALID_KIND";
  }
  return null;
}

function validateWorkObject(obj: unknown): string | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "INVALID_WORK_OBJECT";
  const o = obj as Record<string, unknown>;

  // Closed allowlist
  const keyErr = checkAllowedKeys(o, WORK_OBJECT_ALLOWED_KEYS, "work_object");
  if (keyErr !== null) return keyErr;

  // Forbidden keys
  const forbidErr = checkForbiddenKeys(o);
  if (forbidErr !== null) return `WORK_${forbidErr}`;

  if (typeof o["work_id"] !== "string" || o["work_id"].length === 0) return "WORK_MISSING_WORK_ID";
  if (typeof o["task_id"] !== "string" || o["task_id"].length === 0) return "WORK_MISSING_TASK_ID";
  if (typeof o["owner"] !== "string" || o["owner"].length === 0) return "WORK_MISSING_OWNER";
  if (typeof o["pack"] !== "string" || o["pack"].length === 0) return "WORK_MISSING_PACK";
  if (typeof o["plant"] !== "string" || o["plant"].length === 0) return "WORK_MISSING_PLANT";
  if (typeof o["scope"] !== "string" || o["scope"].length === 0) return "WORK_MISSING_SCOPE";
  if (typeof o["contract"] !== "string" || o["contract"].length === 0) return "WORK_MISSING_CONTRACT";
  if (!isValidDigest(o["source_digest"])) return "WORK_INVALID_SOURCE_DIGEST";
  if (typeof o["version"] !== "string" || o["version"].length === 0) return "WORK_MISSING_VERSION";

  // Every reference-shaped axis must satisfy the positive portable-reference
  // grammar — no account/path/body/control data under a reference field.
  if (!isPortableRef(o["work_id"])) return "WORK_WORK_ID_REF_LEAK";
  if (!isPortableRef(o["task_id"])) return "WORK_TASK_ID_REF_LEAK";
  if (!isPortableRef(o["owner"])) return "WORK_OWNER_REF_LEAK";
  if (!isPortableRef(o["contract"])) return "WORK_CONTRACT_REF_LEAK";
  if (!isPortableRef(o["pack"])) return "WORK_PACK_REF_LEAK";
  if (!isPortableRef(o["plant"])) return "WORK_PLANT_REF_LEAK";
  if (!isPortableRef(o["scope"])) return "WORK_SCOPE_REF_LEAK";
  if (!isPortableRef(o["version"])) return "WORK_VERSION_REF_LEAK";

  // Binding digest: if present, must match computed value
  if (o["binding_digest"] !== undefined && o["binding_digest"] !== null) {
    if (!isValidDigest(o["binding_digest"])) return "WORK_INVALID_BINDING_DIGEST_FORMAT";
    const expected = computeWorkBindingDigest({
      work_id: o["work_id"] as string,
      task_id: o["task_id"] as string,
      pack: o["pack"] as string,
      plant: o["plant"] as string,
      scope: o["scope"] as string,
      owner: o["owner"] as string,
      contract: o["contract"] as string,
      source_digest: o["source_digest"] as string,
      version: o["version"] as string,
    });
    if (o["binding_digest"] !== expected) return "WORK_BINDING_DIGEST_MISMATCH";
  }

  return null;
}

function validateCellEffect(eff: unknown): string | null {
  if (!eff || typeof eff !== "object" || Array.isArray(eff)) return "INVALID_CELL_EFFECT";
  const o = eff as Record<string, unknown>;

  // Closed allowlist + forbidden nested credential keys.
  const keyErr = checkAllowedKeys(o, CELL_EFFECT_ALLOWED_KEYS, "cell_effect");
  if (keyErr !== null) return keyErr;
  const forbidErr = checkForbiddenKeys(o);
  if (forbidErr !== null) return `CELL_EFFECT_${forbidErr}`;

  if (!VALID_CELL_KINDS.has(o["kind"] as string)) return "INVALID_CELL_EFFECT_KIND";
  if (!isCleanSymbolicRef(o["cell_id"])) return "CELL_EFFECT_CELL_ID_LEAK";
  // description is a bounded human-facing string, never a nested body or a
  // smuggled serialized payload.
  if (typeof o["description"] !== "string" || o["description"].length === 0) {
    return "CELL_EFFECT_MISSING_DESCRIPTION";
  }
  if (!isBoundedHumanMeta(o["description"])) return "CELL_EFFECT_DESCRIPTION_INVALID";
  if (!VALID_CELL_OUTCOMES.has(o["effect"] as string)) return "CELL_EFFECT_INVALID_EFFECT";
  return null;
}

function validateWillRoleDeskAssignment(assignment: unknown, index: number): string | null {
  if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) {
    return `INVALID_WILL_DESK_AT_${index}`;
  }
  const o = assignment as Record<string, unknown>;

  // Closed allowlist
  const keyErr = checkAllowedKeys(o, WILL_DESK_ALLOWED_KEYS, "will_desk");
  if (keyErr !== null) return keyErr;

  if (!VALID_WILL_DESKS.has(o["desk"] as string)) return `INVALID_WILL_DESK_NAME:${o["desk"]}`;
  // Desks are role filters inside the Will organ; they are never new organs.
  if (o["assigned_to_organ"] !== "will") return "WILL_DESK_NOT_BOUND_TO_WILL";
  return null;
}

function validateEvidenceDimensions(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return "INVALID_EVIDENCE";
  }
  const e = evidence as Record<string, unknown>;

  // Closed allowlist
  const keyErr = checkAllowedKeys(e, EVIDENCE_ALLOWED_KEYS, "evidence");
  if (keyErr !== null) return keyErr;

  if (!VALID_DISCOVERED.has(e["discovered"] as string)) return "EVIDENCE_INVALID_DISCOVERED";
  if (!VALID_INSTALLED.has(e["installed"] as string)) return "EVIDENCE_INVALID_INSTALLED";
  if (!VALID_CONFIGURED.has(e["configured"] as string)) return "EVIDENCE_INVALID_CONFIGURED";
  if (!VALID_AUTH.has(e["auth"] as string)) return "EVIDENCE_INVALID_AUTH";
  if (!VALID_ADMISSION.has(e["admission"] as string)) return "EVIDENCE_INVALID_ADMISSION";
  if (!VALID_RUNTIME.has(e["runtime"] as string)) return "EVIDENCE_INVALID_RUNTIME";
  if (!VALID_VERIFICATION.has(e["verification"] as string)) return "EVIDENCE_INVALID_VERIFICATION";

  return null;
}

function validateToolchainRequirement(req: unknown): string | null {
  if (!req || typeof req !== "object" || Array.isArray(req)) return "INVALID_TOOLCHAIN_REQ";
  const o = req as Record<string, unknown>;

  // Closed allowlist
  const keyErr = checkAllowedKeys(o, TOOLCHAIN_ALLOWED_KEYS, "toolchain_req");
  if (keyErr !== null) return keyErr;

  if (typeof o["id"] !== "string" || o["id"].length === 0) return "TOOLCHAIN_MISSING_ID";
  if (!isCleanSymbolicRef(o["id"])) return "TOOLCHAIN_ID_LEAK";
  if (!VALID_TOOLCHAIN_KINDS.has(o["kind"] as string)) return "TOOLCHAIN_INVALID_KIND";
  if (typeof o["version_constraint"] !== "string" || o["version_constraint"].length === 0) {
    return "TOOLCHAIN_MISSING_VERSION_CONSTRAINT";
  }
  return null;
}

function validateExternalProductRef(ref: unknown): string | null {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return "INVALID_EXTERNAL_PRODUCT_REF";
  const o = ref as Record<string, unknown>;

  // Closed allowlist
  const keyErr = checkAllowedKeys(o, EXTERNAL_PRODUCT_ALLOWED_KEYS, "external_product_ref");
  if (keyErr !== null) return keyErr;

  if (typeof o["product"] !== "string" || o["product"].length === 0) {
    return "EXTERNAL_PRODUCT_MISSING_PRODUCT";
  }
  if (!isPortableRef(o["product"])) return "EXTERNAL_PRODUCT_PRODUCT_REF_LEAK";
  if (typeof o["owner"] !== "string" || o["owner"].length === 0) {
    return "EXTERNAL_PRODUCT_MISSING_OWNER";
  }
  if (!isPortableRef(o["owner"])) return "EXTERNAL_PRODUCT_OWNER_REF_LEAK";
  if (o["grants_no_install_authority"] !== true) {
    return "EXTERNAL_PRODUCT_MISSING_NO_AUTHORITY_FLAG";
  }
  return null;
}

/**
 * Validate that CompatibilityObservations do not contain authorization tokens.
 * Hardware observations must remain purely observational — they may not contain
 * patterns that resemble authorization grants, device identity issuance, or
 * destination effect approvals.
 */
const COMPATIBILITY_NOTE_FORBIDDEN_RE =
  /\b(?:authorized|approval|auth:yes|device-identity|destination-effect|issued-by|grant)\b/i;

function validateCompatibilityObservations(obs: unknown): string | null {
  if (!obs || typeof obs !== "object" || Array.isArray(obs)) return "INVALID_COMPATIBILITY_OBS";
  const o = obs as Record<string, unknown>;

  // Closed allowlist
  const keyErr = checkAllowedKeys(o, COMPATIBILITY_OBS_ALLOWED_KEYS, "compatibility_obs");
  if (keyErr !== null) return keyErr;

  // Every allowed field is a plain scalar string, never a nested body.
  for (const field of ["hardware_model", "chip_model", "architecture", "os_version", "note"] as const) {
    if (typeof o[field] !== "string") return `COMPATIBILITY_OBS_INVALID_${field.toUpperCase()}`;
  }
  if (!isBoundedHumanMeta(o["note"])) return "COMPATIBILITY_OBS_NOTE_INVALID";
  if (COMPATIBILITY_NOTE_FORBIDDEN_RE.test(o["note"] as string)) {
    return "COMPATIBILITY_OBS_CONTAINS_AUTH_TOKEN";
  }
  return null;
}

function validateCapabilityHitModesDeclaration(decl: unknown): string | null {
  if (!decl || typeof decl !== "object" || Array.isArray(decl)) {
    return "INVALID_CAPABILITY_HIT_DECLARATION";
  }
  const d = decl as Record<string, unknown>;

  // Closed allowlist
  const keyErr = checkAllowedKeys(d, CAPABILITY_HIT_DECLARATION_ALLOWED_KEYS, "capability_hit_modes");
  if (keyErr !== null) return keyErr;

  if (d["catalog_source_ref"] !== CAPABILITY_HIT_SOURCE_REF) {
    return "CAPABILITY_HIT_INVALID_SOURCE_REF";
  }
  if (!isValidDigest(d["catalog_source_digest"])) {
    return "CAPABILITY_HIT_INVALID_SOURCE_DIGEST";
  }
  if (!Array.isArray(d["modes"])) return "CAPABILITY_HIT_MODES_NOT_ARRAY";
  const catalogDigest = d["catalog_source_digest"] as string;

  const seenModes = new Set<string>();
  for (const mode of d["modes"] as unknown[]) {
    if (!mode || typeof mode !== "object" || Array.isArray(mode)) {
      return "CAPABILITY_HIT_MODE_INVALID";
    }
    const m = mode as Record<string, unknown>;

    // Closed allowlist
    const modeKeyErr = checkAllowedKeys(m, CAPABILITY_HIT_MODE_ALLOWED_KEYS, "capability_hit_mode");
    if (modeKeyErr !== null) return modeKeyErr;

    if (!VALID_CAPABILITY_HIT_MODE_IDS.has(m["mode_id"] as string)) {
      return "CAPABILITY_HIT_UNKNOWN_MODE_ID";
    }
    if (m["disabled"] !== true) return "CAPABILITY_HIT_MODE_NOT_DISABLED";
    if (m["source_ref"] !== CAPABILITY_HIT_SOURCE_REF) {
      return "CAPABILITY_HIT_MODE_INVALID_SOURCE_REF";
    }
    if (!isValidDigest(m["source_digest"])) return "CAPABILITY_HIT_MODE_INVALID_SOURCE_DIGEST";
    // Each mode's source_digest must agree with the declared catalog digest.
    if (m["source_digest"] !== catalogDigest) {
      return "CAPABILITY_HIT_MODE_DIGEST_MISMATCH";
    }
    if (seenModes.has(m["mode_id"] as string)) return "CAPABILITY_HIT_DUPLICATE_MODE";
    seenModes.add(m["mode_id"] as string);
  }

  // The declared set must contain exactly the complete four known modes.
  if (seenModes.size !== CAPABILITY_HIT_MODE_IDS.length) {
    return "CAPABILITY_HIT_INCOMPLETE_MODE_SET";
  }
  for (const id of CAPABILITY_HIT_MODE_IDS) {
    if (!seenModes.has(id)) return "CAPABILITY_HIT_MISSING_MODE";
  }

  return null;
}

function sizeBytes(value: unknown): number {
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== "string") return Infinity;
    return new TextEncoder().encode(encoded).byteLength;
  } catch {
    return Infinity;
  }
}

// ─── validateMigrationSnapshot ────────────────────────────────────────────

export function validateMigrationSnapshot(value: unknown): ValidationResult {
  // Basic type check
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "INVALID_TYPE" };
  }

  const obj = value as Record<string, unknown>;

  // Size check (must come before expensive field processing)
  if (sizeBytes(obj) > MAX_MIGRATION_SNAPSHOT_BYTES) {
    return { ok: false, reason: "EXCEEDS_SIZE_LIMIT" };
  }

  // Prototype pollution guard (top-level and nested)
  const forbiddenKey = checkForbiddenKeys(obj);
  if (forbiddenKey !== null) {
    return { ok: false, reason: "FORBIDDEN_PAYLOAD", details: [forbiddenKey] };
  }
  if (!checkNestedPrototypeKeys(obj)) {
    return { ok: false, reason: "PROTOTYPE_POLLUTION" };
  }

  // Closed allowlist — root object
  const rootKeyErr = checkAllowedKeys(obj, SNAPSHOT_ALLOWED_KEYS, "snapshot");
  if (rootKeyErr !== null) {
    return { ok: false, reason: "UNKNOWN_SNAPSHOT_KEY", details: [rootKeyErr] };
  }

  // Schema
  if (obj["schema"] !== MIGRATION_SNAPSHOT_SCHEMA) {
    return { ok: false, reason: "INVALID_SCHEMA" };
  }

  // Version
  const version = obj["version"];
  if (!version || typeof version !== "object" || Array.isArray(version)) {
    return { ok: false, reason: "INVALID_VERSION" };
  }
  const versionObj = version as Record<string, unknown>;

  // Closed version object
  const versionKeyErr = checkAllowedKeys(versionObj, VERSION_ALLOWED_KEYS, "version");
  if (versionKeyErr !== null) {
    return { ok: false, reason: "UNKNOWN_VERSION_KEY", details: [versionKeyErr] };
  }

  if (typeof versionObj["major"] !== "number" || typeof versionObj["minor"] !== "number") {
    return { ok: false, reason: "INVALID_VERSION" };
  }
  if (!Number.isInteger(versionObj["major"]) || !Number.isInteger(versionObj["minor"])) {
    return { ok: false, reason: "INVALID_VERSION" };
  }
  if ((versionObj["minor"] as number) < 0) {
    return { ok: false, reason: "INVALID_VERSION" };
  }
  if (versionObj["major"] !== SUPPORTED_SNAPSHOT_MAJOR) {
    return { ok: false, reason: "UPGRADE_REQUIRED" };
  }

  // observed_at — valid calendar, non-epoch
  if (!isNonEpochValidTimestamp(obj["observed_at"])) {
    return { ok: false, reason: "INVALID_EVIDENCE_TIME" };
  }
  const snapshotObservedAt = obj["observed_at"] as string;

  // profile
  if (!VALID_PROFILES.has(obj["profile"] as string)) {
    return { ok: false, reason: "INVALID_PROFILE" };
  }

  // source_release_digest
  if (!isValidDigest(obj["source_release_digest"])) {
    return { ok: false, reason: "INVALID_SOURCE_RELEASE_DIGEST" };
  }

  // module_lock_digest
  if (!isValidDigest(obj["module_lock_digest"])) {
    return { ok: false, reason: "INVALID_MODULE_LOCK_DIGEST" };
  }

  // logical_module_refs — must be unique
  const moduleRefs = obj["logical_module_refs"];
  if (!Array.isArray(moduleRefs)) {
    return { ok: false, reason: "INVALID_MODULE_REFS" };
  }
  for (const ref of moduleRefs) {
    if (!isCleanSymbolicRef(ref)) {
      return { ok: false, reason: "INVALID_MODULE_REF_VALUE" };
    }
  }
  if (new Set(moduleRefs).size !== moduleRefs.length) {
    return { ok: false, reason: "DUPLICATE_MODULE_REF" };
  }

  // external_product_refs — optional; each must declare no authority
  if (obj["external_product_refs"] !== undefined && obj["external_product_refs"] !== null) {
    if (!Array.isArray(obj["external_product_refs"])) {
      return { ok: false, reason: "INVALID_EXTERNAL_PRODUCT_REFS" };
    }
    for (const ref of obj["external_product_refs"]) {
      const err = validateExternalProductRef(ref);
      if (err !== null) return { ok: false, reason: err };
    }
  }

  // organs — wrapper object must be closed
  const organs = obj["organs"];
  if (!organs || typeof organs !== "object" || Array.isArray(organs)) {
    return { ok: false, reason: "INVALID_ORGANS" };
  }
  const organsObj = organs as Record<string, unknown>;

  const organsKeyErr = checkAllowedKeys(organsObj, ORGANS_WRAPPER_ALLOWED_KEYS, "organs");
  if (organsKeyErr !== null) {
    return { ok: false, reason: "UNKNOWN_ORGANS_KEY", details: [organsKeyErr] };
  }

  if (!Array.isArray(organsObj["operating"]) || !Array.isArray(organsObj["cognitive"])) {
    return { ok: false, reason: "INVALID_ORGANS" };
  }
  const operatingRefs = organsObj["operating"] as unknown[];
  const cognitiveRefs = organsObj["cognitive"] as unknown[];
  if (operatingRefs.length !== OPERATING_ORGAN_IDS.length) {
    return { ok: false, reason: "OPERATING_ORGAN_COUNT_INVALID" };
  }
  if (cognitiveRefs.length !== COGNITIVE_ORGAN_IDS.length) {
    return { ok: false, reason: "COGNITIVE_ORGAN_COUNT_INVALID" };
  }
  const seenOperating = new Set<string>();
  for (const ref of operatingRefs) {
    const err = validateOrganRef(ref, snapshotObservedAt, "operating");
    if (err !== null) return { ok: false, reason: err };
    const id = (ref as Record<string, unknown>)["organ_id"] as string;
    if (seenOperating.has(id)) return { ok: false, reason: "DUPLICATE_OPERATING_ORGAN" };
    seenOperating.add(id);
  }
  const seenCognitive = new Set<string>();
  for (const ref of cognitiveRefs) {
    const err = validateOrganRef(ref, snapshotObservedAt, "cognitive");
    if (err !== null) return { ok: false, reason: err };
    const id = (ref as Record<string, unknown>)["organ_id"] as string;
    if (seenCognitive.has(id)) return { ok: false, reason: "DUPLICATE_COGNITIVE_ORGAN" };
    seenCognitive.add(id);
  }

  // knowledge_refs
  const knowledgeRefs = obj["knowledge_refs"];
  if (!Array.isArray(knowledgeRefs)) {
    return { ok: false, reason: "INVALID_KNOWLEDGE_REFS" };
  }
  for (const ref of knowledgeRefs) {
    const err = validateKnowledgeRef(ref);
    if (err !== null) return { ok: false, reason: err };
  }

  // work_objects
  const workObjects = obj["work_objects"];
  if (!Array.isArray(workObjects)) {
    return { ok: false, reason: "INVALID_WORK_OBJECTS" };
  }
  const seenWorkIds = new Set<string>();
  for (const wo of workObjects) {
    const err = validateWorkObject(wo);
    if (err !== null) return { ok: false, reason: err };
    const workId = (wo as WorkObjectRef).work_id;
    if (seenWorkIds.has(workId)) return { ok: false, reason: "DUPLICATE_WORK_ID" };
    seenWorkIds.add(workId);
  }

  // cell_effects
  const cellEffects = obj["cell_effects"];
  if (!Array.isArray(cellEffects)) {
    return { ok: false, reason: "INVALID_CELL_EFFECTS" };
  }
  for (const eff of cellEffects) {
    const err = validateCellEffect(eff);
    if (err !== null) return { ok: false, reason: err };
  }

  // will_role_desks — must be exactly 6, unique desk names, all valid
  const willDesks = obj["will_role_desks"];
  if (!Array.isArray(willDesks)) {
    return { ok: false, reason: "INVALID_WILL_DESKS" };
  }
  if (willDesks.length !== 6) {
    return { ok: false, reason: "WILL_DESKS_COUNT_INVALID" };
  }
  const seenDesks = new Set<string>();
  for (let i = 0; i < willDesks.length; i++) {
    const err = validateWillRoleDeskAssignment(willDesks[i], i);
    if (err !== null) return { ok: false, reason: err };
    const deskName = (willDesks[i] as Record<string, unknown>)["desk"] as string;
    if (seenDesks.has(deskName)) {
      return { ok: false, reason: "DUPLICATE_WILL_DESK" };
    }
    seenDesks.add(deskName);
  }

  // evidence — validated with closed allowlist and enum checks
  const evidenceErr = validateEvidenceDimensions(obj["evidence"]);
  if (evidenceErr !== null) return { ok: false, reason: evidenceErr };

  // toolchain_requirements — must be array
  const toolchainReqs = obj["toolchain_requirements"];
  if (!Array.isArray(toolchainReqs)) {
    return { ok: false, reason: "INVALID_TOOLCHAIN" };
  }
  for (const req of toolchainReqs) {
    const err = validateToolchainRequirement(req);
    if (err !== null) return { ok: false, reason: err };
  }

  // data_classifications — bounded portable classification labels, never bodies
  const dataClassifications = obj["data_classifications"];
  if (!Array.isArray(dataClassifications)) {
    return { ok: false, reason: "INVALID_DATA_CLASSIFICATIONS" };
  }
  if (dataClassifications.some((c) => !isPortableRef(c))) {
    return { ok: false, reason: "INVALID_DATA_CLASSIFICATIONS" };
  }

  // held_requirements — bounded readable metadata, never private payloads
  const heldReqs = obj["held_requirements"];
  if (!Array.isArray(heldReqs)) {
    return { ok: false, reason: "INVALID_HELD_REQUIREMENTS" };
  }
  if (heldReqs.some((r) => !isBoundedHumanMeta(r))) {
    return { ok: false, reason: "INVALID_HELD_REQUIREMENTS" };
  }

  // compatibility_observations — optional; when present must be closed and non-authoritative
  if (obj["compatibility_observations"] !== undefined && obj["compatibility_observations"] !== null) {
    const err = validateCompatibilityObservations(obj["compatibility_observations"]);
    if (err !== null) return { ok: false, reason: err };
  }

  // capability_hit_modes — optional; when present must list only known disabled modes
  if (obj["capability_hit_modes"] !== undefined && obj["capability_hit_modes"] !== null) {
    const err = validateCapabilityHitModesDeclaration(obj["capability_hit_modes"]);
    if (err !== null) return { ok: false, reason: err };
  }

  return { ok: true };
}

// ─── validateMigrationTarget ─────────────────────────────────────────────

const TARGET_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "schema", "version", "target_profile", "destination_id",
  "compatibility_check_only", "requested_modules", "held_requirements",
]);

export function validateMigrationTarget(value: unknown): value is MigrationTargetV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;

  // Forbidden keys
  if (checkForbiddenKeys(obj) !== null) return false;

  // Closed allowlist
  if (checkAllowedKeys(obj, TARGET_ALLOWED_KEYS, "target") !== null) return false;

  // Schema
  if (obj["schema"] !== MIGRATION_TARGET_SCHEMA) return false;

  // Version — closed object, supported major, nonnegative integer minor
  const version = obj["version"];
  if (!version || typeof version !== "object" || Array.isArray(version)) return false;
  const versionObj = version as Record<string, unknown>;
  if (checkAllowedKeys(versionObj, VERSION_ALLOWED_KEYS, "target_version") !== null) return false;
  if (typeof versionObj["major"] !== "number" || typeof versionObj["minor"] !== "number") return false;
  if (!Number.isInteger(versionObj["major"]) || !Number.isInteger(versionObj["minor"])) return false;
  if (versionObj["major"] !== SUPPORTED_TARGET_MAJOR) return false;
  if (versionObj["minor"] < 0) return false;

  // target_profile
  if (!VALID_PROFILES.has(obj["target_profile"] as string)) return false;

  // destination_id — a clean symbolic ref (no path/loopback/account leak).
  if (!isCleanSymbolicRef(obj["destination_id"])) return false;

  // compatibility_check_only
  if (typeof obj["compatibility_check_only"] !== "boolean") return false;

  // requested_modules — array of clean symbolic strings.
  if (!Array.isArray(obj["requested_modules"])) return false;
  for (const m of obj["requested_modules"] as unknown[]) {
    if (!isCleanSymbolicRef(m)) return false;
  }

  // held_requirements — same bounded readable metadata policy as snapshots.
  if (!Array.isArray(obj["held_requirements"])) return false;
  for (const h of obj["held_requirements"] as unknown[]) {
    if (!isBoundedHumanMeta(h)) return false;
  }

  return true;
}

// ─── Compatibility assessment (separate from structural validity) ──────────

/**
 * The outcome of a compatibility assessment.
 *
 *  - "compatible": structurally valid AND every independently-pinned expected
 *    anchor reconciled (owner work binding, verdict lineage, Adytum parity,
 *    capability-hit catalog). Only a "compatible" result may authorize
 *    downstream execution planning.
 *  - "held": structurally valid but one or more expected anchors are missing,
 *    null, unresolved, stale, or mismatched. This is explicit, non-authorizing.
 *  - "nonauthoritative": the snapshot is not structurally valid, or no expected
 *    context was supplied at all. Snapshot data alone is never approval.
 *
 * Snapshot self-data (including a self-computed binding_digest) proves
 * integrity only. It can never, by itself, yield "compatible".
 */
export type CompatibilityStatus = "compatible" | "held" | "nonauthoritative";

export interface CompatibilityAssessment {
  status: CompatibilityStatus;
  /** Structural validity is reported independently of the join outcome. */
  structurally_valid: boolean;
  /**
   * Required holds that block the selected flow. Empty only when status is
   * "compatible". Separated from purely observational relationship findings.
   */
  holds: string[];
  /**
   * Observational relationship findings that are reported but do NOT block an
   * unrelated selected flow (e.g. the unselected Adytum source-parity hold).
   */
  observations: string[];
  /**
   * ALWAYS false. Compatibility is never permission: actual device/effect
   * authority stays with a later exact review / fresh preflight. A "compatible"
   * status means the selected tuples reconciled, not that execution is allowed.
   */
  execution_authorized: false;
}

/** Age in days between two ISO timestamps (consumed/attested vs now). */
function ageDays(fromIso: string, nowIso: string): number {
  const from = new Date(fromIso).getTime();
  const now = new Date(nowIso).getTime();
  return (now - from) / 86_400_000;
}

/**
 * A closed, non-throwing validator for the independently-supplied expected
 * context envelope and every nested tuple. Invalid context must NEVER throw
 * and must NEVER be described as authenticating an owner — it only confirms
 * the caller supplied a well-formed, independently-authorized shape. Returns a
 * reason code when invalid, or null when the envelope is well-formed.
 */
const INPUT_DEPENDENCY_KEYS = new Set([
  "input_id", "producer_organ_id", "consumer_organ_id", "artifact_ref",
  "artifact_digest", "source_digest", "work_id", "task_id", "scope",
]);
const EXPECTED_WORK_KEYS = new Set(["work_id", "task_id", "owner", "contract", "version", "pack", "plant", "scope", "source_digest"]);
const EXPECTED_VERDICT_KEYS = new Set([
  "organ_id", "owner", "version", "plant", "trigger", "input_dependencies",
  "consumed_ref", "artifact_digest", "criteria_digest", "policy_digest", "verifier_ref",
  "max_age_days", "work_id", "artifact_ref", "consumer", "organ_contract", "source_digest",
  "scope", "stages", "require_fresh_pass",
]);
const EXPECTED_STAGE_KEYS = new Set([
  "stage_ref", "work_id", "task_id", "owner_contract", "version", "scope", "plant",
  "artifact_digest", "source_digest", "consumer_ack", "max_age_days",
]);
const STAGE_NAMES = ["source", "released", "installed", "consumed"] as const;
const MAX_EVIDENCE_AGE_DAYS = 3660;

function validMaxAge(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_EVIDENCE_AGE_DAYS;
}

function validateInputDependencies(value: unknown): string | null {
  if (!Array.isArray(value) || value.length > 64) return "INPUT_DEPENDENCIES_INVALID";
  const ids = new Set<string>();
  for (const edge of value) {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) return "INPUT_DEPENDENCY_INVALID";
    const e = edge as Record<string, unknown>;
    const keyErr = checkAllowedKeys(e, INPUT_DEPENDENCY_KEYS, "input_dependency");
    if (keyErr) return keyErr;
    for (const key of ["input_id", "artifact_ref", "work_id", "task_id", "scope"]) {
      if (!isPortableRef(e[key])) return `INPUT_DEPENDENCY_${key.toUpperCase()}_INVALID`;
    }
    for (const key of ["producer_organ_id", "consumer_organ_id"]) {
      if (typeof e[key] !== "string" || !(VALID_OPERATING_ORGAN_IDS.has(e[key]) || VALID_COGNITIVE_ORGAN_IDS.has(e[key]))) return "INPUT_DEPENDENCY_ORGAN_INVALID";
    }
    if (!isValidDigest(e["artifact_digest"]) || !isValidDigest(e["source_digest"])) return "INPUT_DEPENDENCY_DIGEST_INVALID";
    if (ids.has(e["input_id"] as string)) return "INPUT_DEPENDENCY_DUPLICATE";
    ids.add(e["input_id"] as string);
  }
  return null;
}

/** Expected context is plain bounded data, not executable object behavior.
 * Inspect descriptors before reading values so getters/toJSON cannot run.
 */
function boundedExpectedData(value: unknown): boolean {
  let nodes = 0, chars = 0;
  const path = new Set<object>();
  const visit = (v: unknown, depth: number): boolean => {
    if (++nodes > 30_000 || depth > MAX_OBJECT_DEPTH) return false;
    if (typeof v === "string") {
      chars += v.length;
      return chars <= MAX_MIGRATION_SNAPSHOT_BYTES;
    }
    if (v === null || v === undefined || typeof v === "boolean") return true;
    if (typeof v === "number") return true; // Field validators preserve precise numeric diagnostics.
    if (typeof v !== "object" || path.has(v)) return false;
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return false;
    path.add(v);
    for (const key of Reflect.ownKeys(v)) {
      if (typeof key !== "string" || PROTOTYPE_KEYS.has(key)) return false;
      if (array && key === "length") continue;
      if (array && !/^(0|[1-9][0-9]*)$/.test(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (!("value" in descriptor) || !descriptor.enumerable || !visit(descriptor.value, depth + 1)) return false;
    }
    path.delete(v);
    return true;
  };
  try { return visit(value, 0); } catch { return false; }
}

function validateExpectedContext(expected: unknown): string | null {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    return "EXPECTED_CONTEXT_INVALID";
  }
  if (!boundedExpectedData(expected)) return "EXPECTED_CONTEXT_NONPLAIN_OR_UNBOUNDED";
  if (sizeBytes(expected) > MAX_MIGRATION_SNAPSHOT_BYTES) return "EXPECTED_CONTEXT_EXCEEDS_SIZE_LIMIT";
  const e = expected as Record<string, unknown>;

  const EXPECTED_CONTEXT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
    "expected_work", "expected_verdicts", "expected_adytum",
    "expected_capability_hit_source_digest", "required_work_ids",
    "required_organ_ids", "require_capability_hit", "now",
  ]);
  const keyErr = checkAllowedKeys(e, EXPECTED_CONTEXT_ALLOWED_KEYS, "expected_context");
  if (keyErr !== null) return `EXPECTED_CONTEXT_${keyErr}`;
  const forbidErr = checkForbiddenKeys(e);
  if (forbidErr !== null) return `EXPECTED_CONTEXT_${forbidErr}`;

  if (!isValidCalendarTimestamp(e["now"])) return "EXPECTED_CONTEXT_INVALID_NOW";

  // expected_work — required array of closed bindings.
  if (!Array.isArray(e["expected_work"])) return "EXPECTED_CONTEXT_WORK_NOT_ARRAY";
  const seenWork = new Set<string>();
  for (const ew of e["expected_work"] as unknown[]) {
    if (!ew || typeof ew !== "object" || Array.isArray(ew)) return "EXPECTED_WORK_ENTRY_INVALID";
    const w = ew as Record<string, unknown>;
    const keyErr = checkAllowedKeys(w, EXPECTED_WORK_KEYS, "expected_work");
    if (keyErr) return keyErr;
    for (const field of ["work_id", "task_id", "owner", "contract", "version", "pack", "plant", "scope"] as const) {
      if (!isPortableRef(w[field])) return `EXPECTED_WORK_${field.toUpperCase()}_INVALID`;
    }
    if (!isValidDigest(w["source_digest"])) return "EXPECTED_WORK_SOURCE_DIGEST_INVALID";
    if (seenWork.has(w["work_id"] as string)) return "EXPECTED_WORK_DUPLICATE_ID";
    seenWork.add(w["work_id"] as string);
  }

  // expected_verdicts — optional array of closed anchors.
  if (e["expected_verdicts"] !== undefined) {
    if (!Array.isArray(e["expected_verdicts"])) return "EXPECTED_CONTEXT_VERDICTS_NOT_ARRAY";
    const seenAnchor = new Set<string>();
    for (const ev of e["expected_verdicts"] as unknown[]) {
      const anchorErr = validateExpectedVerdictAnchor(ev);
      if (anchorErr !== null) return anchorErr;
      const organId = (ev as Record<string, unknown>)["organ_id"] as string;
      if (seenAnchor.has(organId)) return "EXPECTED_VERDICT_DUPLICATE_ANCHOR";
      seenAnchor.add(organId);
    }
  }

  // expected_adytum — optional closed context.
  if (e["expected_adytum"] !== undefined) {
    const adytumErr = validateExpectedAdytumContext(e["expected_adytum"]);
    if (adytumErr !== null) return adytumErr;
  }

  if (e["expected_capability_hit_source_digest"] !== undefined &&
      !isValidDigest(e["expected_capability_hit_source_digest"])) {
    return "EXPECTED_CONTEXT_INVALID_CAPABILITY_DIGEST";
  }
  if (e["require_capability_hit"] !== undefined && typeof e["require_capability_hit"] !== "boolean") {
    return "EXPECTED_CONTEXT_INVALID_REQUIRE_CAPABILITY";
  }

  if (e["required_work_ids"] !== undefined) {
    if (!Array.isArray(e["required_work_ids"])) return "EXPECTED_CONTEXT_REQUIRED_WORK_NOT_ARRAY";
    const seen = new Set<string>();
    for (const id of e["required_work_ids"] as unknown[]) {
      if (!isPortableRef(id)) return "EXPECTED_CONTEXT_REQUIRED_WORK_ID_INVALID";
      if (seen.has(id as string)) return "EXPECTED_CONTEXT_REQUIRED_WORK_DUPLICATE";
      seen.add(id as string);
    }
  }
  if (e["required_organ_ids"] !== undefined) {
    if (!Array.isArray(e["required_organ_ids"])) return "EXPECTED_CONTEXT_REQUIRED_ORGAN_NOT_ARRAY";
    const seen = new Set<string>();
    for (const id of e["required_organ_ids"] as unknown[]) {
      if (typeof id !== "string" ||
          !(VALID_OPERATING_ORGAN_IDS.has(id) || VALID_COGNITIVE_ORGAN_IDS.has(id))) {
        return "EXPECTED_CONTEXT_REQUIRED_ORGAN_ID_INVALID";
      }
      if (seen.has(id)) return "EXPECTED_CONTEXT_REQUIRED_ORGAN_DUPLICATE";
      seen.add(id);
    }
  }
  return null;
}

function validateExpectedStageAnchor(stage: unknown, requireAck: boolean): string | null {
  if (!stage || typeof stage !== "object" || Array.isArray(stage)) return "EXPECTED_STAGE_INVALID";
  const st = stage as Record<string, unknown>;
  const keyErr = checkAllowedKeys(st, EXPECTED_STAGE_KEYS, "expected_stage");
  if (keyErr) return keyErr;
  if (!validMaxAge(st["max_age_days"])) return "EXPECTED_STAGE_MAX_AGE_INVALID";
  if (st["consumer_ack"] !== undefined && !isPortableRef(st["consumer_ack"])) return "EXPECTED_STAGE_CONSUMER_ACK_INVALID";
  for (const field of ["stage_ref", "work_id", "task_id", "owner_contract", "version", "scope", "plant"] as const) {
    if (!isPortableRef(st[field])) return `EXPECTED_STAGE_${field.toUpperCase()}_INVALID`;
  }
  if (!isValidDigest(st["artifact_digest"])) return "EXPECTED_STAGE_ARTIFACT_DIGEST_INVALID";
  if (!isValidDigest(st["source_digest"])) return "EXPECTED_STAGE_SOURCE_DIGEST_INVALID";
  if (requireAck && !isPortableRef(st["consumer_ack"])) return "EXPECTED_STAGE_CONSUMER_ACK_INVALID";
  return null;
}

function validateExpectedVerdictAnchor(ev: unknown): string | null {
  if (!ev || typeof ev !== "object" || Array.isArray(ev)) return "EXPECTED_VERDICT_ANCHOR_INVALID";
  const a = ev as Record<string, unknown>;
  const keyErr = checkAllowedKeys(a, EXPECTED_VERDICT_KEYS, "expected_verdict");
  if (keyErr) return keyErr;
  const inputErr = validateInputDependencies(a["input_dependencies"]);
  if (inputErr) return inputErr;
  if (!VALID_TRIGGERS.has(a["trigger"] as string)) return "EXPECTED_VERDICT_TRIGGER_INVALID";
  if (typeof a["organ_id"] !== "string" ||
      !(VALID_OPERATING_ORGAN_IDS.has(a["organ_id"]) || VALID_COGNITIVE_ORGAN_IDS.has(a["organ_id"]))) {
    return "EXPECTED_VERDICT_ANCHOR_ORGAN_INVALID";
  }
  for (const field of ["consumed_ref", "verifier_ref", "work_id", "artifact_ref", "consumer", "organ_contract", "scope", "owner", "version", "plant"] as const) {
    if (!isPortableRef(a[field])) return `EXPECTED_VERDICT_${field.toUpperCase()}_INVALID`;
  }
  for (const field of ["artifact_digest", "criteria_digest", "policy_digest", "source_digest"] as const) {
    if (!isValidDigest(a[field])) return `EXPECTED_VERDICT_${field.toUpperCase()}_INVALID`;
  }
  // Finite, nonnegative, bounded max-age; NaN/Infinity/undefined are refused.
  const maxAge = a["max_age_days"];
  if (!validMaxAge(maxAge)) {
    return "EXPECTED_VERDICT_MAX_AGE_INVALID";
  }
  if (a["require_fresh_pass"] !== undefined && typeof a["require_fresh_pass"] !== "boolean") {
    return "EXPECTED_VERDICT_REQUIRE_FRESH_INVALID";
  }
  if (a["stages"] !== undefined) {
    if (!a["stages"] || typeof a["stages"] !== "object" || Array.isArray(a["stages"])) {
      return "EXPECTED_VERDICT_STAGES_INVALID";
    }
    const stages = a["stages"] as Record<string, unknown>;
    const stagesErr = checkAllowedKeys(stages, new Set(STAGE_NAMES), "expected_stages");
    if (stagesErr) return stagesErr;
    for (const name of ["source", "released", "installed", "consumed"] as const) {
      const stageErr = validateExpectedStageAnchor(stages[name], name === "consumed");
      if (stageErr !== null) return `${stageErr}:${name}`;
    }
  }
  return null;
}

function validateExpectedAdytumContext(exp: unknown): string | null {
  if (!exp || typeof exp !== "object" || Array.isArray(exp)) return "EXPECTED_ADYTUM_INVALID";
  const a = exp as Record<string, unknown>;
  const keyErr = checkAllowedKeys(a, ADYTUM_PARITY_ALLOWED_KEYS, "expected_adytum");
  if (keyErr) return keyErr;
  if (!isPortableRef(a["owner_contract_ref"])) return "EXPECTED_ADYTUM_OWNER_REF_INVALID";
  if (!isPortableRef(a["owner_contract_version"])) return "EXPECTED_ADYTUM_OWNER_VERSION_INVALID";
  if (!isValidDigest(a["owner_contract_digest"])) return "EXPECTED_ADYTUM_OWNER_DIGEST_INVALID";
  if (!isPortableRef(a["consumer_support_ref"])) return "EXPECTED_ADYTUM_CONSUMER_REF_INVALID";
  if (!isPortableRef(a["consumer_support_version"])) return "EXPECTED_ADYTUM_CONSUMER_VERSION_INVALID";
  if (!isValidDigest(a["consumer_support_digest"])) return "EXPECTED_ADYTUM_CONSUMER_DIGEST_INVALID";
  for (const key of ["owner_topics", "consumer_topics"] as const) {
    if (!Array.isArray(a[key])) return `EXPECTED_ADYTUM_${key.toUpperCase()}_NOT_ARRAY`;
    const seen = new Set<string>();
    for (const t of a[key] as unknown[]) {
      if (!t || typeof t !== "object" || Array.isArray(t)) return `EXPECTED_ADYTUM_${key.toUpperCase()}_ENTRY_INVALID`;
      const tt = t as Record<string, unknown>;
      const topicErr = checkAllowedKeys(tt, ADYTUM_TOPIC_ALLOWED_KEYS, "expected_topic");
      if (topicErr) return topicErr;
      if (!isPortableRef(tt["topic_ref"])) return `EXPECTED_ADYTUM_${key.toUpperCase()}_TOPIC_REF_INVALID`;
      if (!isPortableRef(tt["version"])) return `EXPECTED_ADYTUM_${key.toUpperCase()}_TOPIC_VERSION_INVALID`;
      if (!isValidDigest(tt["digest"])) return `EXPECTED_ADYTUM_${key.toUpperCase()}_TOPIC_DIGEST_INVALID`;
      if (seen.has(tt["topic_ref"] as string)) return `EXPECTED_ADYTUM_${key.toUpperCase()}_DUPLICATE_TOPIC`;
      seen.add(tt["topic_ref"] as string);
    }
  }
  return null;
}

/** Build the always-false, non-authorizing closed result. */
function finalizeAssessment(
  holds: string[],
  observations: string[],
): CompatibilityAssessment {
  if (holds.length > 0) {
    return {
      status: "held",
      structurally_valid: true,
      holds,
      observations,
      execution_authorized: false,
    };
  }
  return {
    status: "compatible",
    structurally_valid: true,
    holds: [],
    observations,
    execution_authorized: false,
  };
}

/**
 * Assess compatibility of a structurally-valid snapshot against an
 * independently-supplied expected context.
 *
 * This is deliberately separate from validateMigrationSnapshot: structural
 * validity never implies compatibility, and compatibility never implies
 * permission. Every assessment returns execution_authorized:false. A coherently
 * forged whole projection (owner/scope changed and re-hashed) remains
 * non-authoritative unless it also matches the independently pinned expected
 * tuples — which, by construction, it cannot without out-of-band collusion.
 * Structural validity of the expected context is NOT authentication of the
 * caller: the caller must supply that context from an independently authorized
 * source.
 */
export function assessMigrationCompatibility(
  snapshotValue: unknown,
  expected: MigrationExpectedContext | null | undefined,
): CompatibilityAssessment {
  const structural = validateMigrationSnapshot(snapshotValue);
  if (!structural.ok) {
    return {
      status: "nonauthoritative",
      structurally_valid: false,
      holds: [`STRUCTURAL_INVALID:${structural.reason}`],
      observations: [],
      execution_authorized: false,
    };
  }

  const snapshot = snapshotValue as MigrationSnapshotV1;
  const holds: string[] = [];
  const observations: string[] = [];

  // No independently-pinned context at all → nonauthoritative by default.
  if (!expected || typeof expected !== "object") {
    return {
      status: "nonauthoritative",
      structurally_valid: true,
      holds: ["NO_EXPECTED_CONTEXT"],
      observations: [],
      execution_authorized: false,
    };
  }

  // Closed, non-throwing validation of the expected envelope. Invalid context
  // is nonauthoritative; structural validity of this input is NOT trust.
  const ctxErr = validateExpectedContext(expected);
  if (ctxErr !== null) {
    return {
      status: "nonauthoritative",
      structurally_valid: true,
      holds: [`INVALID_EXPECTED_CONTEXT:${ctxErr}`],
      observations: [],
      execution_authorized: false,
    };
  }

  const now = expected.now;

  // ── Index observations ─────────────────────────────────────────────────
  const workById = new Map<string, WorkObjectRef>();
  for (const wo of snapshot.work_objects) workById.set(wo.work_id, wo);
  const expectedByWorkId = new Map<string, ExpectedWorkBinding>();
  for (const ew of expected.expected_work) expectedByWorkId.set(ew.work_id, ew);

  const allOrgans = [...snapshot.organs.operating, ...snapshot.organs.cognitive];
  const organById = new Map<string, OrganEvidenceRef>();
  for (const organ of allOrgans) organById.set(organ.organ_id, organ);
  const expectedVerdicts = new Map<string, ExpectedVerdictAnchor>();
  if (Array.isArray(expected.expected_verdicts)) {
    for (const ev of expected.expected_verdicts) expectedVerdicts.set(ev.organ_id, ev);
  }

  // ── Selected requirement set (bidirectional completeness) ──────────────
  // A selected requirement set scopes the base owned flow. When the caller
  // omits requirement lists, assess every supplied/expected WorkObject and
  // every passed/failed organ. Explicit empty selections are held.
  const selectedWorkIds = expected.required_work_ids;
  const selectedOrganIds = expected.required_organ_ids;
  const hasSelection =
    (Array.isArray(selectedWorkIds) && selectedWorkIds.length > 0) ||
    (Array.isArray(selectedOrganIds) && selectedOrganIds.length > 0);

  if (!hasSelection && expectedByWorkId.size === 0) {
    holds.push("WORK_NO_EXPECTED_BINDINGS");
  }

  if ((selectedWorkIds !== undefined || selectedOrganIds !== undefined) && !hasSelection) {
    holds.push("EMPTY_REQUIREMENT_SELECTION");
  }
  const organIdsToAssess = new Set<string>(selectedOrganIds ?? allOrgans
    .filter(o => o.independent_verdict !== "unknown").map(o => o.organ_id));
  const workIdsToAssess = new Set<string>(selectedWorkIds ?? [
    ...snapshot.work_objects.map(wo => wo.work_id), ...expectedByWorkId.keys(),
  ]);
  // Dependency closure includes the actually used edge as well as the pinned
  // edge: changing a ref cannot remove its original requirement from review.
  for (const id of organIdsToAssess) {
    const anchor = expectedVerdicts.get(id);
    if (anchor) workIdsToAssess.add(anchor.work_id);
    const organ = organById.get(id);
    for (const stage of Object.values(organ?.artifact_lineage ?? {})) {
      if (typeof stage === "object") workIdsToAssess.add(stage.work_id);
    }
    for (const edge of [...(anchor?.input_dependencies ?? []), ...(organ?.input_dependencies ?? [])]) {
      organIdsToAssess.add(edge.producer_organ_id);
      workIdsToAssess.add(edge.work_id);
    }
  }
  if (workIdsToAssess.size === 0 && organIdsToAssess.size === 0) holds.push("EMPTY_REQUIREMENT_SELECTION");

  // ── WorkObject owner join ──────────────────────────────────────────────
  for (const workId of workIdsToAssess) {
    const wo = workById.get(workId);
    if (!wo) {
      // A claimed/selected required observation that is missing must hold.
      holds.push(`WORK_MISSING_OBSERVATION:${workId}`);
      continue;
    }
    const exp = expectedByWorkId.get(workId);
    if (!exp) {
      // Every claimed required observation needs an independent anchor.
      holds.push(`WORK_UNANCHORED:${workId}`);
      continue;
    }
    if (wo.binding_digest === undefined || wo.binding_digest === null) {
      holds.push(`WORK_NO_BINDING_DIGEST:${workId}`);
    }
    const tupleMismatch =
      wo.task_id !== exp.task_id ||
      wo.owner !== exp.owner ||
      wo.contract !== exp.contract ||
      wo.version !== exp.version ||
      wo.source_digest !== exp.source_digest ||
      wo.pack !== exp.pack ||
      wo.plant !== exp.plant ||
      wo.scope !== exp.scope;
    if (tupleMismatch) {
      holds.push(`WORK_ANCHOR_MISMATCH:${workId}`);
    }
  }
  // Bidirectional: every explicitly required work id must have an observation.
  if (Array.isArray(selectedWorkIds)) {
    for (const reqId of selectedWorkIds) {
      if (!workById.has(reqId)) {
        holds.push(`REQUIRED_WORK_MISSING:${reqId}`);
      }
    }
  }

  // ── Verdict / lineage / edge join ──────────────────────────────────────
  // Determine which organs to assess for verdicts. A selected organ set scopes
  // the base flow; otherwise every passed/failed organ is assessed.
  for (const organId of organIdsToAssess) {
    const organ = organById.get(organId);
    if (!organ) {
      holds.push(`REQUIRED_ORGAN_MISSING:${organId}`);
      continue;
    }
    const anchor = expectedVerdicts.get(organId);
    if (organ.verification !== "verified") holds.push(`ORGAN_VERIFICATION_${organ.verification.toUpperCase()}:${organId}`);
    if (organ.freshness !== "fresh") holds.push(`ORGAN_FRESHNESS_${organ.freshness.toUpperCase()}:${organId}`);

    // A required/selected organ must carry a successful determinate verdict.
    if (organ.independent_verdict === "unknown") {
      if (organIdsToAssess.has(organId)) {
        holds.push(`VERDICT_UNKNOWN_REQUIRED:${organId}`);
      }
      continue;
    }
    if (organ.independent_verdict !== "passed" && organ.independent_verdict !== "failed") {
      continue;
    }

    const att = organ.verdict_attestation;
    if (!att) {
      holds.push(`VERDICT_NO_ATTESTATION:${organId}`);
      continue;
    }
    if (!anchor) {
      holds.push(`VERDICT_UNANCHORED:${organId}`);
      continue;
    }

    // Required successful fresh evidence: a failed verdict or a non-fresh
    // attestation freshness holds distinctly, even when identity is coherent.
    if (organ.independent_verdict === "failed") {
      holds.push(`VERDICT_FAILED_HELD:${organId}`);
    }
    if (att.freshness === "expired") {
      holds.push(`VERDICT_FRESHNESS_EXPIRED:${organId}`);
    } else if (att.freshness === "stale") {
      holds.push(`VERDICT_FRESHNESS_STALE:${organId}`);
    } else if (att.freshness === "unknown") {
      holds.push(`VERDICT_FRESHNESS_UNKNOWN:${organId}`);
    }

    // Producer cannot be its own verifier.
    if (att.verifier_ref === organ.owner || anchor.verifier_ref === organ.owner) {
      holds.push(`VERDICT_PRODUCER_IS_VERIFIER:${organId}`);
    }
    if (att.verifier_ref !== anchor.verifier_ref) {
      holds.push(`VERDICT_VERIFIER_MISMATCH:${organId}`);
    }
    if (
      att.artifact_digest !== anchor.artifact_digest ||
      att.criteria_digest !== anchor.criteria_digest ||
      att.policy_digest !== anchor.policy_digest
    ) {
      holds.push(`VERDICT_DIGEST_MISMATCH:${organId}`);
    }

    // ── Independently pinned organ/work/producer/consumer edge ───────────
    // Each of these is independently compared: a changed artifact_ref,
    // consumer, contract, source_digest or scope holds on its own even when
    // the digest triplet still matches. No digest identity is inferred from a
    // string ref.
    for (const field of ["owner", "version", "plant", "trigger"] as const) {
      if (organ[field] !== anchor[field]) holds.push(`EDGE_${field.toUpperCase()}_MISMATCH:${organId}`);
    }
    compareInputs(organ, anchor, organById, expectedVerdicts, expectedByWorkId, holds);
    if (organ.artifact_ref !== anchor.artifact_ref) {
      holds.push(`EDGE_ARTIFACT_REF_MISMATCH:${organId}`);
    }
    if (organ.consumer !== anchor.consumer) {
      holds.push(`EDGE_CONSUMER_MISMATCH:${organId}`);
    }
    if (organ.contract !== anchor.organ_contract) {
      holds.push(`EDGE_CONTRACT_MISMATCH:${organId}`);
    }
    if (organ.source_digest !== anchor.source_digest) {
      holds.push(`EDGE_SOURCE_DIGEST_MISMATCH:${organId}`);
    }
    if (organ.scope !== anchor.scope) {
      holds.push(`EDGE_SCOPE_MISMATCH:${organId}`);
    }

    // The organ's verdict edge must join the exact required WorkObject.
    const joinedWork = workById.get(anchor.work_id);
    if (!joinedWork) {
      holds.push(`EDGE_WORK_MISSING:${organId}`);
    }

    // ── consumed artifact + typed provenance stage tuples ────────────────
    const lineage = organ.artifact_lineage;
    const consumed = lineage?.consumed_ref;
    // A matched stage tuple alone cannot establish the consumed/verdict join.
    // Source, release and installed artifacts may legitimately have other digests.
    if (lineage && (lineage.consumed.artifact_digest !== att.artifact_digest ||
        lineage.consumed.artifact_digest !== anchor.artifact_digest)) {
      holds.push(`CONSUMED_ARTIFACT_VERDICT_MISMATCH:${organId}`);
    }
    if (lineage && lineage.consumed.work_id !== anchor.work_id) {
      holds.push(`CONSUMED_WORK_MISMATCH:${organId}`);
    }
    if (consumed !== anchor.consumed_ref) {
      holds.push(`VERDICT_CONSUMED_MISMATCH:${organId}`);
    }
    if (!anchor.stages) holds.push(`STAGE_ANCHORS_MISSING:${organId}`);
    if (anchor.stages) {
      if (!lineage) {
        holds.push(`LINEAGE_MISSING:${organId}`);
      } else {
        const stageHold = compareStages(lineage, anchor.stages, organId, snapshot.observed_at, now, expectedByWorkId);
        for (const h of stageHold) holds.push(h);
      }
    }

    // Age/freshness policy against the injected now.
    const age = ageDays(att.attested_at, now);
    if (age < 0) {
      holds.push(`VERDICT_FUTURE_ATTESTATION:${organId}`);
    } else if (age > anchor.max_age_days || ageDays(att.attested_at, snapshot.observed_at) > anchor.max_age_days) {
      holds.push(`VERDICT_STALE_HELD:${organId}`);
    }
  }

  // Bidirectional: every expected verdict anchor must have a matching organ
  // observation with a determinate verdict.
  for (const [organId] of expectedVerdicts) {
    if (selectedOrganIds !== undefined && !organIdsToAssess.has(organId)) continue;
    const organ = organById.get(organId);
    if (!organ) {
      holds.push(`VERDICT_ANCHOR_NO_OBSERVATION:${organId}`);
    } else if (organ.independent_verdict === "unknown") {
      holds.push(`VERDICT_ANCHOR_DOWNGRADED:${organId}`);
    }
  }

  // ── Adytum parity relationship (observational unless selected) ─────────
  // Adytum's source-parity hold is always reported, but it only BLOCKS the
  // flow when Adytum is explicitly selected. This keeps all five operating
  // and six cognitive organs in the snapshot without making compatible
  // mathematically unreachable for an unrelated base flow.
  const adytumSelected = organIdsToAssess.has("adytum");
  const adytumSink = adytumSelected ? holds : observations;

  const adytum = snapshot.organs.cognitive.find((o) => o.organ_id === "adytum");
  if (adytum && adytum.adytum_parity) {
    const exp = expected.expected_adytum;
    const parity = adytum.adytum_parity;
    if (!exp) {
      adytumSink.push("ADYTUM_UNANCHORED");
    } else {
      if (
        parity.owner_contract_ref !== exp.owner_contract_ref ||
        parity.owner_contract_version !== exp.owner_contract_version ||
        parity.owner_contract_digest !== exp.owner_contract_digest ||
        parity.consumer_support_ref !== exp.consumer_support_ref ||
        parity.consumer_support_version !== exp.consumer_support_version ||
        parity.consumer_support_digest !== exp.consumer_support_digest
      ) {
        adytumSink.push("ADYTUM_CONTEXT_MISMATCH");
      }
      // Complete per-topic tuple comparison: ref + version + digest. A
      // supported topic name from a different version/artifact cannot
      // substitute for the expected one.
      const ownerTupleMismatch = !topicTuplesMatch(parity.owner_topics, exp.owner_topics);
      const consumerTupleMismatch = !topicTuplesMatch(parity.consumer_topics, exp.consumer_topics);
      if (ownerTupleMismatch) adytumSink.push("ADYTUM_OWNER_TOPIC_MISMATCH");
      if (consumerTupleMismatch) adytumSink.push("ADYTUM_CONSUMER_TOPIC_MISMATCH");

      // The owner publishes 9; the consumer supports 8. Full reconciliation
      // requires the consumer to support every owner topic tuple. This is the
      // actual Hermes-owner-9 / Cambium-consumer-8 source-parity hold; the
      // synthetic 9/8 fixture is explicitly synthetic, not a live owner
      // reconciliation.
      const consumerKeys = new Set(parity.consumer_topics.map(topicKey));
      const everyOwnerSupported = parity.owner_topics.every((t) => consumerKeys.has(topicKey(t)));
      if (!everyOwnerSupported) {
        adytumSink.push("ADYTUM_SOURCE_PARITY_HELD");
      }
    }
  } else if (adytum) {
    adytumSink.push("ADYTUM_NO_PARITY_EVIDENCE");
  }

  // ── Capability-hit catalog join ────────────────────────────────────────
  if (snapshot.capability_hit_modes) {
    const expDigest = expected.expected_capability_hit_source_digest;
    const required = expected.require_capability_hit === true;
    const sink = required ? holds : observations;
    if (!expDigest) {
      sink.push("CAPABILITY_HIT_UNANCHORED");
    } else if (snapshot.capability_hit_modes.catalog_source_digest !== expDigest) {
      sink.push("CAPABILITY_HIT_DIGEST_MISMATCH");
    }
  } else if (expected.require_capability_hit === true) {
    holds.push("CAPABILITY_HIT_REQUIRED_MISSING");
  }

  return finalizeAssessment(holds, observations);
}

// ─── Assessor helpers ──────────────────────────────────────────────────────

function topicKey(t: { topic_ref: string; version: string; digest: string }): string {
  return `${t.topic_ref}\u0000${t.version}\u0000${t.digest}`;
}

function topicTuplesMatch(
  observed: ReadonlyArray<{ topic_ref: string; version: string; digest: string }>,
  expected: ReadonlyArray<{ topic_ref: string; version: string; digest: string }>,
): boolean {
  if (observed.length !== expected.length) return false;
  const obs = new Set(observed.map(topicKey));
  if (obs.size !== observed.length) return false;
  return expected.every((t) => obs.has(topicKey(t)));
}

function compareStages(
  lineage: ArtifactLineage,
  anchors: NonNullable<ExpectedVerdictAnchor["stages"]>,
  organId: string,
  observedAt: string,
  now: string,
  expectedWork: ReadonlyMap<string, ExpectedWorkBinding>,
): string[] {
  const out: string[] = [];
  const pairs: Array<[keyof typeof anchors, ArtifactStage, ExpectedStageAnchor]> = [
    ["source", lineage.source, anchors.source],
    ["released", lineage.released, anchors.released],
    ["installed", lineage.installed, anchors.installed],
    ["consumed", lineage.consumed, anchors.consumed],
  ];
  for (const [name, stage, anchor] of pairs) {
    const label = `${name.toUpperCase()}`;
    // Stage scope is the work scope, separate from the organ's selection scope.
    // Different lifecycle artifact digests and owner contracts remain legitimate.
    const work = expectedWork.get(stage.work_id);
    if (!work) out.push(`STAGE_${label}_WORK_UNANCHORED:${organId}`);
    else if (stage.task_id !== work.task_id || stage.scope !== work.scope || stage.plant !== work.plant) {
      out.push(`STAGE_${label}_WORK_MISMATCH:${organId}`);
    }
    if (stage.freshness !== "fresh") out.push(`STAGE_${label}_FRESHNESS_${stage.freshness.toUpperCase()}:${organId}`);
    const age = ageDays(stage.observed_at, now);
    if (age < 0 || ageDays(stage.observed_at, observedAt) < 0) out.push(`STAGE_${label}_FUTURE:${organId}`);
    else if (age > anchor.max_age_days || ageDays(stage.observed_at, observedAt) > anchor.max_age_days) out.push(`STAGE_${label}_STALE:${organId}`);
    if (
      stage.stage_ref !== anchor.stage_ref ||
      stage.work_id !== anchor.work_id ||
      stage.task_id !== anchor.task_id ||
      stage.owner_contract !== anchor.owner_contract ||
      stage.version !== anchor.version ||
      stage.scope !== anchor.scope ||
      stage.plant !== anchor.plant ||
      stage.artifact_digest !== anchor.artifact_digest ||
      stage.source_digest !== anchor.source_digest
    ) {
      out.push(`STAGE_${label}_MISMATCH:${organId}`);
    }
    if (name === "consumed" && stage.consumer_ack !== anchor.consumer_ack) {
      out.push(`STAGE_CONSUMED_ACK_MISMATCH:${organId}`);
    }
  }
  return out;
}

/** Independently compare the input set, then resolve each producer and work. */
function compareInputs(
  organ: OrganEvidenceRef, anchor: ExpectedVerdictAnchor,
  organs: Map<string, OrganEvidenceRef>, anchors: Map<string, ExpectedVerdictAnchor>,
  work: Map<string, ExpectedWorkBinding>, holds: string[],
): void {
  const expectedInputs = new Map(anchor.input_dependencies.map(e => [e.input_id, e]));
  const observedInputs = new Map(organ.input_dependencies.map(e => [e.input_id, e]));
  for (const id of new Set([...expectedInputs.keys(), ...observedInputs.keys()])) {
    const observed = observedInputs.get(id), expected = expectedInputs.get(id);
    const suffix = `${organ.organ_id}:${id}`;
    if (!observed) { holds.push(`INPUT_MISSING:${suffix}`); continue; }
    if (!expected) { holds.push(`INPUT_UNANCHORED:${suffix}`); continue; }
    if ([...INPUT_DEPENDENCY_KEYS].some(k => observed[k as keyof InputDependencyRef] !== expected[k as keyof InputDependencyRef])) {
      holds.push(`INPUT_ANCHOR_MISMATCH:${suffix}`);
    }
    if (observed.consumer_organ_id !== organ.organ_id || expected.consumer_organ_id !== anchor.organ_id) holds.push(`INPUT_CONSUMER_MISMATCH:${suffix}`);
    const producer = organs.get(observed.producer_organ_id);
    const producerAnchor = anchors.get(expected.producer_organ_id);
    if (!producer || !producerAnchor) { holds.push(`INPUT_PRODUCER_UNANCHORED:${suffix}`); continue; }
    if (producer.artifact_ref !== expected.artifact_ref || producer.source_digest !== expected.source_digest ||
        producerAnchor.artifact_ref !== expected.artifact_ref || producerAnchor.source_digest !== expected.source_digest ||
        producerAnchor.artifact_digest !== expected.artifact_digest || producerAnchor.work_id !== expected.work_id ||
        producer.verdict_attestation?.artifact_digest !== expected.artifact_digest) {
      holds.push(`INPUT_PRODUCER_MISMATCH:${suffix}`);
    }
    if (producer.consumer !== organ.organ_id || producerAnchor.consumer !== anchor.organ_id) holds.push(`INPUT_CONSUMER_MISMATCH:${suffix}`);
    const workAnchor = work.get(expected.work_id);
    if (!workAnchor || workAnchor.task_id !== expected.task_id || workAnchor.scope !== expected.scope) holds.push(`INPUT_WORK_MISMATCH:${suffix}`);
  }
}
