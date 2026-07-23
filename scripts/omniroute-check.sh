#!/usr/bin/env bash
# Read-only OmniRoute runtime/catalog/readiness probe. Add --live for one tiny completion.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${TEMPERANCE_OMNIROUTE_BASE_URL:-http://127.0.0.1:20128/v1}"
BASE_URL="${BASE_URL%/}"
[[ "$BASE_URL" == */v1 ]] || BASE_URL="$BASE_URL/v1"
CLI_BASE_URL="${BASE_URL%/v1}"
MODEL="${TEMPERANCE_OMNIROUTE_MODEL:-temperance-coding}"
LIVE=false
JSON_MODE=false

for arg in "$@"; do
  case "$arg" in
    --live) LIVE=true ;;
    --json) JSON_MODE=true ;;
    -h|--help)
      echo "Usage: $0 [--json] [--live]"
      echo "Read-only OmniRoute runtime, catalog, portfolio, telemetry, and eval probe."
      exit 0
      ;;
    *) echo "FAIL unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v curl >/dev/null 2>&1 || { echo "FAIL curl is required" >&2; exit 127; }
command -v jq >/dev/null 2>&1 || { echo "FAIL jq is required" >&2; exit 127; }

GATEWAY_AUTH="${OMNIROUTE_API_KEY:-}"
if [[ -z "$GATEWAY_AUTH" ]] && command -v security >/dev/null 2>&1; then
  GATEWAY_AUTH="$(security find-generic-password -a "$USER" \
    -s "${TEMPERANCE_OMNIROUTE_KEYCHAIN_SERVICE:-OmniRoute Temperance API Key}" \
    -w 2>/dev/null || true)"
fi
headers=()
[[ -n "$GATEWAY_AUTH" ]] && headers=(-H "Authorization: Bearer $GATEWAY_AUTH")

extract_json() {
  local raw="$1" candidate
  if jq -e . <<< "$raw" >/dev/null 2>&1; then
    jq -c . <<< "$raw"
    return 0
  fi
  candidate="$(sed -n '/^[[:space:]]*[\[{]/,$p' <<< "$raw")"
  jq -e . <<< "$candidate" >/dev/null 2>&1 || return 1
  jq -c . <<< "$candidate"
}

cli_json() {
  command -v omniroute >/dev/null 2>&1 || return 1
  local -a args=(--no-color --quiet --output json)
  [[ -n "$GATEWAY_AUTH" ]] && args+=(--api-key "$GATEWAY_AUTH")
  [[ -n "$CLI_BASE_URL" ]] && args+=(--base-url "$CLI_BASE_URL")
  local raw parsed
  raw="$(omniroute "${args[@]}" "$@" 2>/dev/null || true)"
  parsed="$(extract_json "$raw" 2>/dev/null || true)"
  [[ -n "$parsed" ]] && printf '%s\n' "$parsed"
}

numeric_json_or_null() {
  local expression="$1" source="$2" value
  value="$(jq -c "$expression" <<< "$source" 2>/dev/null || true)"
  if [[ -n "$value" ]] && jq -e 'type == "number" and isfinite and . >= 0' <<< "$value" >/dev/null 2>&1; then
    printf '%s\n' "$value"
  else
    printf 'null\n'
  fi
}

collection_count_or_null() {
  local source="$1" value
  value="$(jq -c 'if type == "array" then length elif (.data | type) == "array" then (.data | length) else null end' <<< "$source" 2>/dev/null || true)"
  if [[ -n "$value" ]] && jq -e 'type == "number" and isfinite and . >= 0' <<< "$value" >/dev/null 2>&1; then
    printf '%s\n' "$value"
  else
    printf 'null\n'
  fi
}

fixture_path="${TEMPERANCE_OMNIROUTE_READINESS_FIXTURE:-}"
fixture=''
fixture_schema_valid=true
if [[ -n "$fixture_path" && -f "$fixture_path" ]]; then
  fixture="$(jq -c . "$fixture_path" 2>/dev/null || true)"
  if [[ -n "$fixture" ]] && [[ "$(jq -r '.schema_version // empty' <<< "$fixture")" != "temperance-readiness-fixture-v1" ]]; then
    fixture_schema_valid=false
  fi
fi

