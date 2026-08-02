#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/omniroute-hermes-preview.sh"
TEST_DIR="$(realpath "$(mktemp -d)")"
MOCK_STATUS="$TEST_DIR/native-status"
POISON_SECURITY="$TEST_DIR/security-must-not-run"
POISON_CURL="$TEST_DIR/curl-must-not-run"
CANARY='test-hermes-admin-password-canary-9372'
status=0

trap 'rm -rf "$TEST_DIR"' EXIT
pass() { printf 'ok - %s\n' "$1"; }
fail() { printf 'FAIL - %s\n' "$1"; status=1; }

cat > "$POISON_SECURITY" <<'EOF'
#!/usr/bin/env bash
printf 'security invoked\n' > "$MOCK_SECURITY_MARKER"
printf '%s\n' "$MOCK_HERMES_ADMIN"
exit 99
EOF
cat > "$POISON_CURL" <<'EOF'
#!/usr/bin/env bash
printf 'curl invoked\n' > "$MOCK_CURL_MARKER"
cat > "$MOCK_STOLEN_STDIN"
exit 99
EOF
cat > "$MOCK_STATUS" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${MOCK_STATUS_FAIL:-0}" = 1 ]; then exit 1; fi
if [ "${MOCK_MALFORMED_STATUS:-0}" = 1 ]; then printf '{}\n'; exit 0; fi
if [ "${MOCK_CONCURRENT_HERMES:-0}" = 1 ]; then
  mkdir -p "$TEMPERANCE_HERMES_DIR"
  printf 'foreign\n' > "$TEMPERANCE_HERMES_DIR/foreign.txt"
fi
if [ "${MOCK_EXPIRED:-0}" = 1 ]; then
  collected='2020-01-01T00:00:00.000Z'
  expires='2020-01-01T00:00:30.000Z'
else
  collected="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  expires="$(date -u -v+30S +%Y-%m-%dT%H:%M:%S.000Z)"
fi
version="${MOCK_VERSION:-3.8.48}"
missing="${MOCK_MISSING_COMBO:-none}"
jq -n \
  --arg collected "$collected" \
  --arg expires "$expires" \
  --arg version "$version" \
  --arg missing "$missing" \
  --arg management "${MOCK_MANAGEMENT_STATE:-not-contacted}" \
  --argjson runtimeContinuity "${MOCK_RUNTIME_CONTINUITY:-true}" \
  --argjson mutation "${MOCK_MUTATION:-false}" '
  {
    schema:"temperance.omniroute.native-control-plane.v1",
    mode:"read-only-local-snapshot",
    collectedAt:$collected,
    expiresAt:$expires,
    fresh:true,
    promotionAuthorized:false,
    mutationMethods:(if $mutation then ["POST"] else [] end),
    evidence:{
      installedVersion:$version,
      runtime:{version:$version,listener:"127.0.0.1:20128"},
      atomicTransaction:true,
      databaseIdentityContinuity:true,
      runtimeContinuity:$runtimeContinuity
    },
    layers:{
      inventory:{governedHermesCombos:{
        temperanceCoding:($missing != "temperance-coding"),
        teBuild:($missing != "te-build"),
        teFreeBurst:($missing != "te-free-burst"),
        teReason:($missing != "te-reason"),
        tePlan:($missing != "te-plan")
      }},
      execution:{hermes:{localStatePresent:false,adoption:"proposal-only"}},
      authority:{omnirouteManagement:$management,hermesEc2:"not-contacted"}
    }
  }'
EOF
chmod 700 "$MOCK_STATUS" "$POISON_SECURITY" "$POISON_CURL"

scenario_home() { printf '%s/%s/home' "$TEST_DIR" "$1"; }
scenario_receipts() { printf '%s/%s/receipts' "$TEST_DIR" "$1"; }
scenario_capture() { printf '%s/%s/capture' "$TEST_DIR" "$1"; }

prepare_scenario() {
  mkdir -p "$(scenario_home "$1")" "$(scenario_receipts "$1")" "$(scenario_capture "$1")"
}

