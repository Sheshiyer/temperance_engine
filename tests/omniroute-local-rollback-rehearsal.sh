#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/omniroute-local-rollback-rehearsal.sh"
TEST_DIR="$(mktemp -d)"
HOME_DIR="$TEST_DIR/home"
PLIST="$HOME_DIR/Library/LaunchAgents/com.temperance.engine.omniroute.plist"
BACKUP="$TEST_DIR/baseline.plist"
CODEX="$TEST_DIR/codex.json"
HERMES="$TEST_DIR/hermes.json"
HERMES_PROPOSAL="$TEST_DIR/hermes-agent.secretless.proposal.yaml"
HERMES_PREVIEW_ROOT="$TEST_DIR/hermes-preview-receipts"
status=0

pass() { printf 'ok - %s\n' "$1"; }
fail() { printf 'FAIL - %s\n' "$1"; status=1; }

mkdir -p "$(dirname "$PLIST")" "$TEST_DIR/receipts" "$HERMES_PREVIEW_ROOT"
printf '%s\n' '<plist><dict><key>OMNIROUTE_SERVER_HOST</key><string>127.0.0.1</string></dict></plist>' > "$BACKUP"
printf '%s\n' '<plist><dict><key>OMNIROUTE_SERVER_HOST</key><string>127.0.0.1</string><key>OMNIROUTE_MCP_ENFORCE_SCOPES</key><string>true</string></dict></plist>' > "$PLIST"
printf '%s\n' '{"schema":"temperance-omniroute-codex-preview-v1","governedCodexUnchanged":true,"isolatedFilesWritten":0,"plaintextApiKeyFound":false}' > "$CODEX"
printf '%s\n' 'model:' '  provider: custom' '  api_key: ${env:TEMPERANCE_HERMES_OMNIROUTE_API_KEY}' > "$HERMES_PROPOSAL"
proposal_hash="$(shasum -a 256 "$HERMES_PROPOSAL" | awk '{print $1}')"
jq -n --arg proposal "$HERMES_PROPOSAL" --arg receipt "$HERMES" \
  --arg proposalHash "$proposal_hash" --arg configPath "$HOME_DIR/.hermes/config.yaml" \
  --arg cookieRoot "$HERMES_PREVIEW_ROOT" \
  '{schema:"temperance-omniroute-hermes-proposal-v3",adoption:"proposal-only",authorization:false,promotionReady:false,offlineCompilation:true,collectionTransport:"none",adminCredentialAccessed:false,sessionCreated:false,nativeEndpointInvoked:false,nativePreview:false,applyInvoked:false,apiKeySent:false,configExistedBefore:false,configExistsAfter:false,setupMarkerExistsAfter:false,directoryCreated:false,directoryExistsAfter:false,sourceSnapshot:{persisted:false,promotionAuthorized:false},legacySessionCookieAudit:{root:$cookieRoot,matchingPathsBefore:0,matchingPathsAfter:0,contentRead:false},transientMaterialPersisted:false,nativeResponsePersisted:false,credentialReference:{materialPersisted:false},plaintextApiKeyFound:false,configPath:$configPath,proposal:$proposal,proposalSha256:$proposalHash,durableArtifacts:[$proposal,$receipt]}' > "$HERMES"

run_rehearsal() {
  HOME="$HOME_DIR" TEMPERANCE_OMNIROUTE_LAUNCHD_PLIST="$PLIST" \
  TEMPERANCE_OMNIROUTE_ROLLBACK_RECEIPTS="$TEST_DIR/receipts" \
    bash "$SCRIPT" --launchd-backup "$BACKUP" --codex-receipt "$CODEX" --hermes-receipt "$HERMES"
}

before="$(shasum -a 256 "$PLIST" | awk '{print $1}')"
output="$(run_rehearsal)"
receipt="$(printf '%s\n' "$output" | sed -n 's/.*receipt=//p')"
after="$(shasum -a 256 "$PLIST" | awk '{print $1}')"
[ "$before" = "$after" ] && pass 'offline rollback rehearsal preserves live plist bytes' || fail 'offline rollback rehearsal preserves live plist bytes'
jq -e '.liveGatewayRestarted==false and .launchAgent.rollbackByteExact==true and .launchAgent.reapplyByteExact==true and .launchAgent.liveBytesUnchangedDuringRehearsal==true and .codex.configurationWrites==0 and .hermes.configurationWrites==0 and .plaintextCredentialsStored==false' "$receipt" >/dev/null \
  && [ "$(stat -f '%Lp' "$receipt")" = 600 ] \
  && pass 'rollback receipt joins all local configuration surfaces' \
  || fail 'rollback receipt joins all local configuration surfaces'

printf '%s\n' '<plist><dict><key>OMNIROUTE_MCP_ENFORCE_SCOPES</key><string>true</string></dict></plist>' > "$BACKUP"
if run_rehearsal > "$TEST_DIR/bad-baseline.out" 2>&1; then
  fail 'rollback rehearsal rejects an already-promoted baseline'
else
  pass 'rollback rehearsal rejects an already-promoted baseline'
fi
printf '%s\n' '<plist><dict><key>OMNIROUTE_SERVER_HOST</key><string>127.0.0.1</string></dict></plist>' > "$BACKUP"
printf '%s\n' '{"schema":"temperance-omniroute-codex-preview-v1","governedCodexUnchanged":false,"isolatedFilesWritten":1,"plaintextApiKeyFound":false}' > "$CODEX"
if run_rehearsal > "$TEST_DIR/bad-codex.out" 2>&1; then
  fail 'rollback rehearsal rejects Codex write drift'
else
  pass 'rollback rehearsal rejects Codex write drift'
fi
printf '%s\n' '{"schema":"temperance-omniroute-codex-preview-v1","governedCodexUnchanged":true,"isolatedFilesWritten":0,"plaintextApiKeyFound":false}' > "$CODEX"
printf 'tamper\n' >> "$HERMES_PROPOSAL"
if run_rehearsal > "$TEST_DIR/bad-hermes-proposal.out" 2>&1; then
  fail 'rollback rehearsal rejects Hermes proposal digest drift'
else
  pass 'rollback rehearsal rejects Hermes proposal digest drift'
fi

exit "$status"
