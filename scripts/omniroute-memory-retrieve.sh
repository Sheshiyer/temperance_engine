#!/usr/bin/env bash
# Queries OmniRoute's Memory feature (POST /api/memory/retrieve-preview,
# read-only by OmniRoute's own design -- "no memories are modified") for
# entries relevant to a query, formatted for injection into a session
# context block.
#
# This is the read side of the pair with scripts/omniroute-memory-sync.sh.
# Intended as the underlying call a future PAI SessionStart hook would make
# (design doc §1) -- NOT wired into ~/.claude/hooks/ by this script itself.
# That wiring is a separate, explicit step: it changes global session-start
# behavior for every project, not just this one, and adds a real network
# round-trip (including this script's own admin login) to every session
# start, which deserves its own latency/caching decision before being made
# automatic.
#
# Auth mirrors omniroute-temperance-reconcile.sh's proven pattern exactly.
# Request shape verified live 2026-08-02 against a real synced memory:
# {query, strategy: "exact"|"semantic"|"hybrid", maxTokens} -- "budgetTokens"
# and "budget" were tried first and rejected by the server's own validation
# ("Unrecognized key"); maxTokens is the field the server actually accepts.
#
# Usage:
#   scripts/omniroute-memory-retrieve.sh "QUERY" [--strategy hybrid|exact|semantic] [--max-tokens N]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/omniroute-curl.sh"
BASE_URL="${TEMPERANCE_OMNIROUTE_ADMIN_URL:-http://127.0.0.1:20128}"
BASE_URL="${BASE_URL%/}"
ADMIN_SERVICE="OmniRoute Temperance Admin"
USER_SAFE="${USER:-$(id -un)}"

STRATEGY="hybrid"
MAX_TOKENS="${TEMPERANCE_MEMORY_RETRIEVE_MAX_TOKENS:-2000}"
QUERY=""

usage() {
  cat <<'USAGE'
Usage:
  scripts/omniroute-memory-retrieve.sh "QUERY" [--strategy hybrid|exact|semantic] [--max-tokens N]
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --strategy) shift; [ "$#" -ge 1 ] || { usage >&2; exit 2; }; STRATEGY="$1" ;;
    --max-tokens) shift; [ "$#" -ge 1 ] || { usage >&2; exit 2; }; MAX_TOKENS="$1" ;;
    -h|--help) usage; exit 0 ;;
    *) [ -z "$QUERY" ] && QUERY="$1" || { usage >&2; exit 2; } ;;
  esac
  shift
done
[ -n "$QUERY" ] || { usage >&2; exit 2; }
case "$STRATEGY" in exact|semantic|hybrid) ;; *) echo "invalid --strategy: $STRATEGY" >&2; exit 2 ;; esac

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v security >/dev/null || { echo "macOS security CLI is required" >&2; exit 1; }

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

request_payload="$(jq -nc --arg q "$QUERY" --arg strategy "$STRATEGY" --argjson maxTokens "$MAX_TOKENS" \
  '{query:$q, strategy:$strategy, maxTokens:$maxTokens}')"
response="$(omniroute_curl_csrf_payload "$CSRF" "$request_payload" -sS -f -b "$TMP_DIR/cookie" \
  -H 'origin: http://127.0.0.1:20128' -H 'referer: http://127.0.0.1:20128/dashboard' \
  -H 'content-type: application/json' -X POST "$BASE_URL/api/memory/retrieve-preview")"

if ! jq -e '.memories | type == "array"' <<<"$response" >/dev/null 2>&1; then
  echo "OmniRoute memory retrieval returned an unexpected shape" >&2
  echo "$response" >&2
  exit 1
fi

jq -r '
  if (.memories | length) == 0 then
    "No relevant memories found."
  else
    (.memories | map("[\(.key)] (\(.type), score \(.score))\n\(.content)") | join("\n\n---\n\n"))
  end
' <<<"$response"
