/**
 * Shared synthetic fixtures for migration contract tests (Task 1).
 * No real host data, credentials, paths, session IDs, or native stores.
 * Exportable helpers for Task 2 and Task 3 imports without modification.
 *
 * Canonical identities follow the admitted Cambium growth-ecosystem review:
 *  - Operating organs: genesis, taste, hands, will, cortex.
 *  - Cognitive organs: vestibule, adytum, nutrix, auspex, circulator, praeceptor.
 *  - Will role desks: head-of-marketing, copywriter, creative-strategist,
 *    launch-lead, seo-lead, analyst — role filters inside the Will organ.
 */
import type {
  MigrationSnapshotV1,
  MigrationTargetV1,
  OrganEvidenceRef,
  KnowledgeRef,
  WorkObjectRef,
  EvidenceDimensions,
  ToolchainRequirement,
  CellEffectClass,
  VerdictAttestation,
  ArtifactLineage,
  AdytumParityEvidence,
  AdytumTopicRef,
  CapabilityHitModesDeclaration,
  MigrationExpectedContext,
  ExpectedWorkBinding,
  ExpectedVerdictAnchor,
  ExpectedStageAnchor,
  ExpectedAdytumContext,
  ArtifactStage,
} from "../src/migration/contracts.ts";
import {
  computeWorkBindingDigest,
  CAPABILITY_HIT_SOURCE_REF,
  CAPABILITY_HIT_MODE_IDS,
  ADYTUM_OWNER_TOPIC_COUNT,
  ADYTUM_CONSUMER_TOPIC_COUNT,
} from "../src/migration/contracts.ts";

// ─── Canonical digest helpers ──────────────────────────────────────────────

export function fakeDigest(label: string): `sha256:${string}` {
  const hexOnly = label
    .replace(/[^0-9a-f]/gi, (c) => {
      const code = c.toLowerCase().charCodeAt(0);
      return (code % 16).toString(16);
    })
    .toLowerCase()
    .padEnd(64, "0")
    .slice(0, 64);
  return `sha256:${hexOnly}`;
}

// ─── Verdict attestation helpers ───────────────────────────────────────────

/**
 * Build a valid VerdictAttestation. The verifier_ref is an independent
 * verifier (never the organ owner). attested_at defaults to the snapshot
 * observation time to avoid future-fresh rejection.
 */
export function makeAttestation(label: string): VerdictAttestation {
  return {
    artifact_digest: fakeDigest(`${label}-artifact`),
    criteria_digest: fakeDigest(`${label}-criteria`),
    policy_digest: fakeDigest(`${label}-policy`),
    verifier_ref: `auspex:verifier:${label}`,
    attested_at: "2026-10-01T00:00:01Z",
    freshness: "fresh",
  };
}

// ─── Adytum parity evidence helper ────────────────────────────────────────

export function makeAdytumTopics(label: string, count: number): AdytumTopicRef[] {
  const topics: AdytumTopicRef[] = [];
  for (let i = 0; i < count; i++) {
    topics.push({
      topic_ref: `${label}:topic-${i}`,
      version: "1.0.0",
      digest: fakeDigest(`${label}-topic-${i}`),
    });
  }
  return topics;
}

/**
 * Build real 9-vs-8 Adytum parity evidence. The owner (Hermes) publishes 9
 * topics; the consumer (Cambium) supports 8 — the ninth is the Adytum hold.
 * By default the consumer supports owner topics 0..7, so owner topic 8 is
 * unreconciled (source-parity-held).
 */
export function makeAdytumParity(): AdytumParityEvidence {
  const ownerTopics = makeAdytumTopics("hermes-owner", ADYTUM_OWNER_TOPIC_COUNT);
  // Consumer supports the first 8 owner topics (missing owner topic 8).
  const consumerTopics: AdytumTopicRef[] = ownerTopics
    .slice(0, ADYTUM_CONSUMER_TOPIC_COUNT)
    .map((t) => ({ ...t }));
  return {
    owner_contract_ref: "hermes:adytum-topics",
    owner_contract_version: "9.0.0",
    owner_contract_digest: fakeDigest("hermes-adytum-owner-contract"),
    owner_topics: ownerTopics,
    consumer_support_ref: "cambium:adytum-supported",
    consumer_support_version: "8.0.0",
    consumer_support_digest: fakeDigest("cambium-adytum-consumer-support"),
    consumer_topics: consumerTopics,
  };
}

