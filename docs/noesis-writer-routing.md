# Noesis writer routing

This document maps every phase of `noesis-writer-skill` (the Tryambakam
Noesis drafting and transmutation skill in the vault's `.agents/skills/`)
onto the Temperance writing fleet. The skill remains the procedure owner;
OmniRoute only routes the two chat rails below. Everything else is
client-side and never crosses the gateway boundary.

## The writing fleet

Two combos, one boundary:

- `te-write` — the drafting rail. Priority strategy:
  `command-code/MiniMaxAI/MiniMax-M2.7` →
  `kimi/kimi-k2.6` →
  `nebius/Qwen/Qwen3-235B-A22B-Instruct-2507`.
  It drafts exactly one section at a time for the skill's sequential
  autoregressive loop and never certifies its own output.
- `te-write-critique` — the evaluation council. Fusion strategy over
  `github/gpt-5.4`, `codex/gpt-5.6-terra`, and Nebius Qwen with
  `codex/gpt-5.6-terra` as judge. It scores voice calibration, vocabulary
  contamination, fractal depth, source lattice integrity, and albedo claim
  grammar, then returns exactly one falsifiable verdict: `COMMIT`,
  `REGENERATE` (with specific corrections), or `FLAG`. It never drafts.

The role layer is the `writing` block in
[`package/router/temperance-workflows.json`](../package/router/temperance-workflows.json);
resolve it with:

```bash
bun package/router/temperance-workflows.ts resolve writing MODEL_IDS...
```

Both names are reserved (names-only) in
[`package/router/omniroute-portfolios.json`](../package/router/omniroute-portfolios.json).
They are role combos like `te-plan`/`te-dispatch`: no task-type mapping, no
classifier changes, and no effect on the five governed portfolios or the
`temperance-coding` compatibility rail.

## Phase map

| Skill phase | Where it runs | Combo / boundary |
| --- | --- | --- |
| P1 brand voice load | client-side file reads (brand-docs-final, voice fingerprint) | none |
| P2 source mining | client-side filesystem over the PARA vault | none — never MCP, never OmniRoute |
| P3 GENERATE (per section, sequential) | `te-write` | priority: MiniMax-M2.7 → kimi-k2.6 → Nebius Qwen |
| P3 EVALUATE / drift score | `te-write-critique` | fusion council, Codex terra judge |
| P3 backpropagate or commit (max 5 iterations) | client-side loop control | trace log stays client-side |
| P4a image planning | `te-creative` (reused) | text planning only |
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

## What never crosses the boundary

- **Vault mining is filesystem work.** The source lattice is built by the
  client from the PARA vault; only bounded excerpts enter a model request.
- **Image generation is client-side.** brandmint's FAL provider
  (Nano Banana Pro, Flux 2 Pro, Recraft V3) runs as local Python with
  `FAL_KEY`; FAL is not an OmniRoute connection and must not be forced into
  a chat combo. `te-creative` plans the image; brandmint makes it.
- **Gate ledgers and traces are evidence artifacts.** Albedo ledgers,
  transmutation traces, and convergence proofs persist in the vault, not in
  route telemetry.
- **MCP lanes stay minimal.** Topical research may use the Exa search lane;
  everything else in this workflow needs no MCP tool. The client authorizes
  any tool call, as always.
- **ACP is declared but inactive.** The `writing` block names an ACP lane
  for future editor-agent integration only; agent-protocol contracts require
  a separate principal-bound security design before any implementation.

## Lifecycle

```bash
scripts/omniroute-temperance-writer.sh                 # authenticated dry-run
scripts/omniroute-temperance-writer.sh --apply         # create both combos
scripts/omniroute-temperance-writer.sh --rollback \
  .omniroute-backups/omniroute-writer-<timestamp>.json
```

The script is snapshot-first, refuses to overwrite existing combos, and
verifies that global `activeCombo` stays unchanged. Its catalog preflight
requires all five writer models live, including `kimi/kimi-k2.6` — that ID
is not yet verified against the live catalog, so if the live spelling
differs the preflight fails closed; correct the ID in the script and in
`temperance-workflows.json` before `--apply`. Timeouts are drafting-sized
(`te-write` 240s/120s) because long-form sections routinely exceed
reasoning-answer lengths; the council reuses the validation timeouts
(180s/90s).
