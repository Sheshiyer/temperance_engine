# Routed Parallel Dispatch Bridge — Design (v2)

**Date:** 2026-07-04
**Status:** design, pending implementation plan
**Scope:** one coherent security pass — the bridge **and** hardening of the shared router it reuses.

---

## 1. Problem

`superpowers:dispatching-parallel-agents` only spawns Claude subagents through the Task/Agent
tool (model enum `sonnet|opus|haiku|fable`). The command-code / kimi / grok / nvidia backends are
reachable only from standalone bash scripts that nothing in the Temperance Execute flow calls. The
enrichment `routing:` line advertises those backends as advisory text that no tool consumes, so when
the flow hits 2+ independent tasks the command-code backends are **structurally unreachable** — the
whole reason this design exists.

A v1 "thin wrapper on top of the installed router" was drafted and then put through an adversarial
multi-lens review. The review confirmed **19 gaps** (1 candidate refuted by test). The three
highest-severity gaps plus a Claude Code harness limit invalidate the "thin wrapper" premise: the
router's programmatic surfaces (`--command`, `--json`, `--execute`) are unsafe to drive from code.
This document is the re-architecture (v2).

## 2. Goal

When the Temperance Execute phase has 2+ independent, non-conflicting tasks, route **each** task to
the right rail — Claude subagent (needs this live session / Claude-only tools), external backend
(self-contained coding/refactor/validation), or inline (trivial, the orchestrator does it) — and make
the external rail **actually invoke command-code/kimi/grok/nvidia**, safely, past the harness's
execution-time cap, with results the orchestrator can integrate.

## 3. Non-goals (YAGNI)

- Unifying the three routing brains (`route-task.sh`, `multi-backend-router.sh`, `routing.ts`) into
  one. The bridge reuses `multi-backend-router.sh`'s routing table only. Drift between the three is a
  separate follow-up.
- Auto-merging worktree diffs. v2 reports diffs; the orchestrator integrates.
- Modifying `superpowers:dispatching-parallel-agents`. v2 builds on it (Claude rail) and does not
  touch it.
- Changing the enrichment hook's execution path (`PromptProcessing.hook.ts`). Discovery is handled by
  installing a real skill (§6.C), not by re-touching the live hook.

## 4. Decisions (locked)

1. **Route each task** per task-type (not command-code-by-default, not Claude-by-default).
2. **Agent splits, router picks.** The orchestrating agent decides Claude-vs-external; the router
   picks backend+model for the external ones.
3. **All detected backends** are eligible (command-code primary by routing priority).
4. **Caller guarantees file non-overlap**; `--worktree` is opt-in real isolation.
5. **Reuse the router's routing logic** — but its I/O boundaries are hardened first (they are
   prerequisites, not a rewrite).
6. **Fix the shared router in this same effort** so `temperance-route` / `temperance-dispatch` /
   `routed-execute.sh` stop being injectable too (one security pass).

## 5. The load-bearing realization

Every unsafe path in v1 traced to **the wrapper driving the router through text/JSON/execute
interfaces**. v2's core move:

> The wrapper reuses only the router's routing **logic** via a new additive `--route-only` mode
> (emits two safe tokens `backend⇥model`, no task echo, no JSON), and **owns execution itself** using
> argv arrays — never `eval`, never `--command`, never `--execute`.

That one decision closes G1, G2(parse-side), G4, G5, G6, G7, G16 structurally.

## 6. Architecture — artifacts

### A. `package/router/dispatch-tasklist.sh` (new — the wrapper)

The missing execution primitive. Reuses the router for **selection only**; owns **execution**.

**Input:** JSON array via `--tasks FILE` or stdin:
```json
[{ "id": "T1", "task": "refactor auth middleware", "backend": "auto", "model": "auto" },
 { "id": "T2", "task": "write tests for the rate limiter", "backend": "command-code",
   "model": "moonshotai/Kimi-K2.7-Code" }]
```
`id` + `task` required. `backend`/`model` optional, default `"auto"`.

**Flags:** `--tasks FILE`, `--out DIR` (default `mktemp -d`), `--worktree`, `--allow-dirty`,
`--concurrency N` (default 4), `--max-turns N` (default 10), `--timeout S` (default 0 = off),
`--foreground` (default: self-background, print run dir, return immediately), `--dry-run`.

**Behavior:**
1. **Resolve router** — `TEMPERANCE_ROUTER` env first; else symlink-safe resolution of
   `${BASH_SOURCE[0]}` via a `readlink` loop (not bare `dirname`, which breaks under the
   `$HOME/.local/bin/temperance-batch` symlink).
2. **Detect backends once**; export the list so the router does not re-run `command-code status`.
3. **Validate** — parse with `jq` (reject malformed batch, nonzero exit); sanitize each `id` against
   `^[A-Za-z0-9._-]+$` (reject batch on violation); reject duplicate ids.
4. **Select** — for `backend=auto`, `router --route-only "$task"` → `backend⇥model`.
   - route `inline` → mark `skipped:inline` (agent handles), **do not execute**.
   - route `none` / chosen backend not in detected set → mark `unavailable` (agent falls back to a
     Claude subagent for that task).
