#!/usr/bin/env bash
set -uo pipefail
R="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/package/router/multi-backend-router.sh"
PORTFOLIO_CATALOG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/tests/fixtures/omniroute-models.json"
EMPTY_PORTFOLIO_CATALOG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/tests/fixtures/omniroute-models-empty.json"
fail=0
check() { # desc, expected, actual
  if [[ "$2" == "$3" ]]; then echo "ok - $1"; else echo "FAIL - $1: expected [$2] got [$3]"; fail=1; fi
}

# route-only emits BACKEND<TAB>MODEL for a coding task when command-code is available
out=$(TEMPERANCE_BACKENDS="command-code" "$R" --route-only "refactor the entire auth layer")
check "route-only long-horizon -> command-code primary" \
  "command-code	xiaomi/mimo-v2.5-pro" "$out"

# A healthy OmniRoute gateway is the preferred execution rail. Temperance still
# classifies the task, while OmniRoute owns provider/model failover behind its
# named combo. Direct agent CLIs remain later fallbacks.
out=$(TEMPERANCE_BACKENDS="omniroute command-code" "$R" --route-only "refactor the entire auth layer")
check "route-only long-horizon -> OmniRoute gateway primary" \
  "omniroute	temperance-coding" "$out"

out=$(TEMPERANCE_BACKENDS="omniroute command-code grok kimi" "$R" --route-only-with-fallbacks "refactor the entire auth layer")
expected=$'omniroute\ttemperance-coding\ncommand-code\txiaomi/mimo-v2.5-pro\ngrok\tgrok-build\nkimi\tkimi-code/kimi-for-coding'
check "OmniRoute gateway precedes direct fallback rails" "$expected" "$out"

# Task-specific OmniRoute portfolios are proposal-only until a promotion receipt
# exists. The frozen selected chain must stay on the compatibility combo.
portfolio_fast=$(TEMPERANCE_BACKENDS="omniroute command-code" \
  TEMPERANCE_OMNIROUTE_CATALOG_FILE="$PORTFOLIO_CATALOG" \
  "$R" --plan-json "fix typo")
check "fast task proposes live te-fast portfolio" "te-fast" \
  "$(jq -r '.proposed_order[0].model' <<< "$portfolio_fast")"
check "fast task selects compatibility combo in shadow" "temperance-coding" \
  "$(jq -r '.selected_order[0].model' <<< "$portfolio_fast")"

portfolio_validation=$(TEMPERANCE_BACKENDS="omniroute command-code" \
  TEMPERANCE_OMNIROUTE_CATALOG_FILE="$PORTFOLIO_CATALOG" \
  "$R" --plan-json "audit the code")
check "validation task proposes live te-validate portfolio" "te-validate" \
  "$(jq -r '.proposed_order[0].model' <<< "$portfolio_validation")"
check "validation task keeps compatibility selected" "temperance-coding" \
  "$(jq -r '.selected_order[0].model' <<< "$portfolio_validation")"

portfolio_missing=$(TEMPERANCE_BACKENDS="omniroute command-code" \
  TEMPERANCE_OMNIROUTE_CATALOG_FILE="$PORTFOLIO_CATALOG" \
  "$R" --plan-json "refactor the entire auth layer")
check "missing named portfolio proposes compatibility" "temperance-coding" \
  "$(jq -r '.proposed_order[0].model' <<< "$portfolio_missing")"
check "missing named portfolio keeps direct fallback after compatibility" $'temperance-coding\nxiaomi/mimo-v2.5-pro' \
  "$(jq -r '.selected_order[] | .model' <<< "$portfolio_missing")"

portfolio_direct=$(TEMPERANCE_BACKENDS="omniroute command-code" \
  TEMPERANCE_OMNIROUTE_CATALOG_FILE="$EMPTY_PORTFOLIO_CATALOG" \
  "$R" --plan-json "fix typo")
check "missing gateway catalog degrades to direct first" "command-code" \
  "$(jq -r '.selected_order[0].backend' <<< "$portfolio_direct")"

