#!/usr/bin/env bash
# Run one agentic Codex turn through OmniRoute's OpenAI-compatible gateway.
# The task stays a single argv item and stdin is closed, so piped batch JSON can
# never be appended to the agent prompt.

set -uo pipefail

MODEL="${1:-${TEMPERANCE_OMNIROUTE_MODEL:-temperance-coding}}"
TASK="${2:-}"
[[ -n "$TASK" ]] || { echo "usage: $0 MODEL TASK" >&2; exit 2; }
command -v codex >/dev/null 2>&1 || { echo "codex CLI is required for the OmniRoute agent backend" >&2; exit 127; }

BASE_URL="${TEMPERANCE_OMNIROUTE_BASE_URL:-http://127.0.0.1:20128/v1}"
BASE_URL="${BASE_URL%/}"
[[ "$BASE_URL" == */v1 ]] || BASE_URL="$BASE_URL/v1"

# Prefer an explicit environment key. On macOS, the local bootstrap stores the
# scoped Temperance key in Keychain so parallel workers can authenticate without
# writing credentials into repository files or command arguments.
GATEWAY_AUTH="${OMNIROUTE_API_KEY:-}"
if [[ -z "$GATEWAY_AUTH" ]] && command -v security >/dev/null 2>&1; then
  GATEWAY_AUTH="$(security find-generic-password -a "$USER" \
    -s "${TEMPERANCE_OMNIROUTE_KEYCHAIN_SERVICE:-OmniRoute Temperance API Key}" \
    -w 2>/dev/null || true)"
fi
[[ -n "$GATEWAY_AUTH" ]] || GATEWAY_AUTH="omniroute-no-auth"

CODEX_PROFILE="${TEMPERANCE_OMNIROUTE_CODEX_PROFILE:-temperance-coding}"
CODEX_SANDBOX="${TEMPERANCE_OMNIROUTE_CODEX_SANDBOX:-workspace-write}"
WIRE_API="${TEMPERANCE_OMNIROUTE_WIRE_API:-responses}"
ROOT_URL="${BASE_URL%/v1}"
CORRELATION_ID="${TEMPERANCE_CORRELATION_ID:-}"
if [[ -n "$CORRELATION_ID" && ! "$CORRELATION_ID" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  echo "invalid TEMPERANCE_CORRELATION_ID" >&2
  exit 2
fi

SESSION_TAG="${TEMPERANCE_SESSION_TAG:-}"
if [[ -n "$SESSION_TAG" && ! "$SESSION_TAG" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  echo "invalid TEMPERANCE_SESSION_TAG" >&2
  exit 2
fi

# The fleet's smallest context rail is Codex Spark (128k). Advertise that real
# ceiling whenever Spark can be selected so Codex compacts before OmniRoute
# rotates a request onto it. Other portfolios retain their existing 200k
# contract. Both values remain explicitly overridable for catalog migrations.
case "$MODEL" in
  noesis-execute|te-dispatch|codex/gpt-5.3-codex-spark)
    MODEL_CONTEXT_WINDOW="${TEMPERANCE_OMNIROUTE_MODEL_CONTEXT_WINDOW:-128000}"
    MODEL_AUTO_COMPACT_TOKEN_LIMIT="${TEMPERANCE_OMNIROUTE_AUTO_COMPACT_TOKEN_LIMIT:-108000}"
    ;;
  *)
    MODEL_CONTEXT_WINDOW="${TEMPERANCE_OMNIROUTE_MODEL_CONTEXT_WINDOW:-200000}"
    MODEL_AUTO_COMPACT_TOKEN_LIMIT="${TEMPERANCE_OMNIROUTE_AUTO_COMPACT_TOKEN_LIMIT:-170000}"
    ;;
esac
[[ "$MODEL_CONTEXT_WINDOW" =~ ^[1-9][0-9]*$ ]] || {
  echo "invalid TEMPERANCE_OMNIROUTE_MODEL_CONTEXT_WINDOW" >&2
  exit 2
}
[[ "$MODEL_AUTO_COMPACT_TOKEN_LIMIT" =~ ^[1-9][0-9]*$ ]] || {
  echo "invalid TEMPERANCE_OMNIROUTE_AUTO_COMPACT_TOKEN_LIMIT" >&2
  exit 2
}
(( MODEL_AUTO_COMPACT_TOKEN_LIMIT < MODEL_CONTEXT_WINDOW )) || {
  echo "OmniRoute auto-compact limit must be below the model context window" >&2
  exit 2
}

args=(
  exec
  -m "$MODEL"
  -c 'model_provider="omniroute"'
  -c 'model_providers.omniroute.name="OmniRoute"'
  -c "model_providers.omniroute.base_url=\"$BASE_URL\""
  -c 'model_providers.omniroute.env_key="OMNIROUTE_API_KEY"'
  -c "model_providers.omniroute.wire_api=\"$WIRE_API\""
  -c 'model_providers.omniroute.requires_openai_auth=false'
  -c "model_context_window=$MODEL_CONTEXT_WINDOW"
  -c "model_auto_compact_token_limit=$MODEL_AUTO_COMPACT_TOKEN_LIMIT"
  -c 'approval_policy="never"'
  --sandbox "$CODEX_SANDBOX"
  --ephemeral
  --skip-git-repo-check
  --color never
)

if [[ -n "$CORRELATION_ID" || -n "$SESSION_TAG" ]]; then
  http_header_pairs=()
  [[ -z "$CORRELATION_ID" ]] || http_header_pairs+=("\"X-Temperance-Correlation-ID\"=\"$CORRELATION_ID\"" "\"x-request-id\"=\"$CORRELATION_ID\"")
  [[ -z "$SESSION_TAG" ]] || http_header_pairs+=("\"x-omniroute-session-id\"=\"$SESSION_TAG\"")
  http_headers_toml="$(IFS=,; echo "${http_header_pairs[*]}")"
  args+=(-c "model_providers.omniroute.http_headers={${http_headers_toml}}")
fi

# OmniRoute's profile generator writes this file from the live catalog. The
# inline provider flags above keep the backend portable when the profile is not
# installed, while loading it when present preserves its model limits.
if [[ "$MODEL" == "$CODEX_PROFILE" && -f "${CODEX_HOME:-$HOME/.codex}/$CODEX_PROFILE.config.toml" ]]; then
  args+=(--profile "$CODEX_PROFILE")
fi
if [[ "${TEMPERANCE_OMNIROUTE_CODEX_ISOLATED:-}" == "0" ]]; then
  echo "warning: TEMPERANCE_OMNIROUTE_CODEX_ISOLATED=0 disables Codex user-config isolation" >&2
else
  args+=(--ignore-user-config)
fi

# Optional per-invocation reduction for text/shell workers. The installed CLI's
# `features list` declares these flags; no user configuration is rewritten.
# This does not promise isolation from separately configured project MCP servers.
# Preserve shell tools, sandbox, execpolicy rules, hooks and hook trust.
TOOL_SURFACE="${TEMPERANCE_OMNIROUTE_CODEX_TOOL_SURFACE:-default}"
case "$TOOL_SURFACE" in
  default) ;;
  local)
    for feature in apps plugins browser_use browser_use_external browser_use_full_cdp_access computer_use image_generation multi_agent multi_agent_v2; do
      args+=(--disable "$feature")
    done
    args+=(-c 'web_search="disabled"')
    ;;
  *) echo "invalid TEMPERANCE_OMNIROUTE_CODEX_TOOL_SURFACE (expected default or local)" >&2; exit 2 ;;
