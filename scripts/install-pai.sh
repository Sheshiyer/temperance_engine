#!/usr/bin/env sh
set -eu

. "${TEMPERANCE_ROOT:?}/scripts/lib.sh"

say "Installing PAI instruction templates"

install_operator_file "$TEMPERANCE_ROOT/templates/AGENTS.md" "$HOME/AGENTS.md"

CLAUDE_ENABLED=false
CODEX_ENABLED=false
test "${TEMPERANCE_CLAUDE_MODE:-skip}" = "install" && CLAUDE_ENABLED=true
test "${TEMPERANCE_CODEX_MODE:-skip}" = "install" && CODEX_ENABLED=true

# Claude and Codex share one enrichment tree. Install it whenever either
# surface is requested; Pulse remains Claude-only below.
if test "$CLAUDE_ENABLED" = true || test "$CODEX_ENABLED" = true; then
  ensure_dir "$PAI_HOME"
  ensure_dir "$PAI_HOME/PAI"
  ENRICH_DEST="$PAI_HOME/PAI/enrich"
  if test -d "$ENRICH_DEST" && test "${TEMPERANCE_FORCE:-0}" != "1"; then
    say "Shared enrichment core already exists at $ENRICH_DEST (preserving it; pass --force to refresh)."
  else
    if test -e "$ENRICH_DEST"; then
      ENRICH_BACKUP="${TEMPERANCE_BACKUP_DIR:-$HOME/.temperance_engine/backups}/$(date -u +%Y%m%dT%H%M%SZ)/enrich"
      ensure_dir "$(dirname "$ENRICH_BACKUP")"
      if is_dry_run; then
        say "DRY_RUN: cp -RP $ENRICH_DEST $ENRICH_BACKUP"
      else
        cp -RP "$ENRICH_DEST" "$ENRICH_BACKUP"
      fi
      say "Backed up prior shared enrichment core to $ENRICH_BACKUP"
    fi
    if is_dry_run; then
      say "DRY_RUN: cp -R $TEMPERANCE_ROOT/package/enrich $ENRICH_DEST"
    else
      rm -rf "$ENRICH_DEST"
      cp -R "$TEMPERANCE_ROOT/package/enrich" "$ENRICH_DEST"
    fi
    say "Installed shared enrichment core at $ENRICH_DEST"
  fi
fi

if test "$CLAUDE_ENABLED" = true; then
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
