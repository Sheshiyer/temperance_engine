#!/usr/bin/env bash
# DEPRECATED: superseded by scripts/omniroute-temperance-reconcile.sh, the
# generalized policy-driven availability/quota reconciler for every governed
# combo (package/router/omniroute-fallback-policy.json, schema
# temperance-fallback-v1). This shim forwards to the new script scoped to
# --combo te-plan so the legacy LaunchAgent and any lingering callers keep
# working until they are migrated (scripts/omniroute-temperance-reconcile.sh
# --install-timer retires the old com.temperance.engine.planner-quota timer).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

printf 'DEPRECATED: %s is superseded by scripts/omniroute-temperance-reconcile.sh; forwarding with --combo te-plan.\n' \
  "$(basename "${BASH_SOURCE[0]}")" >&2

exec "$SCRIPT_DIR/omniroute-temperance-reconcile.sh" --combo te-plan "$@"
