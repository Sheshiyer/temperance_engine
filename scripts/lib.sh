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
  backup_base=$(basename "$backup_src")
  backup_dest="${TEMPERANCE_BACKUP_DIR:-$HOME/.temperance_engine/backups}/$stamp/$backup_base"
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
