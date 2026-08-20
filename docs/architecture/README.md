# Architecture diagrams

Library home: [../index.html](../index.html). These pages share `docs/assets/te-docs.css` with Manifest Zone (navy, gold, cyan) — not the old purple-gradient sheet.

Visual set for Temperance Engine after the 2026-08 spine refresh. Open the HTML files in a browser.

| File | Audience | What changed 2026-08-17 |
|---|---|---|
| [architecture.html](architecture.html) | Everyone | Six-section overview now includes `--with-spine`, Manifest Zone, `/goal`, fleet lock |
| [spine-and-goal.html](spine-and-goal.html) | Members | New. Picker → IAB → GSD → next-wave → `te-dispatch-paid` → `/goal` evaluator |
| [session-trace.html](session-trace.html) | Operators | Rewritten around `./install.sh --with-spine` |
| [integration-map.html](integration-map.html) | Integrators | New WIRED seams: UPS compose, Manifest Zone, `/goal`, fleet lock, Pulse/Voice |
| [system-internals.html](system-internals.html) | Maintainers | `--with-spine` flags, PromptProcessing compose, `temperance-goal.mjs`, Pulse `tts-auth` |
| [omniroute-routing.html](omniroute-routing.html) | Routing | July combo/reconciler map; still valid. Sol babysit-only. |
| [brand-connectors.html](brand-connectors.html) | Brand | Unchanged (hand-authored) |
| [SERVICES.md](SERVICES.md) | Inventory | Live local ports and UPS hooks |
| [DEPENDENCY-GRAPH.md](DEPENDENCY-GRAPH.md) | Inventory | Package + runtime edges |
| [notebooklm-prompt.md](notebooklm-prompt.md) | Stakeholders | Slide prompt for the current glove |

Prose companions: [`../architecture.md`](../architecture.md), [`../gsd-manifest-spine.md`](../gsd-manifest-spine.md), [`../gsd-goal-handoff.md`](../gsd-goal-handoff.md), [`../pai-flow.md`](../pai-flow.md).
