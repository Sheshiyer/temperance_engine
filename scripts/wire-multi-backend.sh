#!/usr/bin/env bash
# scripts/wire-multi-backend.sh
# Non-destructive wiring of multi-backend router into Claude Code, Codex, and OpenCode
#
# What this does:
# 1. Creates backups of anything it touches
# 2. Symlinks router to ~/.local/bin for easy access
# 3. Ensures the shared enrichment core is present for Claude and Codex
# 4. Installs missing prompt adapters without replacing user-owned hooks
# 4. Creates OpenCode hooks directory and installs adapter
# 5. Adds router to Delegation skill knowledge
#
# Usage:
#   ./scripts/wire-multi-backend.sh              # Install
#   ./scripts/wire-multi-backend.sh --dry-run    # Preview only
#   ./scripts/wire-multi-backend.sh --revert     # Undo changes
#   ./scripts/wire-multi-backend.sh --status     # Check current state
#   ./scripts/wire-multi-backend.sh --refresh-enrich # Refresh the shared core
#   ./scripts/wire-multi-backend.sh --refresh-hooks  # Replace prompt adapters

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${HOME}/.temperance_engine/backups/${TIMESTAMP}"

DRY_RUN=false
REVERT=false
STATUS=false
REFRESH_ENRICH=false
REFRESH_HOOKS=false

# Parse args
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    --revert) REVERT=true ;;
    --status) STATUS=true ;;
    --refresh-enrich) REFRESH_ENRICH=true ;;
    --refresh-hooks) REFRESH_HOOKS=true ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--revert] [--status] [--refresh-enrich] [--refresh-hooks]"
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

