---
status: complete
branch: codex/ro00-native-tree-copy-20260907
base: 09cbff5
implementation_commit: c341190
scope: source-only
---
# RO-00 native implementation receipt

The isolated candidate implements deterministic, text-only directory COPY as individually verified leaf operations, with complete explicit hash declarations, source containment, journal-bound recovery manifests, preimage verification, and drift-protected rollback. No runtime installation is claimed.

## API

`ExecutorOptions.repositoryRoot?: string` is the canonical explicit repository root. `sourceRoot?: string` is an alias; conflicting values fail. Trees require an explicit root. `declaredCopyHashes?: Record<string, Record<string, string>>` maps record ID to the complete leaf-path/hash inventory. Tree keys are relative paths; single-file key is `.`. Hashes are lowercase 64-character SHA-256 with optional `sha256:` prefix. Extra, missing, or mismatched leaves fail before journal/destination writes. Legacy file COPY without a declaration captures and verifies the source digest. Absolute file sources remain a legacy-only compatibility path when no repository root is supplied.

`resolveRoot?: (token: string) => string` supports explicit temporary destination bindings without changing process environment. `rollbackTransaction` accepts this resolver in an optional fourth argument.

## Evidence

Initial new tests ran before implementation: 3 failed, 3 passed. The failing cases were successful tree installation/manifest recovery, partial promotion recovery, and rollback drift preflight. Negative tests initially passed because baseline tree installation already failed; those initial passes alone were not treated as feature proof.

Two later adversarial tests each failed before their fixes: manifest path redirection to a same-content sentinel, and pre-existing stage refusal before journal writes. Both subsequently passed.

Final focused command:

`bun test package/install-surface/test/tree-copy.test.ts package/install-surface/test/lifecycle.test.ts package/install-surface/test/lifecycle-safety.test.ts`

Result: **59 pass, 0 fail, 183 assertions**. The new file contributes 14 tests, covering install/rollback, exact inventory, source links/traversal/binary text, staged corruption, partial failure, destination/preimage drift, manifest corruption, legacy files, ancestor symlinks, stage collision, missing root, and deliberately refused directory uninstall. Repeat rollback is included in the main recovery test.

Broad command: `bun test package/install-surface/test`.

Result: **120 pass, 5 errors/failures**. Five test files could not load because this clean candidate has no `ajv/dist/2020.js` dependency. No dependencies were installed. The passing count includes the lifecycle suite. Host/Manifest tests use injected observations; no live service probes were performed.

`git diff --check` passed before committing.

## Boundaries and limitations

- Source-only candidate. No global runtime, dirty product root, in-progress candidate, CLI, fragment schema, dependency manifest, lockfile, installation, service, provider, account, database, merge, or push changes.
- Parent STATE/roadmap remain coordinator-owned; this quick artifact records completion locally.
- Tree uninstall deliberately fails closed and preserves leaves. Tree rollback is supported; it restores recorded prior leaves and removes only recorded prior-absent leaves. Empty directories are not managed or removed.
- Mixed COPY and legacy non-COPY transactions fail rollback before COPY compensation if a non-COPY STAGE is present, because existing non-COPY recovery lacks a declared hash contract. Legacy transactions without a COPY manifest retain their existing compatibility path.
- Text-only IO rejects NUL/control binary data and U+FFFD. The existing string-only IO seam cannot distinguish malformed UTF-8 from a literal replacement character; the latter is conservatively refused too. Binary payloads and metadata/mode preservation are not supported by this slice.
- Configured roots are trusted boundaries. Existing root and descendant symlinks/hardlinks are refused and physical source containment is checked. This uses the existing path-based IO seam and immediate rechecks, not operating-system directory-handle locking against a continuously racing external writer.
- Staging uses per-transaction leaf names, rejects pre-existing stages before journal/destination writes, and rechecks before use. Every COPY preimage and manifest is written and verified before any leaf promotion. An aborted partial COPY remains explicitly recoverable by rollback.
- CLI/schema binding of declared hashes is a separate coordinator-owned integration task. No claims that existing directory fragments are installable without that binding.
