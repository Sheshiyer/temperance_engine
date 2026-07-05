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
WORKTREE=false; ALLOW_DIRTY=false; APPLY_WORKTREE=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --tasks) TASKS_FILE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --foreground) FOREGROUND=true; shift ;;
    --max-turns) MAX_TURNS="$2"; shift 2 ;;
    --concurrency) CONCURRENCY="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --worktree) WORKTREE=true; shift ;;
    --allow-dirty) ALLOW_DIRTY=true; shift ;;
    --apply-worktree) APPLY_WORKTREE=true; shift ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$OUT" ]] && OUT="$(mktemp -d)"
mkdir -p "$OUT"
# Sanitize RUNTAG: it flows verbatim into the worktree branch name
# te-dispatch/$RUNTAG/$id, so any git-illegal char here (space, colon, etc.)
# would make `git worktree add -b` fail for every task with a generic
# status=failed/exit=1 and no indication why. Collapse anything outside the
# git-safe set to '-' so the branch name is always legal regardless of --out.
# NOTE: `basename` emits a trailing newline; piping it straight into `tr`
# would convert that newline to a trailing '-' before the outer $(...)
# strips it. printf '%s' (no trailing newline) into tr avoids that.
_runtag_base="$(basename "$OUT")"
RUNTAG="$(printf '%s' "$_runtag_base" | tr -c 'A-Za-z0-9._-' '-')"
unset _runtag_base

# Repo guard: --worktree requires an actual git repository. Without this
# check, `git status --porcelain` in a non-repo cwd exits 128 with empty
# stdout, which the dirty-tree check below would misread as "clean" and
# proceed — only to have every task fail later at `git worktree add` with a
# generic error. Fail fast here with a clear message instead.
if $WORKTREE && ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "--worktree requires a git repository (not inside one)" >&2
  exit 4
fi

# Dirty-tree guard: worktrees check out HEAD only, so uncommitted changes in
# the caller's tree would silently be left behind — refuse rather than run
# tasks against stale state. Runs synchronously, before any dispatch fork.
if $WORKTREE && ! $ALLOW_DIRTY; then
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    echo "refusing --worktree on a dirty tree (use --allow-dirty)" >&2
    exit 3
  fi
fi

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

# route_fallbacks: id task backend model -> echoes "backend<TAB>model" lines,
# one per backend in the task-type's priority order, filtered to available
# backends (issue #8 fallback chain: command-code -> grok -> kimi). Same
# --backend/--model override convention as route_task: a forced backend
# collapses the chain to that single backend (handled by the router itself).
route_fallbacks() { # id task backend model  -> echoes "backend<TAB>model" lines
  local task="$2" backend="$3" model="$4" args=(--route-only-with-fallbacks)
  [[ -n "$backend" && "$backend" != "auto" ]] && args+=(--backend "$backend")
  [[ -n "$model"   && "$model"   != "auto" ]] && args+=(--model "$model")
  "$ROUTER" "${args[@]}" -- "$task"
}

# --- per-task metadata + dispatch wrapper (W4; W7 adds worktree/diff_path) ---
# attempts (issue #8) is additive: a JSON array of {backend,model,exit,
# duration_s,status} built with jq, one entry per fallback attempt. Top-level
# backend/model/exit/duration_s/status always reflect the FINAL attempt, so
# existing consumers reading only those fields are unaffected.
write_meta(){ # id task backend model exit dur status [worktree] [diff_path] [attempts_json]  -> atomic
  local f="$OUT/$1.meta.json"
  local wt="${8:-}" dp="${9:-}" attempts="${10:-[]}"
  jq -n --arg id "$1" --arg task "$2" --arg b "$3" --arg m "$4" \
        --argjson ex "$5" --argjson d "$6" --arg st "$7" \
        --arg wt "$wt" --arg dp "$dp" --argjson attempts "$attempts" \
    '{id:$id,task:$task,backend:$b,model:$m,exit:$ex,duration_s:$d,status:$st,
      worktree:(if $wt=="" then null else $wt end),
      diff_path:(if $dp=="" then null else $dp end),
      attempts:$attempts,
      merged:null}' \
    > "$f.tmp" && mv -f "$f.tmp" "$f"
}

