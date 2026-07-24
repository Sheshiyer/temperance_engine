# Temperance fleet and creative workflows

The fleet is deliberately role-based. `classify-task.sh` remains the only
task classifier; this document describes what happens after classification.
The role layer is [package/router/temperance-workflows.json](../package/router/temperance-workflows.json).

## Planner and orchestrator rail

GitHub and Codex are separate live connections on this Mac:

1. `github/gpt-5.4` is the default planning model. It passed a live tool-call
   probe and is kept separate from worker fan-out.
2. `codex/gpt-5.6-sol-max` is the escalation model for difficult plans. It is
   exposed by the Codex OAuth connection through OmniRoute, not by the
   `command-code` provider.
3. Nebius Qwen is the quota-conscious planning fallback.

`te-plan` is the named chat combo for this role. The planner produces a frozen
task graph, acceptance criteria, and route hints; it does not become a second
classifier and it does not directly mutate the workspace.

### Availability- and quota-aware reconciliation (all governed combos)

OmniRoute's own combo failover is reactive: `failoverBeforeRetry` only moves
to the next priority tier after a request actually fails, and none of its
built-in routing strategies express "prefer github/codex normally, but
proactively switch to a specific backup once the provider is manually disabled
or its remaining quota drops below a threshold" (`headroom` always picks
whoever has the most quota with no sticky primary preference; `reset-aware`
ranks by which window resets soonest — both were considered and neither
matches this shape). GitHub's live quota window is monthly, Codex's is a
rolling multi-day session window, and either provider can also be switched off
by hand in the dashboard — a signal no quota poll can see.

`scripts/omniroute-temperance-reconcile.sh` closes that gap for **every
governed combo**, generalizing the retired te-plan-only reconciler. It is
policy-driven: [`package/router/omniroute-fallback-policy.json`](../package/router/omniroute-fallback-policy.json)
(schema `temperance-fallback-v1`, registered as `fallback_policy` in
[`omniroute-portfolios.json`](../package/router/omniroute-portfolios.json))
declares, per combo, the BASE model list — including the original
`codex/gpt-5.6-terra` fusion judges, so hysteresis can restore them when codex
returns — plus per-slot substitute chains, anchors that are never substituted,
fusion judge chains, and tier metadata. A live combo that already matches the
computed desired (substituted) state is treated as valid, not as drift to fix.

Availability signals, in precedence order:

1. **manual-disable (HARD DOWN)** — the provider is `isActive:false` via
   `GET /api/providers`, **or** it is absent from `omniroute usage quota`
   while at least one other provider is present (disabled providers vanish
   from the quota report). Substitution is mandatory regardless of quota;
   the event reason is `manual-disable`.
2. **quota** — remaining quota below `threshold_percent` (30) substitutes;
   the event reason is `quota`.
3. **unknown/no data** — priority combos fail open (keep the live model,
   never switch on missing data); fusion combos **fail closed**: verdict
   HOLD, no mutation to that combo, exit code 3, and a `hold_reason` is
   recorded in the state file and event log.

Reconciliation rules:

- **Restore hysteresis** — a substituted base model returns only when its
  provider is `isActive:true` AND remaining ≥ `restore_hysteresis_percent`
  (40 = threshold + 10); a live base model is never evicted by hysteresis.
- **Dedup** — if two slots resolve to the same substitute, the later slot
  takes its next chain entry instead of listing the model twice.
- **Judge independence** — a fusion judge substitute must not equal any
  post-substitution panel model; conflicting entries are skipped. (OmniRoute
  uses `judgeModel` unconditionally with no fallback, so the judge is chosen
  fail-closed.)
- **Fusion panel floor** — after substitution the panel must keep ≥
  `max(minPanel, 2)` resolvable models, else HOLD.
- **Tier gating** — tier1 substitutes (`kimi-coding-apikey/k3`,
  `trae/gemini-3-flash-solo`, `antigravity/*`) are pre-probed and may land
  anywhere; tier2 bench models (`nvidia/deepseek-ai/deepseek-v4-pro`,
  `ollama-cloud/qwen3.5:397b`) may only land in trailing/chain-end
  positions. A tier2 model in slot position 0 yields a `requires-probe`
  verdict in dry-run and a HOLD under `--apply` until a live probe promotes
  it.

