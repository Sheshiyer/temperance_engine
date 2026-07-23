#!/usr/bin/env bash
# Sandbox lifecycle test for scripts/configure-kimi-relay.sh: managed-block
# enable, hooks-line rewrite, idempotency, collision guard, and byte-identical
# disable restore. No live kimi, relay, or network involved.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0
check() { if [[ "$2" == "$3" ]]; then echo "ok - $1"; else echo "FAIL - $1: exp[$2] got[$3]"; fail=1; fi; }

mkdir -p "$TMP/home/.kimi" "$TMP/bin"
cat >"$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' '{"ok":true,"service":"temperance-openai-proxy","automatic_model":"temperance-auto","enrichment_surfaces":["kimi"]}'
SH
chmod +x "$TMP/bin/curl"

cat >"$TMP/home/.kimi/config.toml" <<'TOML'
# user comment that must survive the managed lifecycle
default_model = "kimi-code/kimi-for-coding"
hooks = []
merge_all_available_skills = true

[providers.managed-kimi-code]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"
api_key = "USER-SECRET"
TOML
cp "$TMP/home/.kimi/config.toml" "$TMP/original.toml"

export HOME="$TMP/home"
export KIMI_HOME="$TMP/home/.kimi"
export TEMPERANCE_STATE_DIR="$TMP/home/.temperance_engine"
export TEMPERANCE_BACKUP_DIR="$TMP/home/.temperance_engine/backups"
export PATH="$TMP/bin:$PATH"
CONFIG="$KIMI_HOME/config.toml"
STATE="$TEMPERANCE_STATE_DIR/relay/kimi-provider.json"

# ── enable ──────────────────────────────────────────────────────────────────
"$ROOT/scripts/configure-kimi-relay.sh" enable >/dev/null
check "single managed block" "1" "$(grep -c 'temperance:managed:start' "$CONFIG")"
check "surface header present" "1" "$(grep -c 'X-Temperance-Surface = "kimi"' "$CONFIG")"
check "model table present" "1" "$(grep -c '^\[models."temperance/temperance-auto"\]' "$CONFIG")"
check "user comment survives" "1" "$(grep -c '^# user comment that must survive' "$CONFIG")"
check "default_model untouched" "1" "$(grep -c '^default_model = "kimi-code/kimi-for-coding"$' "$CONFIG")"
check "hooks line rewritten" "1" "$(grep -c '^hooks = \[{ event = "UserPromptSubmit"' "$CONFIG")"
check "config mode 600" "600" "$(stat -f '%Lp' "$CONFIG" 2>/dev/null || stat -c '%a' "$CONFIG")"
test -x "$KIMI_HOME/hooks/temperance-user-prompt-submit.sh" && echo "ok - hook copy installed" || { echo "FAIL - hook copy missing"; fail=1; }
jq -e '.schema_version == "temperance-kimi-relay-v1" and .managed == true and .hooks_line_original == "hooks = []"' "$STATE" >/dev/null \
  && echo "ok - state marker records original hooks line" || { echo "FAIL - state marker wrong"; fail=1; }
find "$TEMPERANCE_BACKUP_DIR" -type f -name config.toml | grep -q . && echo "ok - backup written" || { echo "FAIL - no backup"; fail=1; }

# ── idempotent re-enable keeps one block and the recorded original ──────────
"$ROOT/scripts/configure-kimi-relay.sh" enable >/dev/null
check "re-enable single block" "1" "$(grep -c 'temperance:managed:start' "$CONFIG")"
jq -e '.hooks_line_original == "hooks = []"' "$STATE" >/dev/null \
  && echo "ok - re-enable preserves recorded original" || { echo "FAIL - original clobbered"; fail=1; }

# ── set-default records and applies ─────────────────────────────────────────
"$ROOT/scripts/configure-kimi-relay.sh" enable --set-default >/dev/null
check "default_model managed" "1" "$(grep -c '^default_model = "temperance/temperance-auto"' "$CONFIG")"
jq -e '.previous_default_model == "default_model = \"kimi-code/kimi-for-coding\""' "$STATE" >/dev/null \
  && echo "ok - previous default recorded" || { echo "FAIL - previous default missing"; fail=1; }

# ── disable restores byte-identical ─────────────────────────────────────────
"$ROOT/scripts/configure-kimi-relay.sh" disable >/dev/null
cmp -s "$TMP/original.toml" "$CONFIG" && echo "ok - disable restores byte-identical" || { echo "FAIL - restore differs"; diff "$TMP/original.toml" "$CONFIG" | head -5; fail=1; }
test ! -e "$STATE" && echo "ok - state marker removed" || { echo "FAIL - state marker remains"; fail=1; }
test ! -e "$KIMI_HOME/hooks/temperance-user-prompt-submit.sh" && echo "ok - hook copy removed" || { echo "FAIL - hook copy remains"; fail=1; }

# ── collision guard: user-authored provider aborts enable ───────────────────
cat >>"$CONFIG" <<'TOML'

