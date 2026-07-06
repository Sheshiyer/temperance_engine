#!/usr/bin/env bash
# package/router/parallel-backend-dispatch.sh
# Send a task to multiple backends in parallel and compare results
#
# Usage:
#   ./parallel-backend-dispatch.sh "task description"
#   ./parallel-backend-dispatch.sh --backends "kimi,grok" "task description"
#   ./parallel-backend-dispatch.sh --all "task description"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTER="$SCRIPT_DIR/multi-backend-router.sh"
OUTPUT_DIR="/tmp/temperance-parallel-$(date +%s)"

# ─────────────────────────────────────────────────────────────────────────────
# Backend Execution Functions
# ─────────────────────────────────────────────────────────────────────────────

run_command_code() {
  local desc="$1"
  local model="${2:-claude-sonnet-5}"
  local output_file="$OUTPUT_DIR/command-code.txt"
  
  echo "[command-code] Starting with model: $model" >&2
  local start_time=$(date +%s)
  
  if command-code -p "$desc" --model "$model" --max-turns 10 --trust --yolo --skip-onboarding > "$output_file" 2>&1; then
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    echo "[command-code] Completed in ${duration}s" >&2
    echo "$duration" > "$OUTPUT_DIR/command-code.time"
  else
    echo "[command-code] Failed" >&2
    echo "ERROR" > "$OUTPUT_DIR/command-code.time"
  fi
}

run_kimi() {
  local desc="$1"
  local model="${2:-kimi-code/kimi-for-coding}"
  local output_file="$OUTPUT_DIR/kimi.txt"
  
  echo "[kimi] Starting with model: $model" >&2
  local start_time=$(date +%s)
  
  if kimi --print --yolo --model "$model" -p "$desc" > "$output_file" 2>&1; then
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    echo "[kimi] Completed in ${duration}s" >&2
    echo "$duration" > "$OUTPUT_DIR/kimi.time"
  else
    echo "[kimi] Failed" >&2
    echo "ERROR" > "$OUTPUT_DIR/kimi.time"
  fi
}

run_grok() {
  local desc="$1"
  local model="${2:-grok-composer-2.5-fast}"
  local output_file="$OUTPUT_DIR/grok.txt"
  
  echo "[grok] Starting with model: $model" >&2
  local start_time=$(date +%s)
  
  if "$HOME/.grok/bin/grok" --model "$model" --always-approve "$desc" > "$output_file" 2>&1; then
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    echo "[grok] Completed in ${duration}s" >&2
    echo "$duration" > "$OUTPUT_DIR/grok.time"
  else
    echo "[grok] Failed" >&2
    echo "ERROR" > "$OUTPUT_DIR/grok.time"
  fi
}

