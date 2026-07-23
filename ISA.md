---
project: temperance_engine
task: Add governed OmniRoute portfolios and evidence fabric
effort: E3
phase: learn
iteration: 2026-07-23-combo-synthesis
progress: 139/141
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

- 2026-07-23 | conjectured: every newly authenticated connection should become another Temperance task classifier route
  refuted by: the live inventory separates agentic model providers from search, crawl, embedding, audio, and media services, while OmniRoute health reports only two monitored gateway domains
  learned: connections are capability inputs, not interchangeable model routes; expose a redacted inventory and role map first, then promote only evidence-backed provider pools into named portfolios
  criterion now: ISC-122 through ISC-129 require connection inventory, capability-role mapping, health/metric evidence, fixture safety, leverage guidance, and a current workstation snapshot

- 2026-07-23 | conjectured: adding combo aliases to the picker would be enough to express Temperance philosophy
  refuted by: the first build probe exposed tool-only responses rejected by `minContentLength=1`, the old compatibility rail failed through an empty provider and exhausted account, and expired direct classifier deals remained pinned
  learned: portfolio themes belong in operator-facing descriptions and the Temperance context boundary, tool-capable rails must allow empty text with tool calls, and live target evidence plus reversible rollback must precede promotion
  criterion now: ISC-130 through ISC-141 record authenticated lifecycle, native probes, schema limits, shadow diffs, compatibility repair, expired-pin retirement, and docs/readiness evidence

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
