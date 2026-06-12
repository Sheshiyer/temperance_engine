#!/usr/bin/env sh
set -eu

. "${TEMPERANCE_ROOT:?}/scripts/lib.sh"

say "Installing skill-cluster resolver guidance"
ensure_dir "$AGENTS_HOME"
ensure_dir "$CODEX_HOME/hooks"
install_file "$TEMPERANCE_ROOT/package/skill-resolvers/skill_cluster_resolver.mjs" "$CODEX_HOME/hooks/skill_cluster_resolver.mjs"

if test -d "$AGENTS_HOME/skill-clusters"; then
  if test -f "$AGENTS_HOME/skill-clusters/package.json"; then
    say "Existing skill-clusters directory found: $AGENTS_HOME/skill-clusters"
    say "Run these after install if desired: npm run health && npm run audit-refs && npm run tier"
  fi
else
  say "No $AGENTS_HOME/skill-clusters directory found. Install or clone your skill-clusters repo there before enabling resolver hooks."
fi
