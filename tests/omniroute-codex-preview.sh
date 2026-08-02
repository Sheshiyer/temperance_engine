#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/omniroute-codex-preview.sh"
TEST_DIR="$(mktemp -d)"
MOCK_SECURITY="$TEST_DIR/security"
MOCK_OMNIROUTE="$TEST_DIR/omniroute"
CANARY='test-codex-preview-key-canary-9372'
status=0

pass() { printf 'ok - %s\n' "$1"; }
fail() { printf 'FAIL - %s\n' "$1"; status=1; }

mkdir -p "$TEST_DIR/home/.codex" "$TEST_DIR/receipts" "$TEST_DIR/capture"
printf '%s\n' 'governed=true' > "$TEST_DIR/home/.codex/existing.config.toml"

printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
  'printf "%s\n" "$MOCK_CODEX_PREVIEW_KEY"' > "$MOCK_SECURITY"
printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
  'printf "%s\n" "$@" > "$MOCK_CAPTURE_DIR/argv"' \
  'printf "%s\n" "${OMNIROUTE_API_KEY:+present}" > "$MOCK_CAPTURE_DIR/key-state"' \
  'codex_home=""' \
  'while [ "$#" -gt 0 ]; do case "$1" in --codex-home) codex_home="$2"; shift 2 ;; *) shift ;; esac; done' \
  '[ "${MOCK_WRITE_DURING_DRY_RUN:-0}" != 1 ] || { mkdir -p "$codex_home"; printf drift > "$codex_home/drift.config.toml"; }' \
  'if [ "${MOCK_LEAK_PREVIEW_KEY:-0}" = 1 ]; then printf "api_key = \"%s\"\n" "$OMNIROUTE_API_KEY"; else printf "[dry-run] 2 profiles would be written (4 skipped)\n"; fi' \
  > "$MOCK_OMNIROUTE"
chmod 700 "$MOCK_SECURITY" "$MOCK_OMNIROUTE"

run_preview() {
  HOME="$TEST_DIR/home" USER=tester \
  MOCK_CODEX_PREVIEW_KEY="$CANARY" MOCK_CAPTURE_DIR="$TEST_DIR/capture" \
  TEMPERANCE_SECURITY_BIN="$MOCK_SECURITY" TEMPERANCE_OMNIROUTE_BIN="$MOCK_OMNIROUTE" \
  TEMPERANCE_OMNIROUTE_CODEX_PREVIEW_RECEIPTS="$TEST_DIR/receipts" \
    bash "$SCRIPT" "$@"
}

before="$(shasum -a 256 "$TEST_DIR/home/.codex/existing.config.toml" | awk '{print $1}')"
output="$(run_preview --filter exact-model)"
receipt="$(printf '%s\n' "$output" | sed -n 's/.*receipt=//p')"
after="$(shasum -a 256 "$TEST_DIR/home/.codex/existing.config.toml" | awk '{print $1}')"
[ "$before" = "$after" ] && pass 'native preview preserves governed Codex profile bytes' || fail 'native preview preserves governed Codex profile bytes'
grep -Fxq -- '--dry-run' "$TEST_DIR/capture/argv" && pass 'native generator is always invoked in dry-run mode' || fail 'native generator is always invoked in dry-run mode'
grep -Fxq exact-model "$TEST_DIR/capture/argv" && pass 'native generator receives the explicit filter literally' || fail 'native generator receives the explicit filter literally'
[ "$(cat "$TEST_DIR/capture/key-state")" = present ] && pass 'native generator receives authenticated environment' || fail 'native generator receives authenticated environment'
if grep -Fq "$CANARY" "$TEST_DIR/capture/argv" "$receipt" "$(jq -r '.previewOutput' "$receipt")"; then
  fail 'preview keeps the Keychain secret outside argv and artifacts'
else
  pass 'preview keeps the Keychain secret outside argv and artifacts'
fi
jq -e '.governedCodexUnchanged==true and .isolatedFilesWritten==0 and .previewCount==2 and .plaintextApiKeyFound==false' "$receipt" >/dev/null \
  && [ "$(stat -f '%Lp' "$receipt")" = 600 ] \
  && pass 'preview writes a mode-600 metadata receipt' \
  || fail 'preview writes a mode-600 metadata receipt'

if MOCK_LEAK_PREVIEW_KEY=1 run_preview --filter exact-model >"$TEST_DIR/leak.out" 2>&1; then
  fail 'preview rejects plaintext API-key output'
else
  pass 'preview rejects plaintext API-key output'
fi
if MOCK_WRITE_DURING_DRY_RUN=1 run_preview --filter exact-model >"$TEST_DIR/write.out" 2>&1; then
  fail 'preview rejects files written by a broken dry-run'
else
  pass 'preview rejects files written by a broken dry-run'
fi
if TEMPERANCE_OMNIROUTE_ADMIN_URL='https://public.example.com' run_preview >"$TEST_DIR/remote.out" 2>&1; then
  fail 'preview rejects non-loopback origins'
else
  pass 'preview rejects non-loopback origins'
fi

exit "$status"
