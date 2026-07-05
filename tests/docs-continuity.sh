#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; D="$DIR/docs/parallel-dispatch.md"; fail=0
grep -q "temperance-batch" "$D" && echo "ok - doc mentions temperance-batch" || { echo "FAIL"; fail=1; }
grep -q "temperance-parallel-dispatch" "$D" && echo "ok - doc mentions the skill" || { echo "FAIL"; fail=1; }
grep -qi "Claude-subagent primitive" "$D" && echo "ok - clarifies superpowers role" || { echo "FAIL"; fail=1; }

# --- A+F Task 1: pai-flow.md is the canonical unified flow doc ---
PF="$DIR/docs/pai-flow.md"
for phase in Observe Think Plan Build Execute Verify Learn; do
  grep -q "| .*$phase" "$PF" 2>/dev/null && echo "ok - pai-flow row: $phase" \
    || { echo "FAIL - pai-flow.md missing phase row: $phase"; fail=1; }
done
grep -q "skill-cluster resolver" "$PF" && echo "ok - pai-flow mentions skill-cluster resolver" \
  || { echo "FAIL - pai-flow.md missing 'skill-cluster resolver'"; fail=1; }
grep -q "gsd-core" "$PF" && echo "ok - pai-flow mentions gsd-core" \
  || { echo "FAIL - pai-flow.md missing 'gsd-core'"; fail=1; }
grep -q "/gsd-plan-phase" "$PF" && echo "ok - pai-flow uses /gsd-* hyphen commands" \
  || { echo "FAIL - pai-flow.md missing /gsd-* command form"; fail=1; }
grep -q "temperance-parallel-dispatch" "$PF" && echo "ok - pai-flow mentions temperance-parallel-dispatch" \
  || { echo "FAIL - pai-flow.md missing temperance-parallel-dispatch"; fail=1; }
exit $fail
