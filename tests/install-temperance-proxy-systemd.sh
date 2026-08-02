#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/install-temperance-proxy-systemd.sh"
UNIT="$ROOT/deploy/systemd/temperance-proxy.service"

bash -n "$SCRIPT"
if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze verify "$UNIT" >/dev/null
fi

grep -Fq 'User=temperance-router' "$UNIT"
grep -Fq 'Group=temperance-router' "$UNIT"
grep -Fq 'TEMPERANCE_PROXY_HOST=127.0.0.1' "$UNIT"
grep -Fq 'TEMPERANCE_AUTO_READY=0' "$UNIT"
grep -Fq 'LoadCredential=omniroute.key:/etc/hermes/omniroute-proxy.key' "$UNIT"
grep -Fq 'OMNIROUTE_API_KEY_FILE=%d/omniroute.key' "$UNIT"
! grep -Eq 'User=hermes|Group=hermes|OnFailure=hermes' "$UNIT"
! grep -Eq 'cp .*omniroute-proxy\.key|install .*omniroute-proxy\.key' "$SCRIPT"
grep -Fq 'chmod 600 "$receipt_path"' "$SCRIPT"
grep -Fq 'configure-opencode-session-profiles.sh" "$release_dir/scripts/configure-opencode-session-profiles.sh' "$SCRIPT"
grep -Fq 'MANIFEST.sha256' "$SCRIPT"
grep -Fq 'chmod -R a-w "$release_dir"' "$SCRIPT"
grep -Fq 'Current release drifted; refusing rollback' "$SCRIPT"
grep -Fq 'Service unit drifted; refusing rollback' "$SCRIPT"

printf 'Linux relay installer policy checks passed.\n'
