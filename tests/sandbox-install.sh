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
# Use a unique basename that is unconditionally re-written (hence backed up on install 2).
TARGET="$INSTALL_ROOT/.claude/CLAUDE.md.template"
cp "$TARGET" "$SANDBOX/expected_claude_tmpl"
printf 'SENTINEL-CORRUPT\n' > "$TARGET"
NEWEST=$(find "$INSTALL_ROOT/.temperance_engine/backups" -type f -name 'CLAUDE.md.template' 2>/dev/null | sort | tail -n 1)
if [ -n "$NEWEST" ] && cp "$NEWEST" "$TARGET" && cmp -s "$TARGET" "$SANDBOX/expected_claude_tmpl"; then
  ok "restore-from-backup matches installed bytes"
else
  bad "restore-from-backup failed"
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

printf '\n=== %d passed, %d failed ===\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
