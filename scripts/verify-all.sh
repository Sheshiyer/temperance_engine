#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

if ! command -v bun >/dev/null 2>&1; then
  printf '%s\n' "bun is required for package/enrich tests" >&2
  exit 127
fi

run ./verify.sh
run bun test package/enrich
run bun test package/router/routing-policy.test.ts
run bun test package/adapters/opencode/OmniRouteCatalogGuard.test.ts
run bash tests/docs-continuity.sh
run bash tests/router-hardening.sh
run bash tests/routing-policy.sh
run bash tests/dispatch-tasklist.sh
run sh tests/sandbox-install.sh
run sh tests/identity-tool.sh
run bash tests/wire-batch.sh
run bash tests/classify-task.sh

printf '\n%s\n' "Temperance Engine full verification passed"
