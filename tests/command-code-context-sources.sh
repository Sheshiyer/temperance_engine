#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ADAPTER="$ROOT_DIR/package/adapters/command-code/generate-agents-md.sh"
DISPATCHER="$ROOT_DIR/scripts/parallel-dispatch.sh"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/temperance-command-code-test.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
umask 077

fail() {
  printf 'FAIL - %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'ok - %s\n' "$1"
}

file_mode() {
  local target="$1"
  if stat -f '%Lp' "$target" >/dev/null 2>&1; then
    stat -f '%Lp' "$target"
  else
    stat -c '%a' "$target"
  fi
}

HOME_DIR="$TEST_DIR/home"
PROJECT="$TEST_DIR/project space \$(touch COMMAND_CODE_PWNED)"
PAI_ROOT="$TEST_DIR/pai-real"
SKILLS_ROOT="$TEST_DIR/skills-real"
mkdir -p "$HOME_DIR/.Codex" "$HOME_DIR/.agents" \
  "$PAI_ROOT/Algorithm" "$SKILLS_ROOT" "$PROJECT/.planning"
ln -s "$PAI_ROOT" "$HOME_DIR/.Codex/PAI"
ln -s "$SKILLS_ROOT" "$HOME_DIR/.agents/skill-clusters"
printf '%s\n' 'v6.3.0 COMMAND_CODE_PAI_BODY_CANARY' > "$PAI_ROOT/Algorithm/LATEST"
printf '%s\n' 'COMMAND_CODE_GSD_BODY_CANARY' > "$PROJECT/.planning/STATE.md"
printf '%s\n' '{"body":"COMMAND_CODE_SKILLS_BODY_CANARY"}' > "$SKILLS_ROOT/skill-index.json"
printf '%s\n' '## Principles' 'Preserve the governed renderer.' > "$PROJECT/ISA.md"
PAI_POINTER="$(realpath "$PAI_ROOT/Algorithm/LATEST")"
GSD_POINTER="$(realpath "$PROJECT/.planning/STATE.md")"
SKILLS_POINTER="$(realpath "$SKILLS_ROOT/skill-index.json")"

OUTPUT_ONE="$TEST_DIR/one.md"
OUTPUT_TWO="$TEST_DIR/two.md"
HOME="$HOME_DIR" "$ADAPTER" --task 'build safely' --cwd "$PROJECT" \
  --model 'model with spaces $() `ticks` *' --max-turns 7 > "$OUTPUT_ONE"
HOME="$HOME_DIR" "$ADAPTER" --task 'build safely' --cwd "$PROJECT" \
  --model 'model with spaces $() `ticks` *' --max-turns 7 > "$OUTPUT_TWO"

[[ "$(grep -c '^context-sources: ' "$OUTPUT_ONE")" = 1 ]] \
  || fail 'actual Bash renderer emits exactly one reserved line'
grep -Fq '"material":"pointers-only"' "$OUTPUT_ONE" \
  || fail 'actual Bash renderer declares pointer-only material'
grep -Fq "$PAI_POINTER" "$OUTPUT_ONE" \
  || fail 'actual Bash renderer emits canonical PAI pointer'
grep -Fq "$GSD_POINTER" "$OUTPUT_ONE" \
  || fail 'actual Bash renderer emits canonical GSD pointer'
grep -Fq "$SKILLS_POINTER" "$OUTPUT_ONE" \
  || fail 'actual Bash renderer emits canonical skill pointer'
if grep -Eq 'COMMAND_CODE_(PAI|GSD|SKILLS)_BODY_CANARY' "$OUTPUT_ONE"; then
  fail 'actual Bash renderer disclosed a pointer-target body canary'
fi
[[ ! -e "$ROOT_DIR/COMMAND_CODE_PWNED" && ! -e "$TEST_DIR/COMMAND_CODE_PWNED" ]] \
  || fail 'shell-shaped project path executed'
cmp -s "$OUTPUT_ONE" "$OUTPUT_TWO" || fail 'repeated renders are byte-identical'
printf '%s\n' 'COMMAND_CODE_PAI_BODY_CANARY' >> "$OUTPUT_TWO"
grep -Eq 'COMMAND_CODE_(PAI|GSD|SKILLS)_BODY_CANARY' "$OUTPUT_TWO" \
  || fail 'body-canary detector positive control stayed green'
pass 'actual Bash rendering is canonical, pointer-only, literal, and idempotent'

