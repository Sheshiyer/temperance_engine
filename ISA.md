---
project: temperance_engine
task: Expand the noesis writing fleet with research and media sub-lanes (te-write-research + te-write-media)
effort: E3
phase: verify
iteration: 2026-07-23-writing-fleet-expansion
progress: 185/187
mode: interactive
started: 2026-06-12
updated: 2026-07-23
---

## Problem

The local PAI, skill-cluster, peon-ping, and CodeGraph integration exists as a working machine-specific runtime, but it is not packaged into a public, reviewable, one-time installer.

Temperance also has a unified task classifier and dual-rail batch dispatcher, but its backend selection is primarily static. It does not yet combine capability fit, observed health, quota/cost state, deterministic fallback, and attempt telemetry into one explicit routing policy.

The previous 14-entry backend/model catalog was Temperance-owned scaffolding, not OmniRoute's live provider inventory. OmniRoute patterns were adapted locally, but the OmniRoute runtime itself was never initialized, secured, or connected to agentic dispatch.

## Vision

Temperance Engine gives a user a readable public repo that explains the runtime, installs the safe pieces, references optional local voice packs, and verifies the configuration without leaking private machine state.

The orchestrator should use OmniRoute without becoming an OmniRoute fork: Temperance classifies work and freezes an inspectable dispatch plan; Codex supplies the workspace-capable agent loop; OmniRoute supplies the dynamic provider/model catalog and internal failover; direct agent CLIs preserve outage recovery.

## Out of Scope

Bundling private memory, credentials, backups, proprietary voice/audio packs, or forcing non-macOS voice behavior is out of scope.

Vendoring or forking OmniRoute, replacing `classify-task.sh`, committing provider credentials, automatically importing private provider accounts, or making the base Temperance installer depend on a running OmniRoute daemon remains out of scope. This workstation's explicitly approved local runtime integration is in scope.

## Principles

- `ISA.md` remains the single acceptance ledger and preference store.
- GSD organizes execution; Speckit-style specs/plans supply design context.
- Runtime enrichment must fail open and expose pointers, not private file bodies.
- Ratification controls scope: pending review surfaces stay deferred.
- Classification decides what the task is; policy ranks where it should run; execution records what actually happened.
- Health, capability, cost, and quota signals may influence backend ranking without becoming a second task classifier.
- Fallback is a planned route with observable attempts, not an exception hidden inside a shell loop.
- Temperance owns task classification; OmniRoute owns provider/model inventory and gateway failover.

## Constraints

- Paths must be generalized through `$HOME` and environment variables.
- Installer must create backups before modifying local config.
- Voice packs must be referenced, not vendored.
- Non-macOS devices must be able to skip voice.
- `~/.agents/skill-clusters/skills` must not be scanned wholesale at startup.
- `package/router/classify-task.sh` remains the only task-type and primary-model classifier.
- `ISA.md` remains the only durable preference and acceptance ledger.
- OmniRoute-derived code or protocol ideas must be license-reviewed and attributed before reuse.
- Existing router and batch CLI contracts remain backward compatible unless an explicit migration is ratified.
- Agentic dispatch through OmniRoute must retain a tool-capable client loop; raw chat completion alone is not a coding-agent replacement.

## Goal

Create a public-ready `Sheshiyer/temperance_engine` repository with install, verify, rollback, templates, and documentation for the custom runtime.

Integrate the smallest high-leverage OmniRoute patterns into Temperance's existing router and parallel dispatcher: source-anchored design, capability/health/quota-aware ranking, circuit breaking and ordered failover, dry-run explainability, compact attempt telemetry, and full regression tests, while preserving the ISA and unified classifier as the sole policy authorities.

Configure a secured local OmniRoute runtime as the preferred external gateway, make its live catalog the source of model inventory, execute its selected models through Codex's agent loop, and retain existing direct backends as automatic outage fallbacks.

## Criteria

