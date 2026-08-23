#!/usr/bin/env sh
# DEPRECATED: Use `temperance install` instead.
# This script will be removed in a future release.
# Install the Thoughtseed-member "glove": Codex UPS compose, GSD wrappers,
# Manifest console+bridge, product symlink, router SoT copy.
# Does not vendor GSD core, does not copy secrets, does not apply OmniRoute combos.
set -eu

echo "WARNING: This script is deprecated. Use 'temperance install' instead." >&2

. "${TEMPERANCE_ROOT:?}/scripts/lib.sh"

ROOT="${TEMPERANCE_ROOT}"
STATE="${TEMPERANCE_STATE_DIR:-$HOME/.temperance_engine}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
SPINE="${TEMPERANCE_SPINE_MODE:-skip}"
MANIFEST="${TEMPERANCE_MANIFEST_MODE:-skip}"
GSD="${TEMPERANCE_GSD_MODE:-skip}"
CODEX="${TEMPERANCE_CODEX_MODE:-skip}"
CLAUDE="${TEMPERANCE_CLAUDE_MODE:-skip}"

if test "$SPINE" = "install"; then
  CODEX=install
  GSD=install
  MANIFEST=install
  CLAUDE=install
fi

if test "$CODEX" != "install" && test "$GSD" != "install" && test "$MANIFEST" != "install" && test "$CLAUDE" != "install"; then
  say "Spine surfaces skipped (pass --with-spine or --with-codex/--with-gsd/--with-manifest/--with-claude)."
  exit 0
fi

say "Installing Temperance spine (Codex=$CODEX Claude=$CLAUDE GSD=$GSD Manifest=$MANIFEST)"

ensure_dir "$STATE/router"
ensure_dir "$STATE/state/fleet-locks"
ensure_dir "$STATE/state/manifest"

# Router SoT: repo -> host (no --delete)
if test -d "$ROOT/package/router"; then
  if is_dry_run; then
    printf 'DRY_RUN: rsync package/router/ -> %s/router/\n' "$STATE"
  else
    rsync -a "$ROOT/package/router/" "$STATE/router/"
  fi
  say "[spine] router SoT -> $STATE/router"
fi

# Product points at this clone
if is_dry_run; then
  printf 'DRY_RUN: ln -sfn %s %s/product\n' "$ROOT" "$STATE"
else
  ln -sfn "$ROOT" "$STATE/product"
fi
say "[spine] product -> $ROOT"

if test "$CODEX" = "install"; then
  ensure_dir "$CODEX_HOME/hooks"
  # Codex CLI cannot run async hooks (they are skipped with a warning).
  # Never write `"async": true` into hooks.json.
  if test -f "$ROOT/package/hooks/codex/run-bun-hook.sh"; then
    install_file "$ROOT/package/hooks/codex/run-bun-hook.sh" "$CODEX_HOME/hooks/run-bun-hook.sh"
    if ! is_dry_run; then chmod +x "$CODEX_HOME/hooks/run-bun-hook.sh"; fi
  fi
  for hook in PromptProcessing.hook.ts GsdCommand.hook.ts TemperanceRailAnnounce.hook.ts ManifestModeCommit.hook.ts SessionStartTe.hook.ts; do
    src="$ROOT/package/hooks/codex/$hook"
    test -f "$src" || continue
    install_file "$src" "$CODEX_HOME/hooks/$hook"
    if ! is_dry_run; then chmod +x "$CODEX_HOME/hooks/$hook"; fi
  done
  if test -f "$CODEX_HOME/hooks.json"; then
    if is_dry_run; then
      printf 'DRY_RUN: merge SessionStartTe into %s/hooks.json\n' "$CODEX_HOME"
    else
      python3 - "$CODEX_HOME/hooks.json" "$CODEX_HOME/hooks/SessionStartTe.hook.ts" <<'PY'