// ─── Artifact lineage helper ───────────────────────────────────────────────

function makeArtifactStage(
  label: string,
  stageRef: string,
  withAck: boolean,
): ArtifactStage {
  const stage: ArtifactStage = {
    stage_ref: stageRef,
    work_id: "work:modular-mac-phase-a",
    task_id: "task:install-surface-task1",
    owner_contract: `cambium:organ-contract:${label}`,
    version: "1.0.0",
    scope: "install-surface",
    plant: "mac",
    artifact_digest: fakeDigest(`${label}-artifact`),
    source_digest: fakeDigest(`${label}-src`),
    observed_at: "2026-10-01T00:00:01Z",
    freshness: "fresh",
  };
  if (withAck) stage.consumer_ack = `temperance:ack:${label}`;
  return stage;
}

export function makeArtifactLineage(label: string): ArtifactLineage {
  const consumedRef = `cambium:consumed:${label}`;
  return {
    source: makeArtifactStage(label, `cambium:source:${label}`, false),
    released: makeArtifactStage(label, `cambium:release:${label}`, false),
    installed: makeArtifactStage(label, `cambium:installed:${label}`, false),
    consumed: makeArtifactStage(label, consumedRef, true),
    consumed_ref: consumedRef,
  };
}

/** Expected stage anchor tuples matching makeArtifactLineage(label). */
export function makeExpectedStages(label: string): NonNullable<ExpectedVerdictAnchor["stages"]> {
  const stageAnchor = (stageRef: string, withAck: boolean): ExpectedStageAnchor => {
    const a: ExpectedStageAnchor = {
      max_age_days: 365,
      stage_ref: stageRef,
      work_id: "work:modular-mac-phase-a",
      task_id: "task:install-surface-task1",
      owner_contract: `cambium:organ-contract:${label}`,
      version: "1.0.0",
      scope: "install-surface",
      plant: "mac",
      artifact_digest: fakeDigest(`${label}-artifact`),
      source_digest: fakeDigest(`${label}-src`),
    };
    if (withAck) a.consumer_ack = `temperance:ack:${label}`;
    return a;
  };
  return {
    source: stageAnchor(`cambium:source:${label}`, false),
    released: stageAnchor(`cambium:release:${label}`, false),
    installed: stageAnchor(`cambium:installed:${label}`, false),
    consumed: stageAnchor(`cambium:consumed:${label}`, true),
  };
}

// ─── Operating organ refs (genesis, taste, hands, will, cortex) ────────────

function makeOperatingOrgan(
  organ_id: string,
  trigger: OrganEvidenceRef["trigger"],
  overrides: Partial<OrganEvidenceRef> = {},
): OrganEvidenceRef {
  return {
    organ_id,
    input_dependencies: [],
    owner: "cambium",
    contract: `cambium:organ-contract:${organ_id}`,
    source_digest: fakeDigest(`${organ_id}-src`),
    version: "1.0.0",
    trigger,
    artifact_ref: `cambium:artifact:${organ_id}:2026-10-01`,
    consumer: "temperance",
    independent_verdict: "unknown",
    freshness: "unknown",
    scope: "workstation",
    plant: "mac",
    admission: "pending",
    runtime: "stopped",
    verification: "unknown",
    ...overrides,
  };
}

export const OPERATING_ORGAN_REFS: OrganEvidenceRef[] = [
  makeOperatingOrgan("genesis", "manual-session", {
    admission: "admitted",
    runtime: "running",
    freshness: "stale",
    verification: "unverified",
  }),
  makeOperatingOrgan("taste", "scheduled"),
  makeOperatingOrgan("hands", "event-driven", {
    admission: "admitted",
    runtime: "running",
  }),
  makeOperatingOrgan("will", "manual-session", {
    admission: "admitted",
    runtime: "running",
  }),
  makeOperatingOrgan("cortex", "on-demand"),
];

// ─── Cognitive organ refs ──────────────────────────────────────────────────
// vestibule, adytum, nutrix, auspex, circulator, praeceptor.

