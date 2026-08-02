#!/usr/bin/env bash
set -euo pipefail

# Remove protected prompt/response bodies accidentally retained before the
# dedicated Claude API key was promoted to noLog=true. Summary telemetry stays
# intact. The deleted payload bodies are intentionally not recoverable.

DB_PATH="${OMNIROUTE_DB_PATH:-$HOME/.omniroute/storage.sqlite}"
ARTIFACT_ROOT="${OMNIROUTE_CALL_LOG_ROOT:-$HOME/.omniroute/call_logs}"
RECEIPT_ROOT="${TEMPERANCE_OMNIROUTE_AUTH_RECEIPTS:-$HOME/.temperance_engine/receipts/omniroute-client-auth}"
KEY_NAME="Temperance Claude Native"

usage() {
  printf 'usage: %s {status|apply|verify}\n' "$0" >&2
  exit 2
}

require_tools() {
  command -v sqlite3 >/dev/null || { printf 'sqlite3 is required\n' >&2; exit 127; }
  command -v jq >/dev/null || { printf 'jq is required\n' >&2; exit 127; }
  command -v node >/dev/null || { printf 'node is required\n' >&2; exit 127; }
  [ -r "$DB_PATH" ] || { printf 'OmniRoute database is not readable: %s\n' "$DB_PATH" >&2; exit 1; }
}

candidate_rows() {
  local result
  result="$(sqlite3 -readonly -json "$DB_PATH" \
    "SELECT id,api_key_id,api_key_name,artifact_relpath,artifact_size_bytes,artifact_sha256,has_request_body,has_response_body,has_pipeline_details FROM call_logs WHERE api_key_name='$KEY_NAME' AND (has_request_body=1 OR has_response_body=1 OR has_pipeline_details=1 OR request_summary IS NOT NULL) ORDER BY timestamp;")"
  printf '%s\n' "${result:-[]}"
}

all_artifact_rows() {
  local result
  result="$(sqlite3 -readonly -json "$DB_PATH" \
    "SELECT id,artifact_relpath FROM call_logs WHERE api_key_name='$KEY_NAME' AND artifact_relpath IS NOT NULL ORDER BY timestamp;")"
  printf '%s\n' "${result:-[]}"
}

# OmniRoute 3.8.48 calls this database field `artifact_sha256`, but its own
# writeCallArtifact implementation stores FNV-1a 32-bit. Preserve that exact
# compatibility contract in SQLite and record a genuine SHA-256 separately in
# our receipt.
omniroute_artifact_checksum() {
  node -e 'const fs=require("fs");let h=0x811c9dc5;for(const b of fs.readFileSync(process.argv[1])){h^=b;h=Math.imul(h,0x01000193)>>>0}process.stdout.write(h.toString(16).padStart(8,"0"))' "$1"
}

sha256_checksum() {
  shasum -a 256 "$1" | awk '{print $1}'
}