# A valid receipt may promote one allowlisted low-risk portfolio into the
# frozen selected chain; the receipt is generated from the current manifest.
PROMOTION_HASH="$(bun "$(dirname "$R")/omniroute-promotion.ts" manifest-hash)"
PROMOTION_RECEIPT="$(mktemp)"
PROMOTION_KEY="fixture-promotion-key"
jq -n --arg hash "$PROMOTION_HASH" '{
  schema_version:1, portfolio:"te-fast", suite_id:"suite-fast-v1",
  run_id:"run-20260722-001", run_status:"completed", sample_count:100,
  success_rate:0.98, cost_usd:0.25, latency_p95_ms:800,
  created_at:"2026-01-01T00:00:00Z", expires_at:"2099-01-01T00:00:00Z",
  manifest_hash:$hash, nonce:"run-20260722-001-nonce",
  runtime_version:"3.8.48-fixture", policy_version:"temperance-routing-v1"
}' > "$PROMOTION_RECEIPT"
PROMOTION_RECEIPT_PATH="$PROMOTION_RECEIPT" PROMOTION_KEY="$PROMOTION_KEY" \
  bun -e 'import { readFileSync, writeFileSync } from "node:fs"; import { signPromotionReceipt } from "./package/router/omniroute-promotion.ts"; const path=process.env.PROMOTION_RECEIPT_PATH!; const receipt=JSON.parse(readFileSync(path,"utf8")); receipt.signature=signPromotionReceipt(receipt, process.env.PROMOTION_KEY!); writeFileSync(path, JSON.stringify(receipt));'
promotion_plan=$(TEMPERANCE_BACKENDS="omniroute command-code" \
  TEMPERANCE_OMNIROUTE_CATALOG_FILE="$PORTFOLIO_CATALOG" \
  TEMPERANCE_OMNIROUTE_PROMOTION_RECEIPT="$PROMOTION_RECEIPT" \
  TEMPERANCE_OMNIROUTE_PROMOTION_SIGNING_KEY="$PROMOTION_KEY" \
  TEMPERANCE_OMNIROUTE_RUNTIME_VERSION="3.8.48-fixture" \
  "$R" --plan-json "fix typo")
check "valid receipt promotes te-fast into selected order" "te-fast" \
  "$(jq -r '.selected_order[0].model' <<< "$promotion_plan")"
check "promoted static gateway model is te-fast" "te-fast" \
  "$(jq -r '.static_order[0].model' <<< "$promotion_plan")"
check "promoted proposed gateway model is te-fast" "te-fast" \
  "$(jq -r '.proposed_order[0].model' <<< "$promotion_plan")"
check "valid receipt marks portfolio promoted" "promoted" \
  "$(jq -r '.portfolio.enforcement // empty' <<< "$promotion_plan")"

promotion_wrong_task=$(TEMPERANCE_BACKENDS="omniroute command-code" \
  TEMPERANCE_OMNIROUTE_CATALOG_FILE="$PORTFOLIO_CATALOG" \
  TEMPERANCE_OMNIROUTE_PROMOTION_RECEIPT="$PROMOTION_RECEIPT" \
  TEMPERANCE_OMNIROUTE_PROMOTION_SIGNING_KEY="$PROMOTION_KEY" \
  TEMPERANCE_OMNIROUTE_RUNTIME_VERSION="3.8.48-fixture" \
  "$R" --plan-json "audit the code")
check "receipt for te-fast cannot promote validation portfolio" "temperance-coding" \
  "$(jq -r '.selected_order[0].model' <<< "$promotion_wrong_task")"

promotion_no_key=$(TEMPERANCE_BACKENDS="omniroute command-code" \
  TEMPERANCE_OMNIROUTE_CATALOG_FILE="$PORTFOLIO_CATALOG" \
  TEMPERANCE_OMNIROUTE_PROMOTION_RECEIPT="$PROMOTION_RECEIPT" \
  TEMPERANCE_OMNIROUTE_PROMOTION_SIGNING_KEY="" \
  TEMPERANCE_OMNIROUTE_PROMOTION_KEYCHAIN_SERVICE="Temperance Missing Test Key" \
  TEMPERANCE_OMNIROUTE_RUNTIME_VERSION="3.8.48-fixture" \
  "$R" --plan-json "fix typo")
check "missing signing key preserves compatibility selection" "temperance-coding" \
  "$(jq -r '.selected_order[0].model' <<< "$promotion_no_key")"

