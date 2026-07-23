# OmniRoute runtime integration

Temperance's former 14-entry `MODEL_CATALOG` was a local dispatch scaffold. It
was not OmniRoute's provider catalog. The current boundary is:

1. Temperance's shared classifier decides whether work is inline or external.
2. External work prefers the `omniroute:temperance-coding` backend.
3. Codex supplies the agent/tool loop while OmniRoute supplies the model API.
4. OmniRoute's `temperance-coding` priority combo owns provider/model failover.
5. Command Code, Grok, and Kimi remain direct outage fallbacks.

This avoids two classifiers and preserves filesystem-capable agents. Calling
`/v1/chat/completions` directly would return text but would not, by itself,
provide a coding agent with workspace tools.

## Local configuration

- Runtime: OmniRoute `3.8.48` from [`diegosouzapw/OmniRoute`](https://github.com/diegosouzapw/OmniRoute)
- Dashboard: `http://localhost:20128`
- OpenAI-compatible API: `http://127.0.0.1:20128/v1`
- Data: `~/.omniroute` (`.env` and SQLite are local, never repository inputs)
- Combo: `temperance-coding`
- Current priority targets: `oc/deepseek-v4-flash-free`, `oc/big-pickle`, then `mcode/mimo-auto`
- Admin password: macOS Keychain service `OmniRoute Temperance Admin`
- Scoped inference key: macOS Keychain service `OmniRoute Temperance API Key`
- Codex profile: `~/.codex/temperance-coding.config.toml`
- OpenCode provider: `omniroute/temperance-coding` in `~/.config/opencode/opencode.json`

The two `.env` files used by this installation are mode `600`. The scoped API
key is referenced through `OMNIROUTE_API_KEY`; it is not embedded in config or
source files.

## Test it

The default probe is read-only and verifies the daemon, live model catalog,
named combo, and Temperance routing boundary:

```bash
./scripts/omniroute-check.sh
```

Run one small real completion through the configured combo:

```bash
./scripts/omniroute-check.sh --live
```

Inspect every model OmniRoute currently advertises:

```bash
export OMNIROUTE_API_KEY=$(security find-generic-password \
  -a "$USER" -s 'OmniRoute Temperance API Key' -w)
curl -sS -H "Authorization: Bearer $OMNIROUTE_API_KEY" \
  http://127.0.0.1:20128/v1/models \
  | jq -r '.data[] | [.owned_by,.id] | @tsv'
```

Verify the orchestrator's frozen plan:

```bash
package/router/multi-backend-router.sh --plan-json \
  'refactor the authentication module' \
  | jq '{task_type,status,selected_order}'
```

## Add private providers

The current combo uses verified built-in free routes. For dependable production
agent work, connect OpenAI, Anthropic, Google, OpenRouter, Groq, or Mistral in
Dashboard → Providers, then add those model IDs to `temperance-coding`. Provider
credentials are stored encrypted in `~/.omniroute/storage.sqlite`.

The CLI alternative keeps the provider key out of shell history:

```bash
read -rs 'provider_key?Provider API key: '
echo
omniroute setup --add-provider --provider openai \
  --api-key "$provider_key" --test-provider --non-interactive
unset provider_key
```

After changing providers or combo targets, rerun both checks above. The router
only detects OmniRoute when `/v1/models` contains `temperance-coding`; otherwise
it automatically falls back to direct agent CLIs.

## Operations

```bash
omniroute serve --daemon --no-open
omniroute doctor
omniroute stop
```

Retrieve the dashboard password without printing it into configuration files:

```bash
security find-generic-password -a "$USER" \
  -s 'OmniRoute Temperance Admin' -w
```

`TEMPERANCE_OMNIROUTE_BASE_URL` and `TEMPERANCE_OMNIROUTE_MODEL` override the
local endpoint and combo. Set `OMNIROUTE_API_KEY` explicitly for remote servers.
`TEMPERANCE_OMNIROUTE_CODEX_ISOLATED=1` asks the Codex adapter to ignore the
base user config while retaining repository rules.
