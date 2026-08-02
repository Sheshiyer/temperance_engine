#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AUTH_SCRIPT="$ROOT_DIR/scripts/omniroute-client-auth.sh"
TEST_DIR="$(mktemp -d)"
MOCK_SECURITY="$TEST_DIR/security"
MOCK_CURL="$TEST_DIR/curl"
CANARY='test-private-credential-canary-9631'
status=0

pass() { printf 'ok - %s\n' "$1"; }
fail() { printf 'FAIL - %s\n' "$1"; status=1; }

mkdir -p "$TEST_DIR/home/.claude/profiles" "$TEST_DIR/bin" "$TEST_DIR/receipts"
for profile in antigravity-claude-sonnet-5 gh-claude-sonnet-5 no-think-antigravity-claude-sonnet-5 no-think-gh-claude-sonnet-5; do
  mkdir -p "$TEST_DIR/home/.claude/profiles/$profile"
  printf '{"env":{"TEMPERANCE_TEST":"1"}}\n' > "$TEST_DIR/home/.claude/profiles/$profile/settings.json"
done

printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
  'case " $* " in' \
  '  *" find-generic-password "*) printf "%s\n" "${MOCK_SECURITY_VALUE:-mock-client-key}" ;;' \
  '  *" add-generic-password "*) cat >/dev/null ;;' \
  '  *" delete-generic-password "*) exit 0 ;;' \
  '  *) exit 0 ;;' \
  'esac' > "$MOCK_SECURITY"

printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
  'printf "%s\n" "$*" >> "$MOCK_CAPTURE_DIR/curl.argv"' \
  'stdin_file="$MOCK_CAPTURE_DIR/curl.stdin.$$"' \
  'cat > "$stdin_file" || true' \
  'if [ -r /dev/fd/3 ]; then cat /dev/fd/3 >> "$MOCK_CAPTURE_DIR/curl.fd3" || true; fi' \
  'case " $* " in' \
  '  *"/api/auth/login"*) printf "HTTP/1.1 200 OK\r\nset-cookie: session=mock-session; Path=/\r\n\r\n" ;;' \
  '  *"/api/auth/csrf"*) printf "{\"token\":\"mock-csrf\"}\n200" ;;' \
  '  *) printf 200 ;;' \
  'esac' > "$MOCK_CURL"
chmod 700 "$MOCK_SECURITY" "$MOCK_CURL"
ln -s "$MOCK_CURL" "$TEST_DIR/bin/curl"

export HOME="$TEST_DIR/home"
export USER=tester
export TEMPERANCE_SECURITY_BIN="$MOCK_SECURITY"
export TEMPERANCE_OMNIROUTE_AUTH_RECEIPTS="$TEST_DIR/receipts"
export MOCK_CAPTURE_DIR="$TEST_DIR"
export PATH="$TEST_DIR/bin:$PATH"

# shellcheck source=../scripts/omniroute-client-auth.sh
. "$AUTH_SCRIPT"

bearer_code "$CANARY" /v1/models >/dev/null
if grep -Fq "$CANARY" "$TEST_DIR/curl.argv"; then
  fail 'Bearer key stays out of curl process arguments'
else
  pass 'Bearer key stays out of curl process arguments'
fi
grep -Fq "$CANARY" "$TEST_DIR"/curl.stdin.* && pass 'Bearer key reaches curl through private config stdin' || fail 'Bearer key reaches curl through private config stdin'

: > "$TEST_DIR/curl.argv"
rm -f "$TEST_DIR"/curl.stdin.* "$TEST_DIR/curl.fd3"
MOCK_SECURITY_VALUE="$CANARY" login_admin
if grep -Fq "$CANARY" "$TEST_DIR/curl.argv"; then
  fail 'admin password stays out of curl process arguments'
else
  pass 'admin password stays out of curl process arguments'
fi
grep -Fq "$CANARY" "$TEST_DIR/curl.fd3" && pass 'admin password reaches login through private payload descriptor' || fail 'admin password reaches login through private payload descriptor'

KEY_CREATED=0
PATCH_CAPTURE="$TEST_DIR/key-patch.json"
flag_entry() { printf '%s\n' '{"key":"REQUIRE_API_KEY","configuredValue":null,"effectiveValue":false,"source":"default"}'; }
keys_json() {
  if [ "$KEY_CREATED" = 1 ]; then
    printf '%s\n' '{"keys":[{"id":"mock-claude-id","name":"Temperance Claude Native"}]}'
  else
    printf '%s\n' '{"keys":[]}'
  fi
}
api_mutate() {
  local method="$1" path="$2" payload="$3"
  RESPONSE_CODE=200
  RESPONSE_BODY='{}'
  case "$method $path" in
    'POST /api/keys') KEY_CREATED=1; RESPONSE_CODE=201; RESPONSE_BODY='{"id":"mock-claude-id","key":"mock-created-key"}' ;;
    'PATCH /api/keys/mock-claude-id') printf '%s' "$payload" > "$PATCH_CAPTURE" ;;
  esac
}
quick_tunnel_stopped() { return 0; }
loopback_only() { return 0; }
catalog_code() { printf 200; }
verify_runtime() { printf 'ok - mocked runtime verification\n'; }

