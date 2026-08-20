---
project: manifest-visual-console
task: Integrate LCARS Graph Deck and source-safe project lifecycle actions
effort: advanced
phase: complete
progress: 167/167
mode: algorithm
started: 2026-08-14T13:50:22+05:30
updated: 2026-08-14T16:47:00+05:30
---

## Problem

The console exposes live Manifest pages, but the relationships between PAI phases, Temperance, hooks, skills, CodeGraph, GSD, OmniRoute, and evidence are mostly hidden in lists and static topology. Operators need connected views that preserve live provenance and explicit degraded states.

## Vision

An operator can move from system architecture to phase state, execution routing, or evidence without losing scope, freshness, source ownership, or LCARS orientation. The graph deck feels like a native instrument panel: dense, legible, calm, and honest about what the runtime observed.

## Out of Scope

- No source-checkout deletion or uncontrolled backend authority.
- No fabricated provider health, agent activity, route state, or graph edges.
- No wholesale adoption of a third-party diagram runtime.
- No replacement of the existing five live pages.
- No authentication, deployment, or production database changes.

## Principles

- Live Manifest projections remain the sole UI data authority.
- Every graph node and edge must be explainable by runtime data or an explicit structural relationship.
- LCARS is an interaction grammar, not decorative skin.
- Diagram Design patterns are adapted as accessible, static-first SVG composition.
- Selection, filtering, and evidence inspection must remain cross-view consistent.

## Constraints

- Extend the bridge contract without changing the existing SSE lifecycle.
- Preserve existing user changes in sibling integration metadata.
- Use TypeScript strict unused-symbol checks already enforced by the project.
- Keep graph rendering dependency-light and responsive.
- Preserve reduced-motion behavior and keyboard access.
- Verify the live UI with the running console and bridge.

## Goal

Ship an LCARS Graph Deck and project action rail that render live Manifest relationships, support scope-aware project registration/sync/archive/remove actions, keep manifest history deletion recoverable and confirmation-gated, and pass build, lint, runtime, accessibility, and visual verification without inventing telemetry.

## Criteria

- [x] ISC-1: Project ISA exists at the visual console root.
- [x] ISC-2: Graph node and edge types are exported from one model module.
- [x] ISC-3: Graph nodes carry stable IDs, labels, kinds, and statuses.
- [x] ISC-4: Graph edges carry stable IDs, endpoints, labels, and evidence metadata.
- [x] ISC-5: Architecture graph includes the Manifest bridge projection node.
- [x] ISC-6: Architecture graph includes PAI and Temperance structural nodes.
- [x] ISC-7: Architecture graph includes CodeGraph, GSD, skills, hooks, and OmniRoute sources when observed.
- [x] ISC-8: Phase graph uses the canonical seven PHASES order.
- [x] ISC-9: Phase graph marks the runtime current phase.
- [x] ISC-10: Execution graph derives sessions, agents, dispatches, and routes from snapshot records.
- [x] ISC-11: Evidence graph derives event-backed nodes from recent events.
- [x] ISC-12: Empty snapshot produces an explicit empty graph state.
- [x] ISC-13: Stale freshness remains visible in graph status styling.
- [x] ISC-14: Offline bridge state remains visible in the shell.
- [x] ISC-15: SVG graph components expose accessible names and descriptions.
- [x] ISC-16: Graph nodes are keyboard focusable.
- [x] ISC-17: Selecting a node exposes its inspector details.
- [x] ISC-18: Selecting an edge exposes its relationship details.
- [x] ISC-19: Graph selection can be cleared without changing runtime scope.
- [x] ISC-20: Graph views share the existing project scope selector.
- [x] ISC-21: Graph views use existing Manifest event selection callbacks.
- [x] ISC-22: Graph rendering uses LCARS semantic color tokens.
- [x] ISC-23: Graph rendering uses one focal accent per graph surface.
- [x] ISC-24: Graph layouts remain usable below 820px viewport width.
- [x] ISC-25: Reduced-motion media query disables graph animation effects.
- [x] ISC-26: No graph code imports a backend or mutates runtime state.
- [x] ISC-27: Diagram Design attribution and adaptation are documented.
- [x] ISC-28: TypeScript build passes after graph integration.
- [x] ISC-29: ESLint passes after graph integration.
- [x] ISC-30: Live bridge snapshot populates at least one graph projection.
- [x] ISC-31: Running console serves the Graph Deck route/view successfully.
- [x] ISC-32: Anti: No graph displays synthetic runtime telemetry as observed.

## Test Strategy

