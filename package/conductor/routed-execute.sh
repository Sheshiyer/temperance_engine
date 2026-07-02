#!/usr/bin/env bash
# package/conductor/routed-execute.sh
# Conductor Execute phase with task-model routing.
#
# This is the integration point between the conductor loop and the multi-model
# dispatch system. It reads tasks from tasks.md, routes each to an optimal
# executor using the task-model-router, and dispatches accordingly.
#
# Usage:
#   ./routed-execute.sh tasks.md [plan.md]
#   ./routed-execute.sh --dry-run tasks.md
#
# Integration with conducty:
#   In conducty-execute, replace the general-purpose dispatch with:
#   routed-execute.sh "$TASKS_FILE" "$PLAN_FILE"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
ROUTER="$REPO_ROOT/package/router/multi-backend-router.sh"
PARALLEL_DISPATCH="$REPO_ROOT/package/router/parallel-backend-dispatch.sh"

# ─────────────────────────────────────────────────────────────────────────────
# Parse arguments
# ─────────────────────────────────────────────────────────────────────────────

DRY_RUN=false
TASKS_FILE=""
PLAN_FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true; shift ;;
    *.md)
      if [[ -z "$TASKS_FILE" ]]; then
        TASKS_FILE="$1"
      else
        PLAN_FILE="$1"
      fi
      shift
      ;;
    *) shift ;;
  esac
done

if [[ -z "$TASKS_FILE" || ! -f "$TASKS_FILE" ]]; then
  echo "Usage: $0 [--dry-run] tasks.md [plan.md]" >&2
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Parse tasks.md (checkbox grammar)
# ─────────────────────────────────────────────────────────────────────────────

