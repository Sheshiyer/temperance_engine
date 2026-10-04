#!/usr/bin/env sh
# Install or uninstall the optional Simplified Technical English (STE) agent skill.
#
# The skill is referenced, not vendored: it is fetched from upstream at a pinned
# commit. Temperance Engine never commits the skill or its ASD-STE100 word list.
# TEMPERANCE_STE_MODE is skip (default), install, or uninstall. See docs/ste.md.
set -eu

. "${TEMPERANCE_ROOT:?}/scripts/lib.sh"

STE_SKILL_NAME=simplified-technical-english
STE_REPO_URL="${STE_REPO_URL:-https://github.com/0xpili/simplified-technical-english.git}"
STE_PIN="${STE_PIN:-1e148d670cba46685ad2b4c3f2354a637a7fdbbe}"
AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"
STE_SKILL_HOME="${STE_SKILL_HOME:-$AGENTS_HOME/skills/$STE_SKILL_NAME}"
PAI_HOME="${PAI_HOME:-$HOME/.claude}"
OPENCODE_HOME="${OPENCODE_HOME:-$HOME/.config/opencode}"
TEMPERANCE_BACKUP_DIR="${TEMPERANCE_BACKUP_DIR:-$HOME/.temperance_engine/backups}"
MODE="${TEMPERANCE_STE_MODE:-skip}"

say "Configuring optional Simplified Technical English (STE) skill"

case "$MODE" in
  install | uninstall) ;;
  *)
    say "STE skill skipped (enable with ./install.sh --with-ste)"
    exit 0
    ;;
esac

if ! command -v git >/dev/null 2>&1; then
  say "ERROR: git is required to manage the STE skill"
  exit 1
fi

is_forced() {
  test "${TEMPERANCE_FORCE:-0}" = "1"
}

# Move a path into the backup dir. Backups stay outside every skills dir: a
# sibling copy there would be picked up as a phantom skill.
backup_path() {
  backup_src="$1"
  backup_slug=$(printf '%s' "$backup_src" | sed 's#^/##; s#/#__#g')
  backup_dest="$TEMPERANCE_BACKUP_DIR/$(date -u +%Y%m%dT%H%M%SZ)/$backup_slug"
  ensure_dir "$(dirname "$backup_dest")"
  run_cmd mv "$backup_src" "$backup_dest"
  say "[backup] moved $backup_src -> $backup_dest"
}

# absent | pinned (clean checkout of STE_PIN from STE_REPO_URL) | other
skill_state() {
  if test ! -e "$STE_SKILL_HOME" && test ! -L "$STE_SKILL_HOME"; then
    printf '%s\n' absent
  elif test -d "$STE_SKILL_HOME/.git" &&
    test "$(git -C "$STE_SKILL_HOME" rev-parse HEAD 2>/dev/null)" = "$STE_PIN" &&
    test "$(git -C "$STE_SKILL_HOME" remote get-url origin 2>/dev/null)" = "$STE_REPO_URL" &&
    test -z "$(git -C "$STE_SKILL_HOME" status --porcelain 2>/dev/null)"; then
    printf '%s\n' pinned
  else
    printf '%s\n' other
  fi
}

# Fetch and validate the pinned skill into a staging dir. Nothing at
# STE_SKILL_HOME is touched here, so a failed fetch leaves the active skill and
# every link to it intact. Sets STAGE_WORK and STAGED_REPO.
stage_skill() {
  STAGE_WORK=""
  STAGED_REPO=""
  if is_dry_run; then
    say "DRY_RUN: git fetch --depth 1 $STE_REPO_URL $STE_PIN -> $STE_SKILL_HOME"
    return 0
  fi
  STAGE_WORK=$(mktemp -d "${TMPDIR:-/tmp}/te-ste.XXXXXX")
  STAGED_REPO="$STAGE_WORK/$STE_SKILL_NAME"
  if ! { git init -q "$STAGED_REPO" &&
    git -C "$STAGED_REPO" remote add origin "$STE_REPO_URL" &&
    git -C "$STAGED_REPO" fetch -q --depth 1 origin "$STE_PIN" &&
    git -C "$STAGED_REPO" -c advice.detachedHead=false checkout -q --detach FETCH_HEAD; }; then
    rm -rf "$STAGE_WORK"
    say "ERROR: could not fetch $STE_REPO_URL at $STE_PIN"
    exit 1
  fi
  fetched=$(git -C "$STAGED_REPO" rev-parse HEAD)
  if test "$fetched" != "$STE_PIN"; then
    rm -rf "$STAGE_WORK"
    say "ERROR: fetched $fetched, expected $STE_PIN"
    exit 1
  fi
  for required in SKILL.md references/word-list.md NOTICE.md LICENSE; do
    if test ! -f "$STAGED_REPO/$required"; then
      rm -rf "$STAGE_WORK"
      say "ERROR: the STE skill at $STE_PIN is missing $required"
      exit 1
    fi
  done
}