- [x] ISC-1: Repository contains `install.sh`.
- [x] ISC-2: Repository contains `verify.sh`.
- [x] ISC-3: Repository contains rollback guidance.
- [x] ISC-4: Installer uses `$HOME` or override variables, not hard-coded user paths.
- [x] ISC-5: Installer backs up existing files before writes.
- [x] ISC-6: Voice is optional and skipped on non-macOS by default.
- [x] ISC-7: Voice packs are referenced but not bundled.
- [x] ISC-8: PAI flow is documented.
- [x] ISC-9: Skill-cluster routing is documented.
- [x] ISC-10: Peon-ping pack mapping is documented pack-by-pack.
- [x] ISC-11: CodeGraph routing is documented.
- [x] ISC-12: Credits are documented.
- [x] ISC-13: skills.sh-facing skill card exists.
- [x] ISC-14: skills.sh metadata exists.
- [x] ISC-15: README includes banner, badges, architecture, and upload guidance.
- [x] ISC-16: Upstream GitHub repos are linked from credits or upstream docs.
- [x] ISC-17: Banner image exists.
- [x] ISC-18: Icon image exists.
- [x] ISC-19: Shell verification uses each script's declared interpreter.
- [x] ISC-20: Public/install surfaces contain no private local path patterns.
- [x] ISC-21: README rebuild pipeline path is configurable, not hard-coded to a local user path.
- [x] ISC-22: NotebookLM asset manifest stores repo-relative paths.
- [x] ISC-23: Default installer skips Claude template and Pulse server unless `--with-claude` is passed.
- [x] ISC-24: Default installer skips Codex template unless `--with-codex` is passed.
- [x] ISC-25: OpenCode and Cursor templates are installed by default.
- [x] ISC-26: Cursor ships both `AGENTS.md` guidance and `.cursor/rules/*.mdc` guidance.
- [x] ISC-27: Public docs state no Claude Pro/Max, Anthropic auth, or specific model is required.
- [x] ISC-28: `docs/parallel-dispatch.md` documents when to use superpowers:dispatching-parallel-agents vs GSD execute-phase/workstreams vs subagent-driven-development. _(Superseded by ISC-35/ISC-37: this guidance now lives in `docs/pai-flow.md`'s per-phase table + doctrine; `parallel-dispatch.md` is retired to a redirect stub.)_
- [x] ISC-29: `docs/pai-flow.md` Execute phase references `docs/parallel-dispatch.md`. _(Superseded by ISC-35/ISC-37: the Execute-phase dispatch decision is now in `docs/pai-flow.md` itself; the reference to `parallel-dispatch.md` is a retired-stub pointer, not a delegation.)_
- [x] ISC-30: `package/hooks/ParallelDispatchContext.hook.sh` exists and is advisory-only (never blocks, never triggers dispatch).
- [x] ISC-31: `--with-gsd` install flag exists, default OFF, and prints a reference-only note without vendoring GSD.
- [x] ISC-32: Temperance Engine owns exactly one preference store (`ISA.md`); GSD config and PAI steering/memory stay fully external and untouched except one read-only display read in `ParallelDispatchContext.hook.sh`, which never writes to `config.json`.
- [x] ISC-33: `tests/sandbox-install.sh` asserts installer layering in an isolated sandbox (real install, backups, dry-run safety, restore-from-backup, hook behavior, GSD gating) and never touches the real home directory.
- [x] ISC-34: `scripts/apply-identity.sh` attaches the Temperance identity block to the operator `AGENTS.md` surfaces: dry-run default, backup-first, idempotent, and reversible (`--remove`), proven by `tests/identity-tool.sh`.
- [x] ISC-35: `docs/pai-flow.md` contains the unified 7-phase decision table mapping each PAI phase to its gsd-core command(s), superpowers skill, and done-signal.
- [x] ISC-36: gsd-core (`open-gsd/gsd-core`) is documented as the recommended-default workflow backbone with an explicit superpowers-only fallback; `--with-gsd` remains detect-only (ISC-31 preserved).
- [x] ISC-37: `docs/parallel-dispatch.md` and `docs/multi-surface-architecture.md` are retired to redirect stubs pointing at `docs/pai-flow.md`; `package/conductor/routed-execute.sh` is removed.
- [x] ISC-38: `UPSTREAM.md` credits gsd-core with its current URL (`https://github.com/open-gsd/gsd-core`).
- [x] ISC-39: Unified task router (single classifier). Task-type classification and the command-code type→model primary live in exactly one place: `package/router/classify-task.sh` (POSIX sh). `multi-backend-router.sh` sources it (its `analyze_task_type` delegates; `ROUTING_PRIORITY`'s command-code column is derived from `model_for_type`), and `package/enrich/stages/routing.ts` execs it. No routing surface re-implements the classifier. `route-task.sh` is retired. Because `routing.ts` now execs the shared script, the enrichment runtime must be able to reach it: either a co-located `router/classify-task.sh` sibling of the installed `enrich/`, or `TEMPERANCE_ROUTER_DIR` pointing at its directory. If neither is reachable, `routing.ts` fails open to `task=balanced` (degraded, never fatal).
- [x] ISC-40: Three routing verdicts. `multi-backend-router.sh --verdict "<task>"` emits exactly one of `inline` | `external<TAB>backend<TAB>model` | `claude-subagent`, as a pure remap of `--route-only` (so they never disagree). `external` names the backend `route_only` selected — `omniroute` when its named combo is live, otherwise the first available backend in the command-code→grok→kimi direct fallback chain. `claude-subagent` is the no-external-backend case.
- [x] ISC-41: ISA frontmatter contains `project`, `task`, `effort`, `phase`, `progress`, `mode`, `started`, and `updated`; `progress` matches the checked active criteria count.
- [x] ISC-42: ISA body includes the canonical project-ledger sections for Problem, Vision, Out of Scope, Principles, Constraints, Goal, Criteria, Test Strategy, Features, Decisions, Changelog, and Verification.
- [x] ISC-43: Test Strategy contains rows for every active ISC through ISC-48, including ISC-39, ISC-40, and the workflow-hardening criteria.
- [x] ISC-44: Features maps every active ISC or ISC range, including identity, unified flow, unified router, planning-state resolver hardening, planning spine, and the full verification gate.
- [x] ISC-45: `package/enrich/resolver.test.ts` covers valid `.planning` absent and present states, empty `.planning`, and `.planning` as a file while preserving fail-open pointer-only behavior.
- [x] ISC-46: Root `.planning/` exists as the GSD execution spine and maps ratified surfaces into active or completed-reference phases while keeping pending specs/plans deferred.
- [x] ISC-47: `scripts/verify-all.sh` is the canonical full verification entrypoint and runs `./verify.sh`, `bun test package/enrich`, docs continuity, router hardening, sandbox install, identity, wire-batch, and classify checks.
- [x] ISC-48: `.github/workflows/verify.yml` delegates package verification to `scripts/verify-all.sh` and declares the runtime dependencies needed for that gate.
- [x] ISC-49: The OmniRoute review records the inspected commit SHA and source paths.
- [x] ISC-50: The design includes a source-anchored reuse, adapt, and reject matrix.
- [x] ISC-51: The integration design names `classify-task.sh` as the sole task classifier.
- [x] ISC-52: Task type enters routing only through `classify-task.sh` output.
- [x] ISC-53: Backend capability metadata participates in automatic ranking.
- [x] ISC-54: Observed backend health participates in automatic ranking.
- [x] ISC-55: Available quota or budget state participates in automatic ranking when present.
- [x] ISC-56: An explicit backend override wins over automatic ranking.
- [x] ISC-57: Automatic ranking is deterministic for identical inputs and state.
- [ ] ISC-58: An open circuit removes its backend from new automatic attempts.
- [x] ISC-59: A cooldown probe can restore an open-circuit backend.
- [x] ISC-60: External execution follows an inspectable ordered fallback list.
- [x] ISC-61: Exhausted external fallbacks resolve to the existing subagent fallback.
- [x] ISC-62: Every batch run persists its resolved dispatch plan.
- [x] ISC-63: Every task result records status, attempts, backend, and artifact pointers.
- [x] ISC-64: Dispatch emits structured attempt and fallback events.
- [x] ISC-65: Dispatch records usage or cost metadata when a backend exposes it.
- [x] ISC-66: Dry-run prints the resolved plan without executing a backend.
- [x] ISC-67: Anti: no new task-type classifier is introduced.
- [x] ISC-68: Anti: no provider credential or OmniRoute secret enters the repository.
- [x] ISC-69: Unit tests cover ranking, overrides, circuit state, fallback, and dry-run.
- [x] ISC-70: `scripts/verify-all.sh` executes the new routing-policy tests.
- [x] ISC-71: Public docs explain the OmniRoute-inspired integration boundary.
- [x] ISC-72: Missing health, quota, or cost telemetry degrades safely.
- [x] ISC-73: Existing router and batch CLI outputs remain compatible.
- [x] ISC-74: [REFINED — see Decisions 2026-07-22] OmniRoute remains optional for the base installer; direct fallback rails keep dispatch usable when its daemon is absent.
- [x] ISC-75: Independent task plans remain concurrently dispatchable.
- [x] ISC-76: A fixed-state replay produces the same ranked backend order.
- [x] ISC-77: Batch summaries remain compact and omit raw model output by default.
- [x] ISC-78: Reused OmniRoute ideas or code carry required license attribution.
- [x] ISC-79: A local OmniRoute daemon answers its OpenAI-compatible `/v1/models` endpoint.
- [x] ISC-80: Runtime model inventory comes from OmniRoute's live catalog; Temperance does not copy that catalog into its classifier.
- [x] ISC-81: OmniRoute exposes a `temperance-coding` priority combo whose configured targets each pass a direct completion probe.
- [x] ISC-82: A healthy `temperance-coding` combo ranks before direct agent backends, which remain in the frozen fallback chain.
- [x] ISC-83: OmniRoute dispatch executes through Codex's agent/tool loop rather than a raw chat-only adapter.
- [x] ISC-84: OmniRoute admin and scoped inference credentials remain outside the repository and are stored in macOS Keychain.
- [x] ISC-85: `scripts/omniroute-check.sh` performs a read-only runtime, catalog, combo, and router-boundary probe.
- [x] ISC-86: `scripts/omniroute-check.sh --live` completes a real authenticated request through `temperance-coding`.
- [x] ISC-87: Local Codex and OpenCode configuration expose the `temperance-coding` OmniRoute model without embedding its API key.
- [x] ISC-88: Public documentation explains provider onboarding, model inspection, health checks, startup, shutdown, and fallback behavior.
- [x] ISC-89: Anti: OmniRoute provider/model routing does not introduce a second task classifier.
- [x] ISC-90: OmniRoute data and package environment files containing secrets are mode `600`.
- [x] ISC-91: Router and dispatcher tests cover OmniRoute-first ordering, agentic invocation, literal prompt passage, metadata, and direct fallback preservation.
- [x] ISC-92: A repository-native TDD implementation plan exists for governed OmniRoute portfolios.
- [x] ISC-93: Every frozen routing plan contains one stable correlation identifier.
- [x] ISC-94: Every task attempt record repeats its frozen plan's correlation identifier.
- [x] ISC-95: The OmniRoute Codex adapter forwards the correlation identifier as request metadata.
- [x] ISC-96: Direct fallback attempts retain the same correlation identifier after gateway failure.
- [x] ISC-97: Every external routing candidate declares either the gateway or direct failure domain.
- [x] ISC-98: Shared task-type output resolves deterministically to a named OmniRoute portfolio.
- [x] ISC-99: A missing named portfolio degrades through the compatibility combo before direct backends.
- [x] ISC-100: Anti: unverified OmniRoute telemetry or eval output never receives enforcement authority.
- [x] ISC-101: A machine-readable readiness probe reports configured portfolio availability.
- [x] ISC-102: A machine-readable readiness probe reports telemetry and evaluation evidence state.
- [x] ISC-103: Enrichment reports the shared classifier's resolved OmniRoute portfolio without reclassifying the task.
- [x] ISC-104: The full verification entrypoint executes governed-portfolio regression tests.
- [x] ISC-105: Operator documentation distinguishes discovery routes, production portfolios, councils, and direct fallbacks.
- [x] ISC-106: Concurrent executions with identical routing inputs expose distinct request trace identifiers.
- [x] ISC-107: The local OpenCode OmniRoute provider exposes a curated set of live combo mode IDs alongside `temperance-coding`.
- [x] ISC-108: Every OpenCode combo mode ID is present in OmniRoute's live `/v1/models` catalog at verification time.
- [x] ISC-109: Operator documentation distinguishes direct OpenCode picker overrides from automatic Temperance classifier routing.
- [x] ISC-110: Anti: the OpenCode mode surface does not copy the full provider catalog or embed credentials.
- [x] ISC-111: Anti: an OpenCode OmniRoute override is denied when its model ID is absent or the live catalog cannot be read.
- [x] ISC-112: The shared enrichment stage reports the classifier's requested OmniRoute portfolio without a second classifier.
- [x] ISC-113: The automatic OpenCode model is advertised by the local relay alongside the live OmniRoute catalog.
- [x] ISC-114: An automatic OpenCode request forwards the frozen plan's task, portfolio, plan, and correlation metadata.
- [x] ISC-115: An explicit OpenCode picker model bypasses Temperance classification and reaches OmniRoute unchanged.
- [x] ISC-116: Streaming automatic requests preserve SSE chunks and `[DONE]` while carrying route headers.
- [x] ISC-117: Tool-carrying automatic requests use the verified compatibility combo until named portfolio promotion.
- [x] ISC-118: Upstream OmniRoute status codes and retry headers pass through the relay unchanged.
- [x] ISC-119: Concurrent automatic requests receive distinct request trace identifiers.
- [x] ISC-120: A user-scoped macOS LaunchAgent keeps the automatic relay available across shell sessions.
- [ ] ISC-121: A fresh OpenCode interactive session completes an automatic model request through the relay.
- [x] ISC-122: A read-only connection inventory reports every active OmniRoute connection with auth type and no secret material.
- [x] ISC-123: The connection inventory joins live catalog owners to stable Temperance capability roles without copying the full model catalog into source.
- [x] ISC-124: The inventory reports runtime health, circuit-breaker state, and observed provider success metrics in one machine-readable envelope.
- [x] ISC-125: The inventory command supports a fixture-backed JSON mode for deterministic verification without contacting upstream providers.
- [x] ISC-126: Anti: inventory and role mapping never mutate provider credentials, combos, local OpenCode configuration, or upstream state.
- [x] ISC-127: The operator report explains safe leverage lanes for agentic coding, research tools, media, and model backbones.
- [x] ISC-128: The canonical verification gate executes the connection inventory fixture test.
- [x] ISC-129: Current workstation evidence records 17 active connections, 488 unique model IDs, and 1 degraded gateway domain.
- [x] ISC-130: A dashboard-authenticated combo inventory reports every configured combo with strategy, target count, and no credential material.
- [x] ISC-131: Every new portfolio target is present in the live OmniRoute model catalog before creation.
- [x] ISC-132: Each new portfolio has at least one successful direct content probe on its primary target.
- [x] ISC-133: Tool-capable build targets return an OpenAI tool-call envelope on a native tool probe.
- [x] ISC-134: The existing `temperance-coding` compatibility combo has a Temperance description and healthy fallback targets; Temperance context remains injected by the flow boundary because the OmniRoute combo schema does not persist system messages.
- [x] ISC-135: Four new named portfolios exist: `te-fast`, `te-build`, `te-reason`, and `te-validate`.
- [x] ISC-136: Each new portfolio uses a deterministic strategy and a role-specific Temperance theme encoded in its operator-facing description.
- [x] ISC-137: Combo creation does not switch OmniRoute's active global combo or alter OpenCode configuration.
- [x] ISC-138: Dashboard readback confirms each portfolio's exact model membership and strategy.
- [x] ISC-139: New chat portfolios contain no research, crawl, embedding, audio, or media-only providers.
- [x] ISC-140: Readiness readback identifies all four created portfolios and the compatibility rail; combo metrics expose exercised priority rails while the fusion council remains covered by its native probe.
- [x] ISC-141: Repository portfolio mapping and operator documentation describe the four runtime portfolios and their promotion gates.
- [x] ISC-142: A role manifest makes GitHub the planner primary, Codex GPT-5.6 Sol Max the escalation rail, and Nebius the quota-conscious planning fallback.
- [x] ISC-143: Live probes confirm `github/gpt-5.4` and `codex/gpt-5.6-sol-max` support content and tool-call requests through their distinct OAuth connections.
- [x] ISC-144: The dispatch role manifest shards workers across Command Code, Kimi, Grok Build, and Nebius while preserving direct CLI fallbacks.
- [x] ISC-145: Snapshot-first fleet lifecycle creates `te-plan`, `te-dispatch`, and `te-creative`, preflights live targets, preserves `activeCombo=null`, and exposes rollback.
- [x] ISC-146: Creative workflow metadata keeps ElevenLabs speech and RunwayML video on native `/v1` media contracts outside coding chat fallbacks.
- [x] ISC-147: Shared creative task classification resolves to `te-creative` while role resolution remains separate from prompt classification.
- [x] ISC-148: Local OpenCode configuration exposes live `te-plan`, `te-dispatch`, and `te-creative` picker modes without embedding credentials or copying the provider catalog.
- [x] ISC-149: Full verification covers workflow resolver tests, lifecycle safety, live readiness, and the existing routing/dispatch regression suites.
- [x] ISC-150: A typed Temperance stage contract maps all seven PAI phases to current portfolio contracts, skill capabilities, MCP lanes, and logical knowledge roots without copying private bodies.
- [x] ISC-151: Typed handoffs validate stage order, status, required fields, and next-stage transitions while rejecting secret-bearing or raw-transcript payloads.
- [x] ISC-152: Knowledge discovery is read-only and pointer-only, reporting logical roots and presence without importing file contents into OmniRoute or the repository.
- [x] ISC-153: The shared enrichment core installs whenever Claude Code or Codex is explicitly enabled, while preserving an existing live tree unless refresh is requested.
- [x] ISC-154: Multi-backend wiring installs the classifier, portfolio resolver, and manifest beside enrichment so every configured surface can resolve the same routing contract.
- [x] ISC-155: The Codex UserPromptSubmit adapter invokes the shared enrichment core with `surface=codex`, emits the hook envelope, and fails open without leaking prompt bodies.
- [x] ISC-156: OpenCode keeps direct `omniroute/*` models on port `20128` and exposes automatic `temperance/temperance-auto` through a separate relay provider on port `20129`.
- [x] ISC-157: Relay configuration is backup-first, idempotent, reversible, and records a versioned sidecar without copying credentials or the live model catalog.
- [x] ISC-158: `temperance-doctor.sh` distinguishes direct readiness from automatic readiness, supports offline checks, and emits no secret material.
- [x] ISC-159: The `--with-relay` installer path provisions the macOS LaunchAgent, enables the automatic provider, and passes the live health/model/doctor probes.
- [x] ISC-160: The canonical verification gate covers relay configuration, doctor readiness, Codex enrichment, and sandbox wiring alongside existing routing and dispatch suites.
- [x] ISC-161: The shared enrichment contract recognizes `kimi` as a client surface and produces a well-formed context block for kimi inputs.
- [x] ISC-162: The relay injects server-side enrichment only for requests tagged `X-Temperance-Surface: kimi`, prepending a fresh block to the latest user message without stacking blocks or rewriting prior-turn history.
- [x] ISC-163: Relay enrichment is fail-open and latency-bounded: errors, timeouts, or missing prompts forward the request unmodified with the skip observable in the decision log and response header.
- [x] ISC-164: The relay resolves enrichment cwd from a freshness-gated, schema-validated hook sidecar and falls back to relay cwd, logging the source and an advisory prompt-hash match.
- [x] ISC-165: The Kimi UserPromptSubmit hook always exits 0 with empty stdout, writes the sidecar atomically with owner-only permissions, and appends kimi telemetry without ever blocking a prompt.
- [x] ISC-166: Kimi CLI relay enable appends exactly one marker-delimited managed provider/model block with the surface header, health-gates on relay kimi-enrichment capability, and never touches `default_model` unless explicitly requested.
- [x] ISC-167: Kimi relay disable removes everything managed and nothing else: byte-identical restore before kimi normalizes the config, semantic table/hook removal after, plus hook-copy and state-marker cleanup in both states.
- [x] ISC-168: The desktop daimon variant parameterizes the same managed-block lifecycle, records `config_sha256` for drift detection, installs its hook copy outside the app directory, and never prints config contents.
- [x] ISC-169: Temperance skills resolve in Kimi's project scope (committed `.agents/skills` relative symlinks), user scope (`~/.kimi/skills` symlinks), and the desktop daimon skills directory (real, marker-tagged managed copies, since the desktop scanner does not follow cross-volume symlinks) via backup-first, revertable wiring.
- [x] ISC-170: `temperance-doctor.sh` reports an opt-in `kimi_ready` aggregate that never affects `direct_ready` and gates the exit code only under `--require-kimi`.
- [x] ISC-171: The canonical verification gate covers kimi relay configuration, desktop configuration, hook behavior, and relay enrichment injection alongside existing suites.
- [x] ISC-172: The role manifest exposes a `writing` role — portfolio `te-write` with drafting order MiniMax-M2.7 → Kimi K2.6 → Nebius Qwen, and a nested fusion critique council `te-write-critique` with a Codex terra judge — and the resolver handles `writing` without inspecting prompt text.
- [x] ISC-173: `te-write` and `te-write-critique` appear only in `reserved_portfolios` as names; task-type mappings and the five required portfolios are unchanged, and the portfolio manifest still contains no provider or model membership.
- [x] ISC-174: A snapshot-first writer lifecycle script defaults to dry-run, refuses name collisions, preflights exactly its live catalog targets, preserves `activeCombo` null, and supports rollback; the lifecycle shell gate covers all of these guards.
- [x] ISC-175: Writing-workflow documentation maps every noesis-writer-skill phase (including transmutation mode) to its combo or client-side boundary; FAL image generation, vault source mining, and gate ledgers remain client-side, and `te-creative` is reused for image planning.
- [x] ISC-176: The ACP lane is declared-but-inactive in the manifest and docs, with the principal-bound security design named as the activation prerequisite and no agent-protocol implementation added.
- [x] ISC-177: The canonical verification gate passes with the writing-fleet resolver tests, portfolio manifest tests, and lifecycle shell assertions included.
- [x] ISC-178: The planner's github and codex slots independently substitute `kimi-coding-apikey/k3` when that slot's own live remaining quota drops below the configured threshold (default 30%), deduping to one entry when both trigger, and never substituting when kimi's own quota is also below threshold or the Nebius fallback slot itself.
- [x] ISC-179: The substitution logic is implemented identically in `scripts/omniroute-temperance-planner-quota.sh` (live OmniRoute reconciliation) and `package/router/temperance-workflows.ts`'s `resolveWorkflow("planner", ...)` (advisory CLI), the latter reading the former's cached state file so both stay consistent.
- [x] ISC-180: Because OmniRoute has no update/PATCH endpoint for an existing combo, reconciliation is snapshot-first, dry-run by default, and rollback-capable via delete-then-recreate, matching the existing role-combo lifecycle pattern; it never mutates `te-plan` when the live model order already matches the desired quota-aware order, and never changes the global `activeCombo`.
- [x] ISC-181: The canonical verification gate passes with the planner-quota reconciler's structural and functional shell assertions and the extended `temperance-workflows.test.ts` quota-substitution cases included.
- [x] ISC-182: The role manifest's `writing` block exposes `research` (fusion: DeepSeek V4 Pro, GitHub GPT-5.4, Codex terra, judge Codex terra, Albedo claim-mode classification) and `media` (priority: GitHub GPT-5.4, Codex sol-max, Nebius Qwen) sub-lanes, the resolver returns both without inspecting prompt text, and the workflow sequence runs claim-grounding before drafting.
- [x] ISC-183: `te-write-research` and `te-write-media` appear only in `reserved_portfolios` as names; the five required portfolios, all task-type mappings, and the names-only manifest property are unchanged.
- [x] ISC-184: A second snapshot-first writer lifecycle script, scoped only to the two new combos, defaults to dry-run, refuses name collisions, preflights exactly its live catalog targets, preserves `activeCombo` null, and supports rollback — split from the first writer script because `te-write`/`te-write-critique` were already live and would trip a shared collision guard.
- [x] ISC-185: Writing-workflow documentation maps the research and media phases to their combos and states the `somatic-cantincles-mobile-app` connection as branding/content lineage only — no coded alchemical or biorhythm mechanic exists in that app, and this change touches no file outside `temperance_engine`.
- [x] ISC-186: `te-write-media` is documented as a noesis-house-style brief writer distinct from `te-creative`'s generic brief; `te-creative`'s own manifest entry, tests, and docs remain unmodified.
- [x] ISC-187: The canonical verification gate passes with the expansion resolver tests, portfolio manifest tests, and lifecycle shell assertions included.

## Test Strategy

| isc | type | check | threshold | tool |
|---|---|---|---|---|
| ISC-1 | file | `install.sh` exists | present | test |
| ISC-2 | file | `verify.sh` exists | present | test |
| ISC-3 | text | rollback docs mention backups | match | grep |
| ISC-4 | text | no hard-coded local username path in scripts | zero | grep |
| ISC-5 | text | backup function exists | match | grep |
| ISC-6 | shell | script syntax passes | zero errors | sh -n |
| ISC-7 | text | docs say packs are not bundled | match | grep |
| ISC-8 | file | `docs/pai-flow.md` exists | present | test |
| ISC-9 | file | `docs/skill-clusters.md` exists | present | test |
| ISC-10 | file | `docs/peon-ping-packs.md` exists | present | test |
| ISC-11 | file | `docs/codegraph-routing.md` exists | present | test |
| ISC-12 | file | `CREDITS.md` exists | present | test |
| ISC-13 | file | `skills/temperance-engine/SKILL.md` exists | present | test |
| ISC-14 | file | `skills.sh.json` exists | present | test |
| ISC-15 | text | README references banner and skills.sh | match | grep |
| ISC-16 | text | upstream repo links are present | match | grep |
| ISC-17 | file | `assets/banner.png` exists | present | test |
| ISC-18 | file | `assets/icon.png` exists | present | test |
| ISC-19 | shell | root scripts and `scripts/*.sh` lint with declared shell | zero errors | sh/bash -n |
| ISC-20 | text | public/install surfaces contain no private local path denylist patterns | zero matches | grep |
| ISC-21 | text | `scripts/rebuild-readme.sh` uses `READMEREBUILD_PIPELINE` | match | grep |
| ISC-22 | text | `.readme-notebooklm/assets/manifest.json` uses repo-relative paths | zero private-path matches | grep |
| ISC-23 | shell | default dry-run reports Claude template and Pulse server skipped | match | install dry-run |
| ISC-24 | shell | default dry-run reports Codex template skipped | match | install dry-run |
| ISC-25 | shell | default dry-run reports OpenCode and Cursor template writes | match | install dry-run |
| ISC-26 | file | Cursor AGENTS and rules templates exist | present | test |
| ISC-27 | text | README and Cursor rule state Claude auth/model access is optional | match | grep |
| ISC-28 | file | `docs/parallel-dispatch.md` exists | present | test |
| ISC-29 | text | `docs/pai-flow.md` references `parallel-dispatch.md` | match | grep |
| ISC-30 | text | hook file never calls `exit 1` and contains no dispatch/Task invocation | zero matches | grep |
| ISC-31 | shell | default dry-run has no GSD install output; `--with-gsd` dry-run prints reference note | match | install dry-run |
| ISC-32 | text | hook contains no write/redirect (`>`, `>>`) targeting `config.json` | zero matches | grep |
| ISC-33 | shell | `sh tests/sandbox-install.sh` exits 0 with all assertions PASS | zero failures | run harness |
| ISC-34 | shell | `sh tests/identity-tool.sh` exits 0; tool has no unconditional write path and a `--remove` mode | zero failures | run test + grep |
| ISC-35 | text | `docs/pai-flow.md` has the unified 7-phase decision table | match | grep |
| ISC-36 | text | ISA.md/docs state gsd-core as recommended-default with superpowers-only fallback | match | grep |
| ISC-37 | text | retired docs are redirect stubs pointing at `pai-flow.md`; conductor script removed | match + zero matches | grep + test |
| ISC-38 | text | `UPSTREAM.md` credits `open-gsd/gsd-core` | match | grep |
| ISC-39 | shell | router and enrichment classification use `package/router/classify-task.sh` | zero disagreement | bash tests/router-hardening.sh + bash tests/classify-task.sh |
| ISC-40 | shell | `--verdict` agrees with `--route-only` across inline, external, and subagent cases | zero disagreement | bash tests/router-hardening.sh |
| ISC-41 | text | ISA frontmatter has canonical metadata and progress equals checked/total criteria | exact checked/total ratio | grep + awk |
| ISC-42 | text | ISA includes Principles and Changelog project-ledger sections | match | grep |
| ISC-43 | text | Test Strategy has rows for ISC-39..ISC-48 | match | grep |
| ISC-44 | text | Features table maps identity, unified flow, router, planning, and full verification ranges | match | grep |
| ISC-45 | unit | `.planning` absent, present, empty, and file states are explicit resolver contracts | pass | bun test package/enrich |
| ISC-46 | text | `.planning` exists, names GSD/Speckit, and gates ratified surfaces | match | bash tests/docs-continuity.sh |
| ISC-47 | shell | `scripts/verify-all.sh` runs all named hardening checks | zero failures | scripts/verify-all.sh |
| ISC-48 | yaml | GitHub Verify workflow calls `scripts/verify-all.sh` and sets up Node, Bun, and jq | match | bash tests/docs-continuity.sh |
| ISC-49 | research | review names commit SHA and exact source paths | present | grep |
| ISC-50 | design | matrix classifies each candidate as reuse, adapt, or reject | present | grep |
| ISC-51 | design | classifier authority is explicit | one named authority | grep |
| ISC-52 | unit | routing task type equals shared-classifier output | exact match | routing-policy test |
| ISC-53 | unit | capability mismatch lowers or removes a candidate | pass | routing-policy test |
| ISC-54 | unit | unhealthy backend ranks below healthy equivalent | pass | routing-policy test |
| ISC-55 | unit | exhausted quota lowers or removes a candidate | pass | routing-policy test |
| ISC-56 | unit | forced backend is selected when available | pass | routing-policy test |
| ISC-57 | unit | identical state produces byte-identical ranking | pass | routing-policy test |
| ISC-58 | unit | open circuit excludes backend | pass | circuit-breaker test |
| ISC-59 | unit | successful cooldown probe closes circuit | pass | circuit-breaker test |
| ISC-60 | CLI | resolved fallback order is printed or persisted | exact order | dry-run test |
| ISC-61 | CLI | external exhaustion returns subagent verdict | exact verdict | fallback test |
| ISC-62 | file | run directory contains resolved dispatch plan | present | batch integration test |
| ISC-63 | schema | result envelope contains required fields | schema match | batch integration test |
| ISC-64 | log | attempt and fallback event types are emitted | match | event test |
| ISC-65 | schema | optional usage/cost fields survive result normalization | pass | schema test |
| ISC-66 | CLI | dry-run performs zero backend processes | zero executions | dry-run test |
| ISC-67 | text | classifier implementations outside shared script | zero | grep + router-hardening test |
| ISC-68 | security | OmniRoute credentials or secret literals enter repository | zero | gitleaks + grep |
| ISC-69 | test | named routing-policy scenarios pass | zero failures | unit test command |
| ISC-70 | shell | full gate invokes routing-policy tests | match | verify-all test |
| ISC-71 | docs | integration boundary and provenance are documented | present | docs continuity test |
| ISC-72 | unit | absent telemetry returns a valid ranked plan | pass | routing-policy test |
| ISC-73 | regression | existing router and batch test fixtures pass unchanged | zero failures | existing tests |
| ISC-74 | dependency | OmniRoute package, process, or port is required | zero | package and install scan |
| ISC-75 | integration | two independent tasks overlap in execution time | overlap observed | batch concurrency test |
| ISC-76 | unit | fixed-state ranking replay is identical | byte-identical | routing-policy test |
| ISC-77 | integration | summary excludes raw output and stays within size limit | pass | batch summary test |
| ISC-78 | legal | provenance file names OmniRoute and applicable license | present | grep |
| ISC-79 | HTTP | `GET /v1/models` returns a model array | HTTP 200 | curl + jq |
| ISC-80 | architecture | classifier contains no copied OmniRoute provider catalog | zero catalog duplication | grep + review |
| ISC-81 | integration | named combo and its direct targets complete probes | exact responses | curl |
| ISC-82 | unit | gateway precedes direct backends in frozen order | exact order | router-hardening test |
| ISC-83 | unit | dispatcher invokes Codex for `omniroute` backend | mocked agent succeeds | dispatch test |
| ISC-84 | security | repository scan plus Keychain lookup | no secret literals + entries present | grep + security |
| ISC-85 | shell | default runtime check exits zero without completion | pass | omniroute-check |
| ISC-86 | integration | live runtime check returns expected content | pass | omniroute-check --live |
| ISC-87 | config | Codex profile and OpenCode model resolve | exact model | file + CLI |
| ISC-88 | docs | runtime operations and provider onboarding documented | present | docs continuity |
| ISC-89 | architecture | task classification still enters only via shared script | one classifier | router tests |
| ISC-90 | permissions | secret-bearing OmniRoute environment files | mode 600 | stat |
| ISC-91 | regression | OmniRoute router/dispatcher assertions plus full fallbacks | zero failures | shell tests |
| ISC-92 | file | governed-portfolio implementation plan exists | present | test |
| ISC-93 | schema | frozen plan contains stable correlation identifier | exact match | unit test |
| ISC-94 | schema | every attempt repeats its plan correlation identifier | exact match | dispatch test |
| ISC-95 | unit | Codex provider receives correlation request header | exact argument | mocked Codex |
| ISC-96 | integration | gateway and direct attempts share correlation identifier | exact match | fallback test |
| ISC-97 | schema | every external candidate names gateway or direct domain | enum match | routing tests |
| ISC-98 | unit | task type resolves to expected named portfolio | exact mapping | portfolio test |
| ISC-99 | integration | absent portfolio selects compatibility then direct chain | exact order | router test |
| ISC-100 | safety | enforcement without valid evidence receipt | zero | promotion test |
| ISC-101 | CLI | readiness JSON lists configured portfolio availability | schema match | checker test |
| ISC-102 | CLI | readiness JSON lists telemetry and eval evidence state | schema match | checker test |
| ISC-103 | unit | enrichment task and portfolio share classifier output | exact match | enrichment test |
| ISC-104 | shell | canonical gate invokes governed-portfolio tests | match | verify-all test |
| ISC-105 | docs | portfolio roles and fallback boundaries documented | present | docs continuity |
| ISC-106 | integration | identical plans dispatched concurrently receive distinct execution traces | unique identifiers | dispatch test |
| ISC-107 | config | OpenCode provider lists the curated OmniRoute mode IDs | exact keys | jq + opencode models |
| ISC-108 | HTTP | every configured combo ID appears in `/v1/models` | zero missing | curl + jq |
| ISC-109 | docs | picker override and classifier routing boundary is explicit | present | grep + read |
| ISC-110 | security | mode surface contains no catalog dump or credential literal | zero violations | grep + jq |
| ISC-111 | unit | stale or unavailable OmniRoute catalog fails closed before request dispatch | zero silent fallbacks | Bun test |
| ISC-112 | unit | enrichment includes resolver portfolio intent | exact `portfolio=te-*` line | Bun test |
| ISC-113 | HTTP | relay model catalog includes automatic alias and live IDs | HTTP 200 + IDs | curl + jq |
| ISC-114 | HTTP | automatic request response includes frozen route headers | header set | curl |
| ISC-115 | unit | direct picker model is forwarded without plan execution | exact body | Bun test |
| ISC-116 | unit | streaming relay preserves SSE bytes | `[DONE]` present | Bun test |
| ISC-117 | unit | tools force compatibility route | exact model | Bun test |
| ISC-118 | unit | upstream error status and retry header survive | exact status/header | Bun test |
| ISC-119 | unit | concurrent automatic decisions have unique request IDs | all unique | Bun test |
| ISC-120 | macOS | LaunchAgent is loaded and health endpoint responds | running + HTTP 200 | launchctl + curl |
| ISC-121 | integration | OpenCode auto model completes a fresh session | assistant response | OpenCode CLI |
| ISC-122 | CLI | inventory lists active provider connection metadata | count + redacted fields | connection report |
| ISC-123 | schema | catalog owners map to capability roles without model dump | role map + no full IDs | connection report |
| ISC-124 | schema | health, breaker, and metrics sections coexist | keys + counts | connection report |
| ISC-125 | fixture | fixture mode produces deterministic JSON without network | exact fixture values | connection report test |
| ISC-126 | safety | inventory command has no mutating HTTP or credential writes | zero writes | shell inspection |
| ISC-127 | docs | report explains four leverage lanes and guardrails | present | docs continuity |
| ISC-128 | shell | verify-all invokes fixture inventory test | match + pass | verify-all |
| ISC-129 | live | workstation snapshot matches active connection and catalog probes | 17 / 488 / 1 | health + curl |
| ISC-130 | API | authenticated combo inventory is redacted and complete | configured list + no secrets | dashboard API |
| ISC-131 | catalog | every new target exists in `/v1/models` | zero missing targets | curl + jq |
| ISC-132 | probe | primary target returns non-empty completion | HTTP 200 + content | chat completion |
| ISC-133 | probe | build target emits tool call | HTTP 200 + `tool_calls` | chat completion |
| ISC-134 | API | compatibility combo reads back description and healthy targets | exact fields | dashboard API |
| ISC-135 | API | four named portfolios exist | four names | dashboard API |
| ISC-136 | schema | strategies and descriptions are role-specific | exact strategy/description | dashboard API |
| ISC-137 | safety | active combo and OpenCode config remain unchanged | active null + diff clean | API + readback |
| ISC-138 | API | runtime memberships match manifest | exact target arrays | dashboard API |
| ISC-139 | safety | portfolio targets are chat-capable providers only | zero excluded lanes | catalog + role map |
| ISC-140 | metrics | readiness lists all portfolios; metrics expose exercised priority rails and compatibility | present | readiness + combo metrics |
| ISC-141 | docs | mapping and promotion gates explain all four portfolios | present | docs continuity |
| ISC-142 | design | planner role has GitHub primary, Codex escalation, Nebius fallback | exact manifest | workflow resolver test |
| ISC-143 | integration | planner targets pass content and tool probes | HTTP 200 + tool call | authenticated gateway probes |
| ISC-144 | design | dispatch role includes Command Code, Kimi, Grok, and Nebius | all four present | workflow resolver test |
| ISC-145 | integration | role combo lifecycle snapshots, preflights, preserves active combo, and rolls back | pass | fleet lifecycle script |
| ISC-146 | safety | creative media providers use native endpoints outside chat fallbacks | endpoint boundary present | workflow manifest + docs |
| ISC-147 | architecture | creative classification maps to te-creative without a second classifier | exact mapping | portfolio unit test |
| ISC-148 | config | OpenCode exposes only live role IDs without credentials | JSON + live IDs | OpenCode CLI probe |
| ISC-149 | regression | workflow and existing routing/dispatch gates pass | zero failures | verify-all |
| ISC-150 | schema | seven stage profiles resolve portfolios, skills, MCP lanes, and knowledge pointers | exact stage order + catalog diff | Bun test |
| ISC-151 | safety | malformed, invalid-transition, or secret-bearing handoffs are rejected | zero unsafe handoffs | Bun test |
| ISC-152 | safety | knowledge resolver emits logical roots only and never file bodies | pointer schema + no bodies | Bun test + CLI |
| ISC-153 | installer | Claude or Codex opt-in installs shared enrichment with backup/refresh semantics | present + preserved | install-pai + sandbox |
| ISC-154 | wiring | shared classifier and portfolio resolver are co-located for all configured surfaces | symlinks present | wire-multi-backend |
| ISC-155 | hook | Codex adapter emits the shared contract and fails open | valid envelope | hook smoke + source test |
| ISC-156 | config | direct and automatic OpenCode providers remain on separate ports and namespaces | exact URLs/models | jq + doctor |
| ISC-157 | lifecycle | relay enable/disable backs up config and writes/removes the sidecar | clean round trip | relay config test |
| ISC-158 | diagnostics | doctor reports direct/automatic readiness without secrets | schema + redaction | doctor test |
| ISC-159 | macOS | LaunchAgent relay and automatic provider pass live probes | HTTP 200 + alias | launchd + curl + doctor |
| ISC-160 | regression | full verification invokes the new relay, doctor, and wiring tests | zero failures | verify-all |
| ISC-161 | schema | enrich accepts surface=kimi and emits a well-formed block | wrapper + classify line | Bun test |
| ISC-162 | safety | injection fires only on the kimi surface header, latest user message only, replace-not-stack | header gate + byte-identical history | Bun test |
| ISC-163 | resilience | enrichment error/timeout forwards unmodified with observable skip | fail-open + logged outcome | Bun test |
| ISC-164 | context | sidecar cwd honored when fresh/valid, relay cwd otherwise | freshness + schema gates | Bun test |
| ISC-165 | hook | kimi hook exits 0 with empty stdout across malformed/unwritable paths | never blocks | hook sandbox test |
| ISC-166 | lifecycle | CLI enable appends one managed block, health-gated, default_model untouched | single block + comments intact | kimi relay config test |
| ISC-167 | lifecycle | disable restores config byte-identical and removes hook + state | cmp round trip | kimi relay config test |
| ISC-168 | lifecycle | desktop variant records config_sha256 and leaks no config contents | sha match + no-secret output | kimi desktop config test |
| ISC-169 | wiring | skills resolve at project/user (symlinks) and desktop (managed copies) scopes with revert | links/copies resolve + revert clean + foreign content protected | wire test + doctor |
| ISC-170 | diagnostics | kimi_ready is opt-in and never affects direct_ready | exit-code semantics | doctor test |
| ISC-171 | regression | full verification covers kimi config, hook, and enrichment suites | zero failures | verify-all |
| ISC-172 | schema | resolve writing returns te-write drafting order plus critique council with terra judge | exact order + judge | Bun test |
| ISC-173 | manifest | writing names live only in reserved_portfolios; required set and mappings unchanged | names-only regex + jq index | Bun test + shell gate |
| ISC-174 | lifecycle | writer script dry-run default, collision refusal, catalog preflight, activeCombo guard, rollback | all guards greppable + bash -n | combos shell gate |
| ISC-175 | docs | noesis-writer-routing maps phases and keeps FAL/vault/ledgers client-side | client-side + FAL greps | combos shell gate |
| ISC-176 | boundary | acp lane is declared-inactive with principal-bound prerequisite | status + note match | Bun test |
| ISC-177 | regression | full verification includes writing-fleet suites | zero failures | verify-all |
| ISC-178 | routing | github/codex slots independently substitute kimi-k3 below threshold, dedupe on both, never on kimi-low or the Nebius slot | exact model order + substitutions list | Bun test |
| ISC-179 | consistency | reconciler and advisory CLI implement identical substitution logic via a shared cache file | identical output given identical quota input | Bun test + shell test |
| ISC-180 | lifecycle | te-plan reconciliation is snapshot-first, dry-run default, rollback-capable, no-op when already correct | zero unintended mutations | shell test + live dry-run |
| ISC-181 | regression | full verification includes the planner-quota reconciler and extended workflow tests | zero failures | verify-all |
| ISC-182 | schema | resolve writing returns te-write-research fusion panel/judge and te-write-media priority panel; research precedes drafting | exact panels + workflow order | Bun test |
| ISC-183 | manifest | research/media names live only in reserved_portfolios; required set and mappings unchanged | names-only regex + jq index | Bun test + shell gate |
| ISC-184 | lifecycle | expansion writer script dry-run default, collision refusal, catalog preflight, activeCombo guard, rollback | all guards greppable + bash -n | combos shell gate |
| ISC-185 | docs | routing doc maps research/media phases and frames Somatic Canticles link as narrative-only | narrative + Somatic Canticles greps | combos shell gate |
| ISC-186 | boundary | te-write-media documented distinct from te-creative; te-creative manifest/tests untouched | diff shows te-creative block unchanged | git diff review |
| ISC-187 | regression | full verification includes the writer-expansion suites | zero failures | verify-all |

## Features

| name | satisfies | depends_on | parallelizable |
|---|---|---|---|
| Installer scripts | ISC-1..ISC-7 | none | no |
| Documentation | ISC-8..ISC-12 | none | yes |
| Verification script | all | installer docs | no |
| Public path hygiene | ISC-20..ISC-22 | README assets | yes |
| OpenCode/Cursor defaults | ISC-23..ISC-27 | installer templates | yes |
| Parallel-dispatch guidance (superseded by ISC-35/37 — folded into pai-flow.md) | ISC-28..ISC-31 | PAI flow docs, install.sh flags | yes |
| Single preference store | ISC-32 | parallel-dispatch guidance | no |
| Layering test harness | ISC-33 | installer scripts | no |
| Identity port tool | ISC-34 | operator AGENTS.md surfaces | no |
| Unified PAI/GSD workflow table | ISC-35..ISC-38 | PAI flow docs | yes |
| Unified router invariants | ISC-39..ISC-40 | router scripts, enrichment stage | no |
| ISA normalization ledger | ISC-41..ISC-44 | ISA criteria and sections | no |
| Planning-state resolver hardening | ISC-45 | package/enrich resolver | yes |
| GSD planning spine | ISC-46 | ISA, specs, plans | yes |
| Full verification gate | ISC-47..ISC-48 | existing test harnesses, CI | no |
| OmniRoute source review and boundary design | ISC-49..ISC-51, ISC-71, ISC-74, ISC-78 | upstream source, current architecture | yes |
| Adaptive routing policy | ISC-52..ISC-57, ISC-72, ISC-76 | unified classifier, backend observations | no |
| Circuit breaker and ordered fallback | ISC-58..ISC-61 | adaptive routing policy | no |
| Dispatch plan and result envelope | ISC-62..ISC-66, ISC-77 | batch runner | yes |
| Regression and full-gate coverage | ISC-67..ISC-70, ISC-73, ISC-75 | routing and batch implementation | no |
| Live OmniRoute agent gateway | ISC-79..ISC-91 | local OmniRoute runtime, Codex adapter, existing classifier and fallback rails | no |
| Correlated failure-domain receipts | ISC-93..ISC-97 | frozen routing plan, dispatcher, Codex adapter | no |
| Unique execution trace layer | ISC-106 | deterministic plan lineage, dispatcher task identity | no |
| Governed OmniRoute portfolio resolver | ISC-98..ISC-100 | shared task classifier, live model catalog | no |
| Portfolio evidence and operator surfaces | ISC-92, ISC-101..ISC-105 | OmniRoute CLI/API, enrichment, canonical verification | no |
| OpenCode OmniRoute mode surface | ISC-107..ISC-110 | live combo catalog, local OpenCode config, runtime docs | no |
| OpenCode request-time catalog guard | ISC-111 | OpenCode plugin API, live `/v1/models` endpoint | no |
| OpenCode Temperance flow bridge | ISC-112..ISC-119 | shared enrichment, frozen router, local OpenAI relay | no |
| Local proxy lifecycle | ISC-120..ISC-121 | macOS LaunchAgent, OpenCode runtime | no |
| Connection inventory and leverage map | ISC-122..ISC-129 | OmniRoute CLI/API, live catalog, role map, fixture test | yes |
| Temperance combo synthesis | ISC-130..ISC-141 | dashboard combo API, live catalog, native probes, portfolio manifest | no |
| Planner, dispatch, and creative workflow roles | ISC-142..ISC-149 | role manifest, live gateway probes, native media contracts, fleet lifecycle, OpenCode picker | no |
| PAI capability fabric and typed stage handoffs | ISC-150..ISC-152 | stage contract, client-owned capability resolution, pointer-only knowledge roots, handoff validator | yes |
| Claude/Codex shared enrichment wiring | ISC-153..ISC-155 | shared enrichment core, surface adapters, router companion files | no |
| Separate OpenCode automatic relay provider | ISC-156..ISC-159 | local OpenAI-compatible relay, managed provider config, LaunchAgent lifecycle, readiness doctor | no |
| Multi-surface integration verification | ISC-160 | sandbox, relay configuration, doctor, hook, routing, and dispatch regression suites | no |
| Kimi surface wiring (CLI + desktop daimon) | ISC-161..ISC-168 | shared enrichment core, relay injection seam, TOML managed-block lifecycle, hook sidecar | no |
| Kimi skills discoverability | ISC-169 | repo skills, wire-multi-backend, kimi skill scopes | yes |
| Kimi diagnostics and verification | ISC-170..ISC-171 | readiness doctor, canonical verification gate, sandbox tests | no |
| Noesis writing fleet (drafting rail + critique council) | ISC-172..ISC-177 | role manifest, writer lifecycle script, portfolio manifest, capability fabric and routing docs | no |
| Weekly-quota-aware planner substitution | ISC-178..ISC-181 | live OmniRoute quota poll, planner reconciler script, workflows.ts resolver, fleet docs | no |
| Writing fleet expansion (research + media sub-lanes) | ISC-182..ISC-187 | role manifest, second writer lifecycle script, portfolio manifest, capability fabric and routing docs | no |

## Architecture

<!-- arch-assets:start -->

_Auto-maintained by `ArchitectureAssetsSync.hook.ts` on release events._  
_Last refreshed: 2026-06-22T01:11:11.274Z_

| Asset | Status | How it's generated |
|---|---|---|
| [`docs/architecture/SERVICES.md`](docs/architecture/SERVICES.md) | ✅ current | auto (file scan) |
| [`docs/architecture/DEPENDENCY-GRAPH.md`](docs/architecture/DEPENDENCY-GRAPH.md) | ✅ current | auto (file scan) |
| [`docs/architecture/architecture.html`](docs/architecture/architecture.html) | ✅ current (generated 2026-07-01) | manual (LLM skill) |
| [`docs/architecture/system-internals.html`](docs/architecture/system-internals.html) | ✅ current (generated 2026-07-01) | manual (LLM skill) |
| [`docs/architecture/integration-map.html`](docs/architecture/integration-map.html) | ✅ current (generated 2026-07-01) | manual (LLM skill) |
| [`docs/architecture/session-trace.html`](docs/architecture/session-trace.html) | ✅ current (generated 2026-07-01) | manual (LLM skill) |
| [`docs/architecture/notebooklm-prompt.md`](docs/architecture/notebooklm-prompt.md) | ⬜ not yet generated | manual (LLM skill) |

**To refresh LLM-generated assets:** invoke `/refresh-architecture` in any Claude Code session.

<!-- arch-assets:end -->

## Decisions

- Use a public repo that references voice assets instead of bundling them.
- 2026-07-22 14:00: Preserve the verified prior OmniRoute integration at commit `1f37185` before new writes; serialize Tasks 1–3 in the shared tree and relax the E3 delegation floor because the active higher-priority instruction forbids unrequested subagents.
- 2026-07-22 14:15: refined: Treat `correlation_id` as deterministic frozen-plan lineage; add a distinct per-execution trace identifier before OmniRoute telemetry is trusted for request-level joins, while Task 4 must reconcile every named portfolio against the live catalog before selection.
- Keep the first installer Mac-friendly but not Mac-required.
- Generalize paths through `$HOME` and override variables.
- Treat skills.sh readiness as a skill-card plus metadata layer, not a separate installer fork.
- Link only upstream GitHub repositories verified through `gh repo view`; leave CodeGraph as a referenced local CLI without inventing an unverified repo URL.
- 2026-06-15: Preserve Bash for Bash-declared maintenance scripts and make verification interpreter-aware instead of forcing every `.sh` file through POSIX `sh`.
- 2026-06-15: Treat generated README/NotebookLM metadata as public surface; store repo-relative paths and configurable commands rather than local machine provenance.
- 2026-06-15: Make the public installer OpenCode/Cursor-first. Claude, Codex, Pulse compatibility, Claude auth, and model-specific advisor paths are optional rather than required gates.
- 2026-07-01: Record parallel-dispatch strategy as ISA-tracked decisions (ISC-28..ISC-31) rather than a new config file; GSD stays an opt-in thin reference (`--with-gsd`, default OFF) never vendored, and the shipped hook is advisory-only with no auto-triggered dispatch.
- 2026-07-01: Decide Temperance Engine owns exactly one preference store, `ISA.md`. GSD config and PAI steering/memory remain fully external and out of scope; no separate precedence doc. The only cross-system touch is the hook's read-only `config.json` display read, enforced structurally (no write path exists in the script) rather than documented in prose.
- 2026-07-01: Port the runtime identity to live operator surfaces as an attached, reversible `<!-- temperance:identity -->` block (live-is-truth), never a content replacement; prove the installer layering first with an isolated sandbox harness that pins the Pulse port and cannot touch the real home directory.
- 2026-07-09: Promote product-engineering workflow hardening into repo-native state: `.planning` is the GSD execution spine, Speckit-style specs/plans remain design inputs, `ISA.md` remains the acceptance ledger, and only ratified surfaces become active phases.
- 2026-07-18: Pin the command-code type→model primaries in `package/router/classify-task.sh` (`model_for_type`) to the account's credit deals so parallel dispatch spends discounted/free tokens: `fast`+`validation` → `tencent/Hy3` (FREE), `long-horizon` → `xiaomi/mimo-v2.5-pro` (5×, permanent), `reasoning` → `deepseek/deepseek-v4-pro` (4×, permanent), `creative`+`balanced` → `MiniMaxAI/MiniMax-M3` (2.67×). Permanent deals hold the durable coding/reasoning slots; the two Jul-21-expiring deals (`Hy3`, `MiniMax-M3`) hold high-volume slots. **Revert the four expiring-deal slots on/after 2026-07-21** back to durable models. `package/router/task-model-router.ts` — a dead, no-consumer re-implementation of the classifier + a stale MODEL_CATALOG — was deleted 2026-07-18 so ISC-39's one-classifier doctrine holds literally.
- 2026-07-21: refined: Treat OmniRoute as a pattern library, not a replacement gateway. Temperance keeps one classifier and ISA while adapting health-aware ranking, circuit breaking, explainable fallback, and attempt telemetry into its existing router/batch boundary.
- 2026-07-21 15:03: The integration seam is between shared classification and existing batch execution. Preserve the current dispatcher, add a deterministic policy that reorders its candidate chain from capability and observation signals, and fail open to the current static order when policy state is absent or invalid.
- 2026-07-21 15:03: Risks: concurrent health-state writes, stale quota/cost observations, unstable score ties, and accidental conversion of observations into a second preference store must each have explicit tests or structural guards before implementation is accepted.
- 2026-07-21 15:21: User approved Option A. Replace the existing scaffold's static route-selection layer with a local deterministic shadow policy, frozen dispatch plans, backend observations, and circuit state; retain the unified classifier, parallel dispatcher, concurrency limits, worktree isolation, fail-open semantics, and result artifacts. OmniRoute remains an attributed design source, never a required runtime daemon.
- 2026-07-21: Keep production in shadow mode and leave ISC-58 open until observation evidence justifies enforcement. The enforce-mode exclusion, cooldown probe lease, and kill switch are implemented and tested, but open circuits do not suppress the existing static route while shadow mode is authoritative.
- 2026-07-22 12:54: refined: User explicitly expanded the boundary from OmniRoute-inspired local policy to an actual local OmniRoute runtime. Temperance remains the sole task classifier; OmniRoute becomes the preferred provider/model gateway; Codex supplies the agentic tool loop; command-code, grok, and kimi remain direct outage fallbacks.
- 2026-07-22 12:54: Store the generated OmniRoute dashboard password and scoped Temperance inference key in macOS Keychain, keep runtime data under `~/.omniroute`, and never place either secret in repository configuration or model arguments.
- 2026-07-23: refined: Treat the newly authenticated OmniRoute connections as four capability lanes—agentic model execution, research/tool services, media generation, and model backbones. Temperance can safely inventory and explain these lanes without copying provider credentials or the volatile full catalog; routing policy remains the authority for task selection.
- 2026-07-23: refined: Translate the Temperance synthesis into four named chat portfolios—speed, building, deliberation, and validation—while keeping research/media connections outside chat combos and leaving promotion in shadow mode until evidence receipts exist.
- 2026-07-23: corrected: The expired Hy3 and MiniMax-M3 command-code deals were retired from the shared classifier; fast/validation now use live-verified DeepSeek V4 Flash and creative/balanced use live-verified MiniMax M2.7 until a new bounded deal is recorded.
- 2026-07-22 12:54: Use a named `temperance-coding` priority combo instead of OmniRoute's generic auto/free aliases because live probes showed those aliases could select an inactive Auggie subscription; configure only targets that passed direct authenticated probes.
- 2026-07-22: refined: The single OpenCode OmniRoute option entered at the provider configuration boundary, where the `models` map declared only `temperance-coding`; expose a curated live combo set as explicit picker overrides while preserving `temperance-coding` as the governed default.
- 2026-07-22: Root-cause checkpoint: fixing the OpenCode provider `models` map removes the missing-options symptom at ingestion; adding modes inside the router would create a second UI-specific classifier, so the router remains unchanged and user-selected picker models are treated as explicit overrides.
- 2026-07-23: refined: The picker expansion solved catalog presentation but left OpenCode chat requests outside the Temperance execution spine. The missing seam entered at the provider URL, before `classify-task.sh` and frozen-plan creation.
- 2026-07-23: Adopt a narrow local OpenAI-compatible relay for `temperance-auto`; OpenCode enrichment remains synthetic context, the shared router remains the sole classifier, and all explicit picker models bypass classification.
- 2026-07-23: refined: Treat GitHub and Codex as distinct planner entitlements. `github/gpt-5.4` is the default planning rail; `codex/gpt-5.6-sol-max` is an OAuth-backed escalation route; neither model name is assumed portable to `command-code` or a direct OpenAI API key.
- 2026-07-23: refined: Add a role layer after classification rather than a second classifier. `te-plan` protects planning, `te-dispatch` shards independent work across Command Code/Kimi/Grok/Nebius, and `te-creative` plans native media calls without placing ElevenLabs/Runway payloads in chat fallbacks.
- 2026-07-23: refined: Keep PAI skills, MCP execution, and knowledge retrieval client-owned; add a typed seven-stage capability packet and pointer-only knowledge resolver so OmniRoute can route the selected portfolio without becoming a skill runner, MCP broker, or memory store.
- 2026-07-23: refined: Make Claude Code, the Codex app, and OpenCode the primary local surfaces; share one fail-open enrichment core, preserve direct OmniRoute picker routes, and add a separately managed automatic relay provider.
- 2026-07-23: refined: Treat relay configuration as an owned, reversible surface with backups and a sidecar marker; expose direct versus automatic readiness through a secret-free doctor command.

## Changelog

- 2026-07-09: Normalized ISA frontmatter, added Principles and Changelog sections, and extended criteria through ISC-48 for product-engineering workflow hardening.
- 2026-07-09: Added `.planning` as a ratified GSD execution map, not a second preference store.
- 2026-07-09: Added `scripts/verify-all.sh` and delegated CI package verification to that full gate.
- 2026-07-18: Repointed the dispatch type→model primaries to the account's command-code credit deals (Hy3/MiMo-V2.5-Pro/DeepSeek-V4-Pro/MiniMax-M3); updated `multi-backend-router.sh` MODEL_CATALOG metadata and the `tests/classify-task.sh` + `routing.test.ts` expectations to match.
- 2026-07-18: Deleted dead `package/router/task-model-router.ts` (no importers; re-implemented the classifier against ISC-39 and carried a now-stale model catalog).
- 2026-07-21: Replaced static backend selection with an OmniRoute-inspired local policy seam, frozen per-task plans, atomic backend observations, half-open probe leases, structured attempt/usage/cost evidence, and source/license documentation. The unified classifier and parallel/worktree dispatcher remain authoritative.
- 2026-07-22 | conjectured: OmniRoute could remain a design-only influence while Temperance's local model catalog stayed authoritative.
  refuted by: The user approved replacing that scaffold, and the initialized runtime exposed 100 live catalog routes plus a working authenticated combo.
  learned: Task classification and provider/model routing are separate responsibilities; Temperance should own the former while OmniRoute owns the latter behind a tool-capable Codex client.
  criterion now: ISC-74 was refined and ISC-79 through ISC-91 require the live runtime, secure credentials, dynamic catalog, agentic gateway, documentation, and regression probes.

- 2026-07-22 | conjectured: a deterministic plan correlation identifier could also serve as a unique downstream request trace
  refuted by: the final Advisor showed concurrent executions with identical routing inputs can deliberately share replay lineage
  learned: deterministic plan identity and unique execution tracing require separate fields before telemetry joins become authoritative
  criterion now: ISC-106 requires distinct request traces for concurrent executions with identical routing inputs

- 2026-07-22 | conjectured: a healthy live catalog could stand in for OmniRoute portfolio readiness
  refuted by: the readiness probe found compatibility present but all named portfolios absent, telemetry without eval evidence, and no promotion receipt
  learned: runtime health, catalog membership, telemetry, and eval evidence are separate machine-readable gates that must fail closed independently
  criterion now: ISC-101 and ISC-102 require versioned readiness evidence while enforcement remains false

- 2026-07-22 | conjectured: a local promotion receipt could authorize a named portfolio once its JSON fields looked valid
  refuted by: Advisor review required an external trust anchor, runtime/policy binding, replay protection, and the live workstation had no signing key, named portfolio, or evaluation evidence
  learned: promotion must be authorized only by a signed, bounded receipt and must preserve compatibility routing when any trust or evidence input is absent
  criterion now: Task 6 promotion validation requires HMAC authenticity, manifest/evidence thresholds, expiry, nonce, runtime binding, and an explicit compatibility fallback

- 2026-07-22 | conjectured: OpenCode's single OmniRoute option meant the connected runtime exposed only one usable mode
  refuted by: the live `/v1/models` catalog contained 37 combo aliases, while the local OpenCode `models` map declared only `temperance-coding`
  learned: OmniRoute discovery and OpenCode presentation are separate surfaces; expose a curated, live-verified picker set while keeping automatic task classification and governed routing authoritative
  criterion now: ISC-107 through ISC-110 require curated live IDs, explicit override documentation, and no catalog or credential duplication

- 2026-07-22 | conjectured: validating picker IDs once during configuration was sufficient to keep explicit OmniRoute overrides safe
  refuted by: Advisor review identified catalog drift and OmniRoute's silent unknown-model fallback as a request-time risk
  learned: explicit picker overrides need a request-time live-catalog guard that denies stale IDs and unavailable catalog reads
  criterion now: ISC-111 requires the OpenCode catalog guard to fail closed before an OmniRoute request is sent

- 2026-07-23 | conjectured: exposing curated OmniRoute modes was equivalent to integrating OmniRoute into the Temperance flow
  refuted by: OpenCode's provider request path bypassed `classify-task.sh`, the frozen plan, and the enrichment pipeline even though the picker listed live modes
  learned: presentation, context enrichment, and request-time model scheduling are separate seams; the last seam needs a local proxy because OpenCode plugins cannot replace `input.model`
  criterion now: ISC-112 through ISC-121 track enrichment, automatic relay routing, direct overrides, transport fidelity, lifecycle, and the remaining fresh-session probe

- 2026-07-23 | conjectured: `gpt-5.6-sol-max` should be portable across every connected provider because the name appears in the catalog
  refuted by: `codex/gpt-5.6-sol-max` returned HTTP 200 while `command-code/gpt-5.6-sol-max` returned a provider-model recognition error and `command-code/gpt-5.6-sol` returned `PREMIUM_CREDITS_EXHAUSTED`
  learned: model IDs are provider- and entitlement-scoped; route metadata, quota, capability, and API billing must be evaluated independently
  criterion now: ISC-142 through ISC-149 require role-aware planning, fleet dispatch, native creative boundaries, live role combos, and explicit model limitations

- 2026-07-23 | conjectured: every newly authenticated connection should become another Temperance task classifier route
  refuted by: the live inventory separates agentic model providers from search, crawl, embedding, audio, and media services, while OmniRoute health reports only two monitored gateway domains
  learned: connections are capability inputs, not interchangeable model routes; expose a redacted inventory and role map first, then promote only evidence-backed provider pools into named portfolios
  criterion now: ISC-122 through ISC-129 require connection inventory, capability-role mapping, health/metric evidence, fixture safety, leverage guidance, and a current workstation snapshot

- 2026-07-23 | conjectured: adding combo aliases to the picker would be enough to express Temperance philosophy
  refuted by: the first build probe exposed tool-only responses rejected by `minContentLength=1`, the old compatibility rail failed through an empty provider and exhausted account, and expired direct classifier deals remained pinned
  learned: portfolio themes belong in operator-facing descriptions and the Temperance context boundary, tool-capable rails must allow empty text with tool calls, and live target evidence plus reversible rollback must precede promotion
  criterion now: ISC-130 through ISC-141 record authenticated lifecycle, native probes, schema limits, shadow diffs, compatibility repair, expired-pin retirement, and docs/readiness evidence

- 2026-07-23 | conjectured: importing PAI skills and knowledge directly into OmniRoute would make stage execution complete
  refuted by: OmniRoute routes model requests but does not own local MCP authority, skill invocation, or private memory policy
  learned: a typed capability packet plus path-only knowledge pointers preserves stage ownership, auditability, and privacy while the client performs the tool loop
  criterion now: ISC-150 through ISC-152 require seven-stage mapping, safe handoff validation, and pointer-only knowledge discovery

- 2026-07-23 | conjectured: Kimi could reuse the Claude/Codex prompt-hook pattern to inject enrichment client-side
  refuted by: kimi-cli's hook runner (verified on 1.47.0 and 1.49.0 after repairing the broken uv venv) parses UserPromptSubmit stdout only for a permissionDecision — additionalContext is never injected
  learned: when a host cannot inject context client-side, the relay is the enrichment seam; the client half reduces to a cwd sidecar plus telemetry, and the provider's static custom_headers carry the surface tag
  criterion now: ISC-161 through ISC-171 require the kimi surface contract, header-gated relay injection, fail-open sidecar resolution, marker-delimited TOML lifecycle for both Kimi installs, skill discoverability across scopes, and opt-in doctor readiness

- 2026-07-23 | conjectured: a marker-delimited managed block would survive in kimi's config the way it does in AGENTS.md surfaces
  refuted by: the first live kimi run rewrote config.toml in its canonical serialization — the temperance tables survived semantically but every comment, including the managed-block markers, was dropped
  learned: kimi treats config.toml as a database, not a user file; managed-config lifecycles need a semantic identity anchor (the state marker plus table headers), with marker-based byte-identical restore only as the pre-normalization fast path
  criterion now: ISC-166/ISC-167 cover both states (marker and normalized), the doctor's provider check is semantic, and the deployed relay layout mirrors package/ so the proxy's static enrich import resolves

- 2026-07-23 | conjectured: `kimi/kimi-k2.6` was a valid drafting fallback ID for the te-write priority rail
  refuted by: the writer script's live catalog preflight failed closed — no bare `kimi` provider prefix exists on this OmniRoute installation
  learned: catalog-derived model IDs must be probed against the live `/v1/models` inventory before being pinned in a manifest or script, not inferred from naming convention; `nebius/moonshotai/Kimi-K2.6` is the correct live route and keeps genuine failure-domain diversity from the command-code-backed primary slot
  criterion now: ISC-172 and ISC-174 require the corrected, live-verified model ID across the manifest, script, tests, and docs

- 2026-07-23 | conjectured: the noesis-writer-skill's alchemical protocol powers an in-app "alchemical infusion" mechanic in the biorhythm-gated mobile app
  refuted by: an Explore-agent search of `somatic-cantincles-mobile-app`, `Somatic-Canticles-book`, and `Selemene-engine` found zero references to "alchemical infusion" and no Nigredo/Albedo/Citrinitas/Rubedo stage system anywhere outside the skill directory; "alchemical" appears only as narrative prose flavor in the manuscript
  learned: the skill's connection to that app is branding/content-mining lineage (source material for blog content), not a code integration; expanding the writing fleet should stay scoped to `temperance_engine`'s routing layer unless the user explicitly asks for an app-side feature
  criterion now: ISC-185 requires the routing doc to state this distinction explicitly and requires the change to touch no file outside `temperance_engine`

- 2026-07-23 | conjectured: a symlink into `daimon/skills/` would be discovered by the desktop app the same way it is by kimi-cli, regardless of which volume the target lives on
  refuted by: after the user restarted Kimi.app, neither temperance skill appeared; every other custom skill the app already recognized resolved to a same-volume path (`~/.agents/skills/...`), while the two temperance entries were the only symlinks crossing onto a different mounted volume — `kimi --print` confirmed the CLI resolves the identical symlink correctly, isolating the gap to the desktop app's own scanner
  learned: a host's skill/plugin directory scanner cannot be assumed to follow a symlink the way the shell or a Python-based CLI does; cross-volume symlinks are the likely failure class (a Node `Dirent.isDirectory()`-style check reflecting the link's own type rather than its resolved target), so a scanner-dependent install path needs empirical, in-app confirmation, not just a filesystem-level existence check
  criterion now: ISC-169 requires desktop skills to be real, marker-tagged managed copies (not symlinks) refreshed idempotently by wire-multi-backend.sh, while project/user scopes keep symlinks since those are unaffected

- 2026-07-23 | conjectured: the user's "weekly rate limits for codex and github" would map directly onto an existing weekly quota window for each connection
  refuted by: reading OmniRoute's own quota-tracking database directly showed GitHub's window is monthly (`completions`/`chat`/`premium_interactions`, reset the 1st) and Codex's is a rolling multi-day "session" window; only the Kimi Coding connections carry a genuine `window_key = "Weekly"` row
  learned: "weekly" was the user's framing for "proactively switch before a provider's own quota runs out," not a literal shared reset cadence; the feature must read whatever window each connection's own `omniroute usage quota` percentage currently reflects rather than assuming a common period, and non-code-review "what does the user mean" ambiguity here was resolved by asking (trigger scope, chain position, kimi's own guard, and polling model) before writing code
  criterion now: ISC-178 defines the substitution purely on live remaining-percentage per provider, independent of each provider's underlying reset cadence

- 2026-07-23 | conjectured: OmniRoute's own combo failover, or one of its 18 built-in routing strategies (`headroom`, `reset-aware`), could express "prefer github/codex normally, proactively switch below 30%" without new Temperance code
  refuted by: `failoverBeforeRetry` only reacts to actual request failures, never to a live quota percentage; `headroom` always routes to whoever has the most remaining quota with no sticky primary preference, and `reset-aware` ranks by which window resets soonest — neither expresses a threshold-gated, sticky-primary preference, and OmniRoute's combo API has no update/PATCH endpoint, only create and delete
  learned: proactive, threshold-gated backend preference is a Temperance-owned responsibility layered on top of OmniRoute's reactive failover, implemented the same way rollback already is in this codebase — delete-then-recreate a combo from a freshly computed desired model list, snapshot-first and idempotent when no change is needed
  criterion now: ISC-179 and ISC-180 require the reconciler and the advisory CLI to share one substitution algorithm via a cached state file, and require the live mutation path to be snapshot-first, dry-run by default, and a true no-op when the live combo already matches

## Verification

- `./verify.sh` passed after checking required files, shell syntax, and hard-coded install paths.
- `bun build package/pulse-compat/compat-server.ts --target=bun` passed.
- `node package/skill-resolvers/skill_cluster_resolver.mjs` returned `skill-index-present` on the local system.
- `./install.sh --dry-run --skip-voice` completed without mutating live config and showed backup-first writes.
- `codex-gpt-image` generated `assets/banner.png` and `assets/icon.png` through Codex OAuth.
- `gh repo view` verified links for OpenCode, Codex CLI, GitHub CLI, Bun, and ripgrep.
- 2026-06-15: `./verify.sh` passed with interpreter-aware shell linting and reported `ok: no private local path in public/install surface`.
- 2026-06-15: `./install.sh --dry-run --skip-voice` passed and ended with `Install flow complete`.
- 2026-06-15: The private-path denylist scan across tracked files returned no matches.
- 2026-06-15: `bash scripts/readme-continuity-check.sh HEAD HEAD` passed.
- 2026-06-15: `./install.sh --dry-run --skip-voice` proved default mode skips Claude/Pulse and Codex while installing OpenCode/Cursor templates.
- 2026-06-15: `./install.sh --dry-run --skip-voice --with-claude --with-codex` proved optional Claude/Pulse and Codex surfaces can still be requested explicitly.
- 2026-07-09: `bun test package/enrich` covers `.planning` absent, present, empty, and file-state resolver behavior.
- 2026-07-09: `./scripts/verify-all.sh` passed after running `./verify.sh`, `bun test package/enrich`, docs continuity, router hardening, sandbox install, identity, wire-batch, and classify checks.
- ISC-51: file inspection — `ISA.md` and `multi-backend-router.sh` name `package/router/classify-task.sh` as the only task classifier.
- ISC-56: shell test — `bash tests/router-hardening.sh` reported `ok - route-only forced backend+model`.
- ISC-60: shell test — `bash tests/router-hardening.sh` reported the command-code → grok → kimi fallback chain in order.
- ISC-63: integration test — `bash tests/dispatch-tasklist.sh` verified top-level status/backend plus per-attempt metadata and diff pointers.
- ISC-66: integration test — `bash tests/dispatch-tasklist.sh` reported `ok - dry-run routes T1 to command-code` without invoking a live backend.
- ISC-67: shell test — classifier parity passed across the router corpus and no retired classifier consumer remains.
- ISC-73: regression test — both `tests/router-hardening.sh` and `tests/dispatch-tasklist.sh` completed with zero failures.
- ISC-74: dependency scan — the base installer does not require OmniRoute, and router tests prove the direct command-code → grok → kimi rails remain available when the daemon is absent.
- ISC-75: integration test — dispatch concurrency observed a maximum of two in-flight tasks with `--concurrency 2`, and all four tasks completed.
- 2026-07-21: `bun test package/router/routing-policy.test.ts` passed 14/14 policy and reducer tests, including deterministic replay, circuit state, per-signal freshness, and completion ordering.
- 2026-07-21: `bash tests/routing-policy.sh` passed shadow/enforce/off, forced override, invalid-state fail-open, no-raw-prompt, all-open, semantic-validation, and single-probe lease scenarios.
- 2026-07-21: `bash tests/dispatch-tasklist.sh` passed frozen-plan integrity, concurrency, fallback, timeout, worktree isolation, atomic observations, Bash-4 millisecond ordering, optional usage/cost preservation, and compact-summary checks.
- 2026-07-21: `bash tests/docs-continuity.sh` verified the pinned OmniRoute commit, REUSE/ADAPT/REJECT matrix, MIT attribution, subagent fallback contract, no credential-like literals, and full-gate wiring.
- 2026-07-21: `./scripts/verify-all.sh` completed with `Temperance Engine full verification passed`; 43 enrichment tests, 14 routing-policy tests, router/policy/dispatcher suites, installer sandbox, identity, wiring, and classifier gates were green.
- 2026-07-21: Two read-only parallel reviewers rechecked routing integrity and specification coverage. Mutable-plan execution, all-open phantom routing, duplicate cooldown probes, stale telemetry refresh, and Bash-4 completion ties were corrected before the final gate; no P0/P1 finding remained in the implementation scope.
- ISC-79: HTTP probe — `GET http://127.0.0.1:20128/v1/models` returned HTTP 200 with 100 catalog entries.
- ISC-80: architecture inspection — `classify-task.sh` retains task-type mapping only; the live OmniRoute API supplies provider and model inventory.
- ISC-81: integration probes — `oc/deepseek-v4-flash-free`, `oc/big-pickle`, and `mcode/mimo-auto` completed directly, and the named combo returned `SECURE_COMBO_OK`.
- ISC-82: shell test — `tests/router-hardening.sh` verified `omniroute:temperance-coding` precedes command-code, grok, and kimi while preserving their order.
- ISC-83: integration test — the Codex adapter completed an actual OmniRoute-routed agent run with `AGENT_GATEWAY_OK`; its dispatcher mock also passed.
- ISC-84: security checks — both scoped credentials resolve from their named macOS Keychain entries, and `tests/docs-continuity.sh` found no repository credential literals.
- ISC-85: shell probe — `scripts/omniroute-check.sh` exited zero after reporting runtime 3.8.48, 100 catalog entries, the combo, and router route.
- ISC-86: live integration — `scripts/omniroute-check.sh --live` exited zero and reported completion through `deepseek-v4-flash-free`.
- ISC-87: config probe — `opencode models omniroute` returned `omniroute/temperance-coding`, and the generated Codex profile exists without an embedded inference key.
- ISC-88: documentation test — `tests/docs-continuity.sh` verified runtime operations, provider onboarding, model inspection, health checks, and fallback documentation.
- ISC-89: architecture test — shared-classifier parity passed across router cases, and no alternate OmniRoute task classifier exists.
- ISC-90: permission check — both OmniRoute environment files and the generated Codex profile report mode `600`.
- ISC-91: regression gate — `scripts/verify-all.sh` completed with `Temperance Engine full verification passed`, including all OmniRoute router and dispatcher assertions.
- ISC-92: file read — `docs/plans/2026-07-22-omniroute-governed-portfolios.md` begins with the required implementation-plan header, goal, architecture, stack, and TDD tasks.
- ISC-93: unit test — `bun test package/router/routing-policy.test.ts` passed 14/14 and asserted `correlation_id == tc_ + input_hash[0:24]` across byte-identical replays.
- ISC-94: integration test — `bash tests/dispatch-tasklist.sh` reported `ok - attempt correlation matches frozen plan`.
- ISC-95: mocked client probe — `bash tests/dispatch-tasklist.sh` reported `ok - OmniRoute Codex request carries correlation header`.
- ISC-96: fallback integration — `bash tests/dispatch-tasklist.sh` reported `ok - gateway and direct attempts share correlation` and completed with `dispatch-tasklist: PASS`.
- ISC-97: schema and integration tests — policy/router tests label OmniRoute `gateway` and all CLI candidates `direct`; dispatcher fallback reported both domains and completed with `dispatch-tasklist: PASS`.
- ISC-98: unit test — `bun test package/router/omniroute-portfolios.test.ts` passed mappings for all six outputs of the shared task classifier.
- ISC-99: fixture-driven routing integration — `bash tests/router-hardening.sh` proved a missing named portfolio keeps `temperance-coding` selected before the direct primary, while an empty gateway catalog removes OmniRoute and selects the direct rail.
- ISC-100: isolation probes — the portfolio manifest reports `enforcement=shadow`, resolver tests pin no provider members, and a live plan inspection found no `te-*` model in `selected_order`.
- ISC-101: readiness CLI — `bash tests/omniroute-check.sh` and `scripts/omniroute-check.sh --json` reported the schema version, catalog count, configured/available/missing portfolios, and failed closed for an unknown fixture schema.
- ISC-102: evidence-state CLI — the same fixture/live probes reported telemetry and eval availability/counts, preserved unavailable/null evidence, and kept `.enforcement_ready` false.
- Task 6: promotion gate — `bun test package/router/omniroute-promotion.test.ts` passed 9/9; `bash tests/router-hardening.sh` verified signed `te-fast` promotion, wrong-portfolio rejection, missing-key compatibility fallback, manifest-tamper rejection, and forced-route preservation.
- Task 6: local Mac integration — the installed `~/.local/bin/temperance-route` symlink selected `temperance-coding` without a receipt; `scripts/omniroute-check.sh --live` completed through OmniRoute runtime 3.8.48, with 265 catalog models and enforcement still false.
- ISC-107: OpenCode config/CLI probe — the provider now declares 14 labeled OmniRoute entries, and `opencode models omniroute` lists all 14 including `temperance-coding`.
- ISC-108: live catalog probe — `GET /v1/models` returned 265 models and all 14 configured IDs matched with `missing=0`.
- ISC-109: documentation read — `docs/omniroute-runtime.md` states picker selection is a direct override and automatic task modes remain owned by Temperance routing.
- ISC-110: security/config probe — JSON parsed, `git diff --check` passed, the config retained `{env:OMNIROUTE_API_KEY}`, and no credential literal or full catalog dump was found.
- ISC-111: unit/plugin guard — `bun test package/adapters/opencode/OmniRouteCatalogGuard.test.ts` passed 3/3, including stale-ID rejection and unavailable/malformed catalog denial; OpenCode resolved the installed guard plugin successfully.
- ISC-103: enrichment test — `bun test package/enrich/stages/routing.test.ts` passed and the shared classifier output now carries `portfolio=te-*` from the pure resolver.
- ISC-104: full-gate inspection — `scripts/verify-all.sh` now invokes proxy and OpenCode flow regression suites.
- ISC-105: documentation read — `docs/omniroute-integration.md`, `docs/omniroute-runtime.md`, and `docs/pai-flow.md` distinguish discovery aliases, production compatibility, automatic relay routing, councils, and direct fallbacks.
- ISC-106: proxy unit/integration tests — automatic decisions use UUID request traces while deterministic plan correlation remains separate.
- ISC-112: unit test — `bun test package/adapters/opencode/TemperanceFlowPlugin.test.ts` appends the shared `<temperance-context>` block as a synthetic OpenCode message part.
- ISC-113: live relay probe — `GET http://127.0.0.1:20129/v1/models` returned 266 models including `temperance-auto` and `temperance-coding`.
- ISC-114: live request probe — automatic curl request reached OmniRoute and returned route headers for `temperance-coding`, `rp_32d2951c6a7a99cc`, and `tc_32d2951c6a7a99ccea221e7e`.
- ISC-115: unit test — direct `auto/best-fast` request was forwarded unchanged with `explicit-picker-override` source.
- ISC-116: unit test — streaming response preserved both SSE chunks and `[DONE]`.
- ISC-117: unit test — tool-carrying automatic request selected `temperance-coding` compatibility route.
- ISC-118: unit test/live response — OmniRoute HTTP 502 and retry/error headers passed through the relay unchanged.
- ISC-119: request logs and unit behavior — automatic request IDs use `te_req_` UUID traces distinct from deterministic plan IDs.
- ISC-120: macOS lifecycle probe — `launchctl print gui/$(id -u)/com.temperance.engine.openai-proxy` reported `state = running`; `/health` returned HTTP 200.
- ISC-116/117: live mock-gateway probe — `bash tests/temperance-proxy-live.sh` traversed the real router and relay, preserved successful SSE `[DONE]` framing, returned a real `tool_calls` payload, and carried frozen route headers without relying on provider quota.
- ISC-114: real-upstream canary — a transient relay with `TEMPERANCE_OMNIROUTE_MODEL=auto/best-coding` returned HTTP 200 and `REAL_TEMPERANCE_CANARY_OK` with automatic route, plan, correlation, and task headers; the governed `temperance-coding` request separately returned OmniRoute's explicit `[502] Combo "temperance-coding" failed — all targets exhausted`.
- ISC-121: remains open — `opencode run -m omniroute/temperance-auto` fails before issuing an HTTP request because the existing local OpenCode SQLite schema lacks `replacement_seq`; the relay itself is covered by curl and mock/real-upstream probes.
- Combo diagnosis: direct probes returned HTTP 200 for `opencode/deepseek-v4-flash-free`, an empty-response 502 for `opencode/big-pickle`, and account-exhausted 502 for `mimocode/mimo-auto`; the named combo's failure is therefore upstream target health/quota state, not a hidden relay route miss.
- ISC-122: live `scripts/omniroute-connections.sh` inventory reported 17 active connections with OAuth/API-key type labels and emitted no credential fields.
- ISC-123: the inventory joined 23 catalog owners to four stable capability lanes while reporting counts only, with deterministic duplicate collapse and no full model-ID dump.
- ISC-124: live JSON included runtime status, circuit breakers, connection health, provider metrics, catalog counts, eligibility, and safety flags in one envelope.
- ISC-125: `bash tests/omniroute-connections.sh` passed the fixture-backed deterministic schema, duplicate, unknown-provider, and redaction assertions.
- ISC-126: source inspection and fixture tests confirmed GET-only reads, no credential/config writes, `full_model_ids_emitted=false`, and `credential_fields_emitted=false`.
- ISC-127: `docs/omniroute-connections.md` documents agentic, research, media, and backbone leverage lanes with native-probe and promotion guardrails.
- ISC-128: `./scripts/verify-all.sh` executed `tests/omniroute-connections.sh`; the full gate completed with `Temperance Engine full verification passed`.
- ISC-129: the current live snapshot records 17 active/configured connections, 503 advertised and 488 unique model IDs, and one degraded gateway domain (`oc`).
- ISC-130: authenticated `GET /api/combos` readback listed `temperance-coding`, `te-fast`, `te-build`, `te-reason`, and `te-validate`; the redacted report exposed names, descriptions, strategies, models, and config only.
- ISC-131: the apply preflight checked every target against live `/v1/models` and found zero missing IDs before mutation.
- ISC-132: native `PORTFOLIO_OK` probes returned HTTP 200 for all five named routes, including the repaired compatibility rail.
- ISC-133: native tool probes returned `tool_calls` for both `te-build` and `te-validate`; the build lane was configured with `minContentLength=0` so tool-only responses are valid.
- ISC-134: `temperance-coding` now reads back the Temperance compatibility description and Codex/GitHub/Nebius fallback targets; the unsupported OmniRoute system-message field was not treated as persisted state.
- ISC-135: dashboard creation returned four new combo IDs for `te-fast`, `te-build`, `te-reason`, and `te-validate`.
- ISC-136: readback confirmed priority strategies for fast/build/reason, fusion for validation, and distinct Temperance descriptions for every portfolio.
- ISC-137: pre/post `/api/settings` readback remained `activeCombo=null`; the local OpenCode model map was only extended with picker entries and did not change the relay or global combo.
- ISC-138: authenticated combo readback matched the planned target arrays and strategies exactly, including `judgeModel=codex/gpt-5.6-terra` for `te-validate`.
- ISC-139: the new target arrays contain only chat-capable model routes; research, crawl, embedding, speech, video, and image lanes remain outside the combos.
- ISC-140: `scripts/omniroute-check.sh --json` reported all four required portfolios available plus `temperance-coding`; combo metrics reported exercised priority rails and the validation route passed its native probe.
- ISC-141: `package/router/omniroute-portfolios.json`, `docs/omniroute-runtime.md`, `docs/omniroute-connections.md`, and the lifecycle test document mappings, shadow enforcement, preflight, and rollback gates.
- Advisor follow-up: rollback was exercised against the 20260723T033417Z pre-apply snapshot; readback returned only `temperance-coding` with `activeCombo=null`, then `--apply` recreated all four portfolios successfully.
- Advisor follow-up: an eight-function, 34,553-byte tool-schema probe returned HTTP 200 with no error for all five routes; prose prompts with forced `report_status` returned tool calls for `te-validate` and `te-build`.
- Advisor follow-up: forced prose probes returned prose on Antigravity-backed `te-fast` and `te-reason`; those are now explicitly documented and configured as content rails (`tool_call=false`), while workspace-tool work is assigned to `te-build` or `te-validate`.
- Advisor follow-up: shadow routing receipts show `selected=temperance-coding` and `proposed=te-build|te-reason|te-validate` for matching task types; no promotion receipt was issued.
- Advisor follow-up: a fresh authenticated dashboard session read back all five combos with `activeCombo=null`; this is the intentional shadow-mode invariant, not an unverified active pointer.
- Advisor follow-up: a live OmniRoute restart was intentionally deferred because independent local PR-verification agents were actively using the gateway; fresh authenticated API and OpenCode CLI sessions read the persisted five-combo state, so restart is a maintenance-window follow-up rather than a hidden success claim.
- Advisor follow-up: legacy target repro returned `oc/deepseek-v4-flash-free=200`, `oc/big-pickle=502 empty response`, and `mcode/mimo-auto=502 accounts exhausted`; the repaired compatibility rail returned HTTP 200 `PORTFOLIO_OK`.
- Advisor follow-up: expired Hy3 and MiniMax-M3 classifier pins were retired; live-verified DeepSeek V4 Flash and MiniMax M2.7 now occupy those direct fallback slots, with classifier and dispatch tests green.
- ISC-142: `package/router/temperance-workflows.json` and its resolver make `github/gpt-5.4` planner-primary, `codex/gpt-5.6-sol-max` escalation, and Nebius fallback; resolver tests passed.
- ISC-143: authenticated probes returned HTTP 200 and tool calls for GitHub GPT-5.4 and Codex GPT-5.6 Sol Max; the live Codex metadata reports tool calling/reasoning with a 500k context, 372k input, and 128k output ceiling.
- ISC-144: role resolver readback selected Command Code DeepSeek Flash, Command Code Kimi K2.7 Code, Grok Build, and Nebius Qwen; direct CLI fallback entries remain Command Code → Kimi → Grok.
- ISC-145: `scripts/omniroute-temperance-fleet.sh --apply` created `te-plan`, `te-dispatch`, and `te-creative` after live catalog preflight; `activeCombo` remained null and the printed snapshot supports rollback.
- ISC-146: live catalog metadata and the workflow manifest keep ElevenLabs on `/v1/audio/speech` and RunwayML on `/v1/videos/generations`; no media-only target enters a chat combo.
- ISC-147: `omniroute-portfolios.json` maps the shared `creative` classifier output to `te-creative`; `temperance-workflows.ts` handles roles without inspecting prompt text.
- ISC-148: local OpenCode JSON now exposes `te-plan`, `te-dispatch`, and `te-creative`; `opencode models omniroute` lists all three and no credential literal was added.
- ISC-149: `./scripts/verify-all.sh` passed after the role resolver, lifecycle safety checks, live readiness probe, and existing routing/dispatch suites.
- ISC-150: `bun test package/router/temperance-stage-contract.test.ts` passed 11/11, covering canonical stage order, catalog-backed capabilities, and current portfolio mappings.
- ISC-151: the same contract suite rejected malformed stages, invalid next-stage transitions, forged lanes/portfolios/routes, unsupported fields, oversized shapes, and serialized secret/raw-transcript fields.
- ISC-152: the pointer CLI reported six logical roots with presence flags; the contract suite confirmed no knowledge body fields are emitted and excluded an outside-base symlink.
- ISC-153: `tests/sandbox-install.sh` passed shared enrichment installation for Claude/Codex opt-ins and preserved existing trees unless refresh was requested.
- ISC-154: `bash scripts/wire-multi-backend.sh --status` showed the shared enrichment tree plus classifier, portfolio resolver, and manifest links on the live Mac.
- ISC-155: synthetic Codex UserPromptSubmit smoke emitted a valid `<temperance-context>` block with `surface=codex`; missing optional state remained fail-open.
- ISC-156: live OpenCode JSON retains `omniroute` at `http://127.0.0.1:20128/v1` and adds `temperance/temperance-auto` at `http://127.0.0.1:20129/v1`.
- ISC-157: `bash tests/opencode-relay-config.sh` passed backup-first enable, direct-provider preservation, sidecar creation, and clean disable.
- ISC-158: `bash tests/temperance-doctor.sh` passed direct offline readiness and rejected automatic readiness when the relay was absent; live `--require-auto --json` emitted no secrets.
- ISC-159: `com.temperance.engine.openai-proxy` is running under launchd; `/health` returned HTTP 200, `/v1/models` returned 501 entries including `temperance-auto`, and the live doctor passed automatic readiness.
- ISC-160: the focused relay, doctor, wire, and sandbox tests passed; the canonical `scripts/verify-all.sh` rerun completed with `Temperance Engine full verification passed`.
- 2026-07-23: kimi-cli repaired via `uv tool install kimi-cli --force` (1.47.0 → 1.49.0, replacing the venv whose homebrew python was deleted); hook/provider/skill contracts re-verified unchanged against the 1.49.0 source.
- ISC-161: `bun test package/enrich` passed 44/44 including the `surface=kimi` well-formed-block case.
- ISC-162..164: `bun test package/router/temperance-openai-proxy.test.ts` passed 16/16 — header-gated injection, latest-message-only replace-not-stack, array-content unshift, streaming request injection, fail-open on enrich error, sidecar freshness/schema gates, and relay-cwd fallback.
- ISC-165: `bash tests/kimi-hook.sh` passed — exit 0 with empty stdout across happy path, malformed stdin, missing cwd, and unwritable state dir; sidecar single-line 0600 with sha256-prefix prompt hash matching the relay's normalization.
- ISC-166..167: `bash tests/kimi-relay-config.sh` passed 32 assertions — single managed block, comment survival, hooks-line rewrite with recorded original, idempotent re-enable, `--set-default` record/restore, byte-identical disable (pre-normalization), collision guard, foreign-hooks manual mode, unhealthy-relay refusal, and the full kimi-normalized semantic lifecycle (dedupe on re-enable, header-based removal on disable).
- ISC-168: `bash tests/kimi-desktop-relay-config.sh` passed — `[[hooks]]` inside the managed block, hook copy under `~/.temperance_engine` (outside the app dir), `config_sha256` recorded and matching, no api_key material in any script output, byte-identical disable.
- ISC-169: live `wire-multi-backend.sh` created resolving skill links in `~/.kimi/skills/`; repo `.agents/skills/` relative symlinks resolve; `bash tests/wire-batch.sh` passed 16/16 including the desktop copy-vs-symlink, idempotent-refresh, foreign-content-backup, and marker-gated-revert assertions; live conversion confirmed both desktop skills are now real `.temperance-managed` copies and `temperance-doctor.sh` reports `kimi_desktop_skills: true`.
- ISC-170: `bash tests/temperance-doctor.sh` passed — kimi fixture yields `kimi_ready=true`, a broken kimi lane leaves `direct_ready=true` with exit 0, and `--require-kimi` folds the lane into the exit gate; live `--require-kimi --json` exited 0 with `direct_ready`, `automatic_ready`, and `kimi_ready` all true and no secrets.
- ISC-171: `./scripts/verify-all.sh` completed with `Temperance Engine full verification passed` including the three new kimi suites and the extended doctor test.
- 2026-07-23 live E2E: `kimi --print --model temperance/temperance-auto` from the repo returned the requested `TEMPERANCE_KIMI_OK` text; the relay decision log recorded `surface=kimi`, `enrichment=injected`, `enrichment_cwd_source=session-context`, `prompt_hash_match=true`, routed `temperance-coding` via `tool-safe-compatibility` (kimi requests carry tools, so the ISC-117 pin applied); the hook sidecar held the real session id and repo cwd; `mode-classifier.jsonl` gained `surface="kimi"` telemetry lines.
- ISC-172: `bun test package/router/temperance-workflows.test.ts` passed 8/8, including the writing role's drafting order, critique council/judge shape, client-side image workflow, transmutation stage mapping, and declared-inactive ACP lane.
- ISC-173: `bun test package/router/omniroute-portfolios.test.ts` passed with `reserved_portfolios` extended to `te-write`/`te-write-critique`; the names-only regex assertion, the five required portfolios, and all task-type mappings remained unchanged.
- ISC-174: the writer script's first dry-run failed closed on `kimi/kimi-k2.6` (see Changelog); after correcting the ID to `nebius/moonshotai/Kimi-K2.6` the dry-run authenticated, snapshotted, preflighted all five live catalog targets, printed both combo payloads, and left `activeCombo=null` with zero mutation. `bash tests/omniroute-temperance-combos.sh` passed all 30 checks including the six new writer-script guards.
- ISC-175: `docs/noesis-writer-routing.md` maps every skill phase (P1–P5 plus Nigredo/Albedo/Citrinitas/Rubedo) to its combo or client-side boundary; the shell gate confirms the doc names both combos and states FAL/client-side explicitly.
- ISC-176: `workflowManifest.writing.acp.status === "declared-inactive"` with a note naming the principal-bound security-design prerequisite, asserted in the resolver test suite.
- ISC-177: `./scripts/omniroute-temperance-writer.sh --apply` created `te-write` (id `c37c4438-0906-42a2-a166-11515177d63c`) and `te-write-critique` (id `988a8278-4518-465b-bcac-44884f9b814b`); `activeCombo` remained `null` before and after. Live native probes returned `WRITE_OK` from `te-write` (routed to priority-1 `MiniMaxAI/MiniMax-M2.7` via `command-code`, 622ms, zero cost) and `CRITIQUE_OK` from `te-write-critique` (fusion judge `gpt-5.6-terra` via Codex, 443ms). `./scripts/verify-all.sh` completed with `Temperance Engine full verification passed` including the extended portfolio and workflow suites.
- ISC-178: `bun test package/router/temperance-workflows.test.ts` passed the new github-alone, both-triggered-dedupe, kimi-own-guard, missing-provider-fail-open, and non-`available`-state cases; `bash tests/omniroute-planner-quota.sh` reproduced the same six scenarios against the shell reconciler's `--status` output with identical results.
- ISC-179: the CLI (`bun package/router/temperance-workflows.ts resolve planner ...`) was run against a hand-written state-file fixture and reproduced the exact substitution the shell reconciler computed for the same quota input; with no state file present it fails open to the unmodified candidate list.
- ISC-180: live dry-run against the real `te-plan` combo reported `te-plan already matches the quota-aware desired order` (zero drift with healthy quotas). A live `--apply` test with a faked low-github quota reconciled the real combo to `["kimi-coding-apikey/k3","codex/gpt-5.6-sol-max","nebius/Qwen/Qwen3-235B-A22B-Instruct-2507"]` (verified via a direct `/api/combos` read), preserved `activeCombo: null`, and wrote a timestamped backup; a follow-up `--apply` with real (healthy) quota data reconciled it back to the original `["github/gpt-5.4","codex/gpt-5.6-sol-max","nebius/Qwen/Qwen3-235B-A22B-Instruct-2507"]`, confirmed byte-for-byte via a second live read (same description, strategy, and model order as before either mutation).
- ISC-181: `./scripts/verify-all.sh` completed with `Temperance Engine full verification passed` including `tests/omniroute-planner-quota.sh` and the extended `temperance-workflows.test.ts` suite; the `com.temperance.engine.planner-quota` LaunchAgent was installed (`--install-timer`, 900s interval), its `RunAtLoad` firing confirmed no drift against live quota, and `temperance-doctor.sh --json` reported `planner_quota_state` and `planner_quota_timer` both healthy without affecting `direct_ready`/`automatic_ready`/`kimi_ready`.
- 2026-07-23 negative path: with OmniRoute stopped, the governed kimi lane returned the relay's clean `upstream_unavailable` envelope and the session stayed resumable; the default `managed:kimi-code` lane was structurally untouched. After `omniroute serve` restarted, the same request succeeded end-to-end.
- 2026-07-23 desktop: `configure-kimi-desktop-relay.sh enable` landed the managed block in `daimon-share/config.toml` with `config_sha256` recorded; picker visibility pending the user's next app restart (the app was running and was not killed).
- 2026-07-23 post-restart: the user restarted Kimi.app and reported the picker unchanged (three models) and the desktop skills still not recognized. Investigation found the daimon's live startup log (`configPath=.../daimon/runtime/kimi-code/config.toml`) loads a DIFFERENT config file than the one `configure-kimi-desktop-relay.sh` manages (`daimon-share/config.toml`) — the picker gap is explained by that mismatch and is left as an open follow-up (out of scope for this pass; the user confirmed the model picker is not the priority). The skills gap was root-caused and fixed: see ISC-169 changelog entry below.
- ISC-169 fix: `bash tests/wire-batch.sh` failed to exist for kimi skill regressions until this pass; live diagnosis found every desktop skill the daimon recognized resolved to a same-volume path (`~/.agents/skills/...`), while the two temperance desktop skills were the only symlinks crossing onto a different mounted volume. `kimi --print` confirmed the CLI (Python-based) resolves the identical symlink correctly, isolating the gap to the desktop app's Node/Electron skill scanner. `wire-multi-backend.sh` now installs desktop skills as real, `.temperance-managed`-tagged copies via `copy_skill_dir()` (idempotent refresh, foreign-content backup-then-overwrite, marker-gated revert) instead of symlinks; CLI/project scopes are unaffected (still symlinks). Live fix applied and confirmed: `temperance-doctor.sh` reports `kimi_desktop_skills: true` and both desktop entries are now real directories with the managed marker.
- ISC-182: `bun test package/router/temperance-workflows.test.ts` passed 23/23 (whole-file run, alongside the parallel planner-quota suite), including the research council's DeepSeek-v4-pro/GitHub/Codex-terra panel and judge, the media planner's GitHub/Codex-sol-max/Nebius panel, and the workflow-array ordering assertion that claim-grounding precedes drafting.
- ISC-183: `bun test package/router/omniroute-portfolios.test.ts` passed with `reserved_portfolios` extended to include `te-write-research`/`te-write-media`; the names-only regex assertion, the five required portfolios, and all task-type mappings remained unchanged.
- ISC-184: `scripts/omniroute-temperance-writer-expansion.sh` dry-run authenticated, snapshotted, preflighted all five live catalog targets (`command-code/deepseek/deepseek-v4-pro`, `github/gpt-5.4`, `codex/gpt-5.6-terra`, `codex/gpt-5.6-sol-max`, Nebius Qwen) on the first attempt with no ID corrections needed, and left `activeCombo=null`. `bash tests/omniroute-temperance-combos.sh` passed all 41 checks including the six new expansion-script guards.
- ISC-185: `docs/noesis-writer-routing.md` gained a "Context: Somatic Canticles and the biorhythm mobile app" section stating the connection is branding/content lineage only, grounded in an Explore-agent search of `somatic-cantincles-mobile-app`, `Somatic-Canticles-book`, and `Selemene-engine` that found zero references to "alchemical infusion" or any Nigredo/Albedo/Citrinitas/Rubedo mechanic in any of those repos; this change's `git diff` touches no path outside `temperance_engine`.
- ISC-186: `git diff HEAD -- package/router/temperance-workflows.json | grep -A5 -B5 '"creative"'` returned no hunks — the `creative` block is byte-identical to `HEAD`; `te-write-media`'s manifest entry, resolver branch, and docs are additive only.
- ISC-187: `scripts/omniroute-temperance-writer-expansion.sh --apply` created `te-write-research` (id `1a042162-8b83-4a79-a64d-1c05624914c7`) and `te-write-media` (id `ffe9cc05-282c-4a9a-b0e1-b8b028f26b69`); `activeCombo` remained `null` before and after. Live native probes returned `RESEARCH_OK` from `te-write-research` (fusion judge `gpt-5.6-terra` via Codex, 749ms) and `MEDIA_OK` from `te-write-media` (priority-1 `gpt-5.4` via GitHub, 237ms).
