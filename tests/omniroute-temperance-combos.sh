#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
check() {
  local description="$1"
  shift
  if "$@"; then
    echo "ok - $description"
  else
    echo "FAIL - $description"
    fail=1
  fi
}

check "combo lifecycle script is executable" test -x "$ROOT/scripts/omniroute-temperance-combos.sh"
check "combo lifecycle script parses" bash -n "$ROOT/scripts/omniroute-temperance-combos.sh"
check "lifecycle script snapshots before mutation" grep -q 'BACKUP_PATH=' "$ROOT/scripts/omniroute-temperance-combos.sh"
check "lifecycle script has explicit rollback" grep -q -- '--rollback' "$ROOT/scripts/omniroute-temperance-combos.sh"
check "lifecycle script guards global active combo" grep -q 'activeCombo' "$ROOT/scripts/omniroute-temperance-combos.sh"
check "lifecycle script preflights live catalog" grep -q '/v1/models' "$ROOT/scripts/omniroute-temperance-combos.sh"
check "manifest has four required portfolios" test "$(jq -r '.required_portfolios | length' "$ROOT/package/router/omniroute-portfolios.json")" = 4
check "manifest maps fast lane" test "$(jq -r '.task_type_portfolios.fast' "$ROOT/package/router/omniroute-portfolios.json")" = te-fast
check "manifest maps build lane" test "$(jq -r '.task_type_portfolios["long-horizon"]' "$ROOT/package/router/omniroute-portfolios.json")" = te-build
check "manifest maps reasoning lane" test "$(jq -r '.task_type_portfolios.reasoning' "$ROOT/package/router/omniroute-portfolios.json")" = te-reason
check "manifest maps validation lane" test "$(jq -r '.task_type_portfolios.validation' "$ROOT/package/router/omniroute-portfolios.json")" = te-validate
check "runtime docs name all portfolios" sh -c "grep -q 'te-fast' '$ROOT/docs/omniroute-runtime.md' && grep -q 'te-build' '$ROOT/docs/omniroute-runtime.md' && grep -q 'te-reason' '$ROOT/docs/omniroute-runtime.md' && grep -q 'te-validate' '$ROOT/docs/omniroute-runtime.md'"
check "connection docs preserve native non-chat lanes" grep -q 'native capability lanes' "$ROOT/docs/omniroute-connections.md"

exit "$fail"
