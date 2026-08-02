#!/usr/bin/env bash
# Receipt-bound per-host promotion for Temperance's local routing policy.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUTER="${TEMPERANCE_ROUTING_CONTROLLER_ROUTER:-$ROOT_DIR/package/router/multi-backend-router.sh}"
STATE_DIR="${TEMPERANCE_STATE_DIR:-$HOME/.temperance_engine/state}"
MODE_FILE="${TEMPERANCE_ROUTING_POLICY_FILE:-$STATE_DIR/routing-policy-mode}"
OBSERVATION_STATE="${TEMPERANCE_ROUTING_STATE:-$STATE_DIR/routing-observations.json}"
RECEIPT_DIR="${TEMPERANCE_ROUTING_RECEIPT_DIR:-$HOME/.temperance_engine/receipts/routing-policy}"
PROBE_PROMPT="${TEMPERANCE_ROUTING_PROMOTION_PROBE:-refactor a complex module safely}"
MAX_AGE_MS="${TEMPERANCE_ROUTING_OBSERVATION_MAX_AGE_MS:-86400000}"

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

now_ms() {
  printf '%s000\n' "$(date +%s)"
}

configured_mode() {
  local value=""
  if [[ -f "$MODE_FILE" ]]; then
    IFS= read -r value < "$MODE_FILE" || value=""
  fi
  case "$value" in
    off|shadow|enforce) printf '%s\n' "$value" ;;
    *) printf '%s\n' "shadow" ;;
  esac
}

plan_with_mode() {
  local mode="$1" clock="$2"
  TEMPERANCE_ROUTING_POLICY="$mode" \
  TEMPERANCE_ROUTING_CLAIM_PROBES=0 \
  TEMPERANCE_ROUTING_STATE="$OBSERVATION_STATE" \
  TEMPERANCE_ROUTING_NOW_MS="$clock" \
  TEMPERANCE_ROUTING_OBSERVATION_MAX_AGE_MS="$MAX_AGE_MS" \
    "$ROUTER" --plan-json "$PROBE_PROMPT"
}

plan_from_file() {
  local clock="$1"
  (
    unset TEMPERANCE_ROUTING_POLICY
    TEMPERANCE_ROUTING_POLICY_FILE="$MODE_FILE" \
    TEMPERANCE_ROUTING_CLAIM_PROBES=0 \
    TEMPERANCE_ROUTING_STATE="$OBSERVATION_STATE" \
    TEMPERANCE_ROUTING_NOW_MS="$clock" \
    TEMPERANCE_ROUTING_OBSERVATION_MAX_AGE_MS="$MAX_AGE_MS" \
      "$ROUTER" --plan-json "$PROBE_PROMPT"
  )
}