export const COGNITIVE_ORGAN_REFS: OrganEvidenceRef[] = [
  makeOperatingOrgan("vestibule", "manual-session"),
  makeOperatingOrgan("adytum", "manual-session", {
    // Adytum carries the source-parity hold evidence (held, not verified).
    adytum_parity: makeAdytumParity(),
  }),
  makeOperatingOrgan("nutrix", "scheduled"),
  makeOperatingOrgan("auspex", "event-driven"),
  makeOperatingOrgan("circulator", "on-demand"),
  makeOperatingOrgan("praeceptor", "manual-session"),
];

// ─── Knowledge refs ────────────────────────────────────────────────────────

const SAMPLE_KNOWLEDGE_REFS: KnowledgeRef[] = [
  {
    ref_id: "knowledge:modular-mac-design",
    kind: "canonical",
    source_digest: fakeDigest("knowledge-modular-mac-design"),
    version: "2026-10-01",
    freshness: "fresh",
  },
  {
    ref_id: "knowledge:modular-mac-map-derived",
    kind: "derived",
    source_digest: fakeDigest("knowledge-modular-mac-map"),
    version: "2026-10-01",
    freshness: "stale",
    derived_from: "knowledge:modular-mac-design",
  },
];

// ─── Work objects ──────────────────────────────────────────────────────────

/** Build a WorkObjectRef with a valid binding_digest for the given tuple. */
export function makeWorkObject(fields: {
  work_id: string;
  task_id: string;
  pack: string;
  plant: string;
  scope: string;
  owner: string;
  contract: string;
  source_digest: `sha256:${string}`;
  version: string;
}): WorkObjectRef {
  return {
    ...fields,
    binding_digest: computeWorkBindingDigest(fields),
  };
}

const PHASE_A_FIELDS = {
  work_id: "work:modular-mac-phase-a",
  task_id: "task:install-surface-task1",
  pack: "workstation",
  plant: "mac",
  scope: "install-surface",
  owner: "cambium",
  contract: "cambium:work-contract:modular-mac",
  source_digest: fakeDigest("work-src-phase-a"),
  version: "1.0.0",
} as const;

export const SAMPLE_WORK_OBJECTS: WorkObjectRef[] = [makeWorkObject({ ...PHASE_A_FIELDS })];

export const SAMPLE_CELL_EFFECTS: CellEffectClass[] = [
  { kind: "extract", cell_id: "cell:source-read", description: "read source manifest", effect: "observed" },
  { kind: "feed", cell_id: "cell:evidence-feed", description: "write evidence receipt", effect: "staged" },
];

export const SAMPLE_EVIDENCE: EvidenceDimensions = {
  discovered: "yes",
  installed: "yes",
  configured: "partial",
  auth: "unknown",
  admission: "admitted",
  runtime: "running",
  verification: "unverified",
};

const SAMPLE_TOOLCHAIN: ToolchainRequirement[] = [
  { id: "bun", kind: "binary", version_constraint: "=1.3.5" },
  { id: "typescript", kind: "devtool", version_constraint: "=5.9.3" },
];

// All six Will desks are role filters bound to the single "will" organ.
const SAMPLE_WILL_DESKS = [
  { desk: "head-of-marketing" as const, assigned_to_organ: "will" as const },
  { desk: "copywriter" as const, assigned_to_organ: "will" as const },
  { desk: "creative-strategist" as const, assigned_to_organ: "will" as const },
  { desk: "launch-lead" as const, assigned_to_organ: "will" as const },
  { desk: "seo-lead" as const, assigned_to_organ: "will" as const },
  { desk: "analyst" as const, assigned_to_organ: "will" as const },
];

// ─── Base workstation snapshot ─────────────────────────────────────────────

