#!/usr/bin/env bash
# scripts/parallel-dispatch.sh
# Dispatch multiple command-code sessions in parallel with SP0 enrichment.
#
# Usage:
#   ./parallel-dispatch.sh tasks.json
#   ./parallel-dispatch.sh --task "implement auth" --model deepseek-v4-flash
#   ./parallel-dispatch.sh --compare "implement auth" # same task, 3 models
#
# JSON format for tasks.json:
# [
#   { "task": "implement auth middleware", "model": "deepseek-v4-flash" },
#   { "task": "write tests for auth", "model": "kimi-k2.7-code" },
#   { "task": "document auth flow", "model": "claude-sonnet-5" }
# ]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ADAPTER="$REPO_ROOT/package/adapters/command-code/generate-agents-md.sh"
DISPATCH_DIR="${TEMPERANCE_DISPATCH_DIR:-/tmp/temperance-dispatch}"
LOG_DIR="$DISPATCH_DIR/logs"

# Model selection matrix for compare mode
COMPARE_MODELS=(
  "deepseek-v4-flash"    # Fast draft
  "kimi-k2.7-code"       # Long-horizon coding
  "claude-sonnet-5"      # Balanced intelligence
)

# Cleanup trap
cleanup() {
  echo "[dispatch] Cleaning up..."
  # Kill any remaining background processes
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT

usage() {
  cat <<EOF
Usage: $0 [OPTIONS]

OPTIONS:
  --task "..."              Single task to dispatch
  --model <model>           Model for single task (default: deepseek-v4-flash)
  --compare "..."           Same task to 3 models for comparison
  --tasks-file <path>       JSON file with task array
  --cwd <path>              Working directory (default: current)
  --max-turns <n>           Max conversation turns (default: 10)
  --output-dir <path>       Output directory for results
  --dry-run                 Print commands without executing
  -h, --help                Show this help

EXAMPLES:
  # Single task
  $0 --task "implement auth middleware" --model deepseek-v4-flash

  # Compare 3 models on same task
  $0 --compare "implement auth middleware"

  # Multiple tasks from file
  $0 --tasks-file tasks.json
EOF
}

# Parse arguments
TASK=""
MODEL="deepseek-v4-flash"
COMPARE=""
TASKS_FILE=""
CWD="$(pwd)"
MAX_TURNS=10
OUTPUT_DIR=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --task) TASK="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --compare) COMPARE="$2"; shift 2 ;;
    --tasks-file) TASKS_FILE="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    --max-turns) MAX_TURNS="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

# Setup directories
mkdir -p "$DISPATCH_DIR" "$LOG_DIR"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULT_DIR="${OUTPUT_DIR:-$DISPATCH_DIR/results/$TIMESTAMP}"
mkdir -p "$RESULT_DIR"

# Generate enriched AGENTS.md for a task
generate_workspace() {
  local task="$1"
  local model="$2"
  local workspace="$DISPATCH_DIR/workspaces/${model//\//_}_$$"
  
  mkdir -p "$workspace"
  
  # Generate AGENTS.md with SP0 enrichment (bash adapter)
  if [[ -x "$ADAPTER" ]]; then
    "$ADAPTER" \
      --task "$task" \
      --cwd "$CWD" \
      --model "$model" \
      --max-turns "$MAX_TURNS" \
      > "$workspace/AGENTS.md" 2>/dev/null || {
        # Fallback: create minimal AGENTS.md
        cat > "$workspace/AGENTS.md" <<EOF
# Task Context

**Objective:** $task
**Model:** $model

Follow best practices and verify your work.
EOF
      }
  else
    # Fallback: create minimal AGENTS.md
    cat > "$workspace/AGENTS.md" <<EOF
# Task Context

**Objective:** $task
**Model:** $model

Follow best practices and verify your work.
EOF
  fi
  
  echo "$workspace"
}

