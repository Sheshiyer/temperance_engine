#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/.local/bin" "$TMP/.claude/PAI/enrich" "$TMP/.claude/PAI/router" \
  "$TMP/.claude/hooks" "$TMP/.codex/hooks" "$TMP/.config/opencode/plugins" \
  "$TMP/.config/opencode" "$TMP/.temperance_engine/relay"
printf '%s\n' 'fixture' >"$TMP/.claude/PAI/enrich/index.ts"
printf '%s\n' 'fixture' >"$TMP/.claude/PAI/router/classify-task.sh"
printf '%s\n' 'fixture' >"$TMP/.claude/PAI/router/omniroute-portfolios.ts"
printf '%s\n' '{}' >"$TMP/.claude/PAI/router/omniroute-portfolios.json"
printf '%s\n' 'TEMPERANCE_ENRICH_DIR' >"$TMP/.claude/hooks/PromptProcessing.hook.ts"
printf '%s\n' 'PAI/enrich' >"$TMP/.codex/hooks/PromptProcessing.hook.ts"
printf '%s\n' 'plugin' >"$TMP/.config/opencode/plugins/temperance-flow.ts"
printf '%s\n' 'plugin' >"$TMP/.config/opencode/plugins/omniroute-catalog-guard.ts"
for name in temperance-route temperance-dispatch temperance-batch; do printf '%s\n' 'bin' >"$TMP/.local/bin/$name"; done
cat >"$TMP/.config/opencode/opencode.json" <<'JSON'
{
  "provider": {
    "omniroute": {"options": {"baseURL": "http://127.0.0.1:20128/v1"}},
    "temperance": {
      "options": {"baseURL": "http://127.0.0.1:20129/v1"},
      "models": {"temperance-auto": {"name": "Automatic"}}
    }
  }
}
JSON
cat >"$TMP/.temperance_engine/relay/opencode-provider.json" <<'JSON'
{"schema_version":"temperance-opencode-relay-v1","managed":true,"provider":"temperance","model":"temperance-auto","base_url":"http://127.0.0.1:20129/v1"}
JSON

export HOME="$TMP"
export OPENCODE_HOME="$TMP/.config/opencode"
export TEMPERANCE_STATE_DIR="$TMP/.temperance_engine"
PATH="$TMP/.local/bin:$PATH" "$ROOT/scripts/temperance-doctor.sh" --json --no-network >"$TMP/direct.json"
jq -e '.direct_ready == true and .automatic_ready == false and .checks.direct_provider.ok == true' "$TMP/direct.json" >/dev/null
echo "ok - doctor reports direct readiness without network"

if PATH="$TMP/.local/bin:$PATH" "$ROOT/scripts/temperance-doctor.sh" --require-auto --no-network >/dev/null 2>&1; then
  echo "FAIL - doctor accepted automatic routing without relay" >&2
  exit 1
fi
echo "ok - doctor rejects automatic readiness without relay"

# ── Kimi lane: opt-in aggregate, exit-code semantics ────────────────────────
mkdir -p "$TMP/.kimi/hooks" "$TMP/.kimi/skills/temperance-engine" "$TMP/.kimi/skills/temperance-parallel-dispatch"
printf '%s\n' 'skill' >"$TMP/.kimi/skills/temperance-engine/SKILL.md"
printf '%s\n' 'skill' >"$TMP/.kimi/skills/temperance-parallel-dispatch/SKILL.md"
printf '%s\n' '#!/usr/bin/env bash' 'echo kimi 9.9.9' >"$TMP/.local/bin/kimi"
chmod +x "$TMP/.local/bin/kimi"
cat >"$TMP/.local/bin/curl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' '{"ok":true,"service":"temperance-openai-proxy","automatic_model":"temperance-auto","enrichment_surfaces":["kimi"]}'
SH
chmod +x "$TMP/.local/bin/curl"
KIMI_HOOK="$TMP/.kimi/hooks/temperance-user-prompt-submit.sh"
printf '%s\n' '# temperance-kimi-session-v1 sidecar hook fixture' >"$KIMI_HOOK"
cat >"$TMP/.kimi/config.toml" <<TOML
default_model = "kimi-code/kimi-for-coding"
hooks = [{ event = "UserPromptSubmit", command = "$KIMI_HOOK", timeout = 10 }]  # temperance:managed-hook
# --- temperance:managed:start (temperance-kimi-relay-v1) ---
[providers.temperance]
type = "openai_legacy"
base_url = "http://127.0.0.1:20129/v1"
api_key = "temperance-local"

[providers.temperance.custom_headers]
X-Temperance-Surface = "kimi"

[models."temperance/temperance-auto"]
provider = "temperance"
model = "temperance-auto"
max_context_size = 200000
# --- temperance:managed:end ---
TOML
cat >"$TMP/.temperance_engine/relay/kimi-provider.json" <<JSON
{"schema_version":"temperance-kimi-relay-v1","managed":true,"provider":"temperance","model":"temperance/temperance-auto","base_url":"http://127.0.0.1:20129/v1","hook":"managed","hook_path":"$KIMI_HOOK","hooks_line_original":"hooks = []","previous_default_model":"","config_path":"$TMP/.kimi/config.toml"}
JSON

export KIMI_HOME="$TMP/.kimi"
PATH="$TMP/.local/bin:$PATH" "$ROOT/scripts/temperance-doctor.sh" --json >"$TMP/kimi.json"
jq -e '.kimi_ready == true and .direct_ready == true and .checks.kimi_provider.ok == true and .checks.relay_enrichment.ok == true' "$TMP/kimi.json" >/dev/null
echo "ok - doctor reports kimi readiness with full fixture"

rm -f "$KIMI_HOOK"
PATH="$TMP/.local/bin:$PATH" "$ROOT/scripts/temperance-doctor.sh" --json >"$TMP/kimi-degraded.json"
jq -e '.kimi_ready == false and .direct_ready == true' "$TMP/kimi-degraded.json" >/dev/null
echo "ok - broken kimi lane never affects direct readiness"

if PATH="$TMP/.local/bin:$PATH" "$ROOT/scripts/temperance-doctor.sh" --require-kimi >/dev/null 2>&1; then
  echo "FAIL - doctor accepted --require-kimi with a broken kimi lane" >&2
  exit 1
fi
echo "ok - --require-kimi folds kimi_ready into the exit gate"
