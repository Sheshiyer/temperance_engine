# Changelog

## Unreleased

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

## 0.1.0

- Initial public installer package for Temperance Engine.
- Added backup-first install scripts, verifier, rollback docs, PAI templates, Pulse compatibility server, skill resolver shim, and CodeGraph routing guidance.
