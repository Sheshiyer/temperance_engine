# Swarm Control Runbook

Automatic launch is disabled by default. It becomes eligible only when both environment gates are deliberately enabled:

```bash
export TEMPERANCE_CONTROL_DATABASE_URL='postgresql://…'
export TEMPERANCE_SWARM_CONTROL_ENABLED=1
export TEMPERANCE_SWARM_AUTOLAUNCH=1
```

The control plane uses PostgreSQL for approval records, one-use claims, cancellable outbox records, and task receipts. Manifest JSONL/SSE is an audit projection; it cannot authorize a worker.

## Release checks

1. In this source checkout, run `TEMPERANCE_CONTROL_DATABASE_URL=… bun test` in `package/manifest-bridge`.
2. Require the PostgreSQL behavior cases: race, expiry, immutable drift, stale/ineligible quota, and cancellation.
3. Supply a frozen `swarm-claim.json` with the approved plan/option, current Git head, source fingerprints, task fingerprint, exact `te-dispatch-paid`, 1–4 concurrency, worktree requirement, and quota snapshot path.
4. First run `node package/router/temperance-swarm-dispatch.mjs --request .planning/swarm-claim.json --dry-run` from this checkout.
5. Enable auto-launch only for a clean Git worktree and bounded project root. Merges, deploys, GitHub sync, skill installation, credentials, and backend/model overrides need separate approval.

## Recovery

- **Expired or drifted:** create a new proposal and approval; never edit a prior receipt.
- **Cancelled before delivery:** cancel the claim; the outbox becomes non-deliverable.
- **Lease expiry:** do not reuse the claim. Inspect receipts and create a new bounded proposal.
- **Worker failure:** preserve the receipt, publish a failed dispatch event, and re-plan only the failed task.
- **Database unavailable:** fail closed; automatic launch must not fall back to JSONL or direct `temperance-batch`.
