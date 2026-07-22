#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUTER="$ROOT/package/router/multi-backend-router.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0

check() {
  if [[ "$2" == "$3" ]]; then
    echo "ok - $1"
  else
    echo "FAIL - $1: expected [$2] got [$3]"
    fail=1
  fi
}

printf '%s\n' '{
  "version": 1,
  "updated_at_ms": 900000,
  "backends": {
    "command-code": {"health": 0.1, "quota_remaining": 0.1},
    "grok": {"health": 0.99, "quota_remaining": 0.99},
    "kimi": {"health": 0.4, "quota_remaining": 0.4}
  }
}' > "$TMP/observations.json"

common_env=(
  "TEMPERANCE_BACKENDS=command-code grok kimi"
  "TEMPERANCE_ROUTING_STATE=$TMP/observations.json"
  "TEMPERANCE_ROUTING_NOW_MS=1000000"
)

plan=$(env "${common_env[@]}" TEMPERANCE_ROUTING_POLICY=shadow \
  "$ROUTER" --plan-json "refactor the entire auth layer")

if jq -e '
  .policy_version == "temperance-routing-v1" and
  .mode == "shadow" and
  (.plan_id | startswith("rp_")) and
  (.correlation_id | test("^tc_[a-f0-9]{24}$")) and
  (.correlation_id == ("tc_" + (.input_hash[0:24]))) and
  (.input_hash | length == 64) and
  (.static_order | length == 3) and
  ([.static_order[].failure_domain] == ["direct","direct","direct"]) and
  (.proposed_order | length == 3) and
  (.selected_order | length == 3)
' >/dev/null 2>&1 <<< "$plan"; then
  echo "ok - plan-json emits complete policy envelope"
else
  echo "FAIL - plan-json envelope invalid: $plan"
  fail=1
fi

check "shadow preserves static selected order" "command-code" \
  "$(jq -r '.selected_order[0].backend' <<< "$plan")"
check "shadow records adaptive proposal" "grok" \
  "$(jq -r '.proposed_order[0].backend' <<< "$plan")"

shadow_chain=$(env "${common_env[@]}" TEMPERANCE_ROUTING_POLICY=shadow \
  "$ROUTER" --route-only-with-fallbacks "refactor the entire auth layer")
check "shadow CLI chain stays backward compatible" \
  $'command-code\txiaomi/mimo-v2.5-pro\ngrok\tgrok-build\nkimi\tkimi-code/kimi-for-coding' \
  "$shadow_chain"

enforced_chain=$(env "${common_env[@]}" TEMPERANCE_ROUTING_POLICY=enforce \
  "$ROUTER" --route-only-with-fallbacks "refactor the entire auth layer")
check "enforce uses deterministic proposal" "grok" \
  "$(head -n 1 <<< "$enforced_chain" | cut -f1)"

off_chain=$(env "${common_env[@]}" TEMPERANCE_ROUTING_POLICY=off \
  "$ROUTER" --route-only-with-fallbacks "refactor the entire auth layer")
check "off kill switch restores static order" "command-code" \
  "$(head -n 1 <<< "$off_chain" | cut -f1)"

forced=$(env "${common_env[@]}" TEMPERANCE_ROUTING_POLICY=enforce \
  "$ROUTER" --plan-json --backend kimi --model forced-model "refactor the entire auth layer")
check "forced backend wins adaptive policy" "kimi" \
  "$(jq -r '.selected_order[0].backend' <<< "$forced")"
check "forced model wins adaptive policy" "forced-model" \
  "$(jq -r '.selected_order[0].model' <<< "$forced")"
check "forced plan contains one candidate" "1" \
  "$(jq -r '.selected_order | length' <<< "$forced")"

if jq -e 'has("task") | not' >/dev/null <<< "$plan"; then
  echo "ok - policy envelope excludes raw prompt text"
else
  echo "FAIL - policy envelope contains raw prompt text"
  fail=1
fi

printf '%s\n' '{not-valid-json' > "$TMP/broken.json"
degraded=$(TEMPERANCE_BACKENDS="command-code grok kimi" \
  TEMPERANCE_ROUTING_POLICY=enforce \
  TEMPERANCE_ROUTING_STATE="$TMP/broken.json" \
  "$ROUTER" --route-only-with-fallbacks "refactor the entire auth layer")
check "invalid state fails open to static order" "command-code" \
  "$(head -n 1 <<< "$degraded" | cut -f1)"

