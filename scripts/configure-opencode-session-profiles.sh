#!/usr/bin/env bash
# Persist the curated Temperance/OpenCode session surface. The full OmniRoute
# catalog remains a runtime availability source; only governed aliases are
# exposed in new OpenCode sessions.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUTER_ROOT="$ROOT/package/router"
[ -d "$ROUTER_ROOT" ] || ROUTER_ROOT="$ROOT/router"
HOST_PROFILE="${TEMPERANCE_SESSION_HOST_PROFILE:-mac}"
MANIFEST_OVERRIDE="${TEMPERANCE_SESSION_PROFILE_MANIFEST:-}"
MANIFEST=""
OPENCODE_HOME="${OPENCODE_HOME:-${HOME}/.config/opencode}"
CONFIG_PATH="${TEMPERANCE_OPENCODE_CONFIG:-$OPENCODE_HOME/opencode.json}"
SKILL_HOME="${TEMPERANCE_OPENCODE_SKILL_HOME:-$OPENCODE_HOME/skills}"
STATE_ROOT="${TEMPERANCE_STATE_DIR:-${HOME}/.temperance_engine}/session-routing"
BACKUP_ROOT="${TEMPERANCE_BACKUP_DIR:-${HOME}/.temperance_engine/backups}/session-routing"
OPENCODE_BIN="${OPENCODE_BIN:-opencode}"
ROLLOUT_ID="${TEMPERANCE_ROLLOUT_ID:-}"
MODE="validate"
ROLLBACK_RECEIPT=""

usage() {
  cat <<'USAGE'
Usage:
  scripts/configure-opencode-session-profiles.sh [--host-profile mac|ec2] --apply
  scripts/configure-opencode-session-profiles.sh [--host-profile mac|ec2] --validate
  scripts/configure-opencode-session-profiles.sh [--host-profile mac|ec2] --rollback RECEIPT

Environment:
  TEMPERANCE_ROLLOUT_ID              Shared, caller-stable rollout identifier
  TEMPERANCE_SESSION_HOST_PROFILE    mac (default) or ec2
  TEMPERANCE_SESSION_PROFILE_MANIFEST  Explicit manifest override
  TEMPERANCE_OPENCODE_CONFIG         Alternate OpenCode config for tests
  TEMPERANCE_OPENCODE_SKILL_HOME     Alternate OpenCode skill directory
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) MODE="apply" ;;
    --validate) MODE="validate" ;;
    --rollback)
      MODE="rollback"
      shift
      [ "$#" -ge 1 ] || { usage >&2; exit 2; }
      ROLLBACK_RECEIPT="$1"
      ;;
    --host-profile)
      shift
      [ "$#" -ge 1 ] || { usage >&2; exit 2; }
      HOST_PROFILE="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

case "$HOST_PROFILE" in
  mac)
    DEFAULT_MANIFEST="$ROUTER_ROOT/temperance-session-profiles.json"
    ;;
  ec2)
    DEFAULT_MANIFEST="$ROUTER_ROOT/temperance-session-profiles.ec2.json"
    ;;
  *)
    echo "Unsupported session host profile: $HOST_PROFILE" >&2
    exit 2
    ;;
esac
MANIFEST="${MANIFEST_OVERRIDE:-$DEFAULT_MANIFEST}"

for required in jq perl "$OPENCODE_BIN"; do
  command -v "$required" >/dev/null 2>&1 || {
    echo "Required command is unavailable: $required" >&2
    exit 127
  }
done
if command -v sha256sum >/dev/null 2>&1; then
  SHA256_TOOL="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA256_TOOL="shasum"
else
  echo "Required SHA-256 command is unavailable: install sha256sum or shasum" >&2
  exit 127
fi
[ -f "$MANIFEST" ] || { echo "Session profile manifest not found: $MANIFEST" >&2; exit 1; }
[ -f "$CONFIG_PATH" ] || { echo "OpenCode config not found: $CONFIG_PATH" >&2; exit 1; }
jq empty "$MANIFEST" "$CONFIG_PATH" >/dev/null

case "$ROLLOUT_ID" in
  ""|*[!A-Za-z0-9._-]*)
    if [ "$MODE" = "apply" ] && [ -z "$ROLLOUT_ID" ]; then
      echo "TEMPERANCE_ROLLOUT_ID is required for --apply" >&2
      exit 2
    fi
    [ -z "$ROLLOUT_ID" ] || { echo "Invalid TEMPERANCE_ROLLOUT_ID" >&2; exit 2; }
    ;;
esac

