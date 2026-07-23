#!/usr/bin/env bash
# Install the local Temperance proxy as a per-user macOS LaunchAgent.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.temperance.engine.openai-proxy"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
STATE_DIR="${TEMPERANCE_STATE_DIR:-${HOME}/.temperance_engine/state}"
PORT="${TEMPERANCE_PROXY_PORT:-20129}"
BUN_BIN="$(command -v bun)"
BIN_DIR="${HOME}/.temperance_engine/bin"
PROXY_SOURCE="${ROOT_DIR}/package/router/temperance-openai-proxy.ts"
PROXY_BIN="${BIN_DIR}/temperance-openai-proxy.ts"
ROUTER_DIR="${HOME}/.temperance_engine/router"
ROUTER_SOURCE_DIR="${ROOT_DIR}/package/router"
ROUTER_BIN="${ROUTER_DIR}/multi-backend-router.sh"
# The proxy statically imports ../enrich/index (relay-side kimi enrichment), so
# the deployed layout must mirror package/: bin/ and enrich/ as siblings.
ENRICH_DIR="${HOME}/.temperance_engine/enrich"
ENRICH_SOURCE_DIR="${ROOT_DIR}/package/enrich"

install_agent() {
  mkdir -p "$PLIST_DIR" "$STATE_DIR"
  mkdir -p "$BIN_DIR"
  mkdir -p "$ROUTER_DIR"
  for router_file in \
    multi-backend-router.sh classify-task.sh routing-policy.ts \
    omniroute-portfolios.ts omniroute-portfolios.json \
    omniroute-promotion.ts omniroute-promotion.schema.json; do
    if [[ -f "$ROUTER_DIR/$router_file" ]]; then
      cp -p "$ROUTER_DIR/$router_file" "$ROUTER_DIR/$router_file.bak.$(date +%Y%m%d-%H%M%S)"
    fi
    cp -p "$ROUTER_SOURCE_DIR/$router_file" "$ROUTER_DIR/$router_file"
  done
  chmod 700 "$ROUTER_BIN"
  if [[ -d "$ENRICH_DIR" ]]; then
    mv "$ENRICH_DIR" "$ENRICH_DIR.bak.$(date +%Y%m%d-%H%M%S)"
  fi
  cp -R "$ENRICH_SOURCE_DIR" "$ENRICH_DIR"
  chmod -R go-rwx "$ENRICH_DIR"
  if [[ -f "$PROXY_BIN" ]]; then
    cp -p "$PROXY_BIN" "$PROXY_BIN.bak.$(date +%Y%m%d-%H%M%S)"
  fi
  cp -p "$PROXY_SOURCE" "$PROXY_BIN"
  chmod 600 "$PROXY_BIN"
  if [[ -f "$PLIST_PATH" ]]; then
    cp -p "$PLIST_PATH" "$PLIST_PATH.bak.$(date +%Y%m%d-%H%M%S)"
  fi
  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BUN_BIN}</string>
    <string>run</string>
    <string>${PROXY_BIN}</string>
  </array>
  <key>WorkingDirectory</key><string>${HOME}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>TEMPERANCE_PROXY_PORT</key><string>${PORT}</string>
    <key>TEMPERANCE_PROXY_HOST</key><string>${TEMPERANCE_PROXY_HOST:-127.0.0.1}</string>
    <key>TEMPERANCE_PROXY_LOG</key><string>${STATE_DIR}/openai-proxy.jsonl</string>
    <key>TEMPERANCE_OMNIROUTE_BASE_URL</key><string>http://127.0.0.1:20128/v1</string>
    <key>TEMPERANCE_ROUTER_PATH</key><string>${ROUTER_BIN}</string>
  </dict>
  <key>StandardOutPath</key><string>${STATE_DIR}/openai-proxy.log</string>
  <key>StandardErrorPath</key><string>${STATE_DIR}/openai-proxy.log</string>
</dict>
</plist>
EOF
  chmod 600 "$PLIST_PATH"
  local domain="gui/$(id -u)"
  launchctl bootout "$domain/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$domain" "$PLIST_PATH"
  launchctl kickstart -k "$domain/$LABEL"
  echo "Installed $LABEL at $PLIST_PATH"
  echo "Proxy: http://127.0.0.1:$PORT"
}

uninstall_agent() {
  local domain="gui/$(id -u)"
  launchctl bootout "$domain/$LABEL" 2>/dev/null || true
  if [[ -f "$PLIST_PATH" ]]; then
    mv "$PLIST_PATH" "$PLIST_PATH.removed.$(date +%Y%m%d-%H%M%S)"
  fi
  echo "Unloaded $LABEL; plist retained as a timestamped .removed file"
}

status_agent() {
  launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null || {
    echo "$LABEL is not loaded"
    return 1
  }
}

case "${1:-status}" in
  install) install_agent ;;
  uninstall) uninstall_agent ;;
  status) status_agent ;;
  *) echo "usage: $0 {install|uninstall|status}" >&2; exit 2 ;;
esac
