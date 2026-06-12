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
check_file "$ROOT/docs/pai-flow.md"
check_file "$ROOT/docs/skill-clusters.md"
check_file "$ROOT/docs/peon-ping-packs.md"
check_file "$ROOT/docs/codegraph-routing.md"
check_file "$ROOT/CREDITS.md"

for script in "$ROOT"/*.sh "$ROOT/scripts"/*.sh; do
  sh -n "$script"
  printf 'syntax ok: %s\n' "$script"
done

user_path_pattern="/""Users""/"
if grep -R "$user_path_pattern" "$ROOT/install.sh" "$ROOT/verify.sh" "$ROOT/scripts" "$ROOT/templates" >/dev/null 2>&1; then
  printf '%s\n' "hard-coded local user path found in install surface" >&2
  fail=1
else
  printf '%s\n' "ok: no hard-coded local user path in install surface"
fi

if test "$fail" -ne 0; then
  exit 1
fi

printf '%s\n' "Temperance Engine verification passed"
