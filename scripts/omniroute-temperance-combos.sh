#!/usr/bin/env bash
set -euo pipefail

USER="${USER:-$(id -un)}"
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
providers="$(api_get /api/providers)"
catalog="$(curl -sS -f -H "Authorization: Bearer $INFERENCE_KEY" "$BASE_URL/v1/models")"

active_before="$(jq -c '.activeCombo // null' <<<"$settings")"
if [ "$active_before" != "null" ]; then
  echo "Refusing to proceed: global activeCombo is $active_before, expected null." >&2
  exit 1
fi

new_names_json='["te-fast","te-build","te-reason","te-validate"]'
# Idempotency: existing combos are never refused here. Per-combo actions
# (create / unchanged / differs) are planned after the payloads are built
# below; differs means "report and skip" for te-* and "PUT-repair" for the
# governed temperance-coding rail.

# Catalog preflight: a model missing from the live catalog fails the run,
# unless its provider is currently disabled (isActive:false) -- a disabled
# provider's models legitimately vanish from /v1/models and availability is
# governed by the reconciler, not by this script.
for model in \
  antigravity/gemini-3.5-flash-low \
  antigravity/claude-sonnet-4-6 \
  antigravity/claude-opus-4-6-thinking \
  github/gpt-5.4 \
  codex/gpt-5.6-terra \
  nebius/Qwen/Qwen3-235B-A22B-Instruct-2507
do
  if jq -e --arg model "$model" 'any(.data[]?; .id == $model)' <<<"$catalog" >/dev/null; then
    continue
  fi
  provider="${model%%/*}"
  if jq -e --arg p "$provider" \
    'any(.connections[]?; ((.provider // .name) == $p) and .isActive == false)' <<<"$providers" >/dev/null; then
    echo "Catalog note: $model absent because provider $provider is disabled (isActive:false); continuing." >&2
  else
    echo "Required live catalog model is missing: $model" >&2
    exit 1
  fi
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

# Canonical projection used for idempotent body comparison: server-managed
# fields (id, isHidden, sortOrder, createdAt, updatedAt, version, per-model
# id/kind/providerId/weight) are stripped; key order is normalized.
canon_body() {
  jq -cS '{
    name,
    description: (.description // null),
    systemMessage: (.systemMessage // null),
    strategy,
    models: [.models[].model],
    config
  }'
}

# Prints one of: create | unchanged | differs
combo_action() {
  local name="$1" payload="$2" live
  live="$(jq -c --arg n "$name" '([.combos[] | select(.name == $n)] | .[0]) // empty' <<<"$combos")"
  if [ -z "$live" ]; then
    printf 'create'
    return 0
  fi
  if [ "$(canon_body <<<"$live")" = "$(canon_body <<<"$payload")" ]; then
    printf 'unchanged'
  else
    printf 'differs'
  fi
}

payload_for() {
  case "$1" in
    te-fast) printf '%s' "$fast_payload" ;;
    te-build) printf '%s' "$build_payload" ;;
    te-reason) printf '%s' "$reason_payload" ;;
    te-validate) printf '%s' "$validate_payload" ;;
    temperance-coding) printf '%s' "$compatibility_payload" ;;
  esac
}

action_for() {
  case "$1" in
    te-fast) printf '%s' "$action_te_fast" ;;
    te-build) printf '%s' "$action_te_build" ;;
    te-reason) printf '%s' "$action_te_reason" ;;
    te-validate) printf '%s' "$action_te_validate" ;;
    temperance-coding) printf '%s' "$action_compatibility" ;;
  esac
}

# Governed compatibility rail body: exact last-known body recovered from
# .omniroute-backups/omniroute-writer-expansion-20260723T174830Z.json (the
# original carries no systemMessage field; the governed
# responseValidation.forbiddenSubstrings guard is retained).
compatibility_payload="$(jq -nc \
  --arg name temperance-coding \
  --arg description 'Temperance Engine compatibility rail: tool-capable execution, observable failover, and reversible policy boundaries.' \
  --argjson models "$build_models" \
  --argjson config "$build_config" \
  '{name:$name,description:$description,models:$models,strategy:"priority",config:($config | .responseValidation.forbiddenSubstrings=["subscription for thoughtseedlabs@gmail.com is inactive"])}')"

action_te_fast="$(combo_action te-fast "$fast_payload")"
action_te_build="$(combo_action te-build "$build_payload")"
action_te_reason="$(combo_action te-reason "$reason_payload")"
action_te_validate="$(combo_action te-validate "$validate_payload")"
action_compatibility="$(combo_action temperance-coding "$compatibility_payload")"

printf 'OmniRoute %s authenticated; backup snapshot: %s\n' "$MODE" "$BACKUP_PATH"
printf 'Current combos: %s\n' "$(jq -r '[.combos[].name] | join(", ")' <<<"$combos")"
printf 'Plan: te-fast=%s te-build=%s te-reason=%s te-validate=%s temperance-coding=%s\n' \
  "$action_te_fast" "$action_te_build" "$action_te_reason" "$action_te_validate" "$action_compatibility"
