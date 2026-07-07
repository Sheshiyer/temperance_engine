#!/usr/bin/env bash
# package/adapters/codex/PromptProcessing.hook.sh
# Codex surface adapter for SP0 enrichment.
#
# This is the Codex equivalent of Claude Code's PromptProcessing.hook.ts.
# It runs the SP0 enrichment pipeline and emits a <temperance-context> block.
#
# Installation:
#   Copy to ~/.codex/hooks/PromptProcessing.hook.sh
#   Add to ~/.codex/settings.json:
#   { "hooks": { "prompt_processing": "~/.codex/hooks/PromptProcessing.hook.sh" } }
#
# Fail-open: if enrichment fails, falls back to basic mode classification.

set -u

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

# The shared SP0 enrichment core lives once, under ~/.claude/PAI/enrich,
# regardless of which surface (claude/codex/opencode) is calling it -- see
# ~/.claude/hooks/PromptProcessing.hook.ts, which uses the same default.
# TEMPERANCE_ENRICH_DIR overrides for non-standard installs.
ENRICH_DIR="${TEMPERANCE_ENRICH_DIR:-$HOME/.claude/PAI/enrich}"
CWD="${CODEX_PROJECT_DIR:-$PWD}"
SURFACE="codex"

# ─────────────────────────────────────────────────────────────────────────────
# Read prompt from stdin
# ─────────────────────────────────────────────────────────────────────────────

PROMPT=""
if [ -t 0 ]; then
  # No stdin
  PROMPT=""
else
  PROMPT=$(cat)
fi

# ─────────────────────────────────────────────────────────────────────────────
# Shared enrichment core delegation
# ─────────────────────────────────────────────────────────────────────────────
# Try the real SP0 pipeline (contract/resolver/stages) via bun first. Prints
# the <temperance-context> block and returns 0 on success; returns 1 with no
# output if bun or the core is unavailable, or the core throws -- caller
# falls back to the classifier below. Never fatal (no set -e; failure here
# is just an empty command substitution).

try_enrich_core() {
  local prompt="$1" cwd="$2"
  command -v bun >/dev/null 2>&1 || return 1
  [ -f "$ENRICH_DIR/index.ts" ] || return 1

  TEMPERANCE_HOOK_PROMPT="$prompt" TEMPERANCE_HOOK_CWD="$cwd" TEMPERANCE_HOOK_ENRICH_DIR="$ENRICH_DIR" \
    bun -e '
      const dir = process.env.TEMPERANCE_HOOK_ENRICH_DIR;
      const prompt = process.env.TEMPERANCE_HOOK_PROMPT || "";
      const cwd = process.env.TEMPERANCE_HOOK_CWD || process.cwd();
      import(dir + "/index.ts").then(async (mod) => {
        const out = await mod.enrich({ prompt, cwd, surface: "codex" });
        if (typeof out === "string" && out.trim()) { process.stdout.write(out); process.exit(0); }
        process.exit(1);
      }).catch(() => process.exit(1));
    ' 2>/dev/null
}

# ─────────────────────────────────────────────────────────────────────────────
# Mode classification (fallback if the shared core is unavailable)
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
# ISA resolution
# ─────────────────────────────────────────────────────────────────────────────

resolve_isa_path() {
  # (1) Local ISA.md
  if [ -f "$CWD/ISA.md" ]; then
    echo "$CWD/ISA.md"
    return
  fi
  
  # (2) Newest WORK dir
  local work_root="$HOME/.codex/MEMORY/WORK"
  if [ -d "$work_root" ]; then
    for dir in $(ls -t "$work_root" 2>/dev/null | head -5); do
      local full="$work_root/$dir"
      if [ -f "$full/ISA.md" ]; then
        echo "$full/ISA.md"
        return
      fi
    done
  fi
  
  # Fallback to Claude's WORK dir
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
  
  echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Intent extraction
# ─────────────────────────────────────────────────────────────────────────────

extract_intent() {
  local prompt="$1"
  # First clause (before . ! ? ;)
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
# Main enrichment
# ─────────────────────────────────────────────────────────────────────────────

main() {
  # Try the shared enrichment core first; only fall back to the
  # self-contained classifier below if it's unavailable or throws.
  local enriched
  enriched=$(try_enrich_core "$PROMPT" "$CWD")
  if [ -n "$enriched" ]; then
    printf '%s\n' "$enriched"
    return
  fi

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
    
    # First non-empty
    guardrails="${principles:-${constraints:-${out_of_scope:-none}}}"
    
    # Anti-criteria
    anti=$(slice_section "$isa_path" "Criteria" | grep -i "anti:" | head -1 || echo "none")
    [ -z "$anti" ] && anti="none"
  fi
  
  # Memory pointers
  local memory_worked="" memory_failed=""
  if [ -d "$HOME/.codex/MEMORY/LEARNING/REFLECTIONS" ]; then
    memory_worked=$(ls -t "$HOME/.codex/MEMORY/LEARNING/REFLECTIONS"/*.md 2>/dev/null | head -1 || echo "")
  fi
  if [ -d "$HOME/.codex/MEMORY/LEARNING/FAILURES" ]; then
    memory_failed=$(find "$HOME/.codex/MEMORY/LEARNING/FAILURES" -type f -name "*.md" 2>/dev/null | head -1 || echo "")
  fi
  
  # Emit enrichment block
  printf '<temperance-context>\n'
  printf 'mode/tier: %s | reason: prompt-classified | source: codex-adapter\n' "$mode"
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
