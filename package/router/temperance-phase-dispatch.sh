#!/usr/bin/env bash
# temperance-phase-dispatch.sh — one alchemical step on an OmniRoute combo.
# Prints sigil-formatted rail + provider stack (no emojis), then wires omniroute-codex.
set -euo pipefail

PHASE="${1:-}"
TASK="${2:-}"
[[ -n "$PHASE" && -n "$TASK" ]] || {
  echo "usage: $0 <phase|task_type|combo> \"task\"" >&2
  exit 2
}

MAP="${TEMPERANCE_PHASE_COMBO_MAP:-$HOME/.temperance_engine/router/phase-combo-map.json}"
CONTRACT_CLI="${TEMPERANCE_ROUTING_CONTRACT_CLI:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/routing-contract-cli.ts}"
WIRE="${TEMPERANCE_OMNIROUTE_CODEX:-$HOME/.temperance_engine/router/omniroute-codex.sh}"
FORMAT="${TEMPERANCE_RAIL_FORMAT:-$HOME/.temperance_engine/router/rail-format.sh}"
NATIVE="${TEMPERANCE_ORCHESTRATOR_MODEL:-gpt-5.4}"

resolve_combo() (
  local contract_bun contract_combo
  contract_bun=$(command -v "${TEMPERANCE_BUN:-bun}") || {
    echo "phase resolution: Bun executable unavailable" >&2; exit 127;
  }
  # Keep the shared resolver pure when a caller supplies local Bun/Node
  # settings or preload options. The explicit module path preserves product
  # checkout and installed-router overrides without inheriting global config.
  contract_combo=$(/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C "$contract_bun" \
    --no-env-file --config=/dev/null "$CONTRACT_CLI" phase "$1" "$TASK" "$MAP") || exit "$?"
  [[ -n "$contract_combo" ]] || {
    echo "phase resolution: runtime returned no result" >&2; exit 2;
  }
  printf '%s\n' "$contract_combo"
)

# normalize phase label for formatting when user passed a combo id
phase_label="$PHASE"
case "$PHASE" in
  noesis-observe|te-reason) phase_label="Think" ;;
  noesis-plan|te-plan) phase_label="Plan" ;;
  noesis-build|te-build) phase_label="Build" ;;
  noesis-execute|te-dispatch-paid|te-dispatch) phase_label="Execute" ;;
  noesis-verify|te-validate) phase_label="Verify" ;;
  noesis-fast|te-fast) phase_label="Observe" ;;
esac

COMBO=$(resolve_combo "$PHASE")

if [[ -x "$FORMAT" ]]; then
  "$FORMAT" announce "$phase_label" "$COMBO" "$NATIVE" >&2
  echo >&2
else
  echo "RAIL combo=$COMBO phase=$phase_label native=$NATIVE" >&2
fi

[[ -x "$WIRE" ]] || { echo "missing omniroute-codex.sh at $WIRE" >&2; exit 127; }

if [[ -z "${OMNIROUTE_API_KEY:-}" && -f "$HOME/.omniroute/export-api-key.sh" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.omniroute/export-api-key.sh" >/dev/null 2>&1 || true
fi

# Capture output; best-effort resolved line if response is plain text only
OUT_FILE=$(mktemp)
set +e
"$WIRE" "$COMBO" "$TASK" >"$OUT_FILE" 2> >(tee /dev/stderr >&2)
rc=$?
set -e

# Prefer last non-empty line as model reply; resolved provider unknown without gateway headers
if [[ -x "$FORMAT" ]]; then
  # head of stack as "attempted" note
  head_line=$(sqlite3 "${OMNIROUTE_DB:-$HOME/.omniroute/storage.sqlite}" \
    "SELECT data FROM combos WHERE name='$COMBO' LIMIT 1;" 2>/dev/null \
    | python3 -c "import json,sys
raw=sys.stdin.read().strip()
if not raw: raise SystemExit
m=(json.loads(raw).get('models') or [{}])[0]
mid=m.get('model') or ''
prov=m.get('providerId') or (mid.split('/')[0] if '/' in mid else 'omniroute')
rest=mid.split('/',1)[1] if '/' in mid else mid
print(prov, rest)" 2>/dev/null || true)
  if [[ -n "${head_line:-}" ]]; then
    set -- $head_line
    "$FORMAT" resolved "$COMBO" "${1:-unknown}" "${2:-unknown}" >&2
    echo "  ·  note       head of priority stack (OmniRoute may have failed over)" >&2
  fi
fi

cat "$OUT_FILE"
rm -f "$OUT_FILE"
exit "$rc"