printf 'Global activeCombo before: %s\n' "$active_before"

if [ "$MODE" = "dry-run" ]; then
  printf '\n-- te-fast (%s) --\n%s\n' "$action_te_fast" "$fast_payload"
  printf '\n-- te-build (%s) --\n%s\n' "$action_te_build" "$build_payload"
  printf '\n-- te-reason (%s) --\n%s\n' "$action_te_reason" "$reason_payload"
  printf '\n-- te-validate (%s) --\n%s\n' "$action_te_validate" "$validate_payload"
  printf '\n-- temperance-coding (%s; governed repair target) --\n%s\n' "$action_compatibility" "$compatibility_payload"
  exit 0
fi

if [ "$MODE" = "rollback" ]; then
  old_combos="$(jq -er '.combos.combos' "$ROLLBACK_PATH")"
  old_compatibility="$(jq -c '([.[] | select(.name=="temperance-coding")] | .[0]) // empty' <<<"$old_combos")"
  current_combos="$(api_get /api/combos)"
  # Delete only planned combos that were ABSENT in the snapshot (i.e. the
  # ones the apply actually created); pre-existing ones are left untouched.
  while IFS= read -r combo_id; do
    [ -n "$combo_id" ] || continue
    api_mutate DELETE "/api/combos/$combo_id" '{}' >/dev/null
    printf 'Rolled back created combo id=%s\n' "$combo_id"
  done < <(jq -r \
    --argjson names "$(jq -er '.plannedNewComboNames' "$ROLLBACK_PATH")" \
    --argjson existing "$(jq -c '[.[].name]' <<<"$old_combos")" \
    '.combos[] | select(.name as $n | (($names | index($n)) != null) and (($existing | index($n)) == null)) | .id' \
    <<<"$current_combos")
  live_compatibility_id="$(jq -r '([.combos[] | select(.name=="temperance-coding")] | .[0].id) // empty' <<<"$current_combos")"
  if [ -n "$old_compatibility" ]; then
    if [ -n "$live_compatibility_id" ]; then
      api_mutate PUT "/api/combos/$live_compatibility_id" \
        "$(jq -c --arg id "$live_compatibility_id" '.id = $id' <<<"$old_compatibility")" >/dev/null
      printf 'Restored temperance-coding id=%s from %s\n' "$live_compatibility_id" "$ROLLBACK_PATH"
    else
      api_mutate POST /api/combos \
        "$(jq -c 'del(.id,.createdAt,.updatedAt,.version,.isHidden,.sortOrder)' <<<"$old_compatibility")" >/dev/null
      printf 'Recreated temperance-coding from %s\n' "$ROLLBACK_PATH"
    fi
  elif [ -n "$live_compatibility_id" ]; then
    api_mutate DELETE "/api/combos/$live_compatibility_id" '{}' >/dev/null
    printf 'Deleted temperance-coding id=%s (absent in snapshot %s)\n' "$live_compatibility_id" "$ROLLBACK_PATH"
  fi
  exit 0
fi

collisions=0
for name in te-fast te-build te-reason te-validate temperance-coding; do
  payload="$(payload_for "$name")"
  action="$(action_for "$name")"
  case "$action" in
    create)
      response="$(api_mutate POST /api/combos "$payload")"
      printf 'Created %s id=%s\n' "$(jq -r .name <<<"$response")" "$(jq -r .id <<<"$response")"
      ;;
    unchanged)
      printf 'Present unchanged: %s (skipped)\n' "$name"
      ;;
    differs)
      if [ "$name" = "temperance-coding" ]; then
        live_compatibility_id="$(jq -r '([.combos[] | select(.name=="temperance-coding")] | .[0].id) // empty' <<<"$combos")"
        api_mutate PUT "/api/combos/$live_compatibility_id" "$payload" >/dev/null
        printf 'Repaired temperance-coding compatibility rail id=%s (PUT to governed body)\n' "$live_compatibility_id"
      else
        printf 'COLLISION: %s exists with a different body; reported and skipped (not overwritten).\n' "$name" >&2
        collisions=$((collisions + 1))
      fi
      ;;
  esac
done
if [ "$collisions" -gt 0 ]; then
  printf '%s existing combo(s) differ from the script base body and were left untouched (reconciler-managed live state).\n' "$collisions" >&2
fi

settings_after="$(api_get /api/settings)"
active_after="$(jq -c '.activeCombo // null' <<<"$settings_after")"
[ "$active_after" = "$active_before" ] || {
  echo "Global activeCombo changed unexpectedly: before=$active_before after=$active_after" >&2
  exit 1
}
printf 'Global activeCombo after: %s (unchanged)\n' "$active_after"
printf 'Mutation complete; use --rollback %s if verification fails.\n' "$BACKUP_PATH"
