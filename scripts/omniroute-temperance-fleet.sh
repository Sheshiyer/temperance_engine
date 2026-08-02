#!/usr/bin/env bash
# Snapshot-first lifecycle for the Algorithm, planner, dispatch, and creative
# workflow combos. It never changes OmniRoute's global activeCombo.
set -euo pipefail

BASE_URL="${TEMPERANCE_OMNIROUTE_ADMIN_URL:-http://127.0.0.1:20128}"
BASE_URL="${BASE_URL%/}"
ADMIN_ORIGIN="${TEMPERANCE_OMNIROUTE_ADMIN_ORIGIN:-$BASE_URL}"
BACKUP_DIR="${TEMPERANCE_OMNIROUTE_BACKUP_DIR:-$PWD/.omniroute-backups}"
ADMIN_SERVICE="OmniRoute Temperance Admin"
API_KEY_SERVICE="OmniRoute Temperance API Key"
KEYCHAIN_ACCOUNT="${TEMPERANCE_OMNIROUTE_KEYCHAIN_ACCOUNT:-${USER:-$(id -un)}}"
ROLLOUT_ID="${TEMPERANCE_ROLLOUT_ID:-}"
MODE="dry-run"
ROLLBACK_PATH=""

usage() {
  cat <<'USAGE'
Usage:
  scripts/omniroute-temperance-fleet.sh                 # authenticated dry-run
  scripts/omniroute-temperance-fleet.sh --apply         # create/update role combos
  scripts/omniroute-temperance-fleet.sh --rollback FILE # restore snapshot bodies

Role combos: te-algorithm, te-plan, te-dispatch, te-creative.
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
case "$ROLLOUT_ID" in
  ""|*[!A-Za-z0-9._-]*) [ -z "$ROLLOUT_ID" ] || { echo "invalid TEMPERANCE_ROLLOUT_ID" >&2; exit 2; } ;;
esac
REMOTE_ADMIN_PASSWORD="${TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD:-}"
REMOTE_INFERENCE_KEY="${OMNIROUTE_API_KEY:-}"
unset TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD OMNIROUTE_API_KEY
if [ -z "$REMOTE_ADMIN_PASSWORD" ] \
    || { [ "$MODE" != "rollback" ] && [ -z "$REMOTE_INFERENCE_KEY" ]; }; then
  command -v security >/dev/null || {
    echo "set remote OmniRoute credentials or install the macOS security CLI" >&2
    exit 1
  }
fi
umask 077
mkdir -p "$BACKUP_DIR"
[ "$MODE" != "rollback" ] || [ -f "$ROLLBACK_PATH" ] || { echo "rollback snapshot not found: $ROLLBACK_PATH" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
ADMIN_PASSWORD="$REMOTE_ADMIN_PASSWORD"
unset REMOTE_ADMIN_PASSWORD
if [ -z "$ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD="$(security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$ADMIN_SERVICE" -w)"
fi
LOGIN_PAYLOAD="$TMP_DIR/login.payload.json"
printf '%s' "$ADMIN_PASSWORD" | jq -Rs '{password:.}' >"$LOGIN_PAYLOAD"
unset ADMIN_PASSWORD
login_http="$(curl -sS -o "$TMP_DIR/login.json" -w '%{http_code}' -c "$TMP_DIR/cookie" \
  -H 'content-type: application/json' \
  --data-binary "@$LOGIN_PAYLOAD" \
  "$BASE_URL/api/auth/login")"
rm -f "$LOGIN_PAYLOAD"
case "$login_http" in 2*) ;; *) echo "OmniRoute admin login failed (HTTP $login_http)" >&2; exit 1 ;; esac
CSRF="$(curl -sS -f -b "$TMP_DIR/cookie" "$BASE_URL/api/auth/csrf" | jq -er '.token')"

api_get() { curl -sS -f -b "$TMP_DIR/cookie" "$BASE_URL$1"; }
api_mutate() {
  local method="$1" path="$2" payload="$3" response="$TMP_DIR/mutate.json" http
  http="$(curl -sS -o "$response" -w '%{http_code}' -X "$method" -b "$TMP_DIR/cookie" \
    -H "origin: $ADMIN_ORIGIN" -H "referer: $ADMIN_ORIGIN/dashboard" \
    -H 'content-type: application/json' -H "x-csrf-token: $CSRF" -d "$payload" "$BASE_URL$path")"
  case "$http" in 2*) cat "$response" ;; *) echo "OmniRoute mutation failed: $method $path (HTTP $http)" >&2; cat "$response" >&2; return 1 ;; esac
}

