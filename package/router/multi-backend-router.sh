#!/usr/bin/env bash
# package/router/multi-backend-router.sh
# Unified router across multiple agent backends:
# - OmniRoute gateway (dynamic provider/model catalog through Codex)
# - Command Code (direct fallback)
# - Kimi CLI (K2.7 Code)
# - Grok CLI (grok-composer-2.5-fast, grok-build)
# - OpenRouter (aggregator, if configured)
#
# Usage:
#   ./multi-backend-router.sh "task description"
#   ./multi-backend-router.sh --json "task description"
#   ./multi-backend-router.sh --command "task description"
#   ./multi-backend-router.sh --execute "task description"
#   ./multi-backend-router.sh --backend kimi "task description"
#   ./multi-backend-router.sh --model gpt-5.5 --backend command-code "task description"
#   ./multi-backend-router.sh --route-only "task description"
#   ./multi-backend-router.sh --plan-json "task description"
#   ./multi-backend-router.sh --list-backends
#   ./multi-backend-router.sh --timeout 120 --execute "task description"
#   TEMPERANCE_BACKENDS="command-code kimi" ./multi-backend-router.sh --route-only "task description"
#
# Latency Characteristics:
#   Backend         Startup    Simple Task    Complex Task    Recommended Timeout
#   command-code    ~10s       15-20s         30-120s         180s for complex
#   kimi            ~3s        10-15s         30-60s          120s
#   grok            ~5s        10-15s         20-40s          90s
#
# Note: command-code has higher latency due to agentic execution model.
# For time-critical tasks, prefer kimi or grok.

# This script needs bash >=4 (associative arrays, e.g. MODEL_CATALOG below).
# `env bash` can resolve to macOS's stock /bin/bash 3.2 when PATH puts
# /usr/bin ahead of a newer bash (e.g. Homebrew's) -- which silently mis-parses
# `declare -A` and fails later with an unrelated-looking "unbound variable"
# error. Re-exec under a bash 4+ if one can be found.
if [ -z "${BASH_VERSINFO:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
  for _b in /opt/homebrew/bin/bash /usr/local/bin/bash; do
    if [ -x "$_b" ]; then exec "$_b" "$0" "$@"; fi
  done
  echo "error: $0 requires bash >= 4 (associative arrays); found ${BASH_VERSION:-unknown}." >&2
  echo "Install a newer bash (e.g. 'brew install bash') or put it ahead of /usr/bin/bash in PATH." >&2
  exit 1
fi

set -euo pipefail

# Resolve symlinks so classify-task.sh (sourced below) is found next to the REAL
# script even when invoked through an installed symlink such as
# ~/.local/bin/temperance-route (scripts/wire-multi-backend.sh). BSD readlink has
# no -f, so follow the chain manually.
_src="${BASH_SOURCE[0]}"
while [ -L "$_src" ]; do
  _sdir="$(cd -P "$(dirname "$_src")" && pwd)"
  _src="$(readlink "$_src")"
  case "$_src" in /*) ;; *) _src="$_sdir/$_src" ;; esac
done
SCRIPT_DIR="$(cd -P "$(dirname "$_src")" && pwd)"
unset _src _sdir

# Single source of task-type classification + command-code type->model primary
# (issue #6). classify-task.sh is POSIX sh and only defines functions when
# sourced (its CLI dispatch is guarded by $0), so this does not run anything.
# shellcheck source=classify-task.sh
. "$SCRIPT_DIR/classify-task.sh"

# ─────────────────────────────────────────────────────────────────────────────
# Backend Detection
# ─────────────────────────────────────────────────────────────────────────────

detect_backends() {
  if [[ -n "${TEMPERANCE_BACKENDS+x}" ]]; then
    # Caller supplied the list (may be empty = none). Skip the ~10s status probe.
    echo "${TEMPERANCE_BACKENDS}"
    return
  fi
  local backends=()

  # OmniRoute. /v1/models is the live catalog and stays available on loopback
  # even when dashboard login is enabled. Requiring the selected combo to be in
  # that catalog prevents a live-but-misconfigured daemon from becoming primary.
  local omni_base="${TEMPERANCE_OMNIROUTE_BASE_URL:-http://127.0.0.1:20128/v1}"
  omni_base="${omni_base%/}"
  [[ "$omni_base" == */v1 ]] || omni_base="$omni_base/v1"
  local omni_model="${TEMPERANCE_OMNIROUTE_MODEL:-temperance-coding}"
  local -a omni_headers=()
  [[ -n "${OMNIROUTE_API_KEY:-}" ]] && omni_headers=(-H "Authorization: Bearer $OMNIROUTE_API_KEY")
  if command -v codex >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    if curl -fsS --connect-timeout 1 --max-time 3 "${omni_headers[@]}" "$omni_base/models" 2>/dev/null \
      | jq -e --arg model "$omni_model" '.data[]? | select(.id == $model)' >/dev/null 2>&1; then
      backends+=("omniroute")
    fi
  fi

  # Command Code
  if command -v command-code &>/dev/null; then
    if command-code status 2>&1 | grep -q "Authenticated"; then
      backends+=("command-code")
    fi
  fi
  
  # Kimi
  if command -v kimi &>/dev/null; then
    backends+=("kimi")
  fi
  
  # Grok
  if [[ -x "$HOME/.grok/bin/grok" ]]; then
    backends+=("grok")
  fi
  
  # OpenRouter
  if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
    backends+=("openrouter")
  fi
  
  echo "${backends[*]}"
}

