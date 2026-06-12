# Credits

Temperance Engine packages integration patterns around several tools and ideas. This repository does not claim ownership of those upstream projects.

## Runtime Surfaces

- [Personal AI Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure) by Daniel Miessler is the principal upstream inspiration for the PAI/Algorithm/ISA runtime pattern this package installs around.
- Claude Code and local Claude configuration surfaces. Claude Code is a product surface from Anthropic; this repo only ships local templates and does not redistribute Claude Code.
- [OpenCode](https://github.com/anomalyco/opencode) configuration and MCP surfaces.
- [OpenAI Codex CLI](https://github.com/openai/codex) local instruction and hook surfaces.
- [GitHub CLI](https://github.com/cli/cli) for optional repository creation and publishing.
- [Bun](https://github.com/oven-sh/bun) for the optional local Pulse compatibility server runtime.

## Search and Code Intelligence

- [CodeGraph](https://github.com/colbymchenry/codegraph) for local AST-backed code indexing and structural search. This repo references the local `codegraph` CLI but does not vendor it.
- [ripgrep](https://github.com/BurntSushi/ripgrep)-powered file and text search patterns where structural search is not required.

## Skills and Agent Routing

- Skill-cluster routing pattern built around hub/spoke skill organization, `skill-index.json`, active symlinks, and health checks.
- PAI-style ISA and Algorithm flow: current state to ideal state, criteria as tests, verification as done condition.

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
| CodeGraph | https://github.com/colbymchenry/codegraph | Local AST-backed structural code index. |
| peon-ping | https://github.com/PeonPing/peon-ping | Local voice notification pattern and script surface. |
| OpenCode | https://github.com/anomalyco/opencode | OpenCode config and MCP surface. |
| OpenAI Codex CLI | https://github.com/openai/codex | Codex local instruction surface and auth assumptions. |
| GitHub CLI | https://github.com/cli/cli | Public repo creation and publishing workflow. |
| Bun | https://github.com/oven-sh/bun | Runtime for the optional Pulse compatibility server. |
| ripgrep | https://github.com/BurntSushi/ripgrep | Fast literal file and content search model. |

## Local Session Work

This repo was shaped from a local integration session that verified:

- Algorithm `v6.3.0` activation guard.
- Local Pulse compatibility endpoint on `localhost:31337`.
- peon-ping phase mapping.
- skill-cluster health checks.
- `.agents` CodeGraph indexing and routing.
- OpenCode Augment disablement for blocked home and `.agents` retrieval paths.
