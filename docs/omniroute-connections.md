# OmniRoute connection inventory and leverage map

The workstation now has more than a model list. OmniRoute is holding several
different kinds of connections, and they must not be flattened into one
classifier or one undifferentiated fallback chain.

## Read-only inventory

Run the inventory at any time:

```bash
scripts/omniroute-connections.sh
scripts/omniroute-connections.sh --json | jq .
```

The command only reads OmniRoute health, configured connection metadata, the
OpenAI-compatible model catalog, and provider metrics. It emits no API keys,
OAuth tokens, raw provider errors, or full model IDs. `--json` returns the
versioned `temperance-omniroute-connections-v1` envelope. Unknown providers are
reported as `role: unmapped` and are never eligible for promotion.

The fixture test proves the schema and redaction contract without contacting an
upstream provider:

```bash
bash tests/omniroute-connections.sh
```

The inventory makes the catalog distinction explicit: advertised records may
contain duplicate aliases, so the report shows both `advertised_count` and a
deterministically deduplicated `unique_model_count`. Deduplication is sorted by
model ID and owner; it is descriptive only and never chooses a production
route.

## Current workstation snapshot

The latest local read-only probe found:

| Surface | Observation | Meaning |
| --- | --- | --- |
| Connections | 17 active, 11 API-key and 6 OAuth | credentials are connected, but not all are equally probed |
| Catalog | 503 advertised / 488 unique IDs | aliases are provider-owned and volatile |
| Agentic lane | Antigravity, Command Code, Kimi API-key currently eligible | healthy evidence exists for these connections |
| Backbone lane | Nebius, NVIDIA, Ollama Cloud | general model pools; promote only through named combos |
| Research lane | Brave, Exa, Firecrawl, Jina | tool services, not coding-model fallbacks |
| Media lane | ElevenLabs, RunwayML | speech/video/image contracts, not chat completions |
| Unknown lane | none after mapping known connections | any future provider fails loud as unmapped |
| Gateway health | OmniRoute healthy; governed portfolios probe successfully | `temperance-coding` is repaired; promotion remains shadow-gated |

Metrics are evidence, not truth about every capability. A search provider can
return a 400 to a chat-shaped probe while its native search API is healthy;
native capability probes are required before promoting research or media lanes.

## How Temperance should leverage the connections

| Lane | Temperance use | Promotion rule |
| --- | --- | --- |
| Agentic | tool-capable coding, planning, and parallel-dispatch model work | require native tool-loop success, health evidence, and a named combo |
| Research | bounded search, crawl, and embedding tools inside research skills | keep separate from model routing; probe each native API contract |
| Media | ElevenLabs/Runway generation behind native adapters | separate payload schemas, cost limits, and acceptance tests |
| Backbone | Nebius/NVIDIA/Ollama model pools behind OmniRoute combos | direct probe target, inspect tool/reasoning capability, then issue promotion receipt |

The existing Temperance execution spine remains unchanged:

```text
PAI / ISA / GSD
  -> classify-task.sh
  -> frozen routing plan
  -> connection inventory and observed health
  -> named OmniRoute combo or direct fallback
  -> Codex/OpenCode tool loop
  -> attempt evidence and ISA verification
```

## Temperance portfolio synthesis

The live combo set turns the philosophy into four differentiated operating
modes, without promoting every connected provider into the automatic rail:

| Portfolio | Temperance principle | Strategy | Verified target posture |
| --- | --- | --- | --- |
| `te-fast` | proportionate effort for bounded work | priority | low-latency content rail; Antigravity first, GitHub fallback |
| `te-build` | reversible agency with inspectable evidence | priority | Codex/GitHub/Nebius tool-capable rail |
| `te-reason` | explicit assumptions and evidence-weighted alternatives | priority | deep-thinking content rail; Antigravity, then Nebius/Codex |
| `te-validate` | challenge, reconcile, and synthesize | fusion | GitHub/Codex/Nebius tool-capable panel with Codex judge |

`temperance-coding` remains the compatibility rail for existing OpenCode and
Codex integrations. Research/crawl, embeddings, speech, video, and image
connections remain native capability lanes; they are intentionally not forced
into chat combos. `te-vision` and `te-batch` remain reserved until their native
contracts and evidence receipts exist.

The portfolio manifest is [package/router/omniroute-portfolios.json](../package/router/omniroute-portfolios.json). The authenticated lifecycle,
pre-mutation snapshot, collision guard, native target preflight, and rollback
path are implemented in `scripts/omniroute-temperance-combos.sh`.

The inventory is deliberately descriptive. It does not silently replace
`temperance-coding`, create combos, import credentials, or turn every connected
provider into an automatic route. The safe next promotion is to repair the
governed combo in Dashboard → Combos, then rerun the native probe and the full
verification gate.