validate_observation_state() {
  local clock="$1"
  [[ -f "$OBSERVATION_STATE" ]] || {
    echo "Routing observation state is absent: $OBSERVATION_STATE" >&2
    return 1
  }
  jq -e --argjson now "$clock" --argjson max_age "$MAX_AGE_MS" '
    .version == 1 and
    (.backends | type == "object") and
    (.backends.omniroute | type == "object") and
    (.backends.omniroute.health | type == "number" and . >= 0.8) and
    (.backends.omniroute.health_updated_at_ms | type == "number") and
    (($now - .backends.omniroute.health_updated_at_ms) >= 0) and
    (($now - .backends.omniroute.health_updated_at_ms) <= $max_age) and
    ((.backends.omniroute.circuit_state // "closed") == "closed")
  ' "$OBSERVATION_STATE" >/dev/null
}

validate_enforce_plan() {
  jq -e '
    .mode == "enforce" and
    .status == "ok" and
    (.selected_order | length > 0) and
    .selected_order[0].backend == "omniroute" and
    ([.candidates[] | select(.effective_circuit_state == "open" and .eligible == true)] | length == 0)
  ' >/dev/null
}

preflight_plan() {
  local clock="$1" first second
  validate_observation_state "$clock" || return 1
  first="$(plan_with_mode enforce "$clock")" || return 1
  second="$(plan_with_mode enforce "$clock")" || return 1
  [[ "$first" == "$second" ]] || {
    echo "Fixed-state enforce replay was not byte-identical" >&2
    return 1
  }
  validate_enforce_plan <<< "$first" || {
    echo "Enforce preview did not preserve a healthy OmniRoute-first route" >&2
    return 1
  }
  printf '%s\n' "$first"
}

status_policy() {
  local clock mode plan='null'
  clock="$(now_ms)"
  mode="$(configured_mode)"
  if [[ -f "$OBSERVATION_STATE" ]]; then
    plan="$(plan_from_file "$clock" 2>/dev/null || printf 'null')"
  fi
  jq -cn \
    --arg schema "temperance.routing-policy.status.v1" \
    --arg mode "$mode" \
    --arg mode_file "$MODE_FILE" \
    --arg state_file "$OBSERVATION_STATE" \
    --argjson mode_file_exists "$([[ -f "$MODE_FILE" ]] && printf true || printf false)" \
    --argjson plan "$plan" \
    '{schema:$schema,configured_mode:$mode,mode_file:$mode_file,
      mode_file_exists:$mode_file_exists,observation_state:$state_file,
      plan:(if $plan == null then null else {
        mode:$plan.mode,status:$plan.status,plan_id:$plan.plan_id,
        selected_backend:($plan.selected_order[0].backend // null),
        selected_model:($plan.selected_order[0].model // null)
      } end)}'
}

promote_policy() {
  local clock plan readback stamp previous_exists=false previous_sha='' backup='' applied_sha
  local temp_mode temp_receipt receipt
  clock="$(now_ms)"
  plan="$(preflight_plan "$clock")" || return 1

  mkdir -p "$STATE_DIR" "$RECEIPT_DIR"
  chmod 700 "$STATE_DIR" "$RECEIPT_DIR"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  if [[ -f "$MODE_FILE" ]]; then
    previous_exists=true
    previous_sha="$(sha256_file "$MODE_FILE")"
    backup="$RECEIPT_DIR/routing-policy-mode.$stamp.before"
    cp -p "$MODE_FILE" "$backup"
    chmod 600 "$backup"
  fi

  temp_mode="$MODE_FILE.tmp.$$"
  printf '%s\n' 'enforce' > "$temp_mode"
  chmod 600 "$temp_mode"
  mv "$temp_mode" "$MODE_FILE"
  applied_sha="$(sha256_file "$MODE_FILE")"

  if ! readback="$(plan_from_file "$clock")" || ! validate_enforce_plan <<< "$readback"; then
    if [[ "$previous_exists" == true ]]; then
      cp -p "$backup" "$MODE_FILE"
    else
      rm -f "$MODE_FILE"
    fi
    echo "Routing policy promotion failed readback and was restored" >&2
    return 1
  fi

  receipt="$RECEIPT_DIR/routing-policy-promote.$stamp.json"
  temp_receipt="$receipt.tmp.$$"
  jq -cn \
    --arg schema "temperance.routing-policy.promotion.v1" \
    --arg action "promote" \
    --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg mode_file "$MODE_FILE" \
    --arg observation_state "$OBSERVATION_STATE" \
    --arg observation_sha256 "$(sha256_file "$OBSERVATION_STATE")" \
    --arg previous_sha256 "$previous_sha" \
    --arg backup "$backup" \
    --arg applied_sha256 "$applied_sha" \
    --arg plan_id "$(jq -r '.plan_id' <<< "$readback")" \
    --arg selected_backend "$(jq -r '.selected_order[0].backend' <<< "$readback")" \
    --arg selected_model "$(jq -r '.selected_order[0].model' <<< "$readback")" \
    --arg receipt "$receipt" \
    --argjson previous_exists "$previous_exists" \
    '{schema:$schema,action:$action,created_at:$created_at,mode:"enforce",
      mode_file:$mode_file,observation_state:$observation_state,
      observation_sha256:$observation_sha256,previous_exists:$previous_exists,
      previous_sha256:(if $previous_sha256 == "" then null else $previous_sha256 end),
      backup:(if $backup == "" then null else $backup end),
      applied_sha256:$applied_sha256,plan_id:$plan_id,
      selected_backend:$selected_backend,selected_model:$selected_model,
      rollback_command:("scripts/temperance-routing-policy.sh rollback " + $receipt)}' > "$temp_receipt"
  chmod 600 "$temp_receipt"
  mv "$temp_receipt" "$receipt"
  printf '%s\n' "$receipt"
}

rollback_policy() {
  local receipt="${1:-}" current_sha previous_exists backup previous_sha stamp rollback_receipt temp
  [[ -n "$receipt" && -f "$receipt" ]] || {
    echo "rollback requires an existing promotion receipt" >&2
    return 2
  }
  jq -e --arg mode_file "$MODE_FILE" '
    .schema == "temperance.routing-policy.promotion.v1" and
    .action == "promote" and .mode == "enforce" and
    .mode_file == $mode_file and
    (.applied_sha256 | type == "string" and length == 64)
  ' "$receipt" >/dev/null || {
    echo "Promotion receipt does not authorize this mode file" >&2
    return 1
  }
  [[ -f "$MODE_FILE" ]] || {
    echo "Promoted mode file is absent; refusing ambiguous rollback" >&2
    return 1
  }
  current_sha="$(sha256_file "$MODE_FILE")"
  [[ "$current_sha" == "$(jq -r '.applied_sha256' "$receipt")" ]] || {
    echo "Promoted mode file drifted; refusing rollback" >&2
    return 1
  }
  previous_exists="$(jq -r '.previous_exists' "$receipt")"
  if [[ "$previous_exists" == true ]]; then
    backup="$(jq -r '.backup' "$receipt")"
    previous_sha="$(jq -r '.previous_sha256' "$receipt")"
    [[ -f "$backup" && "$(sha256_file "$backup")" == "$previous_sha" ]] || {
      echo "Exact pre-promotion backup is unavailable or drifted" >&2
      return 1
    }
    cp -p "$backup" "$MODE_FILE"
  else
    rm -f "$MODE_FILE"
  fi

  stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  rollback_receipt="$RECEIPT_DIR/routing-policy-rollback.$stamp.json"
  temp="$rollback_receipt.tmp.$$"
  jq -cn \
    --arg schema "temperance.routing-policy.rollback.v1" \
    --arg action "rollback" \
    --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg promotion_receipt "$receipt" \
    --arg mode_file "$MODE_FILE" \
    --arg restored_mode "$(configured_mode)" \
    --argjson restored_exists "$([[ -f "$MODE_FILE" ]] && printf true || printf false)" \
    '{schema:$schema,action:$action,created_at:$created_at,
      promotion_receipt:$promotion_receipt,mode_file:$mode_file,
      restored_exists:$restored_exists,restored_mode:$restored_mode}' > "$temp"
  chmod 600 "$temp"
  mv "$temp" "$rollback_receipt"
  printf '%s\n' "$rollback_receipt"
}

case "${1:-status}" in
  status) status_policy ;;
  promote) promote_policy ;;
  rollback) rollback_policy "${2:-}" ;;
  *) echo "usage: $0 {status|promote|rollback PROMOTION_RECEIPT}" >&2; exit 2 ;;
esac