run_preview() {
  scenario="${TEST_SCENARIO:-default}"
  prepare_scenario "$scenario"
  receipt_root="${TEMPERANCE_TEST_RECEIPT_ROOT:-$(scenario_receipts "$scenario")}" 
  HOME="$(scenario_home "$scenario")" USER=tester \
  TEMPERANCE_HERMES_PREVIEW_TEST_MODE=1 \
  TEMPERANCE_TEST_NATIVE_STATUS_BIN="$MOCK_STATUS" \
  TEMPERANCE_HERMES_DIR="$(scenario_home "$scenario")/.hermes" \
  TEMPERANCE_OMNIROUTE_HERMES_PREVIEW_RECEIPTS="$receipt_root" \
  TEMPERANCE_SECURITY_BIN="$POISON_SECURITY" TEMPERANCE_CURL_BIN="$POISON_CURL" \
  MOCK_SECURITY_MARKER="$(scenario_capture "$scenario")/security-invoked" \
  MOCK_CURL_MARKER="$(scenario_capture "$scenario")/curl-invoked" \
  MOCK_STOLEN_STDIN="$(scenario_capture "$scenario")/stolen-stdin" \
  MOCK_HERMES_ADMIN="$CANARY" \
    bash "$SCRIPT"
}

no_forbidden_artifacts() {
  root="$1"
  ! find "$root" \( -name session.cookie -o -name login.json -o -name csrf.json \
    -o -name catalog.json -o -name native-preview.json -o -name native-status.json \) \
    -print -quit | grep -q .
}

TEST_SCENARIO=success output="$(TEST_SCENARIO=success run_preview)"
receipt="$(printf '%s\n' "$output" | sed -n 's/.*receipt=//p')"
proposal="$(jq -r '.proposal' "$receipt")"
capture="$(scenario_capture success)"

[ ! -e "$capture/security-invoked" ] && [ ! -e "$capture/curl-invoked" ] && [ ! -e "$capture/stolen-stdin" ] \
  && pass 'offline proposal invokes no Keychain or network transport binary' \
  || fail 'offline proposal invokes no Keychain or network transport binary'
if grep -Fq "$CANARY" "$receipt" "$proposal" || printf '%s' "$output" | grep -Fq "$CANARY"; then
  fail 'credential canary stays outside output and durable artifacts'
else
  pass 'credential canary stays outside output and durable artifacts'
fi
if rg -n '/api/auth/login|auth_token|x-omniroute-csrf|find-generic-password|TEMPERANCE_SECURITY_BIN|TEMPERANCE_CURL_BIN' "$SCRIPT" >/dev/null; then
  fail 'implementation contains no dashboard authentication or curl seam'
else
  pass 'implementation contains no dashboard authentication or curl seam'
fi
[ ! -e "$(scenario_home success)/.hermes" ] \
  && pass 'offline proposal never creates a Hermes directory' \
  || fail 'offline proposal never creates a Hermes directory'
jq -e '
  .schema=="temperance-omniroute-hermes-proposal-v3" and
  .adoption=="proposal-only" and .authorization==false and .promotionReady==false and
  .offlineCompilation==true and .collectionTransport=="none" and
  .adminCredentialAccessed==false and .sessionCreated==false and
  .nativeEndpointInvoked==false and .nativePreview==false and .applyInvoked==false and
  .apiKeySent==false and .directoryCreated==false and .directoryExistsAfter==false and
  .sourceSnapshot.persisted==false and .sourceSnapshot.promotionAuthorized==false and
  .legacySessionCookieAudit.matchingPathsBefore==0 and
  .legacySessionCookieAudit.matchingPathsAfter==0 and
  .legacySessionCookieAudit.contentRead==false and
  .credentialReference.kind=="environment" and
  .credentialReference.materialPersisted==false and
  .transientMaterialPersisted==false and .nativeResponsePersisted==false and
  (.durableArtifacts|length)==2 and .plaintextApiKeyFound==false