version="unknown"
body='{}'
status="000"
runtime_available=false
catalog_source="live /v1/models"
if [[ -n "$fixture" ]]; then
  if [[ "$fixture_schema_valid" == true ]]; then
    version="$(jq -r '.version // "unknown"' <<< "$fixture")"
    body="$(jq -c '.models // {}' <<< "$fixture")"
    status="fixture"
    catalog_source="readiness fixture"
    if jq -e '.models | type == "object" and (.data | type == "array")' <<< "$fixture" >/dev/null 2>&1; then
      runtime_available=true
    fi
  else
    status="invalid-fixture"
    catalog_source="invalid readiness fixture"
  fi
else
  raw="$(curl -sS --connect-timeout 2 --max-time 10 -w $'\n%{http_code}' \
    "${headers[@]}" "$BASE_URL/models" 2>/dev/null || true)"
  status="${raw##*$'\n'}"
  body="${raw%$'\n'*}"
  if [[ "$status" == "200" ]] && jq -e '.data | type == "array"' <<< "$body" >/dev/null 2>&1; then
    runtime_available=true
  else
    body='{}'
  fi
  version="$(omniroute --version 2>/dev/null | tail -n 1 | tr -d '\r' || true)"
  [[ -n "$version" ]] || version="unknown"
fi

manifest="$ROOT_DIR/package/router/omniroute-portfolios.json"
configured_json="$(jq -c '[.task_type_portfolios | to_entries[] | .value] | unique' "$manifest" 2>/dev/null || printf '[]')"
required_json="$(jq -c '(.required_portfolios // [.task_type_portfolios | to_entries[] | .value]) | unique' "$manifest" 2>/dev/null || printf '[]')"
catalog_count_json="$(numeric_json_or_null '.data | length' "$body")"
available_portfolios_json="$(jq -c --argjson configured "$configured_json" \
  '(.data // [] | map(.id) | map(select(type == "string"))) as $ids |
   $configured | map(select(. as $portfolio | $ids | index($portfolio) != null))' <<< "$body" 2>/dev/null || printf '[]')"
missing_portfolios_json="$(jq -c --argjson configured "$configured_json" --argjson available "$available_portfolios_json" \
  '$configured - $available' <<< '{}' 2>/dev/null || printf '[]')"
available_required_portfolios_json="$(jq -c --argjson required "$required_json" \
  '(.data // [] | map(.id) | map(select(type == "string"))) as $ids |
   $required | map(select(. as $portfolio | $ids | index($portfolio) != null))' <<< "$body" 2>/dev/null || printf '[]')"
missing_required_portfolios_json="$(jq -c --argjson required "$required_json" --argjson available "$available_required_portfolios_json" \
  '$required - $available' <<< '{}' 2>/dev/null || printf '[]')"
compatibility_present_json="$(jq -c --arg model "$MODEL" \
  'any(.data[]?; .id == $model)' <<< "$body" 2>/dev/null || printf 'false')"

telemetry_available=false
telemetry_request_count_json=null
telemetry_success_count_json=null
telemetry_failure_count_json=null
telemetry_source="unavailable"
if [[ -n "$fixture" ]]; then
  if [[ "$fixture_schema_valid" == true ]]; then
    fixture_telemetry="$(jq -c '.telemetry // {}' <<< "$fixture")"
    telemetry_request_count_json="$(numeric_json_or_null '.request_count' "$fixture_telemetry")"
    telemetry_success_count_json="$(numeric_json_or_null '.success_count' "$fixture_telemetry")"
    telemetry_failure_count_json="$(numeric_json_or_null '.failure_count' "$fixture_telemetry")"
    if [[ "$(jq -r '.available == true' <<< "$fixture_telemetry")" == true ]] && [[ "$telemetry_request_count_json" != null ]]; then
      telemetry_available=true
      telemetry_source="readiness fixture"
    fi
  fi