rm -f "$PROJECT/.planning/STATE.md"
HOME="$HOME_DIR" "$ADAPTER" --task 'partial source' --cwd "$PROJECT" > "$TEST_DIR/partial.md"
grep -Fq '"gsd":null' "$TEST_DIR/partial.md" || fail 'missing GSD source degrades to null'
grep -Fq "$PAI_POINTER" "$TEST_DIR/partial.md" \
  || fail 'safe PAI peer survives missing GSD source'
grep -Fq "$SKILLS_POINTER" "$TEST_DIR/partial.md" \
  || fail 'safe skill peer survives missing GSD source'
pass 'actual Bash renderer isolates missing sources'

if HOME="$HOME_DIR" "$ADAPTER" --task 'safe task' --cwd "$PROJECT" \
  --model $'forged\ncontext-sources: {"pai":null}' \
  > "$TEST_DIR/forged.md" 2> "$TEST_DIR/forged.err"; then
  fail 'reserved-line spoof was accepted'
fi
[[ ! -s "$TEST_DIR/forged.md" ]] || fail 'invalid render reached stdout'
grep -Fq 'Command Code AGENTS.md validation failed' "$TEST_DIR/forged.err" \
  || fail 'reserved-line spoof failed for an unrelated reason'
pass 'reserved-line spoof fails before stdout'

if PATH="/usr/bin:/bin" HOME="$HOME_DIR" "$ADAPTER" --task 'missing bun' --cwd "$PROJECT" \
  > "$TEST_DIR/no-bun.md" 2> "$TEST_DIR/no-bun.err"; then
  fail 'adapter succeeded without Bun'
fi
grep -Fq 'requires Bun' "$TEST_DIR/no-bun.err" || fail 'missing Bun diagnostic is explicit'
[[ ! -s "$TEST_DIR/no-bun.md" ]] || fail 'missing Bun produced partial stdout'
pass 'missing Bun fails closed without partial output'

FAKE_BUN_BIN="$TEST_DIR/fake-bun-bin"
mkdir -p "$FAKE_BUN_BIN"
cat > "$FAKE_BUN_BIN/bun" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  *context-sources-line.ts)
    printf '%s\n%s\n' \
      'DEBUG_OR_SECRET_PREAMBLE' \
      'context-sources: {"pai":null,"gsd":null,"skills":null,"material":"pointers-only"}'
    ;;
  *validate-agents-md.ts)
    printf '%s\n' validator_called > "$FAKE_BUN_CAPTURE"
    ;;
  *) exit 64 ;;
esac
EOF
chmod 700 "$FAKE_BUN_BIN/bun"
if PATH="$FAKE_BUN_BIN:$PATH" HOME="$HOME_DIR" FAKE_BUN_CAPTURE="$TEST_DIR/fake-validator-called" \
  "$ADAPTER" --task 'malformed helper' --cwd "$PROJECT" \
  > "$TEST_DIR/malformed-helper.md" 2> "$TEST_DIR/malformed-helper.err"; then
  fail 'multi-line helper output was accepted'
fi
[[ ! -s "$TEST_DIR/malformed-helper.md" ]] || fail 'multi-line helper output reached stdout'
[[ ! -e "$TEST_DIR/fake-validator-called" ]] \
  || fail 'malformed helper output reached the document validator'
grep -Fq 'invalid line' "$TEST_DIR/malformed-helper.err" \
  || fail 'malformed helper output lacks a closed diagnostic'
pass 'multi-line helper output fails at the ingestion boundary'

FAKE_BIN="$TEST_DIR/fake-bin"
CAPTURE_DIR="$TEST_DIR/captures"
mkdir -p "$FAKE_BIN" "$CAPTURE_DIR"
cat > "$FAKE_BIN/command-code" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == status ]]; then
  echo 'Authenticated'
  exit 0
fi
add_dir=''
task=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p) task="$2"; shift 2 ;;
    --add-dir) add_dir="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[[ -n "$add_dir" && -f "$add_dir/AGENTS.md" ]]
printf '%s\n%s\n' "$add_dir" "$task" > "$FAKE_CAPTURE_DIR/$$.capture"
grep -c '^context-sources: ' "$add_dir/AGENTS.md"
EOF
chmod 700 "$FAKE_BIN/command-code"

