#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$DIR/package/router/dispatch-tasklist.sh"
export TEMPERANCE_ROUTER="$DIR/package/router/multi-backend-router.sh"
export TEMPERANCE_BACKENDS="command-code"
TEST_STATE_DIR="$(mktemp -d)"
export TEMPERANCE_STATE_DIR="$TEST_STATE_DIR"
trap 'rm -rf "$TEST_STATE_DIR"' EXIT
fail=0
check(){ if [[ "$2" == "$3" ]]; then echo "ok - $1"; else echo "FAIL - $1: exp[$2] got[$3]"; fail=1; fi; }
file_mode(){
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null
}
codex_args(){
  awk '/^MOCK_CODEX_ARGS_START$/{capture=1; next} /^MOCK_CODEX_ARGS_END$/{capture=0} capture'
}

# Bash 4 has no EPOCHREALTIME. Exercise the portable branch directly and
# require distinct millisecond values so parallel completion order is not
# collapsed into whole-second ties.
epoch_fn="$(sed -n '/^epoch_ms(){/,/^}/p' "$W")"
if EPOCH_FN="$epoch_fn" bash -c '
  unset EPOCHREALTIME
  eval "$EPOCH_FN"
  first=$(epoch_ms) || exit 1
  sleep 0.03
  second=$(epoch_ms) || exit 1
  (( second > first ))
'; then
  echo "ok - Bash 4 fallback clock preserves millisecond ordering"
else
  echo "FAIL - Bash 4 fallback clock collapsed completion ordering"
  fail=1
fi

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
check "dry-run routes T1 to command-code" "T1 command-code xiaomi/mimo-v2.5-pro" "$out"

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

# Backend adapters may expose optional normalized usage/cost through the
# per-attempt metrics sidecar path. The dispatcher preserves those fields in
# the attempt envelope without copying raw backend output into its summary.
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
printf '%s' '[{"id":"METRICS","task":"METRICS refactor all files","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
check "backend usage metadata preserved" "11" \
  "$(jq -r '.tasks[0].attempts[0].usage.input_tokens' "$run/index.json" 2>/dev/null)"
check "backend cost metadata preserved" "0.0042" \
  "$(jq -r '.tasks[0].attempts[0].cost.amount' "$run/index.json" 2>/dev/null)"
summary_bytes="$(wc -c < "$run/SUMMARY.md" | tr -d ' ')"
if (( summary_bytes <= 4096 )) && ! grep -q 'MOCK_OUTPUT_START' "$run/SUMMARY.md"; then
  echo "ok - summary remains compact and excludes raw model output"
else
  echo "FAIL - summary is oversized or contains raw model output"
  fail=1
fi
rm -f "$DIR/tests/fixtures/command-code"

# OmniRoute is an agentic gateway backend, not a raw chat adapter. The dispatcher
# invokes Codex with the OmniRoute provider configuration so the selected model
# retains workspace tools. A mocked Codex binary proves argv-safe prompt passage
# and final metadata without calling a live model.
ln -sf mock-codex "$DIR/tests/fixtures/codex"
omni_direct_default="$(mktemp)"
(
  unset TEMPERANCE_OMNIROUTE_CODEX_ISOLATED
  OMNIROUTE_API_KEY=test-key "$DIR/package/router/omniroute-codex.sh" \
    te-dispatch "inspect the adapter defaults"
) >"$omni_direct_default" 2>&1
if codex_args < "$omni_direct_default" | grep -qx -- '--ignore-user-config'; then
  echo "ok - OmniRoute isolates Codex user config by default"
else
  echo "FAIL - default OmniRoute isolation flag missing"; fail=1
fi
ignore_user_line="$(codex_args < "$omni_direct_default" | awk '$0=="--ignore-user-config"{print NR; exit}')"
prompt_delim_line="$(codex_args < "$omni_direct_default" | awk '$0=="--"{print NR; exit}')"
if [[ -n "$ignore_user_line" && -n "$prompt_delim_line" ]] && (( ignore_user_line < prompt_delim_line )); then
  echo "ok - isolation flag stays before the prompt delimiter"
else
  echo "FAIL - isolation flag ordering is wrong"; fail=1
fi
if ! codex_args < "$omni_direct_default" | grep -qx -- '--ignore-rules'; then
  echo "ok - OmniRoute never adds --ignore-rules"
else
  echo "FAIL - forbidden --ignore-rules flag present"; fail=1
fi

omni_direct_empty="$(mktemp)"
TEMPERANCE_OMNIROUTE_CODEX_ISOLATED= OMNIROUTE_API_KEY=test-key \
  "$DIR/package/router/omniroute-codex.sh" te-dispatch "inspect empty isolation override" \
  >"$omni_direct_empty" 2>&1
if codex_args < "$omni_direct_empty" | grep -qx -- '--ignore-user-config'; then
  echo "ok - empty isolation env still isolates"
else
  echo "FAIL - empty isolation env disabled isolation"; fail=1
fi

omni_direct_one="$(mktemp)"
TEMPERANCE_OMNIROUTE_CODEX_ISOLATED=1 OMNIROUTE_API_KEY=test-key \
  "$DIR/package/router/omniroute-codex.sh" te-dispatch "inspect numeric isolation override" \
  >"$omni_direct_one" 2>&1
if codex_args < "$omni_direct_one" | grep -qx -- '--ignore-user-config'; then
  echo "ok - nonzero isolation env still isolates"
else
  echo "FAIL - nonzero isolation env disabled isolation"; fail=1
fi

omni_direct_other="$(mktemp)"
TEMPERANCE_OMNIROUTE_CODEX_ISOLATED=custom OMNIROUTE_API_KEY=test-key \
  "$DIR/package/router/omniroute-codex.sh" te-dispatch "inspect arbitrary isolation override" \
  >"$omni_direct_other" 2>&1
if codex_args < "$omni_direct_other" | grep -qx -- '--ignore-user-config'; then
  echo "ok - arbitrary isolation env still isolates"
else
  echo "FAIL - arbitrary isolation env disabled isolation"; fail=1
fi

omni_direct_optout="$(mktemp)"
TEMPERANCE_OMNIROUTE_CODEX_ISOLATED=0 OMNIROUTE_API_KEY=super-secret \
  "$DIR/package/router/omniroute-codex.sh" te-dispatch "inspect explicit isolation opt-out" \
  >"$omni_direct_optout" 2>&1
if ! codex_args < "$omni_direct_optout" | grep -qx -- '--ignore-user-config' \
    && grep -qF 'TEMPERANCE_OMNIROUTE_CODEX_ISOLATED=0 disables Codex user-config isolation' "$omni_direct_optout" \
    && ! grep -qF 'super-secret' "$omni_direct_optout"; then
  echo "ok - exact-zero isolation opt-out warns without leaking credentials"
else
  echo "FAIL - exact-zero isolation opt-out behavior is wrong"; fail=1
fi

profile_home="$(mktemp -d)"
touch "$profile_home/temperance-coding.config.toml"
omni_direct_configured="$(mktemp)"
CODEX_HOME="$profile_home" OMNIROUTE_API_KEY=test-key \
  TEMPERANCE_OMNIROUTE_BASE_URL="http://127.0.0.1:20128" \
  TEMPERANCE_OMNIROUTE_WIRE_API="responses" \
  TEMPERANCE_OMNIROUTE_CODEX_SANDBOX="workspace-write" \
  TEMPERANCE_CORRELATION_ID="tc_test_route" \
  "$DIR/package/router/omniroute-codex.sh" te-dispatch "inspect the explicit routing configuration" \
  >"$omni_direct_configured" 2>&1
configured_args="$(codex_args < "$omni_direct_configured")"
for expected in \
  'exec' \
  '-m' \
  'te-dispatch' \
  'model_provider="omniroute"' \
  'model_providers.omniroute.name="OmniRoute"' \
  'model_providers.omniroute.base_url="http://127.0.0.1:20128/v1"' \
  'model_providers.omniroute.env_key="OMNIROUTE_API_KEY"' \
  'model_providers.omniroute.wire_api="responses"' \
  'model_providers.omniroute.requires_openai_auth=false' \
  'approval_policy="never"' \
  '--sandbox' \
  'workspace-write' \
  '--ephemeral' \
  '--skip-git-repo-check' \
  '--color' \
  'never' \
  '--profile' \
  'temperance-coding' \
  'X-Temperance-Correlation-ID' \
  'tc_test_route'
do
  if grep -qF -- "$expected" <<< "$configured_args"; then
    :
  else
    echo "FAIL - OmniRoute configuration missing [$expected]"; fail=1
  fi
