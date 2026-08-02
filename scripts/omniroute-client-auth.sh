#!/usr/bin/env bash
set -euo pipefail

# Promote OmniRoute's local /v1 surface from anonymous loopback access to
# mandatory, per-client Bearer auth. Secrets remain in macOS Keychain; receipts
# contain metadata and hashes only.

BASE_URL="${TEMPERANCE_OMNIROUTE_ADMIN_URL:-http://127.0.0.1:20128}"
BASE_URL="${BASE_URL%/}"
USER_NAME="${USER:-$(id -un)}"
ADMIN_SERVICE="${TEMPERANCE_OMNIROUTE_ADMIN_KEYCHAIN_SERVICE:-OmniRoute Temperance Admin}"
CODEX_SERVICE="${TEMPERANCE_OMNIROUTE_KEYCHAIN_SERVICE:-OmniRoute Temperance API Key}"
CLAUDE_SERVICE="${TEMPERANCE_OMNIROUTE_CLAUDE_KEYCHAIN_SERVICE:-OmniRoute Temperance Claude API Key}"
CLAUDE_KEY_NAME="Temperance Claude Native"
RECEIPT_ROOT="${TEMPERANCE_OMNIROUTE_AUTH_RECEIPTS:-$HOME/.temperance_engine/receipts/omniroute-client-auth}"
SECURITY_BIN="${TEMPERANCE_SECURITY_BIN:-/usr/bin/security}"

COOKIE=""
CSRF=""
RESPONSE_BODY=""
RESPONSE_CODE="000"

profiles=(
  antigravity-claude-sonnet-5
  gh-claude-sonnet-5
  no-think-antigravity-claude-sonnet-5
  no-think-gh-claude-sonnet-5
)
models=(
  antigravity/claude-sonnet-5
  gh/claude-sonnet-5
  no-think/antigravity/claude-sonnet-5
  no-think/gh/claude-sonnet-5
)

usage() {
  printf 'usage: %s {status|apply|verify|rollback RECEIPT|restart-rehearsal|revocation-rehearsal}\n' "$0" >&2
  exit 2
}

require_tools() {
  command -v curl >/dev/null || { printf 'curl is required\n' >&2; exit 127; }
  command -v jq >/dev/null || { printf 'jq is required\n' >&2; exit 127; }
  [ -x "$SECURITY_BIN" ] || { printf 'macOS security CLI is required\n' >&2; exit 127; }
}

login_admin() {
  local password payload headers csrf_response
  password="$($SECURITY_BIN find-generic-password -a "$USER_NAME" -s "$ADMIN_SERVICE" -w 2>/dev/null || true)"
  [ -n "$password" ] || { printf 'missing admin Keychain item: %s\n' "$ADMIN_SERVICE" >&2; return 1; }
  payload="$(jq -cn --arg password "$password" '{password:$password}')"
  unset password
  exec 3<<<"$payload"
  headers="$(curl -sS -D - -o /dev/null -H 'content-type: application/json' \
    --data-binary @/dev/fd/3 "$BASE_URL/api/auth/login")"
  exec 3<&-
  unset payload
  COOKIE="$(printf '%s\n' "$headers" | awk 'BEGIN{IGNORECASE=1} /^set-cookie:/ {sub(/^[^:]+:[[:space:]]*/,""); sub(/;.*/,""); print; exit}')"
  [ -n "$COOKIE" ] || { printf 'OmniRoute admin login did not issue a session\n' >&2; return 1; }
  csrf_response="$(printf 'cookie = "%s"\n' "$COOKIE" | \
    curl -sS --config - -w '\n%{http_code}' "$BASE_URL/api/auth/csrf")"
  RESPONSE_CODE="${csrf_response##*$'\n'}"
  RESPONSE_BODY="${csrf_response%$'\n'*}"
  [ "$RESPONSE_CODE" = 200 ] || { printf 'CSRF request failed (HTTP %s)\n' "$RESPONSE_CODE" >&2; return 1; }
  CSRF="$(printf '%s' "$RESPONSE_BODY" | jq -er '.token')"
}

api_get() {
  local response
  response="$(printf 'cookie = "%s"\n' "$COOKIE" | \
    curl -sS --config - -w '\n%{http_code}' "$BASE_URL$1")"
  RESPONSE_CODE="${response##*$'\n'}"
  RESPONSE_BODY="${response%$'\n'*}"
}

