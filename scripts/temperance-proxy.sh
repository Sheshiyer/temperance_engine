#!/usr/bin/env bash
# Local lifecycle wrapper for the Temperance OpenAI-compatible relay.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${TEMPERANCE_STATE_DIR:-${HOME}/.temperance_engine/state}"
PID_FILE="${TEMPERANCE_PROXY_PID_FILE:-${STATE_DIR}/openai-proxy.pid}"
LOG_FILE="${TEMPERANCE_PROXY_LOG:-${STATE_DIR}/openai-proxy.log}"
PORT="${TEMPERANCE_PROXY_PORT:-20129}"

mkdir -p "$STATE_DIR"

running_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s\n' "$pid"
}

start() {
  if pid="$(running_pid)"; then
    echo "Temperance OpenAI proxy already running (pid $pid, port $PORT)"
    return 0
  fi
  : > "$LOG_FILE"
  chmod 600 "$LOG_FILE"
  nohup env TEMPERANCE_PROXY_PORT="$PORT" TEMPERANCE_PROXY_LOG="$STATE_DIR/openai-proxy.jsonl" \
    bun run "$ROOT_DIR/package/router/temperance-openai-proxy.ts" \
    >>"$LOG_FILE" 2>&1 < /dev/null &
  local pid=$!
  printf '%s\n' "$pid" > "$PID_FILE"
  chmod 600 "$PID_FILE"
  sleep 0.2
  if ! kill -0 "$pid" 2>/dev/null; then
    cat "$LOG_FILE" >&2
    rm -f "$PID_FILE"
    return 1
  fi
  echo "Started Temperance OpenAI proxy (pid $pid, http://127.0.0.1:$PORT)"
}

stop() {
  local pid
  if ! pid="$(running_pid)"; then
    rm -f "$PID_FILE"
    echo "Temperance OpenAI proxy is not running"
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  for _ in {1..20}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "Stopped Temperance OpenAI proxy (pid $pid)"
}

status() {
  local pid
  if pid="$(running_pid)"; then
    echo "running pid=$pid port=$PORT"
    curl -fsS --connect-timeout 1 "http://127.0.0.1:$PORT/health"
    return 0
  fi
  echo "stopped port=$PORT"
  return 1
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  *) echo "usage: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
