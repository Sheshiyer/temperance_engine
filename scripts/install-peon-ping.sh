#!/usr/bin/env sh
set -eu

. "${TEMPERANCE_ROOT:?}/scripts/lib.sh"

say "Configuring optional peon-ping voice integration"

if test "${TEMPERANCE_VOICE_MODE:-auto}" = "skip"; then
  say "Voice skipped by flag"
  exit 0
fi

if test "$(uname -s)" != "Darwin" && test "${TEMPERANCE_VOICE_MODE:-auto}" != "force"; then
  say "Voice skipped: non-macOS host"
  exit 0
fi

PEON_SCRIPT="${PEON_SCRIPT:-$PAI_HOME/hooks/peon-ping/peon.sh}"
if test ! -x "$PEON_SCRIPT"; then
  say "Voice skipped: peon-ping script not executable at $PEON_SCRIPT"
  say "Install peon-ping separately or rerun with PEON_SCRIPT=/path/to/peon.sh ./install.sh --with-voice"
  exit 0
fi

say "Voice integration will use $PEON_SCRIPT"
say "Voice packs are referenced only; no audio files are installed by Temperance Engine."