# ─────────────────────────────────────────────────────────────────────────────
# Model Catalog
# ─────────────────────────────────────────────────────────────────────────────

# Format: backend:model → tier:strength:context
declare -A MODEL_CATALOG=(
  # OmniRoute combo (its target catalog and failover policy live in OmniRoute)
  ["omniroute:${TEMPERANCE_OMNIROUTE_MODEL:-temperance-coding}"]="adaptive:agentic:200k"

  # Command Code
  ["command-code:deepseek/deepseek-v4-flash"]="fast:speed:128k"
  ["command-code:deepseek/deepseek-v4-pro"]="deep:reasoning:128k"
  ["command-code:moonshotai/Kimi-K2.7-Code"]="deep:long-horizon:1M"
  ["command-code:claude-sonnet-5"]="balanced:balanced:200k"
  ["command-code:claude-fable-5"]="premium:reasoning:200k"
  ["command-code:google/gemini-3.5-flash"]="fast:parallel:1M"
  ["command-code:Qwen/Qwen3.7-Max"]="deep:frontier:128k"
  ["command-code:gpt-5.5"]="premium:general:128k"
  # Credit-deal primaries (see classify-task.sh model_for_type, decision 2026-07-18)
  ["command-code:tencent/Hy3"]="fast:free:256k"
  ["command-code:xiaomi/mimo-v2.5-pro"]="deep:long-horizon:256k"
  ["command-code:MiniMaxAI/MiniMax-M3"]="balanced:frontier:1M"

  # Kimi (direct)
  ["kimi:kimi-code/kimi-for-coding"]="deep:coding:262k"
  
  # Grok
  ["grok:grok-composer-2.5-fast"]="fast:creative:128k"
  ["grok:grok-build"]="balanced:coding:128k"
)

# ─────────────────────────────────────────────────────────────────────────────
# Routing Rules
# ─────────────────────────────────────────────────────────────────────────────

