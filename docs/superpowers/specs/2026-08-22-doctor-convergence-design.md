# Doctor Convergence Design

**Date:** 2026-08-22
**Status:** Ratified (T07 discuss complete — see `.planning/phases/03-safe-profiles-and-transactional-lifecycle/07-{DISCUSSION-LOG,CONTEXT}.md`)
**Feeds:** Phase 3 (Safe Profiles and Transactional Lifecycle) planning as research input
**Requirements:** PROV-06 primary; DOCT-01…05 preserved

---

## 1. Problem

Four doctor implementations with four incompatible vocabularies report overlapping truths about the same machine:

1. **install-surface doctor** (`temperance doctor`) — the only full DOCT-03 record model (`source/destination/class/expected_state/actual_state/condition/reason_code/severity/actionable/remediation/evidence`), sections `install|privacy|runtime`, `ObservationIO` seam, human + JSON renderers.
2. **Bridge doctor** — flat `{id, status: pass|warn|fail, summary, detail}`; 12 checks duplicating runtime concerns (bridge health, LaunchAgent loaded) in a second dialect.
3. **Host surface-doctor** (~40 checks) — `{id, title, status, reason, severity}`; NEVER-SHIP; mixes portable probes (HTTP health, launchd) with private ones (sqlite combo lookups, personal session stores).
4. **`/gsd:doctor` command** — prose orchestrator shelling to #3 and `temperance-project-init --check`.

Consequences: consumers hardcode per-dialect parsers; a new surface needs manual wiring in multiple doctors; PROV-06 ("install, update, doctor, verify, rollback, uninstall consume the same resolved inventory") is unreachable while doctor truth is fragmented.

## 2. Ratified Direction

One **manifest-driven unified report v2**, per four operator decisions:

1. **Unified report v2** — one shared check-record contract (the existing full DOCT-03 record is the base); every doctor ports behind a stable section interface; one aggregator emits ONE report.
2. **Host split** — portable host checks move public as new sections; genuinely private probes stay host-side in a slimmed file conforming to the same contract.
3. **Sections derive from fragments** — fragment records drive check existence (COPY → installed/drift; service → loaded/health; boundary → privacy). New fragment = automatic coverage.
4. **Bridge absorbed as section** — its checks port as the `manifest` section; standalone entrypoint removed after consumer migration.

## 3. Target Architecture

### 3.1 Report schema (v2)

```
temperance.doctor.report.v2 {
  schema, version {major:2, minor:0}, generated_at,
  scope {complete, requested_sections[]},
  trustworthy, overall_condition, exit_code,
  inventory_digest `sha256:<...>`,        // digest of the resolved fragment inventory (PROV-06 link)
  sections: DoctorSection[]               // id-ordered, registry-driven
}
```

Section record = the existing DOCT-03 record unchanged (`DoctorCheck` from `package/install-surface/src/types.ts`). Conditions remain `PASS | WARN | FAIL | DRIFT | SKIPPED | UNSUPPORTED`.

### 3.2 Section registry

```ts
// package/install-surface/src/doctor/model.ts (v2)
DOCTOR_SECTION_ORDER = ["install", "privacy", "manifest", "runtime", "host"] as const;
```

Each section runner receives `DoctorContext` (unchanged seam) plus the resolved inventory:

```ts
interface DoctorContextV2 extends DoctorContext {
  inventory: ResolvedInventory;   // compiled fragment records + lock state
}
```

Derivation rules (fragment → checks):

| Fragment record class | Derived checks |
|---|---|
| `COPY` | installed/drift per record destination (sha256 class-aware checksums, existing install-section logic generalized) |
| `REGENERATE` | regenerated-artifact presence + validity (no byte-compare against source) |
| `TRANSFORM` | rendered-output validation against allowlisted adapter |
| service records (Phase 4) | loaded + functional health probe |
| boundary records (`private-boundaries.json`) | privacy section checks (existing logic generalized over records) |

A section with zero derived checks reports `SKIPPED` with reason `NO_FRAGMENT_RECORDS` — never silently absent.

### 3.3 New sections

**`manifest` section** (ports bridge doctor's 12 checks): event-log integrity, activation-policy, active-runs, project-registry, prompt-hooks, bridge-source parity, bridge/console launchd, state-root, bridge-health, omniroute, console-health. Each maps to the shared record: `source` = probed component, `destination` = URL/state path, `condition` mapping `pass→PASS, warn→WARN, fail→FAIL`, remediation text carried over.

**`host` section** (portable subset of surface-doctor): HTTP health probes (OmniRoute :20128, auto-proxy :20129, Pulse :31337), launchd label loaded for public services, opencode config parseability, skill-index presence. Explicitly EXCLUDED as private: sqlite combo lookups, personal session stores, speculum/statusline personal-state checks — those stay host-side.

### 3.4 Host-private conformance file

`~/.temperance_engine/router/temperance-surface-doctor.mjs` slims to only private probes and gains an emitter producing records valid against the same `doctor-report.v2` schema (validated via the published JSON schema). The public doctor does NOT shell out to it by default; `/gsd:doctor` may merge both reports for the operator view, labeling provenance per section (`public` vs `host-private`).

### 3.5 Aggregation & CLI

- `temperance doctor [--section ID]... [--json] [--verbose]` stays the single entrypoint (`bin/temperance` guard unchanged: read-only forever).
- Bridge CLI loses its top-level `doctor` command after migration; `bun run src/cli.ts debug` keeps raw snapshots for daemon debugging.
- Exit codes unchanged (0 healthy/findings-as-warned per current contract, 1 findings, 2 malfunction).

## 4. Migration Plan (consumer-safe, no flag-day)

| Step | Action |
|---|---|
| M1 | Add v2 schema + section registry alongside v1; v1 renderers keep working (version-dispatched). |
| M2 | Port manifest section; run both doctors in parallel under tests until parity proven (same 12 checks present, equivalent conditions on fixtures). |
| M3 | Port host-portable section from surface-doctor source; host file slims to private probes + conforming emitter. |
| M4 | Fragment-derivation engine replaces static check lists in install/privacy sections; derivation test proves add/remove-record → check-set change. |
| M5 | Flip default report to v2; migrate consumers: manifest console, statusline snapshot, `/gsd:doctor` prose. |
| M6 | Remove bridge standalone doctor entrypoint; delete v1 schema paths. |

## 5. Verification Contract

1. One invocation covers all five sections; `--json` output validates against `schemas/doctor-report.v2.schema.json`.
2. Derivation test: adding a synthetic COPY record to a fixture inventory adds exactly one installed-check; removing it removes the check.
3. Parity test: manifest section conditions match legacy bridge-doctor conditions on identical fixtures.
4. Privacy: grep gates prove no private probe/path enters public sections (extends Phase 2 guard).
5. Host file validates its emitted report against the same schema (conformance test runs only where `~/.temperance_engine` exists).
6. All existing install-surface doctor tests green throughout (M1–M5 never breaks v1).

## 6. Out of Scope

- Mutation/repair commands (Phase 3 lifecycle owns those).
- Service/platform adapter checks beyond registry readiness (Phase 4).
- Linux launchd honesty (Phase 4); host section reports `UNSUPPORTED` there today.
- Console/statusline UI redesign (only parser migration).

## 7. Risks

| Risk | Mitigation |
|---|---|
| v2 scope creep delaying Phase 3 | M1–M2 land independently; Phase 3 planning can start once M1 spec is stable |
| Host file drift after slimming | Conformance test pins schema version |
| Consumer breakage at M5 | Version-dispatched renderers keep v1 readable during migration window |