Mutations are full-body `PUT /api/combos/:id` (OmniRoute supports PUT; there
is no PATCH), preserving the combo id and every untouched field — only the
`models` array and, for fusion combos, `config.judgeModel` change. Every run
that can mutate snapshots `{settings, combos, catalog, policy, plan}` to
`.omniroute-backups/omniroute-reconcile-<UTC>.json` first — dry-runs
included — and the global `activeCombo` is verified unchanged afterwards.
`te-dispatch` and `te-write` are monitoring-only entries: their providers are
observed and reported, but they carry no substitute chains and are never
mutated.

```bash
scripts/omniroute-temperance-reconcile.sh --status    # read-only availability + diff report
scripts/omniroute-temperance-reconcile.sh --dry-run   # authenticated, snapshots, no mutation
scripts/omniroute-temperance-reconcile.sh --apply     # reconcile all governed combos
scripts/omniroute-temperance-reconcile.sh --combo te-plan --apply   # scope to one combo
scripts/omniroute-temperance-reconcile.sh --rollback FILE

# Run the reconciler automatically (default every 15 minutes):
scripts/omniroute-temperance-reconcile.sh --install-timer    # label com.temperance.engine.reconcile
scripts/omniroute-temperance-reconcile.sh --timer-status
scripts/omniroute-temperance-reconcile.sh --uninstall-timer
```

`--install-timer` also migrates the legacy timer: it unloads
`com.temperance.engine.planner-quota` and renames its plist to
`.removed.<timestamp>` before installing the new label.
`scripts/omniroute-temperance-planner-quota.sh` is **deprecated**: it is now a
thin shim that prints a notice and execs the reconciler with
`--combo te-plan "$@"`, so the old timer and any lingering callers keep
working until migrated.

The reconciler writes `~/.temperance_engine/state/omniroute-reconcile.json`
(schema `temperance-reconcile-v1`) and appends to
`~/.temperance_engine/state/omniroute-reconcile-events.jsonl`; when `te-plan`
is in scope it also refreshes the legacy
`~/.temperance_engine/state/omniroute-planner-quota.json`, so
[`package/router/temperance-workflows.ts`](../package/router/temperance-workflows.ts)'s
`resolveWorkflow("planner", ...)` advisory CLI keeps reading live quota data
from its expected path.

## Temperance Dispatch fleet

`te-dispatch` is a worker portfolio, not the planner. Independent tasks are
sharded across distinct failure domains and capabilities:

| Worker role | OmniRoute target | Direct CLI fallback |
| --- | --- | --- |
| Fast worker | `command-code/deepseek/deepseek-v4-flash` | Command Code DeepSeek Flash |
| Coding worker | `command-code/moonshotai/Kimi-K2.7-Code` | Kimi Code |
| Build worker | `grok-cli/grok-build` | Grok Build |
| Backbone worker | `nebius/Qwen/Qwen3-235B-A22B-Instruct-2507` | Claude fallback if all external rails fail |

Health, quota, capability, latency, and circuit observations rank eligible
candidates deterministically. A provider being listed is not enough: it must
pass the relevant native probe. The current live probes passed for the four
targets above, while the Kimi Coding OAuth connection itself is currently
quota-banned; the Kimi API-key route remains active.

This protects GitHub/Codex/Claude limits: planner requests are not consumed by
worker fan-out, and dispatch can use lower-cost or separately entitled rails.

## Creative workflow

Creative work has two phases:

```text
skill-cluster + ISA pointers
  -> te-creative creative brief planner
  -> native ElevenLabs / RunwayML contract
  -> artifact validation and policy checks
  -> evidence pointer and output handoff
```

`te-creative` is text planning only. ElevenLabs is called through
`/v1/audio/speech`; RunwayML is called through `/v1/videos/generations`. Their
models remain native media targets because a coding combo cannot safely express
audio/video payloads, asynchronous jobs, binary artifacts, or media cost
limits. OmniRoute's catalog reports these endpoint capabilities; they are not
evidence that a chat completion will work.

The full workflow must resolve the relevant taste/design skill cluster, inject
Temperance context and ISA pointers, create a brief, call the native provider,
validate the artifact, and record a reversible evidence pointer. Running a
skill without this context handoff is explicitly not the creative workflow.

## Writing workflow

The writing fleet serves `noesis-writer-skill`'s sequential autoregressive
loop with a hard generator/evaluator split:

```text
brand voice DNA + vault source lattice (client-side)
  -> te-write-research grounds and classifies claims (fusion council)
  -> te-write drafts one section (priority rail)
  -> te-write-critique scores drift and gates (fusion council)
  -> backpropagate corrections or commit (client-side loop, max 5 iterations)
  -> te-write-media plans image briefs; brandmint/FAL generates them client-side
  -> quality gates, convergence proof, and evidence ledgers (client-side)
```