import json, sys
from pathlib import Path
p, hook = Path(sys.argv[1]), sys.argv[2]
data = json.loads(p.read_text())
hooks = data.setdefault("hooks", {})
ss = hooks.setdefault("SessionStart", [])
blob = json.dumps(ss)
if "SessionStartTe.hook.ts" not in blob:
    ss.append({"hooks": [{"type": "command", "command": repr(hook)[1:-1] if False else f"'{hook}'", "timeout": 4}]})
    p.write_text(json.dumps(data, indent=2) + "\n")
    print("merged SessionStartTe")
else:
    print("SessionStartTe already registered")
# Codex CLI skips `"async": true` hooks. Strip so Manifest/event hooks actually run.
stripped = 0
for groups in hooks.values():
    for group in groups:
        for item in group.get("hooks", []):
            if item.pop("async", None) is not None:
                stripped += 1
if stripped:
    p.write_text(json.dumps(data, indent=2) + "\n")
    print(f"stripped {stripped} async hook flags (Codex CLI unsupported)")
PY
    fi
  else
    say "[spine] no $CODEX_HOME/hooks.json — copy PromptProcessing only; register UPS/SessionStart in the Codex app."
  fi
  say "[spine] Codex hooks installed"
fi

if test "$CLAUDE" = "install"; then
  CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
  ensure_dir "$CLAUDE_HOME/hooks"
  if test -f "$ROOT/package/hooks/claude/PromptProcessing.hook.ts"; then
    install_file "$ROOT/package/hooks/claude/PromptProcessing.hook.ts" "$CLAUDE_HOME/hooks/PromptProcessing.hook.ts"
    if ! is_dry_run; then chmod +x "$CLAUDE_HOME/hooks/PromptProcessing.hook.ts"; fi
  fi
  for hook in GsdCommand.hook.ts TemperanceRailAnnounce.hook.ts ManifestModeCommit.hook.ts; do
    src="$ROOT/package/hooks/codex/$hook"
    test -f "$src" || continue
    install_file "$src" "$CLAUDE_HOME/hooks/$hook"
    if ! is_dry_run; then chmod +x "$CLAUDE_HOME/hooks/$hook"; fi
  done
  say "[spine] Claude compose hooks installed (UPS stays registered in $CLAUDE_HOME/settings.json)"
fi

if test "$GSD" = "install"; then
  if test -f "$ROOT/package/router/gsd-command-install.mjs"; then
    if is_dry_run; then
      printf 'DRY_RUN: node package/router/gsd-command-install.mjs\n'
    else
      node "$ROOT/package/router/gsd-command-install.mjs"
    fi
  fi
fi

if test "$MANIFEST" = "install"; then
  export MANIFEST_CONSOLE_ROOT="${MANIFEST_CONSOLE_ROOT:-$ROOT/package/manifest-zone}"
  if test -f "$MANIFEST_CONSOLE_ROOT/package.json" && ! test -x "$MANIFEST_CONSOLE_ROOT/node_modules/.bin/vite"; then
    if is_dry_run; then
      printf 'DRY_RUN: npm install --prefix %s\n' "$MANIFEST_CONSOLE_ROOT"
    else
      (cd "$MANIFEST_CONSOLE_ROOT" && npm install --no-fund --no-audit)
    fi
  fi
  if is_dry_run; then
    printf 'DRY_RUN: would install Manifest bridge + console LaunchAgents\n'
  else
    if test -x "$ROOT/scripts/temperance-manifest-bridge-launchd.sh"; then
      bash "$ROOT/scripts/temperance-manifest-bridge-launchd.sh" install || say "[spine] bridge launchd skipped"
    fi
    if test -x "$ROOT/scripts/temperance-manifest-console-launchd.sh"; then
      bash "$ROOT/scripts/temperance-manifest-console-launchd.sh" install || say "[spine] console launchd skipped"
    fi
  fi
  say "[spine] Manifest console root $MANIFEST_CONSOLE_ROOT"
  if command -v portless >/dev/null 2>&1 && test -x "$ROOT/scripts/apply-portless-organs.sh"; then
    if is_dry_run; then
      printf 'DRY_RUN: apply-portless-organs.sh\n'
    else
      sh "$ROOT/scripts/apply-portless-organs.sh" || say "[spine] portless aliases skipped"
    fi
  else
    say "[spine] portless not on PATH (optional named URLs)"
  fi
fi
