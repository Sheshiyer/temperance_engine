# Task Graph — v1.1 Glove Release Upgrade

Generated: 2026-08-22 · Source: `.planning/DEEP-PASS.md` · Judge: `ISA.md`

## Wave 1 — Hygiene (2026-08-22, in flight)

- [x] **T01** Commit-or-stash working-tree hygiene
  - AC: clean `git status`; secrets never staged; templates diff committed; `.gitignore` secret rule committed; untracked skill links + `.mcp.json` consciously committed or reverted.
- [x] **T02** Regenerate NEXT-WAVE + ORCHESTRATION from current STATE.md
  - AC: fresh `temperance-next-wave` output; current fingerprints; no 2026-08-16 approval residue.
- [x] **T03** Restore healthy Manifest Bridge loopback `:8766`
  - AC: `<manifest-runtime>` receipt flips OFFLINE → healthy bridge; console reflects run.

## Wave 2 — Phase 2 planning (next)

- [x] **T04** Phase 2 discuss: private-path convergence strategy for `verify.sh` guard (te-plan)
  - AC: DISCUSSION-LOG with operator decisions before any PLAN.md.
- [x] **T05** Phase 2 plan: positive candidate inventory (router/hooks/bridge/zone/enrich/skills), COPY/TRANSFORM/REGENERATE/NEVER-SHIP classification (te-plan) — split 02-01 (mechanics, wave 1) + 02-02 (inventory, wave 2); checker iteration 2: 0 blockers / 0 major / 2 minor verify-command fixes applied
  - AC: PLAN.md passes gsd-plan-checker; no atlasRecall.ts anywhere in inventory.

## Wave 3+ — Execution queue (paid after plans ratify)

- [x] **T06** Phase 2 execute: converge public source; zero credentials/private db/logs/atlasRecall (te-dispatch-paid)
  - AC: `verify.sh` private-path guard passes via source fix, not suppression.
  - Done 2026-08-22: Plan 02-01 all six tasks green — Class A relocation (59 files → `~/.temperance_engine/private-overlay/`, overlay pre-existing content untouched), ISA.md redacted (2182 ISC baseline held), 16 historical docs labeled+redacted, guard upgraded to role taxonomy + node_modules pruning + guard-spec exclusion + root-level fail-closed sweep (canary cycle proves planted violation fails), NEXT-WAVE `cwd` dropped (watcher.ts fallback evidence), react-bits-pro gitignored, README genericized. `bash ./verify.sh` exit 0; widened scan zero unexplained hits; credential sweep clean. Deviations: three phase-2 planning docs added to explicit guard-spec enumeration (they must quote guard patterns); fixture2 normalized to canonical `/Volumes/fixture/`; ajv dep install needed for green tests (env, not code). Plan 02-02 complete: `CANDIDATE-INVENTORY.md` authored — 16-row six-column inventory, all 11 `package/*` + 4 `skills/*` dirs mapped exactly once via fragment record ids or repo-native routes, relocation tooling recorded once as NEVER-SHIP; coverage/fragment-citation/privacy verify loops exit clean. Phase 2 success criteria 1–3 all evidenced.
- [x] **T07** Doctor convergence design: fold repo doctor + install-surface doctor + bridge doctor + host surface-doctor into one manifest-driven contract (te-plan)
  - AC: ratified spec in `docs/superpowers/specs/`.
  - Done 2026-08-22: GSD discuss complete — four operator decisions ratified via AskUserQuestion (audit trail `07-DISCUSSION-LOG.md`, decisions `07-CONTEXT.md`): unified report v2 topology, host split (portable→public sections, private probes stay host-side conforming to shared schema), fragment-derived sections, bridge absorbed as `manifest` section with standalone entrypoint removed after consumer migration. Spec authored at `docs/superpowers/specs/2026-08-22-doctor-convergence-design.md`: v2 schema (`temperance.doctor.report.v2` with `inventory_digest` PROV-06 link), five-section registry (`install|privacy|manifest|runtime|host`), derivation rules per record class, M1–M6 no-flag-day consumer migration map (bridge cli.ts doctor subcommand, gsd-rail-map.json, gsd-command-install.mjs, statusline), six-point verification contract including parity + derivation tests. Read-only permanence and DOCT-01…05 semantics preserved throughout.
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
