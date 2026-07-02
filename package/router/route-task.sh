#!/usr/bin/env bash
# package/router/route-task.sh
# Routes a task description to an optimal executor based on complexity signals.
# Bash implementation for CLI usage without Node.js dependency.
#
# Usage:
#   ./route-task.sh "implement auth middleware"
#   ./route-task.sh --json "implement auth middleware"
#   ./route-task.sh --batch tasks.json

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

# Model catalog (model → tier)
declare -A MODEL_TIERS=(
  ["deepseek/deepseek-v4-flash"]="fast"
  ["moonshotai/Kimi-K2.7-Code"]="deep"
  ["claude-sonnet-5"]="balanced"
  ["claude-fable-5"]="premium"
  ["google/gemini-3.5-flash"]="fast"
  ["Qwen/Qwen3.7-Max"]="deep"
)

# ─────────────────────────────────────────────────────────────────────────────
# Complexity analysis
# ─────────────────────────────────────────────────────────────────────────────

analyze_complexity() {
  local desc="$1"
  local lower_desc
  lower_desc=$(echo "$desc" | tr '[:upper:]' '[:lower:]')
  
  # Signals
  local needs_tool_use=false
  local is_extraction=false
  local is_long_horizon=false
  local needs_coordination=false
  local is_architectural=false
  local is_validation=false
  
  # Check patterns
  if echo "$lower_desc" | grep -qE '\b(read|search|grep|edit|write|run|execute|test|build|compile)\b'; then
    needs_tool_use=true
  fi
  
  if echo "$lower_desc" | grep -qE '\b(extract|classify|summarize|list|identify|find|count)\b'; then
    is_extraction=true
  fi
  
  if echo "$lower_desc" | grep -qE '\b(refactor|rewrite|migrate|redesign|overhaul|restructure)\b'; then
    is_long_horizon=true
  fi
  
  if echo "$lower_desc" | grep -qE '\b(coordinate|together|shared|sync|parallel|collaborate)\b'; then
    needs_coordination=true
  fi
  
  if echo "$lower_desc" | grep -qE '\b(architect|design|structure|pattern|system|api|schema)\b'; then
    is_architectural=true
  fi
  
  if echo "$lower_desc" | grep -qE '\b(validate|verify|review|check|audit|test|ensure)\b'; then
    is_validation=true
  fi
  
  # Return as space-separated values
  echo "$needs_tool_use $is_extraction $is_long_horizon $needs_coordination $is_architectural $is_validation"
}

# ─────────────────────────────────────────────────────────────────────────────
# Router
# ─────────────────────────────────────────────────────────────────────────────

