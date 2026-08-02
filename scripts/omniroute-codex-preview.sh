#!/usr/bin/env bash
set -euo pipefail

# Exercise OmniRoute's native setup-codex generator without allowing it to
# modify the governed Codex home. The native preview is discovery evidence;
# Temperance remains authoritative for accepted profiles and context limits.

BASE_URL="${TEMPERANCE_OMNIROUTE_ADMIN_URL:-http://127.0.0.1:20128}"
BASE_URL="${BASE_URL%/}"
FILTER="${TEMPERANCE_OMNIROUTE_CODEX_PREVIEW_FILTER:-gpt-5.3-codex-spark}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
RECEIPT_ROOT="${TEMPERANCE_OMNIROUTE_CODEX_PREVIEW_RECEIPTS:-$HOME/.temperance_engine/receipts/omniroute-codex-preview}"
SECURITY_BIN="${TEMPERANCE_SECURITY_BIN:-/usr/bin/security}"
OMNIROUTE_BIN="${TEMPERANCE_OMNIROUTE_BIN:-$(command -v omniroute || true)}"
KEYCHAIN_SERVICE="${TEMPERANCE_OMNIROUTE_KEYCHAIN_SERVICE:-OmniRoute Temperance API Key}"
USER_NAME="${USER:-$(id -un)}"

usage() {
  printf 'usage: %s [--filter SUBSTRING]\n' "$0" >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --filter)
      [ "$#" -ge 2 ] || usage
      FILTER="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

case "$BASE_URL" in
  http://127.0.0.1:20128|http://localhost:20128) ;;
  *) printf 'refusing non-loopback Codex preview origin: %s\n' "$BASE_URL" >&2; exit 2 ;;
esac
[ -n "$FILTER" ] || { printf 'preview filter must not be empty\n' >&2; exit 2; }
[ -x "$SECURITY_BIN" ] || { printf 'security CLI unavailable: %s\n' "$SECURITY_BIN" >&2; exit 127; }
[ -n "$OMNIROUTE_BIN" ] && [ -x "$OMNIROUTE_BIN" ] || { printf 'omniroute CLI unavailable\n' >&2; exit 127; }
command -v jq >/dev/null || { printf 'jq is required\n' >&2; exit 127; }
command -v shasum >/dev/null || { printf 'shasum is required\n' >&2; exit 127; }

snapshot_codex_home() {
  local listing
  listing="$(mktemp)"
  if [ -d "$CODEX_HOME" ]; then
    find "$CODEX_HOME" -maxdepth 1 -type f -name '*.config.toml' -print0 2>/dev/null \
      | sort -z | xargs -0 shasum -a 256 > "$listing" || true
  fi
  shasum -a 256 "$listing" | awk '{print $1}'
  rm -f "$listing"
}

umask 077
receipt_dir="$RECEIPT_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$receipt_dir"
chmod 700 "$receipt_dir"
preview_home="$receipt_dir/isolated-codex-home"
preview_output="$receipt_dir/preview.txt"
mkdir -p "$preview_home"
chmod 700 "$preview_home"

before_hash="$(snapshot_codex_home)"
api_key="$($SECURITY_BIN find-generic-password -a "$USER_NAME" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
[ -n "$api_key" ] || { printf 'missing Keychain item: %s\n' "$KEYCHAIN_SERVICE" >&2; exit 78; }
OMNIROUTE_API_KEY="$api_key" "$OMNIROUTE_BIN" setup-codex \
  --remote "$BASE_URL" \
  --codex-home "$preview_home" \
  --only "$FILTER" \
  --dry-run > "$preview_output" 2>&1
unset api_key
chmod 600 "$preview_output"
after_hash="$(snapshot_codex_home)"

[ "$before_hash" = "$after_hash" ] || { printf 'FAIL governed Codex profile hash changed during native preview\n' >&2; exit 1; }
written_count="$(find "$preview_home" -type f | wc -l | tr -d ' ')"
[ "$written_count" = 0 ] || { printf 'FAIL native dry-run wrote %s preview files\n' "$written_count" >&2; exit 1; }
if rg -n '(sk-[A-Za-z0-9_-]{16,}|Bearer [A-Za-z0-9._~-]{12,}|api_key[[:space:]]*=[[:space:]]*"[^"$])' "$preview_output" >/dev/null; then
  printf 'FAIL credential-like material found in native Codex preview\n' >&2
  exit 1
fi

preview_count="$(sed -n 's/.*\[dry-run\] \([0-9][0-9]*\) profiles would be written.*/\1/p' "$preview_output" | tail -1)"
[ -n "$preview_count" ] || { printf 'FAIL native Codex preview did not report a profile count\n' >&2; exit 1; }
output_sha256="$(shasum -a 256 "$preview_output" | awk '{print $1}')"
receipt="$receipt_dir/receipt.json"
jq -n \
  --arg schema temperance-omniroute-codex-preview-v1 \
  --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg baseUrl "$BASE_URL" \
  --arg filter "$FILTER" \
  --arg beforeHash "$before_hash" \
  --arg afterHash "$after_hash" \
  --arg previewOutput "$preview_output" \
  --arg outputSha256 "$output_sha256" \
  --argjson previewCount "$preview_count" \
  '{schema:$schema,createdAt:$createdAt,baseUrl:$baseUrl,filter:$filter,governedCodexHashBefore:$beforeHash,governedCodexHashAfter:$afterHash,governedCodexUnchanged:($beforeHash==$afterHash),isolatedFilesWritten:0,previewCount:$previewCount,previewOutput:$previewOutput,previewOutputSha256:$outputSha256,plaintextApiKeyFound:false}' \
  > "$receipt"
chmod 600 "$receipt"
printf 'ok - native Codex preview validated %s profiles without writes or plaintext credentials; receipt=%s\n' "$preview_count" "$receipt"
