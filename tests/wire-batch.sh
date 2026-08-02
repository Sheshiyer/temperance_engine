#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
out=$("$DIR/scripts/wire-multi-backend.sh" --dry-run 2>&1)
echo "$out" | grep -q "temperance-batch" && echo "ok - dry-run wires temperance-batch" || { echo "FAIL - no temperance-batch in dry-run"; fail=1; }
echo "$out" | grep -q "temperance-opencode" && echo "ok - dry-run wires temperance-opencode" || { echo "FAIL - no temperance-opencode in dry-run"; fail=1; }
echo "$out" | grep -q "temperance-claude" && echo "ok - dry-run wires temperance-claude" || { echo "FAIL - no temperance-claude in dry-run"; fail=1; }
# #6: the installed enrichment hook resolves classify-task.sh at the PAI router
# sibling path, so wiring must co-locate it there (routing.ts fails open to
# task=balanced otherwise).
echo "$out" | grep -q "PAI/router/classify-task.sh" && echo "ok - dry-run co-locates classify-task.sh" || { echo "FAIL - classify-task.sh not co-located in dry-run"; fail=1; }
echo "$out" | grep -q "PAI/router/omniroute-portfolios.ts" && echo "ok - dry-run co-locates portfolio resolver" || { echo "FAIL - portfolio resolver not co-located in dry-run"; fail=1; }
echo "$out" | grep -q "shared enrichment core" && echo "ok - dry-run checks shared enrichment core" || { echo "FAIL - shared enrichment core missing from dry-run"; fail=1; }
echo "$out" | grep -q "Claude prompt adapter" && echo "ok - dry-run checks Claude prompt adapter" || { echo "FAIL - Claude prompt adapter missing from dry-run"; fail=1; }
echo "$out" | grep -q "Codex prompt adapter" && echo "ok - dry-run checks Codex prompt adapter" || { echo "FAIL - Codex prompt adapter missing from dry-run"; fail=1; }

# ── Kimi skills: CLI stays a symlink, desktop becomes a real managed copy ────
# The daimon skill scanner does not follow symlinks whose target crosses a
# volume/mount boundary (verified live: every skill it recognizes resolves to
# a same-volume path; a repo clone on another volume was invisible to it even
# though `test -e` and kimi-cli itself resolved the same symlink fine). CLI
# (`~/.kimi/skills`) has no such issue and stays a lightweight symlink.
TMP="$(mktemp -d)"
mkdir -p "$TMP/home/.kimi" "$TMP/home/Library/Application Support/kimi-desktop/daimon-share/daimon/skills"
DESK="$TMP/home/Library/Application Support/kimi-desktop/daimon-share/daimon/skills"
RUN_WIRE() { env HOME="$TMP/home" TEMPERANCE_BACKUP_DIR="$TMP/home/.temperance_engine/backups" TEMPERANCE_KIMI_DESKTOP_SKILLS="$DESK" "$DIR/scripts/wire-multi-backend.sh" "$@"; }

