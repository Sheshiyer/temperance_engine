#!/usr/bin/env bash
# Thin compatibility entry point: all metadata and rendering live in TypeScript.
set -euo pipefail
RAIL_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec bun "${RAIL_SCRIPT_DIR}/rail-announce.ts" "$@"
