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

dry="$(RUN_WIRE --dry-run 2>&1)"
echo "$dry" | grep -q "Would copy temperance skills into Kimi desktop" && echo "ok - dry-run announces desktop copy (not symlink)" || { echo "FAIL - dry-run desktop language wrong"; fail=1; }

RUN_WIRE >/dev/null 2>&1
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
[[ ! -d "$DESK/temperance-engine" ]] && echo "ok - revert removes the managed copy" || { echo "FAIL - revert left the managed copy"; fail=1; }

mkdir -p "$DESK/temperance-engine"
printf 'foreign, unmanaged\n' > "$DESK/temperance-engine/SKILL.md"
RUN_WIRE --revert >/dev/null 2>&1
[[ -f "$DESK/temperance-engine/SKILL.md" ]] && grep -q "foreign, unmanaged" "$DESK/temperance-engine/SKILL.md" && echo "ok - revert never removes an unmanaged (unmarked) directory" || { echo "FAIL - revert touched a foreign directory"; fail=1; }

rm -rf "$TMP"

exit $fail