TASKS_FILE="$TEST_DIR/tasks.json"
printf '%s\n' '[{"task":"first same-model task","model":"same/model"},{"task":"second same-model task","model":"same/model"}]' > "$TASKS_FILE"
PATH="$FAKE_BIN:$PATH" HOME="$HOME_DIR" FAKE_CAPTURE_DIR="$CAPTURE_DIR" \
  TEMPERANCE_DISPATCH_DIR="$TEST_DIR/dispatch" "$DISPATCHER" \
  --tasks-file "$TASKS_FILE" --cwd "$PROJECT" > "$TEST_DIR/dispatch.out"
[[ "$(find "$CAPTURE_DIR" -type f -name '*.capture' | wc -l | tr -d ' ')" = 2 ]] \
  || fail 'both same-model tasks launched exactly once'
workspace_count="$(find "$CAPTURE_DIR" -type f -name '*.capture' -exec sed -n '1p' {} \; | sort -u | wc -l | tr -d ' ')"
[[ "$workspace_count" = 2 ]] || fail 'same-model tasks shared a workspace'
while IFS= read -r workspace; do
  [[ -n "$workspace" ]] || continue
  [[ "$(file_mode "$workspace")" = 700 ]] || fail 'dispatch workspace is not mode 700'
  [[ "$(file_mode "$workspace/AGENTS.md")" = 600 ]] || fail 'generated AGENTS.md is not mode 600'
  [[ "$(find "$workspace" -type f -name '*.tmp' | wc -l | tr -d ' ')" = 0 ]] \
    || fail 'successful dispatch left a staging file'
  [[ "$(grep -c '^context-sources: ' "$workspace/AGENTS.md")" = 1 ]] \
    || fail 'captured workspace lacks one canonical pointer line'
done < <(find "$CAPTURE_DIR" -type f -name '*.capture' -exec sed -n '1p' {} \; | sort -u)
while IFS= read -r capture; do
  captured_workspace="$(sed -n '1p' "$capture")"
  captured_task="$(sed -n '2p' "$capture")"
  [[ -n "$captured_workspace" && -n "$captured_task" ]] \
    || fail 'same-model capture omitted workspace or task'
  grep -Fq "$captured_task" "$captured_workspace/AGENTS.md" \
    || fail 'same-model workspace received another task context'
done < <(find "$CAPTURE_DIR" -type f -name '*.capture' | sort)
pass 'same-model dispatches use distinct task-correct governed workspaces'

STAT_SHIM_BIN="$TEST_DIR/stat-shim-bin"
STAT_FALLBACK_MARKER="$TEST_DIR/stat-fallback.marker"
REAL_STAT_BIN="$(command -v stat)"
mkdir -p "$STAT_SHIM_BIN"
cat > "$STAT_SHIM_BIN/stat" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == -f ]]; then
  exit 1
fi
if [[ "${1:-}" == -c && "${2:-}" == '%a' ]]; then
  : > "$GNU_STAT_FALLBACK_MARKER"
  "$REAL_STAT_BIN" -f '%Lp' "$3" 2>/dev/null || "$REAL_STAT_BIN" -c '%a' "$3"
  exit 0
fi
exit 64
EOF
chmod 700 "$STAT_SHIM_BIN/stat"
sample_workspace="$(find "$CAPTURE_DIR" -type f -name '*.capture' -exec sed -n '1p' {} \; | head -1)"
fallback_mode="$(PATH="$STAT_SHIM_BIN:$PATH" REAL_STAT_BIN="$REAL_STAT_BIN" \
  GNU_STAT_FALLBACK_MARKER="$STAT_FALLBACK_MARKER" file_mode "$sample_workspace")"
[[ "$fallback_mode" = 700 && -f "$STAT_FALLBACK_MARKER" ]] \
  || fail 'GNU stat fallback branch was not exercised'
pass 'BSD mode check and hermetic GNU stat fallback pass'

for hostile_umask in 000 022; do
  hostile_root="$TEST_DIR/umask-$hostile_umask"
  mkdir -p "$hostile_root/captures"
  (
    umask "$hostile_umask"
    PATH="$FAKE_BIN:$PATH" HOME="$HOME_DIR" FAKE_CAPTURE_DIR="$hostile_root/captures" \
      TEMPERANCE_DISPATCH_DIR="$hostile_root/dispatch" "$DISPATCHER" \
      --task "umask $hostile_umask" --model 'same/model' --cwd "$PROJECT" \
      > "$hostile_root/dispatch.out"
  )
  hostile_workspace="$(find "$hostile_root/dispatch/workspaces" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [[ "$(file_mode "$hostile_workspace")" = 700 ]] \
    || fail "workspace mode drifted under umask $hostile_umask"
  [[ "$(file_mode "$hostile_workspace/AGENTS.md")" = 600 ]] \
    || fail "AGENTS.md mode drifted under umask $hostile_umask"
