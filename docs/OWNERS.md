# Verified owners

One owner per concern. Display names: [ECOSYSTEM.md](ECOSYSTEM.md).
Ports and CLIs keep vendor identifiers.

This is the glove copy of the host owner table. Host live wiring: `~/.temperance_engine/docs/OWNERS.md`.

| Concern | Owner | Consumer, not a second owner |
|---|---|---|
| Models, keys, quotas, failover | **Mercurius** / OmniRoute `:20128` | TE router, surfaces |
| Task type → combo | TE router (`phase-combo-map.json`) | Skills, CLAUDE.md |
| Repo planning / execute | **Opus** / GSD `.planning/` (do not fork 1.42.3) | `/gsd:*` wrappers, next-wave |
| Algorithm acceptance ledger | ISA (`ISA.md` or `MEMORY/WORK/*/ISA.md`) | Algorithm OBSERVE/VERIFY |
| Session goal loop | `/gsd:goal` → `.temperance/goal.json` | Not a third planner |
| Event projection | **Vas** (`vas.localhost` / `:8766`) | Speculum glass only |
| Glass | **Speculum** (`speculum.localhost` / IAB `:5173`) | Does not plan |
| Phase furnace | **Athanor** (`athanor.localhost` / `:31337`) | peon packs; non-phase → **Vox** `:8888` |
| Human book | **Liber** (GitHub Project) | Speculum showcases; Liber is the board |
| File/bash guard | SecurityPipeline (v5) + ContainmentGuard | SecurityValidator stays **Read-only** |
| Hook bells | **Campana** (peon-ping) | — |
| Skill resolution | **Arcanum** / `skill-index.json` | Hubs in `~/.agents/skills` only |
| Versions / tags / changelog | Glove `VERSION` + [release-control.md](release-control.md) | Host `~/.temperance_engine/VERSION` tracks install generation |

## Not doubles

- **ISA vs GSD** — different jobs. GSD plans the repo. ISA is the Algorithm test ledger.
- **Temperance vs OmniRoute** — one ecosystem, two version planes. OmniRoute pin is in [COMPATIBILITY.md](COMPATIBILITY.md).
- **Pulse vs peon-ping vs :8888** — Algorithm curl → Pulse packs → optional ElevenLabs forward. Do not collapse; v6.3.0 requires Pulse `:31337`.

## Do not

- Remove ISA, PromptProcessing, ISASync, CheckpointPerISC, or Pulse `:31337`.
- Scan `~/.agents/skill-clusters/skills`.
- Copy `~/.omniroute/storage.sqlite` as a backup.
- Fork GSD 1.42.3 workflows.
- Treat Speculum as an editable Liber board.
