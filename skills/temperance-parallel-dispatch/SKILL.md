---
name: temperance-parallel-dispatch
description: Use in the Execute phase when 2+ independent, non-conflicting tasks can run at once and self-contained work should use a verified native Claude, OmniRoute batch, or direct external rail instead of consuming Sol quota.
---

# Temperance Parallel Dispatch

Route each independent task to the right rail. Build on
`superpowers:dispatching-parallel-agents` (the in-session subagent primitive),
then add governed native non-Codex Claude profiles and the Codex-compatible
external rail. Spark is optional and every Sol-family model is excluded unless
the user separately authorizes it.

## Protocol
1. **Split.** For each task decide: needs this live session or shared tools ->
   in-session subagent; bounded read-only analysis -> native non-Codex; isolated
   file mutation -> worktree worker; trivial one-shot -> inline.
2. **In-session subagent rail.** Dispatch independent subagent tasks together.
   This rail inherits the current agent runtime and is distinct from the native
   OmniRoute Claude rail below.
3. **Governed worker rail.** Choose one of these explicit modes:
   - **Native non-Codex mode (current default for bounded analysis):** pin one
     of `antigravity-claude-sonnet-5`, `gh-claude-sonnet-5`,
     `no-think-antigravity-claude-sonnet-5`, or
     `no-think-gh-claude-sonnet-5` through `temperance-claude`. Run at most four
     independent processes concurrently. For audits, require `--tools ""`,
     `--permission-mode plan`, `--no-session-persistence`, a finite
     `--max-budget-usd`, `--output-format json`, private mode-600 output files,
     and gateway attribution. Native tasks that can edit must use Claude's
     `--worktree`; never allow two workers to share a mutable checkout.
   - **Governed heterogeneous mode (for Codex-compatible coding fleets):**
     write every task with
     explicit `backend:"omniroute"` and an exact non-Sol model that has passed
     the relevant client-wire, tool-loop, nontrivial-output, and receipt gates.
     Pin models per task capability; do not treat catalog presence as execution
     compatibility. Run `temperance-batch --foreground --tasks tasks.json
     --concurrency 4`. Keep `TEMPERANCE_OMNIROUTE_CODEX_SANDBOX=read-only` when
     the Codex CLI is the wire client for audit tasks. External Codex workers
     ignore the operator's user configuration by default while retaining the
     repository rule surface. Their task packets must therefore be
     self-contained: include the bounded objective, exact allowed paths,
     required evidence, and every task-specific policy pointer instead of
     depending on ambient PAI hooks, user plugins, or prior conversation.
     Exact `TEMPERANCE_OMNIROUTE_CODEX_ISOLATED=0` is an audited emergency
     opt-out, not a routine dispatch setting.
   - **Pinned Spark mode:** use exact `codex/gpt-5.3-codex-spark` only when a
     task specifically needs the verified Spark rail or the governed non-Codex
     candidates are unavailable. Spark is no longer the only permitted worker.
   - **Governed combo mode:** use `te-dispatch` only after every member passes
     the Codex Responses-stream, tool-loop, nontrivial-output, and receipt
     correlation gates. A zero exit with only `NO` or stream-shape errors is a
     failed task, never a success.
   - **Pinned mode:** set a direct backend/model only when a task needs a
     provider-specific capability or a known quota rail.
   - Concurrent tasks that can mutate files **must** add `--worktree`.
     `--allow-dirty` is an explicit stale-HEAD tradeoff, not a default.
4. **Poll + integrate.** Require `<run>/index.json`; read `<run>/SUMMARY.md` first, then validate nontrivial task output and gateway attribution before accepting `ok`. In app-orchestrated runs prefer `--foreground`; a printed detached run directory without an index is not progress. `failed`/`timeout`/`unavailable` or invalid output -> re-dispatch on an explicitly non-Sol rail. For worktree tasks, integrate `<run>/<id>.diff`.
5. If `temperance-batch` prints `EXTERNAL_RAIL_UNAVAILABLE`, try an applicable
   allowlisted native non-Codex profile before using an in-session subagent.
   Any failed, timeout, or unavailable task exhausts only frozen non-Sol rails
   before fallback.

## Native non-Codex example

```bash
umask 077
temperance-claude antigravity-claude-sonnet-5 \
  -p "Audit architecture only; return evidence; do not edit." \
  --tools "" --permission-mode plan --no-session-persistence \
  --max-budget-usd 0.25 --output-format json > antigravity.json &
temperance-claude gh-claude-sonnet-5 \
  -p "Audit rollback only; return evidence; do not edit." \
  --tools "" --permission-mode plan --no-session-persistence \
  --max-budget-usd 0.25 --output-format json > github.json &
wait
chmod 600 antigravity.json github.json
```

The two profiles are separate upstream provider families. Validate substantive
terminal results and matching gateway receipts independently; one provider's
success does not promote the other.

## Codex-compatible fleet example

```json
[
  {
    "id": "router-tests",
    "task": "Add bounded routing tests; return changed files and evidence.",
    "backend": "omniroute",
    "model": "<exact-probe-passing-non-sol-model>"
  },
  {
    "id": "runtime-docs",
    "task": "Update runtime documentation for the accepted routing contract.",
    "backend": "omniroute",
    "model": "<exact-probe-passing-non-sol-model>"
  }
]
```

```bash
TEMPERANCE_OMNIROUTE_CODEX_SANDBOX=read-only temperance-batch \
  --foreground \
  --tasks tasks.json \
  --concurrency 4 \
  --worktree
```

`temperance-batch` owns independent tasks and worktree isolation. OmniRoute
owns the authenticated transport and gateway receipt when the Codex CLI is the
wire client. Batch run directories and retained artifacts are owner-only; the
dispatcher does not impose its permissions on files a worker creates in a
repository or shared cache. `te-dispatch` remains a candidate combo until all
of its members are compatible with their declared client wire; individually
proven models may still be pinned before combo-wide promotion.

## Guarantees
- Task text is never eval'd; safe to paste code/errors into task descriptions.
- A worker rail can never dead-end the flow: frozen non-Sol fallbacks remain.
- Every accepted task must have selected backend/model evidence, nontrivial
  output, and gateway attribution. Duplicate or missing correlations remain a
  verification failure.
- Worker fan-out excludes every Sol-family model unless the user separately
  authorizes that quota rail.
- External Codex workers retain repository rules but never require ambient
  user configuration, hooks, plugins, or conversation to understand a task.
