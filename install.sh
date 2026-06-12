#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DRY_RUN=0
VOICE_MODE=auto

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-voice) VOICE_MODE=skip ;;
    --with-voice) VOICE_MODE=force ;;
    -h|--help)
      printf '%s\n' "Usage: ./install.sh [--dry-run] [--skip-voice|--with-voice]"
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
export PAI_HOME="${PAI_HOME:-$HOME/.claude}"
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export OPENCODE_HOME="${OPENCODE_HOME:-$HOME/.config/opencode}"
export AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"
export TEMPERANCE_STATE_DIR="${TEMPERANCE_STATE_DIR:-$HOME/.temperance_engine}"
export TEMPERANCE_BACKUP_DIR="${TEMPERANCE_BACKUP_DIR:-$TEMPERANCE_STATE_DIR/backups}"

printf '%s\n' "Temperance Engine installer"
printf '%s\n' "PAI_HOME=$PAI_HOME"
printf '%s\n' "CODEX_HOME=$CODEX_HOME"
printf '%s\n' "OPENCODE_HOME=$OPENCODE_HOME"
printf '%s\n' "AGENTS_HOME=$AGENTS_HOME"

sh "$ROOT_DIR/scripts/install-pai.sh"
sh "$ROOT_DIR/scripts/install-skill-clusters.sh"
sh "$ROOT_DIR/scripts/install-peon-ping.sh"
sh "$ROOT_DIR/scripts/install-codegraph.sh"
sh "$ROOT_DIR/scripts/configure-opencode.sh"
sh "$ROOT_DIR/scripts/verify-install.sh"

printf '%s\n' "Install flow complete. Restart Claude, Codex, and OpenCode sessions to reload instruction surfaces."
