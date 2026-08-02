# OmniRoute runtime integration

Temperance's former 14-entry `MODEL_CATALOG` was a local dispatch scaffold. It
was not OmniRoute's provider catalog. The current boundary is:

1. Temperance's shared classifier decides whether work is inline or external.
2. General external work prefers `omniroute:temperance-coding`; independent
   fleet tasks explicitly select `omniroute:te-dispatch`.
3. Codex supplies the agent/tool loop while OmniRoute supplies the model API.
4. OmniRoute's named combos own provider/model failover; Temperance owns which
   combo is appropriate for the task.
5. `temperance-coding` is the relay's compatibility rail, while
   `te-algorithm` is the S-only Algorithm coordinator. `te-fast`, `te-build`,
   `te-reason`, `te-validate`, and `te-creative` are the five governed task
   portfolios. `te-plan` and `te-dispatch` are bounded helper roles.
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

The OmniRoute server itself also needs boot persistence on macOS (upstream
`omniroute autostart` covers Linux/systemd only). Install the router
LaunchAgent — it stops any manually started daemon so the agent owns the
port, runs `omniroute serve` under launchd supervision with `KeepAlive`
(crash recovery), and verifies API health after bootstrap:

```bash
scripts/omniroute-autostart-launchd.sh install
scripts/omniroute-autostart-launchd.sh status
```

Note: the agent runs OmniRoute under the Homebrew Node (`/opt/homebrew/bin`
first in the agent PATH). Rebuild native modules with that same Node after a
Homebrew Node upgrade: `cd /opt/homebrew/lib/node_modules/omniroute/dist &&
PATH="/opt/homebrew/bin:/usr/bin:/bin" npm rebuild better-sqlite3`.

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

The relay is intentionally local and optional. If it is stopped, choose an
explicit curated `omniroute/te-*` picker entry, or use the `temperance-route` /
`temperance-batch` CLI rails. The broader provider-owned catalog remains
available to those CLI rails but is intentionally absent from the session
picker.

If the relay returns OmniRoute's `[502]: All accounts exhausted` response, the
Temperance routing seam is working but the selected combo has no usable target.
Use the named portfolio's native probe and repair its dashboard targets (or
temporarily select a verified direct alias such as `auto/best-coding`); the
relay intentionally preserves the upstream failure instead of silently
changing a governed portfolio.

The distinction is observable in OmniRoute call logs: `temperance-coding` is a
compatibility rail; `te-algorithm` is the S-only primary coordinator;
`te-fast`/`te-build`/`te-reason`/`te-creative` are priority portfolios; and
`te-validate` is a fusion council. `te-plan` protects the planner;
`te-dispatch` is the bounded round-robin B-tier worker fleet. An unavailable
S-tier coordinator fails visibly. It never silently degrades; the operator
must explicitly select the A-tier `temperance-continuity` profile backed by
`te-build`.
The writing fleet is
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
- Role combos: `te-algorithm` (S-only coordinator), `te-plan` (planner), and
  `te-dispatch` (B-tier fleet workers)
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

## Codex Spark fleet mode

