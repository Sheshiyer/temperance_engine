#!/bin/sh
# Codex CLI hook runner. Keep hooks synchronous.
# Codex CLI (2026-08) does not support `"async": true` — those entries are skipped.
# Fail-open except security deny (exit 2). Resolve bun even when PATH is /usr/bin:/bin.
export PATH="${HOME}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}"
hook=$1
if [ -z "$hook" ]; then
  exit 0
fi
shift
if [ -x "${HOME}/.bun/bin/bun" ]; then
  bun="${HOME}/.bun/bin/bun"
elif [ -x /opt/homebrew/bin/bun ]; then
  bun=/opt/homebrew/bin/bun
else
  bun=$(command -v bun 2>/dev/null || true)
fi
if [ -z "$bun" ] || [ ! -x "$bun" ]; then
  exit 0
fi
"$bun" "$hook" "$@"
code=$?
if [ "$code" -eq 2 ]; then
  exit 2
fi
exit 0
