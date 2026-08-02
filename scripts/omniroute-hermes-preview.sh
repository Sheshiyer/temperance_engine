#!/usr/bin/env bash
set -euo pipefail

# Compile a proposal-only Hermes configuration from Temperance's redacted,
# read-only local OmniRoute snapshot. This wrapper never authenticates to the
# dashboard, opens a network connection, creates a session, or applies config.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RECEIPT_ROOT="${TEMPERANCE_OMNIROUTE_HERMES_PREVIEW_RECEIPTS:-$HOME/.temperance_engine/receipts/omniroute-hermes-preview}"
HERMES_DIR="${TEMPERANCE_HERMES_DIR:-$HOME/.hermes}"
HERMES_CONFIG="$HERMES_DIR/config.yaml"
HERMES_MARKER="$HERMES_DIR/.first-setup.json"
CREDENTIAL_ENV="TEMPERANCE_HERMES_OMNIROUTE_API_KEY"
EXPECTED_VERSION="3.8.48"
SNAPSHOT_SCHEMA="temperance.omniroute.native-control-plane.v1"

roles=(default delegation compression skills_hub approval)
models=(temperance-coding te-build te-free-burst te-reason te-plan)

usage() {
  printf 'usage: %s\n' "$0" >&2
  printf 'Compiles one offline, secretless Hermes proposal; never applies it.\n' >&2
  exit 2
}

[ "$#" -eq 0 ] || usage
command -v jq >/dev/null || { printf 'jq is required\n' >&2; exit 127; }
command -v rg >/dev/null || { printf 'rg is required\n' >&2; exit 127; }
command -v shasum >/dev/null || { printf 'shasum is required\n' >&2; exit 127; }
command -v stat >/dev/null || { printf 'stat is required\n' >&2; exit 127; }
BUN_BIN="$(command -v bun || true)"
[ -n "$BUN_BIN" ] && [ -x "$BUN_BIN" ] || { printf 'bun is required\n' >&2; exit 127; }

# Any pre-existing Hermes path belongs to another owner. This wrapper never
# creates the path, so there is no path-based cleanup or deletion race.
if [ -e "$HERMES_DIR" ] || [ -L "$HERMES_DIR" ]; then
  printf 'refusing offline Hermes proposal because the Hermes path already exists\n' >&2
  exit 1
fi

