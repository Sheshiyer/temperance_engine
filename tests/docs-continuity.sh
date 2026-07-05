#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; D="$DIR/docs/parallel-dispatch.md"; fail=0
grep -q "temperance-batch" "$D" && echo "ok - doc mentions temperance-batch" || { echo "FAIL"; fail=1; }
grep -q "temperance-parallel-dispatch" "$D" && echo "ok - doc mentions the skill" || { echo "FAIL"; fail=1; }
grep -qi "Claude-subagent primitive" "$D" && echo "ok - clarifies superpowers role" || { echo "FAIL"; fail=1; }
exit $fail
