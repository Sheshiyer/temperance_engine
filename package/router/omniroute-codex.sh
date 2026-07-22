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

args=(
  exec
  -m "$MODEL"
  -c 'model_provider="omniroute"'
  -c 'model_providers.omniroute.name="OmniRoute"'
  -c "model_providers.omniroute.base_url=\"$BASE_URL\""
  -c 'model_providers.omniroute.env_key="OMNIROUTE_API_KEY"'
  -c "model_providers.omniroute.wire_api=\"$WIRE_API\""
  -c 'model_providers.omniroute.requires_openai_auth=false'
  -c 'model_context_window=200000'
  -c 'model_auto_compact_token_limit=170000'
  -c 'approval_policy="never"'
  --sandbox "$CODEX_SANDBOX"
  --ephemeral
  --skip-git-repo-check
  --color never
)

# OmniRoute's profile generator writes this file from the live catalog. The
# inline provider flags above keep the backend portable when the profile is not
# installed, while loading it when present preserves its model limits.
if [[ -f "${CODEX_HOME:-$HOME/.codex}/$CODEX_PROFILE.config.toml" ]]; then
  args+=(--profile "$CODEX_PROFILE")
fi
if [[ "${TEMPERANCE_OMNIROUTE_CODEX_ISOLATED:-0}" == "1" ]]; then
  args+=(--ignore-user-config)
fi

# ROOT_URL is validated by the router's /v1/models probe before dispatch. Keep
# it in the environment for diagnostics without duplicating a second network
# preflight on every parallel task.
OMNIROUTE_BASE_URL="$ROOT_URL" OMNIROUTE_API_KEY="$GATEWAY_AUTH" \
  codex "${args[@]}" -- "$TASK" </dev/null