elif telemetry_raw="$(cli_json telemetry summary)"; then
  telemetry_request_count_json="$(numeric_json_or_null \
    'if type == "array" then ([.[] | select(.metric == "totalRequests" or .metric == "count") | .value] | first) elif type == "object" then (.totalRequests // .count) else null end' \
    "$telemetry_raw")"
  telemetry_success_count_json="$(numeric_json_or_null \
    'if type == "object" then (.successCount // .success_count) else null end' "$telemetry_raw")"
  telemetry_failure_count_json="$(numeric_json_or_null \
    'if type == "object" then (.failureCount // .failure_count) else null end' "$telemetry_raw")"
  if [[ "$telemetry_request_count_json" != null ]]; then
    telemetry_available=true
    telemetry_source="omniroute telemetry summary"
  fi
fi

eval_available=false
eval_suite_count_json=null
eval_run_count_json=null
eval_source="unavailable"
if [[ -n "$fixture" ]]; then
  if [[ "$fixture_schema_valid" == true ]]; then
    fixture_evals="$(jq -c '.evals // {}' <<< "$fixture")"
    eval_suite_count_json="$(collection_count_or_null "$(jq -c '{data:.suites}' <<< "$fixture_evals")")"
    eval_run_count_json="$(collection_count_or_null "$(jq -c '{data:.runs}' <<< "$fixture_evals")")"
    if [[ "$(jq -r '.available == true' <<< "$fixture_evals")" == true ]] \
      && [[ "$eval_suite_count_json" != null ]] && [[ "$eval_suite_count_json" -gt 0 ]] \
      && [[ "$eval_run_count_json" != null ]] && [[ "$eval_run_count_json" -gt 0 ]]; then
      eval_available=true
      eval_source="readiness fixture"
    fi
  fi
else
  eval_suites_raw="$(cli_json eval suites list)"
  eval_runs_raw="$(cli_json eval list)"
  eval_suite_count_json="$(collection_count_or_null "${eval_suites_raw:-null}")"
  eval_run_count_json="$(collection_count_or_null "${eval_runs_raw:-null}")"
  if [[ "$eval_suite_count_json" != null ]] && [[ "$eval_suite_count_json" -gt 0 ]] \
    && [[ "$eval_run_count_json" != null ]] && [[ "$eval_run_count_json" -gt 0 ]]; then
    eval_available=true
    eval_source="omniroute eval CLI"
  fi
fi

router_route=""
router_route_ok=false
if [[ -z "$fixture" ]]; then
  router_route="$(TEMPERANCE_BACKENDS="omniroute" TEMPERANCE_OMNIROUTE_MODEL="$MODEL" \
    "$ROOT_DIR/package/router/multi-backend-router.sh" --route-only \
    "refactor the authentication module" 2>/dev/null || true)"
  [[ "$router_route" == "omniroute"$'\t'"$MODEL" ]] && router_route_ok=true
fi

reasons_json="$(jq -cn \
  --argjson runtime "$runtime_available" \
  --argjson compatibility "$compatibility_present_json" \
  --argjson missing "$missing_required_portfolios_json" \
  --argjson telemetry "$telemetry_available" \
  --argjson evals "$eval_available" \
  --argjson route "$router_route_ok" \
  '["enforcement-disabled-until-promotion-receipt"]
   + (if $runtime then [] else ["runtime-or-catalog-unavailable"] end)
   + (if $compatibility then [] else ["compatibility-combo-missing"] end)
   + (if ($missing | length) == 0 then [] else ["named-portfolios-missing-from-catalog"] end)
   + (if $telemetry then [] else ["telemetry-evidence-unavailable"] end)
   + (if $evals then [] else ["eval-evidence-unavailable"] end)
   + (if $route or ($runtime | not) then [] else ["temperance-route-boundary-unverified"] end)' )"

