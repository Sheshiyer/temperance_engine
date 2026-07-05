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

# --json with a task containing a double quote and newline is still valid JSON
tricky=$'say "hello"\nand run $(id)'
if TEMPERANCE_BACKENDS="command-code" "$R" --json "$tricky" | jq -e . >/dev/null 2>&1; then
  echo "ok - --json valid for quote/newline task"
else
  echo "FAIL - --json produced invalid JSON for tricky task"; fail=1
fi

# nvidia body helper builds valid JSON with a quote in the task
if body=$("$R" --emit-nvidia-body "nvidia/x" 'he said "hi"') && echo "$body" | jq -e '.messages[0].content' >/dev/null 2>&1; then
  echo "ok - nvidia body valid JSON"
else
  echo "FAIL - nvidia body invalid JSON"; fail=1
fi

# --execute on an inline-classified task must NOT masquerade as success
TEMPERANCE_BACKENDS="command-code" "$R" --execute "summarize these bullet points" >/dev/null 2>&1
check "inline --execute exit code" "3" "$?"

# --emit-nvidia-body with no following args must fail loudly, not emit empty-string JSON
"$R" --emit-nvidia-body >/dev/null 2>&1
check "emit-nvidia-body no args exit code" "2" "$?"

# --emit-nvidia-body with only one following arg must also fail loudly
"$R" --emit-nvidia-body "onlymodel" >/dev/null 2>&1
check "emit-nvidia-body one arg exit code" "2" "$?"

# --emit-nvidia-body with both args still emits valid JSON
if body=$("$R" --emit-nvidia-body "m" "d") && echo "$body" | jq -e . >/dev/null 2>&1; then
  echo "ok - emit-nvidia-body with both args emits valid JSON"
else
  echo "FAIL - emit-nvidia-body with both args did not emit valid JSON"; fail=1
fi

exit $fail
