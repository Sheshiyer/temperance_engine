# OmniRoute-Inspired Routing Policy

Temperance adapts a small set of routing and resilience ideas from
[diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute). The review
was pinned to commit `c1bdd91e7b9681e1056c4883b3e26cd0d416108b` (2026-07-20).
OmniRoute is an optional runtime gateway, not a Temperance control-plane
dependency. The local OpenCode relay is a deliberately narrow compatibility
seam; it does not fork OmniRoute or duplicate its provider logic.

## Boundary

OmniRoute primarily routes model requests. Temperance routes workflow tasks,
isolates agent worktrees, executes backend fallbacks, and assembles evidence.
The integration therefore replaces only the static candidate-ordering seam:

```text
classify-task.sh
  -> existing candidate catalog / named portfolio
  -> routing-policy.ts (off | shadow | enforce)
  -> immutable <task>.plan.json
  -> existing parallel dispatcher and worktree safety
  -> attempt metadata
  -> atomic backend-observation reducer
```

The following Temperance components remain authoritative:

- `package/router/classify-task.sh`: the only task-type and command-code
  primary-model classifier.
- `package/router/dispatch-tasklist.sh`: concurrency, argv-safe execution,
  timeouts, worktree isolation, overlap detection, fallback execution, and
  compact results.
- `ISA.md`: the only durable preference and acceptance ledger.

The policy receives the classifier's task type, never raw task text. It ranks
where work runs; it does not decide what the work is.

### OpenCode request path

OpenCode has no supported plugin hook for replacing `input.model`. Its
automatic `omniroute/temperance-auto` model therefore points at the local
`package/router/temperance-openai-proxy.ts` relay on port `20129`:

```text
OpenCode chat.message
  -> shared enrich() -> synthetic <temperance-context>
  -> temperance-openai-proxy
  -> multi-backend-router.sh --plan-json (single classifier)
  -> OmniRoute /v1/chat/completions with selected model
```

The proxy preserves tool payloads, passes streaming bodies through unchanged,
and forwards upstream status codes. Explicit picker models (`auto/*` or a
named combo) bypass classification and remain direct operator overrides.
Automatic requests carrying tools use the verified `temperance-coding`
compatibility combo until a named portfolio has an accepted promotion receipt.

## Source-Anchored Matrix

| Verdict | OmniRoute surface | Temperance treatment |
|---|---|---|
| REUSE | Bounded factor contract in `open-sse/services/autoCombo/scoring.ts` | Keep bounded, inspectable factors and per-candidate reasons. |
| ADAPT | Health, quota, cost, and latency candidate signals in `open-sse/services/combo.ts` | Treat missing signals as neutral and preserve static order until observations exist. |
| ADAPT | `CLOSED`, `OPEN`, and `HALF_OPEN` lifecycle in `src/shared/utils/circuitBreaker.ts` | Use one backend-level circuit, three consecutive failures, five-minute cooldown, and a half-open probe. |
| REUSE | Normalized metadata choke point in `src/domain/omnirouteResponseMeta.ts` | Add `plan_id` and `plan_path` to existing task envelopes without removing fields. |
| ADAPT | Evaluation/replay ideas in `src/lib/routerEval` and `src/lib/usage/routeExplain.ts` | Persist the frozen inputs and order; never recompute historical decisions against current state. |
| REJECT | Random weighted selection and exploration in `open-sse/services/autoCombo/engine.ts` | Temperance routing is deterministic; there is no `Math.random()` path. |
| REJECT | Required proxy, provider catalog, dashboard, strategy packs, quota pools, and session affinity | These duplicate Temperance's control plane and create unnecessary runtime coupling. |
| REJECT | Executable plugin marketplace, caller-declared MCP scopes, simulated A2A cancellation, and plaintext task secrets | Agent/MCP/A2A contracts require a separate principal-bound security design. |

## Policy Modes