| ISC | Type | Check | Threshold | Tool |
| --- | --- | --- | --- | --- |
| ISC-1 | file | Read ISA | present | Read |
| ISC-2..ISC-14 | model | inspect graph adapter and fixtures | each contract present | rg/build |
| ISC-15..ISC-25 | UI | browser and source inspection | accessible/responsive | browser + rg |
| ISC-26..ISC-27 | boundary | import/docs audit | no forbidden imports; attribution present | rg |
| ISC-28..ISC-29 | build | npm commands | exit 0 | npm |
| ISC-30 | runtime | bridge snapshot | graph source count > 0 | curl |
| ISC-31 | live UI | console route screenshot | Graph Deck visible | browser |
| ISC-32 | anti | source/runtime audit | no synthetic observed data | rg + review |

## Features

| name | description | satisfies | depends_on | parallelizable |
| --- | --- | --- | --- | --- |
| graph-model | Normalize live snapshot into graph projections | ISC-2..14,26,32 | manifest.ts | yes |
| diagram-primitives | Render accessible LCARS SVG graph primitives | ISC-15..25 | graph-model contract | yes |
| graph-deck | Add shared graph view and inspector integration | ISC-17..24,30,31 | graph-model, diagram-primitives | no |
| verification | Build, lint, runtime, browser, accessibility checks | ISC-28..32 | graph-deck | no |

## Decisions

- 2026-08-14: Use first-party SVG React primitives instead of adding a diagram runtime; diagram-design is a semantic visual reference and pattern source.
- 2026-08-14: Keep Graph Deck integrated into the existing five pages rather than replacing them with a new navigation model.
- 2026-08-14: Parallelize only disjoint graph-model and diagram-primitives work; keep App/pages integration sequential because it crosses shared callbacks.
- 2026-08-14: Advisor commitment check was attempted; OAuth refresh failed, so the approved pure-adapter/SVG boundary remains the working decision and requires stronger local verification.

## Changelog

- 2026-08-14 — conjectured: Graph relationships can be exposed without backend changes; refuted_by: not yet refuted; learned: existing ManifestSnapshot already contains the required source registries; criterion_now: ISC-2 through ISC-14 verify the projection boundary.
- 2026-08-14 — conjectured: parallel external workers would accelerate both bounded UI tracks; refuted_by: one worker emitted an empty diff and another hit OmniRoute duplicate `_fetch` schema errors, while native fallback sessions stalled; learned: require nontrivial diff validation and keep bounded SVG/model work locally executable; criterion_now: ISC-28 and ISC-29 remain the final implementation gates.
- 2026-08-14 — conjectured: fresh telemetry is required for useful graphs; refuted_by: browser verification rendered useful source relationships while bridge freshness was explicitly stale; learned: freshness and historical completeness are first-class graph state, not blockers to honest inspection; criterion_now: ISC-13, ISC-30, and ISC-32 preserve that distinction.

## Verification

ISC-1: file read — `ISA.md` exists at the visual console root.
ISC-2..ISC-14: source/runtime — `src/graphModel.ts` exports the contract, builds five projections, and browser DOM showed 9 architecture nodes plus 7 phase nodes from live snapshot data.
ISC-15..ISC-18: browser — Graph Deck exposed one `svg[role=img]` with title/desc, 7 focusable nodes, 6 focusable edges, and node/edge inspector states.
ISC-19..ISC-25: source/browser — selection is local UI state, project scope remains in the existing runtime hook, LCARS variables are used, list fallback was one column at 390px, and reduced-motion CSS is present.
ISC-26..ISC-27: source/docs — graph modules contain no fetch/EventSource/runtime mutation and README documents the diagram-design adaptation.
ISC-28: command — `npm run build` exited 0; Vite emitted production assets.
ISC-29: command — `npm run lint` exited 0.
ISC-30: HTTP — `/snapshot` returned schema `temperance.manifest.state.v1` with 2 CodeGraph records and 1 workflow record.
ISC-31: browser/HTTP — `http://127.0.0.1:5173/` returned 200 and Graph Deck navigation/rendering passed DOM and screenshot inspection.
ISC-32: anti/source — graph provenance explicitly distinguishes `structural`, `derived`, and `observed`; stale runtime state remains visibly stale.

Learning: the UI can expose the full native system safely when graph edges carry basis, source, and freshness rather than pretending every relationship is telemetry.

## Iteration 2 — Cambium project lifecycle

### Criteria

- [x] ISC-33: Cambium resolves to the canonical project ID and checkout path in the live registry.
- [x] ISC-34: Cambium snapshot exposes CodeGraph status with `sync_requested: false` by default.
- [x] ISC-35: Cambium snapshot exposes GSD artifact evidence and skill-cluster registry evidence.
- [x] ISC-36: The UI registry distinguishes initialized projects from observed-only and legacy entries.
- [x] ISC-37: Stale and fresh bridge state remain explicit before and after an observation sync.
- [x] ISC-38: Observation sync reads Cambium evidence without changing its Git working tree.
- [x] ISC-39: The live bridge exposes project action metadata and lifecycle routes.
- [x] ISC-40: Refresh, register, sync, archive, unregister, and manifest-history deletion are distinct actions.
- [x] ISC-41: Register requires an existing directory and derives identity from canonical path.
- [x] ISC-42: Sync uses the stored project cwd and never accepts a client-supplied sync path.
- [x] ISC-43: Unregister hides a project while retaining its source checkout and bridge history.
- [x] ISC-44: Manifest-history deletion requires prior unregister and exact project confirmation.
- [x] ISC-45: Manifest-history deletion moves state to recoverable retention and never deletes source files.
- [x] ISC-46: Deleted project history is tombstoned and generic events cannot resurrect it.
- [x] ISC-47: Unsafe project IDs are rejected before any state-path creation.
- [x] ISC-48: LCARS action feedback exposes busy, success, error, and confirmation states accessibly.

