#!/usr/bin/env bash
# Sandbox test for package/adapters/kimi/UserPromptSubmit.hook.sh: sidecar
# write, telemetry append, and the hard contract — always exit 0 with empty
# stdout, across malformed stdin and unwritable state dirs.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/package/adapters/kimi/UserPromptSubmit.hook.sh"
TMP="$(mktemp -d)"
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
fail=0
check() { if [[ "$2" == "$3" ]]; then echo "ok - $1"; else echo "FAIL - $1: exp[$2] got[$3]"; fail=1; fi; }

run_hook() { # $1=payload-file -> sets RUN_EXIT / RUN_STDOUT_BYTES
  set +e
  env HOME="$TMP/home" TEMPERANCE_KIMI_STATE="${STATE_DIR}" bash "$HOOK" <"$1" >"$TMP/stdout.txt" 2>/dev/null
  RUN_EXIT=$?
  set -e
  RUN_STDOUT_BYTES="$(wc -c <"$TMP/stdout.txt" | tr -d ' ')"
}
set -e

mkdir -p "$TMP/home"
STATE_DIR="$TMP/home/.temperance_engine/kimi"
SIDECAR="$STATE_DIR/session-context.json"
TELEMETRY="$TMP/home/.claude/MEMORY/OBSERVABILITY/mode-classifier.jsonl"

# ── happy path ──────────────────────────────────────────────────────────────
printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"sess-1","cwd":"/tmp/project","prompt":"  refactor the router  "}' >"$TMP/p1.json"
run_hook "$TMP/p1.json"
check "exit 0" "0" "$RUN_EXIT"
check "empty stdout" "0" "$RUN_STDOUT_BYTES"
jq -e '.schema_version == "temperance-kimi-session-v1" and .session_id == "sess-1" and .cwd == "/tmp/project" and (.ts | type == "number") and (.prompt_hash | length == 16)' "$SIDECAR" >/dev/null \
  && echo "ok - sidecar schema and fields" || { echo "FAIL - sidecar wrong"; fail=1; }
check "sidecar single line" "1" "$(wc -l <"$SIDECAR" | tr -d ' ')"
check "sidecar mode 600" "600" "$(stat -f '%Lp' "$SIDECAR" 2>/dev/null || stat -c '%a' "$SIDECAR")"
# hash matches the relay's normalization: sha256 over the trimmed prompt.
expected_hash="$(printf '%s' 'refactor the router' | shasum -a 256 | cut -c1-16)"
check "prompt hash matches trimmed sha256" "$expected_hash" "$(jq -r '.prompt_hash' "$SIDECAR")"
check "telemetry single jsonl line" "1" "$(wc -l <"$TELEMETRY" | tr -d ' ')"
jq -e '.surface == "kimi" and .source == "temperance-kimi-hook"' "$TELEMETRY" >/dev/null \
  && echo "ok - telemetry line tagged kimi" || { echo "FAIL - telemetry wrong"; fail=1; }

# ── malformed stdin: exit 0, prior sidecar intact ───────────────────────────
printf 'not json at all' >"$TMP/p2.json"
run_hook "$TMP/p2.json"
check "malformed exit 0" "0" "$RUN_EXIT"
check "malformed empty stdout" "0" "$RUN_STDOUT_BYTES"
check "malformed leaves sidecar intact" "/tmp/project" "$(jq -r '.cwd' "$SIDECAR")"

# ── missing cwd: exit 0, nothing written ────────────────────────────────────
printf '%s' '{"prompt":"no cwd here"}' >"$TMP/p3.json"
rm -f "$SIDECAR"
run_hook "$TMP/p3.json"
check "no-cwd exit 0" "0" "$RUN_EXIT"
test ! -e "$SIDECAR" && echo "ok - no-cwd writes no sidecar" || { echo "FAIL - sidecar written without cwd"; fail=1; }

# ── unwritable state dir: exit 0, empty stdout ──────────────────────────────
mkdir -p "$TMP/ro"
chmod 500 "$TMP/ro"
STATE_DIR="$TMP/ro/state"
run_hook "$TMP/p1.json"
check "unwritable exit 0" "0" "$RUN_EXIT"
check "unwritable empty stdout" "0" "$RUN_STDOUT_BYTES"

exit "$fail"
