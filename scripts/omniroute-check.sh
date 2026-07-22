#!/usr/bin/env bash
# Read-only OmniRoute runtime/catalog probe. Add --live for one tiny completion.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${TEMPERANCE_OMNIROUTE_BASE_URL:-http://127.0.0.1:20128/v1}"
BASE_URL="${BASE_URL%/}"
[[ "$BASE_URL" == */v1 ]] || BASE_URL="$BASE_URL/v1"
MODEL="${TEMPERANCE_OMNIROUTE_MODEL:-temperance-coding}"
LIVE=false
[[ "${1:-}" == "--live" ]] && LIVE=true

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

raw="$(curl -sS --connect-timeout 2 --max-time 10 -w $'\n%{http_code}' \
  "${headers[@]}" "$BASE_URL/models" 2>/dev/null || true)"
status="${raw##*$'\n'}"
body="${raw%$'\n'*}"
if [[ "$status" != "200" ]] || ! jq -e '.data | type == "array"' <<< "$body" >/dev/null 2>&1; then
  echo "FAIL OmniRoute catalog unavailable at $BASE_URL/models (HTTP ${status:-000})" >&2
  exit 1
fi

version="$(omniroute --version 2>/dev/null | tail -n 1 | tr -d '\r')"
count="$(jq '.data | length' <<< "$body")"
if jq -e --arg model "$MODEL" '.data[] | select(.id == $model)' <<< "$body" >/dev/null; then
  combo="present"
else
  combo="missing"
fi

echo "PASS OmniRoute runtime ${version:-unknown}"
echo "API $BASE_URL"
echo "Catalog models $count"
echo "Temperance combo $MODEL ($combo)"
echo "Catalog owners"
jq -r '.data | group_by(.owned_by)[] | "  \(.[0].owned_by // "unknown")\t\(length)"' <<< "$body"

[[ "$combo" == "present" ]] || exit 1

plan="$(TEMPERANCE_BACKENDS="omniroute" TEMPERANCE_OMNIROUTE_MODEL="$MODEL" \
  "$ROOT_DIR/package/router/multi-backend-router.sh" --route-only \
  "refactor the authentication module" 2>/dev/null || true)"
echo "Temperance route ${plan//$'\t'/ }"
[[ "$plan" == "omniroute"$'\t'"$MODEL" ]] || exit 1

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
