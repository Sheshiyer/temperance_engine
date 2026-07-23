#!/usr/bin/env bash
# Sandbox lifecycle test for scripts/configure-kimi-desktop-relay.sh: the
# daimon parameterization — [[hooks]] inside the managed block (no pre-existing
# hooks key), config_sha256 drift anchor, secret-free output, hook copy outside
# the app dir, and byte-identical disable restore.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0
check() { if [[ "$2" == "$3" ]]; then echo "ok - $1"; else echo "FAIL - $1: exp[$2] got[$3]"; fail=1; fi; }

DAIMON_DIR="$TMP/home/Library/Application Support/kimi-desktop/daimon-share"
mkdir -p "$DAIMON_DIR" "$TMP/bin"
cat >"$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' '{"ok":true,"service":"temperance-openai-proxy","automatic_model":"temperance-auto","enrichment_surfaces":["kimi"]}'
SH
chmod +x "$TMP/bin/curl"

cat >"$DAIMON_DIR/config.toml" <<'TOML'
default_model = "daimon-kimi-code"

[providers.daimon-kimi-code]
type = "kimi"
base_url = "https://agent-gw.kimi.com/coding/v1"
api_key = "DESKTOP-SECRET-VALUE"

[models.daimon-kimi-code]
provider = "daimon-kimi-code"
model = "k2p6"
max_context_size = 262144
TOML
cp "$DAIMON_DIR/config.toml" "$TMP/original.toml"

export HOME="$TMP/home"
export TEMPERANCE_STATE_DIR="$TMP/home/.temperance_engine"
export TEMPERANCE_BACKUP_DIR="$TMP/home/.temperance_engine/backups"
export PATH="$TMP/bin:$PATH"
CONFIG="$DAIMON_DIR/config.toml"
STATE="$TEMPERANCE_STATE_DIR/relay/kimi-desktop-provider.json"

# ── enable: managed block with [[hooks]], no secret in output ───────────────
out="$("$ROOT/scripts/configure-kimi-desktop-relay.sh" enable 2>&1)"
case "$out" in
  *DESKTOP-SECRET-VALUE*) echo "FAIL - enable output leaked the api_key"; fail=1 ;;
  *) echo "ok - enable output leaks no secret" ;;
esac
check "single managed block" "1" "$(grep -c 'temperance:managed:start (temperance-kimi-desktop-relay-v1)' "$CONFIG")"
check "hooks table inside block" "1" "$(grep -c '^\[\[hooks\]\]$' "$CONFIG")"
check "surface header present" "1" "$(grep -c 'X-Temperance-Surface = "kimi"' "$CONFIG")"
check "default_model untouched" "1" "$(grep -c '^default_model = "daimon-kimi-code"$' "$CONFIG")"

# hook copy lives outside the app dir (survives app updates)
HOOK_PATH="$(jq -r '.hook_path' "$STATE")"
case "$HOOK_PATH" in
  "$TMP/home/.temperance_engine/"*) echo "ok - hook copy outside app dir" ;;
  *) echo "FAIL - hook copy path unexpected: $HOOK_PATH"; fail=1 ;;
esac
test -x "$HOOK_PATH" && echo "ok - hook copy installed" || { echo "FAIL - hook copy missing"; fail=1; }

# config_sha256 anchors drift detection
jq -e '.schema_version == "temperance-kimi-desktop-relay-v1" and (.config_sha256 | length) == 64' "$STATE" >/dev/null \
  && echo "ok - state marker records config_sha256" || { echo "FAIL - config_sha256 missing"; fail=1; }
if command -v shasum >/dev/null 2>&1; then
  current_sha="$(shasum -a 256 "$CONFIG" | cut -d' ' -f1)"
else
  current_sha="$(sha256sum "$CONFIG" | cut -d' ' -f1)"
fi
check "config_sha256 matches written file" "$current_sha" "$(jq -r '.config_sha256' "$STATE")"

# ── disable restores byte-identical ─────────────────────────────────────────
out="$("$ROOT/scripts/configure-kimi-desktop-relay.sh" disable 2>&1)"
case "$out" in
  *DESKTOP-SECRET-VALUE*) echo "FAIL - disable output leaked the api_key"; fail=1 ;;
  *) echo "ok - disable output leaks no secret" ;;
esac
cmp -s "$TMP/original.toml" "$CONFIG" && echo "ok - disable restores byte-identical" || { echo "FAIL - restore differs"; fail=1; }
test ! -e "$STATE" && echo "ok - state marker removed" || { echo "FAIL - state marker remains"; fail=1; }
test ! -e "$HOOK_PATH" && echo "ok - hook copy removed" || { echo "FAIL - hook copy remains"; fail=1; }

exit "$fail"
