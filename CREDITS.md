# Credits

Temperance Engine packages integration patterns around several tools and ideas. This repository does not claim ownership of those upstream projects.

## Runtime Surfaces

- Claude Code and local Claude configuration surfaces.
- OpenCode configuration and MCP surfaces.
- Codex local instruction and hook surfaces.
- GitHub CLI for optional repository creation and publishing.

## Search and Code Intelligence

- CodeGraph for local AST-backed code indexing and structural search.
- Ripgrep-powered file and text search patterns where structural search is not required.

## Skills and Agent Routing

- Skill-cluster routing pattern built around hub/spoke skill organization, `skill-index.json`, active symlinks, and health checks.
- PAI-style ISA and Algorithm flow: current state to ideal state, criteria as tests, verification as done condition.

## Voice Feedback

- peon-ping style local sound notifications.
- Voice/audio packs are referenced, not bundled. Users must provide packs they have rights to use.

## Local Session Work

This repo was shaped from a local integration session that verified:

- Algorithm `v6.3.0` activation guard.
- Local Pulse compatibility endpoint on `localhost:31337`.
- peon-ping phase mapping.
- skill-cluster health checks.
- `.agents` CodeGraph indexing and routing.
- OpenCode Augment disablement for blocked home and `.agents` retrieval paths.
