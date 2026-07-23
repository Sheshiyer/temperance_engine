# OmniRoute Governed Portfolios and Evidence Fabric Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Temperance deterministic, traceable access to task-specific OmniRoute model portfolios while preserving the existing classifier, frozen-plan authority, Codex agent loop, ISA acceptance ledger, and direct-backend outage rails.

**Architecture:** `classify-task.sh` continues to answer only “what kind of task is this?” A new pure portfolio resolver maps that task type to an explicit OmniRoute combo, the Temperance router freezes the gateway-plus-direct candidate chain, and the dispatcher carries one correlation identifier through every attempt. OmniRoute remains responsible for provider/model failover inside a selected combo; its telemetry and evals remain shadow evidence until an explicit promotion gate passes.

**Tech Stack:** Bash 4+, Bun/TypeScript, jq, Codex CLI custom model providers, OmniRoute OpenAI-compatible API and CLI, shell integration tests.

---

## Guardrails

- Do not add another task classifier or copy OmniRoute's live model catalog into Temperance.
- Do not commit credentials, provider account state, OmniRoute database files, or generated catalog snapshots.
- Do not grant live telemetry or eval output enforcement authority in this tranche.
- Keep `temperance-coding` as the compatibility combo until named portfolios pass readiness and eval gates.
- Keep one gateway attempt domain followed by existing direct CLI outage domains; do not multiply Temperance retries by OmniRoute's internal retry width.
- Run every implementation task test-first and commit only the files named by that task.

## Preflight: Establish a Recoverable Baseline

**Files:**
- Existing approved OmniRoute integration files already present in the working tree
- Exclude: `.codegraph/`

**Step 1: Confirm the branch and inspect whitespace errors**

Run: `git branch --show-current && git diff --check`

Expected: branch is `codex/omniroute-governed-portfolios`; `git diff --check` exits 0.

**Step 2: Re-run the approved baseline gate**

Run: `scripts/verify-all.sh`

Expected: final line is `Temperance Engine full verification passed`.

**Step 3: Commit only the prior approved integration**

Stage the known OmniRoute gateway/shadow-policy files listed by `git status --short`, excluding this plan and `.codegraph/`.

Run: `git diff --cached --check && git commit -m "feat(router): add OmniRoute shadow gateway"`

Expected: commit succeeds and `.codegraph/` remains untracked.

**Step 4: Commit this plan and ISA extension separately**

Run: `git add ISA.md docs/plans/2026-07-22-omniroute-governed-portfolios.md && git diff --cached --check && git commit -m "docs(router): plan governed OmniRoute portfolios"`

Expected: planning artifacts have a dedicated commit.

## Task 1: Carry One Correlation Identifier End-to-End

**Files:**
- Modify: `package/router/routing-policy.ts`
- Modify: `package/router/routing-policy.test.ts`
- Modify: `package/router/multi-backend-router.sh`
- Modify: `package/router/dispatch-tasklist.sh`
- Modify: `package/router/omniroute-codex.sh`
- Modify: `tests/dispatch-tasklist.sh`
- Modify: `tests/routing-policy.sh`
- Modify: `tests/fixtures/mock-codex`

**Step 1: Write failing plan-contract tests**

Add a deterministic field to the TypeScript plan assertions:

```ts
expect(first.correlation_id).toMatch(/^tc_[a-f0-9]{24}$/);
expect(first.correlation_id).toBe(second.correlation_id);
```

Extend `tests/routing-policy.sh` so every shell-produced plan requires a non-empty `correlation_id`.

Run: `bun test package/router/routing-policy.test.ts && bash tests/routing-policy.sh`

Expected: FAIL because `RoutingPlan` has no `correlation_id`.

**Step 2: Implement deterministic plan correlation**

Add the field and derive it from the already canonicalized input hash:

```ts
export interface RoutingPlan {
  correlation_id: string;
  // existing fields remain unchanged
}

const correlationId = `tc_${inputHash.slice(0, 24)}`;
```

Add the same field to degraded/static and unavailable shell plans. Update both plan validators to require a string matching `^tc_[A-Za-z0-9._-]+$`.

Assert `correlation_id === "tc_" + input_hash.slice(0, 24)` and keep the pre-existing byte-identical replay assertion. The identifier is an output derived after hashing; it must never enter canonical input or alter `input_hash`, `plan_id`, route ordering, or replay identity.

Run: `bun test package/router/routing-policy.test.ts && bash tests/routing-policy.sh`

Expected: PASS.

**Step 3: Write failing dispatcher continuity tests**

Assert all three copies match:

```bash
plan_correlation=$(jq -r '.correlation_id' "$run/PLAN.plan.json")
check "metadata correlation matches frozen plan" "$plan_correlation" \
  "$(jq -r '.correlation_id' "$run/PLAN.meta.json")"
check "attempt correlation matches frozen plan" "$plan_correlation" \
  "$(jq -r '.attempts[0].correlation_id' "$run/PLAN.meta.json")"
```

