# Credits

Themed page: [docs/site/credits.html](docs/site/credits.html) · library: [docs/index.html](docs/index.html)

Temperance Engine packages integration patterns around several tools and ideas. This repository does not claim ownership of those upstream projects.

## Runtime Surfaces

- [Personal AI Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure) by Daniel Miessler is the principal upstream inspiration for the PAI/Algorithm/ISA runtime pattern this package installs around.
- [GSD Core](https://github.com/open-gsd/gsd-core) by open-gsd (MIT) is the recommended workflow backbone whose Discuss→Plan→Execute→Verify→Ship phases map onto the PAI flow; referenced, not vendored.
- [OpenCode](https://github.com/anomalyco/opencode) configuration and MCP surfaces.
- [Cursor rules](https://cursor.com/docs/rules) and `AGENTS.md` project guidance surfaces.
- Claude Code and local Claude configuration surfaces are optional compatibility targets. Claude Code is a product surface from Anthropic; this repo only ships opt-in local templates and does not redistribute Claude Code.
- [OpenAI Codex CLI](https://github.com/openai/codex) local instruction and hook surfaces as optional compatibility targets.
- [GitHub CLI](https://github.com/cli/cli) for optional repository creation and publishing.
- [Bun](https://github.com/oven-sh/bun) for the optional local Pulse compatibility server runtime.

## Search and Code Intelligence

- [CodeGraph](https://github.com/colbymchenry/codegraph) for local AST-backed code indexing and structural search. This repo references the local `codegraph` CLI but does not vendor it.
- [ripgrep](https://github.com/BurntSushi/ripgrep)-powered file and text search patterns where structural search is not required.

## Skills and Agent Routing

- Skill-cluster routing pattern built around hub/spoke skill organization, `skill-index.json`, active symlinks, and health checks.
- PAI-style ISA and Algorithm flow: current state to ideal state, criteria as tests, verification as done condition.
- [Simplified Technical English](https://github.com/0xpili/simplified-technical-english) by 0xpili (MIT) is the optional ASD-STE100 writing skill behind `./install.sh --with-ste`. It is fetched at a pinned commit, not vendored. `package/ste-check/` is a TE-owned bun port of its check script. The ASD-STE100 word list stays in the upstream skill; see `docs/ste.md`.

## Voice Feedback

- [peon-ping](https://github.com/PeonPing/peon-ping) style local sound notifications.
- Voice/audio packs are referenced, not bundled. Users must provide packs they have rights to use.

## Public Assets

- `assets/banner.png` and `assets/icon.png` were generated for this repository with the local `codex-gpt-image` workflow using Codex OAuth and GPT Image tooling.
- The generated assets are included under this repository's MIT license unless a future replacement asset specifies different terms.

## GitHub Repositories Linked

| Project | Link | Why it matters |
|---|---|---|
| Personal AI Infrastructure | https://github.com/danielmiessler/Personal_AI_Infrastructure | PAI/Algorithm/ISA runtime inspiration. |
| GSD Core | https://github.com/open-gsd/gsd-core | Recommended workflow backbone; Discuss→Plan→Execute→Verify→Ship maps onto the PAI flow. |
| CodeGraph | https://github.com/colbymchenry/codegraph | Local AST-backed structural code index. |
| peon-ping | https://github.com/PeonPing/peon-ping | Local voice notification pattern and script surface. |
| OpenCode | https://github.com/anomalyco/opencode | OpenCode config and MCP surface. |
| Cursor Rules | https://cursor.com/docs/rules | Cursor project rules and AGENTS.md guidance surface. |
| OpenAI Codex CLI | https://github.com/openai/codex | Optional Codex local instruction surface. |
| GitHub CLI | https://github.com/cli/cli | Public repo creation and publishing workflow. |
| Bun | https://github.com/oven-sh/bun | Runtime for the optional Pulse compatibility server. |
| portless | https://github.com/vercel-labs/portless | Named `.localhost` URLs for Speculum/Vas/Athanor/Mercurius. Referenced, not vendored. |
| Simplified Technical English | https://github.com/0xpili/simplified-technical-english | Optional ASD-STE100 writing skill and source of the bun STE checker port. Referenced, not vendored. |
| ripgrep | https://github.com/BurntSushi/ripgrep | Fast literal file and content search model. |

## Local Session Work

This repo was shaped from a local integration session that verified:

- Algorithm `v6.3.0` activation guard.
- Local Pulse compatibility endpoint on `localhost:31337`.
- peon-ping phase mapping.
- skill-cluster health checks.
- `.agents` CodeGraph indexing and routing.
- OpenCode Augment disablement for blocked home and `.agents` retrieval paths.
- Cursor project-rule guidance that does not require Claude Code, Claude Pro/Max, Anthropic auth, or a specific model.

## Current routing and optional Claude profile

[OmniRoute](https://github.com/diegosouzapw/OmniRoute), maintained by its upstream
contributors, owns provider connections, model discovery, combos, and failover.
The public onboarding catalog pins version 3.8.51. Phloem is a selected hosted
OmniRoute deployment; it is not bundled with the portable core. Legacy 9Router
compatibility remains separate from the current guided default.

The founder-selected Claude profile has its own installed plugins. The dated
[plugin metadata](docs/plans/2026-11-02-claude-tooling-metadata.json) records
versions, scope, roles, sources, and enabled state. The
[exposed skill metadata](docs/plans/2026-11-02-claude-exposed-skills.json) records
names and discovery status only. These inventories do not make the personal
profile a portable dependency. Installation, enablement, session availability,
invocation, and accepted results are separate evidence levels.

| Installed plugin | Version | Current CLI state | Attribution and role |
|---|---|---|---|
| [superpowers](https://github.com/obra/superpowers) | 4.0.3 | disabled | superpowers-dev. Reusable planning, testing, debugging and review workflows. |
| visual-documentation-skills | 1.1.0 | disabled | mhattingpete-claude-skills. Optional visual HTML documentation and diagram skills. |
| rust-analyzer-lsp | 1.0.0 | enabled | claude-plugins-official. Rust language intelligence when the language server is available. |
| agent-sdk-dev | 1.0.1 | disabled | claude-plugins-official. Optional Claude Agent SDK development guidance. |
| [superpowers](https://github.com/obra/superpowers) | 7.0.0 | enabled | claude-plugins-official. Reusable planning, testing, debugging and review workflows. |
| feature-dev | 1.0.1 | enabled | claude-plugins-official. Feature exploration, architecture and quality-review workflow. |
| commit-commands | 1.0.1 | disabled | claude-plugins-official. Optional Git commit and pull-request command helpers. |
| [vercel](https://github.com/vercel/vercel-plugin) | 0.50.0 | disabled | claude-plugins-official. Optional deployment and web-application guidance. |
| playground | a7ba5b93db0c | disabled | claude-plugins-official. Optional interactive HTML explorers. |
| [supabase](https://github.com/supabase-community/supabase-plugin) | 0.1.16 | enabled | claude-plugins-official. Supabase development guidance and optional service tools. |
| claude-md-management | 1.0.0 | disabled | claude-plugins-official. Optional maintenance of CLAUDE.md instructions. |
| codex | 1.0.6 | disabled | openai-codex-plugin-cc. Optional Codex review or task-delegation integration. |
| [obsidian](https://github.com/kepano/obsidian-skills) | 1.0.1 | disabled; project-scoped record | obsidian-skills. Project-scoped Obsidian Markdown, Bases and Canvas skills. |
| [claude-mem](https://github.com/thedotmack/claude-mem) | 10.6.3 | disabled; project-scoped record | thedotmack. Project-scoped persistent-memory plugin; no store is read or promoted here. |
| temperance-rail | 0.11.0 | enabled | Private profile; metadata only. Personal-profile rail mod for phase, dispatch and provenance projections; private implementation is not distributed. |

The official marketplace source is
[Anthropic's Claude plugins repository](https://github.com/anthropics/claude-plugins-official).
Superpowers workflows come from [obra/superpowers](https://github.com/obra/superpowers).
Project-scoped installation records do not establish applicability to this
workspace. The private Temperance rail implementation is not distributed here.

## Package and launch production dependencies

| Surface | Declared tooling | Source and owner |
|---|---|---|
| Install surface | OpenTUI 0.5.11, Ajv 8.20.0; TypeScript 5.9.3 and Bun types 1.3.5 for development | [Package manifest](package/install-surface/package.json); [OpenTUI](https://github.com/anomalyco/opentui), [Ajv](https://github.com/ajv-validator/ajv), [TypeScript](https://github.com/microsoft/TypeScript), [Bun](https://github.com/oven-sh/bun) |
| Manifest bridge | pg ^8.23.0; pg types ^8.21.0 for development | [Package manifest](package/manifest-bridge/package.json); [node-postgres](https://github.com/brianc/node-postgres) and DefinitelyTyped contributors |
| Launch website | React and React DOM 18.3.1, GSAP 3.15.0, GSAP React 2.1.2; Vite 5.4.21, React plugin 4.3.4, parse5 7.3.0 for development | Separate website package manifest; [React](https://github.com/facebook/react), [GSAP](https://github.com/greensock/GSAP), [Vite](https://github.com/vitejs/vite), [parse5](https://github.com/inikulin/parse5); Vercel preview hosting |
| Original showreel | Canvas2D, Bun, Chromium, FFmpeg, procedural soundtrack | [Showreel source guide](package/showreel/README.md); [Chromium](https://www.chromium.org/), [FFmpeg](https://ffmpeg.org/) |

The original film loads Cormorant Garamond, DM Mono, and Space Grotesk through
[Google Fonts](https://fonts.google.com/). The exact family requests are in
[the film source](package/showreel/reel.html).

The website and film are separate launch assets. Website animation dependencies
are not film dependencies. HyperFrames was evaluated; evaluation alone is not
proof that a rendered film used it. Historical NotebookLM research remains a
dated research artifact, with no new run claimed by this editorial refresh.
This list covers declared direct packages and attributed integrations. It is
not a transitive software bill of materials or proof that every catalog entry
is installed or admitted on a host.

The new thirty-second architecture review adapts the original showreel artwork
and procedural score. Its [editable source](package/showreel/architecture-30s/README.md)
includes local Cormorant Garamond, Space Grotesk and DM Mono font subsets, with
their SIL Open Font License notices. See the [film notices](package/showreel/architecture-30s/THIRD-PARTY-NOTICES.md).

## Optional service integrations

The [public onboarding catalog](package/install-surface/src/onboarding/core-catalog.ts)
also lists Hermes A2A, Obsidian REST, Apple Mail MCP, and Cloudflare tunnel
integration slots. These are optional host integrations with separate owners,
credentials, installation, and health checks. Catalog presence does not make
them bundled services or prove accepted tool calls. See the
[native integration guide](docs/omniroute-native-integration.md) for their
ownership boundaries. The optional knowledge volume and personal memory remain
profile data; no personal corpus is included in this package.