PROMOTION_BAD_RECEIPT="$(mktemp)"
BAD_PROMOTION_HASH="sha256:$(printf '%064d' 0)"
jq --arg hash "$BAD_PROMOTION_HASH" '.manifest_hash = $hash' "$PROMOTION_RECEIPT" > "$PROMOTION_BAD_RECEIPT"
promotion_rejected=$(TEMPERANCE_BACKENDS="omniroute command-code" \
  TEMPERANCE_OMNIROUTE_CATALOG_FILE="$PORTFOLIO_CATALOG" \
  TEMPERANCE_OMNIROUTE_PROMOTION_RECEIPT="$PROMOTION_BAD_RECEIPT" \
  TEMPERANCE_OMNIROUTE_PROMOTION_SIGNING_KEY="$PROMOTION_KEY" \
  TEMPERANCE_OMNIROUTE_RUNTIME_VERSION="3.8.48-fixture" \
  "$R" --plan-json "fix typo")
check "invalid receipt preserves compatibility selection" "temperance-coding" \
  "$(jq -r '.selected_order[0].model' <<< "$promotion_rejected")"
rm -f "$PROMOTION_RECEIPT" "$PROMOTION_BAD_RECEIPT"

domain_plan=$(TEMPERANCE_BACKENDS="omniroute command-code grok kimi" "$R" --plan-json "refactor the entire auth layer")
check "OmniRoute candidate declares gateway domain" "gateway" \
  "$(jq -r '.static_order[] | select(.backend=="omniroute") | .failure_domain' <<< "$domain_plan")"
check "direct candidates declare direct domain" "3" \
  "$(jq -r '[.static_order[] | select(.failure_domain=="direct")] | length' <<< "$domain_plan")"

# zero backends -> none<TAB>-
out=$(TEMPERANCE_BACKENDS="" "$R" --route-only "refactor the entire auth layer")
check "route-only zero backends -> none" "none	-" "$out"

# inline task -> inline<TAB>-
out=$(TEMPERANCE_BACKENDS="command-code" "$R" --route-only "summarize these three bullet points")
check "route-only inline" "inline	-" "$out"

# forced backend + model
out=$(TEMPERANCE_BACKENDS="command-code" "$R" --route-only --backend command-code --model gpt-5.5 "quick fix")
check "route-only forced backend+model" "command-code	gpt-5.5" "$out"

# --json with a task containing a double quote and newline is still valid JSON
tricky=$'say "hello"\nand run $(id)'
if TEMPERANCE_BACKENDS="command-code" "$R" --json "$tricky" | jq -e . >/dev/null 2>&1; then
  echo "ok - --json valid for quote/newline task"
else
  echo "FAIL - --json produced invalid JSON for tricky task"; fail=1
fi

# --execute on an inline-classified task must NOT masquerade as success
TEMPERANCE_BACKENDS="command-code" "$R" --execute "summarize these bullet points" >/dev/null 2>&1
check "inline --execute exit code" "3" "$?"

# --route-only-with-fallbacks: full priority-filtered chain, in order,
# filtered to available backends.
out=$(TEMPERANCE_BACKENDS="command-code grok kimi" "$R" --route-only-with-fallbacks "refactor the entire auth layer")
expected=$'command-code\txiaomi/mimo-v2.5-pro\ngrok\tgrok-build\nkimi\tkimi-code/kimi-for-coding'
check "route-only-with-fallbacks: cc/grok/kimi in order" "$expected" "$out"

# filtered to available: grok missing from TEMPERANCE_BACKENDS -> 2 lines (grok dropped)
out=$(TEMPERANCE_BACKENDS="command-code kimi" "$R" --route-only-with-fallbacks "refactor the entire auth layer")
expected=$'command-code\txiaomi/mimo-v2.5-pro\nkimi\tkimi-code/kimi-for-coding'
check "route-only-with-fallbacks: grok filtered out when unavailable" "$expected" "$out"

# inline task -> single inline<TAB>- line
out=$(TEMPERANCE_BACKENDS="command-code grok kimi" "$R" --route-only-with-fallbacks "summarize these three bullet points")
check "route-only-with-fallbacks: inline task -> single inline line" "inline	-" "$out"

# zero backends -> single none<TAB>- line
out=$(TEMPERANCE_BACKENDS="" "$R" --route-only-with-fallbacks "refactor the entire auth layer")
check "route-only-with-fallbacks: zero backends -> single none line" "none	-" "$out"

