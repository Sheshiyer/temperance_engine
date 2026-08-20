# `/goal` handoff

Themed page: [site/gsd-goal.html](site/gsd-goal.html) · library: [index.html](index.html)

Claude Code `/goal` is a **session loop**: a completion condition plus an independent evaluator. It is not a planner.

Temperance uses it to *finish* the spine you already have.

```
/gsd:* binds mode → GSD / writing-plans → next-wave (approval) → te-dispatch-paid
                 → /gsd:verify-phase + ISA probes
                 → /gsd:goal evaluator (same probes)
```

`/gsd:goal` already binds **ALGORITHM**. Do not present a mode picker. Do not write MINIMAL/NATIVE/ALGORITHM as a chat reply. A native card is only for a bare first prompt with no session/cwd mode.

## Commands

| Surface | Command |
|---|---|
| Claude Code / Claude.app | `/gsd:goal` and native `/goal` (same `.temperance/goal.json` text) |
| Codex CLI / Codex app | `/gsd:goal` (shares `~/.codex`) |
| OpenCode.app | `/gsd:goal` |
| Cursor.app | `/gsd:goal` if wrappers exist; otherwise follow `AGENTS.md` |
| Grok | `/gsd:goal` — print Manifest URL, no IAB |
| CLI | `node ~/.temperance_engine/router/temperance-goal.mjs --cwd . --ensure\|--eval` |

## Contract file

Project-local `.temperance/goal.json` (`temperance.goal.v1`).

- **text** comes from ISA `## Goal` when `active_planner=isa`, else GSD STATE.
- **evaluator** probes must be the same checks VERIFY already uses. No second judge.
- **gsd_command** is the next `/gsd:*` (plan / execute / complete-milestone).
- Execute still needs a next-wave **approval** and the existing fleet lock.

## What `/goal` must not do

- Fork GSD
- Auto-approve or auto-dispatch `temperance-batch`
- Spawn a second `gsd-executor` swarm
- Approve from Manifest Zone

## Swarm-architect

using-superpowers names `swarm-architect` for large-plan split. If that skill is not installed, use `writing-plans` or `/gsd:plan-phase`. Those write the plan. `/goal` only loops execute until the evaluator passes.
