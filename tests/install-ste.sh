#!/usr/bin/env bash
# Tests for scripts/install-ste.sh against a local git fixture (no network).
# The fixture files are stubs; they hold no ASD-STE100 content.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT
passes=0
failures=0

check() {
  local label="$1"
  shift
  if "$@"; then
    printf 'ok - %s\n' "$label"
    passes=$((passes + 1))
  else
    printf 'FAIL - %s\n' "$label" >&2
    failures=$((failures + 1))
  fi
}

export GIT_AUTHOR_NAME=fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME=fixture GIT_COMMITTER_EMAIL=fixture@example.invalid
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

UPSTREAM="$TMP_ROOT/upstream"
mkdir -p "$UPSTREAM/references"
git -C "$UPSTREAM" init -q -b main
printf '%s\n' '---' 'name: simplified-technical-english' 'description: stub' '---' >"$UPSTREAM/SKILL.md"
printf '%s\n' '# stub word list' >"$UPSTREAM/references/word-list.md"
printf '%s\n' 'stub notice' >"$UPSTREAM/NOTICE.md"
printf '%s\n' 'stub license' >"$UPSTREAM/LICENSE"
git -C "$UPSTREAM" add -A && git -C "$UPSTREAM" commit -q -m one
PIN1="$(git -C "$UPSTREAM" rev-parse HEAD)"
printf '%s\n' 'second revision' >>"$UPSTREAM/SKILL.md"
git -C "$UPSTREAM" commit -q -am two
PIN2="$(git -C "$UPSTREAM" rev-parse HEAD)"
git -C "$UPSTREAM" rm -q LICENSE && git -C "$UPSTREAM" commit -q -m three
PIN_BAD="$(git -C "$UPSTREAM" rev-parse HEAD)"
git -C "$UPSTREAM" config uploadpack.allowAnySHA1InWant true

# run_ste ENV_DIR [VAR=value ...]: run the installer against a sandbox home.
run_ste() {
  local env_dir="$1"
  shift
  mkdir -p "$env_dir/home"
  env HOME="$env_dir/home" AGENTS_HOME="$env_dir/agents" PAI_HOME="$env_dir/claude" \
    OPENCODE_HOME="$env_dir/opencode" TEMPERANCE_BACKUP_DIR="$env_dir/backups" \
    TEMPERANCE_ROOT="$ROOT" STE_REPO_URL="file://$UPSTREAM" STE_PIN="$PIN1" \
    TEMPERANCE_STE_MODE=install TEMPERANCE_CLAUDE_MODE=install TEMPERANCE_OPENCODE_MODE=install \
    "$@" sh "$ROOT/scripts/install-ste.sh"
}

skill_of() { printf '%s\n' "$1/agents/skills/simplified-technical-english"; }
head_of() { git -C "$(skill_of "$1")" rev-parse HEAD 2>/dev/null; }
links_ok() {
  local skill
  skill="$(skill_of "$1")"
  test "$(readlink "$1/claude/skills/simplified-technical-english")" = "$skill" &&
    test "$(readlink "$1/opencode/skills/simplified-technical-english")" = "$skill"
}

# Default mode is skip.
E="$TMP_ROOT/default"
out="$(run_ste "$E" TEMPERANCE_STE_MODE= 2>&1)"
check "skip is the default and changes nothing" \
  sh -c "printf '%s' \"\$1\" | grep -q 'STE skill skipped' && test ! -e '$E/agents' && test ! -e '$E/claude'" _ "$out"

# Dry run prints the plan and changes nothing.
E="$TMP_ROOT/dry"
out="$(run_ste "$E" TEMPERANCE_DRY_RUN=1 2>&1)"
check "dry run prints the fetch and both links" \
  sh -c "printf '%s' \"\$1\" | grep -q 'DRY_RUN: git fetch --depth 1' && test \"\$(printf '%s' \"\$1\" | grep -c 'DRY_RUN: ln -s')\" = 2" _ "$out"
check "dry run changes nothing" sh -c "test ! -e '$E/agents' && test ! -e '$E/claude' && test ! -e '$E/opencode'"

# Fresh install.
E="$TMP_ROOT/main"
run_ste "$E" >"$TMP_ROOT/main-1.out" 2>&1
check "install fetches the skill at the pin" test "$(head_of "$E")" = "$PIN1"
check "install has the required skill files" \
  sh -c "cd '$(skill_of "$E")' && test -f SKILL.md && test -f references/word-list.md && test -f NOTICE.md && test -f LICENSE"
check "install links the Claude and OpenCode surfaces" links_ok "$E"
check "install leaves a clean checkout" test -z "$(git -C "$(skill_of "$E")" status --porcelain)"

# Rerun is a no-op.
run_ste "$E" >"$TMP_ROOT/main-2.out" 2>&1
check "rerun reports the pinned skill and the links" \
  sh -c "grep -q 'STE skill already at $PIN1' '$TMP_ROOT/main-2.out' && test \"\$(grep -c 'link already present' '$TMP_ROOT/main-2.out')\" = 2"