api_mutate() {
  local method="$1" path="$2" payload="$3" response
  exec 3<<<"$payload"
  response="$(printf 'cookie = "%s"\nheader = "x-omniroute-csrf: %s"\n' "$COOKIE" "$CSRF" | \
    curl -sS -X "$method" --config - \
    -H 'origin: http://127.0.0.1:20128' \
    -H 'referer: http://127.0.0.1:20128/dashboard' \
    -H 'content-type: application/json' \
    --data-binary @/dev/fd/3 -w '\n%{http_code}' "$BASE_URL$path")"
  exec 3<&-
  RESPONSE_CODE="${response##*$'\n'}"
  RESPONSE_BODY="${response%$'\n'*}"
}

flag_entry() {
  api_get /api/settings/feature-flags
  [ "$RESPONSE_CODE" = 200 ] || return 1
  printf '%s' "$RESPONSE_BODY" | jq -c '.flags[] | select(.key=="REQUIRE_API_KEY")'
}

keys_json() {
  api_get /api/keys
  [ "$RESPONSE_CODE" = 200 ] || return 1
  printf '%s' "$RESPONSE_BODY"
}

claude_key_metadata() {
  keys_json | jq -c --arg name "$CLAUDE_KEY_NAME" '[.keys[] | select(.name==$name)]'
}

profile_metadata() {
  local result='[]' profile path hash mode
  for profile in "${profiles[@]}"; do
    path="$HOME/.claude/profiles/$profile/settings.json"
    [ -r "$path" ] || { printf 'missing Claude profile: %s\n' "$path" >&2; return 1; }
    if grep -Eq 'ANTHROPIC_(AUTH_TOKEN|API_KEY)' "$path"; then
      printf 'persisted auth field found in Claude profile: %s\n' "$path" >&2
      return 1
    fi
    hash="$(shasum -a 256 "$path" | awk '{print $1}')"
    mode="$(stat -f '%Lp' "$path")"
    result="$(printf '%s' "$result" | jq -c --arg profile "$profile" --arg path "$path" --arg hash "$hash" --arg mode "$mode" '. + [{profile:$profile,path:$path,sha256:$hash,mode:$mode}]')"
  done
  printf '%s' "$result"
}

quick_tunnel_stopped() {
  local state="$HOME/.omniroute/cloudflared/quick-tunnel-state.json"
  [ -r "$state" ] && jq -e '.status=="stopped" and .pid==null and ((.url // "")=="")' "$state" >/dev/null
}

listener_addresses_are_loopback() {
  local listeners="$1"
  [ -n "$listeners" ] && ! printf '%s\n' "$listeners" | grep -Ev '^(127\.0\.0\.1|\[::1\]):20128$' >/dev/null
}

loopback_only() {
  local listeners
  listeners="$(lsof -nP -iTCP:20128 -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $9}')"
  listener_addresses_are_loopback "$listeners"
}

keychain_present() {
  "$SECURITY_BIN" find-generic-password -a "$USER_NAME" -s "$1" >/dev/null 2>&1
}

bearer_code() {
  local key="$1" path="$2"
  printf 'header = "Authorization: Bearer %s"\n' "$key" | \
    curl -sS --config - -o /dev/null -w '%{http_code}' --max-time 10 \
      "$BASE_URL$path" || printf '000'
}

catalog_code() {
  bearer_code "$1" /v1/models
}

validate_auth_probe_codes() {
  local anon="$1" invalid="$2" claude="$3" codex="$4" management="$5"
  [ "$anon" = 401 ] && [ "$invalid" = 401 ] && [ "$claude" = 200 ] && [ "$codex" = 200 ] || {
    printf 'FAIL auth probes anonymous=%s invalid=%s claude=%s codex=%s\n' "$anon" "$invalid" "$claude" "$codex" >&2
    return 1
  }
  case "$management" in
    2*) printf 'FAIL inference key authenticated management API\n' >&2; return 1 ;;
  esac
}

