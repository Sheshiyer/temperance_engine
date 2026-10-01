import { describe, expect, test } from "bun:test";

import {
  MIGRATION_SNAPSHOT_SCHEMA,
  MIGRATION_TARGET_SCHEMA,
  type MigrationSnapshotV1,
  type MigrationFindingV1,
  validateMigrationSnapshot,
  validateMigrationTarget,
  assessMigrationCompatibility,
  makeMigrationFinding,
  OPERATING_ORGAN_IDS,
  COGNITIVE_ORGAN_IDS,
  WILL_ROLE_DESKS,
  MAX_MIGRATION_SNAPSHOT_BYTES,
  computeWorkBindingDigest,
  CAPABILITY_HIT_SOURCE_REF,
  CAPABILITY_HIT_MODE_IDS,
  ADYTUM_OWNER_TOPIC_COUNT,
  ADYTUM_CONSUMER_TOPIC_COUNT,
} from "../src/migration/contracts.ts";

import {
  workstationSnapshot,
  alwaysOnNodeSnapshot,
  recoverySnapshot,
  integratedMacSnapshot,
  hermesVariantSnapshot,
  adytumParityHoldSnapshot,
  disabledCapabilityHit_noRouter,
  disabledCapabilityHit_noAdmission,
  disabledCapabilityHit_noAuth,
  disabledCapabilityHit_noRuntime,
  workstationTarget,
  alwaysOnNodeTarget,
  fakeDigest,
  OPERATING_ORGAN_REFS,
  COGNITIVE_ORGAN_REFS,
  SAMPLE_WORK_OBJECTS,
  makeWorkObject,
  makeCapabilityHitModesDeclaration,
  makeAdytumParity,
  makeAttestation,
  makeArtifactLineage,
  makeExpectedContext,
  makeExpectedWorkBinding,
  makeExpectedAdytumContext,
  makeExpectedVerdictAnchor,
  makeExpectedStages,
  SAMPLE_EVIDENCE,
  makeInputChainSnapshot,
  makeInputChainExpectedContext,
} from "./migration-fixtures.ts";

const clone = <T>(v: T): T => structuredClone(v);
// Preserve private-path negative inputs without embedding a home path in source.
const SYNTHETIC_HOME = "/" + ["Users", "synthetic"].join("/");

// ─── Schema constant tests ────────────────────────────────────────────────

describe("migration contract schema constants", () => {
  test("snapshot and target schema strings are stable", () => {
    expect(MIGRATION_SNAPSHOT_SCHEMA).toBe("temperance.migration.snapshot.v1");
    expect(MIGRATION_TARGET_SCHEMA).toBe("temperance.migration.target.v1");
  });

  test("OPERATING_ORGAN_IDS lists exactly the five canonical operating organs", () => {
    expect([...OPERATING_ORGAN_IDS]).toEqual([
      "genesis",
      "taste",
      "hands",
      "will",
      "cortex",
    ]);
  });

  test("COGNITIVE_ORGAN_IDS lists exactly the six canonical cognitive organs", () => {
    expect([...COGNITIVE_ORGAN_IDS]).toEqual([
      "vestibule",
      "adytum",
      "nutrix",
      "auspex",
      "circulator",
      "praeceptor",
    ]);
  });

  test("WILL_ROLE_DESKS lists exactly the six canonical role desks", () => {
    expect([...WILL_ROLE_DESKS]).toEqual([
      "head-of-marketing",
      "copywriter",
      "creative-strategist",
      "launch-lead",
      "seo-lead",
      "analyst",
    ]);
  });

  test("CAPABILITY_HIT_MODE_IDS exports exactly the four source-owned mode IDs", () => {
    expect([...CAPABILITY_HIT_MODE_IDS]).toEqual([
      "capability-hit-on-task-change",
      "capability-hit-founder-morning",
      "capability-hit-organ-spotlight",
      "capability-hit-health-escalation",
    ]);
  });

  test("Adytum owner/consumer topic counts are 9 and 8", () => {
    expect(ADYTUM_OWNER_TOPIC_COUNT).toBe(9);
    expect(ADYTUM_CONSUMER_TOPIC_COUNT).toBe(8);
  });
});

// ─── Valid base fixtures ────────────────────────────────────────────────────

describe("validateMigrationSnapshot – valid fixtures", () => {
  test("workstation, always-on-node and recovery base profiles validate", () => {
    expect(validateMigrationSnapshot(workstationSnapshot).ok).toBe(true);
    expect(validateMigrationSnapshot(alwaysOnNodeSnapshot).ok).toBe(true);
    expect(validateMigrationSnapshot(recoverySnapshot).ok).toBe(true);
  });

  test("integrated and hermes-variant Mac fixtures validate as held evidence", () => {
    expect(validateMigrationSnapshot(integratedMacSnapshot).ok).toBe(true);
    expect(validateMigrationSnapshot(hermesVariantSnapshot).ok).toBe(true);
    expect(validateMigrationSnapshot(adytumParityHoldSnapshot).ok).toBe(true);
  });

  test("all four disabled-capability-hit fixtures validate structurally", () => {
    expect(validateMigrationSnapshot(disabledCapabilityHit_noRouter).ok).toBe(true);
    expect(validateMigrationSnapshot(disabledCapabilityHit_noAdmission).ok).toBe(true);
    expect(validateMigrationSnapshot(disabledCapabilityHit_noAuth).ok).toBe(true);
    expect(validateMigrationSnapshot(disabledCapabilityHit_noRuntime).ok).toBe(true);
  });
});

// ─── Brief-specified assertions ─────────────────────────────────────────────