check "rerun makes no backup" test ! -e "$E/backups"

# A different pin is refused without --force.
run_ste "$E" STE_PIN="$PIN2" >"$TMP_ROOT/main-3.out" 2>&1
check "a pin mismatch is refused without force" \
  sh -c "grep -q 'WARNING: .* is not a clean checkout of $PIN2' '$TMP_ROOT/main-3.out' && test \"\$(git -C '$(skill_of "$E")' rev-parse HEAD)\" = '$PIN1'"

# --force backs up the old copy outside every skills dir, then replaces it.
run_ste "$E" STE_PIN="$PIN2" TEMPERANCE_FORCE=1 >"$TMP_ROOT/main-4.out" 2>&1
check "force replaces the skill with the new pin" test "$(head_of "$E")" = "$PIN2"
backup="$(find "$E/backups" -mindepth 2 -maxdepth 2 -name '*simplified-technical-english' | head -n 1)"
check "force keeps the old copy in the backup dir" \
  sh -c "test -n '$backup' && test \"\$(git -C '$backup' rev-parse HEAD)\" = '$PIN1'"
check "no backup lands inside a skills dir" \
  sh -c "test -z \"\$(find '$E/agents/skills' '$E/claude/skills' '$E/opencode/skills' -mindepth 1 -maxdepth 1 ! -name simplified-technical-english)\""
check "force keeps the surface links" links_ok "$E"

# A dirty checkout is not replaced without --force.
printf '%s\n' 'local edit' >>"$(skill_of "$E")/SKILL.md"
run_ste "$E" STE_PIN="$PIN2" >"$TMP_ROOT/main-5.out" 2>&1
check "a dirty checkout is refused and kept" \
  sh -c "grep -q 'WARNING: .* is not a clean checkout' '$TMP_ROOT/main-5.out' && grep -q 'local edit' '$(skill_of "$E")/SKILL.md'"

# A surface path that the user owns is kept without --force.
E="$TMP_ROOT/collision"
mkdir -p "$E/claude/skills/simplified-technical-english"
printf '%s\n' 'my own copy' >"$E/claude/skills/simplified-technical-english/SKILL.md"
run_ste "$E" >"$TMP_ROOT/collision-1.out" 2>&1
check "an existing surface dir is kept without force" \
  sh -c "grep -q 'WARNING: skipping $E/claude/skills/simplified-technical-english' '$TMP_ROOT/collision-1.out' && grep -q 'my own copy' '$E/claude/skills/simplified-technical-english/SKILL.md'"
check "the other surface is still linked" \
  test "$(readlink "$E/opencode/skills/simplified-technical-english")" = "$(skill_of "$E")"
run_ste "$E" TEMPERANCE_FORCE=1 >"$TMP_ROOT/collision-2.out" 2>&1
check "force backs up the surface dir and links it" \
  sh -c "links_ok() { test \"\$(readlink '$E/claude/skills/simplified-technical-english')\" = '$(skill_of "$E")'; }; links_ok && grep -rq 'my own copy' '$E/backups'"

# Claude mode skip leaves the Claude surface alone.
E="$TMP_ROOT/no-claude"
run_ste "$E" TEMPERANCE_CLAUDE_MODE=skip >/dev/null 2>&1
check "Claude mode skip makes no Claude link" \
  sh -c "test ! -e '$E/claude/skills/simplified-technical-english' && test -L '$E/opencode/skills/simplified-technical-english'"

# Integrity failures exit non-zero and leave no partial skill.
E="$TMP_ROOT/bad-pin"
if run_ste "$E" STE_PIN="$PIN_BAD" >"$TMP_ROOT/bad-pin.out" 2>&1; then
  check "a pin without required files fails" false
else
  check "a pin without required files fails" grep -q 'is missing LICENSE' "$TMP_ROOT/bad-pin.out"
fi
check "a failed install leaves no skill dir" test ! -e "$(skill_of "$E")"

E="$TMP_ROOT/unknown-pin"
if run_ste "$E" STE_PIN=0000000000000000000000000000000000000000 >"$TMP_ROOT/unknown-pin.out" 2>&1; then
  check "an unknown pin fails" false
else
  check "an unknown pin fails" grep -q 'ERROR: could not fetch' "$TMP_ROOT/unknown-pin.out"
fi
check "an unknown pin leaves no skill dir" test ! -e "$(skill_of "$E")"

# A forced update fetches and validates before it retires the active skill.
E="$TMP_ROOT/force-fail"
run_ste "$E" >/dev/null 2>&1
if run_ste "$E" STE_PIN=0000000000000000000000000000000000000000 TEMPERANCE_FORCE=1 >"$TMP_ROOT/force-fail.out" 2>&1; then
  check "a forced update to a bad pin fails" false
else
  check "a forced update to a bad pin fails" grep -q 'ERROR: could not fetch' "$TMP_ROOT/force-fail.out"