settings="$(api_get /api/settings)"
combos="$(api_get /api/combos)"
active_before="$(jq -c '.activeCombo // null' <<<"$settings")"
ROLE_NAMES='["te-algorithm","te-plan","te-dispatch","te-creative"]'

models2() { jq -nc --arg a "$1" --arg b "$2" '[{model:$a},{model:$b}]'; }
models3() { jq -nc --arg a "$1" --arg b "$2" --arg c "$3" '[{model:$a},{model:$b},{model:$c}]'; }
models5() { jq -nc --arg a "$1" --arg b "$2" --arg c "$3" --arg d "$4" --arg e "$5" '[{model:$a},{model:$b},{model:$c},{model:$d},{model:$e}]'; }
config() {
  jq -nc --argjson timeoutMs "$1" --argjson targetTimeoutMs "$2" \
    '{responseValidation:{minContentLength:0},maxRetries:0,timeoutMs:$timeoutMs,targetTimeoutMs:$targetTimeoutMs,healthCheckEnabled:true,trackMetrics:true,failoverBeforeRetry:true}'
}
dispatch_config() {
  # OmniRoute 3.8.x does not round-trip queueDepth. The caller bounds the
  # submission queue; the combo persists per-model concurrency and wait time.
  jq -nc \
    '{responseValidation:{minContentLength:0},maxRetries:0,timeoutMs:120000,targetTimeoutMs:60000,healthCheckEnabled:true,trackMetrics:true,failoverBeforeRetry:true,concurrencyPerModel:2,queueTimeoutMs:15000,stickyRoundRobinLimit:1}'
}
payload() {
  # OmniRoute 3.8.x silently drops systemMessage from combo persistence.
  # Keep the workflow instruction in the OpenCode agent prompt and only
  # compare fields the router can round-trip authoritatively here.
  jq -nc --arg name "$1" --arg description "$2" --arg systemMessage "$3" --arg strategy "$4" \
    --argjson models "$5" --argjson config "$6" \
    '{name:$name,description:$description,models:$models,strategy:$strategy,config:$config}'
}

algorithm_payload="$(payload te-algorithm \
  'Temperance Algorithm coordinator: S-tier planning, orchestration, complex judgment, and tool-capable building without silent capability downgrade.' \
  'Temperance Algorithm coordinator: own the session plan and acceptance ledger, delegate bounded worker slices, keep S-tier judgment in the coordinator, and never silently retry at a lower capability tier.' \
  priority "$(models2 codex/gpt-5.6-sol-max antigravity/claude-opus-4-6-thinking)" "$(config 240000 120000)")"
plan_payload="$(payload te-plan \
  'Temperance planning rail: GitHub-first orchestration with Codex escalation and quota-conscious backbone fallback.' \
  'Temperance planner: freeze the task graph, acceptance criteria, and worker handoff; do not mutate the workspace or invent a second classifier.' \
  priority "$(models3 github/gpt-5.4 codex/gpt-5.6-sol-max nebius/Qwen/Qwen3-235B-A22B-Instruct-2507)" "$(config 180000 90000)")"
dispatch_payload="$(payload te-dispatch \
  'Temperance dispatch fleet: round-robin independent work across Codex Spark, Command Code, Kimi, Grok Build, and Nebius with bounded capacity and observable fallback.' \
  'Temperance dispatch worker: execute only the assigned slice, preserve evidence, and return a compact artifact pointer for orchestration.' \
  round-robin "$(models5 codex/gpt-5.3-codex-spark command-code/deepseek/deepseek-v4-flash command-code/moonshotai/Kimi-K2.7-Code grok-cli/grok-build nebius/Qwen/Qwen3-235B-A22B-Instruct-2507)" "$(dispatch_config)")"
