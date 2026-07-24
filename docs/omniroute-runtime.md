# OmniRoute runtime integration

Temperance's former 14-entry `MODEL_CATALOG` was a local dispatch scaffold. It
was not OmniRoute's provider catalog. The current boundary is:

1. Temperance's shared classifier decides whether work is inline or external.
2. External work prefers the `omniroute:temperance-coding` backend.
3. Codex supplies the agent/tool loop while OmniRoute supplies the model API.
4. OmniRoute's named combos own provider/model failover; Temperance owns which
   combo is appropriate for the task.
5. `temperance-coding` is the compatibility rail, while `te-fast`, `te-build`,
   `te-reason`, `te-validate`, and `te-creative` are the five governed task
   portfolios. `te-plan` and `te-dispatch` are role combos for orchestration.
6. Command Code, Grok, and Kimi remain direct outage fallbacks.

This avoids two classifiers and preserves filesystem-capable agents. Calling
`/v1/chat/completions` directly would return text but would not, by itself,
provide a coding agent with workspace tools.

## OpenCode automatic flow

OpenCode's plugin API cannot replace the selected model in `chat.params`. The
local configuration therefore uses a narrow relay for one automatic model.
The direct `omniroute` provider remains pointed at OmniRoute on `20128`; the
automatic route is an explicit second provider named `temperance`, so stopping
the relay never removes the direct picker modes.

- Relay: `http://127.0.0.1:20129/v1`
- Automatic provider/model: `temperance/temperance-auto`
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

Start the relay before enabling `temperance/temperance-auto` in OpenCode:

```bash
scripts/temperance-proxy.sh start
curl -fsS http://127.0.0.1:20129/health | jq .
```

For a login-persistent local service, install the user-scoped LaunchAgent:

```bash
scripts/temperance-proxy-launchd.sh install
scripts/temperance-proxy-launchd.sh status
```

Then add the managed automatic provider with the backup-first configurator:

```bash
scripts/configure-opencode-relay.sh --enable
opencode models temperance
scripts/temperance-doctor.sh --require-auto
```

Disable the automatic provider without touching the direct `omniroute` provider:

```bash
scripts/configure-opencode-relay.sh --disable
```

The relay is intentionally local and optional. If it is stopped, use the
direct `omniroute/temperance-coding` or `auto/*` picker entries, or the
`temperance-route` / `temperance-batch` CLI rails.

If the relay returns OmniRoute's `[502]: All accounts exhausted` response, the
Temperance routing seam is working but the selected combo has no usable target.
Use the named portfolio's native probe and repair its dashboard targets (or
temporarily select a verified direct alias such as `auto/best-coding`); the
relay intentionally preserves the upstream failure instead of silently
changing a governed portfolio.

The distinction is observable in OmniRoute call logs: `temperance-coding` is a
compatibility rail, `te-fast`/`te-build`/`te-reason`/`te-creative` are priority
portfolios, and `te-validate` is a fusion council. `te-plan` protects the
GitHub-first planner; `te-dispatch` is the worker fleet. The writing fleet is
role-scoped in the same way: `te-write` is a priority drafting rail,
`te-write-critique` and `te-write-research` are fusion councils (gate and
ground, respectively), and `te-write-media` is a priority image-brief
planner; none of the four ever enters a coding fallback chain. `auto/*`
remains a separate provider-
owned virtual pool and is never silently promoted into a Temperance portfolio.

## Local configuration

