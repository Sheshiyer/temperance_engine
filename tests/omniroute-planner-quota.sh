#!/usr/bin/env bash
# Structural checks (mirroring the sibling combo/fleet/writer lifecycle test
# files) plus functional sandboxed checks of the quota-substitution logic via
# --status, which needs no OmniRoute admin auth at all (only the read-only
# `omniroute usage quota` poll), so it can be exercised fully offline with a
# mock `omniroute` binary on PATH.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/omniroute-temperance-planner-quota.sh"
fail=0
check() {
  local description="$1"
  shift
  if "$@"; then
    echo "ok - $description"
  else
    echo "FAIL - $description"
    fail=1
  fi
}

check "planner quota script is executable" test -x "$SCRIPT"
check "planner quota script parses" bash -n "$SCRIPT"
check "script snapshots before mutation" grep -q 'BACKUP_PATH=' "$SCRIPT"
check "script has explicit rollback" grep -q -- '--rollback' "$SCRIPT"
check "script preserves the global active combo" grep -q 'activeCombo' "$SCRIPT"
check "script polls the live OmniRoute quota command" grep -q 'usage quota' "$SCRIPT"
check "script never touches the Nebius fallback slot" grep -q 'FALLBACK_MODEL' "$SCRIPT"
check "script has a timer install/uninstall/status lifecycle" sh -c "grep -q -- '--install-timer' '$SCRIPT' && grep -q -- '--uninstall-timer' '$SCRIPT' && grep -q -- '--timer-status' '$SCRIPT'"
check "script defaults to a 30 percent threshold" grep -q 'TEMPERANCE_PLANNER_QUOTA_THRESHOLD:-30' "$SCRIPT"
check "docs name the reconciler" grep -q 'omniroute-temperance-planner-quota.sh' "$ROOT/docs/omniroute-fleet.md"

# ── Functional: quota-substitution logic via --status (no auth required) ────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
MOCK="$TMP/omniroute"
STATE_PATH="$TMP/omniroute-planner-quota.json"
STATUS_JSON="$TMP/status.json"

mock_quota() { # $1 = json array body (the mock omniroute CLI's `usage quota` output)
  cat > "$MOCK" <<EOF
#!/usr/bin/env bash
if [[ "\$*" == *"usage quota"* ]]; then
  printf '\033[2m\360\237\223\213 Loaded env from somewhere\033[0m\n'
  cat <<'JSON'
$1
JSON
fi
EOF
  chmod +x "$MOCK"
}
run_status() {
  env TEMPERANCE_OMNIROUTE_CLI="$MOCK" TEMPERANCE_PLANNER_QUOTA_STATE="$STATE_PATH" bash "$SCRIPT" --status > "$STATUS_JSON" 2>&1
}

mock_quota '[
  {"provider":"github","remaining":22,"state":"available"},
  {"provider":"codex","remaining":95,"state":"available"},
  {"provider":"kimi-coding-apikey","remaining":80,"state":"available"}
]'
run_status
check "github alone below threshold substitutes only the github slot" \
  test "$(jq -c '.desired_models' "$STATUS_JSON")" = '["kimi-coding-apikey/k3","codex/gpt-5.6-sol-max","nebius/Qwen/Qwen3-235B-A22B-Instruct-2507"]'
check "substitution reason cites the actual remaining percentage" \
  test "$(jq -r '.substitutions[0].reason' "$STATUS_JSON")" = "remaining 22% < 30%"
check "state file is schema-tagged and world-unreadable" \
  sh -c "test \"\$(jq -r .schema_version '$STATE_PATH')\" = temperance-planner-quota-v1 && [ \"\$(stat -f '%Lp' '$STATE_PATH' 2>/dev/null || stat -c '%a' '$STATE_PATH')\" = 600 ]"

mock_quota '[
  {"provider":"github","remaining":15,"state":"available"},
  {"provider":"codex","remaining":10,"state":"available"},
  {"provider":"kimi-coding-apikey","remaining":60,"state":"available"}
]'
run_status
check "both providers below threshold dedupe to a single kimi-k3 entry" \
  test "$(jq -c '.desired_models' "$STATUS_JSON")" = '["kimi-coding-apikey/k3","nebius/Qwen/Qwen3-235B-A22B-Instruct-2507"]'
check "dedupe still records exactly one substitution" test "$(jq '.substitutions | length' "$STATUS_JSON")" = 1

mock_quota '[
  {"provider":"github","remaining":15,"state":"available"},
  {"provider":"codex","remaining":95,"state":"available"},
  {"provider":"kimi-coding-apikey","remaining":5,"state":"available"}
]'
run_status
check "kimi's own low quota blocks substitution, original model kept" \
  test "$(jq -c '.desired_models' "$STATUS_JSON")" = '["github/gpt-5.4","codex/gpt-5.6-sol-max","nebius/Qwen/Qwen3-235B-A22B-Instruct-2507"]'
check "no substitutions recorded when kimi itself is low" test "$(jq '.substitutions | length' "$STATUS_JSON")" = 0

mock_quota '[
  {"provider":"github","remaining":100,"state":"available"},
  {"provider":"codex","remaining":100,"state":"available"},
  {"provider":"kimi-coding-apikey","remaining":100,"state":"available"}
]'
run_status
check "all-healthy leaves the original three-model order untouched" \
  test "$(jq -c '.desired_models' "$STATUS_JSON")" = '["github/gpt-5.4","codex/gpt-5.6-sol-max","nebius/Qwen/Qwen3-235B-A22B-Instruct-2507"]'

mock_quota '[
  {"provider":"codex","remaining":95,"state":"available"},
  {"provider":"kimi-coding-apikey","remaining":80,"state":"available"}
]'
run_status
check "a provider missing from quota data fails open (no substitution)" \
  test "$(jq -c '.desired_models' "$STATUS_JSON")" = '["github/gpt-5.4","codex/gpt-5.6-sol-max","nebius/Qwen/Qwen3-235B-A22B-Instruct-2507"]'

mock_quota '[
  {"provider":"github","remaining":99,"state":"banned"},
  {"provider":"codex","remaining":95,"state":"available"},
  {"provider":"kimi-coding-apikey","remaining":80,"state":"available"}
]'
run_status
check "a non-available state substitutes regardless of the numeric remaining value" \
  test "$(jq -c '.desired_models' "$STATUS_JSON")" = '["kimi-coding-apikey/k3","codex/gpt-5.6-sol-max","nebius/Qwen/Qwen3-235B-A22B-Instruct-2507"]'

exit "$fail"
