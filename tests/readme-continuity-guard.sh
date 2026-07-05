#!/usr/bin/env bash
# tests/readme-continuity-guard.sh
# Verifies scripts/readme-continuity-check.sh only fires its version-sensitive
# drift check on GENUINE signals (README.md / CHANGELOG.md / .readme-notebooklm/*),
# not on every docs/ISA/scripts/package edit. Runs the real check against a
# scratch git repo so it exercises the actual diff+signal logic.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$DIR/scripts/readme-continuity-check.sh"
fail=0
check() { if [[ "$2" == "$3" ]]; then echo "ok - $1"; else echo "FAIL - $1: exp[$2] got[$3]"; fail=1; fi; }

REPO=$(mktemp -d)
(
  cd "$REPO"
  git init -q
  git config user.email t@example.com
  git config user.name tester
  mkdir -p .readme-notebooklm/assets
  # README with all four notebooklm markers so marker-validation passes.
  cat > README.md <<'MD'
# Test Project
<!-- readme-gen:start:notebooklm-report -->summary<!-- readme-gen:end:notebooklm-report -->
<!-- readme-gen:start:notebooklm-mindmap -->map<!-- readme-gen:end:notebooklm-mindmap -->
<!-- readme-gen:start:notebooklm-table -->table<!-- readme-gen:end:notebooklm-table -->
<!-- readme-gen:start:notebooklm-metadata -->
- source-count: 1
<!-- readme-gen:end:notebooklm-metadata -->
MD
  printf '{"assets":{}}\n' > .readme-notebooklm/assets/manifest.json
  printf 'x\n' > ISA.md
  printf 'x\n' > CHANGELOG.md
  mkdir -p docs
  printf 'x\n' > docs/pai-flow.md
  git add -A
  git commit -qm base
)
BASE=$(cd "$REPO" && git rev-parse HEAD)

# Scenario A: change ONLY doc-signal files (ISA.md + docs/*) — must NOT trip the
# drift guard (this is the regression the refinement fixes; pre-fix it exit 1'd).
(cd "$REPO" && printf 'change\n' >> ISA.md && printf 'change\n' >> docs/pai-flow.md && git add -A && git commit -qm docs)
HEAD_A=$(cd "$REPO" && git rev-parse HEAD)
TEMPERANCE_ROOT="$REPO" bash "$CHECK" "$BASE" "$HEAD_A" >/dev/null 2>&1
check "doc-only change (ISA.md + docs/) does NOT trip drift guard" "0" "$?"

# Scenario B: change CHANGELOG.md without refreshing README — SHOULD trip drift
# (proves the guard still catches genuine release-signal drift).
(cd "$REPO" && printf 'release\n' >> CHANGELOG.md && git add -A && git commit -qm chlog)
HEAD_B=$(cd "$REPO" && git rev-parse HEAD)
TEMPERANCE_ROOT="$REPO" bash "$CHECK" "$HEAD_A" "$HEAD_B" >/dev/null 2>&1
check "CHANGELOG change without README refresh DOES trip drift guard" "1" "$?"

# Scenario C: change README.md notebooklm section without updating assets —
# SHOULD trip drift ("markers present, assets not updated").
(cd "$REPO" && perl -0pi -e 's/summary/summary-edited/' README.md && git add -A && git commit -qm readme)
HEAD_C=$(cd "$REPO" && git rev-parse HEAD)
TEMPERANCE_ROOT="$REPO" bash "$CHECK" "$HEAD_B" "$HEAD_C" >/dev/null 2>&1
check "README notebooklm edit without asset refresh DOES trip drift guard" "1" "$?"

rm -rf "$REPO"
echo "=== readme-continuity-guard: $([[ $fail -eq 0 ]] && echo PASS || echo FAIL) ==="
exit $fail
