#!/usr/bin/env bash
# wire-session-hook.sh -- OPT-IN, backup-first registration of the
# ParallelDispatchContext SessionStart hook into settings.json.
#
# NOT called by install.sh. The default installer deliberately never writes
# settings.json (structure it does not own). This is the explicit, reversible
# opt-in for the GSD-awareness nudge. It (1) copies the hook to a STABLE path
# under $PAI_HOME/hooks/ (never the removable repo clone) and (2) jq-injects a
# SessionStart entry pointing at that stable path -- backup-first, idempotent,
# atomic. --revert is symmetric and ownership-guarded.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${TEMPERANCE_BACKUP_DIR:-$HOME/.temperance_engine/backups}/$TIMESTAMP"

PAI_HOME="${PAI_HOME:-$HOME/.claude}"
HOOKS_DIR="$PAI_HOME/hooks"
HOOK_DEST="$HOOKS_DIR/ParallelDispatchContext.hook.sh"
HOOK_SRC="$REPO_ROOT/package/hooks/ParallelDispatchContext.hook.sh"
SETTINGS="$PAI_HOME/settings.json"
CMD="$HOOK_DEST"   # exact absolute literal injected into and matched out of settings.json

MODE=install
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --revert)  MODE=revert ;;
    --status)  MODE=status ;;
    -h|--help)
      cat <<EOF
Usage: scripts/wire-session-hook.sh [--dry-run|--revert|--status|-h]

OPT-IN registration of the ParallelDispatchContext SessionStart hook.
NOT run by install.sh. Copies the hook to \$PAI_HOME/hooks/ and registers a
SessionStart entry pointing at that stable path. Backup-first, idempotent,
atomic, and reversible via --revert.
EOF
      exit 0 ;;
    *) printf 'unknown arg: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

log(){  printf '[wire-session] %s\n' "$*"; }
warn(){ printf '[wire-session] WARN: %s\n' "$*" >&2; }
err(){  printf '[wire-session] ERROR: %s\n' "$*" >&2; exit 1; }

# ---- jq filters (single source of truth; tests reuse these shapes) ----
JQ_CHECK='((.hooks.SessionStart // []) | any((.hooks // []) | any(.command == $cmd)))'
JQ_ADD='.hooks = (.hooks // {}) | .hooks.SessionStart = ((.hooks.SessionStart // []) + [{"hooks":[{"type":"command","command":$cmd}]}])'
JQ_REMOVE='.hooks.SessionStart = ((.hooks.SessionStart // []) | map(.hooks = ((.hooks // []) | map(select(.command != $cmd)))) | map(select((.hooks // []) | length > 0)))'

is_registered(){ jq -e --arg cmd "$CMD" "$JQ_CHECK" "$SETTINGS" >/dev/null 2>&1; }

require_valid_settings(){
  [ -f "$SETTINGS" ] || err "settings.json not found at $SETTINGS. Launch Claude Code once so it materializes its own settings.json; this script never fabricates it."
  jq empty "$SETTINGS" >/dev/null 2>&1 || err "$SETTINGS is not valid JSON; refusing to touch it."
}

backup_settings(){
  mkdir -p "$BACKUP_DIR"
  cp "$SETTINGS" "$BACKUP_DIR/settings.json"
  log "Backed up settings.json -> $BACKUP_DIR/settings.json"
}

# Atomic jq write: filter -> temp -> verify -> mv. Never edits in place.
jq_write(){  # $1 = jq filter
  local filter="$1" tmp
  tmp="$(mktemp "${SETTINGS}.XXXXXX")"
  trap 'rm -f "$tmp"' RETURN
  if ! jq --arg cmd "$CMD" "$filter" "$SETTINGS" > "$tmp"; then
    err "jq transform failed; settings.json left untouched."
  fi
  jq empty "$tmp" >/dev/null 2>&1 || err "jq produced invalid JSON; settings.json left untouched."
  mv "$tmp" "$SETTINGS"
  trap - RETURN
}