# Priority order for each task type: command-code -> grok -> kimi (one route
# per backend, no same-backend duplicates). grok/kimi fallback tails per task type (command-code primary is derived from
# classify-task.sh's model_for_type, so the type->model catalog has ONE source).
declare -A ROUTING_FALLBACK_TAILS=(
  ["fast"]="grok:grok-composer-2.5-fast kimi:kimi-code/kimi-for-coding"
  ["long-horizon"]="grok:grok-build kimi:kimi-code/kimi-for-coding"
  ["reasoning"]="grok:grok-build kimi:kimi-code/kimi-for-coding"
  ["validation"]="grok:grok-build kimi:kimi-code/kimi-for-coding"
  ["creative"]="grok:grok-composer-2.5-fast kimi:kimi-code/kimi-for-coding"
  ["balanced"]="grok:grok-build kimi:kimi-code/kimi-for-coding"
)
routing_priority_for_type() {
  local task_type="$1" omni_model="${2:-}"
  local direct_primary="$(model_for_type "$task_type")"
  local fallback_tail="${ROUTING_FALLBACK_TAILS[$task_type]:-${ROUTING_FALLBACK_TAILS[balanced]}}"
  if [[ -n "$omni_model" ]]; then
    printf 'omniroute:%s %s %s\n' "$omni_model" "$direct_primary" "$fallback_tail"
  else
    printf '%s %s\n' "$direct_primary" "$fallback_tail"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Deterministic routing policy (OmniRoute-inspired, Temperance-owned)
# ─────────────────────────────────────────────────────────────────────────────

POLICY_RUNNER="${TEMPERANCE_ROUTING_POLICY_BIN:-$SCRIPT_DIR/routing-policy.ts}"
PORTFOLIO_RESOLVER="${TEMPERANCE_OMNIROUTE_PORTFOLIO_RESOLVER:-$SCRIPT_DIR/omniroute-portfolios.ts}"
PROMOTION_VALIDATOR="${TEMPERANCE_OMNIROUTE_PROMOTION_VALIDATOR:-$SCRIPT_DIR/omniroute-promotion.ts}"

omniroute_catalog_json() {
  local catalog_file="${TEMPERANCE_OMNIROUTE_CATALOG_FILE:-}"
  if [[ -n "$catalog_file" ]]; then
    if [[ -f "$catalog_file" ]] && jq -e 'type == "object" and (.data|type == "array")' "$catalog_file" >/dev/null 2>&1; then
      jq -c . "$catalog_file"
    else
      printf '{"data":[]}\n'
    fi
    return
  fi

  local omni_base="${TEMPERANCE_OMNIROUTE_BASE_URL:-http://127.0.0.1:20128/v1}"
  omni_base="${omni_base%/}"
  [[ "$omni_base" == */v1 ]] || omni_base="$omni_base/v1"
  local -a omni_headers=()
  [[ -n "${OMNIROUTE_API_KEY:-}" ]] && omni_headers=(-H "Authorization: Bearer $OMNIROUTE_API_KEY")
  local catalog=""
  if command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    catalog="$(curl -fsS --connect-timeout 1 --max-time 3 "${omni_headers[@]}" "$omni_base/models" 2>/dev/null || true)"
    if jq -e 'type == "object" and (.data|type == "array")' <<< "$catalog" >/dev/null 2>&1; then
      jq -c . <<< "$catalog"
      return
    fi
  fi

  # An explicit backend override is a caller-owned test/stub contract. If its
  # live catalog is unavailable, preserve the compatibility gateway only; no
  # task-specific portfolio is treated as available without catalog evidence.
  if [[ -n "${TEMPERANCE_BACKENDS+x}" ]] && printf ' %s ' "$TEMPERANCE_BACKENDS" | grep -q ' omniroute '; then
    jq -cn --arg model "${TEMPERANCE_OMNIROUTE_MODEL:-temperance-coding}" \
      '{data:[{id:$model,owned_by:"temperance-override"}]}'
  else
    printf '{"data":[]}\n'
  fi
}

resolve_portfolio_for_type() {
  local task_type="$1" catalog result
  local -a available_models=()
  catalog="$(omniroute_catalog_json)"
  mapfile -t available_models < <(jq -r '.data[]? | select(.id|type == "string") | .id' <<< "$catalog")

  if command -v bun >/dev/null 2>&1 && [[ -f "$PORTFOLIO_RESOLVER" ]]; then
    if (( ${#available_models[@]} > 0 )); then
      result="$(bun "$PORTFOLIO_RESOLVER" resolve "$task_type" "${available_models[@]}" 2>/dev/null || true)"
    else
      result="$(bun "$PORTFOLIO_RESOLVER" resolve "$task_type" 2>/dev/null || true)"
    fi
    if jq -e 'type == "object" and (.source|IN("portfolio","compatibility","direct")) and (.enforcement == "shadow")' <<< "$result" >/dev/null 2>&1; then
      printf '%s\n' "$result"
      return
    fi
  fi

  jq -cn --arg task_type "$task_type" \
    '{task_type:$task_type,requested_portfolio:"",selected_model:null,source:"direct",enforcement:"shadow"}'
}

promotion_receipt_portfolio() {
  local receipt_path="${TEMPERANCE_OMNIROUTE_PROMOTION_RECEIPT:-}"
  if [[ -n "$receipt_path" && -f "$receipt_path" ]]; then
    jq -r '.portfolio // empty' "$receipt_path" 2>/dev/null || true
  fi
}

promotion_signing_key() {
  if [[ -n "${TEMPERANCE_OMNIROUTE_PROMOTION_SIGNING_KEY:-}" ]]; then
    printf '%s\n' "$TEMPERANCE_OMNIROUTE_PROMOTION_SIGNING_KEY"
    return
  fi
  if command -v security >/dev/null 2>&1; then
    security find-generic-password -a "${USER:-}" \
      -s "${TEMPERANCE_OMNIROUTE_PROMOTION_KEYCHAIN_SERVICE:-OmniRoute Temperance Promotion Key}" \
      -w 2>/dev/null || true
  fi
}

promotion_runtime_version() {
  if [[ -n "${TEMPERANCE_OMNIROUTE_RUNTIME_VERSION:-}" ]]; then
    printf '%s\n' "$TEMPERANCE_OMNIROUTE_RUNTIME_VERSION"
  elif command -v omniroute >/dev/null 2>&1; then
    omniroute --version 2>/dev/null | tail -n 1 | tr -d '\r'
  fi
}

promotion_authorized() {
  local receipt_path="${TEMPERANCE_OMNIROUTE_PROMOTION_RECEIPT:-}" result=""
  local signing_key="" runtime_version=""
  if [[ -n "$receipt_path" && -f "$receipt_path" ]] && command -v bun >/dev/null 2>&1 && [[ -f "$PROMOTION_VALIDATOR" ]]; then
    signing_key="$(promotion_signing_key)"
    runtime_version="$(promotion_runtime_version)"
    result="$(TEMPERANCE_OMNIROUTE_PROMOTION_SIGNING_KEY="$signing_key" \
      TEMPERANCE_OMNIROUTE_RUNTIME_VERSION="$runtime_version" \
      bun "$PROMOTION_VALIDATOR" validate 2>/dev/null || true)"
  fi
  if jq -e '.authorized == true and (.reasons | type == "array" and length == 0)' <<< "$result" >/dev/null 2>&1; then
    printf 'true\n'
  else
    printf 'false\n'
  fi
}

remove_backend() {
  local backend_list="$1" backend_to_remove="$2" backend result=""
  for backend in $backend_list; do
    [[ "$backend" == "$backend_to_remove" ]] && continue
    result+="${result:+ }$backend"
  done
  printf '%s\n' "$result"
}

apply_portfolio_shadow_overlay() {
  local plan="$1" source="$2" portfolio_model="$3" requested_portfolio="$4"
  if [[ "$(routing_policy_mode)" != "shadow" || "$source" != "portfolio" || -z "$portfolio_model" ]]; then
    printf '%s\n' "$plan"
    return
  fi
  jq -c --arg model "$portfolio_model" --arg requested "$requested_portfolio" '
    .proposed_order = (
      ([.proposed_order[] | select(.backend == "omniroute") | .model = $model] +
       [.proposed_order[] | select(.backend != "omniroute")])
    ) |
    .diverged = true |
    .portfolio = {
      requested_portfolio: $requested,
      selected_model: $model,
      source: "portfolio",
      enforcement: "shadow"
    }
  ' <<< "$plan"
}

apply_portfolio_promotion_overlay() {
  local plan="$1" portfolio_model="$2" requested_portfolio="$3"
  if [[ -z "$portfolio_model" || -z "$requested_portfolio" || "$(routing_policy_mode)" == "off" ]]; then
    printf '%s\n' "$plan"
    return
  fi
  jq -c --arg model "$portfolio_model" --arg requested "$requested_portfolio" '
    .static_order |= map(if .backend == "omniroute" then .model = $model else . end) |
    .proposed_order |= map(if .backend == "omniroute" then .model = $model else . end) |
    .selected_order |= map(if .backend == "omniroute" then .model = $model else . end) |
    .candidates |= map(if .backend == "omniroute" then .model = $model else . end) |
    .diverged = true |
    .portfolio = {
      requested_portfolio: $requested,
      selected_model: $model,
      source: "portfolio",
      enforcement: "promoted"
    }
  ' <<< "$plan"
}

routing_policy_mode() {
  case "${TEMPERANCE_ROUTING_POLICY:-shadow}" in
    off|shadow|enforce) printf '%s\n' "${TEMPERANCE_ROUTING_POLICY:-shadow}" ;;
    *) printf '%s\n' "shadow" ;;
  esac
}

routing_state_path() {
  if [[ -n "${TEMPERANCE_ROUTING_STATE:-}" ]]; then
    printf '%s\n' "$TEMPERANCE_ROUTING_STATE"
  else
    printf '%s/routing-observations.json\n' "${TEMPERANCE_STATE_DIR:-$HOME/.temperance_engine/state}"
  fi
}

candidate_json() { # route static_rank -> JSON
  local route="$1" rank="$2"
  local backend="${route%%:*}" model="${route#*:}"
  local info="${MODEL_CATALOG[$route]:-unknown:unknown:unknown}"
  local tier="${info%%:*}" rest="${info#*:}"
  local strength="${rest%%:*}" context="${rest#*:}"
  local failure_domain="direct"
  [[ "$backend" == "omniroute" ]] && failure_domain="gateway"
  jq -cn --arg b "$backend" --arg m "$model" --argjson r "$rank" \
    --arg tier "$tier" --arg strength "$strength" --arg context "$context" --arg failure_domain "$failure_domain" \
    '{backend:$b,model:$m,static_rank:$r,failure_domain:$failure_domain,tier:$tier,strength:$strength,context_window:$context}'
}

static_policy_plan() { # mode task_type disposition candidates_json -> JSON
  local mode="$1" task_type="$2" disposition="$3" candidates="$4"
  local status="no-observations"
  local now="${TEMPERANCE_ROUTING_NOW_MS:-$(( $(date +%s) * 1000 ))}"
  [[ "$mode" == "off" ]] && status="off"
  [[ "$disposition" == "inline" ]] && status="inline"
  [[ "$disposition" == "unavailable" ]] && status="unavailable"
  local fingerprint input_hash plan_id correlation_id
  fingerprint="$(jq -cnS --arg mode "$mode" --arg tt "$task_type" --arg status "$status" \
    --argjson now "$now" --argjson candidates "$candidates" \
    '{mode:$mode,task_type:$tt,status:$status,decision_time_ms:$now,candidates:$candidates}')"
  if command -v shasum >/dev/null 2>&1; then
    input_hash="$(printf '%s' "$fingerprint" | shasum -a 256 | awk '{print $1}')"
  else
    input_hash="degraded-$(printf '%s' "$fingerprint" | cksum | awk '{print $1 "-" $2}')"
  fi
  plan_id="rp_$(printf '%.16s' "$input_hash")"
  correlation_id="tc_$(printf '%.24s' "$input_hash")"
  jq -cn --arg mode "$mode" --arg tt "$task_type" --arg status "$status" \
    --argjson candidates "$candidates" --argjson now "$now" \
    --arg input_hash "$input_hash" --arg plan_id "$plan_id" --arg correlation_id "$correlation_id" \
    '{policy_version:"temperance-routing-v1-degraded",mode:$mode,
      plan_id:$plan_id,correlation_id:$correlation_id,input_hash:$input_hash,task_type:$tt,
      decision_time_ms:$now,diverged:false,status:$status,
      static_order:$candidates,proposed_order:$candidates,selected_order:$candidates,
      candidates:($candidates | map(. + {score:0,eligible:true,effective_circuit_state:"closed",
        factors:{capability:0.5,health:0.5,quota:0.5,cost_efficiency:0.5,stability:0.5,circuit:1},
        reasons:["policy-unavailable-static-fallback"]}))}'
}

valid_policy_plan() { # JSON on stdin
  jq -e '
    def route:
      type=="object" and
      (.backend|type=="string" and length>0) and
      (.model|type=="string" and length>0) and
      (.static_rank|type=="number") and
      (.failure_domain=="gateway" or .failure_domain=="direct");
    def route_key: [.backend,.model] | @tsv;
    (.policy_version|type=="string" and length>0) and
    (.plan_id|type=="string" and length>0) and
    (.correlation_id|type=="string" and test("^tc_[A-Za-z0-9._-]+$")) and
    (.input_hash|type=="string" and length>0) and
    (.task_type|type=="string" and length>0) and
    (.decision_time_ms|type=="number") and
    (.diverged|type=="boolean") and
    (.status as $status | ["ok","off","no-observations","inline","unavailable"] | index($status) != null) and
    (.static_order|type=="array" and all(.[]; route)) and
    (.proposed_order|type=="array" and all(.[]; route)) and
    (.selected_order|type=="array" and all(.[]; route)) and
    (([.static_order[]|route_key]|unique|length) == (.static_order|length)) and
    (([.selected_order[]|route_key]|unique|length) == (.selected_order|length)) and
    (([.selected_order[]|route_key] - [.static_order[]|route_key])|length == 0) and
    (if (.status=="inline" or .status=="unavailable")
      then (.selected_order|length)==0
      else (.selected_order|length)>0
      end)
  ' >/dev/null 2>&1
}

route_plan_for_type_json() { # task_type [force_backend] [force_model] [disposition]
  local task_type="$1" force_backend="${2:-}" force_model="${3:-}" disposition="${4:-external}"
  local mode; mode="$(routing_policy_mode)"
  local available_backends; available_backends="$(detect_backends)"
  local portfolio_json='{"source":"direct","requested_portfolio":"","selected_model":null}'
  local portfolio_source="direct" portfolio_requested="" portfolio_selected=""
  local promotion_receipt="" promotion_is_authorized=false
  local omni_compat_model="${TEMPERANCE_OMNIROUTE_MODEL:-temperance-coding}"
  local omni_model_for_priority=""
  if printf ' %s ' "$available_backends" | grep -q ' omniroute '; then
    portfolio_json="$(resolve_portfolio_for_type "$task_type")"
    portfolio_source="$(jq -r '.source // "direct"' <<< "$portfolio_json")"
    portfolio_requested="$(jq -r '.requested_portfolio // empty' <<< "$portfolio_json")"
    portfolio_selected="$(jq -r '.selected_model // empty' <<< "$portfolio_json")"
    promotion_receipt="$(promotion_receipt_portfolio)"
    if [[ "$portfolio_source" == "portfolio" && "$promotion_receipt" == "$portfolio_requested" ]]; then
      promotion_is_authorized="$(promotion_authorized)"
    fi
    if [[ "$portfolio_source" != "direct" && "$portfolio_selected" == "$omni_compat_model" ]]; then
      omni_model_for_priority="$omni_compat_model"
    elif [[ "$portfolio_source" == "portfolio" ]]; then
      # A named portfolio may be proposed only when the compatibility combo
      # is also present for the frozen selected chain.
      omni_model_for_priority="$omni_compat_model"
    else
      available_backends="$(remove_backend "$available_backends" "omniroute")"
    fi
  fi
  local priority; priority="$(routing_priority_for_type "$task_type" "$omni_model_for_priority")"
  local candidates='[]' route backend model item rank=0 forced=false

  if [[ "$disposition" == "external" && -z "${available_backends// }" ]]; then
    disposition="unavailable"
  elif [[ "$disposition" == "external" && -n "$force_backend" ]]; then
    forced=true
    if printf ' %s ' "$available_backends" | grep -q " $force_backend "; then
      route=""
      for item in $priority; do
        [[ "${item%%:*}" == "$force_backend" ]] && { route="$item"; break; }
      done
      case "$force_backend" in
        omniroute) [[ -z "$route" ]] && route="omniroute:${TEMPERANCE_OMNIROUTE_MODEL:-temperance-coding}" ;;
        command-code) [[ -z "$route" ]] && route="command-code:claude-sonnet-5" ;;
        kimi) [[ -z "$route" ]] && route="kimi:kimi-code/kimi-for-coding" ;;
        grok) [[ -z "$route" ]] && route="grok:grok-composer-2.5-fast" ;;
      esac
      if [[ -n "$route" ]]; then
        backend="${route%%:*}"; model="${route#*:}"
        [[ -n "$force_model" ]] && model="$force_model"
        item="$(candidate_json "$backend:$model" 0)"
        candidates="$(jq -cn --argjson item "$item" '[$item]')"
      fi
    else
      disposition="unavailable"
    fi
  elif [[ "$disposition" == "external" ]]; then
    for route in $priority; do
      backend="${route%%:*}"; model="${route#*:}"
      if printf ' %s ' "$available_backends" | grep -q " $backend "; then
        [[ -n "$force_model" ]] && model="$force_model"
        item="$(candidate_json "$backend:$model" "$rank")"
        candidates="$(jq -cn --argjson current "$candidates" --argjson item "$item" '$current + [$item]')"
        rank=$((rank + 1))
      fi
    done
    [[ "$(jq 'length' <<< "$candidates")" == "0" ]] && disposition="unavailable"
  fi

  local observations='{"version":1,"updated_at_ms":0,"backends":{}}'
  local state_path; state_path="$(routing_state_path)"
  if [[ -f "$state_path" ]] && jq -e 'type=="object" and (.backends|type=="object")' "$state_path" >/dev/null 2>&1; then
    observations="$(jq -c . "$state_path")"
  fi
  local now_ms="${TEMPERANCE_ROUTING_NOW_MS:-$(( $(date +%s) * 1000 ))}"
  local observation_max_age_ms="${TEMPERANCE_ROUTING_OBSERVATION_MAX_AGE_MS:-86400000}"
  local input output
  input="$(jq -cn --arg mode "$mode" --arg tt "$task_type" --argjson now "$now_ms" \
    --argjson max_age "$observation_max_age_ms" \
    --argjson candidates "$candidates" --argjson observations "$observations" \
    --argjson forced "$forced" --arg disposition "$disposition" \
    '{mode:$mode,task_type:$tt,now_ms:$now,candidates:$candidates,
      observation_max_age_ms:$max_age,observations:$observations,
      forced:$forced,disposition:$disposition}')"

  if command -v bun >/dev/null 2>&1 && [[ -f "$POLICY_RUNNER" ]]; then
    output="$(printf '%s' "$input" | bun "$POLICY_RUNNER" plan 2>/dev/null)" || output=""
    if [[ -n "$output" ]] && valid_policy_plan <<< "$output"; then
      if [[ "$mode" == "enforce" && "${TEMPERANCE_ROUTING_CLAIM_PROBES:-0}" == "1" ]]; then
        local probe_backend claim_result claimed lease_ms
        lease_ms="${TEMPERANCE_ROUTING_PROBE_LEASE_MS:-600000}"
        while IFS= read -r probe_backend; do
          [[ -z "$probe_backend" ]] && continue
          claim_result="$(bun "$POLICY_RUNNER" claim --state "$state_path" \
            --backend "$probe_backend" --now-ms "$now_ms" \
            --claim-id "$(jq -r '.plan_id' <<< "$output")" \
            --lease-ms "$lease_ms" 2>/dev/null)" || claim_result='{"claimed":false}'
          claimed="$(jq -r '.claimed // false' <<< "$claim_result" 2>/dev/null)"
          if [[ "$claimed" != "true" ]]; then
            output="$(jq -c --arg backend "$probe_backend" '
              .selected_order |= map(select(.backend != $backend)) |
              .proposed_order |= map(select(.backend != $backend)) |
              .candidates |= map(
                if .backend == $backend then
                  .eligible=false |
                  .reasons=((.reasons // []) + ["probe-claim-unavailable"] | unique)
                else . end
              ) |
              .diverged=true |
              if (.selected_order|length)==0 then .status="unavailable" else . end
            ' <<< "$output")"
          fi
        done < <(jq -r '
          [.candidates[] |
            select(.effective_circuit_state=="half_open" and .eligible==true) |
            .backend] | unique[]?
        ' <<< "$output")
      fi
      output="$(apply_portfolio_shadow_overlay "$output" "$portfolio_source" "$portfolio_selected" "$portfolio_requested")"
      if [[ "$promotion_is_authorized" == true && "$forced" != true && -z "$force_model" ]]; then
        output="$(apply_portfolio_promotion_overlay "$output" "$portfolio_selected" "$portfolio_requested")"
      fi
      printf '%s\n' "$output"
      return
    fi
  fi
  output="$(static_policy_plan "$mode" "$task_type" "$disposition" "$candidates")"
  output="$(apply_portfolio_shadow_overlay "$output" "$portfolio_source" "$portfolio_selected" "$portfolio_requested")"
  if [[ "$promotion_is_authorized" == true && "$forced" != true && -z "$force_model" ]]; then
    output="$(apply_portfolio_promotion_overlay "$output" "$portfolio_selected" "$portfolio_requested")"
  fi
  printf '%s\n' "$output"
}

route_plan_json() { # description -> JSON
  local desc="$1" task_type
  task_type="$(analyze_task_type "$desc")"
  if [[ "$task_type" == "inline" ]]; then
    route_plan_for_type_json "$task_type" "" "" "inline"
  else
    route_plan_for_type_json "$task_type" "$FORCE_BACKEND" "$FORCE_MODEL" "external"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Complexity Analysis
# ─────────────────────────────────────────────────────────────────────────────

analyze_task_type() {
  classify_task_type "$1"
}

# ─────────────────────────────────────────────────────────────────────────────
# Route Selection
# ─────────────────────────────────────────────────────────────────────────────

select_route() {
  local task_type="$1"
  local force_backend="${2:-}"
  local plan backend model
  plan="$(route_plan_for_type_json "$task_type" "$force_backend" "$FORCE_MODEL" "external")"
  backend="$(jq -r '.selected_order[0].backend // empty' <<< "$plan")"
  model="$(jq -r '.selected_order[0].model // empty' <<< "$plan")"
  if [[ -n "$backend" && -n "$model" ]]; then
    printf '%s:%s\n' "$backend" "$model"
  elif [[ -n "$force_backend" ]]; then
    echo "ERROR: Backend '$force_backend' not available" >&2
    return 1
  else
    return 1
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Route-Only Selection (programmatic; no command generation/execution)
# ─────────────────────────────────────────────────────────────────────────────

route_only() {
  local desc="$1"
  local plan status backend model
  plan="$(route_plan_json "$desc")"
  status="$(jq -r '.status' <<< "$plan")"
  [[ "$status" == "inline" ]] && { printf 'inline\t-\n'; return; }
  backend="$(jq -r '.selected_order[0].backend // empty' <<< "$plan")"
  model="$(jq -r '.selected_order[0].model // empty' <<< "$plan")"
  [[ -z "$backend" || -z "$model" ]] && { printf 'none\t-\n'; return; }
  printf '%s\t%s\n' "$backend" "$model"
}

# verdict: the unified 3-verdict classification (issue #6). Pure remap of
# route_only so --verdict and --route-only can never disagree.
#   inline\t-      -> inline
#   none\t-        -> claude-subagent   (no external backend => needs live session)
#   backend\tmodel -> external\tbackend\tmodel
# Note: a forced `--backend <name>` that is NOT available makes route_only emit
# `none\t-`, so --verdict reports `claude-subagent` and exits 0 -- whereas a bare
# `--route-only` with the same unavailable forced backend exits 1 with an ERROR on
# stderr. That is intentional (forced backend gone => fall back to the live session)
# and harmless today (no consumer wires --verdict with a forced backend); revisit
# this mapping if one ever does.
verdict() {
  local line b m
  line=$(route_only "$1")
  b=${line%%$'\t'*}; m=${line#*$'\t'}
  case "$b" in
    inline) printf 'inline\n' ;;
    none)   printf 'claude-subagent\n' ;;
    *)      printf 'external\t%s\t%s\n' "$b" "$m" ;;
  esac
}

# verdict_label: just the first field of verdict() (inline|external|claude-subagent),
# for embedding in --json.
verdict_label() {
  verdict "$1" | cut -f1
}

# route_only_with_fallbacks: like route_only, but emits the FULL
# priority-filtered fallback chain for the task's type -- one
# "backend<TAB>model" line per backend in the frozen selected order, filtered
# to backends actually available (detect_backends / TEMPERANCE_BACKENDS).
route_only_with_fallbacks() {
  local desc="$1"
  local plan status
  plan="$(route_plan_json "$desc")"
  status="$(jq -r '.status' <<< "$plan")"
  [[ "$status" == "inline" ]] && { printf 'inline\t-\n'; return; }
  if [[ "$(jq '.selected_order | length' <<< "$plan")" == "0" ]]; then
    printf 'none\t-\n'
    return
  fi
  jq -r '.selected_order[] | [.backend,.model] | @tsv' <<< "$plan"
}

# ─────────────────────────────────────────────────────────────────────────────
# Command Generation
# ─────────────────────────────────────────────────────────────────────────────

generate_command() {
  echo "# DISPLAY ONLY -- never eval; use --route-only + argv execution instead"
  local route="$1"
  local desc="$2"
  local max_turns="${3:-10}"

  local backend="${route%%:*}"
  local model="${route#*:}"
  
  # Escape description for shell
  local escaped_desc="${desc//\"/\\\"}"
  
  case "$backend" in
    omniroute)
      echo "$SCRIPT_DIR/omniroute-codex.sh $model \"$escaped_desc\""
      ;;

    command-code)
      echo "command-code -p \"$escaped_desc\" --model $model --max-turns $max_turns --trust --yolo --skip-onboarding"
      ;;
    
    kimi)
      echo "kimi --print --yolo --model $model -p \"$escaped_desc\""
      ;;
    
    grok)
      echo "$HOME/.grok/bin/grok --model $model --always-approve \"$escaped_desc\""
      ;;

    *)
      echo "# Unknown backend: $backend"
      ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# Execution
