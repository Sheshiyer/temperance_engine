#!/usr/bin/env bash
set -uo pipefail
R="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/package/router/multi-backend-router.sh"
fail=0
check() { # desc, expected, actual
  if [[ "$2" == "$3" ]]; then echo "ok - $1"; else echo "FAIL - $1: expected [$2] got [$3]"; fail=1; fi
}

# route-only emits BACKEND<TAB>MODEL for a coding task when command-code is available
out=$(TEMPERANCE_BACKENDS="command-code" "$R" --route-only "refactor the entire auth layer")
check "route-only long-horizon -> command-code kimi model" \
  "command-code	moonshotai/Kimi-K2.7-Code" "$out"

# zero backends -> none<TAB>-
out=$(TEMPERANCE_BACKENDS="" "$R" --route-only "refactor the entire auth layer")
check "route-only zero backends -> none" "none	-" "$out"

# inline task -> inline<TAB>-
out=$(TEMPERANCE_BACKENDS="command-code" "$R" --route-only "summarize these three bullet points")
check "route-only inline" "inline	-" "$out"

# forced backend + model
out=$(TEMPERANCE_BACKENDS="command-code" "$R" --route-only --backend command-code --model gpt-5.5 "quick fix")
check "route-only forced backend+model" "command-code	gpt-5.5" "$out"

exit $fail
