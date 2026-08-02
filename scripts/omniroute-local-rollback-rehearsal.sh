#!/usr/bin/env bash
set -euo pipefail

# Prove the exact rollback/reapply bytes for every persisted local change in
# this promotion without restarting the healthy gateway. Preview-only Codex
# and Hermes work is joined by receipt; the LaunchAgent change is rehearsed in
# an isolated mode-700 directory from its real pre-change backup.

LABEL="com.temperance.engine.omniroute"
PLIST="${TEMPERANCE_OMNIROUTE_LAUNCHD_PLIST:-$HOME/Library/LaunchAgents/$LABEL.plist}"
RECEIPT_ROOT="${TEMPERANCE_OMNIROUTE_ROLLBACK_RECEIPTS:-$HOME/.temperance_engine/receipts/omniroute-local-rollback}"
BACKUP=""
CODEX_RECEIPT=""
HERMES_RECEIPT=""

usage() {
  printf 'usage: %s --launchd-backup PATH --codex-receipt PATH --hermes-receipt PATH\n' "$0" >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --launchd-backup) [ "$#" -ge 2 ] || usage; BACKUP="$2"; shift 2 ;;
    --codex-receipt) [ "$#" -ge 2 ] || usage; CODEX_RECEIPT="$2"; shift 2 ;;
    --hermes-receipt) [ "$#" -ge 2 ] || usage; HERMES_RECEIPT="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[ -r "$PLIST" ] || { printf 'current LaunchAgent plist is not readable: %s\n' "$PLIST" >&2; exit 1; }
[ -r "$BACKUP" ] || { printf 'pre-change LaunchAgent backup is not readable: %s\n' "$BACKUP" >&2; exit 1; }
[ -r "$CODEX_RECEIPT" ] || { printf 'Codex preview receipt is not readable: %s\n' "$CODEX_RECEIPT" >&2; exit 1; }
[ -r "$HERMES_RECEIPT" ] || { printf 'Hermes preview receipt is not readable: %s\n' "$HERMES_RECEIPT" >&2; exit 1; }
command -v jq >/dev/null || { printf 'jq is required\n' >&2; exit 127; }
command -v shasum >/dev/null || { printf 'shasum is required\n' >&2; exit 127; }

jq -e '.schema=="temperance-omniroute-codex-preview-v1" and .governedCodexUnchanged==true and .isolatedFilesWritten==0 and .plaintextApiKeyFound==false' "$CODEX_RECEIPT" >/dev/null || {
  printf 'Codex preview receipt does not prove zero configuration writes\n' >&2
  exit 1
}
jq -e '.schema=="temperance-omniroute-hermes-proposal-v3" and .adoption=="proposal-only" and .authorization==false and .promotionReady==false and .offlineCompilation==true and .collectionTransport=="none" and .adminCredentialAccessed==false and .sessionCreated==false and .nativeEndpointInvoked==false and .nativePreview==false and .applyInvoked==false and .apiKeySent==false and .configExistedBefore==false and .configExistsAfter==false and .setupMarkerExistsAfter==false and .directoryCreated==false and .directoryExistsAfter==false and .sourceSnapshot.persisted==false and .sourceSnapshot.promotionAuthorized==false and .legacySessionCookieAudit.matchingPathsBefore==0 and .legacySessionCookieAudit.matchingPathsAfter==0 and .legacySessionCookieAudit.contentRead==false and .transientMaterialPersisted==false and .nativeResponsePersisted==false and .credentialReference.materialPersisted==false and .plaintextApiKeyFound==false and (.durableArtifacts|length)==2' "$HERMES_RECEIPT" >/dev/null || {
  printf 'Hermes preview receipt does not prove zero residual state\n' >&2
  exit 1
}
hermes_proposal="$(jq -er '.proposal' "$HERMES_RECEIPT")"
hermes_receipt_ref="$(jq -er '.durableArtifacts[1]' "$HERMES_RECEIPT")"
hermes_proposal_ref="$(jq -er '.durableArtifacts[0]' "$HERMES_RECEIPT")"
hermes_config_path="$(jq -er '.configPath' "$HERMES_RECEIPT")"
legacy_cookie_root="$(jq -er '.legacySessionCookieAudit.root' "$HERMES_RECEIPT")"
[ "$hermes_receipt_ref" = "$HERMES_RECEIPT" ] && [ "$hermes_proposal_ref" = "$hermes_proposal" ] || {
  printf 'Hermes durable artifacts are not bound to the supplied receipt\n' >&2
  exit 1
}
[ "$hermes_config_path" = "$HOME/.hermes/config.yaml" ] || {
  printf 'Hermes receipt targets an unexpected local config path\n' >&2
  exit 1
}
[ -f "$hermes_proposal" ] && [ ! -L "$hermes_proposal" ] || {
  printf 'Hermes proposal artifact is missing or symbolic\n' >&2
  exit 1
}
hermes_proposal_hash="$(shasum -a 256 "$hermes_proposal" | awk '{print $1}')"
[ "$hermes_proposal_hash" = "$(jq -er '.proposalSha256' "$HERMES_RECEIPT")" ] || {
  printf 'Hermes proposal digest does not match its receipt\n' >&2
  exit 1
}
[ -d "$legacy_cookie_root" ] && [ ! -L "$legacy_cookie_root" ] \
  && [ -z "$(find "$legacy_cookie_root" -name session.cookie -print -quit)" ] || {
  printf 'Hermes legacy-cookie absence evidence no longer holds\n' >&2
  exit 1
}
[ ! -e "$HOME/.hermes" ] && [ ! -L "$HOME/.hermes" ] || { printf 'unexpected local Hermes state exists\n' >&2; exit 1; }

