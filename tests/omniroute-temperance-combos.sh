#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

check "combo lifecycle script is executable" test -x "$ROOT/scripts/omniroute-temperance-combos.sh"
check "combo lifecycle script parses" bash -n "$ROOT/scripts/omniroute-temperance-combos.sh"
check "lifecycle script snapshots before mutation" grep -q 'BACKUP_PATH=' "$ROOT/scripts/omniroute-temperance-combos.sh"
check "lifecycle script has explicit rollback" grep -q -- '--rollback' "$ROOT/scripts/omniroute-temperance-combos.sh"
check "lifecycle script guards global active combo" grep -q 'activeCombo' "$ROOT/scripts/omniroute-temperance-combos.sh"
check "lifecycle script preflights live catalog" grep -q '/v1/models' "$ROOT/scripts/omniroute-temperance-combos.sh"
check "fleet lifecycle script is executable" test -x "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet lifecycle script parses" bash -n "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet lifecycle snapshots before mutation" grep -q 'BACKUP_PATH=' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet lifecycle has explicit rollback" grep -q -- '--rollback' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet lifecycle preserves active combo" grep -q 'activeCombo' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet manifest names planner dispatch creative roles" sh -c "grep -q 'te-plan' '$ROOT/package/router/temperance-workflows.json' && grep -q 'te-dispatch' '$ROOT/package/router/temperance-workflows.json' && grep -q 'te-creative' '$ROOT/package/router/temperance-workflows.json'"
check "dispatch manifest starts with exact Codex Spark route" \
  jq -e '.dispatch.strategy == "round-robin"
    and .dispatch.omniroute_workers[0].model == "codex/gpt-5.3-codex-spark"
    and ([.dispatch.omniroute_workers[].model | select(. == "codex/gpt-5.3-codex-spark")] | length) == 1
    and .dispatch.omniroute_workers[0].capability == "low-latency-targeted-coding"
    and (.dispatch.omniroute_workers[0].cost_posture | contains("separate-codex-spark-preview-rate-limit"))' \
  "$ROOT/package/router/temperance-workflows.json"
check "fleet payload starts with exact Spark route" \
  grep -Fq 'round-robin "$(models5 codex/gpt-5.3-codex-spark' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fallback policy's monitor-only te-dispatch record matches the dispatch manifest's live membership (documentation, not enforcement -- monitor_only combos ignore .slots at reconcile time)" \
  jq -e --slurpfile manifest "$ROOT/package/router/temperance-workflows.json" '
    ([.combos[] | select(.name == "te-dispatch")][0].slots | map(.model) | sort) ==
      ($manifest[0].dispatch.omniroute_workers | map(.model) | sort)
  ' "$ROOT/package/router/omniroute-fallback-policy.json"
check "fleet payload bounds per-model concurrency" grep -q 'concurrencyPerModel:2' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet payload bounds queue waiting" grep -q 'queueTimeoutMs:15000' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet payload excludes unsupported persisted queue depth" \
  sh -c "! grep -q 'queueDepth:16' '$ROOT/scripts/omniroute-temperance-fleet.sh'"
check "fleet payload limits round-robin stickiness" grep -q 'stickyRoundRobinLimit:1' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet payload disables same-target retries" grep -q 'maxRetries:0' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet payload fails over before retry" grep -q 'failoverBeforeRetry:true' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet payload records metrics" grep -q 'trackMetrics:true' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet lifecycle preflights exact Spark catalog identifier" \
  grep -q '^  codex/gpt-5.3-codex-spark \\$' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet lifecycle supports remote environment credentials and origin" \
  sh -c "grep -q 'TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD' '$ROOT/scripts/omniroute-temperance-fleet.sh' &&
    grep -q 'OMNIROUTE_API_KEY' '$ROOT/scripts/omniroute-temperance-fleet.sh' &&
    grep -q 'TEMPERANCE_OMNIROUTE_ADMIN_ORIGIN' '$ROOT/scripts/omniroute-temperance-fleet.sh'"