esac

# ROOT_URL is validated by the router's /v1/models probe before dispatch. Keep
# it in the environment for diagnostics without duplicating a second network
# preflight on every parallel task.
#
# An empty final message alone cannot identify a gateway failure. Retrying can
# replay tool effects, so successful empty exits require explicit idempotency
# opt-in. This starts a fresh turn, not a durable continuation. Nonzero exits preserve the original
# failure immediately, without replaying potentially completed tool effects.
# A nonempty final message proves transport completion, not task acceptance.
MAX_ATTEMPTS="${TEMPERANCE_OMNIROUTE_MAX_ATTEMPTS:-4}"
[[ "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || {
  echo "invalid TEMPERANCE_OMNIROUTE_MAX_ATTEMPTS" >&2
  exit 2
}
RETRY_EMPTY="${TEMPERANCE_OMNIROUTE_RETRY_EMPTY:-0}"
[[ "$RETRY_EMPTY" == "0" || "$RETRY_EMPTY" == "1" ]] || {
  echo "invalid TEMPERANCE_OMNIROUTE_RETRY_EMPTY (expected 0 or 1)" >&2
  exit 2
}

LAST_MESSAGE_FILE="$(mktemp)"
STDERR_FILE="$(mktemp)"
cleanup() { rm -f "$LAST_MESSAGE_FILE" "$STDERR_FILE"; }
trap cleanup EXIT

attempt=1
while (( attempt <= MAX_ATTEMPTS )); do
  : > "$LAST_MESSAGE_FILE"
  OMNIROUTE_BASE_URL="$ROOT_URL" OMNIROUTE_API_KEY="$GATEWAY_AUTH" \
    codex "${args[@]}" -o "$LAST_MESSAGE_FILE" -- "$TASK" </dev/null 2>"$STDERR_FILE"
  codex_exit=$?

  if (( codex_exit != 0 )); then
    FAILURE_REASON="codex_nonzero_exit"
    if grep -Eqi 'request\.tools|function_declarations' "$STDERR_FILE" && \
       grep -Eqi 'schema|invalid (value|argument)' "$STDERR_FILE"; then
      FAILURE_REASON="tool_schema_rejected"
    fi
    echo "error: omniroute attempt $attempt/$MAX_ATTEMPTS failed ($FAILURE_REASON; Codex exit $codex_exit)" >&2
    cat "$STDERR_FILE" >&2
    exit "$codex_exit"
  fi

  if [[ -s "$LAST_MESSAGE_FILE" ]]; then
    cat "$LAST_MESSAGE_FILE"
    exit 0
  fi

  cat "$STDERR_FILE" >&2
  if [[ "$RETRY_EMPTY" != "1" ]]; then
    FAILURE_REASON="empty_output_retry_not_authorized"
    echo "error: omniroute returned no final message; tool effects may already exist, so a fresh-turn retry requires explicit idempotency opt-in" >&2
    exit 1
  fi
  if (( attempt == MAX_ATTEMPTS )); then
    FAILURE_REASON="empty_output_exhausted"
    echo "error: omniroute produced no final message after $MAX_ATTEMPTS successful CLI exits; cause unconfirmed" >&2
    exit 1
  fi
  echo "warning: omniroute attempt $attempt/$MAX_ATTEMPTS returned no final message with exit 0 — retrying" >&2
  attempt=$((attempt + 1))
done

exit 1
