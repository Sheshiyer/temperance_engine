# Phase 2: Public Source Convergence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-22
**Phase:** 02-public-source-convergence
**Areas discussed:** Private-path guard convergence strategy for `verify.sh` (T04)

---

## Vault-relocation tooling fate (`package/relocation/`, `scripts/vault-project-relocation.ts`)

| Option | Description | Selected |
|---|---|:---:|
| NEVER-SHIP overlay | Exclude from the public glove entirely; Thoughtseed-vault-specific tooling stays private like `atlasRecall.ts`. | ✓ |
| TRANSFORM to config-driven | Keep public; all roots from env/config with no private defaults. | |
| Split pure primitives public / wiring private | Keep tested registry/capsule/transaction/rollback modules public. | |

**User's choice:** NEVER-SHIP overlay.
**Notes:** Largest runtime-source violation class (~25 hits). The 157 relocation tests stay private with the tooling.

## Historical vault docs handling

| Option | Description | Selected |
|---|---|:---:|
| Label + redact in place | Keep files public; replace private paths with symbolic placeholders and add a historical-record header. | ✓ |
| Move to private overlay | Remove vault-saga docs from the public repo entirely. | |
| Mixed | Redact only instructive docs; move execution handoffs/receipts private. | |

**User's choice:** Label + redact in place.
**Notes:** History preserved, paths gone. Applies to `docs/plans/2026-08-*vault*`, `docs/superpowers/{plans,specs}` vault docs, `docs/vault-project-relocation.md`.

## ISA.md evidence citations

| Option | Description | Selected |
|---|---|:---:|
| Redact in place | Symbolic placeholders replace path strings; every criterion, ISC id, and verdict intact. | ✓ |
| Split evidence out | Historical evidence sections move to a private file; ISA references abstractly. | |

**User's choice:** Redact in place.
**Notes:** ISA.md remains the public acceptance judge.

## Guard evolution

| Option | Description | Selected |
|---|---|:---:|
| Taxonomy + pruning | Prune node_modules/generated dirs; add a fixtures allowlist convention; classify files by role (source/docs/generated); genericize the guard's own hardcoded username pattern. | ✓ |
| Minimal exclusions | Just node_modules exclusion plus a narrow allowlist. | |

**User's choice:** Taxonomy + pruning.
**Notes:** Directly answers the PITFALLS.md root-design diagnosis ("no file-role taxonomy, no fixture convention, no generated-directory pruning"). Suppression stays narrow and principled — convergence passes by source fix, never broad suppression.

---

## Operator decisions ratified: 2026-08-22 via AskUserQuestion.
## Next gate: T05 PLAN.md must pass gsd-plan-checker before any execution dispatch.