- Runtime: OmniRoute `3.8.48` from [`diegosouzapw/OmniRoute`](https://github.com/diegosouzapw/OmniRoute)
- Dashboard: `http://localhost:20128`
- OpenAI-compatible API: `http://127.0.0.1:20128/v1`
- Data: `~/.omniroute` (`.env` and SQLite are local, never repository inputs)
- Compatibility combo: `temperance-coding`
- Governed combos: `te-fast`, `te-build`, `te-reason`, `te-validate`, `te-creative`
- Role combos: `te-plan` (GitHub planner) and `te-dispatch` (fleet workers)
- Writing combos: `te-write` (drafting rail), `te-write-critique`
  (drift-scoring fusion council), `te-write-research` (claim-grounding
  fusion council), and `te-write-media` (image-brief priority planner); see
  [`docs/noesis-writer-routing.md`](./noesis-writer-routing.md)
- Compatibility targets: `codex/gpt-5.6-terra`, `github/gpt-5.4`, then
  `nebius/Qwen/Qwen3-235B-A22B-Instruct-2507`
- Live combo lifecycle: `scripts/omniroute-temperance-combos.sh`
- Role combo lifecycle: `scripts/omniroute-temperance-fleet.sh`
- Writing combo lifecycle: `scripts/omniroute-temperance-writer.sh`
  (te-write/te-write-critique) and
  `scripts/omniroute-temperance-writer-expansion.sh`
  (te-write-research/te-write-media)
- Availability/quota reconciler: `scripts/omniroute-temperance-reconcile.sh`,
  driven by `package/router/omniroute-fallback-policy.json` (schema
  temperance-fallback-v1; registered as `fallback_policy` in
  `omniroute-portfolios.json`). It substitutes guarded slots on
  manual-disable (`isActive:false`, or absent from the quota report while
  others are present) or quota below threshold, restores with hysteresis,
  fails open for priority combos and closed (HOLD, exit 3) for fusion
  combos, and mutates via full-body PUT preserving combo ids. Timer label
  `com.temperance.engine.reconcile` (900s). The retired
  `scripts/omniroute-temperance-planner-quota.sh` is a deprecated shim that
  forwards to the reconciler with `--combo te-plan`.
- Reconciler state: `~/.temperance_engine/state/omniroute-reconcile.json`
  (schema temperance-reconcile-v1) plus the append-only event log
  `~/.temperance_engine/state/omniroute-reconcile-events.jsonl` with event
  types `run`, `substitute` (reason `quota` or `manual-disable`), `restore`,
  `hold` (fail-closed or panel-floor), `requires-probe` (tier2 gating), and
  `rollback`
- Admin password: macOS Keychain service `OmniRoute Temperance Admin`
- Scoped inference key: macOS Keychain service `OmniRoute Temperance API Key`
- Codex profile: `~/.codex/temperance-coding.config.toml`
- OpenCode providers: direct `omniroute/*` plus managed automatic `temperance/temperance-auto` in `~/.config/opencode/opencode.json`
- Read-only surface check: `scripts/temperance-doctor.sh` (`--require-auto` for relay mode)

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
| `te-fast` | Proportionate, low-latency bounded work (content rail) | Temperance task portfolio |
| `te-build` | Tool-capable reversible execution | Temperance task portfolio |
| `te-reason` | Deliberation, assumptions, and alternatives (content rail) | Temperance task portfolio |
| `te-validate` | Multi-model challenge and synthesis with tools | Temperance fusion council |
| `te-creative` | Creative brief and artifact planning (text rail) | Native media workflow; not a chat fallback |
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

The five task portfolios encode the operating philosophy in their
operator-facing descriptions and strategy settings: proportion before power,
reversible agency, explicit uncertainty, and synthesis over unexamined
consensus. The OpenCode flow plugin continues to add the full Temperance/ISA
context at the tool-loop boundary; OmniRoute remains responsible for target
health, failover, and model execution.

Stage-scoped PAI skills, MCP lanes, and knowledge pointers are documented in
[`docs/temperance-capability-fabric.md`](./temperance-capability-fabric.md).
That seam is client-owned: OmniRoute routes the selected portfolio but does not
execute skills, authorize MCP calls, or become the PAI memory store.

Native probes confirm that `te-build` and `te-validate` return function-call
envelopes. The Antigravity-backed `te-fast` and `te-reason` routes are
deliberation/content rails: their provider adapter may return prose even when
the request supplies a forced tool choice, so the picker advertises
`tool_call=false` for those two modes and the orchestrator uses `te-build` or
`te-validate` whenever workspace tools are required.

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

Review or apply the governed portfolio set through the authenticated local
dashboard API. The default is a dry-run; `--apply` snapshots settings, the
current combo inventory, and the live catalog before creating anything. The
script refuses collisions and verifies that global `activeCombo` stays
unchanged:

```bash
scripts/omniroute-temperance-combos.sh
scripts/omniroute-temperance-combos.sh --apply
```

Every apply prints a timestamped rollback snapshot. If a native probe fails,
restore that snapshot with:

```bash
scripts/omniroute-temperance-combos.sh --rollback \
  .omniroute-backups/omniroute-combos-<timestamp>.json
```

Probe a named portfolio directly (the response is SSE even for a short
completion) and require a tool envelope on tool-capable lanes:

```bash
export OMNIROUTE_API_KEY=$(security find-generic-password \
  -a "$USER" -s 'OmniRoute Temperance API Key' -w)
curl -sS -H "Authorization: Bearer $OMNIROUTE_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"model":"te-build","messages":[{"role":"user","content":"Return exactly PORTFOLIO_OK."}],"max_tokens":32}' \
  http://127.0.0.1:20128/v1/chat/completions
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
