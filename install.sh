#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DRY_RUN=0
VOICE_MODE=auto
CLAUDE_MODE=skip
CODEX_MODE=skip
OPENCODE_MODE=install
CURSOR_MODE=install
GSD_MODE=skip
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-voice) VOICE_MODE=skip ;;
    --with-voice) VOICE_MODE=force ;;
    --with-claude) CLAUDE_MODE=install ;;
    --skip-claude) CLAUDE_MODE=skip ;;
    --with-codex) CODEX_MODE=install ;;
    --skip-codex) CODEX_MODE=skip ;;
    --with-opencode) OPENCODE_MODE=install ;;
    --skip-opencode) OPENCODE_MODE=skip ;;
    --with-cursor) CURSOR_MODE=install ;;
    --skip-cursor) CURSOR_MODE=skip ;;
    --with-gsd) GSD_MODE=install ;;
    --skip-gsd) GSD_MODE=skip ;;
    --force) FORCE=1 ;;
    -h|--help)
      printf '%s\n' "Usage: ./install.sh [--dry-run] [--skip-voice|--with-voice] [--with-claude|--skip-claude] [--with-codex|--skip-codex] [--with-opencode|--skip-opencode] [--with-cursor|--skip-cursor] [--with-gsd|--skip-gsd] [--force]"
      exit 0
      ;;
    *)
      printf '%s\n' "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

export TEMPERANCE_ROOT="$ROOT_DIR"
export TEMPERANCE_DRY_RUN="$DRY_RUN"
export TEMPERANCE_VOICE_MODE="$VOICE_MODE"
export TEMPERANCE_CLAUDE_MODE="$CLAUDE_MODE"
export TEMPERANCE_CODEX_MODE="$CODEX_MODE"
export TEMPERANCE_OPENCODE_MODE="$OPENCODE_MODE"
export TEMPERANCE_CURSOR_MODE="$CURSOR_MODE"
export TEMPERANCE_GSD_MODE="$GSD_MODE"
export TEMPERANCE_FORCE="$FORCE"
export PAI_HOME="${PAI_HOME:-$HOME/.claude}"
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export OPENCODE_HOME="${OPENCODE_HOME:-$HOME/.config/opencode}"
export CURSOR_HOME="${CURSOR_HOME:-$HOME/.cursor}"
export AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"
export TEMPERANCE_STATE_DIR="${TEMPERANCE_STATE_DIR:-$HOME/.temperance_engine}"
export TEMPERANCE_BACKUP_DIR="${TEMPERANCE_BACKUP_DIR:-$TEMPERANCE_STATE_DIR/backups}"

printf '%s\n' "Temperance Engine installer"
printf '%s\n' "PAI_HOME=$PAI_HOME"
printf '%s\n' "CODEX_HOME=$CODEX_HOME"
printf '%s\n' "OPENCODE_HOME=$OPENCODE_HOME"
printf '%s\n' "CURSOR_HOME=$CURSOR_HOME"
printf '%s\n' "AGENTS_HOME=$AGENTS_HOME"
printf '%s\n' "CLAUDE_MODE=$CLAUDE_MODE"
printf '%s\n' "CODEX_MODE=$CODEX_MODE"
printf '%s\n' "OPENCODE_MODE=$OPENCODE_MODE"
printf '%s\n' "CURSOR_MODE=$CURSOR_MODE"
printf '%s\n' "GSD_MODE=$GSD_MODE"
printf '%s\n' "FORCE=$FORCE"

sh "$ROOT_DIR/scripts/install-pai.sh"

# Install temperance-parallel-dispatch skill (backup-first)
if test "${TEMPERANCE_CLAUDE_MODE:-skip}" = "install"; then
  SKILL_SRC="$ROOT_DIR/skills/temperance-parallel-dispatch"
  SKILL_DST="$HOME/.claude/skills/temperance-parallel-dispatch"
  if test -d "$SKILL_SRC"; then
    if test -e "$SKILL_DST"; then cp -R "$SKILL_DST" "$SKILL_DST.bak.$(date +%Y%m%d_%H%M%S)"; fi
    mkdir -p "$HOME/.claude/skills"
    cp -R "$SKILL_SRC" "$SKILL_DST"
    printf '%s\n' "[install] temperance-parallel-dispatch skill -> $SKILL_DST"
  fi
fi

sh "$ROOT_DIR/scripts/install-skill-clusters.sh"
sh "$ROOT_DIR/scripts/install-peon-ping.sh"
sh "$ROOT_DIR/scripts/install-codegraph.sh"
sh "$ROOT_DIR/scripts/install-gsd.sh"
sh "$ROOT_DIR/scripts/configure-opencode.sh"
sh "$ROOT_DIR/scripts/verify-install.sh"

printf '%s\n' "Install flow complete. Restart OpenCode or Cursor sessions to reload instruction surfaces. Restart Claude or Codex only if those optional surfaces were enabled."