[providers.temperance]
type = "openai_legacy"
base_url = "http://example.invalid/v1"
api_key = "user-owned"
TOML
cp "$CONFIG" "$TMP/collision.toml"
if "$ROOT/scripts/configure-kimi-relay.sh" enable >/dev/null 2>&1; then
  echo "FAIL - collision enable should exit non-zero"; fail=1
else
  echo "ok - collision guard refuses user-authored provider"
fi
cmp -s "$TMP/collision.toml" "$CONFIG" && echo "ok - collision leaves config untouched" || { echo "FAIL - collision mutated config"; fail=1; }

# ── foreign hooks shape: provider still lands, hook goes manual ─────────────
cat >"$CONFIG" <<'TOML'
default_model = "kimi-code/kimi-for-coding"
hooks = [{ event = "Stop", command = "/usr/local/bin/user-hook.sh" }]
TOML
"$ROOT/scripts/configure-kimi-relay.sh" enable >/dev/null 2>&1
check "foreign hooks preserved" "1" "$(grep -c '^hooks = \[{ event = "Stop"' "$CONFIG")"
check "provider added around foreign hooks" "1" "$(grep -c 'temperance:managed:start' "$CONFIG")"
jq -e '.hook == "manual"' "$STATE" >/dev/null && echo "ok - state records manual hook" || { echo "FAIL - manual hook not recorded"; fail=1; }
"$ROOT/scripts/configure-kimi-relay.sh" disable >/dev/null

# ── kimi-normalized config: markers gone, semantic lifecycle takes over ─────
# kimi-cli rewrites config.toml in its own serialization on every run: our
# tables survive but the marker comments do not. With the state marker present,
# re-enable must dedupe semantically and disable must remove tables by header.
HOOK_PATH="$KIMI_HOME/hooks/temperance-user-prompt-submit.sh"
cat >"$CONFIG" <<TOML
default_model = "kimi-code/kimi-for-coding"
merge_all_available_skills = true

[models."temperance/temperance-auto"]
provider = "temperance"
model = "temperance-auto"
max_context_size = 200000

[providers.managed-kimi-code]
type = "kimi"
api_key = "USER-SECRET"

[providers.temperance]
type = "openai_legacy"
base_url = "http://127.0.0.1:20129/v1"
api_key = "temperance-local"

[providers.temperance.custom_headers]
X-Temperance-Surface = "kimi"

[[hooks]]
event = "UserPromptSubmit"
command = "$HOOK_PATH"
timeout = 10
TOML
mkdir -p "$(dirname "$STATE")"
cat >"$STATE" <<JSON
{"schema_version":"temperance-kimi-relay-v1","managed":true,"provider":"temperance","model":"temperance/temperance-auto","base_url":"http://127.0.0.1:20129/v1","hook":"managed","hook_path":"$HOOK_PATH","hooks_line_original":"","previous_default_model":"","config_path":"$CONFIG"}
JSON
mkdir -p "$(dirname "$HOOK_PATH")"
printf '%s\n' '# temperance-kimi-session-v1 fixture' >"$HOOK_PATH"

"$ROOT/scripts/configure-kimi-relay.sh" enable >/dev/null 2>&1
check "normalized re-enable single provider table" "1" "$(grep -c '^\[providers\.temperance\]$' "$CONFIG")"
check "normalized re-enable single model table" "1" "$(grep -c '^\[models."temperance/temperance-auto"\]$' "$CONFIG")"
check "normalized re-enable keeps user provider" "1" "$(grep -c '^\[providers\.managed-kimi-code\]$' "$CONFIG")"
check "normalized re-enable single hook entry" "1" "$(grep -c "^command = \"$HOOK_PATH\"$" "$CONFIG")"

"$ROOT/scripts/configure-kimi-relay.sh" disable >/dev/null 2>&1
check "normalized disable removes provider table" "0" "$(grep -c '^\[providers\.temperance\]' "$CONFIG")"
check "normalized disable removes model table" "0" "$(grep -c 'temperance/temperance-auto' "$CONFIG")"
check "normalized disable removes hook entry" "0" "$(grep -c "$HOOK_PATH" "$CONFIG")"
check "normalized disable keeps user provider" "1" "$(grep -c '^\[providers\.managed-kimi-code\]$' "$CONFIG")"
test ! -e "$STATE" && echo "ok - normalized disable removes state marker" || { echo "FAIL - state marker remains"; fail=1; }

# ── unhealthy relay refuses enable ──────────────────────────────────────────
cat >"$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' '{"ok":true,"service":"temperance-openai-proxy","automatic_model":"temperance-auto"}'
SH
chmod +x "$TMP/bin/curl"
if "$ROOT/scripts/configure-kimi-relay.sh" enable >/dev/null 2>&1; then
  echo "FAIL - enable should require kimi enrichment capability"; fail=1
else
  echo "ok - enable requires relay kimi enrichment capability"
fi

exit "$fail"
