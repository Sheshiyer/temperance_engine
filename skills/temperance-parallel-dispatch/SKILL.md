---
name: temperance-parallel-dispatch
description: Use in the Execute phase when 2+ independent, non-conflicting tasks can run at once and some are self-contained coding/refactor/validation work that should run on external backends (command-code/kimi/grok) instead of Claude subagents.
---

# Temperance Parallel Dispatch

Route each independent task to the right rail. Build on `superpowers:dispatching-parallel-agents` (the Claude-subagent primitive); add the external rail via `temperance-batch`.

## Protocol
1. **Split.** For each task decide: needs this live session / Claude-only tools -> Claude subagent; self-contained (describable in a prompt) -> external; trivial one-shot -> inline (do it yourself).
2. **Claude rail.** Dispatch all Claude-rail tasks via the Task tool in one message (parallel).
3. **External rail.** Write the external tasks as a JSON array `[{id,task,backend?,model?}]` and run, backgrounded:
   `temperance-batch --tasks tasks.json` (prints a run dir). For file-mutating tasks that might overlap, add `--worktree`.
4. **Poll + integrate.** Poll `<run>/index.json`; read `<run>/SUMMARY.md` (not raw outputs) to triage. Check each task's `status` — `ok` succeeded; `failed`/`timeout`/`unavailable` -> re-dispatch as a Claude subagent (fail-open). For worktree tasks, integrate `<run>/<id>.diff`.
5. If `temperance-batch` prints `EXTERNAL_RAIL_UNAVAILABLE`, run every task as a Claude subagent.

## Guarantees
- Task text is never eval'd; safe to paste code/errors into task descriptions.
- The external rail can never dead-end the flow (fail-open to Claude subagents).