`te-dispatch` starts with the exact catalog route
`codex/gpt-5.3-codex-spark`, then includes the existing Command Code, Kimi,
Grok, and Nebius workers. [OpenAI describes GPT-5.3-Codex-Spark](https://openai.com/index/introducing-gpt-5-3-codex-spark/)
as a text-only, 128k-context research preview with a separate rate limit.
Temperance therefore treats Spark as a low-latency targeted-coding capacity
slot, not the universal base model. The Codex adapter advertises a 128k window
and compacts at 108k whenever `te-dispatch` can select Spark.

There are two different scheduling decisions:

1. `temperance-batch` runs independent tasks concurrently and owns worktree
   isolation.
2. OmniRoute round-robins each new `te-dispatch` request across models, with
   per-model concurrency `2`, a 15-second queue wait, and failover before any
   same-target retry. The dispatch caller, rather than the OmniRoute combo,
   bounds queue depth because OmniRoute 3.8.x does not persist `queueDepth`.

Round-robin is initial model selection. Ordered fallback happens only after
that selected target is unavailable or fails. The dispatcher's direct Command
Code, Kimi, and Grok attempts are a second outage boundary used when the
OmniRoute gateway attempt itself fails.

Fleet tasks make the role explicit:

```json
[
  {
    "id": "router-tests",
    "task": "Add the bounded routing tests and report evidence.",
    "backend": "omniroute",
    "model": "te-dispatch"
  },
  {
    "id": "runtime-docs",
    "task": "Update the accepted runtime contract and verify links.",
    "backend": "omniroute",
    "model": "te-dispatch"
  }
]
```

```bash
temperance-batch --tasks tasks.json --concurrency 4 --worktree
```

For remote or Paseo-hosted sessions, the execution host must reach the same
OmniRoute instance that owns `te-dispatch`. Importing a project/session into
Paseo carries the session and project context; it does not copy the Mac
Keychain credential or local combo database. Configure
`TEMPERANCE_OMNIROUTE_BASE_URL=https://router.example/v1` and
`OMNIROUTE_API_KEY` in that remote project's environment, then verify its
`/v1/models` catalog exposes `te-dispatch` before dispatch. This host affinity
keeps local and remote runs on the same governed portfolio without copying
provider credentials into repository settings.

The lifecycle script is remote-capable too. Store
`TEMPERANCE_OMNIROUTE_ADMIN_PASSWORD` and `OMNIROUTE_API_KEY` as Paseo project
secrets, and set the non-secret project variables
`TEMPERANCE_OMNIROUTE_ADMIN_URL` and
`TEMPERANCE_OMNIROUTE_ADMIN_ORIGIN` to the remote router origin. Then run:

```bash
scripts/omniroute-temperance-fleet.sh --dry-run
scripts/omniroute-temperance-fleet.sh --apply
```

When those environment credentials are absent on macOS, the lifecycle falls
back to the existing Keychain services. Secret values must never be placed in
task JSON, repository settings, logs, or command arguments.

Each run creates a mode-`600`, schema-version-3 snapshot before any mutation.
Apply records the exact combo ids it successfully created or updated. Rollback
uses those identities—not names—skips actions that were unchanged, preserves a
same-name operator replacement, and fails before any mutation if a recorded
body has drifted since apply:

```bash
scripts/omniroute-temperance-fleet.sh --rollback \
  .omniroute-backups/omniroute-fleet-<timestamp>-<pid>.json
```

The lifecycle unsets project-secret variables before invoking `curl`; login
and inference credentials are passed through temporary mode-`600` payload and
header files that are removed when the process exits.

## OpenCode session profiles and model picker

OpenCode starts with one primary profile, not a copy of OmniRoute's entire
catalog. The persisted configuration sets `enabled_providers` to exactly
`omniroute` and `temperance`, and explicitly describes only 14 governed model
IDs. `temperance-auto` remains the default; every other picker entry is an
operator override that bypasses automatic classification. In other words, the
picker remains a direct model override surface inside the curated boundary.

The four primary session profiles are:

| Agent profile | Bound model | Contract |
| --- | --- | --- |
| `temperance-auto` | `temperance/temperance-auto` | Classify NATIVE versus ALGORITHM at the relay |
| `temperance-native` | `omniroute/te-fast` | One bounded step; no orchestration |
| `temperance-algorithm` | `omniroute/te-algorithm` | S-tier planning, complex building, and orchestration |
| `temperance-continuity` | `omniroute/te-build` | Explicit A-tier continuation after an S-tier miss |

Algorithm sessions may delegate one level to `temperance-planner`
(`te-plan`), `temperance-worker` (`te-dispatch`), and
`temperance-validator` (`te-validate`). Workers start on B-tier capacity and
may escalate B→A→S when evidence demands it. A downgrade starts a new task ID;
no in-flight task silently changes tier.

The local Mac configuration exposes this exact 14-entry set:

| Picker entry | Intended use | Governance |
| --- | --- | --- |
| `temperance/temperance-auto` | Automatic NATIVE/ALGORITHM selection | Default session rail |
| `omniroute/te-algorithm` | Complex planning, building, and orchestration | S-only; explicit failure |
| `te-fast` | Proportionate, low-latency bounded work (content rail) | Temperance task portfolio |
| `te-build` | Tool-capable reversible execution | Temperance task portfolio |
| `te-reason` | Deliberation, assumptions, and alternatives (content rail) | Temperance task portfolio |
| `te-plan` | Planner helper | A/S planning rail |
| `te-validate` | Multi-model challenge and synthesis with tools | Temperance fusion council |
| `te-dispatch` | Parallel independent grunt work | B-tier bounded worker fleet |
| `te-creative` | Creative brief and artifact planning (text rail) | Native media workflow; not a chat fallback |
| `te-write` | Draft generation | Governed writing rail |
| `te-write-critique` | Editorial challenge | Governed writing council |
| `te-write-research` | Claim grounding | Governed research council |
| `te-write-media` | Image-brief planning | Governed media planner |
| `codex/gpt-5.3-codex-spark` | Low-latency targeted coding | Direct B-tier capacity slot |

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

The full inventory remains available from the live API; it is intentionally
not copied into OpenCode's picker because the catalog is provider-owned and
changes over time. New connections such as AGY, Ollama Cloud, and OpenCode Zen
enter as candidates; connection presence alone grants no S/A/B promotion:

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

Apply and validate the persisted picker/session policy with one rollout ID:

```bash
TEMPERANCE_ROLLOUT_ID=<rollout-id> \
  scripts/configure-opencode-session-profiles.sh --apply
scripts/configure-opencode-session-profiles.sh --validate
```

Validation compares the exact effective alias set, agent bindings, model
limits, and provider allowlist—not only a model count. After applying, restart
or refresh OpenCode so a fresh process resolves the new profile and picker.
Missing IDs are unavailable; they are never silently substituted.

For relay-independent break-glass work, bypass OpenCode, its relay, OmniRoute,
and the project rule surface with an ephemeral read-only Codex CLI session:

```bash
codex exec --ephemeral --ignore-rules --ignore-user-config \
  --skip-git-repo-check --sandbox read-only \
  "Describe the required repair without changing files."
```

This command is an operator action, not an automatic S-tier downgrade. Record a
new task ID before continuing work on that rail. The July 29 live canary
returned `BREAKGLASS_OK` even with the OmniRoute base forced to an unreachable
port. At the same checkpoint, Command Code was credit-exhausted, Kimi did not
complete its bounded canary, and Grok no longer advertised the configured
`grok-build` ID; those three rails remain detected fallbacks, not
operator-ready break-glass guarantees.

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
Paseo/remote sessions must set these variables on their execution host; imported
session metadata does not transport local Keychain secrets or combo state.
External Codex workers ignore the base user configuration by default while
retaining repository rules. The adapter supplies model, provider, endpoint,
wire API, approval policy, sandbox, and context limits explicitly, and resolves
OmniRoute authentication independently through the environment or Keychain.
Exact `TEMPERANCE_OMNIROUTE_CODEX_ISOLATED=0` opts out with an audit warning;
other values remain isolated. Worker tasks must be self-contained rather than
depending on ambient user PAI hooks or plugins. Dispatcher-owned run
directories and retained artifacts are owner-only without changing the umask
seen by worker-created repository or shared-cache files.