readiness_json="$(jq -cn \
  --arg schema "temperance-omniroute-readiness-v1" \
  --arg base_url "$BASE_URL" --arg source "$catalog_source" --arg version "$version" \
  --arg model "$MODEL" --arg catalog_status "$status" \
  --argjson runtime "$runtime_available" --argjson count "$catalog_count_json" \
  --argjson configured "$configured_json" --argjson available "$available_portfolios_json" \
  --argjson required "$required_json" --argjson required_available "$available_required_portfolios_json" \
  --argjson required_missing "$missing_required_portfolios_json" \
  --argjson missing "$missing_portfolios_json" --argjson compatibility "$compatibility_present_json" \
  --arg telemetry_source "$telemetry_source" --argjson telemetry "$telemetry_available" \
  --argjson requests "$telemetry_request_count_json" --argjson successes "$telemetry_success_count_json" \
  --argjson failures "$telemetry_failure_count_json" \
  --arg eval_source "$eval_source" --argjson evals "$eval_available" \
  --argjson suites "$eval_suite_count_json" --argjson runs "$eval_run_count_json" \
  --argjson route "$router_route_ok" --arg router_route "$router_route" \
  --argjson reasons "$reasons_json" \
  '{schema_version:$schema,
    runtime:{available:$runtime,version:$version,base_url:$base_url,catalog_status:$catalog_status},
    catalog:{available:$runtime,count:$count,compatibility_model:$model,compatibility_present:$compatibility,
      configured_portfolios:$configured,available_portfolios:$available,missing_portfolios:$missing,
      required_portfolios:$required,required_available_portfolios:$required_available,
      required_missing_portfolios:$required_missing,source:$source},
    telemetry:{available:$telemetry,request_count:$requests,success_count:$successes,failure_count:$failures,source:$telemetry_source},
    evals:{available:$evals,suite_count:$suites,run_count:$runs,source:$eval_source},
    router:{verified:$route,route:(if $router_route == "" then null else $router_route end)},
    enforcement_ready:false,reasons:$reasons}' )"

if $JSON_MODE; then
  printf '%s\n' "$readiness_json"
  exit 0
fi

if [[ "$runtime_available" != true ]]; then
  echo "FAIL OmniRoute catalog unavailable at $BASE_URL/models (HTTP ${status:-000})" >&2
  exit 1
fi

count="$(jq -r '.catalog.count' <<< "$readiness_json")"
echo "PASS OmniRoute runtime ${version:-unknown}"
echo "API $BASE_URL"
echo "Catalog models $count"
echo "Temperance combo $MODEL ($(jq -r 'if .catalog.compatibility_present then "present" else "missing" end' <<< "$readiness_json"))"
echo "Configured portfolios $(jq -r '.catalog.configured_portfolios | join(", ")' <<< "$readiness_json")"
echo "Available portfolios $(jq -r 'if (.catalog.available_portfolios|length) == 0 then "none" else (.catalog.available_portfolios|join(", ")) end' <<< "$readiness_json")"
echo "Missing portfolios $(jq -r 'if (.catalog.missing_portfolios|length) == 0 then "none" else (.catalog.missing_portfolios|join(", ")) end' <<< "$readiness_json")"
echo "Telemetry evidence $(jq -r 'if .telemetry.available then "available" else "unavailable" end' <<< "$readiness_json")"
echo "Eval evidence $(jq -r 'if .evals.available then "available" else "unavailable" end' <<< "$readiness_json")"
echo "Enforcement ready false (promotion receipt required)"
echo "Catalog owners"
jq -r '.data | group_by(.owned_by)[] | "  \(.[0].owned_by // "unknown")\t\(length)"' <<< "$body"

[[ "$(jq -r '.catalog.compatibility_present' <<< "$readiness_json")" == true ]] || exit 1
[[ "$router_route_ok" == true ]] || { echo "FAIL Temperance route $router_route" >&2; exit 1; }

if $LIVE; then
  payload="$(jq -cn --arg model "$MODEL" \
    '{model:$model,messages:[{role:"user",content:"Reply with exactly OMNIROUTE_OK"}],stream:false,max_tokens:128}')"
  raw="$(curl -sS --connect-timeout 2 --max-time 90 -w $'\n%{http_code}' \
    "${headers[@]}" -H 'Content-Type: application/json' --data-binary "$payload" \
    "$BASE_URL/chat/completions" 2>/dev/null || true)"
  status="${raw##*$'\n'}"
  body="${raw%$'\n'*}"
  content="$(jq -r '.choices[0].message.content // empty' <<< "$body" 2>/dev/null)"
  resolved="$(jq -r '.model // "unknown"' <<< "$body" 2>/dev/null)"
  if [[ "$status" == "200" && "$content" == "OMNIROUTE_OK" ]]; then
    echo "PASS live completion via $resolved"
  else
    error="$(jq -r '.error.message // "unexpected response"' <<< "$body" 2>/dev/null)"
    echo "FAIL live completion HTTP ${status:-000}: $error" >&2
    exit 1
  fi
fi
