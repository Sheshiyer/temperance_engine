# Routed Parallel Dispatch Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Temperance Execute flow to actually invoke command-code/kimi/grok/nvidia backends for independent tasks, safely, past the harness's execution-time cap.

**Architecture:** A new wrapper (`dispatch-tasklist.sh`) reuses the shared router for *selection only* (a new additive `--route-only` mode) and *owns execution itself* via argv arrays — never `eval`, never string-interpolated JSON. Batches run backgrounded with polling. The shared router (`multi-backend-router.sh`) is hardened in the same pass (jq-built JSON, honest inline/zero-backend, `--model`). An installed skill teaches the orchestrator the split→dispatch→integrate protocol.

**Tech Stack:** Bash 5.x (homebrew, `bash4+` for `declare -A`), `jq`, `git` (worktrees), Claude Code skill install.

## Global Constraints

_Every task's requirements implicitly include this section._

- **Paths generalized through `$HOME` / env vars** — no hard-coded usernames anywhere.
- **Fail-open everywhere** — the external rail can never dead-end the flow; on any doubt, fall back to Claude subagents.
- **Bash target is 5.x** (invoked via `#!/usr/bin/env bash`; homebrew bash is first in PATH). `declare -A` requires bash4+.
- **`jq` is required** for all JSON encode/decode — never build JSON by string interpolation.
- **No GNU `timeout`/`gtimeout`** on macOS — timeouts use a portable bash watchdog with recursive descendant kill.
- **Router changes are backward-compatible** — existing `--json`/`--execute`/`--command`/`--backend`/`--list-backends` keep working; every change is additive or internal-encoding and covered by a regression test.
- **Non-destructive install** — anything written outside the repo is backup-first (via `wire-multi-backend.sh` / `install.sh`).
- **TDD, DRY, YAGNI, frequent commits.** All new tests runnable offline via `--dry-run` or a mock backend on `PATH` — never spend real backend tokens in tests.

---

## Shared Contracts (locked — all tasks conform)

**Files:**
- `package/router/multi-backend-router.sh` — hardened (tasks R1–R3).
- `package/router/dispatch-tasklist.sh` — new wrapper (tasks W1–W8).
- `skills/temperance-parallel-dispatch/SKILL.md` — new skill (task I1).
- `tests/router-hardening.sh`, `tests/dispatch-tasklist.sh`, `tests/fixtures/mock-backend` — new tests.

**Router `--route-only` contract:**
`multi-backend-router.sh --route-only [--backend B] [--model M] "task text"` prints exactly one line to stdout:
```
BACKEND<TAB>MODEL
```
`BACKEND ∈ {command-code,kimi,grok,nvidia,inline,none}`; `MODEL` is a model id or `-` (for `inline`/`none`). Exit 0. No other output on stdout.

**Router env override:** `TEMPERANCE_BACKENDS="command-code kimi grok"` (space-separated) overrides live detection in `detect_backends()`; empty string means "none available" (skips the ~10 s `command-code status` probe).

**Wrapper run-dir layout** (`$OUT`, default `mktemp -d`):
```
$OUT/tasks.json          # the validated input batch
$OUT/<id>.out            # raw stdout of the backend for task <id>
$OUT/<id>.meta.json      # per-task metadata (written atomically: tmp -> mv)
$OUT/index.json          # assembled last, atomically
$OUT/SUMMARY.md          # small, agent-facing triage view
```

**`<id>.meta.json` schema:**
```json
{ "id": "T1", "task": "...", "backend": "command-code", "model": "deepseek/deepseek-v4-flash",
  "exit": 0, "duration_s": 42, "status": "ok", "worktree": null, "diff_path": null }
```
`status ∈ {ok, failed, timeout, skipped:inline, unavailable}`.

**`index.json` schema:**
```json
{ "run_dir": "/abs/path", "tasks": [ <meta>, ... ],
  "summary": { "ok": 2, "failed": 0, "timeout": 0, "skipped": 1, "unavailable": 0 } }
```

**Fail-open marker:** when the router can't be resolved or zero backends are available, the wrapper prints the literal token `EXTERNAL_RAIL_UNAVAILABLE` to stderr and exits 2. The skill treats this as "run every task as a Claude subagent."

**Task-id rule:** `^[A-Za-z0-9._-]+$`; duplicates and violations reject the whole batch (exit 1).

**Wrapper backend functions:** `run_command_code`, `run_kimi`, `run_grok`, `run_nvidia`, each called as `run_X "$task" "$model" "$outfile"` and returning the backend's exit code. Task text is always passed as a single quoted argv element; nvidia body is built with `jq --arg`.

---

## Task R1: Router `--route-only` selection mode + backend override

**Files:**
- Modify: `package/router/multi-backend-router.sh` (`detect_backends()` ~L37; `main()` arg loop ~L411; add `route_only()` + `--model`)
- Test: `tests/router-hardening.sh` (new)

**Interfaces:**
- Produces: `--route-only [--backend B] [--model M] "task"` → `BACKEND\tMODEL`; `TEMPERANCE_BACKENDS` env override; `--model` global flag stored in `$FORCE_MODEL`.

- [ ] **Step 1: Write the failing test**

Create `tests/router-hardening.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail
R="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/package/router/multi-backend-router.sh"
fail=0
check() { # desc, expected, actual
  if [[ "$2" == "$3" ]]; then echo "ok - $1"; else echo "FAIL - $1: expected [$2] got [$3]"; fail=1; fi
}

# route-only emits BACKEND<TAB>MODEL for a coding task when command-code is available
out=$(TEMPERANCE_BACKENDS="command-code" "$R" --route-only "refactor the entire auth layer")
check "route-only long-horizon -> command-code kimi model" \
  "command-code	moonshotai/Kimi-K2.7-Code" "$out"

# zero backends -> none<TAB>-
out=$(TEMPERANCE_BACKENDS="" "$R" --route-only "refactor the entire auth layer")
check "route-only zero backends -> none" "none	-" "$out"

# inline task -> inline<TAB>-
out=$(TEMPERANCE_BACKENDS="command-code" "$R" --route-only "summarize these three bullet points")
check "route-only inline" "inline	-" "$out"

# forced backend + model
out=$(TEMPERANCE_BACKENDS="command-code" "$R" --route-only --backend command-code --model gpt-5.5 "quick fix")
check "route-only forced backend+model" "command-code	gpt-5.5" "$out"

exit $fail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/router-hardening.sh`
Expected: FAIL — `--route-only` unknown / prints usage.

- [ ] **Step 3: Write minimal implementation**

