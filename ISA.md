---
project: temperance_engine
effort: E4
phase: verify
progress: 18/18
mode: public-package
---

## Problem

The local PAI, skill-cluster, peon-ping, and CodeGraph integration exists as a working machine-specific runtime, but it is not packaged into a public, reviewable, one-time installer.

## Vision

Temperance Engine gives a user a readable public repo that explains the runtime, installs the safe pieces, references optional local voice packs, and verifies the configuration without leaking private machine state.

## Out of Scope

Bundling private memory, credentials, backups, proprietary voice/audio packs, or forcing non-macOS voice behavior is out of scope.

## Constraints

- Paths must be generalized through `$HOME` and environment variables.
- Installer must create backups before modifying local config.
- Voice packs must be referenced, not vendored.
- Non-macOS devices must be able to skip voice.
- `~/.agents/skill-clusters/skills` must not be scanned wholesale at startup.

## Goal

Create a public-ready `Sheshiyer/temperance_engine` repository with install, verify, rollback, templates, and documentation for the custom runtime.

## Criteria

- [x] ISC-1: Repository contains `install.sh`.
- [x] ISC-2: Repository contains `verify.sh`.
- [x] ISC-3: Repository contains rollback guidance.
- [x] ISC-4: Installer uses `$HOME` or override variables, not hard-coded user paths.
- [x] ISC-5: Installer backs up existing files before writes.
- [x] ISC-6: Voice is optional and skipped on non-macOS by default.
- [x] ISC-7: Voice packs are referenced but not bundled.
- [x] ISC-8: PAI flow is documented.
- [x] ISC-9: Skill-cluster routing is documented.
- [x] ISC-10: Peon-ping pack mapping is documented pack-by-pack.
- [x] ISC-11: CodeGraph routing is documented.
- [x] ISC-12: Credits are documented.
- [x] ISC-13: skills.sh-facing skill card exists.
- [x] ISC-14: skills.sh metadata exists.
- [x] ISC-15: README includes banner, badges, architecture, and upload guidance.
- [x] ISC-16: Upstream GitHub repos are linked from credits or upstream docs.
- [x] ISC-17: Banner image exists.
- [x] ISC-18: Icon image exists.

## Test Strategy

| isc | type | check | threshold | tool |
|---|---|---|---|---|
| ISC-1 | file | `install.sh` exists | present | test |
| ISC-2 | file | `verify.sh` exists | present | test |
| ISC-3 | text | rollback docs mention backups | match | grep |
| ISC-4 | text | no hard-coded local username path in scripts | zero | grep |
| ISC-5 | text | backup function exists | match | grep |
| ISC-6 | shell | script syntax passes | zero errors | sh -n |
| ISC-7 | text | docs say packs are not bundled | match | grep |
| ISC-8 | file | `docs/pai-flow.md` exists | present | test |
| ISC-9 | file | `docs/skill-clusters.md` exists | present | test |
| ISC-10 | file | `docs/peon-ping-packs.md` exists | present | test |
| ISC-11 | file | `docs/codegraph-routing.md` exists | present | test |
| ISC-12 | file | `CREDITS.md` exists | present | test |
| ISC-13 | file | `skills/temperance-engine/SKILL.md` exists | present | test |
| ISC-14 | file | `skills.sh.json` exists | present | test |
| ISC-15 | text | README references banner and skills.sh | match | grep |
| ISC-16 | text | upstream repo links are present | match | grep |
| ISC-17 | file | `assets/banner.png` exists | present | test |
| ISC-18 | file | `assets/icon.png` exists | present | test |

## Features

| name | satisfies | depends_on | parallelizable |
|---|---|---|---|
| Installer scripts | ISC-1..ISC-7 | none | no |
| Documentation | ISC-8..ISC-12 | none | yes |
| Verification script | all | installer docs | no |

## Decisions

- Use a public repo that references voice assets instead of bundling them.
- Keep the first installer Mac-friendly but not Mac-required.
- Generalize paths through `$HOME` and override variables.
- Treat skills.sh readiness as a skill-card plus metadata layer, not a separate installer fork.
- Link only upstream GitHub repositories verified through `gh repo view`; leave CodeGraph as a referenced local CLI without inventing an unverified repo URL.

## Verification

- `./verify.sh` passed after checking required files, shell syntax, and hard-coded install paths.
- `bun build package/pulse-compat/compat-server.ts --target=bun` passed.
- `node package/skill-resolvers/skill_cluster_resolver.mjs` returned `skill-index-present` on the local system.
- `./install.sh --dry-run --skip-voice` completed without mutating live config and showed backup-first writes.
- `codex-gpt-image` generated `assets/banner.png` and `assets/icon.png` through Codex OAuth.
- `gh repo view` verified links for OpenCode, Codex CLI, GitHub CLI, Bun, and ripgrep.
