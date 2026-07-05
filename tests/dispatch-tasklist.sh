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

# --worktree requires a real git repository: in a non-git cwd, `git status
# --porcelain` exits 128 with empty stdout, which the dirty-tree check alone
# would misread as "clean" and proceed -> every task then fails at
# `git worktree add` with a generic error. A dedicated repo guard must catch
# this first with a clear message + a distinct exit code (not 3, which means
# "dirty tree"; not 1, which is the generic/router-missing code elsewhere).
tmpnongit=$(mktemp -d)
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
err=$( ( cd "$tmpnongit" && printf '%s' '[{"id":"NG","task":"x","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --out "$(mktemp -d)" --tasks - ) 2>&1 >/dev/null )
ngec=$?
check "--worktree outside a repo -> distinct exit code" "4" "$ngec"
[[ "$ngec" != "3" ]] && echo "ok - not confused with dirty-tree exit 3" || { echo "FAIL - collided with dirty-tree exit code"; fail=1; }
echo "$err" | grep -qi "requires a git repository" && echo "ok - clear non-repo message on stderr" || { echo "FAIL - no clear non-repo message: $err"; fail=1; }
rm -f "$DIR/tests/fixtures/command-code"

# RUNTAG sanitization: --out with git-illegal chars (space, colon) in its
# basename must not break the te-dispatch/$RUNTAG/$id branch name. Force a
# colon into --out's basename and confirm the task still runs (worktree
# branch created + task completes ok), proving RUNTAG was sanitized before
# being used in `git worktree add -b`. Uses a fresh, clean repo (the outer
# $tmpgit was deliberately dirtied by the "dirty tree refused" test above).
tmpgit_rt=$(mktemp -d); ( cd "$tmpgit_rt" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
badout="$(mktemp -d)/bad out:name"
mkdir -p "$badout"
( cd "$tmpgit_rt" && printf '%s' '[{"id":"RT","task":"refactor all","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --out "$badout" --tasks - >/dev/null 2>&1 )
check "RUNTAG-sanitized --out: task still ok" "ok" "$(jq -r '.tasks[0].status' "$badout/index.json" 2>/dev/null)"
wt_branch=$(jq -r '.tasks[0].worktree' "$badout/index.json" 2>/dev/null)
if [[ "$wt_branch" == *[:\ ]* ]]; then
  echo "FAIL - branch name still contains illegal chars: $wt_branch"; fail=1
else
  echo "ok - recorded branch name is git-legal ($wt_branch)"
fi
# focused unit check of the sanitization rule itself (same recipe as
# production: printf '%s' with no trailing newline into tr, avoiding
# basename's trailing-newline turning into a trailing '-')
_sanitize_base=$(basename "bad:out name")
sanitized=$(printf '%s' "$_sanitize_base" | tr -c 'A-Za-z0-9._-' '-')
check "RUNTAG sanitization strips colon/space" "bad-out-name" "$sanitized"
rm -f "$DIR/tests/fixtures/command-code"
rm -rf "$badout"

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

# --- concurrency cap: with a slow mock backend and --concurrency 2, dispatch
# 4 tasks and assert the number simultaneously in-flight never exceeds 2.
# Deterministic approach: the mock backend drops a marker file on start and
# removes it on exit; a background sampler polls the marker dir's file count
# at a tight interval for the whole run and records the max seen. This avoids
# timestamp/race flakiness — the marker count is exact at every sample point.
concslots=$(mktemp -d)
cat > "$DIR/tests/fixtures/command-code" <<EOF
#!/usr/bin/env bash
marker="\$(mktemp "$concslots/slot.XXXXXX")"
sleep 1
rm -f "\$marker"
printf 'MOCK_OUTPUT_START\ndone\nMOCK_OUTPUT_END\n'
EOF
chmod +x "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
maxslots=0
(
  for _ in $(seq 1 40); do
    n=$(ls -1 "$concslots" 2>/dev/null | wc -l | tr -d ' ')
    (( n > maxslots )) && maxslots=$n
    echo "$maxslots" > "$concslots/.max"
    sleep 0.1
  done
) &
sampler_pid=$!
printf '%s' '[{"id":"C1","task":"refactor all 1","backend":"command-code","model":"x"},
             {"id":"C2","task":"refactor all 2","backend":"command-code","model":"x"},
             {"id":"C3","task":"refactor all 3","backend":"command-code","model":"x"},
             {"id":"C4","task":"refactor all 4","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --concurrency 2 --out "$run" --tasks - >/dev/null 2>&1
kill "$sampler_pid" 2>/dev/null; wait "$sampler_pid" 2>/dev/null
observed_max=$(cat "$concslots/.max" 2>/dev/null || echo 0)
if (( observed_max <= 2 )); then cap_ok=true; else cap_ok=false; fi
check "concurrency cap respected (max in-flight <= 2, observed=$observed_max)" "true" "$cap_ok"
check "concurrency: all 4 tasks completed ok" "4" "$(jq -r '.summary.ok' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"
rm -rf "$concslots"

# --- multi-task background completion: default (background) mode with 3
# tasks + mock backend -> poll index.json -> assert summary.ok == 3.
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
printf '%s' '[{"id":"M1","task":"refactor all 1","backend":"command-code","model":"x"},
             {"id":"M2","task":"refactor all 2","backend":"command-code","model":"x"},
             {"id":"M3","task":"refactor all 3","backend":"command-code","model":"x"}]' \
  | "$W" --out "$run" --tasks - >/dev/null 2>&1   # default backgrounds
for _ in $(seq 1 40); do [[ -f "$run/index.json" ]] && break; sleep 0.5; done
check "multi-task background: summary.ok == 3" "3" "$(jq -r '.summary.ok' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"

# --- non-dry-run write_meta defaults: a skipped:inline task run WITHOUT
# --dry-run must still get a meta file with worktree:null and diff_path:null,
# proving the 9-arg write_meta call on the non-dispatch branch defaults
# correctly (it's called with only 7 args there).
run=$(mktemp -d)
printf '%s' '[{"id":"SK","task":"summarize these points"}]' \
  | "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
check "non-dry-run skipped:inline status" "skipped:inline" "$(jq -r '.status' "$run/SK.meta.json" 2>/dev/null)"
check "non-dry-run skipped:inline worktree:null" "null" "$(jq -r '.worktree' "$run/SK.meta.json" 2>/dev/null)"
check "non-dry-run skipped:inline diff_path:null" "null" "$(jq -r '.diff_path' "$run/SK.meta.json" 2>/dev/null)"

# --- injection regression w/ embedded newline byte: extend the hostile task
# text to also contain an ACTUAL embedded newline (not just $()/quotes/
# apostrophe) and assert it round-trips literally into <id>.out.
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
payload=$(jq -n --arg t $'line one $(touch /tmp/pwned2) and say "don'\''t"\nline two after newline' \
  '[{id:"INJNL", task:$t, backend:"command-code", model:"x"}]')
printf '%s' "$payload" | "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
got=$(sed -n '/MOCK_OUTPUT_START/,/MOCK_OUTPUT_END/p' "$run/INJNL.out" | sed '1d;$d')
expected=$'line one $(touch /tmp/pwned2) and say "don'\''t"\nline two after newline'
check "task text with embedded newline round-trips literally" "$expected" "$got"
[[ -e /tmp/pwned2 ]] && { echo "FAIL - injection executed!"; fail=1; rm -f /tmp/pwned2; }
rm -f "$DIR/tests/fixtures/command-code"

echo "=== dispatch-tasklist: $([[ $fail -eq 0 ]] && echo PASS || echo FAIL) ==="
exit $fail
