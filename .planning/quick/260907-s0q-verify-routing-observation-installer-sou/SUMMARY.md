# RO-06 source parity and review

The explicit Manifest package-root selection is committed as `b386ea0`; reviewed
COPY expectations and their lock are committed as `bf263d6`; the complete-package
guarded CLI smoke is committed as `50029f5`. No host installation,
service change, routing mutation, push or merge occurred in this source lane.

## Pinned content

- Product source revision: `b386ea0868876414ff2839083d12d769428aaf2b`.
- Source tree: `7cbdfa2eaf982a934ec991661c75a54991a2dc9b`.
- Generated lock SHA-256: `2c8afb4ca7b30e731b7f93524eeff8d8582bbb58392158e1582c2ab1d0b4bc09`.
- Thirteen COPY records pass the immutable-revision and current source byte/mode check.
- Only `manifest.bridge-runtime` and `router.governed-runtime` expectations changed.
  All twenty semantic IDs and all ownership, eligibility and service fields remain
  unchanged. The lock required regeneration because its expectation content changed.

The existing owner generated the expectations with `--revision` and `--write`,
then passed its read-only `--check`. The compiler generated the lock through
`write-lock`. Independent Astra review repeated the pinned check and compared
the structured records against the prior revision; it reported PASS with no
remaining finding. No live or mutable runtime files supplied the expectations.

## Verification

- Complete install-surface suite with cleared environment: 241 tests passed,
  10,474 assertions, zero failures. This includes temporary default/darwin and
  default/linux layout install/replay/rollback, doctor read-back, corrupt recovery
  rejection, failed promotion/compensation and exact user-sentinel preservation.
- Installed observation graph and launcher-layout tests: three tests passed,
  132 assertions, zero failures in this clean-source worktree.
- Generated routing contract `--check`, launcher syntax and diff checks passed.
- Before inventory generation, the combined contract, adapter, admission,
  installed observation and launcher test set passed 88 tests / 1,241 assertions.

## Complete-package guarded offline CLI

The Astra verification worker ran
`bun --no-env-file tests/manifest-bridge-installed-cli-smoke.ts --install-locked-dependencies`
successfully (exit zero). The opt-in script uses the real lifecycle COPY for all
27 declared Manifest package files and verifies all 20 static source modules.
It installs 17 packages from the existing frozen lock into that temporary package,
with lifecycle scripts disabled, an explicit empty config and a disposable cache.
Registry access is limited to this dependency-install step. Package declarations
and lock bytes remain identical.

Separate guarded CLI children run absolute installed entrypoints with explicit
temporary state and cleared environment. `snapshot --all` returns zero events;
reserved observation `emit` returns only `observation_disabled`. Missing `pg`
fails before CLI success, and changed source bytes fail preflight. Source rollback
restores the prior declared files/modes while preserving dependencies, unknown
sentinels and separate synthetic history.

- Dependency inventory: 284 files across 17 locked packages.
- Dependency-tree SHA-256: `6bcf325eab1f0a63616786a93c1dba00e2fd8a774aee43f2a108308652e24da3`.
- Frozen lock SHA-256: `6caa340cf2ee264a30c340091d8f1305806cc7119ead11a7fb303c79c3aae6fb`.
- Static source-graph SHA-256: `81f7527d075977aae5cc50bcba5ad9cf1f90aa4478f67580acd189149eab5444`.
- Bridge expectation digest: `sha256:10d477e6e17921528eeab4c1d75a5b01b8d61f13777961f95c772f23039bf467`.

Early harness attempts stopped before registry installation: calling Bun's
resolver recursively from an import hook crashed Bun 1.3.13. Precomputing literal
resolutions fixed the harness; production code was unchanged. Runtime filesystem
and import guards validate the installed allowlist, and network/listener/process
APIs are mocked to reject effects. This is guarded offline loading, not an OS
sandbox or live service proof. The host capture validator's dormant dynamic import,
server handlers, watcher behavior and PostgreSQL connections remain unexercised.

Independent Astra source review passed the final smoke/preload. The reviewer
verified both syntax transforms and the missing-opt-in refusal with cleared
environment; it did not repeat the registry download. The reported successful
complete smoke run belongs to the implementation worker, while the coordinator
independently reviewed source and the previously reported installer/receipt suites.

The clean-source verification worktree was created from the integrated source
and GSD checkpoint `f8b7a49`. Only the install-surface package's existing frozen
Ajv dependency was installed here. Development dependencies in an earlier bridge
worktree were retained; they were not silently excluded from a COPY census.

## Scope

The launch script retains its repository package default and accepts one explicit
absolute `TEMPERANCE_MANIFEST_RUNTIME_ROOT`. `source` inspects the selected CLI and
working directory without resolving host state or opening a service. Tests prove
path selection, including absent repository and invalid explicit root cases.

The nine-file observation fixture proves synthetic production, strict admission,
durable replay, uncertainty/freshness, corruption controls and restoration in a
temporary installed layout. The additional complete-package check proves guarded
offline CLI loading. Neither establishes a running server/PostgreSQL deployment,
live HTTP/SSE or provider attribution. Darwin
and Linux here are declared-layout fixtures executed on this Mac, not native
multi-platform service acceptance. Full G2 and host rollout are not promoted by
this receipt. Optional manifest-zone generation remains explicitly unavailable.
