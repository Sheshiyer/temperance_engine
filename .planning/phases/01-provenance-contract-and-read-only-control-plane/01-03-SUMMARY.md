---
phase: 01-provenance-contract-and-read-only-control-plane
plan: 03
subsystem: diagnostics
tags: [doctor, read-only, privacy, cli, timeouts]
requires:
  - phase: 01-02
    provides: ratified committed provenance lock and loader
provides:
  - Permanently read-only public temperance doctor CLI
  - Install, privacy, and runtime section composition
  - Stable human and JSON renderers over one report
  - Read-only, privacy, timeout, classification, and exit-code evidence
affects: [phase-2-source-convergence, phase-3-lifecycle, qualification]
tech-stack:
  added: []
  patterns: [capability-limited ObservationIO, bounded section isolation, public-safe projection]
key-files:
  created: [bin/temperance, package/install-surface/src/doctor/orchestrator.ts, package/install-surface/test/doctor.test.ts]
  modified: [scripts/temperance-doctor.sh, package/manifest-bridge/src/doctor.ts, scripts/verify-all.sh]
key-decisions:
  - "Every doctor path is observational; recording and repair are rejected and deferred to governed lifecycle commands."
  - "Private registry output is constructed by explicit allowlist projection before rendering."
patterns-established:
  - "One DoctorReportV1 feeds both human and canonical JSON presentation."
  - "Section crashes and timeouts become deterministic UNAVAILABLE observations while other sections continue."
requirements-completed: [DOCT-01, DOCT-02, DOCT-03, DOCT-04, DOCT-05, SAFE-07]
duration: 12min
completed: 2026-08-20
---

# Phase 1 Plan 03: Read-Only Doctor Summary

**Capability-limited doctor with one stable report, three isolated sections, exact exits, and privacy-safe public rendering**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-20T17:36:00Z
- **Completed:** 2026-08-20T17:48:28Z
- **Tasks:** 5
- **Files modified:** 21

## Accomplishments

- Added `temperance doctor` with repeatable section filters, stable JSON, drift-first human output, and exact 0/1/2 exits.
- Made the legacy Manifest Bridge doctor read-only by removing report persistence and duplicate repair from its command path.
- Proved entries, bytes, modes, links, and mtimes remain unchanged; honeytokens never reach human, JSON, verbose, or safe error projections.
- Added timeout/crash isolation, class-aware verification, private-registry permission gates, and Linux launchd `UNSUPPORTED` behavior.

## Task Commits

1. **Task 1: Define ObservationIO and doctor model** - `b12006a`
2. **Task 2: Implement section adapters and orchestrator** - `e0fe339`
3. **Task 3: Render human and JSON from the same object** - `b7b7187`
4. **Task 4: Add public wrapper and migrate legacy doctor** - `ba3ec16`
5. **Task 5: Doctor and CLI tests including read-only invariant** - `be1d75c`

## Files Created/Modified

- `package/install-surface/src/doctor/` - model, orchestrator, sections, and renderers.
- `package/install-surface/src/private-registry.ts` - owner/mode/link/schema checks and explicit public projection.
- `bin/temperance` - public POSIX entrypoint.
- `scripts/temperance-doctor.sh` - jq-free compatibility wrapper.
- `package/manifest-bridge/src/doctor.ts` - read-only component doctor.
- `package/install-surface/test/doctor.test.ts` and `cli.test.ts` - executable invariants.

## Decisions Made

- A doctor may describe a repair but never execute, record, initialize, or persist it.
- `SKIPPED`, `PRIVATE`, and `UNSUPPORTED` remain visible without becoming actionable overall failures.
- The committed lockfile is loaded as authority; doctor never recompiles fragments.

## Deviations from Plan

### Auto-fixed Issues

**1. Aligned the Phase 1 doctor schema with the approved research contract**
- **Found during:** Task 2
- **Issue:** Plan 01-01's initial report schema represented scope as a string and omitted `trustworthy`, while the locked Plan 01-03 contract requires structured scope and trust state.
- **Fix:** Updated the schema, type, and structural fixture before building the orchestrator.
- **Verification:** All 38 package tests pass, including strict report-schema validation.
- **Committed in:** `e0fe339`

**2. Removed obsolete legacy repair test coverage with the retired doctor mutator**
- **Found during:** Task 4
- **Issue:** The Manifest Bridge test imported the duplicate-repair function that D-14 removes from every doctor surface.
- **Fix:** Replaced persistence assertions with a directory read-only invariant and removed the mutator test.
- **Verification:** The doctor module imports cleanly; the bridge test file remains blocked earlier by missing untracked `src/codegraph.ts` source.
- **Committed in:** `ba3ec16`

**Total deviations:** 2 correctness fixes. No scope expansion.

## Issues Encountered

- The clean worktree cannot load the full Manifest Bridge test module because `package/manifest-bridge/src/codegraph.ts` remains untracked in the preserved spine. This is explicit Phase 2 source-convergence debt.
- The canonical verifier exits 1 only at the already-recorded private-path guard. It was run and left unsuppressed for Phase 2.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 1's 13 requirements are implemented with 38 focused tests passing.
- Next command is `/gsd 2` for public source convergence, including missing tracked product sources and the private-path baseline.

---
*Phase: 01-provenance-contract-and-read-only-control-plane*
*Completed: 2026-08-20*