done
rm -f "$omni_direct_default" "$omni_direct_empty" "$omni_direct_one" \
  "$omni_direct_other" "$omni_direct_optout" "$omni_direct_configured"
rm -rf "$profile_home"

run=$(mktemp -d)
payload='[{"id":"OMNI","task":"refactor the auth module safely","backend":"omniroute","model":"te-dispatch"}]'
printf '%s' "$payload" \
  | OMNIROUTE_API_KEY=test-key TEMPERANCE_BACKENDS="omniroute command-code" \
    "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
check "OmniRoute agent backend succeeds through Codex" "ok" \
  "$(jq -r '.tasks[0].status' "$run/index.json" 2>/dev/null)"
check "OmniRoute backend recorded in attempt envelope" "omniroute" \
  "$(jq -r '.tasks[0].attempts[0].backend' "$run/index.json" 2>/dev/null)"
check "OmniRoute model recorded in attempt envelope" "te-dispatch" \
  "$(jq -r '.tasks[0].attempts[0].model' "$run/index.json" 2>/dev/null)"
omni_correlation="$(jq -r '.tasks[0].correlation_id' "$run/index.json" 2>/dev/null)"
check "OmniRoute attempt correlation matches metadata" "$omni_correlation" \
  "$(jq -r '.tasks[0].attempts[0].correlation_id' "$run/index.json" 2>/dev/null)"
check "OmniRoute plan correlation matches metadata" "$omni_correlation" \
  "$(jq -r '.correlation_id' "$run/OMNI.plan.json" 2>/dev/null)"
if grep -qF 'refactor the auth module safely' "$run/OMNI.out"; then
  echo "ok - OmniRoute task text passed literally to Codex"
else
  echo "FAIL - OmniRoute task text missing from Codex argv"; fail=1
fi
if grep -qF "MOCK_CODEX_CORRELATION=$omni_correlation" "$run/OMNI.out" \
    && grep -qF 'X-Temperance-Correlation-ID' "$run/OMNI.out" \
    && grep -qF "$omni_correlation" "$run/OMNI.out"; then
  echo "ok - OmniRoute Codex request carries correlation header"
else
  echo "FAIL - OmniRoute Codex correlation header missing"; fail=1
fi
if grep -qF 'model_context_window=128000' "$run/OMNI.out" \
    && grep -qF 'model_auto_compact_token_limit=108000' "$run/OMNI.out"; then
  echo "ok - Spark fleet advertises its bounded context contract"
else
  echo "FAIL - Spark fleet context contract missing"; fail=1
fi
non_spark_out="$(mktemp)"
OMNIROUTE_API_KEY=test-key "$DIR/package/router/omniroute-codex.sh" \
  temperance-coding "inspect the bounded adapter contract" >"$non_spark_out" 2>&1
if grep -qF 'model_context_window=200000' "$non_spark_out" \
    && grep -qF 'model_auto_compact_token_limit=170000' "$non_spark_out"; then
  echo "ok - non-Spark portfolios retain their existing context contract"
else
  echo "FAIL - non-Spark context contract changed"; fail=1
fi
rm -f "$non_spark_out"

# A zero-exit OmniRoute/Codex transport diagnostic is not task completion.
# Freeze one explicit fallback chain so the validator can fail the malformed
# gateway attempt without inventing a route after execution has started.
stream_mock_dir="$(mktemp -d)"
stream_router="$stream_mock_dir/router.sh"
stream_codex="$stream_mock_dir/codex"
cat > "$stream_router" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"policy_version":"test","mode":"enforce","plan_id":"rp_stream","correlation_id":"tc_router_shared","input_hash":"same","task_type":"coding","decision_time_ms":1000,"diverged":false,"status":"ok","static_order":[{"backend":"omniroute","model":"te-dispatch","static_rank":0,"failure_domain":"gateway"},{"backend":"command-code","model":"x","static_rank":1,"failure_domain":"direct"}],"proposed_order":[{"backend":"omniroute","model":"te-dispatch","static_rank":0,"failure_domain":"gateway"},{"backend":"command-code","model":"x","static_rank":1,"failure_domain":"direct"}],"selected_order":[{"backend":"omniroute","model":"te-dispatch","static_rank":0,"failure_domain":"gateway"},{"backend":"command-code","model":"x","static_rank":1,"failure_domain":"direct"}],"candidates":[]}'
EOF
cat > "$stream_codex" <<'EOF'
#!/usr/bin/env bash
# Mirrors real `codex`'s -o/--output-last-message contract: the caller
# (omniroute-codex.sh) reads the final message from that file, not stdout.
out_file=""
all_args=("$@")
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then out_file="$2"; fi
  shift
done
content=""
case " ${all_args[*]} " in
  *" NO_ONLY "*) content=$'NO\n' ;;
  *" BAD_STREAM "*) content=$'OutputTextDelta without active item\n' ;;
  *" BLANK_STREAM "*) content=$'\n' ;;
  *" SHORT_TAIL "*) content=$'OutputTextDelta without active item\ntokens used\n69,384\nAL\n' ;;
  *" NOISY_NO "*)
    content=$'WARN plugin cache unavailable\n{"type":"tool","status":"completed"}\ntokens used\n1,234\nNO\n'
    ;;
  *" NOISY_DIAG "*)
    content=$'WARN provider trace\ntool completed successfully\ntokens used\n2,345\nOutputTextDelta without active item\n'
    ;;
  *" VALID_STREAM "*)
    content=$'OutputTextDelta without active item\nCompleted the requested refactor with verified tests.\n'
    ;;
  *) content=$'Completed substantive OmniRoute work.\n' ;;
esac
if [[ -n "$out_file" ]]; then
  printf '%s' "$content" > "$out_file"
else
  printf '%s' "$content"
fi
exit 0
EOF
chmod +x "$stream_router" "$stream_codex"
ln -sf mock-backend "$DIR/tests/fixtures/command-code"

no_run="$(mktemp -d)"
printf '%s' '[{"id":"NOFALSE","task":"NO_ONLY refactor the auth module"}]' \
  | PATH="$stream_mock_dir:$PATH" TEMPERANCE_ROUTER="$stream_router" \
    TEMPERANCE_BACKENDS="omniroute command-code" OMNIROUTE_API_KEY=test-key \
    "$W" --foreground --out "$no_run" --tasks - >/dev/null 2>&1
check "literal NO falls through frozen fallback" "command-code" \
  "$(jq -r '.tasks[0].backend' "$no_run/index.json" 2>/dev/null)"
check "literal NO attempt is failed despite exit zero" "failed:65" \
  "$(jq -r '.tasks[0].attempts[0] | "\(.status):\(.exit)"' "$no_run/index.json" 2>/dev/null)"
check "literal NO uses only the frozen two-attempt chain" "2" \
  "$(jq -r '.tasks[0].attempts | length' "$no_run/index.json" 2>/dev/null)"

diagnostic_run="$(mktemp -d)"
printf '%s' '[{"id":"DIAGFALSE","task":"BAD_STREAM refactor the auth module"}]' \
  | PATH="$stream_mock_dir:$PATH" TEMPERANCE_ROUTER="$stream_router" \
    TEMPERANCE_BACKENDS="omniroute command-code" OMNIROUTE_API_KEY=test-key \
    "$W" --foreground --out "$diagnostic_run" --tasks - >/dev/null 2>&1
check "inactive-item diagnostic falls through frozen fallback" "command-code" \
  "$(jq -r '.tasks[0].backend' "$diagnostic_run/index.json" 2>/dev/null)"
check "inactive-item diagnostic is recorded failed" "failed:65" \
  "$(jq -r '.tasks[0].attempts[0] | "\(.status):\(.exit)"' "$diagnostic_run/index.json" 2>/dev/null)"

noisy_no_run="$(mktemp -d)"
printf '%s' '[{"id":"NOISYNO","task":"NOISY_NO refactor the auth module"}]' \
  | PATH="$stream_mock_dir:$PATH" TEMPERANCE_ROUTER="$stream_router" \
    TEMPERANCE_BACKENDS="omniroute command-code" OMNIROUTE_API_KEY=test-key \
    "$W" --foreground --out "$noisy_no_run" --tasks - >/dev/null 2>&1
check "noisy trace ending in NO falls through frozen fallback" "command-code:failed:65" \
  "$(jq -r '.tasks[0] | "\(.backend):\(.attempts[0].status):\(.attempts[0].exit)"' "$noisy_no_run/index.json" 2>/dev/null)"

