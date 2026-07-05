#!/usr/bin/env sh
# ParallelDispatchContext.hook.sh -- advisory-only session context (fail-open, never blocks)
#
# Not auto-registered by install.sh. To use it, add it to your own
# ~/.claude/settings.json under hooks.SessionStart yourself (this installer
# never writes into settings.json JSON structure it doesn't own). Point the
# command at wherever THIS file actually lives on your machine -- either the
# clone (recommended if you may `git pull` updates), or a copy you placed
# under your PAI hooks dir:
#
#   { "hooks": [ { "type": "command",
#       "command": "/absolute/path/to/temperance_engine/package/hooks/ParallelDispatchContext.hook.sh"
#   } ] }
#
# The installer does not copy this hook anywhere, so `$PAI_HOME/hooks/...`
# will NOT resolve unless you cp the file there yourself first.
#
# Checks (read-only, no side effects):
#   - .planning/ present in cwd           -> GSD-managed project
#   - .planning/active-workstream present -> active GSD workstream name
#   - .planning/workstreams/*/            -> count of defined workstreams
#   - .planning/config.json                -> model_profile / workflow.auto_advance,
#                                              surfaced verbatim, never modified
#
# Temperance Engine owns exactly one preference store: this project's own
# ISA.md. GSD's config and PAI's steering/memory stay fully external. This
# is the only place this repo reads another system's file, and it is read
# only -- there is no write path to config.json anywhere in this script.
#
# Emits a <system-reminder> block to stdout with situational awareness only.
# Never triggers dispatch, never blocks, never writes files. Always exit 0.

set -u

CWD="${CLAUDE_PROJECT_DIR:-$PWD}"
PLANNING_DIR="$CWD/.planning"

if [ ! -d "$PLANNING_DIR" ]; then
  exit 0
fi

WORKSTREAM=""
if [ -f "$PLANNING_DIR/active-workstream" ]; then
  WORKSTREAM=$(cat "$PLANNING_DIR/active-workstream" 2>/dev/null || true)
fi

WS_COUNT=0
if [ -d "$PLANNING_DIR/workstreams" ]; then
  WS_COUNT=$(find "$PLANNING_DIR/workstreams" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
fi

MODEL_PROFILE=""
AUTO_ADVANCE=""
GSD_CONFIG="$PLANNING_DIR/config.json"
if [ -f "$GSD_CONFIG" ]; then
  MODEL_PROFILE=$(grep -o '"model_profile"[[:space:]]*:[[:space:]]*"[^"]*"' "$GSD_CONFIG" 2>/dev/null \
    | sed 's/.*: *"//;s/"$//' | head -n 1)
  AUTO_ADVANCE=$(grep -o '"auto_advance"[[:space:]]*:[[:space:]]*\(true\|false\)' "$GSD_CONFIG" 2>/dev/null \
    | sed 's/.*: *//' | head -n 1)
fi

printf '<system-reminder>\n'
printf 'GSD-managed project detected (.planning/ present).\n'
if [ -n "$WORKSTREAM" ]; then
  printf 'Active workstream: %s\n' "$WORKSTREAM"
fi
if [ "$WS_COUNT" -gt 0 ] 2>/dev/null; then
  printf 'Workstreams defined: %s\n' "$WS_COUNT"
fi
if [ -n "$MODEL_PROFILE" ]; then
  printf 'GSD config.json model_profile: %s (read-only; GSD remains authoritative for its own workflow config)\n' "$MODEL_PROFILE"
fi
if [ -n "$AUTO_ADVANCE" ]; then
  printf 'GSD config.json workflow.auto_advance: %s\n' "$AUTO_ADVANCE"
fi
printf 'See docs/parallel-dispatch.md before choosing sequential vs parallel work for this project.\n'
printf '</system-reminder>\n'

exit 0