5. **Dispatch** with a **concurrency cap** (default 4 slots): each task runs via a backend-specific
   **argv function** (`command-code`/`kimi`/`grok`/`nvidia`), task text passed as a **single quoted
   argument**; nvidia body built with `jq --arg` (never interpolation). Optional per-task **worktree
   subshell** (`cd` into the worktree — real cwd isolation). Optional **watchdog timeout** that kills
   the task's **process group** (portable; no dependency on GNU `timeout`, which is absent on macOS).
6. **Record** — each task writes `<id>.out` (raw stdout) and `<id>.meta.json` written **atomically**
   (`tmp`→`mv`): `{id, backend, model, exit, duration_s, status, worktree?, diff_path?}`.
7. **Assemble** — after all tasks, write `index.json` atomically from the meta files, plus a small
   `SUMMARY.md` (per-task status + first ~15 lines of each output) so the agent can triage without
   reading every full `<id>.out`.
8. **Exit 0** whenever the batch ran; nonzero **only** on invocation error (bad JSON/flags/no router).

**Fail-open:** router unresolved or zero backends → exit with a distinct `EXTERNAL_RAIL_UNAVAILABLE`
marker so the skill routes **all** tasks to Claude subagents. The external rail can never dead-end the
flow.

### B. `package/router/multi-backend-router.sh` (harden — backward-compatible)

| Patch | Change | Closes |
|---|---|---|
| B1 | add `--route-only` → prints `backend\tmodel`, or `inline\t-`, or `none\t-`. No JSON, no task echo. | G1, G2(parse), G16 |
| B2 | `output_json()` builds JSON with `jq -n --arg` (was raw `cat <<EOF` interpolation) | G2 |
| B3 | `execute_route()` nvidia body built with `jq -n --arg` (was raw interpolation) | G2 |
| B4 | `detect_backends()` honors `TEMPERANCE_BACKENDS` env (skips ~10 s `command-code status` when caller supplies the list) | G7 |
| B5 | add `--model <id>` flag (force model within backend) | G6 |
| B6 | `--execute` on an `inline` task returns distinct **exit 3** (was silent `exit 0`), so programmatic callers can tell "not executed" from "executed OK" | G4 |
| B7 | zero backends → `--route-only` emits `none` (not phantom `command-code:claude-sonnet-5`) | G16 |
| B8 | `generate_command()` gets a `# DISPLAY ONLY — never eval` header | G1 |

Backward compatibility: existing `--json`/`--execute`/`--command`/`--backend`/`--list-backends`
behaviors preserved (changes are additive or internal-encoding); covered by regression tests (§9).

### C. Skill / protocol install (discovery fix)

- `skills/temperance-parallel-dispatch/SKILL.md` — repo source of truth, **Claude Code skill
  frontmatter** (`name` + `description` only, in the format the Skill tool registers).
- `install.sh` installs it to `$HOME/.claude/skills/temperance-parallel-dispatch/` (backup-first) so
  it is **actually invocable** — a repo `skills/` file is not auto-registered (verified: the repo's
  `temperance-engine` skill uses skills.sh frontmatter and is absent from the live Skill-tool list).
- Protocol content: split → dispatch → integrate; the background+poll loop (read `index.json`/`SUMMARY.md`,
  not raw outputs, to protect context); fail-open fallback to Claude subagents on
  `unavailable`/`EXTERNAL_RAIL_UNAVAILABLE`; worktree integration steps.

### D. Docs + wiring

- `docs/parallel-dispatch.md` — add the routed rail to the decision tree + comparison table; state
  plainly that `superpowers:dispatching-parallel-agents` is the **Claude-subagent primitive** the
  routed skill builds on, and that the external rail requires `temperance-batch`.
- `scripts/wire-multi-backend.sh` — add `$HOME/.local/bin/temperance-batch` → `dispatch-tasklist.sh`
  (backup-first, non-destructive, symlink-safe).

### E. Tests (`tests/`)

- `tests/dispatch-tasklist.sh` — `--dry-run` auto-route (asserts argv, never executes); forced
  backend+model; malformed JSON rejected; bad/duplicate id rejected; inline task skipped; unavailable
  backend → fallback marker; concurrency cap respected; atomic `index.json` assembled; **injection
  regression**: task text containing `$(id)`, a `"`, an apostrophe, and a newline round-trips as
  literal text.
- `tests/router-hardening.sh` — `--route-only` output shape; `output_json` valid JSON for a
  quote/newline task; nvidia body valid JSON via jq (mocked); `--model` honored; inline → exit 3;
  zero backends → `none`; `TEMPERANCE_BACKENDS` honored (no `status` call).
