---
phase: 01
slug: provenance-contract-and-read-only-control-plane
verified: 2026-08-20
verdict: passed
requirements_verified: 13
known_baselines:
  - phase-2-private-path-source-convergence
  - phase-2-untracked-manifest-bridge-codegraph-source
---

# Phase 01 Verification

## Verdict

Phase 1 achieves its goal: the glove now has one strict, authority-bound, deterministic installation inventory and a permanently read-only doctor that reports the same observations in human and JSON form.

## Requirement Evidence

| Requirements | Evidence | Result |
|---|---|---|
| PROV-01 | Ajv 8.20.0 exact pin; bounded strict v1 fragment, lock, registry, and report validation | passed |
| PROV-02, PROV-03 | Stable semantic records; duplicate and overlapping ownership rejection | passed |
| PROV-04, SAFE-04 | Repository-relative sources, root-token destinations, traversal and escape rejection | passed |
| PROV-05 | Cycle, contradiction, adapter, and identity-migration semantic gates | passed |
| PROV-07 | Checked ISA plus Phase 1 requirement allowlist; operator-approved 18-ID checkpoint | passed |
| DOCT-01, DOCT-02 | Human and canonical JSON renderers consume one DoctorReportV1 | passed |
| DOCT-03 | Complete common observation record contract | passed |
| DOCT-04 | Drift exits 1; bytes, modes, links, entries, and mtimes remain unchanged | passed |
| DOCT-05 | Required, optional, private, unsupported, and unavailable states remain distinct | passed |
| SAFE-07 | COPY, TRANSFORM, REGENERATE, and NEVER-SHIP use class-aware verification | passed |

## Executed Gates

- `bun test package/install-surface`: 38 passed, 0 failed, 69 assertions.
- `bash tests/temperance-doctor.sh`: all four public-wrapper and read-only checks passed.
- `gsd-sdk query init.plan-phase 1 --pick phase_found`: `true`.
- `gsd-sdk query init.phase-op 1 --pick phase_found`: `true`.
- In-memory compile left the committed lock byte-identical at `sha256:e5b2274db7bdb246f52bc2bf1176902ab1f34d94ed9572ba13f71e2d28cc7030`.
- `temperance doctor --record` exited 2 with Phase 3 governed-lifecycle guidance.
- `git diff --check` passed.

## Preserved Baselines

The canonical `scripts/verify-all.sh` still exits 1 at the pre-existing `verify.sh` private-local-path guard. This is the explicit Phase 2 source-convergence release blocker and was not suppressed or broadened away.

The clean branch also cannot load the full Manifest Bridge test module because `package/manifest-bridge/src/codegraph.ts` exists only in the preserved uncommitted host-spine tree. Direct doctor module coverage passes; tracking the missing public product source belongs to Phase 2.

Neither baseline invalidates the 13 Phase 1 requirements, and both remain visible for `/gsd 2`.