sha256_file() {
  if [ "$SHA256_TOOL" = "sha256sum" ]; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

manifest_value() {
  local query="$1"
  jq -cer "$query" "$MANIFEST"
}

compression_mode() {
  manifest_value '.transport_policy.omniroute_compression.mode'
}

compression_providers() {
  manifest_value '.transport_policy.omniroute_compression.providers'
}

validate_manifest() {
  if [ "$HOST_PROFILE" = "ec2" ]; then
    jq -e --arg profile "$HOST_PROFILE" '
      def unique_array: type == "array" and length == (unique | length);
      . as $root
      | ($root.version == 1)
      and ($root.transport_policy.omniroute_compression.mode == "off")
      and ($root.transport_policy.omniroute_compression.providers | unique_array)
      and ($root.session.host_profile == $profile)
      and ($root.session.enabled_providers | unique_array)
      and (($root.session.enabled_providers | sort) == ["omniroute","temperance"])
      and (($root.transport_policy.omniroute_compression.providers | sort) == ($root.session.enabled_providers | sort))
      and ($root.session.defaults.model == "temperance/temperance-auto")
      and ($root.session.defaults.small_model == "omniroute/te-free-burst")
      and ($root.session.defaults.default_agent == "temperance-auto")
      and ($root.session.max_subagent_depth | type == "number" and . >= 0)
      and ($root.aliases | type == "array" and length == 5)
      and ([$root.aliases[].id] | unique_array)
      and (([$root.aliases[].id] | sort) == [
        "omniroute/te-build",
        "omniroute/te-free-burst",
        "omniroute/te-plan",
        "omniroute/temperance-coding",
        "temperance/temperance-auto"
      ])
      and (all($root.aliases[]; . as $alias | $alias.id == $alias.model and ($alias.model | startswith($alias.provider + "/"))))
      and ($root.session.managed_agent_names | unique_array)
      and (all($root.session.agents | keys[]; . as $name | $root.session.managed_agent_names | index($name) != null))
      and (all($root.session.agents[]; .model as $model | [$root.aliases[].id] | index($model) != null))
      and (first($root.aliases[] | select(.id == "omniroute/te-free-burst"))
        | .lane == "B" and .promotion_state == "live-proven" and .config.tool_call == false)
      and (first($root.aliases[] | select(.id == "omniroute/temperance-coding"))
        | .lane == "B" and .promotion_state == "live-proven" and .config.tool_call == true)
      and (all($root.aliases[] | select(.id == "omniroute/te-plan" or .id == "omniroute/te-build");
        .lane == "A" and .promotion_state == "live-proven"))
      and ($root.session.agents["temperance-native"].model == "omniroute/te-free-burst")
      and ($root.session.agents["temperance-worker"].model == "omniroute/temperance-coding")
      and ($root.session.agents["temperance-planner"].model == "omniroute/te-plan")
      and ($root.session.agents["temperance-continuity"].model == "omniroute/te-build")
      and ($root.session.managed_skills | unique_array)
      and (all($root.session.managed_skills[]; . == "temperance-native" or . == "temperance-algorithm"))
      and ($root.session.fail_closed.algorithm_s == {
        activation_environment:"TEMPERANCE_AUTO_READY",
        ready_value:"1",
        unavailable_status:503,
        unavailable_code:"s_tier_unavailable",
        model:"temperance/temperance-auto",
        agents:["temperance-auto","temperance-algorithm"],
        allow_silent_fallback:false
      })
      and ($root.session.agents["temperance-auto"].model == $root.session.fail_closed.algorithm_s.model)
      and ($root.session.agents["temperance-algorithm"].model == $root.session.fail_closed.algorithm_s.model)
      and ([$root.session.agents | to_entries[] | select(.key == "temperance-auto" or .key == "temperance-algorithm") | .value.model] | unique == ["temperance/temperance-auto"])
      and ([$root.aliases[].id | select(contains("spark"))] | length == 0)
      and ($root.session.agents["code-fast"] == null)
    ' "$MANIFEST" >/dev/null || {
      echo "EC2 session manifest failed its fail-closed schema contract: $MANIFEST" >&2
      return 1
    }
  else
    jq -e '
      def unique_array: type == "array" and length == (unique | length);
      . as $root
      | $root.version == 1
      and ($root.transport_policy.omniroute_compression.mode == "off")
      and ($root.transport_policy.omniroute_compression.providers | unique_array)
      and (($root.transport_policy.omniroute_compression.providers | sort) == ["omniroute","temperance"])
      and ($root.max_subagent_depth | type == "number" and . >= 0)
      and ($root.aliases | type == "array" and length > 0)
      and ([$root.aliases[].id] | length == (unique | length))
      and (all($root.aliases[]; .id == .model))
    ' "$MANIFEST" >/dev/null || {
      echo "Mac session manifest failed its compatibility contract: $MANIFEST" >&2
      return 1
    }
  fi
}

