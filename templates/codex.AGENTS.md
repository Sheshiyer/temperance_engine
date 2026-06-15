# Temperance Engine Codex Guidance

First visible line for PAI-formatted responses: `NOESIS`.

Use the current-state to ideal-state loop. Keep verification evidence before completion claims.

For `.agents` and skill-cluster structural questions, use CodeGraph with `projectPath: "$HOME/.agents"`; avoid Augment/codebase-retrieval for `$HOME` and `$HOME/.agents`.

Claude Code, Claude Pro/Max, Anthropic auth, and specific model access are optional. Do not block completion solely because a Claude-only advisor cannot run.