validate_claude_key_metadata() {
  local metadata="$1" expected_models
  expected_models="$(printf '%s\n' "${models[@]}" | jq -R . | jq -s .)"
  printf '%s' "$metadata" | jq -e --argjson models "$expected_models" '
    length==1 and .[0].isActive==true and .[0].allowedModels==$models and
    .[0].allowedCombos==[] and .[0].allowedEndpoints==["chat","models"] and
    .[0].rateLimits==[{"limit":60,"window":60}] and .[0].scopes==["self:usage"] and
    .[0].maxSessions==8 and .[0].noLog==true and .[0].usageLimitEnabled==true and
    .[0].dailyUsageLimitUsd==10 and .[0].weeklyUsageLimitUsd==50
  ' >/dev/null || { printf 'FAIL Claude key metadata drift\n' >&2; return 1; }
}

status_report() {
  local flag metadata
  flag="$(flag_entry)"
  metadata="$(claude_key_metadata | jq -c '[.[] | {name,isActive,allowedModels,allowedCombos,allowedEndpoints,rateLimits,scopes,maxSessions,noLog,usageLimitEnabled,dailyUsageLimitUsd,weeklyUsageLimitUsd}]')"
  jq -n \
    --argjson flag "$flag" \
    --argjson claudeKeys "$metadata" \
    --arg claudeKeychain "$(keychain_present "$CLAUDE_SERVICE" && printf present || printf absent)" \
    --arg codexKeychain "$(keychain_present "$CODEX_SERVICE" && printf present || printf absent)" \
    --arg quickTunnel "$(quick_tunnel_stopped && printf stopped || printf unsafe)" \
    --arg listener "$(loopback_only && printf loopback || printf unsafe)" \
    '{requireApiKey:$flag,claudeKeys:$claudeKeys,claudeKeychain:$claudeKeychain,codexKeychain:$codexKeychain,quickTunnel:$quickTunnel,listener:$listener}'
}

create_receipt() {
  local dir="$1" flag="$2" profile_json="$3" keys="$4" config_path config_hash config_state
  mkdir -p "$dir"
  chmod 700 "$dir"
  config_path="$HOME/.omniroute/config.json"
  if [ -r "$config_path" ]; then
    config_hash="$(shasum -a 256 "$config_path" | awk '{print $1}')"
    config_state=present
  else
    config_hash=""
    config_state=absent
  fi
  jq -n \
    --arg schema temperance-omniroute-client-auth-v1 \
    --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg baseUrl "$BASE_URL" \
    --argjson previousFlag "$flag" \
    --argjson profiles "$profile_json" \
    --argjson keys "$keys" \
    --arg configState "$config_state" \
    --arg configHash "$config_hash" \
    '{schema:$schema,createdAt:$createdAt,baseUrl:$baseUrl,previousFlag:$previousFlag,profiles:$profiles,keysBefore:($keys|del(.keys[]?.key,.keys[]?.keyHash)),contextStore:{state:$configState,sha256:$configHash},createdKeyId:null,createdKeyName:null,applied:false,rolledBack:false}' \
    > "$dir/receipt.json"
  chmod 600 "$dir/receipt.json"
}

verify_runtime() {
  local anon invalid claude_key claude valid codex_key codex management metadata flag
  flag="$(flag_entry)"
  [ "$(printf '%s' "$flag" | jq -r '.effectiveValue')" = true ] || { printf 'FAIL REQUIRE_API_KEY is not effective\n' >&2; return 1; }
  anon="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/v1/models")"
  invalid="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer invalid-temperance-canary' "$BASE_URL/v1/models")"
  claude_key="$($SECURITY_BIN find-generic-password -a "$USER_NAME" -s "$CLAUDE_SERVICE" -w 2>/dev/null || true)"
  codex_key="$($SECURITY_BIN find-generic-password -a "$USER_NAME" -s "$CODEX_SERVICE" -w 2>/dev/null || true)"
  [ -n "$claude_key" ] && [ -n "$codex_key" ] || { printf 'FAIL required Keychain items missing\n' >&2; return 1; }
  claude="$(catalog_code "$claude_key")"
  codex="$(catalog_code "$codex_key")"
  management="$(bearer_code "$claude_key" /api/keys)"
  unset claude_key codex_key
  validate_auth_probe_codes "$anon" "$invalid" "$claude" "$codex" "$management"
  metadata="$(claude_key_metadata)"
  validate_claude_key_metadata "$metadata"
  quick_tunnel_stopped || { printf 'FAIL Quick Tunnel is not stopped\n' >&2; return 1; }
  loopback_only || { printf 'FAIL OmniRoute listener is not loopback-only\n' >&2; return 1; }
  printf 'ok - mandatory client auth, both local keys, management denial, Quick Tunnel, and loopback listener verified\n'
}

