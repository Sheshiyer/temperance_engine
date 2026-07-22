#!/usr/bin/env bash
# package/router/dispatch-tasklist.sh
# Route a JSON task list to backends via multi-backend-router.sh (selection only)
# and execute each task via argv arrays. Never evals router output.

# This script needs bash >=4 (associative arrays, e.g. IS_FALLBACK/STATUS_OF
# below). `env bash` can resolve to macOS's stock /bin/bash 3.2 when PATH puts
# /usr/bin ahead of a newer bash (e.g. Homebrew's) -- which silently mis-parses
# `declare -A` and fails later with an unrelated-looking "unbound variable"
# error. Re-exec under a bash 4+ if one can be found.
if [ -z "${BASH_VERSINFO:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
  for _b in /opt/homebrew/bin/bash /usr/local/bin/bash; do
    if [ -x "$_b" ]; then exec "$_b" "$0" "$@"; fi
  done
  echo "error: $0 requires bash >= 4 (associative arrays); found ${BASH_VERSION:-unknown}." >&2
  echo "Install a newer bash (e.g. 'brew install bash') or put it ahead of /usr/bin/bash in PATH." >&2
  exit 1
fi

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
POLICY_RUNNER="${TEMPERANCE_ROUTING_POLICY_BIN:-$SCRIPT_DIR/routing-policy.ts}"

# --- backend execution (argv arrays; task text is always ONE literal arg) ---
run_command_code(){ command-code -p "$1" --model "$2" --max-turns "${MAX_TURNS:-10}" --trust --yolo --skip-onboarding >"$3" 2>&1; }
run_kimi(){ kimi --print --yolo --model "$2" -p "$1" >"$3" 2>&1; }
run_grok(){ "$HOME/.grok/bin/grok" --model "$2" --always-approve -- "$1" >"$3" 2>&1; }
run_omniroute(){ "$SCRIPT_DIR/omniroute-codex.sh" "$2" "$1" >"$3" 2>&1; }

dispatch_backend(){ # backend task model outfile -> exit code
  case "$1" in
    omniroute) run_omniroute "$2" "$3" "$4" ;;
    command-code) run_command_code "$2" "$3" "$4" ;;
    kimi) run_kimi "$2" "$3" "$4" ;;
    grok) run_grok "$2" "$3" "$4" ;;
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

# --- per-task routing plan (classification + frozen candidate chain) ---
route_plan() { # id task backend model -> plan JSON
  local task="$2" backend="$3" model="$4" args=(--plan-json)
  [[ -n "$backend" && "$backend" != "auto" ]] && args+=(--backend "$backend")
  [[ -n "$model"   && "$model"   != "auto" ]] && args+=(--model "$model")
  if $DRY_RUN; then
    "$ROUTER" "${args[@]}" -- "$task"
  else
    TEMPERANCE_ROUTING_CLAIM_PROBES=1 "$ROUTER" "${args[@]}" -- "$task"
  fi
}

valid_dispatch_plan(){ # plan file
  jq -e '
    def route:
      type=="object" and
      (.backend|type=="string" and length>0) and
      (.model|type=="string" and length>0) and
      (.static_rank|type=="number");
    def route_key: [.backend,.model] | @tsv;
    (.plan_id|type=="string" and length>0) and
    (.status as $status | ["ok","off","no-observations","inline","unavailable"] | index($status) != null) and
    (.static_order|type=="array" and all(.[]; route)) and
    (.selected_order|type=="array" and all(.[]; route)) and
    (([.selected_order[]|route_key] - [.static_order[]|route_key])|length == 0) and
    (if (.status=="inline" or .status=="unavailable")
      then (.selected_order|length)==0
      else (.selected_order|length)>0
      end)
  ' "$1" >/dev/null 2>&1
}

