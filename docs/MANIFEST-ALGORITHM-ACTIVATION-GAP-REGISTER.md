# Manifest Algorithm Activation Gap Register

This register bounds the hardening tranche: Manifest may project evidence only
for an explicitly classified PAI Algorithm run whose Git root is inside an
operator allowlist. It does not enroll, modify, or execute a project merely
because it was discovered.

Status vocabulary: **fixed** is delivered and tested in this tranche; **next**
is a concrete follow-up; **parked** requires a separate authority decision.

## Activation and identity

| # | Gap | Status |
|---:|---|---|
| 1 | Ambient prompts can enter telemetry. | fixed |
| 2 | Hook siblings cannot share classifier output safely. | fixed |
| 3 | Algorithm activation lacks a named event. | fixed |
| 4 | Native and Minimal modes lack an explicit deny path. | fixed |
| 5 | Portfolio scope is not policy-driven. | fixed |
| 6 | Prefix matching can admit sibling paths. | fixed |
| 7 | Symlinked working directories can fork identity. | fixed |
| 8 | Nested working directories can fork identity. | fixed |
| 9 | Git worktrees are not normalized to their worktree root. | fixed |
| 10 | Missing Git roots are not explicitly rejected. | fixed |
| 11 | Invalid project manifests are not distinguished. | fixed |
| 12 | Unenrolled eligible repositories need a visible state. | fixed |

## Run mapping and durable delivery

| # | Gap | Status |
|---:|---|---|
| 13 | Follow-on events lack a stable run correlation. | fixed |
| 14 | Follow-on hooks can observe a non-Algorithm session. | fixed |
| 15 | Session end is not mapped to an active run. | fixed |
| 16 | A missing session ID has no fail-closed behavior. | fixed |
| 17 | Activation does not retain mode and tier. | fixed |
| 18 | Activation does not begin at Observe. | fixed |
| 19 | Offline delivery needs a durable local fallback. | fixed |
| 20 | Local run metadata can race between sessions. | fixed |
| 21 | Event IDs need idempotent run scoping. | fixed |
| 22 | Hook payloads risk prompt/body disclosure. | fixed |
| 23 | Activation policy has no schema/version. | fixed |
| 24 | Policy parse failure has no safe default. | fixed |

## Bridge and projections

| # | Gap | Status |
|---:|---|---|
| 25 | Session projection ignores activation events. | fixed |
| 26 | Project projection lacks enrollment state. | fixed |
| 27 | Aggregate views can imply all disk projects are watched. | fixed |
| 28 | `--all` scope lacks an operator warning. | next |
| 29 | Bridge availability is not surfaced as a startup check. | next |
| 30 | Event schema lacks a formal compatibility policy. | next |
| 31 | Catalog lock recovery needs multiprocess stress coverage. | next |
| 32 | Outbox replay needs crash-injection coverage. | next |
| 33 | Source pointer reachability is not checked. | next |
| 34 | Event retention/compaction is undefined. | next |

## PAI client and hook parity

| # | Gap | Status |
|---:|---|---|
| 35 | Claude activation belongs in the classifier hook. | fixed |
| 36 | Claude generic prompt telemetry is duplicate noise. | fixed |
| 37 | Claude lifecycle events must inherit activation identity. | fixed |
| 38 | Codex needs an equivalent adapter contract. | fixed |
| 39 | OpenCode needs an equivalent adapter contract. | next |
| 40 | Kimi cannot inject prompt context in the same way. | parked |
| 41 | Hook version/runtime compatibility is not probed. | next |
| 42 | Hook timeout and fallback latency lack a budget test. | next |

## HITL and automatic swarm safety

| # | Gap | Status |
|---:|---|---|
| 43 | Dispatch needs an allowed-project-root preflight. | next |
| 44 | Dispatch needs a clean-worktree policy decision. | next |
| 45 | Receipt-bound workers still allow manual batch bypass. | next |
| 46 | Worker terminal receipts are not ingested. | next |
| 47 | Dispatch terminal closure is not projected. | next |
| 48 | Approval rejection and revision request endpoints are absent. | next |
| 49 | Approval invalidation on evidence revision is absent. | next |
| 50 | Approval delegation/roles are unmodeled. | parked |

## Visual operator experience

| # | Gap | Status |
|---:|---|---|
| 51 | Operator cannot distinguish enrolled from observed-only work. | fixed |
| 52 | Active run, mode, and tier need a first-class visual card. | fixed |
| 53 | Rejected activation reason needs an audit surface. | next |
| 54 | Offline/outbox backlog needs an operator indicator. | next |
| 55 | Keyboard focus and live-region audits are incomplete. | next |
| 56 | Mobile decision deck needs touch-target tests. | next |

## Delivery and governance

| # | Gap | Status |
|---:|---|---|
| 57 | There is no scoped activation policy example. | fixed |
| 58 | Project initialization and passive observation are conflated. | fixed |
| 59 | Installation does not state which hook owns activation. | fixed |
| 60 | The empty OmniRoute planning response has no circuit receipt. | next |

## Deliberate non-goals

- No recursive portfolio scan or automatic `temperance-project-init`.
- No project repository mutation during passive observation.
- No UI event can approve or execute a swarm.
- No raw prompt, tool body, credential, or transcript body enters Manifest.