check "fleet lifecycle reads admin credential from a protected payload file" \
  grep -Fq -- '--data-binary "@$LOGIN_PAYLOAD"' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet lifecycle keeps admin credential out of helper process arguments" \
  sh -c "! grep -q -- '--arg password' '$ROOT/scripts/omniroute-temperance-fleet.sh'"
check "fleet lifecycle reads inference credential from a protected header file" \
  grep -Fq -- '-H "@$INFERENCE_HEADERS"' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet lifecycle removes credentials from the curl child environment" \
  grep -q 'unset TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD OMNIROUTE_API_KEY' \
    "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet snapshots use no-clobber creation" grep -q 'set -o noclobber' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet lifecycle supports create actions" grep -q "printf 'create'" "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet lifecycle supports unchanged actions" grep -q "printf 'unchanged'" "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet lifecycle supports update actions" grep -q "printf 'update'" "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet lifecycle updates through full-body PUT" grep -q 'api_mutate PUT' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet rollback records applied combo identities" grep -q 'appliedComboIds' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet rollback resolves mutations by recorded id" grep -q 'combo_by_id' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet rollback restores updated snapshot bodies through PUT" \
  grep -Fq 'api_mutate PUT "/api/combos/$applied_id" "$old"' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet rollback deletes creations by recorded id" \
  grep -Fq 'api_mutate DELETE "/api/combos/$applied_id"' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "fleet rollback never mutates unchanged actions" grep -q 'unchanged) ;;' "$ROOT/scripts/omniroute-temperance-fleet.sh"
check "Spark is absent from governed task portfolio lifecycle" \
  sh -c "! grep -q 'gpt-5.3-codex-spark' '$ROOT/scripts/omniroute-temperance-combos.sh'"
check "parallel dispatch skill names native non-Codex mode" \
  grep -q 'Native non-Codex mode' "$ROOT/skills/temperance-parallel-dispatch/SKILL.md"
check "parallel dispatch skill allowlists independent Claude provider profiles" \
  sh -c "grep -q 'antigravity-claude-sonnet-5' '$ROOT/skills/temperance-parallel-dispatch/SKILL.md' && grep -q 'gh-claude-sonnet-5' '$ROOT/skills/temperance-parallel-dispatch/SKILL.md'"
check "parallel dispatch skill keeps Spark optional" \
  grep -q 'Spark is optional' "$ROOT/skills/temperance-parallel-dispatch/SKILL.md"
check "parallel dispatch skill excludes Sol workers by default" \
  grep -q 'every Sol-family model is excluded' "$ROOT/skills/temperance-parallel-dispatch/SKILL.md"
check "parallel dispatch skill requires exact proven OmniRoute models" \
  sh -c "grep -q '\"backend\": \"omniroute\"' '$ROOT/skills/temperance-parallel-dispatch/SKILL.md' && grep -q '\"model\": \"<exact-probe-passing-non-sol-model>\"' '$ROOT/skills/temperance-parallel-dispatch/SKILL.md'"
check "parallel dispatch skill holds te-dispatch pending wire compatibility" \
  grep -q 'te-dispatch.*candidate combo' "$ROOT/skills/temperance-parallel-dispatch/SKILL.md"
check "parallel dispatch skill bounds task concurrency" grep -q -- '--concurrency 4' "$ROOT/skills/temperance-parallel-dispatch/SKILL.md"
check "parallel dispatch skill requires worktree isolation" grep -q -- '--worktree' "$ROOT/skills/temperance-parallel-dispatch/SKILL.md"
check "runtime docs record Spark 128k limit" grep -q '128k' "$ROOT/docs/omniroute-runtime.md"
check "runtime docs record Spark text-only boundary" grep -qi 'text-only' "$ROOT/docs/omniroute-runtime.md"
check "runtime docs record Spark separate rate limit" grep -qi 'separate rate limit' "$ROOT/docs/omniroute-runtime.md"
check "runtime docs distinguish selection from fallback" grep -q 'Round-robin is initial model selection' "$ROOT/docs/omniroute-runtime.md"
check "runtime docs explain Paseo host affinity" grep -q 'Paseo-hosted sessions' "$ROOT/docs/omniroute-runtime.md"

