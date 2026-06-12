# Temperance Engine OpenCode Guidance

First visible line for PAI-formatted responses: `NOESIS`.

Use CodeGraph for structural search in `$HOME/.agents` and avoid Augment/codebase-retrieval for home-directory or `.agents` trees.

Skill-cluster routing should go through `$HOME/.agents/skill-clusters/skill-index.json`; do not add `$HOME/.agents/skill-clusters/skills` as a startup skill scan path.
