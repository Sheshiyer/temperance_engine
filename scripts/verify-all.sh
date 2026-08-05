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
run bun test package/adapters/command-code/context-sources-line.test.ts
run bash tests/command-code-context-sources.sh
run bun test package/router/routing-policy.test.ts
run bun test package/router/omniroute-portfolios.test.ts
run bun test package/router/omniroute-native-control-plane.test.ts
run bun test package/router/omniroute-context-preview.test.ts
run bun test package/router/omniroute-native-cli-readiness.test.ts
run bun test package/router/temperance-workflows.test.ts
run bun test package/relocation/project-relocation-grammar.test.ts
run bun test package/relocation/project-path-consumers.test.ts
run bun test package/relocation/project-packet-schema.test.ts
run bun test package/relocation/project-packet.test.ts
run bun test package/relocation/project-registry.test.ts
run bun test package/relocation/project-capsule.test.ts
run bun test package/relocation/project-relocation-transaction.test.ts
run bun test package/relocation/project-pickup.test.ts
run bun test package/relocation/project-relocation-rollback.test.ts
run bun test package/relocation/project-relocation-source-guards.test.ts
run bun test package/relocation/project-relocation-apply.test.ts
run bun test package/relocation/session-store-matchers/claude-code-matcher.test.ts
run bun test package/relocation/session-store-matchers/opencode-matcher.test.ts
run bun test package/relocation/session-store-matchers/copilot-matcher.test.ts
run bun test package/relocation/session-store-matchers/codex-matcher.test.ts
run bun test package/relocation/session-store-matchers/kimi-matcher.test.ts
run bun test package/relocation/session-store-matchers/craft-agent-matcher.test.ts
run bun test package/relocation/project-session-map.test.ts
run bun test package/relocation/project-management-record.test.ts
run bun test package/relocation/project-repository-classification.test.ts
run bun test package/relocation/project-nested-repo-discovery.test.ts
run bun test package/relocation/project-candidate-collision.test.ts
run bun test package/relocation/copilot-session-fix.test.ts
run bun test tests/vault-project-relocation.test.ts
run bun test package/router/temperance-stage-contract.test.ts
run bun test package/router/temperance-openai-proxy.test.ts
run bun test package/adapters/opencode/OmniRouteCatalogGuard.test.ts
run bun test package/adapters/opencode/TemperanceFlowPlugin.test.ts
run bun test tests/paseo-vault-projects.test.ts
run bun test package/router/signed-probe-receipt.test.ts
run bun test package/router/signed-probe-challenge-ledger.test.ts
run bun test package/router/omniroute-s-tier-readiness.test.ts
run bun test package/router/omniroute-cloudflare-promotion.test.ts
run bun test package/router/omniroute-cloudflare-production-adapter.test.ts
run bun test tests/omniroute-cloudflare-readiness.test.ts
run bun test tests/omniroute-a2a-readiness.test.ts
run bash tests/omniroute-connections.sh
run bash tests/omniroute-temperance-combos.sh
run bash tests/omniroute-planner-quota.sh
run bash tests/omniroute-memory-sync.sh
run bash tests/omniroute-autostart-launchd.sh
run bash tests/omniroute-native-integration.sh
run bash tests/omniroute-claude.sh
run bash tests/omniroute-opencode.sh
run bash tests/omniroute-codex-preview.sh
run bash tests/omniroute-hermes-preview.sh
run bash tests/omniroute-local-rollback-rehearsal.sh
run bash tests/omniroute-client-auth.sh
run bash tests/omniroute-redact-claude-artifacts.sh
run bash -n scripts/omniroute-client-auth.sh
run bash -n scripts/omniroute-redact-claude-artifacts.sh
run bash tests/temperance-proxy-live.sh
run bash tests/temperance-proxy-launchd.sh
run bash tests/configure-opencode-session-profiles.sh
run bash tests/install-temperance-proxy-systemd.sh
run bash tests/docs-continuity.sh
run bash tests/router-hardening.sh
run bash tests/routing-policy.sh
run bash tests/temperance-routing-policy.sh
run bash tests/dispatch-tasklist.sh
run sh tests/sandbox-install.sh
run sh tests/identity-tool.sh
run bash tests/wire-batch.sh
run bash tests/opencode-relay-config.sh
run bash tests/kimi-relay-config.sh
run bash tests/kimi-desktop-relay-config.sh
run bash tests/kimi-hook.sh
run bash tests/temperance-doctor.sh
run bash tests/classify-task.sh

printf '\n%s\n' "Temperance Engine full verification passed"