# Stateful fixture: one governed combo differs, three are absent, and activeCombo
# is deliberately non-null. Apply must create/update without touching the
# operator's active choice; rollback must delete only creations and restore the
# exact pre-apply dispatch body.
mock_state="$(mktemp -d)"
mock_bin="$mock_state/bin"
mkdir -p "$mock_bin" "$mock_state/backups"
ln -s "$ROOT/tests/fixtures/mock-omniroute-curl" "$mock_bin/curl"
printf '%s\n' '{"activeCombo":"operator-choice"}' >"$mock_state/settings.json"
printf '%s\n' \
  '{"combos":[{"id":"dispatch-old","name":"te-dispatch","description":"old dispatch body","systemMessage":"old instructions","models":[{"model":"old/model"}],"strategy":"priority","config":{"maxRetries":2}}]}' \
  >"$mock_state/combos.json"
jq -nc --argjson models '[
  "antigravity/claude-opus-4-6-thinking",
  "github/gpt-5.4",
  "codex/gpt-5.6-sol-max",
  "codex/gpt-5.3-codex-spark",
  "command-code/deepseek/deepseek-v4-flash",
  "command-code/moonshotai/Kimi-K2.7-Code",
  "grok-cli/grok-build",
  "nebius/Qwen/Qwen3-235B-A22B-Instruct-2507"
]' '{data:[$models[] | {id:.}]}' >"$mock_state/catalog.json"
: >"$mock_state/mutations.jsonl"
apply_output="$mock_state/apply.out"
if PATH="$mock_bin:$PATH" USER=fixture OMNIROUTE_MOCK_STATE_DIR="$mock_state" \
  TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD=fixture-admin OMNIROUTE_API_KEY=fixture-key \
  OMNIROUTE_MOCK_MALFORMED_SUCCESS_IDS=1 \
  TEMPERANCE_OMNIROUTE_BACKUP_DIR="$mock_state/backups" \
  /bin/bash "$ROOT/scripts/omniroute-temperance-fleet.sh" --apply >"$apply_output" 2>&1; then
  echo "ok - fixture fleet apply journals malformed success responses"
else
  echo "FAIL - fixture fleet apply failed"
  sed -n '1,120p' "$apply_output"
  fail=1
fi
snapshot="$(sed -n 's/^OmniRoute apply authenticated; backup snapshot: //p' "$apply_output" | tail -1)"
check "fixture apply journals all authoritative readback identities" \
  test "$(jq '.appliedComboIds | length' "$snapshot")" = 4
check "fixture apply reports Algorithm create plus role actions" \
  grep -q 'Plan: te-algorithm=create te-plan=create te-dispatch=update te-creative=create' "$apply_output"
check "fixture apply preserves activeCombo" grep -q 'Global activeCombo after: "operator-choice" (unchanged)' "$apply_output"
check "fixture apply creates three role combos" \
  test "$(jq -s '[.[] | select(.method=="POST" and .path=="/api/combos")] | length' "$mock_state/mutations.jsonl")" = 3
check "fixture apply updates the changed dispatch combo" \
  test "$(jq -s '[.[] | select(.method=="PUT" and .path=="/api/combos/dispatch-old")] | length' "$mock_state/mutations.jsonl")" = 1
check "fixture applied dispatch starts with Spark and bounded config" \
  jq -e '([.combos[] | select(.name=="te-dispatch")][0]) as $dispatch
    | $dispatch.strategy == "round-robin"
    and $dispatch.models[0].model == "codex/gpt-5.3-codex-spark"
    and $dispatch.config.concurrencyPerModel == 2
    and $dispatch.config.queueTimeoutMs == 15000
    and ($dispatch.config | has("queueDepth") | not)
    and $dispatch.config.maxRetries == 0
    and $dispatch.config.failoverBeforeRetry == true' "$mock_state/combos.json"

