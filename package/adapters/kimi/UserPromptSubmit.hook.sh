#!/usr/bin/env bash
# UserPromptSubmit.hook.sh -- Kimi surface adapter for the Temperance enrichment core.
#
# Kimi's hook runner honors block/allow only: stdout is parsed solely for a
# permissionDecision and additionalContext is never injected, so enrichment for
# the kimi surface happens server-side in temperance-openai-proxy instead. This
# hook is the client half of that seam:
#   1. It records the session's cwd in a sidecar the relay reads to resolve
#      project context (ISA/.planning) for enrichment.
#   2. It appends a telemetry line to the shared mode-classifier observability
#      log so kimi prompts are visible alongside claude/codex/opencode.
#
# Contract: ALWAYS exit 0 with EMPTY stdout. Exit 2 would block the user's
# prompt; any JSON on stdout risks being parsed as a decision. Every failure
# path below degrades to "do nothing".
#
# Install (wire-multi-backend.sh / configure-kimi-relay.sh copies, not symlinks,
# so the hook survives the repo volume unmounting):
#   ~/.kimi/hooks/temperance-user-prompt-submit.sh
# Registered in ~/.kimi/config.toml:
#   hooks = [{ event = "UserPromptSubmit", command = "$HOME/.kimi/hooks/temperance-user-prompt-submit.sh", timeout = 10 }]

set -u

STATE_DIR="${TEMPERANCE_KIMI_STATE:-$HOME/.temperance_engine/kimi}"
SIDECAR="$STATE_DIR/session-context.json"
TELEMETRY_DIR="$HOME/.claude/MEMORY/OBSERVABILITY"
SCHEMA="temperance-kimi-session-v1"

payload="$(cat 2>/dev/null || true)"

command -v jq >/dev/null 2>&1 || exit 0
[ -n "$payload" ] || exit 0

session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null || true)"
cwd="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true)"
prompt="$(printf '%s' "$payload" | jq -r '.prompt // empty' 2>/dev/null || true)"
[ -n "$cwd" ] || exit 0

# Advisory prompt hash: first 16 hex chars of sha256 over the trimmed prompt,
# matching the relay's latestUserPrompt() normalization (kimi prompts carry no
# <temperance-context> blocks, so trim is the only transform that matters).
trimmed_prompt="$(printf '%s' "$prompt" | awk 'BEGIN{RS="^$"} {gsub(/^[[:space:]]+|[[:space:]]+$/,""); printf "%s", $0}' 2>/dev/null || true)"
prompt_hash=""
if command -v shasum >/dev/null 2>&1; then
  prompt_hash="$(printf '%s' "$trimmed_prompt" | shasum -a 256 2>/dev/null | cut -c1-16 || true)"
elif command -v sha256sum >/dev/null 2>&1; then
  prompt_hash="$(printf '%s' "$trimmed_prompt" | sha256sum 2>/dev/null | cut -c1-16 || true)"
fi

ts_ms="$(( $(date +%s 2>/dev/null || echo 0) * 1000 ))"

if mkdir -p "$STATE_DIR" 2>/dev/null; then
  tmp="$(mktemp "$STATE_DIR/.session-context.XXXXXX" 2>/dev/null || true)"
  if [ -n "$tmp" ]; then
    if jq -nc \
      --arg schema "$SCHEMA" \
      --arg session_id "$session_id" \
      --arg cwd "$cwd" \
      --arg prompt_hash "$prompt_hash" \
      --argjson ts "$ts_ms" \
      '{schema_version: $schema, session_id: $session_id, cwd: $cwd, ts: $ts, prompt_hash: $prompt_hash}' \
      >"$tmp" 2>/dev/null; then
      chmod 600 "$tmp" 2>/dev/null || true
      mv -f "$tmp" "$SIDECAR" 2>/dev/null || rm -f "$tmp" 2>/dev/null || true
    else
      rm -f "$tmp" 2>/dev/null || true
    fi
  fi
fi

if mkdir -p "$TELEMETRY_DIR" 2>/dev/null; then
  jq -nc \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" \
    --arg prompt_excerpt "$(printf '%s' "$trimmed_prompt" | cut -c1-200)" \
    '{timestamp: $timestamp, prompt_excerpt: $prompt_excerpt, source: "temperance-kimi-hook", surface: "kimi"}' \
    >>"$TELEMETRY_DIR/mode-classifier.jsonl" 2>/dev/null || true
fi

exit 0
