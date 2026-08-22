# DEEP PASS — Hand-in-Glove System (OmniRoute + Temperance Engine + .agents)

Generated: 2026-08-22 · Mode: ALGORITHM · Milestone: v1.1 Public Temperance Glove
Authority: `ISA.md` (judge) · GSD `.planning/` (organizer) · `scripts/verify-all.sh` (CI)

## A. MACRO MAP

### Surfaces

| Tree | Role | Key contents |
|---|---|---|
| `~/.omniroute/` | Gateway process data | `storage.sqlite` (live WAL), oauth, call_logs, backups; LaunchAgent `com.temperance.engine.omniroute` on `:20128`. NEVER-SHIP. |
| `~/.temperance_engine/` | Operator runtime (host layer) | `bin/` (auto-classifier proxy `:20129`), `router/` (~75 files: phase-combo-map, portfolios, next-wave, project-init, surface-doctor, workflows), `scripts/`, `state/` (doctor receipts, codexbar limits), `manifest-bridge/`. `product` → symlinks to this repo. |
| `~/.agents/` | Skill plane | `skill-clusters` → Madara repo symlink; hubs at `~/.agents/skills`; skill-index resolution. |
| Product repo (this) | Public glove / source authority | `install.sh --with-spine`, `package/install-surface` (Phase 1 provenance compiler + read-only doctor), `scripts/verify-all.sh`, `templates/`, `.planning/` spine. |

### Data/control flow

CLIs (Claude/Codex/OpenCode/Grok) → OmniRoute `:20128` (combo selection via
`phase-combo-map.json`) → provider stack. Classifier proxy `:20129` classifies
task → portfolio. Manifest Bridge `:8766` feeds console `:5173` and
`<manifest-runtime>` receipts. Project rail (`.temperance/project.json`,
`.planning/`) stamped per-repo by `temperance-project-init`. Auto-advance chain:
next-wave → enrich inject → `temperance-batch` (te-dispatch-paid), gated on
human approval receipts.

### Current state (2026-08-22)

- v1.1 milestone, Phase 1/7 complete (commit `c1dfbce`).
- Working tree dirty: templates modified, `.gitignore` secret rule, untracked
  `.mcp.json`, `.agents/skills` links, `.temperance/` rail (secrets gitignored).
- NEXT-WAVE/ORCHESTRATION stale (2026-08-16, approval expired) — chain blocked-by-design.
- Manifest Bridge unhealthy (no loopback bridge on `:8766`).

## B. DEEP PASS (3 layers)

### Layer 1 — UI/settings

Console `:5173`, manifest HUD/receipts, `/gsd:*` mode-bind (four CLIs), Pulse
compat notify (`:31337`). Findings: bridge offline; host CHANGELOG has
Unreleased entries pending a version cut; `.temperance/goal.json` last eval met
but gitignored (correct — secrets adjacent).

### Layer 2 — routing/combo/lifecycle

Combos `te-reason/plan/build/dispatch-paid/validate/fast` resolve against
command-code head. Execute lock honored (Superset+Claude; no Codex worker).
Stale ORCHESTRATION approval blocks auto-advance until regenerated. Reconcile
LaunchAgent stays dry-run only (never auto-`--apply`).

### Layer 3 — PAI/agent workflow + release engineering

ISA.md judges (830 criteria, 708 verified). GSD phases 2–7 are the ratified
queue: source convergence (close `verify.sh` private-path guard), transactional
lifecycle, service adapters (both Mac archs), docs-as-interface, clean-host
qualification, five reviewable release slices. Four doctor surfaces (repo shell
doctor, install-surface doctor, manifest-bridge doctor, host surface-doctor)
must converge onto the one manifest-driven model.

## C. TASK GRAPH

| ID | Task | Acceptance | Combo |
|---|---|---|---|
| T01 | Commit-or-stash working-tree hygiene | Clean `git status`; secrets never staged | te-build |
| T02 | Regenerate NEXT-WAVE + ORCHESTRATION | Fresh run; current fingerprints; no 2026-08-16 residue | te-reason |
| T03 | Restore healthy Manifest Bridge `:8766` | Receipt flips OFFLINE→live | te-build |
| T04 | Phase 2 discuss: private-path convergence strategy | DISCUSSION-LOG with operator decisions | te-plan |
| T05 | Phase 2 plan: positive candidate inventory | PLAN.md passes checker; no atlasRecall.ts | te-plan |
| T06 | Phase 2 execute: converge public source | verify.sh private-path guard passes via source fix | te-dispatch-paid |
| T07 | Doctor convergence design (one manifest-driven doctor) | Ratified spec; four doctors mapped | te-plan |
| T08 | Phase 3: profiles + transactional lifecycle | Phase 3 criteria demonstrable in tests | te-dispatch-paid |
| T09 | Phase 4: macOS LaunchAgent lifecycle adapters | Both-arch path or explicit ephemeral-Mac gate | te-dispatch-paid |
| T10 | Phase 5: docs continuity gate | Gate fails when facts diverge | te-build |
| T11 | Phase 6: clean-host qualification harness | Empty-home journeys pass; failure rehearsal restores | te-dispatch-paid |
| T12 | Version-plane bump reconciliation | release-control.md consistent across 3 planes | te-build |
| T13 | Phase 7: release qualification script | Exact-candidate receipt from fresh clone | te-build |
| T14 | Five commit slices + independent review | No P0/P1; approval cites receipt | te-validate |
| T15 | Skill-gap resolution for lifecycle-test tooling | Resolution record before T08/T11 waves | te-fast |

## D. HANDOFF

- SWARM (te-swarm-s): T01, T02, T03, T12, T15
- PAID (te-dispatch-paid): T06, T08, T09, T11 (after plans ratify)
- Human: phase transitions (auto_advance=false), release approval (T13/T14), any --include-sol

Wave 1 (2026-08-22): T01–T03 hygiene. Wave 2: T04/T05 Phase 2 discuss+plan.
