#!/usr/bin/env bash
# One alchemical step on a gateway-owned combo; policy admission precedes the wire.
set -euo pipefail

PHASE="${1:-}"
TASK="${2:-}"
[[ -n "$PHASE" && -n "$TASK" ]] || {
  echo "usage: $0 <phase|task_type|combo> \"task\"" >&2
  exit 2
}

ROUTER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MAP="${TEMPERANCE_PHASE_COMBO_MAP:-$ROUTER_DIR/phase-combo-map.json}"
CONTRACT_CLI="${TEMPERANCE_ROUTING_CONTRACT_CLI:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/routing-contract-cli.ts}"
WIRE="${TEMPERANCE_OMNIROUTE_CODEX:-$ROUTER_DIR/omniroute-codex.sh}"
FORMAT="${TEMPERANCE_RAIL_FORMAT:-$ROUTER_DIR/rail-format.sh}"
NATIVE="${TEMPERANCE_ORCHESTRATOR_MODEL:-unreported}"

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

# The optional host policy may require exact-seat checks on every fallback.
# The stock gateway adapter cannot prove that contract, so held means no wire.
# Do not promote saved evidence files or advertised context sizes into permits.
"${TEMPERANCE_BUN:-bun}" "$ROUTER_DIR/session-admission-cli.ts" "$phase_label" "$COMBO" >&2 || exit "$?"

if [[ -x "$FORMAT" ]]; then
  "$FORMAT" announce "$phase_label" "$COMBO" "$NATIVE" >&2
  echo >&2
else
  echo "RAIL combo=$COMBO phase=$phase_label native=$NATIVE" >&2
fi

[[ -x "$WIRE" ]] || { echo "missing omniroute-codex.sh at $WIRE" >&2; exit 127; }

# Capture output; best-effort resolved line if response is plain text only
OUT_FILE=$(mktemp)
set +e
"$WIRE" "$COMBO" "$TASK" >"$OUT_FILE" 2> >(tee /dev/stderr >&2)
rc=$?
set -e

# A catalog head is not an actual attempt receipt. Preserve unverified status.
if [[ -x "$FORMAT" ]]; then
  "$FORMAT" resolved "$COMBO" >&2
fi

cat "$OUT_FILE"
rm -f "$OUT_FILE"
exit "$rc"
