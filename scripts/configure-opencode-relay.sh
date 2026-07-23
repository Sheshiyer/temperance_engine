#!/usr/bin/env bash
# Opt OpenCode into the local Temperance automatic provider without changing
# the direct OmniRoute provider. The relay provider is intentionally separate:
# direct `omniroute/*` remains available on :20128 when the relay is stopped.

set -euo pipefail

OPENCODE_HOME="${OPENCODE_HOME:-${HOME}/.config/opencode}"
CONFIG_PATH="${TEMPERANCE_OPENCODE_CONFIG:-${OPENCODE_HOME}/opencode.json}"
STATE_DIR="${TEMPERANCE_STATE_DIR:-${HOME}/.temperance_engine}/relay"
STATE_PATH="${STATE_DIR}/opencode-provider.json"
BACKUP_ROOT="${TEMPERANCE_BACKUP_DIR:-${HOME}/.temperance_engine/backups}"
RELAY_BASE_URL="${TEMPERANCE_PROXY_BASE_URL:-http://127.0.0.1:20129/v1}"
DIRECT_BASE_URL="${TEMPERANCE_OMNIROUTE_BASE_URL:-http://127.0.0.1:20128/v1}"
PROVIDER_ID="${TEMPERANCE_AUTO_PROVIDER_ID:-temperance}"
MODEL_ID="temperance-auto"
DRY_RUN=false
ACTION="enable"

for arg in "$@"; do
  case "$arg" in
    enable|--enable) ACTION="enable" ;;
    disable|--disable) ACTION="disable" ;;
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      cat <<'USAGE'
Usage: configure-opencode-relay.sh [enable|disable] [--dry-run]

enable  Add provider `temperance` at the local :20129 relay.
disable Remove the managed provider and leave `omniroute` at :20128 untouched.
USAGE
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 127; }
[[ -f "$CONFIG_PATH" ]] || { echo "OpenCode config not found: $CONFIG_PATH" >&2; exit 1; }

if [[ "$ACTION" == enable ]]; then
  health="$(curl -fsS --connect-timeout 1 --max-time 3 "${RELAY_BASE_URL%/v1}/health" 2>/dev/null || true)"
  if [[ -z "$health" ]] || ! jq -e '.service == "temperance-openai-proxy" and .automatic_model == "temperance-auto"' <<<"$health" >/dev/null 2>&1; then
    echo "Temperance relay is not healthy at ${RELAY_BASE_URL%/v1}; start it before enabling automatic OpenCode routing." >&2
    exit 1
  fi
fi

backup_path="${BACKUP_ROOT}/$(date -u +%Y%m%dT%H%M%SZ)-$$/opencode.json"
tmp_path="$(mktemp "${TMPDIR:-/tmp}/temperance-opencode.XXXXXX")"
cleanup() { rm -f "$tmp_path"; }
trap cleanup EXIT

if [[ "$ACTION" == enable ]]; then
  jq --arg provider "$PROVIDER_ID" --arg base "$RELAY_BASE_URL" \
    '.provider = (.provider // {})
     | .provider[$provider] = {
         "npm": "@ai-sdk/openai-compatible",
         "options": {"baseURL": $base, "apiKey": "{env:OMNIROUTE_API_KEY}"},
         "models": {
           "temperance-auto": {
             "name": "Temperance · Automatic Classifier",
             "reasoning": true,
             "temperature": true,
             "tool_call": true,
             "limit": {"context": 200000, "input": 200000, "output": 384000}
           }
         }
       }' "$CONFIG_PATH" >"$tmp_path"
else
  jq --arg provider "$PROVIDER_ID" 'del(.provider[$provider])' "$CONFIG_PATH" >"$tmp_path"
fi

jq empty "$tmp_path" >/dev/null
if $DRY_RUN; then
  jq -c --arg action "$ACTION" --arg provider "$PROVIDER_ID" --arg base "$RELAY_BASE_URL" \
    '{action:$action,provider:$provider,relay_base_url:$base,config:.provider[$provider]}' "$tmp_path"
  exit 0
fi

mkdir -p "$(dirname "$backup_path")" "$STATE_DIR"
cp -p "$CONFIG_PATH" "$backup_path"
mv "$tmp_path" "$CONFIG_PATH"
chmod 600 "$CONFIG_PATH"

if [[ "$ACTION" == enable ]]; then
  jq -n --arg provider "$PROVIDER_ID" --arg model "$MODEL_ID" --arg base "$RELAY_BASE_URL" \
    '{schema_version:"temperance-opencode-relay-v1",managed:true,provider:$provider,model:$model,base_url:$base}' >"$STATE_PATH"
  chmod 600 "$STATE_PATH"
else
  rm -f "$STATE_PATH"
fi

echo "OpenCode relay configuration ${ACTION}d: $CONFIG_PATH"
echo "Backup: $backup_path"
if [[ "$ACTION" == enable ]]; then
  echo "Automatic model: ${PROVIDER_ID}/${MODEL_ID}"
  echo "Direct models remain under omniroute at $DIRECT_BASE_URL"
fi
