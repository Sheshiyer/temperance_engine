#!/usr/bin/env bash
# package/adapters/opencode/PromptProcessing.hook.sh
# OpenCode surface adapter for SP0 enrichment.
#
# This is the OpenCode equivalent of Claude Code's PromptProcessing.hook.ts.
# It runs the SP0 enrichment pipeline and emits a <temperance-context> block.
#
# Installation:
#   Copy to ~/.config/opencode/hooks/PromptProcessing.hook.sh
#   Or symlink: ln -s <this-file> ~/.config/opencode/hooks/PromptProcessing.hook.sh
#   Configure in opencode.json:
#   { "hooks": { "prompt_processing": "~/.config/opencode/hooks/PromptProcessing.hook.sh" } }
#
# Fail-open: if enrichment fails, falls back to basic mode classification.

set -u

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

ENRICH_DIR="${TEMPERANCE_ENRICH_DIR:-$HOME/.config/opencode/PAI/enrich}"
CWD="${OPENCODE_PROJECT_DIR:-$PWD}"
SURFACE="opencode"

# Fallback to Claude's PAI dir if opencode-specific doesn't exist
if [ ! -d "$ENRICH_DIR" ]; then
  ENRICH_DIR="$HOME/.claude/PAI/enrich"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Read prompt from stdin
# ─────────────────────────────────────────────────────────────────────────────

PROMPT=""
if [ -t 0 ]; then
  PROMPT=""
else
  PROMPT=$(cat)
fi

# ─────────────────────────────────────────────────────────────────────────────
# Mode classification (fallback if enrichment unavailable)
# ─────────────────────────────────────────────────────────────────────────────

classify_mode() {
  local prompt="$1"
  local lower_prompt
  lower_prompt=$(echo "$prompt" | tr '[:upper:]' '[:lower:]')
  
  # MINIMAL: greetings, acknowledgments
  if echo "$lower_prompt" | grep -qE '^\s*(hi|hello|thanks|ok|yes|no|sure|got it)\s*$'; then
    echo "MINIMAL"
    return
  fi
  
  # ALGORITHM: complex multi-step work
  if echo "$lower_prompt" | grep -qE '\b(build|implement|refactor|debug|fix|create|design|architect|migrate)\b'; then
    echo "ALGORITHM"
    return
  fi
  
  # Default: NATIVE
  echo "NATIVE"
}

# ─────────────────────────────────────────────────────────────────────────────
# ISA resolution (multi-source)
# ─────────────────────────────────────────────────────────────────────────────

