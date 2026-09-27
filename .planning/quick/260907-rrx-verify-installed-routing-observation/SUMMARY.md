# RO-05 result

Completed source/temporary-layout verification against product source commit `1ecc502cf36a610f88888cfbdf2009bfce08a0ac`, containing reviewed RO-04 implementation `c854e21`. The coordinator committed the exact test/helper paths as `a40ee6e`. No push or runtime installation occurred.

Independent Astra review passed. Reviewer and coordinator reran the installed proof with cleared environment; the combined installed/layout check passed 3 tests and 132 assertions. The coordinator also verified the integrated contract, adapter, admission, installed proof and layout set: 88 tests, 1,241 assertions, zero failures. These totals apply to the named combined commands, not to individual adapter-only test counts.

Validation: `bun --no-env-file test tests/routing-observation-installed-layout.test.ts` on Bun 1.3.13 passed: **1 test, 121 assertions, 0 failures**. Earlier harness-only failures were corrected: COPY-only transactions use `temperance.copy-manifest.v2`; Bun runtime import hooks validate targets and then continue normal file resolution. No production source was changed to make the test pass.

## Proven scope

- Nine explicitly named source files form the bounded adapter/contracts/admission/store/catalog graph. Runtime local imports and builtin dependencies are checked before execution; unsupported dynamic imports and undeclared external imports fail. Every source byte is checked against the captured Git commit; source size, SHA-256 and mode are checked again at the installed destination. Both generated contracts match the canonical contract SHA.
- The real fragment compiler, lifecycle planner, tree COPY executor and rollback implementation install test-only router and bridge records under `router` and `runtime/manifest-bridge`. The fixture is an explicit per-run source snapshot, not a production inventory or independently pinned promotion manifest.
- A child with an empty supplied environment, `--no-env-file`, disposable cwd and absolute installed entrypoints performs synthetic adapter production, strict admission, catalog/store persistence, duplicate no-op, immutable conflict rejection, reload/replay and single/all-project snapshots. Stale freshness and unavailable attribution/tool telemetry remain separate, with exact receipt serialization and canonical bytes preserved. Routing/approval/dispatch/agent projections remain empty.
- A child import hook checks the installed allowlist and hashes. Narrow test filesystem wrappers delegate to real operations inside the disposable root and reject outside paths; child process execution is disabled. Lifecycle IO independently guards mutation roots and rejects process/network requests.
- Removing the bridge contract or changing one byte fails preflight before a second child launch. Saved preimages are readable and hash-equivalent. Installation retry and two rollback transactions restore prior file bytes/modes and absent leaves, preserve unknown sentinel files, retain synthetic event history separately, and leave disposable source unchanged. Rollback retry is idempotent.

## Boundaries

This is a bounded source and synthetic temporary-installation receipt. The filesystem/import guards are not an operating-system sandbox. No bridge socket listener, HTTP endpoint, network/service manager, host install, live provider, full CLI/server/PostgreSQL closure, external consumer, or cross-process admission claim is established by this test. RO-04 owns its broader source tests; RO-06 owns production COPY inventory, pinned provenance, launch-layout policy and integration. Full-surface rollback failure/drift gates remain with the existing lifecycle suite.

Owned files: this plan/summary, `tests/routing-observation-installed-layout.test.ts`, and `tests/fixtures/routing-observation/installed-child.ts`. No production files, install fragments, lockfiles or other workers' changes were edited.