validate_manifest

enabled_providers() {
  if [ "$HOST_PROFILE" = "ec2" ]; then
    manifest_value '.session.enabled_providers'
  else
    printf '%s\n' '["omniroute","temperance"]'
  fi
}

default_model() {
  if [ "$HOST_PROFILE" = "ec2" ]; then
    manifest_value '.session.defaults.model'
  else
    printf '%s\n' 'temperance/temperance-auto'
  fi
}

small_model() {
  if [ "$HOST_PROFILE" = "ec2" ]; then
    manifest_value '.session.defaults.small_model'
  else
    printf '%s\n' 'omniroute/codex/gpt-5.3-codex-spark'
  fi
}

default_agent() {
  if [ "$HOST_PROFILE" = "ec2" ]; then
    manifest_value '.session.defaults.default_agent'
  else
    printf '%s\n' 'temperance-auto'
  fi
}

max_subagent_depth() {
  if [ "$HOST_PROFILE" = "ec2" ]; then
    manifest_value '.session.max_subagent_depth'
  else
    manifest_value '.max_subagent_depth'
  fi
}

expected_aliases() {
  jq -c '[.aliases[].id] | sort' "$MANIFEST"
}

managed_agents() {
  if [ "$HOST_PROFILE" = "ec2" ]; then
    manifest_value '.session.agents'
    return
  fi
  jq -nc \
    --arg algorithmPath "${HOME}/.Codex/PAI/Algorithm/**" \
    --arg canonicalAlgorithmPath "${HOME}/.claude/PAI/Algorithm/**" '{
    "temperance-auto": {
      mode: "primary",
      model: "temperance/temperance-auto",
      description: "Automatic Temperance session: classify NATIVE versus ALGORITHM before choosing a governed rail.",
      prompt: "Use the Temperance automatic classifier. Preserve the selected session mode and task identity. Never silently downgrade an ALGORITHM coordinator.",
      permission: {
        task: "allow",
        skill: {"*":"deny","temperance-native":"allow","temperance-algorithm":"allow","using-superpowers":"allow","ISA":"allow","iterativedepth":"allow","systemsthinking":"allow","firstprinciples":"allow","*-orchestrator":"allow"}
      }
    },
    "temperance-native": {
      mode: "primary",
      model: "omniroute/te-fast",
      description: "Bounded NATIVE-mode execution for one-step work.",
      prompt: "Apply the temperance-native contract: execute one bounded step without orchestration or task delegation. This prose lane does not require a skill tool call.",
      permission: {task:"deny",skill:{"*":"deny","temperance-native":"allow"}}
    },
    "temperance-algorithm": {
      mode: "primary",
      model: "omniroute/te-algorithm",
      description: "S-tier ALGORITHM planning, complex building, and orchestration.",
      prompt: "Load the temperance-algorithm skill and the active PAI Algorithm before work. Freeze the S-tier coordinator for this session. Delegate only bounded slices, to a maximum subagent depth of one. If S is unavailable, fail visibly; continuity requires an explicit new task on temperance-continuity.",
      permission: {
        task: "allow",
        external_directory: {"*":"ask",($algorithmPath):"allow",($canonicalAlgorithmPath):"allow"},
        skill: {"*":"deny","temperance-*":"allow","using-superpowers":"allow","ISA":"allow","iterativedepth":"allow","systemsthinking":"allow","firstprinciples":"allow","*-orchestrator":"allow"}
      }
    },
    "temperance-continuity": {
      mode: "primary",
      model: "omniroute/te-build",
      description: "Explicit A-tier continuity profile after a visible S-tier miss.",
      prompt: "This is an explicitly selected A-tier continuity session. Start a new task identity, log the tier transition, and never represent this rail as S-tier coordination.",
      permission: {
        task: "allow",
        skill: {"*":"deny","temperance-*":"allow","using-superpowers":"allow","ISA":"allow","*-orchestrator":"allow"}
      }
    },
    "temperance-planner": {
      mode: "subagent",
      model: "omniroute/te-plan",
      description: "Bounded planning helper; returns a task graph and acceptance evidence.",
      prompt: "Plan only the assigned slice. Do not mutate the workspace or delegate again. Return a compact task graph, risks, and verification criteria.",
      maxSteps: 16,
      permission: {task:"deny",edit:"deny",skill:{"*":"deny","ISA":"allow","systemsthinking":"allow","firstprinciples":"allow"}}
    },
    "temperance-worker": {
      mode: "subagent",
      model: "omniroute/te-dispatch",
      description: "B-tier worker for independent, bounded production slices.",
      prompt: "Execute only the assigned slice, preserve unrelated work, do not delegate, and return evidence plus artifact paths. Escalation is B to A to S; never downgrade within the same task.",
      maxSteps: 32,
      permission: {task:"deny",skill:{"*":"deny","temperance-parallel-dispatch":"allow","using-superpowers":"allow"}}
    },
    "temperance-validator": {
      mode: "subagent",
      model: "omniroute/te-validate",
      description: "Independent validation helper for acceptance and regression evidence.",
      prompt: "Validate the assigned acceptance criteria independently. Do not mutate the workspace or delegate. Return pass/fail evidence and exact failures.",
      maxSteps: 16,
      permission: {task:"deny",edit:"deny",skill:{"*":"deny","ISA":"allow","iterativedepth":"allow"}}
    },
    "code-fast": {
      mode: "subagent",
      model: "omniroute/codex/gpt-5.3-codex-spark",
      description: "Fast bounded coding on the Mac-only Spark entitlement.",
      prompt: "Execute a small targeted coding slice. Do not orchestrate or delegate.",
      maxSteps: 24,
      permission: {task:"deny",skill:{"*":"deny","using-superpowers":"allow"}}
    }
  }'
}

