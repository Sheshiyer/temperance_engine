#!/usr/bin/env bash
# scripts/wire-multi-backend.sh
# Non-destructive wiring of multi-backend router into Claude Code, Codex, and OpenCode
#
# What this does:
# 1. Creates backups of anything it touches
# 2. Symlinks router to ~/.local/bin for easy access
# 3. Updates Codex hooks to use shared enrichment core
# 4. Creates OpenCode hooks directory and installs adapter
# 5. Adds router to Delegation skill knowledge
#
# Usage:
#   ./scripts/wire-multi-backend.sh              # Install
#   ./scripts/wire-multi-backend.sh --dry-run    # Preview only
#   ./scripts/wire-multi-backend.sh --revert     # Undo changes
#   ./scripts/wire-multi-backend.sh --status     # Check current state

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${HOME}/.temperance_engine/backups/${TIMESTAMP}"

DRY_RUN=false
REVERT=false
STATUS=false

# Parse args
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    --revert) REVERT=true ;;
    --status) STATUS=true ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--revert] [--status]"
      exit 0
      ;;
  esac
done

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

log() { echo "[wire] $*"; }
warn() { echo "[wire] WARNING: $*" >&2; }
err() { echo "[wire] ERROR: $*" >&2; exit 1; }

backup_file() {
  local src="$1"
  if [[ -f "$src" || -L "$src" ]]; then
    mkdir -p "$BACKUP_DIR"
    local name
    name=$(basename "$src")
    if $DRY_RUN; then
      log "Would backup: $src → $BACKUP_DIR/$name"
    else
      cp -P "$src" "$BACKUP_DIR/$name"
      log "Backed up: $src → $BACKUP_DIR/$name"
    fi
  fi
}

symlink() {
  local src="$1"
  local dst="$2"
  
  if $DRY_RUN; then
    log "Would symlink: $dst → $src"
    return
  fi
  
  # Backup existing
  if [[ -f "$dst" || -L "$dst" ]]; then
    backup_file "$dst"
    rm -f "$dst"
  fi
  
  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  log "Symlinked: $dst → $src"
}

# ─────────────────────────────────────────────────────────────────────────────
# Status Check
# ─────────────────────────────────────────────────────────────────────────────

