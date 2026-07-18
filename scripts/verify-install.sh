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

private_home_pattern="/""Users""/"
private_volume_pattern="/""Volumes""/madara"
private_craft_pattern="$(printf '.%s' 'craft-agent')"
if grep -R -n -I -F \
  -e "$private_home_pattern" \
  -e "$private_volume_pattern" \
  -e "$private_craft_pattern" \
  "$ROOT/README.md" \
  "$ROOT/.readme-notebooklm" \
  "$ROOT/.github" \
  "$ROOT/.planning" \
  "$ROOT/docs" \
  "$ROOT/scripts" \
  "$ROOT/templates" \
  "$ROOT/package" \
  "$ROOT/skills" \
  "$ROOT/CHANGELOG.md" \
  "$ROOT/CONTRIBUTING.md" \
  "$ROOT/CREDITS.md" \
  "$ROOT/ISA.md" \
  "$ROOT/SECURITY.md" \
  "$ROOT/UPSTREAM.md" \
  "$ROOT/install.sh" \
  "$ROOT/uninstall.sh" \
  "$ROOT/verify.sh" >/dev/null 2>&1; then
  printf '%s\n' "private local path found in public/install surface" >&2
  fail=1
else
  printf '%s\n' "ok: no private local path in public/install surface"
fi

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
