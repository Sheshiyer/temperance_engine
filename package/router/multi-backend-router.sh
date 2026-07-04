#!/usr/bin/env bash
# package/router/multi-backend-router.sh
# Unified router across multiple model backends:
# - Command Code (35 models)
# - Kimi CLI (K2.7 Code)
# - Grok CLI (grok-composer-2.5-fast, grok-build)
# - NVIDIA API (Nemotron models via curl)
# - OpenRouter (aggregator, if configured)
#
# Usage:
#   ./multi-backend-router.sh "task description"
#   ./multi-backend-router.sh --json "task description"
#   ./multi-backend-router.sh --command "task description"
#   ./multi-backend-router.sh --execute "task description"
#   ./multi-backend-router.sh --backend kimi "task description"
#   ./multi-backend-router.sh --list-backends
#   ./multi-backend-router.sh --timeout 120 --execute "task description"
#
# Latency Characteristics:
#   Backend         Startup    Simple Task    Complex Task    Recommended Timeout
#   command-code    ~10s       15-20s         30-120s         180s for complex
#   kimi            ~3s        10-15s         30-60s          120s
#   grok            ~5s        10-15s         20-40s          90s
#   nvidia (API)    ~1s        5-10s          15-30s          60s
#
# Note: command-code has higher latency due to agentic execution model.
# For time-critical tasks, prefer kimi or grok.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─────────────────────────────────────────────────────────────────────────────
# Backend Detection
# ─────────────────────────────────────────────────────────────────────────────

detect_backends() {
  if [[ -n "${TEMPERANCE_BACKENDS+x}" ]]; then
    # Caller supplied the list (may be empty = none). Skip the ~10s status probe.
    echo "${TEMPERANCE_BACKENDS}"
    return
  fi
  local backends=()

  # Command Code
  if command -v command-code &>/dev/null; then
    if command-code status 2>&1 | grep -q "Authenticated"; then
      backends+=("command-code")
    fi
  fi
  
  # Kimi
  if command -v kimi &>/dev/null; then
    backends+=("kimi")
  fi
  
  # Grok
  if [[ -x "$HOME/.grok/bin/grok" ]]; then
    backends+=("grok")
  fi
  
  # NVIDIA API
  if [[ -n "${NVIDIA_API_KEY:-}" ]]; then
    backends+=("nvidia")
  fi
  
  # OpenRouter
  if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
    backends+=("openrouter")
  fi
  
  echo "${backends[*]}"
}

# ─────────────────────────────────────────────────────────────────────────────
# Model Catalog
# ─────────────────────────────────────────────────────────────────────────────

# Format: backend:model → tier:strength:context
declare -A MODEL_CATALOG=(
  # Command Code
  ["command-code:deepseek/deepseek-v4-flash"]="fast:speed:128k"
  ["command-code:deepseek/deepseek-v4-pro"]="deep:reasoning:128k"
  ["command-code:moonshotai/Kimi-K2.7-Code"]="deep:long-horizon:1M"
  ["command-code:claude-sonnet-5"]="balanced:balanced:200k"
  ["command-code:claude-fable-5"]="premium:reasoning:200k"
  ["command-code:google/gemini-3.5-flash"]="fast:parallel:1M"
  ["command-code:Qwen/Qwen3.7-Max"]="deep:frontier:128k"
  ["command-code:gpt-5.5"]="premium:general:128k"
  
  # Kimi (direct)
  ["kimi:kimi-code/kimi-for-coding"]="deep:coding:262k"
  
  # Grok
  ["grok:grok-composer-2.5-fast"]="fast:creative:128k"
  ["grok:grok-build"]="balanced:coding:128k"
  
  # NVIDIA
  ["nvidia:nvidia/nemotron-3-ultra-550b"]="premium:reasoning:128k"
  ["nvidia:nvidia/llama-3.3-nemotron-super-49b"]="balanced:efficient:128k"
)

# ─────────────────────────────────────────────────────────────────────────────
# Routing Rules
# ─────────────────────────────────────────────────────────────────────────────

