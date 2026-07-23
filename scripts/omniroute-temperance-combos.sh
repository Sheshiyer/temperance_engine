#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${TEMPERANCE_OMNIROUTE_ADMIN_URL:-http://127.0.0.1:20128}"
BASE_URL="${BASE_URL%/}"
BACKUP_DIR="${TEMPERANCE_OMNIROUTE_BACKUP_DIR:-$PWD/.omniroute-backups}"
ADMIN_SERVICE="OmniRoute Temperance Admin"
API_KEY_SERVICE="OmniRoute Temperance API Key"
COOKIE_PATH=""
MODE="dry-run"
ROLLBACK_PATH=""

usage() {
  cat <<'USAGE'
Usage:
  scripts/omniroute-temperance-combos.sh                 # authenticated dry-run
  scripts/omniroute-temperance-combos.sh --apply         # create/update governed combos
  scripts/omniroute-temperance-combos.sh --rollback FILE # delete created portfolios and restore snapshot

The script never changes OmniRoute's global activeCombo setting.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) MODE="apply" ;;
    --dry-run) MODE="dry-run" ;;
    --rollback)
      MODE="rollback"
      shift
      [ "$#" -ge 1 ] || { usage >&2; exit 2; }
      ROLLBACK_PATH="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v security >/dev/null || { echo "macOS security CLI is required" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"

if [ "$MODE" = "rollback" ]; then
  [ -f "$ROLLBACK_PATH" ] || { echo "rollback snapshot not found: $ROLLBACK_PATH" >&2; exit 1; }
fi

COOKIE_PATH="$BACKUP_DIR/cookie.$$"
trap 'rm "$COOKIE_PATH" 2>/dev/null || true' EXIT

ADMIN_PASSWORD="$(security find-generic-password -a "$USER" -s "$ADMIN_SERVICE" -w)"
INFERENCE_KEY="$(security find-generic-password -a "$USER" -s "$API_KEY_SERVICE" -w)"

login_status="$(curl -sS -o "$BACKUP_DIR/login.$$.json" -w '%{http_code}' \
  -c "$COOKIE_PATH" \
  -H 'content-type: application/json' \
  -d "$(jq -nc --arg password "$ADMIN_PASSWORD" '{password:$password}')" \
  "$BASE_URL/api/auth/login")"
case "$login_status" in
  2*) ;;
  *) echo "OmniRoute admin login failed (HTTP $login_status)" >&2; exit 1 ;;
esac

CSRF="$(curl -sS -f -b "$COOKIE_PATH" "$BASE_URL/api/auth/csrf" | jq -er '.token')"

api_get() {
  curl -sS -f -b "$COOKIE_PATH" "$BASE_URL$1"
}

api_mutate() {
  local method="$1"
  local path="$2"
  local payload="$3"
  local response="$BACKUP_DIR/mutate.$$.json"
  local status
  status="$(curl -sS -o "$response" -w '%{http_code}' \
    -X "$method" \
    -b "$COOKIE_PATH" \
    -H 'origin: http://127.0.0.1:20128' \
    -H 'referer: http://127.0.0.1:20128/dashboard' \
    -H 'content-type: application/json' \
    -H "x-csrf-token: $CSRF" \
    -d "$payload" \
    "$BASE_URL$path")"
  case "$status" in
    2*) cat "$response" ;;
    *) echo "OmniRoute mutation failed: $method $path (HTTP $status)" >&2; cat "$response" >&2; return 1 ;;
  esac
}

settings="$(api_get /api/settings)"
combos="$(api_get /api/combos)"
catalog="$(curl -sS -f -H "Authorization: Bearer $INFERENCE_KEY" "$BASE_URL/v1/models")"

active_before="$(jq -c '.activeCombo // null' <<<"$settings")"
if [ "$active_before" != "null" ]; then
  echo "Refusing to proceed: global activeCombo is $active_before, expected null." >&2
  exit 1
fi

new_names_json='["te-fast","te-build","te-reason","te-validate"]'
if [ "$MODE" != "rollback" ]; then
  for name in te-fast te-build te-reason te-validate; do
    if jq -e --arg name "$name" 'any(.combos[]?; .name == $name)' <<<"$combos" >/dev/null; then
      echo "Refusing to overwrite existing combo: $name" >&2
      exit 1
    fi
  done
fi