apply_auth() {
  local flag profile_json keys metadata count new_key key_id patch_payload receipt_dir created=0
  quick_tunnel_stopped || { printf 'refusing apply: Quick Tunnel is not safely stopped\n' >&2; return 1; }
  loopback_only || { printf 'refusing apply: OmniRoute is not loopback-only\n' >&2; return 1; }
  profile_json="$(profile_metadata)"
  flag="$(flag_entry)"
  keys="$(keys_json)"
  receipt_dir="$RECEIPT_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  create_receipt "$receipt_dir" "$flag" "$profile_json" "$keys"

  metadata="$(printf '%s' "$keys" | jq -c --arg name "$CLAUDE_KEY_NAME" '[.keys[] | select(.name==$name)]')"
  count="$(printf '%s' "$metadata" | jq 'length')"
  [ "$count" -le 1 ] || { printf 'refusing apply: duplicate Claude key names\n' >&2; return 1; }

  if [ "$count" -eq 0 ]; then
    [ ! -e "$HOME/.omniroute/config.json" ] || true
    api_mutate POST /api/keys "$(jq -cn --arg name "$CLAUDE_KEY_NAME" '{name:$name,noLog:true,allowUsageCommand:false,scopes:["self:usage"],usageLimitEnabled:true,dailyUsageLimitUsd:10,weeklyUsageLimitUsd:50}')"
    case "$RESPONSE_CODE" in 2*) ;; *) printf 'key creation failed (HTTP %s)\n' "$RESPONSE_CODE" >&2; return 1 ;; esac
    new_key="$(printf '%s' "$RESPONSE_BODY" | jq -er '.key')"
    # With -w as the final option, security reads and confirms the password
    # interactively from stdin. Supply both identical lines; the secret never
    # enters a process argument.
    printf '%s\n%s\n' "$new_key" "$new_key" | "$SECURITY_BIN" add-generic-password -a "$USER_NAME" -s "$CLAUDE_SERVICE" -T "$SECURITY_BIN" -w >/dev/null
    unset new_key
    created=1
    keys="$(keys_json)"
    metadata="$(printf '%s' "$keys" | jq -c --arg name "$CLAUDE_KEY_NAME" '[.keys[] | select(.name==$name)]')"
  else
    keychain_present "$CLAUDE_SERVICE" || { printf 'refusing apply: orphaned API key has no recoverable Keychain secret\n' >&2; return 1; }
  fi

  key_id="$(printf '%s' "$metadata" | jq -er '.[0].id')"
  patch_payload="$(jq -cn --argjson models "$(printf '%s\n' "${models[@]}" | jq -R . | jq -s .)" '{allowedModels:$models,allowedCombos:[],allowedEndpoints:["chat","models"],rateLimits:[{limit:60,window:60}],scopes:["self:usage"],isActive:true,maxSessions:8,noLog:true,autoResolve:false,allowUsageCommand:false,usageLimitEnabled:true,dailyUsageLimitUsd:10,weeklyUsageLimitUsd:50}')"
  api_mutate PATCH "/api/keys/$key_id" "$patch_payload"
  case "$RESPONSE_CODE" in 2*) ;; *) printf 'key restriction failed (HTTP %s); receipt=%s\n' "$RESPONSE_CODE" "$receipt_dir/receipt.json" >&2; return 1 ;; esac

  jq --arg id "$key_id" --arg name "$CLAUDE_KEY_NAME" --argjson created "$created" '.createdKeyId=$id | .createdKeyName=$name | .keyCreatedThisRun=($created==1)' "$receipt_dir/receipt.json" > "$receipt_dir/receipt.next.json"
  mv "$receipt_dir/receipt.next.json" "$receipt_dir/receipt.json"
  chmod 600 "$receipt_dir/receipt.json"

  # Both existing Codex/Spark and new Claude keys must work before anonymous
  # access is disabled. This is the active-worker continuity gate.
  local claude_key codex_key
  claude_key="$($SECURITY_BIN find-generic-password -a "$USER_NAME" -s "$CLAUDE_SERVICE" -w 2>/dev/null)"
  codex_key="$($SECURITY_BIN find-generic-password -a "$USER_NAME" -s "$CODEX_SERVICE" -w 2>/dev/null)"
  [ "$(catalog_code "$claude_key")" = 200 ] && [ "$(catalog_code "$codex_key")" = 200 ] || {
    unset claude_key codex_key
    printf 'pre-auth key canary failed; REQUIRE_API_KEY remains unchanged; receipt=%s\n' "$receipt_dir/receipt.json" >&2
    return 1
  }
  unset claude_key codex_key

  api_mutate PUT /api/settings/feature-flags '{"key":"REQUIRE_API_KEY","value":"true"}'
  case "$RESPONSE_CODE" in 2*) ;; *) printf 'feature-flag promotion failed (HTTP %s)\n' "$RESPONSE_CODE" >&2; return 1 ;; esac

  if ! verify_runtime; then
    api_mutate PUT /api/settings/feature-flags '{"key":"REQUIRE_API_KEY"}' || true
    printf 'auth verification failed; DB override reset; receipt=%s\n' "$receipt_dir/receipt.json" >&2
    return 1
  fi
  jq '.applied=true' "$receipt_dir/receipt.json" > "$receipt_dir/receipt.next.json"
  mv "$receipt_dir/receipt.next.json" "$receipt_dir/receipt.json"
  chmod 600 "$receipt_dir/receipt.json"
  printf 'applied receipt=%s\n' "$receipt_dir/receipt.json"
}

