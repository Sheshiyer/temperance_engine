#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; D="$DIR/docs/pai-flow.md"; fail=0
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

# --- A+F Task 2: retired docs are redirect stubs ---
grep -qi "retired" "$DIR/docs/parallel-dispatch.md" && grep -q "pai-flow.md" "$DIR/docs/parallel-dispatch.md" \
  && echo "ok - parallel-dispatch.md is a redirect stub" \
  || { echo "FAIL - parallel-dispatch.md not a redirect stub"; fail=1; }
grep -qi "retired" "$DIR/docs/multi-surface-architecture.md" && grep -q "pai-flow.md" "$DIR/docs/multi-surface-architecture.md" \
  && echo "ok - multi-surface-architecture.md is a redirect stub" \
  || { echo "FAIL - multi-surface-architecture.md not a redirect stub"; fail=1; }

# --- A+F Task 3: conductor retired ---
[ ! -e "$DIR/package/conductor/routed-execute.sh" ] \
  && echo "ok - conductor/routed-execute.sh removed" \
  || { echo "FAIL - package/conductor/routed-execute.sh still present"; fail=1; }

# --- A+F Task 4: gsd-core realignment ---
grep -q "open-gsd/gsd-core" "$DIR/UPSTREAM.md" && echo "ok - UPSTREAM credits gsd-core" \
  || { echo "FAIL - UPSTREAM.md missing open-gsd/gsd-core"; fail=1; }
grep -q "open-gsd/gsd-core" "$DIR/CREDITS.md" && echo "ok - CREDITS credits gsd-core" \
  || { echo "FAIL - CREDITS.md missing open-gsd/gsd-core"; fail=1; }
grep -q "@opengsd/gsd-core" "$DIR/scripts/install-gsd.sh" && echo "ok - install-gsd points at gsd-core npx" \
  || { echo "FAIL - install-gsd.sh missing gsd-core npx guidance"; fail=1; }

# --- A+F Task 5: ISA additive criteria ---
grep -qi "7-phase decision table" "$DIR/ISA.md" && echo "ok - ISA has unified-table criterion" \
  || { echo "FAIL - ISA.md missing unified 7-phase table criterion"; fail=1; }
grep -qi "recommended-default" "$DIR/ISA.md" && grep -q "gsd-core" "$DIR/ISA.md" \
  && echo "ok - ISA has gsd-core recommended-default criterion" \
  || { echo "FAIL - ISA.md missing gsd-core recommended-default criterion"; fail=1; }
grep -qi "redirect stub" "$DIR/ISA.md" && echo "ok - ISA has retirement criterion" \
  || { echo "FAIL - ISA.md missing retirement criterion"; fail=1; }

# --- #6: unified router invariant is documented ---
grep -q 'classify-task\.sh' "$DIR/ISA.md" && echo "ok - ISA has classify-task.sh invariant" \
  || { echo "FAIL - ISA missing classify-task.sh invariant"; fail=1; }
grep -q -- '--verdict' "$DIR/ISA.md" && echo "ok - ISA has --verdict invariant" \
  || { echo "FAIL - ISA missing --verdict"; fail=1; }

# --- ISA normalization: criteria and ledger shape are current ---
grep -q '^task: Package and maintain Temperance Engine public installer/runtime docs$' "$DIR/ISA.md" \
  && grep -q '^progress: 48/48$' "$DIR/ISA.md" \
  && grep -q '^updated: 2026-07-09$' "$DIR/ISA.md" \
  && echo "ok - ISA frontmatter normalized" \
  || { echo "FAIL - ISA frontmatter normalization missing"; fail=1; }
grep -q '^## Principles$' "$DIR/ISA.md" && grep -q '^## Changelog$' "$DIR/ISA.md" \
  && echo "ok - ISA has Principles and Changelog" \
  || { echo "FAIL - ISA missing Principles or Changelog"; fail=1; }
grep -q 'ISC-48' "$DIR/ISA.md" && echo "ok - ISA criteria extend through ISC-48" \
  || { echo "FAIL - ISA missing ISC-48"; fail=1; }
grep -q 'ISA normalization ledger' "$DIR/ISA.md" && echo "ok - ISA features map normalization ledger" \
  || { echo "FAIL - ISA features missing normalization ledger"; fail=1; }

# --- A+F Task 6: skill-clusters documented as the discovery layer ---
grep -qi "discovery/lazy-load layer" "$DIR/docs/skill-clusters.md" \
  && echo "ok - skill-clusters.md names its unified-flow role" \
  || { echo "FAIL - skill-clusters.md missing discovery/lazy-load layer statement"; fail=1; }

# --- workflow hardening: .planning is a ratified GSD/Speckit execution map ---
for planning_doc in PROJECT.md ROADMAP.md STATE.md REQUIREMENTS.md config.json; do
  [ -f "$DIR/.planning/$planning_doc" ] \
    && echo "ok - .planning/$planning_doc exists" \
    || { echo "FAIL - .planning/$planning_doc missing"; fail=1; }
done
grep -qi "Speckit" "$DIR/.planning/PROJECT.md" && echo "ok - .planning names Speckit specs" \
  || { echo "FAIL - .planning/PROJECT.md missing Speckit"; fail=1; }
grep -qi "GSD" "$DIR/.planning/ROADMAP.md" && echo "ok - .planning maps GSD phases" \
  || { echo "FAIL - .planning/ROADMAP.md missing GSD"; fail=1; }
grep -qi "ratified" "$DIR/.planning/REQUIREMENTS.md" && echo "ok - .planning gates ratified surfaces" \
  || { echo "FAIL - .planning/REQUIREMENTS.md missing ratified-surface policy"; fail=1; }
grep -q "scripts/verify-all.sh" "$DIR/.planning/config.json" && echo "ok - .planning config points at verify-all" \
  || { echo "FAIL - .planning/config.json missing verify-all"; fail=1; }
grep -q "scripts/verify-all.sh" "$DIR/.github/workflows/verify.yml" && echo "ok - CI delegates to verify-all" \
  || { echo "FAIL - verify workflow does not call scripts/verify-all.sh"; fail=1; }
exit $fail