- **Mock-backend integration test** — a fake `command-code` on `PATH` that echoes, to exercise the
  real dispatch→collect→atomic-write→assemble path without model spend (closes the "dry-run-only
  tests don't cover execution" coverage hole).

## 7. Data flow

```
Temperance Execute — 2+ independent, non-conflicting tasks
        │ invokes
        ▼
skill: temperance-parallel-dispatch (installed in ~/.claude/skills)
        │  ① agent SPLITS each task
   ┌────┴───────────────────────────────┐
   ▼                                     ▼
 needs live session / Claude tools     self-contained
   │                                     │  ② write JSON list, run wrapper (Bash, background)
   ▼                                     ▼
 Task/Agent tool (Claude subagents)    package/router/dispatch-tasklist.sh
   │                                     │  router --route-only  →  backend⇥model  (selection only)
   │                                     │  wrapper executes via argv array (no eval)
   │                                     │  concurrency-capped, optional worktree, optional watchdog
   │                                     ▼
   │                               run-dir/{<id>.out, <id>.meta.json, index.json, SUMMARY.md}
   └───────────────┬─────────────────────┘
                   ▼  ③ agent polls index.json / reads SUMMARY.md
          verify non-conflict → integrate → Verify phase
```

## 8. Error handling / safety (fail-open everywhere)

- Router unresolved / zero backends → `EXTERNAL_RAIL_UNAVAILABLE` → skill sends all tasks to Claude
  subagents.
- Chosen backend unavailable or task routes `inline` → per-task `unavailable`/`skipped` status → agent
  handles that task on the Claude rail / inline.
- `--worktree` on a dirty tree is refused unless `--allow-dirty` (worktree checks out committed HEAD;
  uncommitted work is not carried — documented, not silently wrong). Worktree creation failure → task
  marked failed, **never** silently run in cwd (avoids collision).
- Mid-batch death → per-task `.meta.json` is atomic; `index.json` assembled last, atomically; partial
  runs are inspectable, never half-written.
- "Exit 0 whenever the batch ran" is paired with the skill instruction to **check per-task `status`**
  in `index.json` (batch-ran ≠ tasks-succeeded).
- Backend CLIs run full-trust (`--trust`/`--yolo`/`--always-approve`); the trust boundary is the task
  author (the orchestrating agent). Task text embedding untrusted third-party content is the caller's
  responsibility; `--worktree` bounds the blast radius when used.

## 9. Verified gap register (implementation must satisfy)

| ID | Sev | Gap | Closed by |
|---|---|---|---|
| G1 | High | `eval` of `--command` = arbitrary command exec | wrapper never evals; §5, B8 |
| G2 | High | nvidia body + `--json` output raw-interpolated → injection/breakage | B2, B3; wrapper argv + jq |
| G3 | High | full-trust CLIs run in caller cwd; `--worktree` isolates nothing | wrapper `cd`s into worktree (A.5) |
| G7 | High | `command-code status` (~10 s) every call, ×2/task | B4 + detect-once (A.2) |
| G11 | High | Bash tool 600 s cap < batch runtime → orphans/partial state | background + poll + atomic writes (A.5–7) |
| G12 | High | repo `skills/` file not auto-registered | install to `~/.claude/skills` (C) |
| G4 | Med | `inline` → fake `exit 0` | B6 (exit 3) + wrapper skips (A.4) |
| G6 | Med | per-task model, no `--model` | B5 |
| G9 | Med | raw id as filename → traversal/collision | id sanitization (A.3) |
| G10 | Med | no atomic index; mid-batch death corrupts | atomic meta + assembled index (A.6–7) |
| G13 | Med | symlink breaks router resolution | `readlink` resolution + env (A.1) |
| G14 | Med | no concurrency cap | slot cap (A.5) |
| G15 | Med | `--timeout` needs absent GNU `timeout` | bash watchdog + pgroup kill (A.5) |
| G16 | Med | zero backends → phantom `command-code:sonnet` | B7 + wrapper availability check (A.4) |
| G18–G20 | Med | worktree: stale HEAD, branch collision, `git diff` misses untracked | `--allow-dirty` gate, unique branch `te-dispatch/<run>/<id>`, `git add -A && git diff --cached` (A.5) |
| G5 | Low | `--execute` chatter contaminates results | wrapper owns execution (A.5) |
| G17 | Low | `/tmp` + `$$` collisions | `mktemp -d` run dir (A.6) |
| ~~G8~~ | — | ~~`((id++))` set -e abort~~ | **refuted** — survives on bash 5.3 (empirical test) |

## 10. Rollout / rollback

- All additive; router edits backward-compatible + regression-tested.
- Skill install and `temperance-batch` symlink go through `wire-multi-backend.sh` /
  `install.sh` (backup-first); `wire-multi-backend.sh --revert` removes symlinks.
- Router changes revertable via git; the bridge does not touch live hooks, `routing.ts`, or the
  superpowers skill.
- All paths generalized through `$HOME` / env vars (no hard-coded usernames).

## 11. Open follow-ups (not this spec)

- Unify the three routing brains (`route-task.sh` / `multi-backend-router.sh` / `routing.ts`).
- Auto-merge worktree diffs.
- Optionally surface `skill=temperance-parallel-dispatch` in the enrichment `routing:` line.
