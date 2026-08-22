# T07 Doctor Convergence — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-22
**Task:** T07 doctor convergence design (pre-phase design work feeding Phase 3 planning)
**Surfaces examined:** `bin/temperance` → install-surface doctor; bridge doctor; host surface-doctor; `/gsd:doctor` command

---

## Topology

| Option | Description | Selected |
|---|---|:---:|
| Unified report v2 | One shared check-record contract (full DOCT-03 model); each existing doctor ports behind a stable section interface; a manifest-driven aggregator merges them into ONE report. | ✓ |
| Federated envelope | Thin top-level wrapper nests unchanged reports. | |
| Contract-only | Ratify schema + registry; no aggregation yet. | |

**User's choice:** Unified report v2.
**Notes:** Bridge/host checks become sections; one oracle for Phase 3.

## Host surface-doctor fate

| Option | Description | Selected |
|---|---|:---:|
| Split | Portable checks (HTTP health, launchd loaded, config presence) move public as new sections; genuinely private probes (sqlite combo lookups, personal session stores) stay host-side but conform to the shared contract. | ✓ |
| Stay fully private | Public doctor shells out to the private file when present. | |
| Untouched | Docs 1+2 only this phase. | |

**User's choice:** Split.
**Notes:** Public glove gains real fresh-machine diagnostics without shipping personal probes.

## Manifest-driven meaning

| Option | Description | Selected |
|---|---|:---:|
| Sections derive from fragments | Fragment records drive which checks exist: COPY → installed/drift check; service → loaded/health; boundary → privacy check. New fragment = automatic doctor coverage. | ✓ |
| Static registry, manifest informs | Hand-written section list; manifest supplies expected values only. | |

**User's choice:** Sections derive from fragments.
**Notes:** Strongest PROV-06 story — one resolved inventory feeds all lifecycle verbs.

## Bridge doctor fate

| Option | Description | Selected: Absorb as section |
|---|---|---|
| Absorb as section | Port its 12 checks as a 'manifest' section in the unified report; standalone entrypoint removed after consumers migrate. | ✓ |
| Keep both entries | Standalone stays for daemon debugging; record format unified only. | |

**User's choice:** Absorb as section.

---

## Operator decisions ratified: 2026-08-22 via AskUserQuestion.
