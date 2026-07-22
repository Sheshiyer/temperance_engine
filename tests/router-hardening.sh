#!/usr/bin/env bash
set -uo pipefail
R="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/package/router/multi-backend-router.sh"
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