creative_payload="$(payload te-creative \
  'Temperance creative planning rail: context-rich briefs handed to native ElevenLabs and RunwayML media contracts.' \
  'Temperance creative planner: resolve the taste/design skill, inject ISA pointers, specify the native media payload, and define artifact acceptance criteria.' \
  priority "$(models3 github/gpt-5.4 codex/gpt-5.6-sol-max nebius/Qwen/Qwen3-235B-A22B-Instruct-2507)" "$(config 180000 90000)")"

payload_for() {
  case "$1" in
    te-algorithm) printf '%s' "$algorithm_payload" ;;
    te-plan) printf '%s' "$plan_payload" ;;
    te-dispatch) printf '%s' "$dispatch_payload" ;;
    te-creative) printf '%s' "$creative_payload" ;;
    *) return 1 ;;
  esac
}

combo_by_name() {
  jq -c --arg name "$2" '[.combos[]? | select(.name == $name)][0] // null' <<<"$1"
}

combo_by_id() {
  jq -c --arg id "$2" '[.combos[]? | select(.id == $id)][0] // null' <<<"$1"
}

combo_matches() {
  local current="$1" desired="$2"
  [ "$(jq -nr --argjson current "$current" --argjson desired "$desired" '
      def project($actual; $template):
        if ($template | type) == "object" then
          reduce ($template | keys[]) as $key
            ({}; .[$key] = project($actual[$key]; $template[$key]))
        elif ($template | type) == "array" then
          if (($actual | type) == "array"
              and ($actual | length) == ($template | length)) then
            [range(0; $template | length) as $index
              | project($actual[$index]; $template[$index])]
          else $actual end
        else $actual end;
      project($current; $desired) == $desired
    ')" = "true" ]
}

created_combo_id() {
  local before="$1" after="$2" name="$3" desired="$4"
  local before_ids candidate candidate_id found="" count=0
  before_ids="$(jq -c '[.combos[]?.id]' <<<"$before")"
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    if combo_matches "$candidate" "$desired"; then
      candidate_id="$(jq -er '.id' <<<"$candidate")" || continue
      found="$candidate_id"
      count=$((count + 1))
    fi
  done < <(jq -c --arg name "$name" --argjson beforeIds "$before_ids" '
    .combos[]?
    | select(.name == $name)
    | select(.id as $id | ($beforeIds | index($id) | not))
  ' <<<"$after")
  [ "$count" -eq 1 ] || return 1
  printf '%s' "$found"
}

combo_action() {
  local name="$1" desired="$2" current
  current="$(combo_by_name "$combos" "$name")"
  if [ "$current" = "null" ]; then
    printf 'create'
    return
  fi
  combo_matches "$current" "$desired" && printf 'unchanged' || printf 'update'
}

action_te_algorithm="$(combo_action te-algorithm "$algorithm_payload")"
action_te_plan="$(combo_action te-plan "$plan_payload")"
action_te_dispatch="$(combo_action te-dispatch "$dispatch_payload")"
action_te_creative="$(combo_action te-creative "$creative_payload")"
action_for() {
  case "$1" in
    te-algorithm) printf '%s' "$action_te_algorithm" ;;
    te-plan) printf '%s' "$action_te_plan" ;;
    te-dispatch) printf '%s' "$action_te_dispatch" ;;
    te-creative) printf '%s' "$action_te_creative" ;;
    *) return 1 ;;
  esac
}