route_task() {
  local desc="$1"
  local output_json="${2:-false}"
  
  # Analyze complexity
  local signals
  signals=$(analyze_complexity "$desc")
  read -r needs_tool_use is_extraction is_long_horizon needs_coordination is_architectural is_validation <<< "$signals"
  
  # Decision tree
  local executor="command-code"
  local tier="full"
  local model="claude-sonnet-5"
  local reason="default balanced routing"
  local confidence="0.7"
  local max_turns=""
  local subagent_type=""
  
  # 1. Trivial extraction → inline lightweight
  if [[ "$needs_tool_use" == "false" && "$is_extraction" == "true" ]]; then
    executor="inline"
    tier="lightweight"
    model=""
    max_turns="3"
    reason="one-shot extraction, no tool use needed"
    confidence="0.95"
  
  # 2. Needs coordination → agent team
  elif [[ "$needs_coordination" == "true" ]]; then
    executor="team"
    tier="full"
    model=""
    reason="requires multi-agent coordination and shared state"
    confidence="0.85"
  
  # 3. Architectural → Architect subagent
  elif [[ "$is_architectural" == "true" && "$needs_tool_use" == "false" ]]; then
    executor="subagent"
    tier="full"
    model=""
    subagent_type="Architect"
    reason="architectural design, benefits from specialized agent"
    confidence="0.8"
  
  # 4. Long-horizon coding → Kimi K2.7
  elif [[ "$is_long_horizon" == "true" ]]; then
    executor="command-code"
    tier="full"
    model="moonshotai/Kimi-K2.7-Code"
    reason="long-horizon task benefits from 1M context and coding persistence"
    confidence="0.85"
  
  # 5. Validation/review → Gemini (fresh eyes)
  elif [[ "$is_validation" == "true" && "$needs_tool_use" == "false" ]]; then
    executor="command-code"
    tier="full"
    model="google/gemini-3.5-flash"
    reason="validation benefits from fresh perspective"
    confidence="0.75"
  
  # 6. Standard tool use → DeepSeek (fast)
  elif [[ "$needs_tool_use" == "true" && "$is_long_horizon" == "false" ]]; then
    executor="command-code"
    tier="full"
    model="deepseek/deepseek-v4-flash"
    reason="standard coding task benefits from fast iteration"
    confidence="0.8"
  fi
  
  # Output
  if [[ "$output_json" == "true" ]]; then
    cat <<EOF
{
  "executor": "$executor",
  "tier": "$tier",
  "model": ${model:+"\"$model\""}${model:-null},
  "subagentType": ${subagent_type:+"\"$subagent_type\""}${subagent_type:-null},
  "maxTurns": ${max_turns:-null},
  "reason": "$reason",
  "confidence": $confidence
}
EOF
  else
    echo "Executor:   $executor"
    echo "Tier:       $tier"
    [[ -n "$model" ]] && echo "Model:      $model"
    [[ -n "$subagent_type" ]] && echo "Subagent:   $subagent_type"
    [[ -n "$max_turns" ]] && echo "Max turns:  $max_turns"
    echo "Reason:     $reason"
    echo "Confidence: $confidence"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Command generation
# ─────────────────────────────────────────────────────────────────────────────

generate_command() {
  local desc="$1"
  
  # Route first
  local routing
  routing=$(route_task "$desc" true)
  
  local executor model max_turns
  executor=$(echo "$routing" | grep -o '"executor": "[^"]*"' | cut -d'"' -f4)
  model=$(echo "$routing" | grep -o '"model": "[^"]*"' | cut -d'"' -f4 || echo "")
  max_turns=$(echo "$routing" | grep -o '"maxTurns": [0-9]*' | cut -d':' -f2 | tr -d ' ' || echo "10")
  
  case "$executor" in
    inline)
      echo "# INLINE: Handle in current session"
      echo "# Task: $desc"
      ;;
    subagent)
      local subagent_type
      subagent_type=$(echo "$routing" | grep -o '"subagentType": "[^"]*"' | cut -d'"' -f4)
      echo "# SUBAGENT: Task(subagent_type=\"$subagent_type\", prompt=\"$desc\")"
      ;;
    command-code)
      echo "command-code \\"
      echo "  -p \"$desc\" \\"
      echo "  --model ${model:-claude-sonnet-5} \\"
      echo "  --max-turns ${max_turns:-10} \\"
      echo "  --trust \\"
      echo "  --skip-onboarding"
      ;;
    team)
      echo "# TEAM: TeamCreate + TaskCreate + spawn"
      echo "# Task: $desc"
      ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $0 [OPTIONS] "task description"

OPTIONS:
  --json          Output JSON format
  --command       Generate execution command
  --batch FILE    Route multiple tasks from JSON file
  -h, --help      Show this help

EXAMPLES:
  $0 "implement auth middleware"
  $0 --json "implement auth middleware"
  $0 --command "refactor the database layer"
EOF
}

main() {
  local json=false
  local command=false
  local batch=""
  local desc=""
  
  while [[ $# -gt 0 ]]; do
    case $1 in
      --json) json=true; shift ;;
      --command) command=true; shift ;;
      --batch) batch="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) desc="$1"; shift ;;
    esac
  done
  
  if [[ -n "$batch" ]]; then
    echo "Batch routing not implemented in bash version — use TypeScript" >&2
    exit 1
  fi
  
  if [[ -z "$desc" ]]; then
    usage
    exit 1
  fi
  
  if [[ "$command" == "true" ]]; then
    generate_command "$desc"
  else
    route_task "$desc" "$json"
  fi
}

main "$@"