describe("plan-specified contract assertions", () => {
  test("root credential key is rejected", () => {
    expect(validateMigrationSnapshot({ ...workstationSnapshot, credential: "fixture" }).ok).toBe(false);
  });

  test("schema major 99 returns UPGRADE_REQUIRED", () => {
    const r = validateMigrationSnapshot({ ...workstationSnapshot, version: { major: 99, minor: 0 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("UPGRADE_REQUIRED");
  });
});

// ─── P1 — canonical organ / will-desk ecosystem ─────────────────────────────

describe("P1: canonical organ & Will-desk ecosystem", () => {
  test("wrong-ecosystem operating organ id (phloem) is rejected", () => {
    const s = clone(workstationSnapshot);
    s.organs.operating[0].organ_id = "phloem";
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ORGAN_UNKNOWN_OPERATING_ID");
  });

  test("wrong-ecosystem cognitive organ id (hermes) is rejected", () => {
    const s = clone(workstationSnapshot);
    s.organs.cognitive[0].organ_id = "hermes";
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ORGAN_UNKNOWN_COGNITIVE_ID");
  });

  test("operating organ set must have exactly five members", () => {
    const s = clone(workstationSnapshot);
    s.organs.operating = s.organs.operating.slice(0, 4);
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("OPERATING_ORGAN_COUNT_INVALID");
  });

  test("cognitive organ set must have exactly six members", () => {
    const s = clone(workstationSnapshot);
    s.organs.cognitive = s.organs.cognitive.slice(0, 5);
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("COGNITIVE_ORGAN_COUNT_INVALID");
  });

  test("duplicate operating organ id is rejected", () => {
    const s = clone(workstationSnapshot);
    s.organs.operating[1].organ_id = s.organs.operating[0].organ_id;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("DUPLICATE_OPERATING_ORGAN");
  });

  test("Will desks are the six canonical role filters bound to the will organ", () => {
    const r = validateMigrationSnapshot(workstationSnapshot);
    expect(r.ok).toBe(true);
    for (const d of workstationSnapshot.will_role_desks) {
      expect(d.assigned_to_organ).toBe("will");
    }
  });

  test("a wrong-ecosystem desk name (inquiry) is rejected", () => {
    const s = clone(workstationSnapshot);
    (s.will_role_desks[0] as { desk: string }).desk = "inquiry";
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("INVALID_WILL_DESK_NAME");
  });

  test("a desk assigned to an organ other than will is rejected", () => {
    const s = clone(workstationSnapshot);
    (s.will_role_desks[0] as { assigned_to_organ: string }).assigned_to_organ = "cortex";
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("WILL_DESK_NOT_BOUND_TO_WILL");
  });
});

// ─── P1 — closed nested privacy: every allowed value validated ───────────────

describe("P1: closed nested typed privacy — allowed values validated recursively", () => {
  test("cell_effects[].description nested body is rejected", () => {
    const s = clone(workstationSnapshot);
    (s.cell_effects[0] as unknown as { description: unknown }).description = { credential: "synthetic-secret" };
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("CELL_EFFECT_MISSING_DESCRIPTION");
  });

  test("cell_effects missing effect is rejected", () => {
    const s = clone(workstationSnapshot);
    delete (s.cell_effects[0] as { effect?: unknown }).effect;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("CELL_EFFECT_INVALID_EFFECT");
  });

  test("compatibility_observations nested hardware_model body is rejected", () => {
    const s = clone(workstationSnapshot);
    (s.compatibility_observations as unknown as { hardware_model: unknown }).hardware_model = {
      session_id: "synthetic-session",
    };
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("COMPATIBILITY_OBS_INVALID_HARDWARE_MODEL");
  });

  test("held_requirements array of nested bodies is rejected", () => {
    const s = clone(workstationSnapshot);
    (s as unknown as { held_requirements: unknown }).held_requirements = [{ credential: "synthetic-secret" }];
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_HELD_REQUIREMENTS");
  });

  test("logical_module_refs with nested body is rejected", () => {
    const s = clone(workstationSnapshot);
    (s as unknown as { logical_module_refs: unknown }).logical_module_refs = [{ credential: "synthetic-secret" }];
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_MODULE_REF_VALUE");
  });

  test("will desk missing assigned_to_organ is rejected", () => {
    const s = clone(workstationSnapshot);
    delete (s.will_role_desks[0] as { assigned_to_organ?: unknown }).assigned_to_organ;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("WILL_DESK_NOT_BOUND_TO_WILL");
  });

  test("knowledge_refs missing version is rejected", () => {
    const s = clone(workstationSnapshot);
    delete (s.knowledge_refs[0] as { version?: unknown }).version;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("KNOWLEDGE_MISSING_VERSION");
  });

  test("knowledge_refs missing freshness is rejected", () => {
    const s = clone(workstationSnapshot);
    delete (s.knowledge_refs[0] as { freshness?: unknown }).freshness;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("KNOWLEDGE_INVALID_FRESHNESS");
  });

  test("knowledge_refs invalid freshness enum is rejected", () => {
    const s = clone(workstationSnapshot);
    (s.knowledge_refs[0] as unknown as { freshness: string }).freshness = "not-an-enum";
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("KNOWLEDGE_INVALID_FRESHNESS");
  });

  test("toolchain_requirements missing version_constraint is rejected", () => {
    const s = clone(workstationSnapshot);
    delete (s.toolchain_requirements[0] as { version_constraint?: unknown }).version_constraint;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("TOOLCHAIN_MISSING_VERSION_CONSTRAINT");
  });

  test("organ consumer with a path leak is rejected", () => {
    const s = clone(workstationSnapshot);
    // Mutate the CONSUMER (not the owner) with a private path; the positive
    // reference grammar now rejects it on the consumer field itself.
    s.organs.operating[0].consumer = `${SYNTHETIC_HOME}/private`;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ORGAN_CONSUMER_REF_LEAK");
  });

  test("organ scope with a path leak is rejected", () => {
    const s = clone(workstationSnapshot);
    s.organs.operating[0].scope = `${SYNTHETIC_HOME}/private`;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ORGAN_SCOPE_REF_LEAK");
  });

  test("organ verifier_ref with a path leak is rejected", () => {
    const s = clone(workstationSnapshot);
    s.organs.operating[0].independent_verdict = "passed";
    s.organs.operating[0].verdict_attestation = makeAttestation("leak");
    s.organs.operating[0].verdict_attestation!.verifier_ref = `${SYNTHETIC_HOME}/private`;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
  });

  test("snapshot version minor of -1 is rejected", () => {
    const r = validateMigrationSnapshot({ ...workstationSnapshot, version: { major: 1, minor: -1 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_VERSION");
  });

  test("unknown root key is rejected", () => {
    const r = validateMigrationSnapshot({ ...workstationSnapshot, extra: "unexpected" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("UNKNOWN_SNAPSHOT_KEY");
  });

  test("nested unknown organ key is rejected", () => {
    const s = clone(workstationSnapshot);
    (s.organs.operating[0] as unknown as { credential: string }).credential = "synthetic-secret";
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
  });
});

// ─── P1 — closed target privacy ─────────────────────────────────────────────

describe("P1: target closed privacy", () => {
  test("target requested_modules nested body is rejected", () => {
    const t = clone(workstationTarget);
    (t as unknown as { requested_modules: unknown }).requested_modules = [{ credential: "synthetic-secret" }];
    expect(validateMigrationTarget(t)).toBe(false);
  });

  test("target held_requirements nested body is rejected", () => {
    const t = clone(workstationTarget);
    (t as unknown as { held_requirements: unknown }).held_requirements = [{ credential: "synthetic-secret" }];
    expect(validateMigrationTarget(t)).toBe(false);
  });

  test("target destination_id path leak is rejected", () => {
    const t = clone(workstationTarget);
    t.destination_id = `${SYNTHETIC_HOME}/private`;
    expect(validateMigrationTarget(t)).toBe(false);
  });
});

// ─── Forbidden payloads / prototype pollution ───────────────────────────────

describe("validateMigrationSnapshot – forbidden payloads", () => {
  for (const key of ["credential", "api_key", "secret", "password", "token", "session_id", "raw_log"]) {
    test(`root ${key} is rejected`, () => {
      expect(validateMigrationSnapshot({ ...workstationSnapshot, [key]: "x" }).ok).toBe(false);
    });
  }

  test("nested __proto__ own-key is rejected", () => {
    const s = clone(workstationSnapshot) as unknown as Record<string, unknown>;
    const parsed = JSON.parse('{"organs":{"operating":[{"__proto__":{"polluted":true}}]}}');
    (s as Record<string, unknown>)["organs"] = parsed.organs;
    expect(validateMigrationSnapshot(s).ok).toBe(false);
  });

  test("snapshot exceeding size limit is rejected", () => {
    const s = clone(workstationSnapshot);
    s.data_classifications = [("x").repeat(MAX_MIGRATION_SNAPSHOT_BYTES + 10)];
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("EXCEEDS_SIZE_LIMIT");
  });
});

// ─── Digests / duplicates / timestamps ──────────────────────────────────────

describe("validateMigrationSnapshot – digests, duplicates, timestamps", () => {
  test("missing source_release_digest is rejected", () => {
    const s = clone(workstationSnapshot);
    (s as unknown as { source_release_digest: unknown }).source_release_digest = "not-a-digest";
    expect(validateMigrationSnapshot(s).ok).toBe(false);
  });

  test("duplicate logical module refs are rejected", () => {
    const s = clone(workstationSnapshot);
    s.logical_module_refs = ["provider.9router", "provider.9router"];
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("DUPLICATE_MODULE_REF");
  });

  test("Feb 30 observed_at is rejected (calendar check)", () => {
    const r = validateMigrationSnapshot({ ...workstationSnapshot, observed_at: "2026-02-30T00:00:00Z" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_EVIDENCE_TIME");
  });

  test("epoch-zero observed_at is rejected", () => {
    const r = validateMigrationSnapshot({ ...workstationSnapshot, observed_at: "1970-01-01T00:00:00.000Z" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_EVIDENCE_TIME");
  });
});

// ─── Runtime evidence (P2b) ─────────────────────────────────────────────────

describe("runtime evidence — stopped/running/unreachable/unknown independent of installed", () => {
  test("installed=yes with runtime=stopped is accepted", () => {
    const s = clone(workstationSnapshot);
    s.evidence = { ...SAMPLE_EVIDENCE, installed: "yes", runtime: "stopped" };
    expect(validateMigrationSnapshot(s).ok).toBe(true);
  });

  test("installed=yes with runtime=unreachable is accepted", () => {
    const s = clone(workstationSnapshot);
    s.evidence = { ...SAMPLE_EVIDENCE, installed: "yes", runtime: "unreachable" };
    expect(validateMigrationSnapshot(s).ok).toBe(true);
  });

  test("legacy runtime value 'installed' is rejected", () => {
    const s = clone(workstationSnapshot);
    (s.evidence as unknown as { runtime: string }).runtime = "installed";
    expect(validateMigrationSnapshot(s).ok).toBe(false);
  });
});

// ─── Cell effects ───────────────────────────────────────────────────────────

describe("validateMigrationSnapshot – cell effect classes", () => {
  test("valid extract/feed/read/edit cell effects are accepted", () => {
    const s = clone(workstationSnapshot);
    s.cell_effects = [
      { kind: "extract", cell_id: "cell:a", description: "a", effect: "observed" },
      { kind: "feed", cell_id: "cell:b", description: "b", effect: "staged" },
      { kind: "read", cell_id: "cell:c", description: "c", effect: "observed" },
      { kind: "edit", cell_id: "cell:d", description: "d", effect: "applied" },
    ];
    expect(validateMigrationSnapshot(s).ok).toBe(true);
  });

  test("an out-of-set cell verb is rejected", () => {
    const s = clone(workstationSnapshot);
    (s.cell_effects[0] as unknown as { kind: string }).kind = "delete";
    expect(validateMigrationSnapshot(s).ok).toBe(false);
  });
});

// ─── P1 — WorkObject substitution & real owner join ─────────────────────────

describe("P1: WorkObject stable binding digest — nine-axis substitution rejected", () => {
  const axes = ["work_id", "task_id", "pack", "plant", "scope", "owner", "contract", "version"] as const;
  for (const axis of axes) {
    test(`substituting ${axis} without rehash is rejected`, () => {
      const s = clone(workstationSnapshot);
      (s.work_objects[0] as unknown as Record<string, string>)[axis] = "other-nonempty";
      const r = validateMigrationSnapshot(s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("WORK_BINDING_DIGEST_MISMATCH");
    });
  }

  test("substituting source_digest without rehash is rejected", () => {
    const s = clone(workstationSnapshot);
    s.work_objects[0].source_digest = fakeDigest("different-valid");
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("WORK_BINDING_DIGEST_MISMATCH");
  });
});

describe("P1: WorkObject owner anchor — self digest is integrity only", () => {
  test("structurally valid snapshot is NONAUTHORITATIVE without expected context", () => {
    const r = assessMigrationCompatibility(workstationSnapshot, undefined);
    expect(r.structurally_valid).toBe(true);
    expect(r.status).toBe("nonauthoritative");
    expect(r.holds).toContain("NO_EXPECTED_CONTEXT");
  });

  test("absent binding_digest is an explicit HELD, never a silent pass", () => {
    const s = clone(workstationSnapshot);
    delete s.work_objects[0].binding_digest;
    s.evidence.verification = "verified";
    // structurally valid (binding_digest optional)
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    const r = assessMigrationCompatibility(s, makeExpectedContext());
    expect(r.status).toBe("held");
    expect(r.holds.some((h) => h.startsWith("WORK_NO_BINDING_DIGEST"))).toBe(true);
  });

  test("coherently changed owner/scope + rehash still fails the independent anchor", () => {
    const s = clone(workstationSnapshot);
    s.work_objects[0].owner = "other-owner";
    s.work_objects[0].scope = "other-tenant";
    s.work_objects[0].binding_digest = computeWorkBindingDigest(s.work_objects[0]);
    s.evidence.admission = "admitted";
    s.evidence.verification = "verified";
    // structurally valid (self-consistent rehash)
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    const r = assessMigrationCompatibility(s, makeExpectedContext());
    expect(r.status).toBe("held");
    expect(r.holds.some((h) => h.startsWith("WORK_ANCHOR_MISMATCH"))).toBe(true);
  });

  test("a scoped base flow is compatible while Adytum stays source-parity-held", () => {
    // A fully independently matched fresh/passed selected Genesis flow. The base
    // flow selects only the Genesis work/organ; all five operating and six
    // cognitive organs (including Adytum) remain in the snapshot. Adytum's
    // 9-vs-8 source-parity hold is reported in observations but does NOT block
    // this unrelated required flow. Compatibility NEVER authorizes execution.
    const s = clone(workstationSnapshot);
    const organ = s.organs.operating[0]; // genesis
    organ.independent_verdict = "passed";
    organ.verification = "verified";
    organ.freshness = "fresh";
    organ.verdict_attestation = makeAttestation("scoped-genesis");
    organ.artifact_lineage = makeArtifactLineage("scoped-genesis");
    expect(validateMigrationSnapshot(s).ok).toBe(true);

    const anchor = makeExpectedVerdictAnchor("genesis", "scoped-genesis", {
      stages: makeExpectedStages("scoped-genesis"),
      require_fresh_pass: true,
    });
    const r = assessMigrationCompatibility(
      s,
      makeExpectedContext({
        required_work_ids: ["work:modular-mac-phase-a"],
        required_organ_ids: ["genesis"],
        expected_verdicts: [anchor],
      }),
    );

    expect(r.structurally_valid).toBe(true);
    expect(r.status).toBe("compatible");
    expect(r.holds).toEqual([]);
    // Compatibility is never permission.
    expect(r.execution_authorized).toBe(false);
    // The unselected Adytum source-parity hold is still visible as an observation.
    expect(r.observations).toContain("ADYTUM_SOURCE_PARITY_HELD");
  });

  test("selecting Adytum keeps its source-parity hold blocking (explicit held)", () => {
    const s = clone(workstationSnapshot);
    const organ = s.organs.operating[0];
    organ.independent_verdict = "passed";
    organ.verification = "verified";
    organ.freshness = "fresh";
    organ.verdict_attestation = makeAttestation("scoped-genesis");
    organ.artifact_lineage = makeArtifactLineage("scoped-genesis");
    const anchor = makeExpectedVerdictAnchor("genesis", "scoped-genesis", {
      stages: makeExpectedStages("scoped-genesis"),
    });
    const r = assessMigrationCompatibility(
      s,
      makeExpectedContext({
        required_work_ids: ["work:modular-mac-phase-a"],
        required_organ_ids: ["genesis", "adytum"],
        expected_verdicts: [anchor],
      }),
    );
    expect(r.status).toBe("held");
    expect(r.holds).toContain("ADYTUM_SOURCE_PARITY_HELD");
    expect(r.execution_authorized).toBe(false);
  });

  test("a required selected expectation with no observation is held", () => {
    const s = clone(workstationSnapshot);
    const r = assessMigrationCompatibility(
      s,
      makeExpectedContext({ required_work_ids: ["work:does-not-exist"] }),
    );
    expect(r.status).toBe("held");
    expect(r.holds).toContain("REQUIRED_WORK_MISSING:work:does-not-exist");
  });

  test("an empty/unresolved selection is not blanket-compatible", () => {
    // Empty expected_work with no selection falls back to whole-snapshot and
    // still holds on the unanchored base WorkObject — never silent compatible.
    const s = clone(workstationSnapshot);
    const r = assessMigrationCompatibility(
      s,
      makeExpectedContext({ expected_work: [], expected_adytum: undefined }),
    );
    expect(r.status).toBe("held");
    expect(r.holds.length).toBeGreaterThan(0);
    expect(r.holds.some((h) => h.startsWith("WORK_"))).toBe(true);
  });

  test("a snapshot whose Adytum organ carries no parity evidence is held when selected", () => {
    // Repaired from the old mislabeled "no Adytum organ ... compatible" test,
    // which actually asserted held. Adytum remains one of the canonical six
    // cognitive organs; it is never deleted to manufacture success.
    const s = clone(workstationSnapshot);
    const adytum = s.organs.cognitive.find((o) => o.organ_id === "adytum")!;
    delete adytum.adytum_parity;
    adytum.verification = "unverified";
    adytum.admission = "pending";
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    const r = assessMigrationCompatibility(
      s,
      makeExpectedContext({ required_organ_ids: ["adytum"], expected_adytum: undefined }),
    );
    expect(r.status).toBe("held");
    expect(r.holds).toContain("ADYTUM_NO_PARITY_EVIDENCE");
  });
});

// ─── P1 — verdict / lineage binding ─────────────────────────────────────────

describe("P1: verdict attestation structural binding", () => {
  test("passed verdict without attestation is rejected", () => {
    const s = clone(workstationSnapshot);
    s.organs.operating[0].independent_verdict = "passed";
    delete s.organs.operating[0].verdict_attestation;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ORGAN_VERDICT_MISSING_ATTESTATION");
  });

  test("unknown verdict carrying an attestation is rejected", () => {
    const s = clone(workstationSnapshot);
    s.organs.operating[1].independent_verdict = "unknown";
    s.organs.operating[1].verdict_attestation = makeAttestation("x");
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ORGAN_UNKNOWN_VERDICT_HAS_ATTESTATION");
  });

  test("future attested_at with freshness=fresh is rejected", () => {
    const s = clone(workstationSnapshot);
    s.organs.operating[0].independent_verdict = "passed";
    const att = makeAttestation("future");
    att.attested_at = "2027-01-01T00:00:00Z";
    att.freshness = "fresh";
    s.organs.operating[0].verdict_attestation = att;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("VERDICT_ATTESTATION_FUTURE_FRESH");
  });

  test("Feb 30 attested_at is rejected", () => {
    const s = clone(workstationSnapshot);
    s.organs.operating[0].independent_verdict = "passed";
    const att = makeAttestation("cal");
    att.attested_at = "2026-02-30T00:00:00Z";
    s.organs.operating[0].verdict_attestation = att;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("VERDICT_ATTESTATION_INVALID_TIMESTAMP");
  });
});

describe("P1: verdict lineage join against independent anchor", () => {
  function snapshotWithPassedOrgan(label: string): MigrationSnapshotV1 {
    const s = clone(workstationSnapshot);
    const organ = s.organs.operating[0];
    organ.independent_verdict = "passed";
    organ.verification = "verified";
    organ.freshness = "fresh";
    organ.verdict_attestation = makeAttestation(label);
    organ.artifact_lineage = makeArtifactLineage(label);
    return s;
  }

  test("matching lineage + independent verifier yields no verdict hold", () => {
    const s = snapshotWithPassedOrgan("genesis-v");
    const organId = s.organs.operating[0].organ_id;
    // Adytum is unselected here, so its 9-vs-8 source parity is reported as an
    // observation and never produces a VERDICT_ hold. Only the verdict path is
    // under test.
    const exp = makeExpectedContext({
      expected_verdicts: [makeExpectedVerdictAnchor(organId, "genesis-v")],
    });
    const r = assessMigrationCompatibility(s, exp);
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    expect(r.holds.some((h) => h.startsWith("VERDICT_"))).toBe(false);
    expect(r.holds.some((h) => h.startsWith("EDGE_"))).toBe(false);
    expect(r.holds.some((h) => h.startsWith("STAGE_"))).toBe(false);
  });

  test("CHANGED artifact_digest in a passed attestation is held (not fresh-matched)", () => {
    const s = snapshotWithPassedOrgan("genesis-v");
    const organId = s.organs.operating[0].organ_id;
    s.organs.operating[0].verdict_attestation!.artifact_digest = fakeDigest("other-artifact");
    const exp = makeExpectedContext({
      expected_verdicts: [makeExpectedVerdictAnchor(organId, "genesis-v")],
    });
    const r = assessMigrationCompatibility(s, exp);
    expect(r.status).toBe("held");
    expect(r.holds.some((h) => h.startsWith("VERDICT_DIGEST_MISMATCH"))).toBe(true);
  });

  test("unrelated consumed_ref is held, not matched", () => {
    const s = snapshotWithPassedOrgan("genesis-v");
    const organId = s.organs.operating[0].organ_id;
    // Keep the lineage structurally valid (consumed_ref must mirror the typed
    // consume stage ref) but point the whole consume stage at an unrelated ref.
    s.organs.operating[0].artifact_lineage!.consumed.stage_ref = "other-work:artifact";
    s.organs.operating[0].artifact_lineage!.consumed_ref = "other-work:artifact";
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    const exp = makeExpectedContext({
      expected_verdicts: [makeExpectedVerdictAnchor(organId, "genesis-v")],
    });
    const r = assessMigrationCompatibility(s, exp);
    expect(r.status).toBe("held");
    expect(r.holds.some((h) => h.startsWith("VERDICT_CONSUMED_MISMATCH"))).toBe(true);
  });

  test("producer as its own verifier is held", () => {
    const s = snapshotWithPassedOrgan("genesis-v");
    const organId = s.organs.operating[0].organ_id;
    s.organs.operating[0].verdict_attestation!.verifier_ref = s.organs.operating[0].owner;
    const exp = makeExpectedContext({
      expected_verdicts: [
        makeExpectedVerdictAnchor(organId, "genesis-v", {
          verifier_ref: s.organs.operating[0].owner,
        }),
      ],
    });
    const r = assessMigrationCompatibility(s, exp);
    expect(r.status).toBe("held");
    expect(r.holds.some((h) => h.startsWith("VERDICT_PRODUCER_IS_VERIFIER"))).toBe(true);
  });

  test("a passed verdict with no expected anchor is held", () => {
    const s = snapshotWithPassedOrgan("genesis-v");
    const exp = makeExpectedContext({ expected_verdicts: [] });
    const r = assessMigrationCompatibility(s, exp);
    expect(r.status).toBe("held");
    expect(r.holds.some((h) => h.startsWith("VERDICT_UNANCHORED"))).toBe(true);
  });

  test("decades-old attestation is stale-held under age policy", () => {
    const s = snapshotWithPassedOrgan("genesis-v");
    const organId = s.organs.operating[0].organ_id;
    const att = s.organs.operating[0].verdict_attestation!;
    att.attested_at = "1990-01-01T00:00:00Z";
    att.freshness = "stale";
    const exp = makeExpectedContext({
      expected_verdicts: [makeExpectedVerdictAnchor(organId, "genesis-v", { max_age_days: 365 })],
      now: "2026-10-01T00:00:02Z",
    });
    const r = assessMigrationCompatibility(s, exp);
    expect(r.status).toBe("held");
    expect(r.holds.some((h) => h.startsWith("VERDICT_STALE_HELD"))).toBe(true);
  });
});

// ─── P1 — artifact lineage stages ───────────────────────────────────────────

describe("artifact lineage — distinct stages validated", () => {
  test("lineage stage with a path leak in the installed stage ref is rejected", () => {
    const s = clone(workstationSnapshot);
    s.organs.operating[0].artifact_lineage = makeArtifactLineage("x");
    s.organs.operating[0].artifact_lineage!.installed.stage_ref = `${SYNTHETIC_HOME}/private`;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ARTIFACT_STAGE_INSTALLED_STAGE_REF_REF_LEAK");
  });

  test("each lineage stage tuple mismatch holds on its own against pinned stages", () => {
    const base = clone(workstationSnapshot);
    const organ = base.organs.operating[0];
    organ.independent_verdict = "passed";
    organ.verification = "verified";
    organ.freshness = "fresh";
    organ.verdict_attestation = makeAttestation("stage-join");
    organ.artifact_lineage = makeArtifactLineage("stage-join");
    const anchor = makeExpectedVerdictAnchor("genesis", "stage-join", {
      stages: makeExpectedStages("stage-join"),
    });
    const exp = makeExpectedContext({ expected_verdicts: [anchor] });
    // Baseline: no stage hold.
    const baseR = assessMigrationCompatibility(base, exp);
    expect(baseR.holds.some((h) => h.startsWith("STAGE_"))).toBe(false);
    // Independently change each stage's source digest -> its own mismatch hold.
    for (const name of ["source", "released", "installed", "consumed"] as const) {
      const s = clone(base);
      s.organs.operating[0].artifact_lineage![name].source_digest = fakeDigest(`mutated-${name}`);
      const r = assessMigrationCompatibility(s, exp);
      expect(r.status).toBe("held");
      expect(r.holds).toContain(`STAGE_${name.toUpperCase()}_MISMATCH:genesis`);
    }
  });
});

// ─── P1 — Adytum parity ─────────────────────────────────────────────────────

describe("P1: Adytum parity — real 9-vs-8 topic sets", () => {
  test("verified adytum without parity evidence is rejected structurally", () => {
    const s = clone(workstationSnapshot);
    const adytum = s.organs.cognitive.find((o) => o.organ_id === "adytum")!;
    delete adytum.adytum_parity;
    adytum.verification = "verified";
    adytum.admission = "admitted";
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ADYTUM_VERIFIED_WITHOUT_PARITY");
  });

  test("owner topic set with wrong count (8 not 9) is rejected", () => {
    const s = clone(workstationSnapshot);
    const adytum = s.organs.cognitive.find((o) => o.organ_id === "adytum")!;
    adytum.adytum_parity!.owner_topics = adytum.adytum_parity!.owner_topics.slice(0, 8);
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ADYTUM_PARITY_OWNER_TOPIC_COUNT");
  });

  test("consumer topic set with wrong count (9 not 8) is rejected", () => {
    const s = clone(workstationSnapshot);
    const adytum = s.organs.cognitive.find((o) => o.organ_id === "adytum")!;
    const parity = adytum.adytum_parity!;
    parity.consumer_topics = parity.owner_topics.map((t) => ({ ...t }));
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ADYTUM_PARITY_CONSUMER_TOPIC_COUNT");
  });

  test("default Adytum (consumer supports 8/9) is SOURCE-PARITY-HELD when Adytum is selected", () => {
    // Selecting Adytum pins its source-parity relationship as a required hold.
    const r = assessMigrationCompatibility(
      adytumParityHoldSnapshot,
      makeExpectedContext({ required_organ_ids: ["adytum"] }),
    );
    expect(r.status).toBe("held");
    expect(r.holds).toContain("ADYTUM_SOURCE_PARITY_HELD");
  });

  test("default Adytum source-parity is an observation (non-blocking) when unselected", () => {
    const r = assessMigrationCompatibility(adytumParityHoldSnapshot, makeExpectedContext());
    expect(r.observations).toContain("ADYTUM_SOURCE_PARITY_HELD");
    expect(r.holds).not.toContain("ADYTUM_SOURCE_PARITY_HELD");
  });

  test("changing an existing owner version adds an Adytum mismatch (selected = held)", () => {
    const s = clone(adytumParityHoldSnapshot);
    const parity = s.organs.cognitive.find((o) => o.organ_id === "adytum")!.adytum_parity!;
    parity.owner_contract_version = "99.0.0";
    const r = assessMigrationCompatibility(s, makeExpectedContext({ required_organ_ids: ["adytum"] }));
    expect(r.status).toBe("held");
    expect(r.holds).toContain("ADYTUM_CONTEXT_MISMATCH");
  });

  test("changing an existing topic VERSION adds an Adytum consumer-topic mismatch", () => {
    const s = clone(adytumParityHoldSnapshot);
    const parity = s.organs.cognitive.find((o) => o.organ_id === "adytum")!.adytum_parity!;
    // Alter the version of an existing (still-present-by-ref) consumer topic.
    parity.consumer_topics[0].version = "99.0.0";
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    const r = assessMigrationCompatibility(s, makeExpectedContext({ required_organ_ids: ["adytum"] }));
    expect(r.status).toBe("held");
    expect(r.holds).toContain("ADYTUM_CONSUMER_TOPIC_MISMATCH");
  });

  test("changing an existing topic DIGEST adds an Adytum consumer-topic mismatch", () => {
    const s = clone(adytumParityHoldSnapshot);
    const parity = s.organs.cognitive.find((o) => o.organ_id === "adytum")!.adytum_parity!;
    parity.consumer_topics[0].digest = fakeDigest("other");
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    const r = assessMigrationCompatibility(s, makeExpectedContext({ required_organ_ids: ["adytum"] }));
    expect(r.status).toBe("held");
    expect(r.holds).toContain("ADYTUM_CONSUMER_TOPIC_MISMATCH");
  });

  test("an arbitrary consumer-topic substitution (still 8) holds against pinned context", () => {
    const s = clone(adytumParityHoldSnapshot);
    const parity = s.organs.cognitive.find((o) => o.organ_id === "adytum")!.adytum_parity!;
    // Swap one of the 8 supported topics for an unrelated topic (count stays 8).
    parity.consumer_topics[0] = {
      topic_ref: "cambium:unrelated-topic",
      version: "1.0.0",
      digest: fakeDigest("unrelated-topic"),
    };
    // Structurally valid (count rules still satisfied).
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    const r = assessMigrationCompatibility(s, makeExpectedContext({ required_organ_ids: ["adytum"] }));
    expect(r.status).toBe("held");
    expect(r.holds).toContain("ADYTUM_CONSUMER_TOPIC_MISMATCH");
  });
});

// ─── P2 — four disabled capability-hit modes ────────────────────────────────

describe("P2: capability-hit modes — complete disabled four-set required", () => {
  test("valid four-mode declaration validates", () => {
    const s = clone(workstationSnapshot);
    s.capability_hit_modes = makeCapabilityHitModesDeclaration();
    expect(validateMigrationSnapshot(s).ok).toBe(true);
  });

  test("empty mode set is rejected", () => {
    const s = clone(workstationSnapshot);
    const d = makeCapabilityHitModesDeclaration();
    d.modes = [];
    s.capability_hit_modes = d;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("CAPABILITY_HIT_INCOMPLETE_MODE_SET");
  });

  test("partial mode set (one mode) is rejected", () => {
    const s = clone(workstationSnapshot);
    const d = makeCapabilityHitModesDeclaration();
    d.modes = d.modes.slice(0, 1);
    s.capability_hit_modes = d;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("CAPABILITY_HIT_INCOMPLETE_MODE_SET");
  });

  test("duplicate mode (three unique + one dup) is rejected", () => {
    const s = clone(workstationSnapshot);
    const d = makeCapabilityHitModesDeclaration();
    d.modes[3] = { ...d.modes[0] };
    s.capability_hit_modes = d;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("CAPABILITY_HIT_DUPLICATE_MODE");
  });

  test("per-mode source_digest disagreeing with catalog digest is rejected", () => {
    const s = clone(workstationSnapshot);
    const d = makeCapabilityHitModesDeclaration();
    d.modes[0].source_digest = fakeDigest("other-source");
    s.capability_hit_modes = d;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("CAPABILITY_HIT_MODE_DIGEST_MISMATCH");
  });

  test("an enabled mode (disabled=false) is rejected", () => {
    const s = clone(workstationSnapshot);
    const d = makeCapabilityHitModesDeclaration();
    (d.modes[0] as unknown as { disabled: boolean }).disabled = false;
    s.capability_hit_modes = d;
    expect(validateMigrationSnapshot(s).ok).toBe(false);
  });

  test("integrated Mac fixture exercises the four disabled modes", () => {
    expect(integratedMacSnapshot.capability_hit_modes?.modes.length).toBe(4);
    expect(validateMigrationSnapshot(integratedMacSnapshot).ok).toBe(true);
  });

  test("capability-hit catalog digest mismatch against pinned context is held when required", () => {
    const r = assessMigrationCompatibility(integratedMacSnapshot, makeExpectedContext({
      expected_capability_hit_source_digest: fakeDigest("other-catalog"),
      require_capability_hit: true,
    }));
    expect(r.structurally_valid).toBe(true);
    expect(r.status).toBe("held");
    expect(r.holds).toContain("CAPABILITY_HIT_DIGEST_MISMATCH");
    expect(r.execution_authorized).toBe(false);
  });

  test("capability-hit digest mismatch is observational (non-blocking) when not required", () => {
    const r = assessMigrationCompatibility(integratedMacSnapshot, makeExpectedContext({
      expected_capability_hit_source_digest: fakeDigest("other-catalog"),
    }));
    expect(r.observations).toContain("CAPABILITY_HIT_DIGEST_MISMATCH");
    expect(r.holds).not.toContain("CAPABILITY_HIT_DIGEST_MISMATCH");
  });
});

// ─── Target validation (P2a) ────────────────────────────────────────────────

describe("validateMigrationTarget", () => {
  test("valid workstation/always-on-node targets pass", () => {
    expect(validateMigrationTarget(workstationTarget)).toBe(true);
    expect(validateMigrationTarget(alwaysOnNodeTarget)).toBe(true);
  });

  test("unsupported major 99 is rejected", () => {
    expect(validateMigrationTarget({ ...workstationTarget, version: { major: 99, minor: 0 } })).toBe(false);
  });

  test("negative minor is rejected", () => {
    expect(validateMigrationTarget({ ...workstationTarget, version: { major: 1, minor: -1 } })).toBe(false);
  });

  test("forward minor is accepted", () => {
    expect(validateMigrationTarget({ ...workstationTarget, version: { major: 1, minor: 5 } })).toBe(true);
  });

  test("unknown target field is rejected", () => {
    expect(validateMigrationTarget({ ...workstationTarget, extra: "x" })).toBe(false);
  });
});

// ─── External product refs & device identity ────────────────────────────────

describe("external product refs grant no authority", () => {
  test("external ref with grants_no_install_authority=true validates", () => {
    const s = clone(workstationSnapshot);
    s.external_product_refs = [
      { product: "snow-gloves", owner: "snowlife", grants_no_install_authority: true },
    ];
    expect(validateMigrationSnapshot(s).ok).toBe(true);
  });

  test("external ref lacking the no-authority flag is rejected", () => {
    const s = clone(workstationSnapshot);
    s.external_product_refs = [
      { product: "snow-gloves", owner: "snowlife", grants_no_install_authority: false as unknown as true },
    ];
    expect(validateMigrationSnapshot(s).ok).toBe(false);
  });

  test("external ref owner carrying a private path is rejected", () => {
    const s = clone(workstationSnapshot);
    s.external_product_refs = [
      { product: "snow-gloves", owner: `${SYNTHETIC_HOME}/private`, grants_no_install_authority: true },
    ];
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("EXTERNAL_PRODUCT_OWNER_REF_LEAK");
  });
});

// ─── makeMigrationFinding ────────────────────────────────────────────────────

describe("makeMigrationFinding", () => {
  test("builds a finding with and without remediation", () => {
    const f1: MigrationFindingV1 = makeMigrationFinding({
      code: "HELD", severity: "warning", subject: "adytum", message: "parity held",
    });
    expect(f1.remediation).toBeUndefined();
    const f2 = makeMigrationFinding({
      code: "HELD", severity: "warning", subject: "adytum", message: "parity held", remediation: "reconcile topics",
    });
    expect(f2.remediation).toBe("reconcile topics");
  });
});

// ─── computeWorkBindingDigest determinism ────────────────────────────────────

describe("computeWorkBindingDigest", () => {
  test("is deterministic and axis-sensitive", () => {
    const base = SAMPLE_WORK_OBJECTS[0];
    const d1 = computeWorkBindingDigest(base);
    const d2 = computeWorkBindingDigest({ ...base });
    expect(d1).toBe(d2);
    const d3 = computeWorkBindingDigest({ ...base, owner: "changed" });
    expect(d3).not.toBe(d1);
  });
});

// ─── held evidence remains valid snapshots ──────────────────────────────────

describe("held evidence — disabled capabilities are valid held observations", () => {
  test("all held-state fixtures validate structurally", () => {
    for (const s of [
      disabledCapabilityHit_noRouter,
      disabledCapabilityHit_noAdmission,
      disabledCapabilityHit_noAuth,
      disabledCapabilityHit_noRuntime,
    ]) {
      expect(validateMigrationSnapshot(s).ok).toBe(true);
    }
  });
});

// ─── Restored structural negatives (coverage regression from r2) ────────────

describe("restored structural negatives", () => {
  test("missing module_lock_digest is rejected", () => {
    const s = clone(workstationSnapshot);
    delete (s as { module_lock_digest?: unknown }).module_lock_digest;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_MODULE_LOCK_DIGEST");
  });

  test("malformed module_lock_digest is rejected", () => {
    const s = clone(workstationSnapshot);
    (s as { module_lock_digest: string }).module_lock_digest = "not-a-digest";
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_MODULE_LOCK_DIGEST");
  });

  test("canonical knowledge ref carrying derived_from is rejected", () => {
    const s = clone(workstationSnapshot);
    (s.knowledge_refs[0] as { derived_from?: string }).derived_from = "knowledge:other";
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("UNKNOWN_KEY:knowledge_ref:derived_from");
  });

  test("derived knowledge ref missing derived_from is rejected", () => {
    const s = clone(workstationSnapshot);
    delete (s.knowledge_refs[1] as { derived_from?: string }).derived_from;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("DERIVED_MISSING_DERIVED_FROM");
  });

  test("knowledge ref with an unknown kind is rejected", () => {
    const s = clone(workstationSnapshot);
    (s.knowledge_refs[0] as { kind: string }).kind = "speculative";
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
  });

  test("knowledge ref_id carrying a private path is rejected", () => {
    const s = clone(workstationSnapshot);
    s.knowledge_refs[0].ref_id = `${SYNTHETIC_HOME}/private`;
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("KNOWLEDGE_REF_ID_LEAK");
  });
});

// ─── Positive bounded portable-reference grammar (reviewer P1-A probes) ─────

describe("portable reference grammar — reviewer P1-A probes", () => {
  test("logical_module_ref shaped as an account email is rejected", () => {
    const s = clone(workstationSnapshot);
    s.logical_module_refs = ["synthetic@example.invalid"];
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_MODULE_REF_VALUE");
  });

  test("logical_module_ref carrying a serialized body is rejected", () => {
    const s = clone(workstationSnapshot);
    s.logical_module_refs = ['{"credential":"synthetic"}'];
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_MODULE_REF_VALUE");
  });

  test("logical_module_ref carrying a control character is rejected", () => {
    const s = clone(workstationSnapshot);
    s.logical_module_refs = ["synthetic\ncredential=fixture"];
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_MODULE_REF_VALUE");
  });

  test("oversized logical_module_ref is rejected", () => {
    const s = clone(workstationSnapshot);
    s.logical_module_refs = ["a".repeat(300)];
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_MODULE_REF_VALUE");
  });

  test("WorkObject task_id carrying a private path is rejected (even after rehash)", () => {
    const s = clone(workstationSnapshot);
    s.work_objects[0].task_id = `${SYNTHETIC_HOME}/private`;
    s.work_objects[0].binding_digest = computeWorkBindingDigest(s.work_objects[0]);
    const r = validateMigrationSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("WORK_TASK_ID_REF_LEAK");
  });

  test("a well-formed colon/dot portable ref is accepted", () => {
    const s = clone(workstationSnapshot);
    s.logical_module_refs = [
      "provider.9router",
      "cambium:work-contract:modular-mac",
      "thoughtseed-labs:growth-whitepaper:telegram-capability-hit-system.v1",
    ];
    expect(validateMigrationSnapshot(s).ok).toBe(true);
  });
});

// ─── Independent edge join (reviewer P1-B probes) ───────────────────────────

describe("independent source/work/consumer edge join — reviewer P1-B probes", () => {
  function passedGenesis() {
    const s = clone(workstationSnapshot);
    const organ = s.organs.operating[0];
    organ.independent_verdict = "passed";
    organ.verification = "verified";
    organ.freshness = "fresh";
    organ.verdict_attestation = makeAttestation("proof");
    organ.artifact_lineage = makeArtifactLineage("proof");
    const exp = makeExpectedContext({
      expected_verdicts: [makeExpectedVerdictAnchor("genesis", "proof")],
    });
    return { s, exp };
  }

  test("baseline passed-genesis edge reconciles with no VERDICT_/EDGE_ hold", () => {
    const { s, exp } = passedGenesis();
    const r = assessMigrationCompatibility(s, exp);
    expect(r.holds.some((h) => h.startsWith("VERDICT_") || h.startsWith("EDGE_"))).toBe(false);
  });

  const edgeCases: Array<[string, (s: MigrationSnapshotV1) => void, string]> = [
    ["artifact_ref", (s) => { s.organs.operating[0].artifact_ref = "other:artifact"; }, "EDGE_ARTIFACT_REF_MISMATCH:genesis"],
    ["consumer", (s) => { s.organs.operating[0].consumer = "other-consumer"; }, "EDGE_CONSUMER_MISMATCH:genesis"],
    ["contract", (s) => { s.organs.operating[0].contract = "other:contract"; }, "EDGE_CONTRACT_MISMATCH:genesis"],
    ["source_digest", (s) => { s.organs.operating[0].source_digest = fakeDigest("different-source"); }, "EDGE_SOURCE_DIGEST_MISMATCH:genesis"],
    ["scope", (s) => { s.organs.operating[0].scope = "other-tenant"; }, "EDGE_SCOPE_MISMATCH:genesis"],
  ];
  for (const [name, mutate, expectedHold] of edgeCases) {
    test(`independently changing organ ${name} adds its own edge hold`, () => {
      const { s, exp } = passedGenesis();
      mutate(s);
      const r = assessMigrationCompatibility(s, exp);
      expect(r.status).toBe("held");
      expect(r.holds).toContain(expectedHold);
    });
  }
});

// ─── Required evidence completeness (reviewer P1-C probes) ──────────────────

describe("required evidence completeness — reviewer P1-C probes", () => {
  test("removing the required WorkObject holds (missing evidence cannot disappear)", () => {
    const s = clone(workstationSnapshot);
    s.work_objects = [];
    const r = assessMigrationCompatibility(
      s,
      makeExpectedContext({ required_work_ids: ["work:modular-mac-phase-a"] }),
    );
    expect(r.status).toBe("held");
    expect(r.holds).toContain("REQUIRED_WORK_MISSING:work:modular-mac-phase-a");
  });

  test("downgrading a required verdict to unknown holds", () => {
    const s = clone(workstationSnapshot);
    const organ = s.organs.operating[0];
    organ.independent_verdict = "passed";
    organ.verification = "verified";
    organ.freshness = "fresh";
    organ.verdict_attestation = makeAttestation("proof");
    organ.artifact_lineage = makeArtifactLineage("proof");
    const exp = makeExpectedContext({
      expected_verdicts: [makeExpectedVerdictAnchor("genesis", "proof")],
    });
    // Downgrade to unknown (drops the attestation to stay structurally valid).
    s.organs.operating[0].independent_verdict = "unknown";
    delete s.organs.operating[0].verdict_attestation;
    delete s.organs.operating[0].artifact_lineage;
    const r = assessMigrationCompatibility(s, exp);
    expect(r.status).toBe("held");
    expect(r.holds).toContain("VERDICT_ANCHOR_DOWNGRADED:genesis");
  });

  test("duplicate expected work IDs make the context nonauthoritative", () => {
    const s = clone(workstationSnapshot);
    const binding = makeExpectedWorkBinding();
    const r = assessMigrationCompatibility(
      s,
      makeExpectedContext({ expected_work: [binding, { ...binding }] }),
    );
    expect(r.status).toBe("nonauthoritative");
    expect(r.holds[0]).toContain("EXPECTED_WORK_DUPLICATE_ID");
  });

  test("duplicate required work IDs make the context nonauthoritative", () => {
    const s = clone(workstationSnapshot);
    const r = assessMigrationCompatibility(
      s,
      makeExpectedContext({ required_work_ids: ["work:dup", "work:dup"] }),
    );
    expect(r.status).toBe("nonauthoritative");
    expect(r.holds[0]).toContain("EXPECTED_CONTEXT_REQUIRED_WORK_DUPLICATE");
  });
});

// ─── Successful fresh evidence required (reviewer P1-D probes) ──────────────

describe("successful fresh evidence required — reviewer P1-D probes", () => {
  function selectedGenesis(overrides: (s: MigrationSnapshotV1) => void) {
    const s = clone(workstationSnapshot);
    const organ = s.organs.operating[0];
    organ.independent_verdict = "passed";
    organ.verification = "verified";
    organ.freshness = "fresh";
    organ.verdict_attestation = makeAttestation("proof");
    organ.artifact_lineage = makeArtifactLineage("proof");
    overrides(s);
    const exp = makeExpectedContext({
      required_organ_ids: ["genesis"],
      expected_verdicts: [makeExpectedVerdictAnchor("genesis", "proof", { require_fresh_pass: true })],
    });
    return { s, exp };
  }

  test("a failed verdict yields a distinct VERDICT_FAILED_HELD", () => {
    const { s, exp } = selectedGenesis((s) => {
      s.organs.operating[0].independent_verdict = "failed";
    });
    const r = assessMigrationCompatibility(s, exp);
    expect(r.status).toBe("held");
    expect(r.holds).toContain("VERDICT_FAILED_HELD:genesis");
  });

  test("an explicitly expired attestation freshness yields a distinct hold", () => {
    const { s, exp } = selectedGenesis((s) => {
      s.organs.operating[0].verdict_attestation!.freshness = "expired";
    });
    const r = assessMigrationCompatibility(s, exp);
    expect(r.status).toBe("held");
    expect(r.holds).toContain("VERDICT_FRESHNESS_EXPIRED:genesis");
  });

  test("a future attestation yields a distinct future hold", () => {
    const s = clone(workstationSnapshot);
    const organ = s.organs.operating[0];
    organ.independent_verdict = "passed";
    organ.verification = "verified";
    organ.freshness = "fresh";
    const att = makeAttestation("future");
    att.attested_at = "2026-10-01T00:00:01Z";
    att.freshness = "stale"; // avoid future-fresh structural reject
    organ.verdict_attestation = att;
    organ.artifact_lineage = makeArtifactLineage("future");
    const r = assessMigrationCompatibility(
      s,
      makeExpectedContext({
        expected_verdicts: [makeExpectedVerdictAnchor("genesis", "future")],
        now: "2026-09-01T00:00:00Z",
      }),
    );
    expect(r.status).toBe("held");
    expect(r.holds).toContain("VERDICT_FUTURE_ATTESTATION:genesis");
  });

  test("every assessment returns execution_authorized:false (including compatible)", () => {
    const s = clone(workstationSnapshot);
    const organ = s.organs.operating[0];
    organ.independent_verdict = "passed";
    organ.verification = "verified";
    organ.freshness = "fresh";
    organ.verdict_attestation = makeAttestation("ok");
    organ.artifact_lineage = makeArtifactLineage("ok");
    const compatible = assessMigrationCompatibility(
      s,
      makeExpectedContext({
        required_work_ids: ["work:modular-mac-phase-a"],
        required_organ_ids: ["genesis"],
        expected_verdicts: [makeExpectedVerdictAnchor("genesis", "ok")],
      }),
    );
    expect(compatible.status).toBe("compatible");
    expect(compatible.execution_authorized).toBe(false);

    const held = assessMigrationCompatibility(s, makeExpectedContext());
    expect(held.execution_authorized).toBe(false);

    const nonauth = assessMigrationCompatibility(s, undefined);
    expect(nonauth.execution_authorized).toBe(false);
  });
});

// ─── Closed expected-context validation (reviewer P2 probes) ────────────────

describe("closed expected-context validation — reviewer P2 probes", () => {
  test("expected_work:[null] is nonauthoritative without throwing", () => {
    const s = clone(workstationSnapshot);
    const r = assessMigrationCompatibility(
      s,
      makeExpectedContext({ expected_work: [null as unknown as ReturnType<typeof makeExpectedWorkBinding>] }),
    );
    expect(r.status).toBe("nonauthoritative");
    expect(r.holds[0]).toContain("EXPECTED_WORK_ENTRY_INVALID");
  });

  test("expected_verdicts:[null] is nonauthoritative without throwing", () => {
    const s = clone(workstationSnapshot);
    const r = assessMigrationCompatibility(
      s,
      makeExpectedContext({ expected_verdicts: [null as unknown as ReturnType<typeof makeExpectedVerdictAnchor>] }),
    );
    expect(r.status).toBe("nonauthoritative");
    expect(r.holds[0]).toContain("EXPECTED_VERDICT_ANCHOR_INVALID");
  });

  test("NaN max_age_days is nonauthoritative (no silent stale bypass)", () => {
    const s = clone(workstationSnapshot);
    const organ = s.organs.operating[0];
    organ.independent_verdict = "passed";
    organ.verification = "verified";
    organ.freshness = "fresh";
    organ.verdict_attestation = makeAttestation("old");
    organ.verdict_attestation.attested_at = "1980-01-01T00:00:00Z";
    organ.verdict_attestation.freshness = "stale";
    organ.artifact_lineage = makeArtifactLineage("old");
    const r = assessMigrationCompatibility(
      s,
      makeExpectedContext({
        expected_verdicts: [makeExpectedVerdictAnchor("genesis", "old", { max_age_days: NaN })],
      }),
    );
    expect(r.status).toBe("nonauthoritative");
    expect(r.holds[0]).toContain("EXPECTED_VERDICT_MAX_AGE_INVALID");
  });

  test("an unknown root key in expected context is refused", () => {
    const s = clone(workstationSnapshot);
    const exp = makeExpectedContext() as unknown as Record<string, unknown>;
    exp.credential = "synthetic";
    const r = assessMigrationCompatibility(s, exp as unknown as ReturnType<typeof makeExpectedContext>);
    expect(r.status).toBe("nonauthoritative");
    expect(r.holds[0]).toContain("INVALID_EXPECTED_CONTEXT");
  });

  test("a malformed now is nonauthoritative without throwing", () => {
    const s = clone(workstationSnapshot);
    const r = assessMigrationCompatibility(s, makeExpectedContext({ now: "not-a-time" }));
    expect(r.status).toBe("nonauthoritative");
    expect(r.holds[0]).toContain("EXPECTED_CONTEXT_INVALID_NOW");
  });
});

// ─── Topic-tuple binding (reviewer P1-E probes) ─────────────────────────────

describe("Adytum topic-tuple binding — reviewer P1-E probes", () => {
  test("source-parity hold reflects actual Hermes-9 / Cambium-8 observation", () => {
    const r = assessMigrationCompatibility(
      adytumParityHoldSnapshot,
      makeExpectedContext({ required_organ_ids: ["adytum"] }),
    );
    expect(r.holds).toContain("ADYTUM_SOURCE_PARITY_HELD");
  });

  test("equal counts but wrong topic (version) cannot clear the hold", () => {
    const s = clone(adytumParityHoldSnapshot);
    const parity = s.organs.cognitive.find((o) => o.organ_id === "adytum")!.adytum_parity!;
    parity.consumer_topics[0].version = "2.0.0";
    const r = assessMigrationCompatibility(s, makeExpectedContext({ required_organ_ids: ["adytum"] }));
    expect(r.status).toBe("held");
    expect(r.holds).toContain("ADYTUM_CONSUMER_TOPIC_MISMATCH");
  });

  test("the synthetic 9/8 refs are documented as synthetic, not live reconciliation", () => {
    const parity = makeAdytumParity();
    expect(parity.owner_topics[0].topic_ref.startsWith("hermes-owner:")).toBe(true);
    expect(parity.owner_topics.length).toBe(ADYTUM_OWNER_TOPIC_COUNT);
    expect(parity.consumer_topics.length).toBe(ADYTUM_CONSUMER_TOPIC_COUNT);
  });
});

// R4: fresh independent expectations precede every mutation.
describe("R4 retained-patch regressions", () => {
  function positive() {
    const s = clone(workstationSnapshot);
    Object.assign(s.organs.operating[0], { independent_verdict: "passed", verification: "verified", freshness: "fresh",
      verdict_attestation: makeAttestation("proof"), artifact_lineage: makeArtifactLineage("proof") });
    const e = makeExpectedContext({ required_work_ids: [s.work_objects[0].work_id], required_organ_ids: ["genesis"],
      expected_verdicts: [makeExpectedVerdictAnchor("genesis", "proof", { stages: makeExpectedStages("proof") })] });
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    expect(assessMigrationCompatibility(s, e)).toMatchObject({ status: "compatible", holds: [], execution_authorized: false });
    return { s, e };
  }
  for (const stage of ["source", "released", "installed", "consumed"] as const) {
    for (const freshness of ["unknown", "stale", "expired"] as const) {
      test(`${stage} ${freshness} cannot borrow a fresh verdict`, () => {
        const { s, e } = positive(); s.organs.operating[0].artifact_lineage![stage].freshness = freshness;
        expect(assessMigrationCompatibility(s, e).holds).toContain(`STAGE_${stage.toUpperCase()}_FRESHNESS_${freshness.toUpperCase()}:genesis`);
      });
    }
    for (const [time, reason] of [["1980-01-01T00:00:00Z", "STALE"], ["2099-01-01T00:00:00Z", "FUTURE"]]) {
      test(`${stage} ${reason} time cannot borrow a fresh verdict`, () => {
        const { s, e } = positive(); s.organs.operating[0].artifact_lineage![stage].observed_at = time;
        expect(assessMigrationCompatibility(s, e).holds).toContain(`STAGE_${stage.toUpperCase()}_${reason}:genesis`);
      });
    }
  }
  for (const field of ["owner", "version", "plant", "trigger"] as const) {
    test(`selected organ ${field} is independently anchored`, () => {
      const { s, e } = positive(); Object.assign(s.organs.operating[0], { [field]: field === "trigger" ? "scheduled" : "other" });
      expect(assessMigrationCompatibility(s, e).holds).toContain(`EDGE_${field.toUpperCase()}_MISMATCH:genesis`);
    });
  }
  for (const field of ["verification", "freshness"] as const) {
    for (const state of field === "verification" ? ["unknown", "failed", "unverified"] : ["unknown", "stale", "expired"]) {
      test(`selected ${field} ${state} stays independent of passed verdict`, () => {
        const { s, e } = positive(); Object.assign(s.organs.operating[0], { [field]: state });
        expect(assessMigrationCompatibility(s, e).holds).toContain(`ORGAN_${field.toUpperCase()}_${state.toUpperCase()}:genesis`);
      });
    }
  }
  test("linked work is checked when selection names a second valid work", () => {
    const { s, e } = positive();
    const other = makeWorkObject({ ...s.work_objects[0], work_id: "work:other", task_id: "task:other" });
    s.work_objects.push(other); const { binding_digest, ...anchor } = other; e.expected_work.push(anchor);
    e.required_work_ids = [other.work_id]; s.work_objects[0].task_id = "task:substituted";
    s.work_objects[0].binding_digest = computeWorkBindingDigest(s.work_objects[0]);
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    expect(assessMigrationCompatibility(s, e).holds).toContain(`WORK_ANCHOR_MISMATCH:${s.work_objects[0].work_id}`);
  });
  test("empty selections with no observations cannot use unused expectations", () => {
    const { s, e } = positive(); s.work_objects = [];
    s.organs.operating[0].independent_verdict = "unknown";
    delete s.organs.operating[0].verdict_attestation; delete s.organs.operating[0].artifact_lineage;
    e.expected_verdicts = []; e.required_work_ids = []; e.required_organ_ids = [];
    expect(assessMigrationCompatibility(s, e).holds).toContain("EMPTY_REQUIREMENT_SELECTION");
  });
  test("selected lineage cannot silently omit stage anchors", () => {
    const { s, e } = positive(); delete e.expected_verdicts![0].stages;
    expect(assessMigrationCompatibility(s, e).holds).toContain("STAGE_ANCHORS_MISSING:genesis");
  });
  for (const target of ["work", "verdict", "stage", "stages", "adytum", "topic"] as const) {
    test(`expected ${target} is closed`, () => {
      const { s, e } = positive();
      const objects = { work: e.expected_work[0], verdict: e.expected_verdicts![0], stage: e.expected_verdicts![0].stages!.source,
        stages: e.expected_verdicts![0].stages!, adytum: e.expected_adytum!, topic: e.expected_adytum!.owner_topics[0] };
      Object.assign(objects[target], { credential: "synthetic" });
      expect(assessMigrationCompatibility(s, e).status).toBe("nonauthoritative");
    });
  }
  test("expected context refuses inherited fields", () => {
    const { s, e } = positive(); Object.setPrototypeOf(e.expected_work[0], { credential: "synthetic" });
    expect(assessMigrationCompatibility(s, e).status).toBe("nonauthoritative");
  });
});

// Input dependencies name producer output; consumer output and verdict remain distinct.
describe("R4 bounded input dependency joins", () => {
  function positive(profile: "workstation" | "always-on-node" = "workstation") {
    const s = makeInputChainSnapshot(profile), e = makeInputChainExpectedContext();
    expect(validateMigrationSnapshot(s)).toEqual({ ok: true });
    expect(assessMigrationCompatibility(s, e)).toMatchObject({ status: "compatible", holds: [], execution_authorized: false });
    expect(assessMigrationCompatibility(s, e).observations).toContain("ADYTUM_SOURCE_PARITY_HELD");
    return { s, e };
  }
  for (const profile of ["workstation", "always-on-node"] as const) {
    test(`${profile} closes five operating organs without selecting Adytum or Snow Gloves`, () => { positive(profile); });
  }
  for (const field of ["producer_organ_id", "consumer_organ_id", "artifact_ref", "artifact_digest", "source_digest", "work_id", "task_id", "scope"] as const) {
    test(`changed input ${field} holds against the original independent edge`, () => {
      const { s, e } = positive();
      Object.assign(s.organs.operating[4].input_dependencies[0], { [field]: field.endsWith("digest") ? fakeDigest("substitute") : field.endsWith("organ_id") ? "taste" : "other:ref" });
      expect(validateMigrationSnapshot(s).ok).toBe(true);
      expect(assessMigrationCompatibility(s, e).holds).toContain("INPUT_ANCHOR_MISMATCH:cortex:input:will:cortex");
    });
  }
  test("missing observed input is held", () => {
    const { s, e } = positive(); s.organs.operating[4].input_dependencies = [];
    expect(assessMigrationCompatibility(s, e).holds).toContain("INPUT_MISSING:cortex:input:will:cortex");
  });
  test("extra unanchored input is held", () => {
    const { s, e } = positive(); e.expected_verdicts![4].input_dependencies = [];
    expect(assessMigrationCompatibility(s, e).holds).toContain("INPUT_UNANCHORED:cortex:input:will:cortex");
  });
  test("producer owner cannot be replaced behind an unchanged input edge", () => {
    const { s, e } = positive(); s.organs.operating[3].owner = "other-owner";
    expect(assessMigrationCompatibility(s, e).holds).toContain("EDGE_OWNER_MISMATCH:will");
  });
  test("producer source cannot be replaced behind an unchanged input edge", () => {
    const { s, e } = positive(); s.organs.operating[3].source_digest = fakeDigest("substitute");
    expect(assessMigrationCompatibility(s, e).holds).toContain("INPUT_PRODUCER_MISMATCH:cortex:input:will:cortex");
  });
  test("producer without its own independent anchor is held", () => {
    const { s, e } = positive(); e.expected_verdicts = e.expected_verdicts!.filter(v => v.organ_id !== "will");
    expect(assessMigrationCompatibility(s, e).holds).toContain("INPUT_PRODUCER_UNANCHORED:cortex:input:will:cortex");
  });
  test("input cannot replace the consumer output attestation", () => {
    const { s, e } = positive(); s.organs.operating[4].verdict_attestation!.artifact_digest = fakeDigest("will-artifact");
    expect(assessMigrationCompatibility(s, e).holds).toContain("VERDICT_DIGEST_MISMATCH:cortex");
  });
  test("unknown producer verdict remains held despite consumer pass", () => {
    const { s, e } = positive(); s.organs.operating[3].independent_verdict = "unknown";
    delete s.organs.operating[3].verdict_attestation;
    expect(assessMigrationCompatibility(s, e).holds).toContain("VERDICT_UNKNOWN_REQUIRED:will");
  });
  test("input work tuple must match independent work scope even with matching edge copies", () => {
    const { s, e } = positive();
    s.organs.operating[4].input_dependencies[0].task_id = "task:other";
    e.expected_verdicts![4].input_dependencies[0].task_id = "task:other";
    expect(assessMigrationCompatibility(s, e).holds).toContain("INPUT_WORK_MISMATCH:cortex:input:will:cortex");
  });
  for (const where of ["observed", "expected"] as const) {
    test(`${where} input edge fields are closed`, () => {
      const { s, e } = positive();
      Object.assign(where === "observed" ? s.organs.operating[4].input_dependencies[0] : e.expected_verdicts![4].input_dependencies[0], { credential: "synthetic" });
      expect(assessMigrationCompatibility(s, e).status).toBe("nonauthoritative");
    });
  }
  test("input metadata rejects private paths", () => {
    const { s, e } = positive(); s.organs.operating[4].input_dependencies[0].artifact_ref = `${SYNTHETIC_HOME}/private`;
    expect(assessMigrationCompatibility(s, e).structurally_valid).toBe(false);
  });
  test("expected arrays cannot carry hidden extension fields", () => {
    const { s, e } = positive(); Object.assign(e.expected_work, { credential: "synthetic" });
    expect(assessMigrationCompatibility(s, e).status).toBe("nonauthoritative");
  });
  test("expected getters are refused without evaluation", () => {
    const { s, e } = positive(); let read = false;
    Object.defineProperty(e.expected_work[0], "scope", { enumerable: true, get() { read = true; throw new Error("getter evaluated"); } });
    expect(() => assessMigrationCompatibility(s, e)).not.toThrow();
    expect(read).toBe(false);
    expect(assessMigrationCompatibility(s, e).status).toBe("nonauthoritative");
  });
  test("depth and size limits hold before expected-field processing", () => {
    for (const payload of ["x".repeat(MAX_MIGRATION_SNAPSHOT_BYTES + 1), Array.from({ length: 16 }).reduce<unknown>(v => ({ next: v }), {})]) {
      const { s, e } = positive(); Object.assign(e.expected_work[0], { payload });
      expect(assessMigrationCompatibility(s, e).status).toBe("nonauthoritative");
    }
  });
  test("consumer endpoint is checked against the producer's independently pinned consumer", () => {
    const { s, e } = positive();
    s.organs.operating[3].consumer = "wrong-consumer"; e.expected_verdicts![3].consumer = "wrong-consumer";
    expect(assessMigrationCompatibility(s, e).holds).toContain("INPUT_CONSUMER_MISMATCH:cortex:input:will:cortex");
  });
});

describe("R4 scope and freshness boundaries", () => {
  test("unused expected Adytum anchor remains observational for a selected unrelated chain", () => {
    const s = makeInputChainSnapshot(), e = makeInputChainExpectedContext();
    e.expected_verdicts!.push(makeExpectedVerdictAnchor("adytum", "adytum"));
    const r = assessMigrationCompatibility(s, e);
    expect(r.status).toBe("compatible");
    expect(r.observations).toContain("ADYTUM_SOURCE_PARITY_HELD");
    expect(r.execution_authorized).toBe(false);
  });
  test("a required dependency on Adytum makes source parity blocking", () => {
    const s = makeInputChainSnapshot(), e = makeInputChainExpectedContext();
    const adytum = s.organs.cognitive.find(o => o.organ_id === "adytum")!;
    Object.assign(adytum, { verification: "verified", freshness: "fresh", independent_verdict: "passed", consumer: "genesis",
      verdict_attestation: makeAttestation("adytum"), artifact_lineage: makeArtifactLineage("adytum") });
    const edge = { input_id: "input:adytum:genesis", producer_organ_id: "adytum" as const, consumer_organ_id: "genesis" as const,
      artifact_ref: "cambium:artifact:adytum:2026-10-01", artifact_digest: fakeDigest("adytum-artifact"), source_digest: fakeDigest("adytum-src"),
      work_id: "work:modular-mac-phase-a", task_id: "task:install-surface-task1", scope: "install-surface" };
    s.organs.operating[0].input_dependencies = [edge]; e.expected_verdicts![0].input_dependencies = [clone(edge)];
    e.expected_verdicts!.push(makeExpectedVerdictAnchor("adytum", "adytum", { consumer: "genesis" }));
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    expect(assessMigrationCompatibility(s, e).holds).toContain("ADYTUM_SOURCE_PARITY_HELD");
  });
  test("stage future relative to snapshot stays held even when evaluation now is later", () => {
    const s = makeInputChainSnapshot(), e = makeInputChainExpectedContext();
    s.organs.operating[4].artifact_lineage!.installed.observed_at = "2026-10-01T00:00:03Z";
    e.now = "2026-10-01T00:00:05Z";
    expect(assessMigrationCompatibility(s, e).holds).toContain("STAGE_INSTALLED_FUTURE:cortex");
  });
  test("stage age is bounded against snapshot observation as well as evaluation time", () => {
    const s = makeInputChainSnapshot(), e = makeInputChainExpectedContext();
    s.observed_at = "2026-10-03T00:00:01Z";
    e.expected_verdicts![4].stages!.installed.max_age_days = 1;
    expect(assessMigrationCompatibility(s, e).holds).toContain("STAGE_INSTALLED_STALE:cortex");
  });
  test("each stage uses its own independently specified maximum age", () => {
    const s = makeInputChainSnapshot(), e = makeInputChainExpectedContext();
    e.expected_verdicts![4].stages!.source.max_age_days = 0;
    expect(assessMigrationCompatibility(s, e).holds).toContain("STAGE_SOURCE_STALE:cortex");
    expect(assessMigrationCompatibility(s, e).holds).not.toContain("STAGE_INSTALLED_STALE:cortex");
  });
  test("unbounded and missing stage age policy are nonauthoritative", () => {
    for (const age of [NaN, Infinity, -1, 3661, undefined]) {
      const s = makeInputChainSnapshot(), e = makeInputChainExpectedContext();
      Object.assign(e.expected_verdicts![4].stages!.source, { max_age_days: age });
      expect(assessMigrationCompatibility(s, e).status).toBe("nonauthoritative");
    }
  });
  test("plain human metadata remains readable while known private references are refused", () => {
    const s = makeInputChainSnapshot(); s.compatibility_observations!.note = "Synthetic hardware observation only";
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    for (const note of ["contact synthetic@example.invalid", `private ${SYNTHETIC_HOME}/state`, "endpoint localhost:8766"]) {
      s.compatibility_observations!.note = note; expect(validateMigrationSnapshot(s).ok).toBe(false);
    }
  });
});

describe("R5 relational closure regressions", () => {
  function positive(profile: "workstation" | "always-on-node") {
    const s = makeInputChainSnapshot(profile), e = makeInputChainExpectedContext();
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    expect(assessMigrationCompatibility(s, e)).toMatchObject({ status: "compatible", holds: [], execution_authorized: false });
    return { s, e };
  }
  for (const profile of ["workstation", "always-on-node"] as const) {
    test(`${profile}: matching consumed-stage copies cannot contradict the unchanged verdict artifact`, () => {
      const { s, e } = positive(profile);
      s.organs.operating[4].artifact_lineage!.consumed.artifact_digest = fakeDigest("unrelated");
      e.expected_verdicts![4].stages!.consumed.artifact_digest = fakeDigest("unrelated");
      expect(validateMigrationSnapshot(s).ok).toBe(true);
      expect(assessMigrationCompatibility(s, e).holds).toContain("CONSUMED_ARTIFACT_VERDICT_MISMATCH:cortex");
    });
    for (const stage of ["source", "released", "installed", "consumed"] as const) {
      for (const field of ["task_id", "scope", "plant"] as const) {
        test(`${profile}: matching ${stage} ${field} copies cannot contradict independent work`, () => {
          const { s, e } = positive(profile);
          s.organs.operating[4].artifact_lineage![stage][field] = "other:value";
          e.expected_verdicts![4].stages![stage][field] = "other:value";
          expect(validateMigrationSnapshot(s).ok).toBe(true);
          expect(assessMigrationCompatibility(s, e).holds).toContain(`STAGE_${stage.toUpperCase()}_WORK_MISMATCH:cortex`);
        });
      }
    }
    test(`${profile}: consumed work must be the independently anchored verdict work`, () => {
      const { s, e } = positive(profile);
      const other = { ...s.work_objects[0], work_id: "work:other" };
      other.binding_digest = computeWorkBindingDigest(other); s.work_objects.push(other);
      const { binding_digest, ...expectedOther } = other; e.expected_work.push(expectedOther);
      s.organs.operating[4].artifact_lineage!.consumed.work_id = other.work_id;
      e.expected_verdicts![4].stages!.consumed.work_id = other.work_id;
      expect(assessMigrationCompatibility(s, e).holds).toContain("CONSUMED_WORK_MISMATCH:cortex");
    });
    for (const order of ["prepend", "append"] as const) {
      test(`${profile}: ${order} duplicate work with rehashed substitution is structurally rejected`, () => {
        const { s, e } = positive(profile);
        const bad = { ...s.work_objects[0], task_id: "task:substituted", owner: "owner:other" };
        bad.binding_digest = computeWorkBindingDigest(bad);
        if (order === "prepend") s.work_objects.unshift(bad); else s.work_objects.push(bad);
        expect(validateMigrationSnapshot(s)).toEqual({ ok: false, reason: "DUPLICATE_WORK_ID" });
        expect(assessMigrationCompatibility(s, e).structurally_valid).toBe(false);
      });
    }
    test(`${profile}: verdict age must satisfy snapshot time even when evaluation time is earlier`, () => {
      const { s, e } = positive(profile); s.observed_at = "2026-10-03T00:00:01Z";
      e.expected_verdicts![4].max_age_days = 1;
      expect(assessMigrationCompatibility(s, e).holds).toContain("VERDICT_STALE_HELD:cortex");
    });
    test(`${profile}: source released and installed artifacts may legitimately differ from consumed`, () => {
      const { s, e } = positive(profile);
      for (const stage of ["source", "released", "installed"] as const) {
        s.organs.operating[4].artifact_lineage![stage].artifact_digest = fakeDigest(`cortex-${stage}-distinct`);
        e.expected_verdicts![4].stages![stage].artifact_digest = fakeDigest(`cortex-${stage}-distinct`);
        s.organs.operating[4].artifact_lineage![stage].owner_contract = `source-owner:${stage}`;
        e.expected_verdicts![4].stages![stage].owner_contract = `source-owner:${stage}`;
      }
      expect(assessMigrationCompatibility(s, e)).toMatchObject({ status: "compatible", holds: [], execution_authorized: false });
    });
    for (const payload of ['{"credential":"synthetic-secret","session_id":"synthetic-session","prompt":"synthetic-body"}', `${SYNTHETIC_HOME}/private-state`, "body\ncontrol", "x".repeat(513)]) {
      for (const field of ["data_classifications", "held_requirements"] as const) {
        test(`${profile}: ${field} rejects known private or unbounded string form ${payload.slice(0, 12)}`, () => {
          const { s, e } = positive(profile); s[field] = [payload];
          expect(validateMigrationSnapshot(s).ok).toBe(false);
          expect(assessMigrationCompatibility(s, e).status).toBe("nonauthoritative");
        });
      }
    }
  }
  for (const payload of ['{"credential":"synthetic-secret"}', `${SYNTHETIC_HOME}/private-state`, "body\ncontrol", "x".repeat(513)]) {
    test(`target requirement rejects known private or unbounded form ${payload.slice(0, 12)}`, () => {
      const target = clone(workstationTarget); target.held_requirements = [payload];
      expect(validateMigrationTarget(target)).toBe(false);
    });
  }
  test("ordinary readable requirements and portable classifications remain accepted", () => {
    const { s, e } = positive("workstation");
    s.data_classifications = ["public", "internal", "owner:restricted"];
    s.held_requirements = ["Await owner review before migration", "Physical restore evidence remains pending."];
    const target = clone(workstationTarget); target.held_requirements = [...s.held_requirements];
    expect(validateMigrationSnapshot(s).ok).toBe(true);
    expect(validateMigrationTarget(target)).toBe(true);
    expect(assessMigrationCompatibility(s, e).execution_authorized).toBe(false);
  });
});