Extend `mock-codex` to print `TEMPERANCE_CORRELATION_ID` and assert the adapter adds `X-Temperance-Correlation-ID` through `model_providers.omniroute.http_headers`.

Run: `bash tests/dispatch-tasklist.sh`

Expected: FAIL because metadata, attempts, and Codex headers omit the identifier.

**Step 4: Propagate the frozen identifier**

- Pass `correlation_id` beside `plan_id` from preclassification into `run_one`.
- Add it to top-level metadata and every `attempt_record`.
- Export it to every backend process as `TEMPERANCE_CORRELATION_ID` so direct fallback retains the trace.
- In `omniroute-codex.sh`, validate the value against `[A-Za-z0-9._:-]+` and append:

```bash
args+=(
  -c "model_providers.omniroute.http_headers={\"X-Temperance-Correlation-ID\"=\"$CORRELATION_ID\"}"
)
```

Run: `bash tests/dispatch-tasklist.sh`

Expected: PASS, including an OmniRoute failure followed by a direct backend with the same identifier.

**Step 5: Commit**

Run: `git add package/router/routing-policy.ts package/router/routing-policy.test.ts package/router/multi-backend-router.sh package/router/dispatch-tasklist.sh package/router/omniroute-codex.sh tests/dispatch-tasklist.sh tests/routing-policy.sh tests/fixtures/mock-codex && git commit -m "feat(router): correlate gateway and fallback attempts"`

## Task 2: Make Gateway and Direct Failure Domains Explicit

**Files:**
- Modify: `package/router/routing-policy.ts`
- Modify: `package/router/routing-policy.test.ts`
- Modify: `package/router/multi-backend-router.sh`
- Modify: `package/router/dispatch-tasklist.sh`
- Modify: `tests/router-hardening.sh`
- Modify: `tests/dispatch-tasklist.sh`
- Modify: `tests/routing-policy.sh`

**Step 1: Write failing domain-shape tests**

Add candidate assertions:

```ts
expect(plan.static_order.find(({ backend }) => backend === "omniroute")?.failure_domain)
  .toBe("gateway");
expect(plan.static_order.find(({ backend }) => backend === "grok")?.failure_domain)
  .toBe("direct");
```

In shell tests, require `failure_domain` on `static_order`, `proposed_order`, and `selected_order` entries.

Run: `bun test package/router/routing-policy.test.ts && bash tests/router-hardening.sh`

Expected: FAIL because candidates do not declare a domain.

**Step 2: Add the typed field without changing order**

```ts
export type FailureDomain = "gateway" | "direct";

export interface RouteCandidate {
  failure_domain: FailureDomain;
  // existing fields
}
```

Have `candidate_json` assign `gateway` only to backend `omniroute`; all current CLI backends are `direct`. Preserve the field in `plainCandidate` and require it in shell plan validators.

Run: `bun test package/router/routing-policy.test.ts && bash tests/routing-policy.sh && bash tests/router-hardening.sh`

Expected: PASS with byte-stable ranking order and unchanged `selected_order`.

**Step 3: Record the executed domain in every attempt**

Add `failure_domain` to `attempt_record`, derived from the frozen selected candidate rather than recomputed from mutable runtime state. Change cached execution rows from two columns to three:

```bash
jq -r '.[]? | [.backend,.model,.failure_domain] | @tsv'
```

Run: `bash tests/dispatch-tasklist.sh`

Expected: PASS; gateway failure and direct success appear as two differently labeled domains.

**Step 4: Commit**

Run: `git add package/router/routing-policy.ts package/router/routing-policy.test.ts package/router/multi-backend-router.sh package/router/dispatch-tasklist.sh tests/router-hardening.sh tests/dispatch-tasklist.sh tests/routing-policy.sh && git commit -m "feat(router): expose gateway failure domains"`

## Task 3: Add a Pure Shadow-Only Portfolio Resolver

**Files:**
- Create: `package/router/omniroute-portfolios.json`
- Create: `package/router/omniroute-portfolios.ts`
- Create: `package/router/omniroute-portfolios.test.ts`

**Step 1: Write failing resolver tests**

Cover each shared classifier task type, compatibility fallback, and no-gateway result:

```ts
expect(resolvePortfolio("fast", ["te-fast", "temperance-coding"]).selected_model)
  .toBe("te-fast");
expect(resolvePortfolio("validation", ["temperance-coding"]).source)
  .toBe("compatibility");
expect(resolvePortfolio("balanced", []).source).toBe("direct");
```

Run: `bun test package/router/omniroute-portfolios.test.ts`

