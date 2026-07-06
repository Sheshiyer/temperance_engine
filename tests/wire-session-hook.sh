#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$DIR/scripts/wire-session-hook.sh"
HOOK="$DIR/package/hooks/ParallelDispatchContext.hook.sh"
fail=0

# --- hook defect regressions (Task 1) ---
grep -q 'docs/pai-flow.md' "$HOOK" && echo "ok - hook points at docs/pai-flow.md" || { echo "FAIL - hook missing pai-flow.md ref"; fail=1; }
grep -q 'See docs/parallel-dispatch.md' "$HOOK" && { echo "FAIL - hook still surfaces retired parallel-dispatch.md"; fail=1; } || echo "ok - retired doc ref not surfaced"
grep -q 'installer does not copy this hook anywhere' "$HOOK" && { echo "FAIL - stale header claim present"; fail=1; } || echo "ok - stale header claim removed"

# --- isolated fixture: settings.json with 4 SessionStart groups + a sentinel top-level key ---
FIX="$(mktemp -d)"
export PAI_HOME="$FIX"
cat > "$FIX/settings.json" <<'JSON'
{
  "unknownTopKey": 123,
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "/x/a.ts" } ] },
      { "hooks": [ { "type": "command", "command": "/x/b.js" } ] },
      { "matcher": "", "hooks": [ { "type": "command", "command": "/x/peon.sh", "timeout": 5 } ] },
      { "hooks": [ { "type": "command", "command": "/x/c.ts" } ] }
    ]
  }
}
JSON
CMD="$FIX/hooks/ParallelDispatchContext.hook.sh"
before_sha="$(shasum "$FIX/settings.json" | awk '{print $1}')"

# --- DRY-RUN mutates nothing ---
out="$(bash "$SCRIPT" --dry-run 2>&1)"; rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q 'Would add' && echo "ok - dry-run logs Would add" || { echo "FAIL - dry-run"; fail=1; }
after_sha="$(shasum "$FIX/settings.json" | awk '{print $1}')"
[ "$before_sha" = "$after_sha" ] && echo "ok - dry-run left settings.json byte-identical" || { echo "FAIL - dry-run mutated settings.json"; fail=1; }
[ ! -e "$CMD" ] && echo "ok - dry-run created no hook file" || { echo "FAIL - dry-run created hook file"; fail=1; }

# --- INSTALL adds exactly one entry ---
bash "$SCRIPT" >/dev/null 2>&1
len="$(jq '.hooks.SessionStart | length' "$FIX/settings.json")"
[ "$len" = "5" ] && echo "ok - install added one group (5 total)" || { echo "FAIL - group count $len"; fail=1; }
occ="$(jq --arg c "$CMD" '[.hooks.SessionStart[].hooks[]?.command] | map(select(. == $c)) | length' "$FIX/settings.json")"
[ "$occ" = "1" ] && echo "ok - exactly one occurrence of our command" || { echo "FAIL - occurrence=$occ"; fail=1; }
[ -f "$CMD" ] && echo "ok - hook copied to stable path" || { echo "FAIL - hook not copied"; fail=1; }

# --- IDEMPOTENT second run ---
out2="$(bash "$SCRIPT" 2>&1)"
echo "$out2" | grep -q 'already registered' && echo "ok - second run is a skip" || { echo "FAIL - not idempotent"; fail=1; }
len2="$(jq '.hooks.SessionStart | length' "$FIX/settings.json")"
[ "$len2" = "5" ] && echo "ok - no duplicate on second run" || { echo "FAIL - duplicate group ($len2)"; fail=1; }

# --- unknown keys + foreign groups preserved after install ---
[ "$(jq '.unknownTopKey' "$FIX/settings.json")" = "123" ] && echo "ok - unknown top-level key preserved" || { echo "FAIL - lost unknown key"; fail=1; }
jq -e '[.hooks.SessionStart[].hooks[]?.command] | index("/x/peon.sh")' "$FIX/settings.json" >/dev/null && echo "ok - foreign command preserved" || { echo "FAIL - foreign command dropped"; fail=1; }

