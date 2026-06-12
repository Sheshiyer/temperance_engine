#!/usr/bin/env sh
set -eu

. "${TEMPERANCE_ROOT:?}/scripts/lib.sh"

say "Installing OpenCode and Codex templates"
ensure_dir "$OPENCODE_HOME"
ensure_dir "$CODEX_HOME"
install_file "$TEMPERANCE_ROOT/templates/opencode.AGENTS.md" "$OPENCODE_HOME/AGENTS.md"
install_file "$TEMPERANCE_ROOT/templates/codex.AGENTS.md" "$CODEX_HOME/AGENTS.md"

if test -f "$OPENCODE_HOME/opencode.json"; then
  say "Existing OpenCode config found. Review templates/opencode.json.patch.json and merge manually."
else
  install_file "$TEMPERANCE_ROOT/templates/opencode.json.patch.json" "$OPENCODE_HOME/opencode.json"
fi