Expected: FAIL because the resolver does not exist.

**Step 2: Add the reviewable portfolio manifest**

Create `omniroute-portfolios.json`:

```json
{
  "version": 1,
  "compatibility_model": "temperance-coding",
  "task_type_portfolios": {
    "fast": "te-fast",
    "long-horizon": "te-build",
    "reasoning": "te-reason",
    "validation": "te-validate",
    "creative": "te-vision",
    "balanced": "te-build"
  },
  "reserved_portfolios": ["te-batch"],
  "enforcement": "shadow"
}
```

The manifest names portfolios but never pins their provider/model members; those remain OmniRoute-owned runtime state.

**Step 3: Implement the pure resolver and CLI**

Return this stable shape:

```ts
export interface PortfolioResolution {
  task_type: string;
  requested_portfolio: string;
  selected_model: string | null;
  source: "portfolio" | "compatibility" | "direct";
  enforcement: "shadow";
}
```

Add `resolve TASK_TYPE [MODEL ...]` CLI output as compact JSON for later shell integration. Unknown task types normalize to `balanced`; they never invoke keyword classification.

Run: `bun test package/router/omniroute-portfolios.test.ts`

Expected: PASS.

**Step 4: Prove shadow isolation and direct fallback remain unchanged**

Run: `bash tests/router-hardening.sh && bash tests/dispatch-tasklist.sh`

Expected: PASS; no `te-*` portfolio appears in any router `selected_order`, and the existing direct fallback chain still succeeds.

**Step 5: Commit**

Run: `git add package/router/omniroute-portfolios.json package/router/omniroute-portfolios.ts package/router/omniroute-portfolios.test.ts && git commit -m "feat(router): resolve governed OmniRoute portfolios"`

## Task 4: Integrate Portfolio Resolution into Frozen Plans

### Post-Task-3 Advisor gates

- Keep the completed `correlation_id` contract as deterministic frozen-plan lineage. Before request-level telemetry joins, add a separate per-execution trace identifier satisfying ISC-106; do not overload or randomize the replay identifier.
- Reconcile every manifest portfolio name against the current `/v1/models` catalog before it may enter any proposed or selected chain. The current live probe proves only `temperance-coding`, not the named `te-*` portfolios.

**Files:**
- Modify: `package/router/multi-backend-router.sh`
- Modify: `tests/router-hardening.sh`
- Modify: `tests/routing-policy.sh`
- Create: `tests/fixtures/omniroute-models.json`

**Step 1: Write fixture-driven failing router tests**

Use a catalog fixture instead of a live daemon. Assert `fast -> te-fast`, `validation -> te-validate`, missing named combo -> `temperance-coding`, and missing both -> direct first.

Run: `bash tests/router-hardening.sh`

Expected: FAIL because every type still uses `TEMPERANCE_OMNIROUTE_MODEL`.

**Step 2: Resolve after classification and before candidate construction**

Add one catalog-read seam (`TEMPERANCE_OMNIROUTE_CATALOG_FILE` for tests; live `/v1/models` otherwise). Pass the existing task type to the pure resolver and place only its selected gateway model before the direct tail.

**Step 3: Keep `temperance-coding` as compatibility authority**

Named portfolios affect `proposed_order` in shadow mode. Until a promotion receipt exists, `selected_order` must retain the compatibility combo plus direct backends.

Run: `bash tests/router-hardening.sh && bash tests/routing-policy.sh`

Expected: PASS with no second classifier and no live-network dependency in tests.

**Step 4: Commit**

Run: `git add package/router/multi-backend-router.sh tests/router-hardening.sh tests/routing-policy.sh tests/fixtures/omniroute-models.json && git commit -m "feat(router): plan task-specific OmniRoute portfolios"`

## Task 5: Add Machine-Readable Runtime Readiness Evidence

**Files:**
- Modify: `scripts/omniroute-check.sh`
- Create: `tests/omniroute-check.sh`
- Create: `tests/fixtures/omniroute-runtime/`

**Step 1: Write failing `--json` readiness tests**

Assert schema fields for runtime version, catalog count, configured portfolios, missing portfolios, telemetry state, eval suite count, eval run count, and `enforcement_ready:false`.

Run: `bash tests/omniroute-check.sh`

Expected: FAIL because the checker only prints human text.

**Step 2: Implement read-only JSON mode**

Use `/v1/models` for catalog availability and OmniRoute CLI/API read commands for eval/telemetry counts. Treat malformed percentages, absent evals, and command errors as unavailable evidence, never as zero-risk success.

**Step 3: Preserve the existing human and `--live` contracts**

Run: `bash tests/omniroute-check.sh && scripts/omniroute-check.sh && scripts/omniroute-check.sh --json | jq -e '.enforcement_ready == false'`

