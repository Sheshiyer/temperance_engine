#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

"$ROOT/scripts/temperance-doctor.sh" --section privacy --state-root "$TMP" --json >"$TMP/report.json"
python3 - "$TMP/report.json" <<'PY'
import json, sys
report = json.load(open(sys.argv[1]))
assert report["schema"] == "temperance.doctor.report.v1"
assert report["trustworthy"] is True
assert report["scope"] == {"complete": False, "requested_sections": ["privacy"]}
assert report["overall_condition"] == "PASS"
assert report["sections"][0]["condition"] == "SKIPPED"
PY
echo "ok - public doctor emits stable JSON without jq"

"$ROOT/scripts/temperance-doctor.sh" --section privacy --state-root "$TMP" >"$TMP/report.txt"
grep -q "TEMPERANCE DOCTOR · PASS" "$TMP/report.txt"
grep -q "privacy" "$TMP/report.txt"
echo "ok - public doctor emits human report from the same observation"

set +e
"$ROOT/bin/temperance" doctor --repair-duplicates >"$TMP/repair.out" 2>"$TMP/repair.err"
repair_status=$?
set -e
test "$repair_status" -eq 2
grep -q "permanently read-only" "$TMP/repair.err"
grep -q "Phase 3" "$TMP/repair.err"
echo "ok - mutating doctor flags are rejected with migration guidance"

before="$(git -C "$ROOT" hash-object package/install-surface/install-surface-manifest.lock.json)"
(cd "$ROOT/package/install-surface" && bun run src/cli.ts compile >/dev/null)
after="$(git -C "$ROOT" hash-object package/install-surface/install-surface-manifest.lock.json)"
test "$before" = "$after"
echo "ok - compile is read-only and committed lock bytes remain exact"
