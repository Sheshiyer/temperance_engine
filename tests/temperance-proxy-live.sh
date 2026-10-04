#!/usr/bin/env bash
# Live success-path probe for the local OpenCode relay against a deterministic
# OpenAI-compatible mock. This avoids depending on provider quota while still
# traversing the real router, relay, SSE transport, and tool-call payload.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOCK_PORT="${TEMPERANCE_TEST_MOCK_PORT:-22330}"
PROXY_PORT="${TEMPERANCE_TEST_PROXY_PORT:-22331}"
STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/temperance-proxy-live.XXXXXX")"
# The mocked success path must not inherit a real operator's selected policy
# or append its synthetic traffic to the operator's runtime log.
export TEMPERANCE_STATE="$STATE_DIR/temperance-state"
export TEMPERANCE_STATE_DIR="$STATE_DIR/runtime-state"
export TEMPERANCE_PROXY_LOG="$STATE_DIR/requests.jsonl"
# The proxy also reads Kimi session context from $HOME/.temperance_engine/kimi.
export TEMPERANCE_KIMI_STATE="$STATE_DIR/kimi"
unset TEMPERANCE_SESSION_POLICY
MOCK_LOG="$STATE_DIR/mock.log"
PROXY_LOG="$STATE_DIR/proxy.log"
# The proxy's default log; on a host checkout of ~/.temperance_engine it is in the repo.
HOST_LOG="$HOME/.temperance_engine/state/openai-proxy.jsonl"

cleanup() {
  kill "${PROXY_PID:-}" "${MOCK_PID:-}" 2>/dev/null || true
  rm -rf "$STATE_DIR"
}
trap cleanup EXIT

TEMPERANCE_MOCK_PORT="$MOCK_PORT" bun run "$ROOT_DIR/package/router/temperance-openai-proxy.mock.ts" >"$MOCK_LOG" 2>&1 &
MOCK_PID=$!
TEMPERANCE_OMNIROUTE_BASE_URL="http://127.0.0.1:${MOCK_PORT}/v1" \
TEMPERANCE_PROXY_PORT="$PROXY_PORT" \
TEMPERANCE_ROUTER_PATH="$ROOT_DIR/package/router/multi-backend-router.sh" \
TEMPERANCE_AUTO_READY=1 \
bun run "$ROOT_DIR/package/router/temperance-openai-proxy.ts" >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!

for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "http://127.0.0.1:${PROXY_PORT}/health" >/dev/null 2>&1 && break
  sleep 0.2
done

stream_headers="$STATE_DIR/stream.headers"
stream_body="$STATE_DIR/stream.body"
curl -fsS --max-time 10 -D "$stream_headers" \
  -H 'Content-Type: application/json' \
  --data '{"model":"temperance-auto","messages":[{"role":"user","content":"stream this"}],"stream":true,"max_tokens":8}' \
  "http://127.0.0.1:${PROXY_PORT}/v1/chat/completions" >"$stream_body"

tool_headers="$STATE_DIR/tool.headers"
tool_body="$STATE_DIR/tool.body"
curl -fsS --max-time 10 -D "$tool_headers" \
  -H 'Content-Type: application/json' \
  --data '{"model":"temperance-auto","messages":[{"role":"user","content":"use the tool"}],"tools":[{"type":"function","function":{"name":"write_file","parameters":{"type":"object"}}}],"stream":false,"max_tokens":8}' \
  "http://127.0.0.1:${PROXY_PORT}/v1/chat/completions" >"$tool_body"

grep -q 'MOCK_STREAM_OK' "$stream_body"
grep -q 'data: \[DONE\]' "$stream_body"
grep -qi '^X-Temperance-Correlation-ID:' "$stream_headers"
jq -e '.choices[0].message.tool_calls[0].function.name == "write_file"' "$tool_body" >/dev/null

echo "ok - automatic stream preserved SSE content and DONE marker"
echo "ok - automatic tool request preserved tool_calls payload"
echo "ok - automatic success path carried frozen routing headers"

test -s "$TEMPERANCE_PROXY_LOG"
# Check this test's own requests by correlation ID, not the operator log's
# size: a live relay on the host may log unrelated requests meanwhile.
correlation_id() { sed -n 's/^[Xx]-[Tt]emperance-[Cc]orrelation-[Ii][Dd]: *//p' "$1" | tr -d '\r' | head -n 1; }
for headers in "$stream_headers" "$tool_headers"; do
  id="$(correlation_id "$headers")"
  test -n "$id"
  grep -qF "$id" "$TEMPERANCE_PROXY_LOG"
  # `! grep` would not trip set -e, so fail explicitly.
  if [ -e "$HOST_LOG" ] && grep -qF "$id" "$HOST_LOG"; then
    echo "FAIL - request $id was logged to operator state $HOST_LOG" >&2
    exit 1
  fi
done
echo "ok - request log stays in the test state dir, not operator state"
