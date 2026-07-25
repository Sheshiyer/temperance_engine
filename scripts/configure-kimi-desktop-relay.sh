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

# Preflight: on Kimi.app 3.1.5 / daimon-bundle 0.5.49 the daimon regenerates BOTH
# desktop configs from a template on every launch (not merely on app update), and
# its agent kernel loads daimon/runtime/kimi-code/config.toml -- not the file this
# script writes. Enabling still "succeeds" and then does nothing, so warn loudly
# rather than report a success the next app start silently undoes.
# TEMPERANCE_KIMI_DESKTOP_SKIP_PREFLIGHT=1 bypasses (e.g. an older app build).
if [[ "${TEMPERANCE_KIMI_DESKTOP_SKIP_PREFLIGHT:-0}" != "1" ]]; then
  daimon_config="${TEMPERANCE_KIMI_DAIMON_CONFIG:-${HOME}/Library/Application Support/kimi-desktop/daimon-share/daimon/config.json}"
  if [[ -f "$daimon_config" ]] && command -v jq >/dev/null 2>&1; then
    agent_file="$(jq -r '.agents.defaults.agentFile // empty' "$daimon_config" 2>/dev/null || true)"
    if [[ -n "$agent_file" && "$agent_file" != "$TEMPERANCE_KIMI_CONFIG" ]]; then
      cat >&2 <<WARN
warning: the Kimi desktop app loads its agent config from
  $agent_file
but this script writes
  $TEMPERANCE_KIMI_CONFIG
On app 3.1.5 that makes the desktop lane INERT, and the daimon rewrites both
files from a template on every launch, so this change will not persist.
Do not simply point TEMPERANCE_KIMI_DESKTOP_CONFIG at the agentFile: the
agent-core kernel has no openai_legacy provider type and no custom_headers, and
carries strict schemas, so writing there can break app startup.
See docs/kimi-surface.md. Continuing anyway.
WARN
    fi
  fi
fi

exec bash "${SCRIPT_DIR}/configure-kimi-relay.sh" "$@"