apply_output="$(apply_auth)"
receipt="$(printf '%s\n' "$apply_output" | sed -n 's/^applied receipt=//p')"
[ -r "$receipt" ] && [ "$(stat -f '%Lp' "$receipt")" = 600 ] && pass 'apply writes a mode-600 receipt' || fail 'apply writes a mode-600 receipt'
jq -e '.noLog==true and .usageLimitEnabled==true and .dailyUsageLimitUsd==10 and .weeklyUsageLimitUsd==50 and .allowedEndpoints==["chat","models"] and .maxSessions==8' "$PATCH_CAPTURE" >/dev/null \
  && pass 'apply enforces no-log, finite spend, endpoints, and sessions' \
  || fail 'apply enforces no-log, finite spend, endpoints, and sessions'
jq -e '.applied==true and .keyCreatedThisRun==true and (.profiles|length)==4' "$receipt" >/dev/null \
  && pass 'apply receipt records exact profile migration state' \
  || fail 'apply receipt records exact profile migration state'

GOOD_METADATA="$(jq -c '[. + {id:"mock-claude-id",name:"Temperance Claude Native"}]' "$PATCH_CAPTURE")"
validate_claude_key_metadata "$GOOD_METADATA" \
  && pass 'metadata validator accepts the exact governed policy' \
  || fail 'metadata validator accepts the exact governed policy'
if validate_claude_key_metadata "$(printf '%s' "$GOOD_METADATA" | jq '.[0].noLog=false')" >/dev/null 2>&1; then
  fail 'metadata validator rejects noLog false'
else
  pass 'metadata validator rejects noLog false'
fi
if validate_claude_key_metadata "$(printf '%s' "$GOOD_METADATA" | jq '.[0].allowedModels += ["unapproved/fifth-model"]')" >/dev/null 2>&1; then
  fail 'metadata validator rejects a fifth allowed model'
else
  pass 'metadata validator rejects a fifth allowed model'
fi
validate_auth_probe_codes 401 401 200 200 401 \
  && pass 'auth validator accepts the exact protected response matrix' \
  || fail 'auth validator accepts the exact protected response matrix'
if validate_auth_probe_codes 200 401 200 200 401 >/dev/null 2>&1; then
  fail 'auth validator rejects anonymous catalog access'
else
  pass 'auth validator rejects anonymous catalog access'
fi
if validate_auth_probe_codes 401 401 200 200 200 >/dev/null 2>&1; then
  fail 'auth validator rejects inference-key management access'
else
  pass 'auth validator rejects inference-key management access'
fi
if listener_addresses_are_loopback '*:20128'; then
  fail 'listener validator rejects an all-interface bind'
else
  pass 'listener validator rejects an all-interface bind'
fi

DELETE_SEEN=0
api_mutate() {
  local method="$1" path="$2"
  RESPONSE_CODE=200
  RESPONSE_BODY='{}'
  [ "$method $path" != 'DELETE /api/keys/mock-claude-id' ] || DELETE_SEEN=1
}
rollback_auth "$receipt" >/dev/null
[ "$DELETE_SEEN" = 1 ] && pass 'receipt-bound rollback deletes only its created key' || fail 'receipt-bound rollback deletes only its created key'
[ -r "${receipt%/*}/receipt.rollback.json" ] && pass 'rollback emits a mode-600 receipt' || fail 'rollback emits a mode-600 receipt'

REVOKED=0
api_mutate() {
  local method="$1" path="$2"
  RESPONSE_CODE=200
  RESPONSE_BODY='{}'
  case "$method $path" in
    'POST /api/keys') RESPONSE_CODE=201; RESPONSE_BODY='{"id":"throwaway-id","key":"throwaway-secret"}' ;;
    'DELETE /api/keys/throwaway-id') REVOKED=1 ;;
  esac
}
catalog_code() { [ "$REVOKED" = 1 ] && printf 401 || printf 200; }
revocation_output="$(revocation_rehearsal)"
revocation_receipt="$(printf '%s\n' "$revocation_output" | sed -n 's/.*receipt=//p')"
jq -e '.preRevocationHttp==200 and .postRevocationHttp==401 and .deleted==true and .secretPersisted==false' "$revocation_receipt" >/dev/null \
  && pass 'revocation rehearsal proves post-delete 401 without persisting secret' \
  || fail 'revocation rehearsal proves post-delete 401 without persisting secret'

exit "$status"
