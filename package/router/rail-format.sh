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

_gsd_box_line() {
  local inner="$1"
  local width=60
  local pad=$((width - ${#inner}))
  ((pad < 0)) && pad=0
  printf '| %s%*s |\n' "$inner" "$pad" ""
}

cmd_gsd_init() {
  local name="${1:?command}"
  local map="${TEMPERANCE_GSD_RAIL_MAP:-$HOME/.temperance_engine/router/gsd-rail-map.json}"
  python3 - "$map" "$name" <<'PY'
import json, os, sqlite3, subprocess, sys
from pathlib import Path
home = Path.home()
mp, name = sys.argv[1], sys.argv[2]
try:
    m = json.loads(Path(mp).read_text())
except Exception:
    print("x GSD · rail map unreadable"); sys.exit(1)
spec = (m.get("commands") or {}).get(name) or dict(m.get("defaults") or {})
mode = spec.get("mode") or "ALGORITHM"
combo = spec.get("combo")
seq = spec.get("combo_sequence") or ([combo] if combo else [])
alchemy = spec.get("alchemy") or "—"
view = spec.get("view") or "PLANNING"
group = spec.get("group") or "ops"
phase = {
    "OBSERVE": "observe", "THINK": "think", "PLAN": "plan",
    "BUILD": "build", "EXECUTE": "execute", "VERIFY": "verify", "LEARN": "learn",
}.get(str(alchemy).upper(), "observe")
# banner via self
script = Path(os.environ.get("HOME", str(home))) / ".temperance_engine/router/rail-format.sh"
ctx = f"/{name}"
extra = f"mode {mode} · combo {(' → '.join(seq) if seq else 'none')} · {view}"
subprocess.run([str(script), "gsd-banner", phase, ctx, extra], check=False)
print(f"  ·  group     {group}")
print(f"  ·  alchemy   {alchemy}")
print(f"  ·  workflow  ~/.claude/get-shit-done/workflows/{name}.md")
print(f"  ·  map       gsd-rail-map.json")
goal = Path.cwd() / ".temperance" / "goal.json"
if goal.exists():
    try:
        g = json.loads(goal.read_text())
        print(f"  ·  goal      {g.get('status','?')} · {str(g.get('text') or '')[:120]}")
        print(f"  ·  planner   {g.get('planner','?')} · next /gsd:{g.get('gsd_command','progress')}")
    except Exception:
        print("  ·  goal      unreadable")
else:
    print("  ·  goal      none · temperance-goal --ensure")
db = Path(os.environ.get("OMNIROUTE_DB") or (home / ".omniroute/storage.sqlite"))
shown = []
for c in seq:
    if not c or c in shown:
        continue
    shown.append(c)
    print(f"  ·  stack     {c}")
    if not db.exists():
        print("     ·  (omniroute db missing)")
        continue
    try:
        raw = sqlite3.connect(f"file:{db}?mode=ro", uri=True).execute(
            "SELECT data FROM combos WHERE name=? LIMIT 1", (c,)
        ).fetchone()
    except Exception:
        raw = None
    if not raw:
        print("     ·  (combo not in live catalog)")
        continue
    models = (json.loads(raw[0]).get("models") or [])[:6]
    for i, mrow in enumerate(models, 1):
        mid = mrow.get("model") or ""
        mark = ">" if i == 1 else " "
        print(f"     {mark} {i}  {mid}")
if spec.get("next_wave"):
    print("  ·  fleet     temperance-next-wave + te-dispatch-paid (no double spawn)")
print("  ·  design    ~/.temperance_engine/docs/GSD-PAI-DESIGN-FLOW.md")
PY
}

cmd_gsd_banner() {
  local phase="${1:-execute}" context="${2:-}" extra="${3:-}"
  local step total stage label sigil
  IFS='|' read -r step total stage label sigil <<<"$(phase_meta "$phase")"
  local title="${sigil} GSD · ${stage} · ${label}"
  [[ -n "$context" ]] && title="${title} · ${context}"
  echo "+--------------------------------------------------------------+"
  _gsd_box_line "$title"
  [[ -n "$extra" ]] && _gsd_box_line "$extra"
  echo "+--------------------------------------------------------------+"
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
  gsd-banner) shift; cmd_gsd_banner "$@" ;;
  gsd-init) shift; cmd_gsd_init "$@" ;;
  *)
    echo "usage: $0 announce <phase> <combo> [native]" >&2
    echo "       $0 stack <combo>" >&2
    echo "       $0 resolved <combo> <provider> <model>" >&2
    echo "       $0 gsd-banner <phase> [context] [extra]" >&2
    echo "       $0 gsd-init <gsd-command>" >&2
    exit 2
    ;;
esac
