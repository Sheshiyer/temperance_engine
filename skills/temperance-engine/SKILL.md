---
name: "Temperance Engine"
description: "Install a local PAI operator runtime with skill-cluster routing, optional peon-ping voice feedback, and CodeGraph-first .agents search."
category: "Developer Tooling"
platforms:
  - macOS
  - Linux
  - Unix-like
tags:
  - pai
  - opencode
  - codex
  - codegraph
  - skills
  - installer
  - local-agent-runtime
homepage: "https://github.com/Sheshiyer/temperance_engine"
repository: "https://github.com/Sheshiyer/temperance_engine"
license: "MIT"
icon: "../../assets/icon.png"
banner: "../../assets/banner.png"
---

# Temperance Engine

Temperance Engine installs a reviewable local AI-operator runtime pattern: PAI-style instruction surfaces, guarded Algorithm flow, skill-cluster routing, optional peon-ping phase sounds, and CodeGraph-first structural search for `.agents`.

## What This Skill Helps With

- Set up PAI-style `NOESIS` instruction templates.
- Install a local Pulse compatibility server on `localhost:31337`.
- Reference local peon-ping voice packs without bundling audio.
- Preserve skill-cluster startup debloat through `skill-index.json` routing.
- Route `.agents` structural lookup through CodeGraph instead of blocked home-directory semantic retrieval.
- Verify installation and rollback surfaces.

## Install

```bash
git clone https://github.com/Sheshiyer/temperance_engine.git
cd temperance_engine
./install.sh
./verify.sh
```

## Safe Install Options

```bash
./install.sh --dry-run
./install.sh --skip-voice
./install.sh --with-voice
```

## Voice Behavior

Voice is optional. Non-macOS systems skip it by default. macOS systems use a local peon-ping script only when it exists at:

```bash
$HOME/.claude/hooks/peon-ping/peon.sh
```

No sound packs are bundled. Users must provide packs they have rights to use.

## Phase Pack Map

| Phase | Pack |
|---|---|
| Native | `nier-2b` |
| Algorithm entry | `nier-2b` |
| Observe | `glados` |
| Think | `hal_2001` |
| Plan | `jarvis-mk2` |
| Build | `peon` |
| Execute | `nier-2b` |
| Verify | `cortana` |
| Learn | `sc_kerrigan` |

## Verification

```bash
./verify.sh
```

The verifier checks required files, shell syntax, documentation presence, and absence of hard-coded local username paths in the install surface.

## Credits

Temperance Engine links and credits upstream surfaces in `CREDITS.md` and `UPSTREAM.md`. It references OpenCode, Codex CLI, GitHub CLI, Bun, ripgrep, CodeGraph, Claude Code surfaces, peon-ping, and skills.sh without vendoring private or unclear-license assets.