# The mock adds the same server-managed top-level, model, and config fields as
# a normalized live response. A second pass must ignore those fields and report
# every governed body unchanged.
second_output="$mock_state/second.out"
PATH="$mock_bin:$PATH" USER=fixture OMNIROUTE_MOCK_STATE_DIR="$mock_state" \
  TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD=fixture-admin OMNIROUTE_API_KEY=fixture-key \
  TEMPERANCE_OMNIROUTE_BACKUP_DIR="$mock_state/backups" \
  /bin/bash "$ROOT/scripts/omniroute-temperance-fleet.sh" --dry-run >"$second_output" 2>&1
second_snapshot="$(sed -n 's/^OmniRoute dry-run authenticated; backup snapshot: //p' "$second_output" | tail -1)"
check "fixture second pass is idempotent despite server-managed fields" \
  grep -q 'Plan: te-algorithm=unchanged te-plan=unchanged te-dispatch=unchanged te-creative=unchanged' "$second_output"
cp "$mock_state/combos.json" "$mock_state/applied-state.json"
cp "$mock_state/mutations.jsonl" "$mock_state/apply-mutations.jsonl"

bad_snapshot="$mock_state/wrong-router-snapshot.json"
jq '.baseUrl = "https://wrong-router.example"' "$snapshot" >"$bad_snapshot"
if PATH="$mock_bin:$PATH" USER=fixture OMNIROUTE_MOCK_STATE_DIR="$mock_state" \
  TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD=fixture-admin OMNIROUTE_API_KEY=fixture-key \
  TEMPERANCE_OMNIROUTE_BACKUP_DIR="$mock_state/backups" \
  /bin/bash "$ROOT/scripts/omniroute-temperance-fleet.sh" \
    --rollback "$bad_snapshot" >"$mock_state/bad-rollback.out" 2>&1; then
  echo "FAIL - fixture rollback accepted a snapshot from another router"
  fail=1
else
  echo "ok - fixture rollback rejects a snapshot from another router"
fi
check "rejected cross-router rollback performs no mutations" \
  test "$(wc -l <"$mock_state/mutations.jsonl" | tr -d ' ')" = 4

# A snapshot whose actions were all unchanged owns no mutations. Rollback must
# leave a later operator body edit untouched and emit no mutation request.
jq '(.combos[] | select(.name == "te-plan").description) =
  "operator changed unchanged combo"' \
  "$mock_state/combos.json" >"$mock_state/combos.next"
mv "$mock_state/combos.next" "$mock_state/combos.json"
unchanged_rollback_output="$mock_state/unchanged-rollback.out"
if [ -n "$second_snapshot" ] && PATH="$mock_bin:$PATH" USER=fixture \
  OMNIROUTE_MOCK_STATE_DIR="$mock_state" \
  TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD=fixture-admin OMNIROUTE_API_KEY=fixture-key \
  TEMPERANCE_OMNIROUTE_BACKUP_DIR="$mock_state/backups" \
  /bin/bash "$ROOT/scripts/omniroute-temperance-fleet.sh" \
    --rollback "$second_snapshot" >"$unchanged_rollback_output" 2>&1; then
  echo "ok - fixture rollback skips unchanged snapshot actions"
else
  echo "FAIL - fixture rollback failed for unchanged snapshot actions"
  sed -n '1,120p' "$unchanged_rollback_output"
  fail=1
fi
check "unchanged rollback preserves later operator body edits" \
  jq -e '[.combos[] | select(.name == "te-plan")][0].description ==
    "operator changed unchanged combo"' "$mock_state/combos.json"
check "unchanged rollback emits no mutations" \
  test "$(wc -l <"$mock_state/mutations.jsonl" | tr -d ' ')" = 4