In `multi-backend-router.sh`, make `detect_backends()` honor the env override — add at the very top of the function body:
```bash
detect_backends() {
  if [[ -n "${TEMPERANCE_BACKENDS+x}" ]]; then
    # Caller supplied the list (may be empty = none). Skip the ~10s status probe.
    echo "${TEMPERANCE_BACKENDS}"
    return
  fi
  local backends=()
  # ... existing detection unchanged ...
```

Add a `route_only()` function (near `select_route`):
```bash
route_only() {
  local desc="$1"
  local task_type
  task_type=$(analyze_task_type "$desc")
  if [[ "$task_type" == "inline" ]]; then
    printf 'inline\t-\n'; return
  fi
  local avail
  avail=$(detect_backends)
  if [[ -z "${avail// }" ]]; then
    printf 'none\t-\n'; return
  fi
  local route
  route=$(select_route "$task_type" "$FORCE_BACKEND")
  local backend="${route%%:*}" model="${route#*:}"
  [[ -n "$FORCE_MODEL" ]] && model="$FORCE_MODEL"
  # Guard the phantom fallback: if selected backend is not actually available, report none.
  if ! echo " $avail " | grep -q " $backend "; then
    printf 'none\t-\n'; return
  fi
  printf '%s\t%s\n' "$backend" "$model"
}
```

In `main()`, add state and flags (`FORCE_BACKEND` already exists as `force_backend`; introduce module-level `FORCE_MODEL`, `FORCE_BACKEND`):
```bash
  local route_only_mode=false
  FORCE_MODEL=""
  FORCE_BACKEND=""
  # in the arg loop:
      --route-only) route_only_mode=true; shift ;;
      --model) FORCE_MODEL="$2"; shift 2 ;;
      --backend) FORCE_BACKEND="$2"; shift 2 ;;   # replaces the old local force_backend
  # after arg loop, before the existing analyze/select block:
  if $route_only_mode; then route_only "$desc"; exit 0; fi
```
Declare `FORCE_MODEL`/`FORCE_BACKEND` with `declare -g` at top of `main()` (or as script globals) so `route_only()` sees them. Replace remaining uses of `force_backend` with `$FORCE_BACKEND`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/router-hardening.sh`
Expected: PASS — all four `route-only` checks ok.

- [ ] **Step 5: Commit**

```bash
git add package/router/multi-backend-router.sh tests/router-hardening.sh
git commit -m "feat(router): add --route-only selection mode + TEMPERANCE_BACKENDS/--model"
```

---

## Task R2: Router safe JSON encoding (`--json` output + nvidia body)

**Files:**
- Modify: `package/router/multi-backend-router.sh` (`output_json()` ~L323; `execute_route()` nvidia branch ~L301)
- Test: `tests/router-hardening.sh` (extend)

**Interfaces:**
- Produces: `--json "task"` always emits RFC-8259-valid JSON regardless of quotes/newlines in the task; `nvidia_body(model, desc)` helper emits valid JSON.

- [ ] **Step 1: Write the failing test**

Append to `tests/router-hardening.sh` (before `exit $fail`):
```bash
# --json with a task containing a double quote and newline is still valid JSON
tricky=$'say "hello"\nand run $(id)'
if TEMPERANCE_BACKENDS="command-code" "$R" --json "$tricky" | jq -e . >/dev/null 2>&1; then
  echo "ok - --json valid for quote/newline task"
else
  echo "FAIL - --json produced invalid JSON for tricky task"; fail=1
fi

# nvidia body helper builds valid JSON with a quote in the task
if body=$("$R" --emit-nvidia-body "nvidia/x" 'he said "hi"') && echo "$body" | jq -e '.messages[0].content' >/dev/null 2>&1; then
  echo "ok - nvidia body valid JSON"
else
  echo "FAIL - nvidia body invalid JSON"; fail=1
fi
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/router-hardening.sh`
Expected: FAIL — tricky `--json` output is invalid; `--emit-nvidia-body` unknown.

- [ ] **Step 3: Write minimal implementation**

Rewrite `output_json()` body to build with jq:
```bash
output_json() {
  local desc="$1" task_type="$2" route="$3"
  local backend="${route%%:*}" model="${route#*:}"
  local info="${MODEL_CATALOG[$route]:-unknown:unknown:unknown}"
  local tier="${info%%:*}" rest="${info#*:}"
  local strength="${rest%%:*}" context="${rest#*:}"
  jq -n --arg task "$desc" --arg tt "$task_type" --arg b "$backend" --arg m "$model" \
        --arg tier "$tier" --arg s "$strength" --arg c "$context" --arg avail "$(detect_backends)" \
    '{task:$task, task_type:$tt, backend:$b, model:$m, tier:$tier, strength:$s,
      context_window:$c, available_backends:$avail}'
}
```

Add a reusable body helper and route the nvidia execution through it:
```bash
nvidia_body() {  # model, desc  -> stdout JSON
  jq -n --arg m "$1" --arg c "$2" \
    '{model:$m, messages:[{role:"user", content:$c}], max_tokens:4096}'
}
```
In `execute_route()` nvidia branch, replace the interpolated `-d "{...}"` with:
```bash
    nvidia)
      curl -s https://integrate.api.nvidia.com/v1/chat/completions \
        -H "Authorization: Bearer $NVIDIA_API_KEY" -H "Content-Type: application/json" \
        -d "$(nvidia_body "$model" "$desc")" \
        | jq -r '.choices[0].message.content // .error.message // "Error"'
      ;;
```
Add a tiny debug entrypoint in `main()`'s arg loop so the helper is testable offline:
```bash
      --emit-nvidia-body) nvidia_body "$2" "$3"; exit 0 ;;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/router-hardening.sh`
Expected: PASS — both new checks ok, plus R1 checks still ok.

- [ ] **Step 5: Commit**

```bash
git add package/router/multi-backend-router.sh tests/router-hardening.sh
git commit -m "fix(router): build --json output and nvidia body with jq (kill JSON injection)"
```

---

## Task R3: Router honest inline exit code + display-only guard

**Files:**
- Modify: `package/router/multi-backend-router.sh` (`main()` inline branch ~L443; `generate_command()` ~L232)
- Test: `tests/router-hardening.sh` (extend)

**Interfaces:**
- Produces: `--execute` on an inline task exits `3` (not `0`); `generate_command()` carries a display-only banner.

- [ ] **Step 1: Write the failing test**

Append to `tests/router-hardening.sh`:
```bash
# --execute on an inline-classified task must NOT masquerade as success
TEMPERANCE_BACKENDS="command-code" "$R" --execute "summarize these bullet points" >/dev/null 2>&1
check "inline --execute exit code" "3" "$?"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/router-hardening.sh`
Expected: FAIL — inline `--execute` currently exits 0.

- [ ] **Step 3: Write minimal implementation**

In `main()`, the inline handler currently `exit 0` for both `--json` and human. Make the non-json inline path exit 3:
```bash
  if [[ "$task_type" == "inline" ]]; then
    if $json; then
      echo '{"task_type":"inline","executor":"inline","reason":"one-shot extraction, no external dispatch"}'
      exit 0
    else
      echo "Task type:    inline"
      echo "Executor:     inline (handle in current session)"
      echo "Reason:       one-shot extraction, no external dispatch needed"
      $execute && exit 3   # signal 'not executed' to programmatic callers
      exit 0
    fi
  fi
