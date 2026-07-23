#!/usr/bin/env bash
# Opt the Kimi desktop app's daimon runtime into the Temperance automatic
# provider. The daimon runtime shares kimi-cli's TOML config schema, so this is
# a thin parameterization of configure-kimi-relay.sh:
#   - config: daimon-share/config.toml (app-managed; may be regenerated on app
#     update -- the state marker records config_sha256 so temperance-doctor can
#     flag drift, and re-running enable is idempotent recovery)
#   - hook copy: installed under ~/.temperance_engine (NOT inside the app dir)
#     so it survives app updates and volume unmounts
#   - state marker: kimi-desktop-provider.json (temperance-kimi-desktop-relay-v1)
#
# The daimon config carries a plaintext api_key: this wrapper (and the core
# script) never prints config contents -- only paths and key names.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export TEMPERANCE_KIMI_CONFIG="${TEMPERANCE_KIMI_DESKTOP_CONFIG:-${HOME}/Library/Application Support/kimi-desktop/daimon-share/config.toml}"
export TEMPERANCE_KIMI_STATE_NAME="kimi-desktop-provider.json"
export TEMPERANCE_KIMI_SCHEMA="temperance-kimi-desktop-relay-v1"
export TEMPERANCE_KIMI_HOOK_PATH="${TEMPERANCE_KIMI_DESKTOP_HOOK_PATH:-${TEMPERANCE_STATE_DIR:-${HOME}/.temperance_engine}/kimi/hooks/temperance-user-prompt-submit.sh}"
export TEMPERANCE_KIMI_RECORD_SHA=1

exec bash "${SCRIPT_DIR}/configure-kimi-relay.sh" "$@"
