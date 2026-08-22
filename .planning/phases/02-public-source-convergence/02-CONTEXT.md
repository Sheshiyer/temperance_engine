# Phase 2: Public Source Convergence - Context

**Date:** 2026-08-22
**Status:** Discuss complete; ready for PLAN.md (T05)
**Goal:** Downloaders receive a complete, portable repository payload rather than a copy of the reference Mac or its private overlays.

## Requirements Addressed

SAFE-01, SAFE-02, RELS-04 (see `.planning/ROADMAP.md` Phase 2)

## Current Baseline (measured 2026-08-22)

`bash ./verify.sh` fails its private-path guard (`scripts/verify-install.sh:104-133`)
with **154 hits across 39 files** for patterns `/Users/`, `/Volumes/madara`, `.craft-agent`.

### Violation taxonomy and ratified disposition

| Class | Location | Hits | Disposition |
|---|---|---|---|
| A. Runtime source | `package/relocation/**`, `scripts/vault-project-relocation.ts` | ~25 | **NEVER-SHIP overlay** — exclude from public repo (like `atlasRecall.ts`); tooling + its tests move private. Public repo keeps no relocation runtime code. |
| B. Acceptance judge | `ISA.md` | 27 | **Redact in place** — symbolic placeholders, all criteria/ISC ids/verdicts intact. |
| C. Historical docs | `docs/plans/2026-08-*vault*`, `docs/superpowers/{plans,specs}` vault docs, `docs/vault-project-relocation.md` | ~55 | **Label + redact in place** — symbolic placeholders + historical-record header. |
| D. Generated/meta | `.planning/NEXT-WAVE.json` cwd field, `.planning/react-bits-pro/`, `.planning/research/PITFALLS.md` | ~7 | Regenerate/symbolic-redact; react-bits-pro commit-or-ignore decision still open from Wave 1. |
| E. False positives | `package/manifest-bridge/node_modules/@types/node`, one line in `package/manifest-bridge/README.md` | 4 | Guard prunes node_modules; README hook path genericized to `$HOME/.claude/hooks/...`. |
| F. Guard itself | `scripts/verify-install.sh:68,104-133` | 2 | Guard's own patterns genericized (no maintainer username literal). |

## Ratified Decisions (2026-08-22)

1. **Relocation tooling → NEVER-SHIP overlay.** Excluded from the public payload entirely.
2. **Historical docs → label + redact in place.**
3. **ISA.md → redact in place**, remains public acceptance judge.
4. **Guard → taxonomy + pruning upgrade**: file-role classification (source/docs/generated),
   node_modules/generated pruning, narrow fixtures allowlist convention, genericized guard
   patterns. Never broad suppression.

## Constraints Carried Forward

- Convergence must pass via source fix — never by weakening the guard into broad exclusions
  (STATE.md blocker; PITFALLS.md root diagnosis).
- `atlasRecall.ts` stays NEVER-SHIP (standing decision).
- The positive candidate inventory (success criterion 1) must include router, hooks,
  Manifest Bridge/Zone, enrichment, and complete Temperance skill packages with zero
  unmapped public capability.
- macOS Apple Silicon + Intel block release; Linux best-effort (not this phase's burden).
- Five release commit slices constrain integration/review, not phase shape.

## Success Criteria Mapping

1. **Positive candidate inventory printed + reviewable** → T05 plan defines inventory format;
   T06 executes the scan that proves every public capability maps to a manifest surface.
2. **No credentials/private state/atlasRecall in scans** → T06 executes class A–F convergence;
   scan gates prove absence.
3. **verify.sh passes via portability, not suppression** → taxonomy guard (class F) is the
   mechanism: role-aware scanning with narrow allowlist only.

## Open Items

- `.planning/react-bits-pro/` commit-or-ignore decision (carried from Wave 1 hygiene) —
  must be resolved during T06 because it sits in guard scope.
- Relocation tooling's private-overlay destination path needs operator confirmation at T06
  execution time (same overlay location as atlasRecall.ts or separate).

## Next Commands

- `/gsd:plan-phase 2` → writes PLAN.md per this CONTEXT (T05), then gsd-plan-checker.
- Execution wave (T06) dispatches te-dispatch-paid after plan ratification.
