---
phase: 01-provenance-contract-and-read-only-control-plane
plan: 01
subsystem: provenance
tags: [ajv, json-schema, canonical-json, bun]
requires: []
provides:
  - Standalone install-surface ESM package with Ajv 8.20.0
  - Strict Draft 2020-12 schemas for fragments, locks, registries, and doctor reports
  - Typed provenance contracts and deterministic canonical JSON
affects: [01-02-compiler, 01-03-doctor, release-validation]
tech-stack:
  added: [ajv@8.20.0]
  patterns: [bounded schema validation, strict unknown-field rejection, canonical UTF-8 ordering]
key-files:
  created: [package/install-surface/src/schema.ts, package/install-surface/src/types.ts, package/install-surface/src/canonical-json.ts]
  modified: []
key-decisions:
  - "Schema versions are the exact supported pair {major: 1, minor: 0} plus stable major URIs."
  - "Canonical JSON normalizes Unicode, byte-sorts keys, semantic-ID-sorts record arrays, and ends with one newline."
patterns-established:
  - "Validate bounded decoded values structurally before semantic or filesystem work."
  - "Keep provenance types in a package with no host-runtime dependency."
requirements-completed: [PROV-01]
duration: 18min
completed: 2026-08-20
---

# Phase 1 Plan 01: Strict Provenance Contract Summary

**Strict bounded Draft 2020-12 validation and deterministic canonical serialization for every v1 provenance envelope**

## Performance

- **Duration:** 18 min
- **Started:** 2026-08-20T17:02:00Z
- **Completed:** 2026-08-20T17:20:45Z
- **Tasks:** 5
- **Files modified:** 13

## Accomplishments

- Created an isolated ESM package whose only production dependency is exactly `ajv@8.20.0`.
- Added four strict v1 schemas and bounded validation functions with unknown-field and unsupported-version rejection.
- Added typed lifecycle records plus deterministic NFC-normalized, byte-ordered canonical JSON.

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold package.json and pin ajv@8.20.0** - `b5b9e8c`
2. **Task 2: Write failing schema.test.ts fixtures** - `7ef6358`
3. **Task 3: Author Draft 2020-12 schemas** - `8de15be`
4. **Task 4: Add types.ts schema literals and canonical-json.ts** - `cacdd45`
5. **Task 5: Implement schema.ts Ajv compiler and turn tests GREEN** - `e12cd54`

## Files Created/Modified

- `package/install-surface/package.json` and `bun.lock` - isolated dependency surface.
- `package/install-surface/schemas/*.v1.schema.json` - strict structural contracts.
- `package/install-surface/src/types.ts` - discriminated lifecycle and doctor types.
- `package/install-surface/src/canonical-json.ts` - deterministic canonical bytes.
- `package/install-surface/src/schema.ts` - bounded Ajv validators.
- `package/install-surface/test/schema.test.ts` and fixtures - RED/GREEN schema evidence.

## Decisions Made

- Used exact v1.0 version pairs so unknown minors fail closed instead of being guessed compatible.
- Kept all filesystem and semantic policy out of structural validation.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- The first task commit command used paths relative to the repository root while running inside the package directory; the add failed without changing the index and was immediately rerun with package-relative paths.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-02 can build semantic, authority, deny, and deterministic compilation atop the validated types.
- No lockfile bytes have been generated or written yet.

---
*Phase: 01-provenance-contract-and-read-only-control-plane*
*Completed: 2026-08-20*