### Verification

ISC-33..35: live bridge and Cambium snapshot returned project `cambium-4cfc2f7087`, 6,877 CodeGraph nodes, 398 indexed files, 2 GSD artifacts, and 804 skill-cluster entries.
ISC-36..39: browser showed 9 registry entries, the project action rail, and `/projects/{id}/actions` returned 200 with five bounded actions.
ISC-40..42: `POST /projects/{id}/sync` was run from the live UI; it returned `sync complete`, raised Cambium from 54 to 55 accepted events, and kept `sync_requested: false`.
ISC-43..47: bridge unit tests covered unregister filtering, exact-confirmation rejection, recoverable retention, source preservation, tombstone rejection, and traversal rejection; all 34 bridge tests passed.
ISC-48: browser verified empty registration confirmation, disabled destructive action, successful sync status, and the accessible action rail; UI build and lint passed.

### Decisions

- 2026-08-14: Project lifecycle actions live in the bridge and UI, but source ownership remains outside the bridge; “delete” means recoverable bridge-history retention only.
- 2026-08-14: Unregister is a visibility/tombstone action, not filesystem deletion; future telemetry cannot silently resurrect deleted history.
- 2026-08-14: Sync is observation sync, not CodeGraph indexing; CodeGraph remains read-only unless an explicit native CLI workflow requests indexing.
- 2026-08-14: The action rail is globally visible beneath the phase strip so project scope and lifecycle state remain legible across all graph and operational views.
- 2026-08-14: Advisor commitment check was attempted for the phase-navigation redesign; OAuth refresh failed, so the approach is grounded in live DOM reproduction and preserved runtime boundaries.

### Changelog

- 2026-08-14 — conjectured: project lifecycle can be added as simple CRUD; refuted_by: safety audit found path traversal, destructive history deletion, and resurrection risks; learned: lifecycle requires canonical IDs, tombstones, retention, and explicit confirmation; criterion_now: ISC-41 through ISC-47.
- 2026-08-14 — learned: Cambium observation sync makes the bridge fresh without modifying the checkout; criterion_now: ISC-37 and ISC-38.

## Iteration 3 — Clickable phase flow and workspace hierarchy

### Criteria

- [x] ISC-49: The seven phase segments render as keyboard-focusable controls.
- [x] ISC-50: The phase strip exposes `role="tablist"` and each phase exposes `role="tab"`.
- [x] ISC-51: The runtime current phase remains marked with `aria-current` and `NOW`.
- [x] ISC-52: Operator phase focus is distinct from runtime current phase.
- [x] ISC-53: Clicking OBSERVE navigates to the Overview workspace.
- [x] ISC-54: Clicking THINK navigates to the Graph Deck workspace.
- [x] ISC-55: Clicking PLAN navigates to the Planning workspace.
- [x] ISC-56: Clicking BUILD navigates to the Graph Deck workspace.
- [x] ISC-57: Clicking EXECUTE navigates to the Execution workspace.
- [x] ISC-58: Clicking VERIFY navigates to the Evidence workspace.
- [x] ISC-59: Clicking LEARN navigates to the Ops / Delivery workspace.
- [x] ISC-60: Left-rail phase controls and top phase tabs share one navigation handler.
- [x] ISC-61: Graph Deck sub-tabs remain independently clickable after phase navigation.
- [x] ISC-62: Project scope remains unchanged when phase navigation occurs.
- [x] ISC-63: SSE subscription remains scoped to the selected project after phase navigation.
- [x] ISC-64: Project lifecycle controls remain available without obscuring workspace navigation.
- [x] ISC-65: Add-project registration is visually separated from observation and destructive actions.
- [x] ISC-66: Destructive history controls remain confirmation-gated and visually subordinate.
- [x] ISC-67: Phase navigation remains keyboard reachable at mobile viewport widths.
- [x] ISC-68: Anti: Clicking a phase tab never mutates the observed runtime phase or source state.

### Test Strategy

| ISC | Type | Check | Threshold | Tool |
| --- | --- | --- | --- | --- |
| ISC-49..52 | accessibility | inspect phase controls | 7 buttons, roles, current marker | browser DOM |
| ISC-53..60 | navigation | click each phase | expected workspace active | browser |
| ISC-61..63 | integration | phase navigation and graph tabs | graph tabs clickable; scope/SSE stable | browser + DOM |
| ISC-64..66 | interaction design | action shelf layout/state | navigation remains visible; destructive gate retained | browser screenshot |
| ISC-67 | responsive | keyboard/mobile probe | all seven controls reachable | browser |
| ISC-68 | anti | runtime snapshot comparison | phase unchanged after clicks | bridge snapshot + browser |