rollback_auth() {
  local receipt="$1" previous_source previous_value key_id created
  [ -r "$receipt" ] || { printf 'receipt not readable: %s\n' "$receipt" >&2; return 1; }
  [ "$(jq -r '.schema' "$receipt")" = temperance-omniroute-client-auth-v1 ] || { printf 'invalid receipt schema\n' >&2; return 1; }
  previous_source="$(jq -r '.previousFlag.source' "$receipt")"
  previous_value="$(jq -r '.previousFlag.configuredValue // empty' "$receipt")"
  if [ "$previous_source" = db ] && [ -n "$previous_value" ]; then
    api_mutate PUT /api/settings/feature-flags "$(jq -cn --arg value "$previous_value" '{key:"REQUIRE_API_KEY",value:$value}')"
  else
    api_mutate PUT /api/settings/feature-flags '{"key":"REQUIRE_API_KEY"}'
  fi
  case "$RESPONSE_CODE" in 2*) ;; *) printf 'feature-flag rollback failed (HTTP %s)\n' "$RESPONSE_CODE" >&2; return 1 ;; esac

  created="$(jq -r '.keyCreatedThisRun // false' "$receipt")"
  key_id="$(jq -r '.createdKeyId // empty' "$receipt")"
  if [ "$created" = true ] && [ -n "$key_id" ]; then
    api_mutate DELETE "/api/keys/$key_id" '{}'
    case "$RESPONSE_CODE" in 2*) ;; *) printf 'created-key rollback failed (HTTP %s)\n' "$RESPONSE_CODE" >&2; return 1 ;; esac
    "$SECURITY_BIN" delete-generic-password -a "$USER_NAME" -s "$CLAUDE_SERVICE" >/dev/null 2>&1 || true
  fi
  jq '.rolledBack=true' "$receipt" > "${receipt%/*}/receipt.rollback.json"
  chmod 600 "${receipt%/*}/receipt.rollback.json"
  printf 'rolled back receipt=%s\n' "${receipt%/*}/receipt.rollback.json"
}

restart_rehearsal() {
  if pgrep -alf 'omniroute-codex|temperance-batch' | grep -v 'pgrep -alf' >/dev/null 2>&1; then
    printf 'refusing restart rehearsal while OmniRoute worker processes are active\n' >&2
    return 1
  fi
  local before after
  before="$(flag_entry)"
  [ "$(printf '%s' "$before" | jq -r '.effectiveValue')" = true ] || { printf 'client auth must be effective before restart rehearsal\n' >&2; return 1; }
  "$(cd "$(dirname "$0")" && pwd)/omniroute-autostart-launchd.sh" install
  login_admin
  after="$(flag_entry)"
  [ "$(printf '%s' "$after" | jq -r '.effectiveValue')" = true ] || { printf 'client auth did not persist restart\n' >&2; return 1; }
  verify_runtime
  printf 'ok - restart persistence rehearsal passed\n'
}

