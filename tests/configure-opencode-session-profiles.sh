#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/configure-opencode-session-profiles.sh"
MOCK="$ROOT/tests/fixtures/mock-opencode-session"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT
passes=0
failures=0

check() {
  local label="$1"
  shift
  if "$@"; then
    printf 'ok - %s\n' "$label"
    passes=$((passes + 1))
  else
    printf 'FAIL - %s\n' "$label" >&2
    failures=$((failures + 1))
  fi
}

make_fixture() {
  local fixture="$1"
  mkdir -p "$fixture/home/ubuntu" "$fixture/opencode/skills" "$fixture/state" "$fixture/backups"
  jq -n '{
    plugin:["./plugins/temperance-flow.ts"],
    small_model:"omniroute/codex/gpt-5.3-codex-spark",
    provider:{
      omniroute:{
        npm:"@ai-sdk/openai-compatible",
        options:{
          baseURL:"http://127.0.0.1:20128/v1",
          apiKey:"{env:OMNIROUTE_API_KEY}",
          headers:{"X-OmniRoute-Compression":"on","x-operator-header":"preserve-omniroute"}
        },
        models:{
          "codex/gpt-5.3-codex-spark":{
            name:"Spark",
            reasoning:true,
            temperature:false,
            tool_call:true,
            limit:{context:128000,input:128000,output:32000}
          }
        }
      },
      temperance:{
        npm:"@ai-sdk/openai-compatible",
        options:{
          baseURL:"http://127.0.0.1:20129/v1",
          apiKey:"{env:OMNIROUTE_API_KEY}",
          headers:{"X-OMNIROUTE-COMPRESSION":"engine:caveman","x-relay-header":"preserve-temperance"}
        },
        models:{
          "temperance-auto":{
            name:"Temperance Auto",
            reasoning:true,
            temperature:true,
            tool_call:true,
            limit:{context:200000,input:200000,output:384000}
          }
        }
      },
      thirdparty:{
        npm:"@ai-sdk/openai-compatible",
        options:{baseURL:"http://127.0.0.1:29999/v1",apiKey:"{env:THIRDPARTY_API_KEY}"},
        models:{
          "operator-owned":{
            name:"Operator owned",
            reasoning:false,
            temperature:true,
            tool_call:false,
            limit:{context:32000,input:32000,output:8000}
          }
        }
      }
    },
    agent:{
      "code-fast":{
        model:"omniroute/codex/gpt-5.3-codex-spark",
        description:"Fast bounded coding on the Mac-only Spark entitlement."
      }
    },
    unrelated:{preserved:true}
  }' >"$fixture/opencode/opencode.json"
  chmod 600 "$fixture/opencode/opencode.json"
}

run_policy() {
  local fixture="$1" rollout="$2"
  shift 2
  HOME="$fixture/home/ubuntu" \
  OPENCODE_HOME="$fixture/opencode" \
  TEMPERANCE_OPENCODE_CONFIG="$fixture/opencode/opencode.json" \
  TEMPERANCE_OPENCODE_SKILL_HOME="$fixture/opencode/skills" \
  TEMPERANCE_STATE_DIR="$fixture/state" \
  TEMPERANCE_BACKUP_DIR="$fixture/backups" \
  TEMPERANCE_ROLLOUT_ID="$rollout" \
  OPENCODE_BIN="$MOCK" \
    "$SCRIPT" "$@"
}

run_policy_with_manifest() {
  local fixture="$1" rollout="$2" host_profile="$3" manifest="$4"
  HOME="$fixture/home/ubuntu" \
  OPENCODE_HOME="$fixture/opencode" \
  TEMPERANCE_OPENCODE_CONFIG="$fixture/opencode/opencode.json" \
  TEMPERANCE_OPENCODE_SKILL_HOME="$fixture/opencode/skills" \
  TEMPERANCE_STATE_DIR="$fixture/state" \
  TEMPERANCE_BACKUP_DIR="$fixture/backups" \
  TEMPERANCE_ROLLOUT_ID="$rollout" \
  TEMPERANCE_SESSION_HOST_PROFILE="$host_profile" \
  TEMPERANCE_SESSION_PROFILE_MANIFEST="$manifest" \
  OPENCODE_BIN="$MOCK" \
    "$SCRIPT" --apply
}

