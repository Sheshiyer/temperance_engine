#!/usr/bin/env bash
# Structural checks for scripts/omniroute-memory-sync.sh and
# scripts/omniroute-memory-retrieve.sh. Functional live-network checks live
# in package/router/pai-memory-frontmatter.test.ts (pure parsing/mapping
# logic, no network) -- these two shell scripts' HTTP/auth behavior needs a
# live-or-mocked OmniRoute instance to exercise for real, same gap already
# noted for omniroute-temperance-reconcile.sh in tests/omniroute-planner-quota.sh.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC="$ROOT/scripts/omniroute-memory-sync.sh"
RETRIEVE="$ROOT/scripts/omniroute-memory-retrieve.sh"
PARSER="$ROOT/package/router/pai-memory-frontmatter.ts"
fail=0
check() {
  local description="$1"
  shift
  if "$@"; then
    echo "ok - $description"
  else
    echo "FAIL - $description"
    fail=1
  fi
}

check "sync script is executable" test -x "$SYNC"
check "sync script parses" bash -n "$SYNC"
check "retrieve script is executable" test -x "$RETRIEVE"
check "retrieve script parses" bash -n "$RETRIEVE"
check "frontmatter parser module exists" test -f "$PARSER"

check "sync script defaults to dry-run" grep -q 'MODE="dry-run"' "$SYNC"
check "sync script requires --apply to actually write" grep -q -- '\[ "\$MODE" = "dry-run" \]' "$SYNC"
check "sync script reuses the existing admin credential service, not a new one" \
  grep -q 'ADMIN_SERVICE="OmniRoute Temperance Admin"' "$SYNC"
check "sync script mirrors the reconciler's login pattern" \
  sh -c "grep -q '/api/auth/login' '$SYNC' && grep -q '/api/auth/csrf' '$SYNC'"
check "sync script is read-only toward PAI's own memory files (no write/unlink of the source dir)" \
  sh -c "! grep -E 'rm |unlink|writeFileSync' '$SYNC' | grep -q MEMORY_DIR"
check "sync script paginates existing keys rather than assuming one page" \
  grep -q 'totalPages' "$SYNC"
check "sync script fetches every page before deciding what is new (dedupe happens after the full existing-key set is known)" \
  sh -c "awk '/existing_keys=/{el=NR} /while :; do/{wl=NR} END{exit !(wl < el)}' '$SYNC'"
check "sync script skips entries whose key already exists in OmniRoute" \
  grep -q 'select((.key as \$k | \$existing | index(\$k)) == null)' "$SYNC"
check "sync script delegates markdown parsing to the pure, testable frontmatter module" \
  grep -q 'pai-memory-frontmatter.ts' "$SYNC"
check "sync script skips gracefully (exit 0) when no PAI memory directory exists, rather than failing" \
  sh -c "grep -q 'nothing to sync' '$SYNC' && grep -A1 'nothing to sync' '$SYNC' | grep -q 'exit 0'"

check "retrieve script's actual request payload uses the verified maxTokens field name" \
  grep -q -- '--argjson maxTokens' "$RETRIEVE"
check "retrieve script documents that budgetTokens/budget were tried and rejected before maxTokens was found" \
  grep -q 'Unrecognized key' "$RETRIEVE"
check "retrieve script validates the strategy argument" \
  grep -q 'exact|semantic|hybrid' "$RETRIEVE"
check "retrieve script explicitly does not wire itself into a SessionStart hook" \
  grep -q 'NOT wired into' "$RETRIEVE"
check "retrieve script reuses the same admin credential service as the sync script and reconciler" \
  grep -q 'ADMIN_SERVICE="OmniRoute Temperance Admin"' "$RETRIEVE"

check "design doc records the verified memory API schema" \
  grep -q 'POST /api/memory' "$ROOT/docs/superpowers/specs/2026-08-02-memory-compression-freetier-leverage-design.md"

exit "$fail"
