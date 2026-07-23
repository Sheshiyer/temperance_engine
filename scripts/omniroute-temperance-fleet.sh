#!/usr/bin/env bash
# Snapshot-first lifecycle for the planner, dispatch, and creative workflow
# combos. It never changes OmniRoute's global activeCombo.
set -euo pipefail

BASE_URL="${TEMPERANCE_OMNIROUTE_ADMIN_URL:-http://127.0.0.1:20128}"
BASE_URL="${BASE_URL%/}"
BACKUP_DIR="${TEMPERANCE_OMNIROUTE_BACKUP_DIR:-$PWD/.omniroute-backups}"
ADMIN_SERVICE="OmniRoute Temperance Admin"
API_KEY_SERVICE="OmniRoute Temperance API Key"
MODE="dry-run"
ROLLBACK_PATH=""

usage() {
  cat <<'USAGE'
Usage:
  scripts/omniroute-temperance-fleet.sh                 # authenticated dry-run
  scripts/omniroute-temperance-fleet.sh --apply         # create role combos
  scripts/omniroute-temperance-fleet.sh --rollback FILE # remove created role combos

Role combos: te-plan, te-dispatch, te-creative.
The script never changes OmniRoute's global activeCombo.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) MODE="apply" ;;
    --dry-run) MODE="dry-run" ;;
    --rollback) MODE="rollback"; shift; [ "$#" -ge 1 ] || { usage >&2; exit 2; }; ROLLBACK_PATH="$1" ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v security >/dev/null || { echo "macOS security CLI is required" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
[ "$MODE" != "rollback" ] || [ -f "$ROLLBACK_PATH" ] || { echo "rollback snapshot not found: $ROLLBACK_PATH" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
ADMIN_PASSWORD="$(security find-generic-password -a "$USER" -s "$ADMIN_SERVICE" -w)"
INFERENCE_KEY="$(security find-generic-password -a "$USER" -s "$API_KEY_SERVICE" -w)"
login_http="$(curl -sS -o "$TMP_DIR/login.json" -w '%{http_code}' -c "$TMP_DIR/cookie" \
  -H 'content-type: application/json' \
  -d "$(jq -nc --arg password "$ADMIN_PASSWORD" '{password:$password}')" \
  "$BASE_URL/api/auth/login")"
case "$login_http" in 2*) ;; *) echo "OmniRoute admin login failed (HTTP $login_http)" >&2; exit 1 ;; esac
CSRF="$(curl -sS -f -b "$TMP_DIR/cookie" "$BASE_URL/api/auth/csrf" | jq -er '.token')"

api_get() { curl -sS -f -b "$TMP_DIR/cookie" "$BASE_URL$1"; }
api_mutate() {
  local method="$1" path="$2" payload="$3" response="$TMP_DIR/mutate.json" http
  http="$(curl -sS -o "$response" -w '%{http_code}' -X "$method" -b "$TMP_DIR/cookie" \
    -H 'origin: http://127.0.0.1:20128' -H 'referer: http://127.0.0.1:20128/dashboard' \
    -H 'content-type: application/json' -H "x-csrf-token: $CSRF" -d "$payload" "$BASE_URL$path")"
  case "$http" in 2*) cat "$response" ;; *) echo "OmniRoute mutation failed: $method $path (HTTP $http)" >&2; cat "$response" >&2; return 1 ;; esac
}

settings="$(api_get /api/settings)"
combos="$(api_get /api/combos)"
catalog="$(curl -sS -f -H "Authorization: Bearer $INFERENCE_KEY" "$BASE_URL/v1/models")"
active_before="$(jq -c '.activeCombo // null' <<<"$settings")"
[ "$active_before" = "null" ] || { echo "Refusing to proceed: global activeCombo is $active_before" >&2; exit 1; }

ROLE_NAMES='["te-plan","te-dispatch","te-creative"]'
if [ "$MODE" != "rollback" ]; then
  while IFS= read -r name; do
    if jq -e --arg name "$name" 'any(.combos[]?; .name == $name)' <<<"$combos" >/dev/null; then
      echo "Refusing to overwrite existing combo: $name" >&2
      exit 1
    fi
  done < <(jq -r '.[]' <<<"$ROLE_NAMES")
fi

for model in \
  github/gpt-5.4 \
  codex/gpt-5.6-sol-max \
  command-code/deepseek/deepseek-v4-flash \
  command-code/moonshotai/Kimi-K2.7-Code \
  grok-cli/grok-build \
  nebius/Qwen/Qwen3-235B-A22B-Instruct-2507