# --- #6 unification: classifier is now sourced from classify-task.sh ---
# Parity: MBR's task classification must equal the shared classifier's for a corpus.
CT="$(dirname "$R")/classify-task.sh"
for t in "refactor the auth module" "quick refactor the module" "debug this" \
         "audit the code" "brainstorm ideas" "fix typo" "summarize this text" "do the thing"; do
  via_ct="$("$CT" "$t" | cut -f1)"
  # MBR --json exposes .task_type; use it as MBR's classification of record.
  via_mbr="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --json "$t" | jq -r '.task_type')"
  check "parity[$t]" "$via_ct" "$via_mbr"
done
# quick refactor must classify as long-horizon in MBR too (proves shared ordering)
qr="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --json 'quick refactor the module' | jq -r '.task_type')"
check "MBR quick-refactor=long-horizon" "long-horizon" "$qr"

# --- #6 unification: --verdict mode + verdict<->route-only agreement ---
# inline task -> inline
v="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --verdict 'summarize this text')"
[[ "$v" == "inline" ]] && echo "ok   - verdict inline" || { echo "FAIL - verdict inline: $v"; fail=1; }
# non-trivial + backend available -> external<TAB>command-code<TAB>model
# (route_only emits the model WITHOUT its "command-code:" prefix, so verdict
#  carries the bare model in field 3.)
v="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --verdict 'refactor the auth module')"
[[ "$v" == "external"$'\t'"command-code"$'\t'"xiaomi/mimo-v2.5-pro" ]] \
  && echo "ok   - verdict external" || { echo "FAIL - verdict external: $v"; fail=1; }
# non-trivial + NO backend -> claude-subagent
v="$(TEMPERANCE_BACKENDS='' bash "$R" --verdict 'refactor the auth module')"
[[ "$v" == "claude-subagent" ]] && echo "ok   - verdict claude-subagent" || { echo "FAIL - verdict subagent: $v"; fail=1; }
# verdict <-> route-only agreement for a corpus
for t in "summarize this text" "refactor the auth module" "audit the code"; do
  ro="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --route-only "$t")"
  vv="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --verdict "$t")"
  case "$ro" in
    inline$'\t'-) exp="inline" ;;
    none$'\t'-)   exp="claude-subagent" ;;
    *)            exp="external"$'\t'"${ro%%$'\t'*}"$'\t'"${ro#*$'\t'}" ;;
  esac
  [[ "$vv" == "$exp" ]] && echo "ok   - agree[$t]" || { echo "FAIL - agree[$t]: ro=$ro v=$vv"; fail=1; }
done
# --json carries an additive .verdict
jv="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --json 'refactor the auth module' | jq -r '.verdict')"
[[ "$jv" == "external" ]] && echo "ok   - json.verdict" || { echo "FAIL - json.verdict: $jv"; fail=1; }

# --- #6: MBR must source classify-task.sh even when invoked via a symlink ---
# (scripts/wire-multi-backend.sh installs ~/.local/bin/temperance-route as a
#  symlink to this router; SCRIPT_DIR must resolve to the REAL dir, not the link's.)
SYM_TMP="$(mktemp -d)"; ln -s "$R" "$SYM_TMP/temperance-route"
sym_out="$(TEMPERANCE_BACKENDS='command-code' bash "$SYM_TMP/temperance-route" --route-only 'refactor the auth module' 2>&1)"
check "MBR via symlink sources classify-task.sh" "command-code	xiaomi/mimo-v2.5-pro" "$sym_out"
rm -rf "$SYM_TMP"

# --- #6: route-task.sh is retired; nothing may reference it ---
# (excludes this test file itself, which necessarily names the retired
# script in its own guard text below, and ISA.md, whose ISC-39 records the
# retirement as history -- a documentary mention, not a dangling consumer)
ROUTER_DIR="$(dirname "$R")"
REPO_ROOT="$(cd "$ROUTER_DIR/../.." && pwd)"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
ISA_DOC="$REPO_ROOT/ISA.md"
refs="$(grep -rln --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=docs 'route-task\.sh' "$REPO_ROOT" | grep -v -F "$SELF" | grep -v -F "$ISA_DOC" || true)"
if [[ -z "$refs" ]]; then echo "ok   - no route-task.sh references (code)"; else echo "FAIL - route-task.sh still referenced: $refs"; fail=1; fi
if [[ -e "$ROUTER_DIR/route-task.sh" ]]; then echo "FAIL - route-task.sh still exists"; fail=1; else echo "ok   - route-task.sh deleted"; fi

exit $fail
