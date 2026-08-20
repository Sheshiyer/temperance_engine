# Temperance Engine Codex Guidance

First visible line for PAI-formatted responses: `NOESIS`.

If `.planning/` exists, prefer `/gsd:progress` then the next `/gsd:*`. Run `/gsd:doctor` for host truth. `/gsd:*` already binds a mode — do not quiz MINIMAL/NATIVE/ALGORITHM in a reply. A real picker is only for a bare first prompt with no mode. Then ChatGPT IAB (Codex) to `http://127.0.0.1:5173`. Do not fork GSD.

Use the current-state to ideal-state loop. Keep verification evidence before completion claims.

For `.agents` and skill-cluster structural questions, use CodeGraph with `projectPath: "$HOME/.agents"`; avoid Augment/codebase-retrieval for `$HOME` and `$HOME/.agents`.

Claude Code, Claude Pro/Max, Anthropic auth, and specific model access are optional. Do not block completion solely because a Claude-only advisor cannot run.
