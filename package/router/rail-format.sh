#!/usr/bin/env bash
# rail-format.sh — shared sigil-formatted rail/combo announcements (no emojis).
# Usage:
#   rail-format.sh announce <phase> <combo> [native_model]
#   rail-format.sh stack <combo>
#   rail-format.sh resolved <combo> <provider> <model>
set -euo pipefail

DB="${OMNIROUTE_DB:-$HOME/.omniroute/storage.sqlite}"

# Alchemical stage labels aligned with PAI 7-phase Algorithm (sigils = planetary, not emoji)
phase_meta() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    observe|observing) echo "1|7|NIGREDO|OBSERVE|♄" ;;
    think|thinking)    echo "2|7|ALBEDO|THINK|☿" ;;
    plan|planning)     echo "3|7|ALBEDO|PLAN|☉" ;;
    build|building)    echo "4|7|CITRINITAS|BUILD|♃" ;;
    execute|exec)      echo "5|7|RUBEDO|EXECUTE|♂" ;;
    verify|verify)     echo "6|7|RUBEDO|VERIFY|♀" ;;
    learn|learning)    echo "7|7|MULTIPLICATIO|LEARN|☽" ;;
    *)                 echo "·|7|PROCESS|$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')|◇" ;;
  esac
}

split_model() {
  # provider/rest → provider model
  local m="$1"
  if [[ "$m" == */* ]]; then
    printf '%s\t%s\n' "${m%%/*}" "${m#*/}"
  else
    printf '%s\t%s\n' "omniroute" "$m"
  fi
}

combo_stack() {
  local combo="$1"
  if [[ ! -f "$DB" ]] || ! command -v sqlite3 >/dev/null 2>&1; then
    return 0
  fi
  sqlite3 "$DB" "SELECT data FROM combos WHERE name='$(printf '%s' "$combo" | sed "s/'/''/g")' LIMIT 1;" 2>/dev/null \
    | python3 -c "
import json,sys
raw=sys.stdin.read().strip()
if not raw: sys.exit(0)
try:
  d=json.loads(raw)
except Exception:
  sys.exit(0)
for i,m in enumerate(d.get('models') or [], 1):
  mid=m.get('model') or ''
  prov=m.get('providerId') or (mid.split('/')[0] if '/' in mid else 'omniroute')
  rest=mid.split('/',1)[1] if '/' in mid else mid
  print(f'{i}\t{prov}\t{rest}\t{mid}')
" 2>/dev/null
}

cmd_stack() {
  local combo="$1"
  echo "◇ STACK · ${combo}"
  local n=0
  while IFS=$'\t' read -r i prov rest mid; do
    [[ -z "${i:-}" ]] && continue
    n=1
    printf '  %s  %-14s  %s\n' "$i" "$prov" "$rest"
  done < <(combo_stack "$combo")
  if [[ "$n" -eq 0 ]]; then
    echo "  ·  (stack unavailable — combo not in live OmniRoute catalog)"
  fi
}

cmd_announce() {
  local phase="$1" combo="$2" native="${3:-gpt-5.4}"
  local meta step total stage label sigil
  IFS='|' read -r step total stage label sigil <<<"$(phase_meta "$phase")"
  local head_prov="" head_rest="" head_mid=""
  local first
  first=$(combo_stack "$combo" | head -1 || true)
  if [[ -n "$first" ]]; then
    IFS=$'\t' read -r _ head_prov head_rest head_mid <<<"$first"
  fi

  echo "${sigil} RAIL · ${stage} · ${label} · ${step}/${total}"
  printf '  ·  %-10s  %s\n' "native" "${native}  (orchestrator · babysit)"
  printf '  ·  %-10s  %s\n' "combo" "${combo}"
  if [[ -n "$head_prov" ]]; then
    printf '  ·  %-10s  %s · %s\n' "head" "$head_prov" "$head_rest"
  fi
  echo "  ·  stack"
  local any=0
  while IFS=$'\t' read -r i prov rest mid; do
    [[ -z "${i:-}" ]] && continue
    any=1
    mark=" "
    [[ "$i" == "1" ]] && mark="►"
    printf '     %s %s  %-14s  %s\n' "$mark" "$i" "$prov" "$rest"
  done < <(combo_stack "$combo")
  [[ "$any" -eq 0 ]] && echo "     ·  (unavailable)"
  echo "  ·  dispatch"
  echo "     ~/.temperance_engine/router/temperance-phase-dispatch.sh ${phase} \"…\""
  echo "     ~/.temperance_engine/router/omniroute-codex.sh ${combo} \"…\""
}

cmd_resolved() {
  local combo="$1" provider="$2" model="$3"
  echo "☿ COMBO · ${combo} · RESOLVED"
  printf '  ·  %-10s  %s\n' "provider" "$provider"
  printf '  ·  %-10s  %s\n' "model" "$model"
  printf '  ·  %-10s  %s\n' "route" "${provider}/${model}"
}

case "${1:-}" in
  announce) shift; cmd_announce "$@" ;;
  stack) shift; cmd_stack "$@" ;;
  resolved) shift; cmd_resolved "$@" ;;
  *)
    echo "usage: $0 announce <phase> <combo> [native]" >&2
    echo "       $0 stack <combo>" >&2
    echo "       $0 resolved <combo> <provider> <model>" >&2
    exit 2
    ;;
esac