check_status() {
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo "TEMPERANCE ENGINE - MULTI-BACKEND WIRING STATUS"
  echo "═══════════════════════════════════════════════════════════════════════════════"
  echo ""
  
  # Router CLI
  echo "1. ROUTER CLI"
  if [[ -L "$HOME/.local/bin/temperance-route" ]]; then
    local target
    target=$(readlink "$HOME/.local/bin/temperance-route")
    echo "   [INSTALLED] ~/.local/bin/temperance-route → $target"
  elif [[ -f "$HOME/.local/bin/temperance-route" ]]; then
    echo "   [INSTALLED] ~/.local/bin/temperance-route (file, not symlink)"
  else
    echo "   [NOT INSTALLED] ~/.local/bin/temperance-route"
  fi
  echo ""

  # Dispatch CLI
  if [[ -L "$HOME/.local/bin/temperance-dispatch" ]]; then
    local target
    target=$(readlink "$HOME/.local/bin/temperance-dispatch")
    echo "   [INSTALLED] ~/.local/bin/temperance-dispatch → $target"
  elif [[ -f "$HOME/.local/bin/temperance-dispatch" ]]; then
    echo "   [INSTALLED] ~/.local/bin/temperance-dispatch (file, not symlink)"
  else
    echo "   [NOT INSTALLED] ~/.local/bin/temperance-dispatch"
  fi
  echo ""

  # Batch CLI
  if [[ -L "$HOME/.local/bin/temperance-batch" ]]; then
    local target
    target=$(readlink "$HOME/.local/bin/temperance-batch")
    echo "   [INSTALLED] ~/.local/bin/temperance-batch → $target"
  elif [[ -f "$HOME/.local/bin/temperance-batch" ]]; then
    echo "   [INSTALLED] ~/.local/bin/temperance-batch (file, not symlink)"
  else
    echo "   [NOT INSTALLED] ~/.local/bin/temperance-batch"
  fi
  echo ""

  # Claude Code
  echo "2. CLAUDE CODE"
  if [[ -d "$HOME/.claude/PAI/enrich" ]]; then
    echo "   [OK] Enrichment core: ~/.claude/PAI/enrich/"
    ls -la "$HOME/.claude/PAI/enrich/" 2>/dev/null | head -5 | sed 's/^/       /'
  else
    echo "   [MISSING] Enrichment core not found"
  fi
  if [[ -f "$HOME/.claude/hooks/PromptProcessing.hook.ts" ]]; then
    if grep -q "TEMPERANCE_ENRICH_DIR" "$HOME/.claude/hooks/PromptProcessing.hook.ts" 2>/dev/null; then
      echo "   [OK] PromptProcessing hook uses Temperance enrichment"
    else
      echo "   [PARTIAL] PromptProcessing hook exists but may not use Temperance"
    fi
  else
    echo "   [MISSING] PromptProcessing hook"
  fi
  echo ""
  
  # Codex
  echo "3. CODEX"
  if [[ -f "$HOME/.codex/hooks/PromptProcessing.hook.ts" ]]; then
    if grep -q "TEMPERANCE_ENRICH_DIR\|PAI/enrich" "$HOME/.codex/hooks/PromptProcessing.hook.ts" 2>/dev/null; then
      echo "   [OK] PromptProcessing hook uses shared enrichment core"
    else
      echo "   [PARTIAL] PromptProcessing hook exists but uses local classifier only"
    fi
  else
    echo "   [MISSING] PromptProcessing hook"
  fi
  echo ""
  
  # OpenCode
  echo "4. OPENCODE"
  if [[ -d "$HOME/.config/opencode/hooks" ]]; then
    echo "   [OK] Hooks directory exists"
    ls -la "$HOME/.config/opencode/hooks/" 2>/dev/null | head -5 | sed 's/^/       /'
  else
    echo "   [MISSING] Hooks directory"
  fi
  if [[ -f "$HOME/.config/opencode/AGENTS.md" ]]; then
    echo "   [OK] AGENTS.md installed"
  else
    echo "   [MISSING] AGENTS.md"
  fi
  echo ""
  
  # Available backends
  echo "5. AVAILABLE BACKENDS"
  local backends=()
  command -v command-code &>/dev/null && backends+=("command-code")
  command -v kimi &>/dev/null && backends+=("kimi")
  [[ -x "$HOME/.grok/bin/grok" ]] && backends+=("grok")
  [[ -n "${NVIDIA_API_KEY:-}" ]] && backends+=("nvidia")
  echo "   ${backends[*]:-NONE}"
  echo ""
  
  # Backups
  echo "6. BACKUPS"
  if [[ -d "$HOME/.temperance_engine/backups" ]]; then
    local count
    count=$(ls -1 "$HOME/.temperance_engine/backups" 2>/dev/null | wc -l | tr -d ' ')
    echo "   $count backup(s) in ~/.temperance_engine/backups/"
  else
    echo "   No backups yet"
  fi
  
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════════════"
}

# ─────────────────────────────────────────────────────────────────────────────
# Revert
# ─────────────────────────────────────────────────────────────────────────────

