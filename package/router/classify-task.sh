#!/usr/bin/env sh
# package/router/classify-task.sh
# Single source of truth for task-type classification + the command-code
# primary model per type. POSIX sh (no bashisms) so it runs under /bin/sh,
# macOS system bash, and homebrew bash alike. Sourced by
# multi-backend-router.sh (functions only) and exec'd by
# package/enrich/stages/routing.ts (CLI). Pure: NO backend detection, NO
# availability gating -- that stays in the router. Does NOT call `set` (it is
# sourced into a script with its own shell options and must not mutate them).

# classify_task_type "<task>" -> one of:
#   long-horizon | reasoning | validation | creative | fast | inline | balanced
# Ordered, first-match-wins. This is the ONLY copy of these regexes.
classify_task_type() {
  lower_desc=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  if printf '%s' "$lower_desc" | grep -qE '\b(refactor|rewrite|migrate|redesign|overhaul|restructure|entire|all files|across.*files)\b'; then
    echo "long-horizon"; return
  fi
  if printf '%s' "$lower_desc" | grep -qE '\b(analyze|debug|diagnose|explain|understand|reason|think|complex|difficult)\b'; then
    echo "reasoning"; return
  fi
  if printf '%s' "$lower_desc" | grep -qE '\b(validate|verify|review|check|audit|test|ensure|confirm)\b'; then
    echo "validation"; return
  fi
  if printf '%s' "$lower_desc" | grep -qE '\b(brainstorm|creative|design|explore|imagine|ideate|alternative)\b'; then
    echo "creative"; return
  fi
  if printf '%s' "$lower_desc" | grep -qE '\b(quick|simple|small|minor|tweak|fix typo|update comment)\b'; then
    echo "fast"; return
  fi
  if printf '%s' "$lower_desc" | grep -qE '\b(extract|classify|summarize|list|identify|find|count)\b'; then
    if ! printf '%s' "$lower_desc" | grep -qE '\b(read|search|grep|edit|write|run|execute|test|build|compile)\b'; then
      echo "inline"; return
    fi
  fi
  echo "balanced"
}

# model_for_type "<type>" -> "<backend>:<model>" (the command-code primary;
# inline -> current-session sentinel). Single source of the type->primary
# catalog: MBR derives ROUTING_PRIORITY's command-code column from this, and
# routing.ts renders `preferred=` from it.
model_for_type() {
  case "$1" in
    fast)         echo "command-code:deepseek/deepseek-v4-flash" ;;
    long-horizon) echo "command-code:moonshotai/Kimi-K2.7-Code" ;;
    reasoning)    echo "command-code:claude-fable-5" ;;
    validation)   echo "command-code:google/gemini-3.5-flash" ;;
    creative)     echo "command-code:claude-sonnet-5" ;;
    inline)       echo "inline:current-session" ;;
    *)            echo "command-code:claude-sonnet-5" ;;
  esac
}

# CLI: `classify-task.sh "<task>"` -> "<type>\t<backend>:<model>". Runs ONLY
# when executed directly, not when sourced. The basename-of-$0 guard works in
# both bash (sourcing does not change $0) and sh.
_classify_main() {
  _t=$(classify_task_type "$1")
  printf '%s\t%s\n' "$_t" "$(model_for_type "$_t")"
}
case "${0##*/}" in
  classify-task.sh) _classify_main "$@" ;;
esac
