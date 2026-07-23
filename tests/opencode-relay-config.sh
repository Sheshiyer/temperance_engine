#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/opencode" "$TMP/state" "$TMP/backups"
cat >"$TMP/opencode/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "omniroute": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {"baseURL": "http://127.0.0.1:20128/v1", "apiKey": "{env:OMNIROUTE_API_KEY}"},
      "models": {"temperance-coding": {"name": "Temperance Coding"}}
    }
  }
}
JSON

health_dir="$TMP/bin"
mkdir -p "$health_dir"
cat >"$health_dir/curl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' '{"ok":true,"service":"temperance-openai-proxy","automatic_model":"temperance-auto"}'
SH
chmod +x "$health_dir/curl"

export HOME="$TMP"
export OPENCODE_HOME="$TMP/opencode"
export TEMPERANCE_STATE_DIR="$TMP/state"
export TEMPERANCE_BACKUP_DIR="$TMP/backups"
export PATH="$health_dir:$PATH"

"$ROOT/scripts/configure-opencode-relay.sh" --enable
jq -e '.provider.omniroute.options.baseURL == "http://127.0.0.1:20128/v1"' "$OPENCODE_HOME/opencode.json" >/dev/null
jq -e '.provider.temperance.options.baseURL == "http://127.0.0.1:20129/v1" and .provider.temperance.models["temperance-auto"] != null' "$OPENCODE_HOME/opencode.json" >/dev/null
jq -e '.schema_version == "temperance-opencode-relay-v1"' "$TEMPERANCE_STATE_DIR/relay/opencode-provider.json" >/dev/null
find "$TMP/backups" -type f -name opencode.json | grep -q .
echo "ok - relay provider is added without changing direct provider"

"$ROOT/scripts/configure-opencode-relay.sh" --disable
jq -e '.provider.omniroute.options.baseURL == "http://127.0.0.1:20128/v1" and (.provider.temperance == null)' "$OPENCODE_HOME/opencode.json" >/dev/null
test ! -e "$TEMPERANCE_STATE_DIR/relay/opencode-provider.json"
echo "ok - relay provider disables cleanly"
