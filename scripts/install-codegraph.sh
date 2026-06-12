#!/usr/bin/env sh
set -eu

. "${TEMPERANCE_ROOT:?}/scripts/lib.sh"

say "Configuring CodeGraph routing"

if test -d "$AGENTS_HOME"; then
  if command -v codegraph >/dev/null 2>&1; then
    if test -d "$AGENTS_HOME/.codegraph"; then
      say "CodeGraph index already exists at $AGENTS_HOME/.codegraph"
    elif is_dry_run; then
      say "DRY_RUN: would run codegraph init -i in $AGENTS_HOME"
    else
      (cd "$AGENTS_HOME" && codegraph init -i)
    fi
  else
    say "codegraph CLI not found; install it separately, then run: cd $AGENTS_HOME && codegraph init -i"
  fi
else
  say "No AGENTS_HOME found at $AGENTS_HOME; skipping CodeGraph index initialization"
fi