resolve_isa_path() {
  # (1) Local ISA.md
  if [ -f "$CWD/ISA.md" ]; then
    echo "$CWD/ISA.md"
    return
  fi
  
  # (2) OpenCode WORK dir
  local work_root="$HOME/.config/opencode/MEMORY/WORK"
  if [ -d "$work_root" ]; then
    for dir in $(ls -t "$work_root" 2>/dev/null | head -5); do
      local full="$work_root/$dir"
      if [ -f "$full/ISA.md" ]; then
        echo "$full/ISA.md"
        return
      fi
    done
  fi
  
  # (3) Claude's WORK dir (shared memory)
  work_root="$HOME/.claude/MEMORY/WORK"
  if [ -d "$work_root" ]; then
    for dir in $(ls -t "$work_root" 2>/dev/null | head -5); do
      local full="$work_root/$dir"
      if [ -f "$full/ISA.md" ]; then
        echo "$full/ISA.md"
        return
      fi
    done
  fi
  
  # (4) Codex WORK dir
  work_root="$HOME/.codex/MEMORY/WORK"
  if [ -d "$work_root" ]; then
    for dir in $(ls -t "$work_root" 2>/dev/null | head -5); do
      local full="$work_root/$dir"
      if [ -f "$full/ISA.md" ]; then
        echo "$full/ISA.md"
        return
      fi
    done
  fi
  
  echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Intent extraction
# ─────────────────────────────────────────────────────────────────────────────

extract_intent() {
  local prompt="$1"
  echo "$prompt" | sed 's/[.!?;].*//' | head -c 80
}

extract_not_wants() {
  local prompt="$1"
  if echo "$prompt" | grep -qi "avoid"; then
    echo "$prompt" | sed -n 's/.*avoid \([^,.]*\).*/\1/ip' | head -1
  elif echo "$prompt" | grep -qi "don't\|do not"; then
    echo "$prompt" | sed -n "s/.*don't \([^,.]*\).*/\1/ip" | head -1
  elif echo "$prompt" | grep -qi "without"; then
    echo "$prompt" | sed -n 's/.*without \([^,.]*\).*/\1/ip' | head -1
  else
    echo "none"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Section extraction from markdown
# ─────────────────────────────────────────────────────────────────────────────

slice_section() {
  local file="$1"
  local heading="$2"
  
  [ ! -f "$file" ] && return
  
  awk -v h="$heading" '
    BEGIN { IGNORECASE=1; in_section=0 }
    /^## / {
      if (in_section) exit
      if (tolower($0) ~ "^## *" tolower(h) " *$") in_section=1
      next
    }
    in_section { print }
  ' "$file" | head -3
}

# ─────────────────────────────────────────────────────────────────────────────
# Memory resolution (multi-source)
# ─────────────────────────────────────────────────────────────────────────────

resolve_memory() {
  local type="$1"  # "worked" | "failed"
  local result=""
  
  # Check multiple memory locations
  local dirs=(
    "$HOME/.config/opencode/MEMORY/LEARNING"
    "$HOME/.claude/MEMORY/LEARNING"
    "$HOME/.codex/MEMORY/LEARNING"
  )
  
  for base in "${dirs[@]}"; do
    if [ "$type" = "worked" ] && [ -d "$base/REFLECTIONS" ]; then
      result=$(ls -t "$base/REFLECTIONS"/*.md 2>/dev/null | head -1 || echo "")
      [ -n "$result" ] && echo "$result" && return
    elif [ "$type" = "failed" ] && [ -d "$base/FAILURES" ]; then
      result=$(find "$base/FAILURES" -type f -name "*.md" 2>/dev/null | head -1 || echo "")
      [ -n "$result" ] && echo "$result" && return
    fi
  done
  
  echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Main enrichment
# ─────────────────────────────────────────────────────────────────────────────

main() {
  # Classify mode
  local mode
  mode=$(classify_mode "$PROMPT")
  
  # Resolve ISA
  local isa_path
  isa_path=$(resolve_isa_path)
  
  # Extract intent
  local intent not_wants
  intent=$(extract_intent "$PROMPT")
  not_wants=$(extract_not_wants "$PROMPT")
  
  # Extract guardrails from ISA
  local guardrails="none"
  local anti="none"
  if [ -n "$isa_path" ] && [ -f "$isa_path" ]; then
    local principles constraints out_of_scope
    principles=$(slice_section "$isa_path" "Principles" | head -1)
    constraints=$(slice_section "$isa_path" "Constraints" | head -1)
    out_of_scope=$(slice_section "$isa_path" "Out of Scope" | head -1)
    
    guardrails="${principles:-${constraints:-${out_of_scope:-none}}}"
    
    anti=$(slice_section "$isa_path" "Criteria" | grep -i "anti:" | head -1 || echo "none")
    [ -z "$anti" ] && anti="none"
  fi
  
  # Memory pointers (multi-source)
  local memory_worked memory_failed
  memory_worked=$(resolve_memory "worked")
  memory_failed=$(resolve_memory "failed")
  
  # Emit enrichment block
  printf '<temperance-context>\n'
  printf 'mode/tier: %s | reason: prompt-classified | source: opencode-adapter\n' "$mode"
  printf 'intent: %s | not: %s\n' "$intent" "$not_wants"
  printf 'guardrails: %s | anti: %s\n' "$guardrails" "$anti"
  [ -n "$isa_path" ] && printf 'isa: %s\n' "$isa_path"
  [ -n "$memory_worked" ] && printf 'memory: worked=%s\n' "$memory_worked"
  [ -n "$memory_failed" ] && printf 'memory: failed=%s\n' "$memory_failed"
  printf '</temperance-context>\n'
}

# Run
main

exit 0