managed_agent_names() {
  if [ "$HOST_PROFILE" = "ec2" ]; then
    manifest_value '.session.managed_agent_names'
  else
    managed_agents | jq -c 'keys'
  fi
}

managed_skills() {
  if [ "$HOST_PROFILE" = "ec2" ]; then
    manifest_value '.session.managed_skills'
  else
    printf '%s\n' '["temperance-native","temperance-algorithm"]'
  fi
}

validate_provider_headers_contract() {
  local providers_json="$1"
  while IFS= read -r provider_name; do
    jq -e --arg provider "$provider_name" '
      .provider[$provider] as $provider_config
      | ($provider_config == null)
        or (
          ($provider_config | type) == "object"
          and (
            ($provider_config | has("options") | not)
            or $provider_config.options == null
            or (
              ($provider_config.options | type) == "object"
              and (
                ($provider_config.options | has("headers") | not)
                or ($provider_config.options.headers | type) == "object"
              )
            )
          )
        )
    ' "$CONFIG_PATH" >/dev/null || {
      echo "Provider options.headers must be absent or an object: $provider_name" >&2
      return 1
    }
  done < <(jq -r '.[]' <<<"$providers_json")
}

check_skill_collision() {
  local name="$1"
  local source="$2"
  local target="$SKILL_HOME/$name"
  [ -e "$source" ] || { echo "Managed skill source is missing: $source" >&2; return 1; }
  if [ -L "$target" ]; then
    [ "$(readlink "$target")" = "$source" ] || {
      echo "Skill namespace collision: $target points to $(readlink "$target")" >&2
      return 1
    }
  elif [ -e "$target" ]; then
    echo "Skill namespace collision: $target already exists and is not the managed symlink" >&2
    return 1
  fi
}

