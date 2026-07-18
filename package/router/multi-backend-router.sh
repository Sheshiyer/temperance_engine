#!/usr/bin/env bash
# package/router/multi-backend-router.sh
# Unified router across multiple model backends:
# - Command Code (35 models)
# - Kimi CLI (K2.7 Code)
# - Grok CLI (grok-composer-2.5-fast, grok-build)
# - OpenRouter (aggregator, if configured)
#
# Usage:
#   ./multi-backend-router.sh "task description"
#   ./multi-backend-router.sh --json "task description"
#   ./multi-backend-router.sh --command "task description"
#   ./multi-backend-router.sh --execute "task description"
#   ./multi-backend-router.sh --backend kimi "task description"
#   ./multi-backend-router.sh --model gpt-5.5 --backend command-code "task description"
#   ./multi-backend-router.sh --route-only "task description"
#   ./multi-backend-router.sh --list-backends
#   ./multi-backend-router.sh --timeout 120 --execute "task description"
#   TEMPERANCE_BACKENDS="command-code kimi" ./multi-backend-router.sh --route-only "task description"
#
# Latency Characteristics:
#   Backend         Startup    Simple Task    Complex Task    Recommended Timeout
#   command-code    ~10s       15-20s         30-120s         180s for complex
#   kimi            ~3s        10-15s         30-60s          120s
#   grok            ~5s        10-15s         20-40s          90s
#
# Note: command-code has higher latency due to agentic execution model.
# For time-critical tasks, prefer kimi or grok.

# This script needs bash >=4 (associative arrays, e.g. MODEL_CATALOG below).
# `env bash` can resolve to macOS's stock /bin/bash 3.2 when PATH puts
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

set -euo pipefail

