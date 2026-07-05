# Upstream Links

Temperance Engine is an integration package. It connects local configuration surfaces and does not claim ownership over upstream tools.

## Verified GitHub Repositories

| Surface | Repository | Role |
|---|---|---|
| Personal AI Infrastructure | https://github.com/danielmiessler/Personal_AI_Infrastructure | Main PAI/Algorithm/ISA inspiration and upstream conceptual root. |
| GSD Core | https://github.com/open-gsd/gsd-core | Recommended workflow backbone (Discuss→Plan→Execute→Verify→Ship); referenced, not vendored. |
| CodeGraph | https://github.com/colbymchenry/codegraph | Local AST-backed structural code index for `.agents`. |
| peon-ping | https://github.com/PeonPing/peon-ping | Local AI-agent voice notification pattern and script surface. |
| OpenCode | https://github.com/anomalyco/opencode | OpenCode configuration and MCP runtime surface. |
| Cursor Rules | https://cursor.com/docs/rules | Cursor project rules and AGENTS.md guidance surface. |
| Codex CLI | https://github.com/openai/codex | Optional local Codex instruction surface. |
| GitHub CLI | https://github.com/cli/cli | Optional public repo creation and publishing. |
| Bun | https://github.com/oven-sh/bun | Runtime used by the optional Pulse compatibility server. |
| ripgrep | https://github.com/BurntSushi/ripgrep | Fast literal search pattern used by local tooling. |

## Referenced Non-Vendored Surfaces

- Claude Code: optional local Claude instruction and hook surfaces are referenced, not redistributed.
- CodeGraph: local `codegraph` CLI and index are referenced, not vendored.
- peon-ping: local script and sound packs are referenced, not vendored.
- skills.sh: `skills/temperance-engine/SKILL.md` is prepared as the marketplace-facing entry.

## Asset Notes

- `assets/banner.png` and `assets/icon.png` were generated for this repo through the local `codex-gpt-image` workflow.
- Voice/audio packs are intentionally excluded because users must provide packs they have rights to use.