validate_runtime() {
  local effective models actual_aliases expected config_aliases plugin_output
  local expected_providers expected_model expected_small_model expected_default_agent expected_depth
  local expected_agents expected_managed_agents expected_skills expected_compression_mode expected_compression_providers
  expected="$(expected_aliases)"
  expected_providers="$(enabled_providers)"
  expected_model="$(default_model)"
  expected_small_model="$(small_model)"
  expected_default_agent="$(default_agent)"
  expected_depth="$(max_subagent_depth)"
  expected_agents="$(managed_agents)"
  expected_managed_agents="$(managed_agent_names)"
  expected_skills="$(managed_skills)"
  expected_compression_mode="$(compression_mode)"
  expected_compression_providers="$(compression_providers)"
  effective="$("$OPENCODE_BIN" debug config)"
  jq -e \
    --arg model "$expected_model" \
    --arg smallModel "$expected_small_model" \
    --arg defaultAgent "$expected_default_agent" \
    --arg compressionMode "$expected_compression_mode" \
    --argjson depth "$expected_depth" \
    --argjson expected "$expected" \
    --argjson compressionProviders "$expected_compression_providers" \
    --argjson providers "$expected_providers" \
    --argjson expectedAgents "$expected_agents" \
    --argjson managedAgentNames "$expected_managed_agents" '
    . as $effective
    | def compression_entries($provider):
        [($effective.provider[$provider].options.headers // {}) | to_entries[] | select(.key | ascii_downcase == "x-omniroute-compression")];
    ($effective.enabled_providers | sort) == ($providers | sort)
    and $effective.model == $model
    and $effective.small_model == $smallModel
    and $effective.default_agent == $defaultAgent
    and $effective.subagent_depth == $depth
    and all($compressionProviders[];
      . as $provider
      | ($effective.provider[$provider].options.headers | type) == "object"
      and (compression_entries($provider) | length == 1)
      and (compression_entries($provider)[0].key == "x-omniroute-compression")
      and (compression_entries($provider)[0].value == $compressionMode))
    and all($expectedAgents | to_entries[];
      . as $binding
      | ($effective.agent[$binding.key] | del(.steps, .options)) == $binding.value)
    and all($managedAgentNames[]; . as $name | ($expectedAgents[$name] != null) or ($effective.agent[$name] == null))
    and (
      [$providers[] as $provider
        | $effective.provider[$provider].models | keys[]
        | ($provider + "/" + .)] | sort
    ) == $expected
  ' <<<"$effective" >/dev/null || {
    echo "Resolved OpenCode configuration does not match the governed $HOST_PROFILE session policy" >&2
    return 1
  }

  config_aliases="$(jq -c --argjson providers "$expected_providers" '[
    $providers[] as $provider
    | .provider[$provider].models | keys[]
    | ($provider + "/" + .)
  ] | sort' <<<"$effective")"
  [ "$config_aliases" = "$expected" ] || {
    echo "Resolved provider alias set differs from the manifest" >&2
    return 1
  }

  jq -e --slurpfile effective <(printf '%s' "$effective") '
    all(.aliases[];
      . as $alias
      | ($alias.model | sub("^" + $alias.provider + "/"; "")) as $model_key
      | $effective[0].provider[$alias.provider].models[$model_key].limit.context == $alias.limits.context
      and $effective[0].provider[$alias.provider].models[$model_key].limit.output == $alias.limits.output
    )
  ' "$MANIFEST" >/dev/null || {
    echo "Resolved model limits differ from the governed manifest" >&2
    return 1
  }

  models="$("$OPENCODE_BIN" models | perl -pe 's/\e\][^\a]*(?:\a|\e\\)//g; s/\e\[[0-9;?]*[ -\/]*[@-~]//g')"
  actual_aliases="$(printf '%s\n' "$models" | sed '/^[[:space:]]*$/d' | LC_ALL=C sort | jq -Rsc 'split("\n") | map(select(length>0))')"
  [ "$actual_aliases" = "$expected" ] || {
    echo "Fresh OpenCode model picker differs from the exact governed alias set" >&2
    printf 'Expected: %s\nActual:   %s\n' "$expected" "$actual_aliases" >&2
    return 1
  }
  printf '%s\n' "$models" | grep -Eq '(^|/)(auto/|nvidia/|huggingface/|te-orchestrate$)' && {
    echo "Ungoverned or candidate model leaked into the picker" >&2
    return 1
  }
  if [ "$HOST_PROFILE" = "ec2" ] && printf '%s\n' "$models" | grep -Eqi 'spark|te-algorithm'; then
    echo "Mac-only or unavailable S model leaked into the EC2 picker" >&2
    return 1
  fi

  while IFS= read -r skill_name; do
    check_skill_collision "$skill_name" "$ROOT/skills/$skill_name"
  done < <(jq -r '.[]' <<<"$expected_skills")
  if ! plugin_output="$("$OPENCODE_BIN" debug skill 2>&1)"; then
    echo "OpenCode skill discovery failed: $plugin_output" >&2
    return 1
  fi
  printf '%s\n' "$plugin_output" | grep -qi 'failed to load plugin' && {
    echo "OpenCode plugin startup is not clean" >&2
    return 1
  }
  printf 'Validated %s OpenCode session policy: %s aliases, %s agents, %s providers, depth %s.\n' \
    "$HOST_PROFILE" \
    "$(jq 'length' <<<"$expected")" \
    "$(jq 'length' <<<"$expected_agents")" \
    "$(jq 'length' <<<"$expected_providers")" \
    "$expected_depth"
}

if [ "$MODE" = "validate" ]; then
  validate_runtime
  exit 0
fi

