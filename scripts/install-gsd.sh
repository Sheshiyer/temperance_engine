#!/usr/bin/env sh
set -eu

. "${TEMPERANCE_ROOT:?}/scripts/lib.sh"

say "Configuring optional GSD (gsd-core) reference"

if test "${TEMPERANCE_GSD_MODE:-skip}" != "install"; then
  say "GSD reference skipped; pass --with-gsd to print reference guidance."
  exit 0
fi

GSD_HOME="${GSD_HOME:-$HOME/.claude/get-shit-done}"

# gsd-core (open-gsd/gsd-core) installs via npx into the project/global; its
# published bins are `gsd-core`, `gsd-tools`, `gsd_run` (NOT `gsd`). The legacy
# danielmiessler-lineage path is ~/.claude/get-shit-done. Detect either, so
# back-compat never regresses. Still detect-only — Temperance never vendors GSD.
if test -d "$GSD_HOME" || command -v gsd-core >/dev/null 2>&1; then
  say "GSD detected (legacy path or gsd-core CLI)."
  say "See docs/pai-flow.md for how gsd-core phases map onto the PAI 7-phase flow."
else
  say "GSD not found. Temperance Engine does not install or vendor GSD."
  say "Recommended: install gsd-core with 'npx @opengsd/gsd-core@latest' (open-gsd/gsd-core)."
  say "See docs/pai-flow.md for the recommended-default flow and its superpowers fallback."
fi
