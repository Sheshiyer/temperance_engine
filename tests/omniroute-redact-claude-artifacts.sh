#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/omniroute-redact-claude-artifacts.sh"
TEST_DIR="$(mktemp -d)"
DB_PATH="$TEST_DIR/storage.sqlite"
ARTIFACT_ROOT="$TEST_DIR/call_logs"
RECEIPT_ROOT="$TEST_DIR/receipts"
ARTIFACT_REL="2026/08/protected.json"
ARTIFACT_PATH="$ARTIFACT_ROOT/$ARTIFACT_REL"
status=0

pass() { printf 'ok - %s\n' "$1"; }
fail() { printf 'FAIL - %s\n' "$1"; status=1; }

mkdir -p "$(dirname "$ARTIFACT_PATH")" "$RECEIPT_ROOT"
sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE call_logs (
  id TEXT PRIMARY KEY,
  api_key_id TEXT,
  api_key_name TEXT,
  artifact_relpath TEXT,
  artifact_size_bytes INTEGER,
  artifact_sha256 TEXT,
  has_request_body INTEGER,
  has_response_body INTEGER,
  has_pipeline_details INTEGER,
  request_summary TEXT,
  timestamp TEXT
);
INSERT INTO call_logs VALUES (
  'row-1','key-1','Temperance Claude Native','2026/08/protected.json',0,'old',1,1,1,'retained','2026-08-01T00:00:00Z'
);
SQL
printf '%s\n' '{"summary":{"apiKeyName":"Temperance Claude Native","status":200},"requestBody":{"secret":"prompt"},"responseBody":{"secret":"answer"},"error":{"secret":"failure"},"pipeline":{"secret":"trace"}}' > "$ARTIFACT_PATH"
chmod 600 "$ARTIFACT_PATH"

run_redactor() {
  OMNIROUTE_DB_PATH="$DB_PATH" \
  OMNIROUTE_CALL_LOG_ROOT="$ARTIFACT_ROOT" \
  TEMPERANCE_OMNIROUTE_AUTH_RECEIPTS="$RECEIPT_ROOT" \
    bash "$SCRIPT" "$@"
}

if run_redactor verify >"$TEST_DIR/pre-verify.out" 2>&1; then
  fail 'verification detects a deliberately planted protected body'
else
  pass 'verification detects a deliberately planted protected body'
fi

apply_output="$(run_redactor apply)"
receipt="$(printf '%s\n' "$apply_output" | sed -n 's/^applied receipt=//p')"
jq -e '.requestBody==null and .responseBody==null and .error==null and (has("pipeline")|not) and .summary.status==200' "$ARTIFACT_PATH" >/dev/null \
  && pass 'apply removes protected bodies while preserving summary telemetry' \
  || fail 'apply removes protected bodies while preserving summary telemetry'
sqlite3 "$DB_PATH" 'SELECT has_request_body=0 AND has_response_body=0 AND has_pipeline_details=0 AND request_summary IS NULL FROM call_logs WHERE id="row-1";' | grep -qx 1 \
  && pass 'apply clears every protected-detail database marker' \
  || fail 'apply clears every protected-detail database marker'
[ -r "$receipt" ] && [ "$(stat -f '%Lp' "$receipt")" = 600 ] \
  && pass 'apply writes a mode-600 metadata-only receipt' \
  || fail 'apply writes a mode-600 metadata-only receipt'
jq -e '.changes[0].omnirouteChecksumFnv1a32 | length==8' "$receipt" >/dev/null \
  && jq -e '.changes[0].redactedSha256 | length==64' "$receipt" >/dev/null \
  && pass 'receipt distinguishes OmniRoute compatibility checksum from SHA-256' \
  || fail 'receipt distinguishes OmniRoute compatibility checksum from SHA-256'
run_redactor verify >/dev/null \
  && pass 'verification inspects every redacted artifact after apply' \
  || fail 'verification inspects every redacted artifact after apply'

jq '.responseBody={secret:"replanted"}' "$ARTIFACT_PATH" > "$TEST_DIR/replanted.json"
mv "$TEST_DIR/replanted.json" "$ARTIFACT_PATH"
chmod 600 "$ARTIFACT_PATH"
if run_redactor verify >"$TEST_DIR/post-plant.out" 2>&1; then
  fail 'verification rejects artifact drift even when database flags stay clear'
else
  pass 'verification rejects artifact drift even when database flags stay clear'
fi

exit "$status"
