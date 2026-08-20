# Architecture

Themed pages: [architecture/architecture.html](architecture/architecture.html) · [index.html](index.html)

Temperance Engine is a local runtime integration package for OpenCode/Cursor-first operator workflows. It does not require Claude Code, Claude Pro/Max, Anthropic auth, Codex auth, or a specific model; Claude and Codex instruction surfaces are optional compatibility targets.

An optional second layer — a local OmniRoute gateway with governed model portfolios — sits on top once installed; see [OmniRoute Routing](architecture/omniroute-routing.html).

The Thoughtseed-member glove is `./install.sh --with-spine`. Public `./install.sh` stays OpenCode/Cursor-first. See [GSD + Manifest spine](gsd-manifest-spine.md) and the visual set under [docs/architecture/](architecture/README.md).

## Components

- Instruction surfaces: `AGENTS.md`, OpenCode guidance, Cursor guidance, and optional Claude/Codex guidance.
- Pulse compatibility: optional local HTTP server on `:31337`. Algorithm phase messages play peon-ping. Non-phase messages may forward to Voice `:8888` (ElevenLabs). Forward 4xx/5xx are classified `tts-auth` or `tts-failed`.
- Voice adapter: optional peon-ping invocation by phase. Distinct from Voice `:8888`.
- Skill-cluster routing: resolver guidance and health-check conventions.
- CodeGraph routing: structural search for `$HOME/.agents`.
- OmniRoute routing (optional): local gateway `:20128` plus relay `:20129` for `temperance/temperance-auto` and Kimi. Combos: `te-plan`, `te-build`, `te-reason`, `te-validate`, `te-dispatch-paid`. Sol is babysit-only, never a fleet head.
- GSD slash spine (optional `--with-gsd` / `--with-spine`): thin `/gsd:*` remotes on Claude Code, Codex, OpenCode, and Grok. They read GSD 1.30.0 workflows. They do not fork GSD. `/gsd:doctor` and `/gsd:goal` are Temperance-owned. Claude also gets native `/goal`.
- UPS compose: `package/hooks/codex` and `package/hooks/claude` PromptProcessing emit one `additionalContext` envelope — classifier + `<temperance-rail>` + `<gsd-rail>` + `<pai-mode-offer>` + hook receipt. Companion hooks must not steal stdin.
- Manifest Zone / **Speculum** (optional `--with-manifest` / `--with-spine`): Vite LCARS on `:5173`. Named glass `https://speculum.localhost:1355` via [portless](https://github.com/vercel-labs/portless) when installed. ChatGPT IAB stays `http://127.0.0.1:5173`. Projection only. Bound planning projects, not every Vas cwd. Live STATE / ROADMAP / GOAL. Never Chrome/Safari.
- Manifest bridge: event plane on `:8766`. Heartbeat plus 180s stale window. Edge `local|clio`.
- Session goal loop: `.temperance/goal.json` (`temperance.goal.v1`). CLI `temperance-goal --ensure|--eval`. `/gsd:goal` (and Claude native `/goal`) loops execute until the same VERIFY probes pass. Not a planner.
- Dual-fleet lock: `/gsd:execute-phase` writes `~/.temperance_engine/state/fleet-locks/<cwd-hash>.json` when next-wave emits tasks. A second `gsd-executor` swarm on the same `[P]` ids is forbidden while the lock is active (<2h).
- Product symlink: `~/.temperance_engine/product` always points at this clone.
- Codex CLI limits: no `async` hooks, bun via `run-bun-hook.sh`, Refero OAuth is member-local. See [codex-cli-limits.md](codex-cli-limits.md).

## Data Flow

1. Member install is `./install.sh` (public) or `./install.sh --with-spine` (glove).
2. Session start: `/gsd:*` binds the mode. Only a bare first prompt with no saved mode uses the native question card (`ask_user_question` on Grok, `AskUserQuestion` on Codex/Claude). Never a NOESIS bullet quiz.
3. After a mode exists, open ChatGPT IAB only (Codex/Claude) or print the URL (Grok): `http://127.0.0.1:5173/?mode=…&view=…`. Never Chrome/Safari.
4. PromptProcessing classifies the prompt and composes one rail envelope. GSD wrappers name `/gsd:*` plus combo plus Manifest view.
5. The agent follows the 7-phase PAI shell. `active_planner` is `isa` or `gsd`. Plan via `/gsd:plan-phase` or `writing-plans`.
6. Execute needs next-wave approval. Fleet work uses `te-dispatch-paid` under the dual-fleet lock. Manifest cannot approve or launch.
7. `/gsd:goal` binds ISA Goal or GSD STATE into `.temperance/goal.json`. The evaluator reuses doctor/ISA probes. Fail → continue the same `/gsd:*`. Pass → stop.
8. If Pulse is enabled, phase notifications POST to `localhost:31337/notify` (peon). Non-phase may forward to Voice `:8888`.
9. Code search for `.agents` uses CodeGraph instead of blocked semantic retrieval.
10. If the OmniRoute relay is enabled and the automatic model is selected, a chat request is enriched, classified into a frozen route, and forwarded to the resolved combo.

## Public Packaging Boundary

The repo ships templates and scripts. It does not ship private memories, live config backups, auth tokens, model credentials, Claude/Codex accounts, or audio packs. `--with-spine` does not vendor GSD core, copy API keys, `--apply` OmniRoute combos, bind OmniRoute to LAN, or make Sol a fleet head.

## Visual map

| Page | What it shows |
|---|---|
| [architecture.html](architecture/architecture.html) | Six-section overview: business, data flow, install pipeline, layers, features, deploy |
| [spine-and-goal.html](architecture/spine-and-goal.html) | Picker → Manifest Zone → GSD → next-wave → fleet lock → `/goal` |
| [session-trace.html](architecture/session-trace.html) | One `--with-spine` walkthrough |
| [integration-map.html](architecture/integration-map.html) | WIRED vs reference-only seams |
| [system-internals.html](architecture/system-internals.html) | Flags, hooks, ports, CLIs |
| [omniroute-routing.html](architecture/omniroute-routing.html) | Combo roster and reconciler |
