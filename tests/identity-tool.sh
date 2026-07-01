#!/usr/bin/env sh
# Unit test for scripts/apply-identity.sh against throwaway fixtures.
set -u
REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TOOL="$REPO_ROOT/scripts/apply-identity.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1" >&2; }

SANDBOX=$(mktemp -d 2>/dev/null || mktemp -d -t teid)
trap 'rm -rf "$SANDBOX"' EXIT INT TERM
export TEMPERANCE_STATE_DIR="$SANDBOX/state"
export TEMPERANCE_BACKUP_DIR="$SANDBOX/state/backups"

FIX="$SANDBOX/AGENTS.md"
printf '# PAI 4.0.3 — Personal AI Infrastructure\n\nbody line\n' > "$FIX"
cp "$FIX" "$SANDBOX/orig"

run_tool() {
  ( export IDENTITY_HOME_AGENTS="$FIX" \
           IDENTITY_OPENCODE_AGENTS="$SANDBOX/none1" \
           IDENTITY_CODEX_AGENTS="$SANDBOX/none2"
    sh "$TOOL" "$@" )
}

run_tool --dry-run >/dev/null 2>&1
cmp -s "$FIX" "$SANDBOX/orig" && ok "dry-run leaves file unchanged" || bad "dry-run mutated file"

run_tool --apply >/dev/null 2>&1
head -1 "$FIX" | grep -qF 'temperance:identity:start' && ok "apply inserts block at top" || bad "apply missing block"
grep -qF '# PAI 4.0.3 — Personal AI Infrastructure' "$FIX" && ok "apply preserves PAI body" || bad "apply lost PAI body"

run_tool --apply >/dev/null 2>&1
count=$(grep -cF 'temperance:identity:start' "$FIX")
[ "$count" = "1" ] && ok "apply idempotent (single block)" || bad "apply stacked $count blocks"

find "$TEMPERANCE_BACKUP_DIR" -type f 2>/dev/null | grep -q . \
  && ok "backup created on apply" || bad "no backup on apply"

run_tool --remove >/dev/null 2>&1
grep -qF 'temperance:identity' "$FIX" && bad "remove left block behind" || ok "remove strips block"
cmp -s "$FIX" "$SANDBOX/orig" && ok "remove restores original bytes" || bad "remove did not restore original"

# regression: same-basename targets must not clobber each other's backups
mkdir -p "$SANDBOX/a" "$SANDBOX/b"
FA="$SANDBOX/a/AGENTS.md"; FB="$SANDBOX/b/AGENTS.md"
printf 'AAA original\n' > "$FA"
printf 'BBB original\n' > "$FB"
COLL_BACKUP="$SANDBOX/collide/backups"
( export IDENTITY_HOME_AGENTS="$FA" \
         IDENTITY_OPENCODE_AGENTS="$FB" \
         IDENTITY_CODEX_AGENTS="$SANDBOX/none3" \
         TEMPERANCE_BACKUP_DIR="$COLL_BACKUP"
  sh "$TOOL" --apply ) >/dev/null 2>&1
nb=$(find "$COLL_BACKUP" -type f 2>/dev/null | wc -l | tr -d ' ')
[ "$nb" -ge 2 ] && ok "same-basename backups are path-unique ($nb backups)" \
  || bad "backup collision: only $nb backup(s) for 2 same-basename targets"

printf '\n=== %d passed, %d failed ===\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
