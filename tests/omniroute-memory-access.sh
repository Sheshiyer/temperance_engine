#!/usr/bin/env bash
# Behavioral checks for the Cloudflare Access service-token path in
# scripts/lib/omniroute-curl.sh, as used by scripts/omniroute-memory-retrieve.sh
# and scripts/omniroute-memory-sync.sh. curl and security are mocked on PATH;
# jq and bun are real. No network is used.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RETRIEVE="$ROOT/scripts/omniroute-memory-retrieve.sh"
SYNC="$ROOT/scripts/omniroute-memory-sync.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
fail=0
pass() { printf 'ok - %s\n' "$1"; }
bad() { printf 'FAIL - %s\n' "$1"; fail=1; }
check() { local d="$1"; shift; if "$@"; then pass "$d"; else bad "$d"; fi; }

# Never inherit an operator's routing or Access environment.
unset TEMPERANCE_OMNIROUTE_ADMIN_URL TEMPERANCE_OMNIROUTE_ACCESS_CLIENT_ID \
  TEMPERANCE_OMNIROUTE_ACCESS_CLIENT_SECRET TEMPERANCE_OMNIROUTE_ALLOW_REMOTE_LOGIN_WITHOUT_ACCESS

ADMIN_CANARY='admin-password-canary-5521'
ID_CANARY='access-id-canary.access'
SECRET_CANARY='access-secret-canary-9f3e'
MOCK_BIN="$TEST_DIR/bin"
mkdir -p "$MOCK_BIN" "$TEST_DIR/memory"

# security: admin password always present; Access items only when MOCK_KEYCHAIN_ACCESS=1.
cat > "$MOCK_BIN/security" <<'MOCK'
#!/usr/bin/env bash
service=""
while [ "$#" -gt 0 ]; do case "$1" in -s) service="$2"; shift 2 ;; *) shift ;; esac; done
printf '%s\n' "$service" >> "$MOCK_LOG/security"
case "$service" in
  "OmniRoute Temperance Admin") printf '%s\n' "$MOCK_ADMIN_PASSWORD" ;;
  "OmniRoute Temperance Access Client ID") [ "${MOCK_KEYCHAIN_ACCESS:-0}" = 1 ] && printf '%s\n' "$MOCK_ACCESS_ID" || exit 44 ;;
  "OmniRoute Temperance Access Client Secret") [ "${MOCK_KEYCHAIN_ACCESS:-0}" = 1 ] && printf '%s\n' "$MOCK_ACCESS_SECRET" || exit 44 ;;
  *) exit 44 ;;
esac
MOCK

# curl: one log line per call with the URL, argv, the Access config content and
# its mode; answers the OmniRoute endpoints the two scripts use.
cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
out="" fmt="" url="" access="" access_mode="" argv="$*"
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) fmt="$2"; shift 2 ;;
    -c|-b|-X|-H) shift 2 ;;
    --config)
      if [ "$2" = - ]; then cat > /dev/null
      elif grep -q 'CF-Access-Client' "$2"; then
        access="$(tr '\n' ' ' < "$2")"; access_mode="$(stat -f '%Lp' "$2" 2>/dev/null || stat -c '%a' "$2")"
        printf '%s\n' "$2" >> "$MOCK_LOG/access-files"
      fi
      shift 2 ;;
    --data-binary) [ "$2" = @/dev/fd/3 ] && cat <&3 > /dev/null; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf 'url=%s | access=[%s] mode=%s | argv=%s\n' "$url" "$access" "$access_mode" "$argv" >> "$MOCK_LOG/curl"
case "$url" in
  */api/auth/login) body='{}'; code="${MOCK_LOGIN_HTTP:-200}" ;;
  */api/auth/csrf) body='{"token":"csrf-test"}'; code=200 ;;
  */api/memory/retrieve-preview) body='{"memories":[]}'; code=200 ;;
  */api/memory\?*) body='{"data":[],"totalPages":1}'; code=200 ;;
  *) body='{}'; code=404 ;;
esac
if [ -n "$out" ]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
[ -n "$fmt" ] && printf '%s' "$code"
exit 0
MOCK
chmod 755 "$MOCK_BIN/security" "$MOCK_BIN/curl"

# run NAME SCRIPT ARGS... with the current MOCK_* / TEMPERANCE_* settings.
run() {
  local name="$1"; shift
  export MOCK_LOG="$TEST_DIR/log-$name"; mkdir -p "$MOCK_LOG"; : > "$MOCK_LOG/curl"; : > "$MOCK_LOG/security"
  PATH="$MOCK_BIN:$PATH" MOCK_ADMIN_PASSWORD="$ADMIN_CANARY" MOCK_ACCESS_ID="$ID_CANARY" \
    MOCK_ACCESS_SECRET="$SECRET_CANARY" TEMPERANCE_PAI_MEMORY_DIR="$TEST_DIR/memory" \
    "$@" > "$MOCK_LOG/stdout" 2> "$MOCK_LOG/stderr"
  echo $? > "$MOCK_LOG/exit"
}
log() { cat "$TEST_DIR/log-$1/$2"; }
exit_of() { cat "$TEST_DIR/log-$1/exit"; }
REMOTE=https://te-memory.example.test

# 1. Remote origin without a token: refused before the admin password is read.
TEMPERANCE_OMNIROUTE_ADMIN_URL="$REMOTE" run no-token bash "$RETRIEVE" "query"
check "remote origin without an Access token exits non-zero" test "$(exit_of no-token)" != 0
check "refusal explains the missing Access token" grep -q 'Refusing to send the OmniRoute admin password' "$TEST_DIR/log-no-token/stderr"
check "no request is sent without an Access token" test ! -s "$TEST_DIR/log-no-token/curl"
check "the admin password is never read without an Access token" sh -c "! grep -q 'OmniRoute Temperance Admin' '$TEST_DIR/log-no-token/security'"