# A scoped enrichment refresh must not rewrite router links, hooks, or Kimi
# skill copies. This is the deployment path for isolated enrichment changes.
SCOPED_HOME="$TMP/scoped-home"
mkdir -p "$SCOPED_HOME/.claude/PAI/enrich" "$SCOPED_HOME/.codex" "$SCOPED_HOME/.config/opencode" "$SCOPED_HOME/.kimi"
printf 'legacy\n' > "$SCOPED_HOME/.claude/PAI/enrich/legacy.txt"
printf 'codex-sentinel\n' > "$SCOPED_HOME/.codex/unrelated.txt"
printf 'opencode-sentinel\n' > "$SCOPED_HOME/.config/opencode/unrelated.txt"
printf 'kimi-sentinel\n' > "$SCOPED_HOME/.kimi/unrelated.txt"
unrelated_before="$(shasum -a 256 "$SCOPED_HOME/.codex/unrelated.txt" "$SCOPED_HOME/.config/opencode/unrelated.txt" "$SCOPED_HOME/.kimi/unrelated.txt" | shasum -a 256)"
scoped_dry="$(env HOME="$SCOPED_HOME" TEMPERANCE_BACKUP_DIR="$SCOPED_HOME/.temperance_engine/backups" "$DIR/scripts/wire-multi-backend.sh" --refresh-enrich-only --dry-run 2>&1)"
echo "$scoped_dry" | grep -q "Would install shared enrichment core" && echo "ok - scoped dry-run announces enrichment refresh" || { echo "FAIL - scoped dry-run missed enrichment refresh"; fail=1; }
echo "$scoped_dry" | grep -q "temperance-route" && { echo "FAIL - scoped dry-run touched router wiring"; fail=1; } || echo "ok - scoped dry-run excludes router wiring"
[[ ! -e "$SCOPED_HOME/.temperance_engine" ]] && echo "ok - scoped dry-run creates no backup path" || { echo "FAIL - scoped dry-run mutated the backup tree"; fail=1; }
env HOME="$SCOPED_HOME" TEMPERANCE_BACKUP_DIR="$SCOPED_HOME/.temperance_engine/backups" "$DIR/scripts/wire-multi-backend.sh" --refresh-enrich-only >/dev/null 2>&1
[[ -f "$SCOPED_HOME/.claude/PAI/enrich/contextSources.ts" ]] && echo "ok - scoped refresh installs pointer resolver" || { echo "FAIL - scoped refresh missed pointer resolver"; fail=1; }
[[ ! -e "$SCOPED_HOME/.local/bin/temperance-route" ]] && echo "ok - scoped refresh leaves unrelated launchers absent" || { echo "FAIL - scoped refresh mutated unrelated launchers"; fail=1; }
grep -Rqs legacy "$SCOPED_HOME/.temperance_engine/backups" && echo "ok - scoped refresh preserves prior core in backup" || { echo "FAIL - scoped refresh missed prior-core backup"; fail=1; }
scoped_hash_before="$(find "$SCOPED_HOME/.claude/PAI/enrich" -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256)"
env HOME="$SCOPED_HOME" TEMPERANCE_BACKUP_DIR="$SCOPED_HOME/.temperance_engine/backups" "$DIR/scripts/wire-multi-backend.sh" --refresh-enrich-only >/dev/null 2>&1
scoped_hash_after="$(find "$SCOPED_HOME/.claude/PAI/enrich" -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256)"
[[ "$scoped_hash_before" = "$scoped_hash_after" ]] && echo "ok - scoped refresh is content-idempotent" || { echo "FAIL - scoped refresh changed content on re-run"; fail=1; }
unrelated_after="$(shasum -a 256 "$SCOPED_HOME/.codex/unrelated.txt" "$SCOPED_HOME/.config/opencode/unrelated.txt" "$SCOPED_HOME/.kimi/unrelated.txt" | shasum -a 256)"
[[ "$unrelated_before" = "$unrelated_after" ]] && echo "ok - scoped refresh preserves existing unrelated sentinels" || { echo "FAIL - scoped refresh changed unrelated sentinels"; fail=1; }

# Unexpected file and symlink destinations must be backed up type-safely rather
# than disappearing under the directory replacement.
SCOPED_FILE_HOME="$TMP/scoped-file-home"
mkdir -p "$SCOPED_FILE_HOME/.claude/PAI"
printf 'foreign-file-canary\n' > "$SCOPED_FILE_HOME/.claude/PAI/enrich"
env HOME="$SCOPED_FILE_HOME" TEMPERANCE_BACKUP_DIR="$SCOPED_FILE_HOME/.temperance_engine/backups" "$DIR/scripts/wire-multi-backend.sh" --refresh-enrich-only >/dev/null 2>&1
[[ -d "$SCOPED_FILE_HOME/.claude/PAI/enrich" ]] && grep -Rqs 'foreign-file-canary' "$SCOPED_FILE_HOME/.temperance_engine/backups" \
  && echo "ok - scoped refresh backs up an unexpected file destination" \
  || { echo "FAIL - scoped refresh lost an unexpected file destination"; fail=1; }

