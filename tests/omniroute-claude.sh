#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCHER="$ROOT_DIR/package/router/omniroute-claude.sh"
SHIM="$ROOT_DIR/package/router/claude-launch-shim/claude"
TEST_DIR="$(mktemp -d)"
MOCK_SECURITY="$TEST_DIR/security"
MOCK_OMNIROUTE="$TEST_DIR/omniroute"
MOCK_CLAUDE="$TEST_DIR/real-claude"
CANARY='test-claude-key-canary-7419'
status=0

pass() { printf 'ok - %s\n' "$1"; }
fail() { printf 'FAIL - %s\n' "$1"; status=1; }
check_eq() { [ "$1" = "$2" ] && pass "$3" || fail "$3 (expected $2, got $1)"; }

printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
  'printf called > "$MOCK_CAPTURE_DIR/security.called"' \
  '[ "${MOCK_SECURITY_EMPTY:-0}" != 1 ] || exit 44' \
  'printf "%s\n" "$MOCK_CLAUDE_KEY"' > "$MOCK_SECURITY"

printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
  'printf "%s\n" "$@" > "$MOCK_CAPTURE_DIR/omniroute.argv"' \
  'printf "%s\n" "${OMNIROUTE_API_KEY:+present}" > "$MOCK_CAPTURE_DIR/omniroute.key"' \
  '[ "${1:-}" = launch ] || exit 64' \
  '[ "${MOCK_OMNIROUTE_FAIL:-0}" != 1 ] || exit 69' \
  'while [ "$#" -gt 0 ] && [ "$1" != -- ]; do shift; done' \
  '[ "$#" -gt 0 ] && shift' \
  'export ANTHROPIC_AUTH_TOKEN="$OMNIROUTE_API_KEY"' \
  'exec claude "$@"' > "$MOCK_OMNIROUTE"

printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
  'printf "%s\n" "$@" > "$MOCK_CAPTURE_DIR/claude.argv"' \
  'if [ -z "${OMNIROUTE_API_KEY:-}" ]; then key_state=absent; else key_state=present; fi' \
  'printf "%s\n" "$key_state" > "$MOCK_CAPTURE_DIR/claude.omniroute-key"' \
  'if [ "${ANTHROPIC_AUTH_TOKEN:-}" = "$MOCK_CLAUDE_KEY" ]; then auth_state=matched; else auth_state=mismatched; fi' \
  'printf "%s\n" "$auth_state" > "$MOCK_CAPTURE_DIR/claude.auth-token"' > "$MOCK_CLAUDE"

chmod 700 "$MOCK_SECURITY" "$MOCK_OMNIROUTE" "$MOCK_CLAUDE"

profiles=(
  antigravity-claude-sonnet-5
  gh-claude-sonnet-5
  no-think-antigravity-claude-sonnet-5
  no-think-gh-claude-sonnet-5
)

for profile in "${profiles[@]}"; do
  capture="$TEST_DIR/$profile"
  mkdir -p "$capture"
  MOCK_CAPTURE_DIR="$capture" MOCK_CLAUDE_KEY="$CANARY" \
    TEMPERANCE_SECURITY_BIN="$MOCK_SECURITY" TEMPERANCE_OMNIROUTE_BIN="$MOCK_OMNIROUTE" \
    TEMPERANCE_REAL_CLAUDE_BIN="$MOCK_CLAUDE" \
    TEMPERANCE_OMNIROUTE_CLAUDE_KEYCHAIN_SERVICE='test-service' \
    "$LAUNCHER" "$profile" -p 'bounded canary' >/dev/null

  grep -Fxq "$profile" "$capture/omniroute.argv" && pass "$profile delegates exact profile" || fail "$profile delegates exact profile"
  check_eq "$(tr -d '\n' < "$capture/omniroute.key")" present "$profile supplies key only to native launch"
  check_eq "$(tr -d '\n' < "$capture/claude.omniroute-key")" absent "$profile scrubs duplicate OmniRoute key"
  check_eq "$(tr -d '\n' < "$capture/claude.auth-token")" matched "$profile preserves required Anthropic bearer"
  if grep -Fq "$CANARY" "$capture/omniroute.argv" "$capture/claude.argv"; then
    fail "$profile exposes key in child arguments"
  else
    pass "$profile keeps key out of child arguments"
  fi
done