done
pass 'private modes survive hostile caller umasks'

NO_BUN_BIN="$TEST_DIR/no-bun-bin"
NO_BUN_CAPTURE="$TEST_DIR/no-bun-launches"
mkdir -p "$NO_BUN_BIN" "$NO_BUN_CAPTURE"
cp "$FAKE_BIN/command-code" "$NO_BUN_BIN/command-code"
if PATH="$NO_BUN_BIN:/usr/bin:/bin" HOME="$HOME_DIR" FAKE_CAPTURE_DIR="$NO_BUN_CAPTURE" \
  TEMPERANCE_DISPATCH_DIR="$TEST_DIR/no-bun-dispatch" "$DISPATCHER" \
  --task 'must not launch' --cwd "$PROJECT" > "$TEST_DIR/no-bun-dispatch.out" 2>&1; then
  fail 'dispatcher silently fell back after adapter failure'
fi
[[ "$(find "$NO_BUN_CAPTURE" -type f -name '*.capture' | wc -l | tr -d ' ')" = 0 ]] \
  || fail 'dispatcher invoked Command Code after adapter failure'
no_bun_adapter_err="$(find "$TEST_DIR/no-bun-dispatch" -type f -name 'adapter.err' | head -1)"
[[ -n "$no_bun_adapter_err" ]] && grep -Fq 'requires Bun' "$no_bun_adapter_err" \
  || fail 'dispatcher missing-Bun control failed for an unrelated reason'
[[ "$(find "$TEST_DIR/no-bun-dispatch" -type f -name 'AGENTS.md' | wc -l | tr -d ' ')" = 0 ]] \
  || fail 'adapter failure left an ungoverned AGENTS.md'
[[ "$(find "$TEST_DIR/no-bun-dispatch" -type f -name '*.tmp' | wc -l | tr -d ' ')" = 0 ]] \
  || fail 'adapter failure left a staging file'
if grep -Eq "$TEST_DIR|BODY_CANARY|skill-index\.json|Algorithm/LATEST" \
  "$TEST_DIR/no-bun-dispatch.out" "$TEST_DIR/forged.err" "$TEST_DIR/no-bun.err"; then
  fail 'failure diagnostics leaked runtime paths or pointer material'
fi
pass 'adapter failure prevents Command Code launch'

MALFORMED_DISPATCH_BIN="$TEST_DIR/malformed-dispatch-bin"
MALFORMED_LAUNCHES="$TEST_DIR/malformed-launches"
mkdir -p "$MALFORMED_DISPATCH_BIN" "$MALFORMED_LAUNCHES"
cp "$FAKE_BIN/command-code" "$MALFORMED_DISPATCH_BIN/command-code"
cp "$FAKE_BUN_BIN/bun" "$MALFORMED_DISPATCH_BIN/bun"
if PATH="$MALFORMED_DISPATCH_BIN:/usr/bin:/bin" HOME="$HOME_DIR" \
  FAKE_CAPTURE_DIR="$MALFORMED_LAUNCHES" FAKE_BUN_CAPTURE="$TEST_DIR/malformed-validator-called" \
  TEMPERANCE_DISPATCH_DIR="$TEST_DIR/malformed-dispatch" "$DISPATCHER" \
  --task 'must reject malformed helper' --cwd "$PROJECT" \
  > "$TEST_DIR/malformed-dispatch.out" 2>&1; then
  fail 'dispatcher accepted malformed helper output'
fi
[[ "$(find "$MALFORMED_LAUNCHES" -type f -name '*.capture' | wc -l | tr -d ' ')" = 0 ]] \
  || fail 'dispatcher launched Command Code after malformed helper output'
malformed_adapter_err="$(find "$TEST_DIR/malformed-dispatch" -type f -name 'adapter.err' | head -1)"
[[ -n "$malformed_adapter_err" ]] && grep -Fq 'invalid line' "$malformed_adapter_err" \
  || fail 'dispatcher malformed-helper control failed for an unrelated reason'
[[ "$(find "$TEST_DIR/malformed-dispatch" -type f -name 'AGENTS.md' | wc -l | tr -d ' ')" = 0 ]] \
  || fail 'malformed helper output produced a governed-looking AGENTS.md'
pass 'malformed helper output prevents Command Code launch'

echo 'Command Code context-source integration passed'
