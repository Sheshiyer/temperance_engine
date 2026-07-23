#!/usr/bin/env bash
# Read-only readiness report for the Claude, Codex, OpenCode, and Kimi surfaces.

set -euo pipefail

OPENCODE_HOME="${OPENCODE_HOME:-${HOME}/.config/opencode}"
OPENCODE_CONFIG="${TEMPERANCE_OPENCODE_CONFIG:-${OPENCODE_HOME}/opencode.json}"
STATE_PATH="${TEMPERANCE_STATE_DIR:-${HOME}/.temperance_engine}/relay/opencode-provider.json"
KIMI_HOME="${KIMI_HOME:-${HOME}/.kimi}"
KIMI_CONFIG="${TEMPERANCE_KIMI_CONFIG:-${KIMI_HOME}/config.toml}"
KIMI_STATE_PATH="${TEMPERANCE_STATE_DIR:-${HOME}/.temperance_engine}/relay/kimi-provider.json"
KIMI_DESKTOP_CONFIG="${TEMPERANCE_KIMI_DESKTOP_CONFIG:-${HOME}/Library/Application Support/kimi-desktop/daimon-share/config.toml}"
KIMI_DESKTOP_STATE_PATH="${TEMPERANCE_STATE_DIR:-${HOME}/.temperance_engine}/relay/kimi-desktop-provider.json"
OMNI_BASE="${TEMPERANCE_OMNIROUTE_BASE_URL:-http://127.0.0.1:20128/v1}"
RELAY_BASE="${TEMPERANCE_PROXY_BASE_URL:-http://127.0.0.1:20129/v1}"
JSON_MODE=false
REQUIRE_AUTO=false
REQUIRE_KIMI=false
SKIP_NETWORK=false

for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=true ;;
    --require-auto) REQUIRE_AUTO=true ;;
    --require-kimi) REQUIRE_KIMI=true ;;
    --no-network) SKIP_NETWORK=true ;;
    -h|--help)
      echo "Usage: temperance-doctor.sh [--json] [--require-auto] [--require-kimi] [--no-network]"
      echo ""
      echo "Exit code follows direct_ready; --require-auto adds the relay lane and"
      echo "--require-kimi adds the opt-in Kimi CLI lane (kimi_ready) to the gate."
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 127; }

declare -A result detail
set_check() {
  local key="$1" ok="$2" message="$3"
  result["$key"]="$ok"
  detail["$key"]="$message"
}

check_path() {
  local key="$1" path="$2"
  if [[ -e "$path" || -L "$path" ]]; then
    set_check "$key" true "present"
  else
    set_check "$key" false "missing"
  fi
}

check_path "router" "$HOME/.local/bin/temperance-route"
check_path "dispatch" "$HOME/.local/bin/temperance-dispatch"
check_path "batch" "$HOME/.local/bin/temperance-batch"
check_path "enrichment" "$HOME/.claude/PAI/enrich/index.ts"
check_path "classifier" "$HOME/.claude/PAI/router/classify-task.sh"
check_path "portfolio_resolver" "$HOME/.claude/PAI/router/omniroute-portfolios.ts"
check_path "portfolio_manifest" "$HOME/.claude/PAI/router/omniroute-portfolios.json"
check_path "claude_hook" "$HOME/.claude/hooks/PromptProcessing.hook.ts"
check_path "codex_hook" "$HOME/.codex/hooks/PromptProcessing.hook.ts"
check_path "opencode_config" "$OPENCODE_CONFIG"
check_path "opencode_flow" "$OPENCODE_HOME/plugins/temperance-flow.ts"
check_path "opencode_guard" "$OPENCODE_HOME/plugins/omniroute-catalog-guard.ts"

if [[ -f "$HOME/.claude/hooks/PromptProcessing.hook.ts" ]] && grep -q 'TEMPERANCE_ENRICH_DIR\|PAI/enrich' "$HOME/.claude/hooks/PromptProcessing.hook.ts"; then
  set_check "claude_hook_contract" true "shared enrichment adapter"
else
  set_check "claude_hook_contract" false "shared enrichment adapter not detected"
fi
if [[ -f "$HOME/.codex/hooks/PromptProcessing.hook.ts" ]] && grep -q 'TEMPERANCE_ENRICH_DIR\|PAI/enrich' "$HOME/.codex/hooks/PromptProcessing.hook.ts"; then
  set_check "codex_hook_contract" true "shared enrichment adapter"
else
  set_check "codex_hook_contract" false "shared enrichment adapter not detected"
fi

direct_base=""
auto_provider=""
auto_model=false
if [[ -f "$OPENCODE_CONFIG" ]] && jq -e . "$OPENCODE_CONFIG" >/dev/null 2>&1; then
  direct_base="$(jq -r '.provider.omniroute.options.baseURL // empty' "$OPENCODE_CONFIG")"
  auto_provider="$(jq -r '.provider.temperance.options.baseURL // empty' "$OPENCODE_CONFIG")"
  if jq -e '.provider.temperance.models["temperance-auto"] != null' "$OPENCODE_CONFIG" >/dev/null 2>&1; then
    auto_model=true
  fi
  if [[ "$direct_base" == "$OMNI_BASE" ]]; then
    set_check "direct_provider" true "$direct_base"
  else
    set_check "direct_provider" false "expected $OMNI_BASE, found ${direct_base:-missing}"
  fi
