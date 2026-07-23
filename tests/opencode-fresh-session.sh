#!/usr/bin/env bash
# ISC-121 regression probe: a fresh OpenCode CLI session completes an automatic
# model request through the Temperance relay. This is a live client-integration
# check, so it skips gracefully whenever the local OpenCode CLI or the relay is
# unavailable (CI, fresh machines, uninstalled runtime).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCODE_BIN="${OPENCODE_BIN:-$HOME/.opencode/bin/opencode}"
RELAY_HEALTH="${TEMPERANCE_RELAY_HEALTH_URL:-http://127.0.0.1:20129/health}"
DECISION_LOG="${TEMPERANCE_PROXY_DECISION_LOG:-$HOME/.temperance_engine/state/openai-proxy.jsonl}"
CANARY="TEMPERANCE_OPENCODE_OK"

if [[ ! -x "$OPENCODE_BIN" ]]; then
  printf 'skip: opencode CLI not found at %s\n' "$OPENCODE_BIN"
  exit 0
fi

if ! curl -fsS -m 5 "$RELAY_HEALTH" >/dev/null 2>&1; then
  printf 'skip: temperance relay not healthy at %s\n' "$RELAY_HEALTH"
  exit 0
fi

OUT="$(cd "$ROOT_DIR" && "$OPENCODE_BIN" run -m temperance/temperance-auto \
  "Reply with exactly: $CANARY" 2>/dev/null || true)"

if [[ "$OUT" != *"$CANARY"* ]]; then
  printf 'fail: canary %s missing from opencode output\n' "$CANARY" >&2
  exit 1
fi

# The decision log must contain a real (non-test) opencode surface entry.
if [[ -f "$DECISION_LOG" ]]; then
  if ! grep -q '"surface":"opencode"' "$DECISION_LOG" \
    || ! grep '"surface":"opencode"' "$DECISION_LOG" | grep -qv 'rp_test'; then
    printf 'fail: no real surface:opencode entry in %s\n' "$DECISION_LOG" >&2
    exit 1
  fi
fi

printf 'ok: opencode fresh-session relay probe (ISC-121)\n'