SCOPED_LINK_HOME="$TMP/scoped-link-home"
SCOPED_LINK_TARGET="$TMP/scoped-link-target"
mkdir -p "$SCOPED_LINK_HOME/.claude/PAI" "$SCOPED_LINK_TARGET"
printf 'foreign-link-target-canary\n' > "$SCOPED_LINK_TARGET/foreign.txt"
ln -s "$SCOPED_LINK_TARGET" "$SCOPED_LINK_HOME/.claude/PAI/enrich"
env HOME="$SCOPED_LINK_HOME" TEMPERANCE_BACKUP_DIR="$SCOPED_LINK_HOME/.temperance_engine/backups" "$DIR/scripts/wire-multi-backend.sh" --refresh-enrich-only >/dev/null 2>&1
scoped_link_backup="$(find "$SCOPED_LINK_HOME/.temperance_engine/backups" -type l -name enrich -print -quit)"
[[ -n "$scoped_link_backup" && "$(readlink "$scoped_link_backup")" = "$SCOPED_LINK_TARGET" && -f "$SCOPED_LINK_TARGET/foreign.txt" ]] \
  && echo "ok - scoped refresh preserves an unexpected symlink and its target" \
  || { echo "FAIL - scoped refresh lost or followed an unexpected symlink"; fail=1; }

SCOPED_FIFO_HOME="$TMP/scoped-fifo-home"
mkdir -p "$SCOPED_FIFO_HOME/.claude/PAI"
mkfifo "$SCOPED_FIFO_HOME/.claude/PAI/enrich"
if env HOME="$SCOPED_FIFO_HOME" TEMPERANCE_BACKUP_DIR="$SCOPED_FIFO_HOME/.temperance_engine/backups" "$DIR/scripts/wire-multi-backend.sh" --refresh-enrich-only >/dev/null 2>&1; then
  echo "FAIL - scoped refresh replaced an unsupported FIFO destination"; fail=1
else
  echo "ok - scoped refresh rejects an unsupported FIFO destination"
fi
[[ -p "$SCOPED_FIFO_HOME/.claude/PAI/enrich" ]] \
  && echo "ok - rejected FIFO destination remains intact" \
  || { echo "FAIL - rejected FIFO destination was damaged"; fail=1; }

# A failed staged copy must leave the old enrichment core byte-intact.
SCOPED_FAIL_HOME="$TMP/scoped-fail-home"
SCOPED_FAIL_BIN="$TMP/scoped-fail-bin"
mkdir -p "$SCOPED_FAIL_HOME/.claude/PAI/enrich" "$SCOPED_FAIL_BIN"
printf 'old-core-canary\n' > "$SCOPED_FAIL_HOME/.claude/PAI/enrich/legacy.txt"
printf '%s\n' '#!/usr/bin/env bash' 'case " $* " in *"/package/enrich/. "*) exit 73 ;; esac' 'exec /bin/cp "$@"' > "$SCOPED_FAIL_BIN/cp"
chmod 700 "$SCOPED_FAIL_BIN/cp"
if env HOME="$SCOPED_FAIL_HOME" TEMPERANCE_BACKUP_DIR="$SCOPED_FAIL_HOME/.temperance_engine/backups" PATH="$SCOPED_FAIL_BIN:$PATH" "$DIR/scripts/wire-multi-backend.sh" --refresh-enrich-only >/dev/null 2>&1; then
  echo "FAIL - scoped refresh accepted a failed staged copy"; fail=1
else
  echo "ok - scoped refresh rejects a failed staged copy"
fi
[[ -f "$SCOPED_FAIL_HOME/.claude/PAI/enrich/legacy.txt" ]] && grep -q 'old-core-canary' "$SCOPED_FAIL_HOME/.claude/PAI/enrich/legacy.txt" \
  && [[ ! -e "$SCOPED_FAIL_HOME/.claude/PAI/enrich/contextSources.ts" ]] \
  && echo "ok - failed staged copy preserves the prior enrichment core" \
  || { echo "FAIL - failed staged copy damaged the prior enrichment core"; fail=1; }

