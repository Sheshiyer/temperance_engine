#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCHER="$ROOT_DIR/package/router/omniroute-opencode.sh"
TEST_DIR="$(mktemp -d)"
MOCK_SECURITY="$TEST_DIR/security"
MOCK_OPENCODE="$TEST_DIR/opencode"
CANARY='test-opencode-key-canary-8521'
status=0

pass() { printf 'ok - %s\n' "$1"; }
fail() { printf 'FAIL - %s\n' "$1"; status=1; }

printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
  '[ "${MOCK_SECURITY_EMPTY:-0}" != 1 ] || exit 44' \
  'printf "%s\n" "$MOCK_OPENCODE_KEY"' > "$MOCK_SECURITY"
printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
  'printf "%s\n" "$@" > "$MOCK_CAPTURE_DIR/argv"' \
  'if [ "${OMNIROUTE_API_KEY:-}" = "$MOCK_OPENCODE_KEY" ]; then auth_state=matched; else auth_state=mismatched; fi' \
  'printf "%s\n" "$auth_state" > "$MOCK_CAPTURE_DIR/auth"' \
  '[ "${MOCK_OPENCODE_FAIL:-0}" != 1 ] || exit 69' > "$MOCK_OPENCODE"
chmod 700 "$MOCK_SECURITY" "$MOCK_OPENCODE"

capture="$TEST_DIR/ok"
mkdir -p "$capture"
MOCK_CAPTURE_DIR="$capture" MOCK_OPENCODE_KEY="$CANARY" \
  TEMPERANCE_SECURITY_BIN="$MOCK_SECURITY" TEMPERANCE_REAL_OPENCODE_BIN="$MOCK_OPENCODE" \
  "$LAUNCHER" run --model omniroute/temperance-coding >/dev/null

grep -Fxq run "$capture/argv" && pass 'OpenCode arguments pass literally' || fail 'OpenCode arguments pass literally'
if grep -Fq "$CANARY" "$capture/argv"; then fail 'OpenCode key appears in arguments'; else pass 'OpenCode key stays out of arguments'; fi
if [ "$(tr -d '\n' < "$capture/auth")" = matched ]; then pass 'OpenCode receives Keychain bearer'; else fail 'OpenCode receives Keychain bearer'; fi

missing="$TEST_DIR/missing"
mkdir -p "$missing"
if MOCK_CAPTURE_DIR="$missing" MOCK_OPENCODE_KEY="$CANARY" MOCK_SECURITY_EMPTY=1 \
  TEMPERANCE_SECURITY_BIN="$MOCK_SECURITY" TEMPERANCE_REAL_OPENCODE_BIN="$MOCK_OPENCODE" \
  "$LAUNCHER" >/dev/null 2>&1; then
  fail 'missing OpenCode key fails closed'
else
  pass 'missing OpenCode key fails closed'
fi
[ ! -e "$missing/argv" ] && pass 'missing key fails before OpenCode execution' || fail 'missing key fails before OpenCode execution'

upstream_failure="$TEST_DIR/upstream-failure"
mkdir -p "$upstream_failure"
if MOCK_CAPTURE_DIR="$upstream_failure" MOCK_OPENCODE_KEY="$CANARY" MOCK_OPENCODE_FAIL=1 \
  TEMPERANCE_SECURITY_BIN="$MOCK_SECURITY" TEMPERANCE_REAL_OPENCODE_BIN="$MOCK_OPENCODE" \
  "$LAUNCHER" models omniroute >/dev/null 2>&1; then
  fail 'OpenCode upstream failure propagates as a launcher failure'
else
  pass 'OpenCode upstream failure propagates as a launcher failure'
fi
[ -e "$upstream_failure/argv" ] \
  && pass 'OpenCode upstream failure remains on the governed launcher path' \
  || fail 'OpenCode upstream failure remains on the governed launcher path'

exit "$status"