run_nvidia() {
  local desc="$1"
  local model="${2:-nvidia/nemotron-3-ultra-550b}"
  local output_file="$OUTPUT_DIR/nvidia.txt"
  
  echo "[nvidia] Starting with model: $model" >&2
  local start_time=$(date +%s)
  
  local response
  response=$(curl -s https://integrate.api.nvidia.com/v1/chat/completions \
    -H "Authorization: Bearer $NVIDIA_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"$model\",
      \"messages\": [{\"role\": \"user\", \"content\": \"$desc\"}],
      \"max_tokens\": 4096
    }" 2>&1)
  
  local end_time=$(date +%s)
  local duration=$((end_time - start_time))
  
  if echo "$response" | jq -e '.choices[0].message.content' > /dev/null 2>&1; then
    echo "$response" | jq -r '.choices[0].message.content' > "$output_file"
    echo "[nvidia] Completed in ${duration}s" >&2
    echo "$duration" > "$OUTPUT_DIR/nvidia.time"
  else
    echo "$response" > "$output_file"
    echo "[nvidia] Failed" >&2
    echo "ERROR" > "$OUTPUT_DIR/nvidia.time"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Comparison Report
# ─────────────────────────────────────────────────────────────────────────────

generate_report() {
  local desc="$1"
  
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo "PARALLEL DISPATCH REPORT"
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo ""
  echo "Task: $desc"
  echo "Output directory: $OUTPUT_DIR"
  echo ""
  echo "───────────────────────────────────────────────────────────────────────────────"
  echo "TIMING"
  echo "───────────────────────────────────────────────────────────────────────────────"
  
  for backend in command-code kimi grok nvidia; do
    local time_file="$OUTPUT_DIR/$backend.time"
    local output_file="$OUTPUT_DIR/$backend.txt"
    
    if [[ -f "$time_file" ]]; then
      local duration=$(cat "$time_file")
      local size="N/A"
      [[ -f "$output_file" ]] && size=$(wc -c < "$output_file" | tr -d ' ')
      
      if [[ "$duration" == "ERROR" ]]; then
        printf "  %-15s %s\n" "$backend:" "FAILED"
      else
        printf "  %-15s %ss (%s bytes)\n" "$backend:" "$duration" "$size"
      fi
    fi
  done
  
  echo ""
  echo "───────────────────────────────────────────────────────────────────────────────"
  echo "OUTPUT PREVIEWS (first 500 chars)"
  echo "───────────────────────────────────────────────────────────────────────────────"
  
  for backend in command-code kimi grok nvidia; do
    local output_file="$OUTPUT_DIR/$backend.txt"
    
    if [[ -f "$output_file" ]]; then
      echo ""
      echo "[$backend]"
      head -c 500 "$output_file" | head -20
      echo ""
      echo "..."
    fi
  done
  
  echo ""
  echo "───────────────────────────────────────────────────────────────────────────────"
  echo "Full outputs saved to: $OUTPUT_DIR/"
  echo "───────────────────────────────────────────────────────────────────────────────"
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

usage() {
  cat << EOF
Usage: $0 [OPTIONS] "task description"

OPTIONS:
  --backends <list>   Comma-separated backends (command-code,kimi,grok,nvidia)
  --all               Use all available backends
  --compare-only      Show comparison of existing results (requires --output-dir)
  --output-dir <dir>  Custom output directory
  -h, --help          Show this help

EXAMPLES:
  $0 "implement authentication middleware"
  $0 --backends "kimi,grok" "refactor the API"
  $0 --all "analyze the codebase structure"
EOF
}

main() {
  local backends=""
  local all=false
  local compare_only=false
  local desc=""
  
  while [[ $# -gt 0 ]]; do
    case $1 in
      --backends) backends="$2"; shift 2 ;;
      --all) all=true; shift ;;
      --compare-only) compare_only=true; shift ;;
      --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) desc="$1"; shift ;;
    esac
  done
  
  if [[ -z "$desc" ]] && ! $compare_only; then
    usage
    exit 1
  fi
  
  # Create output directory
  mkdir -p "$OUTPUT_DIR"
  
  # Detect available backends
  local available
  available=$("$ROUTER" --list-backends 2>/dev/null | sed 's/Available backends: //')
  
  # Determine which backends to use
  local use_backends=()
  
  if $all; then
    use_backends=($available)
  elif [[ -n "$backends" ]]; then
    IFS=',' read -ra use_backends <<< "$backends"
  else
    # Default: use top 2 from routing
    local task_type
    task_type=$("$ROUTER" --json "$desc" 2>/dev/null | jq -r '.task_type // "balanced"')
    
    # Use primary + one alternate
    local primary
    primary=$("$ROUTER" --json "$desc" 2>/dev/null | jq -r '.backend // "command-code"')
    
    use_backends=("$primary")
    
    # Add one more for comparison
    for b in $available; do
      if [[ "$b" != "$primary" ]]; then
        use_backends+=("$b")
        break
      fi
    done
  fi
  
  echo "Dispatching to backends: ${use_backends[*]}"
  echo "Output directory: $OUTPUT_DIR"
  echo ""
  
  # Save task description
  echo "$desc" > "$OUTPUT_DIR/task.txt"
  
  # Launch backends in parallel
  local pids=()
  
  for backend in "${use_backends[@]}"; do
    case $backend in
      command-code)
        run_command_code "$desc" &
        pids+=($!)
        ;;
      kimi)
        run_kimi "$desc" &
        pids+=($!)
        ;;
      grok)
        run_grok "$desc" &
        pids+=($!)
        ;;
      nvidia)
        run_nvidia "$desc" &
        pids+=($!)
        ;;
    esac
  done
  
  # Wait for all to complete
  echo "Waiting for ${#pids[@]} backend(s) to complete..."
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  
  # Generate comparison report
  generate_report "$desc"
}

main "$@"
