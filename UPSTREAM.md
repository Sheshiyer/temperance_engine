# Upstream Links

Temperance Engine is an integration package. It connects local configuration surfaces and does not claim ownership over upstream tools.

## Verified GitHub Repositories

| Surface | Repository | Role |
|---|---|---|
| OpenCode | https://github.com/anomalyco/opencode | OpenCode configuration and MCP runtime surface. |
| Codex CLI | https://github.com/openai/codex | Local Codex instruction surface and OAuth-adjacent tooling assumptions. |
| GitHub CLI | https://github.com/cli/cli | Optional public repo creation and publishing. |
| Bun | https://github.com/oven-sh/bun | Runtime used by the optional Pulse compatibility server. |
| ripgrep | https://github.com/BurntSushi/ripgrep | Fast literal search pattern used by local tooling. |

## Referenced Non-Vendored Surfaces

- Claude Code: local Claude instruction and hook surfaces are referenced, not redistributed.
- CodeGraph: local `codegraph` CLI and index are referenced, not vendored.
- peon-ping: local script and sound packs are referenced, not vendored.
- skills.sh: `skills/temperance-engine/SKILL.md` is prepared as the marketplace-facing entry.

## Asset Notes

- `assets/banner.png` and `assets/icon.png` were generated for this repo through the local `codex-gpt-image` workflow.
- Voice/audio packs are intentionally excluded because users must provide packs they have rights to use.