# --- per-task metadata + dispatch wrapper (W4; W7 adds worktree/diff_path) ---
# attempts (issue #8) is additive: a JSON array of {backend,model,exit,
# duration_s,status} built with jq, one entry per fallback attempt. Top-level
# backend/model/exit/duration_s/status always reflect the FINAL attempt, so
# existing consumers reading only those fields are unaffected.
write_meta(){ # id task backend model exit dur status [worktree] [diff_path] [attempts_json] [plan_id] [plan_path] -> atomic
  local f="$OUT/$1.meta.json"
  local wt="${8:-}" dp="${9:-}" attempts="${10:-[]}" plan_id="${11:-}" plan_path="${12:-}"
  jq -n --arg id "$1" --arg task "$2" --arg b "$3" --arg m "$4" \
        --argjson ex "$5" --argjson d "$6" --arg st "$7" \
        --arg wt "$wt" --arg dp "$dp" --argjson attempts "$attempts" \
        --arg plan_id "$plan_id" --arg plan_path "$plan_path" \
    '{id:$id,task:$task,backend:$b,model:$m,exit:$ex,duration_s:$d,status:$st,
      worktree:(if $wt=="" then null else $wt end),
      diff_path:(if $dp=="" then null else $dp end),
      plan_id:(if $plan_id=="" then null else $plan_id end),
      plan_path:(if $plan_path=="" then null else $plan_path end),
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

# build_index_json: (re)assemble $OUT/index.json from the current
# $OUT/*.meta.json files, atomically. Single source of truth for the
# aggregation shape so both the original post-dispatch write and the
# post-merge refresh (Codex review finding P2b) use the exact same jq --
# no hand-edited/duplicated field lists to drift out of sync.
#
# P2b: index.json is first written before apply_worktree_merges runs;
# set_merged only patches each per-task .meta.json, so without this refresh
# index.json's .tasks[].merged stays null even after the merge pass sets
# true/false in the metas. apply_worktree_merges calls this again at its END
# (after every set_merged call) so callers reading the aggregate see the
# real merged state.
build_index_json(){
  jq -s --arg dir "$OUT" '{run_dir:$dir, tasks:., summary:{
     ok:(map(select(.status=="ok"))|length),
     failed:(map(select(.status=="failed"))|length),
     timeout:(map(select(.status=="timeout"))|length),
     skipped:(map(select(.status|startswith("skipped")))|length),
     unavailable:(map(select(.status=="unavailable"))|length)}}' \
     "$OUT"/*.meta.json > "$OUT/index.json.tmp" && mv -f "$OUT/index.json.tmp" "$OUT/index.json"
}

# attempt_record: backend model exit dur status -> one jq-built attempt object
attempt_record(){ # backend model exit dur status task_id attempt_index start_ms finish_ms fallback_reason usage_json cost_json -> JSON
  jq -n --arg b "$1" --arg m "$2" --argjson ex "$3" --argjson d "$4" --arg st "$5" \
    --arg task_id "$6" --argjson attempt_index "$7" --argjson started_at_ms "$8" \
    --argjson finished_at_ms "$9" --arg fallback_reason "${10:-}" \
    --argjson usage "${11:-null}" --argjson cost "${12:-null}" \
    '{event:"attempt",backend:$b,model:$m,exit:$ex,duration_s:$d,status:$st,
      task_id:$task_id,attempt_index:$attempt_index,started_at_ms:$started_at_ms,
      finished_at_ms:$finished_at_ms,
      fallback_reason:(if $fallback_reason=="" then null else $fallback_reason end),
      usage:$usage,cost:$cost}'
}

