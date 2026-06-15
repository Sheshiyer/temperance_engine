#!/usr/bin/env sh
set -eu

. "${TEMPERANCE_ROOT:?}/scripts/lib.sh"

say "Installing PAI instruction templates"

install_file "$TEMPERANCE_ROOT/templates/AGENTS.md" "$HOME/AGENTS.md"

if test "${TEMPERANCE_CLAUDE_MODE:-skip}" = "install"; then
  ensure_dir "$PAI_HOME"
  ensure_dir "$PAI_HOME/PAI/PULSE"
  ensure_dir "$PAI_HOME/hooks"

  install_file "$TEMPERANCE_ROOT/templates/CLAUDE.md.template" "$PAI_HOME/CLAUDE.md.template"
  install_file "$TEMPERANCE_ROOT/package/pulse-compat/compat-server.ts" "$PAI_HOME/PAI/PULSE/compat-server.ts"

  if command -v bun >/dev/null 2>&1; then
    if is_dry_run; then
      say "DRY_RUN: would start Pulse compatibility server with bun"
    else
      if test -f "$PAI_HOME/PAI/PULSE/compat-server.pid"; then
        old_pid=$(cat "$PAI_HOME/PAI/PULSE/compat-server.pid" 2>/dev/null || true)
        if test -n "$old_pid" && kill -0 "$old_pid" 2>/dev/null; then
          kill "$old_pid" 2>/dev/null || true
        fi
      fi
      nohup bun "$PAI_HOME/PAI/PULSE/compat-server.ts" > "$PAI_HOME/PAI/PULSE/compat-server.log" 2>&1 &
      printf '%s\n' "$!" > "$PAI_HOME/PAI/PULSE/compat-server.pid"
    fi
  else
    say "bun not found; Pulse compatibility server installed but not started"
  fi
else
  say "Claude template and Pulse server skipped; pass --with-claude to install them."
fi
