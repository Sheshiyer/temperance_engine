#!/usr/bin/env sh
set -eu

. "${TEMPERANCE_ROOT:?}/scripts/lib.sh"

say "Installing editor templates"

if test "${TEMPERANCE_OPENCODE_MODE:-install}" = "install"; then
  ensure_dir "$OPENCODE_HOME"
  install_operator_file "$TEMPERANCE_ROOT/templates/opencode.AGENTS.md" "$OPENCODE_HOME/AGENTS.md"

  if test -f "$OPENCODE_HOME/opencode.json"; then
    say "Existing OpenCode config found. Review templates/opencode.json.patch.json and merge manually."
  else
    install_file "$TEMPERANCE_ROOT/templates/opencode.json.patch.json" "$OPENCODE_HOME/opencode.json"
  fi
else
  say "OpenCode template skipped by flag."
fi

if test "${TEMPERANCE_CURSOR_MODE:-install}" = "install"; then
  ensure_dir "$CURSOR_HOME/templates"
  install_operator_file "$TEMPERANCE_ROOT/templates/cursor.AGENTS.md" "$CURSOR_HOME/templates/temperance-engine.AGENTS.md"
  install_file "$TEMPERANCE_ROOT/templates/cursor.rules.mdc" "$CURSOR_HOME/templates/temperance-engine.rules.mdc"
  say "Cursor templates installed under $CURSOR_HOME/templates. Copy them into a project as AGENTS.md or .cursor/rules/temperance-engine.mdc."
else
  say "Cursor template skipped by flag."
fi

if test "${TEMPERANCE_CODEX_MODE:-skip}" = "install"; then
  ensure_dir "$CODEX_HOME"
  install_file "$TEMPERANCE_ROOT/templates/codex.AGENTS.md" "$CODEX_HOME/AGENTS.md"
else
  say "Codex template skipped; pass --with-codex to install it."
fi
