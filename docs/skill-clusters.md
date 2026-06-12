# Skill Clusters

Skill clusters keep a large skill library out of startup context while preserving discoverability.

## Canonical Home

```bash
$HOME/.agents/skill-clusters
```

## Key Files

- `skill-index.json`: canonical skill resolution map.
- `profiles.json`: active and deferred cluster profile.
- `scripts/tier.mjs`: active hub symlink enumerator.
- `scripts/skills-health.mjs`: structural health gate.
- `scripts/audit-refs.mjs`: stale reference audit.

## Rules

- Use active hub symlinks for startup enumeration.
- Resolve missing skills through `skill-index.json`.
- Do not scan `skill-clusters/skills` wholesale at startup.
- Activate deferred clusters only when a task genuinely needs them.

## Verification

```bash
cd "$HOME/.agents/skill-clusters"
npm run health
npm run audit-refs
npm run tier
```
