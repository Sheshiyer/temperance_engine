# Noesis writer routing

This document maps every phase of `noesis-writer-skill` (the Tryambakam
Noesis drafting and transmutation skill in the vault's `.agents/skills/`)
onto the Temperance writing fleet. The skill remains the procedure owner;
OmniRoute only routes the two chat rails below. Everything else is
client-side and never crosses the gateway boundary.

## The writing fleet

Four combos, each with one job:

- `te-write` — the drafting rail. Priority strategy:
  `command-code/MiniMaxAI/MiniMax-M2.7` →
  `nebius/moonshotai/Kimi-K2.6` →
  `nebius/Qwen/Qwen3-235B-A22B-Instruct-2507`.
  It drafts exactly one section at a time for the skill's sequential
  autoregressive loop and never certifies its own output.
- `te-write-critique` — the evaluation council. Fusion strategy over
  `github/gpt-5.4`, `codex/gpt-5.6-terra`, and Nebius Qwen with
  `codex/gpt-5.6-terra` as judge. It scores voice calibration, vocabulary
  contamination, fractal depth, source lattice integrity, and albedo claim
  grammar, then returns exactly one falsifiable verdict: `COMMIT`,
  `REGENERATE` (with specific corrections), or `FLAG`. It never drafts.
- `te-write-research` — the grounding council, run *before* drafting.
  Fusion strategy over `command-code/deepseek/deepseek-v4-pro`,
  `github/gpt-5.4`, and `codex/gpt-5.6-terra` (judge `codex/gpt-5.6-terra`).
  It triangulates independent research passes into one claim-classified
  synthesis using the Albedo Epistemic Grammar's seven claim modes, so the
  drafting rail starts from a grounded source lattice instead of fabricating
  citations mid-draft. It shares no models with `te-write` or
  `te-write-critique` — deliberately widening which providers the fleet
  actually exercises. It never drafts prose.
- `te-write-media` — the image-brief planner. Priority strategy over
  `github/gpt-5.4`, `codex/gpt-5.6-sol-max`, and Nebius Qwen (the same
  roster `te-creative` uses). It writes structured brandmint/FAL briefs in
  the noesis house style (Amir Musich typographic-poster anchors, Goethe
  color system, brand palette) instead of a generic creative brief — text
  planning only; brandmint/FAL still generates the image client-side.

The role layer is the `writing` block in
[`package/router/temperance-workflows.json`](../package/router/temperance-workflows.json);
resolve it with:

```bash
bun package/router/temperance-workflows.ts resolve writing MODEL_IDS...
```

All four names are reserved (names-only) in
[`package/router/omniroute-portfolios.json`](../package/router/omniroute-portfolios.json).
They are role combos like `te-plan`/`te-dispatch`: no task-type mapping, no
classifier changes, and no effect on the five governed portfolios or the
`temperance-coding` compatibility rail. `te-creative` remains a separate,
generic combo for non-writing creative work; `te-write-media` does not
replace it, it gives this one skill's image pipeline its own house-style
brief writer instead of `te-creative`'s generic brief.

## Phase map

| Skill phase | Where it runs | Combo / boundary |
| --- | --- | --- |
| P1 brand voice load | client-side file reads (brand-docs-final, voice fingerprint) | none |
| P2 source mining | client-side filesystem over the PARA vault | none — never MCP, never OmniRoute |
| P2b claim grounding | `te-write-research` | fusion council, Codex terra judge, Albedo claim-mode classification |
| P3 GENERATE (per section, sequential) | `te-write` | priority: MiniMax-M2.7 → kimi-k2.6 → Nebius Qwen |
| P3 EVALUATE / drift score | `te-write-critique` | fusion council, Codex terra judge |
| P3 backpropagate or commit (max 5 iterations) | client-side loop control | trace log stays client-side |
| P4a image planning | `te-write-media` | text planning only, noesis house style |
| P4b image generation | client-side brandmint/FAL (`FAL_KEY`) | never an OmniRoute lane |
| P5 quality gates + convergence proof | council scoring + client-side checks | ledgers persist in the vault `_processing/` tree |

## Transmutation mode

The skill's Nigredo→Albedo→Citrinitas→Rubedo audit of existing posts uses
the same two rails with inverted emphasis:

| Alchemical stage | Combo | Contract |
| --- | --- | --- |
| NIGREDO (blind claim extraction) | `te-write-critique` | inventory claims; never rewrites |
| ALBEDO (ledger classification) | `te-write-critique` + client-side ledger | `{slug}-albedo-ledger.json` stays client-side |
| CITRINITAS (surgical edits) | `te-write` | deletion-over-addition edits under ledger instruction |
| RUBEDO (re-verification) | `te-write-critique` | verdict TRANSMUTED / PARTIAL / ESCALATE-TO-MANUAL |

## Context: Somatic Canticles and the biorhythm mobile app

`noesis-writer-skill` lists `Somatic-Canticles` (the Tryambakam Noesis
manuscript project at `01-Projects/tryambakam-noesis/`) as one of the source
areas its vault-mining phase draws from — the skill writes marketing/blog
content *about* that universe. A separate, real product in the same
`tryambakam-noesis` folder, `somatic-cantincles-mobile-app`, is a beta
Expo/React Native app with a genuinely implemented biorhythm-gated chapter
system (`lib/unlock-engine.ts` evaluates each chapter's unlock conditions
against live physical/emotional/intellectual/spiritual cycle values from a
sibling `Selemene-engine` API).

**This is a branding/content-lineage connection, not a built mechanic.**
There is no "alchemical infusion" system, no Nigredo/Albedo/Citrinitas/Rubedo
stage-gate, and no coded link between the skill's alchemical protocol and
the app's biorhythm engine anywhere in either codebase — confirmed by
searching the app, its backend, and the manuscript for those exact terms.
The word "alchemical" appears only as narrative prose flavor in the source
chapters (e.g. Chapter 9: *"the volatile salt of fear was sublimated into
the fixed gold of will"*). The two systems share a brand umbrella
(`tryambakam.space`) and a content pipeline (manuscript → skill → blog),
not a code integration. This writing fleet expansion (`te-write-research`,
`te-write-media`) stays scoped to `temperance_engine`'s routing layer and
does not touch `somatic-cantincles-mobile-app`, `Somatic-Canticles-book`,
or `Selemene-engine`.

## What never crosses the boundary

- **Vault mining is filesystem work.** The source lattice is built by the
  client from the PARA vault; only bounded excerpts enter a model request.
- **Image generation is client-side.** brandmint's FAL provider
  (Nano Banana Pro, Flux 2 Pro, Recraft V3) runs as local Python with
  `FAL_KEY`; FAL is not an OmniRoute connection and must not be forced into
  a chat combo. `te-write-media` plans the brief; brandmint makes the image.
- **Gate ledgers and traces are evidence artifacts.** Albedo ledgers,
  transmutation traces, and convergence proofs persist in the vault, not in
  route telemetry.
- **MCP lanes stay minimal and distinct from `te-write-research`.**
  `te-write-research` is a chat combo that synthesizes and classifies
  claims from context it's given; it does not browse the web itself. The
  Exa search MCP lane is what a client uses to fetch topical facts *before*
  handing them to the research council — the combo and the tool are
  separate seams, and everything else in this workflow needs no MCP tool.
  The client authorizes any tool call, as always.
- **ACP is declared but inactive.** The `writing` block names an ACP lane
  for future editor-agent integration only; agent-protocol contracts require
  a separate principal-bound security design before any implementation.

## Lifecycle

```bash
scripts/omniroute-temperance-writer.sh                            # te-write / te-write-critique dry-run
scripts/omniroute-temperance-writer.sh --apply                    # create both
scripts/omniroute-temperance-writer.sh --rollback \
  .omniroute-backups/omniroute-writer-<timestamp>.json

scripts/omniroute-temperance-writer-expansion.sh                  # te-write-research / te-write-media dry-run
scripts/omniroute-temperance-writer-expansion.sh --apply          # create both
scripts/omniroute-temperance-writer-expansion.sh --rollback \
  .omniroute-backups/omniroute-writer-expansion-<timestamp>.json
```

Two scripts, not one: `te-write`/`te-write-critique` were already live
before `te-write-research`/`te-write-media` were designed, and a shared
collision guard would refuse to run against that pre-existing state. Each
script is snapshot-first, refuses to overwrite existing combos, and
verifies that global `activeCombo` stays unchanged. The first script's
catalog preflight requires `command-code/MiniMaxAI/MiniMax-M2.7`,
`nebius/moonshotai/Kimi-K2.6`, `nebius/Qwen/Qwen3-235B-A22B-Instruct-2507`,
`github/gpt-5.4`, and `codex/gpt-5.6-terra`; the second requires
`command-code/deepseek/deepseek-v4-pro`, `github/gpt-5.4`,
`codex/gpt-5.6-terra`, `codex/gpt-5.6-sol-max`, and Nebius Qwen — all
confirmed against the live `/v1/models` catalog on 2026-07-23. Timeouts are
drafting-sized (`te-write` 240s/120s) because long-form sections routinely
exceed reasoning-answer lengths; the councils reuse the validation-style
timeouts (180s/90s for research, 120s/60s for the shorter media brief).