```
Add a banner as the first line of `generate_command()`:
```bash
generate_command() {
  echo "# DISPLAY ONLY -- never eval; use --route-only + argv execution instead"
  # ... existing body ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/router-hardening.sh`
Expected: PASS — inline exit-code check ok; all prior checks ok.

- [ ] **Step 5: Commit**

```bash
git add package/router/multi-backend-router.sh tests/router-hardening.sh
git commit -m "fix(router): inline --execute returns exit 3; mark generate_command display-only"
```

---

## Task W1: Wrapper skeleton — resolve router, validate batch, `--dry-run`

**Files:**
- Create: `package/router/dispatch-tasklist.sh`
- Test: `tests/dispatch-tasklist.sh` (new)

**Interfaces:**
- Produces: symlink-safe router resolution (`TEMPERANCE_ROUTER` else readlink of `$0`); JSON batch parse via `jq`; id sanitize `^[A-Za-z0-9._-]+$`; dup rejection; `--dry-run` prints one `id backend model` line per task.
- Consumes: Task R1 `--route-only`.

- [ ] **Step 1: Write the failing test**

Create `tests/dispatch-tasklist.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$DIR/package/router/dispatch-tasklist.sh"
export TEMPERANCE_ROUTER="$DIR/package/router/multi-backend-router.sh"
export TEMPERANCE_BACKENDS="command-code"
fail=0
check(){ if [[ "$2" == "$3" ]]; then echo "ok - $1"; else echo "FAIL - $1: exp[$2] got[$3]"; fail=1; fi; }

# malformed JSON rejected (exit 1)
echo 'not json' | "$W" --dry-run --tasks - >/dev/null 2>&1
check "malformed json rejected" "1" "$?"

# bad id rejected
echo '[{"id":"../evil","task":"x"}]' | "$W" --dry-run --tasks - >/dev/null 2>&1
check "bad id rejected" "1" "$?"

# duplicate id rejected
echo '[{"id":"T1","task":"a"},{"id":"T1","task":"b"}]' | "$W" --dry-run --tasks - >/dev/null 2>&1
check "dup id rejected" "1" "$?"

# dry-run prints a routing line per task
out=$(printf '%s' '[{"id":"T1","task":"refactor the entire module"}]' | "$W" --dry-run --tasks - 2>/dev/null)
check "dry-run routes T1 to command-code" "T1 command-code moonshotai/Kimi-K2.7-Code" "$out"

exit $fail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/dispatch-tasklist.sh`
Expected: FAIL — `dispatch-tasklist.sh` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `package/router/dispatch-tasklist.sh`:
```bash
#!/usr/bin/env bash
# package/router/dispatch-tasklist.sh
# Route a JSON task list to backends via multi-backend-router.sh (selection only)
# and execute each task via argv arrays. Never evals router output.
set -uo pipefail   # NOT -e: per-task failures are recorded, never abort the batch

# --- resolve this script's real path (symlink-safe) ---
self_path() {
  local src="${BASH_SOURCE[0]}"
  while [[ -L "$src" ]]; do
    local dir; dir="$(cd -P "$(dirname "$src")" && pwd)"
    src="$(readlink "$src")"; [[ "$src" != /* ]] && src="$dir/$src"
  done
  cd -P "$(dirname "$src")" && pwd
}
SCRIPT_DIR="$(self_path)"
ROUTER="${TEMPERANCE_ROUTER:-$SCRIPT_DIR/multi-backend-router.sh}"

DRY_RUN=false; TASKS_FILE=""; OUT=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --tasks) TASKS_FILE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

[[ -x "$ROUTER" ]] || { echo "EXTERNAL_RAIL_UNAVAILABLE" >&2; echo "router not found: $ROUTER" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

# Detect backends ONCE and export, so every per-task --route-only call skips the
# ~10s `command-code status` probe (closes G7 on the wrapper path). If the caller
# already set TEMPERANCE_BACKENDS (e.g. tests), respect it.
if [[ -z "${TEMPERANCE_BACKENDS+x}" ]]; then
  export TEMPERANCE_BACKENDS="$("$ROUTER" --list-backends 2>/dev/null | sed 's/^.*: //')"
fi
AVAIL="$TEMPERANCE_BACKENDS"

# --- read + validate batch ---
raw="$(cat -- "${TASKS_FILE:-/dev/stdin}")"
echo "$raw" | jq -e 'type=="array"' >/dev/null 2>&1 || { echo "invalid task JSON (expected array)" >&2; exit 1; }

# id sanity + dup detection
ids="$(echo "$raw" | jq -r '.[].id')"
while IFS= read -r id; do
  [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid task id: $id" >&2; exit 1; }
done <<< "$ids"
if [[ "$(echo "$ids" | sort | uniq -d)" != "" ]]; then echo "duplicate task id(s)" >&2; exit 1; fi

# --- per-task routing (selection only) ---
route_task() { # id task backend model  -> echoes "backend<TAB>model"
  local task="$2" backend="$3" model="$4" args=(--route-only)
  [[ -n "$backend" && "$backend" != "auto" ]] && args+=(--backend "$backend")
  [[ -n "$model"   && "$model"   != "auto" ]] && args+=(--model "$model")
  "$ROUTER" "${args[@]}" "$task"
}

# iterate tasks
n=$(echo "$raw" | jq 'length')
for ((i=0; i<n; i++)); do
  id=$(echo "$raw"   | jq -r ".[$i].id")
  task=$(echo "$raw" | jq -r ".[$i].task")
  backend=$(echo "$raw" | jq -r ".[$i].backend // \"auto\"")
  model=$(echo "$raw"   | jq -r ".[$i].model // \"auto\"")
  IFS=$'\t' read -r rb rm < <(route_task "$id" "$task" "$backend" "$model")
  if $DRY_RUN; then echo "$id $rb $rm"; fi
done
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/dispatch-tasklist.sh`
Expected: PASS — all four checks ok.

- [ ] **Step 5: Commit**

```bash
git add package/router/dispatch-tasklist.sh tests/dispatch-tasklist.sh
git commit -m "feat(dispatch): wrapper skeleton — resolve router, validate batch, --dry-run routing"
```

---

## Task W2: Wrapper task classification (auto / forced / inline / unavailable)

**Files:**
- Modify: `package/router/dispatch-tasklist.sh` (routing loop)
- Test: `tests/dispatch-tasklist.sh` (extend)

**Interfaces:**
- Produces: each task classified into `dispatch` (rb ∈ real backends), `skipped:inline` (rb=inline), or `unavailable` (rb=none). Classification stored per task for W3/W4.

- [ ] **Step 1: Write the failing test**

Append to `tests/dispatch-tasklist.sh`:
```bash
# inline task is marked skipped:inline in dry-run
out=$(printf '%s' '[{"id":"S1","task":"summarize these points"}]' | "$W" --dry-run --tasks - 2>/dev/null)
check "inline -> skipped" "S1 skipped:inline" "$out"

# with zero backends, a coding task is unavailable
out=$(printf '%s' '[{"id":"U1","task":"refactor everything"}]' | TEMPERANCE_BACKENDS="" "$W" --dry-run --tasks - 2>/dev/null)
check "zero backends -> unavailable" "U1 unavailable" "$out"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/dispatch-tasklist.sh`
Expected: FAIL — dry-run still prints `S1 inline -` / `U1 none -`, not the status words.

- [ ] **Step 3: Write minimal implementation**

Replace the dry-run print in the loop with classification:
```bash
  status="dispatch"
  case "$rb" in
    inline) status="skipped:inline" ;;
    none)   status="unavailable" ;;
  esac
  if $DRY_RUN; then
    if [[ "$status" == "dispatch" ]]; then echo "$id $rb $rm"; else echo "$id $status"; fi
    continue
  fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/dispatch-tasklist.sh`
Expected: PASS — inline and unavailable checks ok; W1 dispatch line still ok.

- [ ] **Step 5: Commit**

```bash
git add package/router/dispatch-tasklist.sh tests/dispatch-tasklist.sh
git commit -m "feat(dispatch): classify tasks into dispatch/skipped/unavailable"
```

---

## Task W3: Safe backend execution + injection regression

**Files:**
- Modify: `package/router/dispatch-tasklist.sh` (add `run_*` argv functions + execution)
- Create: `tests/fixtures/mock-backend`
- Test: `tests/dispatch-tasklist.sh` (extend)

**Interfaces:**
- Produces: `run_command_code`/`run_kimi`/`run_grok`/`run_nvidia "$task" "$model" "$outfile"`; execution writes `$OUT/<id>.out`. Task text reaches the backend as a single literal argv element (no shell/JSON injection).
- Consumes: mock backend on `PATH` echoing its `-p` argument.

- [ ] **Step 1: Write the failing test**

Create `tests/fixtures/mock-backend` (chmod +x it in the test):
```bash
#!/usr/bin/env bash
# Mock command-code/kimi/grok: print the prompt passed via -p (or last arg) verbatim.
prompt=""; prev=""
for a in "$@"; do [[ "$prev" == "-p" ]] && prompt="$a"; prev="$a"; done
[[ -z "$prompt" ]] && prompt="${!#}"
printf 'MOCK_OUTPUT_START\n%s\nMOCK_OUTPUT_END\n' "$prompt"
```

Append to `tests/dispatch-tasklist.sh`:
```bash
# injection regression: task text with $(), quotes, apostrophe, newline round-trips literally
chmod +x "$DIR/tests/fixtures/mock-backend"
export PATH="$DIR/tests/fixtures:$PATH"
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
payload='[{"id":"INJ","task":"run $(touch /tmp/pwned) and say \"don'\''t\" now","backend":"command-code","model":"x"}]'
printf '%s' "$payload" | "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
got=$(sed -n '/MOCK_OUTPUT_START/,/MOCK_OUTPUT_END/p' "$run/INJ.out" | sed '1d;$d')
check "task text passed literally (no eval)" 'run $(touch /tmp/pwned) and say "don'\''t" now' "$got"
[[ -e /tmp/pwned ]] && { echo "FAIL - injection executed!"; fail=1; rm -f /tmp/pwned; }
rm -f "$DIR/tests/fixtures/command-code"
```
(Note: `--foreground` lands in W5; for this task, make the wrapper foreground-by-default temporarily — W5 adds backgrounding and this test already passes `--foreground`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/dispatch-tasklist.sh`
Expected: FAIL — no execution yet; `$run/INJ.out` absent.

- [ ] **Step 3: Write minimal implementation**

Add argv backend functions (task text always a single quoted arg):
```bash
run_command_code(){ command-code -p "$1" --model "$2" --max-turns "${MAX_TURNS:-10}" --trust --skip-onboarding >"$3" 2>&1; }
run_kimi(){ kimi --print --yolo --model "$2" -p "$1" >"$3" 2>&1; }
run_grok(){ "$HOME/.grok/bin/grok" --model "$2" --always-approve "$1" >"$3" 2>&1; }
run_nvidia(){ curl -s https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer ${NVIDIA_API_KEY:-}" -H "Content-Type: application/json" \
  -d "$(jq -n --arg m "$2" --arg c "$1" '{model:$m,messages:[{role:"user",content:$c}],max_tokens:4096}')" \
  | jq -r '.choices[0].message.content // .error.message // "Error"' >"$3" 2>&1; }

dispatch_backend(){ # backend task model outfile -> exit code
  case "$1" in
    command-code) run_command_code "$2" "$3" "$4" ;;
    kimi) run_kimi "$2" "$3" "$4" ;;
    grok) run_grok "$2" "$3" "$4" ;;
    nvidia) run_nvidia "$2" "$3" "$4" ;;
    *) echo "unknown backend: $1" >"$4"; return 1 ;;
  esac
}
```
Add `--out`/`--foreground`/`--max-turns` handling and, in the loop, when `status == dispatch`, execute:
```bash
  [[ -z "$OUT" ]] && OUT="$(mktemp -d)"
  mkdir -p "$OUT"
  # ... inside loop, dispatch branch:
  dispatch_backend "$rb" "$task" "$rm" "$OUT/$id.out"