epoch_ms(){
  if [[ -n "${EPOCHREALTIME:-}" ]]; then
    awk -v value="$EPOCHREALTIME" 'BEGIN { printf "%.0f", value * 1000 }'
  elif command -v perl >/dev/null 2>&1; then
    perl -MTime::HiRes=time -e 'printf "%.0f", time() * 1000'
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import time; print(time.time_ns() // 1_000_000, end="")'
  elif command -v bun >/dev/null 2>&1; then
    bun -e 'process.stdout.write(String(Date.now()))'
  else
    echo "millisecond clock unavailable (need Bash 5, Perl, Python 3, or Bun)" >&2
    return 1
  fi
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
# Parses the patch text directly rather than shelling out to
# `git apply --numstat` so it works even on an empty/whitespace-only diff
# (numstat on an empty file errors on some git versions) and needs no cwd.
#
# Reviewer finding (#7 follow-up): a naive `diff --git a/X b/Y` header parse
# that only captures the a/ side silently drops the DESTINATION of a
# rename/copy (git emits `diff --git a/orig.txt b/shared.txt` for a pure
# rename, with no other line mentioning shared.txt in some cases). That let a
# rename-to-shared.txt and a separate write-to-shared.txt slip past overlap
# detection as non-conflicting, which broke the feature's core safety
# guarantee. Fix: union every per-path line the patch format can produce --
# each of these lines carries exactly one unambiguous path, so there's no
# space-splitting ambiguity:
#   rename from / rename to / copy from / copy to   (rename & copy patches)
#   --- a/X / +++ b/X                                (content hunks; skip /dev/null)
# ...plus a header fallback that captures BOTH a/ and b/ sides (covers
# mode-only or binary diffs that have no ---/+++ hunk lines at all). Adding
# extra/duplicate keys can only make overlap detection MORE conservative
# (more likely to flag a conflict), never less -- that's the safe direction,
# so the union is intentional. Output is sorted + deduped; one path per line,
# same newline-separated contract callers already rely on.
#
# Codex review finding (P2a): for a filename containing a SPACE, git appends
# a TAB then metadata after the path on `---`/`+++` lines (e.g.
# "+++ b/shared file.txt<TAB>..."), but the corresponding `rename from`/
# `rename to`/`copy from`/`copy to` lines carry NO such tab. Left unstripped,
# that produces two DIFFERENT overlap keys for the same file ("shared
# file.txt<TAB>..." vs "shared file.txt"), so a rename-to and a write-to the
# same spaced filename are missed as an overlap. Fix: strip everything from
# the first literal tab onward on every extracted line before the
# dequote/prefix-strip step. `rename from/to`, `copy from/to`, and the
# `diff --git` header never carry a tab suffix, so this strip is a no-op for
# them and only affects `---`/`+++` lines -- safe to apply unconditionally.
diff_files(){ # diff_path
  {
    grep -E '^rename from ' "$1" 2>/dev/null | sed -E 's#^rename from ##'
    grep -E '^rename to '   "$1" 2>/dev/null | sed -E 's#^rename to ##'
    grep -E '^copy from '   "$1" 2>/dev/null | sed -E 's#^copy from ##'
    grep -E '^copy to '     "$1" 2>/dev/null | sed -E 's#^copy to ##'
    grep -E '^--- '         "$1" 2>/dev/null | sed -E 's#^--- ##'
    grep -E '^\+\+\+ '      "$1" 2>/dev/null | sed -E 's#^\+\+\+ ##'
    # Header fallback: split `diff --git a/X b/Y` (plain) or
    # `diff --git "a/X" "b/Y"` (quoted) into its two path tokens, one per
    # line, so both sides feed the same per-line dequote/prefix-strip below.
    grep -E '^diff --git '  "$1" 2>/dev/null \
      | sed -E 's#^diff --git ("[^"]*"|[^ ]+) ("[^"]*"|[^ ]+)$#\1\n\2#'
  } | sed -E $'s/\t.*$//' \
    | while IFS= read -r _p; do dequote_path "$_p"; done \
    | sed -E 's#^(a/|b/)##' \
    | grep -v -E '^(/dev/null)?$' \
    | sort -u
}

# dequote_path: best-effort decode of a single git-quoted path token (e.g.
# "caf\303\251.txt" for non-ASCII/special-char filenames). Overlap SAFETY
# never depends on this decoding succeeding -- both sides of a rename/copy
# produce the identical key whether quoted-and-decoded or left raw, so a
# decode miss can only affect MERGE-REPORT readability, never correctness.
# Always falls back to the raw token on any doubt; never errors, never
# drops a path.
dequote_path(){
  local p="$1" inner decoded
  if [[ "$p" == \"*\" && "$p" == *\" && ${#p} -ge 2 ]]; then
    inner="${p:1:-1}"
    decoded="$(printf '%b' "$inner" 2>/dev/null)"
    [[ -n "$decoded" ]] && { printf '%s\n' "$decoded"; return; }
  fi
  printf '%s\n' "$p"
}

# apply_worktree_merges: post-run, opt-in (--apply-worktree only) safe-path
# auto-merge of captured worktree diffs into the caller's cwd (issue #7).
# Runs AFTER index.json exists so it can read each task's final status +
# diff_path from one source of truth. Fail-open throughout: any apply
# failure leaves the <id>.diff file on disk and marks that task merged:false,
# never touching the cwd for that task.
#
# Codex review finding (P1): `git apply --check` / `git apply` must run
# root-relative, not cwd-relative. The captured diffs are produced by
# `git -C $wt diff --cached`, so their paths are root-relative. If this
# wrapper is invoked from a SUBDIRECTORY of the repo, running plain
# `git apply` there makes git treat the root-rooted paths as outside cwd --
# it prints "Skipped patch '...'" and exits 0, so both --check and apply
# "succeed" with NO file changes, and set_merged records a false merged:true.
# Fix: resolve the repo root ONCE here and run both --check and apply via
# `git -C "$root"`. $dpath is always absolute ($OUT is absolute), so -C does
# not affect how it's read. Fail-open: if root can't be resolved, do not
# apply anything -- every candidate is marked merged:false and the report
# notes the reason, rather than risk a repeat of the silent-success bug.
apply_worktree_merges(){
  local idx="$OUT/index.json"
  [[ -f "$idx" ]] || return 0

  local root; root="$(git rev-parse --show-toplevel 2>/dev/null)"

  # OVERLAP UNIVERSE vs APPLY SET (Codex review finding P1, #7 follow-up):
  # these are two deliberately different sets.
  #
  # The OVERLAP UNIVERSE is every worktree task with a non-empty captured
  # diff, REGARDLESS of status (ok/failed/timeout) and regardless of
  # fallback. Any captured diff is a competing output for the files it
  # touches, whether or not the task that produced it ultimately succeeded --
  # so it must count toward overlap detection.
  #
  # Why: run_one (#7/#8) captures the worktree diff UNCONDITIONALLY for every
  # worktree task via `git add -A && git diff --cached`, before checking
  # final status. A task whose backend WRITES a file and THEN exits nonzero
  # ends up status=failed with a NON-EMPTY diff that touched a real file. If
  # the candidate filter required status=="ok", that diff -- and the files it
  # touched -- would be invisible to the overlap map below, so a DIFFERENT,
  # single-attempt ok task touching the SAME file would be wrongly seen as
  # non-overlapping and auto-applied over the failed task's competing output.
  # That breaks the non-overlap safety contract this feature exists to
  # provide (same class of bug as the fallback-candidacy fix below, just for
  # status instead of attempt count).
  #
  # Codex review finding (P1, composing with #8 fallback chain): run_one
  # reuses the SAME worktree across every fallback attempt for a task, and
  # captures the diff ONCE at the end. So a task that fell back (primary
  # backend wrote/failed, a later backend succeeded) can finish status=ok
  # with a captured diff that contains BOTH the failed attempt's edits and
  # the successful attempt's edits -- there is no way to tell them apart from
  # the diff alone. Auto-applying that combined diff would leak a failed
  # backend's partial edits into the caller's live tree.
  #
  # Codex review finding (P1, review-fix regression): an earlier version of
  # this fix excluded fallback tasks from the universe HERE, before the
  # TOUCHERS_OF overlap map below was built, which let a fallback task's
  # touched files fall out of the overlap universe entirely. Same class of
  # bug as the failed/timeout case above -- fixed the same way, by keeping
  # the task in the universe and deciding whether to APPLY it separately.
  #
  # The APPLY SET is the strict subset actually written to the caller's
  # tree: status=="ok" AND single-attempt (not fallback) AND not conflicted
  # AND the diff applies cleanly. Everything else in the universe stays out
  # of the caller's tree: non-ok tasks are never candidates for merged:true
  # or merged:false (they were never "held back" from applying -- they were
  # never eligible to apply at all), so their `merged` stays null, same as
  # any non-worktree task. `[[ -s "$dpath" ]]` below already drops empty
  # diffs, so a task that failed before writing anything doesn't poison
  # overlap either.
  local -a cand_ids=()
  declare -A IS_FALLBACK=() STATUS_OF=()
  local cid attempts_len st
  while IFS=$'\t' read -r cid st; do
    [[ -n "$cid" ]] || continue
    STATUS_OF["$cid"]="$st"
    attempts_len="$(jq -r --arg id "$cid" '.tasks[] | select(.id==$id) | (.attempts | length)' "$idx")"
    if [[ "$attempts_len" =~ ^[0-9]+$ ]] && (( attempts_len > 1 )); then
      IS_FALLBACK["$cid"]=1
    fi
    cand_ids+=("$cid")
  done < <(jq -r '.tasks[] | select(.worktree != null and .diff_path != null) | [.id, .status] | @tsv' "$idx")

  if (( ${#cand_ids[@]} == 0 )); then
    return 0
  fi

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

  local -a applied=() conflicted_report=() apply_failed=() fallback_skip=() not_applied_nonok=()
  local root_unresolved=false
  if [[ -z "$root" ]]; then
    root_unresolved=true
  fi
  # Decision order per task in the overlap universe (st = status, isfb =
  # fallback flag). Only status=="ok", single-attempt, non-conflicted tasks
  # ever reach the apply step -- everything else is held back or left as a
  # non-candidate, per the universe/apply-set split documented above.
  for cid in "${cand_ids[@]}"; do
    dpath="${DIFF_OF[$cid]}"
    st="${STATUS_OF[$cid]:-}"
    if [[ -n "${CONFLICTED[$cid]:-}" ]]; then
      if [[ "$st" == "ok" ]]; then
        # An ok task that overlaps another universe member (ok, fallback, or
        # failed/timeout) is held back -- it WAS eligible to apply, so
        # merged:false (not null), reported as a conflict.
        set_merged "$cid" false
        conflicted_report+=("$cid:${CONFLICT_FILES_OF_TASK[$cid]}")
      else
        # A non-ok (failed/timeout) task's diff poisoned overlap for others,
        # but the task itself was never a merge candidate -- it was neither
        # applied nor "held back" from applying (there was nothing to hold
        # back: it never had a chance to apply). Leave merged as the null
        # write_meta already recorded; do not call set_merged. Note it for
        # transparency in the report instead.
        not_applied_nonok+=("$cid:${CONFLICT_FILES_OF_TASK[$cid]}")
      fi
      continue
    fi
    if [[ "$st" != "ok" ]]; then
      # Non-ok (failed/timeout), non-conflicted: still never a merge
      # candidate. merged stays null (never applied, never "held back").
      not_applied_nonok+=("$cid:")
      continue
    fi
    if [[ -n "${IS_FALLBACK[$cid]:-}" ]]; then
      # Non-overlapping fallback task: still not safe to auto-apply (see
      # the fallback-chain comment above cand_ids) -- skip it, distinctly
      # from a conflict.
      set_merged "$cid" false
      fallback_skip+=("$cid")
      continue
    fi
    if [[ ! -s "$dpath" ]]; then
      # Empty diff (no changes): nothing to apply, but it was eligible and
      # non-conflicted -- treat as not-applied rather than a failure.
      set_merged "$cid" false
      continue
    fi
    if $root_unresolved; then
      # Fail-open (P1): repo root could not be resolved -- applying via cwd
      # risks the silent-success bug this fix closes, so do not apply
      # anything; record as an apply failure (diff stays on disk).
      set_merged "$cid" false
      apply_failed+=("$cid")
      continue
    fi
    if git -C "$root" apply --check "$dpath" 2>/dev/null; then
      if git -C "$root" apply "$dpath" 2>/dev/null; then
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
    if $root_unresolved; then
      echo "## WARNING: repo root unresolvable"
      echo
      echo "\`git rev-parse --show-toplevel\` failed, so no diffs were applied"
      echo "(fail-open). All candidates below are recorded under Apply failures."
      echo
    fi
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
    echo "## Skipped: fallback attempts (apply manually after review)"
    echo
    if (( ${#fallback_skip[@]} > 0 )); then
      echo "These tasks needed a fallback backend (attempts > 1) before"
      echo "succeeding. The captured worktree diff may contain edits from"
      echo "BOTH the failed attempt(s) and the successful one -- not safe to"
      echo "auto-apply. Review the diff by hand before applying it."
      echo
      for cid in "${fallback_skip[@]}"; do
        echo "- $cid: $(jq -r --arg id "$cid" '.tasks[] | select(.id==$id) | .diff_path' "$idx")"
      done
    else
      echo "(none)"
    fi
    echo
    echo "## Not applied (failed/timeout -- output present, blocks overlap)"
    echo
    if (( ${#not_applied_nonok[@]} > 0 )); then
      echo "These worktree tasks did NOT finish ok (status=failed or"
      echo "status=timeout), so they were never merge candidates (merged"
      echo "stays null, same as any non-worktree task). Their captured diff"
      echo "is still a real, non-empty output, so it still counts toward"
      echo "overlap detection -- any ok task sharing a file with one of"
      echo "these is held back under Conflicted above, even though the task"
      echo "listed here itself was never a candidate to apply."
      echo
      for entry in "${not_applied_nonok[@]}"; do
        cid="${entry%%:*}"; local flist="${entry#*:}"
        if [[ -n "$flist" ]]; then
          echo "- $cid (status=${STATUS_OF[$cid]:-unknown}): shared file(s):$flist"
        else
          echo "- $cid (status=${STATUS_OF[$cid]:-unknown}): ${DIFF_OF[$cid]}"
        fi
      done
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
    echo "- skipped-fallback: ${#fallback_skip[@]}"
    echo "See \`MERGE-REPORT.md\` for details."
  } >> "$OUT/SUMMARY.md"

  # P2b: regenerate index.json now that every set_merged call above has
  # landed, so the aggregate's .tasks[].merged matches the per-task metas
  # instead of the stale null from the pre-merge write. Done at the END
  # (not the start) of this function -- apply_worktree_merges itself reads
  # index.json for candidates before this point, so regenerating earlier
  # would risk reading a half-updated file mid-pass.
  build_index_json
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
run_attempt(){ # backend task model outfile timeout -> echoes ex<TAB>dur<TAB>start_ms<TAB>finish_ms
  local backend="$1" task="$2" model="$3" outfile="$4" tmo="$5" start end dur ex start_ms finish_ms
  local metrics_path="$outfile.metrics.json"
  rm -f "$metrics_path"
  start=$(date +%s); start_ms="$(epoch_ms)"
  if (( tmo > 0 )); then
    local sentinel="$outfile.watchdog"
    TEMPERANCE_ATTEMPT_METRICS_PATH="$metrics_path" \
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
    TEMPERANCE_ATTEMPT_METRICS_PATH="$metrics_path" \
      exec_task "$backend" "$task" "$model" "$outfile"; ex=$?
  fi
  end=$(date +%s); finish_ms="$(epoch_ms)"; dur=$((end-start))
  printf '%s\t%s\t%s\t%s\n' "$ex" "$dur" "$start_ms" "$finish_ms"
}

run_one(){ # id task rb rm plan_path plan_id selected_order_json
  local id="$1" task="$2" rb="$3" rm="$4"
  local plan_path="${5:-}" plan_id="${6:-}" selected_order_json="${7:-[]}"
  local branch="" diffp=""
  TASK_WT=""   # default: no worktree (W7 sets this before this block)
  if $WORKTREE; then
    branch="te-dispatch/${RUNTAG}/${id}"
    TASK_WT="$OUT/wt-$id"
    if ! git worktree add -q -b "$branch" "$TASK_WT" HEAD 2>/dev/null; then
      write_meta "$id" "$task" "$rb" "$rm" 1 0 "failed" "" "" "[]" "$plan_id" "$plan_path"
      return
    fi
  fi

  # Execute the exact selected_order frozen during preclassification. Never
  # re-run routing here: adaptive state can change while parallel tasks run,
  # and recomputing would make the recorded decision impossible to replay.
  # exit 0 -> stop (ok). exit 124 (timeout) -> stop, NO fallback:
  # a per-attempt timeout means the task itself is too slow, not a
  # backend-health signal, so trying another backend would just repeat the
  # same wait. Any other non-zero exit -> record failed, advance to the next
  # backend in the chain. Chain exhausted with no success -> status=failed
  # using the LAST attempt's exit code.
  local -a fb_backends=() fb_models=()
  while IFS=$'\t' read -r fbk fmk; do
    [[ -z "$fbk" || "$fbk" == "none" || "$fbk" == "inline" ]] && continue
    fb_backends+=("$fbk"); fb_models+=("$fmk")
  done < <(jq -r '.[]? | [.backend,.model] | @tsv' <<< "$selected_order_json" 2>/dev/null)
  # Guard for a corrupt/missing plan: attempt the cached first route once.
  if (( ${#fb_backends[@]} == 0 )); then
    fb_backends=("$rb"); fb_models=("$rm")
  fi

  local attempts_json="[]"
  local ex=1 dur=0 st="failed" fbk fmk start_ms=0 finish_ms=0 fallback_reason=""
  local metrics_file metrics_json usage_json cost_json
  local i
  for ((i=0; i<${#fb_backends[@]}; i++)); do
    fbk="${fb_backends[i]}"; fmk="${fb_models[i]}"
    IFS=$'\t' read -r ex dur start_ms finish_ms < <(run_attempt "$fbk" "$task" "$fmk" "$OUT/$id.out" "$TIMEOUT")
    if (( ex == 124 )); then st="timeout"
    elif (( ex != 0 )); then st="failed"
    else st="ok"
    fi
    (( i > 0 )) && fallback_reason="previous-attempt-failed" || fallback_reason=""
    metrics_file="$OUT/$id.out.metrics.json"
    metrics_json='{}'
    if [[ -f "$metrics_file" ]] && jq -e 'type=="object"' "$metrics_file" >/dev/null 2>&1; then
      metrics_json="$(jq -c . "$metrics_file")"
    fi
    usage_json="$(jq -c '.usage // null' <<< "$metrics_json")"
    cost_json="$(jq -c '.cost // null' <<< "$metrics_json")"
    rm -f "$metrics_file"
    attempts_json=$(jq -c --argjson prev "$attempts_json" --argjson rec "$(attempt_record "$fbk" "$fmk" "$ex" "$dur" "$st" "$id" "$i" "$start_ms" "$finish_ms" "$fallback_reason" "$usage_json" "$cost_json")" \
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
  write_meta "$id" "$task" "$rb" "$rm" "$ex" "$dur" "$st" "$branch" "$diffp" "$attempts_json" "$plan_id" "$plan_path"
}

# --- pre-classify every task (routing only, no dispatch) so we can fail-open
# synchronously BEFORE the foreground/background fork (W5). Results are cached
# in parallel arrays, indexed by task position, so run_batch's loop below
# doesn't re-invoke the router per task.
n=$(echo "$raw" | jq 'length')
declare -a ROUTE_BACKEND ROUTE_MODEL ROUTE_STATUS ROUTE_PLAN_PATH ROUTE_PLAN_ID ROUTE_SELECTED_JSON
any_dispatch=false
for ((i=0; i<n; i++)); do
  id=$(echo "$raw"   | jq -r ".[$i].id")
  task=$(echo "$raw" | jq -r ".[$i].task")
  backend=$(echo "$raw" | jq -r ".[$i].backend // \"auto\"")
  model=$(echo "$raw"   | jq -r ".[$i].model // \"auto\"")
  plan_path="$OUT/$id.plan.json"
  if route_plan "$id" "$task" "$backend" "$model" > "$plan_path.tmp" \
      && valid_dispatch_plan "$plan_path.tmp"; then
    : # Cache every execution field from the private temp file before publish.
  else
    rm -f "$plan_path.tmp"
    jq -n --arg id "$id" --argjson now "$(( $(date +%s) * 1000 ))" \
      '{policy_version:"unavailable",mode:"off",plan_id:("rp_unavailable_"+$id),
      input_hash:"unavailable",task_type:"unknown",decision_time_ms:$now,diverged:false,
      status:"unavailable",static_order:[],
      proposed_order:[],selected_order:[],candidates:[]}' > "$plan_path.tmp"
  fi
  rb="$(jq -r '.selected_order[0].backend // "none"' "$plan_path.tmp")"
  rm="$(jq -r '.selected_order[0].model // "-"' "$plan_path.tmp")"
  plan_id="$(jq -r '.plan_id' "$plan_path.tmp")"
  plan_status="$(jq -r '.status' "$plan_path.tmp")"
  selected_json="$(jq -c '.selected_order' "$plan_path.tmp")"
  selected_count="$(jq '.selected_order | length' "$plan_path.tmp")"
  if [[ "$plan_status" != "inline" && "$plan_status" != "unavailable" && "$selected_count" == "0" ]]; then
    plan_status="unavailable"
  fi
  status="dispatch"
  case "$plan_status" in
    inline) status="skipped:inline"; rb="inline"; rm="-" ;;
    unavailable) status="unavailable"; rb="none"; rm="-" ;;
  esac
  [[ "$status" == "dispatch" ]] && any_dispatch=true
  ROUTE_BACKEND[i]="$rb"; ROUTE_MODEL[i]="$rm"; ROUTE_STATUS[i]="$status"
  ROUTE_PLAN_PATH[i]="$plan_path"; ROUTE_PLAN_ID[i]="$plan_id"
  ROUTE_SELECTED_JSON[i]="$selected_json"
  mv -f "$plan_path.tmp" "$plan_path"
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
    plan_path="${ROUTE_PLAN_PATH[i]}" plan_id="${ROUTE_PLAN_ID[i]}" selected_json="${ROUTE_SELECTED_JSON[i]}"
    if $DRY_RUN; then
      if [[ "$status" == "dispatch" ]]; then echo "$id $rb $rm"; else echo "$id $status"; fi
      continue
    fi
    case "$status" in
      dispatch)
        while (( $(jobs -rp | wc -l) >= CONCURRENCY )); do wait -n; done
        run_one "$id" "$task" "$rb" "$rm" "$plan_path" "$plan_id" "$selected_json" &
        ;;
      *) write_meta "$id" "$task" "$rb" "$rm" 0 0 "$status" "" "" "[]" "$plan_id" "$plan_path" ;;
    esac
  done

  wait
  if ! $DRY_RUN; then
    build_index_json
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
    # Parent-owned observation reduction: all worker attempts are complete,
    # so one locked atomic write updates cross-run backend facts. Failure is
    # advisory only; task results and fail-open behavior remain authoritative.
    if command -v bun >/dev/null 2>&1 && [[ -f "$POLICY_RUNNER" ]]; then
      state_path="${TEMPERANCE_ROUTING_STATE:-${TEMPERANCE_STATE_DIR:-$HOME/.temperance_engine/state}/routing-observations.json}"
      if ! bun "$POLICY_RUNNER" observe --state "$state_path" --index "$OUT/index.json" >/dev/null; then
        echo "warning: routing observation update failed" >&2
      fi
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