mode_of() {
  local path="$1" mode
  if mode="$(stat -f '%Lp' "$path" 2>/dev/null)"; then
    printf '%s\n' "$mode"
  else
    stat -c '%a' "$path"
  fi
}

chmod +x "$MOCK"
fixture_main="$TMP_ROOT/main"
make_fixture "$fixture_main"
original_hash="$(shasum -a 256 "$fixture_main/opencode/opencode.json" | awk '{print $1}')"

run_policy "$fixture_main" rollout-one --apply >"$fixture_main/apply-one.out"
receipt_one="$fixture_main/state/session-routing/rollouts/rollout-one.json"
check "apply writes a rollback receipt" test -f "$receipt_one"
check "apply preserves unrelated configuration" \
  jq -e '
    .unrelated.preserved == true
    and .provider.thirdparty.models["operator-owned"].name == "Operator owned"
    and (.enabled_providers | index("thirdparty") == null)
  ' "$fixture_main/opencode/opencode.json"
check "apply persists exact providers and session defaults" \
  jq -e '
    (.enabled_providers | sort) == ["omniroute","temperance"]
    and .model == "temperance/temperance-auto"
    and .default_agent == "temperance-auto"
    and .subagent_depth == 1
  ' "$fixture_main/opencode/opencode.json"
check "Mac apply preserves unrelated headers and canonicalizes compression off" \
  jq -e '
    . as $root
    |
    def compression_entries($provider):
      [$root.provider[$provider].options.headers | to_entries[]
        | select(.key | ascii_downcase == "x-omniroute-compression")];
    $root.provider.omniroute.options.headers["x-operator-header"] == "preserve-omniroute"
    and $root.provider.temperance.options.headers["x-relay-header"] == "preserve-temperance"
    and all(["omniroute","temperance"][];
      . as $provider
      | (compression_entries($provider) | length == 1)
      and compression_entries($provider)[0] == {key:"x-omniroute-compression",value:"off"})
  ' "$fixture_main/opencode/opencode.json"
check "apply exposes exactly fourteen aliases" \
  test "$(jq '[.enabled_providers[] as $provider | .provider[$provider].models | keys[]] | length' "$fixture_main/opencode/opencode.json")" = 14
check "apply installs both managed mode skills" \
  sh -c "test -L '$fixture_main/opencode/skills/temperance-native' && test -L '$fixture_main/opencode/skills/temperance-algorithm'"
check "validate accepts a fresh governed session surface" \
  run_policy "$fixture_main" unused --validate

run_policy "$fixture_main" rollout-two --apply >"$fixture_main/apply-two.out"
receipt_two="$fixture_main/state/session-routing/rollouts/rollout-two.json"
check "second apply is idempotent and receipt-bound" test -f "$receipt_two"
run_policy "$fixture_main" unused --rollback "$receipt_two" >"$fixture_main/rollback-two.out"
check "second rollback preserves first rollout links" \
  sh -c "test -L '$fixture_main/opencode/skills/temperance-native' && test -L '$fixture_main/opencode/skills/temperance-algorithm'"
run_policy "$fixture_main" unused --rollback "$receipt_one" >"$fixture_main/rollback-one.out"
check "first rollback restores exact original config" \
  test "$(shasum -a 256 "$fixture_main/opencode/opencode.json" | awk '{print $1}')" = "$original_hash"
check "first rollback removes only receipt-created links" \
  sh -c "test ! -e '$fixture_main/opencode/skills/temperance-native' && test ! -e '$fixture_main/opencode/skills/temperance-algorithm'"

fixture_collision="$TMP_ROOT/collision"
make_fixture "$fixture_collision"
jq '.agent["temperance-auto"]={model:"foreign/model"}' \
  "$fixture_collision/opencode/opencode.json" >"$fixture_collision/opencode/next.json"
mv "$fixture_collision/opencode/next.json" "$fixture_collision/opencode/opencode.json"
collision_hash="$(shasum -a 256 "$fixture_collision/opencode/opencode.json" | awk '{print $1}')"
if run_policy "$fixture_collision" collision --apply >"$fixture_collision/collision.out" 2>&1; then
  check "foreign agent namespace collision fails closed" false
else
  check "foreign agent namespace collision fails closed" true
