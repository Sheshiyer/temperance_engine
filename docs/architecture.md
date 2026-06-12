# Architecture

Temperance Engine is a local runtime integration package. It does not replace Claude, Codex, OpenCode, CodeGraph, or peon-ping. It wires them together through documented local config surfaces.

## Components

- Instruction surfaces: `AGENTS.md`, Claude template, OpenCode guidance, and Codex guidance.
- Pulse compatibility: a local HTTP server that accepts phase notifications.
- Voice adapter: optional peon-ping invocation by phase.
- Skill-cluster routing: resolver guidance and health-check conventions.
- CodeGraph routing: structural search for `$HOME/.agents`.

## Data Flow

1. The agent decides a phase.
2. The agent writes or follows instruction-surface rules.
3. The phase notification POSTs to `localhost:31337/notify`.
4. The compatibility server maps the phase to a peon-ping pack.
5. Code search for `.agents` uses CodeGraph instead of blocked semantic retrieval.

## Public Packaging Boundary

The repo ships templates and scripts. It does not ship private memories, live config backups, auth tokens, or audio packs.
