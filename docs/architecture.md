# Architecture

Temperance Engine is a local runtime integration package for OpenCode/Cursor-first operator workflows. It does not require Claude Code, Claude Pro/Max, Anthropic auth, Codex auth, or a specific model; Claude and Codex instruction surfaces are optional compatibility targets.

## Components

- Instruction surfaces: `AGENTS.md`, OpenCode guidance, Cursor guidance, and optional Claude/Codex guidance.
- Pulse compatibility: an optional local HTTP server that accepts phase notifications when Claude/Pulse compatibility is enabled.
- Voice adapter: optional peon-ping invocation by phase.
- Skill-cluster routing: resolver guidance and health-check conventions.
- CodeGraph routing: structural search for `$HOME/.agents`.

## Data Flow

1. The agent decides a phase.
2. The agent writes or follows instruction-surface rules.
3. If Pulse compatibility is enabled, the phase notification POSTs to `localhost:31337/notify`.
4. The optional compatibility server maps the phase to a peon-ping pack.
5. Code search for `.agents` uses CodeGraph instead of blocked semantic retrieval.

## Public Packaging Boundary

The repo ships templates and scripts. It does not ship private memories, live config backups, auth tokens, model credentials, Claude/Codex accounts, or audio packs.