# Dispatch a single command-code session
dispatch_one() {
  local task="$1"
  local model="$2"
  local id="$3"
  local workspace
  
  workspace=$(generate_workspace "$task" "$model")
  local log_file="$LOG_DIR/${model//\//_}_${id}.log"
  local result_file="$RESULT_DIR/${model//\//_}_${id}.md"
  
  echo "[dispatch:$id] Starting: model=$model task='${task:0:40}...'"
  
  local cmd=(
    command-code
    -p "$task"
    --model "$model"
    --max-turns "$MAX_TURNS"
    --add-dir "$workspace"
    --trust
    --skip-onboarding
  )
  
  if $DRY_RUN; then
    echo "[dry-run:$id] ${cmd[*]}"
    return 0
  fi
  
  # Run and capture output
  {
    echo "# Dispatch Result"
    echo ""
    echo "- **Task:** $task"
    echo "- **Model:** $model"
    echo "- **Timestamp:** $(date -Iseconds)"
    echo "- **Workspace:** $workspace"
    echo ""
    echo "## Output"
    echo ""
    echo '```'
    "${cmd[@]}" 2>&1 || echo "[ERROR] command-code exited with code $?"
    echo '```'
    echo ""
    echo "## Workspace AGENTS.md"
    echo ""
    echo '```markdown'
    cat "$workspace/AGENTS.md"
    echo '```'
  } > "$result_file" 2>&1
  
  echo "[dispatch:$id] Complete: $result_file"
}

# Compare mode: same task, 3 models
dispatch_compare() {
  local task="$1"
  local pids=()
  local id=0
  
  echo "[dispatch] Compare mode: dispatching to ${#COMPARE_MODELS[@]} models"
  echo "[dispatch] Task: $task"
  echo ""
  
  for model in "${COMPARE_MODELS[@]}"; do
    dispatch_one "$task" "$model" "$id" &
    pids+=($!)
    ((id++))
  done
  
  echo "[dispatch] Waiting for ${#pids[@]} processes..."
  
  local failed=0
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      ((failed++))
    fi
  done
  
  echo ""
  echo "[dispatch] Complete: $((${#pids[@]} - failed))/${#pids[@]} succeeded"
  echo "[dispatch] Results in: $RESULT_DIR"
  
  # Generate comparison summary
  {
    echo "# Comparison Summary"
    echo ""
    echo "Task: $task"
    echo "Timestamp: $(date -Iseconds)"
    echo ""
    echo "## Results"
    echo ""
    for f in "$RESULT_DIR"/*.md; do
      [[ -f "$f" ]] || continue
      local model_name
      model_name=$(basename "$f" .md | sed 's/_[0-9]*$//')
      echo "- [$model_name](./$( basename "$f"))"
    done
  } > "$RESULT_DIR/SUMMARY.md"
  
  return $failed
}

# Multi-task mode from JSON file
dispatch_tasks_file() {
  local file="$1"
  
  if ! command -v jq &>/dev/null; then
    echo "Error: jq required for tasks-file mode"
    exit 1
  fi
  
  local count
  count=$(jq 'length' "$file")
  echo "[dispatch] Processing $count tasks from $file"
  
  local pids=()
  local id=0
  
  while IFS= read -r line; do
    local task model
    task=$(echo "$line" | jq -r '.task')
    model=$(echo "$line" | jq -r '.model // "deepseek-v4-flash"')
    
    dispatch_one "$task" "$model" "$id" &
    pids+=($!)
    ((id++))
  done < <(jq -c '.[]' "$file")
  
  echo "[dispatch] Waiting for ${#pids[@]} processes..."
  
  local failed=0
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      ((failed++))
    fi
  done
  
  echo ""
  echo "[dispatch] Complete: $((${#pids[@]} - failed))/${#pids[@]} succeeded"
  echo "[dispatch] Results in: $RESULT_DIR"
  
  return $failed
}

# Main dispatch logic
main() {
  # Verify command-code is available
  if ! command -v command-code &>/dev/null; then
    echo "Error: command-code not found. Install with: npm i -g command-code@latest"
    exit 1
  fi
  
  # Check auth
  if ! command-code status 2>&1 | grep -q "Authenticated"; then
    echo "Error: command-code not authenticated. Run: command-code login"
    exit 1
  fi
  
  echo "=================================="
  echo "Temperance Engine Parallel Dispatch"
  echo "=================================="
  echo ""
  
  if [[ -n "$COMPARE" ]]; then
    dispatch_compare "$COMPARE"
  elif [[ -n "$TASKS_FILE" ]]; then
    dispatch_tasks_file "$TASKS_FILE"
  elif [[ -n "$TASK" ]]; then
    dispatch_one "$TASK" "$MODEL" "0"
    echo ""
    echo "[dispatch] Result: $RESULT_DIR"
  else
    echo "Error: No task specified"
    usage
    exit 1
  fi
}

main "$@"
