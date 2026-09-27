---
status: complete
workflow: gsd-quick
scope: source-only
base: 432782ef6bf8eae7b5ba69e5dc5d92abf5873f4b
source_commit: a9391a96d5b7b19ef967fcda8476f591ab1dd408
inventory_commit: 003ff745d1368220e4bf77e26f16c768c65e001c
---

# Product TypeScript foundation convergence — summary

## Delivered

- Reconciled the twelve map-approved product consumers with the recovered
  TypeScript routing foundation and retained `gsd-command-install.mjs` mode
  `0755`.
- Preserved the reviewed classifier and phase-resolver process containment:
  isolated Bun invocation, explicit module paths, and no inherited config or
  preload options. The sourced shell API still emits the product’s established
  direct-route model stream for `multi-backend-router.sh`.
- Made the enrichment direct import installable by declaring
  `router.enrichment-runtime-dependency`, which copies
  `task-classification.ts` to `TEMPERANCE_STATE/runtime/router/`.
- Made `gsd-command-install.mjs`'s adjacent backup helper installable by
  declaring `router.gsd-backup-helper`, which copies the executable helper to
  `TEMPERANCE_STATE/bin/`; the existing governed router COPY supplies its
  adjacent TypeScript implementation.
- Added dependency edges so enrichment selects its runtime classifier and the
  governed router selects its backup helper. The original 13 COPY and 20
  semantic records remain intact; the reviewed inventory is now 15 COPY and
  22 semantic records.
- Added a disposable-root proof that copies only synthetic source, imports the
  installed enrichment route, runs the installed backup helper through a
  disposable Bun shim, and restores both pre-existing destination files and
  modes through the lifecycle rollback journal.
- Regenerated COPY expectations from source commit
  `a9391a96d5b7b19ef967fcda8476f591ab1dd408` and refreshed the lock through
  the owning CLI. The resulting inventory digest is
  `sha256:9b81f80c1bb6fb0270d7a373b616b648e196fd58ff6195fc621c7ea7ecdf6bc3`.

## Commits

- `a9391a9` — `feat(m30): converge installed TypeScript foundations`
- `39863f5` — `test(m30): isolate installed foundation proof`
- `003ff74` — `chore(m30): pin installed foundation inventory`

## Verification

- `bun --no-env-file package/install-surface/scripts/sync-copy-expectations.ts --revision a9391a96d5b7b19ef967fcda8476f591ab1dd408 --check` passed for 15 COPY records and source tree `05017b1d4add01d9a0258f898d7cc5f86a806f4f`.
- `bun --no-env-file package/install-surface/src/cli.ts write-lock` produced
  the recorded 22-record semantic inventory digest.
- `bun install --frozen-lockfile --ignore-scripts` was run only in
  `package/install-surface`; it installed the locked `ajv@8.20.0` dependency
  without changing package or lockfile bytes.
- `bun --no-env-file test ./package/install-surface/test` passed **242 tests,
  11,235 assertions** across 18 files. This includes the checked-in full
  Darwin/Linux replay, doctor read-back, failure recovery, and rollback suite.
- `bun --no-env-file test package/enrich/stages/routing.test.ts` passed 5 tests and 23 assertions.
- `bash tests/classify-task.sh` and `bash tests/router-hardening.sh` passed.
- `node scripts/sync-routing-observation-contract.mjs --check` returned
  `{"ok":true,"changed":[]}`. The independent
  RO06 source-layout aggregate (`routing-observation-installed-layout`,
  `manifest-bridge-runtime-layout`, and `sync-routing-observation-contract`)
  passed **47 tests and 318 assertions**.
- Shell syntax and `git diff --check` passed.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Compatibility bug] Preserved the product shell model stream**
   - The reviewed containment wrapper’s TypeScript `preferred` values are
     `combo:noesis-*`; passing them through the existing sourced shell API made
     `multi-backend-router.sh` discard its direct fallback.
   - The shell now uses the isolated TypeScript contract for task type while
     retaining its reviewed product mapping for `model_for_type` and CLI
     output. Direct TypeScript enrichment remains on the noesis contract.

2. **[Rule 3 - Test-environment isolation] Kept the focused proof independent
   of the schema-loader package**
   - The focused proof reads reviewed fragment declarations directly and
     exercises the lifecycle’s pinned COPY checks, install, import, helper
     execution, and rollback in a synthetic root. After the authorized frozen
     dependency install, the complete schema-backed installer and RO06 suites
     also passed. No dependency version or lockfile changed.

## Held Boundary

This is source and disposable-installation evidence only. No host runtime was
installed, no service or listener was started, and no provider, gateway,
credentials, database, remote, tag, merge, or deployment was touched. The
separately opt-in Manifest CLI smoke was not run because it performs its own
registry dependency installation, outside this source-only acceptance lane.

## Self-Check: PASSED

- The summary exists at its quick-task path.
- Source, focused-test, and generated-inventory commits resolve to `a9391a9`,
  `39863f5`, and `003ff74` respectively.