umask 077
receipt_dir="$RECEIPT_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$receipt_dir"
chmod 700 "$receipt_dir"
baseline_copy="$receipt_dir/launchd.baseline.plist"
current_copy="$receipt_dir/launchd.current.plist"
working_copy="$receipt_dir/launchd.rehearsal.plist"
cp "$BACKUP" "$baseline_copy"
cp "$PLIST" "$current_copy"
cp "$current_copy" "$working_copy"
chmod 600 "$baseline_copy" "$current_copy" "$working_copy"

baseline_hash="$(shasum -a 256 "$baseline_copy" | awk '{print $1}')"
current_hash="$(shasum -a 256 "$current_copy" | awk '{print $1}')"
[ "$baseline_hash" != "$current_hash" ] || { printf 'LaunchAgent backup and promoted bytes are unexpectedly identical\n' >&2; exit 1; }

cp "$baseline_copy" "$working_copy"
rollback_hash="$(shasum -a 256 "$working_copy" | awk '{print $1}')"
[ "$rollback_hash" = "$baseline_hash" ] || { printf 'isolated LaunchAgent rollback is not byte-exact\n' >&2; exit 1; }
cp "$current_copy" "$working_copy"
reapply_hash="$(shasum -a 256 "$working_copy" | awk '{print $1}')"
[ "$reapply_hash" = "$current_hash" ] || { printf 'isolated LaunchAgent reapply is not byte-exact\n' >&2; exit 1; }
actual_after_hash="$(shasum -a 256 "$PLIST" | awk '{print $1}')"
[ "$actual_after_hash" = "$current_hash" ] || { printf 'live LaunchAgent changed during offline rehearsal\n' >&2; exit 1; }

grep -q '<key>OMNIROUTE_MCP_ENFORCE_SCOPES</key>' "$current_copy" || {
  printf 'promoted LaunchAgent lacks MCP scope enforcement\n' >&2
  exit 1
}
if grep -q '<key>OMNIROUTE_MCP_ENFORCE_SCOPES</key>' "$baseline_copy"; then
  printf 'pre-change LaunchAgent backup already contains the promoted setting\n' >&2
  exit 1
fi

receipt="$receipt_dir/receipt.json"
jq -n \
  --arg schema temperance-omniroute-local-rollback-v1 \
  --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg plist "$PLIST" \
  --arg backup "$BACKUP" \
  --arg baselineHash "$baseline_hash" \
  --arg currentHash "$current_hash" \
  --arg rollbackHash "$rollback_hash" \
  --arg reapplyHash "$reapply_hash" \
  --arg codexReceipt "$CODEX_RECEIPT" \
  --arg hermesReceipt "$HERMES_RECEIPT" \
  --arg hermesProposal "$hermes_proposal" \
  --arg hermesProposalHash "$hermes_proposal_hash" \
  '{schema:$schema,createdAt:$createdAt,liveGatewayRestarted:false,launchAgent:{path:$plist,preChangeBackup:$backup,baselineSha256:$baselineHash,currentSha256:$currentHash,rollbackSha256:$rollbackHash,reapplySha256:$reapplyHash,rollbackByteExact:($baselineHash==$rollbackHash),reapplyByteExact:($currentHash==$reapplyHash),liveBytesUnchangedDuringRehearsal:true},codex:{receipt:$codexReceipt,configurationWrites:0,governedProfilesUnchanged:true},hermes:{receipt:$hermesReceipt,proposal:$hermesProposal,proposalSha256:$hermesProposalHash,configurationWrites:0,residualState:false,collectionTransport:"none",adminCredentialAccessed:false},plaintextCredentialsStored:false}' \
  > "$receipt"
chmod 600 "$receipt"
printf 'ok - full local rollback and reapply rehearsed byte-exact without restarting the gateway; receipt=%s\n' "$receipt"
