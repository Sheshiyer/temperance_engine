# Memory, Compression, OmniGlyph, and Free-Tier Leverage — Design

**Issue:** Operator review request, four related but distinct threads: (1) PAI native memory integration with OmniRoute's own memory feature, dynamic across CLI sessions, extending into Paseo project settings; (2) compression is underleveraged and must not touch PAI's own algorithm/enrichment flow; (3) leverage OmniGlyph; (4) systematic tracking of free-tier and promotional models for routing preference.

**Status:** design (research complete — codebase research plus live, authenticated inspection of the running OmniRoute dashboard at `localhost:20128`; awaiting operator review before ratification/`/gsd:plan-phase`).

---

## 0. How this was researched

Three parallel codebase Explore passes (PAI memory architecture, compression pipeline, free-tier tracking) were followed by direct, authenticated browsing of the live OmniRoute dashboard (`Memory`, `Provider Quota`, `Quota Sharing`, `OmniGlyph`, `Free Provider Rankings` pages) and inspection of the actual REST calls those pages make. This surfaced facts no static code read could have: OmniRoute's Memory feature has zero entries and no embedding source configured; the live quota page shows `GPT-5.3-Codex-Spark` at 0% remaining right now; `/api/free-provider-rankings` is a real, working endpoint with a concrete JSON schema (not just a dashboard visual); and the live `/api/combos` list contains three `te-*`-prefixed combos — `te-swarm-s`, `te-review`, `te-free-burst` — that none of Temperance's own lifecycle scripts (`omniroute-temperance-combos.sh`/`-writer.sh`/`-writer-expansion.sh`/`-fleet.sh`) created. All three carry `_v3.source: "routing-v3-proposal.md"` and were applied 2026-07-26, outside Temperance's governed combo lifecycle entirely.

That last finding matters beyond this doc: **Phase 0 of the OmniRoute Paseo-native routing milestone** (`2026-08-02-omniroute-paseo-native-routing-design.md`) assumed "remove any non-`te-*` combo" was a sufficient drift check. It isn't — these three combos pass a prefix check while still being ungoverned. Phase 0's task has been annotated with this finding; it doesn't need re-scoping here, just awareness that a prefix check alone won't catch everything.

---

## 1. PAI memory ↔ OmniRoute memory ↔ Paseo

### Problem
Two memory layers already exist and have never talked to each other or to OmniRoute:
- **PAI's own memory** (`~/.claude/PAI/MEMORY/{WORK,LEARNING,RELATIONSHIP,STATE}`), hook-populated, auto-injected at session start by `LoadContext.hook.ts` as the "PAI Dynamic Context" block.
- **Claude Code's native per-project memory** (`~/.claude/projects/<slug>/memory/`), frontmattered markdown + `MEMORY.md` index, closed-source injection logic.

**Live state of the integration target**: OmniRoute's "Conversational Memory" page shows `Total Entries: 0`, `Tokens Used: 0`, and — critically — its Engine tab reports **`Embedding: auto: no embedding source available`**. Keyword search (FTS5) works today; semantic search does not, because no embedding source is configured. Three options exist: Remote provider (needs API key, ongoing cost), Static local "potion" (no WASM/external deps, small model), Transformers.js/MiniLM (local, ~400MB RAM, ~3s cold start). A Tier-2 Qdrant vector store is also available but disabled (only worth it for a very large memory set or cross-instance sharing — not this).

### Decision needed (operator)
Which embedding source to enable. **Recommendation: Static local (potion-base-8M)** — no ongoing cost, no external dependency, no meaningful RAM tax, consistent with this codebase's existing local-first posture (e.g. compression forced off rather than trusting an unverified remote transform). Remote-provider and Transformers.js are viable fallbacks if potion's quality proves insufficient in practice.

### Design
Treat OmniRoute's memory as a **downstream index**, not a competing source of truth — this is the same non-destructive posture the existing "do not duplicate OmniRoute's control plane" principle already establishes elsewhere in this codebase (`docs/omniroute-integration.md:5-8,68`).