case "$RECEIPT_ROOT" in
  /*) ;;
  *) printf 'Hermes receipt root must be absolute\n' >&2; exit 1 ;;
esac
umask 077
mkdir -p "$RECEIPT_ROOT"
[ -d "$RECEIPT_ROOT" ] && [ ! -L "$RECEIPT_ROOT" ] || {
  printf 'Hermes receipt root must be a real directory\n' >&2
  exit 1
}
[ "$(realpath "$RECEIPT_ROOT")" = "$RECEIPT_ROOT" ] || {
  printf 'Hermes receipt root must be canonical and contain no symlink traversal\n' >&2
  exit 1
}
[ "$(stat -f '%u' "$RECEIPT_ROOT")" = "$(id -u)" ] || {
  printf 'Hermes receipt root must be owned by the current user\n' >&2
  exit 1
}
chmod 700 "$RECEIPT_ROOT"

# The one historical reusable cookie was removed after metadata-only
# validation. Every future proposal proves the exact receipt tree is still
# cookie-free before it does any collection or writes any new evidence.
legacy_cookie="$(find "$RECEIPT_ROOT" -name session.cookie -print -quit)"
[ -z "$legacy_cookie" ] || {
  printf 'refusing Hermes proposal while a legacy session.cookie path exists\n' >&2
  exit 1
}

if [ "${TEMPERANCE_HERMES_PREVIEW_TEST_MODE:-0}" = 1 ]; then
  STATUS_BIN="${TEMPERANCE_TEST_NATIVE_STATUS_BIN:-}"
  [ -n "$STATUS_BIN" ] && [ -x "$STATUS_BIN" ] || {
    printf 'test mode requires an executable TEMPERANCE_TEST_NATIVE_STATUS_BIN\n' >&2
    exit 2
  }
  snapshot="$($STATUS_BIN)"
  snapshot_mode="test-fixture"
else
  snapshot="$($BUN_BIN "$ROOT_DIR/scripts/omniroute-native-status.ts")"
  snapshot_mode="verified-local-read-only"
fi

printf '%s' "$snapshot" | jq -e \
  --arg schema "$SNAPSHOT_SCHEMA" \
  --arg version "$EXPECTED_VERSION" '
    .schema == $schema and
    .mode == "read-only-local-snapshot" and
    .fresh == true and
    .promotionAuthorized == false and
    .mutationMethods == [] and
    .evidence.installedVersion == $version and
    .evidence.runtime.version == $version and
    (.evidence.runtime.listener == "127.0.0.1:20128" or .evidence.runtime.listener == "[::1]:20128") and
    .evidence.atomicTransaction == true and
    .evidence.databaseIdentityContinuity == true and
    .evidence.runtimeContinuity == true and
    .layers.execution.hermes.localStatePresent == false and
    .layers.execution.hermes.adoption == "proposal-only" and
    .layers.authority.omnirouteManagement == "not-contacted" and
    .layers.authority.hermesEc2 == "not-contacted" and
    (.layers.inventory.governedHermesCombos | keys | sort) ==
      (["teBuild","teFreeBurst","tePlan","teReason","temperanceCoding"] | sort) and
    (.layers.inventory.governedHermesCombos | all(. == true))
  ' >/dev/null || {
    printf 'redacted local snapshot does not satisfy the offline Hermes proposal contract\n' >&2
    exit 1
  }

collected_at="$(printf '%s' "$snapshot" | jq -er '.collectedAt')"
expires_at="$(printf '%s' "$snapshot" | jq -er '.expiresAt')"
freshness="$($BUN_BIN -e '
  const collected = Date.parse(process.argv[1]);
  const expires = Date.parse(process.argv[2]);
  const now = Date.now();
  process.stdout.write(Number.isFinite(collected) && Number.isFinite(expires) &&
    expires > now && collected <= now + 1000 && expires - collected > 0 &&
    expires - collected <= 30000 ? "valid" : "invalid");
' "$collected_at" "$expires_at")"
[ "$freshness" = valid ] || {
  printf 'redacted local snapshot is expired or has an invalid lifetime\n' >&2
  exit 1
}

# A concurrent creator is outside this wrapper's authority. Preserve it and
# fail; never remove, rename, follow, or mutate the path.
if [ -e "$HERMES_DIR" ] || [ -L "$HERMES_DIR" ]; then
  printf 'Hermes state appeared during offline collection; preserving it and refusing proposal\n' >&2
  exit 1
fi

selections='[]'
for index in "${!roles[@]}"; do
  selections="$(printf '%s' "$selections" | jq -c --arg role "${roles[$index]}" --arg model "${models[$index]}" '. + [{role:$role,model:$model}]')"
done
snapshot_sha256="$(printf '%s' "$snapshot" | shasum -a 256 | awk '{print $1}')"
unset snapshot

receipt_dir="$RECEIPT_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir "$receipt_dir"
chmod 700 "$receipt_dir"
proposal="$receipt_dir/hermes-agent.secretless.proposal.yaml"
receipt="$receipt_dir/receipt.json"
proposal_tmp="$(mktemp "$receipt_dir/.proposal.XXXXXX")"
receipt_tmp="$(mktemp "$receipt_dir/.receipt.XXXXXX")"
chmod 600 "$proposal_tmp" "$receipt_tmp"

cat > "$proposal_tmp" <<EOF
# temperance-hermes-secretless-proposal-v1
# Proposal only. Do not install until the host-specific promotion gate passes.
model:
  default: temperance-coding
  provider: custom
  base_url: http://127.0.0.1:20128/v1
  api_key: \${env:$CREDENTIAL_ENV}
  api_mode: chat_completions
delegation:
  model: te-build
  base_url: http://127.0.0.1:20128/v1
  api_key: \${env:$CREDENTIAL_ENV}
  api_mode: chat_completions
  max_spawn_depth: 1
auxiliary:
  compression:
    model: te-free-burst
    base_url: http://127.0.0.1:20128/v1
    api_key: \${env:$CREDENTIAL_ENV}
  skills_hub:
    model: te-reason
    base_url: http://127.0.0.1:20128/v1
    api_key: \${env:$CREDENTIAL_ENV}
  approval:
    model: te-plan
    base_url: http://127.0.0.1:20128/v1
    api_key: \${env:$CREDENTIAL_ENV}
EOF
chmod 600 "$proposal_tmp"

if rg -n '(YOUR_OMNIROUTE_API_KEY_HERE|sk-[A-Za-z0-9_-]{16,}|Bearer [A-Za-z0-9._~-]{12,}|oma_(live_)?[A-Za-z0-9_-]{12,})' "$proposal_tmp" >/dev/null; then
  printf 'credential-like material found in secretless Hermes proposal\n' >&2
  exit 1
fi
[ "$(rg -F -c 'api_key: ${env:TEMPERANCE_HERMES_OMNIROUTE_API_KEY}' "$proposal_tmp")" = 5 ] || {
  printf 'secretless Hermes proposal lacks exact environment references\n' >&2
  exit 1
}
for index in "${!roles[@]}"; do
  rg -F "${models[$index]}" "$proposal_tmp" >/dev/null || {
    printf 'secretless Hermes proposal omitted governed role %s\n' "${roles[$index]}" >&2
    exit 1
  }
done

[ ! -e "$HERMES_DIR" ] && [ ! -L "$HERMES_DIR" ] || {
  printf 'Hermes state appeared during proposal compilation; preserving it and refusing completion\n' >&2
  exit 1
}
[ -z "$(find "$RECEIPT_ROOT" -name session.cookie -print -quit)" ] || {
  printf 'legacy session.cookie path appeared during proposal compilation\n' >&2
  exit 1
}

proposal_sha256="$(shasum -a 256 "$proposal_tmp" | awk '{print $1}')"
jq -n \
  --arg schema temperance-omniroute-hermes-proposal-v3 \
  --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg sourceSnapshotMode "$snapshot_mode" \
  --arg sourceSnapshotSha256 "$snapshot_sha256" \
  --arg sourceSnapshotCollectedAt "$collected_at" \
  --arg sourceSnapshotExpiresAt "$expires_at" \
  --arg configPath "$HERMES_CONFIG" \
  --arg proposal "$proposal" \
  --arg receipt "$receipt" \
  --arg proposalSha256 "$proposal_sha256" \
  --arg credentialEnvironment "$CREDENTIAL_ENV" \
  --arg legacyCookieRoot "$RECEIPT_ROOT" \
  --argjson selections "$selections" \
  '{schema:$schema,createdAt:$createdAt,adoption:"proposal-only",authorization:false,promotionReady:false,offlineCompilation:true,collectionTransport:"none",adminCredentialAccessed:false,sessionCreated:false,nativeEndpointInvoked:false,nativePreview:false,applyInvoked:false,keyIdSent:null,apiKeySent:false,configPath:$configPath,configExistedBefore:false,configExistsAfter:false,setupMarkerExistedBefore:false,setupMarkerExistsAfter:false,directoryExistedBefore:false,directoryCreated:false,directoryExistsAfter:false,selections:$selections,sourceSnapshot:{mode:$sourceSnapshotMode,schema:"temperance.omniroute.native-control-plane.v1",sha256:$sourceSnapshotSha256,collectedAt:$sourceSnapshotCollectedAt,expiresAt:$sourceSnapshotExpiresAt,persisted:false,promotionAuthorized:false},nativeMappingEvidence:"previously-observed-policy-pinned",proposal:$proposal,proposalSha256:$proposalSha256,credentialReference:{kind:"environment",name:$credentialEnvironment,materialPersisted:false},legacySessionCookieAudit:{root:$legacyCookieRoot,matchingPathsBefore:0,matchingPathsAfter:0,contentRead:false},transientMaterialPersisted:false,nativeResponsePersisted:false,durableArtifacts:[$proposal,$receipt],plaintextApiKeyFound:false,externalHostsContacted:false}' \
  > "$receipt_tmp"
chmod 600 "$receipt_tmp"

if rg -n '(YOUR_OMNIROUTE_API_KEY_HERE|sk-[A-Za-z0-9_-]{16,}|Bearer [A-Za-z0-9._~-]{12,}|oma_(live_)?[A-Za-z0-9_-]{12,})' "$receipt_tmp" >/dev/null; then
  printf 'credential-like material found in Hermes proposal receipt\n' >&2
  exit 1
fi
mv "$proposal_tmp" "$proposal"
mv "$receipt_tmp" "$receipt"
chmod 600 "$proposal" "$receipt"
printf 'ok - offline secretless Hermes proposal compiled with zero authentication or network transport; receipt=%s\n' "$receipt"
