#!/usr/bin/env bash
set -euo pipefail

# Launch one of the four OmniRoute-generated Claude profiles without writing an
# inference key into settings.json or OmniRoute's plaintext context store.
# The key exists only in the launcher/native-launch environment and the final
# ANTHROPIC_AUTH_TOKEN consumed by Claude Code.

source_path="${BASH_SOURCE[0]}"
while [ -L "$source_path" ]; do
  source_dir="$(cd -P "$(dirname "$source_path")" && pwd)"
  source_path="$(readlink "$source_path")"
  case "$source_path" in /*) ;; *) source_path="$source_dir/$source_path" ;; esac
done
SCRIPT_DIR="$(cd -P "$(dirname "$source_path")" && pwd)"
unset source_path source_dir
SHIM_DIR="$SCRIPT_DIR/claude-launch-shim"
SHIM_BIN="$SHIM_DIR/claude"
USER_NAME="${USER:-$(id -un)}"
KEYCHAIN_SERVICE="${TEMPERANCE_OMNIROUTE_CLAUDE_KEYCHAIN_SERVICE:-OmniRoute Temperance Claude API Key}"
SECURITY_BIN="${TEMPERANCE_SECURITY_BIN:-/usr/bin/security}"
OMNIROUTE_BIN="${TEMPERANCE_OMNIROUTE_BIN:-$(command -v omniroute || true)}"
REAL_CLAUDE_BIN="${TEMPERANCE_REAL_CLAUDE_BIN:-$(command -v claude || true)}"
BASE_URL="http://127.0.0.1:20128"

usage() {
  printf 'usage: %s PROFILE [claude arguments...]\n' "$0" >&2
  printf 'profiles: antigravity-claude-sonnet-5, gh-claude-sonnet-5, no-think-antigravity-claude-sonnet-5, no-think-gh-claude-sonnet-5\n' >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
profile="$1"
shift

case "$profile" in
  antigravity-claude-sonnet-5|gh-claude-sonnet-5|no-think-antigravity-claude-sonnet-5|no-think-gh-claude-sonnet-5) ;;
  *)
    printf 'refusing ungoverned OmniRoute Claude profile: %s\n' "$profile" >&2
    exit 2
    ;;
esac

[ -x "$SECURITY_BIN" ] || { printf 'security CLI unavailable: %s\n' "$SECURITY_BIN" >&2; exit 127; }
[ -n "$OMNIROUTE_BIN" ] && [ -x "$OMNIROUTE_BIN" ] || { printf 'omniroute CLI unavailable\n' >&2; exit 127; }
[ -n "$REAL_CLAUDE_BIN" ] && [ -x "$REAL_CLAUDE_BIN" ] || { printf 'real claude CLI unavailable\n' >&2; exit 127; }
[ -x "$SHIM_BIN" ] || { printf 'Claude environment scrubber unavailable: %s\n' "$SHIM_BIN" >&2; exit 127; }
case "$REAL_CLAUDE_BIN" in
  /*) ;;
  *) printf 'real claude CLI must resolve to an absolute path\n' >&2; exit 127 ;;
esac
[ "$REAL_CLAUDE_BIN" != "$SHIM_BIN" ] || { printf 'refusing recursive Claude shim\n' >&2; exit 127; }

api_key="$($SECURITY_BIN find-generic-password -a "$USER_NAME" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
[ -n "$api_key" ] || {
  printf 'missing Keychain item: %s\n' "$KEYCHAIN_SERVICE" >&2
  exit 78
}
case "$api_key" in
  *[[:space:]]*) printf 'invalid whitespace in Keychain API key\n' >&2; exit 78 ;;
esac

# Native OmniRoute launch resolves OMNIROUTE_API_KEY and injects the required
# ANTHROPIC_AUTH_TOKEN. PATH selects our one-hop scrubber; the scrubber removes
# OMNIROUTE_API_KEY before execing the real Claude binary.
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL OMNIROUTE_CONTEXT
export OMNIROUTE_API_KEY="$api_key"
export TEMPERANCE_REAL_CLAUDE_BIN="$REAL_CLAUDE_BIN"
export TEMPERANCE_OMNIROUTE_CLAUDE_LAUNCH=1
export PATH="$SHIM_DIR:$PATH"
unset api_key

exec "$OMNIROUTE_BIN" launch --remote "$BASE_URL" --profile "$profile" -- "$@"
