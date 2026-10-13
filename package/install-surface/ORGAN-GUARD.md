# Optional organ guard source package

This profile installs only reviewed source files into TEMPERANCE_STATE/optional/organ-guard, preserving their bin/router topology. It installs no organ implementations, jobs, callbacks, provider configuration or routing changes. Existing default/minimal profiles exclude it.

Use explicit profile and scope:

```sh
temperance install --profile organ-guard --only organ-guard.source --dry-run
temperance install --profile organ-guard --only organ-guard.source
```

`--select` is an admission hint, not plan isolation. An installed lifecycle receipt means copied source hashes/modes and transaction completion, not command execution, Python availability/version, Darwin ABI compatibility, Linux accounting support, callback delivery, capacity or semantic acceptance. Those runtime prerequisites remain unaccepted. Source copying does not require Python.

Updates use the same explicit profile/scope. The existing transaction journal records preimages and supports rollback by transaction ID. Uninstall uses the dedicated organ-guard profile; scoped uninstall is unsupported by the existing reverse-dependency contract. Review dry-run and destination drift before any action. No install is performed by this document.

The generator's scoped `--only organ-guard.source` update pins its source tree at public6195142 while provenance v2 carries each older COPY record's original revision/tree. Retained declarations are reconstructed from those commits before merging. Existing expectations are preserved. Unscoped v2 check validates every pinned record and current source; explicit unscoped write remains an all-record single-revision operation and can refresh unrelated declarations. Do not use it for this optional addition.

The compiled global inventory digest and a new skipped outcome change truthfully, while pre-existing selected steps/outcomes remain unchanged. The public guard's successful inert CLI fixture was held/skipped under elevated pressure; source installation does not close native or sustained-memory acceptance. See ../organ-guard/README.md for limitations.

A separate pre-existing contract gap remains: RuntimeDependency is typed and consumed by the lifecycle executor, but `requires` is absent from the closed fragment/lock schemas. This source-only record does not introduce or rely on that field.
