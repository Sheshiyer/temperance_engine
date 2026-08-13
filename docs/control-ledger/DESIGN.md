# Fail-Closed PostgreSQL Control Ledger for Temperance Swarm Dispatch

This document is the reference contract for a PostgreSQL control plane that sits between an **approval** and **worker dispatch**. It records authority-changing transitions in one transactional system of record so that no worker can be started unless every gate passed *in the same transaction* and no transition can be duplicated.

The dispatcher remains out of scope: this ledger represents dispatch as a guarded state transition, not as a process spawn.

## 1. Core idea

The existing orchestrator (`router/temperance-next-wave.mjs`) produces a proposal and requires an unexpired approval receipt, but the receipt and the subsequent checks live in files (`APPROVALS.json`, `ORCHESTRATION.json`, dispatcher metadata). Files cannot provide atomic compare-and-swap across concurrent dispatchers.

The ledger moves that boundary into PostgreSQL:

- an approval is a **granted capability**, not an authorization token that can be read twice;
- a claim is the **atomic consumption** of that capability;
- a claim produces exactly one work item and one expiring lease;
- all revalidation gates run inside the claim transaction;
- every denial is recorded with a machine-readable reason;
- every authority change is appended to a hash-linked event chain.

The word "fail-closed" has a precise meaning here: **the only way to reach a running work item is to pass every guard in one transaction; any exception, ambiguity, drift, expiry, or duplicate produces a recorded denial and no running work item.**

## 2. State machine

```text
proposal (immutable)
  └── approval: granted ──claim_approval()──▶ consumed
                                              └── claim: active
                                                    ├── work_item: queued
                                                    └── lease: active
work_item: queued ──authorize_dispatch()──▶ running
work_item: running ──submit_receipt()──▶ succeeded
lease: active ──heartbeat_lease()──▶ active (extended)
lease: active ──expire_leases()──▶ expired
claim: active ──release_lease()──▶ released
claim: active ──expire_leases()──▶ expired
```

A work item is `running` only while its claim is active and its lease is unexpired. Expiry of a lease closes the work item and the claim; re-dispatch requires a **new approval** — it never silently re-claims.

## 3. Tables

All tables live in schema `control_ledger`. `*_key` columns are client-supplied idempotency handles and are unique.

| Table | Purpose | Immutability |
|-------|---------|--------------|
| `proposal` | frozen plan fingerprint, policy, budget, concurrency, worktree rule | immutable |
| `approval` | granted capability with expiry and status | controlled status columns only |
| `claim` | atomic consumption of one approval | controlled status columns only |
| `lease` | short-TTL, owner-bound execution lease | controlled expiry/heartbeat/status only |
| `work_item` | one unit of work tied to a claim | controlled status only |
| `dispatch` | guarded dispatch transition record | controlled status only |
| `receipt` | kinded, hash-verified execution evidence | immutable |
| `ledger_event` | hash-linked append-only event chain | immutable |
| `idempotency` | cross-entity method outcomes for retry replay | immutable |

### Column contract

- `proposal`
  - `proposal_key` unique
  - `plan_id`, `option_id`
  - `policy_hash` — hash of the approval-policy document
  - `source_fingerprints` jsonb — hashes of the plan sources
  - `git_head` text — recorded repository head at proposal time
  - `quota_budget` jsonb — budget map (e.g. `{"max_tasks":4,"max_tokens":100000}`)
  - `max_concurrency` int, `worktree_required` bool

- `approval`
  - `approval_key` unique
  - `proposal_id` FK
  - `status` in `granted, consumed, expired, revoked, denied`
  - `expires_at` timestamptz
  - `consumed_at`, `revoked_at`, `deny_reason`

- `claim`
  - `claim_key` unique
  - `approval_id` FK
  - `owner` — worker or execution identity
  - revalidation snapshot: `policy_hash`, `source_fingerprints`, `git_head`, `quota_snapshot`, `concurrency_snapshot`, `worktree`
  - `status` in `active, released, expired, failed`

- `lease`
  - `lease_key` unique
  - `work_item_id`, `claim_id`, `owner`
  - `expires_at`, `heartbeat_count`, `status` in `active, released, expired`

