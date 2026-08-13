# Temperance Control Ledger

Fail-closed PostgreSQL control plane for approval-bound swarm dispatch. This directory is the design and reference implementation contract; it does **not** dispatch workers.

## Files

- `DESIGN.md` — state machine, table contract, invariant layers, and deployment notes.
- `ISA.md` — Ideal State Artifact; 44 binary ISC probes with per-probe test strategy.
- `schema.sql` — schema, CHECK constraints, partial unique indexes, and the cross-entity `idempotency` table.
- `functions.sql` — transactional guard functions plus `record_outcome` replay storage.
- `tests.sql` — executable invariant suite.

## Apply and test

```bash
createdb temperance_control_ledger_test
psql -d temperance_control_ledger_test -v ON_ERROR_STOP=1 \
  -f schema.sql \
  -f functions.sql \
  -f tests.sql
```

`tests.sql` exercises the fail-closed paths: one active claim per approval, claim replay, drift denials, worktree gate, lease owner checks, expiry, receipt validation, hash-chain integrity, and the anti-invariants.

## Operation order

1. `claim_approval(...)` is the only way to turn an unexpired `granted` approval into a work item. Treat any non-`granted` result as a hard stop.
2. `authorize_dispatch(...)` records a guarded transition but does not start a worker; the real dispatcher must re-check the returned work item and lease ids.
3. `heartbeat_lease(...)` keeps an owner-bound lease alive; `expire_leases()` reaps overdue leases and closes their work items.
4. `submit_receipt(...)` stores hash-verified evidence only while a matching active lease exists.

## Postgres requirement

PostgreSQL 14+ with `pgcrypto` available. The SQL has passed lexical/transaction-structure validation; the full behavioral suite requires a running PostgreSQL server, which is unavailable in this execution environment (`shmget` is denied for sandbox process groups).
