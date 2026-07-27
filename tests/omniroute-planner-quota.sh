#!/usr/bin/env bash
# Structural checks. scripts/omniroute-temperance-planner-quota.sh is now a
# deprecation shim (see its header comment) that forwards to
# scripts/omniroute-temperance-reconcile.sh --combo te-plan, the generalized
# policy-driven reconciler covering every governed combo.
#
# The functional quota-substitution checks that used to run here against a
# mocked `omniroute` CLI no longer apply as-is: the reconciler requires
# real Keychain-backed admin auth (`security find-generic-password`) plus a
# live OmniRoute HTTP API (/api/auth/login, /api/settings, /api/combos,
# /api/providers, /v1/models), so it can no longer be exercised offline with
# just a CLI mock on PATH.
#
# TODO(follow-up): give scripts/omniroute-temperance-reconcile.sh its own
# integration test harness (a fake `security` binary plus a minimal HTTP
# mock server) to restore equivalent functional coverage of the
# substitution/threshold/hysteresis logic that used to be checked here.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHIM="$ROOT/scripts/omniroute-temperance-planner-quota.sh"
RECONCILER="$ROOT/scripts/omniroute-temperance-reconcile.sh"
POLICY="$ROOT/package/router/omniroute-fallback-policy.json"
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

check "planner quota shim is executable" test -x "$SHIM"
check "planner quota shim parses" bash -n "$SHIM"
check "shim forwards to the generalized reconciler" grep -q 'omniroute-temperance-reconcile.sh' "$SHIM"
check "shim scopes itself to the te-plan combo" grep -q -- '--combo te-plan' "$SHIM"

check "reconciler script is executable" test -x "$RECONCILER"
check "reconciler script parses" bash -n "$RECONCILER"
check "reconciler snapshots before mutation" grep -q 'BACKUP_PATH=' "$RECONCILER"
check "reconciler has explicit rollback" grep -q -- '--rollback' "$RECONCILER"
check "reconciler guards the global active combo" grep -q 'activeCombo' "$RECONCILER"
check "reconciler polls the live OmniRoute quota command" grep -q 'usage quota' "$RECONCILER"
check "reconciler has a timer install/uninstall/status lifecycle" sh -c "grep -q -- '--install-timer' '$RECONCILER' && grep -q -- '--uninstall-timer' '$RECONCILER' && grep -q -- '--timer-status' '$RECONCILER'"
check "reconciler keeps the legacy planner-quota state file fresh for te-plan" grep -q 'LEGACY_STATE_PATH' "$RECONCILER"

check "fallback policy defines a 30 percent threshold" test "$(jq -r '.threshold_percent' "$POLICY")" = 30
check "fallback policy covers the te-plan combo" sh -c "jq -e '[.combos[] | select(.name == \"te-plan\")] | length == 1' '$POLICY' >/dev/null"
check "policy never substitutes the Nebius anchor for te-plan" sh -c "jq -e '.combos[] | select(.name == \"te-plan\") | .slots[] | select(.model | contains(\"nebius\")) | .role == \"anchor\"' '$POLICY' >/dev/null"
check "docs record the planner-quota deprecation" grep -q 'omniroute-temperance-planner-quota.sh' "$ROOT/docs/omniroute-fleet.md"
check "docs name the reconciler" grep -q 'omniroute-temperance-reconcile.sh' "$ROOT/docs/omniroute-fleet.md"

exit "$fail"