# Move a validated staged checkout into place.
install_staged() {
  if is_dry_run; then
    return 0
  fi
  ensure_dir "$(dirname "$STE_SKILL_HOME")"
  mv "$STAGED_REPO" "$STE_SKILL_HOME"
  rm -rf "$STAGE_WORK"
  say "[install] STE skill $STE_PIN -> $STE_SKILL_HOME"
}

# True when a surface path is the checkout itself (STE_SKILL_HOME points into
# that surface's skills dir), as opposed to a link to it.
is_checkout_path() {
  test "$1" = "$STE_SKILL_HOME" ||
    { test -e "$1" && test ! -L "$1" && test "$1" -ef "$STE_SKILL_HOME"; }
}

# True when a surface path is our link to the managed checkout.
is_managed_link() {
  test -L "$1" && test "$(readlink "$1")" = "$STE_SKILL_HOME"
}

# Link one surface's skills dir to the skill. Anything already at the link path
# that is not our link is left alone unless --force, which backs it up first.
link_surface() {
  link="$1/$STE_SKILL_NAME"
  if is_checkout_path "$link"; then
    say "STE skill is installed in place at $link"
    return 0
  fi
  if is_managed_link "$link"; then
    say "STE skill link already present: $link"
    return 0
  fi
  if test -e "$link" || test -L "$link"; then
    if ! is_forced; then
      say "WARNING: skipping $link (it exists and is not a Temperance STE link; pass --force to back it up and replace it)"
      return 0
    fi
    backup_path "$link"
  fi
  ensure_dir "$1"
  run_cmd ln -s "$STE_SKILL_HOME" "$link"
  say "[install] STE skill link -> $link"
}

# Remove one surface's link, but only if it points to the managed checkout.
# Operator-owned skills and links elsewhere are left alone.
unlink_surface() {
  link="$1/$STE_SKILL_NAME"
  if is_checkout_path "$link"; then
    return 0 # the checkout itself; handled below
  fi
  if is_managed_link "$link"; then
    run_cmd rm -f "$link"
    say "[uninstall] removed STE skill link $link"
  elif test -e "$link" || test -L "$link"; then
    say "WARNING: leaving $link (it is not a link to $STE_SKILL_HOME)"
  fi
}

if test "$MODE" = "uninstall"; then
  # Decide first, then act: a refused uninstall must leave the links in place,
  # because a plain reinstall stops before it relinks a non-pinned checkout.
  state=$(skill_state)
  if test "$state" = "other" && ! is_forced; then
    say "WARNING: $STE_SKILL_HOME is not a clean checkout of $STE_PIN from $STE_REPO_URL; nothing changed (pass --force to move it to the backup dir)"
    exit 0
  fi
  unlink_surface "$PAI_HOME/skills"
  unlink_surface "$OPENCODE_HOME/skills"
  if test "$state" = "absent"; then
    say "STE skill is not installed at $STE_SKILL_HOME"
  else
    backup_path "$STE_SKILL_HOME"
  fi
  say "STE skill removed; nothing was deleted (see $TEMPERANCE_BACKUP_DIR)."
  exit 0
fi

case "$(skill_state)" in
  pinned)
    say "STE skill already at $STE_PIN: $STE_SKILL_HOME"
    ;;
  other)
    if ! is_forced; then
      say "WARNING: $STE_SKILL_HOME exists but is not a clean checkout of $STE_PIN; left unchanged (pass --force to back it up and replace it)"
      exit 0
    fi
    stage_skill # fetch and validate first; the active skill is untouched on failure
    backup_path "$STE_SKILL_HOME"
    install_staged
    ;;
  absent)
    stage_skill
    install_staged
    ;;
esac

if test "${TEMPERANCE_CLAUDE_MODE:-skip}" = "install"; then
  link_surface "$PAI_HOME/skills"
fi
if test "${TEMPERANCE_OPENCODE_MODE:-install}" = "install"; then
  link_surface "$OPENCODE_HOME/skills"
fi

say "STE skill is referenced, not vendored; the ASD-STE100 word list stays in the upstream skill. See docs/ste.md."