do
  jq -e --arg model "$model" 'any(.data[]?; .id == $model)' <<<"$catalog" >/dev/null || {
    echo "Required live catalog model is missing: $model" >&2
    exit 1
  }
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PATH="$BACKUP_DIR/omniroute-fleet-$STAMP.json"
jq -n --arg baseUrl "$BASE_URL" --arg capturedAt "$STAMP" \
  --argjson settings "$settings" --argjson combos "$combos" --argjson catalog "$catalog" \
  --argjson plannedNames "$ROLE_NAMES" \
  '{schemaVersion:1,baseUrl:$baseUrl,capturedAt:$capturedAt,settings:$settings,combos:$combos,catalog:$catalog,plannedNewComboNames:$plannedNames}' \
  > "$BACKUP_PATH"

models3() { jq -nc --arg a "$1" --arg b "$2" --arg c "$3" '[{model:$a},{model:$b},{model:$c}]'; }
models4() { jq -nc --arg a "$1" --arg b "$2" --arg c "$3" --arg d "$4" '[{model:$a},{model:$b},{model:$c},{model:$d}]'; }
config() {
  jq -nc --argjson timeoutMs "$1" --argjson targetTimeoutMs "$2" \
    '{responseValidation:{minContentLength:0},maxRetries:0,timeoutMs:$timeoutMs,targetTimeoutMs:$targetTimeoutMs,healthCheckEnabled:true,trackMetrics:true,failoverBeforeRetry:true}'
}
payload() {
  jq -nc --arg name "$1" --arg description "$2" --arg systemMessage "$3" --arg strategy priority \
    --argjson models "$4" --argjson config "$5" \
    '{name:$name,description:$description,systemMessage:$systemMessage,models:$models,strategy:$strategy,config:$config}'
}

plan_payload="$(payload te-plan \
  'Temperance planning rail: GitHub-first orchestration with Codex escalation and quota-conscious backbone fallback.' \
  'Temperance planner: freeze the task graph, acceptance criteria, and worker handoff; do not mutate the workspace or invent a second classifier.' \
  "$(models3 github/gpt-5.4 codex/gpt-5.6-sol-max nebius/Qwen/Qwen3-235B-A22B-Instruct-2507)" "$(config 180000 90000)")"
dispatch_payload="$(payload te-dispatch \
  'Temperance dispatch fleet: shard independent work across Command Code, Kimi, Grok Build, and Nebius with observable fallback.' \
  'Temperance dispatch worker: execute only the assigned slice, preserve evidence, and return a compact artifact pointer for orchestration.' \
  "$(models4 command-code/deepseek/deepseek-v4-flash command-code/moonshotai/Kimi-K2.7-Code grok-cli/grok-build nebius/Qwen/Qwen3-235B-A22B-Instruct-2507)" "$(config 120000 60000)")"
creative_payload="$(payload te-creative \
  'Temperance creative planning rail: context-rich briefs handed to native ElevenLabs and RunwayML media contracts.' \
  'Temperance creative planner: resolve the taste/design skill, inject ISA pointers, specify the native media payload, and define artifact acceptance criteria.' \
  "$(models3 github/gpt-5.4 codex/gpt-5.6-sol-max nebius/Qwen/Qwen3-235B-A22B-Instruct-2507)" "$(config 180000 90000)")"

printf 'OmniRoute %s authenticated; backup snapshot: %s\n' "$MODE" "$BACKUP_PATH"
printf 'Global activeCombo before: %s\n' "$active_before"
if [ "$MODE" = "dry-run" ]; then
  printf '\n-- te-plan --\n%s\n\n-- te-dispatch --\n%s\n\n-- te-creative --\n%s\n' "$plan_payload" "$dispatch_payload" "$creative_payload"
  exit 0
fi

if [ "$MODE" = "rollback" ]; then
  old_combos="$(jq -er '.combos.combos' "$ROLLBACK_PATH")"
  current_combos="$(api_get /api/combos)"
  while IFS= read -r combo_id; do
    [ -n "$combo_id" ] || continue
    api_mutate DELETE "/api/combos/$combo_id" '{}' >/dev/null
    printf 'Rolled back role combo id=%s\n' "$combo_id"
  done < <(jq -r --argjson names "$(jq -er '.plannedNewComboNames' "$ROLLBACK_PATH")" '.combos[] | select(.name as $n | $names | index($n)) | .id' <<<"$current_combos")
  printf 'Rollback complete from %s\n' "$ROLLBACK_PATH"
  exit 0
fi

for item in "$plan_payload" "$dispatch_payload" "$creative_payload"; do
  response="$(api_mutate POST /api/combos "$item")"
  printf 'Created %s id=%s\n' "$(jq -r .name <<<"$response")" "$(jq -r .id <<<"$response")"
done
active_after="$(jq -c '.activeCombo // null' <<<"$(api_get /api/settings)")"
[ "$active_after" = "$active_before" ] || { echo "Global activeCombo changed unexpectedly" >&2; exit 1; }
printf 'Global activeCombo after: %s (unchanged)\n' "$active_after"
printf 'Mutation complete; use --rollback %s if verification fails.\n' "$BACKUP_PATH"
