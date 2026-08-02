# GSD Roadmap

This roadmap maps only ratified work into GSD phases. Pending design surfaces
stay visible in `REQUIREMENTS.md` but do not become active execution phases.

## Ratified Milestone (queued): OmniRoute Paseo-Native Routing Overhaul

Ratification source: operator request via `/superpowers:brainstorm` dialogue,
2026-08-02. Design: [`docs/superpowers/specs/2026-08-02-omniroute-paseo-native-routing-design.md`](../docs/superpowers/specs/2026-08-02-omniroute-paseo-native-routing-design.md).

This milestone is ratified but not yet promoted to `config.json`'s
`active_milestone` — the current active milestone (below) has open governed gates
and `workflow.auto_advance` is `false`, so switching focus is an explicit operator
decision, not automatic. Promote by updating `config.json` and running
`/gsd:plan-phase` on Phase 1 once ready.

| GSD phase | Surface | Source | Done signal |
|---|---|---|---|
| Observe | Five drifting model-catalog sources; dead quota-scoring fields; live OpenCode adapter wrongly assumed dead; Paseo has no native HTTP-provider concept | Three parallel Explore passes + one focused follow-up, 2026-08-02 | Architecture, blast radius, and combo-store reality documented with file:line citations |
| Think | OpenCode-vs-Paseo resolution; combo-removal scope; roadmap-vs-narrow-slice scoping | `/superpowers:brainstorm` dialogue, three operator decisions (D1-D3) | Design doc written and operator-approved |
| Plan | Phase 0-5 dependency-ordered roadmap (combo hygiene → catalog consolidation → quota wiring → native provider → cutover → OpenCode retirement) | This design doc §5 | Per-phase `PLAN.md` via `/gsd:plan-phase`, one phase at a time |
| Build | Phase 1 done (§12): fixed `te-dispatch` Spark drift + stale doc comment. Phase 2 done (§13): real `omniroute` quota signal wired into `routing-policy.ts`'s scorer via `set-observation`. Phase 3 done (§14): catalog guard relocated to `package/router/omniroute-catalog-guard.ts`; fail-closed validation added to `temperance-openai-proxy.ts`'s explicit-picker path; new `package/router/omniroute-acp-agent.ts` implements a minimal Agent Client Protocol agent (verified against the real `acp` SDK already installed for Paseo's kimi-cli provider) that delegates all routing to the unmodified proxy. Remaining: Phase 4 cutover (register the agent in live `~/.paseo/config.json`, decide the `ENRICHMENT_SURFACES` question, run a real end-to-end prompt) and Phase 5 OpenCode retirement | `package/router` | Contracts P1-P5 (design doc §6) hold; unit tests pass per phase |
| Execute | Phase 4 done (§15-§16): `omniroute` + 4 role-pinned providers (`omniroute-dispatch/-plan/-validate/-write-research`) registered live in `~/.paseo/config.json`; `orchestration-preferences.json` (live and repo example) now default every role to the native provider, replacing `opencode/omniroute/te-*`. Proven end-to-end per role (`paseo run --provider omniroute-plan` → proxy decision log shows `explicit-picker-override` to `te-plan`, not auto-classified). Found and fixed a real bug in `scripts/paseo-vault-projects.ts` along the way (hardcoded old defaults + a schema check that would have rejected the new bare-provider-name shape). Phase 5 (OpenCode adapter removal) investigated and **closed as blocked, not executed** (§17): `package/adapters/opencode/*` turned out to be shared with an independent EC2 production consumer (`hermes-runner-01`/Hermes headless dispatch, ISC-297+), not Mac/Paseo-exclusive as originally scoped — deleting it would break EC2's OpenCode reconciliation with no repo-verifiable way to confirm safety short of live SSM access. No files changed for Phase 5; operator decision recorded via AskUserQuestion. Phase 0 done (§18): live combo fetch confirmed zero rogue non-`te-*` combos and exactly two ungoverned ones (`te-swarm-s`, `te-review`, both `routing-v3-proposal.md`-sourced like `te-free-burst`); operator chose to adopt both rather than delete, wired as new `review`/`swarm` roles mirroring `bulk`'s pattern. Found and fixed an unrelated pre-existing regression along the way: `tests/dispatch-tasklist.sh`'s mock `codex` predated `omniroute-codex.sh`'s `-o FILE` retry-on-empty-output contract, silently failing 8 fallback-safety checks. | Phase 4 §15-§16, Phase 5 §17, Phase 0 §18 | Live Paseo routing proven for both explicit and default-role selection; Phase 5 formally closed-blocked rather than left open-ended; Phase 0 done live with zero rogue combos found; `scripts/verify-all.sh` fully green (first clean end-to-end run this session) |
| Verify | Per-phase test gates plus operator-run live checks (combo diff, quota starvation, end-to-end Paseo routing) | Design doc §7 | All 7 items in design doc §11's verified gap register satisfied |
| Learn | ISC-107/111/112 retirement deferred — blocked on Phase 5 (§17), not done this milestone; new ISC entries for the single-catalog and real-quota invariants still open | `ISA.md` | Evidence recorded; milestone marked complete-except-Phase-5 in `.planning/STATE.md`, with Phase 5 tracked separately as blocked pending live EC2 verification |

## Ratified Milestone (queued): Memory, Compression, OmniGlyph, and Free-Tier Leverage

Ratification source: operator review request, 2026-08-02. Design:
[`docs/superpowers/specs/2026-08-02-memory-compression-freetier-leverage-design.md`](../docs/superpowers/specs/2026-08-02-memory-compression-freetier-leverage-design.md).
Researched via codebase Explore passes plus live, authenticated inspection of
the running OmniRoute dashboard (Memory, Quota, OmniGlyph, Free Provider
Rankings pages and their underlying `/api/*` calls) — not queued behind the
Paseo-native routing milestone; independent enough to run in parallel.

| GSD phase | Surface | Source | Done signal |
|---|---|---|---|
| Observe | PAI's two memory layers vs. OmniRoute's unconfigured Memory feature (0 entries, no embedding source); compression forced off with the `<temperance-context>` tag never fixture-tested; OmniGlyph gated to a model no live combo targets; `/api/free-provider-rankings` and the orphaned `te-free-burst` combo both confirmed live and unwired | Design doc §0-§4, live `/api/combos` + `/api/free-provider-rankings` fetch, 2026-08-02 | Findings documented with citations, including the 3 ungoverned `te-*` combos from `routing-v3-proposal.md` |
| Think | Sequencing by risk/effort; embedding-source choice for Memory; OmniGlyph's prerequisite routing decision | Design doc §5 | Operator reviews and approves sequencing before phase plans are written |
| Plan | Per-thread phase plans (free-tier wiring, memory ingestion, compression fixture-parity, OmniGlyph contingent design) | Design doc §1-§4 | `/gsd:plan-phase` per thread once ratified into `config.json` |
| Build | Done: `te-free-burst` wired (§4); `cost_efficiency` bridge on `/api/usage/analytics`, not the disjoint free-provider-rankings list (§4 impl. note); `<temperance-context>` fixture-parity gate in `omniroute-context-preview.ts` (§2 impl. note); `scripts/omniroute-memory-sync.sh` + `scripts/omniroute-memory-retrieve.sh` + `package/router/pai-memory-frontmatter.ts` (§1 impl. note); `lite` compression promoted, scoped per-portfolio via a fail-closed allowlist in `temperance-openai-proxy.ts` (§2 second impl. note). Remaining: SessionStart hook wiring (deliberately deferred — global blast radius, needs a latency/caching decision), PAI Layer-1 `events.jsonl` ingestion, Paseo project-settings toggle, OmniGlyph's prerequisite routing decision. `headroom` deliberately closed as not-promoted (§2 third impl. note) rather than left as a TODO | `package/router`, `scripts` | Contracts per design doc §6 hold; live-tested against the running OmniRoute instance, not just unit tests |
| Execute | Done: Static Potion embedding enabled (found broken — 404 on its HF asset, running on FTS5 fallback, not this repo's code to fix); memory sync applied live (7/7 synced, idempotent); memory retrieval tested live (real match returned); `lite`/`headroom` live fixture-parity probe run against the authenticated `/api/compression/preview` endpoint (§2 second/third impl. notes) — `lite` proved (6% real savings, all markers incl. `<temperance-context>` wrapper survived exactly-once/in-order); `headroom` properly exercised on a tool-result-shaped probe (dashboard-documented 8-row minimum, needs a pure top-level array as a message's sole content) and DID trigger (26-57% savings), but converts JSON to a "TOON" tabular format with zero documented evidence any fleet model correctly comprehends it -- an unverifiable-from-here model-comprehension risk, not a transport-fidelity one, so it stays deliberately unpromoted | N/A (live OmniRoute state) | Operator-attested |
| Verify | Fixture-parity gate for any promoted compression engine; bridge tests mirroring Phase 2's pattern | Design doc §6 | Tests pass; no engine promoted without its fixture proving `<temperance-context>` survival — `lite` has that proof live; `headroom` triggers but its risk (model comprehension of TOON output) is a different, unverified kind of evidence this gate can't produce, so it stays unpromoted on that basis |
| Learn | New ISC entries for the free-tier bridge, compression fixture-parity gate, and memory sync/retrieve scripts | `ISA.md` | Evidence recorded |

## Active Milestone: Full Native Integration Completion Audit

Ratification source: the operator's continuing OmniRoute integration goal and
2026-08-02 authorization for governed non-Codex workers with Sol excluded.

| GSD phase | Surface | Source | Done signal |
|---|---|---|---|
| Observe | OmniRoute native CLI preview authorization seam | installed 3.8.48 source, live denials, protected snapshot | native command and policy exist; current CLI and direct loopback authorization both fail closed |
| Think | Transport identity versus authorization readiness | first principles, systems analysis, exact non-Sol reviews | process binding is separated from credential validity and unsupported OS claims stay untrusted |
| Learn | Offline native CLI readiness diagnostic | `ISA.md` ISC-596..ISC-612, Advisor, Cato | exact six-file digest verification accepted; semantic preview and process-bound transport remain held |
| Build | Inspector, CLI, focused tests, documentation | new `package/router` and `scripts` surfaces | exact versioned contracts produce private metadata without network or authority |
| Execute | Installed-contract observation | exact local primary source plus redacted native snapshot | verified or unverified contract result; compression and protected projections remain unchanged |
| Verify | Focused, native, canonical, Advisor, Forge, Cato | local tests and read-only probes | exact bytes pass applicable gates without Sol-family dispatch |
| Learn | Full-objective completion decision | `ISA.md`, `.planning/STATE.md` | transport readiness is bounded; broader external promotion gates remain active |

The isolated private-worker slice is accepted: exact Spark and governed
non-Codex rails remain available, Sol is excluded, and signal cleanup is
fail-closed. The active milestone remains open for the external Context,
Hermes, Cloudflare, MCP/A2A, and genuine-S promotion gates.

The current slice does not execute OmniRoute's installed token loader or send a
preview request. It statically verifies the shipped command, endpoint, OpenAPI,
and management-policy contracts. Live semantic work remains closed until native
authorization and same-connection process identity are independently proven.

## Completed Milestone: Context Settings Preview Qualification

Ratification source: operator request on 2026-08-02.

| GSD phase | Surface | Source | Done signal |
|---|---|---|---|
| Observe | Installed preview route, OpenAPI, UI, auth policy, live status | OmniRoute 3.8.48 source and redacted snapshot | exact request shapes and current auth denial recorded |
| Think | Semantic, credential, and receipt boundary | Council, BeCreative, governed non-Codex reviews | browser/session reuse rejected; staged qualifier selected |
| Plan | Synthetic-only qualifier and trusted-transport gate | `ISA.md` ISC-572..ISC-585 | atomic pass/hold and non-claim contract frozen |
| Build | Pure qualifier core, CLI, and adversarial tests | `package/router`, `scripts` | focused suite passes without arbitrary prompt input |
| Execute | Documentation wiring and auth-gated live receipt | native guide, GSD, exact loopback endpoint | metadata-only receipt; all protected projections unchanged |
| Verify | Advisor, Cato, native/full gates, runtime invariants | local tests plus read-only probes | No P0/P1, no Sol, no protected mutation |
| Learn | Evidence and scoped-token promotion boundary | `ISA.md`, `.planning/STATE.md` | local harness closes; semantic promotion remains explicit |

This milestone does not enable prompt compression. Master compression, active
combo, and the custom system prompt remain off. An authenticated engine matrix
requires process-bound authenticated transport—not a reusable bearer token
alone—and must preserve every synthetic semantic marker before any per-request
trial can be considered.

## Completed Milestone: Hermes Secretless Discovery Hardening

The zero-auth offline compiler, v3 proposal, rollback binding, cookie cleanup,
focused tests, full verifier, and independent Cato pass are complete. Native
Hermes Apply and protected-host promotion remain separately authorized gates.
Completion evidence is governed by `ISA.md` ISC-564..ISC-571.

## Completed Milestone: OmniRoute Cloudflare Production Boundary

The isolated local adapter and hermetic transaction boundary are complete, but
live promotion remains deliberately closed. `createRemoteKey` stops before HTTP
because OmniRoute 3.8.48 cannot exactly enforce four manifest promises.
Hostname, Access, machine identity, resource-scoped authority, connector,
canary, and signed approval inputs remain external gates.

## Completed Milestone: Product-Engineering Workflow Hardening

Ratification source: operator request on 2026-07-09.

| GSD phase | Surface | Source | Done signal |
|---|---|---|---|
| Observe | Resolver planning-state flip | Current repo behavior and advisor flag | Tests name `.planning` absent and present contracts |
| Think | Product workflow authority | `ISA.md`, approved specs, current plans | `.planning/` records authority order and ratification policy |
| Plan | Ratified GSD mapping | `.planning/REQUIREMENTS.md` | Only ratified surfaces are mapped into active phases |
| Build | Verification spine | `scripts/verify-all.sh`, `.github/workflows/verify.yml` | Full local and CI verification use one script |
| Execute | Package hardening checks | Existing tests plus `bun test package/enrich` | `scripts/verify-all.sh` exits 0 |
| Verify | ISA continuity | `ISA.md` ISC-41..ISC-48 | Criteria and verification evidence are recorded |
| Learn | Future work intake | Pending specs in `REQUIREMENTS.md` | Deferred surfaces require explicit ratification before execution |

## Ratified Completed Surfaces

| Surface | Ratified source | Current state | ISA link |
|---|---|---|---|
| Public package baseline | `docs/plans/2026-06-12-temperance-engine.md` | Implemented and verified | ISC-1..ISC-27 |
| Temperance identity port and installer layering | `docs/superpowers/specs/2026-07-01-temperance-identity-port-design.md`; `docs/superpowers/plans/2026-07-01-temperance-identity-port.md` | Implemented and verified | ISC-33, ISC-34 |
| Unified PAI/GSD flow | `docs/superpowers/specs/2026-07-05-unify-orchestrators-A-F-design.md`; `docs/superpowers/plans/2026-07-05-unify-orchestrators-A-F.md` | Implemented and verified in `docs/pai-flow.md` | ISC-35..ISC-38 |
| Unified routing brain | `docs/superpowers/specs/2026-07-05-unify-routing-brains-design.md`; `docs/superpowers/plans/2026-07-05-unify-routing-brains.md` | Implemented and verified in router tests | ISC-39, ISC-40 |
| Routed parallel dispatch bridge | `docs/superpowers/specs/2026-07-04-routed-parallel-dispatch-bridge-design.md`; `docs/superpowers/plans/2026-07-04-routed-parallel-dispatch-bridge.md` | Completed dependency, reference only for new work | ISC-28..ISC-31 by superseded dispatch guidance |
| Isolated OmniRoute Cloudflare production boundary | Operator request on 2026-08-02; `docs/runbooks/omniroute-cloudflare-production-adapter.md` | Locally verified; external promotion deliberately closed | ISC-529..ISC-536 |

## Deferred Until Ratified

These surfaces are important context, but they are not active GSD phases from
this directory until their specs are explicitly approved for implementation.

| Surface | Current repo document | Reason deferred |
|---|---|---|
| Integrated system hardening | `docs/superpowers/specs/2026-07-02-integrated-system-hardening-design.md` | Status says pending user review |
| GSD hook wiring and external project conversion | `docs/superpowers/plans/2026-07-06-gsd-hook-wiring-and-ratandevelopers-conversion.md` | Plan exists without a ratified local spec |
