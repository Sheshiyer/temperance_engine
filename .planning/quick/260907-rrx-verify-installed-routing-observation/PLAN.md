# RO-05: disposable installed routing-observation replay

Scope: source tests and a synthetic temporary installation only. Parent owns reviewed RO-04 integration and RO-06 production inventory/provenance. No host installation, services, network, production fragments, or lock changes.

1. Declare the complete bounded local import graph for adapter, generated contracts, admission, store and catalog. Fingerprint source bytes/modes and validate every installed import and hash before child execution. Exclude the full CLI/server/PostgreSQL graph explicitly.
2. Compile two test-only tree COPY records at the real `router` and `runtime/manifest-bridge` destinations. Apply the existing lifecycle executor with injected disposable roots and guarded IO.
3. Execute installed absolute modules in a child with an empty environment, disabled env-file loading and disposable cwd. Assert synthetic admission, exact retry, conflict, persistent reload/replay, catalog snapshots, stale and uncertain state with immutable receipt bytes.
4. Remove a required contract and change one byte separately; fail preflight before spawning. Roll back both an installation retry and the original transaction, proving prior bytes/modes/file absence and unknown sentinel preservation.
5. Run the focused test after parent integrates reviewed RO-04; report exact evidence and remaining gates in SUMMARY.md. Do not commit or push.
