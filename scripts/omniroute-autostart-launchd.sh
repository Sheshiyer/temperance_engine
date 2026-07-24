#!/usr/bin/env bash
set -euo pipefail

# Manage boot persistence for the local OmniRoute server via a LaunchAgent.
# OmniRoute upstream ships autostart only for Linux (systemd user service);
# on macOS the router otherwise stays down after a reboot until someone
# manually runs `omniroute serve --daemon`. This script closes that gap.
#
# Usage:
#   scripts/omniroute-autostart-launchd.sh install    # write plist, stop any manual daemon, bootstrap agent
#   scripts/omniroute-autostart-launchd.sh uninstall  # bootout agent, retire plist to .removed.<ts>
#   scripts/omniroute-autostart-launchd.sh status     # report agent + API health
#
# Discipline: never deletes state, backs up an existing plist before
# overwrite, verifies API health after install, and leaves a manually
# started daemon untouched until the agent is confirmed healthy.

USER_NAME="${USER:-$(id -un)}"
LABEL="com.temperance.engine.omniroute"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.temperance_engine/logs"
OUT_LOG="$LOG_DIR/omniroute.out.log"
ERR_LOG="$LOG_DIR/omniroute.err.log"
BASE_URL="${TEMPERANCE_OMNIROUTE_ADMIN_URL:-http://127.0.0.1:20128}"
BASE_URL="${BASE_URL%/}"
DOMAIN="gui/$(id -u)"

OMNIROUTE_BIN="$(command -v omniroute || true)"
[ -n "$OMNIROUTE_BIN" ] || { echo "omniroute CLI not found on PATH" >&2; exit 1; }

usage() {
  sed -n '2,13p' "$0" >&2
  exit 2
}

api_health() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$BASE_URL/v1/models" \
    -H "Authorization: Bearer $1" 2>/dev/null || echo "000"
}

agent_pid() {
  launchctl list 2>/dev/null | awk -v label="$LABEL" '$3 == label { print $1 }'
}

write_plist() {
  mkdir -p "$LOG_DIR"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$OMNIROUTE_BIN</string>
    <string>serve</string>
    <string>--no-open</string>
    <string>--no-tray</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>StandardOutPath</key>
  <string>$OUT_LOG</string>
  <key>StandardErrorPath</key>
  <string>$ERR_LOG</string>
</dict>
</plist>
PLIST
  chmod 644 "$PLIST"
}

install_agent() {
  local ts backup
  ts="$(date -u +%Y%m%d-%H%M%S)"

  if [ -f "$PLIST" ]; then
    backup="$PLIST.bak.$ts"
    cp "$PLIST" "$backup"
    echo "existing plist backed up to $backup"
  fi

  write_plist
  echo "plist written: $PLIST"

  # If the agent is already loaded, bootout before re-bootstrap.
  if [ -n "$(agent_pid)" ] || launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  fi

  # Stop a manually started daemon so the launchd job owns the port.
  # Skip the stop if the running server is already this launchd job.
  if [ -z "$(agent_pid)" ] && curl -sS -o /dev/null --max-time 3 "$BASE_URL/" 2>/dev/null; then
    echo "stopping manually started OmniRoute daemon (agent takes over)..."
    "$OMNIROUTE_BIN" stop >/dev/null 2>&1 || true
    sleep 2
  fi

  launchctl bootstrap "$DOMAIN" "$PLIST"
  sleep 5

  local pid
  pid="$(agent_pid)"
  [ -n "$pid" ] && [ "$pid" != "-" ] || {
    echo "agent loaded but no running PID; check $ERR_LOG" >&2
    exit 1
  }
  echo "agent running (PID $pid)"

  local key health
  key="$(security find-generic-password -a "$USER_NAME" -s 'OmniRoute Temperance API Key' -w 2>/dev/null || true)"
  if [ -n "$key" ]; then
    health="$(api_health "$key")"
    [ "$health" = "200" ] || { echo "API health check failed (HTTP $health); check $ERR_LOG" >&2; exit 1; }
    echo "API healthy at $BASE_URL (HTTP 200)"
  else
    echo "warning: inference key not in keychain; skipped authenticated health check" >&2
  fi
}

uninstall_agent() {
  local ts
  ts="$(date -u +%Y%m%d-%H%M%S)"
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl bootout "$DOMAIN/$LABEL"
    echo "agent booted out: $LABEL"
  else
    echo "agent not loaded: $LABEL"
  fi
  if [ -f "$PLIST" ]; then
    mv "$PLIST" "$PLIST.removed.$ts"
    echo "plist retired: $PLIST.removed.$ts"
  fi
}

status_agent() {
  local pid
  pid="$(agent_pid)"
  if [ -n "$pid" ]; then
    echo "agent: loaded (PID $pid)"
  elif launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    echo "agent: loaded (not running)"
  else
    echo "agent: not loaded"
  fi
  [ -f "$PLIST" ] && echo "plist: $PLIST" || echo "plist: absent"
  local key
  key="$(security find-generic-password -a "$USER_NAME" -s 'OmniRoute Temperance API Key' -w 2>/dev/null || true)"
  if [ -n "$key" ]; then
    echo "api: HTTP $(api_health "$key") at $BASE_URL"
  fi
}

[ "${1:-}" = "install" ] && { install_agent; exit 0; }
[ "${1:-}" = "uninstall" ] && { uninstall_agent; exit 0; }
[ "${1:-}" = "status" ] && { status_agent; exit 0; }
usage
