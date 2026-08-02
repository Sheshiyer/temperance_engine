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
# The 2026-07-21 command-code deals for Hy3 and MiniMax-M3 expired. On
# 2026-07-28 new bounded FREE deals were recorded in ISA.md for the two
# vacated high-volume slots, restoring the 2026-07-18 decision's
# free/credit-deal intent. Every pin below was re-verified against the live
# command-code catalog: `command-code --list-models` (CLI v1.4.3, 2026-07-28).
model_for_type() {
  case "$1" in
    # 2026-07-28: FREE "fast lightweight-MoE coding & agentic work"; succeeds
    # the expired tencent/Hy3 FREE deal. Src: command-code --list-models v1.4.3.
    fast)         echo "command-code:inclusionai/ling-3.0-flash-free" ;;
    # 2026-07-28: 5x permanent credit deal (ISA 2026-07-18); still listed.
    # Src: command-code --list-models v1.4.3, 2026-07-28.
    long-horizon) echo "command-code:xiaomi/mimo-v2.5-pro" ;;
    # 2026-07-28: 4x permanent credit deal (ISA 2026-07-18); still listed.
    # Src: command-code --list-models v1.4.3, 2026-07-28.
    reasoning)    echo "command-code:deepseek/deepseek-v4-pro" ;;
    # 2026-07-28: same FREE deal as fast (high-volume slot).
    validation)   echo "command-code:inclusionai/ling-3.0-flash-free" ;;
    # 2026-07-28: FREE "open-weight agentic coding and long-horizon work";
    # succeeds the expired MiniMaxAI/MiniMax-M3 2.67x deal.
    # Src: command-code --list-models v1.4.3, 2026-07-28.
    creative)     echo "command-code:poolside/laguna-s-2.1-free" ;;
    inline)       echo "inline:current-session" ;;
    # balanced default: same FREE deal as creative.
    *)            echo "command-code:poolside/laguna-s-2.1-free" ;;
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