cp "$mock_state/applied-state.json" "$mock_state/combos.json"
cp "$mock_state/apply-mutations.jsonl" "$mock_state/mutations.jsonl"

# Reusing a governed name does not transfer ownership. When a created combo is
# replaced by an operator under a new id, rollback must leave that replacement
# intact while reverting only the other identities recorded by the snapshot.
jq '(.combos[] | select(.name == "te-plan")) |=
  (.id = "operator-replacement" | .description = "operator replacement body")' \
  "$mock_state/combos.json" >"$mock_state/combos.next"
mv "$mock_state/combos.next" "$mock_state/combos.json"
replacement_rollback_output="$mock_state/replacement-rollback.out"
if [ -n "$snapshot" ] && PATH="$mock_bin:$PATH" USER=fixture \
  OMNIROUTE_MOCK_STATE_DIR="$mock_state" \
  TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD=fixture-admin OMNIROUTE_API_KEY=fixture-key \
  TEMPERANCE_OMNIROUTE_BACKUP_DIR="$mock_state/backups" \
  /bin/bash "$ROOT/scripts/omniroute-temperance-fleet.sh" \
    --rollback "$snapshot" >"$replacement_rollback_output" 2>&1; then
  echo "ok - fixture rollback preserves same-name operator replacement"
else
  echo "FAIL - fixture rollback failed with same-name operator replacement"
  sed -n '1,120p' "$replacement_rollback_output"
  fail=1
fi
check "replacement rollback retains the operator-owned identity" \
  jq -e 'any(.combos[]; .id == "operator-replacement"
    and .name == "te-plan"
    and .description == "operator replacement body")' "$mock_state/combos.json"
check "replacement rollback never deletes the operator-owned identity" \
  sh -c "! jq -s -e 'any(.[]; .method == \"DELETE\" and
    .path == \"/api/combos/operator-replacement\")' '$mock_state/mutations.jsonl' >/dev/null"
cp "$mock_state/applied-state.json" "$mock_state/combos.json"
cp "$mock_state/apply-mutations.jsonl" "$mock_state/mutations.jsonl"

# A later body edit to an identity that this apply created must fail the
# complete preflight. No earlier role may be partially reverted.
jq '(.combos[] | select(.name == "te-creative").description) =
  "operator changed applied combo"' \
  "$mock_state/combos.json" >"$mock_state/combos.next"
mv "$mock_state/combos.next" "$mock_state/combos.json"
if PATH="$mock_bin:$PATH" USER=fixture OMNIROUTE_MOCK_STATE_DIR="$mock_state" \
  TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD=fixture-admin OMNIROUTE_API_KEY=fixture-key \
  TEMPERANCE_OMNIROUTE_BACKUP_DIR="$mock_state/backups" \
  /bin/bash "$ROOT/scripts/omniroute-temperance-fleet.sh" \
    --rollback "$snapshot" >"$mock_state/drift-rollback.out" 2>&1; then
  echo "FAIL - fixture rollback accepted post-apply body drift"
  fail=1
else
  echo "ok - fixture rollback rejects post-apply body drift"
fi
check "drift rejection performs no partial rollback mutations" \
  test "$(wc -l <"$mock_state/mutations.jsonl" | tr -d ' ')" = 4
cp "$mock_state/applied-state.json" "$mock_state/combos.json"
cp "$mock_state/apply-mutations.jsonl" "$mock_state/mutations.jsonl"

# Simulate an operator choosing another active combo after apply. Rollback owns
# role bodies only and must preserve this newer global choice.
printf '%s\n' '{"activeCombo":"later-operator-choice"}' >"$mock_state/settings.json"
rollback_output="$mock_state/rollback.out"
if [ -n "$snapshot" ] && PATH="$mock_bin:$PATH" USER=fixture OMNIROUTE_MOCK_STATE_DIR="$mock_state" \
  TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD=fixture-admin OMNIROUTE_API_KEY=fixture-key \
  TEMPERANCE_OMNIROUTE_BACKUP_DIR="$mock_state/backups" \
  /bin/bash "$ROOT/scripts/omniroute-temperance-fleet.sh" --rollback "$snapshot" >"$rollback_output" 2>&1; then
  echo "ok - fixture fleet rollback succeeds"
