---
phase: 01
slug: provenance-contract-and-read-only-control-plane
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-20
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` on Bun 1.3.13 |
| **Config file** | none — package-local discovery; Wave 0 establishes `package/install-surface/` |
| **Quick run command** | `cd package/install-surface && bun test test/schema.test.ts test/semantics.test.ts` |
| **Full suite command** | `cd package/install-surface && bun test && cd ../.. && bash tests/temperance-doctor.sh` |
| **Canonical repository command** | `./scripts/verify-all.sh` |
| **Estimated runtime** | quick target under 30 seconds; full target under 120 seconds |

## Sampling Rate

- **After every task commit:** Run the narrowest touched `bun test` file set.
- **After every plan wave:** Run `cd package/install-surface && bun test && cd ../.. && bash tests/temperance-doctor.sh`.
- **Before `/gsd:verify-work`:** Run `./scripts/verify-all.sh`, retaining any known Phase 2 path-hygiene failure as explicit baseline evidence rather than suppressing it.
- **Max feedback latency:** 30 seconds for focused task tests; 120 seconds for wave tests.
- **No production-parity shortcut:** Phase 1 has no database behavior. If a later runtime adapter adds PostgreSQL-backed behavior, verify it against real PostgreSQL; in-memory fakes prove formatting and error mapping only.

## Per-Task Verification Map

Task IDs are provisional until the planner assigns final plan/task numbers. Every row must be bound to an executable plan task before plan verification passes.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD-PROV-01 | TBD | 0 | PROV-01 | T-01 | Unsupported versions and unknown fields fail before semantic or lifecycle work | unit | `cd package/install-surface && bun test test/schema.test.ts` | no — W0 | pending |
| TBD-PROV-02 | TBD | 0 | PROV-02 | T-02 | Each surface has exactly one stable ID, owner, and class | unit + golden | `cd package/install-surface && bun test test/semantics.test.ts -t stable` | no — W0 | pending |
| TBD-PROV-03 | TBD | 0 | PROV-03 | T-02 | Exact and ancestor/descendant ownership conflicts fail closed | unit + property | `cd package/install-surface && bun test test/semantics.test.ts -t ownership` | no — W0 | pending |
| TBD-PROV-04 | TBD | 0 | PROV-04 | T-03 | Sources remain relative and destinations use allowlisted root tokens | adversarial unit | `cd package/install-surface && bun test test/semantics.test.ts -t path` | no — W0 | pending |
| TBD-PROV-05 | TBD | 0 | PROV-05 | Escapes, cycles, contradictions, and unsafe adapters fail closed | adversarial unit | `cd package/install-surface && bun test test/semantics.test.ts -t semantic` | no — W0 | pending |
| TBD-PROV-07 | TBD | 0 | PROV-07 | Manifest records cannot self-ratify or exceed ISA/milestone authority | integration | `cd package/install-surface && bun test test/authority.test.ts` | no — W0 | pending |
| TBD-DOCT-01 | TBD | 0 | DOCT-01 | Human doctor output is ordered, drift-first, and read-only | CLI golden | `cd package/install-surface && bun test test/cli.test.ts -t human` | no — W0 | pending |
| TBD-DOCT-02 | TBD | 0 | DOCT-02 | JSON and human renderings share observations and expose no repair path | invariant | `cd package/install-surface && bun test test/doctor.test.ts -t read-only` | no — W0 | pending |
| TBD-DOCT-03 | TBD | 0 | DOCT-03 | Every public check record contains the complete common field contract | schema + golden | `cd package/install-surface && bun test test/doctor.test.ts -t record-contract` | no — W0 | pending |
| TBD-DOCT-04 | TBD | 0 | DOCT-04 | Drift returns `DRIFT` and exit 1 without changing fixture bytes or metadata | CLI integration | `cd package/install-surface && bun test test/cli.test.ts -t drift` | no — W0 | pending |
| TBD-DOCT-05 | TBD | 0 | DOCT-05 | Required, optional, unsupported, private, and unavailable states remain distinct | table-driven unit | `cd package/install-surface && bun test test/doctor.test.ts -t eligibility` | no — W0 | pending |
| TBD-SAFE-04 | TBD | 0 | SAFE-04 | Absolute, traversal, unknown-root, and symlink escape inputs fail closed | adversarial unit | `cd package/install-surface && bun test test/semantics.test.ts -t unsafe-paths` | no — W0 | pending |
| TBD-SAFE-07 | TBD | 0 | SAFE-07 | COPY, TRANSFORM, REGENERATE, and NEVER-SHIP use distinct verification rules | table-driven integration | `cd package/install-surface && bun test test/doctor.test.ts -t class-aware` | no — W0 | pending |

## Required Test Layers

1. Strict schema fixtures for valid v1, unknown fields, missing fields, unsupported versions, contradictory unions, and oversized inputs.
2. Semantic fixtures for duplicate IDs/owners, path overlaps, dependency cycles, unknown dependencies/tokens, unsafe adapter/class pairs, and authority mismatches.
3. Metamorphic determinism tests that shuffle fragments, records, dependencies, object construction, and completion order while requiring byte-identical output.
4. Golden-byte fixtures for the committed lockfile and versioned doctor JSON envelope.
5. A read-only invariant that snapshots directory entries, bytes, modes, links, and timestamps before and after doctor execution.
6. Privacy honeytokens across bindings, labels, provider names, notes, parser errors, and filesystem errors; every output channel must exclude them.
7. Timeout/crash isolation tests proving remaining sections complete and deterministic `UNAVAILABLE` observations produce exit 1.
8. A complete CLI matrix for default/filtered/verbose/human/JSON modes and exact 0/1/2 exits.
9. Compatibility tests proving legacy doctor wrappers reach the typed read-only path and mutating doctor flags are rejected with migration guidance.
10. Deny-policy tests proving safe repository-relative disclosure only when permitted and zero candidate mutation.

## Wave 0 Requirements

- [ ] `package/install-surface/package.json` plus exact-pinned Ajv dependency and lockfile update.
- [ ] `package/install-surface/test/fixtures/` with valid, adversarial, golden, registry, and report fixtures.
- [ ] `package/install-surface/test/schema.test.ts` for strict schema/version behavior.
- [ ] `package/install-surface/test/semantics.test.ts` for ownership, graph, path, class, and adapter behavior.
- [ ] `package/install-surface/test/authority.test.ts` for PROV-07 canonical-authority enforcement.
- [ ] `package/install-surface/test/determinism.test.ts` for exact-byte permutations.
- [ ] `package/install-surface/test/privacy.test.ts` for registry permissions and honeytoken non-disclosure.
- [ ] `package/install-surface/test/doctor.test.ts` for condition, timeout, aggregation, and read-only invariants.
- [ ] `package/install-surface/test/cli.test.ts` for human/JSON/exit compatibility.
- [ ] Extend `tests/temperance-doctor.sh` and `scripts/verify-all.sh` with the public entrypoint and lock-drift gate.

## Manual-Only Verifications

All Phase 1 requirement behavior is automatable. Human review remains required for intentional schema-major migrations, semantic-ID migrations, and ratification of newly declared public surfaces; those are authority decisions rather than substitutes for automated tests.

## Validation Sign-Off

- [ ] Final plan task IDs replace every provisional `TBD-*` row.
- [ ] Every task has an `<automated>` verification or an explicit Wave 0 dependency.
- [ ] Sampling continuity has no three consecutive tasks without automated verification.
- [x] Wave 0 enumerates every missing test reference.
- [x] No watch-mode flags appear in verification commands.
- [x] Focused feedback target is under 30 seconds.
- [x] `nyquist_compliant: true` is set in frontmatter.
- [x] PostgreSQL non-applicability is explicit; no in-memory parity claim is permitted.

**Approval:** pending final plan/task binding