# 2. Remote origin, token in the Keychain: every request carries both headers.
TEMPERANCE_OMNIROUTE_ADMIN_URL="$REMOTE" MOCK_KEYCHAIN_ACCESS=1 run keychain bash "$RETRIEVE" "query"
check "remote origin with a Keychain Access token succeeds" test "$(exit_of keychain)" = 0
check "retrieve makes its three requests (login, csrf, retrieve-preview)" test "$(wc -l < "$TEST_DIR/log-keychain/curl" | tr -d ' ')" = 3
check "every request carries CF-Access-Client-Id" sh -c "! grep -v 'CF-Access-Client-Id: $ID_CANARY' '$TEST_DIR/log-keychain/curl' | grep -q ."
check "every request carries CF-Access-Client-Secret" sh -c "! grep -v 'CF-Access-Client-Secret: $SECRET_CANARY' '$TEST_DIR/log-keychain/curl' | grep -q ."
check "the Access secret never appears in curl argv" sh -c "! sed 's/.*| argv=//' '$TEST_DIR/log-keychain/curl' | grep -q '$SECRET_CANARY'"
check "the admin password never appears in curl argv" sh -c "! grep -q '$ADMIN_CANARY' '$TEST_DIR/log-keychain/curl'"
check "the Access header file is owner-only (0600)" sh -c "! grep -v 'mode=600 ' '$TEST_DIR/log-keychain/curl' | grep -q ."
check "the Access header file is removed when the script exits" sh -c "while read -r f; do [ ! -e \"\$f\" ] || exit 1; done < '$TEST_DIR/log-keychain/access-files'"

# 3. Token from the environment instead of the Keychain.
TEMPERANCE_OMNIROUTE_ADMIN_URL="$REMOTE" TEMPERANCE_OMNIROUTE_ACCESS_CLIENT_ID="$ID_CANARY" \
  TEMPERANCE_OMNIROUTE_ACCESS_CLIENT_SECRET="$SECRET_CANARY" run env-token bash "$RETRIEVE" "query"
check "an Access token from the environment is used" sh -c "test \"\$(cat '$TEST_DIR/log-env-token/exit')\" = 0 && ! grep -v 'CF-Access-Client-Secret: $SECRET_CANARY' '$TEST_DIR/log-env-token/curl' | grep -q ."

# 4. Loopback origin: no token needed, and none is sent.
TEMPERANCE_OMNIROUTE_ADMIN_URL=http://127.0.0.1:20128 MOCK_KEYCHAIN_ACCESS=1 run loopback bash "$RETRIEVE" "query"
check "a loopback origin needs no Access token" test "$(exit_of loopback)" = 0
check "a loopback origin sends no Access headers" sh -c "! grep -q 'CF-Access' '$TEST_DIR/log-loopback/curl'"

# 5. Access bounces the login: a clear message instead of a bare HTTP code.
TEMPERANCE_OMNIROUTE_ADMIN_URL="$REMOTE" MOCK_KEYCHAIN_ACCESS=1 MOCK_LOGIN_HTTP=302 run bounced bash "$RETRIEVE" "query"
check "an Access redirect on login fails the run" test "$(exit_of bounced)" != 0
check "an Access redirect is reported as an Access rejection" grep -q 'Cloudflare Access did not accept the service token' "$TEST_DIR/log-bounced/stderr"

# 6. Explicit opt-out for a privately protected origin: warns, sends no headers.
TEMPERANCE_OMNIROUTE_ADMIN_URL="$REMOTE" TEMPERANCE_OMNIROUTE_ALLOW_REMOTE_LOGIN_WITHOUT_ACCESS=1 run opt-out bash "$RETRIEVE" "query"
check "the opt-out proceeds with a warning" sh -c "test \"\$(cat '$TEST_DIR/log-opt-out/exit')\" = 0 && grep -q 'without a Cloudflare Access token' '$TEST_DIR/log-opt-out/stderr'"

# 7. The sync script shares the same path (dry-run: login, csrf, memory list).
TEMPERANCE_OMNIROUTE_ADMIN_URL="$REMOTE" run sync-no-token bash "$SYNC"
check "sync refuses a remote origin without an Access token" sh -c "test \"\$(cat '$TEST_DIR/log-sync-no-token/exit')\" != 0 && test ! -s '$TEST_DIR/log-sync-no-token/curl'"
TEMPERANCE_OMNIROUTE_ADMIN_URL="$REMOTE" MOCK_KEYCHAIN_ACCESS=1 run sync-keychain bash "$SYNC"
check "sync dry-run succeeds with an Access token" test "$(exit_of sync-keychain)" = 0
check "every sync request carries the Access headers" sh -c "test -s '$TEST_DIR/log-sync-keychain/curl' && ! grep -v 'CF-Access-Client-Secret: $SECRET_CANARY' '$TEST_DIR/log-sync-keychain/curl' | grep -q ."

# 8. Loopback detection.
. "$ROOT/scripts/lib/omniroute-curl.sh"
for url in http://127.0.0.1:20128 http://localhost/ 'http://[::1]:20128/x'; do
  check "loopback: $url" omniroute_origin_is_loopback "$url"
done
for url in https://te-memory.thoughtseed.space http://127.0.0.1.example.test http://user@127.0.0.1 http://10.0.0.5:20128; do
  check "remote: $url" sh -c "! (. '$ROOT/scripts/lib/omniroute-curl.sh'; omniroute_origin_is_loopback '$url')"
done

exit "$fail"
