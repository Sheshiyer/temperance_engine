# OmniRoute Routing Overhaul: Paseo-Native Providers, Single Catalog, Real Quota-Awareness — Design

**Issue:** Operator-reported "fundamental issues" with OmniRoute model/provider selection, combo management, and rate-limit-aware/preferential routing.

**Status:** design (approved via `/superpowers:brainstorm` dialogue on 2026-08-02; awaiting ROADMAP ratification, then `/gsd:plan-phase` per phase).

---

## 1. Problem

The operator suspected two root causes and asked for a diagnosis via three parallel
codebase explorations plus one focused follow-up. The findings materially revised
the starting premise:

1. **Suspected: OpenCode config is unused dead weight, Paseo already has its own
   model providers.** Actual: `package/adapters/opencode/OmniRouteCatalogGuard.ts`
   and `TemperanceFlowPlugin.ts` are live — symlinked into
   `~/.config/opencode/plugins/`, gated by `scripts/verify-all.sh` (5 test gates),
   referenced by `ISA.md` ISC-107/111/112. Paseo's own docs
   (`docs/paseo-vault-portfolio.md:41`) state *"OpenCode is the client loop for
   OmniRoute-backed portfolios. Paseo supplies the remote control plane around
   that local provider"* — Paseo currently has **zero** independent model-provider
   concept; its `agents.providers` schema (live in `~/.paseo/config.json:26-59`)
   only knows ACP-CLI-wrapper providers (`grok`, `kimi`, `copilot`, `codex`, `pi`).
   No HTTP/OpenAI-compatible provider kind exists there today.

2. **Suspected: "OmniRoute combos" and "Temperance combos" are two duplicated
   storage systems; keep only Temperance's.** Actual: there is exactly one combo
   store — OmniRoute's own `~/.omniroute/storage.sqlite`, reachable only through
   its local HTTP API. Every combo in the most recent repo snapshot
   (`.omniroute-backups/omniroute-combos-20260724T114852Z.json`) is already
   `te-*`-prefixed and Temperance-owned. No rogue non-`te-*` combo was found — but
   that snapshot is 9 days stale relative to the operator's recent provider
   refresh, so it cannot confirm current live state.

3. **Additionally found: five independent, unsynchronized "which model for which
   task" catalogs** — `package/router/omniroute-fallback-policy.json`,
   `multi-backend-router.sh`'s hardcoded `MODEL_CATALOG`/`ROUTING_FALLBACK_TAILS`
   bash arrays, `classify-task.sh`'s `model_for_type()`, `temperance-workflows.json`/
   `.ts`'s role→candidate lists, and `omniroute-portfolios.json`'s name-only map.
   These can silently drift against each other.

4. **Additionally found: rate-limit-aware scoring is partly dead code.**
   `routing-policy.ts`'s scorer allocates 25% of its weight to `quota`/
   `cost_efficiency`, but no production code path ever populates those fields from
   real attempt data — they permanently fall back to a neutral `0.5`
   (`routing-policy.ts:216-217`). The only real quota polling that exists lives in
   `omniroute-temperance-reconcile.sh` (hits OmniRoute's `usage quota` endpoint)
   and never feeds `routing-observations.json`.

## 2. Operator decisions (locked, from the brainstorm dialogue)

| # | Decision | Rationale given |
|---|----------|------------------|
| **D1** | Retire the OpenCode adapter anyway; build a Paseo-native OmniRoute provider path, even though it is net-new work (Paseo has no HTTP-provider concept today). | Operator's explicit choice over "keep OpenCode, fix real bugs" and "I have newer context" options. |
| **D2** | Remove any non-`te-*` combo found in OmniRoute's live combo list. | Operator's explicit choice over "those are already the te-* combos" and "I'll check myself." |
| **D3** | Scope this as a full sequenced roadmap covering all 5 threads (native provider, cutover, OpenCode retirement, catalog consolidation, quota wiring), not a narrower slice. | Operator's explicit choice over "just the provider path" and "fix concretely-broken stuff first." |

## 3. Goal

Collapse five drifting model-selection surfaces into one, make rate-limit
awareness real (not a neutral placeholder), and replace the OpenCode-mediated
routing path with a Paseo-native one — without ever losing the two safety
properties OpenCode currently provides (fail-closed live-model validation,
context enrichment injection) and without duplicating OmniRoute's own
provider/combo logic inside Temperance (an existing guardrail, see §4).

## 4. Non-goals (YAGNI / existing guardrails preserved)

- **Not** forking or duplicating OmniRoute's own provider/combo/quota logic inside
  Temperance — `docs/omniroute-integration.md:5-8,68` already rejects this
  explicitly. This plan only consolidates *Temperance's own* redundant catalogs
  and bridges *already-computed* quota data into the scorer; it does not
  reimplement OmniRoute's combo engine.
- **Not** changing `omniroute-portfolios.json`'s name-only design —
  `docs/plans/2026-07-22-omniroute-governed-portfolios.md:15` already guards
  against copying OmniRoute's live model catalog into Temperance's portfolio
  manifest. Phase 1 (catalog consolidation) only touches the other four sources.
- **Not** deleting `package/enrich/*` — confirmed shared with the command-code
  adapter and `temperance-openai-proxy.ts`; only the OpenCode-specific plugin
  *wiring* is retired, not the enrichment core.
- **Not** attempting live verification (OmniRoute HTTP calls, live Paseo agent
  runs) from this development sandbox — it cannot reach `127.0.0.1:20128` or
  Paseo's live config (Keychain/localhost restrictions, already recorded in
  `ISA.md`). Those steps are explicitly operator-run.