backup_dir() {
  local src="$1"
  if [[ -d "$src" && ! -L "$src" ]]; then
    mkdir -p "$BACKUP_DIR"
    local name
    name=$(basename "$src")
    if $DRY_RUN; then
      log "Would backup directory: $src → $BACKUP_DIR/$name"
    else
      cp -RP "$src" "$BACKUP_DIR/$name"
      log "Backed up directory: $src → $BACKUP_DIR/$name"
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

MANAGED_SKILL_MARKER=".temperance-managed"

# The Kimi desktop app's daimon skill scanner does not follow symlinks whose
# real target lives on a different volume/mount than daimon-share itself
# (confirmed: every pre-existing custom skill it recognizes resolves to
# ~/.agents/skills/... on the boot volume; a repo clone on a different mounted
# volume is silently invisible to it even though the CLI and a plain
# `test -e` both resolve it fine). Real copies sidestep that gap.
# Idempotent: always refreshes to match the repo, and only ever removes a
# destination it marked itself, so a same-named user skill is never clobbered.
copy_skill_dir() {
  local src="$1"
  local dst="$2"

  if $DRY_RUN; then
    log "Would copy skill: $dst ← $src (desktop scanner needs a same-volume real directory, not a symlink)"
    return
  fi

  if [[ -e "$dst" || -L "$dst" ]]; then
    if [[ -f "$dst/$MANAGED_SKILL_MARKER" ]]; then
      rm -rf "$dst"
    else
      backup_dir "$dst" 2>/dev/null || backup_file "$dst"
      rm -rf "$dst"
    fi
  fi

  mkdir -p "$(dirname "$dst")"
  cp -R "$src" "$dst"
  touch "$dst/$MANAGED_SKILL_MARKER"
  log "Copied skill (desktop-safe, same-volume): $dst ← $src"
}

ensure_enrichment_core() {
  local src="$REPO_ROOT/package/enrich"
  local dst="$HOME/.claude/PAI/enrich"
  [[ -d "$src" ]] || err "Shared enrichment source missing: $src"
  if [[ -d "$dst" && "$REFRESH_ENRICH" != true ]]; then
    log "Shared enrichment core already present; preserving $dst"
    return
  fi
  if $DRY_RUN; then
    [[ -e "$dst" ]] && log "Would backup directory: $dst → $BACKUP_DIR/enrich"
    log "Would install shared enrichment core: $dst → $src"
    return
  fi
  if [[ -e "$dst" ]]; then
    backup_dir "$dst"
    rm -rf "$dst"
  fi
  mkdir -p "$(dirname "$dst")"
  cp -R "$src" "$dst"
  log "Installed shared enrichment core: $dst"
}

ensure_prompt_hook() {
  local src="$1"
  local dst="$2"
  if [[ -e "$dst" || -L "$dst" ]]; then
    if [[ "$REFRESH_HOOKS" == true ]]; then
      symlink "$src" "$dst"
    else
      log "Prompt hook already present; preserving $dst"
    fi
    return
  fi
  symlink "$src" "$dst"
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
  if [[ -L "$HOME/.config/opencode/plugins/temperance-flow.ts" || -f "$HOME/.config/opencode/plugins/temperance-flow.ts" ]]; then
    echo "   [OK] Temperance flow plugin installed"
  else
    echo "   [MISSING] Temperance flow plugin"
  fi
  echo ""
  
  # Kimi
  echo "5. KIMI"
  if [[ -L "$HOME/.kimi/skills/temperance-parallel-dispatch" && -e "$HOME/.kimi/skills/temperance-parallel-dispatch" ]]; then
    echo "   [OK] CLI skill links resolve"
  elif [[ -d "$HOME/.kimi" ]]; then
    echo "   [MISSING] CLI skill links (~/.kimi/skills/temperance-*)"
  else
    echo "   [N/A] Kimi CLI not installed"
  fi
  local kimi_desktop_skills="${TEMPERANCE_KIMI_DESKTOP_SKILLS:-$HOME/Library/Application Support/kimi-desktop/daimon-share/daimon/skills}"
  if [[ -f "$kimi_desktop_skills/temperance-parallel-dispatch/$MANAGED_SKILL_MARKER" ]]; then
    echo "   [OK] Desktop daimon skill copies present (real copies — the desktop scanner does not follow cross-volume symlinks)"
  elif [[ -d "$kimi_desktop_skills" ]]; then
    echo "   [MISSING] Desktop daimon skill copies"
  else
    echo "   [N/A] Kimi desktop app not installed"
  fi
  if [[ -f "$HOME/.temperance_engine/relay/kimi-provider.json" ]]; then
    echo "   [OK] CLI relay provider state marker present"
  else
    echo "   [--] CLI relay lane not enabled (scripts/configure-kimi-relay.sh)"
  fi
  echo ""

  # Available backends
  echo "6. AVAILABLE BACKENDS"
  local backends=()
  command -v command-code &>/dev/null && backends+=("command-code")
  command -v kimi &>/dev/null && backends+=("kimi")
  [[ -x "$HOME/.grok/bin/grok" ]] && backends+=("grok")
  echo "   ${backends[*]:-NONE}"
  echo ""
  
  # Backups
  echo "7. BACKUPS"
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
  for router_file in classify-task.sh omniroute-portfolios.ts omniroute-portfolios.json; do
    [[ -L "$HOME/.claude/PAI/router/$router_file" ]] && rm -f "$HOME/.claude/PAI/router/$router_file" && log "Removed: ~/.claude/PAI/router/$router_file"
  done
  [[ -L "$HOME/.config/opencode/hooks/PromptProcessing.hook.sh" ]] && rm -f "$HOME/.config/opencode/hooks/PromptProcessing.hook.sh" && log "Removed: OpenCode hook symlink"
  for skill in temperance-engine temperance-parallel-dispatch; do
    [[ -L "$HOME/.kimi/skills/$skill" ]] && rm -f "$HOME/.kimi/skills/$skill" && log "Removed: ~/.kimi/skills/$skill"
    kimi_desktop_skill="${TEMPERANCE_KIMI_DESKTOP_SKILLS:-$HOME/Library/Application Support/kimi-desktop/daimon-share/daimon/skills}/$skill"
    [[ -f "$kimi_desktop_skill/$MANAGED_SKILL_MARKER" ]] && rm -rf "$kimi_desktop_skill" && log "Removed: Kimi desktop skill copy $skill"
  done
  
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
  ensure_enrichment_core
  symlink "$REPO_ROOT/package/router/multi-backend-router.sh" "$HOME/.local/bin/temperance-route"
  symlink "$REPO_ROOT/package/router/parallel-backend-dispatch.sh" "$HOME/.local/bin/temperance-dispatch"
  symlink "$REPO_ROOT/package/router/dispatch-tasklist.sh" "$HOME/.local/bin/temperance-batch"

  # Co-locate the shared classifier at the PAI router path so the installed
  # enrichment hook (enrich/stages/routing.ts) resolves its
  # ../../router/classify-task.sh sibling instead of failing open to
  # task=balanced. (routing.ts also honors TEMPERANCE_ROUTER_DIR as an override.)
  for router_file in classify-task.sh omniroute-portfolios.ts omniroute-portfolios.json; do
    symlink "$REPO_ROOT/package/router/$router_file" "$HOME/.claude/PAI/router/$router_file"
  done
  
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
    mkdir -p "$HOME/.config/opencode/plugins"
    symlink "$REPO_ROOT/package/adapters/opencode/TemperanceFlowPlugin.ts" "$HOME/.config/opencode/plugins/temperance-flow.ts"
  fi
  echo ""
  
  # 3. Check Claude Code (already wired via existing install)
  log "Step 3: Checking Claude Code..."
  if $DRY_RUN; then
    log "Would ensure Claude prompt adapter: ~/.claude/hooks/PromptProcessing.hook.ts"
  else
    mkdir -p "$HOME/.claude/hooks"
    ensure_prompt_hook "$REPO_ROOT/package/enrich/adapters/claude-prompthook.ts" "$HOME/.claude/hooks/PromptProcessing.hook.ts"
  fi
  if [[ -d "$HOME/.claude/PAI/enrich" ]]; then
    log "Claude Code enrichment core already installed at ~/.claude/PAI/enrich/"
  else
    warn "Claude Code enrichment core not found. Run: ./install.sh --with-claude"
  fi
  echo ""
  
  # 4. Check Codex (existing hooks don't use shared core)
  log "Step 4: Checking Codex..."
  if $DRY_RUN; then
    log "Would ensure Codex prompt adapter: ~/.codex/hooks/PromptProcessing.hook.ts"
  else
    mkdir -p "$HOME/.codex/hooks"
    ensure_prompt_hook "$REPO_ROOT/package/enrich/adapters/codex-prompthook.ts" "$HOME/.codex/hooks/PromptProcessing.hook.ts"
  fi
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
  
  # 4b. Kimi skills (CLI + desktop daimon). Provider/hook wiring is opt-in via
  # configure-kimi-relay.sh; this step only makes the repo skills discoverable.
  log "Step 4b: Checking Kimi skills..."
  if [[ -d "$HOME/.kimi" ]]; then
    if $DRY_RUN; then
      log "Would symlink temperance skills into ~/.kimi/skills/"
    else
      mkdir -p "$HOME/.kimi/skills"
      for skill in temperance-engine temperance-parallel-dispatch; do
        # remove self-referential link left by unguarded `ln -s` re-runs
        # (BSD ln follows a symlinked dst; cp -R would also propagate it
        # into the desktop copies below)
        [[ -L "$REPO_ROOT/skills/$skill/$skill" ]] && rm -f "$REPO_ROOT/skills/$skill/$skill"
        symlink "$REPO_ROOT/skills/$skill" "$HOME/.kimi/skills/$skill"
      done
    fi
  else
    log "Kimi CLI not detected (~/.kimi missing); skipping CLI skill links"
  fi
  KIMI_DESKTOP_SKILLS="${TEMPERANCE_KIMI_DESKTOP_SKILLS:-$HOME/Library/Application Support/kimi-desktop/daimon-share/daimon/skills}"
  if [[ -d "$KIMI_DESKTOP_SKILLS" ]]; then
    if $DRY_RUN; then
      log "Would copy temperance skills into Kimi desktop daimon skills dir (real copies — the desktop scanner does not follow cross-volume symlinks)"
    else
      for skill in temperance-engine temperance-parallel-dispatch; do
        # same self-heal as the ~/.kimi loop above: never propagate a
        # self-referential link into the desktop copies via cp -R
        [[ -L "$REPO_ROOT/skills/$skill/$skill" ]] && rm -f "$REPO_ROOT/skills/$skill/$skill"
        copy_skill_dir "$REPO_ROOT/skills/$skill" "$KIMI_DESKTOP_SKILLS/$skill"
      done
    fi
  else
    log "Kimi desktop daimon skills dir not found; skipping desktop skill copies"
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