export const workstationSnapshot: MigrationSnapshotV1 = {
  schema: "temperance.migration.snapshot.v1",
  version: { major: 1, minor: 0 },
  observed_at: "2026-10-01T00:00:01Z",
  profile: "workstation",
  source_release_digest: fakeDigest("release-workstation"),
  module_lock_digest: fakeDigest("lock-workstation"),
  logical_module_refs: ["provider.9router", "integration.cambium-ecosystem"],
  organs: {
    operating: OPERATING_ORGAN_REFS,
    cognitive: COGNITIVE_ORGAN_REFS,
  },
  knowledge_refs: SAMPLE_KNOWLEDGE_REFS,
  work_objects: SAMPLE_WORK_OBJECTS,
  cell_effects: SAMPLE_CELL_EFFECTS,
  will_role_desks: SAMPLE_WILL_DESKS,
  evidence: SAMPLE_EVIDENCE,
  toolchain_requirements: SAMPLE_TOOLCHAIN,
  data_classifications: ["public", "internal"],
  held_requirements: [],
  compatibility_observations: {
    hardware_model: "MacBookPro18,1",
    chip_model: "Apple M1 Pro",
    architecture: "arm64",
    os_version: "15.0",
    note: "compatibility observation only",
  },
};

// ─── Always-on-node snapshot ───────────────────────────────────────────────

export const alwaysOnNodeSnapshot: MigrationSnapshotV1 = {
  ...workstationSnapshot,
  profile: "always-on-node",
  source_release_digest: fakeDigest("release-always-on-node"),
  module_lock_digest: fakeDigest("lock-always-on-node"),
  logical_module_refs: ["provider.9router"],
};

// ─── Recovery snapshot ─────────────────────────────────────────────────────

export const recoverySnapshot: MigrationSnapshotV1 = {
  ...workstationSnapshot,
  profile: "recovery",
  source_release_digest: fakeDigest("release-recovery"),
  module_lock_digest: fakeDigest("lock-recovery"),
  logical_module_refs: [],
  held_requirements: ["recovery-no-new-dispatch"],
};

// ─── Capability-hit modes declaration fixture ─────────────────────────────
// Valid declaration of all four disabled source-owned modes. Every mode's
// source_digest agrees with the catalog digest.

const CAPABILITY_HIT_CATALOG_DIGEST = fakeDigest("capability-hit-system-v1-source");

export function makeCapabilityHitModesDeclaration(): CapabilityHitModesDeclaration {
  return {
    catalog_source_ref: CAPABILITY_HIT_SOURCE_REF,
    catalog_source_digest: CAPABILITY_HIT_CATALOG_DIGEST,
    modes: CAPABILITY_HIT_MODE_IDS.map((mode_id) => ({
      mode_id,
      disabled: true as const,
      source_ref: CAPABILITY_HIT_SOURCE_REF,
      source_digest: CAPABILITY_HIT_CATALOG_DIGEST,
    })),
  };
}

// ─── Synthetic integrated Mac chain ───────────────────────────────────────
// Exercises the actual four disabled capability-hit modes and the Adytum
// source-parity hold. Remains valid held evidence, not a validation error.

export const integratedMacSnapshot: MigrationSnapshotV1 = {
  ...workstationSnapshot,
  profile: "workstation",
  source_release_digest: fakeDigest("release-integrated-mac"),
  module_lock_digest: fakeDigest("lock-integrated-mac"),
  organs: {
    operating: OPERATING_ORGAN_REFS,
    cognitive: COGNITIVE_ORGAN_REFS,
  },
  capability_hit_modes: makeCapabilityHitModesDeclaration(),
  held_requirements: ["adytum-eight-vs-nine-parity"],
};

// ─── Hermes variant fixture ────────────────────────────────────────────────
// A Mac-door / Hermes variant: the Adytum organ is plant-scoped to hermes.

export const hermesVariantSnapshot: MigrationSnapshotV1 = {
  ...workstationSnapshot,
  profile: "workstation",
  source_release_digest: fakeDigest("release-hermes-variant"),
  module_lock_digest: fakeDigest("lock-hermes-variant"),
  organs: {
    operating: OPERATING_ORGAN_REFS,
    cognitive: COGNITIVE_ORGAN_REFS.map((ref) =>
      ref.organ_id === "adytum"
        ? { ...ref, plant: "hermes" as const, scope: "hermes-topic" }
        : ref
    ),
  },
  held_requirements: ["adytum-eight-vs-nine-parity"],
};

// ─── Adytum parity hold fixture ────────────────────────────────────────────
// The canonical six cognitive organs, with Adytum carrying real 9-vs-8 topic
// parity evidence. The snapshot is valid held evidence; parity is NOT matched
// unless reconciled against an independently pinned expected context.

