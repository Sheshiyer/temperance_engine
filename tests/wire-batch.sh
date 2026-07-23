#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
out=$("$DIR/scripts/wire-multi-backend.sh" --dry-run 2>&1)
echo "$out" | grep -q "temperance-batch" && echo "ok - dry-run wires temperance-batch" || { echo "FAIL - no temperance-batch in dry-run"; fail=1; }
# #6: the installed enrichment hook resolves classify-task.sh at the PAI router
# sibling path, so wiring must co-locate it there (routing.ts fails open to
# task=balanced otherwise).
echo "$out" | grep -q "PAI/router/classify-task.sh" && echo "ok - dry-run co-locates classify-task.sh" || { echo "FAIL - classify-task.sh not co-located in dry-run"; fail=1; }
echo "$out" | grep -q "PAI/router/omniroute-portfolios.ts" && echo "ok - dry-run co-locates portfolio resolver" || { echo "FAIL - portfolio resolver not co-located in dry-run"; fail=1; }
echo "$out" | grep -q "shared enrichment core" && echo "ok - dry-run checks shared enrichment core" || { echo "FAIL - shared enrichment core missing from dry-run"; fail=1; }
echo "$out" | grep -q "Claude prompt adapter" && echo "ok - dry-run checks Claude prompt adapter" || { echo "FAIL - Claude prompt adapter missing from dry-run"; fail=1; }
echo "$out" | grep -q "Codex prompt adapter" && echo "ok - dry-run checks Codex prompt adapter" || { echo "FAIL - Codex prompt adapter missing from dry-run"; fail=1; }
exit $fail