for model in \
  antigravity/gemini-3.5-flash-low \
  antigravity/claude-sonnet-4-6 \
  antigravity/claude-opus-4-6-thinking \
  github/gpt-5.4 \
  codex/gpt-5.6-terra \
  nebius/Qwen/Qwen3-235B-A22B-Instruct-2507
do
  jq -e --arg model "$model" 'any(.data[]?; .id == $model)' <<<"$catalog" >/dev/null || {
    echo "Required live catalog model is missing: $model" >&2
    exit 1
  }
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PATH="$BACKUP_DIR/omniroute-combos-$STAMP.json"
jq -n \
  --arg baseUrl "$BASE_URL" \
  --arg capturedAt "$STAMP" \
  --argjson settings "$settings" \
  --argjson combos "$combos" \
  --argjson catalog "$catalog" \
  --argjson plannedNames "$new_names_json" \
  '{schemaVersion:1,baseUrl:$baseUrl,capturedAt:$capturedAt,settings:$settings,combos:$combos,catalog:$catalog,plannedNewComboNames:$plannedNames}' \
  > "$BACKUP_PATH"

models_json() {
  jq -nc --arg a "$1" --arg b "$2" --arg c "$3" '[{model:$a},{model:$b},{model:$c}]'
}

config_json() {
  local timeout_ms="$1"
  local target_timeout_ms="$2"
  local min_content_length="$3"
  jq -nc \
    --argjson timeoutMs "$timeout_ms" \
    --argjson targetTimeoutMs "$target_timeout_ms" \
    --argjson minContentLength "$min_content_length" \
    '{responseValidation:{minContentLength:$minContentLength},maxRetries:0,timeoutMs:$timeoutMs,targetTimeoutMs:$targetTimeoutMs,healthCheckEnabled:true,trackMetrics:true,failoverBeforeRetry:true}'
}

combo_payload() {
  local name="$1"
  local description="$2"
  local system_message="$3"
  local strategy="$4"
  local models="$5"
  local config="$6"
  local judge_model="$7"
  local fusion_tuning="$8"
  jq -nc \
    --arg name "$name" \
    --arg description "$description" \
    --arg systemMessage "$system_message" \
    --arg strategy "$strategy" \
    --argjson models "$models" \
    --argjson config "$config" \
    --arg judgeModel "$judge_model" \
    --argjson fusionTuning "$fusion_tuning" \
    '{
      name:$name,
      description:$description,
      systemMessage:$systemMessage,
      models:$models,
      strategy:$strategy,
      config:($config + (if $judgeModel != "" then {judgeModel:$judgeModel} else {} end) + (if ($fusionTuning|length) > 0 then {fusionTuning:$fusionTuning} else {} end))
    }'
}

fast_models="$(models_json antigravity/gemini-3.5-flash-low antigravity/claude-sonnet-4-6 github/gpt-5.4)"
build_models="$(models_json codex/gpt-5.6-terra github/gpt-5.4 nebius/Qwen/Qwen3-235B-A22B-Instruct-2507)"
reason_models="$(models_json antigravity/claude-opus-4-6-thinking nebius/Qwen/Qwen3-235B-A22B-Instruct-2507 codex/gpt-5.6-terra)"
validate_models="$(models_json github/gpt-5.4 codex/gpt-5.6-terra nebius/Qwen/Qwen3-235B-A22B-Instruct-2507)"
fast_config="$(config_json 60000 30000 1)"
build_config="$(config_json 120000 60000 0)"
reason_config="$(config_json 180000 90000 1)"
validate_config="$(config_json 180000 90000 0)"
fusion_tuning="$(jq -nc '{minPanel:2,stragglerGraceMs:3000,panelHardTimeoutMs:90000}')"

fast_payload="$(combo_payload \
  te-fast \
  'Temperance fast lane: proportionate, low-latency work with concise output and observable failover.' \
  'Temperance fast lane: solve the bounded task directly, preserve user intent, stay concise, and expose uncertainty rather than inventing detail.' \
  priority "$fast_models" "$fast_config" '' '{}')"
build_payload="$(combo_payload \
  te-build \
  'Temperance build lane: tool-capable agency, reversible execution, and inspectable fallback evidence.' \
  'Temperance build lane: use tools when needed, make the smallest reversible change, verify the result, and report the evidence.' \
  priority "$build_models" "$build_config" '' '{}')"