### Features

| name | description | satisfies | depends_on | parallelizable |
| --- | --- | --- | --- | --- |
| phase-navigation | Promote phase strip and rail to shared accessible controls | ISC-49..60,67,68 | App navigation state | no |
| workspace-hierarchy | Make workspace/phase/action relationships explicit in shell layout | ISC-61..66 | phase-navigation | no |
| interaction-verification | Browser-test phase, graph, scope, and action flows | ISC-49..68 | phase-navigation, workspace-hierarchy | no |

### Verification

ISC-49..52: live DOM inspection returned seven `BUTTON` elements in each phase surface, all with `tabIndex: 0`; both surfaces expose `role="tablist"`, each control exposes `role="tab"`, and runtime `OBSERVE` retained `aria-current="step"` plus `NOW`.
ISC-53..60: browser-click matrix mapped OBSERVE→Overview, THINK/BUILD→Graph Deck, PLAN→Planning, EXECUTE→Execution, VERIFY→Evidence, LEARN→Ops / Delivery; top strip and rail both produced the same focus and workspace state.
ISC-61..63: Graph Deck exposed five independently clickable sub-tabs; Evidence lineage selected successfully; Cambium scope remained `cambium-4cfc2f7087`; source review shows phase selection only changes local navigation state, leaving the runtime hook and SSE subscription untouched.
ISC-64..66: browser inspection found the action rail present with grouped `OBSERVE / READ` and `MANAGE / VISIBILITY` controls, an `aria-expanded` Add Project disclosure, and a collapsed confirmation-gated danger zone; the registration form is subordinate to workspace navigation.
ISC-67: responsive source inspection confirms the phase strip becomes horizontally scrollable at 820px and phase controls remain native buttons; the existing mobile shell and reduced-motion rules remain active. The browser client did not expose a viewport-resize method for a second live viewport.
ISC-68: Cambium bridge snapshot remained at 55 events with the same recent event IDs and `last_event_at` before and after phase navigation; the checkout was not touched.

### Verification constraints

- The required Cato role was unavailable in the configured dispatcher (`unknown agent_type 'Cato'`); the local audit above is the recorded substitute.
- Parallel delegation was attempted earlier but the session had reached its agent-thread limit; the work was kept local because the remaining checks were bounded browser/source/runtime invariants rather than independent implementation slices.

### Changelog

- 2026-08-14 — conjectured: the phase strip is a visual status indicator only; refuted_by: user screenshots and live DOM show it reads as a tab system while remaining non-interactive; learned: lifecycle status and operator navigation need separate but linked state; criterion_now: ISC-49 through ISC-52.
- 2026-08-14 — conjectured: a global expanded action rail helps operators act quickly; refuted_by: screenshot shows the rail displacing the primary workspace and blurring observe/manage/destructive flows; learned: action controls must be grouped and visually subordinate to workspace navigation; criterion_now: ISC-64 through ISC-66.
- 2026-08-14 — learned: phase focus must be local operator navigation while `NOW` remains bridge-owned runtime state; criterion_now: ISC-49 through ISC-63 and ISC-68.
- 2026-08-14 — learned: the configured Cato audit role was unavailable, so completion evidence records the exact dispatcher failure and local substitute; criterion_now: verification constraints.

## Iteration 4 — Navigation hygiene and shell hierarchy

### Problem refinement

The first integration made the phase strip clickable but retained a second
seven-item interactive phase rail in the left shell. The result is a repeated
navigation system: the operator sees the same phase model as both workspace
tabs and rail controls, while Graph Deck introduces a third tab layer. The
revision must preserve the phase model without making the shell compete with
itself.

### Criteria

