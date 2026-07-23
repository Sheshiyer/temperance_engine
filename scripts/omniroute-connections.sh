#!/usr/bin/env bash
# Read-only OmniRoute connection, catalog, health, and leverage inventory.
# It intentionally calls only GET/read-only CLI surfaces and never emits
# credentials, model IDs, raw errors, or provider payloads.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROLE_MAP="${TEMPERANCE_OMNIROUTE_ROLE_MAP:-$ROOT_DIR/package/router/omniroute-connection-roles.json}"
BASE_URL="${TEMPERANCE_OMNIROUTE_BASE_URL:-http://127.0.0.1:20128/v1}"
BASE_URL="${BASE_URL%/}"
[[ "$BASE_URL" == */v1 ]] || BASE_URL="$BASE_URL/v1"
FIXTURE="${TEMPERANCE_CONNECTIONS_FIXTURE:-}"
JSON_MODE=false

for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=true ;;
    --fixture) echo "Use TEMPERANCE_CONNECTIONS_FIXTURE=/path/to/fixture.json" >&2; exit 2 ;;
    -h|--help)
      echo "Usage: $0 [--json]"
      echo "Read-only redacted OmniRoute connection and capability inventory."
      exit 0
      ;;
    *) echo "FAIL unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "FAIL jq is required" >&2; exit 127; }
[[ -f "$ROLE_MAP" ]] || { echo "FAIL role map missing: $ROLE_MAP" >&2; exit 1; }

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
  local raw parsed
  raw="$(omniroute "$@" 2>/dev/null || true)"
  parsed="$(extract_json "$raw" 2>/dev/null || true)"
  [[ -n "$parsed" ]] && printf '%s\n' "$parsed"
}

empty_fixture() {
  printf '%s\n' '{"health":{},"providers":{"providers":[]},"metrics":[],"catalog":{"data":[]}}'
}

if [[ -n "$FIXTURE" ]]; then
  [[ -f "$FIXTURE" ]] || { echo "FAIL fixture missing: $FIXTURE" >&2; exit 1; }
  FIXTURE_JSON="$(jq -c . "$FIXTURE")"
  HEALTH_JSON="$(jq -c '.health // {}' <<< "$FIXTURE_JSON")"
  PROVIDERS_JSON="$(jq -c '.providers // {providers:[]}' <<< "$FIXTURE_JSON")"
  METRICS_JSON="$(jq -c '.metrics // []' <<< "$FIXTURE_JSON")"
  CATALOG_JSON="$(jq -c '.catalog // {data:[]}' <<< "$FIXTURE_JSON")"
  SOURCE="fixture"
else
  HEALTH_JSON="$(cli_json health --json || printf '{}')"
  PROVIDERS_JSON="$(cli_json providers list --json || printf '{"providers":[]}')"
  METRICS_JSON="$(cli_json providers metrics --output json || printf '[]')"
  GATEWAY_AUTH="${OMNIROUTE_API_KEY:-}"
  if [[ -z "$GATEWAY_AUTH" ]] && command -v security >/dev/null 2>&1; then
    GATEWAY_AUTH="$(security find-generic-password -a "${USER:-}" \
      -s "${TEMPERANCE_OMNIROUTE_KEYCHAIN_SERVICE:-OmniRoute Temperance API Key}" \
      -w 2>/dev/null || true)"
  fi
  HEADERS=()
  [[ -n "$GATEWAY_AUTH" ]] && HEADERS=(-H "Authorization: Bearer $GATEWAY_AUTH")
  RAW_CATALOG="$(curl -sS --connect-timeout 2 --max-time 10 "${HEADERS[@]}" \
    "$BASE_URL/models" 2>/dev/null || true)"
  CATALOG_JSON="$(extract_json "$RAW_CATALOG" 2>/dev/null || printf '{"data":[]}')"
  SOURCE="live"
fi

ROLES_JSON="$(jq -c . "$ROLE_MAP")"

