#!/usr/bin/env bash
# Guard: every command-code invocation in the dispatch rail must carry --yolo
# so command-code can actually write files / run shell in the sandboxed worktree,
# matching how kimi (--yolo) and grok (--always-approve) are already invoked.
# Without it, command-code stops on a permission prompt and does no work
# (observed: exit 0 with an empty diff, asking the user to enable --yolo).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0

FILES=(
  "$DIR/package/router/dispatch-tasklist.sh"
  "$DIR/package/router/parallel-backend-dispatch.sh"
  "$DIR/package/router/multi-backend-router.sh"
)

for f in "${FILES[@]}"; do
  # Each line that invokes `command-code -p` must include the --yolo flag.
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if printf '%s' "$line" | grep -q -- '--yolo'; then
      echo "ok - command-code invocation carries --yolo ($(basename "$f"))"
    else
      echo "FAIL - command-code invocation missing --yolo ($(basename "$f")): $line"
      fail=1
    fi
  done < <(grep -n 'command-code -p' "$f")
done

# Sanity: kimi/grok remain permissive too (regression guard on the sibling backends).
grep -q 'kimi --print --yolo' "$DIR/package/router/dispatch-tasklist.sh" && echo "ok - kimi still --yolo" || { echo "FAIL - kimi lost --yolo"; fail=1; }
grep -q 'grok" --model "\$2" --always-approve' "$DIR/package/router/dispatch-tasklist.sh" && echo "ok - grok still --always-approve" || { echo "FAIL - grok lost --always-approve"; fail=1; }

exit $fail