fi
check "collision failure leaves config unchanged" \
  test "$(shasum -a 256 "$fixture_collision/opencode/opencode.json" | awk '{print $1}')" = "$collision_hash"

fixture_malformed_headers="$TMP_ROOT/malformed-headers"
make_fixture "$fixture_malformed_headers"
jq '.provider.omniroute.options.headers="malformed"' \
  "$fixture_malformed_headers/opencode/opencode.json" >"$fixture_malformed_headers/opencode/malformed.json"
mv "$fixture_malformed_headers/opencode/malformed.json" "$fixture_malformed_headers/opencode/opencode.json"
malformed_hash="$(shasum -a 256 "$fixture_malformed_headers/opencode/opencode.json" | awk '{print $1}')"
if run_policy "$fixture_malformed_headers" malformed --apply >"$fixture_malformed_headers/apply.out" 2>&1; then
  check "malformed provider headers fail closed before mutation" false
else
  check "malformed provider headers fail closed before mutation" true
fi
check "malformed headers create no backup, receipt, or config drift" \
  sh -c "test \"\$(shasum -a 256 '$fixture_malformed_headers/opencode/opencode.json' | awk '{print \$1}')\" = '$malformed_hash' && test -z \"\$(find '$fixture_malformed_headers/backups' '$fixture_malformed_headers/state' -type f -print -quit)\""

fixture_invalid_mode="$TMP_ROOT/invalid-compression-mode"
make_fixture "$fixture_invalid_mode"
invalid_mode_manifest="$fixture_invalid_mode/invalid-mac-manifest.json"
jq '.transport_policy.omniroute_compression.mode="lite"' \
  "$ROOT/package/router/temperance-session-profiles.json" >"$invalid_mode_manifest"
invalid_mode_hash="$(shasum -a 256 "$fixture_invalid_mode/opencode/opencode.json" | awk '{print $1}')"
if run_policy_with_manifest "$fixture_invalid_mode" invalid-mode mac "$invalid_mode_manifest" \
    >"$fixture_invalid_mode/apply.out" 2>&1; then
  check "Mac manifest rejects a compression mode other than off" false
else
  check "Mac manifest rejects a compression mode other than off" true
fi
check "invalid Mac compression mode fails before backup or mutation" \
  sh -c "test \"\$(shasum -a 256 '$fixture_invalid_mode/opencode/opencode.json' | awk '{print \$1}')\" = '$invalid_mode_hash' && test -z \"\$(find '$fixture_invalid_mode/backups' '$fixture_invalid_mode/state' -type f -print -quit)\""

fixture_invalid_scope="$TMP_ROOT/invalid-compression-scope"
make_fixture "$fixture_invalid_scope"
invalid_scope_manifest="$fixture_invalid_scope/invalid-ec2-manifest.json"
jq '.transport_policy.omniroute_compression.providers=["omniroute"]' \
  "$ROOT/package/router/temperance-session-profiles.ec2.json" >"$invalid_scope_manifest"
invalid_scope_hash="$(shasum -a 256 "$fixture_invalid_scope/opencode/opencode.json" | awk '{print $1}')"
if run_policy_with_manifest "$fixture_invalid_scope" invalid-scope ec2 "$invalid_scope_manifest" \
    >"$fixture_invalid_scope/apply.out" 2>&1; then
  check "EC2 manifest rejects compression scope missing a governed provider" false
else
  check "EC2 manifest rejects compression scope missing a governed provider" true
fi
check "invalid EC2 compression scope fails before backup or mutation" \
  sh -c "test \"\$(shasum -a 256 '$fixture_invalid_scope/opencode/opencode.json' | awk '{print \$1}')\" = '$invalid_scope_hash' && test -z \"\$(find '$fixture_invalid_scope/backups' '$fixture_invalid_scope/state' -type f -print -quit)\""

fixture_drift="$TMP_ROOT/drift"
make_fixture "$fixture_drift"
run_policy "$fixture_drift" drift --apply >"$fixture_drift/apply.out"
drift_receipt="$fixture_drift/state/session-routing/rollouts/drift.json"
jq '.operator_edit=true' "$fixture_drift/opencode/opencode.json" >"$fixture_drift/opencode/edited.json"
mv "$fixture_drift/opencode/edited.json" "$fixture_drift/opencode/opencode.json"
if run_policy "$fixture_drift" unused --rollback "$drift_receipt" >"$fixture_drift/rollback.out" 2>&1; then
  check "post-apply drift blocks rollback" false
