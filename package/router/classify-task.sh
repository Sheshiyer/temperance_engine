#!/usr/bin/env sh
# Compatibility boundary for CLI and sourced shell callers. Task-type ownership
# is task-classification.ts; product shell callers retain their reviewed model
# stream until multi-backend routing moves to the TypeScript contract directly.
# Sourcing defines functions only and preserves options.
# POSIX sourced callers outside Bash must set TEMPERANCE_CLASSIFY_MODULE_DIR
# when using a checkout other than $HOME/.temperance_engine/router.
# Subshells keep all scratch variables and cwd changes out of the caller.
_temperance_classification_dir() (
  _tc_src="$1"
  while [ -L "$_tc_src" ]; do
    _tc_base=$(CDPATH= cd -P -- "$(dirname -- "$_tc_src")" && pwd) || exit
    _tc_src=$(readlink "$_tc_src") || exit
    case "$_tc_src" in /*) ;; *) _tc_src="$_tc_base/$_tc_src" ;; esac
  done
  CDPATH= cd -P -- "$(dirname -- "$_tc_src")" && pwd
)
_temperance_classification_run() (
  _tc_module="$1"
  shift
  _tc_bun=$(command -v "${TEMPERANCE_BUN:-bun}") || {
    printf '%s\n' 'classification: Bun executable unavailable' >&2; exit 127;
  }
  case "$_tc_bun" in /*) ;; *) _tc_bun="$PWD/$_tc_bun" ;; esac
  # Neither inherited Bun/Node options nor cwd/global Bun configuration may
  # preload code or replace the pure contract process environment.
  _tc_output=$(/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C "$_tc_bun" \
    --no-env-file --config=/dev/null "$_tc_module" "$@") || exit "$?"
  [ -n "$_tc_output" ] || {
    printf '%s\n' 'classification: runtime returned no result' >&2; exit 2;
  }
  printf '%s\n' "$_tc_output"
)
_temperance_classification() (
  if [ -n "${TEMPERANCE_CLASSIFY_MODULE_DIR:-}" ]; then
    _tc_dir=$(CDPATH= cd -P -- "$TEMPERANCE_CLASSIFY_MODULE_DIR" && pwd) || exit
  elif [ -n "${BASH_SOURCE:-}" ]; then
    _tc_dir=$(_temperance_classification_dir "$BASH_SOURCE") || exit
  else
    _tc_dir="${TEMPERANCE_HOME:-$HOME/.temperance_engine}/router"
    _tc_dir=$(CDPATH= cd -P -- "$_tc_dir" && pwd) || exit
  fi
  _temperance_classification_run "$_tc_dir/routing-contract-cli.ts" "$@"
)
classify_task_type() { _temperance_classification type "${1:-}"; }
# Product compatibility: multi-backend-router.sh consumes this direct-route
# column, while newer TypeScript consumers use task-classification.ts directly.
model_for_type() {
  case "${1:-}" in
    ralph)        echo "combo:te-build" ;;
    optimize)     echo "combo:te-reason" ;;
    dispatch)     echo "combo:te-dispatch-paid" ;;
    media)        echo "combo:te-write-media" ;;
    vision)       echo "combo:te-vision" ;;
    research)     echo "combo:te-write-research" ;;
    plan-max)     echo "combo:te-plan-max" ;;
    plan)         echo "combo:te-plan" ;;
    fast)         echo "command-code:poolside/laguna-s-2.1-free" ;;
    long-horizon) echo "command-code:xiaomi/mimo-v2.5-pro" ;;
    reasoning)    echo "command-code:xiaomi/mimo-v2.5-pro" ;;
    validation)   echo "command-code:google/gemini-3.7-flash" ;;
    creative)     echo "command-code:MiniMaxAI/MiniMax-M3" ;;
    inline)       echo "inline:current-session" ;;
    *)            echo "command-code:poolside/laguna-s-2.1-free" ;;
  esac
}
_classify_main() (
  _tc_type=$(classify_task_type "${1:-}") || exit
  printf '%s\t%s\n' "$_tc_type" "$(model_for_type "$_tc_type")"
)
case "${0##*/}" in
  classify-task.sh) _classify_main "$@" ;;
esac
