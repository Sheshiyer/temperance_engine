# Bounded lifecycle updates

`--only` is an install/update scope, not a profile or an approval bypass. It
accepts comma-separated surface IDs and includes exactly their transitive
`depends_on` dependencies. Other profile records appear in neither the plan's
steps nor its outcomes. The full compiled inventory and its digest are retained
for source verification and receipt linkage.

From this package directory, inspect the router update without writing:

```sh
bun run src/cli.ts update --profile default --only router.governed-runtime --dry-run --json
```

For the current router declaration, the emitted scope is:

```json
{
  "mode": "dependency-closure",
  "requested_ids": ["router.governed-runtime"],
  "dependency_ids": ["router.gsd-backup-helper"],
  "record_ids": ["router.governed-runtime", "router.gsd-backup-helper"]
}
```

`steps` are topologically ordered, so the helper precedes the router. Scope lists
are sorted for deterministic review. The JSON apply result emits the same scope;
the transaction receipt lists only scoped outcomes and retains the complete
inventory digest. A dry-run describes the plan; it does not prove current COPY
bytes match their declared inventory or that runtime services are healthy.

After reviewing scope and verifying source inventory, the matching apply form is:

```sh
bun run src/cli.ts update --profile default --only router.governed-runtime --json
```

Unknown IDs, empty/malformed lists, unavailable profile/platform records, private
records, missing dependencies, dependency cycles, and conflicting `--select`
hints are rejected. An unavailable optional capability inside the requested
closure is an error, not silently skipped. `--select` alone retains its historical
admission-hint behavior and does **not** limit a whole-profile operation.

`--only` is rejected for uninstall, rollback, and receipt. Scoped removal would
need reverse-dependency safety; rollback is already scoped by transaction ID.

Lifecycle state uses the explicit API root, then `TEMPERANCE_STATE`, then
`$HOME/.temperance`. The executor and recovery use that same transaction root.
Codex/Claude destinations honor `CODEX_HOME`/`CLAUDE_CONFIG_DIR`; unset values use
`$HOME/.codex` and `$HOME/.claude`. Explicit custom API root resolvers remain
supported. Doctor uses the same default environment bindings.
