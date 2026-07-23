# OmniRoute-Inspired Shadow Routing Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Temperance's static backend-ordering layer with a deterministic, observable shadow-routing policy while preserving its classifier, parallel dispatcher, worktree safety, fallbacks, and CLI contracts.

**Architecture:** A dependency-free Bun/TypeScript policy module receives only the shared classifier's task type, the router's existing candidate chain, and a frozen backend-observation snapshot. The router emits an immutable plan in `off`, `shadow`, or `enforce` mode; the batch dispatcher executes that exact plan once and reduces completed attempt telemetry into one atomically written cross-run observation file.

**Tech Stack:** Bash 4+, Bun/TypeScript, jq, Bun test, existing shell integration tests.

---

### Task 1: Deterministic routing policy and observation reducer

**Files:**
- Create: `package/router/routing-policy.ts`
- Create: `package/router/routing-policy.test.ts`

**Step 1: Write the failing policy tests**

Cover these public contracts before implementation:

```ts
import { describe, expect, test } from "bun:test";
import { planRouting, reduceObservations } from "./routing-policy";

test("shadow mode records a proposal but executes static order", () => {});
test("enforce mode ranks capability, health, and quota deterministically", () => {});
test("identical frozen inputs produce byte-identical plans", () => {});
test("missing observations preserve the static order", () => {});
test("forced overrides collapse to one candidate", () => {});
test("open circuits are excluded and cooldown permits a half-open probe", () => {});
test("three backend failures open a circuit and success closes it", () => {});
test("timeouts are recorded without poisoning backend health", () => {});
```

**Step 2: Run tests and verify RED**

Run: `bun test package/router/routing-policy.test.ts`

Expected: FAIL because `routing-policy.ts` does not exist.

**Step 3: Implement the minimal pure policy**

Export:

```ts
export function planRouting(input: RoutingInput): RoutingPlan;
export function reduceObservations(
  current: ObservationState,
  attempts: AttemptObservation[],
  nowMs: number,
): ObservationState;
```

The plan must contain `policy_version`, `mode`, `plan_id`, `input_hash`, `task_type`, `static_order`, `proposed_order`, `selected_order`, and per-candidate bounded factors/reasons. Use capability, health, quota, cost-efficiency, and static stability factors; omit randomness. Missing observations return the static order. `open` excludes a backend; an elapsed cooldown makes it `half_open`. A forced candidate remains authoritative.

Add CLI commands:

```text
bun routing-policy.ts plan     # JSON stdin → plan JSON stdout
bun routing-policy.ts observe  # --state FILE --index FILE, atomic reduction
```

The observe command must serialize writers with a lock directory, preserve optional quota/cost fields, and rename a temporary file atomically.

**Step 4: Run tests and verify GREEN**

Run: `bun test package/router/routing-policy.test.ts`

Expected: all policy and reducer tests pass.

### Task 2: Router plan envelope and compatibility modes

**Files:**
- Modify: `package/router/multi-backend-router.sh`
- Modify: `tests/router-hardening.sh`
- Create: `tests/routing-policy.sh`

**Step 1: Write failing shell integration tests**

Assert:

- `--plan-json` emits the complete plan envelope.
- `TEMPERANCE_ROUTING_POLICY=shadow` preserves command-code → grok → kimi execution order.
- A frozen observation fixture produces a different `proposed_order` in shadow mode.
- `TEMPERANCE_ROUTING_POLICY=enforce` uses that proposal.
- `off` and policy failure retain the current static order.
- Explicit backend/model overrides still win.
- No prompt text enters the TypeScript policy input.

**Step 2: Run tests and verify RED**

Run: `bash tests/routing-policy.sh`

Expected: FAIL because `--plan-json` is not implemented.

**Step 3: Implement the router policy seam**

Add `--plan-json` and a single `route_plan_for_type_json` helper after classification. Build candidates only from `ROUTING_PRIORITY`, `MODEL_CATALOG`, detected availability, and explicit overrides. Read observations from:

```text
${TEMPERANCE_ROUTING_STATE:-${TEMPERANCE_STATE_DIR:-$HOME/.temperance_engine/state}/routing-observations.json}
```

Support `TEMPERANCE_ROUTING_POLICY=off|shadow|enforce`, defaulting to `shadow`. If Bun, state, or policy output is absent/invalid, return a valid degraded static plan. Derive `--route-only`, `--route-only-with-fallbacks`, normal display, JSON, command, and execute selection from the same plan without changing their existing output schemas.

**Step 4: Run tests and verify GREEN**

Run: `bash tests/routing-policy.sh`

Run: `bash tests/router-hardening.sh`

Expected: new policy tests pass and all existing router fixtures remain unchanged.

### Task 3: Frozen parallel dispatch plans and observations

**Files:**
- Modify: `package/router/dispatch-tasklist.sh`
- Modify: `tests/dispatch-tasklist.sh`

**Step 1: Write failing batch tests**

Add focused assertions that every task gets `<id>.plan.json`, `run_one` executes its stored `selected_order` without a second router call, task metadata contains `plan_id` and `plan_path`, shadow mode keeps current fallback behavior, and completed attempts update a temporary routing-observation state once after workers join.

**Step 2: Run the new focused test and verify RED**

Run: `bash tests/dispatch-tasklist.sh`

Expected: FAIL at the first missing plan assertion.

**Step 3: Freeze and execute plans**

During preclassification, invoke router `--plan-json` exactly once per task and atomically persist `$OUT/$id.plan.json`. Cache status and first selected candidate from that file. Pass the plan path into `run_one`; load the entire fallback chain from `selected_order` instead of calling the router again. Extend metadata additively with `plan_id` and `plan_path` while preserving existing fields.

After all workers join and `index.json` is built, invoke the observation reducer once. Observation-update failure must be warning-only and must not change task results.

**Step 4: Run tests and verify GREEN**

Run: `bash tests/dispatch-tasklist.sh`

Expected: complete dispatch suite passes, including concurrency, timeout, fallback, worktree, merge, and compact-summary assertions.

### Task 4: Provenance, operator documentation, and full gate

**Files:**
- Create: `docs/omniroute-integration.md`
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `UPSTREAM.md`
- Modify: `README.md`
- Modify: `scripts/verify-all.sh`
- Modify: `ISA.md`

**Step 1: Write failing continuity checks**

Extend documentation or routing-policy tests to require the pinned OmniRoute commit, reuse/adapt/reject matrix, `off|shadow|enforce` rollback instructions, MIT attribution, and inclusion of both routing-policy and dispatch suites in `scripts/verify-all.sh`.

**Step 2: Run checks and verify RED**

Run: `bash tests/docs-continuity.sh`

Expected: FAIL on missing integration documentation or provenance.

**Step 3: Add documentation and canonical verification**

Document the control-plane boundary, environment variables, state/plan schemas, promotion gate, kill switch, and rejected OmniRoute surfaces. Record OmniRoute's MIT notice and source commit without copying credentials or making the repository a runtime dependency. Add `bun test package/router/routing-policy.test.ts`, `bash tests/routing-policy.sh`, and `bash tests/dispatch-tasklist.sh` to the canonical gate.

Update ISA criteria only when the corresponding probe passes, append exact verification evidence, and keep unfinished promotion criteria unchecked if shadow evidence is insufficient.

**Step 4: Run the complete verification gate**

Run: `scripts/verify-all.sh`

Expected: `Temperance Engine full verification passed` with policy, router, dispatcher, documentation, install, identity, and classifier suites green.

**Step 5: Inspect the final diff**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors and only scoped implementation, test, documentation, plan, and ISA changes.
