#!/usr/bin/env bash
# Snapshot-first lifecycle for the writing fleet: the te-write drafting rail
# and the te-write-critique fusion council. It never changes OmniRoute's
# global activeCombo.
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
  scripts/omniroute-temperance-writer.sh                 # authenticated dry-run
  scripts/omniroute-temperance-writer.sh --apply         # create writing combos
  scripts/omniroute-temperance-writer.sh --rollback FILE # remove created writing combos

Writing combos: te-write (drafting rail), te-write-critique (fusion council).
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

WRITER_NAMES='["te-write","te-write-critique"]'
if [ "$MODE" != "rollback" ]; then
  while IFS= read -r name; do
    if jq -e --arg name "$name" 'any(.combos[]?; .name == $name)' <<<"$combos" >/dev/null; then
      echo "Refusing to overwrite existing combo: $name" >&2
      exit 1
    fi
  done < <(jq -r '.[]' <<<"$WRITER_NAMES")
fi

# The kimi drafting-model ID must match the live catalog spelling; if this
# preflight fails, correct the ID here and in temperance-workflows.json.
for model in \
  command-code/MiniMaxAI/MiniMax-M2.7 \
  nebius/moonshotai/Kimi-K2.6 \
  nebius/Qwen/Qwen3-235B-A22B-Instruct-2507 \
  github/gpt-5.4 \
  codex/gpt-5.6-terra
do
  jq -e --arg model "$model" 'any(.data[]?; .id == $model)' <<<"$catalog" >/dev/null || {
    echo "Required live catalog model is missing: $model" >&2
    exit 1
  }
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PATH="$BACKUP_DIR/omniroute-writer-$STAMP.json"
jq -n --arg baseUrl "$BASE_URL" --arg capturedAt "$STAMP" \
  --argjson settings "$settings" --argjson combos "$combos" --argjson catalog "$catalog" \
  --argjson plannedNames "$WRITER_NAMES" \
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

write_models="$(models_json command-code/MiniMaxAI/MiniMax-M2.7 nebius/moonshotai/Kimi-K2.6 nebius/Qwen/Qwen3-235B-A22B-Instruct-2507)"
critique_models="$(models_json github/gpt-5.4 codex/gpt-5.6-terra nebius/Qwen/Qwen3-235B-A22B-Instruct-2507)"
write_config="$(config_json 240000 120000 1)"
critique_config="$(config_json 180000 90000 1)"
fusion_tuning="$(jq -nc '{minPanel:2,stragglerGraceMs:3000,panelHardTimeoutMs:90000}')"

write_payload="$(combo_payload \
  te-write \
  'Temperance writing rail: sequential long-form drafting for the noesis autoregressive loop with observable failover.' \
  'Temperance writing rail: draft exactly the requested section using the supplied voice DNA, source lattice, and backpropagated corrections; preserve claim provenance; never invent citations; return prose only and never certify your own output.' \
  priority "$write_models" "$write_config" '' '{}')"
critique_payload="$(combo_payload \
  te-write-critique \
  'Temperance writing critique council: independent drift scoring fused into one falsifiable gate verdict.' \
  'Temperance writing critique council: score the submitted section for voice calibration, vocabulary contamination, fractal depth, source lattice integrity, and albedo claim grammar; return numeric scores, the failing gates, and exactly one falsifiable verdict - COMMIT, REGENERATE with specific corrections, or FLAG for manual review; never draft or rewrite content.' \
  fusion "$critique_models" "$critique_config" codex/gpt-5.6-terra "$fusion_tuning")"

printf 'OmniRoute %s authenticated; backup snapshot: %s\n' "$MODE" "$BACKUP_PATH"
printf 'Current combos: %s\n' "$(jq -r '[.combos[].name] | join(", ")' <<<"$combos")"
printf 'Planned writing combos: te-write, te-write-critique\n'
printf 'Global activeCombo before: %s\n' "$active_before"
if [ "$MODE" = "dry-run" ]; then
  printf '\n-- te-write --\n%s\n\n-- te-write-critique --\n%s\n' "$write_payload" "$critique_payload"
  exit 0
fi

if [ "$MODE" = "rollback" ]; then
  current_combos="$(api_get /api/combos)"
  while IFS= read -r combo_id; do
    [ -n "$combo_id" ] || continue
    api_mutate DELETE "/api/combos/$combo_id" '{}' >/dev/null
    printf 'Rolled back writing combo id=%s\n' "$combo_id"
  done < <(jq -r --argjson names "$(jq -er '.plannedNewComboNames' "$ROLLBACK_PATH")" '.combos[] | select(.name as $n | $names | index($n)) | .id' <<<"$current_combos")
  printf 'Rollback complete from %s\n' "$ROLLBACK_PATH"
  exit 0
fi

for item in "$write_payload" "$critique_payload"; do
  response="$(api_mutate POST /api/combos "$item")"
  printf 'Created %s id=%s\n' "$(jq -r .name <<<"$response")" "$(jq -r .id <<<"$response")"
done
active_after="$(jq -c '.activeCombo // null' <<<"$(api_get /api/settings)")"
[ "$active_after" = "$active_before" ] || { echo "Global activeCombo changed unexpectedly" >&2; exit 1; }
printf 'Global activeCombo after: %s (unchanged)\n' "$active_after"
printf 'Mutation complete; use --rollback %s if verification fails.\n' "$BACKUP_PATH"