noisy_diagnostic_run="$(mktemp -d)"
printf '%s' '[{"id":"NOISYDIAG","task":"NOISY_DIAG refactor the auth module"}]' \
  | PATH="$stream_mock_dir:$PATH" TEMPERANCE_ROUTER="$stream_router" \
    TEMPERANCE_BACKENDS="omniroute command-code" OMNIROUTE_API_KEY=test-key \
    "$W" --foreground --out "$noisy_diagnostic_run" --tasks - >/dev/null 2>&1
check "noisy trace ending in inactive-item diagnostic falls back" "command-code:failed:65" \
  "$(jq -r '.tasks[0] | "\(.backend):\(.attempts[0].status):\(.attempts[0].exit)"' "$noisy_diagnostic_run/index.json" 2>/dev/null)"

blank_run="$(mktemp -d)"
printf '%s' '[{"id":"BLANKFALSE","task":"BLANK_STREAM refactor the auth module"}]' \
  | PATH="$stream_mock_dir:$PATH" TEMPERANCE_ROUTER="$stream_router" \
    TEMPERANCE_BACKENDS="omniroute command-code" OMNIROUTE_API_KEY=test-key \
    "$W" --foreground --out "$blank_run" --tasks - >/dev/null 2>&1
check "blank OmniRoute completion falls through frozen fallback" "command-code" \
  "$(jq -r '.tasks[0].backend' "$blank_run/index.json" 2>/dev/null)"

short_tail_run="$(mktemp -d)"
printf '%s' '[{"id":"SHORTFALSE","task":"SHORT_TAIL refactor the auth module"}]' \
  | PATH="$stream_mock_dir:$PATH" TEMPERANCE_ROUTER="$stream_router" \
    TEMPERANCE_BACKENDS="omniroute command-code" OMNIROUTE_API_KEY=test-key \
    "$W" --foreground --out "$short_tail_run" --tasks - >/dev/null 2>&1
check "truncated two-character tail falls through frozen fallback" "command-code:failed:65" \
  "$(jq -r '.tasks[0] | "\(.backend):\(.attempts[0].status):\(.attempts[0].exit)"' "$short_tail_run/index.json" 2>/dev/null)"

valid_stream_run="$(mktemp -d)"
printf '%s' '[{"id":"VALIDOMNI","task":"VALID_STREAM refactor the auth module"}]' \
  | PATH="$stream_mock_dir:$PATH" TEMPERANCE_ROUTER="$stream_router" \
    TEMPERANCE_BACKENDS="omniroute command-code" OMNIROUTE_API_KEY=test-key \
    "$W" --foreground --out "$valid_stream_run" --tasks - >/dev/null 2>&1
check "substantive OmniRoute output remains successful" "omniroute:ok:1" \
  "$(jq -r '.tasks[0] | "\(.backend):\(.status):\(.attempts | length)"' "$valid_stream_run/index.json" 2>/dev/null)"
rm -rf "$stream_mock_dir"
rm -f "$DIR/tests/fixtures/command-code"

tmpgit_perm=$(mktemp -d); ( cd "$tmpgit_perm" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
perm_run="$(mktemp -d)"
( cd "$tmpgit_perm" && printf '%s' '[{"id":"PERM","task":"WRITE=file-perm.txt:hello-perm do work","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --apply-worktree --out "$perm_run" --tasks - >/dev/null 2>&1 )
check "output directory mode is 700" "700" "$(file_mode "$perm_run")"
for artifact in \
  "$perm_run/PERM.plan.json" \
  "$perm_run/PERM.out" \
  "$perm_run/PERM.meta.json" \
  "$perm_run/PERM.diff" \
  "$perm_run/SUMMARY.md" \
  "$perm_run/index.json" \
  "$perm_run/MERGE-REPORT.md"
do
  check "dispatcher artifact mode 600: $(basename "$artifact")" "600" "$(file_mode "$artifact")"
done
rm -f "$DIR/tests/fixtures/command-code"

real_git="$(command -v git)"
tmpgit_leak=$(mktemp -d); ( cd "$tmpgit_leak" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
leak_run="$(mktemp -d)"
git_wrapper_dir="$(mktemp -d)"
cat > "$git_wrapper_dir/git" <<EOF
#!/usr/bin/env bash
if [[ "\${1:-}" == "worktree" && "\${2:-}" == "remove" ]]; then
  exit 1
fi
exec "$real_git" "\$@"
EOF
chmod +x "$git_wrapper_dir/git"
( cd "$tmpgit_leak" && printf '%s' '[{"id":"LEAKMODE","task":"WRITE=file-leak.txt:hello-leak do work","backend":"command-code","model":"x"}]' \
  | PATH="$git_wrapper_dir:$PATH" "$W" --foreground --worktree --out "$leak_run" --tasks - >/dev/null 2>&1 )
[[ -f "$leak_run/.leaks" ]] && echo "ok - leak artifact recorded when worktree cleanup fails" || { echo "FAIL - leak artifact missing"; fail=1; }
check "dispatcher artifact mode 600: .leaks" "600" "$(file_mode "$leak_run/.leaks")"
rm -f "$DIR/tests/fixtures/command-code"

cat > "$DIR/tests/fixtures/command-code" <<'EOF'
#!/usr/bin/env bash
umask
EOF
chmod +x "$DIR/tests/fixtures/command-code"
umask_run="$(mktemp -d)"
(
  umask 0027
  printf '%s' '[{"id":"UMASK","task":"report inherited umask","backend":"command-code","model":"x"}]' \
    | "$W" --foreground --out "$umask_run" --tasks - >/dev/null 2>&1
)
check "worker observes caller umask unchanged" "0027" "$(tr -d '\r\n' < "$umask_run/UMASK.out")"
rm -f "$DIR/tests/fixtures/command-code"

# A caller-supplied --out directory is a security boundary. If its mode cannot
# be established as 700, dispatch must stop before publishing a plan or output.
chmod_fail_out="$(mktemp -d)"
chmod 755 "$chmod_fail_out"
chmod_fail_bin="$(mktemp -d)"
real_chmod="$(command -v chmod)"
cat > "$chmod_fail_bin/chmod" <<EOF
#!/usr/bin/env bash
for arg in "\$@"; do
  if [[ "\$arg" == "$chmod_fail_out" ]]; then
    exit 1
  fi
done
exec "$real_chmod" "\$@"
EOF
chmod +x "$chmod_fail_bin/chmod"
printf '%s' '[{"id":"MODEFAIL","task":"refactor safely","backend":"command-code","model":"x"}]' \
  | PATH="$chmod_fail_bin:$PATH" "$W" --foreground --out "$chmod_fail_out" --tasks - \
    >/dev/null 2>&1
check "unsecured caller output directory fails closed" "5" "$?"
if compgen -G "$chmod_fail_out/*.plan.json" >/dev/null \
    || compgen -G "$chmod_fail_out/*.out" >/dev/null; then
  echo "FAIL - unsecured output directory received dispatcher artifacts"; fail=1
else
  echo "ok - unsecured output directory receives no dispatcher artifacts"
fi

# Gateway failure and direct fallback remain one trace even though execution
# crosses the OmniRoute/Codex adapter boundary into a direct CLI backend.
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
fallback_run=$(mktemp -d)
printf '%s' '[{"id":"TRACE","task":"FAIL_OMNIROUTE refactor the auth module"}]' \
  | OMNIROUTE_API_KEY=test-key TEMPERANCE_BACKENDS="omniroute command-code" \
    "$W" --foreground --out "$fallback_run" --tasks - >/dev/null 2>&1
trace_correlation="$(jq -r '.tasks[0].correlation_id' "$fallback_run/index.json" 2>/dev/null)"
check "gateway failure falls back to direct backend" "command-code" \
  "$(jq -r '.tasks[0].backend' "$fallback_run/index.json" 2>/dev/null)"
check "gateway and direct attempts share correlation" "1" \
  "$(jq -r --arg correlation "$trace_correlation" '[.tasks[0].attempts[] | select(.correlation_id == $correlation)] | length == 2 | if . then 1 else 0 end' "$fallback_run/index.json" 2>/dev/null)"
check "gateway attempt records gateway failure domain" "gateway" \
  "$(jq -r '.tasks[0].attempts[0].failure_domain' "$fallback_run/index.json" 2>/dev/null)"
check "direct fallback records direct failure domain" "direct" \
  "$(jq -r '.tasks[0].attempts[1].failure_domain' "$fallback_run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"
rm -f "$DIR/tests/fixtures/codex"

# flag-like task text must NOT be interpreted as router flags
# ("--help" exactly matches the router's -h|--help case unless "--" ends option parsing)
out=$(printf '%s' '[{"id":"F1","task":"--help"}]' | "$W" --dry-run --tasks - 2>/dev/null)
check "flag-like task -> dispatch (not swallowed as --help)" \
  "F1 command-code poolside/laguna-s-2.1-free" "$out"

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

# Router fingerprints are decision evidence, not execution identities. Four
# tasks frozen against the same same-second plan must still receive four unique
# per-execution/per-task correlations, each preserved through its own attempts.
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
correlation_run="$(mktemp -d)"
correlation_router="$correlation_run/router.sh"
cat > "$correlation_router" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"policy_version":"test","mode":"enforce","plan_id":"rp_same_second","correlation_id":"tc_shared_fingerprint","input_hash":"same","task_type":"coding","decision_time_ms":1000,"diverged":false,"status":"ok","static_order":[{"backend":"command-code","model":"x","static_rank":0,"failure_domain":"direct"}],"proposed_order":[{"backend":"command-code","model":"x","static_rank":0,"failure_domain":"direct"}],"selected_order":[{"backend":"command-code","model":"x","static_rank":0,"failure_domain":"direct"}],"candidates":[]}'
EOF
chmod +x "$correlation_router"
printf '%s' '[{"id":"CORR1","task":"refactor all files"},{"id":"CORR2","task":"refactor all files"},{"id":"CORR3","task":"refactor all files"},{"id":"CORR4","task":"refactor all files"}]' \
  | TEMPERANCE_ROUTER="$correlation_router" TEMPERANCE_BACKENDS="command-code" \
    "$W" --foreground --out "$correlation_run" --tasks - >/dev/null 2>&1
check "four same-second tasks receive unique correlations" "true" \
  "$(jq -r '[.tasks[].correlation_id] | length == 4 and (unique | length == 4)' "$correlation_run/index.json" 2>/dev/null)"
check "plan correlations are unique across same-second tasks" "true" \
  "$(jq -s 'map(.correlation_id) | length == 4 and (unique | length == 4)' "$correlation_run"/CORR*.plan.json 2>/dev/null)"
check "metadata and attempts keep one correlation per task" "true" \
  "$(jq -r 'all(.tasks[]; . as $task | ([.attempts[].correlation_id] | unique) == [$task.correlation_id])' "$correlation_run/index.json" 2>/dev/null)"
check "attempt metadata is duplicate-free" "true" \
  "$(jq -r 'all(.tasks[]; ([.attempts[].attempt_index] | length) == ([.attempts[].attempt_index] | unique | length))' "$correlation_run/index.json" 2>/dev/null)"

correlation_run_two="$(mktemp -d)"
printf '%s' '[{"id":"CORR1","task":"refactor all files"}]' \
  | TEMPERANCE_ROUTER="$correlation_router" TEMPERANCE_BACKENDS="command-code" \
    "$W" --foreground --out "$correlation_run_two" --tasks - >/dev/null 2>&1
check "separate executions receive distinct correlations" "true" \
  "$(jq -n --arg first "$(jq -r '.tasks[0].correlation_id' "$correlation_run/index.json")" \
    --arg second "$(jq -r '.tasks[0].correlation_id' "$correlation_run_two/index.json")" '$first != $second')"
rm -f "$DIR/tests/fixtures/command-code"

# OmniRoute-inspired policy seam: preclassification must freeze exactly one
# plan and run_one must consume that file rather than asking the router to
# re-derive a fallback chain against newer mutable state.
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
counter="$run/router-calls.log"
wrapper="$run/router-wrapper.sh"
cat > "$wrapper" <<EOF
#!/usr/bin/env bash
case "\${1:-}" in
  --plan-json) printf '%s\n' plan >> "$counter" ;;
  --route-only|--route-only-with-fallbacks) printf '%s\n' legacy >> "$counter" ;;