else
  check "post-apply drift blocks rollback" true
fi
check "blocked rollback preserves operator edit" \
  jq -e '.operator_edit == true' "$fixture_drift/opencode/opencode.json"
check "blocked rollback preserves managed links" \
  sh -c "test -L '$fixture_drift/opencode/skills/temperance-native' && test -L '$fixture_drift/opencode/skills/temperance-algorithm'"

fixture_ec2="$TMP_ROOT/ec2"
make_fixture "$fixture_ec2"
ec2_original_hash="$(shasum -a 256 "$fixture_ec2/opencode/opencode.json" | awk '{print $1}')"
run_policy "$fixture_ec2" ec2-one --host-profile ec2 --apply >"$fixture_ec2/apply.out"
ec2_receipt="$fixture_ec2/state/session-routing/rollouts/ec2-one.json"
ec2_backup="$(jq -er '.backupPath' "$ec2_receipt")"
check "EC2 apply writes a profile-bound receipt" \
  jq -e '
    .hostProfile == "ec2"
    and (.manifestPath | endswith("temperance-session-profiles.ec2.json"))
    and (.manifestHash | test("^[0-9a-f]{64}$"))
    and (.backupHash | test("^[0-9a-f]{64}$"))
    and (.createdAt | test("Z$"))
  ' "$ec2_receipt"
check "EC2 receipt is mode 600" test "$(mode_of "$ec2_receipt")" = 600
check "EC2 timestamped backup is mode 600" \
  sh -c "test \"$(mode_of "$ec2_backup")\" = 600 && printf '%s' '$ec2_backup' | grep -Eq 'opencode-ec2-[0-9]{8}T[0-9]{6}Z.json$'"
check "EC2 keeps exact providers and defaults" \
  jq -e '
    (.enabled_providers | sort) == ["omniroute","temperance"]
    and .model == "temperance/temperance-auto"
    and .small_model == "omniroute/te-free-burst"
    and .default_agent == "temperance-auto"
    and .subagent_depth == 1
  ' "$fixture_ec2/opencode/opencode.json"
check "EC2 apply preserves unrelated headers and canonicalizes compression off" \
  jq -e '
    . as $root
    |
    def compression_entries($provider):
      [$root.provider[$provider].options.headers | to_entries[]
        | select(.key | ascii_downcase == "x-omniroute-compression")];
    $root.provider.omniroute.options.headers["x-operator-header"] == "preserve-omniroute"
    and $root.provider.temperance.options.headers["x-relay-header"] == "preserve-temperance"
    and all(["omniroute","temperance"][];
      . as $provider
      | (compression_entries($provider) | length == 1)
      and compression_entries($provider)[0] == {key:"x-omniroute-compression",value:"off"})
  ' "$fixture_ec2/opencode/opencode.json"
check "EC2 picker contains only five governed aliases" \
  jq -e '
    ([.enabled_providers[] as $provider
      | .provider[$provider].models | keys[]
      | ($provider + "/" + .)] | sort) == [
        "omniroute/te-build",
        "omniroute/te-free-burst",
        "omniroute/te-plan",
        "omniroute/temperance-coding",
        "temperance/temperance-auto"
      ]
  ' "$fixture_ec2/opencode/opencode.json"
check "EC2 preserves but does not enable unrelated provider config" \
  jq -e '
    .provider.thirdparty.models["operator-owned"].name == "Operator owned"
    and (.enabled_providers | index("thirdparty") == null)
  ' "$fixture_ec2/opencode/opencode.json"
check "EC2 removes Mac-only Spark picker and agent" \
  jq -e '
    .agent["code-fast"] == null
    and ([.provider.omniroute.models | keys[] | select(test("spark"; "i"))] | length == 0)
  ' "$fixture_ec2/opencode/opencode.json"
