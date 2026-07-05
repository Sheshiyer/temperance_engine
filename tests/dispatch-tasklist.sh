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

# inline task is marked skipped:inline in dry-run
out=$(printf '%s' '[{"id":"S1","task":"summarize these points"}]' | "$W" --dry-run --tasks - 2>/dev/null)
check "inline -> skipped" "S1 skipped:inline" "$out"

# with zero backends, a coding task is unavailable
out=$(printf '%s' '[{"id":"U1","task":"refactor everything"}]' | TEMPERANCE_BACKENDS="" "$W" --dry-run --tasks - 2>/dev/null)
check "zero backends -> unavailable" "U1 unavailable" "$out"

# injection regression: task text with $(), quotes, apostrophe, newline round-trips literally
chmod +x "$DIR/tests/fixtures/mock-backend"
export PATH="$DIR/tests/fixtures:$PATH"
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
payload='[{"id":"INJ","task":"run $(touch /tmp/pwned) and say \"don'\''t\" now","backend":"command-code","model":"x"}]'
printf '%s' "$payload" | "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
got=$(sed -n '/MOCK_OUTPUT_START/,/MOCK_OUTPUT_END/p' "$run/INJ.out" | sed '1d;$d')
check "task text passed literally (no eval)" 'run $(touch /tmp/pwned) and say "don'\''t" now' "$got"
[[ -e /tmp/pwned ]] && { echo "FAIL - injection executed!"; fail=1; rm -f /tmp/pwned; }
rm -f "$DIR/tests/fixtures/command-code"

# flag-like task text must NOT be interpreted as router flags
# ("--help" exactly matches the router's -h|--help case unless "--" ends option parsing)
out=$(printf '%s' '[{"id":"F1","task":"--help"}]' | "$W" --dry-run --tasks - 2>/dev/null)
check "flag-like task -> dispatch (not swallowed as --help)" \
  "F1 command-code claude-sonnet-5" "$out"

