#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export TEMPERANCE_ROOT="$ROOT_DIR"
export PAI_HOME="${PAI_HOME:-$HOME/.claude}"
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export OPENCODE_HOME="${OPENCODE_HOME:-$HOME/.config/opencode}"
export CURSOR_HOME="${CURSOR_HOME:-$HOME/.cursor}"
export AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"

sh "$ROOT_DIR/scripts/verify-install.sh"

# Execute this repo's self-contained regression guards (verify-install.sh only
# syntax-lints tests/*.sh; without an execution step a guard can never actually
# catch a regression). These are hermetic: command-code-permissions.sh is
# grep-only, and wire-session-hook.sh isolates via mktemp fixtures with
# PAI_HOME + TEMPERANCE_BACKUP_DIR overridden, so they gate safely in CI.
printf '%s\n' "Running regression guards..."
# Bare statements (not `cmd && echo ok`): under `set -e`, the left side of an
# && list is exempt from errexit, which would silently swallow a failing guard.
bash "$ROOT_DIR/tests/command-code-permissions.sh" >/dev/null
printf '%s\n' "ok: command-code --yolo guard"
if command -v jq >/dev/null 2>&1; then
  bash "$ROOT_DIR/tests/wire-session-hook.sh" >/dev/null
  printf '%s\n' "ok: wire-session-hook suite"
else
  printf '%s\n' "skip: tests/wire-session-hook.sh (jq not found)"
fi
