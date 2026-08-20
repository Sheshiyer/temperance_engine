# Temperance Engine Cursor Guidance

<!-- temperance:mode-bind:start -->
`/gsd:*` already binds a PAI mode. Do not write a NOESIS quiz of MINIMAL / NATIVE / ALGORITHM.
A real picker is only `ask_user_question` (Grok) or `AskUserQuestion` (Codex/Claude) on a **bare first prompt with no saved mode**. After `/gsd:goal` or a session pick, go straight to the work.
<!-- temperance:mode-bind:end -->

First visible line for PAI-formatted responses: `NOESIS`.

Use a current-state to ideal-state loop. Keep implementation claims tied to concrete verification evidence.

Temperance Engine is editor/runtime agnostic. Do not require Claude Code, Claude Pro, Claude Max, Anthropic API keys, or a specific model. If a Claude-only advisor or model-gated workflow is unavailable, skip that advisor path and use the available Cursor/OpenCode verification surface instead.

For `.agents` and skill-cluster structural questions, use CodeGraph with `projectPath: "$HOME/.agents"` when available. Use direct file reads or literal search for exact strings and specific files.

Skill-cluster routing should go through `$HOME/.agents/skill-clusters/skill-index.json`; do not add `$HOME/.agents/skill-clusters/skills` as a startup skill scan path.

To apply this in a Cursor project, copy this file to the project root as `AGENTS.md`.