fi
check "a failed forced update keeps the active skill" test "$(head_of "$E")" = "$PIN1"
check "a failed forced update leaves both links resolving" \
  sh -c "test -f '$E/claude/skills/simplified-technical-english/SKILL.md' && test -f '$E/opencode/skills/simplified-technical-english/SKILL.md'"
check "a failed forced update makes no backup" test ! -e "$E/backups"

# STE_SKILL_HOME may be a surface path itself; it must never become a self-link.
E="$TMP_ROOT/in-place"
INPLACE="$E/claude/skills/simplified-technical-english"
run_ste "$E" STE_SKILL_HOME="$INPLACE" >"$TMP_ROOT/in-place-1.out" 2>&1
check "an in-place install is a real checkout" sh -c "test -d '$INPLACE/.git' && test ! -L '$INPLACE'"
check "an in-place install is reported as in place" grep -q 'installed in place' "$TMP_ROOT/in-place-1.out"
run_ste "$E" STE_SKILL_HOME="$INPLACE" STE_PIN="$PIN2" TEMPERANCE_FORCE=1 >"$TMP_ROOT/in-place-2.out" 2>&1
check "a forced in-place update never creates a self-link" \
  sh -c "test ! -L '$INPLACE' && test -f '$INPLACE/SKILL.md' && test \"\$(git -C '$INPLACE' rev-parse HEAD)\" = '$PIN2'"
check "the other surface links to the in-place checkout" \
  test "$(readlink "$E/opencode/skills/simplified-technical-english")" = "$INPLACE"

# Uninstall removes only what it manages, in the configured roots, and deletes nothing.
E="$TMP_ROOT/uninstall"
mkdir -p "$E/claude/skills/simplified-technical-english" "$E/home/.claude/skills/simplified-technical-english"
printf '%s\n' 'operator-owned skill' >"$E/claude/skills/simplified-technical-english/SKILL.md"
printf '%s\n' 'default-path skill' >"$E/home/.claude/skills/simplified-technical-english/SKILL.md"
run_ste "$E" >/dev/null 2>&1
run_ste "$E" TEMPERANCE_STE_MODE=uninstall TEMPERANCE_DRY_RUN=1 >/dev/null 2>&1
check "a dry-run uninstall changes nothing" \
  sh -c "test -L '$E/opencode/skills/simplified-technical-english' && test -d '$(skill_of "$E")'"
run_ste "$E" TEMPERANCE_STE_MODE=uninstall >"$TMP_ROOT/uninstall-1.out" 2>&1
check "uninstall removes the managed link" \
  sh -c "test ! -e '$E/opencode/skills/simplified-technical-english' && test ! -L '$E/opencode/skills/simplified-technical-english'"
check "uninstall keeps an operator-owned skill at a configured surface" \
  grep -q 'operator-owned skill' "$E/claude/skills/simplified-technical-english/SKILL.md"
check "uninstall never touches default paths when roots are overridden" \
  grep -q 'default-path skill' "$E/home/.claude/skills/simplified-technical-english/SKILL.md"
check "uninstall moves the checkout to the backup dir" \
  sh -c "test ! -e '$(skill_of "$E")' && find '$E/backups' -path '*simplified-technical-english/.git' -type d | grep -q ."
run_ste "$E" TEMPERANCE_STE_MODE=uninstall >"$TMP_ROOT/uninstall-2.out" 2>&1
check "uninstall is idempotent" grep -q 'is not installed' "$TMP_ROOT/uninstall-2.out"

E="$TMP_ROOT/uninstall-dirty"
run_ste "$E" >/dev/null 2>&1
printf '%s\n' 'local edit' >>"$(skill_of "$E")/SKILL.md"
run_ste "$E" TEMPERANCE_STE_MODE=uninstall >"$TMP_ROOT/uninstall-dirty.out" 2>&1
check "uninstall leaves a dirty checkout without force" \
  sh -c "grep -q 'WARNING: .* is not a clean checkout' '$TMP_ROOT/uninstall-dirty.out' && grep -q 'local edit' '$(skill_of "$E")/SKILL.md'"
check "a refused uninstall keeps both surface links" links_ok "$E"
run_ste "$E" TEMPERANCE_STE_MODE=uninstall TEMPERANCE_FORCE=1 >/dev/null 2>&1
check "a forced uninstall of a dirty checkout unlinks and moves it" \
  sh -c "test ! -e '$E/opencode/skills/simplified-technical-english' && test ! -e '$(skill_of "$E")' && grep -rq 'local edit' '$E/backups'"

# install.sh exposes the flags and calls the installer.
check "install.sh documents --with-ste" sh -c "sh '$ROOT/install.sh' --help | grep -q -- '--with-ste'"
check "install.sh runs scripts/install-ste.sh" grep -q 'sh "$ROOT_DIR/scripts/install-ste.sh"' "$ROOT/install.sh"
check "install.sh defaults the STE mode to skip" grep -qx 'STE_MODE=skip' "$ROOT/install.sh"

printf '%s passed, %s failed\n' "$passes" "$failures"
test "$failures" -eq 0