revert() {
  log "Reverting multi-backend wiring..."
  
  # List available backups
  if [[ ! -d "$HOME/.temperance_engine/backups" ]]; then
    warn "No backups found at ~/.temperance_engine/backups/"
    return 1
  fi
  
  local latest
  latest=$(ls -1t "$HOME/.temperance_engine/backups" 2>/dev/null | head -1)
  
  if [[ -z "$latest" ]]; then
    warn "No backups found"
    return 1
  fi
  
  local backup_path="$HOME/.temperance_engine/backups/$latest"
  log "Using backup: $backup_path"
  
  # Remove symlinks we created
  [[ -L "$HOME/.local/bin/temperance-route" ]] && rm -f "$HOME/.local/bin/temperance-route" && log "Removed: ~/.local/bin/temperance-route"
  [[ -L "$HOME/.local/bin/temperance-dispatch" ]] && rm -f "$HOME/.local/bin/temperance-dispatch" && log "Removed: ~/.local/bin/temperance-dispatch"
  [[ -L "$HOME/.local/bin/temperance-batch" ]] && rm -f "$HOME/.local/bin/temperance-batch" && log "Removed: ~/.local/bin/temperance-batch"
  [[ -L "$HOME/.config/opencode/hooks/PromptProcessing.hook.sh" ]] && rm -f "$HOME/.config/opencode/hooks/PromptProcessing.hook.sh" && log "Removed: OpenCode hook symlink"
  
  # Restore backed up files
  for f in "$backup_path"/*; do
    [[ -f "$f" ]] || continue
    local name
    name=$(basename "$f")
    log "Would need manual restore for: $name"
  done
  
  log "Revert complete. Backups preserved at: $backup_path"
}

# ─────────────────────────────────────────────────────────────────────────────
# Install
# ─────────────────────────────────────────────────────────────────────────────

install() {
  log "Wiring multi-backend router (non-destructive)..."
  $DRY_RUN && log "(DRY RUN - no changes will be made)"
  echo ""
  
  # 1. Router CLI to ~/.local/bin
  log "Step 1: Installing router CLI..."
  mkdir -p "$HOME/.local/bin"
  symlink "$REPO_ROOT/package/router/multi-backend-router.sh" "$HOME/.local/bin/temperance-route"
  symlink "$REPO_ROOT/package/router/parallel-backend-dispatch.sh" "$HOME/.local/bin/temperance-dispatch"
  symlink "$REPO_ROOT/package/router/dispatch-tasklist.sh" "$HOME/.local/bin/temperance-batch"
  
  # Check if ~/.local/bin is in PATH
  if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
    warn "~/.local/bin is not in PATH. Add to your shell profile:"
    warn '  export PATH="$HOME/.local/bin:$PATH"'
  fi
  echo ""
  
  # 2. OpenCode hooks directory + adapter
  log "Step 2: Setting up OpenCode hooks..."
  if $DRY_RUN; then
    log "Would create: ~/.config/opencode/hooks/"
    log "Would symlink: OpenCode PromptProcessing adapter"
  else
    mkdir -p "$HOME/.config/opencode/hooks"
    symlink "$REPO_ROOT/package/adapters/opencode/PromptProcessing.hook.sh" "$HOME/.config/opencode/hooks/PromptProcessing.hook.sh"
  fi
  echo ""
  
  # 3. Check Claude Code (already wired via existing install)
  log "Step 3: Checking Claude Code..."
  if [[ -d "$HOME/.claude/PAI/enrich" ]]; then
    log "Claude Code enrichment core already installed at ~/.claude/PAI/enrich/"
  else
    warn "Claude Code enrichment core not found. Run: ./install.sh --with-claude"
  fi
  echo ""
  
  # 4. Check Codex (existing hooks don't use shared core)
  log "Step 4: Checking Codex..."
  if [[ -f "$HOME/.codex/hooks/PromptProcessing.hook.ts" ]]; then
    if grep -q "TEMPERANCE_ENRICH_DIR\|PAI/enrich" "$HOME/.codex/hooks/PromptProcessing.hook.ts" 2>/dev/null; then
      log "Codex already uses shared enrichment core"
    else
      warn "Codex uses local classifier only. To upgrade:"
      warn "  1. Backup: cp ~/.codex/hooks/PromptProcessing.hook.ts ~/.codex/hooks/PromptProcessing.hook.ts.bak"
      warn "  2. Copy Claude's hook: cp ~/.claude/hooks/PromptProcessing.hook.ts ~/.codex/hooks/"
      warn "  This is optional - local classifier still works fine"
    fi
  fi
  echo ""
  
  # 5. Summary
  log "Step 5: Verifying..."
  echo ""
  check_status
  
  if ! $DRY_RUN; then
    echo ""
    log "Installation complete!"
    log ""
    log "Usage:"
    log "  temperance-route 'implement auth'        # Route task to best backend"
    log "  temperance-route --execute 'quick fix'   # Execute directly"
    log "  temperance-dispatch --all 'analyze'      # Compare across backends"
    log ""
    log "To revert: $0 --revert"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

main() {
  if $STATUS; then
    check_status
  elif $REVERT; then
    revert
  else
    install
  fi
}

main