' "$receipt" >/dev/null \
  && [ "$(stat -f '%Lp' "$receipt")" = 600 ] \
  && [ "$(stat -f '%Lp' "$proposal")" = 600 ] \
  && pass 'receipt explicitly proves offline non-authorizing boundaries' \
  || fail 'receipt explicitly proves offline non-authorizing boundaries'
[ "$(find "${receipt%/*}" -type f | wc -l | tr -d ' ')" = 2 ] \
  && no_forbidden_artifacts "${receipt%/*}" \
  && pass 'success retains exactly proposal and receipt' \
  || fail 'success retains exactly proposal and receipt'
[ "$(rg -F -c 'api_key: ${env:TEMPERANCE_HERMES_OMNIROUTE_API_KEY}' "$proposal")" = 5 ] \
  && rg -F 'provider: custom' "$proposal" >/dev/null \
  && rg -F 'base_url: http://127.0.0.1:20128/v1' "$proposal" >/dev/null \
  && ! rg -F 'YOUR_OMNIROUTE_API_KEY_HERE' "$proposal" >/dev/null \
  && pass 'proposal uses official custom endpoint and inert environment references' \
  || fail 'proposal uses official custom endpoint and inert environment references'

prepare_scenario existing
mkdir "$(scenario_home existing)/.hermes"
printf 'protected: true\n' > "$(scenario_home existing)/.hermes/config.yaml"
if TEST_SCENARIO=existing run_preview > "$TEST_DIR/existing.out" 2>&1; then
  fail 'offline proposal refuses existing Hermes configuration'
else
  pass 'offline proposal refuses existing Hermes configuration'
fi
[ "$(cat "$(scenario_home existing)/.hermes/config.yaml")" = 'protected: true' ] \
  || fail 'existing Hermes configuration remains byte-identical'

prepare_scenario empty_existing
mkdir "$(scenario_home empty_existing)/.hermes"
if TEST_SCENARIO=empty_existing run_preview > "$TEST_DIR/empty-existing.out" 2>&1; then
  fail 'offline proposal refuses an empty existing home'
else
  pass 'offline proposal refuses an empty existing home'
fi
[ -d "$(scenario_home empty_existing)/.hermes" ] \
  && pass 'empty pre-existing Hermes home remains untouched' \
  || fail 'empty pre-existing Hermes home remains untouched'

prepare_scenario symlink_existing
mkdir -p "$TEST_DIR/symlink-target"
ln -s "$TEST_DIR/symlink-target" "$(scenario_home symlink_existing)/.hermes"
if TEST_SCENARIO=symlink_existing run_preview > "$TEST_DIR/symlink-existing.out" 2>&1; then
  fail 'offline proposal refuses a symlinked existing home'
else
  pass 'offline proposal refuses a symlinked existing home'
fi
[ -L "$(scenario_home symlink_existing)/.hermes" ] \
  && pass 'pre-existing Hermes symlink remains untouched' \
  || fail 'pre-existing Hermes symlink remains untouched'

if TEST_SCENARIO=concurrent MOCK_CONCURRENT_HERMES=1 run_preview > "$TEST_DIR/concurrent.out" 2>&1; then
  fail 'offline proposal rejects concurrently created Hermes state'
else
  pass 'offline proposal rejects concurrently created Hermes state'
fi
[ "$(cat "$(scenario_home concurrent)/.hermes/foreign.txt")" = foreign ] \
  && pass 'concurrent Hermes state is preserved without cleanup authority' \
  || fail 'concurrent Hermes state is preserved without cleanup authority'

for combo in temperance-coding te-build te-free-burst te-reason te-plan; do
  scenario="missing-${combo}"
  if TEST_SCENARIO="$scenario" MOCK_MISSING_COMBO="$combo" run_preview > "$TEST_DIR/$scenario.out" 2>&1; then
    fail "offline proposal rejects missing governed combo $combo"
  else
    pass "offline proposal rejects missing governed combo $combo"
  fi
done

if TEST_SCENARIO=expired MOCK_EXPIRED=1 run_preview > "$TEST_DIR/expired.out" 2>&1; then
  fail 'offline proposal rejects expired snapshots'
else
  pass 'offline proposal rejects expired snapshots'
fi
if TEST_SCENARIO=version MOCK_VERSION=3.8.49 run_preview > "$TEST_DIR/version.out" 2>&1; then
  fail 'offline proposal rejects unsupported OmniRoute versions'
else
  pass 'offline proposal rejects unsupported OmniRoute versions'
fi
if TEST_SCENARIO=continuity MOCK_RUNTIME_CONTINUITY=false run_preview > "$TEST_DIR/continuity.out" 2>&1; then
  fail 'offline proposal rejects runtime identity drift'
else
  pass 'offline proposal rejects runtime identity drift'
fi
if TEST_SCENARIO=mutation MOCK_MUTATION=true run_preview > "$TEST_DIR/mutation.out" 2>&1; then
  fail 'offline proposal rejects mutation-capable snapshots'
else
  pass 'offline proposal rejects mutation-capable snapshots'
fi
if TEST_SCENARIO=management MOCK_MANAGEMENT_STATE=contacted run_preview > "$TEST_DIR/management.out" 2>&1; then
  fail 'offline proposal rejects management-contacted snapshots'
else
  pass 'offline proposal rejects management-contacted snapshots'
fi
if TEST_SCENARIO=malformed MOCK_MALFORMED_STATUS=1 run_preview > "$TEST_DIR/malformed.out" 2>&1; then
  fail 'offline proposal rejects malformed snapshots'
else
  pass 'offline proposal rejects malformed snapshots'
fi
if TEST_SCENARIO=status_fail MOCK_STATUS_FAIL=1 run_preview > "$TEST_DIR/status-fail.out" 2>&1; then
  fail 'offline proposal propagates snapshot collection failure'
else
  pass 'offline proposal propagates snapshot collection failure'
fi

prepare_scenario legacy_cookie
mkdir -p "$(scenario_receipts legacy_cookie)/historical"
printf '%s\n' "$CANARY" > "$(scenario_receipts legacy_cookie)/historical/session.cookie"
if TEST_SCENARIO=legacy_cookie run_preview > "$TEST_DIR/legacy-cookie.out" 2>&1; then
  fail 'offline proposal blocks any legacy session.cookie path'
else
  pass 'offline proposal blocks any legacy session.cookie path'
fi
[ "$(cat "$(scenario_receipts legacy_cookie)/historical/session.cookie")" = "$CANARY" ] \
  && ! grep -Fq "$CANARY" "$TEST_DIR/legacy-cookie.out" \
  && pass 'legacy cookie is neither read nor deleted by proposal code' \
  || fail 'legacy cookie is neither read nor deleted by proposal code'

if TEST_SCENARIO=relative TEMPERANCE_TEST_RECEIPT_ROOT='relative-receipts' run_preview > "$TEST_DIR/relative.out" 2>&1; then
  fail 'offline proposal rejects a relative receipt root'
else
  pass 'offline proposal rejects a relative receipt root'
fi

prepare_scenario receipt_symlink
mkdir -p "$TEST_DIR/receipt-symlink-target"
ln -s "$TEST_DIR/receipt-symlink-target" "$TEST_DIR/receipt-root-symlink"
if TEST_SCENARIO=receipt_symlink TEMPERANCE_TEST_RECEIPT_ROOT="$TEST_DIR/receipt-root-symlink" run_preview > "$TEST_DIR/receipt-symlink.out" 2>&1; then
  fail 'offline proposal rejects a symlinked receipt root'
else
  pass 'offline proposal rejects a symlinked receipt root'
fi
[ -L "$TEST_DIR/receipt-root-symlink" ] \
  && pass 'receipt-root symlink remains untouched' \
  || fail 'receipt-root symlink remains untouched'

exit "$status"