export const adytumParityHoldSnapshot: MigrationSnapshotV1 = {
  ...workstationSnapshot,
  held_requirements: ["adytum-eight-vs-nine-parity"],
  organs: {
    operating: OPERATING_ORGAN_REFS,
    cognitive: COGNITIVE_ORGAN_REFS,
  },
};

// ─── Disabled capability-hit mode fixtures ─────────────────────────────────
// These exercise the actual four-mode declaration in held states.

export const disabledCapabilityHit_noRouter: MigrationSnapshotV1 = {
  ...workstationSnapshot,
  logical_module_refs: [],
  evidence: { ...SAMPLE_EVIDENCE, discovered: "no", configured: "none" },
  capability_hit_modes: makeCapabilityHitModesDeclaration(),
  held_requirements: ["no-router-hold"],
};

export const disabledCapabilityHit_noAdmission: MigrationSnapshotV1 = {
  ...workstationSnapshot,
  evidence: { ...SAMPLE_EVIDENCE, admission: "not-admitted" },
  capability_hit_modes: makeCapabilityHitModesDeclaration(),
  held_requirements: ["admission-pending"],
};

export const disabledCapabilityHit_noAuth: MigrationSnapshotV1 = {
  ...workstationSnapshot,
  evidence: { ...SAMPLE_EVIDENCE, auth: "no" },
  capability_hit_modes: makeCapabilityHitModesDeclaration(),
  held_requirements: ["auth-pending"],
};

export const disabledCapabilityHit_noRuntime: MigrationSnapshotV1 = {
  ...workstationSnapshot,
  evidence: { ...SAMPLE_EVIDENCE, runtime: "unreachable" },
  capability_hit_modes: makeCapabilityHitModesDeclaration(),
  held_requirements: ["runtime-hold"],
};

// ─── Expected context helpers (independently pinned, out-of-band) ──────────

/** The expected work binding matching the base workstation WorkObject. */
export function makeExpectedWorkBinding(): ExpectedWorkBinding {
  const { source_digest, ...rest } = PHASE_A_FIELDS;
  return { ...rest, source_digest };
}

/** Expected Adytum context reconciling owner 9 / consumer 8 (parity held). */
export function makeExpectedAdytumContext(): ExpectedAdytumContext {
  const parity = makeAdytumParity();
  // Complete per-topic ref/version/digest tuples (not just names). The
  // synthetic hermes-owner:topic-N references are explicitly synthetic — they
  // are NOT a live owner-contract reconciliation.
  return {
    owner_contract_ref: parity.owner_contract_ref,
    owner_contract_version: parity.owner_contract_version,
    owner_contract_digest: parity.owner_contract_digest,
    owner_topics: parity.owner_topics.map((t) => ({ ...t })),
    consumer_support_ref: parity.consumer_support_ref,
    consumer_support_version: parity.consumer_support_version,
    consumer_support_digest: parity.consumer_support_digest,
    consumer_topics: parity.consumer_topics.map((t) => ({ ...t })),
  };
}

/**
 * Full expected context for the base workstation snapshot. By default this
 * reconciles work and capability-hit, but Adytum stays source-parity-held
 * because the consumer supports only 8 of the 9 owner topics.
 */
export function makeExpectedContext(
  overrides: Partial<MigrationExpectedContext> = {},
): MigrationExpectedContext {
  return {
    expected_work: [makeExpectedWorkBinding()],
    expected_verdicts: [],
    expected_adytum: makeExpectedAdytumContext(),
    expected_capability_hit_source_digest: CAPABILITY_HIT_CATALOG_DIGEST,
    now: "2026-10-01T00:00:02Z",
    ...overrides,
  };
}