symlink_launcher="$TEST_DIR/temperance-claude"
ln -s "$LAUNCHER" "$symlink_launcher"
symlink_capture="$TEST_DIR/symlink"
mkdir -p "$symlink_capture"
MOCK_CAPTURE_DIR="$symlink_capture" MOCK_CLAUDE_KEY="$CANARY" \
  TEMPERANCE_SECURITY_BIN="$MOCK_SECURITY" TEMPERANCE_OMNIROUTE_BIN="$MOCK_OMNIROUTE" \
  TEMPERANCE_REAL_CLAUDE_BIN="$MOCK_CLAUDE" \
  "$symlink_launcher" antigravity-claude-sonnet-5 -p 'symlink canary' >/dev/null
[ "$(tr -d '\n' < "$symlink_capture/claude.auth-token")" = matched ] && pass 'symlinked launcher resolves repository scrubber' || fail 'symlinked launcher resolves repository scrubber'

reject_capture="$TEST_DIR/reject"
mkdir -p "$reject_capture"
if MOCK_CAPTURE_DIR="$reject_capture" MOCK_CLAUDE_KEY="$CANARY" \
  TEMPERANCE_SECURITY_BIN="$MOCK_SECURITY" TEMPERANCE_OMNIROUTE_BIN="$MOCK_OMNIROUTE" \
  TEMPERANCE_REAL_CLAUDE_BIN="$MOCK_CLAUDE" "$LAUNCHER" unknown-profile >/dev/null 2>&1; then
  fail 'unknown profile is rejected'
else
  pass 'unknown profile is rejected'
fi
[ ! -e "$reject_capture/security.called" ] && pass 'unknown profile fails before Keychain read' || fail 'unknown profile fails before Keychain read'

missing_capture="$TEST_DIR/missing"
mkdir -p "$missing_capture"
if MOCK_CAPTURE_DIR="$missing_capture" MOCK_CLAUDE_KEY="$CANARY" MOCK_SECURITY_EMPTY=1 \
  TEMPERANCE_SECURITY_BIN="$MOCK_SECURITY" TEMPERANCE_OMNIROUTE_BIN="$MOCK_OMNIROUTE" \
  TEMPERANCE_REAL_CLAUDE_BIN="$MOCK_CLAUDE" "$LAUNCHER" antigravity-claude-sonnet-5 >/dev/null 2>&1; then
  fail 'missing Keychain item fails closed'
else
  pass 'missing Keychain item fails closed'
fi
[ ! -e "$missing_capture/omniroute.argv" ] && pass 'missing key fails before native launch' || fail 'missing key fails before native launch'

upstream_failure_capture="$TEST_DIR/upstream-failure"
mkdir -p "$upstream_failure_capture"
if MOCK_CAPTURE_DIR="$upstream_failure_capture" MOCK_CLAUDE_KEY="$CANARY" MOCK_OMNIROUTE_FAIL=1 \
  TEMPERANCE_SECURITY_BIN="$MOCK_SECURITY" TEMPERANCE_OMNIROUTE_BIN="$MOCK_OMNIROUTE" \
  TEMPERANCE_REAL_CLAUDE_BIN="$MOCK_CLAUDE" \
  "$LAUNCHER" antigravity-claude-sonnet-5 -p 'fail-closed canary' >/dev/null 2>&1; then
  fail 'OmniRoute upstream failure propagates as a launcher failure'
else
  pass 'OmniRoute upstream failure propagates as a launcher failure'
fi
[ ! -e "$upstream_failure_capture/claude.argv" ] \
  && pass 'OmniRoute upstream failure never falls back to direct Claude' \
  || fail 'OmniRoute upstream failure never falls back to direct Claude'

if TEMPERANCE_REAL_CLAUDE_BIN="$MOCK_CLAUDE" "$SHIM" >/dev/null 2>&1; then
  fail 'scrubber refuses ungoverned direct execution'
else
  pass 'scrubber refuses ungoverned direct execution'
fi

for profile in "${profiles[@]}"; do
  settings="$HOME/.claude/profiles/$profile/settings.json"
  if [ -r "$settings" ] && ! grep -Eq 'ANTHROPIC_(AUTH_TOKEN|API_KEY)' "$settings"; then
    pass "$profile persisted profile remains tokenless"
  else
    fail "$profile persisted profile remains tokenless"
  fi
done

exit "$status"
