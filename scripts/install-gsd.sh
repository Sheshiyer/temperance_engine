#!/usr/bin/env sh
# DEPRECATED: Use `temperance install` instead.
# This script will be removed in a future release.
set -eu

echo "WARNING: This script is deprecated. Use 'temperance install' instead." >&2

. "${TEMPERANCE_ROOT:?}/scripts/lib.sh"

say "Configuring optional external GSD reference"

if test "${TEMPERANCE_GSD_MODE:-skip}" != "install"; then
  say "GSD reference skipped; pass --with-gsd or --with-spine to install wrappers (GSD core stays external)."
  exit 0
fi

GSD_HOME="${GSD_HOME:-$HOME/.claude/get-shit-done}"

# Temperance never vendors GSD. Wrappers in package/router/gsd-command-install.mjs
# point at the upstream workflow files and require the upstream query CLI.
if test -d "$GSD_HOME"; then
  say "GSD workflows detected at $GSD_HOME."
else
  say "GSD workflows missing at $GSD_HOME. Wrapper installation will fail closed."
fi

if command -v gsd-sdk >/dev/null 2>&1 \
  && gsd-sdk query current-timestamp full --raw >/dev/null 2>&1; then
  say "GSD query CLI ready ($(command -v gsd-sdk))."
else
  say "GSD workflows are not runtime-ready: gsd-sdk query is unavailable."
  say "Install the matching external CLI: npm install -g get-shit-done-cc@1.42.3"
  say "Wrappers will stop before workflow reads or agent dispatch until this probe passes."
fi

INSTALLER="${TEMPERANCE_ROOT}/package/router/gsd-command-install.mjs"
if test -f "$INSTALLER"; then
  if is_dry_run; then
    printf 'DRY_RUN: node %s\n' "$INSTALLER"
  else
    node "$INSTALLER"
  fi
  say "See docs/gsd-manifest-spine.md for picker-before-IAB and /gsd:doctor."
else
  say "gsd-command-install.mjs missing from package/router."
fi