if [ "$MODE" = "rollback" ]; then
  [ -f "$ROLLBACK_RECEIPT" ] || { echo "Rollback receipt not found: $ROLLBACK_RECEIPT" >&2; exit 1; }
  jq -e '.schemaVersion == 1 and .kind == "temperance-opencode-session-routing"' "$ROLLBACK_RECEIPT" >/dev/null || {
    echo "Rollback receipt has an unsupported schema" >&2
    exit 1
  }
  receipt_profile="$(jq -er '.hostProfile // "mac"' "$ROLLBACK_RECEIPT")"
  [ "$receipt_profile" = "$HOST_PROFILE" ] || {
    echo "Rollback receipt belongs to host profile $receipt_profile, not $HOST_PROFILE" >&2
    exit 1
  }
  receipt_manifest_hash="$(jq -r '.manifestHash // empty' "$ROLLBACK_RECEIPT")"
  if [ -n "$receipt_manifest_hash" ] && [ "$(sha256_file "$MANIFEST")" != "$receipt_manifest_hash" ]; then
    echo "Selected session manifest changed after apply; refusing rollback" >&2
    exit 1
  fi
  receipt_config="$(jq -er '.configPath' "$ROLLBACK_RECEIPT")"
  [ "$receipt_config" = "$CONFIG_PATH" ] || {
    echo "Rollback receipt belongs to a different OpenCode config" >&2
    exit 1
  }
  expected_applied_hash="$(jq -er '.appliedHash' "$ROLLBACK_RECEIPT")"
  [ "$(sha256_file "$CONFIG_PATH")" = "$expected_applied_hash" ] || {
    echo "OpenCode config changed after apply; refusing partial rollback" >&2
    exit 1
  }
  backup_path="$(jq -er '.backupPath' "$ROLLBACK_RECEIPT")"
  [ -f "$backup_path" ] || { echo "Rollback backup is missing: $backup_path" >&2; exit 1; }
  receipt_backup_hash="$(jq -r '.backupHash // empty' "$ROLLBACK_RECEIPT")"
  if [ -n "$receipt_backup_hash" ] && [ "$(sha256_file "$backup_path")" != "$receipt_backup_hash" ]; then
    echo "Rollback backup drifted after apply; refusing partial rollback" >&2
    exit 1
  fi
  while IFS=$'\t' read -r target source; do
    [ -L "$target" ] && [ "$(readlink "$target")" = "$source" ] || {
      echo "Managed skill link drifted; refusing partial rollback: $target" >&2
      exit 1
    }
  done < <(jq -r '.createdSkills[]? | [.target,.source] | @tsv' "$ROLLBACK_RECEIPT")

  rollback_tmp="$(mktemp "${TMPDIR:-/tmp}/temperance-opencode-rollback.XXXXXX")"
  trap 'rm -f "$rollback_tmp"' EXIT
  cp -p "$backup_path" "$rollback_tmp"
  chmod 600 "$rollback_tmp"
  mv -f "$rollback_tmp" "$CONFIG_PATH"
  while IFS= read -r target; do
    [ -z "$target" ] || rm "$target"
  done < <(jq -r '.createdSkills[]?.target' "$ROLLBACK_RECEIPT")
  printf 'Rolled back OpenCode session policy from %s\n' "$ROLLBACK_RECEIPT"
  exit 0
fi

agents_json="$(managed_agents)"
agent_names_json="$(managed_agent_names)"
skills_json="$(managed_skills)"
enabled_providers_json="$(enabled_providers)"
compression_mode_value="$(compression_mode)"
compression_providers_json="$(compression_providers)"
default_model_id="$(default_model)"
small_model_id="$(small_model)"
default_agent_name="$(default_agent)"
subagent_depth="$(max_subagent_depth)"
[ "$compression_mode_value" = "off" ] || {
  echo "Manifest transport_policy.omniroute_compression.mode must be off" >&2
  exit 1
}
jq -en \
  --argjson enabled "$enabled_providers_json" \
  --argjson scoped "$compression_providers_json" \
  '($enabled | sort) == ($scoped | sort)' >/dev/null || {
  echo "Manifest transport_policy.omniroute_compression.providers must match enabled governed providers" >&2
  exit 1
}
while IFS= read -r provider_name; do
  jq -e --arg provider "$provider_name" '.provider[$provider] | type == "object"' "$CONFIG_PATH" >/dev/null || {
    if [ "$HOST_PROFILE" = "ec2" ] && [ "$provider_name" = "temperance" ]; then
      continue
    fi
    echo "Enabled provider is missing from OpenCode config: $provider_name" >&2
    exit 1
  }
