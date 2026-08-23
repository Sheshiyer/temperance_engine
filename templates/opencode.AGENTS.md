# Temperance Engine OpenCode Guidance

<!-- temperance:mode-bind:start -->
`/gsd:*` already binds a PAI mode. Do not write a NOESIS quiz of MINIMAL / NATIVE / ALGORITHM.
A real picker is only `ask_user_question` (Grok) or `AskUserQuestion` (Codex/Claude) on a **bare first prompt with no saved mode**. After `/gsd:goal` or a session pick, go straight to the work.
<!-- temperance:mode-bind:end -->

First visible line for PAI-formatted responses: `NOESIS`.

Use CodeGraph for structural search in `$HOME/.agents` and avoid Augment/codebase-retrieval for home-directory or `.agents` trees.

Skill-cluster routing should go through `$HOME/.agents/skill-clusters/skill-index.json`. Startup scan is **hubs only** (`$HOME/.agents/skills` orchestrator+core + preserve, GSD profile `standard`). Do not add `$HOME/.agents/skill-clusters/skills` as a startup skill scan path. Add a Thoughtseed git root with `thoughtseed-cockpit-add PATH --pin --te-init`. Execute stays Superset + Claude Code — not Codex App as a worker.

Claude Code, Claude Pro/Max, Anthropic auth, Codex auth, and specific model access are optional. If a Claude-only advisor path is unavailable, continue with OpenCode-native verification evidence.