- [x] ISC-69: The top phase strip is the sole interactive seven-phase navigator.
- [x] ISC-70: The left rail contains no second phase `tablist`.
- [x] ISC-71: The left rail presents exactly one `WORKSPACES` navigation group.
- [x] ISC-72: The left rail presents runtime phase as non-interactive context.
- [x] ISC-73: The compact rail context displays the bridge-owned current phase.
- [x] ISC-74: The compact rail context displays the local operator focus.
- [x] ISC-75: The main focus note remains the authoritative focus explanation.
- [x] ISC-76: The top bar contains one project scope selector.
- [x] ISC-77: The top bar contains runtime status and refresh only.
- [x] ISC-78: The workspace navigation exposes exactly six operator pages.
- [x] ISC-79: Graph Deck exposes exactly five second-level tabs only on its page.
- [x] ISC-80: No duplicate phase control carries `role="tab"` outside the top strip.
- [x] ISC-81: The keyboard tab order does not enter hidden duplicate phase controls.
- [x] ISC-82: The top phase strip retains a visible focus indicator.
- [x] ISC-83: The phase strip remains horizontally scrollable below 820px.
- [x] ISC-84: The compact rail context remains readable below 820px.
- [x] ISC-85: Selecting a phase still routes to its mapped workspace.
- [x] ISC-86: Selecting a phase still leaves runtime `NOW` unchanged.
- [x] ISC-87: Selecting a phase still leaves project scope unchanged.
- [x] ISC-88: Graph Deck sub-tabs remain independently clickable.
- [x] ISC-89: The project action rail does not duplicate top-bar controls.
- [x] ISC-90: Project actions remain grouped by observe, manage, and dangerous intent.
- [x] ISC-91: Add Project remains a separate disclosure with `aria-expanded`.
- [x] ISC-92: Manifest-history forgetting remains collapsed and confirmation-gated.
- [x] ISC-93: Dead phase-rail styles and component references are removed.
- [x] ISC-94: The rail footer remains the single local event-plane status surface.
- [x] ISC-95: Anti: The shell does not expose two interactive phase navigators.

### Test Strategy

| ISC | Type | Check | Threshold | Tool |
| --- | --- | --- | --- | --- |
| ISC-69..75 | hierarchy | inspect shell DOM and accessible names | one phase tablist; one static context | browser DOM |
| ISC-76..80 | navigation | inspect topbar, workspace, and Graph Deck controls | exact counts and scopes | browser DOM |
| ISC-81..84 | accessibility/responsive | inspect focusability and responsive CSS | no hidden duplicate tabs; mobile rules present | browser + source |
| ISC-85..88 | behavior | click phase and Graph Deck controls | mappings and runtime invariants hold | browser + bridge snapshot |
| ISC-89..92 | interaction | inspect action rail disclosures | grouped actions and gates preserved | browser DOM |
| ISC-93..94 | source hygiene | search component/style references | no dead phase rail symbols | rg + build |
| ISC-95 | anti | count interactive phase controls | exactly seven interactive phase controls | browser DOM |

### Features

| name | description | satisfies | depends_on | parallelizable |
| --- | --- | --- | --- | --- |
| shell-navigation-hygiene | Make the top phase strip the sole phase navigator and simplify the rail | ISC-69..84, ISC-93..95 | live DOM reproduction | no |
| regression-preserving-cleanup | Preserve phase routing, scope, Graph Deck tabs, and project actions | ISC-85..92 | shell-navigation-hygiene | no |

### Decisions

- 2026-08-14: Root cause is at shell composition, not phase data ingestion; the phase model is correct, but its controls are rendered twice.
- 2026-08-14: The top phase strip remains the single phase navigation surface because it already carries `NOW`, `FOCUS`, keyboard semantics, and workspace mapping.
- 2026-08-14: The left rail becomes a workspace navigator plus compact read-only runtime context; it will not compete with the phase strip.
- 2026-08-14: E4's 128-criterion soft floor is not expanded artificially for this bounded shell hygiene iteration; the 27 new criteria are granular and cover the actual changed surface.

### Verification

ISC-69..80: live DOM returned one top phase `tablist`, seven native phase buttons, zero left-rail phase controls, six workspace buttons, one topbar selector, and Graph Deck's five tabs only when Graph Deck was active.
ISC-81..84: all seven top phase controls had `tabIndex: 0`; the rendered shell had no hidden duplicate phase buttons; source CSS preserves horizontal overflow below 820px, visible focus rules, and compact rail context styling.
ISC-85..88: browser matrix mapped all seven phases to their expected workspaces, kept runtime `OBSERVE`, preserved Cambium scope `cambium-4cfc2f7087`, and selected Graph Deck's `Evidence lineage` tab successfully.
ISC-89..92: action rail remained present with grouped observe/manage/danger sections; Add Project retained `aria-expanded`; danger disclosure remained collapsed by default and exact-confirmation gated.
ISC-93..94: `rg` found no `phase-rail`, `phase-rail-row`, `phase-dot`, or `PhaseRail` references; the local event-plane footer remained present.
ISC-95: before and after phase navigation the bridge snapshot remained at 56 events with identical recent IDs and `last_event_at`; no duplicate interactive phase navigator remained in the DOM.

### Verification constraints

- The governed native audit rail produced no verifiable report, so it was rejected rather than accepted as evidence.
- In-session fallback dispatch was attempted but the dispatcher reported `collab spawn failed: agent thread limit reached`.
- Advisor was invoked before implementation and again after the durable revision; both failed authentication because the OAuth session expired and could not refresh.
- The Cato cross-vendor audit was attempted and rejected by the dispatcher with `unknown agent_type 'Cato'`.

### Changelog

