#!/usr/bin/env sh
set -eu

ROOT="${TEMPERANCE_ROOT:?}"
fail=0

check_file() {
  if test -f "$1"; then
    printf 'ok: %s\n' "$1"
  else
    printf 'missing: %s\n' "$1" >&2
    fail=1
  fi
}

check_file "$ROOT/install.sh"
check_file "$ROOT/verify.sh"
check_file "$ROOT/scripts/verify-all.sh"
check_file "$ROOT/.planning/PROJECT.md"
check_file "$ROOT/.planning/ROADMAP.md"
check_file "$ROOT/.planning/STATE.md"
check_file "$ROOT/.planning/REQUIREMENTS.md"
check_file "$ROOT/.planning/config.json"
check_file "$ROOT/docs/pai-flow.md"
check_file "$ROOT/docs/skill-clusters.md"
check_file "$ROOT/docs/peon-ping-packs.md"
check_file "$ROOT/docs/codegraph-routing.md"
check_file "$ROOT/docs/parallel-dispatch.md"
check_file "$ROOT/scripts/install-gsd.sh"
check_file "$ROOT/scripts/configure-opencode-relay.sh"
check_file "$ROOT/scripts/configure-kimi-relay.sh"
check_file "$ROOT/scripts/configure-kimi-desktop-relay.sh"
check_file "$ROOT/scripts/omniroute-temperance-planner-quota.sh"
check_file "$ROOT/scripts/temperance-doctor.sh"
check_file "$ROOT/package/adapters/kimi/UserPromptSubmit.hook.sh"
check_file "$ROOT/docs/kimi-surface.md"
check_file "$ROOT/package/hooks/ParallelDispatchContext.hook.sh"
check_file "$ROOT/scripts/apply-identity.sh"
check_file "$ROOT/tests/sandbox-install.sh"
check_file "$ROOT/tests/identity-tool.sh"
check_file "$ROOT/CREDITS.md"
check_file "$ROOT/UPSTREAM.md"
check_file "$ROOT/skills.sh.json"
check_file "$ROOT/skills/temperance-engine/SKILL.md"
check_file "$ROOT/templates/AGENTS.md"
check_file "$ROOT/templates/opencode.AGENTS.md"
check_file "$ROOT/templates/cursor.AGENTS.md"
check_file "$ROOT/templates/cursor.rules.mdc"
check_file "$ROOT/templates/codex.AGENTS.md"
check_file "$ROOT/templates/CLAUDE.md.template"
check_file "$ROOT/assets/banner.png"
check_file "$ROOT/assets/icon.png"
check_file "$ROOT/package/enrich/adapters/codex-prompthook.ts"
check_file "$ROOT/package/hooks/codex/PromptProcessing.hook.ts"
check_file "$ROOT/package/hooks/codex/GsdCommand.hook.ts"
check_file "$ROOT/package/hooks/codex/SessionStartTe.hook.ts"
check_file "$ROOT/package/hooks/codex/run-bun-hook.sh"
check_file "$ROOT/docs/codex-cli-limits.md"
check_file "$ROOT/package/hooks/claude/PromptProcessing.hook.ts"
check_file "$ROOT/package/router/gsd-rail-map.json"
check_file "$ROOT/package/router/gsd-command-install.mjs"
check_file "$ROOT/package/router/temperance-goal.mjs"
check_file "$ROOT/docs/gsd-goal-handoff.md"
check_file "$ROOT/package/manifest-zone/src/GsdDeck.tsx"
check_file "$ROOT/docs/gsd-manifest-spine.md"
check_file "$ROOT/scripts/install-spine.sh"

if grep -R --include='*.ts' --include='*.mjs' --include='*.sh' -n -E "/Users/[A-Za-z0-9_.-]+" \
  "$ROOT/package/hooks" "$ROOT/package/router/gsd-command-install.mjs" "$ROOT/scripts/install-spine.sh" 2>/dev/null \
  | grep -v node_modules; then
  printf 'hardcoded home path in install sources\n' >&2
  fail=1
else
  printf 'ok: no hardcoded home path in spine sources\n'
fi

check_shell_syntax() {
  script="$1"
  shebang=""
  IFS= read -r shebang < "$script" || true

  case "$shebang" in
    *bash*)
      if ! command -v bash >/dev/null 2>&1; then
        printf 'bash required to lint %s\n' "$script" >&2
        fail=1
        return
      fi
      bash -n "$script"
      printf 'syntax ok: %s (bash)\n' "$script"
      ;;
    *)
      sh -n "$script"
      printf 'syntax ok: %s (sh)\n' "$script"
      ;;
  esac
}