printf '%s\n' '{
  "version": 1,
  "updated_at_ms": 900000,
  "backends": {
    "command-code": {"health": 0.1, "circuit_state":"open", "cooldown_until_ms":2000000},
    "grok": {"health": 0.1, "circuit_state":"open", "cooldown_until_ms":2000000},
    "kimi": {"health": 0.1, "circuit_state":"open", "cooldown_until_ms":2000000}
  }
}' > "$TMP/all-open.json"
all_open=$(TEMPERANCE_BACKENDS="command-code grok kimi" \
  TEMPERANCE_ROUTING_POLICY=enforce \
  TEMPERANCE_ROUTING_STATE="$TMP/all-open.json" \
  TEMPERANCE_ROUTING_NOW_MS=1000000 \
  "$ROUTER" --plan-json "refactor the entire auth layer")
check "all-open plan is unavailable" "unavailable" "$(jq -r '.status' <<< "$all_open")"
check "all-open plan has no selected route" "0" "$(jq -r '.selected_order|length' <<< "$all_open")"
all_open_route=$(TEMPERANCE_BACKENDS="command-code grok kimi" \
  TEMPERANCE_ROUTING_POLICY=enforce \
  TEMPERANCE_ROUTING_STATE="$TMP/all-open.json" \
  TEMPERANCE_ROUTING_NOW_MS=1000000 \
  "$ROUTER" --route-only "refactor the entire auth layer")
check "all-open route resolves to subagent sentinel" $'none\t-' "$all_open_route"

no_backend_json=$(TEMPERANCE_BACKENDS="" "$ROUTER" --json "refactor the entire auth layer")
check "normal JSON mode has no phantom backend" "null" \
  "$(jq -r '.backend' <<< "$no_backend_json")"
check "normal JSON mode resolves to subagent" "claude-subagent" \
  "$(jq -r '.verdict' <<< "$no_backend_json")"
no_backend_command=$(TEMPERANCE_BACKENDS="" "$ROUTER" --command "refactor the entire auth layer" 2>&1 || true)
if grep -q 'claude-subagent' <<< "$no_backend_command" && ! grep -q '^command-code ' <<< "$no_backend_command"; then
  echo "ok - command mode emits subagent fallback without phantom invocation"
else
  echo "FAIL - command mode emitted phantom route: $no_backend_command"
  fail=1
fi

invalid_policy=$(env "${common_env[@]}" TEMPERANCE_ROUTING_POLICY=enforce \
  TEMPERANCE_ROUTING_POLICY_BIN="$ROOT/tests/fixtures/invalid-routing-policy.ts" \
  "$ROUTER" --route-only "refactor the entire auth layer")
check "semantically invalid policy fails open to static route" \
  $'command-code\txiaomi/mimo-v2.5-pro' "$invalid_policy"

printf '%s\n' '{
  "version": 1,
  "updated_at_ms": 900000,
  "backends": {
    "command-code": {"health": 0.5, "circuit_state":"open", "cooldown_until_ms":900000}
  }
}' > "$TMP/probe-state.json"
first_probe=$(TEMPERANCE_BACKENDS="command-code" \
  TEMPERANCE_ROUTING_POLICY=enforce \
  TEMPERANCE_ROUTING_CLAIM_PROBES=1 \
  TEMPERANCE_ROUTING_STATE="$TMP/probe-state.json" \
  TEMPERANCE_ROUTING_NOW_MS=1000000 \
  "$ROUTER" --plan-json "refactor the entire auth layer")
check "first half-open plan claims the probe" "command-code" \
  "$(jq -r '.selected_order[0].backend' <<< "$first_probe")"
if jq -e '.backends["command-code"].probe_claimed_until_ms > 1000000' \
  "$TMP/probe-state.json" >/dev/null 2>&1; then
  echo "ok - half-open probe lease persisted"
else
  echo "FAIL - half-open probe lease missing"
  fail=1
fi
second_probe=$(TEMPERANCE_BACKENDS="command-code" \
  TEMPERANCE_ROUTING_POLICY=enforce \
  TEMPERANCE_ROUTING_CLAIM_PROBES=1 \
  TEMPERANCE_ROUTING_STATE="$TMP/probe-state.json" \
  TEMPERANCE_ROUTING_NOW_MS=1000000 \
  "$ROUTER" --plan-json "refactor the entire auth layer")
check "duplicate half-open probe is unavailable" "unavailable" \
  "$(jq -r '.status' <<< "$second_probe")"

exit "$fail"
