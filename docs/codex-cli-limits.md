# Codex CLI limits (glove)

Themed page: [index.html](index.html)

Temperance installs Codex **app** and **CLI** from the same `~/.codex` tree. The CLI is stricter than the app. `--with-spine` must respect these limits or members get startup warnings and skipped hooks.

## What the CLI will not do

| Limit | Symptom | Glove rule |
|---|---|---|
| No `"async": true` hooks | `skipping async hook in ~/.codex/hooks.json: async hooks are not supported yet` | Never write `async`. `install-spine.sh` strips leftover flags. Manifest event hooks run **synchronously** via `package/hooks/codex/run-bun-hook.sh`. |
| Short `PATH` | `PreToolUse hook exited with code 1` / `env: bun: No such file or directory` | Run bun hooks through `run-bun-hook.sh` (Homebrew + `~/.bun/bin`). Crash is fail-open. Security **deny stays exit 2**. |
| Under-dev features | `Under-development features enabled: chronicle` | Optional `suppress_unstable_features_warning = true` in `~/.codex/config.toml`. Do not enable `chronicle` from the installer. |
| MCP OAuth | `The refero MCP server is not logged in` / `MCP startup incomplete` | Do not ship Refero tokens. Members who want Refero run `codex mcp login refero` then leave the server enabled. Otherwise keep `[mcp_servers.refero] enabled = false` so startup stays clean. |

## Resume previous CLI sessions

```bash
codex resume              # picker for this cwd
codex resume --all        # every session
codex resume --last       # most recent
codex resume <SESSION_ID>
codex fork --last
```

Rollouts live under `~/.codex/sessions/`.

## What `--with-spine` installs for Codex

- `package/hooks/codex/PromptProcessing.hook.ts` (UPS compose)
- `run-bun-hook.sh` (sync runner, bun PATH, fail-open)
- SessionStart merge **without** `async`
- Strip of any existing `"async"` keys in `~/.codex/hooks.json`

The Codex **app** shares the same files. Sync hooks also work there.

## Out of scope

- Admin `/etc/codex`
- Auto-login to Refero or any OAuth MCP
- Enabling `chronicle` for members
- Chrome/Safari for Manifest
