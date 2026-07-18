#!/usr/bin/env sh
# package/router/classify-task.sh
# Single source of truth for task-type classification + the command-code
# primary model per type. POSIX sh (no bashisms) so it runs under /bin/sh,
# macOS system bash, and homebrew bash alike. Sourced by
# multi-backend-router.sh (functions only) and exec'd by
# package/enrich/stages/routing.ts (CLI). Pure: NO backend detection, NO
# availability gating -- that stays in the router. Does NOT call `set` (it is
# sourced into a script with its own shell options and must not mutate them).

# _kw <text> <alternation> -> exit 0 if any keyword in the alternation matches
# <text> as a whole word. Uses POSIX-portable word boundaries
# `(^|[^[:alnum:]])...([^[:alnum:]]|$)` rather than the GNU/BSD `\b`, which is
# not defined by POSIX ERE and can misbehave on strict/busybox grep. Verified
# byte-identical to `\b` for these keyword lists on macOS + GNU grep.
_kw() {
  printf '%s' "$1" | grep -Eq "(^|[^[:alnum:]])($2)([^[:alnum:]]|$)"
}

# classify_task_type "<task>" -> one of:
#   long-horizon | reasoning | validation | creative | fast | inline | balanced
# Ordered, first-match-wins. This is the ONLY copy of these keyword lists.
classify_task_type() {
  lower_desc=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  if _kw "$lower_desc" 'refactor|rewrite|migrate|redesign|overhaul|restructure|entire|all files|across.*files'; then
    echo "long-horizon"; return
  fi
  if _kw "$lower_desc" 'analyze|debug|diagnose|explain|understand|reason|think|complex|difficult'; then
    echo "reasoning"; return
  fi
  if _kw "$lower_desc" 'validate|verify|review|check|audit|test|ensure|confirm'; then
    echo "validation"; return
  fi
  if _kw "$lower_desc" 'brainstorm|creative|design|explore|imagine|ideate|alternative'; then
    echo "creative"; return
  fi
  if _kw "$lower_desc" 'quick|simple|small|minor|tweak|fix typo|update comment'; then
    echo "fast"; return
  fi
  if _kw "$lower_desc" 'extract|classify|summarize|list|identify|find|count'; then
    if ! _kw "$lower_desc" 'read|search|grep|edit|write|run|execute|test|build|compile'; then
      echo "inline"; return
    fi
  fi
  echo "balanced"
}

# model_for_type "<type>" -> "<backend>:<model>" (the command-code primary;
# inline -> current-session sentinel). Single source of the type->primary
# catalog: MBR derives ROUTING_PRIORITY's command-code column from this, and
# routing.ts renders `preferred=` from it.
#
# Primaries are pinned to the account's command-code credit deals so parallel
# dispatch spends discounted/free tokens (decision 2026-07-18):
#   tencent/Hy3            FREE  ($0/req)   -- expires 2026-07-21
#   xiaomi/mimo-v2.5-pro   5x    ($30->150) -- permanent
#   deepseek/deepseek-v4-pro 4x  ($30->120) -- permanent
#   MiniMaxAI/MiniMax-M3   2.67x ($30->80)  -- expires 2026-07-21
# On/after 2026-07-21, revert the two expiring slots (fast, validation ->
# a durable fast model; creative, balanced -> a durable general model).
model_for_type() {
  case "$1" in
    fast)         echo "command-code:tencent/Hy3" ;;
    long-horizon) echo "command-code:xiaomi/mimo-v2.5-pro" ;;
    reasoning)    echo "command-code:deepseek/deepseek-v4-pro" ;;
    validation)   echo "command-code:tencent/Hy3" ;;
    creative)     echo "command-code:MiniMaxAI/MiniMax-M3" ;;
    inline)       echo "inline:current-session" ;;
    *)            echo "command-code:MiniMaxAI/MiniMax-M3" ;;
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
