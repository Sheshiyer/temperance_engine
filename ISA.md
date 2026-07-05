---
project: temperance_engine
effort: E4
phase: complete
progress: 34/34
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
- [x] ISC-19: Shell verification uses each script's declared interpreter.
- [x] ISC-20: Public/install surfaces contain no private local path patterns.
- [x] ISC-21: README rebuild pipeline path is configurable, not hard-coded to a local user path.
- [x] ISC-22: NotebookLM asset manifest stores repo-relative paths.
- [x] ISC-23: Default installer skips Claude template and Pulse server unless `--with-claude` is passed.
- [x] ISC-24: Default installer skips Codex template unless `--with-codex` is passed.
- [x] ISC-25: OpenCode and Cursor templates are installed by default.
- [x] ISC-26: Cursor ships both `AGENTS.md` guidance and `.cursor/rules/*.mdc` guidance.
- [x] ISC-27: Public docs state no Claude Pro/Max, Anthropic auth, or specific model is required.
- [x] ISC-28: `docs/parallel-dispatch.md` documents when to use superpowers:dispatching-parallel-agents vs GSD execute-phase/workstreams vs subagent-driven-development.
- [x] ISC-29: `docs/pai-flow.md` Execute phase references `docs/parallel-dispatch.md`.
- [x] ISC-30: `package/hooks/ParallelDispatchContext.hook.sh` exists and is advisory-only (never blocks, never triggers dispatch).
- [x] ISC-31: `--with-gsd` install flag exists, default OFF, and prints a reference-only note without vendoring GSD.
- [x] ISC-32: Temperance Engine owns exactly one preference store (`ISA.md`); GSD config and PAI steering/memory stay fully external and untouched except one read-only display read in `ParallelDispatchContext.hook.sh`, which never writes to `config.json`.
- [x] ISC-33: `tests/sandbox-install.sh` asserts installer layering in an isolated sandbox (real install, backups, dry-run safety, restore-from-backup, hook behavior, GSD gating) and never touches the real home directory.
- [x] ISC-34: `scripts/apply-identity.sh` attaches the Temperance identity block to the operator `AGENTS.md` surfaces: dry-run default, backup-first, idempotent, and reversible (`--remove`), proven by `tests/identity-tool.sh`.
- [x] ISC-35: `docs/pai-flow.md` contains the unified 7-phase decision table mapping each PAI phase to its gsd-core command(s), superpowers skill, and done-signal.
- [x] ISC-36: gsd-core (`open-gsd/gsd-core`) is documented as the recommended-default workflow backbone with an explicit superpowers-only fallback; `--with-gsd` remains detect-only (ISC-31 preserved).
- [x] ISC-37: `docs/parallel-dispatch.md` and `docs/multi-surface-architecture.md` are retired to redirect stubs pointing at `docs/pai-flow.md`; `package/conductor/routed-execute.sh` is removed.
- [x] ISC-38: `UPSTREAM.md` credits gsd-core with its current URL (`https://github.com/open-gsd/gsd-core`).

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
| ISC-19 | shell | root scripts and `scripts/*.sh` lint with declared shell | zero errors | sh/bash -n |
| ISC-20 | text | public/install surfaces contain no private local path denylist patterns | zero matches | grep |
| ISC-21 | text | `scripts/rebuild-readme.sh` uses `READMEREBUILD_PIPELINE` | match | grep |
| ISC-22 | text | `.readme-notebooklm/assets/manifest.json` uses repo-relative paths | zero private-path matches | grep |
| ISC-23 | shell | default dry-run reports Claude template and Pulse server skipped | match | install dry-run |
| ISC-24 | shell | default dry-run reports Codex template skipped | match | install dry-run |
| ISC-25 | shell | default dry-run reports OpenCode and Cursor template writes | match | install dry-run |
| ISC-26 | file | Cursor AGENTS and rules templates exist | present | test |
| ISC-27 | text | README and Cursor rule state Claude auth/model access is optional | match | grep |
| ISC-28 | file | `docs/parallel-dispatch.md` exists | present | test |
| ISC-29 | text | `docs/pai-flow.md` references `parallel-dispatch.md` | match | grep |
| ISC-30 | text | hook file never calls `exit 1` and contains no dispatch/Task invocation | zero matches | grep |
| ISC-31 | shell | default dry-run has no GSD install output; `--with-gsd` dry-run prints reference note | match | install dry-run |
| ISC-32 | text | hook contains no write/redirect (`>`, `>>`) targeting `config.json` | zero matches | grep |
| ISC-33 | shell | `sh tests/sandbox-install.sh` exits 0 with all assertions PASS | zero failures | run harness |
| ISC-34 | shell | `sh tests/identity-tool.sh` exits 0; tool has no unconditional write path and a `--remove` mode | zero failures | run test + grep |
| ISC-35 | text | `docs/pai-flow.md` has the unified 7-phase decision table | match | grep |
| ISC-36 | text | ISA.md/docs state gsd-core as recommended-default with superpowers-only fallback | match | grep |
| ISC-37 | text | retired docs are redirect stubs pointing at `pai-flow.md`; conductor script removed | match + zero matches | grep + test |
| ISC-38 | text | `UPSTREAM.md` credits `open-gsd/gsd-core` | match | grep |

## Features