for script in "$ROOT"/*.sh "$ROOT/scripts"/*.sh "$ROOT/tests"/*.sh; do
  [ -f "$script" ] || continue
  check_shell_syntax "$script"
done

# --- Private-path guard: role taxonomy + structural pruning -----------------
# File roles:
#   source   — always scanned (default for anything unclassified; fail closed)
#   docs     — always scanned
#   generated — pruned structurally below (dependency/vendor/build output is not
#               source; pruning here is NOT suppression of source violations)
#   fixtures-allowlisted — synthetic private-looking paths permitted ONLY under a
#               fixtures/ directory matching the documented synthetic marker.
#               Synthetic marker convention: paths under /Volumes/fixture/ are
#               test scaffolding, never real host locations. The allowlist set
#               ships EMPTY otherwise.
#
# Patterns are clone-location-generic: any absolute home path, any mounted
# volume path, and session-store names. No maintainer-specific literals.
#
# Self-scan exclusion (role: guard-spec): the guard cannot scan files whose
# purpose is to define or specify the guard itself — its own script, plus the
# explicitly-enumerated phase planning docs that quote its patterns verbatim in
# their verify commands. This set is enumerated below, never globbed; every
# unclassified file still scans as source (fail-closed). Adding a file here
# requires stating in that file why it must quote guard patterns.

GUARD_SPEC=" $ROOT/scripts/verify-install.sh $ROOT/.planning/phases/02-public-source-convergence/02-CONTEXT.md $ROOT/.planning/phases/02-public-source-convergence/02-01-PLAN.md $ROOT/.planning/phases/02-public-source-convergence/02-02-PLAN.md "

# Hits collect into a temp file rather than a captured pipeline: /bin/sh on
# macOS is bash 3.2, whose parser cannot handle a case statement inside
# command substitution.
hits_tmp=$(mktemp "${TMPDIR:-/tmp}/te-private-guard.XXXXXX")

{ find "$ROOT/README.md" "$ROOT/.readme-notebooklm" "$ROOT/.github" \
    "$ROOT/.planning" "$ROOT/docs" "$ROOT/scripts" "$ROOT/templates" \
    "$ROOT/package" "$ROOT/skills" \
    "$ROOT/CHANGELOG.md" "$ROOT/CONTRIBUTING.md" "$ROOT/CREDITS.md" \
    "$ROOT/ISA.md" "$ROOT/SECURITY.md" "$ROOT/UPSTREAM.md" \
    "$ROOT/install.sh" "$ROOT/uninstall.sh" "$ROOT/verify.sh" \
    \( -name node_modules -o -name dist -o -name build \) -prune -o \
    -type f -print 2>/dev/null
  # root level: any file dropped at the repository top must also be scanned
  # (fail-closed default extends to unenumerated top-level files)
  find "$ROOT" -maxdepth 1 -type f -print 2>/dev/null
} | sort -u \
| while IFS= read -r candidate; do
    case "$GUARD_SPEC" in *" $candidate "*) continue ;; esac
    file_hits=$(grep -n -I -E '/Users/[A-Za-z0-9_.-]+|/Volumes/[A-Za-z0-9_-]+/[^/]|\.craft-agent' -- "$candidate" 2>/dev/null \
      | grep -v '<OPERATOR_HOME>\|<PROJECT_VOLUME>\|<SESSION_STORE>\|/Volumes/fixture/' || true)
    if [ -n "$file_hits" ]; then
      printf '%s\n' "$file_hits" >> "$hits_tmp"
      printf 'FILE:%s\n' "$candidate" >> "$hits_tmp"
    fi
  done

if [ -s "$hits_tmp" ]; then
  printf '%s\n' "private local path found in public/install surface:" >&2
  cat "$hits_tmp" >&2
  fail=1
else
  printf '%s\n' "ok: no private local path in public/install surface"
fi
rm -f "$hits_tmp"

if grep -q "assets/banner.png" "$ROOT/README.md" && grep -q "skills.sh" "$ROOT/README.md"; then
  printf '%s\n' "ok: README references banner and skills.sh"
else
  printf '%s\n' "README missing banner or skills.sh guidance" >&2
  fail=1
fi

if grep -q "Thoughtseed Labs" "$ROOT/README.md" && grep -q "Personal_AI_Infrastructure" "$ROOT/CREDITS.md" && grep -q "colbymchenry/codegraph" "$ROOT/CREDITS.md" && grep -q "PeonPing/peon-ping" "$ROOT/CREDITS.md"; then
  printf '%s\n' "ok: README and credits include requested attribution"
else
  printf '%s\n' "README or credits missing requested attribution" >&2
  fail=1
fi

if grep -q "OpenCode/Cursor-first" "$ROOT/README.md" \
  && grep -q "does not require Claude Code" "$ROOT/README.md" \
  && grep -q -- "--with-claude" "$ROOT/README.md" \
  && grep -q -- "--with-codex" "$ROOT/README.md" \
  && grep -q "Claude Code, Claude Pro/Max, Anthropic auth" "$ROOT/templates/cursor.rules.mdc"; then
  printf '%s\n' "ok: OpenCode/Cursor-first docs keep Claude and Codex optional"
else
  printf '%s\n' "OpenCode/Cursor-first optional Claude/Codex guidance missing" >&2
  fail=1
fi

node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$ROOT/skills.sh.json"
printf '%s\n' "ok: skills.sh.json parses"

node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$ROOT/.planning/config.json"
printf '%s\n' "ok: .planning/config.json parses"

if test "$fail" -ne 0; then
  exit 1
fi

printf '%s\n' "Temperance Engine verification passed"
