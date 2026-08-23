# T08 Phase 3 Planning — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-22
**Task:** Phase 3 planning (Safe Profiles and Transactional Lifecycle), folding T07 M1–M2 as wave 1
**Baseline observed:** fragments carry a single `default` profile across all 18 records (`compile.ts:54`); zero journal/compensation/receipt code exists in `package/install-surface/src/`; installation is a federation of independent shell scripts (`install-spine.sh`, `install-pai.sh`, `install-gsd.sh`, `configure-opencode.sh`, launchd self-installers) that do not consume the resolved inventory.

---

## Profile selection mechanism

| Option | Description | Selected |
|---|---|---|
| Eligibility enum | Extend each fragment record's existing `eligibility.profiles` to minimal/full/no-voice membership; compiler filters by selected profile. One resolved-inventory path, zero new files. | ✓ |
| Profile manifest file | Separate profiles.json maps profile → record-id list; second source of truth with drift risk. | |
| Attribute-derived | Derive membership from record attributes; implicit rules conflict with INST-01 explicit preview. | |

**User's choice:** Eligibility enum.
**Notes:** no-voice excludes pulse/tts records; minimal = hooks+router core; full = everything.

## Executor home

| Option | Description | Selected |
|---|---|---|
| install-surface TS module | New `src/lifecycle/` beside compile/load/path-policy/private-registry; shell scripts shrink to thin wrappers calling the CLI. | ✓ |
| New package/lifecycle | Cleaner boundary but cross-package versioning friction and duplicated path-policy wiring. | |
| Shell-script evolution | Fastest start but PROV-06 unreachable without rewrite anyway. | |

**User's choice:** install-surface TS module.

## Journal persistence

| Option | Description | Selected |
|---|---|---|
| State root, tx dirs | `~/.temperance_engine/transactions/<txid>/` holds journal.json, preimage/, receipt.json, before/after manifest digests. Survives repo reinstalls; SAFE-03 traversal guard already excludes state root. | ✓ |
| Destination-local | Co-located per project but installs touch HOME-level surfaces one project can't own. | |
| Hybrid | Journal centralized, preimages scattered — harder exact-restore proof (LIFE-05). | |

**User's choice:** State root, tx dirs.
**Notes:** rollback selects retained txid; retention last-N configurable.

## T07 M1–M2 sequencing

| Option | Description | Selected |
|---|---|---|
| Wave 1 of Phase 3 | Plan 03-01 implements v2 schema + registry + manifest section port with parity tests; lifecycle builds against the final doctor contract. | ✓ |
| Parallel standalone wave | Doctor converges sooner but streams collide on install-surface files. | |
| Defer to post-Phase-3 | Receipts/journal verification would build on the fragmented dialect voted to kill. | |

**User's choice:** Wave 1 of Phase 3.

---

## Operator decisions ratified: 2026-08-22 via AskUserQuestion.
