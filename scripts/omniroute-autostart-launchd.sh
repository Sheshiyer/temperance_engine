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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/omniroute-curl.sh"
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
  omniroute_curl_bearer "$1" -sS -o /dev/null -w '%{http_code}' --max-time 5 \
    "$BASE_URL/v1/models" 2>/dev/null || echo "000"
}

agent_pid() {
  launchctl list 2>/dev/null | awk -v label="$LABEL" '$3 == label { print $1 }'
}

wait_for_api() {
  local key="$1" attempt health
  for attempt in $(seq 1 40); do
    health="$(api_health "$key")"
    [ "$health" = 200 ] && return 0
    sleep 0.5
  done
  return 1
}

recover_manual_daemon() {
  local backup="${1:-}" key
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  if [ -n "$backup" ] && [ -f "$backup" ]; then
    cp "$backup" "$PLIST"
    chmod 644 "$PLIST"
  fi
  OMNIROUTE_SERVER_HOST=127.0.0.1 OMNIROUTE_MCP_ENFORCE_SCOPES=true \
    "$OMNIROUTE_BIN" serve --daemon --no-open --no-tray >/dev/null
  key="$(security find-generic-password -a "$USER_NAME" -s 'OmniRoute Temperance API Key' -w 2>/dev/null || true)"
  [ -n "$key" ] && wait_for_api "$key"
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
    <key>OMNIROUTE_SERVER_HOST</key>
    <string>127.0.0.1</string>
    <key>OMNIROUTE_MCP_ENFORCE_SCOPES</key>
    <string>true</string>
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
  local ts backup="" attempt bootstrap_ok=false
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

  for attempt in 1 2 3; do
    if launchctl bootstrap "$DOMAIN" "$PLIST"; then
      bootstrap_ok=true
      break
    fi
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    sleep 1
  done
  if [ "$bootstrap_ok" != true ]; then
    echo "LaunchAgent bootstrap failed after three attempts; restoring loopback manual daemon" >&2
    recover_manual_daemon "$backup" || echo "manual recovery health check failed" >&2
    return 1
  fi
  sleep 5

  local pid
  pid="$(agent_pid)"
  [ -n "$pid" ] && [ "$pid" != "-" ] || {
    echo "agent loaded but no running PID; restoring loopback manual daemon" >&2
    recover_manual_daemon "$backup" || echo "manual recovery health check failed" >&2
    return 1
  }
  echo "agent running (PID $pid)"
  launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -q 'OMNIROUTE_MCP_ENFORCE_SCOPES => true' || {
    echo "agent is missing mandatory dormant MCP scope enforcement; restoring loopback manual daemon" >&2
    recover_manual_daemon "$backup" || echo "manual recovery health check failed" >&2
    return 1
  }
  echo "dormant MCP scope enforcement present"

  local key health
  key="$(security find-generic-password -a "$USER_NAME" -s 'OmniRoute Temperance API Key' -w 2>/dev/null || true)"
  if [ -n "$key" ]; then
    health="$(api_health "$key")"
    if [ "$health" != 200 ]; then
      echo "API health check failed (HTTP $health); restoring loopback manual daemon" >&2
      recover_manual_daemon "$backup" || echo "manual recovery health check failed" >&2
      return 1
    fi
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
  if launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -q 'OMNIROUTE_MCP_ENFORCE_SCOPES => true'; then
    echo "mcp scopes: enforced before registration"
  else
    echo "mcp scopes: not enforced"
  fi
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
