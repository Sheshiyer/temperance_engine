# Dependency Graph

> Manual refresh 2026-08-17. The 2026-06 hook scan only saw two source files and is stale.

Edges are ownership, not compiled imports. Public install never vendors the external row.

## Repo packages

```
temperance_engine
├── install.sh                 → scripts/install-*.sh, scripts/install-spine.sh
├── package/hooks/codex        → PromptProcessing composes rails
│                                GsdCommand / RailAnnounce / SessionStartTe (no UPS steal)
├── package/hooks/claude       → same compose envelope, surface claude
├── package/router             → gsd wrappers, goal, next-wave, doctor probes,
│                                OmniRoute proxy, phase-combo-map, fallback policy
├── package/manifest-bridge    → :8766 event plane (projection)
├── package/manifest-zone      → :5173 LCARS (projection)
├── package/pulse-compat       → :31337 peon + optional Voice forward
├── package/enrich             → shared <temperance-context> / classifier
├── package/skill-resolvers    → Codex skill-index probe
├── package/headless           → optional EC2 shadow runtime
└── templates/                 → AGENTS / OpenCode / Cursor / Codex / CLAUDE
```

## Runtime edges

| From | To | Kind |
|---|---|---|
| `install.sh --with-spine` | Claude+Codex hooks + four-surface `/gsd:*` + Manifest + Pulse | install |
| PromptProcessing | `gsd-rail-map.json`, classifier, Manifest bridge | compose |
| `/gsd:*` wrappers | GSD 1.30.0 workflows (external) | remote, no fork |
| `/gsd:goal` | `temperance-goal.mjs` → `.temperance/goal.json` | session loop (Claude also `/goal`) |
| Claude UPS | `package/hooks/claude/PromptProcessing.hook.ts` | compose + persist + skip-quiz |
| `temperance-next-wave.mjs` | fleet lock under `~/.temperance_engine/state/fleet-locks/` | lock |
| `/gsd:execute-phase` | `te-dispatch-paid` via OmniRoute `:20128` | fleet |
| Manifest Zone `:5173` | Manifest bridge `:8766` | SSE / JSONL read |
| Pulse `:31337` | peon-ping (phase) or Voice `:8888` (non-phase) | notify |
| Relay `:20129` | OmniRoute `:20128` | frozen route |

## Recommended external dependencies

- **gsd-core** (open-gsd/gsd-core) — workflow backbone, referenced-not-vendored.
- **OmniRoute** — combo gateway, optional.
- **skill-clusters** at `$HOME/.agents/skill-clusters` — discovery index, not scanned wholesale.
- **CodeGraph** — `$HOME/.agents` structural index.
