# PAI Flow

Themed page: [site/pai-flow.html](site/pai-flow.html) · library: [index.html](index.html)

The packaged model is a disciplined work loop with one authoritative structure:
**PAI is the 7-phase outer shell; gsd-core is the recommended workflow backbone;
superpowers skills + temperance-parallel-dispatch are the tool inventory the
backbone invokes; the skill-cluster resolver is the discovery/lazy-load layer.**

## Core Principle

Move from current state to ideal state. The ideal state is decomposed into
criteria. Criteria are verified with tools. Work is complete only when the
criteria pass.

## Architecture

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
   │   │   OpenCode auto relay (request-time portfolio)   │    │
   │   │   + ~30 more via deferred clusters (on demand)    │    │
   │   └──────────────────────────────────────────────────┘    │
   └───────────────────────────────────────────────────────────┘
  Observe/Think = agent-native (codegraph, read, memory recall)
  Enrichment: <temperance-context> block every prompt (always-on layer)
  OpenCode automatic requests: enrich → frozen plan → OmniRoute relay
  Kimi automatic requests: hook sidecar (cwd) → relay-side enrich → frozen plan → OmniRoute

  Retired: docs/parallel-dispatch.md · docs/multi-surface-architecture.md → redirect stubs
```

Only PAI + gsd-core hold the session spine; everything else is a called tool.
Observe/Think are agent-native. The skill-cluster resolver
(`~/.agents/skill-clusters/skill-index.json`) sits between "backbone names a
skill" and "tool runs" — it is the context-economy mechanism (only active-spoke
skills loaded; deferred clusters resolved on demand). temperance-parallel-dispatch
is a specialist tool that fires only in Execute (and optionally Verify), not a
default. OpenCode's `temperance/temperance-auto` model follows the same route at request
time through the local relay; direct picker models remain explicit overrides.
Kimi (CLI and desktop daimon) joins the same governed lane with one difference:
its hook runner cannot inject context, so the relay performs the enrichment
server-side for `X-Temperance-Surface: kimi` requests (see
[`docs/kimi-surface.md`](kimi-surface.md)).

## Phases and the decision framework

The table below is DEFAULTS, not mandates — any phase exits when its done-signal
is met. gsd-core commands are shown in the canonical `/gsd-*` hyphen form.

| # | PAI Phase | gsd-core command(s) | superpowers skill | temperance-parallel-dispatch | Done signal |
|---|---|---|---|---|---|
| 1 | Observe | `/gsd-new-project`, `/gsd-explore`, `/gsd-capture` | (agent-native: codegraph, read, memory) | no | Problem stated; live state read; constraints enumerated |
| 2 | Think | Discuss: `/gsd-discuss-phase`, `/gsd-spec-phase`, `/gsd-spike` | `brainstorming` (design); `systematic-debugging` (bugs) | no | Hidden requirements + risks surfaced; approach candidates listed |
| 3 | Plan | Plan: `/gsd-plan-phase`, `/gsd-plan-review-convergence`, `/gsd-mvp-phase` | `writing-plans` (standalone lightweight plans) | no | PLAN.md files with declared deps + verification criteria; user aligned |
| 4 | Build | *(folds into Execute — gsd-core has no separate Build)* | `subagent-driven-development`, `test-driven-development` | no | Per-task tests green; task checkbox done |
| 5 | Execute | Execute: `/gsd-execute-phase`, `/gsd-fast`, `/gsd-quick` | `dispatching-parallel-agents`, `subagent-driven-development` | **YES, bounded** — 2+ independent tasks may use `te-dispatch-paid`; automatic launch additionally requires the approval-and-claim controller. `te-dispatch` is retired. | All plans complete; branch ready for verify |
| 6 | Verify | Verify: `/gsd-verify-work`, `/gsd-code-review`, `/gsd-ui-review` | `verification-before-completion`, `requesting-code-review` | Optional — parallel verifier fan-out | Fresh evidence per criterion; review clean |
| 7 | Learn | Ship: `/gsd-ship`, `/gsd-milestone-summary`, `/gsd-complete-milestone`, `/gsd-progress` | `finishing-a-development-branch`, `receiving-code-review` | no | Decisions recorded; PR/ship done; milestone archived |

**Cross-cutting gsd-core commands** (not phase-bound): `/gsd-progress`,
`/gsd-resume-work`, `/gsd-pause-work`, `/gsd-manager`, `/gsd-config`, `/gsd-settings`.

**Temperance-owned session loop:** `/gsd:goal` (also `/goal`) writes
`.temperance/goal.json` and evaluates the same doctor/ISA probes VERIFY
already uses. It is not a planner. Next-wave approval and the dual-fleet
lock still gate Execute. Manifest Zone only projects the GOAL card.

**Command-syntax compat note:** gsd-core commands are `/gsd-*` (hyphen) in
Claude Code / gsd-core docs; Gemini CLI and this installer's wrappers use
`/gsd:*` (colon). Identical commands, runtime-specific spelling. After
`./install.sh --with-spine`, Claude/Codex/OpenCode/Grok get the same wrapper set.
`/gsd:doctor` and `/gsd:goal` are Temperance-owned (not GSD core workflows).
`/gsd:*` already binds the mode. A native card (`ask_user_question` / `AskUserQuestion`)
is only for a bare first prompt with no saved mode. After that, Codex/Claude open
ChatGPT IAB to Manifest Zone; Grok prints the URL. See
[`gsd-manifest-spine.md`](gsd-manifest-spine.md) and
[`gsd-goal-handoff.md`](gsd-goal-handoff.md).

## Doctrine

1. The table is DEFAULTS, not mandates — exit on done-signal.
2. gsd-core is the backbone but not every cell has a gsd-core command (Observe/Build gaps are honest — no ceremony where it adds nothing).
3. temperance-parallel-dispatch fires only in Execute (and optionally Verify). Direct `temperance-batch` is a manual batch tool; automatic paid work must enter through the one-use approval claim and controller described in [`manifest-control-plane.md`](manifest-control-plane.md).
4. `temperance-manifest` is the operational projection CLI: it reports bridge health, emits bounded observations, and can read CodeGraph status without changing planner, router, approval, GSD, or skill-cluster ownership.
5. GSD and skill-cluster telemetry is explicit (`--gsd`, `--skill-clusters`) and observational; deferred/archived cluster activation and legacy GSD execution remain operator-owned.
6. `temperance-manifest omniroute` records only protected gateway reachability; route planning and provider selection remain OmniRoute/router authority.
4. Done-signals are the enforcement wedge (future sub-project B nudges on skip/premature-exit; A only documents them).
5. Escape hatch: the agent overrides any row when the situation genuinely doesn't fit; the framework nudges, never gates.
6. Degradation: gsd-core absent → the superpowers column IS the flow (`brainstorming → writing-plans → subagent-driven-development → verification-before-completion → finishing-a-development-branch`).

## GSD is recommended, not required

gsd-core (`open-gsd/gsd-core`, `npx @opengsd/gsd-core@latest`) is the recommended
default backbone. When gsd-core is present, use its phase commands. When absent,
the superpowers column of the table above IS the flow:
`brainstorming → writing-plans → subagent-driven-development →
verification-before-completion → finishing-a-development-branch`.
`--with-gsd` at install time is detect-only and never vendors gsd-core.

## ISA Pattern

An ISA is the system of record for a task or project. It contains problem,
vision, constraints, goal, criteria, test strategy, features, decisions,
changelog, and verification.

## Completion Rule

No completion claim without fresh verification evidence.

## Retired surfaces (folded into this doc)

- `docs/parallel-dispatch.md` — the Execute-phase dispatch decision is now this
  doc's Execute row + doctrine. `superpowers:dispatching-parallel-agents` remains
  the **Claude-subagent primitive**; `temperance-parallel-dispatch` (external
  backends via `temperance-batch`) builds on it. Automatic paid dispatch adds the
  separate approval-and-claim controller. (Redirect stub retained.)
- `docs/multi-surface-architecture.md` — the enrichment/router/adapter layers are
  this doc's Architecture section. (Redirect stub retained.)
