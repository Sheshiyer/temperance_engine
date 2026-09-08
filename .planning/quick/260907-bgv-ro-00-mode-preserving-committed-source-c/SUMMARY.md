---
status: complete
base: 09cbff5ad82cec4b65b5e2f26b201d08e7346c5a
workflow: gsd-quick
---
# RO-00 mode-preserving committed-source COPY inventory — summary

## Delivered

- Extended the public COPY contract with a complete SHA-256 and `0644`/`0755`
  inventory for every actionable file/tree leaf. The lifecycle derives that
  contract only from the compiled record, preserves executable permissions,
  checks staged and promoted files, and restores prior content plus mode.
- Materialized 13 public COPY records (126 leaves: 108 `0644`, 18 `0755`) from
  the pinned source commit `09cbff5ad82cec4b65b5e2f26b201d08e7346c5a` and
  recorded its tree `8fb9f2a7e4f72ee3c6f20b1e0587b88ef36009dd` in a separate
  provenance artifact.
- Corrected the two stale Codex hook names (`GsdCommand.hook.ts` and
  `SessionStartTe.hook.ts`) and declared the direct `ManifestModeCommit` and
  `TemperanceRailAnnounce` hook dependencies.
- Added a TypeScript inventory generator/checker that reads raw Git objects
  from a full commit, applies the deny policy to every leaf, rejects unsafe
  maps, links, special modes, binary data, and inherited Git-locator state,
  then verifies working-tree parity. Its write targets reject symlink and
  hardlink redirection.
- Changed the doctor to compare installed COPY files against declared content
  and mode, including exact tree leaf sets. It no longer treats matching mutable
  source and destination bytes as reviewed-content proof.

## Verification

- `bun test package/install-surface/test` — 181 pass, 0 fail, 435 assertions.
- `bun build` of the CLI, inventory generator, sync script, and doctor
  orchestrator — all succeeded.
- `bun run package/install-surface/src/cli.ts compile` —
  `sha256:0fcf3c2d410203a79c3abf84facb82e1019feb2baf03d740b23a0cd7140031f7`.
- `sync-copy-expectations --check` — 13 records against the pinned commit/tree.
- A temporary-root CLI test ran a declared tree install from an unrelated
  working directory, then rolled it back while preserving a user-owned
  sentinel. No host location was used.
- Two independent Astra reviews found and drove fixes for path publication,
  declared modes, and rollback recovery; final review returned PASS.

## Held boundary

This is source-only evidence. No host installation, launchd restart, service,
combo, provider, SQLite, Superset, Manifest, or Organ Console mutation occurred.
G2 still needs a separately approved, temporary-root **full-surface** replay
covering non-COPY transforms/regenerators, imported runtime closure, injected
interruption, rollback, and unknown-sentinel proof before an installed-runtime
claim or activation is valid.