Expected: all commands pass; the live workstation remains shadow-only until eval evidence exists.

**Step 4: Commit**

Run: `git add scripts/omniroute-check.sh tests/omniroute-check.sh tests/fixtures/omniroute-runtime && git commit -m "feat(router): report OmniRoute readiness evidence"`

## Task 6: Create the Eval Promotion Gate

**Files:**
- Create: `package/router/omniroute-promotion.ts`
- Create: `package/router/omniroute-promotion.test.ts`
- Create: `package/router/omniroute-promotion.schema.json`
- Modify: `package/router/multi-backend-router.sh`

**Step 1: Write failing promotion-receipt tests**

Require matching portfolio, suite ID, completed run ID, minimum sample count, minimum success threshold, maximum cost/latency limits, creation time, expiry time, and manifest hash. Reject missing, expired, malformed, or wrong-portfolio receipts.

**Step 2: Implement fail-closed receipt validation**

The validator returns only `{authorized:boolean, reasons:string[]}`. It reads a receipt path supplied by `TEMPERANCE_OMNIROUTE_PROMOTION_RECEIPT`; it never mutates OmniRoute.

**Step 3: Permit one low-risk portfolio only**

When a valid receipt exists, allow the receipt's named portfolio into `selected_order`; all other portfolio proposals remain shadow-only.

Run: `bun test package/router/omniroute-promotion.test.ts && bash tests/router-hardening.sh`

Expected: PASS; absence of a receipt preserves compatibility behavior.

**Step 4: Commit**

Run: `git add package/router/omniroute-promotion.ts package/router/omniroute-promotion.test.ts package/router/omniroute-promotion.schema.json package/router/multi-backend-router.sh tests/router-hardening.sh && git commit -m "feat(router): gate OmniRoute portfolio promotion"`

## Task 7: Align Enrichment with Portfolio Scheduling

**Files:**
- Modify: `package/enrich/stages/routing.ts`
- Modify: `package/enrich/stages/routing.test.ts`

**Step 1: Write failing enrichment tests**

Assert that enrichment invokes the shared classifier once, reports `portfolio=te-*`, and fails open to `portfolio=temperance-coding` or no external route when resolver files are absent.

**Step 2: Replace stale provider-primary messaging**

Keep `task=<type>` from `classify-task.sh`; call the pure resolver with that output. Do not add keyword tests or provider/model inventory to enrichment.

Run: `bun test package/enrich`

Expected: PASS with pointer-only, fail-open output.

**Step 3: Commit**

Run: `git add package/enrich/stages/routing.ts package/enrich/stages/routing.test.ts && git commit -m "feat(enrich): report OmniRoute portfolio intent"`

## Task 8: Document, Gate, and Verify the Full Tranche

**Files:**
- Modify: `docs/omniroute-integration.md`
- Modify: `docs/omniroute-runtime.md`
- Modify: `docs/pai-flow.md`
- Modify: `README.md`
- Modify: `scripts/verify-all.sh`
- Modify: `tests/docs-continuity.sh`
- Modify: `ISA.md`

**Step 1: Document the authority stack**

Describe: PAI depth -> ISA acceptance -> GSD lifecycle -> Temperance classification/policy/dispatch -> Codex tools -> OmniRoute portfolio/provider selection. Explain discovery routes, explicit combos, council/fusion cost multiplication, promotion receipts, and direct outage rails.

**Step 2: Add every new test to the canonical gate**

Run: `scripts/verify-all.sh`

Expected: final line is `Temperance Engine full verification passed`.

**Step 3: Run live read-only readiness**

Run: `scripts/omniroute-check.sh --json | jq .`

Expected: valid JSON reflecting current portfolio/eval/telemetry state. Do not claim enforcement readiness unless the receipt gate independently passes.

**Step 4: Update ISA through canonical workflows**

Append verification evidence for each satisfied ISC and leave any unprobed runtime criterion open. Record the compatibility-combo conjecture/refutation/learning entry if named portfolio evidence changes the rollout decision.

**Step 5: Commit**

Run: `git add README.md ISA.md docs/omniroute-integration.md docs/omniroute-runtime.md docs/pai-flow.md scripts/verify-all.sh tests/docs-continuity.sh && git commit -m "docs(router): explain governed OmniRoute portfolios"`

## Final Acceptance

Run:

```bash
git diff --check
bun test package/router
bun test package/enrich
bash tests/router-hardening.sh
bash tests/routing-policy.sh
bash tests/dispatch-tasklist.sh
bash tests/omniroute-check.sh
scripts/verify-all.sh
scripts/omniroute-check.sh --json | jq -e '.runtime.available == true'
```

Expected: all repository tests pass; live readiness returns structured evidence; production portfolio enforcement remains false unless an unexpired, test-proven promotion receipt authorizes one named portfolio.
