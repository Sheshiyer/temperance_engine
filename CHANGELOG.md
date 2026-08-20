# Changelog

Themed page: [docs/site/changelog.html](docs/site/changelog.html) · library: [docs/index.html](docs/index.html)

All notable changes to the **glove product** are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/) via `VERSION` and [docs/release-control.md](docs/release-control.md).
Compatibility: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## [Unreleased]

### Added

- Release-control plane: `VERSION`, `docs/release-control.md`, `docs/COMPATIBILITY.md`, and organ owner/ecosystem maps (`docs/OWNERS.md`, `docs/ECOSYSTEM.md`). Host runtime now has matching `~/.temperance_engine/VERSION` and `CHANGELOG.md`. OmniRoute remains independently versioned and pinned at 3.8.48.
- Phase 1 GSD plans (`01-01`/`01-02`/`01-03`) for the provenance compiler and read-only `temperance doctor`, planned with `--skip-ui`. Execution has not started.
- HITL seat routing: Codex App has no `AskUserQuestion` — discuss/plan gates resume on Grok/Claude; missing picker writes a checkpoint instead of numbered lists or a dead session. Speculum stays glass. See `docs/GSD-HITL-PICKER.md`.

- Codex CLI limits are now part of the glove: no async hooks (CLI skips them), `package/hooks/codex/run-bun-hook.sh` for bun PATH + fail-open, `install-spine.sh` strips leftover async flags, and `docs/codex-cli-limits.md` documents chronicle warning, Refero login, and `codex resume`.
- Hand-in-glove protocol now matches the Mini operator runtime: Claude compose UPS (`package/hooks/claude/PromptProcessing.hook.ts`), `/gsd:*` + native `/goal` on Claude Code, mode-bind on Claude/OpenCode/Cursor templates, repo `AGENTS.md` project rail, and `--with-spine` installers that copy the compose hook instead of the old enrich-only adapter. `/gsd:goal` skips the picker and runs the ISA Goal evaluator.
- PAI mode offer no longer tells the model to write a chat-reply quiz. `/gsd:*` and classifier ALGORITHM skip the picker. Grok must use `ask_user_question` (question card); Codex/Claude use `AskUserQuestion`. Grok prints the Manifest URL instead of pretending it has ChatGPT IAB.
- Curated the docs library: `docs/README.md` is the map (live / routing / retired / historical). `.temperance/project.json` now exists with `active_planner=isa`. `.planning/STATE.md` names the live spine first. README documentation list no longer treats retired stubs as current.
- Restyled the operator library to the Manifest Zone / banner palette (navy, gold, cyan). Shared sheet `docs/assets/te-docs.css`. Visual home: `docs/index.html`. Architecture HTML no longer uses the purple-gradient default.
- Refreshed the architecture visual set (2026-08-17): `docs/architecture/architecture.html`, new `spine-and-goal.html`, rewritten `session-trace.html`, updated integration-map/system-internals, SERVICES, DEPENDENCY-GRAPH, and `notebooklm-prompt.md`. Pictures now show `--with-spine`, Manifest Zone, picker-before-IAB, `/gsd:goal`, and the dual-fleet lock.
- Added `/gsd:goal` (and `/goal`) as the portable session loop around GSD + next-wave + te-dispatch-paid. Writes `.temperance/goal.json`; evaluator reuses doctor/ISA probes. Does not auto-dispatch or fork GSD. See `docs/gsd-goal-handoff.md`.
- Folded the live Mac Mini operator spine into the installer: `--with-spine` installs Codex UPS compose (picker-before-IAB), `/gsd:*` wrappers including `/gsd:doctor`, Manifest LCARS (`package/manifest-zone`) + bridge, Pulse `tts-auth` class, product symlink, and router SoT copy. GSD core is still not vendored. Secrets are never copied.
- Added `docs/gsd-manifest-spine.md` and live doctor probes (`active_planner`, OmniRoute bind, IAB pref, ranker age).
- Added `docs/parallel-dispatch.md`, an advisory `ParallelDispatchContext.hook.sh`, and an opt-in `--with-gsd` reference flag (default off, no vendoring).
- Generated `docs/architecture/architecture.html`, the visual architecture diagram showing Temperance Engine as a productized extraction of the author's live PAI + GSD + superpowers + CodeGraph + peon-ping runtime.
- Added three deep-dive architecture docs: `system-internals.html` (per-component mechanics), `integration-map.html` (which seams are real code paths vs. reference-only), and `session-trace.html` (a concrete install-to-session walkthrough).
- Decided Temperance Engine owns exactly one preference store (`ISA.md`); GSD config and PAI steering/memory stay fully external. Dropped the separate precedence-rule doc in favor of the decision itself, recorded in `ISA.md`, plus a read-only `config.json` display read in `ParallelDispatchContext.hook.sh` (structurally enforced, no write path).
- Added explicit credits for Personal AI Infrastructure, CodeGraph, and peon-ping.
- Added full system-flow architecture diagram and Thoughtseed Labs attribution to README.
- Added skills.sh-facing skill card and metadata.
- Added generated banner and icon assets.
- Added upstream link map and expanded credits.
- Added GitHub Actions verification workflow.

## [0.1.0] - 2026-08-16

### Added

- Initial public installer package for Temperance Engine.
- Added backup-first install scripts, verifier, rollback docs, PAI templates, Pulse compatibility server, skill resolver shim, and CodeGraph routing guidance.

[Unreleased]: https://github.com/Sheshiyer/temperance_engine/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Sheshiyer/temperance_engine/releases/tag/v0.1.0