else
  echo "FAIL - fixture fleet rollback failed"
  sed -n '1,120p' "$rollback_output"
  fail=1
fi
check "fixture rollback deletes only newly created role combos" \
  jq -e '.combos | length == 1 and .[0].name == "te-dispatch"' "$mock_state/combos.json"
check "fixture rollback restores every governed dispatch field and identity" \
  jq -e --slurpfile snapshot "$snapshot" '
    def canonical:
      {
        id,
        name,
        description:(.description // null),
        systemMessage:(.systemMessage // null),
        strategy,
        models:[(.models // [])[] | .model],
        config:((.config // {}) | del(.serverManaged))
      };
    ([.combos[] | select(.name == "te-dispatch")][0] | canonical)
      == ([$snapshot[0].combos.combos[]
        | select(.name == "te-dispatch")][0] | canonical)
  ' "$mock_state/combos.json"
if ! jq -e '.combos | length == 1
    and .[0].name == "te-dispatch"
    and .[0].description == "old dispatch body"' "$mock_state/combos.json" >/dev/null; then
  echo "fixture rollback diagnostic:"
  jq . "$mock_state/combos.json"
  jq -s . "$mock_state/mutations.jsonl"
fi
check "fixture rollback preserves the current activeCombo" \
  grep -q 'activeCombo="later-operator-choice" (unchanged)' "$rollback_output"
rm -rf "$mock_state"

check "manifest has six required portfolios" test "$(jq -r '.required_portfolios | length' "$ROOT/package/router/omniroute-portfolios.json")" = 6
check "manifest maps fast lane" test "$(jq -r '.task_type_portfolios.fast' "$ROOT/package/router/omniroute-portfolios.json")" = te-fast
check "manifest maps build lane" test "$(jq -r '.task_type_portfolios["long-horizon"]' "$ROOT/package/router/omniroute-portfolios.json")" = te-build
check "manifest maps creative lane" test "$(jq -r '.task_type_portfolios.creative' "$ROOT/package/router/omniroute-portfolios.json")" = te-creative
check "manifest maps reasoning lane" test "$(jq -r '.task_type_portfolios.reasoning' "$ROOT/package/router/omniroute-portfolios.json")" = te-reason
check "manifest maps validation lane" test "$(jq -r '.task_type_portfolios.validation' "$ROOT/package/router/omniroute-portfolios.json")" = te-validate
check "runtime docs name all portfolios" sh -c "grep -q 'te-algorithm' '$ROOT/docs/omniroute-runtime.md' && grep -q 'te-fast' '$ROOT/docs/omniroute-runtime.md' && grep -q 'te-build' '$ROOT/docs/omniroute-runtime.md' && grep -q 'te-reason' '$ROOT/docs/omniroute-runtime.md' && grep -q 'te-validate' '$ROOT/docs/omniroute-runtime.md' && grep -q 'te-creative' '$ROOT/docs/omniroute-runtime.md'"
check "connection docs preserve native non-chat lanes" grep -q 'native capability lanes' "$ROOT/docs/omniroute-connections.md"
check "writer lifecycle script is executable" test -x "$ROOT/scripts/omniroute-temperance-writer.sh"
check "writer lifecycle script parses" bash -n "$ROOT/scripts/omniroute-temperance-writer.sh"
check "writer lifecycle snapshots before mutation" grep -q 'BACKUP_PATH=' "$ROOT/scripts/omniroute-temperance-writer.sh"
check "writer lifecycle has explicit rollback" grep -q -- '--rollback' "$ROOT/scripts/omniroute-temperance-writer.sh"
check "writer lifecycle preserves active combo" grep -q 'activeCombo' "$ROOT/scripts/omniroute-temperance-writer.sh"
check "writer lifecycle preflights live catalog" grep -q '/v1/models' "$ROOT/scripts/omniroute-temperance-writer.sh"
check "workflow manifest names the writing role combos" sh -c "grep -q 'te-write' '$ROOT/package/router/temperance-workflows.json' && grep -q 'te-write-critique' '$ROOT/package/router/temperance-workflows.json'"
check "portfolio manifest reserves writing combos names-only" sh -c "jq -e '(.reserved_portfolios | index(\"te-write\") != null) and (.reserved_portfolios | index(\"te-write-critique\") != null)' '$ROOT/package/router/omniroute-portfolios.json' >/dev/null"
check "runtime docs name writing portfolios" sh -c "grep -q 'te-write' '$ROOT/docs/omniroute-runtime.md' && grep -q 'te-write-critique' '$ROOT/docs/omniroute-runtime.md'"
check "writer routing doc keeps image generation client-side" sh -c "test -f '$ROOT/docs/noesis-writer-routing.md' && grep -qi 'client-side' '$ROOT/docs/noesis-writer-routing.md' && grep -qi 'FAL' '$ROOT/docs/noesis-writer-routing.md'"
check "writer expansion lifecycle script is executable" test -x "$ROOT/scripts/omniroute-temperance-writer-expansion.sh"
check "writer expansion lifecycle script parses" bash -n "$ROOT/scripts/omniroute-temperance-writer-expansion.sh"
check "writer expansion lifecycle snapshots before mutation" grep -q 'BACKUP_PATH=' "$ROOT/scripts/omniroute-temperance-writer-expansion.sh"
check "writer expansion lifecycle has explicit rollback" grep -q -- '--rollback' "$ROOT/scripts/omniroute-temperance-writer-expansion.sh"
check "writer expansion lifecycle preserves active combo" grep -q 'activeCombo' "$ROOT/scripts/omniroute-temperance-writer-expansion.sh"
check "writer expansion lifecycle preflights live catalog" grep -q '/v1/models' "$ROOT/scripts/omniroute-temperance-writer-expansion.sh"
check "workflow manifest names the research and media sub-lanes" sh -c "grep -q 'te-write-research' '$ROOT/package/router/temperance-workflows.json' && grep -q 'te-write-media' '$ROOT/package/router/temperance-workflows.json'"
check "portfolio manifest reserves research and media combos names-only" sh -c "jq -e '(.reserved_portfolios | index(\"te-write-research\") != null) and (.reserved_portfolios | index(\"te-write-media\") != null)' '$ROOT/package/router/omniroute-portfolios.json' >/dev/null"
check "runtime docs name research and media portfolios" sh -c "grep -q 'te-write-research' '$ROOT/docs/omniroute-runtime.md' && grep -q 'te-write-media' '$ROOT/docs/omniroute-runtime.md'"
check "writer routing doc maps research and media phases" sh -c "grep -q 'te-write-research' '$ROOT/docs/noesis-writer-routing.md' && grep -q 'te-write-media' '$ROOT/docs/noesis-writer-routing.md'"
check "writer routing doc frames Somatic Canticles link as narrative, not a built mechanic" sh -c "grep -qi 'Somatic Canticles' '$ROOT/docs/noesis-writer-routing.md' && grep -qi 'narrative' '$ROOT/docs/noesis-writer-routing.md'"
check "workflow manifest names the bulk role and its zero-cost models" \
  sh -c "jq -e '.bulk.portfolio == \"te-free-burst\" and (.bulk.models | index(\"opencode/deepseek-v4-flash-free\") != null) and (.bulk.models | index(\"command-code/poolside/laguna-s-2.1-free\") != null)' '$ROOT/package/router/temperance-workflows.json' >/dev/null"
check "portfolio manifest reserves te-free-burst names-only" \
  jq -e '.reserved_portfolios | index("te-free-burst") != null' "$ROOT/package/router/omniroute-portfolios.json"

exit "$fail"
