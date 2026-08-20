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
#   ralph | optimize | dispatch | media | vision | research | plan-max | plan
#   | long-horizon | reasoning | validation | creative | fast | inline | balanced
# Ordered, first-match-wins. Availability/session gating lives in classify-route.
classify_task_type() {
  lower_desc=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  if _kw "$lower_desc" 'ralph|maestro|ephemeral feature|isolated context|feature loop'; then
    echo "ralph"; return
  fi
  if _kw "$lower_desc" 'autoresearch|hill-?climb|optimize loop|eval mode|keep/discard|karpathy'; then
    echo "optimize"; return
  fi
  if _kw "$lower_desc" 'dispatch|parallel workers|paid fleet|te-dispatch|swarm fan-?out'; then
    echo "dispatch"; return
  fi
  if _kw "$lower_desc" 'elevenlabs|runway|text-to-speech|tts|image-to-video|meshy|voiceover|voice over'; then
    echo "media"; return
  fi
  if _kw "$lower_desc" 'screenshot|vision bridge|te-vision|image audit'; then
    echo "vision"; return
  fi
  if _kw "$lower_desc" 'literature|cite sources|web search|search evidence|te-write-research'; then
    echo "research"; return
  fi
  if _kw "$lower_desc" 'plan-max|te-plan-max|architecture decision|system design|multi-?milestone|deep pass|task graph'; then
    echo "plan-max"; return
  fi
  if _kw "$lower_desc" 'roadmap|spec|architecture|implementation plan'; then
    echo "plan"; return
  fi
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
# Command Code primaries = live deals only (2026-08-19 pricing-limits + Studio).
# Keep: laguna-s-2.1-free, xiaomi/mimo-v2.5-pro (~5x), MiniMax-M3 (~2x),
# google/gemini-3.7-flash (~2x through 2026-12-31).
# Do not pin full-price CC (deepseek-v4-pro/flash, terra, Step flash).
# Combo stacks still come from lane-templates + rank-paid-fleet — this file
# only names the CC classifier primary per task type.
model_for_type() {
  case "$1" in
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
