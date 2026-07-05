#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
out=$("$DIR/scripts/wire-multi-backend.sh" --dry-run 2>&1)
echo "$out" | grep -q "temperance-batch" && echo "ok - dry-run wires temperance-batch" || { echo "FAIL - no temperance-batch in dry-run"; fail=1; }
exit $fail