REPORT="$(jq -cn \
  --arg source "$SOURCE" \
  --arg base_url "$BASE_URL" \
  --argjson roles "$ROLES_JSON" \
  --argjson health "$HEALTH_JSON" \
  --argjson providers "$PROVIDERS_JSON" \
  --argjson metrics "$METRICS_JSON" \
  --argjson catalog "$CATALOG_JSON" '
  def role_for($provider):
    if (($roles.roles.agentic // []) | index($provider)) then "agentic"
    elif (($roles.roles.research // []) | index($provider)) then "research"
    elif (($roles.roles.media // []) | index($provider)) then "media"
    elif (($roles.roles.backbone // []) | index($provider)) then "backbone"
    else "unmapped" end;
  def metric_for($provider): (($metrics // []) | map(select(.provider == $provider)) | first) // {};
  def breaker_for($provider): (($health.providerBreakers // []) | map(select(.provider == $provider)) | first) // {};
  def health_for($provider; $active):
    (metric_for($provider)) as $metric |
    (breaker_for($provider)) as $breaker |
    if ($active | not) then "inactive"
    elif (($breaker.state // "") | IN("OPEN","DEGRADED")) then "degraded"
    elif (($metric.totalRequests // 0) > 0 and ($metric.successRate // null) != null and ($metric.successRate < 80 or ($metric.lastStatus // 0) >= 400)) then "degraded"
    elif (($metric.totalRequests // 0) > 0 and ($metric.successRate // null) != null and ($metric.successRate >= 80) and (($metric.lastStatus // 200) < 400)) then "healthy"
    else "unknown" end;
  def provider_rows:
    (($providers.providers // []) | map({
      id: (.id // null),
      provider: (.provider // "unknown"),
      name: (.name // "unnamed"),
      auth_type: (.authType // "unknown"),
      active: (.isActive == true),
      test_status: (.testStatus // "unknown"),
      role: role_for(.provider // "unknown"),
      health: health_for((.provider // "unknown"); (.isActive == true)),
      eligible: ((.isActive == true) and (health_for((.provider // "unknown"); true) == "healthy") and (role_for(.provider // "unknown") != "unmapped")),
      metrics: (metric_for(.provider // "unknown") | if length == 0 then null else {requests:(.totalRequests // 0),successes:(.totalSuccesses // 0),success_rate:(.successRate // null),avg_latency_ms:(.avgLatencyMs // null),last_status:(.lastStatus // null)} end),
      breaker: (breaker_for(.provider // "unknown") | if length == 0 then null else {state:(.state // "unknown"),failures:(.failureCount // 0),retry_after_ms:(.retryAfterMs // 0)} end)
    }) | sort_by(.provider, .name, .id));
  def catalog_rows:
    (($catalog.data // []) | map(select((.id // null) | type == "string")));
  (provider_rows) as $connections |
  (catalog_rows) as $catalog_rows |
  ($catalog_rows | sort_by([.id, (.owned_by // "unknown")]) | unique_by(.id)) as $unique_catalog |
  ($catalog_rows | group_by(.owned_by // "unknown") | map({owner:(.[0].owned_by // "unknown"),models:length,unique_models:([.[].id]|unique|length),role:role_for(.[0].owned_by // "unknown")} ) | sort_by(-.models,.owner)) as $owners |
  ($connections | group_by(.role) | map({role:.[0].role,connections:length,active:(map(select(.active))|length),eligible:(map(select(.eligible))|length),providers:(map(.provider)|unique|sort)}) | sort_by(.role)) as $role_summary |
  {
    schema_version:"temperance-omniroute-connections-v1",
    generated_at:(now | todateiso8601),
    source:$source,
    read_only:{writes:false,credential_writes:false,endpoints:["GET /health","GET /v1/models","providers list","providers metrics"]},
    runtime:{base_url:$base_url,status:($health.status // "unknown"),version:($health.version // "unknown"),active_connections:($health.activeConnections // ($connections|map(select(.active))|length)),catalog_count:($health.providerSummary.catalogCount // null),configured_count:($health.providerSummary.configuredCount // ($connections|length)),circuit_breakers:($health.circuitBreakers // {})},
    connections:{count:($connections|length),active_count:($connections|map(select(.active))|length),role_summary:$role_summary,items:$connections},
    catalog:{advertised_count:($catalog_rows|length),unique_model_count:($unique_catalog|length),duplicate_count:(($catalog_rows|length)-($unique_catalog|length)),owners:$owners},
    leverage:{role_map_version:$roles.version,lanes:$roles.lane_descriptions,recommendations:[
      {lane:"agentic",rule:"Only healthy, tool-capable agentic connections are eligible for coding portfolios."},
      {lane:"research",rule:"Use research connections as bounded tools; do not treat search/crawl credentials as chat models."},
      {lane:"media",rule:"Keep media providers behind their native payload adapters and separate acceptance probes."},
      {lane:"backbone",rule:"Promote backbone pools into named portfolios only after direct probe and combo evidence."}
    ],unmapped_providers:($connections|map(select(.role=="unmapped")|.provider)|unique|sort),degraded_providers:($connections|map(select(.health=="degraded")|.provider)|unique|sort),eligible_agentic:($connections|map(select(.role=="agentic" and .eligible))|map(.provider)|unique|sort)},
    safety:{unknown_role_policy:$roles.unknown_policy,full_model_ids_emitted:false,credential_fields_emitted:false}
  }')"

if $JSON_MODE; then
  printf '%s\n' "$REPORT"
  exit 0
fi

echo "PASS OmniRoute connection inventory ($(jq -r '.source' <<< "$REPORT"))"
echo "Runtime $(jq -r '.runtime.version // "unknown"' <<< "$REPORT") at $(jq -r '.runtime.base_url' <<< "$REPORT")"
echo "Connections $(jq -r '.connections.active_count' <<< "$REPORT") active / $(jq -r '.connections.count' <<< "$REPORT") configured"
echo "Catalog $(jq -r '.catalog.unique_model_count' <<< "$REPORT") unique / $(jq -r '.catalog.advertised_count' <<< "$REPORT") advertised ($(jq -r '.catalog.duplicate_count' <<< "$REPORT") duplicate aliases)"
echo "Roles $(jq -r '.connections.role_summary | map((.role)+"="+(.connections|tostring)) | join(", ")' <<< "$REPORT")"
echo "Eligible agentic $(jq -r '.leverage.eligible_agentic | if length == 0 then "none" else join(", ") end' <<< "$REPORT")"
echo "Degraded $(jq -r '.leverage.degraded_providers | if length == 0 then "none" else join(", ") end' <<< "$REPORT")"
echo "Unmapped $(jq -r '.leverage.unmapped_providers | if length == 0 then "none" else join(", ") end' <<< "$REPORT")"