# --- REVERT restores symmetry ---
bash "$SCRIPT" --revert >/dev/null 2>&1
len3="$(jq '.hooks.SessionStart | length' "$FIX/settings.json")"
[ "$len3" = "4" ] && echo "ok - revert restored group count" || { echo "FAIL - revert count $len3"; fail=1; }
occ3="$(jq --arg c "$CMD" '[.hooks.SessionStart[].hooks[]?.command] | map(select(. == $c)) | length' "$FIX/settings.json")"
[ "$occ3" = "0" ] && echo "ok - revert removed our entry" || { echo "FAIL - entry remains"; fail=1; }
[ ! -e "$CMD" ] && echo "ok - revert removed stable hook file" || { echo "FAIL - hook file remains"; fail=1; }
[ "$(jq '.unknownTopKey' "$FIX/settings.json")" = "123" ] && echo "ok - unknown key survived revert" || { echo "FAIL - revert lost unknown key"; fail=1; }

# --- VALID JSON after every op ---
jq empty "$FIX/settings.json" && echo "ok - settings.json still valid JSON" || { echo "FAIL - invalid JSON"; fail=1; }

# --- REVERT-when-absent is a no-op ---
sha_x="$(shasum "$FIX/settings.json" | awk '{print $1}')"
bash "$SCRIPT" --revert >/dev/null 2>&1
sha_y="$(shasum "$FIX/settings.json" | awk '{print $1}')"
[ "$sha_x" = "$sha_y" ] && echo "ok - revert-when-absent is a no-op" || { echo "FAIL - revert-absent mutated"; fail=1; }

# --- GUARD: symlink at HOOK_DEST on install is REPLACED, never clobbered-through ---
FIX4="$(mktemp -d)"; mkdir -p "$FIX4/hooks"
cat > "$FIX4/settings.json" <<'JSON'
{ "hooks": { "SessionStart": [ { "hooks": [ { "type": "command", "command": "/x/a.ts" } ] } ] } }
JSON
EXT="$(mktemp)"; printf 'ORIGINAL_EXTERNAL_CONTENT\n' > "$EXT"
ln -s "$EXT" "$FIX4/hooks/ParallelDispatchContext.hook.sh"
PAI_HOME="$FIX4" bash "$SCRIPT" >/dev/null 2>&1
[ "$(cat "$EXT")" = "ORIGINAL_EXTERNAL_CONTENT" ] && echo "ok - install did not clobber the symlink target" || { echo "FAIL - symlink target clobbered on install"; fail=1; }
[ ! -L "$FIX4/hooks/ParallelDispatchContext.hook.sh" ] && [ -f "$FIX4/hooks/ParallelDispatchContext.hook.sh" ] && echo "ok - symlink replaced by our real hook file" || { echo "FAIL - hook dest still a symlink or missing"; fail=1; }
rm -rf "$FIX4" "$EXT"

# --- GUARD: missing settings.json errs, does not fabricate ---
FIX2="$(mktemp -d)"; PAI_HOME="$FIX2" bash "$SCRIPT" >/dev/null 2>&1
[ $? -ne 0 ] && [ ! -e "$FIX2/settings.json" ] && echo "ok - missing settings.json errs, not fabricated" || { echo "FAIL - fabricated or exited 0 on missing settings"; fail=1; }

# --- GUARD: invalid settings.json refused, left untouched ---
FIX3="$(mktemp -d)"; printf '{ "hooks": ' > "$FIX3/settings.json"; broke_before="$(shasum "$FIX3/settings.json" | awk '{print $1}')"
PAI_HOME="$FIX3" bash "$SCRIPT" >/dev/null 2>&1
broke_after="$(shasum "$FIX3/settings.json" | awk '{print $1}')"
[ "$broke_before" = "$broke_after" ] && echo "ok - invalid settings.json left untouched" || { echo "FAIL - touched invalid settings.json"; fail=1; }

rm -rf "$FIX" "$FIX2" "$FIX3"
exit $fail