1. **Ingestion (one direction, PAI → OmniRoute)**: a new script tails PAI's `events.jsonl` (append-only, safe to read without touching write paths) and the native project `memory/*.md` files, and upserts into OmniRoute's memory via its API (`Add Memory`/`Import` — confirmed present on the dashboard; exact request shape needs one more live inspection pass before implementation, not blocking this design). Map PAI's `type: user/feedback/project/reference` onto OmniRoute's `Factual/Episodic/Procedural/Semantic` taxonomy (straightforward but not 1:1 — needs an explicit mapping table at implementation time, e.g. `feedback→Procedural`, `project→Episodic`, `reference→Factual`, `user→Semantic`).
2. **Retrieval (OmniRoute → session, the other direction)**: a sibling SessionStart hook alongside `LoadContext.hook.ts` that queries OmniRoute's memory search and folds relevant hits into the same "Dynamic Context" injection pattern already in place — additive, not a replacement for PAI's own memory.
3. **Paseo project settings**: a per-project toggle (which OmniRoute memory namespace to sync into, on/off) — Paseo's existing generic hook-forwarding (`paseo hooks claude SessionEnd/Stop`) already gives a lifecycle signal to trigger sync; no new plumbing needed there.
4. **Cross-CLI-session dynamism**: because this lives in OmniRoute (a shared local daemon, not per-CLI-process state), any CLI surface routed through OmniRoute — Claude, OpenCode, Kimi, and eventually the Paseo-native ACP agent from Phase 3 — reads the same memory index automatically, which is the actual mechanism for "dynamic across CLI sessions like PAI does."

### Non-goals
Not replacing Claude Code's native project-memory injection (opaque, not ours to change). Not making OmniRoute memory the primary store — PAI's own memory stays authoritative; OmniRoute is a searchable mirror.

### Implementation note (2026-08-02): ingestion + retrieval built and live-verified; three scope corrections

