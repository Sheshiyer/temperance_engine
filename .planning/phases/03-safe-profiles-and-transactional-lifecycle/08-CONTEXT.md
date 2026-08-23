# T08 Phase 3 — Context

**Date:** 2026-08-22
**Status:** Discuss complete; plan authoring next
**Phase:** 3 of 7 — Safe Profiles and Transactional Lifecycle
**Goal:** Users can plan and perform profile-based installation, update, rollback, and uninstall without losing user-owned configuration or being stranded by partial failure — all six lifecycle verbs consuming ONE resolved inventory (PROV-06).

## Requirements Addressed

PROV-06, INST-01, INST-03, INST-04, INST-05, INST-07, LIFE-01, LIFE-02, LIFE-03, LIFE-05, LIFE-06, LIFE-07, LIFE-08, SAFE-03, SAFE-05, SAFE-06 (16 rows).
Folded scope: T07 M1–M2 (doctor-report.v2 schema + section registry + manifest section port with parity tests) as **Plan 03-01, wave 1** — lifecycle builds against the final doctor contract.

## Baseline (measured 2026-08-22)

- Fragment `eligibility.profiles` exists as a seam; all 18 records carry only `"default"`.
- No journal/compensation/transaction/receipt code anywhere in `package/install-surface/src/`.
- Install is shell-script federation (`install-spine.sh`, `install-pai.sh`, `install-gsd.sh`, `configure-opencode.sh`, launchd self-installers); none consume the resolved inventory.
- Doctor v1 (install/privacy/runtime sections) shipped and permanently read-only; T07 spec ratified for v2.

## Ratified Decisions (2026-08-22)

1. **Profiles = eligibility enum.** Extend `eligibility.profiles` on each fragment record to `minimal | full | no-voice` membership; `compile.ts` filters by the selected profile. One resolved inventory, zero new config files. no-voice excludes pulse/tts records; minimal = hooks+router core; full = everything.
2. **Executor lives in install-surface.** New `package/install-surface/src/lifecycle/{planner,journal,executor,receipts,hazards}.ts`; `cli.ts` gains `install|update|rollback|uninstall` subcommands; existing shell scripts shrink to thin wrappers.
3. **Transactions persist in state root.** `~/.temperance_engine/transactions/<txid>/{journal.json, preimage/, receipt.json, manifest-before.json, manifest-after.json}`; rollback via `temperance rollback --select <txid>`; retention last-N configurable. SAFE-03 traversal guard already excludes the state root.
4. **T07 M1–M2 is wave 1** (Plan 03-01); lifecycle is wave 2+ (Plan 03-02).

## Constraints Carried Forward

- Doctor stays permanently read-only; mutation belongs to lifecycle commands only.
- SAFE-03: lifecycle commands never recursively traverse provider caches, private state roots, personal memory roots.
- SAFE-05/06: symlink/hardlink/parent-swap/path-type hazards fail closed before mutation; no recursive deletion — removal targets enumerated from verified ownership records.
- LIFE-01: compensation journal written BEFORE each mutation; LIFE-03: staged atomic promotion within destination filesystem, declared modes preserved.
- LIFE-08 + privacy: receipts redact private values; no operator paths/identity in any public output.
- User-authored configuration outside Temperance-owned blocks preserved and recorded (INST-07).
- Failed application never presented as committed state (Phase 3 SC3).
- T07 spec (`docs/superpowers/specs/2026-08-22-doctor-convergence-design.md`) governs v2 doctor work: v1 never breaks, ObservationIO seam mandatory, DOCT-01…05 semantics preserved.
- Phase transitions require explicit operator approval (`auto_advance: false`).

## Success Criteria Mapping (from ROADMAP Phase 3)

1. Profile preview/selection with explicit optionality → decision 1 + INST-01/03/04/05.
2. Six verbs on one resolved inventory; no private-root traversal; user config preserved → PROV-06, SAFE-03, INST-07.
3. Persisted compensation, staged atomic promotion, declared modes, redacted receipts → LIFE-01/02/03/08.
4. Exact retained-transaction rollback; hazards fail closed → LIFE-05/06, SAFE-05.
5. Uninstall restores displaced content, removes only owned artifacts, idempotent no-op → LIFE-07, SAFE-06.

## Next Commands

- Plan authoring: Plan 03-01 (doctor v2 wave: M1–M2 + parity) then Plan 03-02 (profiles + lifecycle executor), both via gsd plan-phase consuming `docs/superpowers/specs/2026-08-22-doctor-convergence-design.md` as research input.
- Execution dispatch: te-dispatch-paid after plans pass gsd-plan-checker.