else
  set_check "direct_provider" false "invalid or missing OpenCode config"
fi

relay_ok=false
relay_auto=false
if ! $SKIP_NETWORK; then
  health="$(curl -fsS --connect-timeout 1 --max-time 3 "${RELAY_BASE%/v1}/health" 2>/dev/null || true)"
  if [[ -n "$health" ]] && jq -e '.service == "temperance-openai-proxy"' <<<"$health" >/dev/null 2>&1; then
    relay_ok=true
    if [[ "$(jq -r '.automatic_model // empty' <<<"$health")" == "temperance-auto" ]]; then relay_auto=true; fi
  fi
fi
set_check "relay_health" "$relay_ok" "$([[ "$relay_ok" == true ]] && echo "$RELAY_BASE" || echo "unavailable")"
set_check "relay_alias" "$relay_auto" "$([[ "$relay_auto" == true ]] && echo "temperance-auto advertised" || echo "not advertised")"

if [[ "$auto_provider" == "$RELAY_BASE" && "$auto_model" == true ]]; then
  set_check "automatic_config" true "temperance/temperance-auto"
else
  set_check "automatic_config" false "provider or model missing"
fi

state_ok=false
if [[ -f "$STATE_PATH" ]] && jq -e --arg provider "temperance" --arg base "$RELAY_BASE" \
  '.schema_version == "temperance-opencode-relay-v1" and .managed == true and .provider == $provider and .model == "temperance-auto" and .base_url == $base' "$STATE_PATH" >/dev/null 2>&1; then
  state_ok=true
fi
set_check "relay_state" "$state_ok" "$([[ "$state_ok" == true ]] && echo managed || echo missing-or-stale)"

# ── Kimi surface (opt-in lane; excluded from direct_ready) ──────────────────
if command -v kimi >/dev/null 2>&1 && kimi --version >/dev/null 2>&1; then
  set_check "kimi_cli" true "$(kimi --version 2>/dev/null | head -n1)"
else
  # A present-but-broken binary (e.g. stale uv venv python) fails here too.
  set_check "kimi_cli" false "kimi missing or not runnable"
fi
check_path "kimi_config" "$KIMI_CONFIG"

# Semantic check, not marker-based: kimi-cli rewrites config.toml in its own
# canonical serialization and drops comments (incl. managed-block markers).
if [[ -f "$KIMI_CONFIG" ]] && grep -Fq '[providers.temperance]' "$KIMI_CONFIG" \
  && grep -Fq "base_url = \"${RELAY_BASE}\"" "$KIMI_CONFIG" \
  && grep -Fq '[models."temperance/temperance-auto"]' "$KIMI_CONFIG"; then
  set_check "kimi_provider" true "temperance provider at $RELAY_BASE"
else
  set_check "kimi_provider" false "temperance provider/model tables not found"
fi
if [[ -f "$KIMI_CONFIG" ]] && grep -Fq 'X-Temperance-Surface = "kimi"' "$KIMI_CONFIG"; then
  set_check "kimi_surface_header" true "surface header configured"
else
  set_check "kimi_surface_header" false "X-Temperance-Surface header missing"
fi

kimi_hook_path="$KIMI_HOME/hooks/temperance-user-prompt-submit.sh"
if [[ -f "$KIMI_STATE_PATH" ]]; then
  state_hook_path="$(jq -r '.hook_path // empty' "$KIMI_STATE_PATH" 2>/dev/null || true)"
  [[ -n "$state_hook_path" ]] && kimi_hook_path="$state_hook_path"
fi
if [[ -f "$kimi_hook_path" ]] && grep -q "temperance-kimi-session-v1" "$kimi_hook_path" \
  && [[ -f "$KIMI_CONFIG" ]] && grep -Fq "$kimi_hook_path" "$KIMI_CONFIG"; then
  set_check "kimi_hook" true "sidecar hook installed and registered"
else
  set_check "kimi_hook" false "hook missing, stale, or unregistered"
fi

kimi_state_ok=false
if [[ -f "$KIMI_STATE_PATH" ]] && jq -e --arg base "$RELAY_BASE" \
  '.schema_version == "temperance-kimi-relay-v1" and .managed == true and .provider == "temperance" and .base_url == $base' "$KIMI_STATE_PATH" >/dev/null 2>&1; then
  kimi_state_ok=true
fi
set_check "kimi_state" "$kimi_state_ok" "$([[ "$kimi_state_ok" == true ]] && echo managed || echo missing-or-stale)"

kimi_skills_ok=true
for skill in temperance-engine temperance-parallel-dispatch; do
  [[ -e "$KIMI_HOME/skills/$skill/SKILL.md" ]] || kimi_skills_ok=false
