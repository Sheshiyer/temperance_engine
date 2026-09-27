# RO-06 installer source parity

GSD quick initialized as 260907-s0q on 2026-09-07. The authorized source consolidation continues in the isolated integration worktree. Native Astra workers own the separate RO-05 fixture paths; the coordinator owns this slice and will preserve their changes.

1. Give the existing platform launcher an explicit Manifest package-root override, retaining its repository default. Add a read-only source inspection command and verify both layouts with temporary fixtures and missing-source controls. Do not invoke launchctl or alter the running host.
2. After reviewed RO-03/04 and RO-05 source integration, capture one full immutable source revision. Refresh only changed COPY expectations through sync-copy-expectations, check all public source bytes and compile semantic records. Write the lock through its owner only if its canonical bytes change.
3. Run the relevant launch-layout test, generated contract parity, installed receipt fixture and complete install-surface tests. Investigate concrete failures; keep actual host installation and full bridge CLI dependency/startup qualification separate from the nine-file observation closure.
4. Record exact revision, hashes, semantic IDs, validation and remaining gates. Commit exact source/generated/doc paths and an additive STATE quick row. No merge, push, release, services, live provider calls, routing writes or milestone advancement.

The coordinator additionally authorizes a bounded complete-package offline CLI
startup proof, delegated to the existing Astra verification worker after static
inspection found the command paths safe with explicit state roots. Ownership:
tests/manifest-bridge-installed-cli-smoke.ts and, if needed,
tests/fixtures/routing-observation/cli-preload.ts. The manually invoked script
uses real COPY, frozen package dependency installation with scripts disabled and
a disposable cache, then absolute installed CLI snapshot/emit commands with
cleared runtime environment. Registry downloads are limited to the dependency
installation step; CLI execution must not open sockets, call services, resolve
host sources or execute subprocesses. Missing dependency/source drift controls,
locked metadata parity, dependency tree hashes and restoration stay explicit.
This can prove offline CLI loading but cannot qualify server handlers, dormant
host dynamic imports, a running PostgreSQL service or live provider execution.

Owned paths: scripts/temperance-manifest-bridge-launchd.sh; tests/manifest-bridge-runtime-layout.test.ts; package/manifest-bridge/README.md; package/install-surface/fragments affected by the source owner; package/install-surface/copy-expectations.provenance.json; package/install-surface/install-surface-manifest.lock.json if needed; this quick directory and additive STATE row.

Acceptance: explicit layout selection, no source guessing; missing source fails before service operations; pinned source/install byte and mode parity; unchanged semantic record IDs; full disposable lifecycle restoration passes; verification scope and unrun live gates stay visible. Full G2 is not satisfied by a nine-file runtime fixture alone.