if [ "$MODE" = "rollback" ]; then
  [ "$(jq -er '.schemaVersion' "$ROLLBACK_PATH")" = "3" ] || {
    echo "rollback requires a schemaVersion 3 identity-safe snapshot" >&2
    exit 1
  }
  snapshot_base="$(jq -er '.baseUrl' "$ROLLBACK_PATH")"
  [ "${snapshot_base%/}" = "$BASE_URL" ] || {
    echo "rollback snapshot belongs to a different OmniRoute base URL" >&2
    exit 1
  }
  old_combos="$(jq -cer '.combos' "$ROLLBACK_PATH")"
  snapshot_names="$(jq -cer '.plannedComboNames' "$ROLLBACK_PATH")"
  jq -e --argjson expected "$ROLE_NAMES" \
    'sort == ($expected | sort)' <<<"$snapshot_names" >/dev/null || {
      echo "rollback snapshot has an unexpected governed combo set" >&2
      exit 1
    }
  current_combos="$combos"

  # Preflight the complete rollback before mutating anything. Only mutations
  # recorded as successfully applied by this exact snapshot are eligible:
  # - unchanged actions are never touched;
  # - creates are deleted by recorded id, never by reused name;
  # - updates are restored only while the live id/body still matches what this
  #   apply wrote. Operator changes therefore fail closed without a partial
  #   rollback.
  rollback_safe=true
  while IFS= read -r name; do
    action="$(jq -er --arg name "$name" '.plannedActions[$name]' "$ROLLBACK_PATH")"
    applied_id="$(jq -r --arg name "$name" '.appliedComboIds[$name] // empty' "$ROLLBACK_PATH")"
    [ "$action" = "unchanged" ] && continue
    [ -n "$applied_id" ] || continue
    current="$(combo_by_id "$current_combos" "$applied_id")"
    desired="$(jq -cer --arg name "$name" '.plannedPayloads[$name]' "$ROLLBACK_PATH")"
    case "$action" in
      create)
        if [ "$current" != "null" ] && ! combo_matches "$current" "$desired"; then
          echo "Refusing rollback: created combo id=$applied_id changed after apply" >&2
          rollback_safe=false
        fi
        ;;
      update)
        old="$(combo_by_id "$old_combos" "$applied_id")"
        if [ "$old" = "null" ] || [ "$current" = "null" ] \
            || ! combo_matches "$current" "$desired"; then
          echo "Refusing rollback: updated combo id=$applied_id no longer matches this apply" >&2
          rollback_safe=false
        fi
        ;;
      *)
        echo "Refusing rollback: unexpected action '$action' for $name" >&2
        rollback_safe=false
        ;;
    esac
  done < <(jq -r '.[]' <<<"$snapshot_names")
  $rollback_safe || exit 1

  while IFS= read -r name; do
    action="$(jq -er --arg name "$name" '.plannedActions[$name]' "$ROLLBACK_PATH")"
    applied_id="$(jq -r --arg name "$name" '.appliedComboIds[$name] // empty' "$ROLLBACK_PATH")"
    [ -n "$applied_id" ] || continue
    case "$action" in
      create)
        current="$(combo_by_id "$current_combos" "$applied_id")"
        if [ "$current" != "null" ]; then
          api_mutate DELETE "/api/combos/$applied_id" '{}' >/dev/null
          printf 'Rolled back created role combo %s id=%s\n' "$name" "$applied_id"
        fi
        ;;
      update)
        old="$(combo_by_id "$old_combos" "$applied_id")"
        api_mutate PUT "/api/combos/$applied_id" "$old" >/dev/null
        printf 'Restored role combo %s id=%s from snapshot\n' "$name" "$applied_id"
        ;;
      unchanged) ;;
    esac
  done < <(jq -r '.[]' <<<"$snapshot_names")
  active_after="$(jq -c '.activeCombo // null' <<<"$(api_get /api/settings)")"
  [ "$active_after" = "$active_before" ] || { echo "Global activeCombo changed during rollback" >&2; exit 1; }
  printf 'Rollback complete from %s; activeCombo=%s (unchanged)\n' "$ROLLBACK_PATH" "$active_after"
  exit 0
fi

INFERENCE_KEY="$REMOTE_INFERENCE_KEY"
unset REMOTE_INFERENCE_KEY
if [ -z "$INFERENCE_KEY" ]; then
  INFERENCE_KEY="$(security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$API_KEY_SERVICE" -w)"