/** Expected verdict anchor for an organ, with an independent verifier. */
export function makeExpectedVerdictAnchor(
  organ_id: string,
  label: string,
  overrides: Partial<ExpectedVerdictAnchor> = {},
): ExpectedVerdictAnchor {
  // Edge defaults reconcile the canonical operating-organ fixture produced by
  // makeOperatingOrgan(organ_id, ...): owner "cambium", contract
  // "cambium:organ-contract:<id>", source_digest fakeDigest("<id>-src"),
  // artifact_ref "cambium:artifact:<id>:2026-10-01", consumer "temperance",
  // scope "workstation", joined to the base PHASE_A WorkObject.
  return {
    organ_id: organ_id as ExpectedVerdictAnchor["organ_id"],
    owner: "cambium", version: "1.0.0", plant: "mac",
    trigger: organ_id === "taste" ? "scheduled" : organ_id === "hands" ? "event-driven" : organ_id === "cortex" ? "on-demand" : "manual-session",
    input_dependencies: [],
    stages: makeExpectedStages(label),
    consumed_ref: `cambium:consumed:${label}`,
    artifact_digest: fakeDigest(`${label}-artifact`),
    criteria_digest: fakeDigest(`${label}-criteria`),
    policy_digest: fakeDigest(`${label}-policy`),
    verifier_ref: `auspex:verifier:${label}`,
    max_age_days: 365,
    work_id: PHASE_A_FIELDS.work_id,
    artifact_ref: `cambium:artifact:${organ_id}:2026-10-01`,
    consumer: "temperance",
    organ_contract: `cambium:organ-contract:${organ_id}`,
    source_digest: fakeDigest(`${organ_id}-src`),
    scope: "workstation",
    ...overrides,
  };
}

// ─── Target fixtures ──────────────────────────────────────────────────────

export const workstationTarget: MigrationTargetV1 = {
  schema: "temperance.migration.target.v1",
  version: { major: 1, minor: 0 },
  target_profile: "workstation",
  destination_id: "destination:new-workstation",
  compatibility_check_only: true,
  requested_modules: ["provider.9router", "integration.cambium-ecosystem"],
  held_requirements: [],
};

export const alwaysOnNodeTarget: MigrationTargetV1 = {
  schema: "temperance.migration.target.v1",
  version: { major: 1, minor: 0 },
  target_profile: "always-on-node",
  destination_id: "destination:always-on-node",
  compatibility_check_only: true,
  requested_modules: ["provider.9router"],
  held_requirements: [],
};

/** Synthetic operating-organ input chain; the expected side is constructed
 * independently from fixture constants, never extracted from observed input.
 */
function chainInput(producer: ExpectedVerdictAnchor["organ_id"], consumer: ExpectedVerdictAnchor["organ_id"]) {
  return {
    input_id: `input:${producer}:${consumer}`, producer_organ_id: producer, consumer_organ_id: consumer,
    artifact_ref: `cambium:artifact:${producer}:2026-10-01`, artifact_digest: fakeDigest(`${producer}-artifact`),
    source_digest: fakeDigest(`${producer}-src`), work_id: "work:modular-mac-phase-a",
    task_id: "task:install-surface-task1", scope: "install-surface",
  };
}
const CHAIN_IDS = ["genesis", "taste", "hands", "will", "cortex"] as const;

export function makeInputChainSnapshot(profile: "workstation" | "always-on-node" = "workstation"): MigrationSnapshotV1 {
  const s = structuredClone(profile === "workstation" ? workstationSnapshot : alwaysOnNodeSnapshot);
  for (let i = 0; i < CHAIN_IDS.length; i++) {
    const id = CHAIN_IDS[i];
    Object.assign(s.organs.operating[i], {
      independent_verdict: "passed", verification: "verified", freshness: "fresh",
      verdict_attestation: makeAttestation(id), artifact_lineage: makeArtifactLineage(id),
      consumer: CHAIN_IDS[i + 1] ?? "temperance",
      input_dependencies: i === 0 ? [] : [chainInput(CHAIN_IDS[i - 1], id)],
    });
  }
  return s;
}

export function makeInputChainExpectedContext(): MigrationExpectedContext {
  return makeExpectedContext({
    required_work_ids: ["work:modular-mac-phase-a"], required_organ_ids: ["cortex"],
    expected_verdicts: CHAIN_IDS.map((id, i) => makeExpectedVerdictAnchor(id, id, {
      consumer: CHAIN_IDS[i + 1] ?? "temperance",
      input_dependencies: i === 0 ? [] : [chainInput(CHAIN_IDS[i - 1], id)],
    })),
  });
}
