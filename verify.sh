#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export TEMPERANCE_ROOT="$ROOT_DIR"
export PAI_HOME="${PAI_HOME:-$HOME/.claude}"
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export OPENCODE_HOME="${OPENCODE_HOME:-$HOME/.config/opencode}"
export AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"

sh "$ROOT_DIR/scripts/verify-install.sh"
