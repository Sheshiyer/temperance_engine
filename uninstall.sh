#!/usr/bin/env sh
set -eu

STATE_DIR="${TEMPERANCE_STATE_DIR:-$HOME/.temperance_engine}"
BACKUP_DIR="${TEMPERANCE_BACKUP_DIR:-$STATE_DIR/backups}"

printf '%s\n' "Temperance Engine uninstall helper"
printf '%s\n' "Backups live under: $BACKUP_DIR"
printf '%s\n' "This helper does not delete files automatically. Restore from the newest backup after reviewing it."
printf '%s\n' "See docs/rollback.md for exact commands."
