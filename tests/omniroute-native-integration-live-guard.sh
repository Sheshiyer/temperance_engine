#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT_DIR/tests/omniroute-native-integration.sh"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/omniroute-native-live-guard.XXXXXX")"
trap 'rm -rf "$TEMP_ROOT"' EXIT

HOME_ROOT="$TEMP_ROOT/home"
mkdir -p "$HOME_ROOT"

default_output="$TEMP_ROOT/default.out"
if ! env HOME="$HOME_ROOT" PATH="$PATH" TEMPERANCE_ALLOW_LIVE_INSPECTION=0 bash "$TARGET" >"$default_output" 2>&1; then
  cat "$default_output" >&2
  printf '%s\n' "default fixture-only native integration unexpectedly failed" >&2
  exit 1
fi
grep -Fq "SKIP - optional live OmniRoute inspection skipped: set TEMPERANCE_ALLOW_LIVE_INSPECTION=1 to enable" "$default_output"
if grep -Fq "FAIL - optional live OmniRoute listeners are loopback-only" "$default_output"; then
  cat "$default_output" >&2
  printf '%s\n' "fixture-only native integration evaluated a listener" >&2
  exit 1
fi
printf '%s\n' "ok - native integration skips operator runtime inspection by default"

fixture_bin="$TEMP_ROOT/bin"
mkdir -p "$fixture_bin"
printf '%s\n' '#!/usr/bin/env sh' 'printf "%s\n" "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME" "node 1 fixture 1u IPv4 0x0 0t0 TCP *:20128 (LISTEN)"' > "$fixture_bin/lsof"
chmod 700 "$fixture_bin/lsof"

enabled_output="$TEMP_ROOT/enabled.out"
if env HOME="$HOME_ROOT" PATH="$fixture_bin:$PATH" TEMPERANCE_ALLOW_LIVE_INSPECTION=1 OMNIROUTE_DB_PATH="$TEMP_ROOT/missing.sqlite" OMNIROUTE_QUICK_TUNNEL_STATE="$TEMP_ROOT/missing.json" bash "$TARGET" >"$enabled_output" 2>&1; then
  cat "$enabled_output" >&2
  printf '%s\n' "opted-in synthetic non-loopback listener unexpectedly passed" >&2
  exit 1
fi
grep -Fq "FAIL - optional live OmniRoute listeners are loopback-only" "$enabled_output"
if grep -Fq "SKIP - optional live OmniRoute inspection skipped: set TEMPERANCE_ALLOW_LIVE_INSPECTION=1 to enable" "$enabled_output"; then
  cat "$enabled_output" >&2
  printf '%s\n' "opted-in native integration did not exercise listener guard" >&2
  exit 1
fi
printf '%s\n' "ok - native integration rejects non-loopback listeners when explicitly enabled"

loopback_bin="$TEMP_ROOT/loopback-bin"
mkdir -p "$loopback_bin"
printf '%s\n' '#!/usr/bin/env sh' 'printf "%s\n" "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME" "node 1 fixture 1u IPv4 0x0 0t0 TCP 127.0.0.1:20128 (LISTEN)"' > "$loopback_bin/lsof"
chmod 700 "$loopback_bin/lsof"
for field in url publicUrl apiUrl; do
  state="$TEMP_ROOT/tunnel-$field.json"
  printf '{"status":"stopped","pid":null,"url":"","%s":"https://exposed.trycloudflare.com"}\n' "$field" > "$state"
  tunnel_output="$TEMP_ROOT/tunnel-$field.out"
  env HOME="$HOME_ROOT" PATH="$loopback_bin:$PATH" TEMPERANCE_ALLOW_LIVE_INSPECTION=1 OMNIROUTE_DB_PATH="$TEMP_ROOT/missing.sqlite" OMNIROUTE_QUICK_TUNNEL_STATE="$state" bash "$TARGET" >"$tunnel_output" 2>&1 || true
  if ! grep -Fq "FAIL - optional live Quick Tunnel state is stopped and cleared" "$tunnel_output"; then
    cat "$tunnel_output" >&2
    printf '%s\n' "a stopped Quick Tunnel state with a live $field passed as cleared" >&2
    exit 1
  fi
done
cleared="$TEMP_ROOT/tunnel-cleared.json"
printf '{"status":"stopped","pid":null,"url":"","publicUrl":"","apiUrl":""}\n' > "$cleared"
cleared_output="$TEMP_ROOT/tunnel-cleared.out"
env HOME="$HOME_ROOT" PATH="$loopback_bin:$PATH" TEMPERANCE_ALLOW_LIVE_INSPECTION=1 OMNIROUTE_DB_PATH="$TEMP_ROOT/missing.sqlite" OMNIROUTE_QUICK_TUNNEL_STATE="$cleared" bash "$TARGET" >"$cleared_output" 2>&1 || true
grep -Fq "ok - optional live Quick Tunnel state is stopped and cleared" "$cleared_output"
printf '%s\n' "ok - live Quick Tunnel probe treats url, publicUrl and apiUrl as a live tunnel"
