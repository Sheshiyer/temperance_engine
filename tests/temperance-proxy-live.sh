#!/usr/bin/env bash
# Live success-path probe for the local OpenCode relay against a deterministic
# OpenAI-compatible mock. This avoids depending on provider quota while still
# traversing the real router, relay, SSE transport, and tool-call payload.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOCK_PORT="${TEMPERANCE_TEST_MOCK_PORT:-22330}"
PROXY_PORT="${TEMPERANCE_TEST_PROXY_PORT:-22331}"
# Reject unsafe inherited endpoints before starting a child or making HTTP.
valid_fixture_port() {
  local port="$1"
  [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] || return 1
  (( port >= 1024 && port <= 65535 )) || return 1
  case "$port" in 20128|20129|8770|39337) return 1 ;; esac
}
if ! valid_fixture_port "$MOCK_PORT" || ! valid_fixture_port "$PROXY_PORT" \
    || [[ "$MOCK_PORT" == "$PROXY_PORT" ]]; then
  echo "HOLD - distinct unprivileged fixture ports required; protected service ports excluded" >&2
  exit 1
fi
STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/temperance-proxy-live.XXXXXX")"
# The mocked success path must not inherit a real operator's selected policy
# or append its synthetic traffic to the operator's runtime log.
export TEMPERANCE_STATE="$STATE_DIR/temperance-state"
export TEMPERANCE_STATE_DIR="$STATE_DIR/runtime-state"
export TEMPERANCE_PROXY_LOG="$STATE_DIR/requests.jsonl"
unset TEMPERANCE_SESSION_POLICY
MOCK_LOG="$STATE_DIR/mock.log"
PROXY_LOG="$STATE_DIR/proxy.log"