```
For this task run sequentially and foreground; concurrency/meta come in W4. Ensure `--foreground` and `--max-turns` are accepted flags (no-op ok for now).

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/dispatch-tasklist.sh`
Expected: PASS — output equals the literal task text; `/tmp/pwned` never created.

- [ ] **Step 5: Commit**

```bash
git add package/router/dispatch-tasklist.sh tests/dispatch-tasklist.sh tests/fixtures/mock-backend
git commit -m "feat(dispatch): argv backend execution + injection regression (mock backend)"
```

---

## Task W4: Concurrency cap + atomic meta + index.json + SUMMARY.md

**Files:**
- Modify: `package/router/dispatch-tasklist.sh`
- Test: `tests/dispatch-tasklist.sh` (extend)

**Interfaces:**
- Produces: `--concurrency N` (default 4); per-task `<id>.meta.json` atomic; assembled `index.json` + `SUMMARY.md`. meta/index conform to Shared Contracts schema.

- [ ] **Step 1: Write the failing test**

Append to `tests/dispatch-tasklist.sh`:
```bash
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
printf '%s' '[{"id":"A","task":"refactor all files","backend":"command-code","model":"x"},
             {"id":"B","task":"refactor all files","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
# index.json valid + 2 ok tasks
ok=$(jq -r '.summary.ok' "$run/index.json" 2>/dev/null)
check "index.json summary.ok" "2" "$ok"
# per-task meta present + status ok
st=$(jq -r '.status' "$run/A.meta.json" 2>/dev/null)
check "A meta status ok" "ok" "$st"
# SUMMARY.md exists
[[ -f "$run/SUMMARY.md" ]] && echo "ok - SUMMARY.md written" || { echo "FAIL - no SUMMARY.md"; fail=1; }
rm -f "$DIR/tests/fixtures/command-code"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/dispatch-tasklist.sh`
Expected: FAIL — no `index.json`/`meta.json`/`SUMMARY.md` yet.