- `work_item`
  - `work_item_key` unique
  - `proposal_id`, `claim_id`
  - `task_spec_hash` — canonical hash of `task_spec`
  - `status` in `queued, running, succeeded, failed, blocked, expired`

- `dispatch`
  - `dispatch_key` unique
  - `work_item_id`, `lease_id`, `combo`, `concurrency`
  - `status` in `queued, started, succeeded, failed, denied`

- `receipt`
  - `receipt_key` unique
  - `work_item_id`, `claim_id`
  - `kind` in `dispatch, task, verification, report`
  - `payload`, `payload_hash`
  - `status` in `stored, replayed, rejected`

- `ledger_event`
  - `event_id`, `entity_type`, `entity_key`, `transition`, `payload`
  - `prev_event_hash`, `event_hash`

- `idempotency`
  - unique `(namespace, idem_key)`
  - `method`, `outcome`, `created_at`

## 4. Invariant enforcement layers

Fail-closed invariants are enforced by **three layers**, so application bugs cannot bypass the database:

1. **CHECK constraints and unique indexes** — hard facts about state shape.
2. **Partial unique indexes** — at most one active claim per approval, one active lease per work item, one receipt per work item and kind.
3. **Guard functions** — the only way to advance state. They run all drift/lease/claim checks in one transaction and return a structured `jsonb` result.

### Partial unique indexes

```sql
CREATE UNIQUE INDEX uq_claim_one_active_per_approval
  ON control_ledger.claim(approval_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX uq_lease_one_active_per_work_item
  ON control_ledger.lease(work_item_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX uq_receipt_one_per_work_item_kind
  ON control_ledger.receipt(work_item_id, kind);
```

These are the second line of defense: if two claims race, `FOR UPDATE` on the approval serializes them; if a caller bypasses the function and writes directly, the partial unique index still prevents a second active claim.

## 5. Atomic claim

`claim_approval(...)` is the single choke point.

### Execution order

1. Replay check: if `claim_key` exists, return the stored claim id and `status: replayed`. No new row.
2. Lock the approval row `FOR UPDATE`.
3. Deny if approval is missing, not `granted`, or `expires_at <= clock_timestamp()`.
4. Load the proposal snapshot.
5. Revalidate the full bundle:
   - `policy_hash` equal
   - `source_fingerprints` equal
   - `git_head` equal
   - `quota_snapshot` within `quota_budget`
   - concurrency within `max_concurrency`
   - worktree flag present when `worktree_required`
6. Insert the claim, consume the approval, create the work item and lease.
7. Append hash-linked events and store the idempotent outcome.
8. Return `status: granted` with claim/work item/lease ids.

### Fail-closed behavior

- Any guard failure returns `status: denied` with a stable `reason`.
- The approval is not consumed on denial, except expiry — an expired approval is marked `expired` at the moment it is observed.
- Any unexpected SQL exception is caught and returned as `status: denied` with `reason: error:<SQLSTATE>`, so an unknown error can never look like a grant.
- The entire transition commits or rolls back as one transaction.

## 6. Idempotency

Every externally supplied operation has a unique key:

| Operation | Key | Replay behavior |
|-----------|-----|-----------------|
| create proposal | `proposal_key` | one proposal row |
| create approval | `approval_key` | one approval row |
| claim approval | `claim_key` | same claim id, `replayed` |
| submit receipt | `receipt_key` | stored receipt, `replayed` |
| queue dispatch | `dispatch_key` | same dispatch id, `replayed` |

Keys are client-generated and lexically safe (`^[A-Za-z0-9._-]+$`). Replay never re-executes a guard, because the stored result is the result of the original execution. The `idempotency` table additionally stores the method and outcome JSON for cross-entity auditing.

The race on the claim is resolved by the approval row lock plus the partial unique index: concurrent claims with different keys for the same approval yield exactly one `granted` and N−1 `denied`.

## 7. Drift detection

Drift means: **the state the dispatcher is about to run does not match the state the approval recorded.**

The ledger never trusts the caller's claim that nothing changed. `claim_approval` compares the caller's revalidation bundle against the `proposal` row stored at approval time:

| Gate | Denial reason |
|------|---------------|
| plan source fingerprints differ | `drift:source_fingerprints` |
| policy hash differs | `drift:policy_hash` |
| git head differs | `drift:git_head` |
| quota exceeds budget | `drift:quota` |
| concurrency over cap | `concurrency_exceeded` |
| worktree required but absent | `worktree_required` |

