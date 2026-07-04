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

# --- backend execution (argv arrays; task text is always ONE literal arg) ---
run_command_code(){ command-code -p "$1" --model "$2" --max-turns "${MAX_TURNS:-10}" --trust --skip-onboarding >"$3" 2>&1; }
run_kimi(){ kimi --print --yolo --model "$2" -p "$1" >"$3" 2>&1; }
run_grok(){ "$HOME/.grok/bin/grok" --model "$2" --always-approve -- "$1" >"$3" 2>&1; }
run_nvidia(){
  curl -s https://integrate.api.nvidia.com/v1/chat/completions \
    -H "Authorization: Bearer ${NVIDIA_API_KEY:-}" -H "Content-Type: application/json" \
    -d "$(jq -n --arg m "$2" --arg c "$1" '{model:$m,messages:[{role:"user",content:$c}],max_tokens:4096}')" \
    | jq -r '.choices[0].message.content // .error.message // "Error"' >"$3" 2>&1
}

dispatch_backend(){ # backend task model outfile -> exit code
  case "$1" in
    command-code) run_command_code "$2" "$3" "$4" ;;
    kimi) run_kimi "$2" "$3" "$4" ;;
    grok) run_grok "$2" "$3" "$4" ;;
    nvidia) run_nvidia "$2" "$3" "$4" ;;
    *) echo "unknown backend: $1" >"$4"; return 1 ;;
  esac
}

DRY_RUN=false; TASKS_FILE=""; OUT=""; FOREGROUND=false; MAX_TURNS="${MAX_TURNS:-10}"
CONCURRENCY="${CONCURRENCY:-4}"
TIMEOUT="${TIMEOUT:-0}"   # per-task watchdog timeout in seconds; 0 = off
while [[ $# -gt 0 ]]; do
  case $1 in
    --tasks) TASKS_FILE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --foreground) FOREGROUND=true; shift ;;
    --max-turns) MAX_TURNS="$2"; shift 2 ;;
    --concurrency) CONCURRENCY="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$OUT" ]] && OUT="$(mktemp -d)"
mkdir -p "$OUT"

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
  "$ROUTER" "${args[@]}" -- "$task"
}

# --- per-task metadata + dispatch wrapper (W4) ---
write_meta(){ # id task backend model exit dur status  -> atomic
  local f="$OUT/$1.meta.json"
  jq -n --arg id "$1" --arg task "$2" --arg b "$3" --arg m "$4" \
        --argjson ex "$5" --argjson d "$6" --arg st "$7" \
    '{id:$id,task:$task,backend:$b,model:$m,exit:$ex,duration_s:$d,status:$st,worktree:null,diff_path:null}' \
    > "$f.tmp" && mv -f "$f.tmp" "$f"
}

# kill_tree PID — kill a process and all its descendants (portable, no setsid;
# macOS has no GNU timeout/gtimeout). Recursively walks pgrep -P before killing
# the parent so children don't get orphaned and outlive the watchdog.
kill_tree(){
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

run_one(){ # id task rb rm
  local id="$1" task="$2" rb="$3" rm="$4" start end dur ex
  start=$(date +%s)
  TASK_WT=""   # default: no worktree (W7 sets this before this block)
  if (( TIMEOUT > 0 )); then
    exec_task "$rb" "$task" "$rm" "$OUT/$id.out" & local bpid=$!
    ( sleep "$TIMEOUT"; kill_tree "$bpid" ) & local wpid=$!
    if wait "$bpid" 2>/dev/null; then ex=0; else ex=$?; fi
    # kill_tree (not plain kill): the watchdog subshell's own `sleep` child
    # would otherwise survive `kill "$wpid"` as an orphan when the task
    # finishes before the timeout fires.
    kill_tree "$wpid"; wait "$wpid" 2>/dev/null
    # a SIGTERM-caused exit (>=128) after our watchdog fired == timeout
    if (( ex >= 128 )); then ex=124; fi
  else
    exec_task "$rb" "$task" "$rm" "$OUT/$id.out"; ex=$?
  fi
  end=$(date +%s); dur=$((end-start))
  local st="ok"
  if (( ex == 124 )); then st="timeout"; elif (( ex != 0 )); then st="failed"; fi
  write_meta "$id" "$task" "$rb" "$rm" "$ex" "$dur" "$st"
}

# --- dispatch loop + wait + assembly (W5: runs foreground or backgrounded) ---
run_batch(){
  # iterate tasks
  n=$(echo "$raw" | jq 'length')
  for ((i=0; i<n; i++)); do
    id=$(echo "$raw"   | jq -r ".[$i].id")
    task=$(echo "$raw" | jq -r ".[$i].task")
    backend=$(echo "$raw" | jq -r ".[$i].backend // \"auto\"")
    model=$(echo "$raw"   | jq -r ".[$i].model // \"auto\"")
    IFS=$'\t' read -r rb rm < <(route_task "$id" "$task" "$backend" "$model")
    status="dispatch"
    case "$rb" in
      inline) status="skipped:inline" ;;
      none)   status="unavailable" ;;
    esac
    if $DRY_RUN; then
      if [[ "$status" == "dispatch" ]]; then echo "$id $rb $rm"; else echo "$id $status"; fi
      continue
    fi
    case "$status" in
      dispatch)
        while (( $(jobs -rp | wc -l) >= CONCURRENCY )); do wait -n; done
        run_one "$id" "$task" "$rb" "$rm" &
        ;;
      *) write_meta "$id" "$task" "$rb" "$rm" 0 0 "$status" ;;
    esac
  done

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
}

# --dry-run must stay foreground: it prints per-task classification lines
# synchronously for the caller to consume; it cannot be backgrounded.
if $FOREGROUND || $DRY_RUN; then
  run_batch
else
  # Background the job INSIDE the subshell (not the subshell itself) so it
  # fully detaches from this script's job table. Backgrounding the subshell
  # from here (`( run_batch ... ) & disown`) still ties its lifetime to this
  # process for command-substitution callers: `$(...)` blocks until every
  # fd/job reachable from this script's job control has settled, so a
  # caller capturing our output would otherwise stall until run_batch
  # finishes. Redirect all three streams so the detached job never blocks
  # on stdin (already fully consumed into $raw) or leaks output.
  ( run_batch </dev/null >/dev/null 2>&1 & )
  echo "$OUT"
fi