esac
exec "$DIR/package/router/multi-backend-router.sh" "\$@"
EOF
chmod +x "$wrapper"
printf '%s' '[{"id":"PLAN","task":"refactor all files"}]' \
  | TEMPERANCE_ROUTER="$wrapper" TEMPERANCE_STATE_DIR="$run/state" \
    "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
[[ -f "$run/PLAN.plan.json" ]] && echo "ok - frozen dispatch plan written" || { echo "FAIL - no frozen dispatch plan"; fail=1; }
check "frozen plan selected backend" "command-code" \
  "$(jq -r '.selected_order[0].backend' "$run/PLAN.plan.json" 2>/dev/null)"
check "metadata plan_id matches frozen plan" \
  "$(jq -r '.plan_id' "$run/PLAN.plan.json" 2>/dev/null)" \
  "$(jq -r '.plan_id' "$run/PLAN.meta.json" 2>/dev/null)"
check "metadata correlation matches frozen plan" \
  "$(jq -r '.correlation_id' "$run/PLAN.plan.json" 2>/dev/null)" \
  "$(jq -r '.correlation_id' "$run/PLAN.meta.json" 2>/dev/null)"
check "attempt correlation matches frozen plan" \
  "$(jq -r '.correlation_id' "$run/PLAN.plan.json" 2>/dev/null)" \
  "$(jq -r '.attempts[0].correlation_id' "$run/PLAN.meta.json" 2>/dev/null)"
check "metadata records plan path" "$run/PLAN.plan.json" \
  "$(jq -r '.plan_path' "$run/PLAN.meta.json" 2>/dev/null)"
check "router plan resolved once" "1" "$(grep -c '^plan$' "$counter" 2>/dev/null || true)"
check "execution never re-routes legacy chain" "0" "$(grep -c '^legacy$' "$counter" 2>/dev/null || true)"
check "observation reducer records success" "1" \
  "$(jq -r '.backends["command-code"].success_count' "$run/state/routing-observations.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"

# Queued workers consume the parent-cached selected_order, not the mutable
# inspection artifact. Tampering with a queued task's plan file must not alter
# the backend that actually runs or the result metadata.
ln -sf slow-mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
(
  printf '%s' '[{"id":"TAMPER1","task":"refactor all files","backend":"command-code","model":"x"},{"id":"TAMPER2","task":"refactor all files","backend":"command-code","model":"x"}]' \
    | TEMPERANCE_STATE_DIR="$run/state" "$W" --foreground --concurrency 1 --out "$run" --tasks - >/dev/null 2>&1
) &
tamper_pid=$!
for _ in $(seq 1 40); do
  [[ -f "$run/TAMPER2.plan.json" ]] && break
  sleep 0.05
done
if [[ -f "$run/TAMPER2.plan.json" ]]; then
  jq '.selected_order=[{"backend":"evil","model":"tampered","static_rank":0}]' \
    "$run/TAMPER2.plan.json" > "$run/TAMPER2.plan.json.tmp"
  mv -f "$run/TAMPER2.plan.json.tmp" "$run/TAMPER2.plan.json"
fi
wait "$tamper_pid"
check "tampered plan cannot change cached execution backend" "command-code" \
  "$(jq -r '.backend' "$run/TAMPER2.meta.json" 2>/dev/null)"
check "tampered plan cannot change successful result" "ok" \
  "$(jq -r '.status' "$run/TAMPER2.meta.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"

# Observation updates are advisory. A stale lock must be bounded well below a
# backend turn and must not change the real task's result.
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
mkdir -p "$run/state/routing-observations.json.lock"
printf '%s' '[{"id":"LOCK","task":"refactor all files","backend":"command-code","model":"x"}]' \
  | TEMPERANCE_STATE_DIR="$run/state" "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
check "stale observation lock leaves task successful" "ok" \
  "$(jq -r '.tasks[0].status' "$run/index.json" 2>/dev/null)"
SECONDS=0
bun "$DIR/package/router/routing-policy.ts" observe \
  --state "$run/state/routing-observations.json" --index "$run/index.json" \
  >/dev/null 2>&1
lock_elapsed=$SECONDS
if (( lock_elapsed <= 1 )); then
  echo "ok - held observation lock is bounded (${lock_elapsed}s)"
else
  echo "FAIL - held observation lock delayed observer ${lock_elapsed}s"
  fail=1
fi
rm -f "$DIR/tests/fixtures/command-code"

# An unwritable/invalid state target forces the observer to fail. Dispatch
# evidence must remain successful and index.json must stay valid.
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
printf '%s' '[{"id":"OBSFAIL","task":"refactor all files","backend":"command-code","model":"x"}]' \
  | TEMPERANCE_ROUTING_STATE="/dev/null/routing-observations.json" \
    "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
check "observation write failure leaves task successful" "ok" \
  "$(jq -r '.tasks[0].status' "$run/index.json" 2>/dev/null)"
check "observation write failure preserves batch success" "1" \
  "$(jq -r '.summary.ok' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"