# Priority order for each task type (Command Code primary, others fallback)
declare -A ROUTING_PRIORITY=(
  # Fast iteration - DeepSeek Flash primary, Grok fallback
  ["fast"]="command-code:deepseek/deepseek-v4-flash grok:grok-composer-2.5-fast kimi:kimi-code/kimi-for-coding"
  
  # Long-horizon coding - Kimi K2.7 via Command Code primary, direct Kimi fallback
  ["long-horizon"]="command-code:moonshotai/Kimi-K2.7-Code kimi:kimi-code/kimi-for-coding command-code:Qwen/Qwen3.7-Max"
  
  # Complex reasoning - Claude Fable primary, NVIDIA fallback
  ["reasoning"]="command-code:claude-fable-5 command-code:deepseek/deepseek-v4-pro nvidia:nvidia/nemotron-3-ultra-550b"
  
  # Validation/review - Gemini Flash primary, Grok fallback
  ["validation"]="command-code:google/gemini-3.5-flash grok:grok-build command-code:claude-sonnet-5"
  
  # Creative/exploratory - Sonnet primary, Grok fallback
  ["creative"]="command-code:claude-sonnet-5 grok:grok-composer-2.5-fast kimi:kimi-code/kimi-for-coding"
  
  # Default balanced - Sonnet primary
  ["balanced"]="command-code:claude-sonnet-5 grok:grok-build kimi:kimi-code/kimi-for-coding nvidia:nvidia/llama-3.3-nemotron-super-49b"
)

# ─────────────────────────────────────────────────────────────────────────────
# Complexity Analysis
# ─────────────────────────────────────────────────────────────────────────────

analyze_task_type() {
  local desc="$1"
  local lower_desc
  lower_desc=$(echo "$desc" | tr '[:upper:]' '[:lower:]')
  
  # Long-horizon
  if echo "$lower_desc" | grep -qE '\b(refactor|rewrite|migrate|redesign|overhaul|restructure|entire|all files|across.*files)\b'; then
    echo "long-horizon"
    return
  fi
  
  # Reasoning
  if echo "$lower_desc" | grep -qE '\b(analyze|debug|diagnose|explain|understand|reason|think|complex|difficult)\b'; then
    echo "reasoning"
    return
  fi
  
  # Validation
  if echo "$lower_desc" | grep -qE '\b(validate|verify|review|check|audit|test|ensure|confirm)\b'; then
    echo "validation"
    return
  fi
  
  # Creative
  if echo "$lower_desc" | grep -qE '\b(brainstorm|creative|design|explore|imagine|ideate|alternative)\b'; then
    echo "creative"
    return
  fi
  
  # Fast (simple tasks)
  if echo "$lower_desc" | grep -qE '\b(quick|simple|small|minor|tweak|fix typo|update comment)\b'; then
    echo "fast"
    return
  fi
  
  # Check for extraction (inline)
  if echo "$lower_desc" | grep -qE '\b(extract|classify|summarize|list|identify|find|count)\b'; then
    if ! echo "$lower_desc" | grep -qE '\b(read|search|grep|edit|write|run|execute|test|build|compile)\b'; then
      echo "inline"
      return
    fi
  fi
  
  # Default
  echo "balanced"
}

# ─────────────────────────────────────────────────────────────────────────────
# Route Selection
# ─────────────────────────────────────────────────────────────────────────────

select_route() {
  local task_type="$1"
  local force_backend="${2:-}"
  
  local available_backends
  available_backends=$(detect_backends)
  
  # If forcing a backend
  if [[ -n "$force_backend" ]]; then
    if echo "$available_backends" | grep -qw "$force_backend"; then
      # Return first model for that backend
      local priority="${ROUTING_PRIORITY[$task_type]:-${ROUTING_PRIORITY[balanced]}}"
      for route in $priority; do
        local backend="${route%%:*}"
        if [[ "$backend" == "$force_backend" ]]; then
          echo "$route"
          return
        fi
      done
      # Fallback to default model for backend
      case "$force_backend" in
        command-code) echo "command-code:claude-sonnet-5" ;;
        kimi) echo "kimi:kimi-code/kimi-for-coding" ;;
        grok) echo "grok:grok-composer-2.5-fast" ;;
        nvidia) echo "nvidia:nvidia/nemotron-3-ultra-550b" ;;
        *) echo "command-code:claude-sonnet-5" ;;
      esac
      return
    else
      echo "ERROR: Backend '$force_backend' not available" >&2
      return 1
    fi
  fi
  
  # Get priority list for task type
  local priority="${ROUTING_PRIORITY[$task_type]:-${ROUTING_PRIORITY[balanced]}}"
  
  # Find first available backend:model
  for route in $priority; do
    local backend="${route%%:*}"
    if echo "$available_backends" | grep -qw "$backend"; then
      echo "$route"
      return
    fi
  done
  
  # Absolute fallback
  echo "command-code:claude-sonnet-5"
}