done < <(jq -r '.[]' <<<"$enabled_providers_json")
validate_provider_headers_contract "$enabled_providers_json"
owned_config=false
current_config_hash="$(sha256_file "$CONFIG_PATH")"
if [ -d "$STATE_ROOT/rollouts" ]; then
  while IFS= read -r prior_receipt; do
    [ -f "$prior_receipt" ] || continue
    if jq -e --arg config "$CONFIG_PATH" --arg hash "$current_config_hash" '
        .schemaVersion == 1
        and .kind == "temperance-opencode-session-routing"
        and .configPath == $config
        and .appliedHash == $hash
      ' "$prior_receipt" >/dev/null 2>&1; then
      owned_config=true
      break
    fi
  done < <(find "$STATE_ROOT/rollouts" -maxdepth 1 -type f -name '*.json' -print)
fi
while IFS= read -r agent_name; do
  existing_agent="$(jq -c --arg name "$agent_name" '.agent[$name] // null' "$CONFIG_PATH")"
  desired_agent="$(jq -c --arg name "$agent_name" '.[$name] // null' <<<"$agents_json")"
  if [ "$existing_agent" != "null" ] && [ "$existing_agent" != "$desired_agent" ]; then
    [ "$owned_config" = false ] || continue
    # code-fast predates this bundle and is accepted only at the exact governed
    # model binding; every other foreign namespace collision fails closed.
    existing_agent_model="$(jq -r '.model // empty' <<<"$existing_agent")"
    if [ "$agent_name" != "code-fast" ] \
        || { [ "$existing_agent_model" != "omniroute/codex/gpt-5.3-codex-spark" ] \
          && { [ "$HOST_PROFILE" != "ec2" ] || [ "$existing_agent_model" != "omniroute/te-fast" ]; }; }; then
      echo "Agent namespace collision: $agent_name" >&2
      exit 1
    fi
  fi
done < <(jq -r '.[]' <<<"$agent_names_json")

while IFS= read -r skill_name; do
  check_skill_collision "$skill_name" "$ROOT/skills/$skill_name"
done < <(jq -r '.[]' <<<"$skills_json")

umask 077
mkdir -p "$BACKUP_ROOT/$ROLLOUT_ID" "$STATE_ROOT/rollouts" "$SKILL_HOME"
backup_stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
backup_path="$BACKUP_ROOT/$ROLLOUT_ID/opencode-$HOST_PROFILE-$backup_stamp.json"
receipt_path="$STATE_ROOT/rollouts/$ROLLOUT_ID.json"
[ ! -e "$receipt_path" ] || { echo "Rollout receipt already exists: $receipt_path" >&2; exit 1; }
[ ! -e "$backup_path" ] || { echo "Timestamped backup already exists: $backup_path" >&2; exit 1; }
cp -p "$CONFIG_PATH" "$backup_path"
chmod 600 "$backup_path"

next_config="$(mktemp "${TMPDIR:-/tmp}/temperance-opencode-session.XXXXXX")"
receipt_tmp="$(mktemp "${TMPDIR:-/tmp}/temperance-opencode-receipt.XXXXXX")"
created_skills='[]'
config_installed=false
cleanup_apply() {
  rm -f "$next_config" "$receipt_tmp"
  if [ "$config_installed" = true ]; then
    cp -p "$backup_path" "$CONFIG_PATH"
    chmod 600 "$CONFIG_PATH"
    rm -f "$receipt_path"
  fi
  while IFS= read -r target; do
    [ -z "$target" ] || { [ -L "$target" ] && rm "$target"; }
  done < <(jq -r '.[].target' <<<"$created_skills")
}
trap cleanup_apply EXIT

