---
project: temperance_engine
task: Build and test the vault relocation subsystem (Tasks 2A/3/4/6/7/8/9)
effort: E4
effort_source: classifier
phase: build
iteration: 2026-08-04-vault-relocation-build-out
progress: 681/788
mode: interactive
started: 2026-06-12
updated: 2026-08-04T23:15:00Z
---

## Problem

The local PAI, skill-cluster, peon-ping, and CodeGraph integration exists as a working machine-specific runtime, but it is not packaged into a public, reviewable, one-time installer.

Temperance also has a unified task classifier and dual-rail batch dispatcher, but its backend selection is primarily static. It does not yet combine capability fit, observed health, quota/cost state, deterministic fallback, and attempt telemetry into one explicit routing policy.

The previous 14-entry backend/model catalog was Temperance-owned scaffolding, not OmniRoute's live provider inventory. OmniRoute patterns were adapted locally, but the OmniRoute runtime itself was never initialized, secured, or connected to agentic dispatch.

The vault portfolio now inventories 87 local project roots, but Paseo knows only
five projects and contains one duplicate Temperance workspace. Work can be
orchestrated across native provider applications, yet most vault projects are
not selectable from Paseo's desktop, CLI, mobile, or remote surfaces.

OpenCode currently auto-enables credentialed providers outside its explicit
configuration, expanding a deliberately curated 27-model surface into a volatile
182-model picker. Newly connected providers also enter OmniRoute as catalog
availability without role, health, capability, or promotion evidence, so catalog
breadth can masquerade as routing quality.

The Mac mini now satisfies the governed session contract, but the `safvr` EC2
host does not. Its Ubuntu OpenCode session resolves 22 models, lacks Native and
Algorithm mode skills, and points directly at an older OmniRoute portfolio set.
An older Temperance relay is already active on loopback, but its deployed bytes
predate the governed session manifest and it runs as the Hermes service identity.

After the governed Mac and EC2 rollout, the provider-topology dashboard visually
shows only OpenAI Codex as active and Antigravity as errored while the rollout
summary also reports two enabled OpenCode providers. It is not yet proven whether
this is correct activity telemetry, a conflation of OpenCode adapter count with
OmniRoute upstream connection count, or a stale/incomplete topology projection.

OmniRoute now exposes a Cloudflare Quick Tunnel plus native Context Settings,
CLI Code, CLI Agents, MCP, A2A, Context Sources, and documentation surfaces. The
Temperance runtime already has PAI stages, GSD planning state, governed routing,
skill-cluster resolution, Hermes isolation, and a Spark dispatch fleet, but the
native OmniRoute features have not yet been mapped against those existing seams.
Without that mapping, overlapping context injection or agent bridges can
duplicate policy, expose a public endpoint, consume protected Sol quota, or
bypass the single-classifier and single-ISA contracts.

Working Git repositories are also interleaved with the TWC Obsidian/PARA tree,
including a nested Thoughtseed Labs knowledge vault. This creates nested `.git`
traversal, indexing, watcher, and ownership confusion while making a casual move
capable of breaking Git worktrees, runtime path consumers, or project planning
links. The earlier relocation concept also made native-session and Paseo linkage
part of the critical path even though durable continuity belongs in a portable
project checkpoint, not in provider-owned chat databases.

## Vision

Temperance Engine gives a user a readable public repo that explains the runtime, installs the safe pieces, references optional local voice packs, and verifies the configuration without leaking private machine state.

The orchestrator should use OmniRoute without becoming an OmniRoute fork: Temperance classifies work and freezes an inspectable dispatch plan; Codex supplies the workspace-capable agent loop; OmniRoute supplies the dynamic provider/model catalog and internal failover; direct agent CLIs preserve outage recovery.

Every present project shown in the vault portfolio should be selectable in Paseo
through a stable exact-path workspace. Additional task-specific workspaces may
coexist. Role preferences should route planning,
implementation, research, UI, and audit work through verified native or
OmniRoute-backed providers without coupling project registration to session
imports or repository mutations.

An OpenCode session should expose only a small set of named Temperance profiles:
automatic PAI routing, a proportionate Native lane, and an Algorithm coordinator.
PAI remains the workflow-policy owner; lazy mode skills provide behavior;
OmniRoute selects within governed combinations; task workers escalate from B to
A to S only when needed; every concrete serving model remains visible to the
operator without entering the model picker.

The Mac mini and EC2 host should present the same policy contract even when their
provider entitlements differ: automatic, Native, and Algorithm session postures;
explicit S/A/B capability labels; bounded worker escalation; a curated picker;
loopback-only routing; and receipt-bound rollback. The EC2 implementation should
feel like the same Temperance system without pretending Mac-only credentials or
model availability are portable.

The TWC vault should remain the readable knowledge system, Thoughtseed Labs
should remain its nested knowledge vault, and active code should live outside
every vault tree under a stable two-portfolio root. Each old project address
should remain useful as a lightweight capsule that explains the new code path,
GitHub authority, knowledge record, project-packet digest, and rollback story.
Any fresh Codex, Claude, OpenCode, or Kimi client should pick up the project from
the same bounded checkpoint without importing a native transcript.

## Out of Scope

Bundling private memory, credentials, backups, proprietary voice/audio packs, or forcing non-macOS voice behavior is out of scope.

Vendoring or forking OmniRoute, replacing `classify-task.sh`, committing provider credentials, automatically importing private provider accounts, or making the base Temperance installer depend on a running OmniRoute daemon remains out of scope. This workstation's explicitly approved local runtime integration is in scope.

Exposing raw provider catalogs, certifying newly connected models from names
alone, treating correlated aliases as independent fallbacks, or allowing skills
to become a second routing authority remains out of scope.

Changing Hermes code, units, timers, environment, data, network ingress, or
provider-broker state is outside this rollout. Copying macOS Keychain material,
resetting the OmniRoute dashboard password without explicit approval, or labeling
an EC2 route S-tier when its content and forced-tool probes do not pass is also
outside scope.

Publishing OmniRoute administrative dashboard routes, dashboard sessions,
provider credentials, or unkeyed inference access through the Quick Tunnel is
outside scope. Replacing PAI, GSD, ISA, skill-cluster routing, or Hermes with an
OmniRoute-owned duplicate is also outside scope.

Every portfolio other than `thoughtseed` and `tryambakam-noesis`, moving
Thoughtseed Labs, deleting any folder, rewriting native transcripts, relocating
provider databases, mass-moving repositories, and shrinking or rewriting the
outer vault's historical Git object store are outside this relocation tranche.

## Principles

- `ISA.md` remains the single acceptance ledger and preference store.
- GSD organizes execution; Speckit-style specs/plans supply design context.
- Runtime enrichment must fail open and expose pointers, not private file bodies.
- Ratification controls scope: pending review surfaces stay deferred.
- Classification decides what the task is; policy ranks where it should run; execution records what actually happened.
- Health, capability, cost, and quota signals may influence backend ranking without becoming a second task classifier.
- Fallback is a planned route with observable attempts, not an exception hidden inside a shell loop.
- Temperance owns task classification; OmniRoute owns provider/model inventory and gateway failover.
- Prefer a verified native OmniRoute capability over custom glue when it preserves Temperance's policy ownership and evidence boundaries.
- Context compression is a transport optimization, never a substitute for PAI stage semantics, ISA criteria, or GSD planning state.
- The vault project inventory owns local portfolio membership; Paseo owns runnable workspace identity.
- Project registration and agent-session creation remain separate lifecycle operations.
- A filesystem path is a current address; the stable project ID is the durable identity.
- Knowledge, code, session, and execution authorities remain linked without being collapsed into one store.
- Portable checkpoint state, not raw native chat state, is the cross-client continuity contract.
- Codex owns the local interactive governance rail without replacing either portfolio's durable authority plane.
- The shared packet schema does not imply shared Thoughtseed and Tryambakam identities, secrets, schedulers, or runtimes.

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
- New integration fan-out may use governed non-Codex OmniRoute models selected by task fit and live evidence; Sol-family models remain excluded from worker dispatch and reserved for separately authorized coordinator use.
- The Cloudflare tunnel may carry inference or an explicitly approved bridge only after anonymous and authenticated access probes establish the exposure boundary.
- Agentic dispatch through OmniRoute must retain a tool-capable client loop; raw chat completion alone is not a coding-agent replacement.
- The portfolio reconciliation must not restart Paseo or modify project repositories.
- The global `04-Archives` tree and GitHub-only repositories remain outside the 87-project live inventory.
- Existing Paseo workspaces are preserved; pre-existing duplicates are reported rather than destructively removed.
- OpenCode configuration changes are backup-first, reversible, and read back after writes.
- Capability tiers `S`, `A`, and `B` remain separate from fallback-readiness tiers `tier1` and `tier2`.
- PAI and Temperance own deterministic mode, effort, and escalation policy; OmniRoute executes the selected combination.
- A session freezes coordinator identity, while bounded worker tasks may escalate only `B → A → S`.
- Direct OpenCode picker overrides continue to bypass automatic Temperance classification.
- EC2 discovery and mutation use AWS profile `safvr` and SSM; no SSH ingress change is required.
- OmniRoute and the Temperance relay remain bound to loopback ports `20128` and `20129`.
- EC2 release artifacts are immutable, backup-first, and owned outside Hermes service paths.
- Hermes unit bytes, enabled state, activation timestamps, and protected data remain unchanged.
- EC2 capability labels derive from live content and forced-tool evidence, not catalog names.
- An unavailable S-tier coordinator fails closed instead of silently becoming an A-tier session.
- The relocation destination root is exactly `/Volumes/madara/2026/Projects/`.
- The relocation portfolio allowlist is exactly `thoughtseed` and `tryambakam-noesis`.
- Thoughtseed Labs remains at `/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-labs/`.
- Lifecycle and repository type are metadata, never destination path segments.
- Native CLI session stores remain in their provider-owned locations under the user's home directory.
- Relocation does not inspect, rewrite, import, or require native CLI session stores.
- Relocation does not modify or require Paseo.
- OmniRoute owns model routing only; it owns no project, task, handoff, or session state.
- Thoughtseed remote, scheduled, Telegram, and external operations remain Hermes-owned.
- Tryambakam uses its TN-owned Kimiclaw, Paperclip, Snow Gloves, Selemene, Cloudflare, and seed authorities without inheriting Thoughtseed planes.
- Kimi project context is attached at orchestrator dispatch time; prompt-hook emulation is forbidden.
- Tauri is optional cockpit infrastructure and never the scheduler, routing authority, durable memory, or secret store.
- A Thoughtseed relocation requires a verified TeamForge project ID; the relocation flow cannot mint one.
- Physical source parentage is not portfolio authority; ambiguous and mixed-lineage repositories remain held until owner-mapped.
- OmniRoute deployment profiles, endpoint/config namespaces, and credential scopes remain portfolio-specific.
- The relocation threat model excludes a hostile privileged or same-user process racing outside the exclusive relocation lock.
- Live apply is single-repository, same-device, digest-approved, receipt-bound, and rollback-capable.
- Outer-vault Git history cleanup is a separate backup-and-approval operation.

### Risks

- Enabling a public transport while `REQUIRE_API_KEY` is false makes anonymous inference a single-event security failure.
- Editing generated Claude profile files to add credentials is unstable because OmniRoute auto-sync may overwrite them.
- Using OmniRoute's native context store for a local inference key persists the secret in a mode-600 JSON file rather than Keychain.
- OmniRoute's native Hermes generator can persist an API key in `config.yaml`; it must remain proposal-only beside the protected EC2 Hermes runtime.
- Global prompt compression can silently weaken exact PAI, GSD, ISA, tool-schema, or receipt constraints even when the dashboard shows an apparently useful engine toggle.
- Authentication changes can interrupt unrelated active workers unless every current client already presents a valid key and the transition is canaried.
- A named tunnel without Cloudflare Access, inference-key restrictions, rate limits, spend limits, and a catch-all `404` still creates an unnecessarily broad remote trust boundary.

## Goal

Create a public-ready `Sheshiyer/temperance_engine` repository with install, verify, rollback, templates, and documentation for the custom runtime.

Integrate the smallest high-leverage OmniRoute patterns into Temperance's existing router and parallel dispatcher: source-anchored design, capability/health/quota-aware ranking, circuit breaking and ordered failover, dry-run explainability, compact attempt telemetry, and full regression tests, while preserving the ISA and unified classifier as the sole policy authorities.

Configure a secured local OmniRoute runtime as the preferred external gateway, make its live catalog the source of model inventory, execute its selected models through Codex's agent loop, and retain existing direct backends as automatic outage fallbacks.

Reconcile the vault's 87-project dashboard inventory into Paseo with an
idempotent, snapshot-first operation; install role-aware orchestration
preferences that use Temperance/OmniRoute portfolios and a native Claude
creative lane; and leave session imports, agent launches, daemon restarts, and
repo-local `paseo.json` authoring outside the registration operation.

Reduce OpenCode's visible model surface to governed session/helper aliases,
install Native and Algorithm mode skills and model-bound primary profiles,
record an explicit S/A/B capability taxonomy with fail-closed promotion gates,
and verify that automatic routing, explicit overrides, worker escalation,
fallback independence, and rollback remain observable and reversible.

Verify the Mac mini deployment, then reconcile the existing EC2 relay and Ubuntu
OpenCode installation into the same governed policy contract using EC2-local
OmniRoute evidence, Linux systemd isolation, loopback-only listeners, immutable
releases, and a rollback receipt, while preserving every Hermes-owned surface.

Reconcile provider-topology semantics with operational reality: distinguish
OpenCode adapters, OmniRoute upstream connections, governed combinations, and
recent routing activity; identify the displayed count and node-state sources;
and determine whether any correction is warranted without changing provider
credentials, routing policy, EC2, or Hermes during this diagnostic pass.

Map OmniRoute's native Context, CLI Code, CLI Agents, MCP, A2A, and Hermes-facing
surfaces onto the existing Temperance PAI/GSD/ISA/skill-cluster architecture;
adopt only non-duplicative, security-verifiable seams; and prove parallel worker
dispatch can use governed non-Codex OmniRoute models without consuming Sol quota.

Relocate only approved `thoughtseed` and `tryambakam-noesis` working repositories
to `/Volumes/madara/2026/Projects/<portfolio>/<repository>` through a dry-run-first,
same-device, one-repository transaction that preserves Git state, stable project
identity, portfolio-specific knowledge records, portable project packets,
old-path knowledge capsules, fresh-client pickup, and exact rollback while
leaving Thoughtseed Labs, native session stores, Paseo, and every other folder
untouched.

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
- [x] ISC-58: An open circuit removes its backend from new automatic attempts.
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
- [x] ISC-121: A fresh OpenCode interactive session completes an automatic model request through the relay.
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
- [x] ISC-188: A connector-brand name (the Athanor, the Caduceus, the Vigil) is applied only where its underlying code prints output a human reads directly in a terminal-safe context — a user-invoked CLI's stdout/stderr (`Banner.ts`, `OpinionTracker.ts`, the proxy's boot log, the reconciler's install/apply lines). It is never applied to a machine-parsed channel (a JSONL log writer, a hook's JSON protocol response, headless stdout meant for a downstream parser) or to a Claude Code hook subprocess's stderr, whose ANSI-rendering safety across every UI surface (raw terminal vs. desktop/web app vs. IDE extension) is unverified.
- [x] ISC-189: The dispatch role manifest contains model `codex/gpt-5.3-codex-spark`.
- [x] ISC-190: The Spark worker role names low-latency targeted coding as its capability.
- [x] ISC-191: The Spark worker records the separate preview rate-limit pool.
- [x] ISC-192: The `te-dispatch` round-robin model list starts with `codex/gpt-5.3-codex-spark`.
- [x] ISC-193: The `te-dispatch` lifecycle payload contains `codex/gpt-5.3-codex-spark` exactly once.
- [x] ISC-194: The `te-dispatch` lifecycle payload uses OmniRoute `round-robin`.
- [x] ISC-195: The `te-dispatch` lifecycle payload bounds concurrency per model.
- [x] ISC-196: The `te-dispatch` lifecycle payload bounds queue waiting time.
- [x] ISC-197: The `te-dispatch` lifecycle payload bounds queue depth.
- [x] ISC-198: The `te-dispatch` lifecycle payload disables same-target retries.
- [x] ISC-199: The `te-dispatch` lifecycle payload enables failover before retry.
- [x] ISC-200: The `te-dispatch` lifecycle payload enables metrics tracking.
- [x] ISC-201: Fleet lifecycle preflight requires the exact Spark catalog identifier.
- [x] ISC-202: Fleet lifecycle dry-run emits a round-robin `te-dispatch` payload.
- [x] ISC-203: Fleet lifecycle apply leaves OmniRoute `activeCombo` unchanged.
- [x] ISC-204: Fleet lifecycle reports an update action for changed governed combos.
- [x] ISC-205: Fleet lifecycle rollback restores every updated governed combo body.
- [x] ISC-206: Dispatch workflow resolution selects Spark when its catalog identifier exists.
- [x] ISC-207: Dispatch workflow resolution omits Spark when its catalog identifier is absent.
- [x] ISC-208: The command-code, Kimi, and Grok direct fallback entries remain present.
- [x] ISC-209: Fleet guidance assigns external tasks to `omniroute:te-dispatch`.
- [x] ISC-210: Fleet guidance requires worktree isolation for concurrent mutating tasks.
- [x] ISC-211: Runtime documentation records Spark's 128k text-only boundary.
- [x] ISC-212: Runtime documentation records Spark's independent preview rate limit.
- [x] ISC-213: Runtime documentation distinguishes round-robin selection from ordered fallback.
- [x] ISC-214: Anti: Spark is added to planner, reasoning, or validation portfolios.
- [x] ISC-215: A fleet run preserves per-task provider and model attribution.
- [x] ISC-216: The canonical verification gate passes with Spark fleet tests included.
- [x] ISC-217: The Codex adapter advertises 128k when `te-dispatch` can select Spark.
- [x] ISC-218: The Spark fleet auto-compacts below its advertised context ceiling.
- [x] ISC-219: Non-Spark OmniRoute portfolios retain their existing 200k adapter contract.
- [x] ISC-220: Host-side lifecycle apply reconciles live `te-dispatch`, and a canary records its selected provider/model.
- [x] ISC-221: Vault inventory is the authoritative local project membership source.
- [x] ISC-222: Portfolio statistics reproduce the dashboard's eighty-seven local projects.
- [x] ISC-223: Every present inventory record resolves to its Git repository root.
- [x] ISC-224: Every distinct valid inventory path has one Paseo project identity.
- [x] ISC-225: Every configured project has an active exact-path workspace.
- [x] ISC-226: Existing valid Paseo projects and workspaces remain unchanged.
- [x] ISC-227: Reconciliation prevents duplicate creation across overlapping applies.
- [x] ISC-228: Distinct checkouts sharing a remote remain distinct Paseo projects.
- [x] ISC-229: Workspace titles include inventory groups for duplicate-name disambiguation.
- [x] ISC-230: All seven local-only inventory repositories are registered.
- [x] ISC-231: Internal archive-named records remain included when inventory lists them.
- [x] ISC-232: Global archives and remote-only repositories remain unregistered.
- [x] ISC-233: Registration imports no historical provider sessions.
- [x] ISC-234: Registration launches no project agents or model requests.
- [x] ISC-235: Registration does not restart or reconfigure the Paseo daemon.
- [x] ISC-236: Registration modifies no file inside any inventoried repository.
- [x] ISC-237: Paseo registry files are snapshotted before live registration.
- [x] ISC-238: Dry-run reports exact create, preserve, and error actions.
- [x] ISC-239: Sequential reruns converge to zero creates; overlapping runs fail closed.
- [x] ISC-240: Missing or non-Git paths fail closed with named errors.
- [x] ISC-241: Additional same-path workspaces are reported without destructive cleanup.
- [x] ISC-242: A machine-readable receipt records every inventory path outcome.
- [x] ISC-243: A human-readable guide explains portfolio scope and lifecycle.
- [x] ISC-244: Provider inspection verifies each configured preference target exists.
- [x] ISC-245: Orchestration preferences cover implementation, UI, research, planning, and audit.
- [x] ISC-246: Implementation preference uses the OmniRoute Spark-enabled dispatch portfolio.
- [x] ISC-247: Planning, research, and audit use distinct Temperance portfolios.
- [x] ISC-248: UI work uses a verified native Claude provider lane.
- [x] ISC-249: Remote operation reuses the same Paseo daemon workspace registry.
- [x] ISC-250: Focused tests and live readback verify complete reconciliation.
- [x] ISC-251: Redacted inventory reports every current OmniRoute connection.
- [x] ISC-252: AGY, Ollama Cloud, and OpenCode Zen receive explicit capability roles.
- [x] ISC-253: Unknown provider owners remain ineligible for governed combinations.
- [x] ISC-254: A machine-readable manifest defines distinct S, A, and B capability tiers.
- [x] ISC-255: Capability tiers remain structurally separate from fallback readiness tiers.
- [x] ISC-256: Session policy declares automatic, Native, and Algorithm coordinator profiles.
- [x] ISC-257: OpenCode defaults new sessions to `temperance/temperance-auto`.
- [x] ISC-258: OpenCode enables only `omniroute` and `temperance` providers.
- [x] ISC-259: OpenCode exposes no more than fourteen governed model aliases.
- [x] ISC-260: OpenCode exposes no raw NVIDIA or Hugging Face provider catalog.
- [x] ISC-261: OpenCode background work resolves to a declared B-tier small model.
- [x] ISC-262: Native and Algorithm PAI mode skills exist in project skill scope.
- [x] ISC-263: PAI mode skills contain no provider credentials or catalog copies.
- [x] ISC-264: Native and Algorithm OpenCode profiles bind explicit coordinator models.
- [x] ISC-265: Session profiles keep coordinator identity stable for the session.
- [x] ISC-266: Dispatch profiles assign bounded grunt work to B-tier workers first.
- [x] ISC-267: Worker escalation follows the single direction `B → A → S`.
- [x] ISC-268: Mid-task model downgrade requires an explicit new task boundary.
- [x] ISC-269: Every route receipt records session, task, profile, tier, and decision.
- [x] ISC-270: Every successful route receipt records the resolved concrete provider and model from buffered headers or bounded final streaming attribution trailers.
- [x] ISC-271: The tier manifest declares a failure domain for every eligible model.
- [x] ISC-272: A-tier continuity requires a failure domain distinct from its S-tier primary.
- [x] ISC-273: Explicit OpenCode picker models still bypass automatic classification.
- [x] ISC-274: Startup validation rejects unresolved profile and helper model references.
- [x] ISC-275: OpenCode configuration writes create a recoverable timestamped backup.
- [x] ISC-276: Governed OmniRoute combination writes remain snapshot-first and reversible.
- [x] ISC-277: Session-profile reconciliation never changes OmniRoute `activeCombo`.
- [x] ISC-278: Newly connected models require content, tool, health, and promotion evidence.
- [x] ISC-279: Models lacking promotion evidence remain candidates, not eligible fallbacks.
- [x] ISC-280: Anti: no second task-type classifier enters the routing path.
- [x] ISC-281: Focused tests cover tier schema, profiles, validation, and config containment.
- [x] ISC-282: A fresh OpenCode automatic session completes through the curated surface.
- [x] ISC-283: OpenCode loads Temperance plugins without invoking helper exports.
- [x] ISC-284: Expired or malformed live catalogs fail closed after cache TTL.
- [x] ISC-285: Resolved OpenCode model identifiers equal the curated manifest set.
- [x] ISC-286: Every custom OpenCode alias declares context and output limits.
- [x] ISC-287: Candidate `te-orchestrate` appears in no default or fallback path.
- [x] ISC-288: Temperance worker agents enforce and propagate a finite depth cap.
- [x] ISC-289: A documented direct-CLI break-glass command succeeds without either relay.
- [x] ISC-290: One bundle identifier restores partial OpenCode, skill, and combo application safely.
- [x] ISC-291: Mac OpenCode resolves exactly fourteen governed models.
- [x] ISC-292: Mac session validation reports eight agents, two providers, and depth one.
- [x] ISC-293: Mac OpenCode defaults to `temperance/temperance-auto`.
- [x] ISC-294: Mac direct and automatic readiness both report true.
- [x] ISC-295: Mac rollout bundle exists with mode `600`.
- [x] ISC-296: AWS profile `safvr` resolves the approved account and IAM identity.
- [x] ISC-297: Exactly one running EC2 instance is named `hermes-runner-01`.
- [x] ISC-298: The approved EC2 instance is online through SSM.
- [x] ISC-299: The EC2 host reports Ubuntu 24.04 on x86_64.
- [x] ISC-300: Pre-rollout Hermes unit hashes are captured.
- [x] ISC-301: Pre-rollout Hermes active, enabled, and activation states are captured.
- [x] ISC-302: Ubuntu invokes OpenCode 1.17.11 under the `ubuntu` account.
- [x] ISC-303: The pre-rollout EC2 OpenCode surface reproduces twenty-two visible models.
- [x] ISC-304: EC2 OmniRoute 3.8.48 is active under systemd.
- [x] ISC-305: The authenticated EC2 OmniRoute catalog returns 281 entries.
- [x] ISC-306: EC2 content and forced-tool probes classify candidate S, A, and B routes.
- [x] ISC-307: The chosen topology uses the EC2-local OmniRoute rather than Mac credentials.
- [x] ISC-308: EC2 deploys Temperance router bytes from an immutable release directory.
- [x] ISC-309: EC2 OpenCode reconciliation runs as `ubuntu`, never root.
- [x] ISC-310: EC2 OpenCode enables only `omniroute` and `temperance` providers.
- [x] ISC-311: EC2 OpenCode resolves no more than fourteen governed aliases.
- [x] ISC-312: EC2 OpenCode resolves zero raw `opencode/*` models.
- [x] ISC-313: EC2 OpenCode defaults new sessions to `temperance/temperance-auto`.
- [x] ISC-314: EC2 background work uses a live-probed B-tier model.
- [x] ISC-315: Native and Algorithm mode skills resolve under the Ubuntu OpenCode scope.
- [x] ISC-316: EC2 declares the governed primary and helper agents with depth one.
- [x] ISC-317: The Linux Temperance relay runs active and enabled under systemd.
- [x] ISC-318: OmniRoute and the existing relay listen only on loopback.
- [x] ISC-319: The relay reads its API key from a protected systemd credential file.
- [x] ISC-320: The relay service identity is not a member of the `hermes` group.
- [x] ISC-321: The relay service identity cannot read `/etc/hermes/.env`.
- [x] ISC-322: A fresh EC2 automatic OpenCode session returns structured S-tier-unavailable until promotion.
- [x] ISC-323: A fresh EC2 Native OpenCode session returns valid content.
- [x] ISC-324: A fresh EC2 Algorithm session fails closed without reaching an A- or B-tier upstream.
- [x] ISC-325: The live-probed EC2 B-worker route returns a forced tool call.
- [x] ISC-326: EC2 route receipts bind session, task, profile, tier, and decision.
- [x] ISC-327: A mode-`600` EC2 bundle records config, skill, service, and release rollback order.
- [x] ISC-328: A rollback rehearsal restores the exact pre-rollout OpenCode bytes.
- [x] ISC-329: Post-rollout Hermes unit hashes equal the captured pre-rollout hashes.
- [x] ISC-330: Post-rollout Hermes active, enabled, and activation states remain unchanged.
- [x] ISC-331: EC2 security-group ingress contains no ports `20128` or `20129`.
- [x] ISC-332: Anti: rollout writes modify no Hermes unit, environment, code, or data file.
- [ ] ISC-333: EC2 authenticates a genuine S-tier provider that passes content and forced-tool probes.
- [ ] ISC-334: OmniRoute admin authorization creates or updates a fail-closed `te-algorithm` combo.
- [ ] ISC-335: The relay enables `TEMPERANCE_AUTO_READY=1` only after S-tier promotion evidence exists.
- [ ] ISC-336: A fresh EC2 Algorithm OpenCode session completes on the promoted S-tier combo without downgrade.
- [x] ISC-337: A redacted live probe enumerates every authenticated Mac OmniRoute upstream connection by stable provider identity.
- [x] ISC-338: Read-only payload and projection inspection identifies every topology count source and its semantic meaning.
- [x] ISC-339: Topology node activity state derives from fresh routing-attempt telemetry rather than OpenCode adapter enablement.
- [x] ISC-340: The topology headline count equals the number implied by its documented state predicate.
- [x] ISC-341: OpenCode adapters `omniroute` and `temperance` remain distinct from OmniRoute upstream provider identities.
- [x] ISC-342: Governed aliases and combinations do not inflate the topology provider count.
- [x] ISC-343: Configured or historically observed providers without an in-flight request remain visible as idle nodes.
- [x] ISC-344: The rendered topology derives provider identities and activity states directly from its backing inputs.
- [x] ISC-345: A read-only regression assertion distinguishes two enabled OpenCode adapters from a larger OmniRoute upstream inventory.
- [x] ISC-346: Anti: the topology diagnosis changes no credentials, routing portfolios, EC2 state, or Hermes-owned surface.
- [x] ISC-347: Local OmniRoute `/docs` returns HTTP 200.
- [x] ISC-348: The installed docs catalog exposes auth, tunnels, compression, context, CLI tools, MCP, and A2A skill entries.
- [x] ISC-349: Anonymous local dashboard access redirects to `/login`.
- [x] ISC-350: Anonymous tunneled dashboard access redirects to `/login`.
- [x] ISC-351: An anonymous tunneled `/v1/models` probe cannot return HTTP 200.
- [ ] ISC-352: An anonymous tunneled chat probe is rejected before request-schema validation.
- [ ] ISC-353: A dedicated remote inference key allows only explicitly pinned, probe-passing non-Sol model identifiers until broader fleet promotion.
- [ ] ISC-354: The remote inference key has an explicit endpoint allowlist.
- [ ] ISC-355: The remote inference key has a finite request-per-minute limit.
- [ ] ISC-356: The remote inference key has a finite daily or weekly spend limit.
- [ ] ISC-357: Anonymous tunneled management API access returns an authorization rejection.
- [ ] ISC-358: The approved remote transport exposes no provider-management response body anonymously.
- [x] ISC-359: Repository scans contain no Quick Tunnel hostname or tunnel credential.
- [ ] ISC-360: A documented command stops the active remote transport without stopping OmniRoute.
- [x] ISC-361: OmniRoute custom global system-prompt injection remains disabled.
- [x] ISC-362: Global prompt compression remains disabled until the governed fixture matrix passes.
- [x] ISC-363: A compression preview preserves all seven Temperance stage names byte-for-byte.
- [x] ISC-364: A compression preview preserves representative `ISC-N` identifiers byte-for-byte.
- [x] ISC-365: A compression preview preserves GSD `.planning` pointer paths byte-for-byte.
- [x] ISC-366: A compression preview preserves valid tool-call JSON structure.
- [x] ISC-367: `preserveSystemPrompt` remains enabled in effective OmniRoute settings.
- [x] ISC-368: Session Dedup remains disabled until update-aware behavior is proven.
- [x] ISC-369: CCR retrieval remains disabled for private PAI memory roots.
- [x] ISC-370: Relevance, Aggressive, and LLMLingua transformations remain disabled for governed requests.
- [x] ISC-371: Caveman cannot affect governed requests while the global compression pipeline is disabled.
- [x] ISC-372: Any adopted OmniRoute Context Source has an explicit path allowlist.
- [x] ISC-373: Any adopted OmniRoute Context Source exposes pointers rather than private file bodies.
- [x] ISC-374: Native CLI Code discovery can validate Codex configuration without writing it.
- [x] ISC-375: Native CLI Code discovery leaves the existing Temperance Codex profile hash unchanged.
- [x] ISC-376: Generated CLI Code previews contain no plaintext API key.
- [x] ISC-377: Native CLI Agents discovery identifies Hermes support.
- [x] ISC-378: The Hermes settings API requires management authentication.
- [x] ISC-379: Any Hermes integration artifact is generated as a redacted dry-run proposal.
- [x] ISC-380: OmniRoute MCP status requires management authentication.
- [x] ISC-381: OmniRoute MCP scope enforcement is enabled before any client registration.
- [ ] ISC-382: OmniRoute A2A publishes a bounded capability list through an authenticated probe.
- [x] ISC-383: A2A integration has no write path to `classify-task.sh` or `ISA.md`.
- [x] ISC-384: OmniRoute GitHub skill discovery results remain candidate-only.
- [x] ISC-385: Native skill discovery performs no direct installation into live skill scopes.
- [x] ISC-386: `skill-index.json` remains the canonical skill-cluster registry.
- [x] ISC-387: GSD `.planning` remains the canonical execution-planning spine.
- [x] ISC-388: The seven-stage Temperance capability packet remains the orchestration handoff contract.
- [x] ISC-389: Live `te-dispatch` contains `codex/gpt-5.3-codex-spark`.
- [x] ISC-390: Live `te-dispatch` contains zero Sol-family model identifiers.
- [x] ISC-391: Every fleet task explicitly selects backend `omniroute`.
- [x] ISC-392: Every accepted Codex worker task explicitly selects pinned model `codex/gpt-5.3-codex-spark` while `te-dispatch` is held.
- [x] ISC-393: At least four independent read-only tasks execute concurrently through `temperance-batch`.
- [x] ISC-394: At least one fleet task records concrete Spark attribution.
- [x] ISC-395: Every fleet attempt record contains zero Sol-family model identifiers.
- [x] ISC-396: Failed fleet tasks fall through only to non-Sol rails.
- [x] ISC-397: The installed `temperance-parallel-dispatch` skill matches the repository-native Spark fleet contract.
- [x] ISC-398: Skill refresh creates a recoverable snapshot before replacing stale installed content.
- [x] ISC-399: Documentation maps each OmniRoute native surface to Temperance ownership and adoption status.
- [x] ISC-400: An automated contract test rejects policy ownership duplicated inside OmniRoute integration guidance.
- [x] ISC-401: The canonical repository verification gate exits zero after integration work.
- [x] ISC-402: Anti: logs and artifacts expose no API key, dashboard credential, or provider token.
- [x] ISC-403: Anti: this iteration changes no EC2 or Hermes-owned runtime surface.
- [x] ISC-404: Anti: OpenCode remains at two enabled providers and fourteen governed aliases.
- [x] ISC-405: Rollback restores every local configuration byte changed by this iteration.
- [x] ISC-406: The `antigravity-claude-sonnet-5` profile contains no persisted authentication secret.
- [x] ISC-407: The `gh-claude-sonnet-5` profile contains no persisted authentication secret.
- [x] ISC-408: The `no-think-antigravity-claude-sonnet-5` profile contains no persisted authentication secret.
- [x] ISC-409: The `no-think-gh-claude-sonnet-5` profile contains no persisted authentication secret.
- [x] ISC-410: The governed Claude launcher reads its inference key from macOS Keychain at execution time.
- [x] ISC-411: The governed Claude launcher writes no inference key to disk.
- [x] ISC-412: The governed Claude launcher places no inference key in child-process arguments.
- [x] ISC-413: The governed Claude launcher fails before execution when Keychain lookup is empty.
- [x] ISC-414: The governed Claude launcher rejects every profile outside the four-profile allowlist.
- [x] ISC-415: The governed Claude launcher delegates execution to native `omniroute launch --profile`.
- [x] ISC-416: OmniRoute's Claude profile auto-sync generator persists no authentication token.
- [x] ISC-417: A mode-600 migration receipt records the four pre-migration profile hashes.
- [x] ISC-418: The four migration-receipt hashes match their source profile bytes.
- [x] ISC-419: OmniRoute resolves `REQUIRE_API_KEY` to true after local-client migration.
- [x] ISC-420: Anonymous local `/v1/models` access returns HTTP 401 after migration.
- [x] ISC-421: Invalid-Bearer local `/v1/models` access returns HTTP 401 after migration.
- [x] ISC-422: Keychain-authenticated local `/v1/models` access returns HTTP 200 after migration.
- [x] ISC-423: The `antigravity-claude-sonnet-5` native launch profile passes a non-interactive canary.
- [x] ISC-424: The `gh-claude-sonnet-5` native launch profile passes a non-interactive canary.
- [x] ISC-425: The `no-think-antigravity-claude-sonnet-5` native launch profile passes a non-interactive canary.
- [x] ISC-426: The `no-think-gh-claude-sonnet-5` native launch profile passes a non-interactive canary.
- [x] ISC-427: The existing Keychain-authenticated Codex/OpenCode rail passes a post-migration catalog and routing canary without consuming Spark quota.
- [x] ISC-428: Cloudflare Quick Tunnel remains stopped after local authentication promotion.
- [x] ISC-429: OmniRoute remains bound only to loopback after local authentication promotion.
- [ ] ISC-430: The promoted named Cloudflare Tunnel terminates unmatched ingress with HTTP 404.
- [ ] ISC-431: Cloudflare Access rejects unauthenticated requests before they reach OmniRoute.
- [ ] ISC-432: An Access-authenticated remote request routes only to its explicitly allowlisted governed model.
- [x] ISC-433: The native Claude inference key is distinct from the existing Codex/Spark inference key.
- [x] ISC-434: The native Claude key permits exactly the four governed Claude model identifiers.
- [x] ISC-435: The native Claude key permits only the `chat` and `models` endpoint categories.
- [x] ISC-436: The native Claude key has a finite positive request-rate limit.
- [x] ISC-437: The native Claude inference key cannot authenticate any management endpoint.
- [x] ISC-438: Native Claude launch leaves the OmniRoute context-store bytes unchanged.
- [x] ISC-439: Mandatory client authentication remains effective after an OmniRoute restart rehearsal.
- [x] ISC-440: A revoked throwaway inference key receives HTTP 401.
- [x] ISC-441: The real Claude process receives no duplicate `OMNIROUTE_API_KEY` environment variable.
- [x] ISC-442: Every newly dispatched integration worker uses a non-Codex OmniRoute model.
- [x] ISC-443: Every newly dispatched integration worker explicitly pins backend `omniroute` and an exact model.
- [x] ISC-444: At least two distinct non-Codex provider families produce nontrivial, receipt-attributed worker results.
- [x] ISC-445: Every newly dispatched integration attempt contains zero Sol-family model identifiers.
- [ ] ISC-446: Cloudflare programmatic access uses an Access service token or mTLS, never a browser-cookie dependency.
- [ ] ISC-447: Named-tunnel credentials remain outside the repository and are readable only by the launch principal.
- [ ] ISC-448: A remote key request for a model outside its allowlist is denied before provider routing.
- [ ] ISC-449: Rollback reverses remote exposure, client-auth promotion, and local launcher changes in dependency order.
- [x] ISC-450: The dedicated Claude key resolves `noLog` to true.
- [x] ISC-451: The dedicated Claude key has finite positive daily and weekly USD limits.
- [x] ISC-452: Every protected Claude payload artifact created before no-log promotion is redacted.
- [x] ISC-453: Redaction retains summary telemetry while request, response, error, and pipeline bodies remain absent.
- [x] ISC-454: OmniRoute client, admin-login, and router curl paths keep credentials outside child-process arguments.
- [x] ISC-455: LaunchAgent bootstrap failure restores an authenticated loopback-only manual daemon before returning failure.
- [x] ISC-456: Documentation distinguishes two OpenCode adapters from OmniRoute upstream provider inventory and activity telemetry.
- [x] ISC-457: Remote promotion stays closed while DNS and Cloudflare Access authority remain absent or unproven.
- [x] ISC-458: Revocation evidence records the data-plane cache delay and a real terminal HTTP 401.
- [x] ISC-459: The repository and installed parallel-dispatch skills are byte-identical and make governed native non-Codex analysis first-class while Spark stays optional and Sol stays excluded.
- [x] ISC-460: Mutation tests reject both `noLog=false` and any fifth allowed Claude model.
- [x] ISC-461: Mutation tests reject anonymous catalog access, inference-key management access, and any all-interface OmniRoute listener.
- [x] ISC-462: Redaction verification detects a planted or replanted protected body and records a genuine SHA-256 separately from OmniRoute's compatibility checksum.
- [x] ISC-463: Governed Claude and OpenCode launchers propagate upstream failure without silently selecting a direct-vendor fallback.
- [x] ISC-464: The canonical full repository verifier passes after the non-Codex dispatch contract and negative controls are integrated.
- [x] ISC-465: The Mac Temperance proxy LaunchAgent retries transient bootstrap failure and restores the exact prior proxy, router, enrichment, and plist bytes on any failed promotion.
- [x] ISC-466: An unresolved open or half-open circuit remains fail-closed after ordinary observation TTL expiry until its cooldown permits a bounded probe.
- [x] ISC-467: Per-host circuit-policy promotion is deterministic, receipt-bound, drift-detecting, and restores the exact prior mode bytes or prior absence.
- [x] ISC-468: The Mac host runs circuit enforcement only after fresh healthy OmniRoute evidence selects OmniRoute first without an eligible open circuit.
- [x] ISC-469: Enforce mode claims half-open probe leases by default while an explicit `TEMPERANCE_ROUTING_POLICY=off` remains the immediate kill switch.
- [x] ISC-470: Cloudflare readiness emits versioned, identity-redacted JSON from only `wrangler whoami --json` or a local fixture.
- [x] ISC-471: Cloudflare readiness distinguishes authentication and permission-label claims from resource-scoped DNS, Access-policy, machine-identity, account, and hostname authority.
- [x] ISC-472: Unobservable scopes, ambiguous accounts, invalid hostnames, and partial Cloudflare permission sets all fail closed.
- [x] ISC-473: The Cloudflare preflight cannot create a tunnel, DNS record, Access application, policy, service token, certificate, or route.
- [x] ISC-474: Native A2A inspection binds versioned source indicators to the installed package version and a SHA-256 over every relevant route and ownership source without claiming dataflow proof.
- [x] ISC-475: Ambient management credentials or any unguarded A2A RPC, status, list, detail, or cancel route fail the conservative source indicators.
- [x] ISC-476: Ownerless tasks, unbounded skills, and CLI/server create mismatch each fail the conservative native A2A source indicators.
- [x] ISC-477: A matching mode-600 five-minute A2A receipt can validate its claims but cannot produce live or technical readiness without authenticated instance binding.
- [x] ISC-478: The native A2A preflight never grants promotion authority, even when every source indicator and receipt claim passes.
- [x] ISC-479: The canonical full repository verifier includes both readiness suites and passes without enabling Cloudflare or A2A.
- [x] ISC-480: Signed probe receipts use Ed25519 with versioned, surface-specific domain separation rather than sharing the routing-promotion HMAC trust domain.
- [x] ISC-481: Receipt verification binds exact issuer, key identifier, audience, one-time challenge, short lifetime, and a snapshot-only non-authorizing issued/consumed replay state.
- [x] ISC-482: Every signed probe receipt machine-readably limits its claim to signer integrity and disclaims Cloudflare resource authority, A2A handler safety, and write capability.
- [x] ISC-483: Tampering, cross-surface substitution, wrong audience, replay, expiry, missing or malformed signatures, unsafe verbs, and canonicalization ambiguity all fail closed.
- [x] ISC-484: Cloudflare signed-probe integrity binds exact expected account, zone, hostname, tunnel, and GET-only endpoint evidence without satisfying resource-scope or hostname-zone authority gates.
- [x] ISC-485: Cloudflare readiness remains hard-false and read-only when every local permission and signed-integrity claim passes but independent resource authority is absent.
- [x] ISC-486: A2A signed-probe integrity binds exact package version, source digest, server instance, and behavioral safety evidence; missing evidence is indeterminate and cannot satisfy technical or promotion readiness.
- [x] ISC-487: Probe verification accepts public trust material only, places no signing secret in process arguments or artifacts, and writes no current promotion-gate input.
- [x] ISC-488: Native integration guidance maps signed probes into PAI, GSD, ISA, skill-cluster, routing, Cloudflare, and A2A ownership without creating a second policy authority.
- [x] ISC-489: Focused adversarial tests and the canonical full repository verifier pass while Cloudflare, A2A, EC2, Hermes, and Sol-family dispatch remain unchanged.
- [x] ISC-490: A standalone signed-probe challenge controller is the only permitted future authorization-state seam and remains absent from every current promotion call site.
- [x] ISC-490.1: Challenge issuance binds a 256-bit operating-system-generated nonce to an exact key identifier and at-most-five-minute lifetime while holding an exclusive bounded-wait mutation lock.
- [x] ISC-490.2: Challenge consumption is keyed only by exact key identifier and challenge, denies missing, expired, and consumed entries, and permits exactly one winner under concurrent replay attempts.
- [x] ISC-490.3: Every ledger transition uses a same-directory exclusive temporary file, file fsync, atomic rename, and parent-directory fsync; prepared receipts deterministically recover pre-commit or post-commit crashes.
- [x] ISC-490.4: Ledger, lock, receipt, backup, and temporary paths reject symbolic links, non-regular files, non-owner identities, broad modes, and non-canonical parent traversal before mutation.
- [x] ISC-490.5: Issued and consumed tombstones remain until no receipt can be fresh, then prune under explicit entry, byte, and time bounds without reopening a live receipt.
- [x] ISC-490.6: Mode-600 operation receipts bind exact pre/post generations, hashes, path identity, and durable backups; rollback rejects drift, monotonically revokes only an unconsumed issuance, and can never restore or reopen consumed state.
- [x] ISC-490.7: The read-only verifier accepts the versioned controller ledger only as an `authorizing:false` snapshot, legacy fixtures remain compatible, and no current promotion path imports or consumes challenge state.
- [x] ISC-491: Both host manifests declare literal-off OmniRoute compression transport policy scoped exactly to the enabled `omniroute` and `temperance` providers; missing, malformed, mismatched, or non-off policy fails before mutation.
- [x] ISC-492: The OpenCode reconciler preserves unrelated provider headers, removes every case-insensitive compression-header variant, installs exactly one canonical `x-omniroute-compression: off` header on both governed providers, validates the resolved configuration, and restores exact prior bytes through drift-protected rollback.
- [x] ISC-493: The Temperance relay overwrites every client compression-header spelling with literal `off` at the final outbound boundary, focused request-capture tests prove both direct and relay paths, and global compression, Cloudflare, A2A, EC2, Hermes, routing promotion, and Sol-family state remain unchanged.
- [x] ISC-494: The Mac LaunchAgent installer persists an explicit canonical `TEMPERANCE_AUTO_READY` value, defaults fresh installs fail-closed, preserves transactional recovery, and lets the already-proven Mac S contract be deliberately reactivated without any Sol request.
- [x] ISC-495: The EC2 S-candidate manifest accepts only explicit non-Sol, non-`auto`, reasoning-capable aliases and rejects malformed candidates, duplicate identities, forbidden model families, and real tool names.
- [x] ISC-496: The probe sends a well-formed nonexistent-model control before and after candidates plus a preregistered mismatch control; any unexpected control result voids every candidate without a positive readiness claim.
- [x] ISC-497: Every live request is serial, loopback-only, compression-off, nonce-bound, non-streaming, retry-free, deadline-bounded, token-bounded, and limited to content or inert `te_probe_noop` tool observation.
- [x] ISC-498: Candidate outcomes use only the closed vocabulary `FALSIFIED`, `CONSISTENT_UNPROVEN`, `ENV_UNAVAILABLE`, `QUOTA_BLOCKED`, `TRANSPORT_FAIL`, `PINNING_UNVERIFIED`, and `STRUCTURALLY_UNVERIFIABLE`; no field claims genuine identity, readiness, authorization, or promotion.
- [x] ISC-499: `FALSIFIED` requires an explicit serving-attribution contradiction; refusal, missing nonce, truncation, empty content, normalization differences, or tool/text path disagreement can never independently emit `FALSIFIED`.
- [x] ISC-500: The receipt emits only allowlisted telemetry, identifies integrity as unauthenticated local telemetry, records explicit identity/authorization/promotion non-claims, expires, and binds manifest plus probe-source hashes without persisting raw bodies or errors.
- [x] ISC-501: Receipt creation uses a private owner-only directory and exclusive no-follow mode-`600` creation; collisions, symbolic links, broad modes, and overwrite attempts fail closed.
- [x] ISC-502: Live authentication reads only a strict regular key file outside the repository, never accepts a credential on argv, and emits no credential, environment dump, request body, raw response, or full vendor error to stdout, stderr, or receipts.
- [x] ISC-503: Repository guards find no production import of the S telemetry reader, no receipt consumer in promotion paths, and no new write to `TEMPERANCE_AUTO_READY`, combo state, Hermes state, Cloudflare state, or A2A state.
- [x] ISC-504: A live EC2 run emits a non-authorizing mode-`600` receipt that rejects every current non-Sol Opus candidate while OmniRoute, Temperance, Hermes, loopback listeners, and `TEMPERANCE_AUTO_READY=0` remain unchanged.
- [x] ISC-505: Focused adversarial tests, source bundling, diff hygiene, and the canonical full repository verifier pass with zero Sol-family request or state change.
- [x] ISC-506: The named-remote-promotion manifest accepts only its exact versioned schema and rejects every unknown or missing field before planning.
- [x] ISC-507: The manifest accepts only a lowercase non-wildcard hostname that is a strict subdomain of its declared Cloudflare zone.
- [x] ISC-508: The manifest origin is exactly the loopback OmniRoute data plane at `http://127.0.0.1:20128`.
- [x] ISC-509: The manifest permits exactly one explicit probe-passing non-Sol, non-`auto` model identifier for the initial remote key.
- [x] ISC-510: The initial remote-key policy is exact, no-log, session-bounded, endpoint-bounded, rate-bounded, and daily/weekly-spend-bounded.
- [x] ISC-511: The promotion plan has one deterministic dependency order from authority preflight through remote key, service identity, Access, tunnel, DNS, connector, and canaries.
- [ ] ISC-512: Apply requires an unexpired, independently signature-verified, manifest-bound, exact-resource authority receipt, safe local client authentication, stopped Quick Tunnel with no residual fallback, loopback-only origin, zero conflicting remote identities, and no account-wide `cert.pem` path.
- [x] ISC-513: Any failed preflight produces zero Cloudflare, OmniRoute, filesystem, Keychain, launchd, DNS, or connector mutation.
- [ ] ISC-514: Cloudflare control-plane authentication is read only from a strict regular mode-`600` token file outside the repository and never from argv or environment.
- [ ] ISC-515: Cloudflare service-token, tunnel-token, and OmniRoute remote-key secrets enter only the configured secret sink and never receipts, command arguments, stdout, stderr, or logs.
- [x] ISC-516: The Access self-hosted application and specific-token Service Auth policy exist before any tunnel configuration or DNS route can be created; `Everyone` and `Bypass` are rejected.
- [x] ISC-517: The remote tunnel configuration contains exactly the declared hostname-to-loopback rule with `originRequest.access.required`, exact team and audience bindings, followed by an unmatched `http_status:404` catch-all.
- [x] ISC-518: The proxied DNS CNAME targets only the created tunnel identity, is blocked by any covering wildcard or apex shadow, and cannot be created before Access verification.
- [ ] ISC-519: The connector runs only through `cloudflared tunnel run --token-file` using an owner-only token file outside the repository.
- [ ] ISC-520: Every mutation is journaled in a private directory before execution and the final mode-`600` receipt contains only allowlisted identifiers, hashes, states, and non-claims.
- [x] ISC-521: Failure recovery and explicit rollback stop the connector, remove DNS, clean and poll zero connections, remove tunnel state, then remove Access, service-token, OmniRoute-key, and owned secret state; failed containment emits `PROMOTION_STUCK_OPEN` and preserves Access and credential defenses.
- [x] ISC-522: Rollback is receipt-bound, ownership-tag-bound, drift-protected, idempotent, and never deletes a pre-existing, foreign same-name, or operator-replaced resource.
- [ ] ISC-523: The live canary contract requires resolved-host HTTP evidence, exact Access audience, issuer, and principal validation, anonymous Access denial, invalid machine-identity denial, invalid origin-Bearer denial, exact-model success, disallowed-model denial before routing, and anonymous management denial.
- [x] ISC-524: Preview mode performs zero network, Keychain, launchd, filesystem-secret, DNS, tunnel, Access, OmniRoute-key, or connector mutation.
- [ ] ISC-525: Mocked Cloudflare, OmniRoute, Keychain, cloudflared, and launchd fixtures prove every ordering, drift, leak, rollback, and partial-failure invariant before the canonical verifier passes.
- [x] ISC-526: The runbook maps Cloudflare, OmniRoute, Temperance, PAI/GSD/ISA, remote-client, and operator ownership plus the exact external inputs still required for live promotion.
- [ ] ISC-527: Public promotion requires pinned Ed25519 verification and durable atomic one-use consumption of an explicit unexpired operator approval receipt bound to the prepared-state hash, exact hostname, tunnel, Access application, remote-key policy, and canary contract.
- [x] ISC-528: Prepare mode may create only private control-plane resources and ends with no DNS record, no running connector, no public route, and ownership-bound deterministic recovery for response-before-journal crashes without adopting foreign same-name resources.
- [x] ISC-529: The production adapter lives in a separate explicit composition module that the generic preview CLI never imports, accepts no default hostname or authority source, and performs no work at module load.
- [x] ISC-530: Cloudflare and OmniRoute management credentials are read only from canonical external owner-only regular mode-`600` files with no symlink, hardlink, environment, argv, or dashboard-session fallback.
- [x] ISC-531: Exact Cloudflare and loopback OmniRoute request contracts are dependency-injected, timeout-bounded, redirect-denying, content-type-aware, and never expose reusable secrets through errors, logs, receipts, or serialized results.
- [x] ISC-532: Every production mutation writes a durable request-hash intent before the external call and a sanitized identifier/state-hash result immediately afterward; generated secrets are written only to owner-only sinks before their buffers are cleared.
- [x] ISC-533: Production recovery may use only a journal-recorded exact resource identifier or independently read-back ownership provenance; same-name discovery for service tokens, remote keys, and tunnel configuration fails closed as a manual-orphan condition.
- [x] ISC-534: Approval consumption is a one-way durable anti-replay transition invoked only after the core verifies the pinned Ed25519 approval, exact prepared-state bindings, and expiry; the ledger never independently claims authorization.
- [x] ISC-535: Hermetic adversarial tests cover malformed credentials, secret redaction, non-JSON Access failures, one-use replay, write ordering, single-attempt no-retry behavior, foreign same-name refusal, partial responses, and structural CLI exclusion.
- [x] ISC-536: GSD state, runbooks, verification wiring, Advisor review, Cato audit, and the canonical verifier distinguish locally proven adapter behavior from every external Cloudflare, hostname, Access, canary, and network-partition claim that remains open.
- [x] ISC-537: Antecedent: one snapshot separates inventory, activity, policy, execution, and authority layers.
- [x] ISC-538: Live collection uses one verified local read-only SQLite transaction with no credential, management-session, HTTP, WebSocket, or network path.
- [x] ISC-539: Collection rejects unsafe database ancestry, owner or link drift, writable modes, unsupported schema/non-WAL/hot-journal state, sidecar drift, runtime PID/package/database-binding change, Cloudflare process drift, and mixed pre/post-restart evidence.
- [x] ISC-540: Snapshot serialization omits reusable credentials, secret-bearing provider metadata, account identifiers, emails, raw bodies, and raw errors; a post-projection tripwire fails closed on sensitive keys and value shapes.
- [x] ISC-541: Compression projection reports candidate/default/active-profile settings, reports master-off as off, and reports master-on as request-dependent without mutating Context Settings.
- [x] ISC-542: Topology projection separates provider-family inventory and persisted recent/error activity while explicitly reporting current WebSocket activity as unknown.
- [x] ISC-543: CLI projection reports detected code tools and proposal-only Hermes adoption without invoking any native apply path.
- [x] ISC-544: Protocol projection reports only persisted MCP/A2A counters and declares configured state unknown without starting, enabling, registering, or contacting either protocol.
- [x] ISC-545: Dispatch projection rejects `sol`, `sol-max`, and `solmax` across worker and direct-fallback identifiers, then quantifies governed non-Codex worker, provider-family, exact-target, and native-profile diversity separately from catalog visibility.
- [x] ISC-546: Adversarial fixtures cover secret-laden rows, unsafe paths/modes/ownership, unsupported schema/non-WAL/hot-journal state, runtime/package/database/process drift, master-on/default-off/active-profile compression, and Sol aliases in workers and fallbacks.
- [x] ISC-547: Documentation, GSD state, native integration tests, and the canonical verifier consume the redacted snapshot contract without claiming external promotion.
- [x] ISC-548: The shared enrichment contract exposes a client-owned context-source projection for exactly PAI Algorithm, GSD state, and the canonical skill-cluster index.
- [x] ISC-549: Each context-source pointer resolves from one fixed non-symlink regular-file candidate beneath a separately canonicalized allowlisted root; only the installed PAI and skill roots may themselves be symlinks, while repo `.planning` must be a real contained directory; missing files, non-regular files, traversal, sibling-prefix matches, and descendant symlink escape fail closed without a tree scan.
- [x] ISC-550: Context-source resolution returns absolute path pointers only and never reads, copies, hashes, parses, summarizes, or serializes the pointed file bodies.
- [x] ISC-551: The enrichment assembler emits one deterministic compact-JSON `context-sources:` line across the shared Claude, Codex, OpenCode, and Kimi surfaces, declares `material=pointers-only`, and explicitly excludes the separate direct Command Code renderer from this bounded claim.
- [x] ISC-552: Missing or unsafe sources degrade independently to `none`; no single source failure suppresses the remaining safe pointers or throws from enrichment.
- [x] ISC-553: Adversarial tests prove body canaries, ASCII controls, Unicode line separators, envelope delimiters, target and intermediate symlink escape, sibling-prefix paths, directory/FIFO substitution, absent roots, and partial availability cannot disclose bodies, add a line, close the envelope, or produce an unsafe pointer.
- [x] ISC-554: The adopted bridge performs no OmniRoute database or settings mutation, creates no Obsidian or Notion credential, enables no MCP/A2A transport, and invokes no Hermes generation or apply path.
- [x] ISC-555: Native-integration documentation distinguishes OmniRoute's credential-bearing full-note/write-capable Context Source tools from Temperance's client-owned pointer catalog and records the later promotion gates.
- [x] ISC-556: Focused enrichment tests, the live pointer projection, structural no-mutation guards, the canonical verifier, post-build Advisor, independent Cato, and reread reconciliation pass without Sol-family dispatch or protected-runtime changes.
- [x] ISC-557: Command Code is an explicit enrichment surface, and both its documented TypeScript renderer and the actual Bash dispatch renderer obtain the pointer projection from the canonical metadata-only resolver and pure serializer rather than reimplementing pointer policy.
- [x] ISC-558: Every successful Command Code render contains exactly one line beginning `context-sources: ` with deterministic ordered compact JSON and `material:"pointers-only"`; newline-bearing task, model, ISA, and memory material cannot forge a second reserved line.
- [x] ISC-559: Full, partial, missing, unsafe, directory, FIFO, symlink-escape, and control-character source fixtures preserve independent failure isolation; unique PAI, GSD, and skill-index body canaries never appear in Command Code output.
- [x] ISC-560: Missing Bun, helper failure, malformed helper output, or any exact-one validation failure returns nonzero and prevents `command-code` launch instead of silently creating a fallback `AGENTS.md` without the governed pointer line.
- [x] ISC-561: Concurrent same-model dispatches receive distinct private workspaces and task-correct non-cross-contaminated `AGENTS.md` files whose `--add-dir` targets each contain the canonical pointer line.
- [x] ISC-562: Documentation and structural gates name direct Command Code as adopted while preserving runtime-only pointer retention, no pointer-target dereference, no OmniRoute/Hermes/Cloudflare/MCP/A2A mutation, and every external promotion gate.
- [x] ISC-563: Focused adapter/enrichment tests, live generation, protected-state hashes, the native integration gate, the canonical verifier, governed non-Codex reviews, post-build Advisor, independent Cato, and reread reconciliation pass with zero Sol-family dispatch.
- [x] ISC-564: The recurring Hermes proposal compiler performs no Keychain lookup, dashboard login, cookie/CSRF exchange, HTTP request, native endpoint call, or session creation; its receipt explicitly records zero authentication and network transport.
- [x] ISC-565: The compiler accepts only a fresh redacted local snapshot bound to OmniRoute 3.8.48, exact runtime/database identity continuity, no management contact, no mutation methods, absent Hermes state, and exactly one of each five governed combo names; it never invokes native Apply.
- [x] ISC-566: The compiler rejects every pre-existing Hermes path including empty directories and symlinks, never creates or deletes that path, and preserves then rejects any state that appears concurrently, eliminating path-based cleanup authority and its deletion race.
- [x] ISC-567: The sole retained configuration proposal uses the official Hermes custom OpenAI-compatible endpoint contract, exact loopback `/v1`, the five governed role/model bindings, and `${env:TEMPERANCE_HERMES_OMNIROUTE_API_KEY}` references without credential material; its receipt remains explicitly proposal-only, non-authorizing, and promotion-not-ready.
- [x] ISC-568: A successful run retains exactly two owner-only artifacts—the secretless proposal and metadata receipt—with no persisted source snapshot, native placeholder YAML, authentication exchange, administrator canary, plaintext key, or reusable credential material.
- [x] ISC-569: Adversarial fixtures cover poisoned auth/network binaries, existing/empty/symlinked homes, concurrent state, each missing governed combo, expired/malformed snapshots, version and identity drift, mutation/management claims, legacy cookies, and unsafe receipt roots without network or cleanup authority.
- [x] ISC-570: The previously retained `session.cookie` beneath the exact Hermes-preview receipt root was metadata-validated and deleted without reading; current and future v3 compilation plus rollback evidence re-scan the canonical root and fail unless zero such paths remain.
- [x] ISC-571: The focused Hermes and rollback suites, native integration gate, documentation continuity, full verifier, two exact non-Codex OmniRoute reviews with gateway attribution, independent Cato, and reread reconciliation pass with zero Sol-family dispatch and no Hermes Apply, EC2, Cloudflare, MCP, or A2A mutation.
- [x] ISC-572: The qualifier pins OmniRoute 3.8.48's exact `POST http://127.0.0.1:20128/api/compression/preview` contract and contains no settings, login, cookie, provider, routing, Cloudflare, MCP, A2A, Hermes, or EC2 endpoint.
- [x] ISC-573: The qualifier exposes only embedded synthetic fixture identifiers and accepts no arbitrary prompt body, prompt path, stdin body, workspace document, PAI file body, GSD file body, ISA file body, or skill body.
- [x] ISC-574: Candidate order is exactly Lite, Headroom, then minimal RTK; every other installed engine remains explicitly held and cannot enter a request through user-controlled identifiers.
- [x] ISC-575: Lite, Headroom, and minimal RTK requests use their exact native request shapes, while RTK disables custom/project filters, retains no raw output, preserves code/docstrings, and never inherits the dashboard's configured standard intensity.
- [x] ISC-576: The live qualifier has no credential input or authorization header and sends only the anonymous denial canary; browser sessions, dashboard passwords, cookies, machine tokens, inference keys, scoped bearer tokens, and reusable session material are forbidden until the established connection is cryptographically or descriptor-bound to the observed OmniRoute process with scope, expiry, and revocation evidence.
- [x] ISC-577: The unauthenticated live path sends one synthetic canary only, requires an authentication denial, classifies every candidate as held, and never mistakes route reachability for semantic qualification.
- [x] ISC-578: A successful candidate requires valid non-fallback preview output and preserves exact PAI order, GSD status, ISA identifier, tool-schema marker, code marker, receipt digest, and injection canary with no missing, duplicate, or reordered critical marker.
- [x] ISC-579: Malformed or nullable response fields never throw, the live denial transport is deadline-bounded without reading response bodies, and every implemented schema, validation, fallback, marker, order, invariant, redirect, and transport failure produces held evidence rather than partial promotion or fallback.
- [x] ISC-580: Pre/post projections remain byte-equivalent for runtime/database identity, compression policy, governed dispatch, context-source ownership, custom system prompt, local Hermes state, and Cloudflare state.
- [x] ISC-581: The retained receipt is owner-only, metadata-only, non-authorizing, and promotion-not-ready; it stores fixture identifiers and hashes plus classifications but no token, token path, prompt, original, compressed text, diff, response body, private path, or credential-like value.
- [x] ISC-582: Adversarial tests cover candidate injection, zero credential/header surfaces, authentication denial, unexpected and stalled response bodies, malformed/null response fields, fallback, invalid validation, missing/duplicate/order-drift markers, invariant drift, unsafe receipt roots, and receipt-body leakage.
- [x] ISC-583: Native documentation and GSD state keep PAI/ISA/GSD/skill clusters as semantic-policy owners, describe Context Settings as a preview transport optimization, and name process-bound authenticated transport plus the clean semantic matrix as later promotion gates; a scoped bearer token alone is explicitly insufficient.
- [x] ISC-584: The current live run records anonymous `401 AUTH_001`, the active machine-bound CLI token's management-policy rejection, all candidates held, global compression and active combo still off, custom system prompt off, and protected runtime projections unchanged.
- [x] ISC-585: Focused qualifier tests, native integration, documentation continuity, the canonical verifier, governed non-Codex reviews with distinct gateway attribution, two timed-out Advisor attempts recorded as unavailable rather than approval, independent Cato PASS, and reread reconciliation complete with zero Sol-family dispatch or protected-surface mutation.
- [x] ISC-586: External Codex workers default to Codex's supported `--ignore-user-config` execution flag while every routing-relevant model, provider, endpoint, wire, approval, sandbox, and context-limit value remains explicit at the launcher boundary.
- [x] ISC-587: Exact `TEMPERANCE_OMNIROUTE_CODEX_ISOLATED=0` is the only user-config opt-out; all other unset or nonzero values remain isolated, repository rules stay enabled, and opt-out emits an auditable warning without exposing credentials.
- [x] ISC-588: The adapter never adds `--ignore-rules`, places `--ignore-user-config` before the prompt delimiter, resolves gateway authentication independently from ignored Codex user configuration, and remains compatible with the pinned live Codex binary.
- [x] ISC-589: Each batch run directory is explicitly mode `700` and every retained plan, output, metadata, diff, summary, index, leak, and merge-report artifact is explicitly mode `600` without imposing an owner-only umask on worker-created repository or shared-cache files.
- [x] ISC-590: The parallel-dispatch contract requires self-contained external worker tasks, retains repository-local instructions, forbids dependence on ambient user PAI hooks or plugins, permits governed non-Codex OmniRoute workers, and excludes every Sol-family identifier.
- [x] ISC-591: Mocked regression tests prove default isolation, exact-zero opt-out, flag ordering, explicit effective routing configuration, zero `--ignore-rules`, private artifact modes, and no batch-wide umask blast radius.
- [x] ISC-592: A live exact `codex/gpt-5.3-codex-spark` task succeeds substantively through the default-isolated path with a unique correlation receipt, exact model attribution, no fallback, and no Sol-family execution.
- [x] ISC-593: The initial ambient-user-config Spark timeout remains rejected evidence rather than success, and timeout enlargement is not used as a substitute for launcher isolation.
- [x] ISC-594: Post-proof native status remains Sol-free and preserves provider inventory, routing policy, Context Settings, Cloudflare, Hermes, MCP, A2A, EC2, proxy, and OmniRoute runtime invariants.
- [x] ISC-595: Focused adapter and batch tests, documentation continuity, native integration, the canonical verifier, post-build Advisor, independent Cato, and reread reconciliation all pass before this bounded hardening slice is accepted.
- [x] ISC-596: The installed OmniRoute version, compression-preview CLI command, OpenAPI request contract, management classification, and loopback CLI-token policy are pinned from primary local source before any live semantic probe.
- [ ] ISC-597: Native CLI readiness distinguishes a missing client token, a rejected client token, an unauthorized route, and a successful semantic preview without printing or persisting any token value.
- [x] ISC-598: The shipped CLI token loader's empty-token condition is reproduced independently and recorded as a vendor packaging defect rather than a Temperance routing or provider failure.
- [x] ISC-599: A zero-byte TCP connection can bind the exact established reverse tuple to the expected OmniRoute PID before any request header, credential, or body byte is sent.
- [x] ISC-600: Process-bound transport remains unavailable unless the same accepted socket, listener PID, process start identity, package version, and protected runtime projection all remain exact through response completion.
- [x] ISC-601: Anti: no bearer, dashboard password, browser cookie, access token, inference key, machine-token value, arbitrary prompt, or private PAI body enters an argument, log, receipt, fixture, or repository file.
- [x] ISC-602: Anti: a valid credential on an unbound loopback connection cannot qualify Context Settings or authorize any promotion.
- [ ] ISC-603: Any future authenticated preview sends exactly one bounded POST on one verified connection with explicit content length, connection close, no redirect, no retry, finite timeout, and a bounded response parser.
- [x] ISC-604: Only fixed synthetic fixtures may qualify Lite, Headroom, and minimal RTK, in that order; every other engine and all live prompt traffic remain held.
- [x] ISC-605: Semantic qualification requires exact policy-marker preservation, injection-canary containment, receipt-schema validation, and protected pre/post projection equality for every candidate.
- [x] ISC-606: A denial or protocol anomaly produces only a mode-600 metadata receipt that is non-authorizing, body-free, token-free, and explicit that compression remains off.
- [ ] ISC-607: Listener substitution, PID mismatch or reuse, runtime drift, malformed headers, chunk overflow, redirect, retry, response stall, and state mutation all fail closed in adversarial tests.
- [x] ISC-608: Documentation and GSD state identify the shipped CLI-token defect, preserve OmniRoute as transport owner, preserve PAI/ISA/GSD/skill clusters as semantic-policy owners, and keep process-bound semantic promotion closed.
- [x] ISC-609: Governed non-Codex reviews use exact OmniRoute model attribution, no fallback, no tools, private artifacts, finite spend, and zero Sol-family execution; unsupported OS claims remain untrusted until locally reproduced.
- [x] ISC-610: The implementation reuses native OmniRoute contracts and installed primary source where possible, adds no second compression engine, and does not patch the installed package in place.
- [x] ISC-611: Focused tests, native integration, documentation continuity, syntax, diff hygiene, and the canonical full verifier pass without changing provider routing, compression settings, Cloudflare, Hermes, MCP/A2A, EC2, or protected runtime identity.
- [ ] ISC-612: Pre-build Advisor, mandatory Forge implementation, post-build Advisor, independent Cato audit, and reread reconciliation complete before this transport-readiness slice is accepted.
- [x] ISC-613: The relocation destination root resolves exactly to `/Volumes/madara/2026/Projects/`.
- [x] ISC-614: The relocation portfolio allowlist contains exactly `thoughtseed` and `tryambakam-noesis`.
- [ ] ISC-615: Anti: a source or destination folder outside the two allowed portfolios changes during inventory, plan, apply, verification, or rollback.
- [x] ISC-616: Thoughtseed Labs remains at its exact current path through every relocation operation.
- [ ] ISC-617: Every repository, worktree, or vault boundary discovered by metadata-only inspection beneath the two scoped source portfolios receives one closed-vocabulary migration classification.
- [x] ISC-618: Every standalone Git repository is represented as an independent migration unit.
- [ ] ISC-619: Every `.git` pointer entry is classified as a linked worktree rather than a standalone repository.
- [ ] ISC-620: Every nested remote-bearing Git repository is classified as an independent nested migration unit.
- [x] ISC-621: Every unknown or non-repository entry is left unchanged and reported with a named held reason.
- [ ] ISC-622: Every migration manifest records lifecycle as metadata.
- [ ] ISC-623: Every migration manifest records repository type as metadata.
- [x] ISC-624: Every migration manifest binds one stable logical project ID.
- [x] ISC-625: Every migration manifest records canonical old path, canonical new path, and verified GitHub identity when available.
- [x] ISC-626: Every migration preflight records the current branch or detached-branch state.
- [x] ISC-627: Every migration preflight records the exact HEAD object ID.
- [ ] ISC-628: Every migration preflight records a deterministic refs digest.
- [x] ISC-629: Every migration preflight records canonical remote names and URLs without contacting a remote.
- [ ] ISC-630: Every migration preflight records the complete Git worktree graph.
- [ ] ISC-631: Every migration preflight records submodule status.
- [ ] ISC-632: Every migration preflight records Git LFS availability and local state.
- [ ] ISC-633: Every migration preflight records a deterministic untracked-file inventory.
- [ ] ISC-634: Every migration preflight records the ignored-file classification policy and result.
- ISC-635: [DROPPED — native-session link manifests were removed from the relocation critical path; see Decision 2026-08-03 18:32.]
- ISC-636: [DROPPED — Paseo reconciliation was removed from the relocation critical path; see Decision 2026-08-03 18:32.]
- [x] ISC-637: Anti: a generated manifest, capsule, report, or receipt contains credentials, auth headers, cookies, raw prompts, raw responses, or transcript bodies.
- [ ] ISC-638: A live apply operation addresses exactly one explicitly approved standalone canary repository.
- [ ] ISC-639: A live apply operation proves source and destination have the same device identity before mutation.
- [ ] ISC-640: A destination collision aborts before mutation and names the conflicting canonical path.
- [ ] ISC-641: Directory rename executes only while the source identity and every approved preflight digest remain exact.
- ISC-642: [DROPPED — the seven-file session-bearing capsule was replaced by the compact six-file packet-linked capsule in ISC-699.]
- [ ] ISC-642.1: Successful relocation creates a canonical handoff under the repository's portfolio-specific knowledge authority whose digest is referenced by the old-path capsule.
- [ ] ISC-643: Post-move Git porcelain-v2 status matches the approved expected state.
- [ ] ISC-644: Post-move HEAD matches the preflight HEAD object ID.
- [ ] ISC-645: Post-move refs digest matches the preflight refs digest.
- [ ] ISC-646: Post-move remotes match the preflight remote map byte-for-byte after canonical serialization.
- [ ] ISC-647: Post-move worktree graph matches the approved expected graph.
- [ ] ISC-648: Post-move repository filesystem hashes match the preflight integrity manifest.
- ISC-649: [DROPPED — native predecessor/successor mapping was replaced by client-neutral checkpoint pickup; see ISC-700..ISC-703.]
- ISC-650: [DROPPED — provider continuation proof was replaced by a fresh-client packet canary; see ISC-700..ISC-703.]
- [ ] ISC-651: Every completed operation emits a digest-bound receipt with state, evidence paths, capsule manifest, and exact rollback command.
- [ ] ISC-652: Rollback refuses any capsule, repository, destination, or old-path drift without removing bytes.
- [ ] ISC-653: Successful rollback restores the exact old repository path and preflight Git state.
- [x] ISC-654: Anti: relocation executes a network Git operation or mutates a remote.
- [x] ISC-655: Anti: relocation prunes, compacts, garbage-collects, or rewrites the outer vault Git history.
- [x] ISC-656: Historical outer-vault Git debloat is documented as a separate backup-and-approval phase.
- [ ] ISC-657: The known outer/nested dual-tracking overlap is reported separately from ignore-rule changes.
- [ ] ISC-658: Concurrent relocation attempts for the same repository are serialized by one exclusive lock.
- [x] ISC-659: Relocation receipt directories use mode `0700` and receipt files use mode `0600`.
- [x] ISC-660: Dry-run changes zero source, destination, Git, portfolio-registry, Paseo, and provider-home bytes.
- [x] ISC-661: Every managed repository packet contains `PROJECT.md`.
- [x] ISC-662: Every managed repository packet contains `.project/project.yaml`.
- [x] ISC-663: Every managed repository packet contains `.project/HANDOFF.md`.
- [ ] ISC-664: Relocation preserves an existing `AGENTS.md` until a separate adapter review approves changes.
- [ ] ISC-665: Relocation preserves an existing `CLAUDE.md` until a separate adapter review approves changes.
- [x] ISC-666: Every `.project/project.yaml` validates against one closed schema.
- [x] ISC-667: Every `.project/project.yaml` records one stable project ID.
- [x] ISC-668: Every `.project/project.yaml` records exactly one allowlisted portfolio.
- [x] ISC-669: Every `.project/project.yaml` records the verified GitHub repository identity when available.
- [ ] ISC-670: Every `.project/project.yaml` records one portfolio-authorized knowledge reference.
- [x] ISC-671: Every `.project/project.yaml` declares Codex as the default local interactive client.
- [x] ISC-672: Every `.project/project.yaml` declares one closed-vocabulary approval profile.
- [x] ISC-673: Every routed `.project/project.yaml` declares `temperance-omniroute` as routing authority.
- [x] ISC-674: Every routing lane named by `.project/project.yaml` belongs to the approved `te-*` lane set.
- [x] ISC-675: Every `.project/project.yaml` records one setup command or an explicit not-applicable value.
- [x] ISC-676: Every `.project/project.yaml` records one test command or an explicit not-applicable value.
- [x] ISC-677: Every `.project/project.yaml` records one verification command.
- [x] ISC-678: Anti: a project packet contains a secret, credential, provider account value, native session identifier, prompt body, response body, transcript locator, or machine-local checkout path.
- [ ] ISC-679: Every `.project/HANDOFF.md` records one current objective.
- [x] ISC-680: Every `.project/HANDOFF.md` records one base commit.
- [x] ISC-681: Every `.project/HANDOFF.md` records one branch or detached-state value.
- [ ] ISC-682: Every `.project/HANDOFF.md` records one clean-or-dirty working-tree value.
- [ ] ISC-683: Every `.project/HANDOFF.md` records completed work.
- [ ] ISC-684: Every `.project/HANDOFF.md` records current decisions.
- [x] ISC-685: Every `.project/HANDOFF.md` records one exact next action.
- [ ] ISC-686: Every `.project/HANDOFF.md` records blockers or an explicit none value.
- [ ] ISC-687: Every `.project/HANDOFF.md` records the latest verification result.
- [ ] ISC-688: Every `.project/HANDOFF.md` records one update timestamp.
- [x] ISC-689: Codex is represented only as the default local interactive governance rail.
- [x] ISC-690: OmniRoute project metadata contains no project-state, task-state, handoff-state, or native-session-state fields.
- [ ] ISC-691: The Thoughtseed authority profile retains Hermes as remote and scheduled execution authority.
- [x] ISC-692: Anti: the Tryambakam authority profile contains a Thoughtseed TeamForge, Cambium, Hermes, Telegram, Plexus, or operational Paperclip authority identifier.
- [ ] ISC-693: The Kimi pickup adapter reads the canonical packet at orchestrator dispatch time.
- [ ] ISC-694: Anti: the Kimi pickup adapter emulates a prompt-submit hook.
- [ ] ISC-695: Anti: the Tryambakam adapter implements a second Temperance classifier or preference store.
- [ ] ISC-696: Tauri is never represented as a scheduling authority.
- [x] ISC-697: Every Thoughtseed relocation record resolves beneath the ratified Thoughtseed Labs registry root.
- [x] ISC-698: Every Tryambakam relocation record resolves beneath the ratified `_System/10865xseed/projects/` registry root.
- [ ] ISC-699: Successful relocation creates the exact six-file packet-linked capsule at the old project path.
- [x] ISC-700: Every old-path capsule records the exact project-packet digest.
- [x] ISC-701: The pure packet resolver resolves the stable project ID from the packet fixture.
- [x] ISC-702: The pure packet resolver resolves the exact next action from the packet fixture.
- [x] ISC-703: The pure packet resolver uses zero provider or transcript input.
- [x] ISC-704: Anti: production relocation code traverses an unapproved provider-home path or any native session-store path.
- [x] ISC-705: Anti: production relocation code invokes a Paseo import, reconciliation, registration, or mutation path.
- [ ] ISC-706: Dashboard call counts, rank, latency, model counts, or node state cannot authorize a routing promotion.
- [x] ISC-707: `hermes-aws-ts` remains held until an approved path-consumer dependency manifest exists.
- [x] ISC-708: A cross-portfolio authority reference fails packet validation closed.
- [ ] ISC-709: Every canary manifest records one bounded old-path consumer audit.
- [ ] ISC-710: Every unresolved runtime old-path consumer holds the repository before mutation.
- [x] ISC-711: A competing stable-ID or GitHub-identity claim in the other portfolio registry fails before mutation.
- [x] ISC-712: Relocation leaves GitHub remote ownership and collaboration state unchanged.
- [x] ISC-713: Anti: relocation creates a symlink fallback at the old project path.
- [ ] ISC-714: Every managed repository packet contains `.project/CONTEXT.md`.
- [ ] ISC-715: Anti: `.project/CONTEXT.md` contains copied corpora, live task state, or native session state.
- [ ] ISC-716: Anti: the relocation transaction creates or edits a file inside the repository checkout.
- [ ] ISC-717: The authority profile does not represent ChatGPT web as a local-filesystem or OmniRoute execution client.
- [ ] ISC-718: Every Thoughtseed packet project ID matches a verified TeamForge project ID.
- [ ] ISC-719: Every routed packet declares one portfolio-allowlisted OmniRoute deployment profile.
- [ ] ISC-720: An unverified TN OmniRoute deployment profile fails routed delegation closed.
- [ ] ISC-721: Every routed packet records one secretless credential-scope reference.
- [ ] ISC-722: Every inventory record reports proposed portfolio, mapping evidence, and ambiguity state.
- [ ] ISC-723: Every repository with conflicting path, packet, GitHub, or knowledge portfolio evidence remains held.
- [ ] ISC-724: A live fresh-client canary resolves the same stable project ID as the pure resolver.
- [ ] ISC-725: A live fresh-client canary resolves the same exact next action as the pure resolver.
- [ ] ISC-726: A live fresh-client canary uses no resume, import, native session identifier, or prior project transcript.
- [x] ISC-727: The selected registry repository has a clean or owner-checkpointed exact baseline before entry creation.
- [x] ISC-728: The transaction revalidates canonical parent paths plus source device/inode immediately before rename.
- [x] ISC-729: A source-replacement or parent/path-swap injection aborts before an unintended rename.
- [x] ISC-730: The Thoughtseed relocation registry root is ratified as `thoughtseed-labs/20-operations/project-management/relocation-registry/thoughtseed/<repository>/`.
- [x] ISC-731: The Tryambakam registry root is ratified as `/Volumes/madara/2026/twc-vault/_System/10865xseed/projects/<repository>/`.
- [ ] ISC-732: Every Thoughtseed reconciliation entry is keyed by the verified TeamForge project ID.
- [x] ISC-733: Every new Thoughtseed reconciliation entry begins with a `reconciling` transition event.
- [ ] ISC-734: Every reconciled Thoughtseed main project record stores the verified current repository path.
- [ ] ISC-735: Every reconciled Thoughtseed main project record stores one non-null `relocation_evidence_ref`.
- [ ] ISC-736: The read-back digest of the updated main project record matches its closure manifest.
- [x] ISC-737: Every closed Thoughtseed reconciliation entry projects status `reconciled` from its transition log.
- [x] ISC-738: Every closed Thoughtseed reconciliation entry records `closed_at`.
- [x] ISC-739: Every closed Thoughtseed reconciliation entry records `canonical_project_record`.
- [x] ISC-740: Every closed Thoughtseed reconciliation entry records `closure_manifest_digest`.
- [x] ISC-741: Every closed Thoughtseed reconciliation entry retains the owner-ratification evidence.
- [ ] ISC-742: Every closed Thoughtseed reconciliation entry retains its integrity and rollback evidence.
- [x] ISC-743: Anti: reconciliation closure deletes, moves, or flattens a Thoughtseed relocation-registry entry.
- [ ] ISC-744: Anti: a reconciled main project record duplicates historical old-path or relocation-event fields from the evidence registry.
- [x] ISC-745: Every `relocation_evidence_ref` is the exact `sha256:<digest>` identity of the retained evidence.
- [ ] ISC-746: Every reconciled main project record stores the evidence lookup path separately from `relocation_evidence_ref`.
- [x] ISC-747: Every reconciliation status transition appends an event rather than rewriting a prior event.
- [ ] ISC-748: Closure repository identity uses HEAD and canonical ref-set equality rather than Git packfile-byte equality.
- [x] ISC-749: Every reconciled transition records the relocation actor separately from the owner ratifier.
- [x] ISC-750: The read-only report enumerates every immediate Thoughtseed source candidate in the approved source root.
- [x] ISC-751: The read-only report enumerates every immediate Tryambakam source candidate in the approved source root.
- [ ] ISC-752: Every inventory row passes the repository-boundary and local-Git-evidence schema check.
- [ ] ISC-753: Every inventory row passes the proposed-portfolio, evidence, and ambiguity schema check.
- [x] ISC-754: The report identifies the Cambium Portfolio Workbench implementation and its repository-data source.
- [x] ISC-755: A read-only browser probe records the authenticated Workbench route's rendered state.
- [x] ISC-756: Every conflicting or insufficient portfolio classification in the report is explicitly held.
- [x] ISC-757: Anti: this inventory stage mutates any scanned checkout beyond the explicit Temperance ISA update, or moves, deletes, clones, rewrites, registers, imports, or mutates any session, Paseo workspace, destination repository, or external service.
- [x] ISC-758: A filesystem path is never treated as the identity of a repository.
- [x] ISC-759: Every future approved local destination repository basename is normalized under one shared convention before any rename or move.
- [x] ISC-760: The normalized destination repository-directory grammar is ratified before any concrete slug proposal, rename, or move.
- [x] ISC-760.1: ASCII full stop U+002E is not representable at a non-boundary position in a canonical local destination repository basename.
- [x] ISC-760.2: The eventual complete canonical grammar excludes every ASCII uppercase letter U+0041–U+005A at every position of the exact `<repository>` segment.
- [x] ISC-760.3: The eventual complete canonical grammar's full ASCII-lowercase repertoire-inclusion requirement is ratified for the exact `<repository>` segment.
- [x] ISC-760.4: The eventual complete canonical grammar permits every ASCII digit U+0030–U+0039 as a repertoire member for the exact `<repository>` segment.
- [x] ISC-760.5: The eventual complete canonical grammar permits ASCII hyphen-minus U+002D as a repertoire member for the exact `<repository>` segment.
- [x] ISC-760.6: The eventual complete canonical grammar excludes ASCII low line U+005F from the exact `<repository>` repertoire.
- [x] ISC-760.7: The eventual complete canonical grammar admits only explicitly permitted code points for the exact `<repository>` segment; unruled code points are inadmissible until separately admitted.
- [x] ISC-760.8: The eventual complete canonical grammar separately ratifies whether ASCII hyphen-minus U+002D may occupy the first code point of an exact `<repository>` segment of length at least two.
- [x] ISC-760.9: The eventual complete canonical grammar separately ratifies whether ASCII hyphen-minus U+002D may occupy the last code point of an exact `<repository>` segment of length at least two.
- [x] ISC-760.10: The eventual complete canonical grammar separately ratifies whether the exact one-code-point `<repository>` segment `-` is admissible.
- [x] ISC-760.11: The eventual complete canonical grammar separately ratifies whether any multi-code-point exact depth-one `<repository>` segment containing U+002D is admissible beyond the singleton decision.
- [x] ISC-760.12: The eventual complete canonical grammar separately ratifies whether the multi-codepoint admission permission composes by intersection with, rather than repeals, prior positional prohibitions.
- [x] ISC-760.13: The eventual complete canonical grammar separately ratifies whether normalization occurs before or after positional projection and validation.
- [x] ISC-760.14: The eventual complete canonical grammar separately ratifies whether normalization is validity-preserving for already accepted raw names.
- [x] ISC-760.15: The eventual complete canonical grammar separately ratifies the identity-key projection basis after normalization validity resolves.
- [x] ISC-760.16: The eventual complete canonical grammar separately ratifies the presentation projection basis after identity-key projection resolves.
- [x] ISC-760.17: The eventual complete canonical grammar separately ratifies collision handling after identity-key projection resolves.
- [x] ISC-760.18: The eventual complete canonical grammar separately ratifies the normalization algorithm and post-normalization invariant after validity closure resolves.
- [x] ISC-760.19: The eventual complete canonical grammar separately ratifies interior U+002D flanking and adjacency after multi-codepoint admission and precedence resolve.
- [x] ISC-761: `docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md` exists.
- [x] ISC-762: The audit records the current tracked worktree change count from `git diff --name-status`.
- [x] ISC-763: The audit records that `~/.temperance_engine/product` resolves to the current repository root.
- [x] ISC-764: The audit records the sole live-router-only filename reported by the repository/runtime directory diff.
- [x] ISC-765: The audit records the manifest-bridge source/runtime drift direction.
- [x] ISC-766: The audit records the enrichment source/runtime drift and local-only `atlasRecall.ts` surface.
- [x] ISC-767: The audit records byte parity for the four installed Codex/Claude hook files tested.
- [x] ISC-768: The audit records the installed-skill support files absent from the repository skill package.
- [x] ISC-769: The audit contains an explicit `COPY` classification table.
- [x] ISC-770: The audit contains an explicit `TRANSFORM` classification table.
- [x] ISC-771: The audit contains an explicit `REGENERATE` classification table.
- [x] ISC-772: The audit contains an explicit `NEVER-SHIP` classification table.
- [x] ISC-773: Anti: the audit contains no credential, token, cookie, private key, database body, or secret value.
- [x] ISC-774: The audit defines seven dependency-ordered GSD workflow stages without hard-coding continuing phase numbers.
- [x] ISC-775: Every proposed GSD workflow stage names its entry command.
- [x] ISC-776: Every proposed GSD workflow stage names its durable output artifact.
- [x] ISC-777: Every proposed GSD workflow stage names at least one binary completion gate.
- [x] ISC-778: Every proposed GSD workflow stage records its immediate dependency.
- [x] ISC-779: The workflow preserves a ratification gate before milestone activation.
- [x] ISC-780: The workflow records the config/STATE/ROADMAP milestone-authority disagreement and requires reconciliation before activation.
- [x] ISC-781: The workflow maps README, Quickstart, architecture, rollback, security, and contributor documentation updates.
- [x] ISC-782: The workflow maps installer, hook, skill, service, and mutable-state lifecycle updates.
- [x] ISC-783: The workflow maps source parity, sandbox install, secret scan, and runtime smoke tests.
- [x] ISC-784: The workflow defines reviewable commit slices rather than one bulk synchronization commit.
- [x] ISC-785: The workflow defines one empty-home sandbox installation probe.
- [x] ISC-786: The workflow defines one no-voice or non-macOS compatibility probe.
- [x] ISC-787: The workflow defines one uninstall or rollback restoration probe.
- [x] ISC-788: The workflow defines one installed-file provenance or checksum probe.

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
| ISC-58 | unit | open circuit excludes backend | pass in live enforce mode | circuit-breaker test + host status |
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
| ISC-121 | integration | OpenCode auto model completes a fresh session | pass (canary `TEMPERANCE_OPENCODE_OK` + real `surface:"opencode"` decision-log entries, 2026-07-24) | OpenCode CLI |
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
| ISC-188 | scope | connector names appear only on human-readable terminal-safe surfaces | no machine-protocol naming | grep + build/test |
| ISC-189 | manifest | dispatch workers include the exact Spark identifier | one match | jq |
| ISC-190 | manifest | Spark worker capability equals low-latency targeted coding | exact value | jq |
| ISC-191 | manifest | Spark worker cost posture names its separate preview limit | exact value | jq |
| ISC-192 | lifecycle | te-dispatch round-robin model list starts with Spark | first model match | shell dry-run fixture |
| ISC-193 | lifecycle | te-dispatch model list contains Spark | exactly one | jq |
| ISC-194 | lifecycle | te-dispatch strategy is round-robin | exact value | jq |
| ISC-195 | safety | te-dispatch concurrencyPerModel is positive and bounded | 1..4 | jq |
| ISC-196 | safety | te-dispatch queueTimeoutMs is positive and finite | 1..60000 | jq |
| ISC-197 | safety | te-dispatch queueDepth is positive and finite | 1..100 | jq |
| ISC-198 | resilience | te-dispatch maxRetries equals zero | exact value | jq |
| ISC-199 | resilience | te-dispatch failoverBeforeRetry is true | true | jq |
| ISC-200 | telemetry | te-dispatch trackMetrics is true | true | jq |
| ISC-201 | catalog | fleet script preflights exact Spark model | exact grep | shell test |
| ISC-202 | lifecycle | dry-run prints te-dispatch round-robin body | exact payload | shell fixture test |
| ISC-203 | safety | activeCombo before and after apply match | byte-equal JSON | shell fixture test |
| ISC-204 | lifecycle | changed existing combo produces update plan | exact action | shell fixture test |
| ISC-205 | rollback | rollback restores snapshot body for updated combo | canonical body match | shell fixture test |
| ISC-206 | resolver | live dispatch catalog retains Spark candidate | selected contains model | Bun test |
| ISC-207 | resolver | catalog without Spark omits Spark candidate | selected excludes model | Bun test |
| ISC-208 | fallback | direct CLI fallback backend list is unchanged | exact backend order | Bun test |
| ISC-209 | skill | fleet protocol uses omniroute plus te-dispatch | exact strings | grep |
| ISC-210 | safety | fleet protocol requires worktrees for mutating fanout | exact guard text | grep |
| ISC-211 | docs | runtime doc states 128k and text-only | both matches | grep |
| ISC-212 | docs | runtime doc states separate preview rate limit | match | grep |
| ISC-213 | docs | runtime doc differentiates selection and fallback | both terms | grep |
| ISC-214 | anti | planner/reason/validate model lists exclude Spark | zero matches | jq + shell dry-run |
| ISC-215 | observability | batch summary names backend and model per task | every task attributed | dispatch fixture |
| ISC-216 | regression | full verification includes Spark fleet assertions | zero failures | verify-all |
| ISC-217 | adapter | `te-dispatch` passes `model_context_window=128000` to Codex | exact argv | dispatch fixture |
| ISC-218 | adapter | Spark fleet compaction limit is positive and below 128k | exact argv + validation | dispatch fixture |
| ISC-219 | regression | non-Spark adapter default remains 200k/170k | exact argv | adapter fixture |
| ISC-220 | live | apply governed fleet and run attributed canary | te-dispatch live; provider/model recorded | OmniRoute host |
| ISC-221 | source | supplied vault inventory owns membership | exact source recorded | receipt inspection |
| ISC-222 | inventory | portfolio statistics retain eighty-seven records | exact count and tiers | jq |
| ISC-223 | filesystem | each present record resolves to its exact Git root | zero root mismatches | Git probe |
| ISC-224 | registry | every valid canonical path has a Paseo project | zero missing | live workspace readback |
| ISC-225 | registry | every configured project has an exact-path workspace | zero missing | live workspace readback |
| ISC-226 | safety | existing workspace IDs remain present | exact IDs | pre/post diff |
| ISC-227 | concurrency | lock and immediate live recheck prevent duplicate creation | one create across overlapping applies | concurrent fixture |
| ISC-228 | identity | same-remote distinct paths remain separate | both paths present | receipt readback |
| ISC-229 | naming | created workspace title is group-qualified | exact title | fixture receipt |
| ISC-230 | scope | all present local-only repositories register | exact count | receipt filter |
| ISC-231 | scope | inventory-listed internal archives are retained | paths present | receipt filter |
| ISC-232 | scope | global archives and remote-only records are absent | zero matches | inventory + receipt |
| ISC-233 | safety | no provider session import occurs | zero import command | source test |
| ISC-234 | safety | no agent or model request occurs | zero run/create-agent command | source test |
| ISC-235 | safety | daemon process and configuration remain continuous | no restart command | source + uptime |
| ISC-236 | safety | repository statuses are unchanged | exact pre/post status digests | live probe |
| ISC-237 | recovery | registry snapshot precedes first create | ordered events | fixture test |
| ISC-238 | preview | dry-run reports exact action counts | exact summary | fixture test |
| ISC-239 | idempotency | second apply creates zero; overlap fails closed | zero create calls | fixture + live rerun |
| ISC-240 | validation | invalid paths produce named non-mutating errors | exact errors | fixture + live receipt |
| ISC-241 | safety | same-path task workspaces are reported and preserved | duplicate count and IDs | live receipt + agent list |
| ISC-242 | evidence | receipt covers every inventory record | eighty-seven outcomes | jq |
| ISC-243 | docs | guide explains scope, lifecycle, settings, and remote boundary | sections present | docs review |
| ISC-244 | provider | every preference model exists in live provider catalog | five valid targets | provider list probe |
| ISC-245 | preferences | five role categories are configured | exact keys | jq |
| ISC-246 | routing | implementation maps to Spark-enabled dispatch portfolio | exact provider string | jq |
| ISC-247 | routing | planning, research, and audit portfolios differ | three distinct values | jq |
| ISC-248 | routing | UI maps to native Claude Fable | exact provider string | jq |
| ISC-249 | remote | clients reuse daemon-owned project/workspace registry | daemon readback | CLI + docs |
| ISC-250 | regression | focused tests and live idempotency readback pass | zero failures/creates | Bun + Paseo CLI |
| ISC-251 | inventory | redacted connection count matches OmniRoute readback | exact count | shell + jq |
| ISC-252 | roles | three newly added provider owners map explicitly | exact roles | jq |
| ISC-253 | safety | unknown owner resolves ineligible | false | fixture test |
| ISC-254 | schema | capability manifest contains S, A, B definitions | exact keys | jq |
| ISC-255 | taxonomy | capability and readiness keys are separate | no overlap | fixture test |
| ISC-256 | profiles | automatic, Native, Algorithm profiles exist | three profiles | jq |
| ISC-257 | config | default model is Temperance automatic relay | exact string | jq |
| ISC-258 | config | enabled providers equal governed pair | exact array | jq |
| ISC-259 | containment | resolved OpenCode model count is bounded | at most fourteen | opencode models |
| ISC-260 | containment | resolved providers omit raw NVIDIA and Hugging Face | zero models | opencode models |
| ISC-261 | cost | small model is declared B-tier | exact membership | jq |
| ISC-262 | skills | two mode skills are discoverable | files present | test |
| ISC-263 | secret hygiene | mode skills contain no secret or catalog patterns | zero matches | rg |
| ISC-264 | agents | mode profiles bind declared coordinator aliases | exact models | jq |
| ISC-265 | session | profile declares stable coordinator binding | immutable policy | fixture test |
| ISC-266 | cost | dispatch starts from B-tier worker set | exact tier | fixture test |
| ISC-267 | escalation | transition graph permits only upward tier movement | exact edges | fixture test |
| ISC-268 | downgrade | downgrade requires new task identifier | rejection reason | fixture test |
| ISC-269 | receipt | required decision fields validate | zero omissions | fixture test |
| ISC-270 | receipt | resolved provider and model validate for buffered and streaming success | both present | fixture test + live stream |
| ISC-465 | recovery | Mac proxy promotion retry and rollback | transient retry plus exact restore | sandbox test + live launchd probe |
| ISC-466 | circuit freshness | unresolved circuit outlives signal TTL | open excluded; expired cooldown half-open | Bun + shell tests |
| ISC-467 | promotion recovery | host mode promotion and rollback | deterministic preflight; exact restore; drift rejection | shell test + receipt |
| ISC-468 | live enforcement | fresh OmniRoute-first host plan | health at least 0.8; closed circuit; selected first | controller status + canary receipt |
| ISC-469 | concurrency and rollback | half-open lease and immediate override | one claim by default; explicit off wins | shell tests |
| ISC-470 | Cloudflare evidence | versioned sanitized output and exact read command | no identity or token fields; only whoami/fixture | Bun test |
| ISC-471 | authority separation | authentication and labels versus resource-bound deployment powers | ready stays false without resource/zone proof | Bun test + live read |
| ISC-472 | Cloudflare negative controls | missing scopes, account, hostname | every partial case not ready | Bun test |
| ISC-473 | Cloudflare non-mutation | preflight source and fake Wrangler log | zero write/API mutation commands | Bun test + source review |
| ISC-474 | A2A evidence binding | installed sources and package version | complete SHA-256-bound indicators; no readiness claim | Bun test + live read |
| ISC-475 | A2A auth indicators | RPC plus four companion route guards | unsafe installed source remains false | Bun test + installed source |
| ISC-476 | A2A ownership/protocol indicators | owner enforcement, allowlist, POST create | unsafe installed source remains false | Bun test + installed source |
| ISC-477 | A2A receipt claims | digest, version, mode, TTL, denials, CLI create | claims may pass; readiness remains false without authenticity | Bun test |
| ISC-478 | A2A promotion authority | perfect indicator and receipt-claim fixture | authorization remains false | Bun test |
| ISC-479 | repository regression | complete canonical suite | zero exit; no remote/A2A mutation | `scripts/verify-all.sh` |
| ISC-271 | resilience | every eligible model names failure domain | full coverage | fixture test |
| ISC-272 | resilience | A fallback differs from paired S domain | no collision | fixture test |
| ISC-273 | relay | explicit model reaches OmniRoute unchanged | exact model | proxy test |
| ISC-274 | startup | dangling profile/helper reference fails validation | nonzero exit | fixture test |
| ISC-275 | recovery | config backup predates write and restores bytes | exact digest | sandbox test |
| ISC-276 | recovery | combo mutation has identity-bound snapshot rollback | exact restore | fixture test |
| ISC-277 | safety | activeCombo is identical before and after | exact value | live readback |
| ISC-278 | promotion | evidence gate requires four evidence classes | all required | fixture test |
| ISC-279 | safety | candidate without receipt is ineligible | false | fixture test |
| ISC-280 | anti-regression | classifier count and ownership remain unchanged | one classifier | rg + tests |
| ISC-281 | regression | focused suite passes | zero failures | Bun + shell |
| ISC-282 | live | fresh automatic OpenCode request succeeds | valid response | opencode run |
| ISC-283 | startup | plugin loader emits no named-export failures | zero errors | opencode debug skill |
| ISC-284 | freshness | expired cache plus catalog failure denies request | rejection | Bun test |
| ISC-285 | containment | resolved identifiers equal manifest identifiers | exact set | validation script |
| ISC-286 | context | each custom alias has numeric context/output limits | full coverage | jq |
| ISC-287 | promotion | candidate coordinator has zero default references | zero matches | validation script |
| ISC-288 | recursion | worker depth over configured maximum is rejected | rejection | Bun test |
| ISC-289 | recovery | direct CLI executes with both relay URLs unavailable | terminal receipt | shell probe |
| ISC-290 | rollback | partial-state rollback restores receipt-bound artifacts | exact digests | sandbox test |
| ISC-291 | local | resolved Mac model count | fourteen | `opencode models` |
| ISC-292 | local | governed session validation | 8 agents, 2 providers, depth 1 | config validator |
| ISC-293 | local | default model readback | `temperance/temperance-auto` | jq |
| ISC-294 | local | direct and automatic doctor gates | both true | doctor JSON |
| ISC-295 | local | rollback bundle metadata | exists, mode 600 | stat |
| ISC-296 | AWS | caller identity | approved account and principal | STS |
| ISC-297 | AWS | named instance inventory | exactly one | EC2 API |
| ISC-298 | AWS | managed-instance state | Online | SSM API |
| ISC-299 | host | operating system and architecture | Ubuntu 24.04, x86_64 | SSM shell |
| ISC-300 | Hermes | unit file digests | three captured hashes | sha256sum |
| ISC-301 | Hermes | unit lifecycle baseline | exact states and timestamps | systemctl show |
| ISC-302 | OpenCode | operator binary | version 1.17.11 | sudo -u ubuntu |
| ISC-303 | OpenCode | pre-rollout picker count | twenty-two | opencode models |
| ISC-304 | gateway | OmniRoute service | active 3.8.48 | systemctl + CLI |
| ISC-305 | gateway | authenticated catalog count | 281 | curl + jq |
| ISC-306 | tiers | candidate capability probes | content and forced tools | curl canaries |
| ISC-307 | topology | routing authority | EC2 local | service/config inspection |
| ISC-308 | release | router deployment target | immutable directory | stat |
| ISC-309 | ownership | config target user | ubuntu | receipt paths |
| ISC-310 | containment | enabled providers | governed pair | jq |
| ISC-311 | containment | resolved model count | at most fourteen | opencode models |
| ISC-312 | containment | raw OpenCode provider models | zero | opencode models |
| ISC-313 | default | automatic profile | exact model | jq |
| ISC-314 | cost | small model capability | B and live-probed | manifest + canary |
| ISC-315 | skills | mode skill resolution | two present | file read |
| ISC-316 | agents | governed roles and depth | exact manifest | validator |
| ISC-317 | service | relay lifecycle | active and enabled | systemctl |
| ISC-318 | network | listeners | loopback only | ss |
| ISC-319 | secret | key delivery | protected credential file | systemctl + stat |
| ISC-320 | isolation | service groups | excludes Hermes | id |
| ISC-321 | isolation | Hermes environment read | denied | sudo probe |
| ISC-322 | live | automatic session before S promotion | structured S-tier-unavailable | opencode run |
| ISC-323 | live | Native session | valid content | opencode run |
| ISC-324 | live | Algorithm capability before S promotion | visible failure and zero downgrade | opencode/curl canary |
| ISC-325 | live | B worker | valid content | opencode run |
| ISC-326 | telemetry | route receipt fields | five bound fields | JSONL jq |
| ISC-327 | recovery | bundle receipt | mode 600 and ordered | jq + stat |
| ISC-328 | recovery | rollback rehearsal | exact pre-hash | sha256sum |
| ISC-329 | Hermes | unit bytes after rollout | exact baseline | sha256sum |
| ISC-330 | Hermes | lifecycle after rollout | exact baseline | systemctl show |
| ISC-331 | network | security-group ingress | no relay ports | EC2 API |
| ISC-332 | anti-regression | Hermes-owned write set | zero paths | before/after snapshot |
| ISC-333 | promotion | genuine S provider authentication | content and forced tool pass | provider canaries |
| ISC-334 | gateway | Algorithm combo authorization | admin snapshot plus applied body | OmniRoute lifecycle |
| ISC-335 | safety | automatic readiness gate | enabled only with promotion evidence | systemd plus receipt |
| ISC-336 | live | promoted Algorithm session | S-tier attribution and zero downgrade | OpenCode canary |
| ISC-337 | inventory | redacted authenticated upstream identities | complete stable set | live OmniRoute probe |
| ISC-338 | contract | backing-input count semantics | explicit source and predicate | payload plus compiled-projection inspection |
| ISC-339 | telemetry | node activity source | route attempts, not adapter config | fixture plus live trace |
| ISC-340 | arithmetic | headline count | equals documented predicate | payload reduction test |
| ISC-341 | boundary | OpenCode adapters versus upstreams | disjoint identity classes | config plus payload comparison |
| ISC-342 | containment | aliases and combos excluded | zero provider inflation | fixture test |
| ISC-343 | visibility | configured/historical providers without current traffic | visible as idle nodes | screenshot plus projection inspection |
| ISC-344 | parity | rendered and backing topology | direct identity/state derivation | compiled-projection inspection |
| ISC-345 | regression | two adapters, larger upstream inventory | distinct counts preserved | read-only fixture assertion |
| ISC-346 | anti-regression | protected runtime surfaces | zero mutations | before/after readback |
| ISC-347 | docs | local docs route | HTTP 200 | curl |
| ISC-348 | docs | native capability catalog | required entries present | source grep |
| ISC-349 | auth | local dashboard anonymous access | login redirect | curl |
| ISC-350 | auth | tunneled dashboard anonymous access | login redirect | curl |
| ISC-351 | auth | tunneled model catalog | non-200 anonymously | curl |
| ISC-352 | auth | tunneled chat middleware order | auth rejection before schema | curl |
| ISC-353 | key policy | allowed model | explicit probe-passing non-Sol identifiers only | key readback |
| ISC-354 | key policy | allowed endpoints | explicit inference-only list | key readback |
| ISC-355 | key policy | request rate | finite positive limit | key readback |
| ISC-356 | key policy | spend budget | finite positive limit | key readback |
| ISC-357 | auth | management API | rejection anonymously | curl |
| ISC-358 | exposure | provider-management body | none anonymously | curl |
| ISC-359 | secret hygiene | tunnel material in repository | zero matches | rg |
| ISC-360 | recovery | transport stop procedure | OmniRoute remains active | CLI probe |
| ISC-361 | prompt ownership | global system prompt | disabled | settings readback |
| ISC-362 | compression gate | global pipeline | disabled before fixtures | settings readback |
| ISC-363 | compression | PAI stage names | exact preservation | preview fixture |
| ISC-364 | compression | ISA identifiers | exact preservation | preview fixture |
| ISC-365 | compression | GSD pointers | exact preservation | preview fixture |
| ISC-366 | compression | tool-call JSON | valid equivalent structure | preview fixture |
| ISC-367 | system prompt | preservation setting | enabled | settings readback |
| ISC-368 | dedup | session dedup | disabled | settings readback |
| ISC-369 | retrieval | private PAI CCR | disabled | settings readback |
| ISC-370 | lossy transforms | governed prompt engines | all disabled | settings readback |
| ISC-371 | caveman | effective governed pipeline | no effect while global off | preview fixture |
| ISC-372 | context sources | path allowlist | explicit bounded roots | config readback |
| ISC-373 | context sources | returned material | pointers only | source probe |
| ISC-374 | CLI Code | validation mode | zero writes | CLI dry-run |
| ISC-375 | CLI Code | Temperance profile | exact pre-hash | sha256 readback |
| ISC-376 | CLI Code | generated preview | zero plaintext keys | secret scan |
| ISC-377 | CLI Agents | Hermes discovery | present | API/source probe |
| ISC-378 | Hermes auth | settings endpoint | management auth required | curl |
| ISC-379 | Hermes safety | integration artifact | redacted dry-run | file read |
| ISC-380 | MCP auth | status endpoint | management auth required | curl |
| ISC-381 | MCP safety | scope enforcement | enabled | status readback |
| ISC-382 | A2A | capability list | authenticated bounded response | JSON-RPC probe |
| ISC-383 | A2A boundary | classifier and ISA writes | zero paths | source scan |
| ISC-384 | skills | discovery disposition | candidate-only | contract test |
| ISC-385 | skills | live installation | zero writes | before/after hashes |
| ISC-386 | skill clusters | registry authority | exact canonical path | docs/test |
| ISC-387 | GSD | planning authority | `.planning` canonical | docs/test |
| ISC-388 | PAI | stage handoff | seven-stage contract | manifest test |
| ISC-389 | dispatch | Spark fleet member | exact model present | combo readback |
| ISC-390 | dispatch | Sol fleet members | zero | combo readback |
| ISC-391 | dispatch task | backend | exact `omniroute` | tasklist read |
| ISC-392 | dispatch task | current held-combo model | exact pinned `codex/gpt-5.3-codex-spark` | tasklist read |
| ISC-393 | parallelism | independent tasks | at least four completed | index JSON |
| ISC-394 | attribution | Spark selection | at least one attempt | receipts |
| ISC-395 | quota guard | Sol attempts | zero | index JSON |
| ISC-396 | fallback | failed fleet task rails | non-Sol only | attempts JSON |
| ISC-397 | skill sync | installed contract hash | matches repository | sha256 |
| ISC-398 | skill recovery | pre-refresh snapshot | present and recoverable | stat/readback |
| ISC-399 | documentation | integration matrix | every native surface mapped | docs test |
| ISC-400 | contract | duplicate policy authority | rejected | automated test |
| ISC-401 | regression | canonical verification | exit zero | verify-all |
| ISC-402 | anti-secret | output artifacts | zero secret patterns | rg |
| ISC-403 | anti-runtime | EC2 and Hermes writes | zero | command/write audit |
| ISC-404 | anti-config | OpenCode governed surface | two providers, fourteen aliases | validator |
| ISC-405 | rollback | changed local config | exact bytes restored | rehearsal |
| ISC-406 | secret hygiene | `antigravity-claude-sonnet-5` profile | zero persisted auth fields | jq/rg |
| ISC-407 | secret hygiene | `gh-claude-sonnet-5` profile | zero persisted auth fields | jq/rg |
| ISC-408 | secret hygiene | `no-think-antigravity-claude-sonnet-5` profile | zero persisted auth fields | jq/rg |
| ISC-409 | secret hygiene | `no-think-gh-claude-sonnet-5` profile | zero persisted auth fields | jq/rg |
| ISC-410 | launcher auth | inference-key source | Keychain service read | shell test |
| ISC-411 | launcher secret hygiene | disk writes | zero secret bytes | filesystem diff/scan |
| ISC-412 | launcher secret hygiene | child argv | zero key bytes | fake-command capture |
| ISC-413 | launcher failure | missing Keychain item | nonzero before child execution | shell test |
| ISC-414 | launcher policy | profile name | exact four-profile allowlist | shell test |
| ISC-415 | native integration | launch path | exact OmniRoute command/profile | fake-command capture |
| ISC-416 | auto-sync hygiene | generated profile auth | zero persisted token | source/test probe |
| ISC-417 | migration recovery | pre-profile receipt | mode 600 and four hashes | stat/jq |
| ISC-418 | migration integrity | recorded profile hashes | exact source-byte match | sha256 |
| ISC-419 | client auth | effective feature flag | true | DB/API readback |
| ISC-420 | client auth | anonymous local catalog | HTTP 401 | curl |
| ISC-421 | client auth | invalid local Bearer | HTTP 401 | curl |
| ISC-422 | client auth | valid local Bearer | HTTP 200 | Keychain-backed curl |
| ISC-423 | Claude profile | antigravity canary | nontrivial success | native launch probe |
| ISC-424 | Claude profile | GitHub canary | nontrivial success | native launch probe |
| ISC-425 | Claude profile | no-think Antigravity canary | nontrivial success | native launch probe |
| ISC-426 | Claude profile | no-think GitHub canary | nontrivial success | native launch probe |
| ISC-427 | Codex/OpenCode regression | Keychain-backed catalog and route | HTTP 200 plus governed route | launcher/router probe |
| ISC-428 | transport containment | Quick Tunnel state | stopped | state/API readback |
| ISC-429 | network containment | OmniRoute listener | loopback only | lsof |
| ISC-430 | named tunnel | unmatched ingress | HTTP 404 | remote curl |
| ISC-431 | Cloudflare Access | unauthenticated ingress | rejected upstream of origin | remote curl/log join |
| ISC-432 | remote inference | Access-authenticated model | exact allowlisted governed model | remote canary/receipt |
| ISC-433 | key separation | Claude and Codex key identities | distinct IDs and Keychain services | metadata readback |
| ISC-434 | Claude key policy | allowed models | exact four-profile model set | key readback |
| ISC-435 | Claude key policy | endpoint categories | exactly `chat`, `models` | key readback |
| ISC-436 | Claude key policy | rate limit | finite positive window | key readback |
| ISC-437 | management boundary | Claude inference key on `/api/keys` | HTTP 401 | curl |
| ISC-438 | context-store hygiene | pre/post native launch hash | byte-identical | sha256 |
| ISC-439 | restart persistence | effective client auth after restart | true plus denial probes | API/curl |
| ISC-440 | revocation | throwaway key after revoke | HTTP 401 | API/curl |
| ISC-441 | launcher environment | duplicate OmniRoute key in real Claude | absent | fake-child capture |
| ISC-442 | heterogeneous dispatch | new worker models | all non-Codex | index JSON |
| ISC-443 | dispatch pinning | backend and model fields | exact and explicit | tasklist/index JSON |
| ISC-444 | provider diversity | accepted attributed providers | at least two families | gateway receipts |
| ISC-445 | quota guard | Sol-family attempts | zero | attempts plus gateway receipts |
| ISC-446 | Access machine identity | programmatic auth | service token or mTLS | Access policy/probe |
| ISC-447 | tunnel credential hygiene | repository and file permissions | zero repo bytes; principal-only | rg/stat |
| ISC-448 | remote model restriction | non-allowlisted model | denied before routing | remote canary/receipt |
| ISC-449 | rollback order | tunnel, auth, launcher | reverse dependency order | rehearsal receipt |
| ISC-450 | privacy policy | Claude key no-log | true | key readback |
| ISC-451 | quota policy | Claude daily/weekly USD limits | finite positive | key readback |
| ISC-452 | privacy cleanup | pre-promotion protected artifacts | zero retained bodies | redaction verifier |
| ISC-453 | telemetry preservation | redacted artifacts | summary only | jq/SQLite |
| ISC-454 | process-secret hygiene | curl child arguments | zero credentials | fake-curl test/rg |
| ISC-455 | restart recovery | failed LaunchAgent bootstrap | authenticated loopback service restored | lifecycle test/rehearsal |
| ISC-456 | topology semantics | adapters versus upstreams | distinction documented | docs contract |
| ISC-457 | remote containment | missing Cloudflare authority | zero named tunnel | Wrangler/local audit |
| ISC-458 | revocation cache | deleted throwaway key | terminal 401 plus latency receipt | bounded live poll |
| ISC-459 | dispatch skill sync | repository and installed skill | byte-identical; native non-Codex first-class; Spark optional; Sol excluded | shasum/read |
| ISC-460 | key-policy mutation | no-log and allowed-model drift | both rejected | shell fixture |
| ISC-461 | auth/network mutation | anonymous, management, all-interface cases | all rejected | shell fixture/live verify |
| ISC-462 | artifact mutation | planted and replanted bodies | both rejected; distinct 8/64-hex checksums | SQLite/filesystem fixture |
| ISC-463 | launcher outage | OmniRoute/OpenCode upstream failure | nonzero; no direct Claude fallback | shell fixture |
| ISC-464 | repository regression | complete canonical suite | zero exit; full verification pass | `scripts/verify-all.sh` |
| ISC-490 | authority boundary | current promotion call sites | zero challenge-controller imports or consumption | executable source guard |
| ISC-490.1 | issuance | nonce, identity, lifetime, lock | 256 bits; exact key; at most five minutes; exclusive | Bun tests/parallel CLI |
| ISC-490.2 | replay control | concurrent consumption | exactly one success; every replay denied | Bun multiprocess test |
| ISC-490.3 | durability | prepared transition recovery | exact pre-state or post-state after injected crash | Bun failure-injection test |
| ISC-490.4 | filesystem safety | symlink, type, owner, mode, parent traversal | every unsafe mutation target rejected | Bun adversarial filesystem tests |
| ISC-490.5 | retention | live-window tombstones and capacity | never prune fresh; bounded entries and bytes | deterministic-clock tests |
| ISC-490.6 | rollback | drift and monotonic issuance revocation | drift denied; issued becomes revoked; consumed never reopens | receipt-bound rollback tests |
| ISC-490.7 | verifier boundary | versioned and legacy ledgers | snapshot remains `authorizing:false`; no promotion writes | verifier compatibility tests/source guard |
| ISC-491 | manifest transport policy | Mac and EC2 compression contract | exact providers; literal `off`; malformed and mismatched policy rejected | jq schema fixtures |
| ISC-492 | OpenCode resolved transport | mixed-case and unrelated custom headers plus rollback | one canonical off header per governed provider; unrelated headers and exact rollback preserved | shell fixture plus `opencode debug config` |
| ISC-493 | relay outbound transport | client off/on/mixed-case header variants | final captured upstream request always carries literal `off`; protected surfaces unchanged | Bun request-capture tests plus live invariants |
| ISC-494 | Mac readiness lifecycle | absent, false-like, affirmative, and recovery installs | absent/false resolves `0`; affirmative resolves `1`; guarded install remains healthy and reversible | LaunchAgent shell fixtures plus live health |
| ISC-495 | S candidate manifest | schema and prohibited aliases/models/tools | only explicit non-Sol candidates; malformed or ambiguous entries rejected | Bun manifest tests |
| ISC-496 | instrument controls | pre/post pin denial and mismatch reachability | every control passes or all candidates void | fixture and live HTTP probes |
| ISC-497 | request bounds | transport, nonce, tool, retries, deadlines, request count | serial loopback requests only; finite fixed ceiling | captured fetch fixtures |
| ISC-498 | outcome vocabulary | emitted keys and state values | exact closed non-positive vocabulary | schema tests |
| ISC-499 | falsification semantics | contradiction versus absence/refusal/truncation | only explicit attribution mismatch can falsify | adversarial response fixtures |
| ISC-500 | telemetry schema | allowlist, expiry, hashes, raw-data exclusion | no raw bodies/errors; explicit unauthenticated integrity and non-claims | receipt schema tests |
| ISC-501 | receipt filesystem | directory, exclusive create, mode, symlink, collision | owner-only; O_EXCL/O_NOFOLLOW; exact 0600 | filesystem adversarial tests |
| ISC-502 | credential hygiene | key-source and output surfaces | file-only credential; zero secret or raw-payload output | mocked key/fetch plus process inspection |
| ISC-503 | structural non-authorization | imports, receipt readers, mutations | zero production consumers or readiness/promotion writes | repository source guard |
| ISC-504 | live EC2 rejection | current Opus candidates and protected invariants | all non-promotable; services/listeners/readiness unchanged | SSM receipt plus before/after hashes |
| ISC-505 | regression gate | focused and canonical verification | all green; zero Sol identifiers in live receipt | Bun tests plus `verify-all.sh` |
| ISC-506 | manifest schema | unknown and missing keys | every malformed document rejected before planning | Bun schema fixtures |
| ISC-507 | hostname binding | hostname and declared zone | lowercase strict subdomain; no wildcard, URL, port, apex, or foreign suffix | Bun manifest fixtures |
| ISC-508 | origin boundary | manifest origin | exact `http://127.0.0.1:20128` only | Bun manifest fixtures |
| ISC-509 | remote model pin | initial model identifier | one explicit probe-passing non-Sol, non-auto model | Bun manifest fixtures |
| ISC-510 | remote key policy | endpoints, sessions, logging, rate, spend | exact bounded policy | Bun policy fixtures |
| ISC-511 | transaction plan | operation dependency graph | one deterministic forward order | plan snapshot test |
| ISC-512 | apply preflight | authority/local-auth/tunnel/listener/conflicts/cert path | every gate true before mutation; no residual quick fallback or cert.pem | injected preflight fixtures |
| ISC-513 | preflight atomicity | failed gates versus mutator calls | zero mutator calls | call-log fixtures |
| ISC-514 | control credential | path, type, owner, mode, argv, environment | strict external mode-600 regular file; zero alternate source | filesystem/process fixtures |
| ISC-515 | generated secrets | sinks and observable surfaces | sink-only; zero receipt/argv/stdout/stderr/log bytes | sentinel leak fixtures |
| ISC-516 | Access-first boundary | app/policy readback before route calls | specific-token Service Auth precedes tunnel and DNS; no Everyone/Bypass | ordered mock API log |
| ISC-517 | tunnel ingress | ordered rules and Access validation | exact host origin with team/audience JWT enforcement then catch-all 404 | configuration readback fixture |
| ISC-518 | DNS route | CNAME target and predecessor state | exact tunnel target after Access | ordered mock API log |
| ISC-519 | connector credential | cloudflared argv and token file metadata | token-file only; external owner-600 path | fake cloudflared capture |
| ISC-520 | journal and receipt | permissions, ordering, allowlist, non-claims | private before mutation; mode-600 sanitized final receipt | filesystem/schema tests |
| ISC-521 | rollback order | applied operation stack | connector stop, DNS delete, zero connections, tunnel, Access, tokens, key, secrets | failure-injection log |
| ISC-522 | rollback ownership | drift, repeat, replacement, pre-existence | deny drift; skip non-owned; second rollback no-op | receipt fixtures |
| ISC-523 | remote canaries | six denial/success cases | exact expected status and gateway attribution | mock/live HTTP receipt |
| ISC-524 | preview non-mutation | all external adapters and secret surfaces | zero calls and writes | injected adapter counters |
| ISC-525 | regression | focused and canonical suites | all green with no secret or Sol-family artifact | Bun/shell tests plus `verify-all.sh` |
| ISC-526 | documentation | ownership and external-input matrix | every owner and gate explicit | docs continuity test |
| ISC-527 | approval gate | approval receipt and prepared-state bindings | exact fresh one-use authorization before exposure | receipt verifier tests |
| ISC-528 | prepare boundary | DNS, connector, public route, recovery | all absent; deterministic exact-name recovery | injected adapter log and journal fixture |
| ISC-529 | composition boundary | imports, defaults, module-load effects | generic CLI has no production-adapter import; zero implicit authority | source guard plus import smoke |
| ISC-530 | management credentials | file type, owner, mode, link count, source | strict external 0600 regular files only | filesystem adversarial fixtures |
| ISC-531 | HTTP contract | origin, paths, redirects, content types, error redaction | exact requests; no redirect or secret-bearing error | injected fetch recorder |
| ISC-532 | durable mutation journal | intent/result order and secret sink | intent precedes request; sanitized result follows; sink-only bytes | private temporary filesystem fixture |
| ISC-533 | recovery provenance | exact identifiers, tags, names, orphan states | zero name-only adoption or deletion | foreign-resource fixtures |
| ISC-534 | approval anti-replay | signature-first call order and durable consumption | exactly one winner; ledger remains non-authorizing | signed approval plus concurrent ledger fixture |
| ISC-535 | adapter regression | credentials, redaction, replay, recovery, imports | all adversarial cases pass hermetically | Bun test suite |
| ISC-536 | evidence continuity | GSD, docs, audits, full verifier | local claims closed; external claims remain open | docs gate, Advisor, Cato, verify-all |
| ISC-537 | operator mental model | snapshot top-level sections | five authority layers remain distinct | JSON shape assertion |
| ISC-538 | collection boundary | SQLite transaction and source imports | no credential, HTTP, network, or management session | injected collector and source scan |
| ISC-539 | atomic local evidence | ancestry, ownership, links, schema/WAL, PID package, DB inode, cloudflared PIDs | one coherent version-bound observation or failure | adversarial filesystem/runtime fixtures |
| ISC-540 | redaction boundary | provider and management payloads | no reusable or identifying metadata survives | sentinel serialization scan |
| ISC-541 | compression status | master, default mode, active profile, candidates | master-off is off; master-on is request-dependent | legacy and explicit fixtures |
| ISC-542 | topology semantics | inventory, activity, recent, error, connections | activity never masquerades as inventory | topology fixture and live readback |
| ISC-543 | native CLI status | tool detection and adoption policy | preview/proposal only; apply never called | route ledger assertion |
| ISC-544 | protocol status | persisted MCP and A2A counters | observed only; configuration unknown; no activation path | source exclusion plus fixture |
| ISC-545 | worker routing | workers, direct fallbacks, native profiles | Sol-free with unique non-Codex diversity counted | manifest fixture |
| ISC-546 | regression safety | secrets, paths, schema/WAL, runtime/package/DB/process, compression, Sol | all negative fixtures fail closed | focused Bun suite |
| ISC-547 | evidence continuity | docs, GSD, tests, verifier | local snapshot proven; external gates preserved | docs gate and verify-all |
| ISC-548 | source schema | exact PAI, GSD, and skill-index fields | three pointers plus material marker only | Bun contract tests |
| ISC-549 | path trust | fixed candidates, canonical roots, file type, links, containment | every escape and substitution rejected independently | adversarial filesystem fixtures |
| ISC-550 | privacy | pointed source contents | zero body reads, hashes, copies, parses, or serialization | source dependency guard plus canaries |
| ISC-551 | shared clients | Claude, Codex, OpenCode, Kimi, Command Code | one deterministic line on four; zero line in direct renderer | assembler and shell structural tests |
| ISC-552 | failure isolation | missing, unsafe, and unexpectedly throwing sources | safe peers survive; enrichment never throws | resolver fixtures |
| ISC-553 | injection resistance | controls, separators, delimiters, symlinks, FIFO, partial roots | no extra line, envelope close, body leak, or unsafe pointer | adversarial Bun suite |
| ISC-554 | mutation boundary | OmniRoute, native sources, protocols, Hermes | zero database/settings/credential/protocol/apply mutation | source guards plus pre/post invariants |
| ISC-555 | evidence continuity | native guide and capability fabric | client-owned catalog and future gates explicit | native integration shell gate |
| ISC-556 | final acceptance | focused/live/structural/full/review/reread evidence | all green; no Sol or protected-runtime drift | Bun, shell, live hashes, Advisor, Cato |
| ISC-557 | ownership | actual shell renderer plus documented TS renderer | one canonical pointer resolver and serializer; no duplicate pointer policy | shell delegation and source guard |
| ISC-558 | integrity | reserved-line count, JSON order, hostile rendered inputs | exactly one valid deterministic line or nonzero | Bun and shell fixtures |
| ISC-559 | privacy | full/partial/unsafe source matrix plus body canaries | safe pointers survive independently; zero canary disclosure | metadata fixture suite |
| ISC-560 | failure | missing runtime, helper error, malformed output | nonzero before fake Command Code invocation; zero ungoverned fallback | fake runtime/dispatch harness |
| ISC-561 | concurrency | two same-model tasks in parallel | distinct workspaces and task-correct canonical files | fake Command Code capture |
| ISC-562 | boundary | docs, runtime retention, external state | adopted locally; zero provider/protocol/remote mutation | structural guard plus hashes |
| ISC-563 | acceptance | focused/live/full/review/reread | all green; exact non-Codex attribution; no Sol | Bun, shell, SQLite, Advisor, Cato |
| ISC-564 | zero-auth boundary | success and every failure branch | no Keychain, login, session, HTTP, or native endpoint | poisoned binaries, source guard, receipt |
| ISC-565 | local snapshot boundary | version, runtime/database continuity, exact combo booleans | fresh read-only evidence; no management or mutation | SQLite projection, jq contract, Bun tests |
| ISC-566 | Hermes path ownership | pre-existing and concurrent state | no create, follow, rename, or delete | empty/symlink/concurrent fixtures |
| ISC-567 | Hermes proposal contract | YAML fields, role mapping, receipt non-claims | exact custom loopback config; five env refs; authorization false | shell fixture and official-source audit |
| ISC-568 | durable artifact hygiene | success receipt directory | exactly two mode-600 files; zero source/auth/secret material | find/stat/rg/jq |
| ISC-569 | adversarial regression | thirty-one positive/negative checks | every unsafe case nonzero and preserved | shell suite |
| ISC-570 | historical credential cleanup | exact preview receipt root | validated deletion recorded; zero current/future cookie paths | prior lstat evidence, find, v3 receipt, rollback |
| ISC-571 | final acceptance | focused/native/full/review/reread | all green; no protected mutation or Sol | shell, SQLite, Advisor, Cato |
| ISC-586 | isolation default | adapter argv and explicit provider settings | ignore user config by default; routing contract unchanged | mocked Codex argv plus live help |
| ISC-587 | opt-out contract | unset, zero, one, and other values | exact zero alone opts out and warns | shell matrix |
| ISC-588 | flag and auth boundary | ordering, repository rules, gateway credential source | supported flag before delimiter; no ignore-rules or user-config auth dependency | source guard, mocked argv, live Codex |
| ISC-589 | artifact privacy | run directories and every retained artifact | directories 700, files 600, worker environment umask unchanged | stat matrix plus worker fixture |
| ISC-590 | worker context policy | skill and runtime documentation | self-contained tasks, repo rules retained, non-Codex allowed, Sol forbidden | documentation continuity |
| ISC-591 | regression suite | default, opt-out, argv, modes, umask | all focused assertions pass | dispatch-tasklist shell suite |
| ISC-592 | live Spark proof | exact model, output, attempt, correlation, fallback | substantive ok; one exact attempt; no fallback or Sol | temperance-batch receipt |
| ISC-593 | rejected evidence | original ambient-config run | timeout never counted as success or fixed by duration | retained run receipt and decision ledger |
| ISC-594 | protected invariants | native snapshot before and after proof | Sol-free and byte-stable protected projections | native status and hashes |
| ISC-595 | final acceptance | focused/docs/native/full/review/reread | all green; zero unauthorized mutation | shell, Bun, Advisor, Cato |
| ISC-613 | scope | destination root | exact canonical path | policy unit test |
| ISC-614 | scope | portfolio allowlist | exact two values | policy unit test |
| ISC-615 | anti-scope | unrelated source/destination hashes | byte-identical | integration snapshot |
| ISC-616 | pinned vault | Thoughtseed Labs path and identity | unchanged | lstat and hash snapshot |
| ISC-617 | inventory | scoped entries versus classifications | full coverage | inventory fixture/live report |
| ISC-618 | classification | standalone repositories | independent units | Git fixture test |
| ISC-619 | classification | `.git` pointer repositories | linked worktree | Git fixture test |
| ISC-620 | classification | nested remote repositories | independent nested units | Git fixture test |
| ISC-621 | held entries | unknown/non-repository state | unchanged plus reason | fixture hash comparison |
| ISC-622 | metadata | lifecycle field | closed vocabulary present | schema test |
| ISC-623 | metadata | repository type field | closed vocabulary present | schema test |
| ISC-624 | identity | logical project ID | exactly one stable value | schema test |
| ISC-625 | mapping | old/new/GitHub fields | canonical and verified | schema plus Git readback |
| ISC-626 | Git preflight | branch state | exact value | Git readback fixture |
| ISC-627 | Git preflight | HEAD | exact object ID | `git rev-parse` fixture |
| ISC-628 | Git preflight | refs | deterministic digest | Git plumbing fixture |
| ISC-629 | Git preflight | remotes | exact offline map | `git remote -v` fixture |
| ISC-630 | Git preflight | worktree graph | complete canonical list | `git worktree list --porcelain` |
| ISC-631 | Git preflight | submodules | exact local status | submodule fixture |
| ISC-632 | Git preflight | LFS | availability and local state | LFS fixture |
| ISC-633 | filesystem preflight | untracked files | deterministic inventory | porcelain fixture |
| ISC-634 | filesystem preflight | ignored files | policy plus classification | ignored fixture |
| ISC-635 | tombstone audit | dropped session-manifest contract | points to 2026-08-03 refined decision | ID-stability scan |
| ISC-636 | tombstone audit | dropped Paseo-link contract | points to 2026-08-03 refined decision | ID-stability scan |
| ISC-637 | anti-secret | generated artifacts | zero forbidden patterns | recursive scanner |
| ISC-638 | apply scope | approved repository count | exactly one standalone | transaction test |
| ISC-639 | filesystem | source/destination device | exact equality | stat fixture/live preflight |
| ISC-640 | collision | occupied destination | fail before mutation | transaction fixture |
| ISC-641 | mutation gate | source plus digest state | exact before rename | failure-injection test |
| ISC-642 | tombstone audit | superseded capsule contract | points to ISC-699 | ID-stability scan |
| ISC-642.1 | knowledge authority | portfolio-specific handoff and capsule backlink | exact digest match | registry/capsule snapshot |
| ISC-643 | Git verification | porcelain-v2 status | approved equivalence | pre/post Git readback |
| ISC-644 | Git verification | HEAD | exact equality | pre/post `rev-parse` |
| ISC-645 | Git verification | refs digest | exact equality | pre/post plumbing digest |
| ISC-646 | Git verification | remotes | byte-equal canonical map | pre/post readback |
| ISC-647 | Git verification | worktree graph | approved equivalence | pre/post worktree readback |
| ISC-648 | filesystem verification | integrity hashes | exact equality | SHA-256 manifest |
| ISC-649 | tombstone audit | dropped predecessor/successor contract | points to ISC-700..ISC-703 | ID-stability scan |
| ISC-650 | tombstone audit | dropped provider-continuation contract | points to ISC-700..ISC-703 | ID-stability scan |
| ISC-651 | recovery | operation receipt | complete digest-bound schema | receipt schema test |
| ISC-652 | rollback safety | planted drift | reject with zero removals | adversarial rollback test |
| ISC-653 | rollback recovery | path and Git state | exact preflight restoration | rollback fixture |
| ISC-654 | anti-network | Git command log | zero network/remote mutation calls | fake-Git capture |
| ISC-655 | anti-history | outer vault Git command log | zero cleanup/rewrite calls | source guard plus fake-Git capture |
| ISC-656 | documentation | historical debloat boundary | separate phase stated | docs contract test |
| ISC-657 | overlap truth | dual-tracking condition | separate report present | Git index audit |
| ISC-658 | concurrency | overlapping applies | exactly one lock holder | multiprocess fixture |
| ISC-659 | permissions | receipt directory and files | `0700` and `0600` | stat matrix |
| ISC-660 | dry-run | all protected snapshots | byte-identical | source/destination/Git/registry/Paseo/provider-home hash matrix |
| ISC-661 | packet shape | `PROJECT.md` | present | packet fixture |
| ISC-662 | packet shape | `.project/project.yaml` | present | packet fixture |
| ISC-663 | packet shape | `.project/HANDOFF.md` | present | packet fixture |
| ISC-664 | adapter preservation | existing `AGENTS.md` | byte-identical during relocation | planted rich-file fixture |
| ISC-665 | adapter preservation | existing `CLAUDE.md` | byte-identical during relocation | planted rich-file fixture |
| ISC-666 | packet schema | project YAML keys | strict closed-schema pass | unknown-key matrix |
| ISC-667 | packet identity | stable project ID | one valid value | schema fixture |
| ISC-668 | packet identity | portfolio | one allowlisted value | schema fixture |
| ISC-669 | packet authority | GitHub identity | verified value when discoverable | remote fixture |
| ISC-670 | packet authority | knowledge reference | portfolio-authorized path | resolver fixture |
| ISC-671 | packet governance | default client | exact `codex` | schema fixture |
| ISC-672 | packet governance | approval profile | closed-vocabulary value | schema fixture |
| ISC-673 | packet routing | routing authority | exact `temperance-omniroute` | schema fixture |
| ISC-674 | packet routing | lane names | allowlisted `te-*` values only | adversarial lane matrix |
| ISC-675 | packet commands | setup | command or explicit not-applicable | schema fixture |
| ISC-676 | packet commands | test | command or explicit not-applicable | schema fixture |
| ISC-677 | packet commands | verify | one command | schema fixture |
| ISC-678 | packet hygiene | rendered packet | zero forbidden values | planted-secret/session/path scanner |
| ISC-679 | handoff shape | objective | one non-empty value | handoff fixture |
| ISC-680 | handoff shape | base commit | valid object ID | handoff fixture |
| ISC-681 | handoff shape | branch state | branch or detached value | handoff fixture |
| ISC-682 | handoff shape | working-tree state | exact clean/dirty value | handoff fixture |
| ISC-683 | handoff shape | completed work | section present | handoff fixture |
| ISC-684 | handoff shape | decisions | section present | handoff fixture |
| ISC-685 | handoff shape | next action | one exact action | handoff fixture |
| ISC-686 | handoff shape | blockers | list or explicit none | handoff fixture |
| ISC-687 | handoff shape | verification | result present | handoff fixture |
| ISC-688 | handoff shape | updated timestamp | canonical timestamp | handoff fixture |
| ISC-689 | role boundary | Codex claim | local interactive governance only | authority-profile snapshot |
| ISC-690 | router boundary | OmniRoute fields | zero project/task/handoff/session-state keys | strict-schema negative matrix |
| ISC-691 | Thoughtseed boundary | remote execution authority | exact Hermes ownership | authority-profile snapshot |
| ISC-692 | TN isolation | Thoughtseed authority identifiers | zero matches | recursive profile scanner |
| ISC-693 | Kimi pickup | context load phase | dispatch-time packet read | adapter trace fixture |
| ISC-694 | Kimi boundary | prompt-hook emulation | zero hook path | source guard |
| ISC-695 | routing boundary | TN adapter | zero duplicate classifier/preference store | source guard plus import graph |
| ISC-696 | Tauri boundary | authority profile | scheduler false/absent | schema snapshot |
| ISC-697 | registry routing | Thoughtseed record | beneath ratified Thoughtseed root | path resolver fixture |
| ISC-698 | registry routing | TN record | beneath ratified seed root | path resolver fixture |
| ISC-699 | capsule shape | old-path capsule | exact six files | capsule snapshot |
| ISC-700 | capsule linkage | packet digest | exact equality | packet/capsule snapshot |
| ISC-701 | resolver contract | stable ID | exact packet value | pure packet fixture |
| ISC-702 | resolver contract | next action | exact handoff value | pure packet fixture |
| ISC-703 | resolver isolation | provider/transcript inputs | zero reads | poisoned-path fixture |
| ISC-704 | source hygiene | unapproved provider-home or session-store traversal | zero production reads | source guard plus poisoned filesystem |
| ISC-705 | source hygiene | Paseo mutation/import | zero production calls | import graph plus fake executable |
| ISC-706 | promotion authority | dashboard metrics | cannot set authorization true | adversarial receipt fixture |
| ISC-707 | held runtime | `hermes-aws-ts` | named dependency-manifest gate | inventory policy fixture |
| ISC-708 | isolation failure | cross-portfolio reference | fail closed | adversarial authority matrix |
| ISC-709 | dependency audit | bounded search roots and exact old-path matches | complete manifest | repo/host config fixtures |
| ISC-710 | dependency gate | unresolved runtime consumer | held before mutation | transaction denial fixture |
| ISC-711 | split-brain gate | competing registry claim | fail before mutation | dual-registry fixture |
| ISC-712 | remote boundary | GitHub collaboration state | unchanged | fake-Git command capture plus manifest comparison |
| ISC-713 | old-path boundary | symlink creation | zero calls | filesystem-operation capture |
| ISC-714 | packet shape | `.project/CONTEXT.md` | present | packet fixture |
| ISC-715 | context hygiene | bounded context document | zero copied-corpus/task/session patterns | planted-content scanner |
| ISC-716 | repository preservation | transaction file operations inside checkout | rename only, zero file create/edit | descriptor-operation capture |
| ISC-717 | client boundary | ChatGPT web authority claims | zero local-filesystem/OmniRoute executor claims | authority-profile snapshot |
| ISC-718 | Thoughtseed identity | packet project ID | exact TeamForge match | TeamForge snapshot fixture |
| ISC-719 | routing deployment | packet profile | one portfolio-allowlisted value | cross-profile matrix |
| ISC-720 | TN routing gate | unverified deployment | routed delegation denied | adapter fixture |
| ISC-721 | credential boundary | credential-scope reference | secretless named reference | schema and planted-secret fixture |
| ISC-722 | portfolio classification | inventory record | proposal, evidence, ambiguity present | mixed-lineage fixture |
| ISC-723 | portfolio ambiguity | conflicting evidence | held | Snow Gloves/10869 fixture |
| ISC-724 | live pickup | stable ID | equals resolver output | approved-client canary receipt |
| ISC-725 | live pickup | next action | equals resolver output | approved-client canary receipt |
| ISC-726 | live pickup isolation | resume/import/session/transcript inputs | zero project-history inputs | client launch capture |
| ISC-727 | registry preflight | repository baseline | clean or exact owner checkpoint | dirty-registry fixture |
| ISC-728 | rename preflight | parents plus device/inode | exact immediately before mutation | instrumented rename fixture |
| ISC-729 | rename adversary | source/parent path swap | abort before unintended rename | race-injection fixture |
| ISC-730 | owner ratification | Thoughtseed registry root | exact approved path | user-message evidence plus design readback |
| ISC-731 | owner ratification | Tryambakam registry root | exact approved path | user-message evidence plus design readback |
| ISC-732 | identity authority | Thoughtseed reconciliation key | exact TeamForge project ID | registry schema fixture |
| ISC-733 | lifecycle start | first Thoughtseed transition | exact `reconciling` event | registry fixture |
| ISC-734 | current-state projection | main project record path | verified destination path | projection fixture |
| ISC-735 | evidence linkage | main project record | non-null evidence reference | projection fixture |
| ISC-736 | cutover integrity | main-record readback | closure-manifest digest match | closure fixture |
| ISC-737 | lifecycle closure | projected registry status | exact `reconciled` from event log | closure fixture |
| ISC-738 | lifecycle closure | closure timestamp | canonical timestamp present | schema fixture |
| ISC-739 | lifecycle closure | canonical record pointer | exact resolvable reference | resolver fixture |
| ISC-740 | lifecycle closure | manifest digest | exact SHA-256 | closure fixture |
| ISC-741 | retained authority | owner ratification evidence | present after closure | frozen-entry snapshot |
| ISC-742 | retained recovery | integrity and rollback evidence | present after closure | frozen-entry snapshot |
| ISC-743 | anti-deletion | closed registry filesystem operations | zero delete/move/flatten calls | operation capture |
| ISC-744 | authority separation | main project record historical fields | zero old-path/event fields | strict projection snapshot |
| ISC-745 | evidence identity | relocation evidence reference | exact SHA-256 content identity | replacement/tamper fixture |
| ISC-746 | evidence lookup | path field | separate from evidence identity | schema snapshot |
| ISC-747 | lifecycle history | prior transition events | byte-identical after append | pre/post event-log snapshot |
| ISC-748 | Git identity | closure comparison | HEAD and canonical ref-set equality | repack-insensitive fixture |
| ISC-749 | authority attribution | closure actors | distinct tool actor and owner-ratifier fields | schema fixture |
| ISC-750 | Thoughtseed source coverage | approved source immediate children | exact set equality | directory listing plus report validator |
| ISC-751 | Tryambakam source coverage | approved source immediate children | exact set equality | directory listing plus report validator |
| ISC-752 | Git inventory schema | each report row | boundary and local evidence fields present | report validator |
| ISC-753 | classification schema | each report row | proposal, evidence, ambiguity present | report validator |
| ISC-754 | Workbench provenance | implementation and data source | exact local paths identified | source search and readback |
| ISC-755 | live Workbench state | authenticated admin route | rendered state captured read-only | Chrome page snapshot |
| ISC-756 | ambiguity safety | conflicting or insufficient evidence rows | exact `held` disposition | report validator |
| ISC-757 | anti-mutation | scanned checkouts, destination, session, Paseo, and external state | only explicit Temperance ISA plus external planning report changed | pre/post status and path snapshots |
| ISC-758 | repository identity principle | owner ratification | path explicitly excluded as repository identity | decision and verification readback |
| ISC-759 | repository directory normalization policy | owner ratification | universal normalization accepted before rename or move | decision and verification readback |
| ISC-760 | repository directory grammar | owner ratification | one complete normalized basename grammar accepted before concrete slugs | decision readback |
| ISC-760.1 | internal ASCII period representability | owner ratification | U+002E rejected at non-boundary positions | decision and verification readback |
| ISC-760.2 | ASCII uppercase exclusion | owner ratification | one exact uppercase-exclusion ruling accepted for the `<repository>` segment | decision readback |
| ISC-760.3 | ASCII lowercase repertoire | owner ratification | one exact full-class inclusion ruling accepted for the `<repository>` segment | decision readback |
| ISC-760.4 | ASCII digit repertoire | owner ratification | one exact full-class include, exclude, or defer ruling accepted for the `<repository>` segment | decision readback |
| ISC-760.5 | ASCII hyphen-minus repertoire | owner ratification | one exact include, exclude, or defer ruling accepted for U+002D in the `<repository>` segment | decision readback |
| ISC-760.6 | ASCII low-line repertoire | owner ratification | one exact include, exclude, or closure-neutral defer ruling accepted for U+005F in the `<repository>` segment | decision readback |
| ISC-760.7 | repertoire closure policy | owner ratification | one exact closed, open, or closure-deferred default accepted for unruled code points in the `<repository>` segment | decision readback |
| ISC-760.8 | leading hyphen position | owner ratification | one exact allow, forbid, or unresolved ruling for U+002D at index 0 of length-at-least-two `<repository>` segments | decision readback |
| ISC-760.9 | trailing hyphen position | owner ratification | one exact allow, forbid, or unresolved ruling for U+002D at the final index of length-at-least-two `<repository>` segments | decision readback |
| ISC-760.10 | singleton hyphen name | owner ratification | one exact allow, forbid, or unresolved ruling for the one-code-point `<repository>` segment `-` | decision readback |
| ISC-760.11 | multi-codepoint hyphen-bearing names | owner ratification | one exact allow, forbid, or unresolved ruling for multi-codepoint `<repository>` names containing U+002D | decision readback |
| ISC-760.12 | permission precedence | owner ratification | one exact intersection-or-supersession ruling for multi-codepoint admission versus prior positional prohibitions | decision readback |
| ISC-760.13 | normalization stage | owner ratification | one exact normalize-before-validation or validate-before-normalization ruling | decision readback |
| ISC-760.14 | normalization validity closure | owner ratification | one exact validity-preserving, non-preserving, or unknown ruling | decision readback |
| ISC-760.15 | identity-key projection basis | owner ratification | one exact raw-name or normalized-name identity-key ruling | decision readback |
| ISC-760.16 | presentation projection basis | owner ratification | one exact raw-name or normalized-name presentation ruling | decision readback |
| ISC-760.17 | collision handling | owner ratification | one exact collision policy after identity-key projection | decision readback |
| ISC-760.18 | normalization algorithm and invariant | owner ratification | one exact normalization transform plus post-normalization validity rule | decision readback |
| ISC-760.19 | interior hyphen flanking and adjacency | owner ratification | one exact flanking/adjacency rule for interior U+002D after admission and precedence resolve | decision readback |
| ISC-761 | file | audit artifact exists | present | `test -f` |
| ISC-762 | text | tracked change count recorded | one numeric count | `rg` |
| ISC-763 | path equality | product symlink resolves to repository root | exact canonical equality | `readlink` plus `git rev-parse --show-toplevel` |
| ISC-764 | text | router-only drift recorded | `temperance-search-evidence.sh` | `rg` |
| ISC-765 | text | manifest bridge drift direction recorded | source-newer statement | `rg` |
| ISC-766 | text | enrich drift recorded | private overlay plus direction | `rg` |
| ISC-767 | text | installed hook parity recorded | four hooks | `rg` |
| ISC-768 | text | skill support-file gap recorded | workflows, references, scripts | `rg` |
| ISC-769 | text | COPY classification exists | heading present | `rg` |
| ISC-770 | text | TRANSFORM classification exists | heading present | `rg` |
| ISC-771 | text | REGENERATE classification exists | heading present | `rg` |
| ISC-772 | text | NEVER-SHIP classification exists | heading present | `rg` |
| ISC-773 | security | public artifact has no secret-like values | zero matches | secret scan |
| ISC-774 | structure | seven GSD workflow stages defined without numeric phase assumptions | 7/7 | table readback |
| ISC-775 | structure | workflow-stage commands present | 7/7 | table readback |
| ISC-776 | structure | workflow-stage outputs present | 7/7 | table readback |
| ISC-777 | structure | workflow-stage completion gates present | 7/7 | table readback |
| ISC-778 | structure | workflow-stage dependencies present | 7/7 | table readback |
| ISC-779 | policy | ratification gate present | explicit hold | `rg` |
| ISC-780 | planning authority | config/STATE/ROADMAP disagreement recorded and activation held | three authorities named plus reconciliation gate | readback |
| ISC-781 | docs | six documentation families mapped | 6/6 | table readback |
| ISC-782 | install | five lifecycle families mapped | 5/5 | table readback |
| ISC-783 | tests | four verification families mapped | 4/4 | table readback |
| ISC-784 | release | commit slices defined | at least four | table readback |
| ISC-785 | sandbox | empty-home probe defined | command present | `rg` |
| ISC-786 | portability | no-voice/non-macOS probe defined | command present | `rg` |
| ISC-787 | rollback | restoration probe defined | command present | `rg` |
| ISC-788 | provenance | installed checksum probe defined | command present | `rg` |

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
| Connector-brand live-naming scope guard | ISC-188 | connector-brand Decision (2026-07-28), pai.ts ANSI-color precedent | yes |
| OmniRoute Codex Spark dispatch fleet | ISC-189..ISC-220 | live Spark route, role manifest, governed combo lifecycle, bounded Codex adapter, parallel-dispatch skill | yes |
| Paseo vault portfolio reconciliation | ISC-221..ISC-250 | vault inventory, Paseo daemon, verified provider catalog | no |
| Provider capability taxonomy and promotion gate | ISC-251..ISC-255, ISC-271..ISC-272, ISC-278..ISC-280, ISC-287 | connection inventory, role map, fallback policy, promotion receipts | yes |
| PAI mode skills and session profiles | ISC-256..ISC-268, ISC-288 | OpenCode agents, PAI classifier, stage contract, governed portfolios | yes |
| Route receipts and startup validation | ISC-269..ISC-274, ISC-283..ISC-286 | relay headers, profile manifest, concrete-model readback, plugin loader | yes |
| Curated OpenCode and combo lifecycle | ISC-257..ISC-261, ISC-273, ISC-275..ISC-282, ISC-289..ISC-290 | backup-first config writer, OmniRoute snapshots, live runtime, direct CLI | no |
| Mac rollout confirmation | ISC-291..ISC-295 | live OpenCode, doctor, bundle receipt | no |
| EC2 discovery and capability evidence | ISC-296..ISC-307 | AWS `safvr`, SSM, systemd, catalog, canaries | no |
| Linux governed session reconciliation | ISC-308..ISC-326 | immutable router release, systemd relay, Ubuntu OpenCode, mode skills | no |
| EC2 rollback and Hermes isolation | ISC-327..ISC-332 | receipt, rollback rehearsal, unit snapshots, security-group readback | no |
| EC2 genuine S-tier promotion | ISC-333..ISC-336 | provider authentication, admin combo, readiness gate, Algorithm canary | no |
| Provider topology truth reconciliation | ISC-337..ISC-346 | live OmniRoute inventory, topology telemetry, dashboard projection, guarded runtime invariants | yes |
| Remote transport security boundary | ISC-347..ISC-360, ISC-402, ISC-405 | OmniRoute auth settings, scoped key policy, Cloudflare transport, rollback | no |
| Governed context optimization | ISC-361..ISC-373 | PAI fixtures, GSD pointers, ISA identifiers, OmniRoute preview APIs | yes |
| Native CLI Code and Hermes discovery | ISC-374..ISC-380 | OmniRoute CLI helpers, installed source, existing Codex profile, Hermes settings API | yes |
| MCP, A2A, and skill-cluster boundary | ISC-381..ISC-388 | scoped MCP status, A2A card, skill-index, capability packet | yes |
| Historical Spark-pinned dispatch proof | ISC-389..ISC-398 | `te-dispatch`, `temperance-batch`, attempt receipts, installed skill refresh | yes |
| Native capability integration documentation | ISC-399..ISC-404 | ownership matrix, contract tests, full verification, protected runtime invariants | no |
| Native Keychain-backed Claude launch and local auth migration | ISC-405..ISC-429, ISC-433..ISC-441, ISC-450..ISC-455, ISC-458 | OmniRoute native launcher, four Claude profiles, separate no-log Keychain key, spend caps, artifact redaction, restart recovery, canaries, rollback | no |
| Named Cloudflare Access promotion | ISC-352..ISC-360, ISC-430..ISC-432, ISC-446..ISC-449 | constrained remote key, named tunnel, machine identity, Access policy, remote receipts | no |
| Governed heterogeneous non-Codex dispatch | ISC-442..ISC-445, ISC-459..ISC-464 | exact OmniRoute models, native and Codex-compatible client-wire probes, negative controls, attempt and gateway receipts | yes |
| Mac proxy streaming attribution and transactional promotion | ISC-270, ISC-465 | bounded SSE trailer receipt finalization, LaunchAgent snapshots, retry, health, and restore | no |
| Receipt-bound circuit enforcement | ISC-58, ISC-466..ISC-469 | persisted observations, deterministic planner, host mode controller, atomic half-open lease | no |
| Provider-topology and remote-authority truth | ISC-456..ISC-457 | OpenCode configuration, OmniRoute topology semantics, Wrangler authority audit | yes |
| Read-only Cloudflare and native A2A readiness | ISC-470..ISC-479 | Wrangler identity report, installed OmniRoute source, bounded live receipts, negative fixtures | yes |
| Atomic signed-probe challenge enforcement | ISC-490..ISC-490.7 | signed-probe verifier, owner-only state directory, receipt-bound recovery | no |
| Governed OmniRoute compression boundary | ISC-491..ISC-493 | native per-request override, host manifests, OpenCode provider headers, relay final-boundary normalization | no |
| Explicit Mac relay readiness lifecycle | ISC-494 | fail-closed readiness parser, LaunchAgent transaction, prior Mac S evidence | no |
| Non-authorizing EC2 S-candidate falsifier | ISC-495..ISC-505 | explicit candidate manifest, serial controls, bounded content/tool probes, exclusive telemetry receipt, protected-host invariants | no |
| Receipt-bound named Cloudflare promotion transaction | ISC-506..ISC-528 | strict manifest, authority preflight, Access-first prepare/promote state machine, approval, secret sinks, connector lifecycle, canaries, reverse rollback | no |
| Isolated Cloudflare production-adapter boundary | ISC-529..ISC-536 | exact installed OmniRoute contract, Cloudflare API schemas, owner-only persistence, signed approval, explicit external authority | no |
| Redacted native control-plane snapshot | ISC-537..ISC-547 | verified local read-only collection, topology semantics, Context Settings, CLI/Hermes, MCP/A2A, Sol-free dispatch, safe operator evidence | no |
| Client-owned pointer-only Context Source bridge | ISC-548..ISC-556 | shared enrichment core, fixed PAI/GSD/skill-index candidates, scoped installer, native boundary guide, independent review | no |
| Direct Command Code pointer-catalog alignment | ISC-557..ISC-563 | metadata-only helper, exact-one render validation, fail-closed dispatch, isolated workspaces, boundary documentation | no |
| Secretless native Hermes discovery hardening | ISC-564..ISC-571 | prior CLI Agents research, redacted local snapshot, official Hermes config contract, zero-auth offline compilation, governed non-Codex review | no |
| Synthetic Context Settings preview qualification | ISC-572..ISC-585 | installed 3.8.48 route contract, synthetic fixture matrix, process-bound authentication gate, invariant snapshots, metadata-only receipt | no |
| Isolated private external Codex workers | ISC-586..ISC-595 | explicit OmniRoute adapter contract, Codex isolation flag, private dispatcher artifacts, self-contained task packets, Sol-free governed rails | no |
| Portfolio-first vault project relocation and portable pickup | ISC-613..ISC-749, ISC-642.1 | exact two-portfolio allowlist, ratified registry roots, owner-evidenced portfolio mapping, read-only inventory, bounded old-path consumer audit, isolated single-writer portfolio registries, Thoughtseed outcome projection plus append-only content-addressed evidence, pre-existing client-neutral project packet, scoped routing profiles, single-canary transaction, six-file capsule, resolver plus live-client pickup, rollback, zero session/Paseo dependency | no |
| Read-only portfolio inventory and Workbench reconciliation | ISC-750..ISC-757 | approved roots, existing Workbench implementation, authenticated read-only route | yes |
| Repository identity and folder-organization ratification interview | ISC-758, ISC-759, ISC-760, ISC-760.1, ISC-760.2, ISC-760.3, ISC-760.4, ISC-760.5, ISC-760.6, ISC-760.7, ISC-760.8, ISC-760.9, ISC-760.10, ISC-760.11, ISC-760.12, ISC-760.13, ISC-760.14, ISC-760.15, ISC-760.16, ISC-760.17, ISC-760.18, ISC-760.19 | owner answers recorded sequentially before the next ballot | no |

## Architecture

<!-- arch-assets:start -->

_Auto-maintained by `ArchitectureAssetsSync.hook.ts` on release events._  
_Last refreshed: 2026-07-27T13:28:31.000Z_

| Asset | Status | How it's generated |
|---|---|---|
| [`docs/architecture/SERVICES.md`](docs/architecture/SERVICES.md) | ✅ current | auto (file scan) |
| [`docs/architecture/DEPENDENCY-GRAPH.md`](docs/architecture/DEPENDENCY-GRAPH.md) | ✅ current | auto (file scan) |
| [`docs/architecture/architecture.html`](docs/architecture/architecture.html) | ✅ current (updated 2026-07-27: OmniRoute layer + deep-dive link) | manual (LLM skill) |
| [`docs/architecture/system-internals.html`](docs/architecture/system-internals.html) | ✅ current (updated 2026-07-27: relay/reconciler/headless mechanics) | manual (LLM skill) |
| [`docs/architecture/integration-map.html`](docs/architecture/integration-map.html) | ✅ current (updated 2026-07-27: OmniRoute relay + reconciler WIRED seam) | manual (LLM skill) |
| [`docs/architecture/session-trace.html`](docs/architecture/session-trace.html) | ✅ current (updated 2026-07-27: automatic chat request trace) | manual (LLM skill) |
| [`docs/architecture/omniroute-routing.html`](docs/architecture/omniroute-routing.html) | ✅ current (new 2026-07-27) | manual (LLM skill) |
| [`docs/architecture/brand-connectors.html`](docs/architecture/brand-connectors.html) | ✅ current (new 2026-07-28) | manual (LLM skill) |
| [`docs/architecture.md`](docs/architecture.md) | ✅ current (updated 2026-07-27: OmniRoute component + data-flow step) | manual (LLM skill) |
| [`docs/architecture/notebooklm-prompt.md`](docs/architecture/notebooklm-prompt.md) | ⬜ not yet generated | manual (LLM skill) |

**To refresh LLM-generated assets:** invoke `/refresh-architecture` in any Claude Code session.

<!-- arch-assets:end -->

## Decisions

- 2026-08-02 08:16: refined: Direct Command Code alignment preserves the live Bash renderer's existing ISA and memory semantics and delegates only pointer projection to a small Bun helper over the canonical metadata-only resolver and pure serializer. Any missing runtime, helper failure, malformed output, reserved-line spoof, or exact-one failure aborts before Command Code launch; same-model dispatches use distinct private workspaces. Absolute pointers remain ephemeral runtime material and are never committed or treated as authorization.

- 2026-08-02 07:53 IST: The Context Source integration is a client-owned discovery catalog, not an OmniRoute memory store. Shared enrichment resolves only PAI `Algorithm/LATEST`, repo-local GSD `.planning/STATE.md`, and the canonical skill-cluster index; emits one compact pointer-only line on Claude, Codex, OpenCode, and Kimi; and runtime-gates that exact surface allowlist. Direct Command Code remains outside the claim because its renderer does not execute the Context Source stage. Native Obsidian/Notion promotion is held because installed OmniRoute persists tokens and exposes full-note/write-capable tools; Hermes apply, MCP/A2A, Cloudflare, EC2, and S-tier promotion remain unchanged. The scoped refresh replaces only the installed enrichment core with backup-first recovery.

- 2026-08-02 07:02 IST: refined: The redacted native control-plane snapshot closes ISC-537..ISC-547 as a local observation surface only. It now requires exact schema version `1`, WAL plus stable sidecars and no hot journal, binds the listener PID to its running OmniRoute 3.8.48 package hash and exact database device/inode, joins Quick Tunnel state to stable `cloudflared` process absence, and emits only five short-lived non-authorizing layers. Compression is `off` only when the master is off and otherwise `request-dependent`; dispatch rejects `sol`, `sol-max`, and `solmax` across workers and direct fallbacks while separately counting non-Codex workers, provider families, targets, and native profiles. The mandatory Advisor's second conflict-recall attempt timed out without a verdict, so timeout was not accepted as approval; the file-backed architecture recheck and independent Cato audit both returned PASS after reproducing 9 focused tests/53 assertions and the live status. The final canonical verifier exited zero. No management credential, HTTP/WebSocket/network collection, Cloudflare promotion, Hermes/EC2 mutation, MCP/A2A activation, Algorithm/S promotion, or new Sol call occurred.

- 2026-08-02 05:53 IST: refined: The mandatory Advisor returned no verdict before its 90-second timeout. An independent architecture reviewer then found a P0 in the first snapshot design: exact loopback HTTP authenticates location, not server identity, so a rogue local listener could receive the Keychain administrator credential. The build therefore removes Keychain, dashboard login, cookies, HTTP, and network collection entirely. It uses a verified local SQLite read transaction selecting only aggregate/non-secret columns, checks parent and database identity plus listener PID before and after, binds the snapshot to installed version and dispatch-manifest hash, expires evidence quickly, reports WebSocket-only activity as unknown, and emits fixed observational adoption states with `promotionAuthorized:false`.

- 2026-08-02 05:42 IST: The provider-topology graph is an activity projection over a separate inventory, not a provider registry. Installed 3.8.48 passes the complete provider-family list, live WebSocket `request.started` state, `lastProvider`, and `errorProvider` independently; its blue badge counts active provider families. Live management readback currently reports 26 topology families while the screenshot highlights only active/recent/error rails. The locally executable intervention is therefore a fail-closed, redacted, read-only native control-plane snapshot. It may observe Context Settings, CLI detection, MCP/A2A, provider counts, topology semantics, and the Sol-free dispatch contract, but it may not enable a protocol, apply generated config, mutate Hermes/EC2, or broaden Cloudflare authority.

- 2026-08-02 04:17 IST: refined: The named-tunnel transaction closes only the fifteen locally executable contract criteria ISC-506..ISC-511, ISC-513, ISC-516..ISC-518, ISC-521..ISC-522, ISC-524, ISC-526, and ISC-528. Advisor review forced strict duplicate-key rejection, non-vacuous network canaries, wildcard/apex shadow detection, cryptographic approval verification, stuck-open containment, response-before-journal recovery, and journal-derived ownership tags. Independent Cato returned PASS with no P0/P1 after reproducing the focused suite and diff hygiene. ISC-512, ISC-514..ISC-515, ISC-519..ISC-520, ISC-523, ISC-525, and ISC-527 remain open because a generic CLI and injected fake adapter cannot prove real scoped authority, secret sinks, production journaling, staging canaries, or durable approval consumption. No live tunnel, DNS, Access, connector, key, Hermes, EC2, provider, or Sol state changed.

- 2026-08-02 03:30 IST: refined: Two exact non-Codex OmniRoute reviews completed through `gh/claude-sonnet-5` and `no-think/gh/claude-sonnet-5` with substantive results and zero Sol use. They exposed remote-versus-local tunnel configuration ambiguity, the impossible conflation of pre-DNS object proof with post-DNS runtime denial, connector connection-cleanup delay, collision recovery, and process-secret risks. Official Cloudflare documentation confirms remotely managed configuration through the tunnel configuration API and `originRequest.access.required` with exact `teamName`/`audTag` enforcement. The accepted design splits inert `prepare` from approval-bound `promote`, starts and verifies the connector before final DNS cutover, and stops the connector before DNS removal because cached DNS can outlive deletion. Advisor's conflict recall timed out after 90 seconds and contributes no verdict. ISC-512, ISC-516, ISC-517, and ISC-521 are refined; ISC-527..ISC-528 add approval and no-exposure prepare boundaries.
- 2026-08-02 03:24 IST: refined: The next feasible move is not a live Cloudflare promotion and not an A2A wrapper. Live evidence still lacks hostname, DNS, Access-policy, machine-identity, resource-scope, and zone authority; AWS SSM auth is also expired, while native A2A retains ambient-manage and ownership defects. FirstPrinciples classifies external authority as hard but manual deployment as soft. SystemsThinking selects a Level-5 rules intervention: an Access-first transaction state machine. RootCauseAnalysis identifies single-event cut sets—route-before-Access, broad origin key, missing catch-all, secret-bearing process arguments, and forward-order rollback—that must become structurally impossible. Science ranks a fully executable but inert promotion transaction above waiting, unsafe A2A wrapping, or unauthenticated EC2 work. ISC-506..ISC-526 therefore define the local preparation that may close without claiming ISC-352..ISC-360, ISC-430..ISC-432, or ISC-446..ISC-449.
- 2026-08-02 03:12 IST: The EC2 genuine-S gate now has a non-authorizing falsification instrument, not a readiness oracle. It admits only three preregistered non-Sol Opus aliases, requires valid pin-before, mismatch, and pin-after controls, stops candidate work immediately when early controls are invalid, and never mutates routing or promotion state. The live fail-fast receipt is deliberately inconclusive: its mismatch control was structurally unexpected, so all candidates are `STRUCTURALLY_UNVERIFIABLE`, zero candidate requests were attempted, and no candidate absence or identity conclusion is permitted. Protected service, unit, listener, security-group, Hermes, and `TEMPERANCE_AUTO_READY=0` invariants remained exact. A later diagnostic-bundle refresh was blocked by an expired AWS session before SSM staging and contributes no instrument evidence.
- 2026-08-02 02:13: refined: The pre-build Advisor rejected any positive genuine-S/readiness interpretation as circular gateway self-attestation. The accepted design is therefore a falsification-only instrument with no identity, readiness, authorization, or promotion claim and no consumer. A well-formed nonexistent-model control runs before and after candidates; the currently reproducible `auto/claude-opus` attribution mismatch proves the contradiction branch remains reachable. Controls and candidates are serial, nonce-bound, compression-off, bounded, and raw-HTTP. Explicit attribution contradiction may produce `FALSIFIED`; absence, refusal, timeout, truncation, normalization, and path disagreement cannot. Receipts are exclusive mode-600 allowlisted telemetry, explicitly unauthenticated and expiring, with no raw bodies/errors or credential surface. Missing Auggie is a prerequisite failure, not a model failure. This iteration may add evidence but cannot close ISC-333 or mutate promotion state.
- 2026-08-02 02:04: refined: EC2 S readiness is defined by exact serving attribution plus successful content and forced-tool behavior, never by a catalog alias or HTTP 200 alone. Fresh non-Sol probes falsified every visible Opus candidate: `aug/claude-opus-4.6` returned 502 because the Auggie CLI is absent; both `theoldllm` Opus aliases returned 403 `insufficient_quota`; and `auto/claude-opus` returned 200 only by silently serving Nebius Llama 3.3 70B. Sol aliases were absent and no Sol request was made. ISC-333 remains open, and the next bounded improvement must turn this exact rejection contract into a repeatable, non-authorizing readiness receipt before any combo mutation is considered.
- 2026-08-02 01:46 IST: The literal-off boundary iteration is accepted as a contained local completion, not authority to finish the persistent promotion goal. The post-deliverable Advisor withdrew its wrong-layer transport objections after conflict recall and returned no P0; its remaining process-freshness and enablement questions were closed by deployed-file mtime/ctime preceding PID start plus request-path source and live-state inspection. Independent Cato reproduced the focused suites and live invariants and returned PASS with no P0/P1. Cloudflare, A2A, Hermes, EC2 S, combo promotion, and genuine-S authentication remain outside this iteration.
- 2026-08-02 01:14 IST: OmniRoute's native per-request `x-omniroute-compression` override is adopted only as an explicit literal-off defense-in-depth boundary. Both governed OpenCode providers receive the header through a manifest-owned, case-insensitive preserve-and-canonicalize merge; the relay overwrites client input at the final outbound boundary. The global master remains off, no response header is accepted as proof, and promotion requires outbound request capture without changing Cloudflare, A2A, EC2, Hermes, routing promotion, or Sol-family state.
- 2026-08-02 01:31 IST: refined: Guarded Mac relay promotion exposed that the older deployed proxy treated an absent readiness variable as ready while the corrected fail-closed proxy requires explicit evidence. The LaunchAgent lifecycle therefore records canonical readiness explicitly, defaults new installs to `0`, and enables `1` only when deliberately supplied. This Mac rollout may restore `1` from its already-proven host contract without dispatching the protected Sol-family model; EC2 remains independently gated at `0`.
- 2026-08-02 00:04 IST: ISC-490 closes as a standalone, non-authorizing local controller only. The post-deliverable Advisor found no P0 and its evidence requests produced descriptor `fstatfs`, APFS `F_FULLFSYNC`, runtime CLOEXEC assertions, explicit cross-process flock/SIGKILL coverage, durability-failure injection, readonly literal `authorizing:false`, and a repository import ban. Two exact non-Codex OmniRoute audits (`antigravity/claude-sonnet-5` and `gh/claude-sonnet-5`) returned PASS with zero Sol use. Cato then found one P1 raw-parent-traversal normalization gap; the shared path boundary now rejects every non-canonical raw absolute spelling before access, and Cato's recheck returned PASS with no P0/P1. The controller remains absent from current Cloudflare, A2A, routing, EC2, Hermes, and promotion call sites.
- 2026-08-01 23:05 IST: The required pre-build `Inference.ts --mode advisor --auto-state` call returned no content before its 90-second timeout, so an independent architecture reviewer audited the concrete ISC-490 design. The review rejected byte-restoring rollback after consumption because it would reopen a replayable challenge. Challenge consumption is therefore irreversible; rollback is a new monotonic revocation transition permitted only while the exact issued state remains current. The controller uses an OS advisory lock released automatically on process death, generation plus operation identity to prevent ABA recovery, descriptor-relative POSIX file operations inside exact-eUID mode-700 directories, strict fsync ordering, and fail-closed filesystem support.
- 2026-08-01 21:05 IST: OmniRoute streaming attribution arrives in final SSE comments rather than the initial compatibility response headers. The Temperance proxy now finalizes a successful stream receipt only after EOF, parses bounded control trailers across chunk and newline boundaries, prefers final attribution over stale headers, preserves every forwarded byte, and records missing attribution, cancellation, body absence, read failure, or non-2xx status without a false success.
- 2026-08-01 21:05 IST: The first canonical Temperance proxy promotion reproduced macOS `launchctl bootstrap` error 5 after the previous agent had been booted out. The old agent was immediately recovered without restarting OmniRoute. Proxy promotion now snapshots every live artifact before mutation, retries transient bootstrap failure, requires bounded loopback health, and transactionally restores the exact prior proxy, router, enrichment tree, and plist on any failed promotion.
- 2026-08-01 19:46 IST: The post-deliverable Advisor initially refused certification because its auto-state prompt was empty. A conflict recall supplied exact files, live HTTP/listener/restart/redaction evidence, receipt results, and the full-gate result; the advisor withdrew the no-evidence claim. Its requested negative controls were promoted into executable tests rather than answered narratively. Cross-vendor Cato then returned PASS with no local P0/P1.
- 2026-08-01 19:46 IST: OmniRoute 3.8.48 stores FNV-1a 32-bit in its legacy-misnamed `artifact_sha256` field. The redactor preserves that upstream compatibility contract but records a separately named genuine SHA-256 in its mode-600 receipt; the fixture asserts 8-hex and 64-hex values independently.
- 2026-08-01 19:46 IST: The advisor's overdue Hy3/MiniMax-M3 warning came from stale project memory, not live configuration. Repository inspection proved the reversion was completed on 2026-07-28; the project-memory note now records that resolution and the current Ling/Laguna high-volume pins.
- 2026-08-01 19:30 IST: Two bounded native non-Codex workers completed through distinct OmniRoute provider families: `antigravity/claude-sonnet-5` returned 5,412 result characters and `gh/claude-sonnet-5` returned 3,091. A mode-600 receipt joins both outputs to gateway HTTP-200 summaries with zero retained request/response artifacts and zero Sol identifiers. Worker recommendations remain advisory; ISA, not the transport receipt, decides acceptance.
- 2026-08-01 19:27 IST: The first restart-persistence rehearsal exposed a real launchd failure: bootstrap returned error 5 after the manual daemon stopped. The gateway was restored on loopback, the installer gained three bounded bootstrap attempts plus prior-plist/manual-daemon recovery, and a fresh rehearsal passed with mandatory auth, Quick Tunnel stopped, and a loopback-only listener. Restart success is never inferred from the install command alone.
- 2026-08-01 19:22 IST: The dedicated Claude key is now `noLog=true` with USD 10 daily and USD 50 weekly limits. The security audit found ten earlier protected artifacts; exact row/path preflight preceded irreversible body redaction, metadata-only summary artifacts remain, and the mode-600 receipt explicitly states that no secret backup was created. Credential-bearing curl paths now use process-private config stdin/descriptors, and a mocked apply/rollback/revocation suite enforces that contract.
- 2026-08-01 19:21 IST: A live throwaway-key rehearsal observed OmniRoute 3.8.48 continue accepting the deleted key through its data-plane validation cache, then return HTTP 401 after sixty seconds. Remote incident response therefore stops transport first and restarts the drained loopback service when immediate cache invalidation is required; deletion acknowledgement alone is not revocation proof.
- 2026-08-01 19:17 IST: Cloudflare control-plane inspection found an authenticated Wrangler session with a connector-write permission label but no resource-scoped or hostname-zone authority proof, no named tunnels, no local tunnel credentials, and no DNS Write, Access Apps and Policies Write, or Access Service Tokens Write label. No remote surface was created. Remote promotion requires explicit hostname/zone selection plus resource-bound authority, Access-before-route sequencing, a service token or mTLS, a constrained no-log remote key, and catch-all 404 ingress.
- 2026-08-01 19:15 IST: Four exact non-Codex Codex-wire probes were not promotable: DeepSeek lacked provider credits, Kimi disconnected before `response.completed`, Grok produced duplicate tool definitions, and Nebius ended with the truncated tail `AL` despite a zero exit. The dispatcher now rejects terminal tails under 24 characters or 12 letters. Catalog presence remains availability evidence only; native provider wires may promote independently.
- 2026-08-01 18:39 IST: The user broadened this execution from Spark-only fan-out to governed non-Codex OmniRoute workers. New integration tasks may pin live, probe-passing models from distinct non-Codex provider families; every attempt remains backend-explicit, Sol-free, and receipt-attributed. Historical Spark acceptance evidence remains valid but no longer defines the only worker rail.
- 2026-08-01 18:39 IST: “Non-Codex model” describes the serving OmniRoute provider/model, not necessarily the local agent-loop binary. A Codex CLI may serve only as the tool-capable wire client when the target model passes that Responses/tool contract; otherwise the task uses the provider's native direct client. No model is promoted from catalog presence alone.
- 2026-08-01 18:25 IST: Native Claude adoption will use a Temperance allowlisting wrapper that reads a dedicated `OmniRoute Temperance Claude API Key` item from macOS Keychain and then delegates to OmniRoute's supported `launch --profile` command. The four generated `settings.json` files remain tokenless, so future OmniRoute profile auto-syncs cannot erase authentication and no secret enters generated configuration; the pre-existing Codex/Spark item remains separate.
- 2026-08-01 18:25 IST: OmniRoute's native local context file is not the secret store for this migration. Although it is chmod 600, its `apiKey`/`accessToken` fields are plaintext JSON; Keychain remains the local credential boundary, while the native launcher remains the execution boundary.
- 2026-08-01 18:25 IST: The FaultTree top event is “remote transport reaches unbounded OmniRoute inference or management.” Its single-event cut sets are anonymous `/v1` while `REQUIRE_API_KEY=false`, a broad remote key, a Quick Tunnel with no durable policy, and a plaintext client credential. Promotion therefore eliminates every single-event cut set before any named tunnel starts: mandatory client auth, dedicated least-privilege remote key, Cloudflare Access, finite rate/spend, endpoint/model restrictions, loopback origin, and catch-all `404`.
- 2026-08-01 18:25 IST: The highest feasible SystemsThinking leverage is the rules layer, not another routing parameter: “PAI/GSD/ISA own policy; OmniRoute transports only authenticated, already-governed work.” The tactical compensating controls remain the stopped Quick Tunnel and loopback listener; receipt correlation shortens the feedback delay after promotion.
- 2026-08-01 18:25 IST: Context Settings remains globally off. The database contains no explicit `engines` row, so the dashboard's Caveman candidate is derived from legacy configuration and cannot affect requests while the master switch is false. Any future optimization begins with preview fixtures and a route-bounded combo, never a global PAI/GSD/ISA prompt transformation.
- 2026-08-01 18:25 IST: Native Hermes support is documentation and proposal generation only for this rollout. The installed generator persists `api_key` into `config.yaml`; it will not touch the protected EC2 Hermes runtime or replace the existing systemd credential boundary.
- 2026-08-01 18:25 IST: FeedbackMemoryConsult found no relevant project feedback entry; the sole keyword match was an unrelated Klear Karma visual-style note. The live dispatch evidence and current ISA decisions therefore remain the applicable failure memory: keep Spark pinned, reject false-green terminal output, and treat missing per-task gateway correlation as a remote-promotion blocker.

- 2026-08-01 18:10: Final Cato-style delta audit found no P0/P1. It considers the dispatcher receipt-integrity P2 resolved for the local acceptance ledger: per-execution/task correlations are unique, malformed terminal streams fail closed, and the full focused suite passes. Gateway-side per-task correlation joinability remains explicitly unproven and continues to block combo and remote promotion.
- 2026-08-01 18:07: Refined ISC-353 to match the same evidence gate as ISC-392: a future remote key must allow only exact pinned Spark while `te-dispatch` is held. Granting a remote key to a combo whose non-Spark members fail the Codex Responses contract would reintroduce the false-green route through a new trust boundary.
- 2026-08-01 18:03: After the dispatcher fix, the same four bounded read-only tasks were rerun concurrently through exact `omniroute` + `codex/gpt-5.3-codex-spark`. All four completed in 14–17 seconds; every output was nontrivial; every task had one attempt, zero fallback, and a unique execution correlation. Independent gateway call-log readback for the run window recorded only provider `codex` / model `gpt-5.3-codex-spark`, with zero Sol-family calls and zero credential-bearing artifacts.
- 2026-08-01 18:04: The canonical full repository gate initially found two stale assertions that still encoded the pre-evidence `te-dispatch` skill contract and an outdated ISA progress value. Both were tightened to the held-combo/pinned-Spark contract and normalized ledger count. The second complete `scripts/verify-all.sh` run exited zero with `Temperance Engine full verification passed`.
- 2026-08-01 18:05: Independent Cato-style audit passed with no P0/P1 findings. Its P2 warning is retained: local `/v1/models` remains anonymous while `REQUIRE_API_KEY=false`; loopback binding and stopped Quick Tunnel contain that condition but do not promote it. The post-deliverable Advisor therefore classifies this iteration as a contained local milestone, not completed remote access; auth migration, dedicated constrained remote key, named Tunnel plus Access, anonymous-denial probes, and rollback rehearsal remain open.
- 2026-08-01 17:47: Refined ISC-392 after live evidence: `te-dispatch` remains Sol-free and Spark-capable as a candidate combo, but it is held from the Codex Responses agent loop. Five round-robin probes produced upstream 400/502 responses or response-stream fragments, while `minContentLength: 0` let outputs ending in `NO` appear successful. Current accepted worker tasks must therefore pin `codex/gpt-5.3-codex-spark`; combo promotion requires wire compatibility, tool-loop success, nontrivial output, and unique receipt correlation for every member.
- 2026-08-01 17:48: Detached app-orchestrated dispatch printed a run directory before its process vanished without an index. The refreshed skill now requires foreground mode for app orchestration and treats a detached path without `index.json` as no progress. A bounded four-way foreground retry completed 4/4 on pinned Spark in 19–26 seconds with nontrivial outputs and zero fallback; the earlier broad five-way audit was retained honestly as 5/5 timeouts at 240 seconds.
- 2026-08-01 17:49: The bounded run exposed a second receipt defect: two distinct tasks shared the same Temperance correlation identifier because degraded static plans created in the same second hash the same task type, candidates, and second-resolution timestamp. Gateway call records also generate their own request correlation rather than preserving the Temperance header. Unique per-execution task correlation and gateway joinability remain promotion gates; duplicate receipts cannot be counted as proof.
- 2026-08-01 17:33: FeedbackMemoryConsult recovered two directly applicable failure patterns: the Spark rail previously returned unavailable for 54 tasks because routing policy had zero candidates despite a healthy gateway, and a delegated group later stalled for 600 seconds. This run therefore requires a live `te-dispatch` membership preflight, per-task timeout, concrete provider/model receipts, and a no-Sol scan of every attempted and fallback route before fleet results are trusted.
- 2026-08-01 17:34: The Quick Tunnel is stopped while loopback OmniRoute remains live. A global auth flip is deferred because four configured Claude profiles point at `localhost:20128` without a client token; the promotion order is local-client key migration, `REQUIRE_API_KEY=true`, local compatibility proof, dedicated constrained remote key, then remote-transport re-enable. Killing only the exact Cloudflare child produced a transient parent restart before OmniRoute persisted `status: stopped`; the former public URL subsequently returned unreachable.
- 2026-08-01 17:24: SystemsThinking/Iceberg diagnosis: the visible event is an anonymously reachable tunneled `/v1`; the recurring pattern is enabling a useful native integration before mapping its trust boundary; the generating structure is independent dashboard-login and client-API authentication controls combined with an all-path Quick Tunnel; the mental model to retire is “local UI login implies tunneled API protection.” The high-leverage intervention is auth-first transport with a dedicated least-privilege key and explicit ownership matrix, not more routing glue.
- 2026-08-01 17:25: First-principles decomposition fixes seven independent seams: transport, authentication, context transformation, planning/policy, agent execution, provider routing, and observability. Cloudflare may transport; OmniRoute may authenticate, transform governed fixtures, route, and observe; PAI/GSD/ISA/skill clusters continue to plan and govern; Codex/Hermes remain separate execution clients. No native feature is adopted by collapsing two of those owners.
- 2026-08-01 17:26: Structured investigation results: “dashboard login secures Quick Tunnel inference” is refuted by anonymous `/v1/models` HTTP 200 and schema-level chat handling; “global compression safely saves governed tokens” remains unproven pending preservation fixtures; “native CLI Agents can replace the Hermes integration” remains unproven and is restricted to authenticated redacted previews; “`te-dispatch` is Spark-capable and Sol-free” is confirmed by its live five-member round-robin body; “native skill discovery may install directly” is rejected in favor of candidate-only results routed through `skill-index.json`.
- 2026-08-01 17:00: This iteration is native-first and evidence-gated: inspect OmniRoute documentation, backing APIs, runtime state, and existing Temperance seams before enabling context compression, agent bridges, public-tunnel access, or new routing. The user-authorized goal includes implementation, but public exposure and Hermes mutations remain separately gated by authentication and invariant probes.
- 2026-08-01: E5 Interview workflow completed with a zero-question queue: Problem, Vision, Out of Scope, Principles, Constraints, Goal, Criteria, Test Strategy, and Features are all non-thin, while the user's supplied rollout summary already answers the foundational scope questions. Diagnosis remains read-only; a UI change is not inferred from a request to understand the topology.
- 2026-08-01: Provider-topology investigation starts with three competing hypotheses—honest activity telemetry, adapter/upstream category conflation, or stale/incomplete projection. The screenshot is reproduction evidence only; no provider, routing, credential, EC2, or Hermes mutation is authorized before the live backing payload identifies the ingestion point.
- 2026-07-29 15:45: refined: Treat the current 1,320-record OmniRoute catalog as volatile availability only. OpenCode will expose three session postures and at most fourteen governed aliases; newly connected AGY, Ollama Cloud, and OpenCode Zen routes receive explicit roles but remain candidate-only until their required evidence and promotion receipts exist.
- 2026-07-29 15:46: Freeze coordinator identity per OpenCode session, not the worker tier for every later task. PAI and Temperance remain the single policy owner; bounded workers may escalate only `B → A → S`, and downgrade requires a new task boundary.
- 2026-07-29 15:47: Preserve the existing dirty-worktree fleet and Spark lifecycle changes. New work uses additive manifests, surgical configuration patches, snapshot-first runtime reconciliation, and focused tests; no existing modified file is replaced wholesale.
- 2026-07-29 15:52: refined after IterativeDepth and Advisor: block cutover until both OpenCode plugins load cleanly, catalog freshness fails closed, the resolved alias set matches exactly, custom limits survive config merge, `te-orchestrate` remains mechanically candidate-only, worker depth is bounded, direct-CLI break-glass succeeds, and partial rollback is receipt-bound.
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
- 2026-07-28: Recorded new bounded FREE command-code deals for the two high-volume slots vacated by the expired 2026-07-21 Hy3/MiniMax-M3 deals, restoring the 2026-07-18 credit-deal intent: `fast`+`validation` → `inclusionai/ling-3.0-flash-free` (FREE), `creative`+`balanced` → `poolside/laguna-s-2.1-free` (FREE). The permanent deals were re-verified present in the live catalog: `long-horizon` → `xiaomi/mimo-v2.5-pro` (5×), `reasoning` → `deepseek/deepseek-v4-pro` (4×). Verification source: `command-code --list-models` (CLI v1.4.3, 2026-07-28). `package/router/classify-task.sh` remains the only pin source; `tests/classify-task.sh`, `tests/dispatch-tasklist.sh`, and `multi-backend-router.sh` MODEL_CATALOG metadata updated to match. The 2026-07-23 interim pins (DeepSeek V4 Flash, MiniMax M2.7) remain valid catalog members but are no longer classifier primaries.
- 2026-07-28: Named Temperance Engine's owned connectors with alchemical proper nouns consistent with the Algorithm's phase-sigil system: PAI → the Athanor (display-only rename; `~/.claude/PAI` and `$PAI_HOME` unchanged), Temperance's own OmniRoute integration code → the Caduceus, the headless EC2 shadow runtime → the Vigil. Explicitly scoped OUT: renaming Cambium/Hermes/Plexus or any part of the separately-governed Thoughtseed production system (documented in that monorepo's own `INFRA_STATUS.md`, outside this repository), renaming third-party deps (`gsd-core`, OmniRoute the product, `hermes-agent`), and applying these names to live display text (deferred). See `docs/superpowers/specs/2026-07-28-connector-brand-design.md`.
- 2026-07-28: Closed the live-display-text deferral above. The Athanor now appears in `~/.claude/PAI/Tools/Banner.ts`'s primary header and PAI-identity row icon (⬢→⚗, live machine files, not git-tracked — backed up before editing); the Caduceus now appears in `package/router/temperance-openai-proxy.ts`'s boot log and `scripts/omniroute-temperance-reconcile.sh`'s LaunchAgent-install/apply-complete lines (PR #29). The Vigil has no live-naming target: `package/headless`'s only stdout is machine-parsed JSON (`canonicalJson(...)`), and naming it there would corrupt a real consumer's parsing — intentionally left alone per ISC-188 rather than forced. The originally estimated "~9 files" for the companion ANSI-color extension (from the pai.ts proof-of-concept) was verified down to exactly one valid target, `OpinionTracker.ts`; see the refutation entry below and ISC-188.
- 2026-07-28 19:39: refined: Use OmniRoute `round-robin` for the `te-dispatch` fleet and leave the existing `te-fast` priority rail unchanged. `temperance-batch` supplies parallelism across independent tasks; OmniRoute distributes fleet requests across provider/model workers and handles per-request fallback. Spark's separate preview rate limit is therefore capacity input, not a reason to make Spark the universal coding default.
- 2026-07-28 19:40: refined: The fleet has two distinct concurrency layers: `temperance-batch` owns parallel task execution and worktree isolation, while OmniRoute `te-dispatch` owns round-robin provider/model capacity, per-model queue bounds, cooldown, and ordered fallback. Keeping those layers separate prevents either OmniRoute or Spark from becoming a second task classifier.
- 2026-07-28 19:43: The pre-build Advisor call timed out after 90 seconds without a verdict. Proceed conservatively with no `activeCombo` mutation, snapshot-first governed updates, exact rollback restoration, bounded round-robin queueing, and preserved direct CLI fallbacks; re-run Advisor after durable artifacts exist.
- 2026-07-28 19:52: refined: Bound Codex's advertised context to 128k whenever `te-dispatch` or the exact Spark route is selected, with auto-compaction at 108k; retain 200k/170k for other portfolios. The adapter must honor the smallest context rail that OmniRoute can choose, not the largest model elsewhere in the fleet.
- 2026-07-28 20:12: The post-build Advisor call also timed out after 90 seconds without a verdict. Preserve the already-tested conservative configuration and require the independent read-only audit plus host-side deferred verification rather than treating Advisor silence as approval.
- 2026-07-28 20:13: Repository and fixture verification is complete through the new Spark lifecycle tests. The restricted task sandbox cannot read the login Keychain item or connect to localhost, so live `te-dispatch` reconciliation and the existing live-proxy suite are tracked as `DV-SPARK-FLEET-HOST-01/02`, not claimed complete.
- 2026-07-28 20:24: refined after independent lifecycle audit: fleet snapshots use schema version 3 and record the planned action, desired body, and successfully applied combo id for each governed role. Rollback is identity-bound, skips unchanged actions, preserves same-name replacements, preflights all post-apply drift before mutation, and restores every governed field for recorded updates.
- 2026-07-28 20:25: refined after independent lifecycle audit: remote credentials are removed from the exported child environment before any `curl`; the login body and inference authorization header travel through process-private mode-`600` temporary files rather than command arguments. Snapshot creation uses process-qualified names plus no-clobber redirection.
- 2026-07-28 20:31: corrected after re-audit: a 2xx create/update response is not trusted as the mutation journal. The lifecycle performs authoritative `/api/combos` readback, recovers created identities by pre/post id difference plus canonical desired-body match, verifies updates at the original id, and records only verified identities; the fixture deliberately returns malformed success bodies for all three mutations.
- 2026-07-28 20:34: independent re-audit PASS: malformed-success journaling, process-argument and child-environment secret handling, identity-bound rollback, unchanged/replacement/drift protections, complete governed restoration, `activeCombo` preservation, and snapshot no-clobber behavior were all confirmed. The remaining preflight-to-mutation TOCTOU is an OmniRoute API limitation because no conditional-write surface is visible; rollback therefore revalidates all governed bodies immediately before its mutation pass.
- 2026-07-29: Use the vault's 87-record `_projects_inventory.json` as portfolio membership, but register only the 85 paths that currently exist as exact Git roots. Preserve the two missing records (`sankalpa`, `witness-agents-intro-web`) as named stale-inventory errors rather than cloning or inventing local state.
- 2026-07-29: Reconcile workspaces exclusively through the Paseo daemon CLI. Registry snapshots are forensic evidence; rollback archives the workspace IDs returned in the apply receipt and never overwrites daemon-owned JSON.
- 2026-07-29: Keep repository-local `paseo.json` optional. Project registration and global role routing are applied now without dirtying 85 repositories; per-project setup/services/scripts require project-specific review.
- 2026-07-29: The pre-build Claude Fable advisor verified all five provider/model strings and independently required daemon-mediated registration, explicit duplicate detection, and receipt-driven rollback. Its third missing-path claim was refuted because byte-level inspection proved the trailing-space `temperence engine ` directory exists.
- 2026-07-29: Treat portfolio coverage and task workspaces as separate layers. Every valid inventory path must have coverage, while additional same-path workspaces are legitimate when an active Paseo agent owns them.
- 2026-07-29: An interrupted wrapper and resumed apply exposed a real concurrency race. Reconciliation now holds an exclusive apply lock, reloads daemon state immediately before every create, and verifies overlap safety with two concurrent processes.
- 2026-08-01 16:38: refined: The rollout's “2 providers” is the intentional OpenCode adapter count (`omniroute` plus `temperance`), not the OmniRoute upstream inventory. The topology graph independently projects configured and historically observed provider identities, while its blue badge and green/red emphasis represent live and last-event telemetry. No routing or provider correction is warranted by the screenshot.
- 2026-08-01 16:47: refined after Advisor and independent read-only audit: the locally captured screenshot's 34-node identity fingerprint matches the Mac projection (25 configured families unioned with 26 non-placeholder historical families after normalization). The audit found no P0/P1 issue and no evidence of provider loss; stale red/error age, configured-versus-historical labeling, and host labeling are P2 dashboard UX concerns, not authority to alter routing.
- 2026-08-01 20:20: Native non-Codex OmniRoute workers are the default bounded audit rail. Antigravity and GitHub Claude may run concurrently only with exact profile pins, no tools, plan permission mode, no session persistence, finite budget, private output, and gateway attribution. Spark is optional and Sol remains excluded.
- 2026-08-01 20:24: CLI Code and CLI Agents are evidence generators, not configuration owners. Native Codex preview runs only with `--dry-run` in an isolated home; native Hermes preview is refused when Hermes state exists, sends no API key, requires placeholders, and invokes no Apply path.
- 2026-08-01 20:27: MCP scope enforcement is a dormant pre-registration invariant. The server stays disabled/offline until a real least-scope client denial can be exercised. A2A stays disabled because its public card is not an authenticated response and its current `/a2a` handler does not validate governed database keys or dashboard sessions.
- 2026-08-01 21:24: Circuit state and ordinary routing signals have different lifetimes. Health, quota, cost, and latency may decay to neutral after their TTL; unresolved `open` and `half_open` states remain fail-closed until cooldown and one atomic probe resolve them. This closes ISC-58 without allowing stale failures to re-enter as apparently healthy candidates.
- 2026-08-01 21:24: The Mac routing policy is promoted through a receipt-bound host controller, not a permanent environment edit. Its first attempt correctly refused OmniRoute health `0.757`; one bounded read-only Spark canary restored fresh health to `0.806`, after which deterministic replay selected `omniroute/temperance-coding`. No Sol model, Cloudflare route, Hermes state, EC2 service, or OmniRoute daemon restart was involved.
- 2026-08-01 21:24: Native A2A remains disabled. The installed `/a2a` handler's optional ambient-key check is not shared by its task list/read/cancel API, the ambient key synthesizes a process-wide `manage` principal, and the shipped CLI's create request does not match the installed task route's exported methods. A custom Temperance facade would not honestly prove native OmniRoute A2A, so ISC-382 stays open.
- 2026-08-01 20:29: Local rollback evidence may be rehearsed offline when the only persisted change is a public LaunchAgent plist and all other surfaces prove zero writes. The rehearsal must join the real pre-change backup, current bytes, Codex zero-write receipt, and Hermes zero-state receipt while leaving the healthy gateway untouched.
- 2026-08-01 23:48: refined: The isolated production adapter is now locally verified, but it is not a live composition root or promotion authorization. Exact OmniRoute 3.8.48 policy mismatch stops before HTTP; Cloudflare remains stopped until hostname, DNS/Access scope, machine identity, signed probe, resource authority, connector, and canary evidence exist. Governed non-Codex OmniRoute workers are authorized for bounded review while Sol remains excluded.
- 2026-08-02 09:53: refined: Native Hermes Apply remains forbidden because OmniRoute 3.8.48 accepts but does not resolve `keyId` and can render a supplied `apiKey` into YAML. Cato correctly rejected the intermediate memory-only login design: plaintext loopback cannot cryptographically bind a request to the intended same-user listener, and path identity checks cannot close a cleanup race. The recurring compiler now performs zero Keychain, login, cookie, CSRF, HTTP, session, or native-endpoint work. It consumes the already hardened local redacted snapshot, requires exact version/runtime/database/combo evidence, never creates or deletes a Hermes path, and retains only a non-authorizing secretless proposal plus v3 metadata receipt. Prior native mapping evidence remains research input, not recurring transport or installation authority. Protected EC2, Cloudflare, MCP, A2A, provider promotion, and native Apply remain outside this slice.
- 2026-08-02 10:23 IST: refined: Context Settings stays a preview-only transport optimization beneath PAI, GSD, ISA, and skill-cluster semantic ownership. The first live probe proves anonymous `401`; the active runtime also rejects OmniRoute's documented machine-bound CLI token at the management middleware, so this iteration will not borrow a browser session, dashboard password, cookie, or inference key to force access. The staged qualifier sends only a synthetic denial canary without authority and may later run the exact Lite → Headroom → minimal-RTK matrix only from an explicit owner-only `oma_live_` scoped access-token file. Every receipt remains metadata-only and non-authorizing; global compression, active combo, custom prompt, routing, Cloudflare, Hermes, MCP/A2A, EC2, and Sol stay unchanged.
- 2026-08-02 11:03 IST: refined after independent Cato: a scoped Bearer token alone cannot authorize semantic preview because separate pre/post process observations do not bind the established plaintext loopback connection to the observed OmniRoute process. The production token path was removed. The live qualifier now sends only the anonymous denial canary with no credential/header and never reads a response body; the exact Lite → Headroom → minimal-RTK matrix remains a pure offline contract until process-bound authenticated transport or an OmniRoute-native one-use preview capability supplies server identity, scope, expiry, and revocation evidence.
- 2026-08-02 11:31 IST: refined after live Council and SystemsThinking: the broad Spark audit timed out because the external Codex worker inherited the operator's user configuration, startup hooks, plugins, and Algorithm entry before it could perform its bounded task; the same exact Spark rail completed a substantive read-only audit in 44 seconds when `TEMPERANCE_OMNIROUTE_CODEX_ISOLATED=1` selected `--ignore-user-config`. The ingestion point is the external worker launcher, not routing rank or timeout size. Governed external Codex workers will therefore default to isolated user configuration while retaining repository rules and receiving self-contained task context; an explicit opt-out remains available. Batch artifacts become owner-only. Antigravity's proposed `skillCluster` router branch was rejected because no such enrichment field exists and making skills a second router would violate the ownership boundary; Spark's A2A proposal was rejected because native A2A remains technically unsafe and externally unpromoted; GitHub's Cloudflare authority concern is already enforced and remains an external gate.
- 2026-08-03 17:58 IST: refined: The repository-relocation taxonomy is portfolio-first and path-stable: working repositories may move only to `/Volumes/madara/2026/Projects/thoughtseed/<repository>` or `/Volumes/madara/2026/Projects/tryambakam-noesis/<repository>`, while lifecycle and repository type remain metadata. The two names are an exact allowlist, not a deletion instruction; every other folder remains untouched. Thoughtseed Labs stays at its current nested-vault path as the knowledge authority. Implementation is dry-run-first and one-canary-per-approval, preserves old-path capsules plus redacted native-session and Paseo successor links, and treats historical outer-vault Git debloat as a separate backup-and-approval operation.
- 2026-08-03 18:06 IST: refined after independent architecture audit: Old paths are ignored by the outer vault, so their capsules cannot be the sole durable authority. The planning recommendation, pending explicit ratification, is for each accepted move to create a canonical, reviewable handoff beneath Thoughtseed Labs `20-operations/project-management/relocation-registry/<portfolio>/<repository>/`; the old-path capsule is a digest-bound convenience pointer and no commit or push is automatic. Session identity is the redacted `provider + host + profile/account + native session ID` tuple with client/importer versions, one-workspace Paseo deduplication, and continuation evidence. Inventory is metadata-only boundary discovery; unknown or out-of-scope provider data remains held rather than implied covered.
- 2026-08-03 18:32: refined: Cross-client continuity is now defined by one repository-owned project packet and one explicit technical checkpoint, not by moving or linking native chat sessions. Paseo and every provider-owned session store are removed from relocation inventory, preflight, apply, verification, rollback, and acceptance. Codex is the default local interactive governance rail; OmniRoute remains model routing only; Hermes retains Thoughtseed remote/scheduled/external authority; and the Tryambakam Kimiclaw, Paperclip, Snow Gloves, Selemene, Cloudflare, and seed planes remain portfolio-local.
- 2026-08-03 18:32: refined: The recommended canonical relocation registries, pending owner ratification, are Thoughtseed Labs `20-operations/project-management/relocation-registry/thoughtseed/<repository>/` for Thoughtseed and root `_System/10865xseed/projects/<repository>/` for Tryambakam. The TN × Snow Gloves clean-pass supersedes Thoughtseed-entangled Kimi/Tauri assumptions; its implementation proposals remain outside the relocation tranche. The transaction is the sole writer to one portfolio registry, any competing identity claim fails closed, old paths receive six-file packet-linked capsules rather than symlinks, and every canary requires a bounded old-path consumer manifest. `hermes-aws-ts` and other path-consumed runtimes remain held.
- 2026-08-03 18:50: refined after independent architecture audit: Packet preparation is a separately reviewed preflight change and relocation never edits checkout files. Thoughtseed IDs must match TeamForge. Repository parentage does not decide portfolio; Snow Gloves, `10869`, and all mixed evidence remain held until owner-mapped. Routing uses portfolio-scoped deployment and credential profiles; TN OmniRoute delegation remains unverified and fails closed. Pure resolver proof and a real-client canary are separate acceptance gates. The selected registry needs a clean or owner-checkpointed baseline. The rename contract uses an atomic same-volume POSIX rename with immediate path/device/inode revalidation under a stated non-hostile-local-process threat model rather than claiming unsupported descriptor-relative safety.
- 2026-08-03 19:02: refined: The owner ratified Thoughtseed registry root `thoughtseed-labs/20-operations/project-management/relocation-registry/thoughtseed/<repository>/` and Tryambakam registry root `/Volumes/madara/2026/twc-vault/_System/10865xseed/projects/<repository>/`. For Thoughtseed, “merge back” is outcome projection after repository acceptance: current state plus `relocation_evidence_ref` enters the canonical main project record, then the TeamForge-keyed registry entry closes as `reconciled` and remains in place as tamper-evident Git history. Historical transition, ratification, integrity, receipt, and rollback evidence never flatten into the main record or disappear. Tryambakam remains TN-local.
- 2026-08-03 19:07: refined after Advisor boundary review: `relocation_evidence_ref` is content-addressed (`sha256:<digest>`) and separate from its lookup path; reconciliation status is derived from append-only transition events; closure records the tool actor and owner ratifier separately; Git identity uses HEAD and canonical ref-set equality plus explicit untracked/ignored-file digests rather than packfile bytes. The Advisor's artifactless claim that Thoughtseed is only a neighbor was rejected because the ratified Thoughtseed path is inside Thoughtseed Labs main project management. Delegation was intentionally skipped: this was a sequential three-document wording update with overlapping authority semantics, and direct lookup/edit completed below the thirty-second delegation gate.
- 2026-08-04 00:30 IST: refined: The owner authorized the read-only two-portfolio inventory and directed the investigation to reuse the existing Cambium Portfolio Workbench. The E5 Interview workflow found no thin policy section requiring another question because prior owner answers already ratify scope, target taxonomy, registry roots, Thoughtseed merge-back semantics, and the no-move boundary. This iteration may write only the Temperance ISA and planning report; repository, session, Paseo, and external-service mutation remains forbidden.
- 2026-08-04 00:53 IST: refined: The anti-mutation probe distinguishes the explicitly authorized Temperance acceptance-ledger update and cross-portfolio planning report from source-checkout, destination, session, Paseo, and external-service mutation. This avoids falsely claiming byte identity for the two authored planning artifacts while preserving the no-relocation boundary.

- 2026-08-04 01:01 IST: refined after post-deliverable Advisor and independent audit: Reconciliation coverage is now explicit in both directions; 14/54 WorkObjects carry 19 repository-provenance strings, 40 remain unknown rather than silently classified, and zero exact repository-to-WorkObject joins are claimed without an immutable mapping table. Thoughtseed's 112 Git markers are split into 36 immediate primary roots, 4 immediate worktrees, and 72 nested/worktree/bare markers rather than called movable units. The TeamForge zero is bound only to an exact local Miniflare snapshot; the TN registry absence is `not configured`. The configured Cato role was unavailable, so a fresh independent Cato-style read-only auditor ran the exact checklist and returned PASS with no P0/P1; this is not represented as a cross-vendor Cato invocation.
- 2026-08-04 01:11 IST: refined: The owner opened a sequential identity-mapping interview. Each turn will present exactly one ratification question, write the answer back before advancing, and preserve project identity, WorkObject identity, Git identity, and filesystem address as separate fields. No repository move or parallel adjudication occurs during the interview. The E3 delegation floor is intentionally relaxed because only the owner can ratify identity semantics; later independent read-only evidence collection may use the governed non-Sol dispatch rail.
- 2026-08-04 01:17 IST: refined after pre-commitment Advisor: The first proposed ballot improperly bundled path semantics, project authority, repository identity, and WorkObject cardinality. The interview now starts with only the path invariant: a path is a machine-scoped, time-bounded address and never an identity. Host/repository identity, multiple simultaneous worktrees, project-to-repository cardinality, WorkObject roles, merge/split semantics, and enforcement each remain separate later decisions. No contract row is ratified by this refinement.
- 2026-08-04 01:18 IST: refined after post-deliverable Advisor: The first ballot is narrowed again to one principle only: a filesystem path is not the identity of a repository. Address-record fields, path normalization, machine identity, temporal semantics, simultaneous-address cardinality, and storage scope remain undecided. Approval of the principle is a modeling decision only and authorizes no migration, schema change, registry write, or file movement.
- 2026-08-04 01:19 IST: Decision 1 ratified by the owner: a filesystem path is not the identity of a repository. This is a modeling decision only; address schema, normalization, cardinality, migration, registry writes, and implementation remain unauthorized.
- 2026-08-04 01:23 IST: refined after Decision 2 Advisor review: The proposed provider-issued-ID ballot was held because it would prematurely exclude local and content-derived identity schemes while leaving host-instance and identifier-obtainability semantics unresolved. Decision 2 is narrowed to one mechanism-neutral stability invariant: the same hosted repository object retains repository identity across rename, same-host ownership transfer, and visibility changes. No identifier choice or implementation is ratified by this refinement.
- 2026-08-04 01:28 IST: refined from owner correction: The immediate problem is the absence of a consistent system for renaming and organizing repository folders beneath `/Volumes/madara/2026/Projects/thoughtseed/` and `/Volumes/madara/2026/Projects/tryambakam-noesis/`. The hosted-repository continuity ballot is paused. The already-ratified shallow portfolio spine remains intact, while repository-directory naming is now the next sequential decision. No folder rename, directory creation, move, or implementation is authorized.
- 2026-08-04 01:32 IST: refined after naming-ballot Advisor and filesystem inspection: Naming grammar and naming-source provenance are separate axes. The next ballot decides only whether destination repository directories are universally normalized, universally preserved, or normalized case-by-case. Exact grammar, source precedence, collision handling, and rename mechanics remain later decisions. `/Volumes/madara` is Journaled HFS+ and therefore requires explicit case-only rename safeguards in any later implementation; this observation grants no mutation authority.
- 2026-08-04 01:34 IST: refined after post-deliverable Advisor: The naming-policy ballot is binary and applies only to local destination repository directory basenames. Option A normalizes every future approved repository basename under one shared convention; Option B preserves each approved basename exactly and is the no-action default. Remote repository names are untouched. Choosing A authorizes only three later planning ballots—grammar, derivation/segmentation, and collision/exceptions—and no filesystem operation.
- 2026-08-04 01:38 IST: Decision 2 ratified by the owner: every future approved local destination repository directory basename is normalized under one shared convention. Remote repository names remain untouched. This authorizes only the later grammar, derivation/segmentation, and collision/exception planning ballots; it authorizes no filesystem operation.
- 2026-08-04 01:41 IST: refined after pre-commitment Advisor: The proposed kebab-versus-snake ballot was held because both alternatives silently ratified a broader ASCII character envelope and made internal dots unrepresentable. To preserve one-axis ratification, the next ballot asks only whether internal dots are representable in the canonical local basename grammar. Separator choice, other character classes, derivation, transliteration, semantic quality, collisions, exceptions, clone discipline, and rename mechanics remain undecided; no filesystem operation is authorized.
- 2026-08-04 01:43 IST: refined after post-deliverable Advisor: Decision 2 is effective from its 2026-08-04 01:38 IST owner ratification and applies only when a repository is later individually approved for a destination basename. Existing basenames are grandfathered until that approval and gain no reconciliation obligation. The decision authorizes no rename, move, directory creation, validator, CI check, tooling change, or enforcement point. `ISC-760` remains pending because normalization policy does not determine grammar. For Decision 3, “repository directory basename” means the entire directory entry directly beneath its portfolio root, not a filename with an extension; the ballot asks only whether ASCII full stop U+002E may occur at a non-boundary position. Boundary positions, repetition, other code points, separators, derivation, collisions, exceptions, and enforcement remain undecided.
- 2026-08-04 01:56 IST: Decision 3 ratified by the owner: ASCII full stop U+002E is not representable at a non-boundary position in a canonical local destination repository directory basename. No transformation for a dotted source name is implied; such a candidate remains held until derivation and collision/exception rules are separately ratified. Boundary positions, other code points, case, separators, concrete slugs, enforcement, and every filesystem operation remain undecided and unauthorized.
- 2026-08-04 02:01 IST: refined after pre-commitment Advisor: Decision 4 binds only the exact `<repository>` directory segment directly beneath the ratified Thoughtseed or Tryambakam portfolio root; host, owner, namespace, and worktree segments are outside it. “Admissible” means only that the canonical grammar permits a character. The decision is definitional and prospective and creates no validator, generator, migration, reconciliation, or rename obligation. The ballot asks only whether any ASCII uppercase letter U+0041–U+005A is admissible. Lowercase letters, digits, Unicode, positions or counts under an uppercase-capable answer, separators, derivation, collisions, exceptions, and enforcement remain undecided. Two-agent delegation was intentionally skipped because this owner-only sequential decision and overlapping append-only ISA edit are each a directed sub-thirty-second task; parallel workers would duplicate analysis and introduce a write race.
- 2026-08-04 02:07 IST: refined after post-deliverable Advisor and two bounded conflict re-calls: Decision 4 constrains the eventual complete grammar rather than assuming an open- or closed-world interim character set. Both options bind only the depth-one `<repository>` segment in the prospective paths `/Volumes/madara/2026/Projects/thoughtseed/<repository>/` and `/Volumes/madara/2026/Projects/tryambakam-noesis/<repository>/`; fixed root literals, portfolio literals, and descendants are unaffected. Option A requires that segment to exclude every ASCII uppercase letter U+0041–U+005A at every position and makes no lowercase-admission ruling. Option B imposes no uppercase-class exclusion requirement and does not affirm admission, positions, or counts. Either answer closes `ISC-760.2` as a ruling while parent `ISC-760` remains pending; no answer leaves both unchanged. Literal spelling is independent of filesystem case-folding. Enforcement remains deferred until the parent grammar is complete and a repository is individually approved. The Advisor withdrew its contradictory claims after ISA readback proved `ISC-760.1` persisted and the ratified destination is intentionally outside the knowledge-vault ledger.
- 2026-08-04 02:13 IST: Decision 4 ratified by the owner: the eventual complete canonical grammar excludes every ASCII uppercase letter U+0041–U+005A at every position of the exact depth-one `<repository>` segment beneath either ratified portfolio root. This makes no ruling about lowercase-letter admission or any other character class. Fixed root and portfolio literals remain outside the rule. Parent `ISC-760` stays pending, and the decision creates no current conformance claim, validator, generator, migration, reconciliation, rename, or filesystem operation.
- 2026-08-04 02:15 IST: refined after pre-commitment Advisor: Decision 5 asks whether all 26 ASCII lowercase code points U+0061–U+007A must belong to the eventual complete `<repository>` character repertoire. “Repertoire” means code-point set membership only. One answer applies identically to both ratified portfolio roots. Option A includes the entire class. Option B imposes no full-class inclusion requirement, excludes no lowercase code point, and leaves full, partial, or zero membership for later. Position, count, ordering, boundary, separator, derivation, collision, and enforcement remain outside both options. `ISC-760.2` is already checked with owner evidence and destination entries remain zero. Two-agent delegation was intentionally skipped because the owner-only ballot and overlapping append-only ISA edit are each directed sub-thirty-second work; parallel dispatch would duplicate analysis and introduce a write race.
- 2026-08-04 02:18 IST: refined after post-deliverable Advisor: Decision 5 is an approval ballot, not a symmetric closed-policy ballot. Option A ratifies all 26 ASCII lowercase code points U+0061–U+007A as permitted members of the eventual `<repository>` character repertoire and closes `ISC-760.3`. Option B declines that approval, excludes no lowercase code point, and leaves `ISC-760.3` pending for later refinement. The scope is only the exact depth-one `<repository>` segment under `/Volumes/madara/2026/Projects/thoughtseed/` and `/Volumes/madara/2026/Projects/tryambakam-noesis/`; the fixed roots and portfolio literals are unaffected. Membership means permitted, not mandatory occurrence. Position, count, ordering, boundary, separator, digit, non-ASCII, derivation, collision, and enforcement rules remain undecided.
- 2026-08-04 02:21 IST: Decision 5 ratified by the owner: all 26 ASCII lowercase code points U+0061–U+007A are permitted members of the eventual complete character repertoire for the exact depth-one `<repository>` segment under both ratified portfolio roots. Membership is permission, not mandatory occurrence, and does not by itself make any concrete name valid. Position, count, ordering, boundary, separator, digit, non-ASCII, derivation, collision, and enforcement remain undecided; the prior uppercase exclusion remains unchanged. Parent `ISC-760` remains pending, and this decision authorizes no rename, move, directory creation, validation, or other filesystem operation.
- 2026-08-04 02:26 IST: refined after pre-commitment Advisor: Decision 6 is the `ISC-760.4` all-or-none class-level ruling for ASCII digit code points U+0030–U+0039 in the permitted character repertoire for the exact depth-one `<repository>` segment beneath either ratified portfolio root. The owner chooses exactly one unconditional option. Option A permits all ten digits; this is membership permission only and does not require their occurrence or decide numeric-only names, leading digits, position, count, run length, ordering, boundary behavior, total length, or separators. Option B excludes all ten digits from that exact segment only and rules nothing about non-ASCII digits or digit-like characters. Option C defers the class-level ruling, creates neither permission nor prohibition or default, and preserves full, partial, or zero digit membership for a later ballot. No answer is not Option C and leaves `ISC-760.4` pending. Derivation, collisions, reserved names, encoding, enforcement, migration, and every filesystem operation remain undecided and unauthorized. Parent `ISC-760` remains pending. Owner-only sequential adjudication and the overlapping append-only ISA edit are serial; parallel dispatch remains held to avoid duplicated reasoning and a write race.
- 2026-08-04 02:28 IST: refined after post-deliverable Advisor: Decision 5's membership ruling cannot independently validate a concrete name, and its exact owner wording is retained in Verification. Decision 6 is expressly the all-or-none class ballot mapped to `ISC-760.4`; a subset outcome remains reachable only by choosing defer and later ratifying a subset ballot. Its common scope binds all three options, non-ASCII digits remain outside it, and absence of an answer leaves the criterion pending rather than silently selecting defer.
- 2026-08-04 02:53 IST: Decision 6 ratified by the owner: every ASCII digit code point U+0030–U+0039 is a permitted repertoire member for the exact depth-one `<repository>` segment beneath either ratified portfolio root. Membership is permission, not required occurrence, and does not by itself validate any concrete name. Numeric-only names, positions, counts, separators, derivation, non-ASCII digits, collisions, encoding, enforcement, migration, and filesystem operations remain undecided and unauthorized. Parent `ISC-760` remains pending.
- 2026-08-04 02:56 IST: refined after pre-commitment Advisor: Decision 7 is `ISC-760.5` and asks only for the all-or-none repertoire treatment of ASCII hyphen-minus U+002D in the exact depth-one `<repository>` segment beneath either ratified portfolio root. The Advisor's proposed closed-allowlist convention is held because closure is a separate axis and would retroactively characterize unresolved characters. Option A permits U+002D as a repertoire member only; consistent with the owner's lowercase and digit rulings, it neither requires occurrence nor guarantees or decides any position and does not make hyphen-minus a separator token. Option B excludes U+002D at every position and occurrence count in the exact segment; this is a per-codepoint denial, not a closure-policy ruling or precedent for analogous characters. Option C makes no ruling, creates neither permission nor prohibition, and leaves `ISC-760.5` pending for owner refinement in a later turn. No answer is not Option C and also leaves the criterion pending. Required occurrence, separator semantics, leading/trailing/interior positions, repetition, adjacency, run length, total basename length, underscore, other dash code points, every other character, derivation, collisions, reserved names, encoding, enforcement, migration, concrete names, and filesystem operations remain undecided and unauthorized. Parent `ISC-760` remains pending. The serial owner-only ballot and overlapping append-only ISA edit do not satisfy the parallel-dispatch split gate; two workers would duplicate analysis and race on one ledger.
- 2026-08-04 02:58 IST: refined after post-deliverable Advisor: Decision 6 already binds only U+0030–U+0039, stores the owner's exact words, explicitly leaves numeric-only names and non-ASCII digits undecided, denies concrete-name validity, and authorizes no filesystem operation. Decision 7 removes the proposed non-vacuity coupling because the owner-established semantics permit repertoire membership without deciding position. Option B is explicitly per-codepoint rather than a closure-policy precedent; Option C is expressly unresolved rather than tacit permission or prohibition. No Decision 7 outcome changes the ratified digit ruling, validates a name, or creates a destination entry. This one-owner interview has no quorum, tie, or tally mechanism; the owner must select exactly one complete option for a ruling.
- 2026-08-04 03:14 IST: Decision 7 ratified by the owner: ASCII hyphen-minus U+002D is a permitted repertoire member for the exact depth-one `<repository>` segment beneath either ratified portfolio root. Membership does not require occurrence or decide position. Selection of the named Option A preserves its previously defined scope: it does not by itself establish separator semantics or validate any concrete name. Repetition, adjacency, run length, total length, underscore, other dash code points, derivation, collisions, closure policy, encoding, enforcement, migration, and filesystem operations remain undecided and unauthorized. Parent `ISC-760` remains pending.
- 2026-08-04 03:16 IST: refined after pre-commitment Advisor: Decision 8 is `ISC-760.6` and asks only whether ASCII low line U+005F belongs to the character repertoire for the exact depth-one `<repository>` segment beneath either ratified portfolio root. No other codepoint is ruled on; fullwidth low line U+FF3F and all non-ASCII characters remain unresolved. Common to every option: membership never requires occurrence, and position, repetition, adjacency, derivation, collisions, repertoire closure, enforcement, migration, and filesystem operations remain undecided and unauthorized; hyphen-minus U+002D remains permitted. Option A, `A-low-line-excluded`, excludes U+005F from membership. It establishes no separator semantics and validates no concrete name; it is revisitable only through a later explicit owner ruling. It is recommended because a minimal repertoire can be widened without renaming existing destinations, whereas narrowing after names exist can require migration. Option B, `B-low-line-included`, permits U+005F as a repertoire member only; it establishes no separator semantics and validates no concrete name. Option C, `C-low-line-unresolved`, makes no ruling: U+005F is neither admitted nor excluded, its status remains unresolved, and the option is neutral about eventual repertoire closure. No answer is not Option C and leaves `ISC-760.6` pending. Excluding U+005F removes only that one delimiter-like candidate while leaving admitted hyphen-minus semantically undefined; it neither declares hyphen a separator nor excludes unexamined characters by analogy. Parent `ISC-760` remains pending. The owner-only ballot and overlapping append-only ISA write remain serial; parallel workers would duplicate analysis and race on the same ledger.
- 2026-08-04 03:18 IST: refined after post-deliverable Advisor: the named `A-hyphen-minus-included` option governs the owner's shortened restatement, so its previously defined no-separator-semantics limitation is preserved as inherited scope rather than attributed to the restatement. The developer-supplied intent confirms that “does not ... decide its position” is the operative parse. Decision 8 uses self-describing option labels, removes the overbroad hyphen-or-none claim, makes Option A explicitly revisitable by owner ruling, binds no separator semantics under A or B, and bases the exclusion recommendation on widen-later reversibility rather than treating hyphen as a chosen separator.
- 2026-08-04 03:25 IST: Decision 8 ratified by the owner: ASCII low line U+005F is excluded from the exact depth-one `<repository>` repertoire beneath either ratified portfolio root. This establishes no separator semantics and may be revisited only through an explicit later owner ruling. Fullwidth low line U+FF3F and other non-ASCII characters remain unresolved; no concrete name is validated and no enforcement, migration, rename, move, directory creation, or other filesystem operation is authorized. Parent `ISC-760` remains pending.
- 2026-08-04 03:27 IST: refined after pre-commitment Advisor: Decision 9 is `ISC-760.7` and asks only for the default status of code points without an approved class ruling in the exact depth-one `<repository>` segment immediately beneath `/Volumes/madara/2026/Projects/thoughtseed/` or `/Volumes/madara/2026/Projects/tryambakam-noesis/`. “Code point” means a Unicode scalar value. Current rulings are U+0061–U+007A permitted, U+0030–U+0039 permitted, U+002D permitted, U+0041–U+005A excluded, U+005F excluded, and U+002E excluded only in internal position; leading and trailing U+002E remain unruled. Option A, `A-closed-repertoire`, admits only code points explicitly permitted by an approved class ruling; unruled code points are inadmissible for canonical candidates until separately admitted. Closure is a default, not a freeze, and admission still does not decide position, occurrence, adjacency, length, or concrete-name validity. Option B, `B-open-repertoire`, does not itself prohibit an unruled code point; every unruled Unicode scalar value, including controls, whitespace, slash, non-ASCII characters, and non-internal U+002E, is provisionally admissible subject to later grammar, position, and occurrence decisions. Option C, `C-defer-closure`, adopts neither default; unruled code points are neither admitted nor prohibited, and any downstream decision requiring closure is blocked until this criterion resolves. No option decides position, occurrence, adjacency, length, separator semantics, derivation, collision or uniqueness, enforcement/tooling/CI, migration or existing-name status, parent grammar structure, normalization or encoding, reserved names, or the merits of any specific unruled class; the six ratified repertoire facets are not reopened. A tie or no quorum resolves to C. A may later be replaced by B, or B by A, through an ordinary explicit owner decision; neither adoption retroactively invalidates the six ratified facets. The recommendation for A is recorded separately from the option text because it keeps canonical candidates portable and makes future admissions explicit. No filesystem operation is authorized.
- 2026-08-04 03:29 IST: refined after post-deliverable Advisor; this supersedes the immediately preceding Decision 9 draft. Scope is the exact depth-one segment immediately beneath `/Volumes/madara/2026/Projects/thoughtseed/` or `/Volumes/madara/2026/Projects/tryambakam-noesis/`; “code point” means a Unicode scalar value. Current permitted set is exactly U+0061–U+007A, U+0030–U+0039, and U+002D; current exclusions are U+0041–U+005A, U+005F, U+002E in internal position, plus structural invariants U+0000 and U+002F and the exact reserved segment values `.` and `..`, which apply under every option and are outside this closure vote. Option A, `A-closed-repertoire`, permits only that explicitly admitted set; every other unruled code point is inadmissible until separately admitted. This is a default, not a freeze: future admissions remain possible, and admission still decides neither position, occurrence, adjacency, length, separator semantics, nor concrete-name validity. Option B, `B-open-repertoire`, leaves every other unruled Unicode scalar value provisionally admissible subject to later grammar, position, and occurrence decisions; this includes non-internal U+002E, controls other than U+0000, whitespace, and non-ASCII characters, but not the structural invariants or existing explicit exclusions. Provisional admission grants no acquired right, and later narrowing is not a reversal or grandfathering event. Option C, `C-defer-closure`, adopts neither default; unruled code points are neither admitted nor prohibited, closure-dependent downstream decisions are blocked, and the ballot must be re-tabled as the next owner grammar decision. C is neither A nor B. No option decides position, occurrence, adjacency, length, separator semantics, derivation, collision or uniqueness, enforcement/tooling/CI, migration or existing-name status, parent grammar structure, normalization or encoding, reserved names beyond the stated invariants, or the merits of any specific unruled class; the six ratified repertoire facets remain closed to this ballot. Tie or no quorum resolves to C. A or B may later be superseded by the other only through an explicit owner ruling; no outcome validates a concrete name or authorizes filesystem work. A is recommended separately because explicit admission keeps canonical candidates portable and makes future widening reviewable.
- 2026-08-04 03:33 IST: Decision 9 ratified by the owner: `A-closed-repertoire` is selected for the exact depth-one `<repository>` segment beneath both approved portfolio roots. Only the explicitly permitted set U+0061–U+007A, U+0030–U+0039, and U+002D is currently admissible; every other unruled code point is inadmissible until separately admitted. Future admissions remain possible. This closure ruling does not decide position, occurrence, adjacency, length, separator semantics, derivation, collision or uniqueness, enforcement/tooling/CI, migration or existing-name status, normalization or encoding, reserved names beyond the stated structural invariants, or any concrete name. It implies that leading/trailing U+002E are not admissible under the closed default; internal U+002E and the six prior repertoire facets remain unchanged. No validation, rename, move, directory creation, or other filesystem operation is authorized. Parent `ISC-760` remains pending.
- 2026-08-04 04:14 IST: clarification: future repertoire admissions under Decision 9 require a later explicit owner decision recorded in `ISA.md`; no automatic widening, validator, migration, or grandfathering follows from the amendment hook. The current closure still decides neither positional grammar nor concrete-name validity.
- 2026-08-04 04:06 IST: refined after pre-commitment Advisor: Decision 10 asks only whether U+002D may occupy index 0 of the literal on-disk depth-one `<repository>` directory-entry sequence beneath either approved portfolio root, and only for segments of length at least two code points. Option F forbids a length-at-least-two segment whose first code point is U+002D. Option P permits that occurrence without making any concrete name valid. Neither option decides trailing or interior position, repetition, adjacency, separator semantics, required occurrence, empty or length-one segments, total length, derivation, collisions, enforcement, migration, or future admissions. The recommendation is F because it is reversible without migration and avoids option-parsing hazards; it does not require a leading letter and therefore leaves digit-initial names unresolved. No filesystem operation is authorized.
- 2026-08-04 04:08 IST: Decision 10 is tabled for owner ratification as the leading-hyphen ballot. The exact owner scope is the literal on-disk depth-one `<repository>` directory-entry sequence under `/Volumes/madara/2026/Projects/thoughtseed/` or `/Volumes/madara/2026/Projects/tryambakam-noesis/`; index 0 means its first Unicode scalar value after the filesystem's literal decoding. The ballot applies only to segments of length at least two; normalization and encoding policy remain undecided. Option F (`F-leading-hyphen-forbidden`) makes any length-at-least-two segment beginning with U+002D inadmissible. Option P (`P-leading-hyphen-permitted`) says that occurrence alone is not a ground of inadmissibility, subject to all unresolved axes. Failure to reach quorum leaves `ISC-760.8` pending. The ballot is predicated only on the already-admitted U+002D and does not extend to future code points. No validation, rename, move, directory creation, or other filesystem operation is authorized.
- 2026-08-04 04:36 IST: Decision 10 ratified by the owner: exact answer `forbidden` selects the sole forbid option, `F-leading-hyphen-forbidden`, from the preceding binary ballot. For the literal on-disk depth-one `<repository>` directory-entry sequence beneath `/Volumes/madara/2026/Projects/thoughtseed/` or `/Volumes/madara/2026/Projects/tryambakam-noesis/`, any segment of length at least two whose first Unicode scalar value is U+002D is inadmissible. This does not cover the one-character name `-`, trailing or interior U+002D, repeated hyphens as an independent axis, separator semantics, digit-initial names, or non-U+002D hyphen-like code points. A name such as `--foo` is non-conforming only because its first code point is U+002D; no repeated-hyphen rule is created. Directory-entry type, retroactivity, normalization, encoding, enforcement, migration, and every filesystem operation remain unresolved or unauthorized. No concrete name is validated.
- 2026-08-04 04:44 IST: Decision 10 scope clarification: the one-character `<repository>` segment `-` is an explicit unresolved positional/length case, not an implicit permission or prohibition. Any positional axis not expressly ratified remains unresolved; absence of a ruling never means allowed. The closed repertoire still governs its codepoint membership, while its concrete-name admissibility is undecided.
- 2026-08-04 04:36 IST: Decision 11 is tabled for owner ratification as the trailing-hyphen ballot. The exact scope is the literal on-disk depth-one `<repository>` directory-entry sequence beneath `/Volumes/madara/2026/Projects/thoughtseed/` or `/Volumes/madara/2026/Projects/tryambakam-noesis/`, limited to segments of length at least two and literal U+002D. Option `T-trailing-hyphen-forbidden` makes a segment ending with U+002D inadmissible; option `T-trailing-hyphen-permitted` says that ending alone is not a ground of inadmissibility. The one-character name `-`, leading and interior positions, repeated hyphens as such, separator semantics, non-U+002D hyphen code points, entry types, retroactivity, enforcement, migration, and all filesystem operations remain unresolved or unauthorized. Failure to reach quorum leaves `ISC-760.9` pending.
- 2026-08-04 04:44 IST: Decision 11 remains explicitly `STAGED`, not ratified. Its trailing-position scope is independently stated and does not inherit a decision from the leading-position rule; no resolver may treat the staged options as settled.
- 2026-08-04 05:10 IST: Decision 11 ratified by the owner: verbatim reply `forbidden as well`; `resolved_option: T-trailing-hyphen-forbidden`. The staged binary ballot contained exactly `T-trailing-hyphen-forbidden` and `T-trailing-hyphen-permitted`; “as well” is interpreted as parity with the already ratified leading rule and carries no scope extension. The ballot's explicit length-at-least-two fence is retained: a literal on-disk depth-one `<repository>` segment beneath `/Volumes/madara/2026/Projects/thoughtseed/` or `/Volumes/madara/2026/Projects/tryambakam-noesis/` whose final Unicode scalar is U+002D is inadmissible only when its length is at least two. The one-character `-` remains explicitly unresolved because Decisions 10 and 11 both exclude length one. Leading and interior U+002D, repeated-hyphen semantics, separator semantics, non-U+002D hyphen code points, entry-type, retroactivity, normalization, encoding, enforcement, migration, and filesystem operations remain unresolved or unauthorized. No concrete name is validated.
- 2026-08-04 05:10 IST: Decision 12 is staged as the singleton-hyphen ballot. Scope is the exact one-code-point `<repository>` segment `-` (U+002D) as a literal on-disk depth-one name beneath `/Volumes/madara/2026/Projects/thoughtseed/` or `/Volumes/madara/2026/Projects/tryambakam-noesis/`. Option `S-singleton-hyphen-forbidden` makes that exact segment inadmissible; option `S-singleton-hyphen-permitted` permits it for this axis only. Entry-type, trailing/leading terminology beyond this exact one-code-point name, interior/repetition/separator semantics, non-U+002D hyphen code points, retroactivity, enforcement, migration, and filesystem operations remain unresolved or unauthorized. A non-answer leaves `ISC-760.10` pending and applies no default.
- 2026-08-04 05:45 IST: Decision 12 ratified by the owner: verbatim reply `S-singleton-hyphen-permitted`; `resolved_option: S-singleton-hyphen-permitted`. The self-contained naming predicate is `depth(name, root) == 1 AND raw_codepoints(name) == [U+002D HYPHEN-MINUS]`, so the entire lexical immediate-child name is exactly one raw Unicode scalar `-`, never a prefix, suffix, substring, or component of a longer name. Scope is limited to the literal roots `/Volumes/madara/2026/Projects/thoughtseed/` and `/Volumes/madara/2026/Projects/tryambakam-noesis/`; both destination roots are currently absent by design, no other root or remounted spelling inherits this rule, and root or entry symlinks are never resolved. This is naming-policy permission only, not read/create/write/traverse/unlink authorization; the policy is resolved, but implementation is explicitly deferred and ratified-but-not-implementable until entry-type semantics are separately decided. Comparison is raw, pre-normalization, case-sensitive, and confusable-unmapped; U+2010, U+2011, U+2012, U+2013, U+2014, U+2015, U+2212, U+FE63, and U+FF0D are denied by the closed repertoire. Multi-codepoint names are not admitted by this decision and remain deferred pending `ISC-760.11`; `ISC-760.11` and `ISC-760.12` do not alter this self-contained singleton predicate. Depth greater than one, `.`/`..` path spellings, entry type, normalization, retroactivity, enforcement, migration, and filesystem operations remain unvalidated or unauthorized. A future conformance fixture must assert lexical `<root>/-` passes and `<root>/--`, `<root>/-a`, `<root>/a-`, `<root>/a-b`, `<root>/x/-`, `<root>/./-`, `<root>/x/../-`, symlink `-`, any non-listed root, and each named confusable single-character name do not inherit this permission; no fixture or checker is shipped by this ratification.
- 2026-08-04 06:00 IST: Decision 13 is superseded as an interior ballot because interior positions presuppose multi-codepoint admission. The corrected next ballot is `ISC-760.11`: whether any multi-codepoint lexical immediate-child `<repository>` name containing U+002D HYPHEN-MINUS is admissible under the same two literal roots. Option `M-multicodepoint-hyphen-forbidden` denies all such names; option `M-multicodepoint-hyphen-permitted` admits the class for this axis only. The term means a multi-codepoint name containing the single code point U+002D, not a multi-codepoint hyphen grapheme; all other hyphen-like code points remain denied by closure. Singleton `-` remains governed by Decision 12; leading and trailing prohibitions remain binding unless a later precedence decision explicitly changes them. No validator, writer, reader, or filesystem behavior changes from this admission alone. A non-answer leaves `ISC-760.11` pending and applies no default.
- 2026-08-04 06:40 IST: Decision 13 ratified by the owner: verbatim reply `yes - M-multicodepoint-hyphen-permitted`; `resolved_option: M-multicodepoint-hyphen-permitted`. This is a prescriptive naming-policy admission only for multi-codepoint lexical immediate-child names containing exactly U+002D HYPHEN-MINUS. It does not repeal or supersede the ratified leading and trailing prohibitions; their composition rule is separately staged as `ISC-760.12`. Interior position, flanking, adjacency, count, non-U+002D hyphens, normalization, entry type, depth, retroactivity, enforcement, migration, and filesystem operations remain unresolved or unauthorized. The planning tranche has no validator implementation or behavior certification; no validator or writer is authorized to change behavior from this decision. Concrete forms such as `a--b` remain unvalidated pending an explicit adjacency/flanking ballot.
- 2026-08-04 06:40 IST: Decision 15 is staged for `ISC-760.12` precedence. Option `P-precedence-intersection` composes multi-codepoint permission with prior prohibitions by intersection; option `P-precedence-supersession` lets the later admission repeal conflicting positional bans. A non-answer leaves precedence unresolved and applies no default. Decision 16 is reserved for an interior-U+002D flanking ballot after this precedence decision resolves; it will not be a bare interior permit/forbid ballot.
- 2026-08-04 07:25 IST: Decision 15 ratified by the owner: verbatim reply `P-precedence-intersection`; `resolved_option: P-precedence-intersection`. The general composition law is monotone narrowing: every permission is intersected with all prior prohibitions, prohibitions dominate, and no later permission silently repeals an earlier prohibition. This policy choice does not yet define normalization order, projection quantifiers, validator behavior, filesystem access, or concrete-name validity; those remain separate pending axes. The next ballot is normalization stage.
- 2026-08-04 07:50 IST: Decision 16 is superseded as a projection ballot because projection basis depends on normalization/validation stage. The corrected next ballot is `ISC-760.13`: option `N-normalize-before-validation` applies normalization before positional projection and validation; option `N-validate-before-normalization` validates the raw name before any normalization. This ballot does not decide downstream projection basis, collision handling, normalization algorithm, post-normalization validity, interior flanking, adjacency, count, entry type, enforcement, migration, or filesystem operations. A non-answer leaves `ISC-760.13` pending and applies no default. Decisions 17–19 are reserved for projection basis, collision, normalization algorithm, and post-normalization invariant.
- 2026-08-04 08:30 IST: Decision 16 ratified by the owner: verbatim reply `N-validate-before-normalization`; `resolved_option: N-validate-before-normalization`. Raw-name validation and positional rules precede any future normalization. This is a policy-ordering decision, not a claim that a validator currently behaves this way; its rejection-set delta is explicitly deferred for Unicode-form, case, edge-character, separator-alias, and empty-after-normalization inputs. The post-normalization validity invariant, projection basis, collision policy, normalization algorithm, enforcement, migration, and filesystem operations remain unresolved or unauthorized. No validator or derived artifact is changed.
- 2026-08-04 08:30 IST: Decision 17 is superseded as a projection ballot because projection basis depends on normalization-validity closure. The corrected next ballot is `ISC-760.14`: option `V-normalization-validity-preserving` asserts every accepted raw name remains valid after the future normalization transform; option `V-normalization-validity-not-preserving` asserts at least one accepted raw name may become invalid; option `V-normalization-validity-unknown` makes no claim. A non-answer leaves `ISC-760.14` pending and applies no default. Identity-key projection, presentation projection, collision policy, normalization algorithm, post-normalization enforcement, interior flanking, adjacency, count, entry type, migration, and filesystem operations remain unresolved.
- 2026-08-04 09:20 IST: Decision 17 ratified by the owner: verbatim reply `V-normalization-validity-preserving`; `resolved_option: V-normalization-validity-preserving`. Every raw name accepted by the pre-normalization policy is required to remain valid after the future normalization transform. This is a prescriptive validity invariant only; it neither proves current validator behavior nor selects the normalization algorithm, identity-key projection, presentation projection, collision policy, post-normalization enforcement, migration, or filesystem operations. The next ballot is identity-key projection, kept separate from presentation projection.
- 2026-08-04 09:20 IST: Decision 18 is staged for `ISC-760.15` identity-key projection. Option `P-identity-key-from-raw-name` derives the durable identity key from the accepted raw name; option `P-identity-key-from-normalized-name` derives it from the future normalized name. This ballot does not decide presentation projection, collision handling, normalization algorithm, post-normalization enforcement, migration, or filesystem operations. A non-answer leaves `ISC-760.15` pending and applies no default.
- 2026-08-04 09:35 IST: Decision 18 ratified by the owner: verbatim reply `normalized-name identity`; `resolved_option: P-identity-key-from-normalized-name`. The durable identity key is derived from the future normalized repository name. This is a projection-policy decision only; it does not select the presentation projection, collision policy, normalization algorithm, validator behavior, post-normalization enforcement, migration, or filesystem operations. The next ballot is presentation projection.
- 2026-08-04 09:35 IST: Decision 19 is staged for `ISC-760.16` presentation projection. Option `P-presentation-from-raw-name` displays the accepted raw repository name; option `P-presentation-from-normalized-name` displays the future normalized repository name. This ballot does not decide identity-key projection, collision handling, normalization algorithm, post-normalization enforcement, migration, or filesystem operations. A non-answer leaves `ISC-760.16` pending and applies no default.
- 2026-08-04 09:55 IST: Decision 19 ratified by the owner: verbatim reply `P-presentation-from-normalized-name`; `resolved_option: P-presentation-from-normalized-name`. Operator-facing repository presentation derives from the future normalized name. This is a presentation-policy decision only; it does not select collision handling, the normalization algorithm, post-normalization enforcement, migration, or filesystem operations. Three formal follow-ups are batched below; an older interior-flanking note remains a bookkeeping gap rather than a silently resolved rule.
- 2026-08-04 09:55 IST: Decision 20 is staged for `ISC-760.17` collision handling. Option `C-collision-fail-closed` rejects any candidate whose normalized identity collides with an existing identity; option `C-collision-deterministic-disambiguation` derives a deterministic distinct identity without overwriting either candidate. This ballot does not choose suffix syntax, normalization algorithm, presentation, enforcement, migration, or filesystem operations. A non-answer leaves `ISC-760.17` pending and applies no default.
- 2026-08-04 09:55 IST: Decision 21 is staged for the normalization algorithm portion of `ISC-760.18`. Option `N-normalization-identity-after-validation` leaves the already-validated ASCII basename unchanged; option `N-normalization-NFC` applies Unicode NFC; option `N-normalization-NFKC` applies Unicode NFKC. This ballot does not decide collision policy, presentation, post-normalization enforcement, migration, or filesystem operations. A non-answer leaves the algorithm portion unresolved and applies no default.
- 2026-08-04 09:55 IST: Decision 22 is staged for the post-normalization invariant portion of `ISC-760.18`. Option `I-post-normalization-revalidate` requires the normalized output to pass the complete grammar before identity or presentation use; option `I-post-normalization-trust-preserving-policy` relies on the ratified validity-preserving invariant without a second validation gate. This ballot does not choose the normalization algorithm, collision handling, presentation, migration, or filesystem operations. A non-answer leaves the invariant portion unresolved and applies no default.
- 2026-08-04 10:10 IST: Decision 20 ratified by the owner: verbatim reply `C-collision-fail-closed`; `resolved_option: C-collision-fail-closed`. Any candidate whose normalized identity collides with an existing identity is rejected before mutation or disambiguating rewrite. This is a policy decision only; it does not define storage implementation, suffix syntax, migration, or filesystem operations.
- 2026-08-04 10:10 IST: Decision 21 ratified by the owner: verbatim reply `N-normalization-identity-after-validation`; `resolved_option: N-normalization-identity-after-validation`. After raw validation, the normalized basename is the unchanged accepted ASCII basename. No Unicode transform, transliteration, case fold, or filesystem operation is authorized by this choice.
- 2026-08-04 10:10 IST: Decision 22 ratified by the owner: verbatim reply `I-post-normalization-trust-preserving-policy`; `resolved_option: I-post-normalization-trust-preserving-policy`. The ratified validity-preserving policy is trusted without a second post-normalization validation gate. This remains a policy assertion, not implementation evidence or authorization to skip any future safety checks required by a concrete writer.
- 2026-08-04 10:10 IST: Decision 23 is staged for `ISC-760.19` interior U+002D flanking and adjacency. Option `F-interior-hyphen-single` permits U+002D only when both immediate neighbors are admitted non-U+002D code points, rejecting repeated runs such as `a--b`; option `F-interior-hyphen-run-permitted` permits interior U+002D adjacency while retaining the ratified leading/trailing prohibitions. This ballot does not alter singleton permission, repertoire closure, normalization, identity, presentation, collision policy, enforcement, migration, or filesystem operations. A non-answer leaves `ISC-760.19` pending and applies no default.
- 2026-08-04 10:25 IST: Decision 23 ratified by the owner: verbatim reply `F-interior-hyphen-run-permitted`; `resolved_option: F-interior-hyphen-run-permitted`. Interior U+002D may be adjacent to other U+002D code points, while the ratified leading-hyphen prohibition, trailing-hyphen prohibition, and intersection precedence remain binding. This closes ISC-760.19 and the normalized destination repository-directory grammar parent ISC-760. No validator, writer, rename, move, migration, or filesystem behavior is authorized.
- 2026-08-04 10:40 IST: Execution planning begins after grammar closure. The new `docs/plans/2026-08-04-repository-grammar-execution.md` addendum binds the ratified ASCII identity grammar to pure tests, read-only two-portfolio inventory, packet/registry preflight, deterministic dry-run, explicit canary approval, one-rename transaction, fresh-client pickup, verification, and rollback. Planning creates no destination directory and authorizes no repository, vault, registry, session, Paseo, provider, Git, or filesystem mutation.
- 2026-08-04 11:05 IST: Execution tranche 1 completed: `bun test package/relocation/project-relocation-grammar.test.ts` passed 6 tests and 28 assertions. The read-only inventory command enumerated 101 immediate children across the two approved roots into mode-`0600` report `/tmp/temperance-relocation.ysoTut/inventory.json` (SHA-256 `d5e1c3a99016b65c77ef226945383e902c2ba3dc005a278bc820bcd645a58f93`): 29 candidates, 72 held, 40 standalone repositories, 38 nested repositories, and 23 non-repositories. The first probe exposed and the corrected policy now holds `thoughtseed-labs`, `10869`, Snow Gloves surfaces, the active Temperance control repository, Hermes, and all Tryambakam entries pending the dirty TN registry baseline. The destination root remained empty; no registry, packet, session, Paseo, provider, Git, or filesystem mutation occurred.
- 2026-08-04 11:25 IST: Decision 26 is staged for canary selection. Recommended `C-canary-thoughtseed-brand-atlas` points to `/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-brand-atlas` → `/Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas`: clean porcelain, standalone repository, one worktree, HEAD `7e9159735e76b9614e74842c459623f341972baa`, tracked-inventory SHA-256 `56e6c172d00cb18880c3bc896395cda9b8b68e5583e42cb9103f550e6bc185cf`, no checked-in old-path references, and no destination collision. Caveats are 513M total size, 19,076 ignored entries, and Vercel/generated surfaces. `plexus-ts-github-settings-ota-review` is held because it shares a nine-worktree graph; every other clean-baseline absence or dirty candidate requires an owner checkpoint. No canary is approved or mutated by this staging.
- 2026-08-04 11:45 IST: Decision 26 ratified by the owner: verbatim reply `approve canary thoughtseed-brand-atlas`; `resolved_option: C-canary-thoughtseed-brand-atlas`. Canary-selection approval authorizes only preflight and dry-run manifest generation for the exact source/destination pair. It does not approve packet authoring, registry writes, capsule creation, rename, client pickup, commit, push, session/Paseo work, or any filesystem mutation.
- 2026-08-04 18:20 IST: The six-file packet draft is present with packet digest `be0d69efec00bc2bd769b4f54e2160e45fea93c80897952a8ff22f79fa6a72c8`. The fresh owner-only dry-run `/tmp/temperance-canary-packet.GWGuFG/thoughtseed-brand-atlas.plan.json` is mode `0600`, SHA-256 `fe78fc1cb2556ae66e86b26705406c628e8a81be1142ae8b7db04b207ab397f8`, `ready:false`, and holds on `packet_identity_pending_teamforge` plus `working_tree_not_clean`; exact checked-in path consumers remain empty and the destination remains absent.
- 2026-08-04 19:10 IST: Owner supplied the exact TeamForge slug `thoughtseed-brand-atlas`. The packet now records `project_id: thoughtseed-brand-atlas`, `identity_status: verified-teamforge`, and `packet_status: reviewed-held`; no substitute or derived ID was used.
- 2026-08-04 19:15 IST: The six-file packet was committed separately in the canary repository as commits `66d0b8a9` and `30e994a0`; no vault, registry, destination, session, Paseo, provider, or deployment state changed.
- 2026-08-04 19:20 IST: Owner approved the exact canary manifest with verbatim reply `approve`. This approval binds only manifest SHA-256 `6159095b53ea6df7b8ed35aeb705ae8142a5cf5cbd90ce39d37eb2b4e5ae8213`, source `/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-brand-atlas`, destination `/Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas`, packet digest `4d177cbd15dd3710c5ae2df8cb3789a221f7d4c1c879d3fcf743ed2d2bcaef43`, and clean Git HEAD `30e994a00a347e9817a03940c9cf068e7ea4a6a9`. It does not yet authorize the separate live-apply transaction, registry/capsule writes, rename, client pickup, or rollback receipt.
- 2026-08-04 19:30 IST: Owner authorized live apply with verbatim reply `apply authorized`. Apply remains held before mutation because the ratified Thoughtseed registry path `thoughtseed-labs/20-operations/project-management/relocation-registry/thoughtseed/<repository>/` is absent, the `thoughtseed-labs` Git worktree has extensive unrelated dirty/untracked state without an approved exact baseline, and the receipt-bound registry/capsule transaction writer is not implemented. No rename, destination creation, registry write, capsule write, session/Paseo change, provider change, or Git mutation occurred.
- 2026-08-04 18:32 IST: Owner review of the six-file draft was acknowledged. A bounded read-only search of Thoughtseed Labs project-management, metadata, and brand-authority sources found no exact `thoughtseed-brand-atlas` TeamForge mapping or authoritative stable project ID. The packet remains `draft-held`; no ID was inferred from the repository name, GitHub remote, Vercel project, or vault context pointer. The next gate is an owner-supplied or authoritative TeamForge readback, followed by packet replacement and a fresh digest-bound dry-run.
- 2026-08-04 11:45 IST: The read-only dry-run manifest `/tmp/temperance-canary-plan.HF48kw/thoughtseed-brand-atlas.plan.json` (mode `0600`, SHA-256 `a93d5dfd484ff3a5ecf5d553177731d019f43c93208cb90f2e7f7f73ad19ceeb`) is held: source and Git are clean, the normalized identity has no destination collision, and no exact checked-in old-path references were found, but all six required packet files are missing (`PROJECT.md`, `AGENTS.md`, `CLAUDE.md`, `.project/CONTEXT.md`, `.project/project.yaml`, `.project/HANDOFF.md`). Manifest approval and packet preparation remain separate gates.
- 2026-08-04 18:16 IST: Decision 27 authorized the next six-file packet for the already approved canary. The packet is a separate, uncommitted repository draft only: `PROJECT.md`, `AGENTS.md`, `CLAUDE.md`, `.project/CONTEXT.md`, `.project/project.yaml`, and `.project/HANDOFF.md`. Thoughtseed TeamForge identity is intentionally represented as `project_id: null`, `identity_status: pending-teamforge-verification`, and `packet_status: draft-held`; no substitute ID was minted. This authorization does not approve relocation, registry/capsule writes, rename, client pickup, commit, push, session/Paseo work, or provider/deployment mutation.
- 2026-08-04 18:20 IST: The six-file packet draft is present with packet digest `be0d69efec00bc2bd769b4f54e2160e45fea93c80897952a8ff22f79fa6a72c8`. The fresh owner-only dry-run `/tmp/temperance-canary-packet.GWGuFG/thoughtseed-brand-atlas.plan.json` is mode `0600`, SHA-256 `fe78fc1cb2556ae66e86b26705406c628e8a81be1142ae8b7db04b207ab397f8`, `ready:false`, and holds on `packet_identity_pending_teamforge` plus `working_tree_not_clean`; exact checked-in path consumers remain empty and the destination remains absent.

## Changelog

- 2026-08-02: Added a separate offline native CLI readiness inspector for six reviewed OmniRoute 3.8.48 files. Exact digest, version, source-type, and marker equality now gate the non-authorizing instant receipt; package/module-graph integrity, transport, replay, authentication, semantic qualification, mutation, and promotion remain explicitly false. Fifteen focused tests, native integration, the canonical verifier, post-build Advisor hardening, and independent Cato PASS completed with protected projections unchanged. The failed Forge attempt made no edits, so ISC-612 remains open rather than being rewritten after the fact.

- 2026-08-02 | conjectured: default user-configuration isolation plus happy-path owner-only artifact permissions were sufficient for bounded external workers.
  refuted by: pre-build Advisor showed that a process-wide owner-only umask would leak into worker-created repository and cache files, while independent Cato reproduced unchecked output-directory permission failures and a signal race where a surviving worker created a late mode-644 diff after cleanup.
  learned: privacy belongs to dispatcher-owned paths, and cancellation must freeze, terminate, and reap every worker tree before worktree cleanup and the final permission pass. `--ignore-user-config` isolates Codex base configuration; it is not claimed to prevent every installed plugin path from being inspected.
  criterion now: ISC-586..ISC-595 accept explicit default isolation, exact-zero opt-out, repository rules, private fail-closed artifacts, signal-safe worker reaping, self-contained Sol-free Spark/non-Codex dispatch, one accepted exact Spark receipt, rejected timeout evidence, protected native invariants, the serial canonical verifier, Advisor reconciliation, and independent Cato PASS.

- 2026-08-02 | conjectured: a canonical owner-only scoped access-token file plus separate pre/post native snapshots would safely enable live Context Settings semantic previews.
  refuted by: independent Cato reproduced a malformed-field throw and unbounded response-body read, then showed that plaintext loopback observations do not bind the credential-bearing connection to the observed process, allowing a same-user listener replacement to capture a reusable Bearer token.
  learned: the production qualifier must remain credential-free and denial-only; exact Lite, Headroom, and minimal-RTK requests and semantic markers stay pure offline contracts until process-bound authenticated transport or a native one-use capability proves server identity, scope, expiry, and revocation.
  criterion now: ISC-572..ISC-585 accept the v2 denial receipt, 13-test/91-assertion adversarial suite, full verifier, governed non-Codex council, timed-out Advisor non-approval, independent Cato PASS after repair, and 564/592 reread while authenticated semantic qualification remains a separate gate.

- 2026-08-02 | conjectured: keeping a dashboard authentication exchange only in process memory and identity-binding a temporary Hermes directory would make recurring native preview safe.
  refuted by: independent Cato found that plaintext loopback could deliver the administrator password to a rogue same-user listener, `jq --arg` exposed it through argv, path checks could not close the cleanup deletion race, and the historical cookie evidence was not yet reconciled.
  learned: native preview is useful once as research, but the recurring artifact compiler must have no authentication or network transport. Reuse the already hardened local snapshot, expose only five fixed combo-presence booleans, create no Hermes path, retain no snapshot, and bind rollback to the exact secretless proposal and zero-cookie evidence.
  criterion now: ISC-564..ISC-571 accept the v3 zero-auth compiler, 31-check Hermes suite, 9-test/54-assertion snapshot suite, five-control rollback suite, live proposal and rollback receipts, full canonical verifier, exact non-Codex reviews, independent Cato PASS, and 550/578 reread while protected-host parser and external promotion gates remain open.

- 2026-08-02 | conjectured: Replacing the duplicate Bash renderer with the existing TypeScript renderer was the cleanest way to align direct Command Code with the shared pointer catalog.
  refuted by: pre-build native reviews showed that a full swap would silently change established ISA/memory discovery, while post-build Cato exposed that whole-document validation alone could accept a multi-line helper preamble.
  learned: the safe seam preserves existing renderer semantics, delegates only metadata-only pointer projection, validates helper stdout at ingestion and the complete document before stdout, and aborts dispatch before launch while isolating every workspace.
  criterion now: ISC-557..ISC-563 accept direct Command Code pointer alignment, exact-one/no-body enforcement, fail-closed/no-launch behavior, private concurrent workspaces, boundary documentation, and full independent verification while native sources and all external promotions remain gated.

- 2026-08-02 | conjectured: OmniRoute's native Context Sources or direct CLI renderers should become the immediate integration point for PAI, GSD, and skill-cluster context.
  refuted by: installed source and architecture review showed credential persistence, full-note/write-capable tools, duplicated policy ownership, and a separate Command Code renderer that never executes the shared Context Source stage.
  learned: the safe first increment is a client-owned pointer catalog with exact fixed candidates, independent source isolation, runtime surface gating, no body dereference, and a backup-first enrichment-only deployment seam; any later dereferencer must reopen, canonicalize, contain, authorize, and bound each target.
  criterion now: ISC-548..ISC-556 accept the verified shared-client bridge while native source promotion, direct Command Code alignment, Hermes apply, Cloudflare authority, MCP/A2A, and genuine S remain separate gates.

- 2026-08-02 | conjectured: a loopback management read with an administrator credential was the simplest trustworthy way to expose OmniRoute native state to Temperance.
  refuted by: architecture review showed a rogue same-user loopback listener could receive the credential, while later Advisor and Cato reviews exposed schema, runtime-package, database-inode, Cloudflare-process, Sol-fallback, diversity, and request-dependent compression ambiguities in weaker local projections.
  learned: a non-authorizing native snapshot must use explicit local SQLite projections, fixed secret-safe errors, coherent schema/WAL/runtime/database/process evidence, five separate claim layers, and fail-closed routing/compression semantics without management transport.
  criterion now: ISC-537..ISC-547 accept the verified local snapshot, 9-test/53-assertion adversarial suite, live OmniRoute 3.8.48 readback, full canonical verifier, architecture PASS, and independent Cato PASS while every external promotion gate remains open.

- 2026-08-02 | conjectured: deterministic resource names, shaped approval receipts, and mock denial responses were sufficient to prove a safe named-tunnel promotion transaction.
  refuted by: post-deliverable Advisor and independent Cato review exposed duplicate-key ambiguity, vacuous Access denial, wildcard and apex DNS shadowing, forged approval receipts, response-before-journal orphaning, same-name foreign-resource adoption, and stuck-open rollback risk.
  learned: promotion safety requires pinned asymmetric approval verification, journal-derived ownership tags, transport-and-identity-bound canaries, containment-preserving rollback, and an explicit distinction between mock state-machine proof and production authority evidence.
  criterion now: fifteen local contract criteria close at ISC-506..ISC-528 while ISC-512, ISC-514..ISC-515, ISC-519..ISC-520, ISC-523, ISC-525, and ISC-527 remain open for a reviewed production adapter, exact external authority, real staging canaries, secret/journal sinks, and durable approval consumption.

- 2026-08-02 | conjectured: a bounded probe could establish genuine S-tier readiness from current non-Sol Opus aliases without dashboard administration.
  refuted by: Advisor review identified circular gateway self-attestation, the first live mismatch control returned an unexpected structure, and the fail-fast rerun correctly issued only three controls with zero candidate requests.
  learned: this surface may falsify preregistered identity claims but cannot authenticate identity, authorize promotion, or convert structurally invalid controls into provider evidence; an expired AWS session before later SSM staging is operational telemetry only.
  criterion now: ISC-495..ISC-505 accept the closed falsification instrument, private non-authorizing receipt, exact protected-host invariants, 31-test adversarial suite, full repository verifier, and independent Cato pass while genuine-S authentication and OmniRoute admin promotion remain open.

- 2026-08-02 | conjectured: Keeping the global OmniRoute compression master off was sufficient to preserve governed PAI, GSD, ISA, and tool traffic.
  refuted by: native documentation and installed source showed per-request, routing-combo, profile, and default resolution seams, while the relay forwarded client headers and direct OpenCode bypassed the relay.
  learned: semantic preservation needs an explicit literal-off boundary at every governed client ingress plus fail-closed lifecycle state; dashboard state alone is not the client contract.
  criterion now: ISC-491..ISC-494 require manifest-scoped canonical off headers, exact rollback, final relay normalization with byte-stable bodies, and explicit Mac readiness.

- 2026-08-02 | conjectured: atomic rename plus a generation counter would be sufficient to turn the read-only signed-probe snapshot into a safe local mutation controller.
  refuted by: architecture review, Advisor recalls, two governed non-Codex OmniRoute audits, and Cato exposed replay-reopening rollback, stale-lock split brain, path TOCTOU, incomplete power durability, inherited locks, unchecked failure evidence, and raw traversal normalization risks.
  learned: safe replay control requires irreversible consumption, OS advisory locking, descriptor-relative exact-owner paths, supported-filesystem admission, full durable ordering, generation-bound recovery, bounded tombstones, structural non-authorization, and canonical raw-path rejection.
  criterion now: ISC-490..ISC-490.7 accept the standalone controller while every live promotion consumer remains explicitly disconnected; rollback-resistant authorization wiring remains a separate future gate.

- 2026-08-01 | conjectured: the existing routing-promotion HMAC and mode-600 readiness JSON were sufficient building blocks for authenticated Cloudflare and A2A evidence.
  refuted by: the commitment-boundary Advisor and two distinct non-Codex OmniRoute audits showed that a shared symmetric key proves only local secret possession, unsigned mode-600 JSON proves no issuer, and either could be misread later as external authority or handler safety.
  learned: signer integrity needs a separate Ed25519 trust domain, exact subject/challenge/freshness binding, canonical bounded inputs, machine-readable non-claims, and surface-specific consumers whose readiness remains hard-false. Snapshot replay state is observational only; atomic consumption belongs to a future authorized controller.
  criterion now: ISC-480..ISC-489 accept the non-authorizing signed-probe capability and executable negative controls; ISC-490 remains open for atomic enforcement before any authorization use.

- 2026-08-01 | conjectured: a logged-in Wrangler session and OmniRoute's native A2A documentation were sufficient to begin remote and agent integration planning.
  refuted by: current OAuth exposes connector control but not DNS or Access authority, while installed A2A source mixes an ambient manage principal with unguarded companion routes, ownerless tasks, unrestricted skills, and a CLI/server method mismatch.
  learned: native integration needs executable read-only preflights that distinguish permission claims from resource authority, source indicators from dataflow proof, receipt claims from authenticated live evidence, and technical evidence from operator authorization.
  criterion now: ISC-470..ISC-479 require sanitized Cloudflare claim gates without resource-authority overclaim, SHA-bound A2A indicators without dataflow overclaim, bounded receipt claims without authenticity overclaim, permanent non-self-authorization, and canonical regression coverage.

- 2026-08-01 | conjectured: initial HTTP response headers and one `launchctl bootstrap` were sufficient for concrete streaming receipts and safe proxy promotion.
  refuted by: automatic stream receipts remained unattributed while final SSE comments named the serving route, and a real promotion returned bootstrap error 5 after bootout.
  learned: successful stream receipts must finalize at EOF from bounded trailers, while LaunchAgent promotion must snapshot before mutation and recover transactionally.
  criterion now: ISC-270 and ISC-465 require concrete streamed attribution plus retry, health, and exact restore evidence.

- 2026-08-01 | conjectured: OmniRoute's native CLI Code and Hermes Agent helpers could be applied directly because the dashboard already understood both clients.
  refuted by: native Codex discovery proposed context limits outside the governed profile contract, while installed Hermes source showed preview merges existing YAML, emits `api_key` fields, creates the target directory, and does not resolve `keyId` into a non-plaintext runtime reference.
  learned: native helpers are valuable schema and compatibility oracles only when wrapped by zero-write, hash, placeholder, and rollback gates; existing Temperance profiles and protected Hermes ownership remain authoritative.
  criterion now: ISC-374 through ISC-376 and ISC-379 require isolated dry-run discovery, unchanged governed hashes, zero plaintext keys, and a placeholder-only Hermes proposal with zero residual state.

- 2026-08-01 | conjectured: the six-skill A2A Agent Card was sufficient proof that OmniRoute already exposed an authenticated capability lane.
  refuted by: anonymous and invalid-Bearer card reads both returned HTTP 200, A2A was disabled with zero tasks, and installed `/a2a` source checked only an absent ambient server key rather than governed database keys or sessions.
  learned: public discovery metadata is not authenticated execution evidence. Keep A2A disabled; load MCP scope enforcement only as a dormant pre-registration invariant; require a real least-scope denial before transport promotion.
  criterion now: ISC-381 is satisfied by live pre-registration scope enforcement, while ISC-382 remains open until a bounded capability response is both authenticated and anonymously denied.
- 2026-08-01 | conjectured: observation TTL could safely reset every stale circuit to neutral before enforce promotion.
  refuted by: fixed-state preview ranked stale-open Command Code ahead of fresh healthy OmniRoute once all of its factors decayed to neutral.
  learned: circuit resolution is safety state, not ordinary optimization telemetry. Preserve unresolved state, bound half-open recovery with one lease, and promote only from a receipt-bound OmniRoute-first plan.
  criterion now: ISC-58 and ISC-466..ISC-469 require stale-circuit exclusion, deterministic promotion, exact rollback, live healthy selection, and an immediate explicit off override.

- 2026-08-01 | conjectured: replacing the earlier Spark-pinned skill example would weaken the parallel-dispatch regression gate.
  refuted by: the full diff, executable mutation controls, canonical verifier, and independent Cato audit showed the retargeted assertions preserve candidate-only `te-dispatch`, require exact proven models, make Spark optional, exclude Sol, and fail red on policy drift.
  learned: routing examples must test the currently authorized governance boundary, while compatibility evidence belongs in separate retained fleet assertions rather than an obsolete exclusive-default example.
  criterion now: ISC-459 through ISC-464 require skill synchronization, mutation failures, artifact integrity, launcher fail-closed behavior, and a full canonical pass.

- 2026-08-01 | conjectured: the Mac OpenCode reconciler would transfer to EC2 once Mac-only aliases were replaced.
  refuted by: the live Ubuntu config lacked the Temperance provider, retained a legacy `code-fast` binding, and OpenCode 1.18.4 normalized agent `maxSteps` into additional `steps` and `options` fields.
  learned: host reconciliation must bootstrap missing governed providers, retire known host-specific legacy bindings, align client versions, and validate normalized effective configuration rather than raw fixture bytes.
  criterion now: ISC-309 through ISC-316 require Ubuntu-owned reconciliation, exact providers and aliases, version-compatible defaults, skills, agents, and depth readback.

- 2026-08-01 | conjectured: a responsive EC2 combo name and successful content response were sufficient to assign its S/A/B execution role.
  refuted by: `te-free-burst` and `te-fast` returned content but failed forced-tool canaries, while the compatibility route passed tools; every advertised Opus-class EC2 route remained unauthenticated, quota-blocked, or non-Opus.
  learned: content and tool readiness are separate evidence classes; cheap content, B tool work, A continuity, and S coordination need distinct bindings, and unavailable S must fail closed.
  criterion now: ISC-314 and ISC-322 through ISC-336 separate the B content/tool lanes, A continuity, structured S unavailability, and credential-gated S promotion.

- 2026-07-29 | conjectured: OpenCode needed to expose OmniRoute's provider catalog so the operator could access newly added models.
  refuted by: the live catalog grew to 1,321 advertised entries while the governed 14-alias surface completed fresh Native, Algorithm, automatic, tool, and streaming probes.
  learned: catalog breadth is router input, not session UX; OpenCode should expose stable task postures and governed overrides while OmniRoute resolves concrete targets behind them.
  criterion now: ISC-257 through ISC-260 and ISC-282 through ISC-286 require exact provider containment, bounded aliases, fresh-session execution, clean plugin loading, catalog freshness, and preserved model limits.

- 2026-07-29 | conjectured: a provider's active connection and catalog membership were sufficient evidence to place its models into a fallback chain.
  refuted by: the current 28 connections include 27 active accounts but zero newly added candidates with the full content, tool, health, and promotion-receipt evidence set.
  learned: capability tier and fallback readiness are separate dimensions; AGY, Ollama Cloud, and OpenCode Zen remain explicit candidate roles until evidence-backed promotion.
  criterion now: ISC-251 through ISC-255 and ISC-271 through ISC-279 separate inventory, role, failure domain, readiness, and promotion gates.

- 2026-07-29 | conjectured: OmniRoute combination bodies could persist `systemMessage` and `queueDepth` as Temperance-owned coordinator and queue policy.
  refuted by: OmniRoute 3.8.48 silently dropped both fields during authoritative readback.
  learned: coordinator behavior belongs in OpenCode agent prompts, task concurrency belongs to the dispatcher, and reconciliation must compare only fields the upstream API actually persists.
  criterion now: ISC-256 through ISC-268 and ISC-276 through ISC-277 place workflow policy in session profiles, bound worker depth, and preserve snapshot-first combination ownership.

- 2026-07-29 | conjectured: one time-bounded catalog cache could safely serve both direct OmniRoute and the synthetic Temperance relay.
  refuted by: a successful direct catalog read polluted the relay's distinct model namespace until the cache was keyed by base URL.
  learned: request-time catalog guards must isolate authority domains and fail closed on unavailable, malformed, empty, or expired catalog data.
  criterion now: ISC-274, ISC-283, and ISC-284 require clean startup, namespace-safe model resolution, and fail-closed cache behavior.

- 2026-07-29 | conjectured: every compatibility-streaming response would expose OmniRoute's resolved provider and model headers.
  refuted by: direct `te-algorithm` and `te-dispatch` canaries exposed concrete attribution, while the compatibility streaming rail returned no concrete attribution headers.
  learned: initial headers were insufficient evidence; streamed attribution required final SSE control-trailer processing at the proxy boundary.
  criterion then: ISC-269 was verified while ISC-270 stayed open; the 2026-08-01 EOF-finalization evidence later closed ISC-270.

- 2026-07-29: A direct Codex CLI canary succeeded with both relay URLs unavailable, establishing the verified break-glass rail. Command Code lacked credits, Kimi stalled, and the configured Grok model was absent, so those legacy rails remain documented as unready rather than silently entering fallbacks.
- 2026-07-29: The receipt-bound OpenCode/skill/combo rollout is live with exact reverse-order restoration recorded in `opencode-tiering-20260729T103424Z-bundle.json`.
- 2026-07-29: Added the Paseo portfolio reconciliation acceptance slice (ISC-221..250), role-preference template, and operational guide for the vault's 87-record/85-present project inventory.
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

- 2026-07-28 | conjectured: ~9 files across `~/.claude/hooks` and `PAI/Tools` each defined their own colorizable `log()` helper in the same shape as `pai.ts`'s ANSI-color proof-of-concept, and the color pattern could be mechanically extended to all of them
  refuted by: grepping the actual call sites (not just the function name) found `ReadmeSkillSync.hook.ts`, `ArchitectureAssetsSync.hook.ts`, `NextStepOrchestrator.hook.ts`, and `MarkitdownIntercept.hook.ts` define only a `logJsonl()` file writer with zero `console.log`/`console.error` calls — nothing to colorize; `SecurityValidator.hook.ts`'s sigil-bearing `console.error` lines run as a Claude Code hook subprocess, not a user-invoked terminal, so raw ANSI's rendering is unverified there; `handlers/VoiceNotification.ts` and `handlers/voice.ts` use no sigils at all
  learned: a memory or prior-session claim that "file X has a log() helper" names a resemblance, not a verified fact — the function's actual call sites and execution context (user-invoked CLI vs. hook subprocess vs. file writer) determine whether it's a safe target, not its name. Only `OpinionTracker.ts` shared `pai.ts`'s exact context (a directly user-invoked `bun` CLI) and was a valid target
  criterion now: ISC-188 requires a connector name or ANSI color to land only on output verified to be human-terminal-facing, never assumed from a memory's file list

- 2026-08-01 | conjectured: the governed rollout reduced the OmniRoute topology to the same two providers exposed in OpenCode.
  refuted by: live Mac CLI and SQLite readbacks show 28 connections, 25 configured families, and 27 enabled connections; installed UI code and the 34-node screenshot show that only activity states are emphasized.
  learned: `2` is coincidental across different layers—two OpenCode adapters and two emphasized topology nodes—while the blue `1` is the distinct in-flight provider count and red can retain an old unsuccessful request without expiry.
  criterion now: ISC-337 through ISC-346 distinguish adapters, upstream inventory, historical identities, live activity, and protected runtime boundaries.

- 2026-08-02 | conjectured: the reviewed state machine could be promoted by wiring the installed OmniRoute key API and relying on deterministic Cloudflare names for crash recovery.
  refuted by: installed OmniRoute 3.8.48 cannot express session-request, session-duration, burst, or exact-path limits, while Cloudflare service-token names cannot prove provenance and Cato found pathname-reopen risk in the first recovery read path.
  learned: a production boundary must refuse weaker keys before HTTP, journal exact identifiers before recovery, classify ambiguous outcomes as manual orphans, and read recovery state only through owner/mode/link/inode-validated descriptors.
  criterion now: ISC-529..ISC-536 close the locally verified composition boundary; live authority and canary criteria remain open and no Quick Tunnel fallback is permitted.

- 2026-08-03 | conjectured: preserving project continuity across Codex, Claude, OpenCode, Kimi, and Paseo required redacted native-session identity tuples, path-successor maps, provider-version coverage, and Paseo reconciliation during repository relocation
  refuted by: the user explicitly removed Paseo from the current goal, the Kimi architecture research proves Kimi Work has no prompt-submit hooks, and the TN clean-pass separates the Tryambakam runtime from Thoughtseed planes rather than sharing their session or control state
  learned: durable continuity belongs in a client-neutral repository packet plus a bounded checkpoint; native sessions are disposable client-local provenance, Codex governs the local approval loop, OmniRoute routes calls, and portfolio authorities remain isolated
  criterion now: ISC-635, ISC-636, ISC-642, ISC-649, and ISC-650 are tombstoned; ISC-661..ISC-729 define packet shape, authority isolation, portfolio mapping, routing deployment scope, old-path consumer discovery, resolver/live-client pickup, and zero Paseo/provider-store dependency

- 2026-08-03 | conjectured: merging a completed Thoughtseed reconciliation back into main project management meant moving or collapsing the relocation-registry entry into the canonical project record
  refuted by: the user approved merge-back only after reconciliation, while the existing design requires digest-bound rollback, ratification, and integrity evidence to survive independently of current project state
  learned: merge-back is an authority cutover and outcome projection; current facts plus an evidence pointer enter the main record while the TeamForge-keyed reconciliation entry freezes in place as historical evidence
  criterion now: ISC-730 and ISC-731 record both owner ratifications; ISC-732..ISC-749 define Thoughtseed reconciliation start, cutover, content-addressed projection, append-only closure, actor attribution, retention, and anti-flattening behavior

- 2026-08-04 | conjectured: the existing Cambium Workbench plus current local portfolio registries could directly seed a relocation-authorizing repository map
  refuted by: only 14 of 54 WorkObjects carry repository provenance, no immutable repository-to-WorkObject join exists, the queried local TeamForge snapshot has zero project mappings, and the ratified TN project registry path is not configured
  learned: Cambium is a digest-bound review cockpit while repository identity, portfolio membership, worktree topology, and current address require separate evidence; mapping authority and packet preparation precede any canary
  criterion now: ISC-750, ISC-751, and ISC-754..ISC-757 close the read-only coverage, provenance, browser, hold, and no-mutation probes while ISC-752 and ISC-753 remain open for the deterministic row schema and authoritative mapping table

- 2026-08-04 | conjectured: a repository's current filesystem path could continue serving as its durable identity during relocation mapping
  refuted by: nested checkouts, linked worktrees, planned relocations, and the owner's explicit approval of Decision 1 show that addresses can change while the repository remains the same
  learned: repository identity must be modeled independently from every filesystem address before any mapping row can become authoritative
  criterion now: ISC-758 records the ratified path-non-identity invariant while address representation remains undecided

- 2026-08-04 | conjectured: hosted-repository continuity should be the next identity-mapping decision after excluding paths as identity
  refuted by: the owner clarified that the immediate unmet need is a system for renaming and organizing repository folders beneath the approved portfolio roots
  learned: identity safeguards are supporting constraints for a concrete folder-management system; normalization policy must precede hosted-identifier mechanics
  criterion now: ISC-759 requires destination repository-directory naming to be ratified before any rename or move

- 2026-08-04 | conjectured: choosing kebab-case or snake_case could be the next single-axis grammar decision after universal normalization
  refuted by: both Advisor reviews showed that either separator ballot silently ratified a wider character repertoire, especially whether internal ASCII periods are representable
  learned: basename grammar must be ratified as independent representability facets before separator, derivation, collision, or enforcement decisions
  criterion now: ISC-759 closes universal normalization policy while ISC-760 remains open until the complete destination basename grammar is ratified

- 2026-08-04 | conjectured: an uppercase-admissibility ballot could directly follow the dotless ruling using short positive option labels
  refuted by: Advisor review exposed that positive labels assumed an interim admission model and that whole-path wording could accidentally bind uppercase literals in the fixed destination root
  learned: each character-class facet must constrain the eventual complete grammar, bind only the exact depth-one `<repository>` segment, and use complementary exclusion language
  criterion now: ISC-760.1 records the dotless ruling while ISC-760.2 holds the exact uppercase-exclusion decision and parent ISC-760 remains pending

- 2026-08-04 | conjectured: either answer to a full lowercase-class inclusion ballot could close the lowercase repertoire facet
  refuted by: post-deliverable Advisor showed that declining a whole-class inclusion requirement excludes nothing and therefore leaves lowercase membership unresolved
  learned: positive character-repertoire admission uses an approval-or-defer ballot; only affirmative full-class approval closes the facet
  criterion now: ISC-760.2 records uppercase exclusion, ISC-760.3 remains pending lowercase approval, and parent ISC-760 remains open

- 2026-08-04 | conjectured: admitting the lowercase class might be enough to validate lowercase-bearing repository names
  refuted by: the owner's explicit non-rulings and Advisor readback separate repertoire membership from occurrence, placement, counts, separators, digits, and derivation
  learned: class membership is permission only and cannot independently make any concrete repository basename valid
  criterion now: ISC-760.3 closes lowercase membership, ISC-760.4 holds the all-or-none ASCII-digit class ballot, and parent ISC-760 remains open

- 2026-08-04 | conjectured: the next hyphen-minus membership ballot needed a non-vacuity clause or an immediate closed-allowlist convention
  refuted by: the owner's established lowercase and digit semantics explicitly separate repertoire membership from occurrence and position, while Advisor review exposed non-vacuity and closure as bundled axes
  learned: codepoint membership, repertoire closure, and positional syntax must remain separate ratifications; membership alone validates no concrete name
  criterion now: ISC-760.4 records ASCII-digit membership, ISC-760.5 holds pure U+002D membership treatment, and parent ISC-760 remains open

- 2026-08-04 | conjectured: the owner's shortened hyphen-minus restatement might retract omitted limitations from the named option
  refuted by: the stable option label selected the previously defined complete option, while the restatement repeated a proper subset and introduced no contradictory ruling
  learned: a named owner option carries its operative scope through abbreviated restatements unless the owner explicitly revises that scope
  criterion now: ISC-760.5 records pure U+002D membership, ISC-760.6 holds U+005F membership treatment, and parent ISC-760 remains open

- 2026-08-04 | conjectured: character-class ballots could continue without first naming the default status of every unruled code point
  refuted by: Advisor review showed closure silently decides leading/trailing periods, non-ASCII characters, controls, and whether an unresolved option behaves like provisional admission
  learned: repertoire closure is its own owner-ratified axis, with path-structural invariants carved out and defer explicitly blocking dependent decisions
  criterion now: ISC-760.6 closes low-line exclusion, ISC-760.7 holds closed/open/deferred closure policy, and parent ISC-760 remains open

- 2026-08-04 | conjectured: leading-hyphen legality could be decided without fencing segment length, representation, or neighboring positions
  refuted by: Advisor identified length-one collision, empty-segment vacuity, artifact-definition ambiguity, and accidental digit/separator implications
  learned: position ballots must name the literal on-disk sequence, require distinct positions through a length-at-least-two carve-out, and preserve every adjacent axis as unresolved
  criterion now: ISC-760.7 records closed repertoire with future admissions possible, ISC-760.8 holds the corrected leading-U+002D ballot, and parent ISC-760 remains open

- 2026-08-04 | conjectured: a post-deliverable Advisor call with only a summary prompt could certify ratification fidelity
  refuted by: the Advisor returned BLOCKED because it received no ISA text to inspect
  learned: an empty external audit is no verdict; local section, criterion, scope, and diff checks remain the acceptance evidence
  criterion now: ISC-760.7 is owner-checked, ISC-760.8 remains pending, and the destination root remains empty

- 2026-08-04 | conjectured: the bare owner word “forbidden” might require another clarification before closing the leading-hyphen axis
  refuted by: the prior ballot exposed exactly one forbid option, and Advisor confirmed the answer uniquely selects F while warning against conflating repeated-hyphen consequences with a new rule
  learned: record the exact referent, preserve the length-at-least-two carve-out, and distinguish direct first-position prohibition from incidental effects on names like `--foo`
  criterion now: ISC-760.8 is owner-checked as F-leading-hyphen-forbidden, ISC-760.9 holds the trailing-U+002D ballot, and parent ISC-760 remains open

- 2026-08-04 | conjectured: a post-deliverable Advisor failure should block a locally evidenced owner ratification
  refuted by: both Advisor attempts lacked ISA state in their invocation context, while direct readback supplied the owner ballot, exact scope, status markers, and no-mutation probes
  learned: textless external audits are recorded as no verdict; explicit unresolved axes must be named rather than inferred from a length fence
  criterion now: ISC-760.8 is owner-checked, single-character `-` is explicitly unresolved, ISC-760.9 is staged, and the destination root remains empty

- 2026-08-04 | conjectured: “forbidden as well” might broaden the trailing ballot beyond its explicit length-at-least-two scope
  refuted by: the staged Decision 11 text supplied exactly two trailing options and explicitly limited both to length-at-least-two segments
  learned: anaphoric owner answers inherit only the preceding ballot's named option and scope; the singleton case needs its own explicit ballot
  criterion now: ISC-760.9 is owner-checked as T-trailing-hyphen-forbidden, ISC-760.10 holds the singleton `-` ballot, and parent ISC-760 remains open

- 2026-08-04 | conjectured: storing only an anaphoric reply string was sufficient to preserve trailing-ruling fidelity
  refuted by: post-deliverable Advisor required an explicit resolved option, no-scope-extension statement, and proof that earlier rules excluded length one
  learned: owner evidence needs both verbatim language and a normalized option token; staged singleton treatment is valid only after prior length fences are read back
  criterion now: ISC-760.9 records `resolved_option: T-trailing-hyphen-forbidden`, ISC-760.10 remains staged, and the destination root remains empty

- 2026-08-04 | conjectured: singleton permission could be ratified without defining lexical roots, symlink handling, or implementation status
  refuted by: Advisor identified scope drift, entry-type ambiguity, argument-parsing hazards, and a missing conformance fixture boundary
  learned: singleton permission must be exact-name-only, lexical, default-deny for every unruled neighbor, and explicitly non-implementable until entry type is decided
  criterion now: ISC-760.10 is owner-checked as S-singleton-hyphen-permitted, ISC-760.11 holds the binary interior-hyphen ballot, and parent ISC-760 remains open

- 2026-08-04 | conjectured: interior-hyphen permission could be balloted before multi-codepoint admission
  refuted by: Advisor showed that every interior position presupposes a multi-codepoint name and therefore couples the ballot to an unresolved admission axis
  learned: resolve multi-codepoint hyphen-bearing names first, then ballot interior position as a dependent axis with a distinct length fence
  criterion now: ISC-760.10 records singleton permission with policy/mechanism separation, ISC-760.11 holds multi-codepoint admission, and ISC-760.12 reserves interior position

- 2026-08-04 | conjectured: singleton policy could remain sufficiently precise without a self-contained raw-codepoint predicate and fixture contract
  refuted by: follow-up audit identified deferred-permit ambiguity, mount-root drift, missing access-verb boundaries, and normalization/confusable leakage
  learned: a naming rule must pin raw U+002D identity, lexical depth, symlink behavior, absent destination-root status, and explicit non-inheritance vectors
  criterion now: ISC-760.10 is owner-checked with policy/mechanism separation, ISC-760.11 is the next multi-codepoint ballot, and no destination root was created

- 2026-08-04 | conjectured: multi-codepoint admission automatically preserved prior leading/trailing prohibitions and exposed a clean interior ballot
  refuted by: Advisor identified missing precedence, undefined “hyphen” referent, enforcement relaxation risk, and the fact that bare interior permit/forbid is degenerate
  learned: admission must name U+002D exclusively, freeze enforcement, ratify precedence separately, and defer interior flanking until precedence resolves
  criterion now: ISC-760.11 is owner-checked as M-multicodepoint-hyphen-permitted, ISC-760.12 holds precedence, and ISC-760.13 reserves interior flanking

- 2026-08-04 | conjectured: multi-codepoint admission could be treated as validator evidence or repetition permission
  refuted by: post-deliverable audit distinguished prescriptive policy from absent implementation and identified `a--b` as an unballoted adjacency case
  learned: policy admission never certifies a validator or concrete name; adjacency and flanking require their own explicit decisions
  criterion now: ISC-760.11 is policy-checked only, ISC-760.12 holds precedence, ISC-760.13 reserves flanking, and no validator behavior changed

- 2026-08-04 | conjectured: intersection precedence could be ratified together with a complete positional composition semantics
  refuted by: Advisor separated the owner token from unresolved projection quantifier, normalization ordering, witness language, and implementation evidence
  learned: precedence is a standalone composition rule; projection must be decided before any interior-domain ballot
  criterion now: ISC-760.12 is owner-checked as P-precedence-intersection, ISC-760.13 holds projection, ISC-760.14 reserves interior flanking, and no validator changed

- 2026-08-04 | conjectured: positional projection could be balloted before normalization/validation stage
  refuted by: follow-up audit showed normalize-then-project and project-then-normalize produce different boundary outcomes and make projection basis non-independent
  learned: ratify normalization stage first, then projection basis, then interior flanking; each stage must preserve the monotone precedence law
  criterion now: ISC-760.12 is owner-checked as P-precedence-intersection, ISC-760.13 holds normalization stage, ISC-760.14 holds projection basis, and ISC-760.15 reserves flanking

- 2026-08-04 | conjectured: validate-before-normalization could be recorded as behavior-neutral
  refuted by: Advisor identified certain rejection-set deltas and an unresolved post-normalization validity invariant
  learned: ordering policy must acknowledge downstream deltas and defer projection basis, collision, transform, and post-normalization validity explicitly
  criterion now: ISC-760.13 is owner-checked as N-validate-before-normalization, ISC-760.14 holds projection basis, and ISC-760.15–ISC-760.17 remain pending

- 2026-08-04 | conjectured: projection basis could follow normalization ordering without a validity-closure ballot
  refuted by: Advisor showed that normalized projection assumes validity preservation and that identity-key and presentation projections can diverge
  learned: decide normalization validity closure first, then identity-key projection, presentation projection, collision, and transform/invariant
  criterion now: ISC-760.13 is owner-checked as N-validate-before-normalization, ISC-760.14 holds validity closure, and ISC-760.15–ISC-760.18 remain pending

- 2026-08-04 | conjectured: validity-preserving normalization could be treated as proof of implementation or a complete projection policy
  refuted by: owner ratification is prescriptive and leaves the transform, validator evidence, identity key, presentation, and collision semantics unselected
  learned: record validity preservation as a downstream invariant, then ballot identity-key source independently from presentation and collision policy
  criterion now: ISC-760.14 is owner-checked as V-normalization-validity-preserving, ISC-760.15 holds the identity-key ballot, and ISC-760.16–ISC-760.18 remain pending

- 2026-08-04 | conjectured: normalized-name identity could implicitly settle presentation or transform behavior
  refuted by: owner’s answer resolves only the identity-key source while presentation, collision, algorithm, and implementation remain independent axes
  learned: use the future normalized name for durable identity, then ask separately how names are presented to operators
  criterion now: ISC-760.15 is owner-checked as P-identity-key-from-normalized-name, ISC-760.16 holds the presentation ballot, and ISC-760.17–ISC-760.18 remain pending

- 2026-08-04 | conjectured: normalized-name presentation would leave only one undifferentiated final question
  refuted by: collision policy, transform selection, and post-normalization enforcement have independent failure modes; historical interior-flanking notes also lack a stable criterion
  learned: batch the three formal follow-ups while reporting the flanking bookkeeping gap separately instead of implying it is resolved
  criterion now: ISC-760.16 is owner-checked as P-presentation-from-normalized-name, ISC-760.17 and ISC-760.18 remain pending, and no implementation is authorized

- 2026-08-04 | conjectured: the three batched projection/normalization answers would close the complete repository grammar
  refuted by: earlier Decisions 13–16 explicitly deferred interior U+002D flanking and adjacency, while no stable criterion represented that dependency
  learned: promote the deferred axis to ISC-760.19 with a binary flanking-versus-run ballot rather than silently treating the historical note as resolved
  criterion now: ISC-760.17 and ISC-760.18 are owner-checked, ISC-760.19 holds the final interior-hyphen ballot, and no implementation is authorized

- 2026-08-04 | conjectured: permitting interior U+002D runs would repeal the earlier edge prohibitions
  refuted by: Decision 23 explicitly retains leading/trailing prohibitions and the monotone intersection precedence law
  learned: interior adjacency is an independent permitted shape; it does not grant edge placement or filesystem authority
  criterion now: ISC-760.19 and parent ISC-760 are owner-checked, the complete normalized basename grammar is policy-closed, and implementation remains deferred

- 2026-08-04 | conjectured: grammar closure could transition directly into a live relocation
  refuted by: the relocation plan still requires read-only inventory, packet and registry preflight, path-consumer audit, deterministic manifest approval, and a single-canary boundary
  learned: execution planning is its own safety tranche; the grammar becomes a pure policy oracle before any move or rename is considered
  criterion now: ISC-760 is owner-checked, the grammar execution addendum is recorded, and all filesystem and repository mutation remains deferred behind explicit approvals

- 2026-08-04 | conjectured: every standalone child returned by a two-root scan could be exposed as a relocation candidate
  refuted by: the first read-only probe surfaced the pinned Thoughtseed Labs knowledge vault and ambiguous/control-plane surfaces as candidates
  learned: inventory disposition must apply explicit knowledge-vault, owner-mapping, active-control, and TN-baseline holds before any canary review
  criterion now: grammar tests pass, the corrected inventory is held/candidate classified, and the destination remains empty

- 2026-08-04 | conjectured: the largest clean standalone candidate would be the safest canary
  refuted by: `thoughtseed-brand-atlas` has a clean Git baseline and low worktree coupling but 513M of ignored/generated state, while the other clean candidate shares nine worktrees
  learned: canary safety is a conjunction of clean state, graph isolation, path-consumer absence, and bounded ignored state; the recommendation still requires owner approval of the size tradeoff
  criterion now: `thoughtseed-brand-atlas` is recommended but unapproved, `plexus-ts-github-settings-ota-review` is held, and no canary transaction is authorized

- 2026-08-04 | conjectured: canary approval implied readiness for a live move
  refuted by: the held dry-run found all six portable-packet prerequisites absent even though Git, collision, and path-consumer checks passed
  learned: canary selection, packet preparation, manifest approval, and live apply are independent gates; a missing packet must stop before any mutation
  criterion now: canary selection is owner-approved, the dry-run is held with a packet-missing reason, and no live transaction is authorized

## Verification

- ISC-750: directory enumeration — The report classifies all 70 Thoughtseed immediate children: 68 directories and 2 files.
- ISC-751: directory enumeration — The report classifies all 57 Tryambakam immediate children: 41 directories and 16 files.
- ISC-754: source inspection — The report identifies the Workbench app sources, bundler artifact, Worker embed, catalog sources, and digest-bound authority contract.
- ISC-755: authenticated Chrome snapshot — `/admin/portfolio/web` rendered `portfolio-workbench@v3; offline; proposal-only`, 54 WorkObjects, 16 review records, zero local plans, and zero writers.
- ISC-756: hold audit — Orphans, ghosts, collisions, conflicting addresses, missing registry evidence, worktree graphs, dirty states, and ambiguous mappings are all held from relocation.
- ISC-757: pre/post boundary snapshot — `/Volumes/madara/2026/Projects/` remained empty; no destination portfolio directory, session/Paseo mutation, provider-store traversal, remote Git operation, or external-service write occurred.

- ISC-730: owner ratification — User approved exact Thoughtseed registry path conditional on post-reconciliation merge-back to main project management.
- ISC-731: owner ratification — User explicitly approved exact Tryambakam registry path `/Volumes/madara/2026/twc-vault/_System/10865xseed/projects/<repository>/`.
- ISC-758: owner ratification — User replied `approve` to Decision 1 after it was narrowed to the single path-non-identity principle.
- ISC-759: owner ratification — User chose `A-normalize` for every future approved local destination repository directory basename; remote repository names remain untouched and no filesystem operation was authorized.
- ISC-760.1: owner ratification — User answered `dotless` to Decision 3, rejecting ASCII full stop U+002E at non-boundary positions in canonical local destination repository directory basenames.
- ISC-760.2: owner ratification — User chose `A-uppercase-excluded` and explicitly required the eventual grammar to forbid ASCII uppercase A–Z everywhere in the exact `<repository>` segment while making no ruling about lowercase admission.
- ISC-760.3: owner ratification — Exact owner answer: `A — A-lowercase-class-included (recommended): approve all ASCII lowercase letters a–z as permitted members of the <repository> character repertoire. This does not require their occurrence or decide position, count, separators, digits, or derivation.` The durable criterion and Decision 5 preserve those non-rulings.
- ISC-760.4: owner ratification — Exact owner answer: `A — A-digit-class-included (recommended): Permit all ASCII digits. This does not require digits or decide numeric-only names, positions, counts, separators, or derivation.` The durable criterion and Decision 6 preserve those non-rulings.
- ISC-760.5: owner ratification — Exact owner answer: `A — A-hyphen-minus-included (recommended): Permit - as a repertoire member. This does not require its occurrence, decide its position`. The durable criterion and Decision 7 preserve the answer and the previously defined named-option scope.
- ISC-760.6: owner ratification — Owner verbatim: `A — A-low-line-excluded (recommended): Exclude _. This establishes no separator semantics and may be revisited through an explicit owner ruling.` Interpretation: U+005F is excluded with no separator-semantic ruling, no expiry, and later supersession only by explicit owner decision.
- ISC-760.7: owner ratification — Owner verbatim: `A — A-closed-repertoire (recommended): Only explicitly permitted code points are admissible; future admissions remain possible.` Interpretation: current admissibility is limited to the explicitly permitted codepoint set; no position, occurrence, separator, derivation, enforcement, or concrete-name rule is implied.
- ISC-760.8: owner ratification — Exact owner answer: `forbidden`. The preceding ballot contained one forbid option, `F-leading-hyphen-forbidden`, so the answer uniquely closes the criterion. It applies only to U+002D at index 0 of literal on-disk depth-one `<repository>` segments of length at least two under the two ratified portfolio roots; the single-character `-` is explicitly unresolved, while trailing/interior positions, repeated-hyphen semantics, other hyphen code points, and filesystem actions remain outside scope.
- ISC-760.9: owner ratification — Verbatim owner answer: `forbidden as well`; `resolved_option: T-trailing-hyphen-forbidden`. The staged Decision 11 ballot contained exactly `T-trailing-hyphen-forbidden` and `T-trailing-hyphen-permitted`, so “as well” carries no scope extension and selects the forbid option within its explicit length-at-least-two scope. Decisions 10 and 11 do not cover length one, so the singleton `-` remains unresolved and is correctly staged as ISC-760.10.
- ISC-760.10: owner ratification — Verbatim owner answer: `S-singleton-hyphen-permitted`; `resolved_option: S-singleton-hyphen-permitted`. U+002D HYPHEN-MINUS is permitted only when `depth(name, root) == 1` and raw pre-normalization codepoints equal `[U+002D]` under the two literal destination roots. Both roots are currently absent by design; this naming policy grants no filesystem access verb, and implementation remains deferred pending entry-type semantics. Multi-codepoint names are not admitted by this decision.
- ISC-760.11: owner ratification — Verbatim owner answer: `yes - M-multicodepoint-hyphen-permitted`; `resolved_option: M-multicodepoint-hyphen-permitted`. The prescriptive policy admits multi-codepoint lexical names containing exactly U+002D HYPHEN-MINUS, but the planning tranche has no validator implementation or behavior certification. Leading/trailing prohibitions remain binding; interior/flanking/adjacency/count behavior, including `a--b`, remains unvalidated and unauthorized.
- ISC-760.12: owner ratification — Verbatim owner answer: `P-precedence-intersection`; `resolved_option: P-precedence-intersection`. Multi-codepoint U+002D admission composes with prior positional prohibitions by intersection; projection, normalization, implementation, and concrete-name validity remain separate.
- ISC-760.13: owner ratification — Verbatim owner answer: `N-validate-before-normalization`; `resolved_option: N-validate-before-normalization`. Raw validation precedes any future normalization; rejection-set deltas and post-normalization validity remain explicitly deferred, with no validator or derived artifact changed.
- ISC-760.14: owner ratification — Verbatim owner answer: `V-normalization-validity-preserving`; `resolved_option: V-normalization-validity-preserving`. Every raw name accepted before normalization is required to remain valid after the future normalization transform. This is a policy invariant, not validator or implementation evidence; algorithm, projection, collision, enforcement, migration, and filesystem behavior remain unresolved.
- ISC-760.15: owner ratification — Verbatim owner answer: `normalized-name identity`; `resolved_option: P-identity-key-from-normalized-name`. The durable identity key derives from the future normalized repository name. This does not authorize implementation or decide presentation, collision, algorithm, validator, enforcement, migration, or filesystem behavior.
- ISC-760.16: owner ratification — Verbatim owner answer: `P-presentation-from-normalized-name`; `resolved_option: P-presentation-from-normalized-name`. Operator-facing presentation derives from the future normalized repository name. Collision handling and normalization details remain separate.
- ISC-760.17: owner ratification — Verbatim owner answer: `C-collision-fail-closed`; `resolved_option: C-collision-fail-closed`. Normalized-identity collisions reject the candidate before mutation or disambiguating rewrite; implementation and filesystem behavior remain unimplemented.
- ISC-760.18: owner ratification — Verbatim owner answers: `N-normalization-identity-after-validation` and `I-post-normalization-trust-preserving-policy`; resolved options are recorded in Decisions 21–22. The accepted ASCII basename remains unchanged after validation, and the validity-preserving policy is trusted without a second validation gate; no implementation behavior is certified.
- ISC-760.19: owner ratification — Verbatim owner answer: `F-interior-hyphen-run-permitted`; `resolved_option: F-interior-hyphen-run-permitted`. Interior U+002D adjacency is permitted, while leading/trailing prohibitions and intersection precedence remain binding. No validator or filesystem behavior changed.

- Execution tranche 1: pure grammar suite passed 6 tests and 28 assertions; read-only inventory produced 101 records with 29 candidates and 72 held, mode `0600`, SHA-256 `d5e1c3a99016b65c77ef226945383e902c2ba3dc005a278bc820bcd645a58f93`; `/Volumes/madara/2026/Projects/` remained empty.
- Canary review: `thoughtseed-brand-atlas` is clean, standalone, one-worktree, and has zero checked-in old-path matches; its tracked inventory SHA-256 is `56e6c172d00cb18880c3bc896395cda9b8b68e5583e42cb9103f550e6bc185cf`, ignored inventory SHA-256 is `79d6fbf05fc072b3e500d29c3356ae06fc7337a225b749595d59e7a35c762657`, and no destination exists. Owner approval remains required.
- Canary dry-run: source `/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/thoughtseed-brand-atlas`, destination `/Volumes/madara/2026/Projects/thoughtseed/thoughtseed-brand-atlas`, `ready:false`, no path consumers, no collision, clean Git, and six missing packet files; manifest mode `0600`, SHA-256 `a93d5dfd484ff3a5ecf5d553177731d019f43c93208cb90f2e7f7f73ad19ceeb`.
- Canary packet identity gate: the reviewed draft remains held because no exact TeamForge mapping was found in the bounded Thoughtseed authority readback; `project_id: null` is preserved and no destination or registry state changed.
- Fresh identity-hold dry-run: private manifest `/tmp/temperance-canary-identity.CTbw2i/thoughtseed-brand-atlas.plan.json` is mode `0600`, SHA-256 `82639f81493c477e29185cae91a593057cd16e82911e6402218d6ac9d8329bb4`, `ready:false`, with `packet_identity_pending_teamforge` and `working_tree_not_clean`; all six packet files are present, no exact checked-in path consumers exist, and the destination root remains empty.
- Final clean canary dry-run: private manifest `/tmp/temperance-canary-final.AiGIuv/thoughtseed-brand-atlas.plan.json` is mode `0600`, SHA-256 `6159095b53ea6df7b8ed35aeb705ae8142a5cf5cbd90ce39d37eb2b4e5ae8213`, `ready:false` with no hold reasons; packet digest is `4d177cbd15dd3710c5ae2df8cb3789a221f7d4c1c879d3fcf743ed2d2bcaef43`, identity is `verified-teamforge`, Git HEAD is `30e994a00a347e9817a03940c9cf068e7ea4a6a9`, path consumers are empty, collision is absent, and destination remains empty.
- Manifest approval readback: the approved file remains mode `0600` and byte-identical; source porcelain is empty, source HEAD matches the approved commit, and `/Volumes/madara/2026/Projects/` remains empty. No live apply was attempted because registry/capsule manifests and the separate apply approval remain outstanding.
- Apply preflight hold: source and canary remain unchanged; live execution cannot safely proceed until the owner baselines the Thoughtseed registry repository and the transaction/capsule writer produces a separate digest-bound apply manifest.

- ISC-586..ISC-588: source inspection, mocked argv capture, and the installed Codex help prove supported `--ignore-user-config` defaulting, exact-zero opt-out, flag placement before `--`, zero production `--ignore-rules`, explicit OmniRoute model/provider/base URL/wire/auth key/approval/sandbox/context settings, Keychain-or-environment child authentication rather than argv secrets, and `--ephemeral` execution.
- ISC-589 and ISC-591: `bash tests/dispatch-tasklist.sh` passes the complete dispatcher suite. Positive mode checks cover run directory `700` and plan/output/meta/diff/summary/index/leak/merge artifacts `600`; the worker observes the caller's `0027` umask unchanged. Negative controls reject an unsecurable caller output directory before artifact creation and prove a TERM-ignoring worker tree is frozen, killed, fully reaped, leaves no worktree or late artifact after its delay, exits 143, and retains only mode-600 files.
- ISC-590: the skill and runtime/native documentation require self-contained external tasks, retain repository rules, prohibit reliance on ambient user PAI hooks/plugins, preserve governed Antigravity/GitHub/Command Code/Kimi/Grok/Nebius alternatives, and exclude Sol-family identifiers. Context Settings, Hermes, Cloudflare, MCP/A2A, PAI/GSD/ISA, and skill-cluster authority boundaries are unchanged.
- ISC-592..ISC-593: accepted live run `/var/folders/zx/_wycnwwx3p1f_4gclpnhr8rm0000gn/T/tmp.RDcxO4QeKF` completed exact `codex/gpt-5.3-codex-spark` in 12 seconds with one substantive attempt, status `ok`, no fallback, plan `rp_cf3d499779e5ead5`, and unique correlation `tc_exec_1785651704928_20856_257278956_task_0_spark-default-isolation-proof`; its directory is `700` and all six retained files are `600`. The original 241-second ambient-config timeout and a later non-completing rerun terminated at the existing boundary remain rejected evidence; neither caused timeout inflation, fallback, or Sol execution.
- ISC-594: the accepted proof's protected native projection is byte-identical before/after. A final interrupted rerun independently returned projection comparison zero and retained only private plan/output artifacts. Inventory remains 28 configured connections, 25 configured families, 26 active connections, and 24 active families; compression and custom prompt remain off, dispatch remains five workers/four non-Codex/three non-Codex families/Sol-free, Hermes stays proposal-only, MCP dormant, A2A held, Quick Tunnel stopped, and external promotion gates closed.
- ISC-595: documentation continuity, native integration, shell syntax, `git diff --check`, and the serial `bash scripts/verify-all.sh` all end green with `Temperance Engine full verification passed`. Advisor's applicable concerns are encoded in artifact-local permissions and explicit isolation claims. Independent Cato first reproduced the late-write P1, then privately reproduced the repaired TERM-ignoring process-tree control and returned PASS with no remaining P0/P1. Final reread preserves governed non-Codex authorization, Sol exclusion, and the still-active broader integration goal.

- ISC-572..ISC-576: source and CLI confinement checks pin the sole live route to `POST http://127.0.0.1:20128/api/compression/preview`, admit no arbitrary input or engine identifier, fix Lite → Headroom → minimal RTK request construction, and find zero Bearer, token-file, login, cookie, inference-key, settings, provider, routing, Cloudflare, Hermes, MCP/A2A, or EC2 production seam.
- ISC-577 and ISC-580: live v2 receipt `~/.temperance_engine/receipts/omniroute-context-preview/20260802T053147600Z-78868-GCtUWE/receipt.json` records one anonymous canary, HTTP 401, `authState:"anonymous_denied"`, all three candidates held, and equal pre/post governed projection SHA-256 `8023834793b373220cf7dfbb7a82f98680acecde5659ef6b81a4d567a51f6d5c` with no changed field.
- ISC-578..ISC-579: pure validation fixtures require every PAI/GSD/ISA/tool/code/receipt/injection marker exactly once and in order, reject fallback/invalid metrics/validation, and normalize missing/null arrays without throwing; the live path never reads or awaits an unexpected response body and skips transport entirely when the pre-snapshot is invalid.
- ISC-581..ISC-582: `bun test ./package/router/omniroute-context-preview.test.ts` passes 13 tests and 91 assertions covering exact requests, marker attacks, malformed/null fields, auth denial, unexpected stalled bodies, invariant drift, unsafe receipt roots, and leakage; the v2 receipt is user-owned mode 600, metadata-only, non-authorizing, tokenless, and promotion-disabled.
- ISC-583..ISC-584: the native guide, GSD roadmap/state, and architecture table preserve PAI/GSD/ISA/skill-cluster semantic ownership, explicitly reject scoped Bearer tokens as sufficient authentication, record the separate anonymous and machine-token `401 AUTH_001` observations, and keep global compression, active combo, custom prompt, Hermes, Cloudflare, provider, routing, MCP/A2A, and EC2 state unchanged.
- ISC-585: three exact no-tool non-Codex OmniRoute reviews completed through GitHub and Antigravity Sonnet 5 families with HTTP-200 gateway attribution, private metadata receipts, no retained bodies, and zero Sol. Both Advisor attempts timed out without verdict and were not counted. Independent Cato first BLOCKed three P1s, then reproduced 324 malformed-field mutations and returned PASS with zero P0/P1 after credential removal; focused/native/docs/diff gates and the canonical `bash scripts/verify-all.sh` end green.

- ISC-557: source and call-path inspection prove the TypeScript and actual Bash renderers both request the `command-code` surface through the canonical metadata-only resolver and shared pure serializer.
- ISC-558: validator fixtures plus live shell spoof and multi-line-helper controls prove exact ordered compact JSON, exactly one reserved line, and zero stdout before validation succeeds.
- ISC-559: resolver/helper fixtures pass the full hostile-source matrix; the aggregate gate passes 68 tests and 208 assertions with zero PAI, GSD, skill-index, or secret body canaries.
- ISC-560: missing Bun, malformed helper output, validator rejection, and direct/full-dispatch failure controls return nonzero, leave zero promoted or staging AGENTS files, and launch zero Command Code processes.
- ISC-561: two same-model tasks receive distinct mode-700 workspaces, task-matching mode-600 AGENTS files, one canonical pointer line apiece, and no staging residue under caller umasks 000 and 022 on both BSD/GNU stat surfaces.
- ISC-562: native integration and documentation gates preserve pointer-only runtime discovery and no native source, Hermes, OmniRoute, Cloudflare, MCP, A2A, provider, EC2, or routing promotion; live protected hashes and listener/process state remain unchanged.
- ISC-563: the final canonical verifier ends `Temperance Engine full verification passed`; Advisor and independent Cato report no P0/P1; exact GitHub and Antigravity Sonnet 5 gateway attribution proves governed non-Codex review with zero Sol-family dispatch.

- ISC-548..ISC-553: the aggregate focused gate passes 72 tests and 248 assertions. It proves exact schema/key order, four-surface runtime gating, independent unexpected-failure containment, no body dependencies, and rejection of traversal, sibling-prefix, symlink, directory/FIFO, control, Unicode-separator, and envelope-delimiter attacks.
- ISC-554..ISC-555: `bash tests/wire-batch.sh` proves isolated backup-first `--refresh-enrich-only` installation and content idempotency; `bash tests/omniroute-native-integration.sh` proves the ownership, Command Code exclusion, native-source hold, and non-mutation documentation contract.
- Live projection: the installed core is byte-identical to `package/enrich`; Claude, Codex, OpenCode, and Kimi each emit one compact line with exact keys `pai`, `gsd`, `skills`, and `material=pointers-only`, and the redacted proof prints no path or body.
- Protected invariants: OmniRoute SQLite SHA-256 `4adc4344…`, dispatch-manifest SHA-256 `18fa4ffd…`, and Codex-hook SHA-256 `769301e2…` are unchanged; OpenCode hook/plugin symlinks retain repository targets; ports 20128/20129 remain loopback-only; exact `cloudflared` process count remains zero.
- Final acceptance: non-interactive `bash scripts/verify-all.sh` exits zero and ends `Temperance Engine full verification passed`; `git diff --check` passes. Grok 4.5 Build Cato and the final post-build Advisor rerun return PASS with no P0/P1. Advisor-driven red/green fixtures prove dry-run non-mutation, type-aware backup, unsupported-type refusal, unrelated-sentinel stability, staged-copy and backup-failure preservation, and failed-promotion restoration. Residual same-user metadata TOCTOU/hardlink aliasing and the brief retire/promote interruption window remain documented P2 recovery boundaries. No failed, unattributed, fallback-mismatched, quota-blocked, or timed-out review is counted as approval, and no Sol-family model was used.

- ISC-537..ISC-540: the live command emits exactly inventory, activity, policy, execution, and authority; reads one `readonly:true`/`query_only` transaction; selects no secret-bearing columns; passes recursive output tripwire and sentinel scans; and exposes no credential, session, HTTP, WebSocket, or network path.
- ISC-539: exact schema version `1`, WAL header/readback, stable WAL/SHM identities, absent hot journal, canonical owner/mode/link checks, `O_NOFOLLOW` descriptor identity, listener PID/start/package hash, exact process-held database device/inode, and stable `cloudflared` PIDs pass live; every negative fixture fails closed.
- ISC-541..ISC-544: live compression master-off reports `off`; master-on fixtures report `request-dependent` with active-profile resolution separated; CLI detection makes Hermes proposal-only; persisted MCP/A2A counters retain unknown configured state and no activation method.
- ISC-542 and ISC-545: live inventory reports 28 connections, 25 configured families, and 26 active connections while WebSocket activity remains explicitly unknown; the hashed manifest reports 5 workers, 4 non-Codex workers, 3 non-Codex provider families, 4 exact non-Codex targets, 3 direct fallbacks, and rejects `sol`, `sol-max`, and `solmax` across every target identifier.
- ISC-546..ISC-547: `bun test package/router/omniroute-native-control-plane.test.ts` passes 9 tests/53 assertions; the native integration shell gate and final `scripts/verify-all.sh` pass; architecture and independent Cato reviews return PASS with no P0/P1, and Cato reports no P2. `promotionAuthorized:false`, no mutation methods, stopped Quick Tunnel, zero `cloudflared` PIDs, no new iteration Sol call, and every external authority gate remain explicit.

- ISC-506..ISC-511: strict raw-JSON parsing rejects duplicate, unknown, and missing keys; exact manifest, hostname, loopback origin, model, bounded key policy, and deterministic dependency-order tests pass.
- ISC-513: failed authority, DNS-shadow, and certificate-path preflights make zero adapter calls and produce zero mutation.
- ISC-516..ISC-518: the injected adapter trace proves Service Auth Access precedes remote tunnel configuration and that exact protected ingress precedes a final DNS cutover with wildcard/apex-shadow rejection.
- ISC-521..ISC-522: reverse rollback, drift rejection, ownership-tag matching, foreign same-name refusal, partial-failure cleanup, canary-failure cleanup, and `PROMOTION_STUCK_OPEN` preservation tests pass.
- ISC-524: the actual generic CLI `preview` exits zero with `mutations:0`; every mutating command exits three with `production_adapter_and_exact_authority_required` and performs zero adapter mutation.
- ISC-526: documentation continuity tests map Cloudflare, OmniRoute, Temperance, PAI/GSD/ISA, remote-client, and operator ownership plus every remaining live input.
- ISC-528: prepared-state recovery and response-before-journal tunnel discovery require the exact journal-derived ownership hash, remove owned partial state, and refuse deletion of a foreign same-name object.
- ISC-512, ISC-514..ISC-515, ISC-519..ISC-520, ISC-523, ISC-525, and ISC-527 remain open: the repository has no reviewed production adapter, independently verified scoped authority, production secret/journal sinks, real staging canaries, or durable approval-consumption implementation.
- Named-tunnel focused verification passes 18 tests, 103 assertions, CLI bundling, documentation continuity, and diff hygiene; the final canonical `bash scripts/verify-all.sh` exits zero and ends `Temperance Engine full verification passed`.
- Independent Cato audit returns PASS with no P0/P1 and agrees that fifteen local/mock criteria may close while eight external production criteria remain open. Two exact non-Codex OmniRoute reviews informed the hardening with zero Sol-family model use.

- ISC-495..ISC-503: the exact three-entry non-Sol manifest, deterministic nine-request ceiling, serial loopback transport, closed outcomes and diagnostics, strict external credential descriptor, private exclusive receipt, source/bundle hashes, and repository non-consumer guards pass 31 focused tests with 139 assertions. Invalid early controls dispatch exactly pin-before, mismatch, and pin-after, attempt zero candidates, emit no intermediate result, and cannot mutate readiness, combos, Hermes, Cloudflare, or A2A state.
- ISC-504: live EC2 receipt `/var/lib/temperance-engine/s-tier-readiness/live-20260801T212852Z.json` is mode `600`, SHA-256 `a9929aaad626ce832bb3b1c524e0764e0980d26079c5cba01d0454516649ef75`, records three of nine permitted control requests, zero candidate attempts, expected pin controls, an unexpected-structure mismatch, and only `STRUCTURALLY_UNVERIFIABLE` candidates. A mechanical post-run assertion returned `protected_invariants=identical receipt=controls_only_inconclusive candidate_requests=0`; all three service PIDs, restart counts, activation timestamps, systemd and unit hashes, loopback listeners, security-group ingress hash, Hermes state, and `TEMPERANCE_AUTO_READY=0` remained exact.
- ISC-505: the final focused rerun passes 31 tests and 139 assertions; production bundling and `git diff --check` pass; the canonical `bash scripts/verify-all.sh` ends `Temperance Engine full verification passed`. Independent Cato returned PASS with no P0/P1. The later AWS `ExpiredTokenException` occurred in the control-plane CLI before SSM staging, so it produced no refresh receipt and is not counted as probe evidence. No Sol-family request or state change occurred.
- Persistent boundary: fresh local mandatory-client-auth verification passes; OmniRoute and the Temperance relay remain loopback-only, and `cloudflared` remains stopped. Fresh Cloudflare and A2A preflights exit `3` with `ready:false` and `promotionReady:false`. Genuine S-provider authentication, OmniRoute dashboard administration, durable named Cloudflare hostname/DNS/Access machine authority, and scoped A2A ownership remain external gates.

- ISC-491: manifest and fail-before-mutation fixtures — both manifests resolve exactly `{mode:"off",providers:["omniroute","temperance"]}`; the 45-check shell suite rejects non-off Mac mode and incomplete EC2 scope before writing backups or receipts.
- ISC-492: resolved configuration plus rollback fixtures — OpenCode 1.18.4 resolves exactly one lowercase `x-omniroute-compression: off` header on each governed provider; unrelated headers survive canonicalization, malformed headers fail before mutation, and byte-exact drift-protected Mac and EC2 rollback checks pass.
- ISC-493: controlled and live transport probes — the real OpenCode capture emitted two `/v1/chat/completions` requests with `compression:"off"`; 33 proxy tests and 113 assertions capture client `on` and mixed-case `engine:caveman` inputs becoming one upstream literal-off header while preserving the request body byte-for-byte. A real OpenCode 1.18.4 request through the deployed relay returned `OPENCODE_RELAY_OK`; the live non-Sol canary returned HTTP 200, provider `nebius`, exact content `COMPRESSION_BOUNDARY_OK`, and effective `off; source=off` under the unchanged false global master.
- ISC-494: LaunchAgent transaction and live health — the focused suite proves absent readiness writes `0`, affirmative readiness writes `1`, and failed promotion restores exact prior bytes; the installed plist reads back `1`, proxy health reports `automatic_ready:true`, and OmniRoute listener PID `17555` remained unchanged across promotion.
- ISC-491..ISC-494 independent review: Cato returned PASS with no P0/P1 after independently reproducing 33 proxy tests with 113 assertions, 45 session-profile checks, and the LaunchAgent transaction suite. It also verified the live canonical OpenCode headers, deployed relay hash and exact executable path, deployed-file mtime/ctime preceding PID start, explicit readiness, healthy loopback listeners, stopped Cloudflare, disabled A2A, and zero EC2, Hermes, or Sol promotion.
- Post-deliverable Advisor reconciliation: conflict recall withdrew initial HTTP-layer and restart objections that did not apply to this request-header boundary. Its final review reported no P0 and accepted the rejection of a positive compression-`on` control; deployed process freshness plus the installed per-request resolution path closed the remaining evidence questions without enabling compression.

- ISC-221..223: the vault source contains 87 records; independent literal-path audit found 85 present exact Git roots and two missing records (`sankalpa`, `witness-agents-intro-web`), including byte-verification of the trailing-space `temperence engine ` root.
- ISC-224..232: final `paseo --json workspace ls` readback reported 87 active workspaces over all 85 distinct valid inventory paths; all seven local-only and five inventory-authorized archive-named roots are present. Same-path extras are the pre-existing two-ID `temperance_engine` entry and a live task workspace on `motionsites-export`.
- ISC-233..236: source inspection found no import/run/restart/direct-registry-write command; Paseo daemon PID `1968` retained its 2026-07-28 start time; a zero-create live apply preserved the 85-repository status digest byte-for-byte (`5a09a19a...` before and after).
- ISC-237..242: dry-run receipt `vault-portfolio-2026-07-29T06-13-29-860Z-53725.json` reported 87/85/4/81/2; apply receipts record snapshot-before-create events and every per-path outcome; final receipt `vault-portfolio-2026-07-29T06-30-11-502Z-43627.json` reported 85 preserved, zero planned, zero created, and two named stale errors.
- Recovery evidence: a resumed apply overlapped the interrupted wrapper process and created 33 duplicate workspaces. All 33 receipt-bound IDs passed an exact two-workspace/path preflight, were soft-archived, and are documented by `vault-portfolio-overlap-cleanup-2026-07-29T06-18-19Z.json`. The reconciler now uses an exclusive mode-`600` lock plus immediate pre-create daemon readback; the concurrent fixture proves exactly one creation across overlapping processes.
- ISC-243..249: `docs/paseo-vault-portfolio.md`, the checked-in example, and live `~/.paseo/orchestration-preferences.json` document/contain all five verified role targets; the daemon remains localhost-bound with its encrypted relay enabled.
- ISC-250: `bun test tests/paseo-vault-projects.test.ts` passed 7/7 with 44 assertions, including overlapping apply safety; live reconciliation created zero workspaces and retained daemon PID `1968`; `./scripts/verify-all.sh` completed with `Temperance Engine full verification passed`.
- Independent Cato re-audit passed with no P0/P1 findings after verifying the exclusive apply lock, immediate pre-create daemon reload, overlap fixture, 85-path coverage, legitimate task-workspace preservation, and absence of session import, daemon restart, direct registry mutation, or repository writes.
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
- ISC-121: closed 2026-07-24 — repaired the drifted local OpenCode SQLite schema (`session_context_epoch` renamed to `session_context_epoch_legacy` and recreated with `replacement_seq`/`revision`, reversible), then `opencode run -m temperance/temperance-auto "Reply with exactly: TEMPERANCE_OPENCODE_OK"` returned the exact canary through the relay, and `~/.temperance_engine/state/openai-proxy.jsonl` recorded real non-test `surface:"opencode"` entries with plan `rp_ae462f526ee975fd`.
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
- ISC-188: grep confirmed exactly one of the ~9 originally-listed files (`OpinionTracker.ts`) has real, colorizable, user-invoked-CLI console output; the other 8 either had zero `console.log`/`console.error` calls (4 files, JSONL-only), ran in an unverified-ANSI hook-subprocess context (1 file), or used no sigils at all (2 files) — no color or connector name was applied to any of those 7, and `package/headless`'s JSON-only stdout received no Vigil naming for the same reason. `bun build OpinionTracker.ts`/`Banner.ts` (both `--target=bun`) and `bun build temperance-openai-proxy.ts --target=bun` all bundled clean; the rendered `Banner.ts` navy/navy-medium output (ANSI stripped, plain-text diffed) showed correct centering and no corruption; `bun test temperance-openai-proxy.test.ts` passed 19/19 unchanged; PR #29's `guard` and `verify` CI checks both passed before merge.
- ISC-216: the unrestricted host reran `scripts/verify-all.sh`; Spark fleet assertions and `tests/temperance-proxy-live.sh` passed, ending with `Temperance Engine full verification passed`.
- ISC-220: the live fleet lifecycle reconciled `te-dispatch`; a host canary selected `cx/gpt-5.3-codex-spark` and returned `x-omniroute-provider` plus `x-omniroute-model` attribution headers.
- ISC-251: `scripts/omniroute-connections.sh --json` reported 28 configured connections and 27 active without emitting credentials or full model IDs.
- ISC-252: `package/router/omniroute-connection-roles.json` maps AGY to `agentic` and Ollama Cloud plus OpenCode Zen to `backbone`.
- ISC-253: the live inventory and fixture test keep Claude, Cursor, Gemini, HuggingChat, Hugging Face, Kiro, and Perplexity Web `unmapped-not-eligible`.
- ISC-254: `temperance-session-profiles.json` validates exact `S`, `A`, and `B` capability-tier keys.
- ISC-255: the manifest validation suite passed its independent capability-versus-readiness taxonomy assertion.
- ISC-256: validated session policy contains automatic, Native, and Algorithm primary profiles.
- ISC-257: live OpenCode configuration and fresh-session readback resolve the default to `temperance/temperance-auto`.
- ISC-258: live validation reports exactly two enabled providers: `omniroute` and `temperance`.
- ISC-259: `opencode models` returned exactly 14 governed aliases despite 1,321 advertised OmniRoute catalog entries.
- ISC-260: the resolved OpenCode set contains zero raw NVIDIA or Hugging Face provider models.
- ISC-261: the live `small_model` is `omniroute/codex/gpt-5.3-codex-spark`, declared in the B capability tier.
- ISC-262: `skills/temperance-native/SKILL.md` and `skills/temperance-algorithm/SKILL.md` exist and are installed into OpenCode skill scope.
- ISC-263: secret and catalog-copy scans of both mode skills returned zero prohibited matches.
- ISC-264: Native binds `te-native`; Algorithm binds the explicit `te-algorithm` S coordinator.
- ISC-265: manifest tests prove coordinator selection is immutable for a session profile.
- ISC-266: dispatch policy assigns bounded helper work to B-tier workers before escalation.
- ISC-267: transition tests allow only `B → A → S` worker escalation.
- ISC-268: same-task downgrade is rejected; a lower tier requires a new task identifier.
- ISC-269: proxy receipt tests and live receipts record session, task, profile, tier, and decision fields.
- ISC-270: direct buffered chat, streaming chat, and Responses probes against `command-code/poolside/laguna-s-2.1-free` each returned HTTP 200 with concrete `cmd` / `poolside/laguna-s-2.1-free` attribution. After deployment, automatic streaming session `verify-isc270-final-20260801T153256Z` wrote exactly one successful receipt with provider `tr`, model `gemini-3-flash-solo`, and `error:null`; invalid-model session `verify-stream-http-error-20260801T153309Z` returned HTTP 404 and recorded `upstream_http_404` rather than a false success.
- ISC-271: validation confirms every eligible manifest model declares a failure domain.
- ISC-272: validation rejects A-tier continuity routes that share the paired S primary's failure domain.
- ISC-273: explicit picker-model proxy tests reach OmniRoute unchanged and bypass automatic classification.
- ISC-274: config validation and catalog guards reject dangling model, profile, and helper references.
- ISC-275: the live configuration write created a timestamped, mode-600, hash-bound backup before replacement.
- ISC-276: fleet reconciliation created identity-bound snapshots before every governed combo mutation and passed rollback tests.
- ISC-277: authoritative pre/post readback kept OmniRoute `activeCombo=null`.
- ISC-278: promotion validation requires content, tool, health, and receipt evidence together.
- ISC-279: AGY, Ollama Cloud, and OpenCode Zen remain candidate-only with no eligible fallback references.
- ISC-280: shared classifier parity and routing suites pass with `classify-task.sh` still the only task-type authority.
- ISC-281: 45 focused Bun tests and 15 configuration lifecycle assertions passed with zero failures.
- ISC-282: fresh default `temperance-auto` and Algorithm OpenCode sessions completed through the curated surface.
- ISC-283: fresh OpenCode startup loaded both Temperance plugins without named-export invocation errors.
- ISC-284: catalog-guard tests deny unavailable, malformed, empty, or expired catalogs and isolate caches by base URL.
- ISC-285: live session validation proves resolved OpenCode identifiers equal the 14-entry manifest set.
- ISC-286: all 14 custom aliases retain finite numeric context and output limits after reconciliation.
- ISC-287: `te-orchestrate` remains candidate-only and validation finds zero default or fallback references.
- ISC-288: live configuration sets subagent depth to one; manifest tests reject deeper worker recursion.
- ISC-289: an ephemeral direct Codex CLI canary returned `BREAKGLASS_OK` while both relay endpoints were unavailable.
- ISC-290: mode-600 bundle receipt `opencode-tiering-20260729T103424Z-bundle.json` records exact reverse rollback across OpenCode, skills, and both combo snapshots.
- ISC-291..ISC-295: the Mac mini remains live at OpenCode 1.18.4 with 14 aliases, 8 agents, 2 providers, depth one, direct/automatic readiness true, and its original mode-600 rollback bundle.
- ISC-296..ISC-307: AWS `safvr`, SSM, Ubuntu/OpenCode, OmniRoute, catalog, service, network, and content/tool discovery established the EC2-local evidence baseline without copying Mac credentials.
- ISC-308..ISC-317: final release `ec2-tiered-20260801T101249Z-r6-final` is manifest-verified and immutable; Ubuntu OpenCode validates 5 aliases, 7 agents, 2 providers, depth one; the isolated relay is active and enabled.
- ISC-318..ISC-326: both ports remain loopback-only; systemd delivers an unprintable credential to `temperance-router`; Hermes secrets are unreadable; Native, continuity, B-worker-tool, planner-tool, and fail-closed Algorithm canaries match the policy and receipt.
- ISC-327..ISC-332: the mode-600 bundle receipt records exact rollback order; rehearsal restored pre-config SHA `c3a990e7…`; Hermes hashes, PID, restart count, activation times, timer state, and security-group ingress stayed unchanged.
- ISC-333..ISC-336 remain open: EC2 still needs a genuine authenticated S provider plus OmniRoute admin authorization before `te-algorithm` and automatic Algorithm execution can be promoted.
- ISC-337: redacted `omniroute providers list --json` and SQLite readback agree on 28 Mac connections across 25 configured provider families; 27 connections are enabled.
- ISC-338: installed OmniRoute 3.8.48 source shows topology identities are the normalized union of nonempty `/api/provider-nodes` entries and non-placeholder `/api/provider-metrics` keys; 25 configured and 26 historical families reduce to the screenshot's 34 nodes, while the blue badge is a separate live-request reduction.
- ISC-339: `useLiveRequests` inserts providers on `request.started`, retains them through `request.streaming`, and removes them on `request.completed` or `request.failed`; OpenCode provider configuration is not read by this path.
- ISC-340: the graph assigns `activeCount` to `new Set(activeRequests.map(provider)).size`; the supplied screenshot shows badge `1` alongside exactly one green provider, OpenAI Codex.
- ISC-341: live OpenCode JSON contains exactly the adapters `omniroute` and `temperance`, while the independent Mac OmniRoute inventory contains 25 configured provider families.
- ISC-342: compiled topology construction reads provider-node and metric provider IDs only; governed combo names and OpenCode aliases are absent from the identity union.
- ISC-343: the supplied 2026-08-01 16:19 IST Mac screenshot retains the wider provider graph as dim idle nodes while only current/recent/error states receive emphasis.
- ISC-344: the graph receives its provider array, live-request array, `lastProvider`, and `errorProvider` directly from the polled/WebSocket backing inputs and derives every node color from those sets.
- ISC-345: a read-only `jq` assertion returned `counts_are_separate=true` for two OpenCode adapters versus 25 configured upstream provider families.
- ISC-346: OpenCode config remains modified 2026-07-29 with SHA-256 `525cbbd7…`; installed OmniRoute package remains modified 2026-07-21 with SHA-256 `6f154e5c…`; this pass issued no AWS, SSM, service, provider-authentication, routing-portfolio, EC2, or Hermes mutation.
- Independent Cato-style E5 audit: PASS with no P0/P1 findings. It independently reproduced 28 connections, 25 configured families, 27 enabled connections, 34 rendered identities, the one-provider in-flight badge predicate, and Antigravity's non-expiring 2026-07-29 HTTP 499 error marker; its P2 findings are dashboard semantics only.
- ISC-420..ISC-429 and ISC-433..ISC-441: live `scripts/omniroute-client-auth.sh verify`, restart rehearsal, revocation receipt, launcher fixtures, and `lsof` prove mandatory local authentication, both Keychain-backed clients, management denial, stopped Quick Tunnel, loopback-only binding, distinct least-privilege credentials, tokenless native profiles, and a real terminal HTTP 401 after the observed 60-second cache delay.
- ISC-442..ISC-445: two bounded native workers pinned exact `omniroute` profiles from separate non-Codex provider families; both returned nontrivial results with HTTP-200 gateway attribution, zero retained bodies, and zero Sol identifiers. Failed Codex-wire candidates were not promoted from catalog presence.
- ISC-450..ISC-458: management readback and receipts prove `noLog=true`, USD 10/50 daily/weekly caps, ten irreversibly redacted legacy bodies with summary telemetry retained, private curl credential transport, recovered launchd bootstrap failure, adapter-versus-upstream topology semantics, closed remote authority, and delayed revocation evidence.
- ISC-459: `shasum -a 256` returned the same `5c2db45e…` hash for repository and installed `temperance-parallel-dispatch` skills; file read confirms native non-Codex analysis is first-class, Spark optional, and Sol excluded.
- ISC-460..ISC-461: `bash tests/omniroute-client-auth.sh` rejects `noLog=false`, a fifth model, anonymous HTTP 200, inference-key management HTTP 200, and `*:20128`; the exact protected matrix passes.
- ISC-462: `bash tests/omniroute-redact-claude-artifacts.sh` catches a planted body, validates the irreversible apply, inspects every artifact, rejects a replanted body despite cleared database flags, and distinguishes OmniRoute's 8-hex compatibility checksum from a genuine 64-hex receipt SHA-256. Live verification inspects all ten summary artifacts.
- ISC-463: `bash tests/omniroute-claude.sh` and `bash tests/omniroute-opencode.sh` propagate simulated upstream failure; the Claude fixture proves the real client is never invoked as a direct fallback.
- ISC-464: final `bash scripts/verify-all.sh` exited zero at 2026-08-01 15:38 UTC and ended `Temperance Engine full verification passed` after running the expanded auth, redaction, launcher, dispatch, lifecycle, CLI Code, Hermes proposal, proxy streaming/transactional rollback, documentation, and repository suites.
- ISC-465: `bash tests/temperance-proxy-launchd.sh` passed transient-bootstrap retry, three-failure exact restoration, and injected mid-copy rollback. The live first promotion exposed bootstrap error 5, recovered the previous proxy agent, then the hardened promotion completed with the proxy healthy on `127.0.0.1:20129`; OmniRoute remained PID 17553 on `127.0.0.1:20128`, Quick Tunnel remained stopped, and Hermes state remained absent.
- ISC-374..ISC-376: `scripts/omniroute-codex-preview.sh` authenticated OmniRoute's native `setup-codex --dry-run`, isolated it below a mode-700 receipt directory, validated 11 matching profiles, wrote zero files, preserved the governed Codex hash exactly, and found no plaintext key. `bash tests/omniroute-codex-preview.sh` passed its leak, broken-dry-run, and non-loopback negative controls.
- ISC-379: `scripts/omniroute-hermes-preview.sh` called the management-authenticated native endpoint with `preview:true`, `keyId:null`, and no `apiKey`; the mode-600 proposal contains five `YOUR_OMNIROUTE_API_KEY_HERE` placeholders for `temperance-coding`, `te-build`, `te-free-burst`, `te-reason`, and `te-plan`. It invoked no Apply path and restored the initially absent `~/.hermes` directory state. `bash tests/omniroute-hermes-preview.sh` passed ten positive/negative controls.
- ISC-381: the LaunchAgent now carries `OMNIROUTE_MCP_ENFORCE_SCOPES=true`; authenticated live `/api/mcp/status` returned `scopesEnforced:true`, `enabled:false`, `online:false`, and `transport:"stdio"` before any client registration. The gateway remained HTTP 200 on `127.0.0.1:20128`; A2A remained disabled with zero tasks; Cloudflare remained stopped.
- ISC-382: remains honestly open. The six-skill card is public to both anonymous and invalid-Bearer reads, and the disabled `/a2a` handler has no governed scoped-key/session boundary. No A2A task or client was created.
- ISC-58 and ISC-466: `bun test package/router/routing-policy.test.ts` passed 17 tests and 61 assertions, including stale-open exclusion before cooldown and bounded half-open recovery after cooldown. `bash tests/routing-policy.sh` also passed per-host mode-file precedence, invalid-file shadow fallback, explicit off override, and stale-circuit reasons.
- ISC-467 and ISC-469: `bash tests/temperance-routing-policy.sh` passed status, promotion, deterministic replay, mode-file permissions, stale-open exclusion, exact rollback, drift rejection, originally absent restoration, unhealthy denial, and explicit off precedence. Enforce mode claims half-open probe leases by default; previews may explicitly set `TEMPERANCE_ROUTING_CLAIM_PROBES=0`.
- ISC-468: the first live controller promotion refused health `0.757` and wrote no mode file. A bounded read-only Spark canary then succeeded once through OmniRoute with provider `codex`, exact model `gpt-5.3-codex-spark`, zero fallback, and zero Sol use; health became `0.806`. Promotion receipt `~/.temperance_engine/receipts/routing-policy/routing-policy-promote.20260801T155354Z-17317.json` records plan `rp_8b03165f9cd21ee3`, selected `omniroute/temperance-coding`, applied mode SHA-256 `3875c1bdb05e4cbf9e7072e2fcd76699ddd1fab8455c53a4007dbaca2a2920be`, and exact rollback. The canonical proxy transaction completed healthy on loopback without restarting OmniRoute.
- ISC-382 source audit: the installed native `/a2a` handler conditionally checks only `process.env.OMNIROUTE_API_KEY`; OmniRoute synthesizes that ambient key with `manage` scope; the public card has no denial; `/api/a2a/tasks` list, item read, status, and cancellation handlers lack the same guard; and the shipped CLI posts `tasks.create` to a route whose installed server export is GET-only. A2A remained disabled with zero tasks and no secret or launcher mutation.
- Full-gate reconciliation: the first `bash scripts/verify-all.sh` correctly exposed that `tests/router-hardening.sh` inherited the live host's newly promoted mode and production observations. The suite now freezes `shadow` with an isolated temporary state directory, `bash tests/router-hardening.sh` passes, and the second complete verifier exits zero with `Temperance Engine full verification passed`. The live host remains `enforce`; repository and installed router/policy bytes match; the mode file and promotion receipt are mode 600; OmniRoute and the proxy remain on `127.0.0.1:20128` and `127.0.0.1:20129`; Quick Tunnel has zero processes; A2A is unavailable; and local Hermes state remains absent.
- ISC-405: `scripts/omniroute-local-rollback-rehearsal.sh` joined the real pre-change plist backup, promoted plist, Codex zero-write receipt, and Hermes zero-state receipt. It reproduced baseline SHA-256 `266311f7…` and promoted SHA-256 `2948e3af…` byte-exact in both rollback and reapply directions without restarting or changing the live gateway.
- Two fresh governed non-Codex audits ran concurrently through exact `antigravity/claude-sonnet-5` and `gh/claude-sonnet-5` profiles with no tools, plan permission mode, no session persistence, USD 0.25 caps, private outputs, and zero Sol use. Hermes passed. The capability audit's broken-auth warning is accepted as the reason A2A remains disabled; its MCP caveat is recorded by labeling scope enforcement a dormant precondition rather than functional proof.
- ISC-470..ISC-473: `bun test tests/omniroute-cloudflare-readiness.test.ts` passed seven adversarial cases. The fake Wrangler log contains exactly `whoami` and `--json`; CLI output omits email, account ID/name, and token material. Full permission-label fixtures can set only `permissionClaimsPass:true`; `ready`, resource scope, and hostname-zone authority remain false, and fixture provenance cannot masquerade as live evidence. The real Wrangler readback exits 3 with live authentication, one account, connector-write label, missing hostname/DNS/Access/machine-identity labels, unobservable resource scope, and unverified zone authority.
- ISC-474..ISC-478: `bun test tests/omniroute-a2a-readiness.test.ts` passed seven adversarial cases. The installed 3.8.48 source digest is complete but its ambient manage principal, missing companion-route guards, ownerless tasks, unbounded skills, and CLI/server create mismatch keep `sourceIndicatorsPass:false`. Even a perfect source fixture plus matching mode-600 five-minute JSON can set only `receiptClaimsValid:true`; dataflow proof, receipt authenticity, source/live/technical readiness, authorization, and promotion remain false.
- ISC-479: the final `bash scripts/verify-all.sh` exited zero after the corrected claim-versus-proof gates and ended `Temperance Engine full verification passed`. OmniRoute remained on `127.0.0.1:20128`; no `cloudflared` process, A2A enablement, task, credential, tunnel, DNS record, Access object, EC2 mutation, Hermes mutation, or Sol-family dispatch occurred.
- Independent Cato re-audit: the first pass correctly blocked three P1 false-ready semantics involving unsigned A2A receipt claims, regex indicator overclaim, and unbound Cloudflare permission labels. After the repairs, the second pass returned PASS with no P0/P1, reproduced all permanently false readiness/authorization predicates, confirmed 14 focused tests and `git diff --check`, and found no secret leakage or mutation path.
- The widened worker authorization was exercised through exact `antigravity-claude-sonnet-5` and `gh-claude-sonnet-5` OmniRoute profiles. Both audits returned substantive results and matching HTTP-200, no-log gateway records from distinct provider families; retained request and response bodies were zero and Sol use was zero. The bounded Spark attempt was terminated after 629 seconds without a complete index and was not accepted as evidence.
- Post-deliverable Advisor conflict review withdrew its initial no-evidence finding after receiving exact probes, then required executable negative controls. Independent Cato re-audit returned PASS with no local P0/P1 and cleared its checksum concern against OmniRoute 3.8.48 source plus the separate receipt SHA-256.
- Remote verification remains honestly open: ISC-430..ISC-432 and ISC-446..ISC-449 require an approved hostname plus Cloudflare DNS Write, Access Apps/Policies Write, and Service Tokens Write or mTLS. No named tunnel, public route, Access app, service token, remote key, EC2 mutation, or Hermes mutation was created.
- ISC-480..ISC-483: `bun test package/router/signed-probe-receipt.test.ts` passes domain mutation in both directions, payload/signature tamper, wrong identity/audience/challenge/key and key type, unissued/consumed snapshots, strict expiry and 30-second future-skew boundaries, canonical-order parity, non-NFC/non-integer/prototype-key rejection, size/depth limits, duplicate raw keys, missing trust inputs, and current-promotion isolation. The implementation uses `node:crypto` Ed25519 over two fixed-width byte-length-prefixed frames and never accepts a signing key in either readiness CLI.
- ISC-484..ISC-486: the Cloudflare suite proves a valid signature plus exact account/zone/hostname/tunnel and GET-only paths can set only integrity/binding gates while resource scope, hostname-zone authority, and readiness stay false. The A2A suite proves a valid exact-instance receipt with complete safety claims cannot satisfy handler dataflow, source/live/technical readiness, authorization, or promotion; missing safety evidence is indeterminate and an insecure present handler remains closed.
- ISC-487..ISC-489: focused verification passes 38 tests and 178 assertions; all three TypeScript entrypoints bundle; `git diff --check` passes; an executable repository guard finds no replay-state consumer or signed-probe promotion call site. Fresh real preflights exit 3 with Cloudflare `ready:false` and A2A `promotionReady:false`; OmniRoute and the proxy remain on `127.0.0.1:20128` and `127.0.0.1:20129`, with zero `cloudflared` processes. The final canonical repository verifier ended `Temperance Engine full verification passed` after private-key/key-type rejection and canonical UTC timestamp hardening.
- ISC-490..ISC-490.7: the standalone controller issues exact-key 256-bit challenges, permits one winner across twelve concurrent consumers, serializes every writer with bounded kernel `flock`, makes consumption irreversible, and permits rollback only as a new issued-to-revoked generation. Owner-only descriptor-relative paths reject symlinks, hardlinks, broad modes, unsupported filesystems, and non-canonical raw traversal before mutation. Durable backup/prepared-receipt/temp/rename/directory/committed-receipt ordering uses checked APFS `F_FULLFSYNC`; injected pre/post rename, durability-error, SIGKILL, unrelated-close, concurrent-recovery, capacity, retention, and drift cases pass.
- ISC-490 verification: the focused controller plus verifier suite passes 31 tests and 158 assertions; the CLI bundles to Bun; `git diff --check` passes. Production-source guards admit mutators only in the controller and its CLI, find zero current promotion import or invocation, and keep every result, operation receipt, recovery result, and verifier snapshot readonly `authorizing:false`.
- ISC-490 governed review: exact OmniRoute models `antigravity/claude-sonnet-5` and `gh/claude-sonnet-5` independently returned PASS after the hardening recheck with no Sol model usage. Cato's first pass identified the raw traversal P1; after shared-boundary repair and three adversarial traversal spellings, its recheck returned PASS with no P0/P1 and cleared ISC-490 through ISC-490.7.
- ISC-490 final invariants: the canonical full repository verifier exits zero and ends `Temperance Engine full verification passed` on the checked 477/497 ISA. Fresh read-only preflights still exit 3 with Cloudflare `ready:false` from live authenticated Wrangler evidence and A2A `sourceReady:false`, `technicalReady:false`, `promotionAuthorized:false`, and `promotionReady:false`. OmniRoute and the Temperance proxy remain loopback-only on `127.0.0.1:20128` and `127.0.0.1:20129`; `pgrep -x cloudflared` finds zero processes. No provider, service, tunnel, DNS, Access, EC2, Hermes, routing-promotion, or Sol-family state changed.
- Independent Cato audit: PASS with no P0/P1. It reproduced the hard-false Cloudflare and A2A readiness/authorization semantics, Ed25519 and bounded-canonical-input contract, public-trust-only loader, snapshot-only replay limitation, current promotion isolation, exit-3 live state, and 37-test pre-hardening baseline. Its two P2 advisories were then closed by explicit private-PEM/private-key/wrong-key-type rejection and canonical millisecond-UTC timestamp validation, raising the focused suite to 38 tests and 178 assertions before the final full-gate pass.
- 2026-08-02 external-boundary audit: read-only SSM proved `hermes-runner-01` OmniRoute 3.8.48 healthy with five configured and five active service connections, while the service-side combo list remains empty and the governed OpenCode surface still exposes only five non-S aliases. Empty offline CLI provider lists were traced to per-user SQLite context divergence and are not treated as service inventory evidence. `TEMPERANCE_AUTO_READY` remains `0`; ISC-333..ISC-336 stay open.
- 2026-08-02 fail-closed repair: `automaticReadiness()` now accepts only explicit `1`, `true`, `yes`, or `on`; absent, empty, false-like, and unrecognized values deny Algorithm/S. The 31-test proxy suite covers the complete affirmative/denial matrix, and the EC2 runbook documents the code-level default so a missing systemd environment entry cannot silently promote S.
- 2026-08-02 package audit: official npm OmniRoute 3.8.49 was unpacked without installation. Six inspected source-level A2A CLI, schema, MCP-tool, task, and skill-control files are byte-identical to 3.8.48; `costAnalysis.ts` delegates numeric parsing to a shared helper. The compiled readiness digest changes, so route bundles are not claimed identical, but both versions return the same fail-closed safety blockers. Registry integrity, digests, and file hashes are recorded in `docs/audits/omniroute-3.8.49-a2a-comparison.json`; no upgrade occurred.
- 2026-08-02 governed dispatch: GitHub Sonnet 5 returned two substantive, no-tool, plan-only audits with private mode-600 output, bounded spend, no persistence, and gateway `GITHUB | claude-sonnet-5 | complete` attribution. The parallel Antigravity result was rejected as exact-model evidence because gateway logs showed Sonnet 5 failures and a Sonnet 4.6 fallback despite client success. Zero Sol-family model was dispatched.
- 2026-08-02 Cato verification: the first pass correctly found that proxy tests could append mocked receipts to the operational log and that buffered attribution documentation overclaimed nullable headers. The suite now assigns every test a unique private temporary `TEMPERANCE_PROXY_LOG`, restores the caller environment, and leaves the operational log SHA-256 byte-identical across 31 tests and 108 assertions. The guide distinguishes nullable buffered attribution from trailer-required streaming attribution. Cato's re-audit returned PASS with no P0/P1.
- 2026-08-02 receipt repair: a mode-600 backup at `~/.temperance_engine/backups/openai-proxy-test-contamination/openai-proxy.before-test-cleanup.20260801T191247Z.jsonl` preserves the pre-cleanup log. Exactly 1,000 rows carrying the unambiguous synthetic `rp_test`/`tc_test` markers were removed; 375 parseable operational rows remained immediately after cleanup, and subsequent canonical live probes append only valid operational receipts. Zero synthetic markers remain. The first mechanical rewrite was restored from that backup before the verified filtered replacement, so no partially encoded log was retained.
- 2026-08-02 post-advisor hardening: the durable 3.8.49 comparison artifact records registry integrity plus installed/candidate source and compiled-readiness hashes, while preserving the finding that both versions expose the same blockers. The exact-model-mismatched Antigravity artifact is quarantined as `REJECTED-antigravity-ec2-attribution-mismatch.json`; only gateway-attributed GitHub Sonnet 5 outputs count as accepted dispatch evidence.
- 2026-08-02 receipt-isolation proof: repository search finds the operational consumer reading the exact state-log path rather than broad backup globs; the protected backup lives outside that path. Two consecutive focused proxy-suite runs passed 31 tests and 108 assertions with the operational log SHA-256 unchanged, and a new regression proves missing buffered provider/model headers remain `null` rather than being invented.
- 2026-08-02 final verification: the canonical `bash scripts/verify-all.sh` rerun exited zero and ended `Temperance Engine full verification passed`. Fresh local auth verification passed; OmniRoute and the proxy remain loopback-only on ports 20128 and 20129; no `cloudflared` process exists. Fresh Cloudflare and A2A preflights correctly exit 3 with `ready:false` and `promotionReady:false`. Re-read reconciliation leaves 477/497 checked and exactly 20 external-authority or upstream-safety criteria open; the persistent goal is not falsely completed.
- 2026-08-02 compression-boundary completion: after the learn-phase ISA reconciliation, the canonical `bash scripts/verify-all.sh` rerun again exited zero and ended `Temperance Engine full verification passed`; `git diff --check`, Mac profile validation, and mandatory client-auth verification pass. Fresh Cloudflare and A2A preflights still exit 3, `cloudflared` remains stopped, and relay health remains `ok:true` with explicit `automatic_ready:true`. The iteration closes at 481/501 with exactly 20 external-authority or upstream-safety criteria open; the persistent promotion goal remains active.
- ISC-529: structural probe — generic CLI source excludes the production adapter import; module construction performs zero file or network work.
- ISC-530: adversarial fixture — canonical owner-only credential reads reject broad modes, symlinks, and hardlinks; no environment, argv, or dashboard-session fallback exists.
- ISC-531: transport fixture — injected requests are timeout-bounded, redirect-denying, JSON/content-type checked, origin-bound, and failure serialization is redacted.
- ISC-532: ordering and durability probe — the injected transport observes a durable `prepared` request-hash record before invocation; APFS full-sync writes precede sanitized refs and secret buffers are cleared.
- ISC-533: recovery fixture — ambiguous calls become `manual_orphan`; symlinked receipts, hardlinked or malformed operation records, and foreign same-name adoption fail closed.
- ISC-534: real ledger fixture — concurrent approval consumption has one winner and the APFS challenge-ledger port returns `authorizing:false` after exact binding checks.
- ISC-535: focused test — `14 pass`, `0 fail`, and `54 expect() calls`; signed challenge-ledger verification separately reports `13 pass`, `0 fail`.
- ISC-536: canonical and independent verification — `Temperance Engine full verification passed`; final Cato re-audit returned `VERDICT pass` with `CRITICAL/P0/P1: none`.
- 2026-08-02 production-boundary invariants: mandatory client-auth verification passed; OmniRoute and the proxy listen only on `127.0.0.1:20128` and `127.0.0.1:20129`; proxy health returned `ok:true`; `pgrep -x cloudflared` found no process. Cloudflare readiness deliberately exits 3 with `ready:false`: authentication is live, while hostname, DNS/Access scope, machine identity, signed probe, resource scope, and hostname-zone authority remain absent. No Cloudflare, Hermes, EC2, provider, routing-promotion, or Sol-family state changed.
- ISC-564: source guards plus poisoned `security` and `curl` fixtures prove the v3 compiler has no Keychain, dashboard-login, cookie/CSRF, HTTP, session, or native-endpoint execution seam; the live receipt records `collectionTransport:"none"` and `adminCredentialAccessed:false`.
- ISC-565: `bun test package/router/omniroute-native-control-plane.test.ts` passes 9 tests and 54 assertions. The local read-only transaction now projects only five fixed governed-combo presence booleans, and the live snapshot proves all five true with OmniRoute/runtime 3.8.48, database/runtime continuity, no mutation methods, no management contact, and absent Hermes state.
- ISC-566: the 31-check shell suite rejects existing, empty, symlinked, and concurrently created Hermes paths. The compiler contains no Hermes `mkdir`, `rmdir`, `rm`, rename, or cleanup path; concurrent foreign state remains byte-readable after refusal.
- ISC-567..ISC-568: live receipt `~/.temperance_engine/receipts/omniroute-hermes-preview/20260802T042309Z-52391/receipt.json` binds the exact five-role selection, official custom loopback endpoint, five environment references, proposal SHA-256, and exactly two mode-600 durable artifacts while persisting neither snapshot nor authentication/native response material.
- ISC-569: `bash tests/omniroute-hermes-preview.sh` passes all 31 positive/negative checks, including every missing combo, stale/malformed snapshot, version/runtime/mutation/management drift, legacy cookie, and unsafe receipt-root control without network or destructive cleanup.
- ISC-570: the exact historical `~/.temperance_engine/receipts/omniroute-hermes-preview/20260801T144653Z-7140/session.cookie` was validated as a mode-600, single-link, user-owned regular file and removed without content access. Repeated recursive scans return zero; v3 compilation and rollback both refuse any reintroduced basename, and the receipt records `contentRead:false` plus zero before/after matches.
- ISC-571: exact GitHub Sonnet 5 and no-think Antigravity Sonnet 5 returned substantive bounded no-tool reviews with gateway HTTP-200 attribution from distinct non-Codex families and zero Sol use. Advisor pre/post attempts returned no usable verdict and were not counted as approval. Independent Cato first rejected the memory-only HTTP design, then returned `PASS — no P0/P1 blockers` after the zero-auth revision. Focused Hermes, rollback, native integration, documentation continuity, `git diff --check`, and the canonical `bash scripts/verify-all.sh` all exit zero.
- 2026-08-02 Hermes v3 final invariants: live rollback receipt `~/.temperance_engine/receipts/omniroute-local-rollback/20260802T042713Z-73598/receipt.json` binds the exact proposal digest and proves byte-exact LaunchAgent rollback/reapply without restarting OmniRoute. The local Hermes path and every historical session-cookie path remain absent; OmniRoute and the proxy remain loopback-only; `cloudflared` remains stopped. No Apply, EC2, Cloudflare, MCP, A2A, provider, routing-promotion, or Sol-family mutation occurred. Reread closes this bounded iteration at 550/578 with 28 external or separately gated criteria open; the persistent integration goal remains active.
- 2026-08-04 vault relocation build-out, Tasks 2A/3/4/6/7/8/9: this entry records direct construction plus executable verification — TDD with a real red-before-green cycle for nearly every new function, plus real read-only CLI runs against the actual vault — not the Advisor/Cato governed-review ritual used elsewhere in this ledger; no Advisor or Cato pass occurred today. `package/relocation/project-path-consumers.ts` (Task 2A, 35 tests) bounds the old-path consumer audit to checked-in text via `git ls-files` and an explicit caller-supplied host-config-surface file list, proven with a fixture that content outside those two bounds never surfaces. `project-packet-schema.ts` + `project-packet.ts` (Task 3, 52 tests) close the `.project/project.yaml` schema and validate the already-committed `thoughtseed-brand-atlas` packet by reading it straight from its Git HEAD, not a copy. `project-registry.ts` + `project-capsule.ts` (Task 4, 42 tests) implement the append-only Thoughtseed reconciliation log and the six-file capsule renderer; every I/O function was exercised only against temp fixture directories, never `thoughtseed-labs` or `_System/10865xseed`. `project-relocation-transaction.ts` (Task 6, 22 tests) is the receipt-bound rename core — `performGuardedRename()`'s device/inode revalidation immediately before and after the POSIX rename catches both mandatory attack scenarios (source-replacement, parent/path-swap) in fixture tests. `project-pickup.ts` (Task 7, 7 tests) is a pure resolver proven bounded (an out-of-band fixture file never influences its output, digest included) and regression-tested directly against the real `thoughtseed-brand-atlas` packet, read-only. `project-relocation-rollback.ts` (Task 8, 21 tests) reuses `performGuardedRename()` in reverse for the rename-back and proved every fail-closed gate (capsule drift, missing receipt, destination drift) removes zero bytes. Task 9 added `project-relocation-source-guards.test.ts` (9 tests, comments stripped before scanning so the guard's own safety-documentation prose can't trip its own checks) proving by direct inspection of production source — not documentation claims — that every Git subcommand invoked across the relocation subsystem is read-only (`ls-files`, `grep`, `status`, `rev-parse`, `branch`, `remote`, `show`, `worktree`) and that no file references `homedir()`, Paseo, `.ssh/`, `id_rsa`, `credentials.json`, embedded PEM keys, or session transcripts; `tests/vault-project-relocation.test.ts` (9 tests) exercises the CLI's `inventory` and `plan --dry-run` commands for real against the actual vault (both are contractually read-only) plus argument-validation failure modes that never touch the filesystem; and `docs/vault-project-relocation.md` consolidates the whole subsystem into one reference document. Total: 203 tests across 11 files, all passing, wired into `scripts/verify-all.sh` (the broader non-relocation suite was not re-run today). 64 previously-open relocation ISC criteria (ISC-613/614/616/618/621/624-627/629/637/654-656/659-663/666-669/671-678/680-681/685-686/689-690/692/697-698/700-705/707-708/711-713/727-729/733/737-741/743/745/747/749) are now checked because the underlying code exists and is directly, currently verifiable — not because a live apply happened. Deliberately left open: every criterion that names a live apply, a live fresh-client canary, or the Thoughtseed "canonical main project-management record" (ISC-638-651, 679/682-684/687-688 depending on exact HANDOFF.md field, 693-696, 699, 706, 709-710, 715/717/718-726 partially, 732/734-736/742/744/746/748, 752-753) — those require either the not-yet-built end-to-end transaction assembly, a real human at a real client, or a file format that has no real example to build against yet. Two interpretive deviations from the abstract spec, made against the one real committed packet rather than invented: `resolvePickupBootstrap()` sources `objective` from `PROJECT.md`'s "Purpose and boundaries" paragraph rather than `.project/HANDOFF.md` (the real file has no HANDOFF.md objective field), and `blocker` defaults to the literal string `"none"` when no "## Blockers" heading exists (the real file has none today). No repository moved; verified after each task that `thoughtseed-brand-atlas` remained at its original path with a clean Git status and that `/Volumes/madara/2026/Projects/` remained empty.
- 2026-08-05 correction: ISC-686 was checked in the previous entry on the reasoning that `resolvePickupBootstrap()`'s "none" default for an absent `## Blockers` section satisfied "records blockers or an explicit none value." On review, both ISC-679's and ISC-686's own criteria-table rows (`handoff shape`, verified by `handoff fixture`) require the *file* to record the value, not the resolver to infer it on read. A resolver-side default when a section is silently missing is not the same claim as the packet author explicitly writing "None." — the two are indistinguishable in the resolver's current output, which is itself the actual gap: a future packet that simply omits Blockers by oversight would be indistinguishable from one that explicitly verified there are none. ISC-686 is uncorrected back to unchecked. `objective` sourced from `PROJECT.md` remains a deliberate, reviewed choice (ISC-679 was already correctly left unchecked) — distinct from `blocker`'s issue, since `objective` is not claimed to satisfy a HANDOFF.md-shape criterion at all.