# Defense in depth: even if a custom router returns status=ok with an empty
# selected_order, the batch must classify it unavailable instead of executing
# the cached none:- sentinel.
run=$(mktemp -d)
wrapper="$run/empty-plan-router.sh"
cat > "$wrapper" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"policy_version":"bad","mode":"enforce","plan_id":"rp_empty","input_hash":"bad","task_type":"balanced","decision_time_ms":1,"diverged":true,"status":"ok","static_order":[{"backend":"command-code","model":"x","static_rank":0}],"proposed_order":[],"selected_order":[],"candidates":[]}'
EOF
chmod +x "$wrapper"
empty_preview=$(printf '%s' '[{"id":"EMPTY","task":"refactor all files"}]' \
  | TEMPERANCE_ROUTER="$wrapper" "$W" --dry-run --out "$run" --tasks - 2>/dev/null)
check "empty selected plan is unavailable" "EMPTY unavailable" "$empty_preview"

# background-by-default: prints run dir fast, task completes eventually
# (uses a slow mock so blocking vs backgrounding is actually observable)
ln -sf slow-mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
start=$(date +%s)
printed=$(printf '%s' '[{"id":"BG","task":"refactor all","backend":"command-code","model":"x"}]' \
  | "$W" --out "$run" --tasks - 2>/dev/null)   # default backgrounds
