<!-- temperance:identity:start -->
# Temperance Engine

This repository is the public **hand-in-glove** product for the local operator runtime.
Host TE (`~/.temperance_engine`) owns models and credentials. This repo owns planning, ISA, and the agent contract.
<!-- temperance:identity:end -->

<!-- temperance:mode-bind:start -->
`/gsd:*` already binds a PAI mode. Do not write a NOESIS quiz of MINIMAL / NATIVE / ALGORITHM.
A real picker is only `ask_user_question` (Grok) or `AskUserQuestion` (Codex/Claude) on a **bare first prompt with no saved mode**. After `/gsd:goal` or a session pick, go straight to the work.
<!-- temperance:mode-bind:end -->

# Temperance Engine Runtime Guidance

Use `NOESIS` as the first visible line for PAI-formatted responses.

## GSD slash remote

- If this repo has `.planning/`, prefer `/gsd:progress` then the next `/gsd:*` named in STATE.
- `/gsd:doctor` (or `temperance-project-init --cwd . --check`) is the daily truth probe.
- `/gsd:*` already binds a PAI mode (goal/plan/execute = ALGORITHM; doctor/fast = NATIVE; help = MINIMAL). Do not write a NOESIS quiz. A real picker (`ask_user_question` on Grok, `AskUserQuestion` on Codex/Claude) is only for a bare first prompt with no mode yet. After a mode exists, Codex/Claude open ChatGPT IAB to `http://127.0.0.1:5173`; Grok prints that URL. Never Chrome/Safari for Manifest.
- All modes keep the seven alchemical steps. Skill clusters and workflows differ by mode.
- Do not fork GSD core. Wrappers read `~/.claude/get-shit-done/workflows/`.
- `active_planner` in `.temperance/project.json` is `isa` or `gsd` — not both as authority.

## PAI Runtime

- Prefer a current-state to ideal-state loop.
- Treat criteria as the verification surface.
- Keep handoff manual unless the user explicitly enables automation.
- Keep local PAI files under `${PAI_HOME:-$HOME/.claude}`.
- Do not require Claude Code, Claude Pro/Max, Anthropic auth, Codex auth, or a specific model. If a Claude-only advisor is unavailable, skip that advisor and verify through OpenCode, Cursor, shell checks, tests, logs, or human review notes.

## Skill Cluster Resolution

- The canonical skill-cluster home is `${AGENTS_HOME:-$HOME/.agents}/skill-clusters`.
- Resolve missing skills through `skill-index.json` before saying a skill does not exist.
- Do not scan `${AGENTS_HOME:-$HOME/.agents}/skill-clusters/skills` wholesale at startup.
- Validate with `npm run health`, `npm run audit-refs`, and `npm run tier` from the skill-clusters repo.

## Local `.agents` CodeGraph Routing

- For structural search about agent skills, skill-clusters, cluster scripts, or `.agents` code, use CodeGraph with `projectPath: "$HOME/.agents"`.
- Do not use Augment/codebase-retrieval for `$HOME` or `$HOME/.agents`; these surfaces can be blocked by dynamic-index security.
- Use direct file reads or text search only for literal text or specific files.

<!-- temperance:project-rail:start -->
## Temperance project rail

This repository is registered with **Temperance Engine** as a project rail.
Host runtime (models, OmniRoute, OpenCode plugins) lives under `~/.temperance_engine`
and `~/.config/opencode`; this repo owns planning and acceptance.

| Concern | Authority |
|---|---|
| Models / failover / budgets | Host OmniRoute + temperance combos |
| Planning spine | `.planning/` (GSD) + `temperance-next-wave` |
| Acceptance | `ISA.md` when present |
| Session loop | `/gsd:goal` → `.temperance/goal.json` (not a second planner) |
| Handoff (if present) | `.project/HANDOFF.md` |
| Parallel execute | `te-dispatch-paid` / `temperance-batch` |

`/gsd:*` binds the mode. A card only on a bare first prompt with no saved session/cwd mode.

### Auto next-wave

When an agent session starts in this cwd, enrich injects `dispatch: NEXT-WAVE …`.
The injected next-wave is a proposal only. Do not dispatch until a matching
approval receipt has been atomically claimed by the swarm control ledger.

```bash
temperance-next-wave --cwd .
temperance-project-init --cwd . --check
manifest-bridge init --cwd .
manifest-bridge sync --cwd .
temperance-swarm-dispatch --request .planning/swarm-claim.json --dry-run
```

Manifest: `.temperance/project.json` (schema temperance.project.v1)
<!-- temperance:project-rail:end -->

Codex CLI: no async hooks. See `docs/codex-cli-limits.md`. Resume with `codex resume`.
