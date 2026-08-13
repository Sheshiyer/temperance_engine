---
task: "Design fail-closed PostgreSQL swarm control ledger"
slug: control-ledger
project: temperance-engine
effort: E3
effort_source: fail-safe
phase: observe
progress: 0/44
mode: interactive
started: 2026-08-13T00:00:00+05:30
updated: 2026-08-13T00:00:00+05:30
---

## Problem

Temperance swarm dispatch has a proposal/approval layer in `router/temperance-next-wave.mjs` and receipt artifacts in `receipts/`, but no transactional system of record for the moment a dispatcher turns an unexpired approval into one worker. The existing contract requires an unexpired matching receipt plus revalidation of project scope, Git head, source fingerprints, policy hash, quota, worktree rule, and concurrency before a swarm starts, yet those checks are spread across a fail-open resolver and file receipts. Two concurrent dispatchers can both see the same approval, double-claim work, or run against drifted plan state.

## Vision

A single PostgreSQL control ledger becomes the authority: an approval is consumed exactly once, every dispatch transition is provably revalidated in the same transaction, in-flight work is bounded by expiring leases, and every receipt is idempotent and hash-verifiable. The system fails closed — ambiguity, expiry, drift, duplicate claim, or lost lease means no worker starts, and the denial is recorded rather than guessed.

## Out of Scope

No worker dispatch, OmniRoute/backend execution, or task files are written from this work. No new approval UI, no PostgreSQL cluster provisioning or deployment automation, no migration of the existing file receipts into the ledger, and no change to the existing fail-open resolver's behavior. The ledger is the control-plane contract and reference SQL only.

## Principles

- Fail closed is the default: uncertainty never becomes a running worker.
- The ledger is the single system of record; files and caller memory are derived views.
- One transaction per authority-changing transition; deny on any exception.
- Idempotency keys are first-class, so retries cannot double-dispatch.
- Drift is measured against the recorded snapshot, not the caller's claim.
- Leases are short, owner-bound, renewable, and always expiring.
- Every authority change leaves a hash-linked, append-only event.

## Constraints

- PostgreSQL 14+ features only: `FOR UPDATE`, `INSERT ... ON CONFLICT DO NOTHING`, partial unique indexes, GiST exclusion, advisory locks, `timestamptz`, `sha256(bytea)`.
- No trigger bypass: constraints and guards must hold even for direct SQL, not just application code.
- Approval, claim, lease, receipt, and event tables are immutable once committed except for controlled state columns.
- Idempotency keys are client-supplied and globally unique within their entity namespace.
- Dispatch capability is never granted by a table row alone; a guard function must execute all gates inside the transaction.
- Workers are not dispatched in this design; dispatch is represented only as a guarded state transition.

## Goal

Ship a PostgreSQL control-ledger design and executable reference SQL for approval-bound Temperance swarm dispatch whose atomic claim, idempotency, drift, lease, receipt, and test invariants are all stated as binary SQL probes and enforced by database constraints plus transactional guard functions.

## Criteria