- [ ] **Step 3: Write minimal implementation**

Add a concurrency-capped dispatch with a slot loop and atomic meta writes. Replace the inline execute with a queued `run_one`:
```bash
CONCURRENCY="${CONCURRENCY:-4}"   # add --concurrency flag to parse loop

write_meta(){ # id task backend model exit dur status  -> atomic
  local f="$OUT/$1.meta.json"
  jq -n --arg id "$1" --arg task "$2" --arg b "$3" --arg m "$4" \
        --argjson ex "$5" --argjson d "$6" --arg st "$7" \
    '{id:$id,task:$task,backend:$b,model:$m,exit:$ex,duration_s:$d,status:$st,worktree:null,diff_path:null}' \
    > "$f.tmp" && mv -f "$f.tmp" "$f"
}

run_one(){ # id task rb rm
  local id="$1" task="$2" rb="$3" rm="$4" start end dur ex
  start=$(date +%s)
  dispatch_backend "$rb" "$task" "$rm" "$OUT/$id.out"; ex=$?
  end=$(date +%s); dur=$((end-start))
  local st="ok"; [[ $ex -ne 0 ]] && st="failed"
  write_meta "$id" "$task" "$rb" "$rm" "$ex" "$dur" "$st"
}
```
In the loop, instead of executing inline: for `dispatch` write nothing yet but launch `run_one ... &` respecting the cap; for `skipped:inline`/`unavailable` write a meta immediately with that status:
```bash
  case "$status" in
    dispatch)
      while (( $(jobs -rp | wc -l) >= CONCURRENCY )); do wait -n; done
      run_one "$id" "$task" "$rb" "$rm" &
      ;;
    *) write_meta "$id" "$task" "$rb" "$rm" 0 0 "$status" ;;
  esac
```
After the loop: `wait` for all, then assemble:
```bash
wait
if ! $DRY_RUN; then
  jq -s --arg dir "$OUT" '{run_dir:$dir, tasks:., summary:{
     ok:(map(select(.status=="ok"))|length),
     failed:(map(select(.status=="failed"))|length),
     timeout:(map(select(.status=="timeout"))|length),
     skipped:(map(select(.status|startswith("skipped")))|length),
     unavailable:(map(select(.status=="unavailable"))|length)}}' \
     "$OUT"/*.meta.json > "$OUT/index.json.tmp" && mv -f "$OUT/index.json.tmp" "$OUT/index.json"
  { echo "# Dispatch run: $OUT"; echo
    jq -r '.tasks[] | "- [\(.status)] \(.id) (\(.backend):\(.model)) exit=\(.exit) \(.duration_s)s"' "$OUT/index.json"
  } > "$OUT/SUMMARY.md"
  echo "$OUT"
fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/dispatch-tasklist.sh`
Expected: PASS — `summary.ok=2`, `A.meta.json` status ok, SUMMARY.md present.

- [ ] **Step 5: Commit**

```bash
git add package/router/dispatch-tasklist.sh tests/dispatch-tasklist.sh
git commit -m "feat(dispatch): concurrency cap, atomic meta, assembled index.json + SUMMARY.md"
```

---

## Task W5: Background execution + poll contract

**Files:**
- Modify: `package/router/dispatch-tasklist.sh`
- Test: `tests/dispatch-tasklist.sh` (extend)

**Interfaces:**
- Produces: default = self-background, print `$OUT` (run dir) to stdout, return within ~1 s; `--foreground` blocks until done. Run dir + `index.json` are the poll surface.

- [ ] **Step 1: Write the failing test**

Append to `tests/dispatch-tasklist.sh`:
```bash
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
start=$(date +%s)
printed=$(printf '%s' '[{"id":"BG","task":"refactor all","backend":"command-code","model":"x"}]' \
  | "$W" --out "$run" --tasks - 2>/dev/null)   # default backgrounds
elapsed=$(( $(date +%s) - start ))
check "background prints run dir" "$run" "$printed"
[[ $elapsed -le 3 ]] && echo "ok - returns fast (${elapsed}s)" || { echo "FAIL - blocked ${elapsed}s"; fail=1; }
# wait for completion then verify
for _ in $(seq 1 20); do [[ -f "$run/index.json" ]] && break; sleep 0.5; done
check "bg task eventually ok" "1" "$(jq -r '.summary.ok' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/dispatch-tasklist.sh`
Expected: FAIL — wrapper currently blocks in foreground and prints run dir at end.

- [ ] **Step 3: Write minimal implementation**