# Only these two direct background children belong to this fixture. No pidfile,
# process-group signal or unrelated/stale PID cleanup is permitted here.
MOCK_PID=""
PROXY_PID=""
owned_job_active() {
  local wanted="$1" current
  jobs -pr > "$STATE_DIR/active-jobs" || return 2
  jobs -ps >> "$STATE_DIR/active-jobs" || return 2
  while IFS= read -r current; do
    [[ "$current" == "$wanted" ]] && return 0
  done < "$STATE_DIR/active-jobs"
  return 1
}
cleanup() {
  local primary=$? cleanup_failed=0 pid attempt child_exit state
  trap - EXIT
  trap '' INT TERM HUP
  set +e
  for pid in "$PROXY_PID" "$MOCK_PID"; do
    [[ -n "$pid" ]] || continue
    owned_job_active "$pid"; state=$?
    if (( state == 0 )); then kill -TERM "$pid" 2>/dev/null; fi
    if (( state == 2 )); then cleanup_failed=1; fi
  done
  for pid in "$PROXY_PID" "$MOCK_PID"; do
    [[ -n "$pid" ]] || continue
    attempt=0
    owned_job_active "$pid"; state=$?
    while (( state == 0 && attempt < 50 )); do
      sleep 0.1; attempt=$((attempt+1))
      owned_job_active "$pid"; state=$?
    done
    if (( state == 0 )); then
      echo "HOLD - owned child $pid required forced kill" >&2
      cleanup_failed=1
      kill -KILL "$pid" 2>/dev/null
      attempt=0
      owned_job_active "$pid"; state=$?
      while (( state == 0 && attempt < 50 )); do
        sleep 0.1; attempt=$((attempt+1))
        owned_job_active "$pid"; state=$?
      done
    fi
    if (( state != 1 )); then
      echo "HOLD - owned child $pid reap unproved; exact-child runner reconciliation required" >&2
      cleanup_failed=1
      continue
    fi
    wait "$pid"; child_exit=$?
    if [[ "$child_exit" == 127 ]]; then
      echo "HOLD - wait could not establish owned child $pid exit" >&2
      cleanup_failed=1
    elif ! printf 'owned-child %s reaped exit=%s\n' "$pid" "$child_exit" >> "$STATE_DIR/cleanup.log"; then
      cleanup_failed=1
    fi
  done
  (( primary != 0 )) && exit "$primary"
  (( cleanup_failed == 0 )) || exit 1
  exit 0
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
# Bounds cover responsive direct children. SIGKILL/host death or an
# uninterruptible child can defeat cleanup; no universal no-orphan claim.

TEMPERANCE_MOCK_PORT="$MOCK_PORT" bun run "$ROOT_DIR/package/router/temperance-openai-proxy.mock.ts" >"$MOCK_LOG" 2>&1 &
MOCK_PID=$!
TEMPERANCE_OMNIROUTE_BASE_URL="http://127.0.0.1:${MOCK_PORT}/v1" \
TEMPERANCE_PROXY_PORT="$PROXY_PORT" \
TEMPERANCE_PROXY_HOST="127.0.0.1" \
TEMPERANCE_ROUTER_PATH="$ROOT_DIR/package/router/multi-backend-router.sh" \
TEMPERANCE_AUTO_READY=1 \
bun run "$ROOT_DIR/package/router/temperance-openai-proxy.ts" >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!

require_owned_servers() {
  if ! owned_job_active "$MOCK_PID" || ! owned_job_active "$PROXY_PID"; then
    echo "HOLD - both recorded fixture server jobs must remain active" >&2
    return 1
  fi
}
# These exact lines are emitted only after each source's Bun.serve returns.
# Fresh per-run logs plus live direct jobs distinguish a bind failure from an
# unrelated listener answering a request. This is controlled fixture evidence,
# not hostile same-user/ABA protection or an atomic port reservation.
mock_bound="Temperance mock gateway listening on $MOCK_PORT"
proxy_bound="the Caduceus: Temperance OpenAI proxy listening on http://127.0.0.1:$PROXY_PORT"
bound=0
attempt=0
while (( attempt < 100 )); do
  require_owned_servers || exit 1
  if grep -Fxq -- "$mock_bound" "$MOCK_LOG" \
      && grep -Fxq -- "$proxy_bound" "$PROXY_LOG"; then
    bound=1
    break
  fi
  sleep 0.1
  attempt=$((attempt+1))
done
if (( bound != 1 )); then
  echo "HOLD - owned servers did not confirm both requested loopback bindings; no HTTP attempted" >&2
  exit 1
fi
require_owned_servers || exit 1
healthy=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  require_owned_servers || exit 1
  if curl -fsS --max-time 1 "http://127.0.0.1:${PROXY_PORT}/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 0.2
done
if (( healthy != 1 )); then
  echo "HOLD - owned proxy health request failed" >&2
  exit 1
fi

stream_headers="$STATE_DIR/stream.headers"
stream_body="$STATE_DIR/stream.body"
require_owned_servers || exit 1
curl -fsS --max-time 10 -D "$stream_headers" \
  -H 'Content-Type: application/json' \
  --data '{"model":"temperance-auto","messages":[{"role":"user","content":"stream this"}],"stream":true,"max_tokens":8}' \
  "http://127.0.0.1:${PROXY_PORT}/v1/chat/completions" >"$stream_body"

tool_body="$STATE_DIR/tool.body"
require_owned_servers || exit 1
curl -fsS --max-time 10 \
  -H 'Content-Type: application/json' \
  --data '{"model":"temperance-auto","messages":[{"role":"user","content":"use the tool"}],"tools":[{"type":"function","function":{"name":"write_file","parameters":{"type":"object"}}}],"stream":false,"max_tokens":8}' \
  "http://127.0.0.1:${PROXY_PORT}/v1/chat/completions" >"$tool_body"

require_owned_servers || exit 1
grep -q 'MOCK_STREAM_OK' "$stream_body"
grep -q 'data: \[DONE\]' "$stream_body"
grep -qi '^X-Temperance-Correlation-ID:' "$stream_headers"
jq -e '.choices[0].message.tool_calls[0].function.name == "write_file"' "$tool_body" >/dev/null

require_owned_servers || exit 1

echo "ok - automatic stream preserved SSE content and DONE marker"
echo "ok - automatic tool request preserved tool_calls payload"
echo "ok - automatic success path carried frozen routing headers"