| name | satisfies | depends_on | parallelizable |
|---|---|---|---|
| Installer scripts | ISC-1..ISC-7 | none | no |
| Documentation | ISC-8..ISC-12 | none | yes |
| Verification script | all | installer docs | no |
| Public path hygiene | ISC-20..ISC-22 | README assets | yes |
| OpenCode/Cursor defaults | ISC-23..ISC-27 | installer templates | yes |
| Parallel-dispatch guidance | ISC-28..ISC-31 | PAI flow docs, install.sh flags | yes |
| Single preference store | ISC-32 | parallel-dispatch guidance | no |
| Layering test harness | ISC-33 | installer scripts | no |
| Identity port tool | ISC-34 | operator AGENTS.md surfaces | no |

## Architecture

<!-- arch-assets:start -->

_Auto-maintained by `ArchitectureAssetsSync.hook.ts` on release events._  
_Last refreshed: 2026-06-22T01:11:11.274Z_

| Asset | Status | How it's generated |
|---|---|---|
| [`docs/architecture/SERVICES.md`](docs/architecture/SERVICES.md) | ✅ current | auto (file scan) |
| [`docs/architecture/DEPENDENCY-GRAPH.md`](docs/architecture/DEPENDENCY-GRAPH.md) | ✅ current | auto (file scan) |
| [`docs/architecture/architecture.html`](docs/architecture/architecture.html) | ✅ current (generated 2026-07-01) | manual (LLM skill) |
| [`docs/architecture/system-internals.html`](docs/architecture/system-internals.html) | ✅ current (generated 2026-07-01) | manual (LLM skill) |
| [`docs/architecture/integration-map.html`](docs/architecture/integration-map.html) | ✅ current (generated 2026-07-01) | manual (LLM skill) |
| [`docs/architecture/session-trace.html`](docs/architecture/session-trace.html) | ✅ current (generated 2026-07-01) | manual (LLM skill) |
| [`docs/architecture/notebooklm-prompt.md`](docs/architecture/notebooklm-prompt.md) | ⬜ not yet generated | manual (LLM skill) |

**To refresh LLM-generated assets:** invoke `/refresh-architecture` in any Claude Code session.

<!-- arch-assets:end -->

## Decisions

- Use a public repo that references voice assets instead of bundling them.
- Keep the first installer Mac-friendly but not Mac-required.
- Generalize paths through `$HOME` and override variables.
- Treat skills.sh readiness as a skill-card plus metadata layer, not a separate installer fork.
- Link only upstream GitHub repositories verified through `gh repo view`; leave CodeGraph as a referenced local CLI without inventing an unverified repo URL.
- 2026-06-15: Preserve Bash for Bash-declared maintenance scripts and make verification interpreter-aware instead of forcing every `.sh` file through POSIX `sh`.
- 2026-06-15: Treat generated README/NotebookLM metadata as public surface; store repo-relative paths and configurable commands rather than local machine provenance.
- 2026-06-15: Make the public installer OpenCode/Cursor-first. Claude, Codex, Pulse compatibility, Claude auth, and model-specific advisor paths are optional rather than required gates.
- 2026-07-01: Record parallel-dispatch strategy as ISA-tracked decisions (ISC-28..ISC-31) rather than a new config file; GSD stays an opt-in thin reference (`--with-gsd`, default OFF) never vendored, and the shipped hook is advisory-only with no auto-triggered dispatch.
- 2026-07-01: Decide Temperance Engine owns exactly one preference store, `ISA.md`. GSD config and PAI steering/memory remain fully external and out of scope; no separate precedence doc. The only cross-system touch is the hook's read-only `config.json` display read, enforced structurally (no write path exists in the script) rather than documented in prose.
- 2026-07-01: Port the runtime identity to live operator surfaces as an attached, reversible `<!-- temperance:identity -->` block (live-is-truth), never a content replacement; prove the installer layering first with an isolated sandbox harness that pins the Pulse port and cannot touch the real home directory.

## Verification

- `./verify.sh` passed after checking required files, shell syntax, and hard-coded install paths.
- `bun build package/pulse-compat/compat-server.ts --target=bun` passed.
- `node package/skill-resolvers/skill_cluster_resolver.mjs` returned `skill-index-present` on the local system.
- `./install.sh --dry-run --skip-voice` completed without mutating live config and showed backup-first writes.
- `codex-gpt-image` generated `assets/banner.png` and `assets/icon.png` through Codex OAuth.
- `gh repo view` verified links for OpenCode, Codex CLI, GitHub CLI, Bun, and ripgrep.
- 2026-06-15: `./verify.sh` passed with interpreter-aware shell linting and reported `ok: no private local path in public/install surface`.
- 2026-06-15: `./install.sh --dry-run --skip-voice` passed and ended with `Install flow complete`.
- 2026-06-15: The private-path denylist scan across tracked files returned no matches.
- 2026-06-15: `bash scripts/readme-continuity-check.sh HEAD HEAD` passed.
- 2026-06-15: `./install.sh --dry-run --skip-voice` proved default mode skips Claude/Pulse and Codex while installing OpenCode/Cursor templates.
- 2026-06-15: `./install.sh --dry-run --skip-voice --with-claude --with-codex` proved optional Claude/Pulse and Codex surfaces can still be requested explicitly.
