#!/usr/bin/env sh
# Install the optional Simplified Technical English (STE) agent skill.
#
# The skill is referenced, not vendored: it is fetched from upstream at a pinned
# commit. Temperance Engine never commits the skill or its ASD-STE100 word list.
# See docs/ste.md.
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

say "Configuring optional Simplified Technical English (STE) skill"

if test "${TEMPERANCE_STE_MODE:-skip}" != "install"; then
  say "STE skill skipped (enable with ./install.sh --with-ste)"
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  say "ERROR: git is required to fetch the STE skill"
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
  say "[install] backed up $backup_src -> $backup_dest"
}

# absent | pinned (clean checkout of STE_PIN) | other
skill_state() {
  if test ! -e "$STE_SKILL_HOME" && test ! -L "$STE_SKILL_HOME"; then
    printf '%s\n' absent
  elif test -d "$STE_SKILL_HOME/.git" &&
    test "$(git -C "$STE_SKILL_HOME" rev-parse HEAD 2>/dev/null)" = "$STE_PIN" &&
    test -z "$(git -C "$STE_SKILL_HOME" status --porcelain 2>/dev/null)"; then
    printf '%s\n' pinned
  else
    printf '%s\n' other
  fi
}

fetch_skill() {
  if is_dry_run; then
    say "DRY_RUN: git fetch --depth 1 $STE_REPO_URL $STE_PIN -> $STE_SKILL_HOME"
    return 0
  fi
  work=$(mktemp -d "${TMPDIR:-/tmp}/te-ste.XXXXXX")
  repo="$work/$STE_SKILL_NAME"
  if ! { git init -q "$repo" &&
    git -C "$repo" remote add origin "$STE_REPO_URL" &&
    git -C "$repo" fetch -q --depth 1 origin "$STE_PIN" &&
    git -C "$repo" -c advice.detachedHead=false checkout -q --detach FETCH_HEAD; }; then
    rm -rf "$work"
    say "ERROR: could not fetch $STE_REPO_URL at $STE_PIN"
    exit 1
  fi
  fetched=$(git -C "$repo" rev-parse HEAD)
  if test "$fetched" != "$STE_PIN"; then
    rm -rf "$work"
    say "ERROR: fetched $fetched, expected $STE_PIN"
    exit 1
  fi
  for required in SKILL.md references/word-list.md NOTICE.md LICENSE; do
    if test ! -f "$repo/$required"; then
      rm -rf "$work"
      say "ERROR: the STE skill at $STE_PIN is missing $required"
      exit 1
    fi
  done
  ensure_dir "$(dirname "$STE_SKILL_HOME")"
  mv "$repo" "$STE_SKILL_HOME"
  rm -rf "$work"
  say "[install] STE skill $STE_PIN -> $STE_SKILL_HOME"
}

# Link one surface's skills dir to the skill. Anything already at the link path
# that is not our link is left alone unless --force, which backs it up first.
link_surface() {
  link="$1/$STE_SKILL_NAME"
  if test -L "$link" && test "$(readlink "$link")" = "$STE_SKILL_HOME"; then
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

state=$(skill_state)
case "$state" in
  pinned)
    say "STE skill already at $STE_PIN: $STE_SKILL_HOME"
    ;;
  other)
    if ! is_forced; then
      say "WARNING: $STE_SKILL_HOME exists but is not a clean checkout of $STE_PIN; left unchanged (pass --force to back it up and replace it)"
      exit 0
    fi
    backup_path "$STE_SKILL_HOME"
    fetch_skill
    ;;
  absent)
    fetch_skill
    ;;
esac

if test "${TEMPERANCE_CLAUDE_MODE:-skip}" = "install"; then
  link_surface "$PAI_HOME/skills"
fi
if test "${TEMPERANCE_OPENCODE_MODE:-install}" = "install"; then
  link_surface "$OPENCODE_HOME/skills"
fi

say "STE skill is referenced, not vendored; the ASD-STE100 word list stays in the upstream skill. See docs/ste.md."
