#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/temperance-proxy-launchd.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

FAKE_BIN="$TEST_ROOT/bin"
TEST_HOME="$TEST_ROOT/home"
STATE_FILE="$TEST_ROOT/bootstrap-count"
mkdir -p "$FAKE_BIN" "$TEST_HOME"

cat > "$FAKE_BIN/bun" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"ok":true,"service":"temperance-openai-proxy"}'
EOF

cat > "$FAKE_BIN/cp" <<'EOF'
#!/usr/bin/env bash
if [[ -n "${TEST_CP_FAIL_MATCH:-}" ]]; then
  for argument in "$@"; do
    if [[ "$argument" == *"$TEST_CP_FAIL_MATCH"* ]]; then exit 74; fi
  done
fi
exec /bin/cp "$@"
EOF

cat > "$FAKE_BIN/launchctl" <<'EOF'
#!/usr/bin/env bash
set -u
case "${1:-}" in
  bootstrap)
    count=0
    [[ -r "$TEST_BOOTSTRAP_STATE" ]] && count="$(cat "$TEST_BOOTSTRAP_STATE")"
    count=$((count + 1))
    printf '%s\n' "$count" > "$TEST_BOOTSTRAP_STATE"
    if (( count <= ${TEST_BOOTSTRAP_FAILS:-0} )); then exit 5; fi
    ;;
  bootout|kickstart|print) ;;
  *) exit 2 ;;
esac
EOF
chmod 700 "$FAKE_BIN/bun" "$FAKE_BIN/cp" "$FAKE_BIN/curl" "$FAKE_BIN/launchctl"

run_install() {
  local ready="${3:-__unset__}"
  if [[ "$ready" == "__unset__" ]]; then
    env -u TEMPERANCE_AUTO_READY \
      HOME="$TEST_HOME" \
      PATH="$FAKE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
      TEST_BOOTSTRAP_STATE="$STATE_FILE" \
      TEST_BOOTSTRAP_FAILS="$1" \
      TEST_CP_FAIL_MATCH="${2:-}" \
        bash "$ROOT/scripts/temperance-proxy-launchd.sh" install
    return
  fi
  HOME="$TEST_HOME" \
  PATH="$FAKE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
  TEST_BOOTSTRAP_STATE="$STATE_FILE" \
  TEST_BOOTSTRAP_FAILS="$1" \
  TEST_CP_FAIL_MATCH="${2:-}" \
  TEMPERANCE_AUTO_READY="$ready" \
    bash "$ROOT/scripts/temperance-proxy-launchd.sh" install
}

printf '0\n' > "$STATE_FILE"
run_install 1 >/dev/null
[[ "$(cat "$STATE_FILE")" == 2 ]]
cmp -s "$ROOT/package/router/temperance-openai-proxy.ts" \
  "$TEST_HOME/.temperance_engine/bin/temperance-openai-proxy.ts"
cmp -s "$ROOT/package/router/multi-backend-router.sh" \
  "$TEST_HOME/.temperance_engine/router/multi-backend-router.sh"
grep -q '<key>TEMPERANCE_AUTO_READY</key><string>0</string>' \
  "$TEST_HOME/Library/LaunchAgents/com.temperance.engine.openai-proxy.plist"

printf '0\n' > "$STATE_FILE"
run_install 0 '' 1 >/dev/null
[[ "$(cat "$STATE_FILE")" == 1 ]]
grep -q '<key>TEMPERANCE_AUTO_READY</key><string>1</string>' \
  "$TEST_HOME/Library/LaunchAgents/com.temperance.engine.openai-proxy.plist"

printf 'baseline-proxy\n' > "$TEST_HOME/.temperance_engine/bin/temperance-openai-proxy.ts"
printf 'baseline-router\n' > "$TEST_HOME/.temperance_engine/router/multi-backend-router.sh"
printf 'baseline-enrich\n' > "$TEST_HOME/.temperance_engine/enrich/rollback-marker"
cp -p "$TEST_HOME/.temperance_engine/bin/temperance-openai-proxy.ts" "$TEST_ROOT/proxy.baseline"
cp -p "$TEST_HOME/.temperance_engine/router/multi-backend-router.sh" "$TEST_ROOT/router.baseline"
cp -p "$TEST_HOME/Library/LaunchAgents/com.temperance.engine.openai-proxy.plist" "$TEST_ROOT/plist.baseline"

printf '0\n' > "$STATE_FILE"
if run_install 3 >/dev/null 2>&1; then
  echo "expected failed promotion to return nonzero" >&2
  exit 1
fi
[[ "$(cat "$STATE_FILE")" == 4 ]]
cmp -s "$TEST_ROOT/proxy.baseline" "$TEST_HOME/.temperance_engine/bin/temperance-openai-proxy.ts"
cmp -s "$TEST_ROOT/router.baseline" "$TEST_HOME/.temperance_engine/router/multi-backend-router.sh"
cmp -s "$TEST_ROOT/plist.baseline" "$TEST_HOME/Library/LaunchAgents/com.temperance.engine.openai-proxy.plist"
grep -qx 'baseline-enrich' "$TEST_HOME/.temperance_engine/enrich/rollback-marker"
grep -q '<key>TEMPERANCE_AUTO_READY</key><string>1</string>' \
  "$TEST_HOME/Library/LaunchAgents/com.temperance.engine.openai-proxy.plist"

printf '0\n' > "$STATE_FILE"
if run_install 0 '/package/router/routing-policy.ts' >/dev/null 2>&1; then
  echo "expected file promotion failure to return nonzero" >&2
  exit 1
fi
[[ "$(cat "$STATE_FILE")" == 1 ]]
cmp -s "$TEST_ROOT/proxy.baseline" "$TEST_HOME/.temperance_engine/bin/temperance-openai-proxy.ts"
cmp -s "$TEST_ROOT/router.baseline" "$TEST_HOME/.temperance_engine/router/multi-backend-router.sh"
cmp -s "$TEST_ROOT/plist.baseline" "$TEST_HOME/Library/LaunchAgents/com.temperance.engine.openai-proxy.plist"
grep -qx 'baseline-enrich' "$TEST_HOME/.temperance_engine/enrich/rollback-marker"

echo "ok - transient launchd bootstrap failures retry before promotion succeeds"
echo "ok - absent automatic readiness installs explicit fail-closed zero"
echo "ok - explicit automatic readiness survives installation and recovery"
echo "ok - persistent promotion failure restores exact pre-install bytes"
echo "ok - mid-copy promotion failure restores the complete prior tree"
echo "=== temperance-proxy-launchd: PASS ==="