# concurrency cap + atomic meta + index.json + SUMMARY.md
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
printf '%s' '[{"id":"A","task":"refactor all files","backend":"command-code","model":"x"},
             {"id":"B","task":"refactor all files","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
# index.json valid + 2 ok tasks
ok=$(jq -r '.summary.ok' "$run/index.json" 2>/dev/null)
check "index.json summary.ok" "2" "$ok"
# per-task meta present + status ok
st=$(jq -r '.status' "$run/A.meta.json" 2>/dev/null)
check "A meta status ok" "ok" "$st"
# SUMMARY.md exists
[[ -f "$run/SUMMARY.md" ]] && echo "ok - SUMMARY.md written" || { echo "FAIL - no SUMMARY.md"; fail=1; }
rm -f "$DIR/tests/fixtures/command-code"

# background-by-default: prints run dir fast, task completes eventually
# (uses a slow mock so blocking vs backgrounding is actually observable)
ln -sf slow-mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
start=$(date +%s)
printed=$(printf '%s' '[{"id":"BG","task":"refactor all","backend":"command-code","model":"x"}]' \
  | "$W" --out "$run" --tasks - 2>/dev/null)   # default backgrounds
elapsed=$(( $(date +%s) - start ))
check "background prints run dir" "$run" "$printed"
[[ $elapsed -le 3 ]] && echo "ok - returns fast (${elapsed}s)" || { echo "FAIL - blocked ${elapsed}s"; fail=1; }
# wait for completion then verify
for _ in $(seq 1 20); do [[ -f "$run/index.json" ]] && break; sleep 0.5; done
check "bg task eventually ok" "1" "$(jq -r '.summary.ok' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"

# per-task watchdog timeout: a slow task killed after --timeout S -> status=timeout, exit=124
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
printf '%s' '[{"id":"TO","task":"SLEEP=5 refactor","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --timeout 1 --out "$run" --tasks - >/dev/null 2>&1
check "timed-out task status" "timeout" "$(jq -r '.tasks[0].status' "$run/index.json" 2>/dev/null)"
check "timed-out task exit" "124" "$(jq -r '.tasks[0].exit' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"

# Task that exits >=128 on its own WITH --timeout must NOT be misclassified as timeout
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
printf '%s' '[{"id":"E130","task":"EXIT=130 self-exit","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --timeout 10 --out "$run" --tasks - >/dev/null 2>&1
check "own exit>=128 with --timeout -> failed (not timeout)" "failed" \
  "$(jq -r '.tasks[0].status' "$run/index.json" 2>/dev/null)"
check "own exit>=128 exit code preserved" "130" \
  "$(jq -r '.tasks[0].exit' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"

# worktree mode against a scratch git repo
tmpgit=$(mktemp -d); ( cd "$tmpgit" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
( cd "$tmpgit" && printf '%s' '[{"id":"WT","task":"refactor all","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "worktree task ran" "ok" "$(jq -r '.tasks[0].status' "$run/index.json" 2>/dev/null)"
check "worktree recorded" "true" "$(jq -r '.tasks[0].worktree != null' "$run/index.json" 2>/dev/null)"
# dirty tree refused without --allow-dirty
( cd "$tmpgit" && echo dirty > f.txt && printf '%s' '[{"id":"D","task":"x","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --out "$(mktemp -d)" --tasks - >/dev/null 2>&1 )
check "dirty tree refused" "3" "$?"   # convention: exit 3 = dirty-tree guard
rm -f "$DIR/tests/fixtures/command-code"

# W7 leak-safety: trap cleans up worktrees on interrupt of an in-flight batch.
# NOTE: POSIX/bash sets SIGINT to SIG_IGN for asynchronous (backgrounded, "cmd &")
# commands run from a non-interactive, non-job-control shell, and a `trap ... INT`
# inside that command cannot override a disposition that was already SIG_IGN at
# shell startup. Since this test must background the wrapper ("$W" ... &) to be
# able to signal it mid-run, a literal SIGINT here would be silently swallowed by
# the wrapper regardless of the trap and would not exercise the fix. SIGTERM does
# not have this exemption and is also the realistic CI-cancellation / OOM-kill
# signal named in the fix brief, so it is used here as the deterministic proxy for
# "batch process is interrupted mid-run". The trap itself is still installed on
# EXIT INT TERM in dispatch-tasklist.sh so a real interactive Ctrl-C (delivered to
# a foreground process group, not a single backgrounded PID) is also covered.
# flakes if the signal races the fork; retry once acceptable
sigterm_leftover() {
  tmpgit=$(mktemp -d); ( cd "$tmpgit" && git init -q && git commit -q --allow-empty -m init )
  ln -sf mock-backend "$DIR/tests/fixtures/command-code"
  run=$(mktemp -d)
  (
    cd "$tmpgit"
    printf '%s' '[{"id":"SLOW","task":"SLEEP=5 something","backend":"command-code","model":"x"}]' \
      | "$W" --foreground --worktree --out "$run" --tasks - >/dev/null 2>&1 &
    wrapper_pid=$!
    sleep 1
    kill -TERM "$wrapper_pid" 2>/dev/null
    wait "$wrapper_pid" 2>/dev/null
  )
  sleep 0.5
  cd "$tmpgit" && git worktree list | grep -c "wt-SLOW" || true
}
leftover="$(sigterm_leftover)"
if [[ "$leftover" != "0" ]]; then
  leftover="$(sigterm_leftover)"   # retry once — signal timing can race the fork
fi
check "SIGTERM during --worktree leaves no leftover worktree" "0" "$leftover"
rm -f "$DIR/tests/fixtures/command-code"

# unresolved router -> marker + exit 2
err=$(printf '%s' '[{"id":"X","task":"y"}]' | TEMPERANCE_ROUTER=/nonexistent "$W" --tasks - 2>&1 >/dev/null)
check "router missing -> exit 2" "2" "$?"
echo "$err" | grep -q EXTERNAL_RAIL_UNAVAILABLE && echo "ok - marker on stderr" || { echo "FAIL - no marker"; fail=1; }

# zero backends AND all tasks unavailable -> marker + exit 2 (nothing external could run)
printf '%s' '[{"id":"X","task":"refactor all"}]' | TEMPERANCE_BACKENDS="" "$W" --foreground --tasks - >/dev/null 2>&1
check "zero backends -> exit 2" "2" "$?"

echo "=== dispatch-tasklist: $([[ $fail -eq 0 ]] && echo PASS || echo FAIL) ==="
exit $fail
