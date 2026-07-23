# Temperance capability fabric

Temperance now treats PAI skills, MCP tools, and the PAI knowledge base as
three different capability classes around the seven-stage process. The stage
contract lives in
[`package/router/temperance-stage-contract.ts`](../package/router/temperance-stage-contract.ts).

## The boundary

```text
PAI stage controller
  -> stage capability packet (skills + MCP lane names + knowledge pointers)
  -> Codex / Claude / OpenCode client resolves and authorizes tools
  -> OmniRoute selects a named portfolio and provider/model
  -> client tool loop executes the work
  -> typed handoff records evidence and points to the next stage
```

OmniRoute is not a skill runner, MCP broker, or memory database. It receives a
model request and handles provider/model selection and gateway failover. The
client that owns the workspace must still expose MCP tools, enforce user
authorization, load the selected skill, and read the pointed-to knowledge.

## What each capability class contributes

| Class | What it contributes | What crosses the OmniRoute boundary |
|---|---|---|
| PAI skill | Procedure, constraints, prompts, and verification method | Skill name/version and a bounded context excerpt; never an unbounded skill dump |
| MCP lane | External data or an action such as CodeGraph, Figma, Vercel, RunwayML, Gmail, or Supabase | Tool schema and an explicit, client-authorized tool call; never implicit model authority |
| Knowledge | Prior decisions, project state, reflections, failures, and reusable facts | The handoff carries paths/pointers only; a client may retrieve a bounded, redacted excerpt for the model request, never the whole private memory tree |
| OmniRoute | Provider/model selection, combo strategy, health, quota, and failover | Route evidence, plan ID, correlation ID, and model output |

## Stage leverage map

The stage contract maps the current workstation’s useful lanes without making
them mandatory. A missing skill, MCP connection, or knowledge root is reported
as `missing`; it does not silently substitute another capability.

`portfolioStatus: "existing"` means the portfolio is declared by the local
Temperance workflow/portfolio manifests. It is not a live provider-health
claim: catalog availability, native probes, quota, and promotion receipts
remain separate runtime gates.

| Stage | Existing portfolio | High-value PAI/MCP lanes |
|---|---|---|
| Observe | `te-reason` | ContextSearch, ISA, FirstPrinciples, CodeGraph, Exa search, project ISA and planning pointers |
| Think | `te-reason` | SystemsThinking, Council, RedTeam, Exa deep search, PostHog when data evidence is needed |
| Plan | `te-plan` | writing-plans, ISA, CodeGraph, project planning, Google Drive references |
| Build | `te-build` | test-driven-development, subagent-driven-development, CodeGraph, GitHub context |
| Execute | `te-dispatch` | dispatching-parallel-agents, temperance-parallel-dispatch, CodeGraph, Chrome DevTools, Vercel, Supabase |
| Verify | `te-validate` | verification-before-completion, browser automation, CodeGraph, PostHog, Supabase, Vercel |
| Learn | `te-reason` today (dedicated `te-learn` is a future proposal) | ISA append, reflections, failures, reusable knowledge pointers; no MCP by default |

Creative work is a cross-stage lane: `te-creative` creates the brief and
context, then native RunwayML or ElevenLabs contracts create media artifacts.
Figma, Canva, Higgsfield, and Mermaid Chart are client-side design or
visualization tools; they should be selected by the skill cluster, not treated
as chat models.

Writing is a second cross-stage lane, bound to `noesis-writer-skill` and its
composition set (`layered-context-content-skill`, `visual-prompt-skill`,
`retrieval-skill`, `content-generator-skill`, `media-suggest-skill`,
`transcript-processor-skill`). `te-write` drafts sections sequentially,
`te-write-critique` scores drift and gates each commit, and `te-creative` is
reused for image planning. Its MCP surface is deliberately minimal — Exa
search for topical research only: vault source mining is client-side
filesystem work over the PARA vault, Meru retrieval is a skill rather than an
MCP lane, and brandmint/FAL image generation is client-side Python that never
crosses the OmniRoute boundary. Knowledge stays pointer-only as everywhere
else (brand docs, controlled vocabulary, and calibration corpus remain
vault-side paths). An ACP lane is declared but inactive for this workflow;
agent-protocol contracts require a separate principal-bound security design
before any implementation.

## Knowledge usage rules

The resolver recognizes these logical roots:

- `project-isa` — the acceptance constitution and preferences.
- `project-planning` — GSD execution state and ratified plans.
- `pai-knowledge` — reusable facts and ideas.
- `pai-work` — prior task ISAs, handoffs, and artifacts.
- `pai-learning` — reflections, failures, signals, and synthesis.
- `skill-index` — lazy-load skill discovery and cluster state.

It returns paths only. A client may then retrieve the smallest relevant,
redacted excerpt for the model request, but the typed handoff itself retains
only the pointer and provenance. The raw source stays outside OmniRoute and is
never copied into the handoff, route evidence, or telemetry. This is important because the current PAI knowledge directory is intentionally sparse;
the richer continuity surface is the work and learning archive. The system
should therefore use retrieval over pointers, not pretend OmniRoute owns a
complete knowledge base. The resolver’s canonicalization and symlink checks are
defense-in-depth for pointer discovery, not a sandbox or authorization layer;
the client must canonicalize and authorize again when dereferencing a pointer.

## Handoff contract

Every stage handoff carries the stage number, goal, ISA reference, capability
packet, memory pointers, decisions, artifacts, verification, open questions,
next stage, and route evidence. The validator rejects malformed transitions,
expanded knowledge bodies, unsupported capability execution fields, raw
transcripts, prompts, credentials, or secrets. A provider retry stays inside
the same stage; only a valid handoff advances the stage.

```bash
bun package/router/temperance-stage-contract.ts resolve verify \
  '{"skills":["ISA","browser-automation-core"],"mcp":["codegraph"],"knowledge":["project-isa"]}'

bun package/router/temperance-stage-contract.ts pointers "$PWD" "$HOME"
```

The command is an inspection and planning seam. It does not invoke an MCP
server, alter PAI memory, change an OmniRoute combo, or make a provider call.