Add `FOREGROUND` state (`--foreground` sets it true; default false). Wrap the dispatch+assemble phase in a function `run_batch`, and at the point of dispatch:
```bash
if $FOREGROUND || $DRY_RUN; then
  run_batch          # existing loop + wait + assemble; prints $OUT at end
else
  ( run_batch >/dev/null 2>&1 ) &   # detached; run dir is the poll surface
  disown
  echo "$OUT"        # return immediately
fi
```
Ensure `$OUT` is resolved (mktemp if empty) *before* branching so the caller gets the path. Move the validation/routing that must happen synchronously (JSON parse, id checks) *before* the branch so bad batches still fail fast with exit 1.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/dispatch-tasklist.sh`
Expected: PASS — prints run dir, returns fast, task completes.

- [ ] **Step 5: Commit**

```bash
git add package/router/dispatch-tasklist.sh tests/dispatch-tasklist.sh
git commit -m "feat(dispatch): background-by-default with run-dir poll; --foreground to block"
```

---

## Task W6: Portable per-task watchdog timeout

**Files:**
- Modify: `package/router/dispatch-tasklist.sh`
- Test: `tests/dispatch-tasklist.sh` (extend)

**Interfaces:**
- Produces: `--timeout S` (default 0 = off); a timed-out task is killed with all descendants and recorded `status=timeout`, `exit=124`.

- [ ] **Step 1: Write the failing test**

Add a slow mode to the mock and a test:
```bash
# extend mock-backend: if task contains SLEEP=N, sleep N before output (add to fixture)
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
printf '%s' '[{"id":"TO","task":"SLEEP=5 refactor","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --timeout 1 --out "$run" --tasks - >/dev/null 2>&1
check "timed-out task status" "timeout" "$(jq -r '.tasks[0].status' "$run/index.json" 2>/dev/null)"
check "timed-out task exit" "124" "$(jq -r '.tasks[0].exit' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"
```
And append to `tests/fixtures/mock-backend` (after computing `prompt`):
```bash
if [[ "$prompt" == *SLEEP=* ]]; then s="${prompt#*SLEEP=}"; s="${s%% *}"; sleep "$s"; fi
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/dispatch-tasklist.sh`
Expected: FAIL — no timeout; task runs to completion, status ok.

- [ ] **Step 3: Write minimal implementation**

Add a portable descendant-kill and wrap the dispatch call in `run_one`:
```bash
TIMEOUT="${TIMEOUT:-0}"   # add --timeout flag

kill_tree(){ # pid — kill process and all descendants (portable, no setsid)
  local p="$1" c
  for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c"; done
  kill -TERM "$p" 2>/dev/null
}

# Single execution seam so timeout (W6) and worktree (W7) compose without
# either wrapping the other's command. TASK_WT is set per-task by run_one
# (empty unless --worktree); W7 fills it in.
TASK_WT=""
exec_task(){ # backend task model outfile
  if [[ -n "$TASK_WT" ]]; then ( cd "$TASK_WT" && dispatch_backend "$1" "$2" "$3" "$4" )
  else dispatch_backend "$1" "$2" "$3" "$4"; fi
}

