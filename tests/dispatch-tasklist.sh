#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$DIR/package/router/dispatch-tasklist.sh"
export TEMPERANCE_ROUTER="$DIR/package/router/multi-backend-router.sh"
export TEMPERANCE_BACKENDS="command-code"
fail=0
check(){ if [[ "$2" == "$3" ]]; then echo "ok - $1"; else echo "FAIL - $1: exp[$2] got[$3]"; fail=1; fi; }

# malformed JSON rejected (exit 1)
echo 'not json' | "$W" --dry-run --tasks - >/dev/null 2>&1
check "malformed json rejected" "1" "$?"

# bad id rejected
echo '[{"id":"../evil","task":"x"}]' | "$W" --dry-run --tasks - >/dev/null 2>&1
check "bad id rejected" "1" "$?"

# duplicate id rejected
echo '[{"id":"T1","task":"a"},{"id":"T1","task":"b"}]' | "$W" --dry-run --tasks - >/dev/null 2>&1
check "dup id rejected" "1" "$?"

# dry-run prints a routing line per task
out=$(printf '%s' '[{"id":"T1","task":"refactor the entire module"}]' | "$W" --dry-run --tasks - 2>/dev/null)
check "dry-run routes T1 to command-code" "T1 command-code moonshotai/Kimi-K2.7-Code" "$out"

exit $fail