reason_payload="$(combo_payload \
  te-reason \
  'Temperance reasoning lane: deliberate depth, explicit assumptions, and evidence-weighted alternatives.' \
  'Temperance reasoning lane: separate facts from assumptions, compare alternatives, state uncertainty, and prefer explanations that remain valid under changed details.' \
  priority "$reason_models" "$reason_config" '' '{}')"
validate_payload="$(combo_payload \
  te-validate \
  'Temperance validation council: independent perspectives synthesized into one falsifiable answer.' \
  'Temperance validation council: challenge the proposed answer, identify failure modes, reconcile disagreements, and return a concise evidence-backed synthesis.' \
  fusion "$validate_models" "$validate_config" codex/gpt-5.6-terra "$fusion_tuning")"

compatibility_id="$(jq -er '.combos[] | select(.name=="temperance-coding") | .id' <<<"$combos")"
compatibility_payload="$(jq -nc \
  --arg name temperance-coding \
  --arg description 'Temperance Engine compatibility rail: tool-capable execution, observable failover, and reversible policy boundaries.' \
  --arg systemMessage 'Temperance compatibility rail: preserve the frozen plan, use tools when needed, make reversible changes, and leave inspectable evidence.' \
  --argjson models "$build_models" \
  --argjson config "$build_config" \
  '{name:$name,description:$description,systemMessage:$systemMessage,models:$models,strategy:"priority",config:($config | .responseValidation.forbiddenSubstrings=["subscription for thoughtseedlabs@gmail.com is inactive"])}')"

printf 'OmniRoute %s authenticated; backup snapshot: %s\n' "$MODE" "$BACKUP_PATH"
printf 'Current combos: %s\n' "$(jq -r '[.combos[].name] | join(", ")' <<<"$combos")"
printf 'Planned portfolios: te-fast, te-build, te-reason, te-validate\n'
printf 'Global activeCombo before: %s\n' "$active_before"

if [ "$MODE" = "dry-run" ]; then
  printf '\n-- te-fast --\n%s\n' "$fast_payload"
  printf '\n-- te-build --\n%s\n' "$build_payload"
  printf '\n-- te-reason --\n%s\n' "$reason_payload"
  printf '\n-- te-validate --\n%s\n' "$validate_payload"
  printf '\n-- temperance-coding repair --\n%s\n' "$compatibility_payload"
  exit 0
fi

if [ "$MODE" = "rollback" ]; then
  old_combos="$(jq -er '.combos.combos' "$ROLLBACK_PATH")"
  old_compatibility="$(jq -er '.[] | select(.name=="temperance-coding")' <<<"$old_combos")"
  current_combos="$(api_get /api/combos)"
  while IFS= read -r combo_id; do
    [ -n "$combo_id" ] || continue
    api_mutate DELETE "/api/combos/$combo_id" '{}' >/dev/null
    printf 'Rolled back created combo id=%s\n' "$combo_id"
  done < <(jq -r --argjson names "$(jq -er '.plannedNewComboNames' "$ROLLBACK_PATH")" '.combos[] | select(.name as $n | $names | index($n)) | .id' <<<"$current_combos")
  api_mutate PUT "/api/combos/$(jq -er '.id' <<<"$old_compatibility")" "$old_compatibility" >/dev/null
  printf 'Restored temperance-coding from %s\n' "$ROLLBACK_PATH"
  exit 0
fi

for payload in "$fast_payload" "$build_payload" "$reason_payload" "$validate_payload"; do
  response="$(api_mutate POST /api/combos "$payload")"
  printf 'Created %s id=%s\n' "$(jq -r .name <<<"$response")" "$(jq -r .id <<<"$response")"
done

api_mutate PUT "/api/combos/$compatibility_id" "$compatibility_payload" >/dev/null
printf 'Updated temperance-coding compatibility rail id=%s\n' "$compatibility_id"

settings_after="$(api_get /api/settings)"
active_after="$(jq -c '.activeCombo // null' <<<"$settings_after")"
[ "$active_after" = "$active_before" ] || {
  echo "Global activeCombo changed unexpectedly: before=$active_before after=$active_after" >&2
  exit 1
}
printf 'Global activeCombo after: %s (unchanged)\n' "$active_after"
printf 'Mutation complete; use --rollback %s if verification fails.\n' "$BACKUP_PATH"