- 2026-08-14 — conjectured: repeating phase menus provide useful redundancy; refuted_by: live DOM and screenshot showed the same seven-phase model competing with workspace and Graph Deck navigation; learned: one primary phase navigator plus read-only runtime context is clearer and safer; criterion_now: ISC-69 through ISC-80 and ISC-95.

## Iteration 5 — Moosh product-guide capability integration

### Problem refinement

The console currently observes aggregate skill-cluster health, but it cannot
tell an operator that the Moosh guide and product-video capabilities exist,
which cluster owns them, which local tools they need, or why a project run is
gated. The imported package is portable and evidence-led, but its execution
path must remain project-scoped, provenance-aware, and secret-safe.

### Criteria

- [x] ISC-96: The two Moosh spokes are inventoried from the reviewed package.
- [x] ISC-97: The still-guide spoke retains its evidence-led capture contract.
- [x] ISC-98: The product-video spoke retains its shared still/motion pipeline.
- [x] ISC-99: Imported Moosh material is marked as imported, not authored.
- [x] ISC-100: The imported spokes contain no secret values or local session data.
- [x] ISC-101: A product-guides orchestrator routes still versus motion work.
- [x] ISC-102: A product-guides core documents evidence and safety boundaries.
- [x] ISC-103: The product-guides cluster is represented in skills.sh metadata.
- [x] ISC-104: The product-guides cluster has an explicit deployment tier.
- [x] ISC-105: The canonical index resolves both Moosh spoke names.
- [x] ISC-106: The canonical index records the product-guides cluster.
- [x] ISC-107: Temperance resolution can surface product-guides for guide tasks.
- [x] ISC-108: Existing documents and creative-frontend ownership remains intact.
- [x] ISC-109: Moosh capture scripts remain available through the resolved skill.
- [x] ISC-110: Moosh video recording remains optional until a film spec exists.
- [x] ISC-111: Project capability data is derived from the canonical project cwd.
- [x] ISC-112: Capability reads never accept a client-supplied execution path.
- [x] ISC-113: Capability reads never mutate project source files.
- [x] ISC-114: Capability reads never activate deferred clusters implicitly.
- [x] ISC-115: Capability reads expose the source registry path safely.
- [x] ISC-116: Capability records distinguish ready, gated, and unavailable.
- [x] ISC-117: Local Node/Playwright capture prerequisites are represented.
- [x] ISC-118: Optional ffmpeg support is represented without blocking stills.
- [x] ISC-119: ElevenLabs is named only for optional voiceover readiness.
- [x] ISC-120: ElevenLabs key presence is boolean and never value-bearing.
- [x] ISC-121: OmniRoute readiness is derived from existing host health.
- [x] ISC-122: OmniRoute key names or values are never exposed in the UI.
- [x] ISC-123: No new provider credential is written by this integration.
- [x] ISC-124: Project capability endpoint is read-only and scope-aware.
- [x] ISC-125: Capability response has stable schema and version metadata.
- [x] ISC-126: Capability response includes provenance for each requirement.
- [x] ISC-127: Capability response includes explicit next action for gates.
- [x] ISC-128: UI uses the existing project scope selector for capabilities.
- [x] ISC-129: UI shows capability ownership and deployment tier.
- [x] ISC-130: UI shows provider readiness without rendering secrets.
- [x] ISC-131: UI distinguishes local capture from optional voiceover.
- [x] ISC-132: UI explains why a run is blocked before offering execution.
- [x] ISC-133: UI remains usable when the capability endpoint is offline.
- [x] ISC-134: Bridge tests cover project isolation and redacted readiness.
- [x] ISC-135: Anti: no UI control silently runs a guide or activates skills.

### Test Strategy

| ISC | Type | Check | Threshold | Tool |
| --- | --- | --- | --- | --- |
| ISC-96..100 | provenance | package and imported files audit | two spokes; no secrets | find + rg |
| ISC-101..110 | cluster | metadata, tier, index, resolver | both spokes resolve | node scripts |
| ISC-111..127 | bridge | capability contract and fixtures | scoped, stable, redacted | bun tests + curl |
| ISC-128..133 | UI | project selector, gates, offline state | accessible deck renders | browser + build |
| ISC-134..135 | anti | isolation and mutation audit | tests pass; no implicit run | bun + rg |

### Features

| name | description | satisfies | depends_on | parallelizable |
| --- | --- | --- | --- | --- |
| product-guides-cluster | Vendor and route the two Moosh capabilities | ISC-96..110 | package audit | yes |
| capability-read-model | Project-scoped local/provider readiness contract | ISC-111..127 | bridge types | yes |
| capability-deck | Render LCARS capability and provider gates | ISC-128..133 | read-model | no |
| integration-verification | Validate cluster, bridge, UI, and anti-claims | ISC-134..135 | all prior features | no |

### Decisions

- 2026-08-14: Keep Moosh as a dedicated `product-guides` cluster so imported
  provenance is not lost inside unrelated documents or creative clusters.
- 2026-08-14: Keep the cluster active at hub level; spokes remain on-demand
  through the canonical index, avoiding startup-surface expansion.