# set_merged: id merged_value("true"|"false") -> patch the .meta.json's
# `merged` field in place (jq-built, atomic). Only invoked from the
# post-run --apply-worktree pass, and only for tasks that actually went
# through worktree capture -- so `merged` stays `null` for everything else
# (non-worktree tasks, or any run without --apply-worktree), per the schema.
set_merged(){ # id merged("true"|"false")
  local f="$OUT/$1.meta.json"
  [[ -f "$f" ]] || return 0
  jq --argjson mv "$2" '.merged = $mv' "$f" > "$f.tmp" && mv -f "$f.tmp" "$f"
}

# attempt_record: backend model exit dur status -> one jq-built attempt object
attempt_record(){ # backend model exit dur status -> JSON object on stdout
  jq -n --arg b "$1" --arg m "$2" --argjson ex "$3" --argjson d "$4" --arg st "$5" \
    '{backend:$b, model:$m, exit:$ex, duration_s:$d, status:$st}'
}

# kill_tree PID — kill a process and all its descendants (portable, no setsid;
# macOS has no GNU timeout/gtimeout). Recursively walks pgrep -P before killing
# the parent so children don't get orphaned and outlive the watchdog.
kill_tree(){
  local p="$1" c
  for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c"; done
  kill -TERM "$p" 2>/dev/null
}

# diff_files: diff_path -> one file path per line touched by that diff.
# Parses `diff --git a/X b/X` headers rather than shelling out to
# `git apply --numstat` so it works even on an empty/whitespace-only diff
# (numstat on an empty file errors on some git versions) and needs no cwd.
diff_files(){ # diff_path
  grep -E '^diff --git ' "$1" 2>/dev/null | sed -E 's#^diff --git a/(.*) b/.*#\1#'
}