done
set_check "kimi_skills" "$kimi_skills_ok" "$([[ "$kimi_skills_ok" == true ]] && echo "skill links resolve" || echo "links missing or target unmounted")"

relay_kimi_enrichment=false
if ! $SKIP_NETWORK && [[ -n "${health:-}" ]] \
  && jq -e '(.enrichment_surfaces // []) | index("kimi") != null' <<<"$health" >/dev/null 2>&1; then
  relay_kimi_enrichment=true
fi
set_check "relay_enrichment" "$relay_kimi_enrichment" "$([[ "$relay_kimi_enrichment" == true ]] && echo "kimi enrichment advertised" || echo "not advertised")"

# ── Kimi desktop (informational; never gates the exit code) ─────────────────
check_path "kimi_desktop_config" "$KIMI_DESKTOP_CONFIG"
kimi_desktop_state_ok=false
if [[ -f "$KIMI_DESKTOP_STATE_PATH" ]] && jq -e --arg base "$RELAY_BASE" \
  '.schema_version == "temperance-kimi-desktop-relay-v1" and .managed == true and .base_url == $base' "$KIMI_DESKTOP_STATE_PATH" >/dev/null 2>&1; then
  kimi_desktop_state_ok=true
fi
set_check "kimi_desktop_state" "$kimi_desktop_state_ok" "$([[ "$kimi_desktop_state_ok" == true ]] && echo managed || echo missing-or-stale)"

# Drift is warn-level: false only when a recorded sha no longer matches (the
# app likely regenerated its config; re-run configure-kimi-desktop-relay.sh).
kimi_desktop_drift_ok=true
kimi_desktop_drift_msg="n/a"
if [[ "$kimi_desktop_state_ok" == true && -f "$KIMI_DESKTOP_CONFIG" ]]; then
  recorded_sha="$(jq -r '.config_sha256 // empty' "$KIMI_DESKTOP_STATE_PATH" 2>/dev/null || true)"
  if [[ -n "$recorded_sha" ]]; then
    if command -v shasum >/dev/null 2>&1; then
      current_sha="$(shasum -a 256 "$KIMI_DESKTOP_CONFIG" | cut -d' ' -f1)"
    else
      current_sha="$(sha256sum "$KIMI_DESKTOP_CONFIG" 2>/dev/null | cut -d' ' -f1 || true)"
    fi
    if [[ "$current_sha" == "$recorded_sha" ]]; then
      kimi_desktop_drift_msg="no drift"
    else
      kimi_desktop_drift_ok=false
      kimi_desktop_drift_msg="config changed since enable (app update?); re-run configure-kimi-desktop-relay.sh"
    fi
  fi
fi
set_check "kimi_desktop_drift" "$kimi_desktop_drift_ok" "$kimi_desktop_drift_msg"

direct_ready=true
for key in router dispatch batch enrichment classifier portfolio_resolver portfolio_manifest claude_hook codex_hook opencode_config opencode_flow opencode_guard claude_hook_contract codex_hook_contract direct_provider; do
  [[ "${result[$key]:-false}" == true ]] || direct_ready=false
done
automatic_ready="$direct_ready"
for key in relay_health relay_alias automatic_config relay_state; do
  [[ "${result[$key]:-false}" == true ]] || automatic_ready=false
done
# Kimi is an opt-in lane: kimi_ready never affects direct_ready and gates the
# exit code only under --require-kimi. Desktop checks stay informational.
kimi_ready=true
for key in kimi_cli kimi_config kimi_provider kimi_surface_header kimi_hook kimi_state kimi_skills relay_health relay_enrichment; do
  [[ "${result[$key]:-false}" == true ]] || kimi_ready=false
done

if $JSON_MODE; then
  checks='{}'
  for key in "${!result[@]}"; do
    checks="$(jq -c --arg key "$key" --argjson ok "${result[$key]}" --arg message "${detail[$key]}" '. + {($key):{ok:$ok,message:$message}}' <<<"$checks")"
  done
  jq -n --argjson checks "$checks" --argjson direct "$direct_ready" --argjson automatic "$automatic_ready" \
    --argjson kimi "$kimi_ready" --argjson required "$REQUIRE_AUTO" --argjson required_kimi "$REQUIRE_KIMI" \
    '{schema_version:"temperance-doctor-v1",direct_ready:$direct,automatic_ready:$automatic,kimi_ready:$kimi,required_automatic:$required,required_kimi:$required_kimi,checks:$checks}'
else
  echo "Temperance Engine doctor"
  echo "  direct_ready=$direct_ready"
  echo "  automatic_ready=$automatic_ready"
  echo "  kimi_ready=$kimi_ready"
  for key in "${!result[@]}"; do
    printf '  %-24s %s (%s)\n' "$key" "${result[$key]}" "${detail[$key]}"
  done | sort
fi

exit_gate="$direct_ready"
$REQUIRE_AUTO && [[ "$automatic_ready" != true ]] && exit_gate=false
$REQUIRE_KIMI && [[ "$kimi_ready" != true ]] && exit_gate=false
$exit_gate
