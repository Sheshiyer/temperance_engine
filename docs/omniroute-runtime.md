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

## OpenCode automatic flow

OpenCode's plugin API cannot replace the selected model in `chat.params`. The
local configuration therefore uses a narrow relay for one automatic model:

- Relay: `http://127.0.0.1:20129/v1`
- Automatic model: `temperance-auto`
- Upstream: OmniRoute `http://127.0.0.1:20128/v1`
- Lifecycle: `scripts/temperance-proxy.sh start|stop|status`
- Persistent macOS startup: `scripts/temperance-proxy-launchd.sh install`

For `temperance-auto`, the relay extracts only the latest user prompt, invokes
`multi-backend-router.sh --plan-json` with `TEMPERANCE_BACKENDS=omniroute`,
rewrites the request model to the frozen OmniRoute candidate, and forwards the
original tools, tool choice, messages, and stream flag. It adds request,
plan, correlation, task-type, and portfolio headers without logging secrets.
If the classifier fails, the relay visibly degrades to `temperance-coding`.
Requests using any other picker model bypass the relay's classifier entirely;
this preserves the direct override contract. The OpenCode flow plugin still
injects the shared PAI/ISA context for those direct requests; only provider
selection is bypassed, not Temperance enrichment.

Start the relay before selecting `omniroute/temperance-auto` in OpenCode:

```bash
scripts/temperance-proxy.sh start
curl -fsS http://127.0.0.1:20129/health | jq .
```

For a login-persistent local service, install the user-scoped LaunchAgent:

```bash
scripts/temperance-proxy-launchd.sh install
scripts/temperance-proxy-launchd.sh status
```

The relay is intentionally local and optional. If it is stopped, use the
direct `omniroute/temperance-coding` or `auto/*` picker entries, or the
`temperance-route` / `temperance-batch` CLI rails.

If the relay returns OmniRoute's `[502]: All accounts exhausted` response, the
Temperance routing seam is working but the current `temperance-coding` combo
has no usable target. Refresh that combo's targets in Dashboard → Combos (or
temporarily select a verified direct alias such as `auto/best-coding`); the
relay intentionally preserves the upstream failure instead of silently
changing a governed portfolio.

The distinction is observable in OmniRoute call logs: `temperance-coding` is a
named priority combo whose current targets are exhausted, while
`auto/best-coding` is a separate virtual combo and may succeed through a
different provider pool. A transient canary with the latter returned HTTP 200
through the real Temperance relay and carried the frozen-plan headers; it does
not promote that provider-owned alias into the governed default.

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
- OpenCode provider: `omniroute/temperance-coding` plus `omniroute/temperance-auto` in `~/.config/opencode/opencode.json`

The two `.env` files used by this installation are mode `600`. The scoped API
key is referenced through `OMNIROUTE_API_KEY`; it is not embedded in config or
source files.

## OpenCode model-picker modes

OpenCode's picker is a **direct model override surface** for every model other
than `temperance-auto`. Manual selections do not run the Temperance classifier.
Automatic task modes belong to `temperance-auto` through the local relay and
the governed `temperance-coding` combo; picker selections remain explicit
experiments or operator overrides.

The local Mac configuration exposes this curated set from OmniRoute's live
combo catalog:

| Picker entry | Intended use | Governance |
| --- | --- | --- |
| `temperance-coding` | Governed default coding route | Temperance-compatible default |
| `auto/best-coding` | Best available coding | Explicit override |
| `auto/best-coding-fast` | Lower-latency coding | Explicit override |
| `auto/best-reasoning` | Deep reasoning and validation | Explicit override |
| `auto/best-fast` | Fast fixes and short tasks | Explicit override |
| `auto/best-chat` | Creative and conversational work | Explicit override |
| `auto/best-vision` | Image and multimodal work | Explicit override |
| `auto/pro-coding` | Pro coding route | Explicit override; may use paid providers |
| `auto/pro-reasoning` | Pro reasoning route | Explicit override; may use paid providers |
| `auto/pro-fast` | Pro low-latency route | Explicit override; may use paid providers |
| `auto/pro-vision` | Pro multimodal route | Explicit override; may use paid providers |
| `auto/smart` | Balanced general-purpose route | Explicit override |
| `auto/cheap` | Cost-sensitive route | Explicit override |
| `auto/best-free` | Free-route experiment | Experimental; no enforcement authority |

The full inventory remains available from the live API; it is intentionally not
copied into OpenCode's picker because the catalog is provider-owned and changes
over time:

```bash
export OMNIROUTE_API_KEY=$(security find-generic-password \
  -a "$USER" -s 'OmniRoute Temperance API Key' -w)
curl -sS -H "Authorization: Bearer $OMNIROUTE_API_KEY" \
  http://127.0.0.1:20128/v1/models \
  | jq -r '.data[] | [.owned_by,.id] | @tsv'
```

Combo names are routing aliases, not permanent provider guarantees. Their
underlying provider/model can change with account health, quota, and dashboard
configuration. A successful alias probe therefore proves reachability only; it
does not authorize a production portfolio promotion. The governed router keeps
`temperance-coding` as its default and retains direct fallback rails.

After editing the local config, restart or refresh OpenCode's model picker.
The configured IDs are checked against `/v1/models`; missing IDs must be
removed or treated as unavailable rather than silently substituted.

The local OpenCode plugin `omniroute-catalog-guard.ts` repeats that check in
`chat.params` immediately before each OmniRoute request. A missing model,
malformed catalog, or unavailable catalog endpoint fails the request closed;
it cannot silently fall back to another provider/model.

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