# If the staged directory cannot be promoted after the old path is retired, the
# transaction must restore that exact prior path before returning failure.
SCOPED_PROMOTE_HOME="$TMP/scoped-promote-home"
SCOPED_PROMOTE_BIN="$TMP/scoped-promote-bin"
mkdir -p "$SCOPED_PROMOTE_HOME/.claude/PAI/enrich" "$SCOPED_PROMOTE_BIN"
printf 'old-promote-canary\n' > "$SCOPED_PROMOTE_HOME/.claude/PAI/enrich/legacy.txt"
printf '%s\n' '#!/usr/bin/env bash' 'case "$1 $2" in *"/.enrich.staging."*"/.claude/PAI/enrich") exit 74 ;; esac' 'exec /bin/mv "$@"' > "$SCOPED_PROMOTE_BIN/mv"
chmod 700 "$SCOPED_PROMOTE_BIN/mv"
if env HOME="$SCOPED_PROMOTE_HOME" TEMPERANCE_BACKUP_DIR="$SCOPED_PROMOTE_HOME/.temperance_engine/backups" PATH="$SCOPED_PROMOTE_BIN:$PATH" "$DIR/scripts/wire-multi-backend.sh" --refresh-enrich-only >/dev/null 2>&1; then
  echo "FAIL - scoped refresh accepted a failed staged promotion"; fail=1
else
  echo "ok - scoped refresh rejects a failed staged promotion"
fi
[[ -f "$SCOPED_PROMOTE_HOME/.claude/PAI/enrich/legacy.txt" ]] && grep -q 'old-promote-canary' "$SCOPED_PROMOTE_HOME/.claude/PAI/enrich/legacy.txt" \
  && [[ ! -e "$SCOPED_PROMOTE_HOME/.claude/PAI/enrich/contextSources.ts" ]] \
  && echo "ok - failed staged promotion restores the prior enrichment core" \
  || { echo "FAIL - failed staged promotion did not restore the prior core"; fail=1; }

# Backup errors must abort before retirement even though the helper is called
# from a negated conditional (which suppresses Bash errexit inside functions).
SCOPED_BACKUP_FAIL_HOME="$TMP/scoped-backup-fail-home"
SCOPED_BACKUP_FAIL_BIN="$TMP/scoped-backup-fail-bin"
mkdir -p "$SCOPED_BACKUP_FAIL_HOME/.claude/PAI/enrich" "$SCOPED_BACKUP_FAIL_BIN"
printf 'old-backup-canary\n' > "$SCOPED_BACKUP_FAIL_HOME/.claude/PAI/enrich/legacy.txt"
printf '%s\n' '#!/usr/bin/env bash' 'case " $* " in *"/.temperance_engine/backups/"*) exit 75 ;; esac' 'exec /bin/cp "$@"' > "$SCOPED_BACKUP_FAIL_BIN/cp"
chmod 700 "$SCOPED_BACKUP_FAIL_BIN/cp"
if env HOME="$SCOPED_BACKUP_FAIL_HOME" TEMPERANCE_BACKUP_DIR="$SCOPED_BACKUP_FAIL_HOME/.temperance_engine/backups" PATH="$SCOPED_BACKUP_FAIL_BIN:$PATH" "$DIR/scripts/wire-multi-backend.sh" --refresh-enrich-only >/dev/null 2>&1; then
  echo "FAIL - scoped refresh accepted a failed backup copy"; fail=1
else
  echo "ok - scoped refresh rejects a failed backup copy"
fi
[[ -f "$SCOPED_BACKUP_FAIL_HOME/.claude/PAI/enrich/legacy.txt" ]] && grep -q 'old-backup-canary' "$SCOPED_BACKUP_FAIL_HOME/.claude/PAI/enrich/legacy.txt" \
  && [[ ! -e "$SCOPED_BACKUP_FAIL_HOME/.claude/PAI/enrich/contextSources.ts" ]] \
  && echo "ok - failed backup copy preserves the prior enrichment core" \
  || { echo "FAIL - failed backup copy damaged the prior core"; fail=1; }