**Verified API schema** (via the live dashboard's Add Memory form and Playground, then confirmed by direct calls):
- `POST /api/memory` — `{type: "factual"|"episodic"|"procedural"|"semantic", key, content, metadata}` → echoes back the entry plus `id`, `apiKeyId`, `sessionId`, `createdAt`, `updatedAt`, `expiresAt`, `accessCount`, `lastAccessedAt`.
- `GET /api/memory?page=N&limit=N` — paginated list, `{data, total, page, limit, totalPages, stats}`.
- `POST /api/memory/retrieve-preview` — `{query, strategy: "exact"|"semantic"|"hybrid", maxTokens}` → `{memories: [{id, type, key, content, score, tokens, tier, vecScore, ftsScore}], resolution, totalTokensUsed, budgetMaxTokens}`. The field name took three tries to find live: `budgetTokens` and `budget` were both rejected by the server's own validation (`"Unrecognized key"`) before `maxTokens` was confirmed correct — recorded here so it's never re-guessed.
- All three endpoints use the same admin-session cookie auth as `/api/combos`/`/api/providers` (confirmed by observing them fire together in one authenticated dashboard session) — not the separate inference API key. Both new scripts reuse `omniroute-temperance-reconcile.sh`'s exact login pattern rather than inventing a second auth path.

**Scope correction 1 — Layer 1 (PAI's own `events.jsonl`) deferred, not ingested.** The design originally proposed tailing both PAI's `events.jsonl` and native project memory. Built only the native per-project memory side (`~/.claude/projects/<slug>/memory/*.md`) — it's the well-understood, already-directly-verified format (frontmatter + body, four typed categories), and reading PAI's internal event log carries more sensitivity and complexity than this pass needed to take on for a first working version. `events.jsonl` ingestion is a clean, additive follow-up once the native-memory path has run for a while.

**Scope correction 2 — hook wiring deliberately not done.** Built `scripts/omniroute-memory-sync.sh` (ingestion: PAI project memory → OmniRoute, dry-run by default, idempotent via a pre-fetched existing-key set, never mutates or deletes anything already in OmniRoute) and `scripts/omniroute-memory-retrieve.sh` (retrieval: query → formatted memories, read-only per OmniRoute's own design). Neither is wired into `~/.claude/hooks/` or `~/.claude/settings.json`. That's global-system-modifying (changes session-start behavior for every project, not just this one) and the retrieval script's own admin login is a real network round-trip that would add real latency to every session start — it deserves a caching/TTL decision before going into a hook, not a default-on wire-up as a side effect of this work. Live-tested both scripts directly instead: `--apply` synced all 7 real memory files from this project's own memory directory into OmniRoute (`pai.temperance_engine.*` keys, idempotent on re-run — confirmed 0 new on second run), and a retrieval query against the live store returned a real match.

**Scope correction 3 — flagging a live environment issue found in passing, not caused by this work.** The retrieval response's `resolution.fallbackReason` reported `"Failed to download https://huggingface.co/minishlab/potion-base-8M/resolve/main/vocab.json: HTTP 404"` — the Static Potion embedding asset enabled earlier this session is 404ing at the source, so retrieval is currently running on the FTS5 keyword-search tier (`"tier":"fts5"`, `vecScore: null`), not true semantic vector search. Keyword search still works (the live retrieval test above returned a real result), so this doesn't block ingestion or retrieval functioning — but semantic-quality ranking won't improve until this resolves, which is outside this repo's code (an external HuggingFace-hosting/OmniRoute-internal path issue, not something `omniroute-memory-sync.sh`/`omniroute-memory-retrieve.sh` can fix).

**Paseo project-settings toggle (design point 3): not built.** Still deferred — the ingestion/retrieval mechanism it would toggle now exists and works standalone; wiring a Paseo-side per-project on/off control is a reasonable next increment once the hook-wiring question above is settled.

Verified: `bun test package/router/pai-memory-frontmatter.test.ts` (12 pass, including the real fixture read from `kimi-surface-live.md` byte-for-byte), `tests/omniroute-memory-sync.sh` (structural checks), live `--apply` run against the running OmniRoute instance (7/7 synced, confirmed idempotent), live retrieval query (real match returned).

---

## 2. Compression — real infrastructure, one real gap

### Problem (confirmed, not assumed)
Compression is forced `off` on every Temperance-routed request (`temperance-openai-proxy.ts`'s `enforceCompressionBoundary()`), and substantial supporting infrastructure already exists and is currently idle: `omniroute-context-preview.ts` (a fixture-parity test harness with `CONTEXT_PREVIEW_CANDIDATES=["lite","headroom","rtk-minimal"]` already probed, and `CONTEXT_PREVIEW_HELD_ENGINES` covering `session-dedup, ccr, caveman, relevance, aggressive, ultra, llmlingua, omniglyph` still untested), `omniroute-native-control-plane.ts` (reads OmniRoute's live compression policy), and a full per-engine safety table in `docs/omniroute-native-integration.md`. The documented rationale (`ISA.md` risk entries, ISC-362–373) is sound: no fixture evidence yet proves any engine preserves PAI stage markers, ISA IDs, tool-schema JSON, or receipts byte-for-byte.

**The gap that matters most for "shouldn't affect PAI's algo/flow"**: the `<temperance-context>` block itself is not specially protected anywhere. It's plain text spliced into the same message content OmniRoute would compress (`temperance-openai-proxy.ts:injectContext()`, `TemperanceFlowPluginCore.ts`). The existing fixture matrix tests synthetic stage/ISA/tool-schema markers but **never the literal `<temperance-context>...</temperance-context>` tag pair**. Today this is moot because compression is fully off — but it means the safety property you're asking for ("shouldn't affect PAI algo/flow") isn't actually verified yet, only assumed by virtue of the master switch being off.

### Design
1. **Close the gap first, before enabling anything**: add the literal `<temperance-context>` wrapper (with realistic PAI/GSD/ISA content inside it) to `omniroute-context-preview.ts`'s fixture matrix, and require exact byte survival per candidate engine before that engine is eligible for promotion. This is additive to the existing harness, not a new one.
2. **Promote conservatively, starting with the already-probed low-risk engines**: `lite` (whitespace/format cleanup) and `headroom` (tabular compaction) are the least likely to touch prose content at all, and both already have partial live probe evidence (unauthenticated 401, per prior research — meaning the transport path works, only the auth boundary was hit). These are the natural first candidates once fixture parity is proven.
3. **Scope by portfolio, not globally**: extend `temperance-session-profiles*.json`'s `transport_policy.omniroute_compression` (currently only supports the literal `mode:"off"`) to name a specific engine per portfolio/task-type, with `enforceCompressionBoundary()` validating against an allowlist instead of hardcoding one value. Keep `te-algorithm`, `te-plan`, and anything S-tier-flagged excluded by default — those are exactly the paths where a silent content change would be most damaging and least visible.
4. **Do not promote `session-dedup`, `ccr`, `relevance`, `caveman`, `aggressive`, `ultra`, or `llmlingua`** in this pass — they're semantically transformative (summarization, pruning, dedup) rather than format cleanup, and carry meaningfully higher risk to prompt fidelity. Treat as a later, separately-gated decision once the lite/headroom promotion has run cleanly for a while.

### Non-goals
Not flipping the global master switch. Not touching `enrich/contract.ts`'s block-construction logic — the fix is at the transport boundary (what's allowed to reach OmniRoute), not the enrichment layer itself.

### Implementation note (2026-08-02): step 1 done
`omniroute-context-preview.ts` gained a third synthetic fixture (`temperance-context-wrapper-v1`) simulating the real `<temperance-context>...</temperance-context>` wrapper shape with synthetic-only content (consistent with the harness's existing no-real-prompt-data design), plus a new `CONTEXT_WRAPPER_MARKERS` triplet (open tag / inner canary / close tag) folded into `CRITICAL_MARKERS` and independently tracked as `contextWrapperOrderPreserved` on `CandidateDecision` — a named, auditable field, not just buried in the generic marker list, so a promotion decision-maker can see this specific gate pass or fail directly. New `context_wrapper_order_drift` reason fires on strip/duplicate/reorder of the tag pair. 7 new tests cover: unmodified-echo survival, stripped-open-tag detection, duplicated-close-tag detection, reordered-tag detection (hoisting the close tag before the open tag, the specific failure mode a summarizing/reordering engine could produce), and receipt non-leakage. Verified: `bun test package/router` (284 pass), `tests/omniroute-temperance-combos.sh` (0 fail). Step 2 (actually probing `lite`/`headroom` against a live, authenticated OmniRoute instance to see whether they pass this gate) is operator-run — this harness is deliberately anonymous-only/unauthenticated by design (see its "production surface confinement" test), so live promotion evidence has to come from outside this sandbox.

---

## 3. OmniGlyph

### Problem — the gating is stricter than "leverage it" implies
Live inspection confirms real, measured economics: ~10× fewer tokens on the converted block, 59–70% end-to-end savings, 1456 image tokens for a 1568×728 page (~28k chars), 100% reading accuracy on Fable 5 (n=30). But it fires only when **all four** gates pass: model = `claude-fable-5` exactly, transport = direct Anthropic (not an aggregator), format = native Claude (never a system role inside messages), and a per-request density/profitability check.

**Concrete finding**: none of Temperance's 16 live governed combos (`te-fast` through `te-algorithm`, fetched from `/api/combos` this session) target `claude-fable-5` at all — the closest is `antigravity/claude-opus-4-6-thinking` in several combos, a different model on a different (Antigravity-proxied, not direct-Anthropic) transport. **OmniGlyph cannot fire for any current Temperance-routed traffic today.** "Leveraging OmniGlyph" is therefore not a toggle — it's a prior decision about whether to introduce a dedicated Fable-5-via-direct-Anthropic path at all.

### Design (contingent on that prior decision)
1. If the operator wants to pursue this: a new narrow portfolio (e.g. `te-fable-direct`) scoped specifically to dense-context tasks (long tool-doc-heavy prompts, large retrieved context) where Fable 5 is both correct for the job and where OmniGlyph's density gate would actually trigger — not a general-purpose lane.
2. It inherits the same fixture-parity requirement as §2: the `<temperance-context>` block survival test applies here too, and arguably matters *more* — OmniGlyph re-renders content as an image, a much larger transformation than text-cleanup compression, and the fixture harness's `CONTEXT_PREVIEW_HELD_ENGINES` already correctly lists it as untested/held.
3. Given the operator's own framing ("OmniGlyph, preview — off by default until end-to-end validation lands" is OmniRoute's own stated position, not Temperance's), this should be sequenced **after** §2's lite/headroom promotion proves the fixture-parity methodology works, not in parallel with it.

### Non-goals
Not enabling OmniGlyph as a fallback/substitute for any existing combo's models — it changes model selection (Fable 5 only) as a precondition, which is a routing decision, not a compression toggle.

---

## 4. Free-tier and promotional model tracking

### Problem (confirmed dead/manual today)
`cost_efficiency` in `routing-policy.ts` has no data source (WEIGHTS.cost_efficiency=0.10, always neutral 0.5 — established in Phase 2 of the routing overhaul). Free-tier/promotional awareness today is entirely manual: dated prose comments in `classify-task.sh` plus matching `ISA.md` changelog entries, updated by a human re-running `command-code --list-models` by hand. `temperance-workflows.json`'s `cost_posture` field (`free-or-low-cost`, `subscription-or-provider-quota`, etc.) is populated but **never read** by `resolveWorkflow()` — dead metadata.

### Why this matters now, quantified (live Analytics, 10 active days, 791.0M tokens / 10,138 requests / $556.68 total)
`gpt-5.3-codex-spark` alone accounts for **$425.23 — 76% of all spend** — while the single highest-*volume* model, `kimi-coding-apikey/k3` (4,065 requests, 355.1M tokens, 44.9% of all requests), costs **$0.00** (subscription-covered). `laguna-s-2.1-free` (213 requests, 25.6M tokens) and `ling-3.0-flash-free` (16 requests, 1.8M tokens) are also $0.00. Cost concentrates almost entirely in two providers — Codex ($428.13) and Github ($103.56) — which together are 95% of total spend on 47.7% of requests, while Kimi-Coding-Apikey carries 44.9% of requests at $0. This is direct, quantified evidence that routing more of the Codex-bound load toward the already-connected free/subscription lanes (exactly what `te-free-burst` and a real `cost_efficiency` signal would do) has real, immediate cost impact — not a speculative optimization.

### Two concrete, verified levers, neither currently wired

**(a) `GET /api/free-provider-rankings`** — confirmed live and working, not just a dashboard visual. Returns `{rankings: [{id, name, category: "apikey"|"noauth"|"oauth", topModel: {modelId, modelName, score, eloRaw, confidence, category}, averageScore, modelCount}]}` for 26 ranked free providers (Blackbox AI, Augment, Antigravity CLI, and 23 others), Arena-ELO-derived. This repo has zero code reading it today.

**(b) The `te-free-burst` combo already exists in OmniRoute, unwired.** Live `/api/combos` shows: `{"name":"te-free-burst","description":"Zero-cost burst lane for low-stakes bulk work; soaks load off paid lanes.","models":["opencode/deepseek-v4-flash-free","command-code/poolside/laguna-s-2.1-free"],"strategy":"priority", ...}`, created 2026-07-26 via the same external `routing-v3-proposal.md` process noted in §0. **No file in this repo — not `omniroute-portfolios.json`, not `temperance-workflows.json`, not `multi-backend-router.sh` — references `te-free-burst` at all.** Someone already built exactly the thing this section is asking for, and it's currently invisible to Temperance's own routing.

### Design
1. **Wire `te-free-burst` in first** — lowest-effort, highest-immediacy win. Add it to `omniroute-portfolios.json` as a real portfolio option (likely mapped from the existing `fast` task type, or a new `bulk`/`free-burst` type if task-type semantics don't fit), and reference it in `temperance-workflows.json` alongside the existing dispatch/planner roles. This alone gets free-tier leverage live without inventing a new mechanism.
2. **Investigate `routing-v3-proposal.md`** before wiring — it's the unexplained source of `te-swarm-s`, `te-review`, and `te-free-burst`. Worth a quick check of whether this file exists somewhere findable (repo history, another session's scratch output) before treating its combos as either "adopt" or "orphaned and safe to ignore."
3. **Feed `cost_efficiency` from `/api/free-provider-rankings`**, mirroring the exact pattern already built in Phase 2 for `quota_remaining`: a periodic poll (candidate site: extend `omniroute-temperance-reconcile.sh`, which already runs periodically and already calls `routing-policy.ts set-observation`) that derives a per-MBR-backend cost/free-ness signal and calls `set-observation --cost-efficiency`. The same backend-granularity caveat from Phase 2 applies — this ranking is per-OmniRoute-provider, not per-MBR-backend (`omniroute`/`command-code`/`kimi`/`grok`), so the mapping needs the same care Phase 2's quota bridge required, not a naive 1:1 copy.
4. **Retire or reconcile `cost_posture`** rather than leaving it as a second, drifting, unused cost taxonomy alongside the new `cost_efficiency` feed — either wire it into `resolveWorkflow()`'s selection logic for real, or remove it if `cost_efficiency` fully supersedes its purpose.

### Non-goals
Not building a new promotional-deal-tracking system from scratch — `command-code`'s own deals stay in `classify-task.sh`'s existing hand-maintained comments for now (still the most direct source for that one provider); this section's leverage is about the two *already-existing, currently-disconnected* mechanisms (`te-free-burst`, `/api/free-provider-rankings`), not a rebuild.

### Implementation note (2026-08-02): `te-free-burst` wired; the `cost_efficiency` bridge changed data source
`te-free-burst` is done: added to `omniroute-portfolios.json`'s `reserved_portfolios` and to a new `bulk` role in `temperance-workflows.json`/`.ts`, with its own tests and cross-file consistency checks in `tests/omniroute-temperance-combos.sh`.

Point 3's plan (feed `cost_efficiency` from `/api/free-provider-rankings`) didn't survive contact with live data. Diffing the live `/api/combos` provider set (`antigravity, codex, command-code, github, grok-cli, kimi-coding-apikey, nebius, nvidia, ollama-cloud, opencode, trae`) against the free-rankings id set (26 providers, listed in §4 above) found overlap of exactly two — `ollama-cloud` and `opencode`, both bench-tier substitutes, not the anchor providers carrying real traffic (Codex, GitHub, Antigravity, Command-Code). A signal built on that list would be structurally uninformative for the traffic that actually exists.

Used `GET /api/usage/analytics?range=7d` instead (same admin-session auth as the existing `/api/combos`/`/api/providers` calls `reconcile.sh` already makes — verified against `scripts/lib/omniroute-curl.sh`'s `api_get()` before writing any fetch code). It reports real recent cost per `(provider, model)` for exactly the traffic OmniRoute is carrying. The bridge computes the request-weighted fraction of recent requests that cost `$0` and persists it as `omniroute`'s `cost_efficiency` — a direct, honest proxy rather than an invented `$/token` normalization scale. Combined with the existing quota bridge into a single `set-observation` call per reconcile run (one lock acquisition, both signals together when both are available). `command-code`/`kimi`/`grok` remain untouched, same rationale as Phase 2.

Point 4 (`cost_posture` retirement) is not done — deferred, since it's a small independent cleanup, not blocking.

Verified: `bun test package/router package/adapters` (284 pass), `tests/omniroute-planner-quota.sh` (0 fail, includes new unit tests for the request-weighted zero-cost-fraction formula), `tests/omniroute-temperance-combos.sh` (0 fail).

---

## 5. Sequencing recommendation

Independent enough to parallelize, but if sequenced by risk/effort: **(4) free-tier wiring first** (lowest risk, existing combo just needs referencing, most concrete payoff) → **(1) memory integration** (needs one operator decision — embedding source — then is purely additive) → **(2) compression fixture-parity + lite/headroom promotion** (needs new test coverage before any behavior change) → **(3) OmniGlyph** (blocked on a prior routing decision, and on §2's methodology landing first).

## 6. Verification

- §4: `bun test` coverage for the `te-free-burst` portfolio wiring; a fixture test for the `/api/free-provider-rankings` → `cost_efficiency` bridge mirroring Phase 2's quota-bridge tests exactly.
- §1: mapping-table unit tests (PAI type → OmniRoute type); ingestion script tested against fixture `events.jsonl`/`memory/*.md` files, not live PAI state.
- §2: the new `<temperance-context>` fixture-parity test is the acceptance gate — no engine gets promoted without it passing.
- §3: no new tests until the prior routing decision is made; if pursued, inherits §2's fixture-parity gate plus new tests for the Fable-5/direct-Anthropic/native-Claude gate combination itself.
- Live-environment items (OmniRoute API calls, actual embedding generation, actual combo creation) are operator-run, consistent with this repo's established sandbox limitation.

---

## Appendix A. Live orchestration snapshot (2026-08-02, informs "what is Temperance actually doing")

Gathered by browsing OmniRoute's Providers and Analytics pages directly, to ground the four sections above in what the system is actually orchestrating today, not just what the code says it should do.

**Provider surface: 27/255 configured.** OmniRoute supports 255 total provider integrations across LLM, search, embedding/rerank, image, audio, video, cloud-agent, local/self-hosted, aggregator, and enterprise/cloud categories. Only 27 are connected. The connected set is concentrated almost entirely in **coding-agent OAuth tools** (Antigravity ×2 accounts, Antigravity CLI, Claude Code, Cursor IDE, Trae ×2, Kimi Coding, OpenAI Codex, Grok Build, Kiro AI, GitHub Copilot) plus a handful of **free-tier/API-key LLM backbones** (Blackbox AI, Gemini, HuggingFace, Nebius AI, NVIDIA NIM, Ollama Cloud, OpenCode Zen, Command Code) and **specialized augmentation services** reserved for the `te-creative`/`te-write-media` combos (Brave Search, Exa Search, Firecrawl, Jina AI, ElevenLabs, Runway, Google Jules). Entire categories sit at 0/N connected: all 16 aggregators/gateways (including OpenRouter itself), all 14 enterprise/cloud providers (Bedrock, Azure, Vertex, etc.), all 12 local/self-hosted providers, 4 of 6 no-auth providers.

**This confirms the orchestration goal in practice, not just in docs**: Temperance is a **coding-agent dispatch and fallback layer**, not a general-purpose multi-modal AI gateway — the unused 228 providers are headroom, not gaps in the current mission.

**Usage reality (10 active days, 791.0M tokens, 10,138 requests, $556.68 total, 20 accounts, 21 providers, 55 models):** traffic is extremely bursty — a single day (Jul 28) carried 505.7M of the 791.0M total tokens (~64%), consistent with a batch dispatch run rather than steady drip usage. `AVG TOKENS/REQ` is 78.0K — large-context, coding-session-shaped requests, which is also relevant to §2/§3: there's real token volume for compression/OmniGlyph to act on, if their fidelity gates are ever cleared. Two API keys account for essentially all traffic: "Temperance Engine" (799.1M tokens, $458.82) and "Temperance Claude Native" (927.2K tokens, $2.73) — confirming Temperance is by far OmniRoute's dominant consumer on this host, not one of several.

**The cost/volume split is the single most actionable fact from this whole review** (detailed in §4): 44.9% of requests run on a $0 subscription lane (`kimi-coding-apikey/k3`) while 76% of spend concentrates in one preview-tier model (`gpt-5.3-codex-spark`, via Codex). Every other section in this doc (memory, compression, OmniGlyph) is a leverage-what-exists exercise; §4 is the one with a live dollar figure attached to it today.
