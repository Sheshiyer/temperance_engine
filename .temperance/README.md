# Temperance project rail

This directory is the **project-side** Temperance packet. It does not replace
the host operator runtime.

## Two layers

| Layer | Location | Owns |
|---|---|---|
| **Host TE** | `~/.temperance_engine`, `~/.config/opencode`, LaunchAgents | Models, OmniRoute, enrich plugins, budgets, combos |
| **Project rail** | `.temperance/`, `.planning/`, `ISA.md`, `AGENTS.md` | What work is next, acceptance, agent contract |

Chat sessions only *feel* like full TE when **both** layers are present for the cwd.

## Commands

```bash
temperance-project-init --cwd . --check   # same as /gsd:doctor
temperance-goal --cwd . --ensure --eval   # same as /gsd:goal
temperance-next-wave --cwd .
temperance-next-wave --write-tasks --approval <approval-id>
temperance-swarm-dispatch --request .planning/swarm-claim.json --dry-run
```

`/gsd:*` already binds MINIMAL / NATIVE / ALGORITHM. A card only on a bare first prompt with no saved mode.

Never commit OmniRoute API keys, provider tokens, or home absolute secrets here.