# apply_worktree_merges: post-run, opt-in (--apply-worktree only) safe-path
# auto-merge of captured worktree diffs into the caller's cwd (issue #7).
# Runs AFTER index.json exists so it can read each task's final status +
# diff_path from one source of truth. Fail-open throughout: any apply
# failure leaves the <id>.diff file on disk and marks that task merged:false,
# never touching the cwd for that task.
apply_worktree_merges(){
  local idx="$OUT/index.json"
  [[ -f "$idx" ]] || return 0

  # Candidates: worktree tasks that finished ok and have a non-empty diff.
  # (failed/timeout/skipped worktree tasks have nothing safe to apply.)
  local -a cand_ids=()
  while IFS= read -r cid; do
    [[ -n "$cid" ]] && cand_ids+=("$cid")
  done < <(jq -r '.tasks[] | select(.worktree != null and .diff_path != null and .status=="ok") | .id' "$idx")

  (( ${#cand_ids[@]} == 0 )) && return 0

  # Build id -> diff_path map and file->[]ids overlap map.
  declare -A DIFF_OF=()
  declare -A FILES_OF=()      # id -> space-joined file list
  declare -A TOUCHERS_OF=()   # file -> space-joined id list (for overlap + report)
  local cid dpath f
  for cid in "${cand_ids[@]}"; do
    dpath="$(jq -r --arg id "$cid" '.tasks[] | select(.id==$id) | .diff_path' "$idx")"
    DIFF_OF["$cid"]="$dpath"
    [[ -s "$dpath" ]] || continue   # empty diff: nothing to apply, nothing to conflict
    local files; files="$(diff_files "$dpath")"
    FILES_OF["$cid"]="$(printf '%s' "$files" | tr '\n' ' ')"
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      TOUCHERS_OF["$f"]="${TOUCHERS_OF["$f"]:-} $cid"
    done <<< "$files"
  done

  # Conflict set: any file touched by >1 task marks ALL its touchers conflicted.
  declare -A CONFLICTED=()
  declare -A CONFLICT_FILES_OF_TASK=()   # id -> space-joined conflicting file list
  local file touchers count
  for file in "${!TOUCHERS_OF[@]}"; do
    touchers="${TOUCHERS_OF[$file]}"
    count=$(wc -w <<< "$touchers")
    if (( count > 1 )); then
      for cid in $touchers; do
        CONFLICTED["$cid"]=1
        CONFLICT_FILES_OF_TASK["$cid"]="${CONFLICT_FILES_OF_TASK[$cid]:-} $file"
      done
    fi
  done

  local -a applied=() conflicted_report=() apply_failed=()
  for cid in "${cand_ids[@]}"; do
    dpath="${DIFF_OF[$cid]}"
    if [[ -n "${CONFLICTED[$cid]:-}" ]]; then
      set_merged "$cid" false
      conflicted_report+=("$cid:${CONFLICT_FILES_OF_TASK[$cid]}")
      continue
    fi
    if [[ ! -s "$dpath" ]]; then
      # Empty diff (no changes): nothing to apply, but it was eligible and
      # non-conflicted -- treat as not-applied rather than a failure.
      set_merged "$cid" false
      continue
    fi
    if git apply --check "$dpath" 2>/dev/null; then
      if git apply "$dpath" 2>/dev/null; then
        set_merged "$cid" true
        applied+=("$cid")
      else
        set_merged "$cid" false
        apply_failed+=("$cid")
      fi
    else
      set_merged "$cid" false
      apply_failed+=("$cid")
    fi
  done

  # --- MERGE-REPORT.md ---
  {
    echo "# Worktree merge report: $OUT"
    echo
    echo "## Applied (merged:true)"
    if (( ${#applied[@]} > 0 )); then
      for cid in "${applied[@]}"; do echo "- $cid: ${FILES_OF[$cid]}"; done
    else
      echo "(none)"
    fi
    echo
    echo "## Conflicted (same file touched by multiple tasks; NOT applied)"
    if (( ${#conflicted_report[@]} > 0 )); then
      for entry in "${conflicted_report[@]}"; do
        cid="${entry%%:*}"; local flist="${entry#*:}"
        echo "- $cid: shared file(s):$flist"
      done
    else
      echo "(none)"
    fi
    echo
    echo "## Apply failures (git apply --check or apply failed; diff kept)"
    if (( ${#apply_failed[@]} > 0 )); then
      for cid in "${apply_failed[@]}"; do echo "- $cid: ${DIFF_OF[$cid]}"; done
    else
      echo "(none)"
    fi
    echo
    echo 'Hand-integrate remaining diffs with: `git apply <path-to-diff>` (after resolving conflicts manually).'
  } > "$OUT/MERGE-REPORT.md"

  # --- SUMMARY.md addendum ---
  {
    echo ""
    echo "## Worktree merge"
    echo ""
    echo "- applied: ${#applied[@]}"
    echo "- conflicted: ${#conflicted_report[@]}"
    echo "- apply-failed: ${#apply_failed[@]}"
    echo "See \`MERGE-REPORT.md\` for details."
  } >> "$OUT/SUMMARY.md"
}

# Single execution seam so timeout (W6) and worktree (W7) compose without
# either wrapping the other's command. TASK_WT is set per-task by run_one
# (empty unless --worktree); W7 fills it in.
TASK_WT=""
exec_task(){ # backend task model outfile
  if [[ -n "$TASK_WT" ]]; then ( cd "$TASK_WT" && dispatch_backend "$1" "$2" "$3" "$4" )
  else dispatch_backend "$1" "$2" "$3" "$4"; fi
}

# run_attempt: one backend/model attempt of a task, under the same
# watchdog-timeout logic that existed pre-fallback-chain. Echoes "exit<TAB>dur"
# on stdout; the task's own stdout/stderr still go to $outfile as before.
run_attempt(){ # backend task model outfile timeout  -> echoes "ex<TAB>dur"
  local backend="$1" task="$2" model="$3" outfile="$4" tmo="$5" start end dur ex
  start=$(date +%s)
  if (( tmo > 0 )); then
    local sentinel="$outfile.watchdog"
    exec_task "$backend" "$task" "$model" "$outfile" & local bpid=$!
    ( sleep "$tmo"; touch "$sentinel"; kill_tree "$bpid" ) & local wpid=$!
    if wait "$bpid" 2>/dev/null; then ex=0; else ex=$?; fi
    # kill_tree (not plain kill): the watchdog subshell's own `sleep` child
    # would otherwise survive `kill "$wpid"` as an orphan when the task
    # finishes before the timeout fires.
    kill_tree "$wpid"; wait "$wpid" 2>/dev/null
    # Real timeout iff the watchdog actually fired (sentinel touched before
    # kill_tree). A task that exits >=128 on its own (segfault, explicit
    # `exit 130`) before the watchdog fires must keep its true exit code —
    # exit-code magnitude alone can't distinguish "we killed it" from
    # "it killed itself the same way."
    if [[ -e "$sentinel" ]]; then
      ex=124
      rm -f "$sentinel"
    fi
  else
    exec_task "$backend" "$task" "$model" "$outfile"; ex=$?
  fi
  end=$(date +%s); dur=$((end-start))
  printf '%s\t%s\n' "$ex" "$dur"
}

run_one(){ # id task rb rm [reqb] [reqm]
  local id="$1" task="$2" rb="$3" rm="$4"
  # reqb/reqm: the RAW task-level backend/model override ("auto" if unset in
  # the task JSON) -- used only to ask route_fallbacks for the chain with the
  # same override semantics as the original route_task call. Falls back to
  # "auto" for any caller that doesn't pass them (keeps run_one callable with
  # its pre-#8 4-arg signature).
  local reqb="${5:-auto}" reqm="${6:-auto}"
  local branch="" diffp=""
  TASK_WT=""   # default: no worktree (W7 sets this before this block)
  if $WORKTREE; then
    branch="te-dispatch/${RUNTAG}/${id}"
    TASK_WT="$OUT/wt-$id"
    if ! git worktree add -q -b "$branch" "$TASK_WT" HEAD 2>/dev/null; then
      write_meta "$id" "$task" "$rb" "$rm" 1 0 "failed" "" "" "[]"
      return
    fi
  fi

  # Fallback chain (#8): try each backend:model the router hands back, in
  # order. The pre-classified $rb/$rm (chosen route) is always attempt #1 --
  # route_fallbacks independently re-derives the SAME task-type's priority
  # list, so it always starts with $rb/$rm too, but re-deriving here (rather
  # than trusting rb/rm alone) is what gives us the rest of the chain to fall
  # back to. exit 0 -> stop (ok). exit 124 (timeout) -> stop, NO fallback:
  # a per-attempt timeout means the task itself is too slow, not a
  # backend-health signal, so trying another backend would just repeat the
  # same wait. Any other non-zero exit -> record failed, advance to the next
  # backend in the chain. Chain exhausted with no success -> status=failed
  # using the LAST attempt's exit code.
  local -a fb_backends=() fb_models=()
  while IFS=$'\t' read -r fbk fmk; do
    [[ -z "$fbk" || "$fbk" == "none" || "$fbk" == "inline" ]] && continue
    fb_backends+=("$fbk"); fb_models+=("$fmk")
  done < <(route_fallbacks "$id" "$task" "$reqb" "$reqm")
  # Guard: if the router's fallback listing came back empty (e.g. a forced
  # backend that's unavailable), still attempt the pre-classified route once
  # so behavior degrades to the pre-#8 single-attempt path rather than
  # silently doing nothing.
  if (( ${#fb_backends[@]} == 0 )); then
    fb_backends=("$rb"); fb_models=("$rm")
  fi

  local attempts_json="[]"
  local ex=1 dur=0 st="failed" fbk fmk
  local i
  for ((i=0; i<${#fb_backends[@]}; i++)); do
    fbk="${fb_backends[i]}"; fmk="${fb_models[i]}"
    IFS=$'\t' read -r ex dur < <(run_attempt "$fbk" "$task" "$fmk" "$OUT/$id.out" "$TIMEOUT")
    if (( ex == 124 )); then st="timeout"
    elif (( ex != 0 )); then st="failed"
    else st="ok"
    fi
    attempts_json=$(jq -c --argjson prev "$attempts_json" --argjson rec "$(attempt_record "$fbk" "$fmk" "$ex" "$dur" "$st")" \
      -n '$prev + [$rec]')
    rb="$fbk"; rm="$fmk"   # top-level fields track the FINAL attempt
    if [[ "$st" == "ok" ]]; then break; fi
    if [[ "$st" == "timeout" ]]; then break; fi   # no fallback on timeout
    # st == "failed": advance to next backend in the chain, if any.
  done

  if [[ -n "$TASK_WT" ]]; then
    diffp="$OUT/$id.diff"
    ( cd "$TASK_WT" && git add -A && git diff --cached ) > "$diffp" 2>/dev/null
    if git worktree remove --force "$TASK_WT" 2>/dev/null; then
      git branch -D "$branch" 2>/dev/null || true
    else
      # Retry with double-force (handles locked worktrees)
      if git worktree remove --force --force "$TASK_WT" 2>/dev/null; then
        git branch -D "$branch" 2>/dev/null || true
      else
        # Real leak — record it so the batch's SUMMARY tells the truth
        printf '%s\t%s\t%s\n' "$id" "$TASK_WT" "$branch" >> "$OUT/.leaks"
      fi
    fi
  fi
  write_meta "$id" "$task" "$rb" "$rm" "$ex" "$dur" "$st" "$branch" "$diffp" "$attempts_json"
}

# --- pre-classify every task (routing only, no dispatch) so we can fail-open
# synchronously BEFORE the foreground/background fork (W5). Results are cached
# in parallel arrays, indexed by task position, so run_batch's loop below
# doesn't re-invoke the router per task.
n=$(echo "$raw" | jq 'length')
declare -a ROUTE_BACKEND ROUTE_MODEL ROUTE_STATUS REQ_BACKEND REQ_MODEL
any_dispatch=false
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
  [[ "$status" == "dispatch" ]] && any_dispatch=true
  ROUTE_BACKEND[i]="$rb"; ROUTE_MODEL[i]="$rm"; ROUTE_STATUS[i]="$status"
  # Cache the RAW task-level backend/model override (may be "auto") -- needed
  # by run_one to ask route_fallbacks for the full chain using the same
  # override semantics as the initial route_task call, rather than forcing
  # the chain down to the single already-resolved backend (rb).
  REQ_BACKEND[i]="$backend"; REQ_MODEL[i]="$model"
done

# Phantom-route guard (spec sec 9.G16): if nothing classified as dispatch AND
# no backend was ever detected, there is no external rail at all — fail open
# synchronously so the caller (skill) sends every task to a Claude subagent
# instead of silently exiting 0 having done no external work. --dry-run is a
# pure classification preview (never dispatches anything anyway) so it stays
# exempt: it must keep printing per-task routing lines for the caller to read.
if ! $DRY_RUN && ! $any_dispatch && [[ -z "${AVAIL// }" ]]; then
  echo "EXTERNAL_RAIL_UNAVAILABLE" >&2
  exit 2
fi

# --- dispatch loop + wait + assembly (W5: runs foreground or backgrounded) ---
run_batch(){
  # Force-cleanup outstanding worktrees on any exit (SIGINT/SIGTERM/normal).
  # Only relevant when --worktree is active; harmless otherwise (glob no-match).
  trap '
    if $WORKTREE; then
      for _d in "$OUT"/wt-*; do
        [[ -d "$_d" ]] || continue
        git worktree remove --force --force "$_d" 2>/dev/null || true
      done
      # Branches: prune orphans that our RUNTAG owns
      git worktree prune 2>/dev/null || true
      # Delete our RUNTAG-scoped branches whose worktree is now gone
      git for-each-ref --format="%(refname:short)" "refs/heads/te-dispatch/$RUNTAG/*" 2>/dev/null | while read -r _b; do
        git branch -D "$_b" 2>/dev/null || true
      done
    fi
  ' EXIT INT TERM
  # iterate tasks, reusing the pre-classification pass's cached routes so the
  # router is never invoked twice for the same task.
  for ((i=0; i<n; i++)); do
    id=$(echo "$raw"   | jq -r ".[$i].id")
    task=$(echo "$raw" | jq -r ".[$i].task")
    rb="${ROUTE_BACKEND[i]}" rm="${ROUTE_MODEL[i]}" status="${ROUTE_STATUS[i]}"
    reqb="${REQ_BACKEND[i]}" reqm="${REQ_MODEL[i]}"
    if $DRY_RUN; then
      if [[ "$status" == "dispatch" ]]; then echo "$id $rb $rm"; else echo "$id $status"; fi
      continue
    fi
    case "$status" in
      dispatch)
        while (( $(jobs -rp | wc -l) >= CONCURRENCY )); do wait -n; done
        run_one "$id" "$task" "$rb" "$rm" "$reqb" "$reqm" &
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
    if [[ -s "$OUT/.leaks" ]]; then
      {
        echo ""
        echo "## Leaked worktrees (manual cleanup required)"
        echo ""
        while IFS=$'\t' read -r lid lwt lbranch; do
          echo "- $lid: worktree \`$lwt\` on branch \`$lbranch\`"
        done < "$OUT/.leaks"
        echo ""
        echo 'Clean up manually: `git worktree remove --force --force <path>` then `git branch -D <branch>`.'
      } >> "$OUT/SUMMARY.md"
    fi
    if $WORKTREE && $APPLY_WORKTREE; then
      apply_worktree_merges
    fi
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
