#!/usr/bin/env sh
set -eu

. "${TEMPERANCE_ROOT:?}/scripts/lib.sh"

say "Configuring optional GSD (get-shit-done) reference"

if test "${TEMPERANCE_GSD_MODE:-skip}" != "install"; then
  say "GSD reference skipped; pass --with-gsd to print reference guidance."
  exit 0
fi

GSD_HOME="${GSD_HOME:-$HOME/.claude/get-shit-done}"

if test -d "$GSD_HOME"; then
  say "GSD detected at $GSD_HOME."
  say "See docs/parallel-dispatch.md for when to use GSD execute-phase/workstreams vs superpowers dispatch."
else
  say "GSD not found at $GSD_HOME. Temperance Engine does not install or vendor GSD."
  say "See docs/parallel-dispatch.md for guidance; install GSD separately if you want it."
fi
