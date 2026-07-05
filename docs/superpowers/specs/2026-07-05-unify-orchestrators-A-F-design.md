# Unify Orchestrators (A+F) — Design

**Date:** 2026-07-05
**Status:** design, pending implementation plan
**Scope:** documentation + ISA-additive. Near-zero runtime code. First of a multi-part effort (A–F); this spec is **A** (decision framework) + **F** (HTML doc refresh). Sub-projects B–E are explicit non-goals here.

---

## 1. Problem

The Temperance Engine ecosystem has **multiple overlapping "orchestrators"** with no single authority and no enforced spine:

1. **PAI Algorithm** — 7-phase loop (Observe→Think→Plan→Build→Execute→Verify→Learn). Defined in `docs/pai-flow.md` as *convention only* — no enforcement code.
2. **GSD** — phase-planning/execution lifecycle. External, referenced-not-vendored.
3. **superpowers** — brainstorming, writing-plans, subagent-driven-development, dispatching-parallel-agents, etc. Plugin skills, agent-chosen.
4. **temperance-parallel-dispatch** — this-repo skill (shipped PR #2) for mixed external-backend batches.
5. **conductor / `routed-execute.sh`** — a prototype "shape→plan→execute→verify→ship" loop in `package/conductor/`. **Zero live consumers.**
6. **Enrichment core** — `package/enrich/` stages emitting `<temperance-context>` every prompt (the only always-on layer).
7. **Skill-cluster resolver** — the discovery/lazy-load layer (`~/.agents/skill-clusters/skill-index.json`). Hooked for Codex; convention-only for Claude Code / OpenCode.

`docs/architecture/integration-map.html` §5 admits the core defect: *"The decision to use GSD vs. superpowers dispatch vs. plain sequential work is always made by the agent reading the doc, never automated."* Nothing enforces PAI's spine; nothing routes between the orchestrators; the docs describing them (`pai-flow.md`, `parallel-dispatch.md`, `multi-surface-architecture.md`, 4 HTML files) present overlapping, partly-stale views.

## 2. Goal

Establish one authoritative, documented flow: **PAI is the outer shell (7 phases); gsd-core is the recommended workflow backbone inside those phases; superpowers + temperance-parallel-dispatch are the tool inventory the backbone invokes; the skill-cluster resolver is the discovery/lazy-load layer between them.** Retire the dead/duplicative surfaces. Do it as documentation + additive ISCs, with no change to install semantics or the repo's no-forced-deps value proposition.

## 3. Non-goals (deferred — each its own future spec / filed issue)

- **B** — Enrichment enforcement: new `phase` classifier + `orchestrator-hint` stages that make PAI imperative, not advisory.
- **C** — Skill-chain auto-wiring (brainstorming → writing-plans → SDD by default).
- **D** — GSD-as-backbone runtime wiring (plan output auto-drives the executor).
- **E** — Skill-cluster resolver **hook parity** for Claude Code / OpenCode (currently Codex-only). *(Flagged as a follow-up during brainstorm.)*
- **Phase 2A** — per-task grok/kimi fallback chain for `dispatch-tasklist.sh` (GH issue #8, parked).
- **Local-env migration** to gsd-core (`npx @opengsd/gsd-core@latest`) — the user's machine, not this repo.

## 4. Decisions (locked in brainstorm)

1. **Thesis**: PAI = shell; gsd-core = backbone; superpowers + temperance-parallel-dispatch = tools; skill-clusters = discovery layer. Conductor + `parallel-dispatch.md` + `multi-surface-architecture.md` retire.
2. **GSD is recommended-default, not required.** No ISA amendment. `--with-gsd` stays detect-only (ISC-31 preserved). When gsd-core is present → full backbone; when absent → the superpowers column of the per-phase table IS the fallback.
3. **gsd-core realignment**: the old `~/.claude/get-shit-done` (danielmiessler lineage, v1.30.0, `gsd:*` colon skills) is deprecated. Realign to **`open-gsd/gsd-core`** (v1.6.1, `npx @opengsd/gsd-core@latest`, phase model Discuss→Plan→Execute→Verify→Ship).
4. **Command syntax**: canonicalize the `/gsd-*` hyphen form (gsd-core primary / Claude Code spelling) with a one-line compat note (Gemini `/gsd:*`, Codex `$gsd-*`).
5. **Framework granularity**: per-phase table (7 rows), defaults not mandates, with an escape hatch. Done-signals are the enforcement wedge for future sub-project B.
6. **Doc structure**: single source of truth = `docs/pai-flow.md`; the 4 HTML docs are views regenerated from it; 2 markdown docs retire to redirect stubs.
7. **Conductor**: delete `package/conductor/routed-execute.sh` (zero consumers; superseded by `dispatch-tasklist.sh`; deleting it also removes a latent unhardened nvidia injection surface that was out of scope for the R2 hardening).

## 5. Architecture (the target flow)

```
PAI Algorithm (7 phases, ALWAYS active — enforcement is future sub-project B)
  Observe → Think → Plan → Build → Execute → Verify → Learn
                     │      │        │          │        │
                     ▼      ▼        ▼          ▼        ▼
   ┌───────────────────────────────────────────────────────────┐
   │  gsd-core backbone (RECOMMENDED default; degrades to       │
   │  superpowers when absent)                                  │
   │    Discuss → Plan → Execute → Verify → Ship                │
   │                    │                                       │
   │                    │ names a skill to invoke               │
   │                    ▼                                       │
   │   ┌──────────────────────────────────────────────────┐    │
   │   │  Skill-cluster resolver (DISCOVERY + LAZY-LOAD)   │    │
   │   │  ~/.agents/skill-clusters/skill-index.json        │    │
   │   │   active-spoke → symlinked → GO                   │    │
   │   │   deferred     → activate cluster → GO            │    │
   │   │   archived     → Read from indexed path           │    │
   │   │   not-found    → hard error                       │    │
   │   └────────────────────────┬─────────────────────────┘    │
   │                            ▼ resolved skill                │
   │   ┌──────────────────────────────────────────────────┐    │
   │   │  Tool inventory                                   │    │
   │   │   superpowers: brainstorming · writing-plans ·    │    │
   │   │     subagent-driven-development ·                 │    │
   │   │     dispatching-parallel-agents ·                 │    │
   │   │     verification-before-completion ·              │    │
   │   │     finishing-a-development-branch                │    │
   │   │   temperance-parallel-dispatch (external backends)│    │
   │   │   + ~30 more via deferred clusters (on demand)    │    │
   │   └──────────────────────────────────────────────────┘    │
   └───────────────────────────────────────────────────────────┘
  Observe/Think = agent-native (codegraph, read, memory recall)
  Enrichment: <temperance-context> block every prompt (always-on layer)

  Retired: package/conductor/routed-execute.sh
  Retired: docs/parallel-dispatch.md · docs/multi-surface-architecture.md → redirect stubs
```

**Layer claims:** only PAI + gsd-core hold the session spine; everything else is a *called tool*. Observe/Think are agent-native. The skill-cluster resolver sits between "backbone names a skill" and "tool runs" — it is the context-economy mechanism (only active-spoke skills loaded; deferred resolved on demand). temperance-parallel-dispatch is a specialist tool that fires only in Execute (and optionally Verify), not a default.

## 6. The per-phase decision framework

Defaults, not mandates. Any phase exits when its done-signal is met (a trivial typo fix may reach Learn without ever entering Plan). gsd-core commands shown in the canonical `/gsd-*` hyphen form.

| # | PAI Phase | gsd-core command(s) | superpowers skill | temperance-parallel-dispatch | Done signal |
|---|---|---|---|---|---|
| 1 | Observe | `/gsd-new-project`, `/gsd-explore`, `/gsd-capture` | (agent-native: codegraph, read, memory) | no | Problem stated; live state read; constraints enumerated |
| 2 | Think | Discuss: `/gsd-discuss-phase`, `/gsd-spec-phase`, `/gsd-spike` | `brainstorming` (design); `systematic-debugging` (bugs) | no | Hidden requirements + risks surfaced; approach candidates listed |
| 3 | Plan | Plan: `/gsd-plan-phase`, `/gsd-plan-review-convergence`, `/gsd-mvp-phase` | `writing-plans` (standalone lightweight plans) | no | PLAN.md files with declared deps + verification criteria; user aligned |
| 4 | Build | *(folds into Execute — gsd-core has no separate Build)* | `subagent-driven-development`, `test-driven-development` | no | Per-task tests green; task checkbox done |
| 5 | Execute | Execute: `/gsd-execute-phase`, `/gsd-fast`, `/gsd-quick` | `dispatching-parallel-agents`, `subagent-driven-development` | **YES** — 2+ independent tasks that benefit from external backends (command-code/grok/kimi) | All plans complete; branch ready for verify |
| 6 | Verify | Verify: `/gsd-verify-work`, `/gsd-code-review`, `/gsd-ui-review` | `verification-before-completion`, `requesting-code-review` | Optional — parallel verifier fan-out | Fresh evidence per criterion; review clean |
| 7 | Learn | Ship: `/gsd-ship`, `/gsd-milestone-summary`, `/gsd-complete-milestone`, `/gsd-progress` | `finishing-a-development-branch`, `receiving-code-review` | no | Decisions recorded; PR/ship done; milestone archived |

**Cross-cutting gsd-core commands** (not phase-bound): `/gsd-progress` (status + auto-advance), `/gsd-resume-work` / `/gsd-pause-work`, `/gsd-manager`, `/gsd-config` / `/gsd-settings`.

**Command-syntax compat note (goes in pai-flow.md):** gsd-core commands are `/gsd-*` (hyphen) in Claude Code / gsd-core docs; Gemini CLI spells them `/gsd:*` (colon); Codex uses `$gsd-*`. Identical commands, runtime-specific spelling.

**Doctrine (surrounds the table in pai-flow.md):**
1. The table is DEFAULTS, not mandates — exit on done-signal.
2. gsd-core is the backbone but not every cell has a gsd-core command (Observe/Build gaps are honest — no ceremony where it adds nothing).
3. temperance-parallel-dispatch fires only in Execute (and optionally Verify). Single-agent work is the default elsewhere.
4. Done-signals are the enforcement wedge (future sub-project B nudges on skip/premature-exit; A only documents them).
5. Escape hatch: the agent overrides any row when the situation genuinely doesn't fit; the framework nudges, never gates.
6. Degradation: gsd-core absent → the superpowers column IS the flow (`brainstorming → writing-plans → subagent-driven-development → verification-before-completion → finishing-a-development-branch`).

## 7. Doc surface plan

**Rewrite (single source of truth):**
- `docs/pai-flow.md` — from a 24-line summary to the full canonical doc: architecture layer diagram (§5), the 7-row per-phase table (§6), the doctrine, the retirement notices, escape-hatch semantics, done-signals. Target ~300–400 lines.

**Deprecate to redirect stubs (preserve inbound links; do NOT delete the file):**
- `docs/parallel-dispatch.md` — content folds into pai-flow.md Execute/Verify rows. Replace body with a ~4-line header: *"Retired — see `docs/pai-flow.md` §Execute."*
- `docs/multi-surface-architecture.md` — enrichment/router/adapter content folds into pai-flow.md §5; conductor section dropped. Same redirect header.

**Regenerate from pai-flow.md via `architecture-diagram-creator` skill (implementation-phase step):**
- `docs/architecture/architecture.html` — overview; drop the "routed through parallel-dispatch.md" line.
- `docs/architecture/integration-map.html` — skill-cluster resolver becomes a documented layer; GSD flips REFERENCE-ONLY → recommended (still detect-only); parallel-dispatch seam simplifies.
- `docs/architecture/session-trace.html` — degrade-gracefully walkthrough: one trace with gsd-core present, one failure-mode row for gsd-core absent → superpowers fallback; uses `npx @opengsd/gsd-core@latest` as the install pointer.
- `docs/architecture/system-internals.html` — `install-gsd.sh` section reflects gsd-core detection + guidance.

**Spot-update:**
- `docs/skill-clusters.md` — add a paragraph: skill-clusters is the discovery/lazy-load layer in the unified flow.
- `docs/architecture/REFRESH-NEEDED.md` — mark A+F done; queue B/C/D/E.
- `docs/architecture/DEPENDENCY-GRAPH.md` — gsd-core edge present as recommended (not required).
- `docs/architecture/SERVICES.md` — gsd-core listed as recommended service.

**Leave as-is:** `docs/codegraph-routing.md`, `docs/peon-ping-packs.md`, `docs/rollback.md`, `docs/skills-sh-upload.md`, `docs/architecture.md` (spot-check only), `docs/plans/*` (legacy).

## 8. gsd-core realignment deltas

| Surface | Old | Realigned |
|---|---|---|
| `UPSTREAM.md` | GSD **absent** (omission) | Add row: `GSD Core \| https://github.com/open-gsd/gsd-core \| Recommended workflow backbone (Discuss→Plan→Execute→Verify→Ship); referenced, not vendored.` |
| `CREDITS.md` | GSD absent | Add gsd-core credit (open-gsd, MIT). |
| `scripts/install-gsd.sh` | Detects `~/.claude/get-shit-done`; "install separately" | Guidance points at `npx @opengsd/gsd-core@latest`; detection recognizes gsd-core install markers OR the legacy path (back-compat). Still detect-only — **ISC-31 preserved**. Exact gsd-core install markers confirmed at implementation time from gsd-core docs. |
| `docs/pai-flow.md` | n/a | Uses the realigned table; gsd-core as recommended-default. |

## 9. Conductor retirement

- **Delete** `package/conductor/routed-execute.sh` and the (then-empty) `package/conductor/` dir.
- Rationale: zero live consumers (verified — no install/hook/symlink/verify reference); fully superseded by `dispatch-tasklist.sh`; deletion removes a latent unhardened nvidia string-interpolation injection surface that R2 did not touch.
- No `install.sh` / `verify.sh` / test changes needed for the removal (nothing referenced it). The `tests/docs-continuity.sh` extension asserts its absence.

## 10. ISA additions (purely additive — all existing ISCs stay green; adds ISC-34–37)

> Note: the current ISC count is stated inconsistently in the source material (`architecture.html` says "31/31"; `ISA.md` already defines up to ISC-33). Implementation task 4 reads the full `ISA.md`, confirms the true highest ISC number, and appends the four new criteria after it (renumbering the labels below if the real max is not 33). The criteria themselves do not change.

- **ISC-34** — `docs/pai-flow.md` contains the unified 7-phase decision table mapping each PAI phase to its gsd-core command(s), superpowers skill, and done-signal.
- **ISC-35** — gsd-core (`open-gsd/gsd-core`) documented as recommended-default backbone with an explicit superpowers-only fallback; `--with-gsd` remains detect-only (ISC-31 preserved).
- **ISC-36** — `docs/parallel-dispatch.md` and `docs/multi-surface-architecture.md` are retired to redirect stubs pointing at `docs/pai-flow.md`; `package/conductor/routed-execute.sh` is removed.
- **ISC-37** — `UPSTREAM.md` credits gsd-core with its current URL (`https://github.com/open-gsd/gsd-core`).

## 11. Test strategy — extend `tests/docs-continuity.sh`

Grep-assertions (offline, no network):
- `pai-flow.md` contains all 7 phase-row markers (one per phase name), the string `skill-cluster resolver`, and `gsd-core`.
- `parallel-dispatch.md` contains the deprecation/redirect header.
- `multi-surface-architecture.md` contains the deprecation/redirect header.
- `package/conductor/routed-execute.sh` does NOT exist (retirement assertion).
- `UPSTREAM.md` contains `open-gsd/gsd-core`.

`verify.sh` must stay green: `verify-install.sh` currently `check_file docs/parallel-dispatch.md` (line 22) — the redirect stub keeps that file present, so the check passes unchanged. `docs/pai-flow.md` (line 18) still present.

## 12. Implementation task preview (for writing-plans, ~7 tasks)

1. Rewrite `docs/pai-flow.md` (the big content task; TDD via docs-continuity grep assertions).
2. Deprecate `parallel-dispatch.md` + `multi-surface-architecture.md` to redirect stubs.
3. Delete `package/conductor/`; realign `install-gsd.sh` guidance to gsd-core/npx; add gsd-core to `UPSTREAM.md` + `CREDITS.md`.
4. Add ISC-34–37 to `ISA.md`.
5. Extend `tests/docs-continuity.sh`; spot-update `docs/skill-clusters.md` + `docs/architecture/{REFRESH-NEEDED,DEPENDENCY-GRAPH,SERVICES}.md`.
6. Regenerate the 4 architecture HTML docs via `architecture-diagram-creator`.
7. Final review + `verify.sh` green + full test suite.

## 13. Risks / open items

- **HTML regen fidelity** — `architecture-diagram-creator` regenerates from `pai-flow.md`; if the skill's output drifts from the intended structure, the HTML docs may need a manual pass. Mitigation: task 6 includes a human review of each regenerated file against §7's intent.
- **gsd-core install-marker detection** — the exact filesystem markers gsd-core leaves (vs. the legacy `~/.claude/get-shit-done` dir) are confirmed at implementation time from gsd-core docs; until then `install-gsd.sh` keeps the legacy-path check as a fallback so detection never regresses.
- **Deferred sub-projects** — A+F documents the target flow but does NOT enforce it. The "advisory not imperative" gap (the original ecosystem bug) is only fully closed when sub-project B ships. A+F is the prerequisite vocabulary for B–E.