# Resolve symlinks so classify-task.sh (sourced below) is found next to the REAL
# script even when invoked through an installed symlink such as
# ~/.local/bin/temperance-route (scripts/wire-multi-backend.sh). BSD readlink has
# no -f, so follow the chain manually.
_src="${BASH_SOURCE[0]}"
while [ -L "$_src" ]; do
  _sdir="$(cd -P "$(dirname "$_src")" && pwd)"
  _src="$(readlink "$_src")"
  case "$_src" in /*) ;; *) _src="$_sdir/$_src" ;; esac
done
SCRIPT_DIR="$(cd -P "$(dirname "$_src")" && pwd)"
unset _src _sdir

# Single source of task-type classification + command-code type->model primary
# (issue #6). classify-task.sh is POSIX sh and only defines functions when
# sourced (its CLI dispatch is guarded by $0), so this does not run anything.
# shellcheck source=classify-task.sh
. "$SCRIPT_DIR/classify-task.sh"

# ─────────────────────────────────────────────────────────────────────────────
# Backend Detection
# ─────────────────────────────────────────────────────────────────────────────

detect_backends() {
  if [[ -n "${TEMPERANCE_BACKENDS+x}" ]]; then
    # Caller supplied the list (may be empty = none). Skip the ~10s status probe.
    echo "${TEMPERANCE_BACKENDS}"
    return
  fi
  local backends=()

  # Command Code
  if command -v command-code &>/dev/null; then
    if command-code status 2>&1 | grep -q "Authenticated"; then
      backends+=("command-code")
    fi
  fi
  
  # Kimi
  if command -v kimi &>/dev/null; then
    backends+=("kimi")
  fi
  
  # Grok
  if [[ -x "$HOME/.grok/bin/grok" ]]; then
    backends+=("grok")
  fi
  
  # OpenRouter
  if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
    backends+=("openrouter")
  fi
  
  echo "${backends[*]}"
}

# ─────────────────────────────────────────────────────────────────────────────
# Model Catalog
# ─────────────────────────────────────────────────────────────────────────────

# Format: backend:model → tier:strength:context
declare -A MODEL_CATALOG=(
  # Command Code
  ["command-code:deepseek/deepseek-v4-flash"]="fast:speed:128k"
  ["command-code:deepseek/deepseek-v4-pro"]="deep:reasoning:128k"
  ["command-code:moonshotai/Kimi-K2.7-Code"]="deep:long-horizon:1M"
  ["command-code:claude-sonnet-5"]="balanced:balanced:200k"
  ["command-code:claude-fable-5"]="premium:reasoning:200k"
  ["command-code:google/gemini-3.5-flash"]="fast:parallel:1M"
  ["command-code:Qwen/Qwen3.7-Max"]="deep:frontier:128k"
  ["command-code:gpt-5.5"]="premium:general:128k"
  # Credit-deal primaries (see classify-task.sh model_for_type, decision 2026-07-18)
  ["command-code:tencent/Hy3"]="fast:free:256k"
  ["command-code:xiaomi/mimo-v2.5-pro"]="deep:long-horizon:256k"
  ["command-code:MiniMaxAI/MiniMax-M3"]="balanced:frontier:1M"

  # Kimi (direct)
  ["kimi:kimi-code/kimi-for-coding"]="deep:coding:262k"
  
  # Grok
  ["grok:grok-composer-2.5-fast"]="fast:creative:128k"
  ["grok:grok-build"]="balanced:coding:128k"
)

# ─────────────────────────────────────────────────────────────────────────────
# Routing Rules
# ─────────────────────────────────────────────────────────────────────────────

# Priority order for each task type: command-code -> grok -> kimi (one route
# per backend, no same-backend duplicates). grok/kimi fallback tails per task type (command-code primary is derived from
# classify-task.sh's model_for_type, so the type->model catalog has ONE source).
declare -A ROUTING_FALLBACK_TAILS=(
  ["fast"]="grok:grok-composer-2.5-fast kimi:kimi-code/kimi-for-coding"
  ["long-horizon"]="grok:grok-build kimi:kimi-code/kimi-for-coding"
  ["reasoning"]="grok:grok-build kimi:kimi-code/kimi-for-coding"
  ["validation"]="grok:grok-build kimi:kimi-code/kimi-for-coding"
  ["creative"]="grok:grok-composer-2.5-fast kimi:kimi-code/kimi-for-coding"
  ["balanced"]="grok:grok-build kimi:kimi-code/kimi-for-coding"
)
declare -A ROUTING_PRIORITY=()
for _rt in fast long-horizon reasoning validation creative balanced; do
  ROUTING_PRIORITY["$_rt"]="$(model_for_type "$_rt") ${ROUTING_FALLBACK_TAILS[$_rt]}"
done
unset _rt

# ─────────────────────────────────────────────────────────────────────────────
# Complexity Analysis
# ─────────────────────────────────────────────────────────────────────────────

analyze_task_type() {
  classify_task_type "$1"
}

# ─────────────────────────────────────────────────────────────────────────────
# Route Selection
# ─────────────────────────────────────────────────────────────────────────────

select_route() {
  local task_type="$1"
  local force_backend="${2:-}"
  
  local available_backends
  available_backends=$(detect_backends)
  
  # If forcing a backend
  if [[ -n "$force_backend" ]]; then
    if echo "$available_backends" | grep -qw "$force_backend"; then
      # Return first model for that backend
      local priority="${ROUTING_PRIORITY[$task_type]:-${ROUTING_PRIORITY[balanced]}}"
      for route in $priority; do
        local backend="${route%%:*}"
        if [[ "$backend" == "$force_backend" ]]; then
          echo "$route"
          return
        fi
      done
      # Fallback to default model for backend
      case "$force_backend" in
        command-code) echo "command-code:claude-sonnet-5" ;;
        kimi) echo "kimi:kimi-code/kimi-for-coding" ;;
        grok) echo "grok:grok-composer-2.5-fast" ;;
        *) echo "command-code:claude-sonnet-5" ;;
      esac
      return
    else
      echo "ERROR: Backend '$force_backend' not available" >&2
      return 1
    fi
  fi
  
  # Get priority list for task type
  local priority="${ROUTING_PRIORITY[$task_type]:-${ROUTING_PRIORITY[balanced]}}"
  
  # Find first available backend:model
  for route in $priority; do
    local backend="${route%%:*}"
    if echo "$available_backends" | grep -qw "$backend"; then
      echo "$route"
      return
    fi
  done
  
  # Absolute fallback
  echo "command-code:claude-sonnet-5"
}

# ─────────────────────────────────────────────────────────────────────────────
# Route-Only Selection (programmatic; no command generation/execution)
# ─────────────────────────────────────────────────────────────────────────────

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

# verdict: the unified 3-verdict classification (issue #6). Pure remap of
# route_only so --verdict and --route-only can never disagree.
#   inline\t-      -> inline
#   none\t-        -> claude-subagent   (no external backend => needs live session)
#   backend\tmodel -> external\tbackend\tmodel
# Note: a forced `--backend <name>` that is NOT available makes route_only emit
# `none\t-`, so --verdict reports `claude-subagent` and exits 0 -- whereas a bare
# `--route-only` with the same unavailable forced backend exits 1 with an ERROR on
# stderr. That is intentional (forced backend gone => fall back to the live session)
# and harmless today (no consumer wires --verdict with a forced backend); revisit
# this mapping if one ever does.
verdict() {
  local line b m
  line=$(route_only "$1")
  b=${line%%$'\t'*}; m=${line#*$'\t'}
  case "$b" in
    inline) printf 'inline\n' ;;
    none)   printf 'claude-subagent\n' ;;
    *)      printf 'external\t%s\t%s\n' "$b" "$m" ;;
  esac
}

# verdict_label: just the first field of verdict() (inline|external|claude-subagent),
# for embedding in --json.
verdict_label() {
  verdict "$1" | cut -f1
}

# route_only_with_fallbacks: like route_only, but emits the FULL
# priority-filtered fallback chain for the task's type -- one
# "backend<TAB>model" line per backend in ROUTING_PRIORITY order, filtered to
# backends actually available (detect_backends / TEMPERANCE_BACKENDS). Reuses
# select_route's priority table directly rather than re-deriving it, so the
# ordering and catalog stay a single source of truth.
route_only_with_fallbacks() {
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

  # --backend forces a single line, same convention as route_only.
  if [[ -n "$FORCE_BACKEND" ]]; then
    if ! echo " $avail " | grep -q " $FORCE_BACKEND "; then
      printf 'none\t-\n'; return
    fi
    local forced_route
    forced_route=$(select_route "$task_type" "$FORCE_BACKEND") || { printf 'none\t-\n'; return; }
    local fb="${forced_route%%:*}" fm="${forced_route#*:}"
    [[ -n "$FORCE_MODEL" ]] && fm="$FORCE_MODEL"
    printf '%s\t%s\n' "$fb" "$fm"
    return
  fi

  local priority="${ROUTING_PRIORITY[$task_type]:-${ROUTING_PRIORITY[balanced]}}"
  local printed=false
  local route backend model
  for route in $priority; do
    backend="${route%%:*}"; model="${route#*:}"
    if echo " $avail " | grep -q " $backend "; then
      [[ -n "$FORCE_MODEL" ]] && model="$FORCE_MODEL"
      printf '%s\t%s\n' "$backend" "$model"
      printed=true
    fi
  done
  $printed || printf 'none\t-\n'
}

# ─────────────────────────────────────────────────────────────────────────────
# Command Generation
# ─────────────────────────────────────────────────────────────────────────────

generate_command() {
  echo "# DISPLAY ONLY -- never eval; use --route-only + argv execution instead"
  local route="$1"
  local desc="$2"
  local max_turns="${3:-10}"

  local backend="${route%%:*}"
  local model="${route#*:}"
  
  # Escape description for shell
  local escaped_desc="${desc//\"/\\\"}"
  
  case "$backend" in
    command-code)
      echo "command-code -p \"$escaped_desc\" --model $model --max-turns $max_turns --trust --yolo --skip-onboarding"
      ;;
    
    kimi)
      echo "kimi --print --yolo --model $model -p \"$escaped_desc\""
      ;;
    
    grok)
      echo "$HOME/.grok/bin/grok --model $model --always-approve \"$escaped_desc\""
      ;;

    *)
      echo "# Unknown backend: $backend"
      ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# Execution
# ─────────────────────────────────────────────────────────────────────────────

execute_route() {
  local route="$1"
  local desc="$2"
  local max_turns="${3:-10}"
  
  local backend="${route%%:*}"
  local model="${route#*:}"
  
  case "$backend" in
    command-code)
      command-code -p "$desc" --model "$model" --max-turns "$max_turns" --trust --yolo --skip-onboarding
      ;;
    
    kimi)
      kimi --print --yolo --model "$model" -p "$desc"
      ;;
    
    grok)
      "$HOME/.grok/bin/grok" --model "$model" --always-approve "$desc"
      ;;

    *)
      echo "Unknown backend: $backend" >&2
      return 1
      ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# Output Formatting
# ─────────────────────────────────────────────────────────────────────────────

output_json() {
  local desc="$1" task_type="$2" route="$3"
  local backend="${route%%:*}" model="${route#*:}"
  local info="${MODEL_CATALOG[$route]:-unknown:unknown:unknown}"
  local tier="${info%%:*}" rest="${info#*:}"
  local strength="${rest%%:*}" context="${rest#*:}"
  # Detect once, then derive the verdict from the already-selected route rather
  # than calling verdict_label -> route_only (which would re-run detect_backends,
  # re-probing `command-code status` ~10s per extra call). output_json is only
  # reached for non-inline tasks, so the verdict is external unless the selected
  # backend is not actually available -- matching route_only's phantom-fallback
  # guard (backend absent from avail => no external route => claude-subagent).
  local avail; avail="$(detect_backends)"
  local verdict="external"
  if ! printf ' %s ' "$avail" | grep -q " $backend "; then verdict="claude-subagent"; fi
  jq -n --arg task "$desc" --arg tt "$task_type" --arg b "$backend" --arg m "$model" \
        --arg tier "$tier" --arg s "$strength" --arg c "$context" --arg avail "$avail" \
        --arg verdict "$verdict" \
    '{task:$task, task_type:$tt, backend:$b, model:$m, tier:$tier, strength:$s,
      context_window:$c, available_backends:$avail, verdict:$verdict}'
}

output_human() {
  local desc="$1"
  local task_type="$2"
  local route="$3"
  local backend="${route%%:*}"
  local model="${route#*:}"
  local info="${MODEL_CATALOG[$route]:-unknown:unknown:unknown}"
  local tier="${info%%:*}"
  local rest="${info#*:}"
  local strength="${rest%%:*}"
  local context="${rest#*:}"
  
  echo "Task type:    $task_type"
  echo "Backend:      $backend"
  echo "Model:        $model"
  echo "Tier:         $tier"
  echo "Strength:     $strength"
  echo "Context:      $context"
  echo ""
  echo "Available backends: $(detect_backends)"
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

usage() {
  cat << EOF
Usage: $0 [OPTIONS] "task description"

OPTIONS:
  --json              Output JSON format
  --command           Generate execution command (don't execute)
  --execute           Execute the routed task
  --backend <name>    Force specific backend (command-code, kimi, grok)
  --model <name>      Force specific model (used with --route-only)
  --route-only        Print "BACKEND<TAB>MODEL" and exit (for programmatic callers)
  --route-only-with-fallbacks
                      Print the full priority-filtered fallback chain, one
                      "BACKEND<TAB>MODEL" line per available backend, in
                      priority order (for programmatic callers)
  --verdict           Print the unified verdict: "inline" |
                      "external<TAB>backend<TAB>model" | "claude-subagent"
  --list-backends     List available backends and exit
  --list-models       List all models in catalog
  -h, --help          Show this help

BACKENDS:
  command-code        35 models via Command Code CLI
  kimi                K2.7 Code via Kimi CLI
  grok                grok-composer-2.5-fast, grok-build via Grok CLI

EXAMPLES:
  $0 "implement auth middleware"
  $0 --json "refactor the entire database layer"
  $0 --command "implement auth middleware"
  $0 --execute "quick fix: update comment"
  $0 --backend kimi "long coding task"
  $0 --list-backends
EOF
}

main() {
  local json=false
  local command=false
  local execute=false
  local route_only_mode=false
  local route_only_fallbacks_mode=false
  local verdict_mode=false
  declare -g FORCE_BACKEND=""
  declare -g FORCE_MODEL=""
  local desc=""

  while [[ $# -gt 0 ]]; do
    case $1 in
      --json) json=true; shift ;;
      --command) command=true; shift ;;
      --execute) execute=true; shift ;;
      --route-only) route_only_mode=true; shift ;;
      --route-only-with-fallbacks) route_only_fallbacks_mode=true; shift ;;
      --verdict) verdict_mode=true; shift ;;
      --model) FORCE_MODEL="$2"; shift 2 ;;
      --backend) FORCE_BACKEND="$2"; shift 2 ;;
      --list-backends)
        echo "Available backends: $(detect_backends)"
        exit 0
        ;;
      --list-models)
        echo "Model catalog:"
        for key in "${!MODEL_CATALOG[@]}"; do
          echo "  $key → ${MODEL_CATALOG[$key]}"
        done | sort
        exit 0
        ;;
      -h|--help) usage; exit 0 ;;
      --) shift; break ;;
      *) desc="$1"; shift ;;
    esac
  done

  # If "--" ended option parsing, any remaining positional arg is the description.
  if [[ $# -gt 0 && -z "$desc" ]]; then desc="$1"; fi

  if [[ -z "$desc" ]]; then
    usage
    exit 1
  fi

  if $route_only_mode; then
    route_only "$desc"
    exit 0
  fi

  if $route_only_fallbacks_mode; then
    route_only_with_fallbacks "$desc"
    exit 0
  fi

  if $verdict_mode; then
    verdict "$desc"
    exit 0
  fi

  # Analyze task
  local task_type
  task_type=$(analyze_task_type "$desc")
  
  # Handle inline tasks
  if [[ "$task_type" == "inline" ]]; then
    if $json; then
      echo '{"task_type": "inline", "executor": "inline", "verdict": "inline", "reason": "one-shot extraction, no external dispatch"}'
      exit 0
    else
      echo "Task type:    inline"
      echo "Executor:     inline (handle in current session)"
      echo "Reason:       one-shot extraction, no external dispatch needed"
      $execute && exit 3   # signal 'not executed' to programmatic callers
      exit 0
    fi
  fi
  
  # Select route
  local route
  route=$(select_route "$task_type" "$FORCE_BACKEND")
  
  if $json; then
    output_json "$desc" "$task_type" "$route"
  elif $command; then
    generate_command "$route" "$desc"
  elif $execute; then
    echo "Executing via $route..."
    echo ""
    execute_route "$route" "$desc"
  else
    output_human "$desc" "$task_type" "$route"
  fi
}

main "$@"
