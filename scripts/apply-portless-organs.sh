#!/bin/sh
# Alias Temperance organs through portless. Does not rebind LaunchAgents.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
ORGANS="$ROOT/package/router/organs.json"
if test ! -f "$ORGANS"; then ORGANS="$HOME/.temperance_engine/router/organs.json"; fi
if ! command -v portless >/dev/null 2>&1; then
  echo "portless not on PATH" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 required" >&2
  exit 1
fi
python3 - "$ORGANS" <<'PY' | while read -r name port; do
import json, sys
doc = json.load(open(sys.argv[1]))
for row in doc.get("http") or []:
    print(row["name"], row["port"])
PY
  [ -n "$name" ] || continue
  portless alias "$name" "$port" --force
done
echo "aliased. start proxy: portless proxy start && portless trust"
portless list || true