# ─────────────────────────────────────────────────────────────────────────────
# Route-Only Selection (programmatic; no command generation/execution)
# ─────────────────────────────────────────────────────────────────────────────

route_only() {
  local desc="$1"
  local task_type
  task_type=$(analyze_task_type "$desc")
  if [[ "$task_type" == "inline" ]]; then
    printf 'inline\t-\n'; return
  fi
  local avail
  avail=$(detect_backends)
  if [[ -z "${avail// }" ]]; then
    printf 'none\t-\n'; return
  fi
  local route
  route=$(select_route "$task_type" "$FORCE_BACKEND")
  local backend="${route%%:*}" model="${route#*:}"
  [[ -n "$FORCE_MODEL" ]] && model="$FORCE_MODEL"
  # Guard the phantom fallback: if selected backend is not actually available, report none.
  if ! echo " $avail " | grep -q " $backend "; then
    printf 'none\t-\n'; return
  fi
  printf '%s\t%s\n' "$backend" "$model"
}

# ─────────────────────────────────────────────────────────────────────────────
# Command Generation
# ─────────────────────────────────────────────────────────────────────────────

generate_command() {
  local route="$1"
  local desc="$2"
  local max_turns="${3:-10}"
  
  local backend="${route%%:*}"
  local model="${route#*:}"
  
  # Escape description for shell
  local escaped_desc="${desc//\"/\\\"}"
  
  case "$backend" in
    command-code)
      echo "command-code -p \"$escaped_desc\" --model $model --max-turns $max_turns --trust --skip-onboarding"
      ;;
    
    kimi)
      echo "kimi --print --yolo --model $model -p \"$escaped_desc\""
      ;;
    
    grok)
      echo "$HOME/.grok/bin/grok --model $model --always-approve \"$escaped_desc\""
      ;;
    
    nvidia)
      # NVIDIA API via curl (simplified)
      cat << EOF
curl -s https://integrate.api.nvidia.com/v1/chat/completions \\
  -H "Authorization: Bearer \$NVIDIA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "$model",
    "messages": [{"role": "user", "content": "$escaped_desc"}],
    "max_tokens": 4096
  }'
EOF
      ;;
    
    *)
      echo "# Unknown backend: $backend"
      ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# Execution
# ─────────────────────────────────────────────────────────────────────────────

execute_route() {
  local route="$1"
  local desc="$2"
  local max_turns="${3:-10}"
  
  local backend="${route%%:*}"
  local model="${route#*:}"
  
  case "$backend" in
    command-code)
      command-code -p "$desc" --model "$model" --max-turns "$max_turns" --trust --skip-onboarding
      ;;
    
    kimi)
      kimi --print --yolo --model "$model" -p "$desc"
      ;;
    
    grok)
      "$HOME/.grok/bin/grok" --model "$model" --always-approve "$desc"
      ;;
    
    nvidia)
      curl -s https://integrate.api.nvidia.com/v1/chat/completions \
        -H "Authorization: Bearer $NVIDIA_API_KEY" \
        -H "Content-Type: application/json" \
        -d "{
          \"model\": \"$model\",
          \"messages\": [{\"role\": \"user\", \"content\": \"$desc\"}],
          \"max_tokens\": 4096
        }" | jq -r '.choices[0].message.content // .error.message // "Error"'
      ;;
    
    *)
      echo "Unknown backend: $backend" >&2
      return 1
      ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# Output Formatting
# ─────────────────────────────────────────────────────────────────────────────