check "EC2 binds B and A agents to live-proven lanes" \
  jq -e '
    .agent["temperance-native"].model == "omniroute/te-free-burst"
    and .agent["temperance-worker"].model == "omniroute/temperance-coding"
    and .provider.omniroute.models["te-free-burst"].tool_call == false
    and .provider.omniroute.models["temperance-coding"].tool_call == true
    and .agent["temperance-planner"].model == "omniroute/te-plan"
    and .agent["temperance-continuity"].model == "omniroute/te-build"
    and .agent["temperance-validator"].model == "omniroute/te-build"
  ' "$fixture_ec2/opencode/opencode.json"
check "EC2 Algorithm and auto share the fail-closed relay model" \
  jq -e '
    .agent["temperance-auto"].model == "temperance/temperance-auto"
    and .agent["temperance-algorithm"].model == "temperance/temperance-auto"
    and ([.agent["temperance-auto"].model,.agent["temperance-algorithm"].model]
      | all(. != "omniroute/te-plan" and . != "omniroute/te-build" and . != "omniroute/te-free-burst" and . != "omniroute/temperance-coding"))
  ' "$fixture_ec2/opencode/opencode.json"
check "EC2 manifest records the structured S readiness gate" \
  jq -e '
    .session.fail_closed.algorithm_s.activation_environment == "TEMPERANCE_AUTO_READY"
    and .session.fail_closed.algorithm_s.ready_value == "1"
    and .session.fail_closed.algorithm_s.unavailable_status == 503
    and .session.fail_closed.algorithm_s.unavailable_code == "s_tier_unavailable"
    and .session.fail_closed.algorithm_s.allow_silent_fallback == false
  ' "$ROOT/package/router/temperance-session-profiles.ec2.json"
check "Mac and EC2 manifests freeze compression for both governed providers" \
  sh -c "jq -e '.transport_policy.omniroute_compression == {mode:\"off\",providers:[\"omniroute\",\"temperance\"]}' '$ROOT/package/router/temperance-session-profiles.json' >/dev/null && jq -e '.transport_policy.omniroute_compression == {mode:\"off\",providers:[\"omniroute\",\"temperance\"]}' '$ROOT/package/router/temperance-session-profiles.ec2.json' >/dev/null"

ec2_applied_hash="$(shasum -a 256 "$fixture_ec2/opencode/opencode.json" | awk '{print $1}')"
run_policy "$fixture_ec2" unused --host-profile ec2 --validate >"$fixture_ec2/validate-one.out"
run_policy "$fixture_ec2" unused --host-profile ec2 --validate >"$fixture_ec2/validate-two.out"
check "EC2 validation is repeatable and non-mutating" \
  test "$(shasum -a 256 "$fixture_ec2/opencode/opencode.json" | awk '{print $1}')" = "$ec2_applied_hash"

invalid_manifest="$fixture_ec2/invalid-ec2-manifest.json"
jq '.session.agents["temperance-algorithm"].model="omniroute/te-build"' \
  "$ROOT/package/router/temperance-session-profiles.ec2.json" >"$invalid_manifest"
if HOME="$fixture_ec2/home/ubuntu" \
  TEMPERANCE_SESSION_HOST_PROFILE=ec2 \
  TEMPERANCE_SESSION_PROFILE_MANIFEST="$invalid_manifest" \
  TEMPERANCE_OPENCODE_CONFIG="$fixture_ec2/opencode/opencode.json" \
  TEMPERANCE_OPENCODE_SKILL_HOME="$fixture_ec2/opencode/skills" \
  TEMPERANCE_STATE_DIR="$fixture_ec2/state" \
  TEMPERANCE_BACKUP_DIR="$fixture_ec2/backups" \
  OPENCODE_BIN="$MOCK" \
  "$SCRIPT" --validate >"$fixture_ec2/invalid-manifest.out" 2>&1; then
  check "EC2 rejects an Algorithm-to-A silent fallback binding" false
else
  check "EC2 rejects an Algorithm-to-A silent fallback binding" true
fi
check "rejected EC2 manifest leaves configuration unchanged" \
  test "$(shasum -a 256 "$fixture_ec2/opencode/opencode.json" | awk '{print $1}')" = "$ec2_applied_hash"

if run_policy "$fixture_ec2" unused --host-profile mac --rollback "$ec2_receipt" \
  >"$fixture_ec2/wrong-profile-rollback.out" 2>&1; then
  check "Mac profile cannot consume an EC2 rollback receipt" false
