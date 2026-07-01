# Parallel Dispatch

Temperance Engine's Execute phase can run work sequentially or in parallel. Picking the wrong mechanism risks shared-state collisions or wasted orchestration overhead, so this doc gives the decision rule.

## Why

Two or more independent tasks in the Execute phase can often run at once instead of one after another. But "independent" has to be verified, not assumed, and the right dispatch mechanism depends on whether the work is already plan-shaped and whether an external planning system (GSD) is installed.

## Decision Tree

1. Is the work GSD-plan-shaped (a phase already has one or more `PLAN.md` files with declared dependencies, produced by `gsd:plan-phase`)?
   - YES: use GSD `execute-phase` (wave-based, per-plan git-worktree isolation via `gsd-executor` agents). Only relevant if GSD is installed (`~/.claude/get-shit-done` present) — Temperance Engine does not vendor or require GSD.
   - NO: continue.
2. Is the work multiple independent milestones/features that need their own persistent planning namespace over a long-lived, multi-session effort (not just one batch of tasks)?
   - YES: GSD `workstreams` (`.planning/workstreams/<name>/`), if GSD is installed.
   - NO: continue.
3. Are there 2+ independent tasks, no shared state, no sequential dependency, and you want them done within the current session (ephemeral, not a persisted plan)?
   - YES: use `superpowers:dispatching-parallel-agents`.
4. Are there independent tasks from a written implementation plan you want executed with review checkpoints, still in the current session?
   - YES: use `superpowers:subagent-driven-development`.
5. Is there any shared mutable state (same files, same branch, same directory) between the tasks?
   - YES: do not parallelize. Run sequentially. Shared-state interference is the top failure mode for both GSD execute-phase (mitigated internally via git worktrees) and superpowers dispatch (not mitigated — no worktree isolation, so the caller must guarantee non-overlap).

## Comparison Table

| Mechanism | Isolation | Persistence | Requires GSD | Best for |
|---|---|---|---|---|
| `superpowers:dispatching-parallel-agents` | none (caller must avoid overlap) | ephemeral (this session) | no | ad hoc independent subtasks |
| `superpowers:subagent-driven-development` | none | ephemeral (this session) | no | executing a plan already written this session |
| GSD `execute-phase` | git worktree per plan | persisted in `.planning/` | yes | a phase with multiple `PLAN.md` files and declared dependencies |
| GSD `workstreams` | separate `.planning/workstreams/<name>/` namespace | persisted, long-lived | yes | multiple parallel milestones/features over many sessions |

## If GSD Is Not Installed

Everything above that isn't GSD-gated still applies via the two superpowers skills. Detect GSD with:

```bash
test -d "$HOME/.claude/get-shit-done"
```

## Related

- `docs/pai-flow.md` (Execute phase)
- `package/hooks/ParallelDispatchContext.hook.sh` (situational-awareness hook)