- [ ] ISC-1: `control_ledger` schema contains `proposal`, `approval`, `claim`, `lease`, `work_item`, `dispatch`, `receipt`, `ledger_event`, `idempotency` tables
- [ ] ISC-2: Every authority table has a unique `*_key` idempotency handle
- [ ] ISC-3: `proposal` plan fingerprint columns are immutable after insert
- [ ] ISC-4: `approval.status` is constrained to granted, consumed, expired, revoked, denied
- [ ] ISC-5: Exactly one active claim can exist per approval
- [ ] ISC-6: Exactly one active lease can exist per work item
- [ ] ISC-7: Exactly one receipt can exist per work item and receipt kind
- [ ] ISC-8: `ledger_event.prev_event_hash` links every event into a hash chain
- [ ] ISC-9: `claim_approval()` is transactional; a raised error leaves no claim row
- [ ] ISC-10: `claim_approval()` returns a structured result with status and denial reason
- [ ] ISC-11: Concurrent claims for one approval produce exactly one success and N-1 denials
- [ ] ISC-12: Claim requires approval status `granted`
- [ ] ISC-13: Claim requires approval `expires_at` in the future
- [ ] ISC-14: Claim requires the caller policy hash to equal the proposal policy hash
- [ ] ISC-15: Claim requires the caller source fingerprints to equal the proposal fingerprints
- [ ] ISC-16: Claim requires the caller Git head to equal the proposal Git head
- [ ] ISC-17: Claim requires the quota snapshot to be within the proposal budget
- [ ] ISC-18: Claim respects proposal `max_concurrency`
- [ ] ISC-19: Claim enforces the proposal worktree requirement
- [ ] ISC-20: Claim consumes the approval from `granted` to `consumed` in the same transaction
- [ ] ISC-21: Replaying the same claim key returns the same claim id with no duplicate row
- [ ] ISC-22: Replaying the same receipt key returns the stored receipt with one row
- [ ] ISC-23: A duplicate approval key cannot create a second approval
- [ ] ISC-24: Idempotency outcomes are stored and returned on replay
- [ ] ISC-25: Source fingerprint drift denies the claim with reason `drift`
- [ ] ISC-26: Policy hash drift denies the claim
- [ ] ISC-27: Git head drift denies the claim
- [ ] ISC-28: Quota drift denies the claim
- [ ] ISC-29: Drift validation compares ledger snapshot against the revalidation bundle, not only caller-supplied values
- [ ] ISC-30: A successful claim creates a short-TTL lease
- [ ] ISC-31: An active-lease owner heartbeat extends `expires_at`
- [ ] ISC-32: A non-owner heartbeat updates zero rows
- [ ] ISC-33: An expired lease cannot be renewed
- [ ] ISC-34: Receipt submission requires an active lease
- [ ] ISC-35: Lease release marks the claim released; expiry fails the work item closed and requires a new approval
- [ ] ISC-36: A receipt must reference a valid claim
- [ ] ISC-37: A receipt payload hash must verify against the task spec hash
- [ ] ISC-38: Receipt kind is constrained to dispatch, task, verification, report
- [ ] ISC-39: Duplicate receipt submissions are rejected or replay the stored receipt
- [ ] ISC-40: A receipt submitted after lease expiry is rejected
- [ ] ISC-41: Anti: no active claim exists for a denied, expired, or revoked approval
- [ ] ISC-42: Anti: no work item is `running` without an active claim and lease
- [ ] ISC-43: Anti: an unknown error during claim returns denial to the caller, never a running worker
- [ ] ISC-44: Anti: hash-chain tamper detection identifies any broken link

## Test Strategy

| isc | type | check | threshold | tool |
|-----|------|-------|-----------|------|
| ISC-1 | schema | `information_schema.tables` count | 9 rows | `psql` |
| ISC-2 | schema | unique indexes on `*_key` | 9 indexes | `psql` |
| ISC-3 | integrity | update plan fingerprint raises | error | `psql` |
| ISC-4 | constraint | invalid status insert fails | error | `psql` |
| ISC-5 | constraint | second active claim insert fails | error | `psql` |
| ISC-6 | constraint | second active lease insert fails | error | `psql` |
| ISC-7 | constraint | duplicate task/kind receipt insert fails | error | `psql` |
| ISC-8 | integrity | hash chain query links consecutive events | 100% | `psql` |
| ISC-9 | atomicity | abort transaction then count claims | 0 | `psql` |
| ISC-10 | api | call returns JSON with status and reason | status present | `psql` |
| ISC-11 | concurrency | parallel `claim_approval` calls | 1 success | `psql`/`pgbench` |
| ISC-12 | guard | claim after revocation is denied | denied | `psql` |
| ISC-13 | guard | claim after expiry is denied | denied | `psql` |
| ISC-14 | drift | mismatched policy hash denied | denied | `psql` |
| ISC-15 | drift | mismatched fingerprints denied | denied | `psql` |
| ISC-16 | drift | mismatched Git head denied | denied | `psql` |
| ISC-17 | drift | over-budget quota denied | denied | `psql` |
| ISC-18 | guard | claim past concurrency cap denied | denied | `psql` |
| ISC-19 | guard | worktree-required claim without worktree denied | denied | `psql` |
| ISC-20 | atomicity | claim result and approval status same transaction | consumed | `psql` |
| ISC-21 | idempotency | same claim key twice | same claim id | `psql` |
| ISC-22 | idempotency | same receipt key twice | one receipt | `psql` |
| ISC-23 | idempotency | same approval key twice | one approval | `psql` |
| ISC-24 | idempotency | replay returns stored outcome | equal | `psql` |
| ISC-25 | drift | fingerprint drift deny reason | `drift` | `psql` |
| ISC-26 | drift | policy drift deny reason | `drift` | `psql` |
| ISC-27 | drift | Git head drift deny reason | `drift` | `psql` |
| ISC-28 | drift | quota drift deny reason | `drift` | `psql` |
| ISC-29 | drift | validator reads snapshot columns | compare true | `psql` |
| ISC-30 | lease | claim leaves lease with future expiry | expires > now | `psql` |
| ISC-31 | lease | owner heartbeat extends expiry | later expiry | `psql` |
| ISC-32 | lease | non-owner heartbeat row count | 0 | `psql` |
| ISC-33 | lease | expired lease heartbeat | 0 | `psql` |
| ISC-34 | lease | receipt with expired lease rejected | error | `psql` |
| ISC-35 | lease | release marks claim released | released | `psql` |
| ISC-36 | receipt | receipt for missing claim rejected | error | `psql` |
| ISC-37 | receipt | wrong payload hash rejected | error | `psql` |
| ISC-38 | receipt | invalid kind rejected | error | `psql` |
| ISC-39 | receipt | duplicate kind replay | stored row | `psql` |
| ISC-40 | receipt | expired lease receipt rejected | error | `psql` |
| ISC-41 | anti | active claim for non-granted approval count | 0 | `psql` |
| ISC-42 | anti | running task without lease count | 0 | `psql` |
| ISC-43 | anti | forced error returns denied | denied | `psql` |
| ISC-44 | anti | tamper probe marks broken link | true | `psql` |