else
  check "Mac profile cannot consume an EC2 rollback receipt" true
fi
check "profile mismatch performs no partial rollback" \
  test "$(shasum -a 256 "$fixture_ec2/opencode/opencode.json" | awk '{print $1}')" = "$ec2_applied_hash"
run_policy "$fixture_ec2" unused --host-profile ec2 --rollback "$ec2_receipt" \
  >"$fixture_ec2/rollback.out"
check "EC2 rollback restores the exact original config" \
  test "$(shasum -a 256 "$fixture_ec2/opencode/opencode.json" | awk '{print $1}')" = "$ec2_original_hash"
check "EC2 rollback removes only receipt-created links" \
  sh -c "test ! -e '$fixture_ec2/opencode/skills/temperance-native' && test ! -e '$fixture_ec2/opencode/skills/temperance-algorithm'"

fixture_ec2_bootstrap="$TMP_ROOT/ec2-bootstrap"
make_fixture "$fixture_ec2_bootstrap"
jq 'del(.provider.temperance)' "$fixture_ec2_bootstrap/opencode/opencode.json" >"$fixture_ec2_bootstrap/opencode/without-temperance.json"
mv "$fixture_ec2_bootstrap/opencode/without-temperance.json" "$fixture_ec2_bootstrap/opencode/opencode.json"
run_policy "$fixture_ec2_bootstrap" ec2-bootstrap --host-profile ec2 --apply >"$fixture_ec2_bootstrap/apply.out"
check "EC2 bootstraps a missing loopback Temperance provider without embedding a key" \
  jq -e '
    .provider.temperance.npm == "@ai-sdk/openai-compatible"
    and .provider.temperance.options.baseURL == "http://127.0.0.1:20129/v1"
    and .provider.temperance.options.apiKey == "{env:OMNIROUTE_API_KEY}"
    and (.provider.temperance.models | keys) == ["temperance-auto"]
  ' "$fixture_ec2_bootstrap/opencode/opencode.json"

fixture_ec2_legacy="$TMP_ROOT/ec2-legacy-code-fast"
make_fixture "$fixture_ec2_legacy"
jq '.agent["code-fast"]={description:"Legacy EC2 fast lane",model:"omniroute/te-fast"}' \
  "$fixture_ec2_legacy/opencode/opencode.json" >"$fixture_ec2_legacy/opencode/legacy.json"
mv "$fixture_ec2_legacy/opencode/legacy.json" "$fixture_ec2_legacy/opencode/opencode.json"
run_policy "$fixture_ec2_legacy" ec2-legacy --host-profile ec2 --apply >"$fixture_ec2_legacy/apply.out"
check "EC2 retires the known legacy te-fast code-fast agent" \
  jq -e '.agent["code-fast"] == null' "$fixture_ec2_legacy/opencode/opencode.json"

fixture_ec2_drift="$TMP_ROOT/ec2-drift"
make_fixture "$fixture_ec2_drift"
run_policy "$fixture_ec2_drift" ec2-drift --host-profile ec2 --apply >"$fixture_ec2_drift/apply.out"
ec2_drift_receipt="$fixture_ec2_drift/state/session-routing/rollouts/ec2-drift.json"
jq '.operator_edit="preserve"' "$fixture_ec2_drift/opencode/opencode.json" \
  >"$fixture_ec2_drift/opencode/edited.json"
mv "$fixture_ec2_drift/opencode/edited.json" "$fixture_ec2_drift/opencode/opencode.json"
if run_policy "$fixture_ec2_drift" unused --host-profile ec2 --rollback "$ec2_drift_receipt" \
  >"$fixture_ec2_drift/rollback.out" 2>&1; then
  check "EC2 post-apply drift blocks rollback" false
else
  check "EC2 post-apply drift blocks rollback" true
fi
check "blocked EC2 rollback preserves operator edit and links" \
  sh -c "jq -e '.operator_edit == \"preserve\"' '$fixture_ec2_drift/opencode/opencode.json' >/dev/null && test -L '$fixture_ec2_drift/opencode/skills/temperance-native' && test -L '$fixture_ec2_drift/opencode/skills/temperance-algorithm'"

printf '%s passed, %s failed\n' "$passes" "$failures"
test "$failures" -eq 0
