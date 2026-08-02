#!/usr/bin/env bash
set -euo pipefail

# OpenCode expands {env:OMNIROUTE_API_KEY} from its governed provider config.
# Resolve that value from Keychain at launch rather than persisting it in JSON.

USER_NAME="${USER:-$(id -un)}"
KEYCHAIN_SERVICE="${TEMPERANCE_OMNIROUTE_KEYCHAIN_SERVICE:-OmniRoute Temperance API Key}"
SECURITY_BIN="${TEMPERANCE_SECURITY_BIN:-/usr/bin/security}"
OPENCODE_BIN="${TEMPERANCE_REAL_OPENCODE_BIN:-$(command -v opencode || true)}"

[ -x "$SECURITY_BIN" ] || { printf 'security CLI unavailable: %s\n' "$SECURITY_BIN" >&2; exit 127; }
[ -n "$OPENCODE_BIN" ] && [ -x "$OPENCODE_BIN" ] || { printf 'opencode CLI unavailable\n' >&2; exit 127; }
case "$OPENCODE_BIN" in
  /*) ;;
  *) printf 'opencode CLI must resolve to an absolute path\n' >&2; exit 127 ;;
esac

api_key="$($SECURITY_BIN find-generic-password -a "$USER_NAME" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
[ -n "$api_key" ] || { printf 'missing Keychain item: %s\n' "$KEYCHAIN_SERVICE" >&2; exit 78; }
case "$api_key" in
  *[[:space:]]*) printf 'invalid whitespace in Keychain API key\n' >&2; exit 78 ;;
esac

export OMNIROUTE_API_KEY="$api_key"
unset api_key
exec "$OPENCODE_BIN" "$@"
