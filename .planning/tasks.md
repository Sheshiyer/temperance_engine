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
  - Discuss done 2026-08-22 (`08-DISCUSSION-LOG.md`, `08-CONTEXT.md`): four decisions ratified — profiles as eligibility enum on fragment records (compiler filters; no new config files), executor as `package/install-surface/src/lifecycle/{planner,journal,executor,receipts,hazards}.ts` with thin shell wrappers, transactions persisted at `~/.temperance_engine/transactions/<txid>/` (journal + preimage + receipt + before/after digests; rollback --select <txid>), T07 M1–M2 folded as wave 1 (Plan 03-01 doctor v2 + manifest section parity) before lifecycle (Plan 03-02). Next: plan authoring via gsd plan-phase.
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
- [ ] **T16** Unified manifest-skill surface design: converge Speculum statusline projection + Manifest Zone console onto one schema-valid host-state snapshot (te-plan, after T07 M3 lands)
  - Baseline (measured 2026-08-22): Speculum = Manifest Zone already — `package/manifest-zone` Vite on :5173, named glass via portless :1355 (`organs.json` console block); statusline `gsd-statusline.js` renders mini-Speculum from HOST-PRIVATE state (VAS session %, OPUS/LIBER/ARCANUM counters, FLEET codexbar provider counts) while the console serves only BRIDGE-side data (project deck, receipts, rails). Gap: no shared source — console cannot leverage statusline data.
  - Design direction: generalize the T07 host-private conforming emitter into a host-state snapshot endpoint emitting records valid against the shared v2 schema family; console merges portable (bridge-served) + host-private (labeled provenance) at render time, mirroring the spec's `/gsd:doctor` merge pattern. Named glass stays `https://speculum.localhost:1355`, loopback `:5173`; "Speculum is projection glass, not a planner" preserved.
  - AC: ratified spec extending `docs/superpowers/specs/2026-08-22-doctor-convergence-design.md`; statusline + console demonstrably read one snapshot source; no private value crosses NEVER-SHIP boundary (only labeled projections do).

## Handoff

- SWARM (te-swarm-s): T01–T03, T12, T15
- PAID (te-dispatch-paid): T06, T08, T09, T11
- PLAN (te-plan / te-plan-max): T07 (done), T16 — after T07 M3 emitter exists
- Human: phase transitions, release approval (T13/T14), any --include-sol decision

## Commit log — 2026-08-22 Phase 2 wave (sliced)

| Slice | Commit | Contents |
|---|---|---|
| 1 | `816a522` | Relocation Class A: 59 overlay files + gitignore additions |
| 2 | `9540def` | Historical docs labeled + redacted to symbolic placeholders |
| 3 | `604f703` | Guard upgrade: role taxonomy, fail-closed sweep, source genericization |
| 4 | `fccd0d0` | Phase 2 planning records + CANDIDATE-INVENTORY |
| 5 | `7ea93f5` | T07 doctor-convergence spec + phase 3 context |
| 6 | `7943a44` | verify-all.sh drops relocated suites |

Guard re-verified PASS post-commit; tree clean.
