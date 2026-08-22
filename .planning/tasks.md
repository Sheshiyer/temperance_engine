# Task Graph — v1.1 Glove Release Upgrade

Generated: 2026-08-22 · Source: `.planning/DEEP-PASS.md` · Judge: `ISA.md`

## Wave 1 — Hygiene (2026-08-22, in flight)

- [ ] **T01** Commit-or-stash working-tree hygiene
  - AC: clean `git status`; secrets never staged; templates diff committed; `.gitignore` secret rule committed; untracked skill links + `.mcp.json` consciously committed or reverted.
- [ ] **T02** Regenerate NEXT-WAVE + ORCHESTRATION from current STATE.md
  - AC: fresh `temperance-next-wave` output; current fingerprints; no 2026-08-16 approval residue.
- [ ] **T03** Restore healthy Manifest Bridge loopback `:8766`
  - AC: `<manifest-runtime>` receipt flips OFFLINE → healthy bridge; console reflects run.

## Wave 2 — Phase 2 planning (next)

- [ ] **T04** Phase 2 discuss: private-path convergence strategy for `verify.sh` guard (te-plan)
  - AC: DISCUSSION-LOG with operator decisions before any PLAN.md.
- [ ] **T05** Phase 2 plan: positive candidate inventory (router/hooks/bridge/zone/enrich/skills), COPY/TRANSFORM/REGENERATE/NEVER-SHIP classification (te-plan)
  - AC: PLAN.md passes gsd-plan-checker; no atlasRecall.ts anywhere in inventory.

## Wave 3+ — Execution queue (paid after plans ratify)

- [ ] **T06** Phase 2 execute: converge public source; zero credentials/private db/logs/atlasRecall (te-dispatch-paid)
  - AC: `verify.sh` private-path guard passes via source fix, not suppression.
- [ ] **T07** Doctor convergence design: fold repo doctor + install-surface doctor + bridge doctor + host surface-doctor into one manifest-driven contract (te-plan)
  - AC: ratified spec in `docs/superpowers/specs/`.
- [ ] **T08** Phase 3: profiles minimal/full/no-voice + transactional install/update/rollback/uninstall (te-dispatch-paid)
  - AC: Phase 3 success criteria demonstrable in tests; failed apply never reads as committed.
- [ ] **T09** Phase 4: macOS LaunchAgent lifecycle adapters, idempotent, health probes; Linux never launchd (te-dispatch-paid)
  - AC: both-arch path or explicit ephemeral-Mac gate documented.
- [ ] **T10** Phase 5: docs continuity gate (te-build)
  - AC: gate fails when facts diverge; historical plans labeled.
- [ ] **T11** Phase 6: clean-host qualification harness (te-dispatch-paid)
  - AC: minimal/full/no-voice empty-home journeys pass; failure rehearsal restores pre-transaction state.
- [ ] **T12** Version-plane bump reconciliation (te-build)
  - AC: `docs/release-control.md` consistent across glove VERSION / host VERSION / OmniRoute pin.
- [ ] **T13** Phase 7: release qualification script (te-build)
  - AC: exact-candidate receipt from fresh clone rehearsal; verify-all green.
- [ ] **T14** Five reviewable commit slices + independent review (te-validate)
  - AC: no P0/P1; human approval cites exact-candidate receipt.
- [ ] **T15** Skill-gap resolution for lifecycle-test tooling (te-fast)
  - AC: resolution record (local | skillsmp | install) before T08/T11 dispatch.

## Handoff

- SWARM (te-swarm-s): T01–T03, T12, T15
- PAID (te-dispatch-paid): T06, T08, T09, T11
- Human: phase transitions, release approval (T13/T14), any --include-sol decision
