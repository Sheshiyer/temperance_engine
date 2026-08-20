#!/usr/bin/env bash
# Install the Manifest visual operator console as a supervised loopback service.

set -euo pipefail

LABEL="com.temperance.engine.manifest-console"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
STATE_DIR="${TEMPERANCE_MANIFEST_STATE_DIR:-${HOME}/.temperance_engine/state/manifest}"
LOG_DIR="${STATE_DIR}/logs"
PORT="${TEMPERANCE_MANIFEST_CONSOLE_PORT:-5173}"
BRIDGE_URL="${TEMPERANCE_MANIFEST_BRIDGE_URL:-http://127.0.0.1:8766}"
CONSOLE_ROOT="${MANIFEST_CONSOLE_ROOT:-${TEMPERANCE_ENGINE_ROOT:-${HOME}/.temperance_engine/product}/package/manifest-zone}"
NPM_BIN="$(command -v npm)"

require_console() {
  [[ -x "$NPM_BIN" ]] && [[ -f "$CONSOLE_ROOT/package.json" ]] && [[ -x "$CONSOLE_ROOT/node_modules/.bin/vite" ]] || {
    echo "Manifest console dependencies are unavailable at $CONSOLE_ROOT; run npm install there first" >&2
    return 1
  }
}

health() {
  curl -fsS --connect-timeout 1 --max-time 1 "http://127.0.0.1:${PORT}/" 2>/dev/null | grep -q '<div id="root">'
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

wait_for_health() { local attempt; for attempt in {1..30}; do health && return 0; sleep 0.25; done; return 1; }

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
    <string>VITE_MANIFEST_BRIDGE_URL=${BRIDGE_URL}</string>
    <string>${NPM_BIN}</string><string>run</string><string>dev</string><string>--</string>
    <string>--host</string><string>127.0.0.1</string><string>--port</string><string>${PORT}</string><string>--strictPort</string>
  </array>
  <key>WorkingDirectory</key><string>${CONSOLE_ROOT}</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${LOG_DIR}/console.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/console.log</string>
</dict></plist>
EOF
  chmod 600 "$PLIST_PATH"; plutil -lint "$PLIST_PATH" >/dev/null
}

install_agent() {
  require_console; mkdir -p "$PLIST_DIR" "$LOG_DIR"
  local backup=""; if [[ -f "$PLIST_PATH" ]]; then backup="${PLIST_PATH}.bak.$(date +%Y%m%d-%H%M%S)-$$"; cp -p "$PLIST_PATH" "$backup"; fi
  if ! write_plist || ! bootstrap_agent || ! wait_for_health; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    if [[ -n "$backup" ]]; then cp -p "$backup" "$PLIST_PATH"; bootstrap_agent || true; else rm -f "$PLIST_PATH"; fi
    echo "Manifest console promotion failed; prior LaunchAgent bytes were restored" >&2; return 1
  fi
  echo "Installed ${LABEL}"; echo "Console: http://127.0.0.1:${PORT}"; echo "Bridge: ${BRIDGE_URL}"
}

status_agent() {
  local launchd="not-loaded" health_state="offline"
  launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && launchd="loaded"
  health && health_state="ready"
  printf '{"service":"temperance-manifest-console","launchd":"%s","health":"%s","url":"http://127.0.0.1:%s","bridge_url":"%s","root":"%s"}\n' "$launchd" "$health_state" "$PORT" "$BRIDGE_URL" "$CONSOLE_ROOT"
  [[ "$launchd" == "loaded" && "$health_state" == "ready" ]]
}

logs_agent() { local count="${2:-80}"; [[ "$count" =~ ^[0-9]+$ ]] || { echo "log count must be numeric" >&2; return 2; }; tail -n "$count" "${LOG_DIR}/console.log" 2>/dev/null || true; }
uninstall_agent() { launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; if [[ -f "$PLIST_PATH" ]]; then mv "$PLIST_PATH" "${PLIST_PATH}.removed.$(date +%Y%m%d-%H%M%S)"; fi; echo "Unloaded ${LABEL}; plist retained with timestamped .removed suffix"; }

case "${1:-status}" in
  install) install_agent ;;
  status) status_agent ;;
  logs) logs_agent ;;
  uninstall) uninstall_agent ;;
  *) echo "usage: $0 {install|status|logs [N]|uninstall}" >&2; exit 2 ;;
esac