## 5. Architecture: phased rollout

Five build phases plus one operator-only hygiene phase, dependency-ordered so
each is independently verifiable and revertible (strangler-fig pattern for the
OpenCode retirement specifically — nothing is deleted until its replacement is
proven).

### Phase 0 — Combo hygiene (operator-run, independent, any time)
Refresh the live combo list (re-run `scripts/omniroute-temperance-reconcile.sh` or
export fresh), diff against the `te-*` set owned by
`omniroute-temperance-combos.sh` / `-writer.sh` / `-writer-expansion.sh` /
`-fleet.sh` (`te-fast, te-build, te-reason, te-validate, te-dispatch, te-creative,
te-write, te-write-critique, te-write-research, te-write-media, te-plan`, plus the
legacy `temperance-coding` compat combo), delete anything outside that set via
OmniRoute's own API/UI (D2). No code changes unless the diff surfaces something.

### Phase 1 — Consolidate the five model catalogs
`package/router/omniroute-fallback-policy.json` becomes authoritative (richest
existing schema: base models, substitute chains, tiers per combo).
`multi-backend-router.sh` (`MODEL_CATALOG`/`ROUTING_FALLBACK_TAILS`,
lines 147-176/185-202), `classify-task.sh` (`model_for_type()`, lines 58-79), and
`temperance-workflows.ts` (lines 92-128, currently a documented "mirror" of the
reconciler's substitution logic) all read from it instead of hand-maintained
copies. `omniroute-portfolios.json` is explicitly out of scope (§4).

### Phase 2 — Real quota/rate-limit wiring
`routing-policy.ts`'s `reduceObservations()` (429-553) gains the ability to
persist `quota_remaining`/`cost_efficiency` per candidate from real attempt
outcomes. `omniroute-temperance-reconcile.sh`'s existing live quota polling
(`threshold_percent`/`restore_hysteresis_percent` drift against OmniRoute's
`usage quota` endpoint) gets bridged into `routing-observations.json` — this is
one missing wire, not new quota-fetching logic.

### Phase 3 — Paseo-native OmniRoute provider (the net-new component)
A thin ACP-CLI-wrapper-shaped entry point (exact location decided at planning
time — candidates: `package/adapters/paseo/`, or a `scripts/te-omniroute-provider`
CLI) matching the pattern of Paseo's existing `agents.providers` entries, that
forwards directly to `temperance-openai-proxy.ts` (reused as-is: it already does
routing-policy + portfolio resolution and reverse-proxies to OmniRoute; it is not
inherently OpenCode-specific, only currently fed exclusively by OpenCode's
`temperance-auto` model). Two safety properties move from OpenCode into the proxy
itself so both callers share them during the transition:
- **Fail-closed live-model validation** — port
  `OmniRouteCatalogGuardCore.ts:40-46,68`'s logic into `temperance-openai-proxy.ts`.
- **Context enrichment injection** — port `TemperanceFlowPluginCore.ts:32-50`'s use
  of the shared `package/enrich/*` into `temperance-openai-proxy.ts`.

Depends on Phase 1 (one catalog) and Phase 2 (real quota data) so the new path is
built on the fixed foundation, not the drifting one.

### Phase 4 — Cutover
`package/paseo/orchestration-preferences.example.json` and the operator's live
`~/.paseo/config.json` / `~/.paseo/orchestration-preferences.json` role slots
switch from `opencode/omniroute/te-*` strings to the new native provider.
Operator verifies real Paseo tasks route correctly through every role
(impl/planning/audit/research).

### Phase 5 — Retire the OpenCode adapter (last, only after Phase 4 is proven)
Remove `package/adapters/opencode/OmniRouteCatalogGuard.ts`,
`TemperanceFlowPlugin.ts`, and their tests. Remove the OpenCode wiring block from
`scripts/wire-multi-backend.sh` (~506-516, plus `check_status()`/`revert()`
references at 354-371/454) while **keeping** `ensure_enrichment_core()`
(187-236, shared with Claude/Codex). Remove OpenCode checks from
`tests/temperance-doctor.sh` / `scripts/temperance-doctor.sh`. Remove the five
OpenCode test gates from `scripts/verify-all.sh` (29-30, 45, 55, 65). Retire/
rewrite `ISA.md` ISC-107/111/112.

## 6. Contracts preserved (regression-guarded)

| ID | Contract | Guard |
|----|----------|-------|
| P1 | `--route-only` / `--route-only-with-fallbacks` / `--list-backends` / `--json` output shape unchanged after Phase 1's catalog-source swap | `tests/router-hardening.sh`, `tests/dispatch-tasklist.sh` |
| P2 | `omniroute-portfolios.json` stays name-only, no provider/model membership added | `omniroute-portfolios.test.ts`'s existing `.not.toMatch(/provider|members|targets/)` assertion |
| P3 | `package/enrich/*` public contract (`contract.ts`, `resolver.ts`) unchanged — command-code adapter and `temperance-openai-proxy.ts` keep working through and after Phase 5 | `bun test package/enrich`, command-code adapter tests |
| P4 | `temperance-openai-proxy.ts`'s existing OpenCode-facing behavior (routing-policy + reverse-proxy for `temperance-auto`) is additive-only through Phase 3 — OpenCode keeps working unmodified until Phase 5 | `temperance-openai-proxy.test.ts` |
| P5 | `scripts/verify-all.sh` exits 0 at the end of every phase | canonical full-suite gate |

## 7. Testing

- Phase 1: `bun test package/router`, extend `tests/omniroute-temperance-combos.sh`'s
  existing partial fleet.sh-vs-temperance-workflows.json cross-check to full
  equality against the consolidated source.
- Phase 2: `bun test package/router/routing-policy.test.ts` with new fixtures
  asserting quota-starved candidates score lower and get deprioritized.
- Phase 3: unit tests for the new provider entry point and the ported
  guard/enrichment logic in `temperance-openai-proxy.ts`.
- Phase 5: `scripts/verify-all.sh` passes with the OpenCode gates *removed*, not
  skipped; `git grep -i opencode` returns only intentional historical/doc
  mentions; command-code adapter and `temperance-openai-proxy.ts` tests still pass
  (proves `package/enrich` survived intact).
- Operator-run (cannot execute in this sandbox): Phase 0's live combo diff, Phase
  2's live quota-starvation confirmation, Phase 3/4's end-to-end Paseo routing
  checks.

## 8. Error handling / fail-open

- The ported catalog guard in `temperance-openai-proxy.ts` (Phase 3) must remain
  fail-closed on stale/unknown model IDs, matching `OmniRouteCatalogGuardCore`'s
  current behavior — this is a safety property, not just a validation nicety.
- Quota wiring (Phase 2) must fail open to the existing neutral `0.5` if
  `routing-observations.json` is missing/malformed, not crash the scorer.
- Phase 5 removal is strictly ordered after Phase 4 verification — no OpenCode
  file is deleted while anything still depends on it (strangler-fig, not big-bang).

## 9. Rollout / rollback

- Each phase lands, is verified per §7, and is independently revertible via git
  revert — no phase's rollback depends on a later phase not having happened yet,
  because later phases only start after earlier ones are verified.
- Phase 0 and Phase 4's live steps use OmniRoute's/Paseo's own existing
  backup/rollback mechanisms (`.omniroute-backups/`, Paseo's own config) — no new
  rollback machinery needed.

## 10. ISA impact

- New ISC entries recording: single-catalog invariant (Phase 1), real
  quota-in-scorer invariant (Phase 2), Paseo-native provider existence + parity
  with retired OpenCode guarantees (Phase 3/4).
- ISC-107/111/112 retired/rewritten in Phase 5 to describe the Paseo-native path
  instead of asserting OpenCode-specific behavior.
- Exact ISC numbers assigned during `/gsd:plan-phase` against the current ISA max.

## 11. Verified gap register (implementation must satisfy)

1. Exactly one authoritative model-catalog source; the other four consumers read
   from it (grep proves no remaining hand-maintained duplicate table).
2. `routing-policy.ts`'s scorer's `quota`/`cost_efficiency` fields are populated
   from real data for at least one exercised code path (test fixture proves
   non-neutral scores under quota pressure).
3. A Paseo-native provider exists, is registered in `agents.providers`-equivalent
   config, and round-trips a real request through `temperance-openai-proxy.ts` to
   OmniRoute without going through OpenCode.
4. The ported fail-closed model-ID validation and context-enrichment injection are
   present and tested in `temperance-openai-proxy.ts`.
5. `package/adapters/opencode/*` is fully removed, with zero dangling references
   in scripts, tests, or `ISA.md` (Phase 5 only).
6. `scripts/verify-all.sh` passes at the end of every phase.
7. Any non-`te-*` combo found live is removed, or the diff is documented as empty
   (Phase 0, operator-attested).

## 12. Phase 1 correction (found during implementation, 2026-08-02)

§5 Phase 1 originally described designating `omniroute-fallback-policy.json` as
authoritative and making `multi-backend-router.sh`, `classify-task.sh`, and
`temperance-workflows.ts` read from it. **Reading the actual files in full
(rather than the earlier Explore-agent summaries) showed this premise doesn't
hold**, and gap register item 1 above ("exactly one authoritative model-catalog
source") is not achievable as stated without breaking working, differently-scoped
systems. The corrected understanding:

- `omniroute-fallback-policy.json` is consumed only by
  `scripts/omniroute-temperance-reconcile.sh`'s jq policy engine — a
  guarded-slot substitution/quota system (tier1/tier2 chains, hysteresis) for
  combos already live in OmniRoute. For `monitor_only: true` combos (te-dispatch
  is one) the reconciler never reads `.slots` at all — it sets
  `desired_models := live_models`, so `.slots` there is pure documentation with
  zero behavioral effect.
- `multi-backend-router.sh`'s `MODEL_CATALOG` / `classify-task.sh`'s
  `model_for_type()` operate on command-code's own catalog (`deepseek/*`,
  `Kimi-K2.7-Code`, etc.) for a different purpose entirely: the direct-CLI
  fallback path used when OmniRoute itself is not an available backend. `MBR`
  already sources `classify-task.sh` as its one source for that pin;
  `MODEL_CATALOG`'s overlapping entries carry additional display-only metadata
  (tier/strength/context), not competing routing logic.
- `temperance-workflows.json`/`.ts` is a declarative combo-creation manifest
  (read by `fleet.sh`/`combos.sh`/`writer.sh` at combo-creation time) plus an
  "advisory" CLI (`docs/omniroute-fleet.md:118`) and a structural-contract
  validation input for `omniroute-native-control-plane.ts` — not a live dispatch
  dependency. `resolveWorkflow()` has no runtime caller outside tests and that
  advisory CLI.

These are three deliberately-separated concerns, not duplicate implementations
of one routing decision. Forcing them into one generic JSON would have broken
the reconciler's richer substitution semantics for no behavioral gain.

**What was real and got fixed instead:**

1. `omniroute-fallback-policy.json`'s `te-dispatch` `slots` (monitor-only,
   documentation-only) were stale — missing `codex/gpt-5.3-codex-spark`, which
   `temperance-workflows.json`'s `dispatch.omniroute_workers` and
   `scripts/omniroute-temperance-fleet.sh` (the actual creator/owner of
   `te-dispatch`) already declare as a member. Fixed, and
   `tests/omniroute-temperance-combos.sh` gained a permanent consistency check
   between the two files so this can't silently re-drift again.
2. `temperance-workflows.ts`'s `applyPlannerQuota()` doc comment cited
   `scripts/omniroute-temperance-planner-quota.sh` as the mirrored
   implementation — that script is now a deprecated forwarding shim to
   `omniroute-temperance-reconcile.sh --combo te-plan` and holds no logic of its
   own. Comment corrected to point at the real live implementation and to state
   plainly that `applyPlannerQuota()` is a simplified, te-plan-only advisory
   approximation of reconcile.sh's general substitution engine, not a strict
   mirror.

Gap register item 1 is retired as originally worded; the corrected Phase 1 goal
was "no stale or misattributed cross-references between the model-selection
surfaces that do overlap," verified by the new consistency test and the
corrected comments. `bun test package/router` (238 pass) and
`tests/omniroute-temperance-combos.sh` (0 fail) both green after the fix.
Phases 2–5 are unaffected — they were derived from direct reads of
`routing-policy.ts`, the OpenCode adapter, and Paseo's config, not from this
retracted premise.

## 13. Phase 2 implementation note (2026-08-02)

§5 Phase 2's "bridge reconcile.sh's quota polling into routing-observations.json"
held up on direct read of `routing-policy.ts`, but needed one refinement:
OmniRoute's quota data is per-*provider* (github, codex, nebius, ...), while
`routing-policy.ts`'s `BackendObservation` is keyed per-*MBR-backend*
(`omniroute`, `command-code`, `kimi`, `grok` — one candidate each). Only
`omniroute` has a real, non-invented mapping between the two: the average of
`classify()`'s live `remaining` percentage across every provider the current
reconcile run actually has quota data for. `command-code`/`kimi`/`grok` have
no equivalent live quota signal anywhere in this repo, and `cost_efficiency`
has no computed source for any backend — both stay at the neutral 0.5 default
by design, not fixed here, rather than fabricating a number.

**Implemented:**
- `routing-policy.ts` gained a `set-observation` CLI command (same lock +
  atomic-write discipline as `claim`/`observe`) that persists
  `quota_remaining`/`cost_efficiency` for one backend without disturbing that
  backend's other fields (health, circuit, etc.).
- `omniroute-temperance-reconcile.sh` now calls it after every run (dry-run or
  apply — quota fetch already happens regardless of mode), averaging
  `remaining` across providers with real data and skipping the call entirely
  (fail-open) when none have quota data.
- Regression + new-behavior tests: `tests/routing-policy.sh` (set-observation
  persistence, non-interference with existing fields, and the real quota
  value reaching `scoreCandidate()`'s `factors.quota`), `tests/omniroute-planner-quota.sh`
  (bridge wiring present; the averaging formula's provider-filtering and
  fail-open-on-no-data behavior, unit-tested directly since a full reconciler
  run needs live/mocked OmniRoute auth this test file's own TODO already flags
  as unresolved).

Verified: `bun test package/router` (238 pass), `tests/routing-policy.sh`
(0 fail), `tests/omniroute-planner-quota.sh` (0 fail),
`tests/omniroute-temperance-combos.sh` (0 fail). `scripts/verify-all.sh` as a
whole currently fails, but at `tests/dispatch-tasklist.sh` — confirmed via
`git stash` to be pre-existing breakage in already-uncommitted changes to
`package/router/dispatch-tasklist.sh`/`omniroute-codex.sh` from work outside
this session (164 and 78 changed lines respectively, none touched here), not
caused by Phase 1 or Phase 2. Every group `verify-all.sh` runs before that
point — including all three test files above — passes.

## 14. Phase 3 implementation note (2026-08-02)

§5 Phase 3 anticipated a large net-new component. Reading
`temperance-openai-proxy.ts` in full first (rather than the earlier
Explore-agent summary) changed the shape of the work, the same way Phase 1's
correction did:

- **It is already a generic, OmniRoute-facing OpenAI-compatible HTTP seam**,
  not something OpenCode-specific — it already does routing-policy/portfolio
  resolution and, critically, already has a `ENRICHMENT_SURFACES` mechanism
  for injecting `<temperance-context>` server-side for callers that can't
  self-enrich (currently just `kimi`). No new HTTP server was needed.
- **Automatic routing (`temperance-auto`) never needed catalog-guard
  protection** — `multi-backend-router.sh`'s portfolio resolution already
  only ever proposes models fetched live from OmniRoute. The real gap
  (matching what `OmniRouteCatalogGuard.ts` protects for OpenCode's picker)
  was the proxy's **explicit-picker path**, which forwarded any named model
  string unvalidated.

**Implemented, all evidence-based:**

1. **Catalog guard relocated**, not duplicated: `OmniRouteCatalogGuardCore.ts`'s
   logic now lives in `package/router/omniroute-catalog-guard.ts` (shared,
   not OpenCode-owned); the adapter file re-exports from it so its existing
   tests keep passing unmodified until Phase 5 deletes the wrapper.
2. **Fail-closed validation wired into `temperance-openai-proxy.ts`'s
   explicit-picker path**: an unknown/stale model now gets denied with a 404
   and `model_denied` code *before* any upstream call, with 3 new tests
   proving the denial, the fail-closed behavior when the catalog itself is
   unreachable, and that automatic routing is never subject to this check.
   Fixed 3 pre-existing tests that exercised the picker path without a live
   catalog assumption.
3. **The actual Paseo-registered component**: `package/router/omniroute-acp-agent.ts`,
   a minimal Agent Client Protocol (ACP) agent — JSON-RPC 2.0, newline-delimited
   stdio, matching the exact mechanism Paseo already uses for its `grok`/
   `kimi`/`copilot`/`codex`/`pi` `agents.providers` entries (`extends: "acp"`,
   spawned via `command`). Implements `initialize`, `session/new`,
   `session/prompt` (buffered, not incrementally streamed, in this v1),
   `session/cancel`, `authenticate`; declares `loadSession: false` honestly
   rather than claiming unimplemented capabilities. Delegates every model/
   provider decision to the unmodified `temperance-openai-proxy.ts` via one
   HTTP call — this file owns protocol translation only.

**On not guessing the protocol:** `WebSearch`/`WebFetch` both errored in this
environment (unrelated tool/model config issue, not a query problem —
confirmed by retrying). Rather than hand-implement ACP from memory, the exact
wire shapes (method names, `camelCase` field aliases, the `session/update`
notification carrying `agent_message_chunk`, `AgentCapabilities`,
`PROTOCOL_VERSION=1`) were read directly from the real `acp` Python SDK
(schema v0.10.8) already installed at
`~/.local/share/uv/tools/kimi-cli/lib/python3.13/site-packages/acp/` for
Paseo's own already-registered `kimi-cli` provider, and from the `paseo`
binary itself (`~/.local/bin/paseo --help`, confirmed present and runnable).
This is the same discipline as Phase 1: verify against the real thing before
building, even when the "real thing" required finding it locally instead of
via the web.

**Deliberately not done in Phase 3 (belongs to Phase 4, needs live Paseo):**
- Whether `"paseo"` should join `ENRICHMENT_SURFACES` (i.e., whether a
  Paseo-spawned ACP session can inject `<temperance-context>` itself, or
  needs the proxy's server-side injection like `kimi` does) is unknown
  without testing against live Paseo. Left unchanged rather than guessed;
  the request already carries `x-temperance-surface: paseo` so the decision
  is a one-line addition once known.
- Incremental streaming of `session/update` chunks (v1 buffers the full
  reply) — a real but scoped-out improvement, not a correctness gap.
- Registering the agent in `~/.paseo/config.json`'s `agents.providers` and
  running a real prompt through it end-to-end — that's Phase 4's cutover
  step, operator-run.

Verified: `bun test package/router/omniroute-acp-agent.test.ts` (19 pass,
including a real spawned-subprocess test that round-trips
initialize → session/new → session/prompt over actual newline-delimited
stdio JSON-RPC against a real local HTTP mock standing in for the proxy — the
closest honest substitute for "a real request" without live OmniRoute/Paseo
access). `bun test package/router package/adapters` (275 pass; one unrelated
pre-existing flaky test in untracked `signed-probe-challenge-ledger.test.ts`
reproduced once then passed 3/3 in isolation and on full-suite reruns — not
caused by this work, not modified by this work).

## 15. Phase 4 implementation note (2026-08-02): live end-to-end proof

This sandbox turned out to have real Keychain and localhost access after all
(the ISA-recorded "sandbox blocks Keychain/localhost" constraint that scoped
Phase 4 as operator-only did not hold this session — see also §13/§14's
memory and cost-bridge work, both live-tested the same way). Both OmniRoute
(`:20128`) and `temperance-openai-proxy.ts` (`:20129`) were confirmed
listening, so Phase 4's registration and a real end-to-end test were done
directly:

1. Registered a new `omniroute` entry in the live `~/.paseo/config.json`
   `agents.providers` (backed up to `~/.paseo/backups/` first), matching the
   exact `{extends:"acp", label, description, command:[...], env:{}}` shape
   the existing `grok`/`kimi` entries already use: `command: ["/opt/homebrew/bin/bun",
   ".../package/router/omniroute-acp-agent.ts"]`.
2. `paseo start` (daemon was stopped) → `paseo status` confirmed
   `omniroute  available (daemon)` alongside the existing Claude/OpenCode/grok
   providers.
3. `paseo run --provider omniroute --wait-timeout 60s "..."` → `status:
   "completed"`. `paseo logs <agentId>` showed a real reply routed through
   OmniRoute (a Trae-hosted model answered) — the full chain (Paseo spawns
   the ACP agent → stdio JSON-RPC `initialize`/`session/new`/`session/prompt`
   → `temperance-openai-proxy.ts` → `multi-backend-router.sh` → OmniRoute →
   real model → `session/update` notification → Paseo captures and marks the
   turn complete) is proven live, not just unit-tested.

**Not yet done, and deliberately not done without asking first**: this only
registered the provider as an *available option* (`--provider omniroute`
explicit selection). `package/paseo/orchestration-preferences.example.json`
and the live `~/.paseo/orchestration-preferences.json` still map
`impl`/`planning`/`audit`/`research` roles to `opencode/omniroute/te-*`
strings — the actual "cutover" (making this the *default* for Paseo's
role-based orchestration, not just an explicit option) changes standing
behavior for every future Paseo-orchestrated task across every project, not
only this repo. That's a bigger, broader-blast-radius change than the
additive provider registration above, and it's the one piece of Phase 4
still waiting on an explicit operator decision.

Also carried forward from Phase 3's own scope note: the `x-temperance-surface: paseo`
header the agent sends is not yet in `ENRICHMENT_SURFACES`, so
`<temperance-context>` injection does not happen for Paseo-routed prompts
yet (this test round-tripped fine without it, since it didn't depend on
enrichment) — still an open, deliberately-deferred question, not answered by
this test.

## 16. Phase 4 cutover (2026-08-02, same session): defaults flipped, with a real bug found and fixed along the way

Operator approved flipping `orchestration-preferences.json`'s role defaults
(not just leaving the provider available for explicit `--provider` use).
Before doing that, one more thing needed checking: does `provider/model`
addressing (the old `opencode/omniroute/te-dispatch` shape) even work for the
native ACP provider? Paseo's own daemon log answered it directly —
`"acp does not expose ACP model selection; using provider default model"` —
confirmed by running `--provider omniroute/te-dispatch` and finding
`paseo inspect` reported `Model: "te-dispatch"` while the actual OmniRoute
request (checked in `temperance-openai-proxy`'s own decision log) still went
through as plain automatic `temperance-auto` routing. The suffix is silently
dropped; naively setting all four roles to `omniroute/te-*` strings would
have quietly collapsed every role to the same auto-classified behavior,
losing the deterministic per-role portfolio pinning the old OpenCode setup
had (planning always → `te-plan`, audit always → `te-validate`, etc.).

**Fix**: registered four additional named providers in `~/.paseo/config.json`
— `omniroute-dispatch`, `omniroute-plan`, `omniroute-validate`,
`omniroute-write-research` — identical `command` to the base `omniroute`
provider, differing only in `env: {TEMPERANCE_OMNIROUTE_MODEL_HINT: "te-*"}`
(a hook already built into `omniroute-acp-agent.ts` in Phase 3, unused until
now). Env vars are set at process-spawn time, before ACP protocol
negotiation even starts, so they aren't subject to the "acp does not expose
model selection" limitation. Verified live: `paseo run --provider
omniroute-plan` produced a `temperance-openai-proxy` decision-log entry of
`{requested_model: "te-plan", routed_model: "te-plan", source:
"explicit-picker-override"}` — proving both the env-var pinning and Phase 3's
fail-closed catalog guard fired correctly on a real request for the first
time.

Both `orchestration-preferences.json` (live `~/.paseo/` and the repo's
`package/paseo/orchestration-preferences.example.json`) now map
`impl→omniroute-dispatch`, `research→omniroute-write-research`,
`planning→omniroute-plan`, `audit→omniroute-validate` (`ui` stays
`claude/claude-fable-5`, unrelated to OmniRoute).

**A real bug found in the process, unrelated to but blocking this change**:
`scripts/paseo-vault-projects.ts` (a separate vault/inventory-reconciliation
tool that bootstraps `orchestration-preferences.json` for newly-registered
projects) had its own independent `DEFAULT_PREFERENCES` constant hardcoded
to the old `opencode/omniroute/te-*` strings, *and* a schema check
(`loadPreferences()`) that unconditionally required every role value to
contain a `/` — which would have thrown `"must be provider/model"` on any of
the new bare provider names. Its separate `validatePreferenceTargets()`
function also assumed every target had a `/` to split on, which would have
silently produced a mangled provider name (`target.slice(0, -1)` on a
slash-less string) rather than erroring cleanly. Fixed both: the schema
check now accepts either shape, and `validatePreferenceTargets()` branches
on whether a `/` is present — `provider/model` targets keep the existing
"is this model in the provider's catalog" check, bare provider-name targets
now confirm the provider is registered and reachable (an empty model list is
the expected, valid response for an ACP provider, not a failure — confirmed
live: `paseo --json provider models omniroute-dispatch` → `[]`, exit 0).
Updated `DEFAULT_PREFERENCES` and the one test assertion that pinned the old
default value.

Verified: `bun test tests/paseo-vault-projects.test.ts` (7 pass, was
failing 6/7 before the `loadPreferences`/`validatePreferenceTargets` fix —
confirmed by reproducing the failure directly against a minimal fake `paseo`
binary before patching), `bun test package/router package/adapters` (296
pass), all three OmniRoute shell test suites (0 fail). `~/.paseo/config.json`
and `~/.paseo/orchestration-preferences.json` were backed up before editing.

## 17. Phase 5 correction (2026-08-02, same session): blocked, not executed — the "OpenCode adapter" is not Mac-only

Phase 5 as originally scoped above (§5) assumed `package/adapters/opencode/*`
was Mac/Paseo-only surface area, safe to delete once Paseo stopped routing
through it (Phase 4). Investigating the current, live blast radius before
touching anything — this repo's established discipline all session — found
that assumption false, and found it via files the original plan never
enumerated because they predate this milestone's scoping conversation
entirely.

**Finding 1 — a second, independent production consumer of OpenCode exists.**
The `safvr` AWS host (`hermes-runner-01`) runs OpenCode as the Hermes
service's own headless agent loop, with no Paseo involvement at all. This is
tracked as its own acceptance ledger in `ISA.md` (ISC-297 through ISC-326+:
"EC2 OpenCode enables only `omniroute` and `temperance` providers," "EC2
OpenCode resolves fourteen governed aliases," "EC2 OpenCode reconciliation
runs as `ubuntu`, never root," etc.) and governed by infrastructure this
session hadn't previously touched or catalogued:
`scripts/configure-opencode-session-profiles.sh` (779 lines; manages the full
provider/agent/model/alias surface for both `mac` and `ec2` host profiles,
including the Algorithm/S-tier fail-closed readiness gate),
`scripts/configure-opencode-relay.sh`, `package/router/omniroute-opencode.sh`
(Keychain-authenticated launcher), and
`package/router/temperance-session-profiles{,.ec2}.json`. None of this is
Paseo-adjacent; per `docs/runbooks/opencode-ec2-session-profile.md` it exists
so the headless EC2 host gets the same curated, fail-closed OpenCode session
contract as the Mac.

**Finding 2 — the two files originally slated for deletion are shared, not
Mac-exclusive, and one is unverifiable from the repo alone.**
`scripts/wire-multi-backend.sh`'s plugin-install step (its Step 2, ~506-516)
is the *only* installer anywhere in the repo for
`TemperanceFlowPlugin.ts` (as `~/.config/opencode/plugins/temperance-flow.ts`),
and it uses plain `$HOME` with no Mac/EC2 branching — confirming it's shared
installer code, consistent with ISC-309's evidence that EC2 reconciliation
runs as the `ubuntu` user via the same `$HOME`-relative pattern. Deleting
`TemperanceFlowPlugin.ts`/`TemperanceFlowPluginCore.ts` would remove EC2's
only means of (re)installing that plugin. Separately, a repo-wide search
found **no script anywhere** that installs `OmniRouteCatalogGuard.ts` as a
plugin on any host, despite it being live on Mac today and gated by
`temperance-doctor.sh`'s `opencode_guard` check — meaning its install
mechanism predates current tooling or was set up by hand. Its safety to
delete cannot be established from repo state alone; it requires checking the
live EC2 host's `~/.config/opencode/plugins/` directory, which this sandbox
cannot reach (no AWS SSM access).

**Decision (operator, via AskUserQuestion): stop deleting, close Phase 5 as
blocked.** No files were changed. `package/adapters/opencode/*` (including
the confirmed-dead-on-Mac `PromptProcessing.hook.sh` — no `hooks` key exists
in Mac's live `opencode.json`, and `configure-opencode-session-profiles.sh`
never touches a `hooks` field either, though EC2 parity is unverified)
remains fully intact, alongside all of §5's originally-cited removal targets
(`wire-multi-backend.sh`'s wiring block, `tests/temperance-doctor.sh` /
`scripts/temperance-doctor.sh`'s OpenCode checks, `scripts/verify-all.sh`'s
five OpenCode test gates, `ISA.md` ISC-107/111/112). The Paseo-native
routing milestone's actual goal — Paseo no longer depends on OpenCode to
reach OmniRoute — was already achieved and verified live in §15-16; Phase 5's
adapter-removal step was cleanup on top of that, not a dependency of it, so
leaving it undone blocks nothing else in this milestone.

**Reopening this later requires**, at minimum: live confirmation of exactly
what's symlinked in `~/.config/opencode/plugins/` and `~/.config/opencode/hooks/`
on `hermes-runner-01` (via AWS SSM, `AWS_PROFILE=safvr`), and a decision on
whether EC2's OpenCode-as-Hermes'-agent-loop is itself in scope for a future
native-provider replacement (mirroring Phase 3's ACP work) or is intended to
stay on OpenCode indefinitely — that decision was never made this session and
determines whether "retire OpenCode" is even the right eventual goal for the
EC2 surface, versus keeping it as permanent shared infrastructure.

## 18. Phase 0 implementation note (2026-08-02, same session): combo hygiene done live; te-swarm-s and te-review adopted, not removed

§5's Phase 0 assumed a plain `te-*` prefix check was sufficient to find
ungoverned combos, and assumed this sandbox couldn't reach live OmniRoute.
Both assumptions were already corrected before this phase ran: the sibling
memory/compression design doc's §0 found the prefix check insufficient (see
its own text, unchanged here), and this session repeatedly proved live
Keychain + localhost access works from Bash. So Phase 0 ran directly, live,
in-session rather than being deferred to the operator.

**Live combo fetch** (`bash scripts/omniroute-temperance-combos.sh`,
authenticated dry-run, no mutation): captured a fresh snapshot
(`.omniroute-backups/omniroute-combos-20260802T124206Z.json`, superseding the
9-day-stale one Phase 0 was written against) and confirmed the complete live
set — 16 combos: `te-fast, te-build, te-reason, te-validate, te-dispatch,
te-creative, te-write, te-write-critique, te-write-research, te-write-media,
te-plan, te-swarm-s, te-review, temperance-coding, te-free-burst,
te-algorithm`. Cross-referencing against every combo-writer script's owned
set accounted for exactly 14 of the 16; **zero rogue non-`te-*` combos
exist**, and exactly two remained ungoverned: `te-swarm-s` and `te-review`
(both `_v3.source: routing-v3-proposal.md`, same unexplained external origin
as `te-free-burst`, applied 2026-07-26).

**Inspected both before deciding.** Both are well-formed, not junk: real
models, sensible descriptions, `priority` strategy with health/timeout config
matching every other Temperance-owned combo's conventions.
- `te-swarm-s`: "S-tier swarm: hardest tasks route through pure subscription
  capacity across three providers" — `antigravity/claude-opus-4-6-thinking`,
  `kimi-coding-apikey/k3`, `command-code/moonshotai/Kimi-K3`.
- `te-review`: "Code review lane: codex and github copilot's first routed
  seats, GLM-5.2 as subscription backstop" — `codex/gpt-5.6-sol-max`,
  `github/gpt-5.4`, `command-code/zai-org/GLM-5.2`.

**Operator decision (via AskUserQuestion): adopt both**, mirroring the
`te-free-burst` precedent from the sibling design doc rather than treating an
unexplained source as grounds for deletion. Wired identically to `bulk`'s
existing pattern:
- `package/router/omniroute-portfolios.json`: added `te-review` and
  `te-swarm-s` to `reserved_portfolios` (not `required_portfolios` — same
  optional-specialized-lane tier as `te-write`/`te-free-burst`, not part of
  automatic `task_type_portfolios` classification).
- `package/router/temperance-workflows.json`: two new top-level roles,
  `review` and `swarm`, each `{portfolio, purpose, models}` — the exact shape
  `bulk` uses, no bespoke sub-structure needed since both are flat
  single-stage combos, not multi-phase pipelines like `writing`.
- `package/router/temperance-workflows.ts`: extended `WorkflowRole` to
  include `"review" | "swarm"`, extended the `workflowManifest` type
  assertion, added both branches to `resolveWorkflow()` (identical shape to
  the `bulk` branch: map models to candidates, split against the live
  catalog, workflow steps `["freeze-plan", "route-te-<name>",
  "collect-evidence"]`).
- Tests: `omniroute-portfolios.test.ts`'s exact-match `reserved_portfolios`
  assertion extended; `temperance-workflows.test.ts` gained both roles'
  models in `liveFleet` plus 4 new tests (resolve + catalog-miss omission,
  per role), mirroring `bulk`'s existing two tests exactly.

Verified: `bun test package/router/temperance-workflows.test.ts
package/router/omniroute-portfolios.test.ts` (31 pass), `bun test
package/router package/adapters` (300 pass), `bash
tests/omniroute-temperance-combos.sh` (all checks pass, including the
existing `te-dispatch`/`temperance-workflows.json` cross-check, unaffected
by this change).

**A real, unrelated regression found and fixed along the way.**
`scripts/verify-all.sh` was not run end-to-end before this phase; doing so
surfaced 8 pre-existing `tests/dispatch-tasklist.sh` failures, all in
scenarios exercising OmniRoute-output-validity fallback (`literal NO`,
`inactive-item diagnostic`, `blank stream`, `short tail`, noisy variants).
Confirmed via `git stash` (reverting the entire session's working-tree
changes and re-running) that this predated Phase 0's own edits — it traces
to an earlier-this-session change to `package/router/omniroute-codex.sh`,
which now invokes real `codex` with `-o "$LAST_MESSAGE_FILE"` (matching
`codex`'s actual `--output-last-message` contract) plus a bounded
retry-on-empty-output loop guarding a known gateway-truncation bug. The
test's mock `codex` binary (`tests/dispatch-tasklist.sh`) was never updated
to match: it printed its fixture content to stdout instead of the file named
by `-o`, so `omniroute-codex.sh` saw an empty `$LAST_MESSAGE_FILE` on every
attempt, retried 4 times, and appended its own verbose "gateway truncation
bug" diagnostic sentence as the final line of the captured output — a
sentence long and letter-rich enough to slip past
`omniroute_output_is_valid()`'s too-short/too-few-letters heuristic, so the
fallback chain never triggered. Fixed by making the mock parse `-o` and
write its fixture content to that file (matching real `codex`'s contract),
preserving the original argv for its case-statement task-text matching.
Verified: `bash tests/dispatch-tasklist.sh` (0 fail, was 8), `bash
scripts/verify-all.sh` (full green, exit 0) — the first clean end-to-end run
confirmed this session.