# ─────────────────────────────────────────────────────────────────────────────

execute_route() {
  local route="$1"
  local desc="$2"
  local max_turns="${3:-10}"
  
  local backend="${route%%:*}"
  local model="${route#*:}"
  
  case "$backend" in
    omniroute)
      "$SCRIPT_DIR/omniroute-codex.sh" "$model" "$desc"
      ;;

    command-code)
      command-code -p "$desc" --model "$model" --max-turns "$max_turns" --trust --yolo --skip-onboarding
      ;;
    
    kimi)
      kimi --print --yolo --model "$model" -p "$desc"
      ;;
    
    grok)
      "$HOME/.grok/bin/grok" --model "$model" --always-approve "$desc"
      ;;

    *)
      echo "Unknown backend: $backend" >&2
      return 1
      ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# Output Formatting
# ─────────────────────────────────────────────────────────────────────────────

output_json() {
  local desc="$1" task_type="$2" route="$3"
  local backend="${route%%:*}" model="${route#*:}"
  local info="${MODEL_CATALOG[$route]:-unknown:unknown:unknown}"
  local tier="${info%%:*}" rest="${info#*:}"
  local strength="${rest%%:*}" context="${rest#*:}"
  # Detect once, then derive the verdict from the already-selected route rather
  # than calling verdict_label -> route_only (which would re-run detect_backends,
  # re-probing `command-code status` ~10s per extra call). output_json is only
  # reached for non-inline tasks, so the verdict is external unless the selected
  # backend is not actually available -- matching route_only's phantom-fallback
  # guard (backend absent from avail => no external route => claude-subagent).
  local avail; avail="$(detect_backends)"
  local verdict="external"
  if ! printf ' %s ' "$avail" | grep -q " $backend "; then verdict="claude-subagent"; fi
  jq -n --arg task "$desc" --arg tt "$task_type" --arg b "$backend" --arg m "$model" \
        --arg tier "$tier" --arg s "$strength" --arg c "$context" --arg avail "$avail" \
        --arg verdict "$verdict" \
    '{task:$task, task_type:$tt, backend:$b, model:$m, tier:$tier, strength:$s,
      context_window:$c, available_backends:$avail, verdict:$verdict}'
}