## Features

| name | description | satisfies | depends_on | parallelizable |
|------|-------------|-----------|------------|----------------|
| schema | DDL and constraints for all ledger tables | ISC-1..ISC-8 | none | false |
| state-guards | CHECK constraints and transition guard triggers | ISC-4..ISC-7, ISC-41..ISC-42 | schema | false |
| claim | transactional `claim_approval()` and denial path | ISC-9..ISC-20, ISC-25..ISC-29, ISC-43 | state-guards | false |
| idempotency | replayable keyed outcomes for approval, claim, receipt | ISC-21..ISC-24 | schema | true |
| drift | snapshot-based revalidation bundle comparison | ISC-14..ISC-17, ISC-25..ISC-29 | claim | false |
| lease | lease create, heartbeat, release, expiry handling | ISC-30..ISC-35 | claim | false |
| receipt | receipt ingest, verification, replay | ISC-36..ISC-40 | lease | false |
| audit | hash-linked event log and tamper probe | ISC-8, ISC-44 | schema | false |
| invariant-tests | executable SQL test suite | ISC-11..ISC-44 | all | false |

## Decisions

- `2026-08-13` — Treat `approval` consumption and `claim` creation as one transaction; partial unique index is the second line of defense against direct SQL double-claim.
- `2026-08-13` — Model an expired lease as work-item `failed`/`blocked` requiring a new approval, rather than silent re-claim, to keep fail-closed semantics.

## Verification

- ISC-1: schema — `CREATE TABLE` count = 10 in `docs/control-ledger/schema.sql`
- ISC-2: schema — unique key columns on proposal/approval/claim/work_item/lease/dispatch/receipt plus `UNIQUE(namespace,idem_key)`
- ISC-5..ISC-7: constraint — `uq_claim_one_active_per_approval`, `uq_lease_one_active_per_work_item`, `uq_receipt_one_per_work_item_kind` present
- ISC-8: integrity — `append_event()` and `ledger_integrity_check()` present
- ISC-9/ISC-10/ISC-43: api — `EXCEPTION WHEN OTHERS` returns `denied`/`error:SQLSTATE`; structured `jsonb_build_object` results
- ISC-11: concurrency — approval `FOR UPDATE` plus active-claim partial unique index
- ISC-12..ISC-20: guard — status/expiry/drift/concurrency/worktree branches present and approval consumed in same transaction
- ISC-21..ISC-24: idempotency — replay branches and `record_outcome()` storage present
- ISC-25..ISC-29: drift — `drift:policy_hash`, `drift:source_fingerprints`, `drift:git_head`, `drift:quota` denial reasons present
- ISC-30..ISC-35: lease — active lease on claim, owner-bound heartbeat, `expire_leases()`, `release_lease()` present
- ISC-36..ISC-40: receipt — work item/claim link, hash comparison, kind CHECK, duplicate handling, active-lease check present
- ISC-41/ISC-42/ISC-44: anti — active-claim-on-non-granted, running-without-lease, and integrity probes in `tests.sql`

## Changelog

- conjectured: file receipts plus fail-open resolver logic are sufficient for swarm control-plane safety
- refuted by: the orchestrator contract itself requires a future dispatcher to atomically revalidate approval, scope, git head, fingerprints, policy, quota, worktree, and concurrency before dispatch
- learned: atomic authority must live in one PostgreSQL transaction with approval-row locking, drift comparison against a stored snapshot, partial unique indexes, and an exception-to-denial path
- criterion now: ISC-1..ISC-44 encode a fail-closed claim/idempotency/drift/lease/receipt/audit ledger