revocation_rehearsal() {
  local name key_id new_key before after payload receipt_dir deleted=false attempts=0 started latency
  name="Temperance Revocation Rehearsal $(date -u +%Y%m%dT%H%M%SZ)-$$"
  api_mutate POST /api/keys "$(jq -cn --arg name "$name" '{name:$name,noLog:true,allowUsageCommand:false,scopes:["self:usage"]}')"
  case "$RESPONSE_CODE" in
    2*) ;;
    *) printf 'throwaway key creation failed (HTTP %s)\n' "$RESPONSE_CODE" >&2; return 1 ;;
  esac
  key_id="$(printf '%s' "$RESPONSE_BODY" | jq -er '.id')"
  new_key="$(printf '%s' "$RESPONSE_BODY" | jq -er '.key')"

  payload="$(jq -cn --arg model "${models[0]}" '{allowedModels:[$model],allowedCombos:[],allowedEndpoints:["models"],rateLimits:[{limit:5,window:60}],scopes:["self:usage"],isActive:true,maxSessions:1,noLog:true,autoResolve:false,allowUsageCommand:false}')"
  api_mutate PATCH "/api/keys/$key_id" "$payload"
  case "$RESPONSE_CODE" in
    2*) ;;
    *)
      api_mutate DELETE "/api/keys/$key_id" '{}' || true
      unset new_key
      printf 'throwaway key restriction failed (HTTP %s)\n' "$RESPONSE_CODE" >&2
      return 1
      ;;
  esac

  before="$(catalog_code "$new_key")"
  if [ "$before" != 200 ]; then
    api_mutate DELETE "/api/keys/$key_id" '{}' || true
    unset new_key
    printf 'throwaway key pre-revocation canary failed (HTTP %s)\n' "$before" >&2
    return 1
  fi

  api_mutate DELETE "/api/keys/$key_id" '{}'
  case "$RESPONSE_CODE" in
    2*) deleted=true ;;
    *)
      unset new_key
      printf 'throwaway key revocation failed (HTTP %s)\n' "$RESPONSE_CODE" >&2
      return 1
      ;;
  esac
  # The data plane keeps an in-process validation cache with a documented
  # one-minute TTL. The management process invalidates its own cache at delete,
  # but the data-plane process may require that TTL to observe revocation.
  started="$(date +%s)"
  for attempts in $(seq 1 75); do
    after="$(catalog_code "$new_key")"
    [ "$after" != 200 ] && break
    sleep 1
  done
  latency="$(( $(date +%s) - started ))"
  unset new_key
  [ "$after" = 401 ] || { printf 'revoked throwaway key returned HTTP %s, expected 401\n' "$after" >&2; return 1; }

  receipt_dir="$RECEIPT_ROOT/revocation-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -p "$receipt_dir"
  chmod 700 "$receipt_dir"
  jq -n \
    --arg schema temperance-omniroute-key-revocation-v1 \
    --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg keyId "$key_id" \
    --arg keyName "$name" \
    --argjson before "$before" \
    --argjson after "$after" \
    --argjson deleted "$deleted" \
    --argjson attempts "$attempts" \
    --argjson latencySeconds "$latency" \
    '{schema:$schema,createdAt:$createdAt,keyId:$keyId,keyName:$keyName,preRevocationHttp:$before,postRevocationHttp:$after,deleted:$deleted,secretPersisted:false,cacheObservationAttempts:$attempts,revocationObservedSeconds:$latencySeconds}' \
    > "$receipt_dir/receipt.json"
  chmod 600 "$receipt_dir/receipt.json"
  printf 'ok - throwaway key revoked and denied; receipt=%s\n' "$receipt_dir/receipt.json"
}

main() {
  require_tools
  local action="${1:-}"
  [ -n "$action" ] || usage
  login_admin

  case "$action" in
    status) status_report ;;
    apply) apply_auth ;;
    verify) verify_runtime ;;
    rollback) [ "$#" -eq 2 ] || usage; rollback_auth "$2" ;;
    restart-rehearsal) restart_rehearsal ;;
    revocation-rehearsal) revocation_rehearsal ;;
    *) usage ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
