#!/usr/bin/env sh

say() {
  printf '%s\n' "$*"
}

is_dry_run() {
  test "${TEMPERANCE_DRY_RUN:-0}" = "1"
}

run_cmd() {
  if is_dry_run; then
    printf 'DRY_RUN: %s\n' "$*"
  else
    "$@"
  fi
}

ensure_dir() {
  if is_dry_run; then
    printf 'DRY_RUN: mkdir -p %s\n' "$1"
  else
    mkdir -p "$1"
  fi
}

backup_file() {
  backup_src="$1"
  if test ! -e "$backup_src"; then
    return 0
  fi
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup_slug=$(printf '%s' "$backup_src" | sed 's#^/##; s#/#__#g')
  backup_dest="${TEMPERANCE_BACKUP_DIR:-$HOME/.temperance_engine/backups}/$stamp/$backup_slug"
  ensure_dir "$(dirname "$backup_dest")"
  if is_dry_run; then
    printf 'DRY_RUN: cp %s %s\n' "$backup_src" "$backup_dest"
  else
    cp "$backup_src" "$backup_dest"
  fi
}

install_file() {
  install_src="$1"
  install_dest="$2"
  ensure_dir "$(dirname "$install_dest")"
  backup_file "$install_dest"
  if is_dry_run; then
    printf 'DRY_RUN: cp %s %s\n' "$install_src" "$install_dest"
  else
    cp "$install_src" "$install_dest"
  fi
}

# is_live_operator_surface: true if $1 already exists, looks like a real,
# in-use operator instruction file (a temperance identity block, or PAI
# doctrine content), AND is not simply what we ourselves would install at
# $2 (our own template). That last check keeps a plain re-install of our
# own generic template (which itself references PAI vocabulary such as
# NOESIS) from being mistaken for a user's live operator surface -- it
# only guards content that differs from our template, i.e. content we did
# not just produce.
is_live_operator_surface() {
  live_target="$1"
  live_src="$2"
  test -f "$live_target" || return 1
  if test -f "$live_src" && cmp -s "$live_target" "$live_src"; then
    return 1
  fi
  grep -qF 'temperance:identity' "$live_target" 2>/dev/null && return 0
  grep -qF 'PAI 4.0.3' "$live_target" 2>/dev/null && return 0
  grep -qF 'Personal AI Infrastructure' "$live_target" 2>/dev/null && return 0
  grep -qF 'NOESIS' "$live_target" 2>/dev/null && return 0
  return 1
}

# install_operator_file: like install_file, but skips (with a warning)
# writing over an existing live operator surface unless TEMPERANCE_FORCE=1.
install_operator_file() {
  op_src="$1"
  op_dest="$2"
  if test "${TEMPERANCE_FORCE:-0}" != "1" && is_live_operator_surface "$op_dest" "$op_src"; then
    say "WARNING: skipping $op_dest (looks like a live operator file; pass --force to overwrite)"
    return 0
  fi
  install_file "$op_src" "$op_dest"
}