Set `TEMPERANCE_ROUTING_POLICY` to one of `off`, `shadow`, or `enforce`:

- `off`: compute and execute the existing static order. This is the immediate
  kill switch and rollback path.
- `shadow` (default): execute the static order, but record the scorer's
  `proposed_order`, factors, and disagreement for evaluation.
- `enforce`: execute the deterministic proposed order. Explicit backend/model
  overrides still win.

The policy fails open. Missing Bun, invalid state, invalid output, or absent
telemetry produces a valid degraded plan using the current static order.

Additional controls:

| Variable | Purpose |
|---|---|
| `TEMPERANCE_ROUTING_STATE` | Exact observation-state file override. |
| `TEMPERANCE_STATE_DIR` | State directory; defaults to `$HOME/.temperance_engine/state`. |
| `TEMPERANCE_ROUTING_POLICY_BIN` | Policy module override for testing or packaging. |
| `TEMPERANCE_ROUTING_NOW_MS` | Injected clock for deterministic tests and replay. |
| `TEMPERANCE_ROUTING_OBSERVATION_MAX_AGE_MS` | Maximum observation age; defaults to 24 hours. |

## Scoring and Replay

The v1 score weights are capability `0.35`, health `0.25`, available quota
`0.15`, cost efficiency `0.10`, and static stability `0.15`. Factors are
clamped to `[0,1]`; score ties resolve by static rank, backend, then model.
Open circuits are excluded from automatic enforcement. An enforce-mode
half-open candidate must acquire an atomic probe lease before dispatch, so
concurrent batches cannot probe the same backend simultaneously. Timeouts
remain task-duration evidence and do not poison backend health.

Observation freshness is tracked per signal (`health_updated_at_ms`,
`quota_updated_at_ms`, `cost_efficiency_updated_at_ms`,
`latency_updated_at_ms`, and `circuit_updated_at_ms`). Updating one backend or
signal cannot make unrelated quota, cost, health, or circuit data fresh again.
Legacy state that only has the global `updated_at_ms` is migrated without
advancing those inherited timestamps. On Bash 4, attempt events use a portable
millisecond clock (Perl, Python, or Bun) so concurrent completions do not
collapse into whole-second ordering ties.

Each `<task>.plan.json` contains:

- `policy_version`, `plan_id`, SHA-256 `input_hash`, and frozen
  `decision_time_ms`;
- classifier-produced `task_type`;
- `static_order`, `proposed_order`, and executed `selected_order`;
- per-candidate score, factors, eligibility, circuit state, and reasons.
- a `diverged` flag showing whether the proposed order differs from static.

The batch dispatcher creates this plan exactly once before execution. Workers
consume a parent-cached copy of `selected_order`; later edits to the inspection
file cannot alter execution, and workers never ask the router to recompute a
fallback chain. Attempt events include task/attempt identity, start/finish
times, status, fallback reason, and optional normalized `usage`/`cost`. Backend
adapters expose metrics by writing a JSON object to the per-attempt path in
`TEMPERANCE_ATTEMPT_METRICS_PATH`; missing or invalid sidecars become `null`
without affecting execution. After workers join, one locked reducer updates
`routing-observations.json` atomically.

## Promotion Gate and Rollback

Keep production on `shadow` until fixed-state replay is byte-identical, current
fallback fixtures remain green, plan/result schemas remain additive, and a
representative observation corpus shows useful disagreements. Promotion can be
performed per environment by setting `TEMPERANCE_ROUTING_POLICY=enforce`.

Rollback is immediate and state-preserving:

```bash
export TEMPERANCE_ROUTING_POLICY=off
```

Deleting or moving the observation file is optional; the `off` mode ignores it
for selection.

## License

OmniRoute is MIT licensed. Temperance's policy is a local implementation of
reviewed contracts rather than copied provider/runtime code. The upstream
source and license notice are recorded in `THIRD_PARTY_NOTICES.md`.
