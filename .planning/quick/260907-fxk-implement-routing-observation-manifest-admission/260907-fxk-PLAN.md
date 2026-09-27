# RO-04 Manifest admission

GSD quick receipt: 260907-fxk. Baseline: 71d0793. Exclusive scoped worktree.

Implement an opt-in trusted policy boundary before generic normalization and project registration; enforce strict envelope and shared receipt validation in store ingest and durable replay. Preserve receipt identity, deterministic retry/conflict behavior, immutable freshness projection, explicit aggregate collection, bounded errors, and generic behavior. Serialize observation admission using a per-stream exclusive lock with replay inside the lock; no stale-lock stealing.

Expose synthetic HTTP/CLI input seams without opening listeners. Verify hostile input/privacy, disabled defaults, replay recovery, retries/conflicts, independent projects, immutable snapshots, concurrent writer behavior and legacy projections. Run selected existing tests that do not open listeners, plus a no-environment synthetic suite.

Ownership: this plan/summary, package/manifest-bridge/src (excluding generated contract), package/manifest-bridge/test. Do not change canonical/generated RO-01/02, router, installer, locks, host state, services, or STATE. No commits, installation, network listeners, database access, provider/combo writes or consumer changes.
