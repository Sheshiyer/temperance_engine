# Temperance Orchestration Contract

`temperance.orchestration.v1` turns a planning artifact into an auditable decision proposal. It is not a dispatcher.

```text
research.collected → plan.option.proposed → approval.requested
  → approval.granted | approval.rejected | approval.expired
  → dispatch.readiness → dispatch.queued → dispatch.started
  → task.* → report.published
```

## Mapping authority

The workflow may select a skill without the user naming it: Algorithm policy auto-invokes core skills at the applicable tier, and the active agent may use a clearly matching skill. The prompt hook itself only injects classified context and recommendations.

Mapping remains legible through four authorities:

- `skill-clusters/skill-index.json`: generated skill resolution and tier policy.
- `router/classify-task.sh` plus `phase-combo-map.json`: task/phase to OmniRoute combo.
- `.planning/PLAN-OPTIONS.json`: planner-owned alternatives and research citations.
- `.planning/ORCHESTRATION.json`: immutable proposal fingerprint, selected option, policy hash, approval, readiness, and receipt expectations.

No recommendation grants authority. Deferred activation, marketplace installation, paid fleet work, GitHub sync, merge, deployment, credential changes, and model overrides retain separate approval requirements.

## Approval boundary

The next-wave resolver is proposal-only. It writes no batch tasks until it finds an unexpired matching receipt in `.planning/APPROVALS.json`. With `TEMPERANCE_SWARM_CONTROL_ENABLED=1` and `TEMPERANCE_CONTROL_DATABASE_URL`, the bridge mirrors an approved bounded paid-fleet option into PostgreSQL. `temperance-swarm-dispatch` atomically claims that approval, revalidates project scope, Git head, source/task fingerprints, policy hash, quota, worktree rule, and concurrency, then launches only when `TEMPERANCE_SWARM_AUTOLAUNCH=1`. Without these two environment gates it exits before a worker starts.

The ledger is authoritative for execution and JSONL/SSE remain projections. PostgreSQL tables store approval, one-use claim, cancellable outbox, and task receipts; the direct batch adapter accepts an opaque claim only when `TEMPERANCE_REQUIRE_CONTROL_CLAIM=1`.

## Planner input

An optional `.planning/PLAN-OPTIONS.json` supplies two to four alternatives and their research:

```json
{
  "research": [{ "label": "source", "path": "docs/research.md", "finding": "..." }],
  "options": [{ "option_id": "opt_a", "label": "Incremental path", "rationale": "...", "tasks": [], "combo": "te-build", "concurrency": 1 }]
}
```

The resolver generates a default option only when live open tasks exist. It never invents research or forks.