The snapshot the caller submits is the re-measured state, not the original proposal values. The ledger owns the original values and is therefore the authority that decides whether drift occurred.

## 8. Leases

A lease is the heartbeat that keeps a claimed work item runnable.

- `claim_approval` creates a short-TTL active lease (default 5 minutes).
- `heartbeat_lease(lease_key, owner)` extends `expires_at` and increments `heartbeat_count`, but only for the owner with an unexpired active lease. A non-owner or expired heartbeat updates zero rows.
- `expire_leases()` reaps overdue leases and, in the same statement, closes their work items and claims.
- `release_lease(lease_key, owner)` marks the lease and claim `released`.

There is no automatic renewal. If a worker loses its lease, its work item is closed; a new approval is required. That is the deliberate cost of fail-closed execution.

## 9. Receipts

`submit_receipt(...)` requires:

1. replay check on `receipt_key`;
2. `payload_hash == sha256(canonical_json(payload))`;
3. the work item and claim exist and are linked;
4. the work item has an active, unexpired, owner-matched lease;
5. for kind `task`, `payload_hash` equals the work item's `task_spec_hash`;
6. `(work_item_id, kind)` is not already stored.

Receipts are immutable once stored. A receipt submitted after lease expiry is rejected with `no_active_lease`; a wrong hash is rejected with `receipt_hash_mismatch`; a duplicate kind is rejected with `duplicate_receipt_kind`.

## 10. Hash-linked events

Every authority transition calls `append_event()`, which:

1. locks the single-row `ledger_head` table;
2. computes `sha256(prev_hash || '|' || entity_type || '|' || entity_key || '|' || transition || '|' || payload::text)`;
3. inserts an immutable `ledger_event` row;
4. advances the head.

This makes the entire authority history a tamper-evident chain: a broken link is detectable by re-walking `event_id` order and recomputing hashes. `sha256` here is a wrapper over `pgcrypto.digest(..., 'sha256')`.

## 11. Invariant table

| ID | Invariant |
|----|-----------|
| ISC-1 | All nine tables exist in `control_ledger` |
| ISC-2 | Each authority table has a unique `*_key` handle |
| ISC-3 | `proposal` fingerprint columns are immutable |
| ISC-4 | `approval.status` is constrained to the five legal values |
| ISC-5 | At most one active claim per approval |
| ISC-6 | At most one active lease per work item |
| ISC-7 | At most one receipt per work item and kind |
| ISC-8 | `ledger_event` forms a hash chain |
| ISC-9 | `claim_approval` is atomic; an error leaves no claim row |
| ISC-10 | `claim_approval` returns structured status and reason |
| ISC-11 | Concurrent claims for one approval produce one success |
| ISC-12..ISC-20 | Claim gates and same-transaction approval consumption |
| ISC-21..ISC-24 | Replay/duplicate key idempotency |
| ISC-25..ISC-29 | Drift gates and drift denial reasons |
| ISC-30..ISC-35 | Lease lifecycle |
| ISC-36..ISC-40 | Receipt validation |
| ISC-41..ISC-44 | Anti-invariants |

Full test probes are enumerated in `ISA.md` under `## Test Strategy`.

## 12. Grants and security

- Application role owns no tables directly; it has `EXECUTE` on guard functions and `SELECT` on a read view.
- `INSERT/UPDATE/DELETE` on tables is revoked from the application role so the guard functions are the only mutation path.
- Guard functions set `search_path = control_ledger, public`.
- The database requires `CREATE EXTENSION pgcrypto`.
- All timestamps are `timestamptz`.

## 13. Deployment notes

1. Apply `schema.sql`, then `functions.sql`.
2. Run `tests.sql` against a disposable database (never against production).
3. Wire the dispatcher to call `claim_approval` and treat any non-`granted` result as a hard stop.
4. Run `expire_leases()` on a scheduler interval shorter than the lease TTL.
5. Back up the ledger alongside the WAL; the event chain is the audit record.

## 14. Not included

Worker dispatch, OmniRoute/backend execution, task files, approval UI, migration of existing file receipts, provisioning automation, and the mutation of the existing fail-open resolver are all out of scope for this design.
