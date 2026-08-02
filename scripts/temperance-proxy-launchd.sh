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

canonical_auto_ready() {
  local normalized
  normalized="$(
    printf '%s' "${TEMPERANCE_AUTO_READY:-0}" \
      | tr '[:upper:]' '[:lower:]' \
      | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
  )"
  case "$normalized" in
    1|true|yes|on) printf '%s\n' 1 ;;
    ""|0|false|no|off) printf '%s\n' 0 ;;
    *)
      echo "Invalid TEMPERANCE_AUTO_READY value: expected 1/true/yes/on or 0/false/no/off" >&2
      return 2
      ;;
  esac
}

bootstrap_agent() {
  local domain="gui/$(id -u)" attempt
  launchctl bootout "$domain/$LABEL" 2>/dev/null || true
  for attempt in 1 2 3; do
    if launchctl bootstrap "$domain" "$PLIST_PATH" 2>/dev/null; then
      launchctl kickstart -k "$domain/$LABEL"
      launchctl print "$domain/$LABEL" >/dev/null
      return 0
    fi
    launchctl bootout "$domain/$LABEL" 2>/dev/null || true
    sleep 0.5
  done
  return 1
}

wait_for_health() {
  local attempt health
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    health="$(curl -fsS --connect-timeout 1 --max-time 1 "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
    if [[ "$health" == *'"service":"temperance-openai-proxy"'* ]]; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

install_agent() {
  local stamp proxy_existed=0 proxy_backup="" plist_existed=0 plist_backup=""
  local enrich_existed=0 enrich_backup="" router_file target backup index auto_ready
  local -a router_files router_existed router_backups
  auto_ready="$(canonical_auto_ready)" || return $?
  stamp="$(date +%Y%m%d-%H%M%S)-$$"
  router_files=(
    multi-backend-router.sh classify-task.sh routing-policy.ts
    omniroute-portfolios.ts omniroute-portfolios.json
    omniroute-promotion.ts omniroute-promotion.schema.json
  )
  mkdir -p "$PLIST_DIR" "$STATE_DIR" "$BIN_DIR" "$ROUTER_DIR"

  # Snapshot every existing target before changing any live byte. A failure in
  # this phase leaves the running LaunchAgent and its complete tree untouched.
  for ((index=0; index<${#router_files[@]}; index++)); do
    router_file="${router_files[index]}"
    target="$ROUTER_DIR/$router_file"
    backup="$target.bak.$stamp"
    if [[ -f "$target" ]]; then
      cp -p "$target" "$backup"
      router_existed[index]=1
      router_backups[index]="$backup"
    else
      router_existed[index]=0
      router_backups[index]=""
    fi
  done
  if [[ -d "$ENRICH_DIR" ]]; then
    enrich_existed=1
    enrich_backup="$ENRICH_DIR.bak.$stamp"
    cp -Rp "$ENRICH_DIR" "$enrich_backup"
  fi
  if [[ -f "$PROXY_BIN" ]]; then
    proxy_existed=1
    proxy_backup="$PROXY_BIN.bak.$stamp"
    cp -p "$PROXY_BIN" "$proxy_backup"
  fi
  if [[ -f "$PLIST_PATH" ]]; then
    plist_existed=1
    plist_backup="$PLIST_PATH.bak.$stamp"
    cp -p "$PLIST_PATH" "$plist_backup"
  fi

  restore_previous() {
    local restore_failed=0
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    for ((index=0; index<${#router_files[@]}; index++)); do
      target="$ROUTER_DIR/${router_files[index]}"
      if [[ "${router_existed[index]}" == 1 ]]; then
        cp -p "${router_backups[index]}" "$target" || restore_failed=1
      else
        rm -f "$target" || restore_failed=1
      fi
    done
    rm -rf "$ENRICH_DIR" || restore_failed=1
    if [[ "$enrich_existed" == 1 ]]; then
      cp -Rp "$enrich_backup" "$ENRICH_DIR" || restore_failed=1
    fi
    if [[ "$proxy_existed" == 1 ]]; then
      cp -p "$proxy_backup" "$PROXY_BIN" || restore_failed=1
    else
      rm -f "$PROXY_BIN" || restore_failed=1
    fi
    if [[ "$plist_existed" == 1 ]]; then
      cp -p "$plist_backup" "$PLIST_PATH" || restore_failed=1
    else
      rm -f "$PLIST_PATH" || restore_failed=1
    fi
    return "$restore_failed"
  }

  recover_previous() {
    if ! restore_previous; then
      echo "Exact byte restoration failed" >&2
      return 1
    fi
    if [[ "$plist_existed" == 1 ]]; then
      if bootstrap_agent && wait_for_health; then
        echo "Restored the previous proxy and LaunchAgent" >&2
        return 0
      fi
      echo "Previous bytes restored, but LaunchAgent recovery failed" >&2
      return 1
    fi
    return 0
  }

  apply_install_files() {
    for ((index=0; index<${#router_files[@]}; index++)); do
      router_file="${router_files[index]}"
      cp -p "$ROUTER_SOURCE_DIR/$router_file" "$ROUTER_DIR/$router_file" || return 1
    done
    chmod 700 "$ROUTER_BIN" || return 1
    rm -rf "$ENRICH_DIR" || return 1
    cp -Rp "$ENRICH_SOURCE_DIR" "$ENRICH_DIR" || return 1
    chmod -R go-rwx "$ENRICH_DIR" || return 1
    cp -p "$PROXY_SOURCE" "$PROXY_BIN" || return 1
    chmod 600 "$PROXY_BIN" || return 1
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
    <key>TEMPERANCE_AUTO_READY</key><string>${auto_ready}</string>
    <key>TEMPERANCE_OMNIROUTE_BASE_URL</key><string>http://127.0.0.1:20128/v1</string>
    <key>TEMPERANCE_ROUTER_PATH</key><string>${ROUTER_BIN}</string>
  </dict>
  <key>StandardOutPath</key><string>${STATE_DIR}/openai-proxy.log</string>
  <key>StandardErrorPath</key><string>${STATE_DIR}/openai-proxy.log</string>
</dict>
</plist>
EOF
    chmod 600 "$PLIST_PATH" || return 1
  }

  if ! apply_install_files; then
    echo "Proxy file promotion failed; restoring exact pre-install bytes" >&2
    recover_previous || true
    return 1
  fi
  if ! bootstrap_agent || ! wait_for_health; then
    echo "Proxy service promotion failed; restoring exact pre-install bytes" >&2
    recover_previous || true
    return 1
  fi
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
