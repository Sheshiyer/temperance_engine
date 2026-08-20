# Manifest Visual Console

The Manifest Zone package is the live operator surface for the local Manifest Bridge. It is intentionally a projection layer: Temperance Engine, PAI hooks, project watchers, and OmniRoute remain the source owners; this app reads the bridge snapshot and SSE event plane.

## Run it

```bash
cd package/manifest-zone
npm install
npm run dev
# or: ./install.sh --with-spine  (LaunchAgent on 127.0.0.1:5173)
```

For the persistent local operator surface, install the supervised console
service from the Temperance checkout instead of leaving a terminal running:

```bash
export TEMPERANCE_ROOT=/path/to/temperance_engine
export MANIFEST_CONSOLE_ROOT="$(pwd)"
bash "$TEMPERANCE_ROOT/scripts/temperance-manifest-console-launchd.sh" install
```

It serves this UI on `http://127.0.0.1:5173`, points it at the loopback bridge,
and restarts it on login/crash. The API bridge at `http://127.0.0.1:8766`
redirects browser root requests here; `/health`, `/snapshot`, and `/events`
remain bridge API endpoints.

The default bridge is `http://127.0.0.1:8766`. Override it with:

```bash
VITE_MANIFEST_BRIDGE_URL=http://127.0.0.1:8766 npm run dev
```

Start the bridge separately from `manifest-bridge`:

```bash
bun run src/cli.ts serve --all --port 8766
```

Inspect the two services independently:

```bash
bash "$TEMPERANCE_ROOT/scripts/temperance-manifest-bridge-launchd.sh" status
bash "$TEMPERANCE_ROOT/scripts/temperance-manifest-console-launchd.sh" status
cd "$TEMPERANCE_ROOT/package/manifest-bridge" && bun run doctor --verbose
```

## Operator pages

- **Overview** — topology, phase rail, attention, live events, and evidence selection.
- **Graph Deck** — architecture, alchemical phases, execution, evidence lineage, and operations graphs with node/edge inspection.
- **Planning** — project registry, materialized next waves, sessions, and planning events.
- **Execution** — observed agent lanes, sessions, routes, and execution events.
- **Evidence** — filtered event plane, provenance inspector, and source-pointer registry.
- **Ops / Delivery** — bridge freshness, project readiness, source mix, alerts, and proof stream.

All pages share one project selector, one runtime hook, one event vocabulary, and one bounded evidence inspector. The selector persists locally and rebinds both snapshot and SSE scope.

The top phase strip is the single interactive phase navigator. The left rail
owns workspace navigation and shows a compact read-only runtime phase context;
it does not repeat the phase menu. The strip uses the canonical seven-phase order and maps
OBSERVE→Overview, THINK/BUILD→Graph Deck, PLAN→Planning, EXECUTE→Execution,
VERIFY→Evidence, and LEARN→Ops / Delivery. `NOW` remains the bridge-owned
runtime phase; `FOCUS` is local operator navigation and never mutates runtime
state or project scope. Graph Deck's five tabs remain a second navigation level.

## Runtime boundary

The client calls:

- `GET /projects` for the live project registry;
- `GET /health` for bridge health and aggregate freshness;
- `GET /snapshot` or `GET /snapshot?project_id=...` for the materialized read model;
- `GET /events` or `GET /events?project_id=...` for named SSE updates.

The UI does not fabricate provider health, agent activity, wave state, or completion. Missing telemetry is rendered as an explicit empty state. Event payloads are bounded at the bridge boundary and raw prompt/tool bodies are not rendered.

## Project actions

The LCARS project action rail is available beneath the phase strip on every
page and is intentionally grouped below workspace navigation. It supports:

- `ADD PROJECT` — registers an existing directory and writes its Temperance
  project marker.
- `SYNC OBSERVATIONS` — reads CodeGraph, GSD, and skill-cluster evidence through
  the stored project cwd; it does not index CodeGraph or mutate the checkout.
- `ARCHIVE` and `REMOVE FROM UI` — change bridge visibility while preserving
  the project source and event history.
- `FORGET MANIFEST HISTORY` — requires the exact project ID and moves bridge
  history into recoverable retention. It never deletes the source checkout.

The action groups are `OBSERVE / READ`, `MANAGE / VISIBILITY`, and a collapsed
`DANGEROUS / FORGET MANIFEST HISTORY` disclosure. Add-project registration is a
separate disclosure with an explicit existing-directory boundary.

The bridge action contract is `GET /projects/{id}/actions`, `POST /projects`
and `POST /projects/{id}/{sync|archive|unregister}`. The history operation is
`DELETE /projects/{id}` with `delete_mode: "manifest-history"` and an exact
`confirm_project_id`. Unsafe IDs, deleted-history resurrection, and direct
source-checkout deletion are rejected.

## Design language

The console follows LCARS-like operational segmentation with a restrained Swiss grid: dark instrument panels, one-pixel rules, mono telemetry labels, cyan live flow, orange attention, magenta decision state, violet routing, and mint healthy flow. The Graph Deck adapts the semantic, static-first SVG discipline from [diagram-design](https://github.com/cathrynlavery/diagram-design): relationships carry explicit basis and provenance, interactive nodes have accessible list fallbacks, and motion remains optional with a reduced-motion override.

## Verification

```bash
npm run build
npm run lint
```

The broader integration checks live in the sibling `manifest-bridge` package.
The project ISA tracks 68 criteria across graph provenance, lifecycle safety,
phase navigation, workspace hierarchy, and browser verification.

## Source map

- `src/App.tsx` — shell, navigation, scope selector, shared freshness/footer surfaces.
- `src/useManifestRuntime.ts` — snapshot, health, project, and SSE lifecycle.
- `src/ProjectActionRail.tsx` / `src/projectActions.css` — LCARS project registration, observation sync, visibility, and confirmation-gated history actions.
- `src/manifest.ts` — typed read model and presentation helpers.
- `src/pages.tsx` — six live page projections and shared components.
- `src/GraphDeck.tsx` — graph projection tabs, selection, and provenance inspector.
- `src/GraphCanvas.tsx` / `src/graph.css` — accessible LCARS SVG and list primitives.
- `src/graphModel.ts` — pure ManifestSnapshot-to-graph projections.
- `src/App.css` — LCARS/Swiss tokens, responsive layout, and accessibility states.
