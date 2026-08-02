#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/temperance-routing-policy.sh"
ROUTER="$ROOT/package/router/multi-backend-router.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
TEST_HOME="$TEST_ROOT/home"
STATE_DIR="$TEST_HOME/.temperance_engine/state"
RECEIPT_DIR="$TEST_HOME/.temperance_engine/receipts/routing-policy"
MODE_FILE="$STATE_DIR/routing-policy-mode"
OBSERVATIONS="$STATE_DIR/routing-observations.json"
mkdir -p "$STATE_DIR"

clock="$(date +%s)000"
fresh=$((clock - 1000))
stale=$((clock - 172800000))
future=$((clock + 600000))

write_safe_state() {
  jq -cn \
    --argjson clock "$clock" \
    --argjson fresh "$fresh" \
    --argjson stale "$stale" \
    --argjson future "$future" '
    {version:1,updated_at_ms:$clock,backends:{
      omniroute:{health:0.95,health_updated_at_ms:$fresh,circuit_state:"closed",circuit_updated_at_ms:$fresh},
      "command-code":{health:0.1,health_updated_at_ms:$stale,circuit_state:"open",circuit_updated_at_ms:$stale,cooldown_until_ms:$future}
    }}' > "$OBSERVATIONS"
  chmod 600 "$OBSERVATIONS"
}

run_controller() {
  HOME="$TEST_HOME" \
  TEMPERANCE_STATE_DIR="$STATE_DIR" \
  TEMPERANCE_ROUTING_POLICY_FILE="$MODE_FILE" \
  TEMPERANCE_ROUTING_STATE="$OBSERVATIONS" \
  TEMPERANCE_ROUTING_RECEIPT_DIR="$RECEIPT_DIR" \
  TEMPERANCE_ROUTING_CONTROLLER_ROUTER="$ROUTER" \
  TEMPERANCE_OMNIROUTE_CATALOG_FILE="$ROOT/tests/fixtures/omniroute-models.json" \
  TEMPERANCE_BACKENDS="omniroute command-code" \
    "$SCRIPT" "$@"
}

write_safe_state
printf '%s\n' 'shadow' > "$MODE_FILE"
chmod 600 "$MODE_FILE"
cp -p "$MODE_FILE" "$TEST_ROOT/mode.baseline"

status="$(run_controller status)"
jq -e '.configured_mode == "shadow" and .mode_file_exists == true' <<< "$status" >/dev/null
echo "ok - status reports the exact pre-promotion mode"

promotion="$(run_controller promote)"
[[ -f "$promotion" && "$(cat "$MODE_FILE")" == "enforce" ]]
[[ "$(stat -f '%Lp' "$promotion")" == "600" ]]
jq -e '.schema == "temperance.routing-policy.promotion.v1" and .selected_backend == "omniroute"' "$promotion" >/dev/null
echo "ok - promotion is OmniRoute-first and receipt-bound"

promoted_status="$(run_controller status)"
jq -e '.configured_mode == "enforce" and .plan.mode == "enforce" and .plan.selected_backend == "omniroute"' <<< "$promoted_status" >/dev/null
echo "ok - per-host mode file makes enforcement effective"

effective_plan="$(HOME="$TEST_HOME" \
  TEMPERANCE_STATE_DIR="$STATE_DIR" \
  TEMPERANCE_ROUTING_POLICY_FILE="$MODE_FILE" \
  TEMPERANCE_ROUTING_STATE="$OBSERVATIONS" \
  TEMPERANCE_ROUTING_NOW_MS="$clock" \
  TEMPERANCE_ROUTING_OBSERVATION_MAX_AGE_MS=86400000 \
  TEMPERANCE_ROUTING_CLAIM_PROBES=0 \
  TEMPERANCE_OMNIROUTE_CATALOG_FILE="$ROOT/tests/fixtures/omniroute-models.json" \
  TEMPERANCE_BACKENDS="omniroute command-code" \
  "$ROUTER" --plan-json "refactor a complex module safely")"
jq -e '
  .mode == "enforce" and .selected_order[0].backend == "omniroute" and
  ([.selected_order[].backend] | index("command-code") == null) and
  (.candidates[] | select(.backend == "command-code") | .effective_circuit_state == "open" and .eligible == false)
' <<< "$effective_plan" >/dev/null
echo "ok - effective enforcement excludes a stale open circuit"

kill_switch="$(HOME="$TEST_HOME" \
  TEMPERANCE_STATE_DIR="$STATE_DIR" \
  TEMPERANCE_ROUTING_POLICY_FILE="$MODE_FILE" \
  TEMPERANCE_ROUTING_POLICY=off \
  TEMPERANCE_ROUTING_STATE="$OBSERVATIONS" \
  TEMPERANCE_ROUTING_NOW_MS="$clock" \
  TEMPERANCE_OMNIROUTE_CATALOG_FILE="$ROOT/tests/fixtures/omniroute-models.json" \
  TEMPERANCE_BACKENDS="omniroute command-code" \
  "$ROUTER" --plan-json "refactor a complex module safely")"
jq -e '.mode == "off" and .selected_order == .static_order' <<< "$kill_switch" >/dev/null
echo "ok - environment off switch immediately overrides promotion"

rollback="$(run_controller rollback "$promotion")"
[[ -f "$rollback" ]]
cmp -s "$TEST_ROOT/mode.baseline" "$MODE_FILE"
jq -e '.restored_mode == "shadow" and .restored_exists == true' "$rollback" >/dev/null
echo "ok - receipt rollback restores exact previous mode bytes"

promotion_drift="$(run_controller promote)"
printf '%s\n' 'off' > "$MODE_FILE"
if run_controller rollback "$promotion_drift" > "$TEST_ROOT/drift.out" 2> "$TEST_ROOT/drift.err"; then
  echo "FAIL - rollback accepted a drifted promoted mode" >&2
  exit 1
fi
[[ "$(cat "$MODE_FILE")" == "off" ]]
echo "ok - rollback rejects post-promotion mode drift"

cp -p "$TEST_ROOT/mode.baseline" "$MODE_FILE"
rm -f "$MODE_FILE"
promotion_absent="$(run_controller promote)"
rollback_absent="$(run_controller rollback "$promotion_absent")"
[[ ! -e "$MODE_FILE" ]]
jq -e '.restored_exists == false and .restored_mode == "shadow"' "$rollback_absent" >/dev/null
echo "ok - rollback restores an originally absent mode file"

write_safe_state
jq '.backends.omniroute.health = 0.2' "$OBSERVATIONS" > "$OBSERVATIONS.tmp"
mv "$OBSERVATIONS.tmp" "$OBSERVATIONS"
chmod 600 "$OBSERVATIONS"
if run_controller promote > "$TEST_ROOT/unsafe.out" 2> "$TEST_ROOT/unsafe.err"; then
  echo "FAIL - promotion accepted unhealthy OmniRoute evidence" >&2
  exit 1
fi
[[ ! -e "$MODE_FILE" ]]
echo "ok - unhealthy evidence cannot create an enforce mode file"

echo "=== temperance-routing-policy: PASS ==="
