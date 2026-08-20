# Services Inventory

> Manual refresh 2026-08-17 for the `--with-spine` glove. The 2026-06 hook scan found no root config files and is stale.

Temperance Engine is a local installer. Services are optional local processes, not cloud SaaS bindings.

## Live local services (member glove)

| Service | Bind | Package / script | Role |
|---|---|---|---|
| Pulse compatibility | `127.0.0.1:31337` | `package/pulse-compat/compat-server.ts` | Phase → peon-ping. Non-phase may forward Voice `:8888`. Classifies `tts-auth` / `tts-failed`. |
| Voice (ElevenLabs) | `127.0.0.1:8888` | host Voice server (not shipped) | Optional TTS. Pulse forwards here when the message is not a phase announce. |
| OmniRoute gateway | `:20128` (LAN bind is operator-owned) | host OmniRoute | Provider/model failover for governed `te-*` combos. |
| Temperance OpenAI relay | `127.0.0.1:20129` | `package/router/temperance-openai-proxy.ts` | Enrich + freeze + forward `temperance/temperance-auto` / Kimi. |
| Manifest bridge | `127.0.0.1:8766` | `package/manifest-bridge` | Event plane. Heartbeat + 180s stale window. Projection only. |
| Manifest Zone | `127.0.0.1:5173` | `package/manifest-zone` | LCARS. STATE / ROADMAP / GOAL. Native IAB only. No approve/launch. |

## Install-time surfaces (not always running)

| Surface | Flag | Writes |
|---|---|---|
| OpenCode / Cursor templates | default on | `$OPENCODE_HOME`, `$CURSOR_HOME/templates` |
| Codex templates + UPS hooks | `--with-codex` or `--with-spine` | `$CODEX_HOME`, `package/hooks/codex/*` |
| Claude compose + Pulse | `--with-claude` or `--with-spine` | `$PAI_HOME` Pulse + CLAUDE template + `package/hooks/claude/PromptProcessing.hook.ts` |
| GSD slash remotes | `--with-gsd` or `--with-spine` | `~/.codex/prompts`, `~/.config/opencode/command`, `~/.grok/commands`, `~/.claude/commands` |
| Manifest + product symlink | `--with-manifest` or `--with-spine` | LaunchAgents + `~/.temperance_engine/product` |
| OmniRoute relay LaunchAgent | `--with-relay` | `com.temperance.engine.proxy` |

`--with-spine` is the member alias for Codex + GSD + Manifest + Claude/Pulse. It does not vendor GSD core or copy secrets.

## Recommended external services

- **gsd-core** (`open-gsd/gsd-core`) — recommended workflow backbone; `npx @opengsd/gsd-core@latest`; referenced-not-vendored.
- **CodeGraph** CLI — structural index for `$HOME/.agents`.
- **OmniRoute** — optional combo gateway.

## UPS compose (Codex + Claude)

`package/hooks/codex/PromptProcessing.hook.ts` and `package/hooks/claude/PromptProcessing.hook.ts` emit `additionalContext` (surface `codex` vs `claude`). Companion hooks (`GsdCommand`, `TemperanceRailAnnounce`, `ManifestModeCommit`, `SessionStartTe`) use `import.meta.main` and must not steal stdin.

Codex **CLI** cannot run `"async": true` hooks. `run-bun-hook.sh` is the sync runner. `install-spine.sh` strips leftover async flags. See [codex-cli-limits.md](../codex-cli-limits.md).

## Files that define runtime

- `package/hooks/codex/PromptProcessing.hook.ts`
- `package/router/gsd-rail-map.json`
- `package/router/temperance-goal.mjs`
- `package/router/temperance-next-wave.mjs`
- `package/router/temperance-project-init.mjs`
- `package/router/phase-combo-map.json`
- `package/router/omniroute-fallback-policy.json`
- `package/manifest-zone/src/GsdDeck.tsx`
- `package/pulse-compat/compat-server.ts`