`te-write` runs priority failover over `command-code/MiniMaxAI/MiniMax-M2.7`,
`nebius/moonshotai/Kimi-K2.6`, and Nebius Qwen; it drafts and never certifies its own
output. `te-write-critique` mirrors the `te-validate` fusion shape
(GitHub/Codex/Nebius panel, Codex terra judge) and returns one falsifiable
verdict per section — COMMIT, REGENERATE, or FLAG; it never drafts. The
skill's transmutation mode reuses the same rails: the council runs the
Nigredo claim inventory and Rubedo re-verification while the drafting rail
performs only the Citrinitas surgical edits.

Two expansion combos widen the fleet beyond draft/critique:

- **`te-write-research`** (fusion: `command-code/deepseek/deepseek-v4-pro`,
  `github/gpt-5.4`, `codex/gpt-5.6-terra`, judge `codex/gpt-5.6-terra`) runs
  *before* drafting begins. It triangulates independent research passes into
  one claim-classified synthesis using the Albedo Epistemic Grammar's seven
  claim modes (DIRECT-OBSERVATION through DECLARED-METAPHOR), so the drafting
  rail starts from a grounded source lattice instead of inventing citations
  mid-draft. It shares no models with `te-write-critique` or `te-write`,
  deliberately widening which providers the writing fleet actually exercises.
  It never drafts prose.
- **`te-write-media`** (priority: `github/gpt-5.4`, `codex/gpt-5.6-sol-max`,
  Nebius Qwen — the same proven roster as `te-creative`) writes structured
  brandmint/FAL image briefs in the noesis house style (Amir Musich
  typographic-poster anchors, Goethe color system, brand palette) instead of
  a generic creative brief. It is text planning only; brandmint/FAL still
  generates the actual image client-side, exactly as `te-creative` does for
  other creative work — this combo never becomes a second `te-creative`, it
  replaces te-creative's *generic* brief with a noesis-specific one for this
  one skill's image pipeline.

Lifecycle: `scripts/omniroute-temperance-writer.sh` for `te-write` /
`te-write-critique`, and `scripts/omniroute-temperance-writer-expansion.sh`
for `te-write-research` / `te-write-media` (both snapshot-first,
collision-guarded, rollbackable — split into two scripts because the first
pair was already live when the second pair was added, and a shared
collision guard would refuse to run against that pre-existing state).
Verify the role resolution with:

```bash
bun package/router/temperance-workflows.ts resolve writing MODEL_IDS...
```

The full phase-by-phase map, client-side boundaries, and catalog caveats
live in [docs/noesis-writer-routing.md](noesis-writer-routing.md).

## Verify the live state

```bash
scripts/omniroute-connections.sh --json | jq .
scripts/omniroute-check.sh --json | jq .
bun package/router/temperance-workflows.ts resolve planner MODEL_IDS...
```

Do not print API keys or provider tokens. Dashboard mutations remain
snapshot-first, collision-guarded, and rollbackable; never set a global
`activeCombo` as part of this workflow.

## Why `gpt-5.6-sol-max` is not a universal API model

On this machine, `codex/gpt-5.6-sol-max` and its `cx/` alias are live and
tool-capable. That does **not** mean `command-code/gpt-5.6-sol-max` or a direct
OpenAI API key can use the same string:

- `codex/*` is backed by the Codex OAuth connection and its entitlement.
- `command-code/*` is a separate provider/quota surface; the live probe for
  `command-code/gpt-5.6-sol` returned `PREMIUM_CREDITS_EXHAUSTED`, while the
  `*-max` spelling is rejected as an unrecognized provider model.
- OmniRoute's live catalog is an availability/metadata surface, not a promise
  of quota, plan access, or semantic equivalence across providers.
- The current Codex catalog reports a 500,000-token context window, 372,000
  maximum input tokens, 128,000 maximum output tokens, reasoning/thinking, and
  tool calling. Those are route limits, not an unlimited “max” allowance.
- OpenAI's product entitlement, Codex access, and API billing are separate;
  rollout, plan/workspace controls, regional support, rate limits, safety
  checks, and usage allowances can all deny a request even when a model name is
  visible. The API may expose Sol/Terra/Luna while a `max` suffix is only a
  Codex reasoning preset or gateway alias.

Therefore the planner treats GitHub, Codex, and Nebius as separate candidates,
probes the exact provider/model route, and falls back by role instead of
assuming that a model name is portable.
