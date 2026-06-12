# Temperance Engine Runtime Guidance

Use `NOESIS` as the first visible line for PAI-formatted responses.

## PAI Runtime

- Prefer a current-state to ideal-state loop.
- Treat criteria as the verification surface.
- Keep handoff manual unless the user explicitly enables automation.
- Keep local PAI files under `${PAI_HOME:-$HOME/.claude}`.

## Skill Cluster Resolution

- The canonical skill-cluster home is `${AGENTS_HOME:-$HOME/.agents}/skill-clusters`.
- Resolve missing skills through `skill-index.json` before saying a skill does not exist.
- Do not scan `${AGENTS_HOME:-$HOME/.agents}/skill-clusters/skills` wholesale at startup.
- Validate with `npm run health`, `npm run audit-refs`, and `npm run tier` from the skill-clusters repo.

## Local `.agents` CodeGraph Routing

- For structural search about agent skills, skill-clusters, cluster scripts, or `.agents` code, use CodeGraph with `projectPath: "$HOME/.agents"`.
- Do not use Augment/codebase-retrieval for `$HOME` or `$HOME/.agents`; these surfaces can be blocked by dynamic-index security.
- Use direct file reads or text search only for literal text or specific files.
