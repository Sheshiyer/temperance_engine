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

check "reconciler bridges quota and cost signals to routing-policy.ts" \
  sh -c "grep -q 'routing-policy.ts' '$RECONCILER' && grep -q 'set_observation_args=(set-observation' '$RECONCILER'"
check "reconciler quota/cost bridge targets the omniroute backend" \
  grep -q -- '--backend omniroute' "$RECONCILER"
check "reconciler quota/cost bridge fails open when no signal is available" \
  grep -q 'command -v bun' "$RECONCILER"
check "reconciler cost bridge queries live usage analytics, not the disjoint free-provider-rankings list" \
  sh -c "grep -q '/api/usage/analytics' '$RECONCILER' && ! grep -q 'api_get.*free-provider-rankings' '$RECONCILER'"
check "reconciler cost bridge computes a zero-cost request fraction, not an invented \$/token scale" \
  grep -q 'select((.cost // 0) == 0)' "$RECONCILER"

# Functional check of the bridge's averaging formula (extracted, since a full
# reconciler run needs a live-or-mocked OmniRoute -- see the TODO above this
# file's mocked-CLI section for that broader gap). Three providers: two with
# real remaining%, one manual-disabled (remaining:null) that must be excluded
# from the average rather than silently pulled toward 0.
avg_filter='[.providers[] | select(.remaining != null) | (.remaining | tonumber)] as $vals
  | if ($vals | length) == 0 then "" else ($vals | add / length / 100) end'
avg_result="$(jq -r "$avg_filter" <<'JSON'
{"providers":{
  "github":{"status":"strong_up","remaining":80},
  "codex":{"status":"weak_up","remaining":40},
  "kimi-coding-apikey":{"status":"hard_down","remaining":null}
}}
JSON
)"
check "quota bridge averages only providers with real remaining data" \
  test "$avg_result" = "0.6"

empty_avg_result="$(jq -r "$avg_filter" <<'JSON'
{"providers":{"github":{"status":"unknown","remaining":null}}}
JSON
)"
check "quota bridge yields empty (skip) when no provider has quota data" \
  test -z "$empty_avg_result"

# Functional check of the cost-efficiency bridge's zero-cost-fraction formula
# (extracted for the same reason as the quota formula above -- see the TODO).
# Four models: two free (0 requests-weighted cost), two paid, mixed request
# counts so the fraction is request-weighted, not model-count-weighted.
cost_filter='[.byModel[] | .requests // 0] as $all
  | ([.byModel[] | select((.cost // 0) == 0) | .requests // 0]) as $free
  | (($all | add) // 0) as $total
  | if $total == 0 then "" else (($free | add) // 0) / $total end'
cost_result="$(jq -r "$cost_filter" <<'JSON'
{"byModel":[
  {"provider":"kimi-coding-apikey","requests":300,"cost":0},
  {"provider":"opencode","requests":100,"cost":0},
  {"provider":"codex","requests":80,"cost":425.23},
  {"provider":"github","requests":20,"cost":103.56}
]}
JSON
)"
check "cost bridge computes the request-weighted zero-cost fraction" \
  test "$cost_result" = "0.8"

empty_cost_result="$(jq -r "$cost_filter" <<'JSON'
{"byModel":[]}
JSON
)"
check "cost bridge yields empty (skip) when there is no usage data" \
  test -z "$empty_cost_result"

exit "$fail"
