#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/omniroute-autostart-launchd.sh"
fail=0

check_count() {
  local description="$1" pattern="$2" expected="$3" actual
  actual="$(rg -c "$pattern" "$SCRIPT" || true)"
  if [[ "$actual" == "$expected" ]]; then
    echo "ok - $description"
  else
    echo "FAIL - $description: expected [$expected] got [$actual]"
    fail=1
  fi
}

check_count "LaunchAgent pins the OmniRoute server host" \
  '<key>OMNIROUTE_SERVER_HOST</key>' 1
check_count "LaunchAgent binds OmniRoute to IPv4 loopback" \
  '<string>127\.0\.0\.1</string>' 1
check_count "LaunchAgent enables MCP scopes before registration" \
  '<key>OMNIROUTE_MCP_ENFORCE_SCOPES</key>' 1
check_count "manual recovery preserves dormant MCP scope enforcement" \
  'OMNIROUTE_MCP_ENFORCE_SCOPES=true' 1
check_count "install verifies the live scope-enforcement environment" \
  'OMNIROUTE_MCP_ENFORCE_SCOPES => true' 2
check_count "health probes use the loopback admin URL" \
  'TEMPERANCE_OMNIROUTE_ADMIN_URL:-http://127\.0\.0\.1:20128' 1
check_count "bootstrap retries are bounded" \
  'for attempt in 1 2 3' 1
check_count "failed bootstrap restores manual loopback service" \
  'recover_manual_daemon "\$backup"' 4
check_count "manual recovery preserves loopback binding" \
  'OMNIROUTE_SERVER_HOST=127\.0\.0\.1' 1

if rg -q 'OMNIROUTE_SERVER_HOST[^\n]*0\.0\.0\.0|<string>0\.0\.0\.0</string>' "$SCRIPT"; then
  echo "FAIL - LaunchAgent exposes OmniRoute on all interfaces"
  fail=1
else
  echo "ok - LaunchAgent never configures an all-interface listener"
fi

exit "$fail"