validate_candidate() {
  local row="$1" rel path artifact_key
  rel="$(printf '%s' "$row" | jq -er '.artifact_relpath')"
  case "$rel" in
    /*|*..*) printf 'unsafe artifact path: %s\n' "$rel" >&2; return 1 ;;
  esac
  path="$ARTIFACT_ROOT/$rel"
  [ -f "$path" ] || { printf 'missing candidate artifact: %s\n' "$path" >&2; return 1; }
  artifact_key="$(jq -r '.summary.apiKeyName // empty' "$path")"
  [ "$artifact_key" = "$KEY_NAME" ] || { printf 'artifact key mismatch: %s\n' "$path" >&2; return 1; }
}

validate_redacted_artifact() {
  local row="$1" rel path artifact_key
  rel="$(printf '%s' "$row" | jq -er '.artifact_relpath')"
  case "$rel" in
    /*|*..*) printf 'unsafe artifact path: %s\n' "$rel" >&2; return 1 ;;
  esac
  path="$ARTIFACT_ROOT/$rel"
  [ -f "$path" ] || { printf 'missing redacted artifact: %s\n' "$path" >&2; return 1; }
  artifact_key="$(jq -r '.summary.apiKeyName // empty' "$path")"
  [ "$artifact_key" = "$KEY_NAME" ] || { printf 'artifact key mismatch: %s\n' "$path" >&2; return 1; }
  jq -e '.requestBody==null and .responseBody==null and .error==null and (has("pipeline")|not)' "$path" >/dev/null || {
    printf 'FAIL protected details remain in artifact: %s\n' "$path" >&2
    return 1
  }
}

status_report() {
  local rows
  rows="$(candidate_rows)"
  jq -n --arg keyName "$KEY_NAME" --argjson candidates "${rows:-[]}" \
    '{keyName:$keyName,candidateCount:($candidates|length),candidates:[$candidates[]|{id,artifact_relpath,has_request_body,has_response_body,has_pipeline_details}]}'
}

verify_redaction() {
  local remaining artifact_count artifacts row
  remaining="$(candidate_rows | jq 'length')"
  [ "$remaining" = 0 ] || { printf 'FAIL %s Claude call-log rows still retain protected details\n' "$remaining" >&2; return 1; }
  artifacts="$(all_artifact_rows)"
  artifact_count="$(printf '%s' "$artifacts" | jq 'length')"
  while IFS= read -r row; do
    validate_redacted_artifact "$row"
  done < <(printf '%s' "$artifacts" | jq -c '.[]')
  printf 'ok - Claude call-log protected details removed; %s summary artifacts remain redacted\n' "$artifact_count"
}

apply_redaction() {
  local rows count receipt_dir receipt row rel path tmp id key_id size checksum sha256 changes='[]'
  rows="$(candidate_rows)"
  count="$(printf '%s' "${rows:-[]}" | jq 'length')"
  if [ "$count" = 0 ]; then
    verify_redaction
    return
  fi

  while IFS= read -r row; do
    validate_candidate "$row"
  done < <(printf '%s' "$rows" | jq -c '.[]')

  receipt_dir="$RECEIPT_ROOT/redaction-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -p "$receipt_dir"
  chmod 700 "$receipt_dir"
  receipt="$receipt_dir/receipt.json"
  jq -n \
    --arg schema temperance-omniroute-claude-artifact-redaction-v1 \
    --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg keyName "$KEY_NAME" \
    --argjson candidates "$rows" \
    '{schema:$schema,createdAt:$createdAt,keyName:$keyName,irreversiblePayloadRedaction:true,secretBackupsCreated:false,candidates:$candidates,applied:false}' \
    > "$receipt"
  chmod 600 "$receipt"

  while IFS= read -r row; do
    rel="$(printf '%s' "$row" | jq -er '.artifact_relpath')"
    path="$ARTIFACT_ROOT/$rel"
    tmp="$(mktemp "${path}.redacted.XXXXXX")"
    jq '.requestBody=null | .responseBody=null | .error=null | del(.pipeline)' "$path" > "$tmp"
    jq -e '.requestBody==null and .responseBody==null and .error==null and (has("pipeline")|not)' "$tmp" >/dev/null
    chmod 600 "$tmp"
    mv "$tmp" "$path"
    size="$(stat -f '%z' "$path")"
    checksum="$(omniroute_artifact_checksum "$path")"
    sha256="$(sha256_checksum "$path")"
    id="$(printf '%s' "$row" | jq -er '.id')"
    key_id="$(printf '%s' "$row" | jq -er '.api_key_id')"
    sqlite3 "$DB_PATH" \
      "UPDATE call_logs SET has_request_body=0,has_response_body=0,has_pipeline_details=0,request_summary=NULL,artifact_size_bytes=$size,artifact_sha256='$checksum' WHERE id='$id' AND api_key_id='$key_id';"
    changes="$(printf '%s' "$changes" | jq -c --arg id "$id" --arg rel "$rel" --argjson size "$size" --arg checksum "$checksum" --arg sha256 "$sha256" '. + [{id:$id,artifactRelpath:$rel,redactedSizeBytes:$size,omnirouteChecksumFnv1a32:$checksum,redactedSha256:$sha256}]')"
  done < <(printf '%s' "$rows" | jq -c '.[]')

  jq --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson changes "$changes" \
    '.applied=true | .completedAt=$completedAt | .changes=$changes' "$receipt" > "$receipt.next"
  mv "$receipt.next" "$receipt"
  chmod 600 "$receipt"
  verify_redaction
  printf 'applied receipt=%s\n' "$receipt"
}

require_tools
case "${1:-}" in
  status) status_report ;;
  apply) apply_redaction ;;
  verify) verify_redaction ;;
  *) usage ;;
esac