elapsed=$(( $(date +%s) - start ))
check "background prints run dir" "$run" "$printed"
# The assertion is about non-blocking behavior; allow a busy workstation a
# small scheduling margin while the background process is being spawned.
[[ $elapsed -le 5 ]] && echo "ok - returns fast (${elapsed}s)" || { echo "FAIL - blocked ${elapsed}s"; fail=1; }
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
# The worker deliberately ignores TERM and would create a late artifact after
# two seconds if it survived. This proves cleanup freezes/kills/reaps the whole
# process tree before worktree removal and final permission hardening.
sigterm_leftover() {
  local tmpgit sigbin pidfile statusfile run wrapper_pid wrapper_status count alive
  local before_manifest after_manifest stable p artifact
  tmpgit=$(mktemp -d); ( cd "$tmpgit" && git init -q && git commit -q --allow-empty -m init )
  sigbin=$(mktemp -d)
  pidfile=$(mktemp)
  statusfile=$(mktemp)
  cat > "$sigbin/command-code" <<'EOF'
#!/usr/bin/env bash
trap '' TERM
sleep 2 &
child=$!
printf '%s %s\n' "$$" "$child" > "$SIGNAL_PID_FILE"
wait "$child"
printf 'late\n' > "$SIGNAL_LATE_FILE"
printf 'MOCK_OUTPUT_START\nlate\nMOCK_OUTPUT_END\n'
EOF
  chmod +x "$sigbin/command-code"
  run=$(mktemp -d)
  (
    cd "$tmpgit"
    printf '%s' '[{"id":"SLOW","task":"something","backend":"command-code","model":"x"}]' \
      | SIGNAL_PID_FILE="$pidfile" SIGNAL_LATE_FILE="$run/LATE.generated" \
        PATH="$sigbin:$PATH" "$W" --foreground --worktree --out "$run" --tasks - >/dev/null 2>&1 &
    wrapper_pid=$!
    for _ in {1..50}; do [[ -s "$pidfile" ]] && break; sleep 0.1; done
    kill -TERM "$wrapper_pid" 2>/dev/null
    wait "$wrapper_pid" 2>/dev/null
    wrapper_status=$?
    printf '%s\n' "$wrapper_status" > "$statusfile"
  )
  before_manifest="$(
    while IFS= read -r artifact; do
      printf '%s:%s\n' "$artifact" "$(file_mode "$artifact")"
    done < <(find "$run" -maxdepth 1 -type f | sort)
  )"
  sleep 2.5
  after_manifest="$(
    while IFS= read -r artifact; do
      printf '%s:%s\n' "$artifact" "$(file_mode "$artifact")"
    done < <(find "$run" -maxdepth 1 -type f | sort)
  )"
  [[ "$before_manifest" == "$after_manifest" ]] && stable=true || stable=false
  count="$(cd "$tmpgit" && git worktree list | grep -c "wt-SLOW" || true)"
  alive=0
  if [[ -s "$pidfile" ]]; then
    for p in $(<"$pidfile"); do
      kill -0 "$p" 2>/dev/null && alive=$((alive+1))
    done
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' "$count" "$run" "$alive" "$stable" "$(<"$statusfile")"
  rm -rf "$sigbin" "$pidfile" "$statusfile"
}
sigterm_result="$(sigterm_leftover)"
leftover="${sigterm_result%%$'\t'*}"
sigterm_rest="${sigterm_result#*$'\t'}"
sigterm_run="${sigterm_rest%%$'\t'*}"
sigterm_rest="${sigterm_rest#*$'\t'}"
sigterm_alive="${sigterm_rest%%$'\t'*}"
sigterm_rest="${sigterm_rest#*$'\t'}"
sigterm_stable="${sigterm_rest%%$'\t'*}"
sigterm_status="${sigterm_rest#*$'\t'}"
check "SIGTERM during --worktree leaves no leftover worktree" "0" "$leftover"
check "SIGTERM exits with conventional status 143" "143" "$sigterm_status"
check "SIGTERM leaves no live worker descendants" "0" "$sigterm_alive"
check "SIGTERM creates no artifacts after cleanup returns" "true" "$sigterm_stable"
check "SIGTERM run directory remains mode 700" "700" "$(file_mode "$sigterm_run")"
interrupted_modes_ok=true
shopt -s nullglob
for artifact in "$sigterm_run"/* "$sigterm_run"/.[!.]* "$sigterm_run"/..?*; do
  [[ -f "$artifact" ]] || continue
  if [[ "$(file_mode "$artifact")" != "600" ]]; then
    interrupted_modes_ok=false
    break
  fi
done
shopt -u nullglob
check "SIGTERM retained artifacts remain mode 600" "true" "$interrupted_modes_ok"

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

# --- fallback chain (#8): per-task cc -> grok -> kimi fallback -------------
# grok is not PATH-mockable (invoked via absolute $HOME/.grok/bin/grok), so
# the execution-level fallback tests below use only command-code + kimi
# (both bareword/PATH-invoked -> mockable). grok ordering is covered at the
# router level in tests/router-hardening.sh.

# (a) primary fails, fallback succeeds: command-code exits 1, kimi exits 0
# on the SAME task payload -> overall status=ok, attempts length 2,
# attempts[0] failed/command-code, final top-level backend=kimi.
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
ln -sf mock-backend "$DIR/tests/fixtures/kimi"
run=$(mktemp -d)
printf '%s' '[{"id":"FB1","task":"command-code_EXIT=1 kimi_EXIT=0 do stuff"}]' \
  | TEMPERANCE_BACKENDS="command-code kimi" "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
check "fallback success: top-level status=ok" "ok" "$(jq -r '.tasks[0].status' "$run/index.json" 2>/dev/null)"
check "fallback success: top-level backend=kimi (final attempt)" "kimi" "$(jq -r '.tasks[0].backend' "$run/index.json" 2>/dev/null)"
check "fallback success: attempts length 2" "2" "$(jq -r '.tasks[0].attempts | length' "$run/index.json" 2>/dev/null)"
check "fallback success: attempts[0].backend=command-code" "command-code" "$(jq -r '.tasks[0].attempts[0].backend' "$run/index.json" 2>/dev/null)"
check "fallback success: attempts[0].status=failed" "failed" "$(jq -r '.tasks[0].attempts[0].status' "$run/index.json" 2>/dev/null)"
check "fallback success: attempts[1].backend=kimi" "kimi" "$(jq -r '.tasks[0].attempts[1].backend' "$run/index.json" 2>/dev/null)"
check "fallback success: attempts[1].status=ok" "ok" "$(jq -r '.tasks[0].attempts[1].status' "$run/index.json" 2>/dev/null)"
check "attempt event is structured" "attempt" "$(jq -r '.tasks[0].attempts[0].event' "$run/index.json" 2>/dev/null)"
check "fallback event records its reason" "previous-attempt-failed" \
  "$(jq -r '.tasks[0].attempts[1].fallback_reason' "$run/index.json" 2>/dev/null)"
check "attempt event records completion time" "number" \
  "$(jq -r '.tasks[0].attempts[1].finished_at_ms | type' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code" "$DIR/tests/fixtures/kimi"

# (b) all backends fail: command-code exits 1, kimi exits 1 -> status=failed,
# attempts length 2 (list exhausted).
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
ln -sf mock-backend "$DIR/tests/fixtures/kimi"
run=$(mktemp -d)
printf '%s' '[{"id":"FB2","task":"command-code_EXIT=1 kimi_EXIT=1 do stuff"}]' \
  | TEMPERANCE_BACKENDS="command-code kimi" "$W" --foreground --out "$run" --tasks - >/dev/null 2>&1
check "fallback all-fail: status=failed" "failed" "$(jq -r '.tasks[0].status' "$run/index.json" 2>/dev/null)"
check "fallback all-fail: attempts length 2" "2" "$(jq -r '.tasks[0].attempts | length' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code" "$DIR/tests/fixtures/kimi"

# (c) timeout -> NO fallback attempted: a slow task with --timeout 1 and 2
# backends available -> status=timeout, attempts length 1 (first attempt
# only; the watchdog kill stops the chain rather than advancing to kimi).
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
ln -sf mock-backend "$DIR/tests/fixtures/kimi"
run=$(mktemp -d)
printf '%s' '[{"id":"FB3","task":"SLEEP=5 refactor"}]' \
  | TEMPERANCE_BACKENDS="command-code kimi" "$W" --foreground --timeout 1 --out "$run" --tasks - >/dev/null 2>&1
check "fallback timeout: status=timeout" "timeout" "$(jq -r '.tasks[0].status' "$run/index.json" 2>/dev/null)"
check "fallback timeout: attempts length 1 (no fallback)" "1" "$(jq -r '.tasks[0].attempts | length' "$run/index.json" 2>/dev/null)"
check "fallback timeout: attempts[0].status=timeout" "timeout" "$(jq -r '.tasks[0].attempts[0].status' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code" "$DIR/tests/fixtures/kimi"

# --- worktree auto-merge (#7): --apply-worktree opt-in safe-path merge -----

# (a) non-overlapping auto-apply: task A writes fileA.txt, task B writes
# fileB.txt (distinct files) -> after the run, BOTH files exist in the
# caller cwd, both metas merged:true, MERGE-REPORT lists both applied.
tmpgit_am1=$(mktemp -d); ( cd "$tmpgit_am1" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
( cd "$tmpgit_am1" && printf '%s' '[{"id":"AMA","task":"WRITE=fileA.txt:hello-A do work","backend":"command-code","model":"x"},
             {"id":"AMB","task":"WRITE=fileB.txt:hello-B do work","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --apply-worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "auto-merge: fileA.txt applied to cwd" "hello-A" "$(cat "$tmpgit_am1/fileA.txt" 2>/dev/null)"
check "auto-merge: fileB.txt applied to cwd" "hello-B" "$(cat "$tmpgit_am1/fileB.txt" 2>/dev/null)"
check "auto-merge: AMA merged:true" "true" "$(jq -r '.merged' "$run/AMA.meta.json" 2>/dev/null)"
check "auto-merge: AMB merged:true" "true" "$(jq -r '.merged' "$run/AMB.meta.json" 2>/dev/null)"
[[ -f "$run/MERGE-REPORT.md" ]] && echo "ok - MERGE-REPORT.md written" || { echo "FAIL - no MERGE-REPORT.md"; fail=1; }
grep -q "AMA" "$run/MERGE-REPORT.md" 2>/dev/null && grep -q "AMB" "$run/MERGE-REPORT.md" 2>/dev/null \
  && echo "ok - MERGE-REPORT lists both applied tasks" || { echo "FAIL - MERGE-REPORT missing applied task(s)"; fail=1; }
grep -q "Worktree merge" "$run/SUMMARY.md" 2>/dev/null && echo "ok - SUMMARY.md has Worktree merge section" || { echo "FAIL - SUMMARY.md missing Worktree merge section"; fail=1; }
rm -f "$DIR/tests/fixtures/command-code"

# (b) overlapping conflict: two tasks both write the SAME file with different
# content -> NEITHER is applied (shared.txt absent or unchanged in cwd),
# both metas merged:false, MERGE-REPORT lists the conflict with the shared file.
tmpgit_am2=$(mktemp -d); ( cd "$tmpgit_am2" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
( cd "$tmpgit_am2" && printf '%s' '[{"id":"CFA","task":"WRITE=shared.txt:from-A do work","backend":"command-code","model":"x"},
             {"id":"CFB","task":"WRITE=shared.txt:from-B do work","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --apply-worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "auto-merge conflict: shared.txt absent from cwd" "" "$(cat "$tmpgit_am2/shared.txt" 2>/dev/null)"
check "auto-merge conflict: CFA merged:false" "false" "$(jq -r '.merged' "$run/CFA.meta.json" 2>/dev/null)"
check "auto-merge conflict: CFB merged:false" "false" "$(jq -r '.merged' "$run/CFB.meta.json" 2>/dev/null)"
grep -qi "shared.txt" "$run/MERGE-REPORT.md" 2>/dev/null && echo "ok - MERGE-REPORT lists conflicted shared file" || { echo "FAIL - MERGE-REPORT missing conflict file"; fail=1; }
rm -f "$DIR/tests/fixtures/command-code"

# (c) opt-out default: --worktree WITHOUT --apply-worktree -> nothing applied
# to cwd, metas merged:null, diffs still captured (proves the safety default).
tmpgit_am3=$(mktemp -d); ( cd "$tmpgit_am3" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
( cd "$tmpgit_am3" && printf '%s' '[{"id":"NOA","task":"WRITE=fileC.txt:hello-C do work","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "opt-out default: fileC.txt NOT applied to cwd" "" "$(cat "$tmpgit_am3/fileC.txt" 2>/dev/null)"
check "opt-out default: NOA merged:null" "null" "$(jq -r '.merged' "$run/NOA.meta.json" 2>/dev/null)"
[[ -s "$run/NOA.diff" ]] && echo "ok - diff still captured without --apply-worktree" || { echo "FAIL - diff missing"; fail=1; }
rm -f "$DIR/tests/fixtures/command-code"

# (d) rename-vs-write overlap (reviewer finding on #7): task X renames
# orig.txt -> shared.txt, task Y writes shared.txt directly (different
# content). diff_files() must record BOTH sides of the rename (orig.txt AND
# shared.txt) so the overlap map catches shared.txt being touched by two
# tasks. Expected: NEITHER applied -- cwd keeps orig.txt with its original
# content and gets no shared.txt; both metas merged:false; MERGE-REPORT shows
# a conflict (not an apply-failure) for the shared file.
tmpgit_am4=$(mktemp -d)
( cd "$tmpgit_am4" && git init -q && printf '%s\n' "original content" > orig.txt && git add -A && git commit -q -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
( cd "$tmpgit_am4" && printf '%s' '[{"id":"RNX","task":"MOVE=orig.txt:shared.txt do work","backend":"command-code","model":"x"},
             {"id":"RNY","task":"WRITE=shared.txt:from-Y do work","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --apply-worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "rename-overlap: orig.txt still present with original content" "original content" "$(cat "$tmpgit_am4/orig.txt" 2>/dev/null)"
check "rename-overlap: shared.txt NOT created in cwd" "" "$(cat "$tmpgit_am4/shared.txt" 2>/dev/null)"
check "rename-overlap: RNX merged:false" "false" "$(jq -r '.merged' "$run/RNX.meta.json" 2>/dev/null)"
check "rename-overlap: RNY merged:false" "false" "$(jq -r '.merged' "$run/RNY.meta.json" 2>/dev/null)"
grep -qi "shared.txt" "$run/MERGE-REPORT.md" 2>/dev/null && echo "ok - MERGE-REPORT lists rename/write conflict on shared.txt" || { echo "FAIL - MERGE-REPORT missing rename/write conflict"; fail=1; }
sed -n '/## Apply failures/,/^$/p' "$run/MERGE-REPORT.md" 2>/dev/null | grep -q "RNX\|RNY" \
  && { echo "FAIL - rename/write pair mislabeled as apply-failed instead of conflicted"; fail=1; } \
  || echo "ok - rename/write pair not mislabeled as apply-failed"
rm -f "$DIR/tests/fixtures/command-code"

# (e) P1 regression (Codex review on #7 PR): invoking the wrapper from a
# SUBDIRECTORY of the repo must still apply root-relative, not cwd-relative.
# Pre-fix, `git apply` runs in the caller's cwd, treats the root-rooted patch
# paths as outside cwd, prints "Skipped patch" and exits 0 -- so merged:true
# gets recorded with NO file actually written at the repo root (silent false
# success). Task writes a ROOT-level file; wrapper is invoked from "sub/".
tmpgit_am5=$(mktemp -d); ( cd "$tmpgit_am5" && git init -q && git commit -q --allow-empty -m init )
mkdir -p "$tmpgit_am5/sub"
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
( cd "$tmpgit_am5/sub" && printf '%s' '[{"id":"SUBW","task":"WRITE=rootfile.txt:hello-root do work","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --apply-worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "subdir invoke: rootfile.txt applied at repo root" "hello-root" "$(cat "$tmpgit_am5/rootfile.txt" 2>/dev/null)"
check "subdir invoke: SUBW merged:true" "true" "$(jq -r '.merged' "$run/SUBW.meta.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"

# (f) P2a regression (Codex review on #7 PR): overlap detection must catch a
# rename-vs-write collision even when the shared filename contains a SPACE.
# `+++ b/shared file.txt<TAB>...` carries a trailing tab+metadata that
# `rename to shared file.txt` does not, so unless diff_files() strips the
# tab suffix, the two forms produce DIFFERENT overlap keys and the conflict
# is missed. Task X renames orig.txt -> "shared file.txt"; task Y writes
# "shared file.txt" directly. Expected: BOTH merged:false, NEITHER applied
# (orig.txt intact, no "shared file.txt" at root), MERGE-REPORT shows the
# conflict.
tmpgit_am6=$(mktemp -d)
( cd "$tmpgit_am6" && git init -q && printf '%s\n' "original content" > orig.txt && git add -A && git commit -q -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
( cd "$tmpgit_am6" && printf '%s' '[{"id":"SPX","task":"MOVE={orig.txt:shared file.txt} do work","backend":"command-code","model":"x"},
             {"id":"SPY","task":"WRITE={shared file.txt:different} do work","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --apply-worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "spaced-filename overlap: orig.txt still present with original content" "original content" "$(cat "$tmpgit_am6/orig.txt" 2>/dev/null)"
check "spaced-filename overlap: 'shared file.txt' NOT created in cwd" "" "$(cat "$tmpgit_am6/shared file.txt" 2>/dev/null)"
check "spaced-filename overlap: SPX merged:false" "false" "$(jq -r '.merged' "$run/SPX.meta.json" 2>/dev/null)"
check "spaced-filename overlap: SPY merged:false" "false" "$(jq -r '.merged' "$run/SPY.meta.json" 2>/dev/null)"
grep -qi "shared file.txt" "$run/MERGE-REPORT.md" 2>/dev/null && echo "ok - MERGE-REPORT lists spaced-filename conflict" || { echo "FAIL - MERGE-REPORT missing spaced-filename conflict"; fail=1; }
rm -f "$DIR/tests/fixtures/command-code"

# (g) P2b regression (Codex review on #7 PR): index.json must be regenerated
# after the merge pass so its aggregate .tasks[].merged reflects the same
# values set_merged wrote into the per-task .meta.json files, instead of
# staying null (index.json is written BEFORE apply_worktree_merges runs).
tmpgit_am7=$(mktemp -d); ( cd "$tmpgit_am7" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
run=$(mktemp -d)
( cd "$tmpgit_am7" && printf '%s' '[{"id":"IDXA","task":"WRITE=fileIdxA.txt:hello-idxA do work","backend":"command-code","model":"x"},
             {"id":"IDXB","task":"WRITE=fileIdxB.txt:hello-idxB do work","backend":"command-code","model":"x"}]' \
  | "$W" --foreground --worktree --apply-worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "index.json refresh: IDXA index merged == meta merged" "$(jq -r '.merged' "$run/IDXA.meta.json" 2>/dev/null)" "$(jq -r '.tasks[] | select(.id=="IDXA") | .merged' "$run/index.json" 2>/dev/null)"
check "index.json refresh: IDXB index merged == meta merged" "$(jq -r '.merged' "$run/IDXB.meta.json" 2>/dev/null)" "$(jq -r '.tasks[] | select(.id=="IDXB") | .merged' "$run/index.json" 2>/dev/null)"
check "index.json refresh: IDXA index merged is true (not null)" "true" "$(jq -r '.tasks[] | select(.id=="IDXA") | .merged' "$run/index.json" 2>/dev/null)"
check "index.json refresh: IDXB index merged is true (not null)" "true" "$(jq -r '.tasks[] | select(.id=="IDXB") | .merged' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code"

# (h) P1 regression (Codex review on #7 PR, composing with #8 fallback chain):
# run_one reuses the SAME worktree across ALL fallback attempts for a task,
# and captures the diff ONCE at the end via `git add -A && git diff --cached`.
# So a task that falls back (primary backend writes/fails, fallback backend
# succeeds) can have its captured diff contain BOTH attempts' edits -- yet
# still finish status=ok. Auto-applying that combined diff would leak a
# failed backend's partial edits into the caller's live tree. Fix: exclude
# any worktree task with (.attempts|length) > 1 from auto-apply, regardless
# of final status; mark it merged:false (not null) and list it in
# MERGE-REPORT.md under a dedicated fallback-skip section instead.
#
# Task F: command-code (primary) exits 1 -> falls back to kimi, which exits 0
# and writes good.txt. Expect (.attempts|length) >= 2 and status=ok, but
# NOT applied. Task N: single-attempt task writing distinct file normalfile.txt
# -> proves non-fallback tasks still auto-apply (no regression).
tmpgit_am8=$(mktemp -d); ( cd "$tmpgit_am8" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
ln -sf mock-backend "$DIR/tests/fixtures/kimi"
run=$(mktemp -d)
( cd "$tmpgit_am8" && printf '%s' '[{"id":"FBW","task":"command-code_EXIT=1 kimi_EXIT=0 WRITE=good.txt:ok do stuff"},
             {"id":"NRM","task":"WRITE=normalfile.txt:hello-normal do work","backend":"command-code","model":"x"}]' \
  | TEMPERANCE_BACKENDS="command-code kimi" "$W" --foreground --worktree --apply-worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "fallback-skip: FBW attempts length >= 2" "true" "$(jq -r '(.attempts|length) >= 2' "$run/FBW.meta.json" 2>/dev/null)"
check "fallback-skip: FBW status=ok" "ok" "$(jq -r '.status' "$run/FBW.meta.json" 2>/dev/null)"
check "fallback-skip: FBW merged:false (not applied despite status=ok)" "false" "$(jq -r '.merged' "$run/FBW.meta.json" 2>/dev/null)"
check "fallback-skip: good.txt NOT applied to cwd" "" "$(cat "$tmpgit_am8/good.txt" 2>/dev/null)"
check "fallback-skip: FBW index merged matches meta (false)" "false" "$(jq -r '.tasks[] | select(.id=="FBW") | .merged' "$run/index.json" 2>/dev/null)"
check "fallback-skip: NRM attempts length == 1 (no fallback)" "1" "$(jq -r '.attempts | length' "$run/NRM.meta.json" 2>/dev/null)"
check "fallback-skip: NRM merged:true (single-attempt still auto-applies)" "true" "$(jq -r '.merged' "$run/NRM.meta.json" 2>/dev/null)"
check "fallback-skip: normalfile.txt applied to cwd" "hello-normal" "$(cat "$tmpgit_am8/normalfile.txt" 2>/dev/null)"
grep -q "Skipped: fallback attempts" "$run/MERGE-REPORT.md" 2>/dev/null && echo "ok - MERGE-REPORT has fallback-skip section" || { echo "FAIL - MERGE-REPORT missing fallback-skip section"; fail=1; }
sed -n '/## Skipped: fallback attempts/,/^## /p' "$run/MERGE-REPORT.md" 2>/dev/null | grep -q "FBW" && echo "ok - MERGE-REPORT lists FBW under fallback-skip" || { echo "FAIL - MERGE-REPORT does not list FBW under fallback-skip"; fail=1; }
grep -q "^- skipped-fallback: 1$" "$run/SUMMARY.md" 2>/dev/null && echo "ok - SUMMARY.md records skipped-fallback: 1" || { echo "FAIL - SUMMARY.md missing skipped-fallback count"; fail=1; }
rm -f "$DIR/tests/fixtures/command-code" "$DIR/tests/fixtures/kimi"

# (i) P1 regression (Codex review on #7 PR review-fix): the fix in (h) excluded
# fallback tasks from the overlap/conflict candidate set (cand_ids) entirely,
# BEFORE the TOUCHERS_OF overlap map was built. Consequence: a fallback
# task's touched files no longer poison the overlap map, so a DIFFERENT,
# single-attempt task that touches the SAME file is now seen as
# non-overlapping and gets auto-applied -- overwriting a file that had a
# competing (fallback) task output. That breaks the non-overlap safety
# contract this feature exists to provide.
#
# Fix: fallback tasks must stay in the overlap UNIVERSE (their files still
# populate TOUCHERS_OF/CONFLICTED) but must never be applied. Decision order
# per candidate: conflicted (incl. via a fallback task) -> fallback-skip ->
# empty-diff -> apply.
#
# Task F: falls back (command-code exits 1, kimi exits 0) and writes
# shared.txt with content "from-F". Task N: single attempt, writes
# shared.txt with DIFFERENT content "from-N". Since both tasks touch
# shared.txt, it must be treated as an overlap: BOTH merged:false, and
# shared.txt must NOT be applied to the caller's repo (absent from cwd).
# RED against pre-fix HEAD: N is auto-applied (merged:true, shared.txt
# present with "from-N") while F is fallback-skipped -- the overlap is
# missed because F was removed from the candidate set before TOUCHERS_OF
# was built.
tmpgit_am9=$(mktemp -d); ( cd "$tmpgit_am9" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
ln -sf mock-backend "$DIR/tests/fixtures/kimi"
run=$(mktemp -d)
( cd "$tmpgit_am9" && printf '%s' '[{"id":"FOV","task":"command-code_EXIT=1 kimi_EXIT=0 WRITE=shared.txt:from-F do stuff"},
             {"id":"NOV","task":"WRITE=shared.txt:from-N do work","backend":"command-code","model":"x"}]' \
  | TEMPERANCE_BACKENDS="command-code kimi" "$W" --foreground --worktree --apply-worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "fallback-overlap: FOV attempts length >= 2" "true" "$(jq -r '(.attempts|length) >= 2' "$run/FOV.meta.json" 2>/dev/null)"
check "fallback-overlap: FOV status=ok" "ok" "$(jq -r '.status' "$run/FOV.meta.json" 2>/dev/null)"
check "fallback-overlap: FOV merged:false" "false" "$(jq -r '.merged' "$run/FOV.meta.json" 2>/dev/null)"
check "fallback-overlap: NOV merged:false (was wrongly true pre-fix)" "false" "$(jq -r '.merged' "$run/NOV.meta.json" 2>/dev/null)"
check "fallback-overlap: shared.txt NOT applied to cwd" "" "$(cat "$tmpgit_am9/shared.txt" 2>/dev/null)"
check "fallback-overlap: FOV index merged matches meta (false)" "false" "$(jq -r '.tasks[] | select(.id=="FOV") | .merged' "$run/index.json" 2>/dev/null)"
check "fallback-overlap: NOV index merged matches meta (false)" "false" "$(jq -r '.tasks[] | select(.id=="NOV") | .merged' "$run/index.json" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code" "$DIR/tests/fixtures/kimi"

# (j) P1 regression (Codex review, #7 follow-up): overlap detection excluded
# FAILED-task diffs entirely (candidate filter required status=="ok"). But
# run_one captures the worktree diff UNCONDITIONALLY regardless of status --
# so a task whose backend WRITES a file and THEN exits nonzero ends up
# status=failed with a NON-EMPTY diff that touched a real file. That diff was
# invisible to the overlap map, so a DIFFERENT, single-attempt ok task
# touching the SAME file was seen as non-overlapping and auto-applied over a
# competing (failed) output -- breaking the non-overlap safety contract.
#
# Fix: the overlap UNIVERSE must include every worktree task with a
# non-empty captured diff, regardless of status (ok/failed/timeout) or
# fallback. The APPLY SET stays the strict subset: status=="ok" AND
# single-attempt AND non-conflicted AND applies cleanly.
#
# Task Fd: ALL backends fail (command-code_EXIT=1, kimi_EXIT=1), so there is
# no successful fallback -- status=failed. It writes shared.txt with
# "from-failed" before failing (mock now writes before honoring a nonzero
# exit). Task N: single-attempt, ok, writes shared.txt with "from-N".
#
# Expected: shared.txt is a real overlap (touched by both Fd and N) -> N must
# be held back (merged:false, listed as conflicted) and shared.txt must NOT
# land in the caller's repo. Fd never becomes an apply candidate (status !=
# ok) -- merged stays null, it is never "applied" or "held back", just noted
# for transparency. RED against pre-fix HEAD (d7dfb3f): N is wrongly
# auto-applied (merged:true, shared.txt present with "from-N") because Fd's
# diff was excluded from the candidate filter (status=="ok" required) before
# TOUCHERS_OF was ever built.
tmpgit_am10=$(mktemp -d); ( cd "$tmpgit_am10" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
ln -sf mock-backend "$DIR/tests/fixtures/kimi"
run=$(mktemp -d)
( cd "$tmpgit_am10" && printf '%s' '[{"id":"FD","task":"command-code_EXIT=1 kimi_EXIT=1 WRITE=shared.txt:from-failed do stuff"},
             {"id":"N","task":"WRITE=shared.txt:from-N do work","backend":"command-code","model":"x"}]' \
  | TEMPERANCE_BACKENDS="command-code kimi" "$W" --foreground --worktree --apply-worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "failed-shares-file: FD status=failed" "failed" "$(jq -r '.status' "$run/FD.meta.json" 2>/dev/null)"
[[ -s "$run/FD.diff" ]] && echo "ok - failed-shares-file: FD has non-empty diff" || { echo "FAIL - FD diff empty/missing"; fail=1; }
check "failed-shares-file: FD merged:null (never a merge candidate)" "null" "$(jq -r '.merged' "$run/FD.meta.json" 2>/dev/null)"
check "failed-shares-file: N merged:false (held back, overlaps FD)" "false" "$(jq -r '.merged' "$run/N.meta.json" 2>/dev/null)"
check "failed-shares-file: shared.txt NOT applied to cwd" "" "$(cat "$tmpgit_am10/shared.txt" 2>/dev/null)"
check "failed-shares-file: N index merged matches meta (false)" "false" "$(jq -r '.tasks[] | select(.id=="N") | .merged' "$run/index.json" 2>/dev/null)"
check "failed-shares-file: FD index merged matches meta (null)" "null" "$(jq -r '.tasks[] | select(.id=="FD") | .merged' "$run/index.json" 2>/dev/null)"
grep -qi "shared.txt" "$run/MERGE-REPORT.md" 2>/dev/null && echo "ok - MERGE-REPORT mentions shared.txt overlap" || { echo "FAIL - MERGE-REPORT missing shared.txt overlap"; fail=1; }
rm -f "$DIR/tests/fixtures/command-code" "$DIR/tests/fixtures/kimi"

# (k) Failed-unique-file control: proves the fix above does NOT over-block --
# a failed task touching a file NO OTHER task touches must not spuriously
# poison an unrelated, non-overlapping ok task's auto-apply. Task Fd2: all
# backends fail, writes ONLY fd2.txt (unique). Task N2: single-attempt ok,
# writes ONLY n2.txt (unique, distinct from fd2.txt). Expected: N2 still
# auto-applies (merged:true, n2.txt present); Fd2 merged:null (never a
# candidate, its failure is irrelevant to N2's file).
tmpgit_am11=$(mktemp -d); ( cd "$tmpgit_am11" && git init -q && git commit -q --allow-empty -m init )
ln -sf mock-backend "$DIR/tests/fixtures/command-code"
ln -sf mock-backend "$DIR/tests/fixtures/kimi"
run=$(mktemp -d)
( cd "$tmpgit_am11" && printf '%s' '[{"id":"FD2","task":"command-code_EXIT=1 kimi_EXIT=1 WRITE=fd2.txt:from-failed-2 do stuff"},
             {"id":"N2","task":"WRITE=n2.txt:hello-n2 do work","backend":"command-code","model":"x"}]' \
  | TEMPERANCE_BACKENDS="command-code kimi" "$W" --foreground --worktree --apply-worktree --out "$run" --tasks - >/dev/null 2>&1 )
check "failed-unique-control: FD2 status=failed" "failed" "$(jq -r '.status' "$run/FD2.meta.json" 2>/dev/null)"
check "failed-unique-control: FD2 merged:null" "null" "$(jq -r '.merged' "$run/FD2.meta.json" 2>/dev/null)"
check "failed-unique-control: N2 merged:true (not blocked by unrelated failure)" "true" "$(jq -r '.merged' "$run/N2.meta.json" 2>/dev/null)"
check "failed-unique-control: n2.txt applied to cwd" "hello-n2" "$(cat "$tmpgit_am11/n2.txt" 2>/dev/null)"
rm -f "$DIR/tests/fixtures/command-code" "$DIR/tests/fixtures/kimi"

echo "=== dispatch-tasklist: $([[ $fail -eq 0 ]] && echo PASS || echo FAIL) ==="
exit $fail
