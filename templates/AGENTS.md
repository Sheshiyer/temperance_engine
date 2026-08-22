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
- Startup scan is **hubs only**: `${AGENTS_HOME:-$HOME/.agents}/skills` (orchestrator+core + preserve) plus this seat's allowlist (PAI thinking skills, GSD profile `standard`). Do not scan `${AGENTS_HOME:-$HOME/.agents}/skill-clusters/skills` wholesale at startup.
- Resolve missing skills through `skill-index.json` before saying a skill does not exist.
- Add a Thoughtseed git root to the Codex cockpit with `thoughtseed-cockpit-add PATH --pin --te-init`. Execute stays Superset + Claude Code — not Codex App as a worker.
- Validate with `npm run health`, `npm run audit-refs`, and `npm run tier` from the skill-clusters repo.

## Local `.agents` CodeGraph Routing

- For structural search about agent skills, skill-clusters, cluster scripts, or `.agents` code, use CodeGraph with `projectPath: "$HOME/.agents"`.
- Do not use Augment/codebase-retrieval for `$HOME` or `$HOME/.agents`; these surfaces can be blocked by dynamic-index security.
- Use direct file reads or text search only for literal text or specific files.
