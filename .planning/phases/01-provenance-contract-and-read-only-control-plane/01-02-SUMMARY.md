---
phase: 01-provenance-contract-and-read-only-control-plane
plan: 02
subsystem: provenance
tags: [compiler, path-policy, authority, determinism, privacy]
requires:
  - phase: 01-01
    provides: strict schemas, typed records, canonical JSON
provides:
  - Deterministic in-memory provenance compiler with explicit lock writer
  - Segment-aware path and ownership policy
  - ISA and requirements authority validation
  - Ratified 18-record install-surface lockfile
affects: [01-03-doctor, lifecycle, release-validation]
tech-stack:
  added: []
  patterns: [validate-before-write pipeline, symbolic deny policy, semantic identity migrations]
key-files:
  created: [package/install-surface/src/compile.ts, package/install-surface/install-surface-manifest.lock.json, package/install-surface/src/semantic-validation.ts]
  modified: [ISA.md]
key-decisions:
  - "The operator ratified exactly 18 immutable public v1.1 semantic IDs before the first lock write."
  - "Private boundaries use symbolic NEVER-SHIP identities without host paths or private filenames."
patterns-established:
  - "Compilation performs schema, path, semantics, deny, and authority checks entirely in memory."
  - "Lock writing remains an explicit command after successful compilation."
requirements-completed: [PROV-02, PROV-03, PROV-04, PROV-05, PROV-07, SAFE-04]
duration: 30min
completed: 2026-08-20
---

# Phase 1 Plan 02: Deterministic Provenance Compiler Summary

**ISA-ratified 18-record provenance lock with deterministic bytes, strict semantic gates, and privacy-safe failures**

## Performance

- **Duration:** 30 min
- **Started:** 2026-08-20T17:07:00Z
- **Completed:** 2026-08-20T17:37:01Z
- **Tasks:** 8 including one blocking human decision
- **Files modified:** 21

## Accomplishments

- Implemented path, ownership, dependency, class, adapter, migration, deny, and canonical-authority gates.
- Compiled six authored fragments into an operator-ratified 18-record lock with digest `sha256:e5b2274db7bdb246f52bc2bf1176902ab1f34d94ed9572ba13f71e2d28cc7030`.
- Proved byte determinism, private-error non-disclosure, identity migration, and no-write compilation across 28 focused tests.

## Task Commits

1. **Task 1: Implement path-policy.ts** - `0035a0d`
2. **Task 2: Implement deny-policy and semantic-validation** - `c9faf76`
3. **Task 3: Implement authority.ts without a competing store** - `a6d26dc`
4. **Task 4: Implement in-memory compile.ts and load.ts** - `93be09f`
5. **Task 5: Author domain fragments and compile CLI** - `7102b66`
6. **Checkpoint: Record semantic-ID approval gate** - `2181fcd`
7. **Task 7: Record ratified IDs and write lockfile** - `eda2617`
8. **Task 8: Add semantic, authority, determinism, and privacy tests** - `dbba982`

## Files Created/Modified

- `package/install-surface/src/path-policy.ts` - token and segment path policy.
- `package/install-surface/src/semantic-validation.ts` - cross-record semantics and migrations.
- `package/install-surface/src/authority.ts` - canonical ISA/requirements checks.
- `package/install-surface/src/compile.ts` and `load.ts` - deterministic compile/write/load boundary.
- `package/install-surface/fragments/*.json` - six reviewed domain fragments.
- `package/install-surface/install-surface-manifest.lock.json` - exact ratified bytes.
- `package/install-surface/test/{semantics,authority,determinism,privacy}.test.ts` - adversarial evidence.

## Decisions Made

- Approved all 18 proposed semantic IDs without deletion.
- Kept lock digest external to the authenticated lock bytes.
- Kept private records symbolic and excluded any resolved binding or private filename.

## Deviations from Plan

### Auto-fixed Issues

**1. Restored the bounded previously ratified ISC-761..788 authority slice**
- **Found during:** Task 3
- **Issue:** The isolated branch base predated that authority slice because the user-owned dirty ISA was deliberately excluded from the planning commit.
- **Fix:** Imported only the already-ratified criteria and test rows needed by the approved plan, without copying unrelated dirty-spine changes.
- **Files modified:** `ISA.md`
- **Verification:** `assertAuthority` accepts checked ISC-769..772 references and rejects unchecked or unknown references.
- **Committed in:** `a6d26dc`

**Total deviations:** 1 auto-fixed blocking dependency.
**Impact on plan:** Restored the plan's stated authority prerequisite without widening semantic scope.

## Issues Encountered

- The referenced glove audit remains untracked in the preserved host spine. It was read as planning evidence but was not copied into this implementation branch.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-03 can load the exact committed lock bytes and build the permanently read-only doctor surface.
- The compiler test matrix is green and `compile` leaves lock bytes unchanged.

---
*Phase: 01-provenance-contract-and-read-only-control-plane*
*Completed: 2026-08-20*
