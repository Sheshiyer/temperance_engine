# T07 Doctor Convergence — Context

**Date:** 2026-08-22
**Status:** Discuss complete; spec authoring next (docs/superpowers/specs/)
**Goal:** One manifest-driven, read-only doctor contract serving install/update/doctor/verify/rollback/uninstall as their shared oracle (PROV-06), replacing four incompatible doctor dialects.

## Requirements Addressed

PROV-06 (primary); DOCT-01…05 preserved; unblocks Phase 3 planning (INST-*, LIFE-*, SAFE-*).

## Current Baseline (measured 2026-08-22)

Four doctors, four vocabularies:

| # | Surface | Schema | Record model | Location |
|---|---|---|---|---|
| 1 | `temperance doctor` | `temperance.doctor.report.v1` | Full DOCT-03 record: source/destination/class/expected_state/actual_state/condition(PASS\|WARN\|FAIL\|DRIFT\|SKIPPED\|UNSUPPORTED)/reason_code/severity/actionable/remediation/evidence; sections install+privacy+runtime; ObservationIO seam; JSON + human renderers | `package/install-surface/src/doctor/*` (repo, public) |
| 2 | Bridge doctor | `temperance.manifest.doctor.v1` | Flat `{id,status(pass/warn/fail),summary,detail}` — 12 checks (event-log, activation-policy, active-runs, project-registry, prompt-hooks, bridge-source, bridge/console-launchd, state-root, bridge-health, omniroute, console-health) | `package/manifest-bridge/src/doctor.ts` (repo, public) |
| 3 | Host surface-doctor | `temperance.surface-doctor.v1` | `{id,title,status,reason,severity}` — ~40 checks (omniroute, auto-proxy, pulse, launchd:*, opencode-*, combo:*, speculum-*, statusline-*) | `~/.temperance_engine/router/temperance-surface-doctor.mjs` (host, NEVER-SHIP) |
| 4 | `/gsd:doctor` command | — | Prose orchestrator shelling to #3 and `temperance-project-init --check` | host commands dir |

Only #1 satisfies DOCT-03 fully. #2 overlaps #1's runtime section with a different vocabulary. #3 can never ship. Consumers (console, statusline, /gsd:doctor) hardcode per-dialect parsers.

## Ratified Decisions (2026-08-22)

1. **Unified report v2** — one shared check-record contract (the full DOCT-03 model); every existing doctor ports behind a stable section interface; one aggregator emits ONE report.
2. **Host split** — portable host checks (HTTP health, launchd loaded, config presence, skill-index) move into the public repo doctor as new sections; genuinely private probes (sqlite combo lookups, personal session stores) remain host-side in a slimmed file conforming to the shared contract.
3. **Sections derive from fragments** — fragment records drive check existence: COPY → installed/drift check; service record → loaded/health checks; boundary record → privacy check. Adding a fragment automatically adds doctor coverage.
4. **Bridge absorbed as section** — its 12 checks port as a `manifest` section of the unified report; standalone entrypoint removed after consumers migrate.

## Constraints Carried Forward

- Doctor stays permanently read-only (`bin/temperance` guard); mutation belongs to Phase 3 lifecycle commands.
- Converged report must keep DOCT-01…05 semantics: human + stable JSON, full record fields, DRIFT distinguishable, required-vs-optional-vs-unsupported distinguished.
- NEVER-SHIP boundary: no private probe, path, or identity enters the public sections; host-private file never ships.
- Phase 4 will add service/platform adapter checks — section registry must extend without schema break.
- Existing consumers (manifest console, statusline, `/gsd:doctor`) need a migration path, not a flag-day.
- `ObservationIO` seam is the testability contract — all new sections must be IO-injectable.

## Success Criteria Mapping (for the spec)

1. One `temperance doctor` invocation produces one report covering install, privacy, runtime, manifest, and portable-host sections against the shared record contract.
2. Fragment-driven derivation proven: a test adds/removes a fragment record and the doctor's check set follows without code change.
3. Host-private probes stay private while conforming: slimmed host file validates against the same report schema.
4. Bridge standalone doctor removed; its coverage present in the unified report; consumers migrated.
5. All existing install-surface doctor tests green plus new section tests; DOCT-01…05 requirement rows stay checked with evidence.

## Next Commands

- Spec authoring → `docs/superpowers/specs/2026-08-22-doctor-convergence-design.md`
- Then GSD plan-phase for Phase 3 consumes this spec as research input.
