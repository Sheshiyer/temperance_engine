#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKER="$ROOT/scripts/omniroute-check.sh"
FIXTURES="$ROOT/tests/fixtures/omniroute-runtime"
fail=0

check() {
  local description="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "ok - $description"
  else
    echo "FAIL - $description: expected [$expected] got [$actual]"
    fail=1
  fi
}

ready="$(TEMPERANCE_OMNIROUTE_READINESS_FIXTURE="$FIXTURES/ready.json" "$CHECKER" --json 2>/dev/null)"
if jq -e . >/dev/null 2>&1 <<< "$ready"; then
  echo "ok - readiness JSON parses"
else
  echo "FAIL - readiness JSON does not parse"
  fail=1
fi
check "runtime reports fixture version" "3.8.48-fixture" \
  "$(jq -r '.runtime.version // empty' <<< "$ready")"
check "readiness schema is versioned" "temperance-omniroute-readiness-v1" \
  "$(jq -r '.schema_version' <<< "$ready")"
check "runtime is available" "true" \
  "$(jq -r '.runtime.available' <<< "$ready")"
check "catalog count is reported" "4" \
  "$(jq -r '.catalog.count' <<< "$ready")"
check "configured portfolio count is reported" "5" \
  "$(jq -r '.catalog.configured_portfolios | length' <<< "$ready")"
check "available portfolio count is reported" "2" \
  "$(jq -r '.catalog.available_portfolios | length' <<< "$ready")"
check "missing portfolio includes te-build" "true" \
  "$(jq -r '.catalog.missing_portfolios | index("te-build") != null' <<< "$ready")"
check "telemetry evidence is reported" "true" \
  "$(jq -r '.telemetry.available' <<< "$ready")"
check "telemetry request count is reported" "12" \
  "$(jq -r '.telemetry.request_count' <<< "$ready")"
check "eval suite count is reported" "2" \
  "$(jq -r '.evals.suite_count' <<< "$ready")"
check "eval run count is reported" "3" \
  "$(jq -r '.evals.run_count' <<< "$ready")"
check "enforcement remains fail-closed" "false" \
  "$(jq -r '.enforcement_ready' <<< "$ready")"

unavailable="$(TEMPERANCE_OMNIROUTE_READINESS_FIXTURE="$FIXTURES/unavailable.json" "$CHECKER" --json 2>/dev/null)"
check "unavailable runtime is represented" "false" \
  "$(jq -r '.runtime.available' <<< "$unavailable")"
check "unavailable telemetry is not zeroed" "false" \
  "$(jq -r '.telemetry.available' <<< "$unavailable")"
check "unavailable evals are not zeroed" "false" \
  "$(jq -r '.evals.available' <<< "$unavailable")"
check "unavailable evidence blocks enforcement" "false" \
  "$(jq -r '.enforcement_ready' <<< "$unavailable")"

unknown_schema="$(TEMPERANCE_OMNIROUTE_READINESS_FIXTURE="$FIXTURES/unknown-schema.json" "$CHECKER" --json 2>/dev/null)"
check "unknown fixture schema fails closed" "false" \
  "$(jq -r '.runtime.available' <<< "$unknown_schema")"
check "unknown fixture schema blocks enforcement" "false" \
  "$(jq -r '.enforcement_ready' <<< "$unknown_schema")"

if grep -Eiq '(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|(api[_-]?key|secret|token|password)[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9])' <<< "$ready$unavailable"; then
  echo "FAIL - readiness output contains credential-like data"
  fail=1
else
  echo "ok - readiness output contains no credential-like data"
fi

exit "$fail"
