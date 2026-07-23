# Kimi surface adapter

Kimi (kimi-cli and the Kimi desktop app's daimon runtime) is wired as a
Temperance surface differently from Claude Code, Codex, and OpenCode, because
its hook runner honors **block/allow only** — a `UserPromptSubmit` hook's
stdout is parsed solely for a `permissionDecision` and `additionalContext` is
never injected (verified against kimi-cli 1.47.0 and 1.49.0,
`kimi_cli/hooks/runner.py`).

The split:

| Seam | Owner | Job |
| --- | --- | --- |
| `[providers.temperance]` + `[models."temperance/temperance-auto"]` in the Kimi TOML config | `scripts/configure-kimi-relay.sh` / `scripts/configure-kimi-desktop-relay.sh` | Governed lane: routes chats through `temperance-openai-proxy` (:20129), tagged `X-Temperance-Surface: kimi` via provider `custom_headers`. |
| Relay-side enrichment | `package/router/temperance-openai-proxy.ts` | Runs the shared `enrich()` server-side for kimi-tagged requests and prepends the `<temperance-context>` block to the latest user message. Fail-open, timeout-bounded. |
| `UserPromptSubmit.hook.sh` (this directory) | Kimi hook config | Writes the cwd sidecar `~/.temperance_engine/kimi/session-context.json` so the relay can resolve project context (ISA/`.planning`), and appends kimi telemetry to `mode-classifier.jsonl`. Always exits 0 with empty stdout — it can never block a prompt. |
| Skills | `scripts/wire-multi-backend.sh` | Symlinks the repo skills into `~/.kimi/skills/` and the desktop daimon skills dir; project scope resolves via the repo's `.agents/skills/`. |

Known limitation: the sidecar is last-writer-wins across concurrent Kimi
sessions. The relay treats it as advisory (freshness TTL + prompt-hash match
logged) and falls back to its own cwd, where the resolver's home-based ISA
discovery still applies.
