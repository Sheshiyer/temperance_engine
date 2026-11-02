# Temperance Engine: the operator layer and its tooling

Date: 2026-11-02. This source-backed overview covers release 0.8.0 and
review-branch additions. Optional-profile tooling metadata is a dated snapshot.

## Core and selected profile

Temperance connects project context, reusable skills, workflows, model routing,
and verification across AI coding clients. The public product provides the
shared core. A personal or company profile selects its context and integrations.
The established V4 metaphor calls the product the glove and the selected profile
the hand. A profile is optional. Its private memory and configuration stay with
its owner.

The current release is **0.8.0**. The portable phase kernel and read-only
Vestibule handler are review-branch source additions. Their fixtures verify
source behavior. They do not prove installation or real host callbacks. The
[capability matrix](plans/2026-11-02-portable-capabilities.md) records each boundary.

The combined source suite passed 103 tests with 544 assertions. This is source
evidence, rather than acceptance of a running personal installation.

## Seven phases and five Koshas

The work loop is Observe, Think, Plan, Build, Execute, Verify, then Learn. An ISA
records the project's criteria and verification evidence. Process completion
does not itself authorize execution or assert acceptance.

Koshas name work layers in this architecture. They are explanatory categories,
not security boundaries. The public
[phase metadata](../package/router/phase-projection.v4.ts) gives this mapping:

| Kosha | Plain meaning | Main phases |
|---|---|---|
| Annamaya | Material substrate: files, configuration, artifacts | Build |
| Pranamaya | Execution lifecycle and telemetry | Execute |
| Manomaya | Selected context and memory | Observe |
| Vijnanamaya | Reasoning, planning, judgment | Think, Plan, Verify |
| Anandamaya | Purpose and learning | Learn |

A clear distinction connects these layers. Evidence informs a plan. An admitted
worker performs the change. Verification checks the result against the ISA.
Learning proposes what to retain. Neither a diagram nor a persuasive
explanation supplies a missing observation or approval.

## Six advisory organs

The public composition contracts declare six advisory roles. They sit around
the loop and retain their own dependencies and evidence limits.

| Organ | Advisory purpose | Current public evidence |
|---|---|---|
| Vestibule | Orient a session with selected context | Draft injected read-only handler; synthetic consumer readback |
| Adytum | Interpret selected context while preserving its sources | Declaration; portable adapter held |
| Nutrix | Turn outcomes into reviewable learning proposals | Declaration; portable adapter held |
| Auspex | Diagnose prerequisites and health | Declaration; portable adapter held |
| Circulator | Review accumulated outcomes and proposals | Declaration; portable adapter held |
| Praeceptor | Suggest skills or workflow improvements | Declaration; portable adapter held |

Adytum depends on Vestibule. Circulator and Praeceptor depend on Nutrix.
Declarations do not activate inference, repair, memory writes, or schedules.
The Vestibule source accepts bounded context through explicit callbacks. Actual
host linkage and a durable ledger need separate proof.

## Installed Claude mods, plugins, and skills

The selected Claude profile has 15 installed plugin records. Five were enabled
in the current CLI readback on this date:

| Plugin | Version | Role |
|---|---|---|
| feature-dev | 1.0.1 | Feature exploration, architecture, quality review |
| rust-analyzer-lsp | 1.0.0 | Rust language intelligence when its server is available |
| supabase | 0.1.16 | Supabase development guidance and optional service tools |
| superpowers | 7.0.0 | Planning, testing, debugging, review workflows |
| temperance-rail | 0.11.0 | Private profile mod for phase, dispatch, provenance projections |

The [complete plugin metadata](plans/2026-11-02-claude-tooling-metadata.json)
includes the ten disabled records and project scopes. A project installation
record does not establish applicability to this workspace. The private rail
implementation is not distributed with the public product.

Installed, enabled, available to a session, invoked, and accepted describe
different evidence. This inventory does not claim that every plugin ran here.
Official marketplace plugins are attributed to
[Anthropic's marketplace](https://github.com/anthropics/claude-plugins-official).
Superpowers workflows come from [obra/superpowers](https://github.com/obra/superpowers).

Skills provide reusable behavior. Hub-first discovery exposes selected cluster
entries and loads relevant spokes on demand. The
[exposed skill appendix](plans/2026-11-02-claude-exposed-skills.json) records names
and discovery metadata only. It exports no skill bodies or personal corpus.
A catalog entry is not an installed dependency or an executed workflow.

## Working modes and client controls

PAI/Temperance defines MINIMAL, NATIVE, and ALGORITHM working modes. E1 through
E5 describe effort inside ALGORITHM. E4 and above use the deeper planning lane
where the selected host policy supports it. These are Temperance conventions.

Claude Code has separate tool permission controls. Its Manual/default,
acceptEdits, plan, and auto settings govern client behavior. They do not replace
Temperance's working modes. See the
[official permission documentation](https://code.claude.com/docs/en/permissions)
for current client rules and availability.

## Routing, clients, and third-party tools

OmniRoute owns provider connections, models, combos, and failover. The public
catalog pins version 3.8.51. Phloem is a selected hosted deployment. A configured
combo or S-tier seat does not prove which model served an attempt. A completed
request receipt supplies that attribution. Legacy 9Router repair stays separate.

OpenCode and Cursor are default instruction targets. Claude Code and Codex are
optional targets. Grok wrappers are optional.

PAI supplies the methodology. GSD supplies workflow structure. Superpowers
supplies reusable practices.
CodeGraph supports structural lookup, while ripgrep supports literal search.

The [credits and tooling inventory](../CREDITS.md) lists owners, source links,
versions, and optional status. It includes peon-ping, Pulse compatibility,
portless, STE, Hermes A2A, Obsidian REST, Apple Mail MCP, and Cloudflare tunnels.
These integrations need their own installation, credentials, and health proof.

Package tooling includes Bun and TypeScript. Direct package dependencies
include OpenTUI, Ajv, and pg in their respective packages. The separate website uses React, GSAP, Vite, and
Vercel hosting.

The film uses Canvas2D, Bun, Chromium, and FFmpeg. Its three new scene callbacks were refined through a selected Phloem route whose completed response reports Opus5.5. [Production provenance](../package/showreel/architecture-30s/PRODUCTION-PROVENANCE.json) separates source generation from local capture, encoding, and runtime acceptance.
HyperFrames evaluation does not establish film use. Historical NotebookLM
research is retained with no new generation claimed. This inventory is not a
transitive software bill of materials.
