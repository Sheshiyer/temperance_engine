#!/usr/bin/env sh
# Sandbox test harness for the Temperance Engine installer.
# Runs a REAL install into a throwaway HOME and asserts layering.
# Never touches the real home directory. Not run from verify-install.sh (would recurse).
set -u

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1" >&2; }

SANDBOX=$(mktemp -d 2>/dev/null || mktemp -d -t tesandbox)
INSTALL_ROOT="$SANDBOX/install"
PULSE_PID_FILE="$INSTALL_ROOT/.claude/PAI/PULSE/compat-server.pid"
cleanup() {
  if [ -f "$PULSE_PID_FILE" ]; then
    p=$(cat "$PULSE_PID_FILE" 2>/dev/null || true)
    [ -n "${p:-}" ] && kill "$p" 2>/dev/null || true
  fi
  rm -rf "$SANDBOX"
}
trap cleanup EXIT INT TERM
mkdir -p "$INSTALL_ROOT"

run_install() {
  root="$1"; shift
  ( export HOME="$root" \
      PAI_HOME="$root/.claude" \
      CODEX_HOME="$root/.codex" \
      OPENCODE_HOME="$root/.config/opencode" \
      CURSOR_HOME="$root/.cursor" \
      AGENTS_HOME="$root/.agents" \
      TEMPERANCE_STATE_DIR="$root/.temperance_engine" \
      TEMPERANCE_BACKUP_DIR="$root/.temperance_engine/backups" \
      TEMPERANCE_PULSE_PORT=39337
    sh "$REPO_ROOT/install.sh" "$@" )
}

# --- Assertion 1: file landing after a real full install ---
if run_install "$INSTALL_ROOT" --skip-voice --with-claude --with-codex --with-gsd \
     >"$SANDBOX/install1.log" 2>&1; then
  ok "install exited 0"
else
  bad "install exited non-zero (see $SANDBOX/install1.log)"
fi

for rel in \
  "AGENTS.md" \
  ".claude/CLAUDE.md.template" \
  ".claude/PAI/PULSE/compat-server.ts" \
  ".codex/hooks/skill_cluster_resolver.mjs" \
  ".config/opencode/AGENTS.md" \
  ".config/opencode/opencode.json" \
  ".codex/AGENTS.md" \
  ".claude/PAI/enrich/index.ts" \
  ".claude/PAI/router/classify-task.sh" \
  ".claude/hooks/PromptProcessing.hook.ts" \
  ".codex/hooks/PromptProcessing.hook.ts" \
  ".local/bin/temperance-route" \
  ".local/bin/temperance-dispatch" \
  ".local/bin/temperance-batch" \
  ".cursor/templates/temperance-engine.AGENTS.md" \
  ".cursor/templates/temperance-engine.rules.mdc" \
; do
  if [ -f "$INSTALL_ROOT/$rel" ]; then ok "landed: $rel"; else bad "missing: $rel"; fi
done

# --- Assertion 2: backup + idempotency on second install ---
if run_install "$INSTALL_ROOT" --skip-voice --with-claude --with-codex --with-gsd \
     >"$SANDBOX/install2.log" 2>&1; then
  ok "re-install exited 0"
else
  bad "re-install exited non-zero"
fi
if find "$INSTALL_ROOT/.temperance_engine/backups" -type f 2>/dev/null | grep -q .; then
  ok "backups created on re-install"
else
  bad "no backups after re-install"
fi