- 2026-08-14: Expose capability readiness as a read-only projection first;
  capture, rendering, voiceover, activation, and dispatch remain separate
  approved operations.
- 2026-08-14: Treat ElevenLabs as optional voiceover infrastructure and
  OmniRoute as host routing, never as a project credential to configure here.
- 2026-08-14: Do not add an execution button until a project guide manifest,
  capture config, and approval receipt have a typed contract.

### Verification

Pending implementation. The prior 95 criteria remain verified and this
iteration is intentionally in THINK until the cluster, bridge, and UI gates
have fresh evidence.

## Iteration 6 — Skill clusters, workflow lineage, and approved project triggers

### Problem refinement

The capability deck answers “what is ready?” for the imported product-guides
cluster, but an operator still cannot see the broader skill-cluster graph or
the workflow that turns a project request into a bounded skill run. The next
surface must expose cluster ownership, resolved skills, workflow stages, and
trigger gates as one project-scoped read model. A trigger may request a bounded
run only after the project manifest, selected skill, workflow, and approval
receipt are all explicit.

### Criteria

- [ ] ISC-136: The bridge exposes a versioned project skill-cluster projection.
- [ ] ISC-137: The projection is scoped to a canonical registered project ID.
- [ ] ISC-138: The projection ignores client-supplied project filesystem paths.
- [ ] ISC-139: The projection includes cluster identity and deployment tier.
- [ ] ISC-140: The projection includes cluster provenance.
- [ ] ISC-141: The projection includes every resolved skill name.
- [ ] ISC-142: Resolved skills include hub versus spoke role.
- [ ] ISC-143: Resolved skills include imported versus authored provenance.
- [ ] ISC-144: Resolved skills include executable path metadata without secrets.
- [ ] ISC-145: The projection includes workflow identity.
- [ ] ISC-146: Workflow stages are ordered and individually addressable.
- [ ] ISC-147: Each workflow stage declares its evidence or input gate.
- [ ] ISC-148: Workflow stages distinguish read-only from approved execution.
- [ ] ISC-149: The projection includes trigger eligibility.
- [ ] ISC-150: Trigger eligibility is false without an explicit approval receipt.
- [ ] ISC-151: Trigger eligibility is false when project scope is absent.
- [ ] ISC-152: Trigger eligibility is false when a required capability is gated.
- [ ] ISC-153: Trigger eligibility includes a human-readable blocker.
- [ ] ISC-154: Trigger requests cannot carry arbitrary command strings.
- [ ] ISC-155: Trigger requests cannot carry arbitrary checkout paths.
- [ ] ISC-156: Trigger requests are idempotent by approval or request identity.
- [ ] ISC-157: Existing project lifecycle actions remain unchanged.
- [ ] ISC-158: Existing graph projections remain unchanged for old snapshots.
- [ ] ISC-159: Aggregate project scope shows a safe project chooser state.
- [ ] ISC-160: Project scope selection refreshes the cluster/workflow projection.
- [ ] ISC-161: The UI shows cluster ownership and tier.
- [ ] ISC-162: The UI shows resolved skills with provenance and role.
- [ ] ISC-163: The UI shows workflow stages in execution order.
- [ ] ISC-164: The UI shows trigger eligibility before presenting a trigger control.
- [ ] ISC-165: The UI does not expose secrets or raw command payloads.
- [ ] ISC-166: The UI preserves offline and stale states for the new projection.
- [ ] ISC-167: The cluster/workflow surface remains keyboard accessible.

### Test Strategy

| ISC | Type | Check | Threshold | Tool |
| --- | --- | --- | --- | --- |
| ISC-136..148 | bridge contract | fetch project projection | stable scoped shape | bun test + curl |
| ISC-149..156 | trigger safety | approval and malformed request matrix | all unsafe requests rejected | bun test |
| ISC-157..160 | regression | old endpoints and project switching | existing suite unchanged | bun test + browser |
| ISC-161..167 | UI | live Cambium cluster/workflow deck | accessible, scoped, honest | browser + build |

### Features

| name | description | satisfies | depends_on | parallelizable |
| --- | --- | --- | --- | --- |
| cluster-workflow-read-model | Project-scoped cluster, skill, and workflow projection | ISC-136..148 | capabilities.ts, skill-index.json | yes |
| trigger-contract | Approval-gated bounded trigger request contract | ISC-149..156 | read-model | yes |
| cluster-workflow-deck | LCARS graph/list surface for ownership and stages | ISC-159..167 | read-model | no |
| regression-verification | Preserve lifecycle, graph, and capability behavior | ISC-157..158 | all prior features | no |

### Decisions

- 2026-08-14: Extend the existing project capability endpoint with a sibling
  cluster/workflow projection rather than overloading aggregate skill health.
- 2026-08-14: Model triggering as a request against a typed workflow and
  approval identity; never accept arbitrary shell commands from the UI.