fi
INFERENCE_HEADERS="$TMP_DIR/inference.headers"
printf 'Authorization: Bearer %s\n' "$INFERENCE_KEY" >"$INFERENCE_HEADERS"
unset INFERENCE_KEY
catalog="$(curl -sS -f -H "@$INFERENCE_HEADERS" "$BASE_URL/v1/models")"
rm -f "$INFERENCE_HEADERS"
for model in \
  antigravity/claude-opus-4-6-thinking \
  github/gpt-5.4 \
  codex/gpt-5.6-sol-max \
  codex/gpt-5.3-codex-spark \
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

CAPTURED_AT="$(date -u +%Y%m%dT%H%M%SZ)"
# Separate invocations can occur within one second (apply followed by verify or
# another dry-run). Include the process id so a later snapshot cannot overwrite
# the rollback source for an earlier mutation.
rollout_prefix=""
[ -z "$ROLLOUT_ID" ] || rollout_prefix="$ROLLOUT_ID-"
BACKUP_PATH="$BACKUP_DIR/omniroute-fleet-$rollout_prefix$CAPTURED_AT-$$.json"
actions_json="$(jq -nc \
  --arg algorithm "$action_te_algorithm" \
  --arg plan "$action_te_plan" \
  --arg dispatch "$action_te_dispatch" \
  --arg creative "$action_te_creative" \
  '{"te-algorithm":$algorithm,"te-plan":$plan,"te-dispatch":$dispatch,"te-creative":$creative}')"
payloads_json="$(jq -nc \
  --argjson algorithm "$algorithm_payload" \
  --argjson plan "$plan_payload" \
  --argjson dispatch "$dispatch_payload" \
  --argjson creative "$creative_payload" \
  '{"te-algorithm":$algorithm,"te-plan":$plan,"te-dispatch":$dispatch,"te-creative":$creative}')"
if ! (
  set -o noclobber
  jq -n --arg baseUrl "$BASE_URL" --arg capturedAt "$CAPTURED_AT" --arg rolloutId "$ROLLOUT_ID" \
    --argjson settings "$settings" --argjson combos "$combos" --argjson catalog "$catalog" \
    --argjson plannedNames "$ROLE_NAMES" --argjson plannedActions "$actions_json" \
    --argjson plannedPayloads "$payloads_json" \
    '{schemaVersion:3,rolloutId:$rolloutId,baseUrl:$baseUrl,capturedAt:$capturedAt,settings:$settings,combos:$combos,catalog:$catalog,plannedComboNames:$plannedNames,plannedActions:$plannedActions,plannedPayloads:$plannedPayloads,appliedComboIds:{}}' \
    > "$BACKUP_PATH"
); then
  echo "Refusing to overwrite existing fleet snapshot: $BACKUP_PATH" >&2
  exit 1
fi

record_applied_id() {
  local name="$1" id="$2" next
  next="$(mktemp "$BACKUP_DIR/.omniroute-fleet-update.XXXXXX")"
  if jq --arg name "$name" --arg id "$id" \
      '.appliedComboIds[$name] = $id' "$BACKUP_PATH" >"$next"; then
    chmod 600 "$next"
    mv -f "$next" "$BACKUP_PATH"
  else
    rm -f "$next"
    return 1
  fi
}

printf 'OmniRoute %s authenticated; backup snapshot: %s\n' "$MODE" "$BACKUP_PATH"
printf 'Global activeCombo before: %s\n' "$active_before"
printf 'Plan: te-algorithm=%s te-plan=%s te-dispatch=%s te-creative=%s\n' \
  "$action_te_algorithm" "$action_te_plan" "$action_te_dispatch" "$action_te_creative"