# --- Assertion 3: dry-run mutates nothing ---
DRY_ROOT="$SANDBOX/dry"
mkdir -p "$DRY_ROOT"
run_install "$DRY_ROOT" --dry-run --skip-voice >"$SANDBOX/dry.log" 2>&1 || true
created=$(find "$DRY_ROOT" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$created" = "0" ]; then ok "dry-run created no files"; else bad "dry-run created $created files"; fi

# --- Assertion 4: restore-from-backup (real rollback path) ---
# Backups are now path-slug named (full source path, / -> __), not basename
# (see scripts/lib.sh backup_file). Find the newest backup by the slug of
# the known target path instead of a basename match.
TARGET="$INSTALL_ROOT/.claude/CLAUDE.md.template"
TARGET_SLUG=$(printf '%s' "$TARGET" | sed 's#^/##; s#/#__#g')
cp "$TARGET" "$SANDBOX/expected_claude_tmpl"
printf 'SENTINEL-CORRUPT\n' > "$TARGET"
NEWEST=$(find "$INSTALL_ROOT/.temperance_engine/backups" -type f -name "$TARGET_SLUG" 2>/dev/null | sort | tail -n 1)
if [ -n "$NEWEST" ] && cp "$NEWEST" "$TARGET" && cmp -s "$TARGET" "$SANDBOX/expected_claude_tmpl"; then
  ok "restore-from-backup matches installed bytes"
else
  bad "restore-from-backup failed"
fi

# --- Assertion 4b: backup collision regression (G4) ---
# Two different source files that share a basename must both survive as
# distinct, path-unique backup files (no basename clobber).
COLL_ROOT="$SANDBOX/collide"
mkdir -p "$COLL_ROOT/a" "$COLL_ROOT/b" "$COLL_ROOT/backups"
COLL_A="$COLL_ROOT/a/AGENTS.md"
COLL_B="$COLL_ROOT/b/AGENTS.md"
printf 'AAA original\n' > "$COLL_A"
printf 'BBB original\n' > "$COLL_B"
(
  . "$REPO_ROOT/scripts/lib.sh"
  export TEMPERANCE_BACKUP_DIR="$COLL_ROOT/backups"
  backup_file "$COLL_A"
  backup_file "$COLL_B"
)
COLL_COUNT=$(find "$COLL_ROOT/backups" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$COLL_COUNT" -ge 2 ]; then
  ok "backup collision regression: same-basename targets get distinct backups ($COLL_COUNT files)"
else
  bad "backup collision: only $COLL_COUNT backup(s) for 2 same-basename targets"
fi

# --- Assertion 5: hook behavior ---
HOOK="$REPO_ROOT/package/hooks/ParallelDispatchContext.hook.sh"
PROJ="$SANDBOX/proj"
mkdir -p "$PROJ/.planning/workstreams/api" "$PROJ/.planning/workstreams/ui"
printf 'ws-api\n' > "$PROJ/.planning/active-workstream"
printf '{ "model_profile": "quality", "workflow": { "auto_advance": false } }\n' > "$PROJ/.planning/config.json"
OUT=$(CLAUDE_PROJECT_DIR="$PROJ" sh "$HOOK")
if printf '%s' "$OUT" | grep -q 'GSD-managed project detected' \
   && printf '%s' "$OUT" | grep -q 'model_profile: quality'; then
  ok "hook emits advisory for GSD project"
else
  bad "hook advisory output missing"
fi
BARE="$SANDBOX/bare"; mkdir -p "$BARE"
OUT2=$(CLAUDE_PROJECT_DIR="$BARE" sh "$HOOK")
if [ -z "$OUT2" ]; then ok "hook silent for non-GSD dir"; else bad "hook not silent for non-GSD dir"; fi

# --- Assertion 6: GSD gating ---
mkdir -p "$SANDBOX/g1" "$SANDBOX/g2"
OUT_ON=$(run_install "$SANDBOX/g1" --dry-run --skip-voice --with-gsd 2>&1 || true)
printf '%s' "$OUT_ON" | grep -q 'GSD_MODE=install' && ok "gsd on: GSD_MODE=install" || bad "gsd on gating"
OUT_OFF=$(run_install "$SANDBOX/g2" --dry-run --skip-voice 2>&1 || true)
printf '%s' "$OUT_OFF" | grep -q 'GSD_MODE=skip' && ok "gsd off: GSD_MODE=skip" || bad "gsd off gating"

# --- Assertion 7: installer live-content guard (G3) ---
# A pre-populated live operator file (carrying a temperance:identity marker)
# must survive a default (non-force) install, and must be overwritten with
# --force.
GUARD_ROOT="$SANDBOX/guard"
mkdir -p "$GUARD_ROOT"
GUARD_TARGET="$GUARD_ROOT/AGENTS.md"
printf '<!-- temperance:identity:start -->\nreal live operator content\n<!-- temperance:identity:end -->\n' > "$GUARD_TARGET"
cp "$GUARD_TARGET" "$SANDBOX/guard_expected"

run_install "$GUARD_ROOT" --skip-voice >"$SANDBOX/guard1.log" 2>&1
if cmp -s "$GUARD_TARGET" "$SANDBOX/guard_expected"; then
  ok "G3 guard: default install preserves live operator AGENTS.md"
else
  bad "G3 guard: default install overwrote live operator AGENTS.md"
fi
if grep -q 'skipping' "$SANDBOX/guard1.log"; then
  ok "G3 guard: skip warning printed on default install"
else
  bad "G3 guard: no skip warning printed on default install"
fi

run_install "$GUARD_ROOT" --skip-voice --force >"$SANDBOX/guard2.log" 2>&1
if cmp -s "$GUARD_TARGET" "$SANDBOX/guard_expected"; then
  bad "G3 guard: --force did not overwrite live operator AGENTS.md"
else
  ok "G3 guard: --force overwrites live operator AGENTS.md"
fi

# --- Assertion 8: compat-server does not invoke the broken peon.sh contract ---
# peon.sh is control-only (pause|resume|mute|unmute|toggle|status|volume|
# rotation|notifications) and has no "play a pack" command; the compat
# server must play sounds directly (afplay + pack manifest), never via
# peon.sh --pack/--category.
COMPAT_SERVER="$REPO_ROOT/package/pulse-compat/compat-server.ts"
if grep -qE -- '--pack|--category' "$COMPAT_SERVER"; then
  bad "compat-server still invokes the broken peon.sh --pack/--category contract"
else
  ok "compat-server does not invoke peon.sh --pack/--category"
fi
if grep -q 'afplay' "$COMPAT_SERVER" && grep -qE 'manifest|openpeon\.json' "$COMPAT_SERVER"; then
  ok "compat-server references afplay and pack manifest resolution"
else
  bad "compat-server missing afplay/manifest references"
fi

printf '\n=== %d passed, %d failed ===\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