# in run_one, dispatch through exec_task under an optional watchdog:
  TASK_WT=""   # default: no worktree (W7 sets this before this block)
  if (( TIMEOUT > 0 )); then
    exec_task "$rb" "$task" "$rm" "$OUT/$id.out" & local bpid=$!
    ( sleep "$TIMEOUT"; kill_tree "$bpid" ) & local wpid=$!
    if wait "$bpid" 2>/dev/null; then ex=0; else ex=$?; fi
    kill "$wpid" 2>/dev/null; wait "$wpid" 2>/dev/null
    # a SIGTERM-caused exit (>=128) after our watchdog fired == timeout
    if (( ex >= 128 )); then ex=124; fi
  else
    exec_task "$rb" "$task" "$rm" "$OUT/$id.out"; ex=$?
  fi
  local st="ok"
  (( ex == 124 )) && st="timeout" || { (( ex != 0 )) && st="failed"; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/dispatch-tasklist.sh`
Expected: PASS — status `timeout`, exit `124`.

- [ ] **Step 5: Commit**

```bash
git add package/router/dispatch-tasklist.sh tests/dispatch-tasklist.sh tests/fixtures/mock-backend
git commit -m "feat(dispatch): portable per-task watchdog timeout with descendant kill"
```

---

## Task W7: Worktree isolation

**Files:**
- Modify: `package/router/dispatch-tasklist.sh`
- Test: `tests/dispatch-tasklist.sh` (extend)

**Interfaces:**
- Produces: `--worktree`/`--allow-dirty`; per-task worktree on branch `te-dispatch/<run>/<id>`; backend runs with cwd = worktree; diff captured to `$OUT/<id>.diff`, `diff_path` set in meta. Dirty tree refused without `--allow-dirty`.

- [ ] **Step 1: Write the failing test**

Append to `tests/dispatch-tasklist.sh`:
```bash
# worktree mode against a scratch git repo
tmpgit=$(mktemp -d); ( cd "$tmpgit" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
( cd "$tmpgit" && printf '%s' '[{"id":"WT","task":"refactor all","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "worktree task ran" "ok" "$(jq -r '.tasks[0].status' "$run/index.json" 2>/dev/null)"
check "worktree recorded" "true" "$(jq -r '.tasks[0].worktree != null' "$run/index.json" 2>/dev/null)"
# dirty tree refused without --allow-dirty
( cd "$tmpgit" && echo dirty > f.txt && printf '%s' '[{"id":"D","task":"x","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --out "$(mktemp -d)" --tasks - >/dev/null 2>&1 )
check "dirty tree refused" "3" "$?"   # convention: exit 3 = dirty-tree guard
rm -f "$DIR/tests/fixtures/command-code"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/dispatch-tasklist.sh`
Expected: FAIL — `--worktree` unknown / no worktree recorded.

- [ ] **Step 3: Write minimal implementation**

Add flags `WORKTREE=false` (`--worktree`), `ALLOW_DIRTY=false` (`--allow-dirty`), and a run tag `RUNTAG` derived from `basename "$OUT"`. Guard dirty tree once, up front (synchronously, before dispatch):
```bash
if $WORKTREE && ! $ALLOW_DIRTY; then
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    echo "refusing --worktree on a dirty tree (use --allow-dirty)" >&2; exit 3
  fi
fi
```
In `run_one`, when `$WORKTREE`, create the worktree and set `TASK_WT` *before* the W6 watchdog block (so `exec_task` runs the backend inside it — timeout still composes), then capture the diff and tear down after:
```bash
  # --- place at the TOP of run_one, before the watchdog block ---
  local branch="" diffp=""
  TASK_WT=""
  if $WORKTREE; then
    branch="te-dispatch/${RUNTAG}/${id}"
    TASK_WT="$OUT/wt-$id"
    if ! git worktree add -q -b "$branch" "$TASK_WT" HEAD 2>/dev/null; then
      write_meta "$id" "$task" "$rb" "$rm" 1 0 "failed" "" ""; return
    fi
  fi
  # ... (existing W6 watchdog block runs here; exec_task cd's into TASK_WT) ...
  # --- after ex/st are computed, before write_meta ---
  if [[ -n "$TASK_WT" ]]; then
    diffp="$OUT/$id.diff"
    ( cd "$TASK_WT" && git add -A && git diff --cached ) > "$diffp" 2>/dev/null
    git worktree remove --force "$TASK_WT" 2>/dev/null
    git branch -D "$branch" 2>/dev/null
  fi
  write_meta "$id" "$task" "$rb" "$rm" "$ex" "$dur" "$st" "$branch" "$diffp"
```
Extend `write_meta` to take two trailing optional args (`worktree`, `diff_path`) and null-coalesce empties:
```bash
write_meta(){ # id task backend model exit dur status [worktree] [diff_path]
  local wt="${8:-}" dp="${9:-}"
  jq -n --arg id "$1" --arg task "$2" --arg b "$3" --arg m "$4" \
        --argjson ex "$5" --argjson d "$6" --arg st "$7" \
        --arg wt "$wt" --arg dp "$dp" \
    '{id:$id,task:$task,backend:$b,model:$m,exit:$ex,duration_s:$d,status:$st,
      worktree:(if $wt=="" then null else $wt end),
      diff_path:(if $dp=="" then null else $dp end)}' \
    > "$OUT/$1.meta.json.tmp" && mv -f "$OUT/$1.meta.json.tmp" "$OUT/$1.meta.json"
}
```
Update the earlier `write_meta` call sites (W4) to pass no worktree args (the `${8:-}`/`${9:-}` defaults keep them `null`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/dispatch-tasklist.sh`
Expected: PASS — worktree task ok, worktree recorded, dirty tree refused with exit 3.

- [ ] **Step 5: Commit**

```bash
git add package/router/dispatch-tasklist.sh tests/dispatch-tasklist.sh
git commit -m "feat(dispatch): opt-in worktree isolation with per-task branch + diff capture"
```

---

## Task W8: Fail-open marker end-to-end

**Files:**
- Modify: `package/router/dispatch-tasklist.sh`
- Test: `tests/dispatch-tasklist.sh` (extend)

**Interfaces:**
- Produces: unresolved router or zero backends → `EXTERNAL_RAIL_UNAVAILABLE` on stderr, exit 2 (already partly in W1 for router; add the zero-backends case pre-dispatch).

- [ ] **Step 1: Write the failing test**

Append to `tests/dispatch-tasklist.sh`:
```bash
# unresolved router -> marker + exit 2
err=$(printf '%s' '[{"id":"X","task":"y"}]' | TEMPERANCE_ROUTER=/nonexistent "$W" --tasks - 2>&1 >/dev/null)
check "router missing -> exit 2" "2" "$?"
echo "$err" | grep -q EXTERNAL_RAIL_UNAVAILABLE && echo "ok - marker on stderr" || { echo "FAIL - no marker"; fail=1; }

# zero backends AND all tasks unavailable -> marker + exit 2 (nothing external could run)
printf '%s' '[{"id":"X","task":"refactor all"}]' | TEMPERANCE_BACKENDS="" "$W" --foreground --tasks - >/dev/null 2>&1
check "zero backends -> exit 2" "2" "$?"

echo "=== dispatch-tasklist: $([[ $fail -eq 0 ]] && echo PASS || echo FAIL) ==="
exit $fail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/dispatch-tasklist.sh`
Expected: FAIL — zero-backends batch currently exits 0 with all tasks `unavailable`.

- [ ] **Step 3: Write minimal implementation**

After the routing pass, if **no** task was classified `dispatch` and the one-time `AVAIL` list (set in W1) is empty, emit the marker. This must run **synchronously before backgrounding** (W5), so the caller sees the exit-2 immediately:
```bash
# track during the routing loop:
any_dispatch=false; [[ "$status" == "dispatch" ]] && any_dispatch=true
# after the routing/classification loop, before the foreground/background branch:
if ! $any_dispatch && [[ -z "${AVAIL// }" ]]; then
  echo "EXTERNAL_RAIL_UNAVAILABLE" >&2; exit 2
fi
```
`AVAIL` is the wrapper's one-time backend list from W1 (honors `TEMPERANCE_BACKENDS`). Keep the router-missing check from W1 (already exits 2 with the marker).

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/dispatch-tasklist.sh`
Expected: PASS — both fail-open cases exit 2 with the marker; full suite prints PASS.

- [ ] **Step 5: Commit**

```bash
git add package/router/dispatch-tasklist.sh tests/dispatch-tasklist.sh
git commit -m "feat(dispatch): emit EXTERNAL_RAIL_UNAVAILABLE + exit 2 when external rail can't run"
```

---

## Task I1: The orchestration skill + installer

**Files:**
- Create: `skills/temperance-parallel-dispatch/SKILL.md`
- Modify: `install.sh` (add skill install step)
- Test: `tests/skill-install.sh` (new)

**Interfaces:**
- Produces: an invocable Claude Code skill installed to `$HOME/.claude/skills/temperance-parallel-dispatch/` (backup-first). Frontmatter is `name` + `description` only.

- [ ] **Step 1: Write the failing test**

Create `tests/skill-install.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
S="$DIR/skills/temperance-parallel-dispatch/SKILL.md"
[[ -f "$S" ]] && echo "ok - SKILL.md exists" || { echo "FAIL - no SKILL.md"; fail=1; }
# frontmatter has exactly name + description keys
keys=$(awk '/^---$/{n++;next} n==1{print}' "$S" | grep -E '^[a-z_]+:' | sed 's/:.*//' | sort | tr '\n' ',')
[[ "$keys" == "description,name," ]] && echo "ok - frontmatter name+description" || { echo "FAIL - frontmatter keys: $keys"; fail=1; }
# install.sh references the skill dir
grep -q "temperance-parallel-dispatch" "$DIR/install.sh" && echo "ok - install.sh installs skill" || { echo "FAIL - install.sh missing skill"; fail=1; }
exit $fail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/skill-install.sh`
Expected: FAIL — SKILL.md and install step absent.

- [ ] **Step 3: Write minimal implementation**

Create `skills/temperance-parallel-dispatch/SKILL.md`:
```markdown
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
```

In `install.sh`, add a backup-first skill install (near other install steps):
```bash
# Install temperance-parallel-dispatch skill (backup-first)
SKILL_SRC="$REPO_ROOT/skills/temperance-parallel-dispatch"
SKILL_DST="$HOME/.claude/skills/temperance-parallel-dispatch"
if [[ -d "$SKILL_SRC" ]]; then
  if [[ -e "$SKILL_DST" ]]; then cp -R "$SKILL_DST" "$SKILL_DST.bak.$(date +%Y%m%d_%H%M%S)"; fi
  mkdir -p "$HOME/.claude/skills"
  cp -R "$SKILL_SRC" "$SKILL_DST"
  echo "[install] temperance-parallel-dispatch skill -> $SKILL_DST"
fi
```
(Guard behind the same `--with-claude` gate if `install.sh` scopes Claude surfaces; otherwise unconditional is fine since it only writes under `~/.claude/skills`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/skill-install.sh`
Expected: PASS — all three checks ok.

- [ ] **Step 5: Commit**

```bash
git add skills/temperance-parallel-dispatch/SKILL.md install.sh tests/skill-install.sh
git commit -m "feat(skill): temperance-parallel-dispatch protocol + backup-first installer"
```

---

## Task I2: Wire `temperance-batch` CLI symlink

**Files:**
- Modify: `scripts/wire-multi-backend.sh` (install + status + revert)
- Test: `tests/dispatch-tasklist.sh` is unaffected; verify via `--dry-run` of the wiring script

**Interfaces:**
- Produces: `$HOME/.local/bin/temperance-batch` → `package/router/dispatch-tasklist.sh` (backup-first symlink); shown in `--status`; removed in `--revert`.

- [ ] **Step 1: Write the failing test**

Create `tests/wire-batch.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
out=$("$DIR/scripts/wire-multi-backend.sh" --dry-run 2>&1)
echo "$out" | grep -q "temperance-batch" && echo "ok - dry-run wires temperance-batch" || { echo "FAIL - no temperance-batch in dry-run"; fail=1; }
exit $fail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/wire-batch.sh`
Expected: FAIL — no `temperance-batch` mention.

- [ ] **Step 3: Write minimal implementation**

In `wire-multi-backend.sh` `install()`, alongside the existing `temperance-route`/`temperance-dispatch` symlinks:
```bash
  symlink "$REPO_ROOT/package/router/dispatch-tasklist.sh" "$HOME/.local/bin/temperance-batch"
```
In `check_status()` add a stanza reporting `temperance-batch`, and in `revert()` add:
```bash
  [[ -L "$HOME/.local/bin/temperance-batch" ]] && rm -f "$HOME/.local/bin/temperance-batch" && log "Removed: ~/.local/bin/temperance-batch"
```
(The existing `symlink()` helper is already backup-first.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/wire-batch.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/wire-multi-backend.sh tests/wire-batch.sh
git commit -m "feat(wire): expose dispatch-tasklist.sh as temperance-batch (backup-first)"
```

---

## Task I3: Update the parallel-dispatch decision doc

**Files:**
- Modify: `docs/parallel-dispatch.md`
- Test: `tests/docs-continuity.sh` (new, grep assertions)

**Interfaces:**
- Produces: decision tree + comparison table include the routed external rail; clarifies the superpowers skill is the Claude-subagent primitive.

- [ ] **Step 1: Write the failing test**

Create `tests/docs-continuity.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; D="$DIR/docs/parallel-dispatch.md"; fail=0
grep -q "temperance-batch" "$D" && echo "ok - doc mentions temperance-batch" || { echo "FAIL"; fail=1; }
grep -q "temperance-parallel-dispatch" "$D" && echo "ok - doc mentions the skill" || { echo "FAIL"; fail=1; }
grep -qi "Claude-subagent primitive" "$D" && echo "ok - clarifies superpowers role" || { echo "FAIL"; fail=1; }
exit $fail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/docs-continuity.sh`
Expected: FAIL — none of the strings present yet.

- [ ] **Step 3: Write minimal implementation**

Add a decision-tree branch (after step 3 in `docs/parallel-dispatch.md`):
```markdown
3b. Of the independent ephemeral tasks, are some self-contained coding/refactor/validation
    tasks (describable fully in a prompt, no need for this live session's context)?
    - YES: use the `temperance-parallel-dispatch` skill. It splits the batch — Claude-rail
      tasks go to `superpowers:dispatching-parallel-agents` (the Claude-subagent primitive),
      external-rail tasks go to `temperance-batch`, which routes each to command-code/kimi/grok.
    - NO: use `superpowers:dispatching-parallel-agents` directly (all Claude subagents).
```
Add a comparison-table row:
```markdown
| `temperance-parallel-dispatch` (+`temperance-batch`) | opt-in worktree per external task | ephemeral (run dir) | no | mixed batch: some tasks on external backends, some Claude subagents |
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/docs-continuity.sh`
Expected: PASS — all three grep checks ok.

- [ ] **Step 5: Commit**

```bash
git add docs/parallel-dispatch.md tests/docs-continuity.sh
git commit -m "docs(parallel-dispatch): add routed external rail to decision tree + table"
```

---

## Final verification (after all tasks)

- [ ] Run the whole suite:
```bash
for t in tests/router-hardening.sh tests/dispatch-tasklist.sh tests/skill-install.sh tests/wire-batch.sh tests/docs-continuity.sh; do
  echo "== $t =="; bash "$t" || echo "!! $t FAILED"; done
```
Expected: every suite prints PASS / all `ok -` lines.
- [ ] Backward-compat spot check: `TEMPERANCE_BACKENDS="command-code" package/router/multi-backend-router.sh --json "refactor all" | jq -e .` still valid; `--list-backends` still works.
- [ ] `bash verify.sh` (repo's own verifier: shell syntax + no hard-coded usernames) passes for all new/modified files.

---

## Gap-register coverage (spec §9 → task)

| Gap | Task |
|---|---|
| G1 (no eval) | W3 (argv), R3 (display-only banner) |
| G2 (JSON injection) | R2 + W3 (jq bodies) |
| G3 (real cwd isolation) | W7 |
| G4 (inline fake-success) | R3 + W2 |
| G5 (execute chatter) | W3 (wrapper owns execution) |
| G6 (per-task model) | R1 (`--model`) |
| G7 (status probe latency) | R1 (`TEMPERANCE_BACKENDS`) + wrapper detect-once (W1/W8) |
| G9 (id sanitize) | W1 |
| G10 (atomic index) | W4 |
| G11 (600 s cap) | W5 |
| G12 (skill discovery) | I1 |
| G13 (symlink resolution) | W1 (`self_path`) |
| G14 (concurrency cap) | W4 |
| G15 (portable timeout) | W6 |
| G16 (phantom route) | R1 (`none`) + W2 (unavailable) |
| G17 (run-dir collision) | W1/W4 (`mktemp -d`) |
| G18–G20 (worktree) | W7 |