install_hook_file(){
  if [ "$DRY_RUN" = "1" ]; then
    log "Would ensure $HOOKS_DIR exists"
    if [ -L "$HOOK_DEST" ]; then
      log "Would replace existing symlink $HOOK_DEST"
    elif [ -e "$HOOK_DEST" ]; then
      log "Would back up existing $HOOK_DEST"
    fi
    log "Would copy hook -> $HOOK_DEST (chmod +x)"
    return 0
  fi
  mkdir -p "$HOOKS_DIR"
  if [ -L "$HOOK_DEST" ]; then
    # Replace a pre-existing symlink with our real copy; never cp THROUGH it
    # (cp would follow the link and overwrite the symlink's target file).
    log "Replacing existing symlink $HOOK_DEST (was -> $(readlink "$HOOK_DEST"))"
    rm -f "$HOOK_DEST"
  elif [ -e "$HOOK_DEST" ]; then
    mkdir -p "$BACKUP_DIR"
    cp "$HOOK_DEST" "$BACKUP_DIR/ParallelDispatchContext.hook.sh"
    log "Backed up existing hook -> $BACKUP_DIR/ParallelDispatchContext.hook.sh"
  fi
  cp "$HOOK_SRC" "$HOOK_DEST"
  chmod +x "$HOOK_DEST"
  log "Installed hook -> $HOOK_DEST"
}

do_install(){
  command -v jq >/dev/null 2>&1 || err "jq is required but not found on PATH"
  [ -f "$HOOK_SRC" ] || err "hook source not found: $HOOK_SRC"
  require_valid_settings

  install_hook_file

  if is_registered; then
    log "[skip] SessionStart entry already registered ($CMD)"
    check_status
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "Would back up settings.json"
    log "Would add SessionStart entry: $CMD"
    check_status
    return 0
  fi

  backup_settings
  jq_write "$JQ_ADD"
  log "Registered SessionStart entry: $CMD"
  check_status
  log "Restart Claude Code to load the new SessionStart hook."
  log "To revert: $0 --revert"
}

do_revert(){
  command -v jq >/dev/null 2>&1 || err "jq is required but not found on PATH"
  # (a) settings.json entry
  if [ -f "$SETTINGS" ] && jq empty "$SETTINGS" >/dev/null 2>&1; then
    if is_registered; then
      if [ "$DRY_RUN" = "1" ]; then
        log "Would back up settings.json and remove SessionStart entry: $CMD"
      else
        backup_settings
        jq_write "$JQ_REMOVE"
        log "Removed SessionStart entry: $CMD"
      fi
    else
      log "[skip] no SessionStart entry to remove"
    fi
  else
    warn "settings.json missing or invalid; skipping entry removal"
  fi
  # (b) stable hook file -- only if it is a regular file we own (never a symlink)
  if [ -L "$HOOK_DEST" ]; then
    warn "$HOOK_DEST is a symlink (user-managed); leaving it in place"
  elif [ -f "$HOOK_DEST" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      log "Would remove hook file: $HOOK_DEST"
    else
      rm -f "$HOOK_DEST"
      log "Removed hook file: $HOOK_DEST"
    fi
  else
    log "[skip] no hook file at $HOOK_DEST"
  fi
}

check_status(){
  printf '\n'
  printf '═══════════════════════════════════════════════════════════════\n'
  printf 'TEMPERANCE ENGINE - SESSIONSTART HOOK WIRING STATUS\n'
  printf '═══════════════════════════════════════════════════════════════\n'
  if [ -L "$HOOK_DEST" ]; then
    printf '  [SYMLINK] hook: %s\n' "$HOOK_DEST"
  elif [ -f "$HOOK_DEST" ]; then
    printf '  [OK]      hook: %s\n' "$HOOK_DEST"
  else
    printf '  [MISSING] hook: %s\n' "$HOOK_DEST"
  fi
  if [ -f "$SETTINGS" ] && jq empty "$SETTINGS" >/dev/null 2>&1; then
    if is_registered; then
      printf '  [REGISTERED]     SessionStart entry present\n'
    else
      printf '  [NOT REGISTERED] SessionStart entry absent\n'
    fi
    printf '  SessionStart groups: %s\n' "$(jq '.hooks.SessionStart | length' "$SETTINGS")"
  else
    printf '  [MISSING] settings.json (%s)\n' "$SETTINGS"
  fi
  printf '═══════════════════════════════════════════════════════════════\n'
}

case "$MODE" in
  status) check_status ;;
  revert) do_revert ;;
  *)      do_install ;;
esac