if [ "$MODE" = "dry-run" ]; then
  printf '\n-- te-algorithm (%s) --\n%s\n\n-- te-plan (%s) --\n%s\n\n-- te-dispatch (%s) --\n%s\n\n-- te-creative (%s) --\n%s\n' \
    "$action_te_algorithm" "$algorithm_payload" \
    "$action_te_plan" "$plan_payload" \
    "$action_te_dispatch" "$dispatch_payload" \
    "$action_te_creative" "$creative_payload"
  exit 0
fi

for name in te-algorithm te-plan te-dispatch te-creative; do
  item="$(payload_for "$name")"
  case "$(action_for "$name")" in
    create)
      response="$(api_mutate POST /api/combos "$item")"
      response_id="$(jq -r '.id // .combo.id // empty' <<<"$response" 2>/dev/null || true)"
      after_create=""
      combo_id=""
      for _readback_delay in 0 0.2 0.5 1 2; do
        [ "$_readback_delay" = 0 ] || sleep "$_readback_delay"
        after_create="$(api_get /api/combos 2>/dev/null || true)"
        [ -n "$after_create" ] || continue
        combo_id="$(created_combo_id "$combos" "$after_create" "$name" "$item" || true)"
        [ -z "$combo_id" ] || break
      done
      if [ -z "$combo_id" ]; then
        readback_candidate="null"
        [ -z "$after_create" ] \
          || readback_candidate="$(combo_by_name "$after_create" "$name")"
        if [ -n "$response_id" ]; then
          api_mutate DELETE "/api/combos/$response_id" '{}' >/dev/null || true
        fi
        printf 'Mutation response: %s\n' \
          "$(jq -c '{id,name,success,error,message}' <<<"$response" 2>/dev/null || printf '{"error":"non-json response"}')" >&2
        printf 'Readback candidate: %s\n' "$readback_candidate" >&2
        echo "Failed to identify created combo after successful mutation; reconcile against snapshot $BACKUP_PATH" >&2
        exit 1
      fi
      if ! record_applied_id "$name" "$combo_id"; then
        api_mutate DELETE "/api/combos/$combo_id" '{}' >/dev/null || true
        echo "Failed to record created combo identity; creation was reverted" >&2
        exit 1
      fi
      printf 'Created %s id=%s\n' "$name" "$combo_id"
      ;;
    update)
      existing="$(combo_by_name "$combos" "$name")"
      combo_id="$(jq -er '.id' <<<"$existing")"
      response="$(api_mutate PUT "/api/combos/$combo_id" "$item")"
      after_update=""
      current_after_update="null"
      for _readback_delay in 0 0.2 0.5 1 2; do
        [ "$_readback_delay" = 0 ] || sleep "$_readback_delay"
        after_update="$(api_get /api/combos 2>/dev/null || true)"
        [ -n "$after_update" ] || continue
        current_after_update="$(combo_by_id "$after_update" "$combo_id")"
        combo_matches "$current_after_update" "$item" && break
      done
      if [ "$current_after_update" = "null" ] \
          || ! combo_matches "$current_after_update" "$item"; then
        api_mutate PUT "/api/combos/$combo_id" "$existing" >/dev/null || true
        printf 'Desired persisted body: %s\n' "$item" >&2
        printf 'Readback candidate: %s\n' "$current_after_update" >&2
        echo "Updated combo failed authoritative readback; update was reverted" >&2
        exit 1
      fi
      if ! record_applied_id "$name" "$combo_id"; then
        api_mutate PUT "/api/combos/$combo_id" "$existing" >/dev/null || true
        echo "Failed to record updated combo identity; update was reverted" >&2
        exit 1
      fi
      printf 'Updated %s id=%s\n' "$name" "$combo_id"
      ;;
    unchanged)
      printf 'Unchanged %s\n' "$name"
      ;;
  esac
done
active_after="$(jq -c '.activeCombo // null' <<<"$(api_get /api/settings)")"
[ "$active_after" = "$active_before" ] || { echo "Global activeCombo changed unexpectedly" >&2; exit 1; }
printf 'Global activeCombo after: %s (unchanged)\n' "$active_after"
printf 'Mutation complete; use --rollback %s if verification fails.\n' "$BACKUP_PATH"