jq \
  --arg model "$default_model_id" \
  --arg smallModel "$small_model_id" \
  --arg defaultAgent "$default_agent_name" \
  --arg compressionMode "$compression_mode_value" \
  --argjson depth "$subagent_depth" \
  --argjson enabledProviders "$enabled_providers_json" \
  --argjson managedAgents "$agents_json" \
  --argjson managedAgentNames "$agent_names_json" \
  --slurpfile manifest "$MANIFEST" '
  . as $old
  | ($manifest[0]) as $policy
  | def model_key($alias): ($alias.model | sub("^" + $alias.provider + "/"; ""));
  def normalized_headers($provider):
    (($old.provider[$provider].options.headers // {})) as $headers
    | reduce ($headers | to_entries[]) as $entry
        ({};
          if ($entry.key | ascii_downcase) == "x-omniroute-compression" then .
          else . + {($entry.key): $entry.value}
          end)
    | .["x-omniroute-compression"] = $compressionMode;
  def default_model($alias):
    (model_key($alias)) as $key
    | {
        name: (
          if $key == "te-algorithm" then "Temperance · Algorithm Coordinator (S)"
          else "Temperance · " + $key
          end
        ),
        reasoning: true,
        temperature: true,
        tool_call: (["te-fast","te-reason","te-write-critique","te-write-research","te-write-media"] | index($key) | not),
        limit: {context:$alias.limits.context,output:$alias.limits.output}
      };
  def curated_models($provider):
    reduce ($policy.aliases[] | select(.provider == $provider)) as $alias
      ({};
        (model_key($alias)) as $key
        | ($old.provider[$provider].models[$key] // $alias.config // default_model($alias)) as $base
        | .[$key] = ($base
          | .limit.context = $alias.limits.context
          | .limit.output = $alias.limits.output)
      );
  if $policy.session.host_profile == "ec2" and (.provider.temperance | type != "object") then
    .provider.temperance = {
      npm: ($old.provider.omniroute.npm // "@ai-sdk/openai-compatible"),
      options: {
        baseURL: "http://127.0.0.1:20129/v1",
        apiKey: ($old.provider.omniroute.options.apiKey // "{env:OMNIROUTE_API_KEY}")
      },
      models: {}
    }
  else . end
  |
  .enabled_providers = $enabledProviders
  | del(.disabled_providers)
  | .model = $model
  | .small_model = $smallModel
  | .default_agent = $defaultAgent
  | .subagent_depth = $depth
  | reduce $enabledProviders[] as $provider (.; .provider[$provider].options = ((.provider[$provider].options // {}) | .headers = normalized_headers($provider)))
  | reduce $enabledProviders[] as $provider (.; .provider[$provider].models = curated_models($provider))
  | .agent = (
      reduce $managedAgentNames[] as $agentName ((.agent // {}); del(.[$agentName]))
      | . + $managedAgents
    )
' "$CONFIG_PATH" >"$next_config"
jq empty "$next_config" >/dev/null
chmod 600 "$next_config"

while IFS= read -r skill_name; do
  source="$ROOT/skills/$skill_name"
  target="$SKILL_HOME/$skill_name"
  if [ ! -L "$target" ]; then
    ln -s "$source" "$target"
    created_skills="$(jq -c --arg target "$target" --arg source "$source" '. + [{target:$target,source:$source}]' <<<"$created_skills")"
  fi
done < <(jq -r '.[]' <<<"$skills_json")

pre_hash="$(sha256_file "$CONFIG_PATH")"
applied_hash="$(sha256_file "$next_config")"
backup_hash="$(sha256_file "$backup_path")"
manifest_hash="$(sha256_file "$MANIFEST")"
created_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
opencode_version="$("$OPENCODE_BIN" --version | head -1)"
jq -n \
  --arg rolloutId "$ROLLOUT_ID" \
  --arg hostProfile "$HOST_PROFILE" \
  --arg manifestPath "$MANIFEST" \
  --arg manifestHash "$manifest_hash" \
  --arg configPath "$CONFIG_PATH" \
  --arg backupPath "$backup_path" \
  --arg backupHash "$backup_hash" \
  --arg preHash "$pre_hash" \
  --arg appliedHash "$applied_hash" \
  --arg opencodeVersion "$opencode_version" \
  --arg createdAt "$created_at" \
  --argjson expectedAliases "$(expected_aliases)" \
  --argjson createdSkills "$created_skills" \
  '{
    schemaVersion:1,
    kind:"temperance-opencode-session-routing",
    rolloutId:$rolloutId,
    hostProfile:$hostProfile,
    manifestPath:$manifestPath,
    manifestHash:$manifestHash,
    configPath:$configPath,
    backupPath:$backupPath,
    backupHash:$backupHash,
    preHash:$preHash,
    appliedHash:$appliedHash,
    opencodeVersion:$opencodeVersion,
    createdAt:$createdAt,
    expectedAliases:$expectedAliases,
    createdSkills:$createdSkills
  }' >"$receipt_tmp"
chmod 600 "$receipt_tmp"

mv -f "$next_config" "$CONFIG_PATH"
config_installed=true
mv -f "$receipt_tmp" "$receipt_path"
validate_runtime
trap - EXIT

printf 'Applied OpenCode session policy: %s\n' "$CONFIG_PATH"
printf 'Rollout receipt: %s\n' "$receipt_path"
printf 'Backup: %s\n' "$backup_path"
printf 'Restart or refresh OpenCode to reload the curated picker.\n'
