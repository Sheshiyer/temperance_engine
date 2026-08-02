#!/usr/bin/env bash
# Syncs PAI's native per-project memory (~/.claude/projects/<slug>/memory/*.md)
# into OmniRoute's Memory feature (verified live 2026-08-02: POST /api/memory,
# {type, key, content, metadata}; see
# docs/superpowers/specs/2026-08-02-memory-compression-freetier-leverage-design.md
# §1) so semantic/keyword search over past project decisions is available to
# any OmniRoute-routed client, not just this Claude Code session.
#
# Read-only on the PAI side (never writes to ~/.claude/projects). Additive
# and idempotent on the OmniRoute side: fetches every existing memory key
# first and skips any file whose key already exists there -- re-running
# never duplicates, and nothing already in OmniRoute is ever mutated or
# deleted by this script.
#
# Auth mirrors scripts/omniroute-temperance-reconcile.sh's proven pattern
# exactly (Keychain admin password -> POST /api/auth/login -> cookie jar ->
# CSRF token), reusing the same admin credential service name, rather than
# inventing a second auth path.
#
# Usage:
#   scripts/omniroute-memory-sync.sh                 # dry-run (default): report what would sync
#   scripts/omniroute-memory-sync.sh --apply          # actually POST new memories
#   scripts/omniroute-memory-sync.sh --memory-dir DIR # override the source directory
#   scripts/omniroute-memory-sync.sh --project-label NAME

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/omniroute-curl.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE_URL="${TEMPERANCE_OMNIROUTE_ADMIN_URL:-http://127.0.0.1:20128}"
BASE_URL="${BASE_URL%/}"
ADMIN_SERVICE="OmniRoute Temperance Admin"
USER_SAFE="${USER:-$(id -un)}"

MODE="dry-run"
PROJECT_LABEL="$(basename "$REPO_ROOT")"
DEFAULT_SLUG="$(printf '%s' "$REPO_ROOT" | sed 's/[^a-zA-Z0-9]/-/g')"
MEMORY_DIR="${TEMPERANCE_PAI_MEMORY_DIR:-$HOME/.claude/projects/$DEFAULT_SLUG/memory}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/omniroute-memory-sync.sh                 # dry-run (default)
  scripts/omniroute-memory-sync.sh --apply          # actually sync new memories
  scripts/omniroute-memory-sync.sh --memory-dir DIR
  scripts/omniroute-memory-sync.sh --project-label NAME
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) MODE="apply" ;;
    --dry-run) MODE="dry-run" ;;
    --memory-dir) shift; [ "$#" -ge 1 ] || { usage >&2; exit 2; }; MEMORY_DIR="$1" ;;
    --project-label) shift; [ "$#" -ge 1 ] || { usage >&2; exit 2; }; PROJECT_LABEL="$1" ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v bun >/dev/null || { echo "bun is required" >&2; exit 1; }
command -v security >/dev/null || { echo "macOS security CLI is required" >&2; exit 1; }

if [ ! -d "$MEMORY_DIR" ]; then
  echo "No PAI memory directory found at $MEMORY_DIR; nothing to sync." >&2
  exit 0
fi

# ── Auth (mirrors omniroute-temperance-reconcile.sh exactly) ──
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ADMIN_PASSWORD="$(security find-generic-password -a "$USER_SAFE" -s "$ADMIN_SERVICE" -w)"
login_payload="$(jq -nc --arg password "$ADMIN_PASSWORD" '{password:$password}')"
unset ADMIN_PASSWORD
login_http="$(omniroute_curl_payload "$login_payload" -sS -o "$TMP_DIR/login.json" -w '%{http_code}' -c "$TMP_DIR/cookie" \
  -H 'content-type: application/json' \
  "$BASE_URL/api/auth/login")"
unset login_payload
case "$login_http" in 2*) ;; *) echo "OmniRoute admin login failed (HTTP $login_http)" >&2; exit 1 ;; esac
CSRF="$(curl -sS -f -b "$TMP_DIR/cookie" "$BASE_URL/api/auth/csrf" | jq -er '.token')"

api_get() { curl -sS -f -b "$TMP_DIR/cookie" "$BASE_URL$1"; }
api_mutate() {
  local method="$1" path="$2" payload="$3" response="$TMP_DIR/mutate.json" http
  http="$(omniroute_curl_csrf_payload "$CSRF" "$payload" -sS -o "$response" -w '%{http_code}' -X "$method" -b "$TMP_DIR/cookie" \
    -H 'origin: http://127.0.0.1:20128' -H 'referer: http://127.0.0.1:20128/dashboard' \
    -H 'content-type: application/json' "$BASE_URL$path")"
  case "$http" in 2*) cat "$response" ;; *) echo "OmniRoute mutation failed: $method $path (HTTP $http)" >&2; cat "$response" >&2; return 1 ;; esac
}

# ── Existing keys (paginate; never re-sync or duplicate) ──
: > "$TMP_DIR/existing-keys.jsonl"
page=1
while :; do
  batch="$(api_get "/api/memory?page=$page&limit=100")"
  jq -r '.data[].key' <<<"$batch" >> "$TMP_DIR/existing-keys.jsonl"
  total_pages="$(jq -r '.totalPages // 1' <<<"$batch")"
  [ "$page" -ge "$total_pages" ] && break
  page=$((page + 1))
done
existing_keys="$(jq -R -s -c 'split("\n") | map(select(length > 0))' "$TMP_DIR/existing-keys.jsonl")"

# ── Candidate entries (pure parsing, no network -- see pai-memory-frontmatter.ts) ──
entries="$(bun "$REPO_ROOT/package/router/pai-memory-frontmatter.ts" list-entries "$MEMORY_DIR" "$PROJECT_LABEL")"
new_entries="$(jq -c --argjson existing "$existing_keys" '[.[] | select((.key as $k | $existing | index($k)) == null)]' <<<"$entries")"

new_count="$(jq 'length' <<<"$new_entries")"
skipped_count="$(( $(jq 'length' <<<"$entries") - new_count ))"
echo "PAI memory sync: $new_count new, $skipped_count already present in OmniRoute, source=$MEMORY_DIR"

if [ "$MODE" = "dry-run" ]; then
  jq -r '.[] | "  would sync: \(.key) (\(.type))"' <<<"$new_entries"
  echo "Dry-run: no changes made. Re-run with --apply to sync."
  exit 0
fi

jq -c '.[]' <<<"$new_entries" | while IFS= read -r entry; do
  key="$(jq -r '.key' <<<"$entry")"
  api_mutate POST "/api/memory" "$entry" >/dev/null
  echo "  synced: $key"
done
echo "PAI memory sync complete: $new_count entries synced."