dry="$(RUN_WIRE --dry-run 2>&1)"
echo "$dry" | grep -q "Would copy temperance skills into Kimi desktop" && echo "ok - dry-run announces desktop copy (not symlink)" || { echo "FAIL - dry-run desktop language wrong"; fail=1; }

RUN_WIRE >/dev/null 2>&1
[[ -L "$TMP/home/.local/bin/temperance-opencode" ]] && echo "ok - OpenCode launcher is a managed symlink" || { echo "FAIL - OpenCode launcher missing"; fail=1; }
[[ -L "$TMP/home/.local/bin/temperance-claude" ]] && echo "ok - Claude launcher is a managed symlink" || { echo "FAIL - Claude launcher missing"; fail=1; }
[[ -L "$TMP/home/.kimi/skills/temperance-engine" ]] && echo "ok - CLI skill stays a symlink" || { echo "FAIL - CLI skill not a symlink"; fail=1; }
[[ ! -L "$DESK/temperance-engine" && -d "$DESK/temperance-engine" ]] && echo "ok - desktop skill is a real directory" || { echo "FAIL - desktop skill is a symlink or missing"; fail=1; }
[[ -f "$DESK/temperance-engine/.temperance-managed" ]] && echo "ok - desktop copy carries the managed marker" || { echo "FAIL - managed marker missing"; fail=1; }
[[ -f "$DESK/temperance-engine/SKILL.md" ]] && echo "ok - desktop copy has real SKILL.md content" || { echo "FAIL - desktop SKILL.md missing"; fail=1; }

RUN_WIRE >/dev/null 2>&1
[[ -f "$DESK/temperance-engine/.temperance-managed" ]] && echo "ok - re-run stays idempotent (marker survives refresh)" || { echo "FAIL - marker lost on refresh"; fail=1; }

rm -rf "$DESK/temperance-engine"
mkdir -p "$DESK/temperance-engine"
printf 'unrelated user skill\n' > "$DESK/temperance-engine/SKILL.md"
RUN_WIRE >/dev/null 2>&1
grep -q "unrelated user skill" "$DESK/temperance-engine/SKILL.md" && { echo "FAIL - foreign content not overwritten"; fail=1; } || echo "ok - foreign same-name directory backed up and overwritten"
find "$TMP/home/.temperance_engine/backups" -type f -name "SKILL.md" | xargs grep -l "unrelated user skill" >/dev/null 2>&1 && echo "ok - foreign content preserved in a backup" || { echo "FAIL - foreign content not backed up"; fail=1; }

RUN_WIRE --revert >/dev/null 2>&1
[[ ! -e "$TMP/home/.local/bin/temperance-opencode" ]] && echo "ok - revert removes managed OpenCode launcher" || { echo "FAIL - OpenCode launcher survived revert"; fail=1; }
[[ ! -e "$TMP/home/.local/bin/temperance-claude" ]] && echo "ok - revert removes managed Claude launcher" || { echo "FAIL - Claude launcher survived revert"; fail=1; }
[[ ! -d "$DESK/temperance-engine" ]] && echo "ok - revert removes the managed copy" || { echo "FAIL - revert left the managed copy"; fail=1; }

mkdir -p "$DESK/temperance-engine"
printf 'foreign, unmanaged\n' > "$DESK/temperance-engine/SKILL.md"
RUN_WIRE --revert >/dev/null 2>&1
[[ -f "$DESK/temperance-engine/SKILL.md" ]] && grep -q "foreign, unmanaged" "$DESK/temperance-engine/SKILL.md" && echo "ok - revert never removes an unmanaged (unmarked) directory" || { echo "FAIL - revert touched a foreign directory"; fail=1; }

rm -rf "$TMP"

exit $fail
