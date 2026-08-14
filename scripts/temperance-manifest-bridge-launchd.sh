#!/usr/bin/env bash
# Install the local Manifest event plane as a supervised, loopback-only LaunchAgent.
# Hooks never fork this service; they only publish/probe and emit its receipt.

set -euo pipefail

ROOT_DIR="${TEMPERANCE_ENGINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LABEL="com.temperance.engine.manifest-bridge"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
STATE_DIR="${TEMPERANCE_MANIFEST_STATE_DIR:-${HOME}/.temperance_engine/state/manifest}"
LOG_DIR="${STATE_DIR}/logs"
PORT="${TEMPERANCE_MANIFEST_PORT:-8766}"
CLI_SOURCE="${ROOT_DIR}/package/manifest-bridge/src/cli.ts"
BUN_BIN="$(command -v bun)"

require_source() {
  [[ -x "$BUN_BIN" ]] && [[ -f "$CLI_SOURCE" ]] || {
    echo "Manifest bridge source or Bun is unavailable; no service was changed" >&2
    return 1
  }
}

health() {
  curl -fsS --connect-timeout 1 --max-time 1 "http://127.0.0.1:${PORT}/health" 2>/dev/null \
    | grep -q '"service":"temperance-manifest-bridge"'
}

bootstrap_agent() {
  local domain="gui/$(id -u)" attempt
  launchctl bootout "$domain/$LABEL" 2>/dev/null || true
  for attempt in 1 2 3; do
    if launchctl bootstrap "$domain" "$PLIST_PATH" 2>/dev/null; then
      launchctl kickstart -k "$domain/$LABEL" >/dev/null 2>&1 || true
      launchctl print "$domain/$LABEL" >/dev/null 2>&1 && return 0
    fi
    launchctl bootout "$domain/$LABEL" 2>/dev/null || true
    sleep 0.5
  done
  return 1
}

wait_for_health() {
  local attempt
  for attempt in {1..20}; do
    health && return 0
    sleep 0.25
  done
  return 1
}

write_plist() {
  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/env</string><string>-i</string>
    <string>PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <string>HOME=${HOME}</string>
    <string>TEMPERANCE_MANIFEST_STATE_DIR=${STATE_DIR}</string>
    <string>TEMPERANCE_MANIFEST_BRIDGE_URL=http://127.0.0.1:${PORT}</string>
    <string>${BUN_BIN}</string><string>run</string><string>${CLI_SOURCE}</string>
    <string>serve</string><string>--port</string><string>${PORT}</string><string>--no-watch</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT_DIR}/package/manifest-bridge</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${LOG_DIR}/bridge.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/bridge.log</string>
</dict></plist>
EOF
  chmod 600 "$PLIST_PATH"
  plutil -lint "$PLIST_PATH" >/dev/null
}

install_agent() {
  require_source
  mkdir -p "$PLIST_DIR" "$LOG_DIR"
  local backup=""; if [[ -f "$PLIST_PATH" ]]; then backup="${PLIST_PATH}.bak.$(date +%Y%m%d-%H%M%S)-$$"; cp -p "$PLIST_PATH" "$backup"; fi
  if ! write_plist || ! bootstrap_agent || ! wait_for_health; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    if [[ -n "$backup" ]]; then cp -p "$backup" "$PLIST_PATH"; bootstrap_agent || true; else rm -f "$PLIST_PATH"; fi
    echo "Manifest bridge promotion failed; prior LaunchAgent bytes were restored" >&2
    return 1
  fi
  echo "Installed ${LABEL}"
  echo "Manifest: http://127.0.0.1:${PORT}/health"
  echo "Logs: ${LOG_DIR}/bridge.log"
}

status_agent() {
  local launchd="not-loaded" health_state="offline"
  launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && launchd="loaded"
  health && health_state="ready"
  printf '{"service":"temperance-manifest-bridge","launchd":"%s","health":"%s","url":"http://127.0.0.1:%s/health","plist":"%s"}\n' "$launchd" "$health_state" "$PORT" "$PLIST_PATH"
  [[ "$launchd" == "loaded" && "$health_state" == "ready" ]]
}

uninstall_agent() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  if [[ -f "$PLIST_PATH" ]]; then mv "$PLIST_PATH" "${PLIST_PATH}.removed.$(date +%Y%m%d-%H%M%S)"; fi
  echo "Unloaded ${LABEL}; plist retained with timestamped .removed suffix"
}

case "${1:-status}" in
  install) install_agent ;;
  status) status_agent ;;
  uninstall) uninstall_agent ;;
  *) echo "usage: $0 {install|status|uninstall}" >&2; exit 2 ;;
esac