parse_tasks() {
  local file="$1"
  
  # Extract unchecked tasks: - [ ] T## [P] description
  # Output: task_id|is_parallel|description
  grep -E '^\s*-\s*\[\s*\]' "$file" | while read -r line; do
    # Extract task ID (T## format)
    local task_id
    task_id=$(echo "$line" | grep -oE 'T[0-9]+' | head -1 || echo "")
    
    # Check if parallel [P]
    local is_parallel="false"
    if echo "$line" | grep -q '\[P\]'; then
      is_parallel="true"
    fi
    
    # Extract description (everything after the checkbox markers)
    local desc
    desc=$(echo "$line" | sed 's/.*\] *//' | sed 's/\[P\] *//' | sed 's/T[0-9]* *//')
    
    echo "${task_id:-TASK}|$is_parallel|$desc"
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# Route and dispatch
# ─────────────────────────────────────────────────────────────────────────────

route_and_dispatch() {
  local tasks_output
  tasks_output=$(parse_tasks "$TASKS_FILE")
  
  if [[ -z "$tasks_output" ]]; then
    echo "[conductor] No unchecked tasks found in $TASKS_FILE"
    exit 0
  fi
  
  local task_count
  task_count=$(echo "$tasks_output" | wc -l | tr -d ' ')
  
  echo "=============================================="
  echo "Temperance Engine Routed Execute"
  echo "=============================================="
  echo "Tasks file: $TASKS_FILE"
  echo "Tasks to execute: $task_count"
  echo ""
  
  # Collect parallel and sequential tasks
  local parallel_tasks=()
  local sequential_tasks=()
  
  while IFS='|' read -r task_id is_parallel desc; do
    [[ -z "$desc" ]] && continue
    
    # Route the task via multi-backend router
    local routing
    routing=$("$ROUTER" --json "$desc" 2>/dev/null || echo '{"task_type":"balanced","backend":"command-code","model":"claude-sonnet-5"}')
    
    local task_type backend model
    task_type=$(echo "$routing" | jq -r '.task_type // "balanced"')
    backend=$(echo "$routing" | jq -r '.backend // "command-code"')
    model=$(echo "$routing" | jq -r '.model // "claude-sonnet-5"')
    
    echo "[$task_id] $desc"
    echo "  → Task type: $task_type"
    echo "  → Backend: $backend"
    echo "  → Model: $model"
    echo ""
    
    # Collect for dispatch
    if [[ "$is_parallel" == "true" ]]; then
      parallel_tasks+=("$task_id|$backend|$model|$desc")
    else
      sequential_tasks+=("$task_id|$backend|$model|$desc")
    fi
  done <<< "$tasks_output"
  
  if $DRY_RUN; then
    echo "[dry-run] Would dispatch:"
    echo "  Parallel: ${#parallel_tasks[@]}"
    echo "  Sequential: ${#sequential_tasks[@]}"
    return 0
  fi
  
  # ─────────────────────────────────────────────────────────────────────────
  # Execute parallel tasks
  # ─────────────────────────────────────────────────────────────────────────
  
  if [[ ${#parallel_tasks[@]} -gt 0 ]]; then
    echo "=== Parallel Execution (${#parallel_tasks[@]} tasks) ==="
    
    local pids=()
    local results_dir="/tmp/temperance-conductor/results/$(date +%Y%m%dT%H%M%S)"
    mkdir -p "$results_dir"
    
    for task_entry in "${parallel_tasks[@]}"; do
      IFS='|' read -r task_id backend model desc <<< "$task_entry"
      
      echo "[parallel:$task_id] Starting via $backend: $desc"
      
      case "$backend" in
        command-code)
          (command-code -p "$desc" --model "${model:-claude-sonnet-5}" --max-turns 10 --trust --skip-onboarding > "$results_dir/$task_id.log" 2>&1; echo "exit:$?" >> "$results_dir/$task_id.log") &
          pids+=($!)
          ;;
        
        kimi)
          (kimi --print --yolo --model "${model:-kimi-code/kimi-for-coding}" -p "$desc" > "$results_dir/$task_id.log" 2>&1; echo "exit:$?" >> "$results_dir/$task_id.log") &
          pids+=($!)
          ;;
        
        grok)
          ("$HOME/.grok/bin/grok" --model "${model:-grok-composer-2.5-fast}" --always-approve "$desc" > "$results_dir/$task_id.log" 2>&1; echo "exit:$?" >> "$results_dir/$task_id.log") &
          pids+=($!)
          ;;
        
        nvidia)
          (curl -s https://integrate.api.nvidia.com/v1/chat/completions \
            -H "Authorization: Bearer $NVIDIA_API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"model\": \"${model:-nvidia/nemotron-3-ultra-550b}\", \"messages\": [{\"role\": \"user\", \"content\": \"$desc\"}], \"max_tokens\": 4096}" \
            | jq -r '.choices[0].message.content // .error.message // "Error"' > "$results_dir/$task_id.log" 2>&1; echo "exit:$?" >> "$results_dir/$task_id.log") &
          pids+=($!)
          ;;
        
        inline)
          echo "[parallel:$task_id] INLINE task - handle in current session"
          ;;
        
        *)
          echo "[parallel:$task_id] Unknown backend: $backend"
          ;;
      esac
    done
    
    # Wait for parallel tasks
    if [[ ${#pids[@]} -gt 0 ]]; then
      echo "[parallel] Waiting for ${#pids[@]} processes..."
      local failed=0
      for pid in "${pids[@]}"; do
        if ! wait "$pid" 2>/dev/null; then
          ((failed++))
        fi
      done
      echo "[parallel] Complete: $((${#pids[@]} - failed))/${#pids[@]} succeeded"
      echo "[parallel] Results in: $results_dir"
    fi
    
    echo ""
  fi
  
  # ─────────────────────────────────────────────────────────────────────────
  # Execute sequential tasks
  # ─────────────────────────────────────────────────────────────────────────
  
  if [[ ${#sequential_tasks[@]} -gt 0 ]]; then
    echo "=== Sequential Execution (${#sequential_tasks[@]} tasks) ==="
    
    for task_entry in "${sequential_tasks[@]}"; do
      IFS='|' read -r task_id backend model desc <<< "$task_entry"
      
      echo "[sequential:$task_id] Executing via $backend: $desc"
      
      case "$backend" in
        command-code)
          command-code \
            -p "$desc" \
            --model "${model:-claude-sonnet-5}" \
            --max-turns 10 \
            --trust \
            --skip-onboarding \
            || echo "[sequential:$task_id] Failed with exit code $?"
          ;;
        
        kimi)
          kimi --print --yolo --model "${model:-kimi-code/kimi-for-coding}" -p "$desc" \
            || echo "[sequential:$task_id] Failed with exit code $?"
          ;;
        
        grok)
          "$HOME/.grok/bin/grok" --model "${model:-grok-composer-2.5-fast}" --always-approve "$desc" \
            || echo "[sequential:$task_id] Failed with exit code $?"
          ;;
        
        nvidia)
          curl -s https://integrate.api.nvidia.com/v1/chat/completions \
            -H "Authorization: Bearer $NVIDIA_API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"model\": \"${model:-nvidia/nemotron-3-ultra-550b}\", \"messages\": [{\"role\": \"user\", \"content\": \"$desc\"}], \"max_tokens\": 4096}" \
            | jq -r '.choices[0].message.content // .error.message // "Error"' \
            || echo "[sequential:$task_id] Failed with exit code $?"
          ;;
        
        inline)
          echo "[sequential:$task_id] INLINE task - handle in current session"
          ;;
        
        subagent)
          echo "[sequential:$task_id] SUBAGENT task - use Task() tool"
          ;;
        
        team)
          echo "[sequential:$task_id] TEAM task - use TeamCreate flow"
          ;;
        
        *)
          echo "[sequential:$task_id] Unknown backend: $backend"
          ;;
      esac
      
      echo ""
    done
  fi
  
  echo "=============================================="
  echo "Routed Execute Complete"
  echo "=============================================="
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

main() {
  # Verify dependencies
  if [[ ! -x "$ROUTER" ]]; then
    echo "Error: Router not found at $ROUTER" >&2
    exit 1
  fi
  
  if ! command -v command-code &>/dev/null; then
    echo "Warning: command-code not found. External dispatch will fail." >&2
  fi
  
  route_and_dispatch
}

main
