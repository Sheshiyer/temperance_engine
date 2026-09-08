#!/usr/bin/env bash
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
GUARD_SOURCE="$ROOT/scripts/verify-install.sh"
fixture=""
output=""

cleanup() {
  [ -z "$fixture" ] || rm -rf "$fixture"
  [ -z "$output" ] || rm -f "$output"
}
trap cleanup EXIT

write_lines() {
  local relative_path="$1"
  shift
  mkdir -p "$(dirname "$fixture/$relative_path")"
  printf '%s\n' "$@" > "$fixture/$relative_path"
}

setup_fixture() {
  [ -z "$fixture" ] || rm -rf "$fixture"
  fixture=$(mktemp -d "${TMPDIR:-/tmp}/te-private-path-guard.XXXXXX")
  mkdir -p "$fixture/scripts"
  cp "$GUARD_SOURCE" "$fixture/scripts/verify-install.sh"

  while IFS= read -r relative_path; do
    [ -n "$relative_path" ] || continue
    target="$fixture/$relative_path"
    [ -e "$target" ] && continue
    mkdir -p "$(dirname "$target")"
    case "$relative_path" in
      .planning/config.json|skills.sh.json) printf '%s\n' '{}' > "$target" ;;
      *.sh) printf '%s\n' '#!/usr/bin/env sh' 'exit 0' > "$target" ;;
      *) : > "$target" ;;
    esac
  done < <(sed -n 's/^check_file "\$ROOT\/\(.*\)"$/\1/p' "$GUARD_SOURCE")

  write_lines README.md \
    'assets/banner.png' \
    'skills.sh' \
    'Thoughtseed Labs' \
    'OpenCode/Cursor-first' \
    'does not require Claude Code' \
    '--with-claude' \
    '--with-codex'
  write_lines CREDITS.md \
    'Personal_AI_Infrastructure' \
    'colbymchenry/codegraph' \
    'PeonPing/peon-ping'
  write_lines templates/cursor.rules.mdc 'Claude Code, Claude Pro/Max, Anthropic auth'

  write_lines package/install-surface/src/lifecycle/receipts.ts \
    'const PRIVATE_PATTERNS = [' \
    '  /\/Users\/[A-Za-z0-9_.-]+/g,' \
    '  /\/Volumes\/[A-Za-z0-9_.-]+/g,' \
    '  /\.craft-agent/g,' \
    '];'
  write_lines package/install-surface/test/lifecycle.test.ts \
    '          destination_symbolic: "/Users/testuser/.config/test/file.txt", // PRIVATE_PATH_GUARD_FIXTURE: synthetic redaction rejection'
  write_lines .planning/phases/03-safe-profiles-and-transactional-lifecycle/03-02-PLAN.md \
    "grep -R -nE '/Users/[A-Za-z0-9_.-]+|\\.craft-agent' package/install-surface/src/ \\" \
    '  && exit 1'
  write_lines docs/fixture-example.md 'const fixtureRoot = "/Volumes/fixture/private-path-guard";'
  write_lines .git 'gitdir: /Volumes/fixture/linked-worktree/.git'
}

run_guard() {
  output=$(mktemp "${TMPDIR:-/tmp}/te-private-path-output.XXXXXX")
  TEMPERANCE_ROOT="$fixture" sh "$fixture/scripts/verify-install.sh" > "$output" 2>&1
}

expect_pass() {
  if ! run_guard; then
    cat "$output" >&2
    printf '%s\n' "FAIL: $1 should pass the private-path guard" >&2
    exit 1
  fi
  rm -f "$output"
  output=""
}

expect_reject() {
  local label="$1"
  local expected_path="$2"
  if run_guard; then
    printf '%s\n' "FAIL: $label should fail the private-path guard" >&2
    exit 1
  fi
  grep -Fq 'private local path found in public/install surface:' "$output"
  grep -Fq "$expected_path" "$output"
  rm -f "$output"
  output=""
}

setup_fixture
expect_pass 'escaped grammar, exact synthetic fixture, and linked-worktree metadata'

setup_fixture
printf '%s\n' 'const leaked = "/Users/actual-user/secret";' >> "$fixture/package/install-surface/src/lifecycle/receipts.ts"
expect_reject 'a real path beside the sanitizer regex' 'package/install-surface/src/lifecycle/receipts.ts'

setup_fixture
printf '%s\n' 'const leaked = ".craft-agent";' >> "$fixture/package/install-surface/src/lifecycle/receipts.ts"
expect_reject 'an unescaped session-store name beside the sanitizer regex' 'package/install-surface/src/lifecycle/receipts.ts'

setup_fixture
printf '%s\n' '          destination_symbolic: "/Users/actual-user/.config/test/file.txt", // PRIVATE_PATH_GUARD_FIXTURE: synthetic redaction rejection' >> "$fixture/package/install-surface/test/lifecycle.test.ts"
expect_reject 'a real path beside the synthetic negative fixture' 'package/install-surface/test/lifecycle.test.ts'

setup_fixture
printf '%s\n' 'const leaked = "/Users/actual-user/secret";' >> "$fixture/docs/fixture-example.md"
expect_reject 'a real path beside a fixture namespace example' 'docs/fixture-example.md'

setup_fixture
write_lines docs/fixture-example.md 'const escapedRoot = "/Volumes/fixture/../actual-release-note";'
expect_reject 'a fixture namespace traversal' 'docs/fixture-example.md'

setup_fixture
printf '%s\n' 'const leaked = "/Users/actual-user/secret";' >> "$fixture/scripts/verify-install.sh"
expect_reject 'a real path in the guard source itself' 'scripts/verify-install.sh'

setup_fixture
write_lines CHANGELOG.md '/Volumes/private-volume/actual-release-note'
expect_reject 'a real changelog path' 'CHANGELOG.md'

printf '%s\n' 'ok: private-path guard accepts only grammar and the exact synthetic fixture'