output_json() {
  local desc="$1"
  local task_type="$2"
  local route="$3"
  local backend="${route%%:*}"
  local model="${route#*:}"
  local info="${MODEL_CATALOG[$route]:-unknown:unknown:unknown}"
  local tier="${info%%:*}"
  local rest="${info#*:}"
  local strength="${rest%%:*}"
  local context="${rest#*:}"
  
  cat << EOF
{
  "task": "$desc",
  "task_type": "$task_type",
  "backend": "$backend",
  "model": "$model",
  "tier": "$tier",
  "strength": "$strength",
  "context_window": "$context",
  "available_backends": "$(detect_backends)"
}
EOF
}

output_human() {
  local desc="$1"
  local task_type="$2"
  local route="$3"
  local backend="${route%%:*}"
  local model="${route#*:}"
  local info="${MODEL_CATALOG[$route]:-unknown:unknown:unknown}"
  local tier="${info%%:*}"
  local rest="${info#*:}"
  local strength="${rest%%:*}"
  local context="${rest#*:}"
  
  echo "Task type:    $task_type"
  echo "Backend:      $backend"
  echo "Model:        $model"
  echo "Tier:         $tier"
  echo "Strength:     $strength"
  echo "Context:      $context"
  echo ""
  echo "Available backends: $(detect_backends)"
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

usage() {
  cat << EOF
Usage: $0 [OPTIONS] "task description"

OPTIONS:
  --json              Output JSON format
  --command           Generate execution command (don't execute)
  --execute           Execute the routed task
  --backend <name>    Force specific backend (command-code, kimi, grok, nvidia)
  --model <name>      Force specific model (used with --route-only)
  --route-only        Print "BACKEND<TAB>MODEL" and exit (for programmatic callers)
  --list-backends     List available backends and exit
  --list-models       List all models in catalog
  -h, --help          Show this help

BACKENDS:
  command-code        35 models via Command Code CLI
  kimi                K2.7 Code via Kimi CLI
  grok                grok-composer-2.5-fast, grok-build via Grok CLI
  nvidia              Nemotron models via NVIDIA API

EXAMPLES:
  $0 "implement auth middleware"
  $0 --json "refactor the entire database layer"
  $0 --command "implement auth middleware"
  $0 --execute "quick fix: update comment"
  $0 --backend kimi "long coding task"
  $0 --list-backends
EOF
}

main() {
  local json=false
  local command=false
  local execute=false
  local route_only_mode=false
  declare -g FORCE_BACKEND=""
  declare -g FORCE_MODEL=""
  local desc=""

  while [[ $# -gt 0 ]]; do
    case $1 in
      --json) json=true; shift ;;
      --command) command=true; shift ;;
      --execute) execute=true; shift ;;
      --route-only) route_only_mode=true; shift ;;
      --model) FORCE_MODEL="$2"; shift 2 ;;
      --backend) FORCE_BACKEND="$2"; shift 2 ;;
      --list-backends)
        echo "Available backends: $(detect_backends)"
        exit 0
        ;;
      --list-models)
        echo "Model catalog:"
        for key in "${!MODEL_CATALOG[@]}"; do
          echo "  $key → ${MODEL_CATALOG[$key]}"
        done | sort
        exit 0
        ;;
      -h|--help) usage; exit 0 ;;
      *) desc="$1"; shift ;;
    esac
  done

  if [[ -z "$desc" ]]; then
    usage
    exit 1
  fi

  if $route_only_mode; then
    route_only "$desc"
    exit 0
  fi

  # Analyze task
  local task_type
  task_type=$(analyze_task_type "$desc")
  
  # Handle inline tasks
  if [[ "$task_type" == "inline" ]]; then
    if $json; then
      echo '{"task_type": "inline", "executor": "inline", "reason": "one-shot extraction, no external dispatch"}'
    else
      echo "Task type:    inline"
      echo "Executor:     inline (handle in current session)"
      echo "Reason:       one-shot extraction, no external dispatch needed"
    fi
    exit 0
  fi
  
  # Select route
  local route
  route=$(select_route "$task_type" "$FORCE_BACKEND")
  
  if $json; then
    output_json "$desc" "$task_type" "$route"
  elif $command; then
    generate_command "$route" "$desc"
  elif $execute; then
    echo "Executing via $route..."
    echo ""
    execute_route "$route" "$desc"
  else
    output_human "$desc" "$task_type" "$route"
  fi
}

main "$@"