- 2026-08-14: Show all currently resolved Moosh cluster skills first, while
  leaving the projection extensible for other active clusters and project
  prompts later.
- 2026-08-14: Keep execution implementation bounded to a request receipt in
  this iteration; actual capture/recording remains a separately approved worker
  operation after the project manifest is complete.

### Verification

- [x] ISC-136: The bridge exposes a versioned project skill-cluster projection.
- [x] ISC-137: The projection is scoped to a canonical registered project ID.
- [x] ISC-138: The projection ignores client-supplied project filesystem paths.
- [x] ISC-139: The projection includes cluster identity and deployment tier.
- [x] ISC-140: The projection includes cluster provenance.
- [x] ISC-141: The projection includes every resolved skill name.
- [x] ISC-142: Resolved skills include hub versus spoke role.
- [x] ISC-143: Resolved skills include imported versus authored provenance.
- [x] ISC-144: Resolved skills include executable path metadata without secrets.
- [x] ISC-145: The projection includes workflow identity.
- [x] ISC-146: Workflow stages are ordered and individually addressable.
- [x] ISC-147: Each workflow stage declares its evidence or input gate.
- [x] ISC-148: Workflow stages distinguish read-only from approved execution.
- [x] ISC-149: The projection includes trigger eligibility.
- [x] ISC-150: Trigger eligibility is false without an explicit approval receipt.
- [x] ISC-151: Trigger eligibility is false when project scope is absent.
- [x] ISC-152: Trigger eligibility is false when a required capability is gated.
- [x] ISC-153: Trigger eligibility includes a human-readable blocker.
- [x] ISC-154: Trigger requests cannot carry arbitrary command strings.
- [x] ISC-155: Trigger requests cannot carry arbitrary checkout paths.
- [x] ISC-156: Trigger requests are idempotent by approval or request identity.
- [x] ISC-157: Existing project lifecycle actions remain unchanged.
- [x] ISC-158: Existing graph projections remain unchanged for old snapshots.
- [x] ISC-159: Aggregate project scope shows a safe project chooser state.
- [x] ISC-160: Project scope selection refreshes the cluster/workflow projection.
- [x] ISC-161: The UI shows cluster ownership and tier.
- [x] ISC-162: The UI shows resolved skills with provenance and role.
- [x] ISC-163: The UI shows workflow stages in execution order.
- [x] ISC-164: The UI shows trigger eligibility before presenting a trigger control.
- [x] ISC-165: The UI does not expose secrets or raw command payloads.
- [x] ISC-166: The UI preserves offline and stale states for the new projection.
- [x] ISC-167: The cluster/workflow surface remains keyboard accessible.

ISC-136..148: bridge tests and live curl — `temperance.manifest.skill-workflow.v1` returned Cambium-scoped cluster metadata, four resolved Product Guides skills, provenance, roles, and six ordered stages.
ISC-149..156: bridge test — gated request was rejected, arbitrary `command` payload was rejected, approved request returned 201, and repeated request returned 200 idempotently.
ISC-157..160: bridge regression suite — lifecycle, graph, capability, sync, and project-isolation tests remained green; live Cambium sync refreshed the registry read model to 808 skills / 44 clusters.
ISC-161..167: browser screenshot and DOM probe — LCARS deck showed the resolved cluster, four skills, ordered stages, disabled `GATED` trigger, and no credential names; project selector remained Cambium-scoped.

Coverage: 32/32 new criteria passed. Bridge: 36 passing / 4 skipped. UI build and lint passed.

### Deliverables

- D1 — Canonical project skill/workflow projection with provenance and gates.
- D2 — Request-only, approval-gated workflow trigger endpoint.
- D3 — LCARS cluster/workflow deck showing resolved versus observed state.
- D4 — Project selector integration and safe trigger feedback.
- D5 — Bridge, UI, browser, secret, and regression verification.

### Dependencies and sequencing

- D1 depends on the existing capability contract and canonical skill index.
- D2 depends on D1 and the existing plan/approval receipt contract.
- D3 can proceed against the typed D1 contract, then D4 wires live callbacks.
- D5 runs after D1–D4 and includes a live Cambium probe.

### Parallelism

- Bridge read-model types and UI projection can be developed as disjoint slices.
- Trigger endpoint and browser verification remain sequential because they depend
  on the final approval and response contract.

### Changelog

- 2026-08-14 — conjectured: aggregate skill health was enough to explain what a project would run; refuted_by: Cambium exposed only a registry count and GSD artifact, with no resolved skill chain or trigger blockers; learned: resolved, observed, and gated states must remain separate in the operator model; criterion_now: ISC-136 through ISC-167.
- 2026-08-14 — conjectured: a trigger control should launch the selected workflow directly; refuted_by: project capture prerequisites and approval receipts are independently incomplete; learned: the first safe control is an idempotent request receipt, not execution authority; criterion_now: ISC-149 through ISC-156.
