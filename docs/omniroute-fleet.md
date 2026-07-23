# Temperance fleet and creative workflows

The fleet is deliberately role-based. `classify-task.sh` remains the only
task classifier; this document describes what happens after classification.
The role layer is [package/router/temperance-workflows.json](../package/router/temperance-workflows.json).

## Planner and orchestrator rail

GitHub and Codex are separate live connections on this Mac:

1. `github/gpt-5.4` is the default planning model. It passed a live tool-call
   probe and is kept separate from worker fan-out.
2. `codex/gpt-5.6-sol-max` is the escalation model for difficult plans. It is
   exposed by the Codex OAuth connection through OmniRoute, not by the
   `command-code` provider.
3. Nebius Qwen is the quota-conscious planning fallback.

`te-plan` is the named chat combo for this role. The planner produces a frozen
task graph, acceptance criteria, and route hints; it does not become a second
classifier and it does not directly mutate the workspace.

## Temperance Dispatch fleet

`te-dispatch` is a worker portfolio, not the planner. Independent tasks are
sharded across distinct failure domains and capabilities:

| Worker role | OmniRoute target | Direct CLI fallback |
| --- | --- | --- |
| Fast worker | `command-code/deepseek/deepseek-v4-flash` | Command Code DeepSeek Flash |
| Coding worker | `command-code/moonshotai/Kimi-K2.7-Code` | Kimi Code |
| Build worker | `grok-cli/grok-build` | Grok Build |
| Backbone worker | `nebius/Qwen/Qwen3-235B-A22B-Instruct-2507` | Claude fallback if all external rails fail |

Health, quota, capability, latency, and circuit observations rank eligible
candidates deterministically. A provider being listed is not enough: it must
pass the relevant native probe. The current live probes passed for the four
targets above, while the Kimi Coding OAuth connection itself is currently
quota-banned; the Kimi API-key route remains active.

This protects GitHub/Codex/Claude limits: planner requests are not consumed by
worker fan-out, and dispatch can use lower-cost or separately entitled rails.

## Creative workflow

Creative work has two phases:

```text
skill-cluster + ISA pointers
  -> te-creative creative brief planner
  -> native ElevenLabs / RunwayML contract
  -> artifact validation and policy checks
  -> evidence pointer and output handoff
```

`te-creative` is text planning only. ElevenLabs is called through
`/v1/audio/speech`; RunwayML is called through `/v1/videos/generations`. Their
models remain native media targets because a coding combo cannot safely express
audio/video payloads, asynchronous jobs, binary artifacts, or media cost
limits. OmniRoute's catalog reports these endpoint capabilities; they are not
evidence that a chat completion will work.

The full workflow must resolve the relevant taste/design skill cluster, inject
Temperance context and ISA pointers, create a brief, call the native provider,
validate the artifact, and record a reversible evidence pointer. Running a
skill without this context handoff is explicitly not the creative workflow.

## Verify the live state

```bash
scripts/omniroute-connections.sh --json | jq .
scripts/omniroute-check.sh --json | jq .
bun package/router/temperance-workflows.ts resolve planner MODEL_IDS...
```

Do not print API keys or provider tokens. Dashboard mutations remain
snapshot-first, collision-guarded, and rollbackable; never set a global
`activeCombo` as part of this workflow.

## Why `gpt-5.6-sol-max` is not a universal API model

On this machine, `codex/gpt-5.6-sol-max` and its `cx/` alias are live and
tool-capable. That does **not** mean `command-code/gpt-5.6-sol-max` or a direct
OpenAI API key can use the same string:

- `codex/*` is backed by the Codex OAuth connection and its entitlement.
- `command-code/*` is a separate provider/quota surface; the live probe for
  `command-code/gpt-5.6-sol` returned `PREMIUM_CREDITS_EXHAUSTED`, while the
  `*-max` spelling is rejected as an unrecognized provider model.
- OmniRoute's live catalog is an availability/metadata surface, not a promise
  of quota, plan access, or semantic equivalence across providers.
- The current Codex catalog reports a 500,000-token context window, 372,000
  maximum input tokens, 128,000 maximum output tokens, reasoning/thinking, and
  tool calling. Those are route limits, not an unlimited “max” allowance.
- OpenAI's product entitlement, Codex access, and API billing are separate;
  rollout, plan/workspace controls, regional support, rate limits, safety
  checks, and usage allowances can all deny a request even when a model name is
  visible. The API may expose Sol/Terra/Luna while a `max` suffix is only a
  Codex reasoning preset or gateway alias.

Therefore the planner treats GitHub, Codex, and Nebius as separate candidates,
probes the exact provider/model route, and falls back by role instead of
assuming that a model name is portable.