output_human() {
  local desc="$1"
  local task_type="$2"
  local route="$3"
  local backend="${route%%:*}"
  local model="${route#*:}"
  local info="${MODEL_CATALOG[$route]:-unknown:unknown:unknown}"
  local tier="${info%%:*}"
  local rest="${info#*:}"
  local strength="${rest%%:*}"
  local context="${rest#*:}"
  
  echo "Task type:    $task_type"
  echo "Backend:      $backend"
  echo "Model:        $model"
  echo "Tier:         $tier"
  echo "Strength:     $strength"
  echo "Context:      $context"
  echo ""
  echo "Available backends: $(detect_backends)"
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

usage() {
  cat << EOF
Usage: $0 [OPTIONS] "task description"

OPTIONS:
  --json              Output JSON format
  --command           Generate execution command (don't execute)
  --execute           Execute the routed task
  --backend <name>    Force specific backend (omniroute, command-code, kimi, grok)
  --model <name>      Force specific model (used with --route-only)
  --plan-json         Print the frozen routing-policy plan as JSON
  --route-only        Print "BACKEND<TAB>MODEL" and exit (for programmatic callers)
  --route-only-with-fallbacks
                      Print the full priority-filtered fallback chain, one
                      "BACKEND<TAB>MODEL" line per available backend, in
                      priority order (for programmatic callers)
  --verdict           Print the unified verdict: "inline" |
                      "external<TAB>backend<TAB>model" | "claude-subagent"
  --list-backends     List available backends and exit
  --list-models       List all models in catalog
  -h, --help          Show this help

BACKENDS:
  omniroute           Dynamic gateway combo via agentic Codex execution
  command-code        35 models via Command Code CLI
  kimi                K2.7 Code via Kimi CLI
  grok                grok-composer-2.5-fast, grok-build via Grok CLI

EXAMPLES:
  $0 "implement auth middleware"
  $0 --json "refactor the entire database layer"
  $0 --command "implement auth middleware"
  $0 --execute "quick fix: update comment"
  $0 --backend kimi "long coding task"
  $0 --list-backends
EOF
}

main() {
  local json=false
  local command=false
  local execute=false
  local plan_json_mode=false
  local route_only_mode=false
  local route_only_fallbacks_mode=false
  local verdict_mode=false
  declare -g FORCE_BACKEND=""
  declare -g FORCE_MODEL=""
  local desc=""

  while [[ $# -gt 0 ]]; do
    case $1 in
      --json) json=true; shift ;;
      --command) command=true; shift ;;
      --execute) execute=true; shift ;;
      --plan-json) plan_json_mode=true; shift ;;
      --route-only) route_only_mode=true; shift ;;
      --route-only-with-fallbacks) route_only_fallbacks_mode=true; shift ;;
      --verdict) verdict_mode=true; shift ;;
      --model) FORCE_MODEL="$2"; shift 2 ;;
      --backend) FORCE_BACKEND="$2"; shift 2 ;;
      --list-backends)
        echo "Available backends: $(detect_backends)"
        exit 0
        ;;
      --list-models)
        echo "Model catalog:"
        for key in "${!MODEL_CATALOG[@]}"; do
          echo "  $key → ${MODEL_CATALOG[$key]}"
        done | sort
        exit 0
        ;;
      -h|--help) usage; exit 0 ;;
      --) shift; break ;;
      *) desc="$1"; shift ;;
    esac
  done

  # If "--" ended option parsing, any remaining positional arg is the description.
  if [[ $# -gt 0 && -z "$desc" ]]; then desc="$1"; fi

  if [[ -z "$desc" ]]; then
    usage
    exit 1
  fi

  if $plan_json_mode; then
    route_plan_json "$desc"
    exit 0
  fi

  if $route_only_mode; then
    route_only "$desc"
    exit 0
  fi

  if $route_only_fallbacks_mode; then
    route_only_with_fallbacks "$desc"
    exit 0
  fi

  if $verdict_mode; then
    verdict "$desc"
    exit 0
  fi

  # Analyze task
  local task_type
  task_type=$(analyze_task_type "$desc")
  
  # Handle inline tasks
  if [[ "$task_type" == "inline" ]]; then
    if $json; then
      echo '{"task_type": "inline", "executor": "inline", "verdict": "inline", "reason": "one-shot extraction, no external dispatch"}'
      exit 0
    else
      echo "Task type:    inline"
      echo "Executor:     inline (handle in current session)"
      echo "Reason:       one-shot extraction, no external dispatch needed"
      $execute && exit 3   # signal 'not executed' to programmatic callers
      exit 0
    fi
  fi
  
  # Resolve one policy plan for all normal output modes. An unavailable plan
  # maps to the existing live-session/subagent fallback; never manufacture a
  # phantom command-code route.
  local plan route backend model
  $execute && export TEMPERANCE_ROUTING_CLAIM_PROBES=1
  plan="$(route_plan_for_type_json "$task_type" "$FORCE_BACKEND" "$FORCE_MODEL" "external")"
  backend="$(jq -r '.selected_order[0].backend // empty' <<< "$plan")"
  model="$(jq -r '.selected_order[0].model // empty' <<< "$plan")"
  if [[ -z "$backend" || -z "$model" ]]; then
    if $json; then
      local avail; avail="$(detect_backends)"
      jq -n --arg task "$desc" --arg tt "$task_type" --arg avail "$avail" \
        '{task:$task,task_type:$tt,backend:null,model:null,tier:null,strength:null,
          context_window:null,available_backends:$avail,verdict:"claude-subagent"}'
    elif $command; then
      echo "# claude-subagent: no eligible external route"
    elif $execute; then
      echo "EXTERNAL_RAIL_UNAVAILABLE" >&2
      return 2
    else
      echo "Task type:    $task_type"
      echo "Executor:     claude-subagent"
      echo "Reason:       no eligible external route"
      echo ""
      echo "Available backends: $(detect_backends)"
    fi
    return
  fi
  route="$backend:$model"
  
  if $json; then
    output_json "$desc" "$task_type" "$route"
  elif $command; then
    generate_command "$route" "$desc"
  elif $execute; then
    echo "Executing via $route..."
    echo ""
    execute_route "$route" "$desc"
  else
    output_human "$desc" "$task_type" "$route"
  fi
}

main "$@"
