# Changelog

Themed page: [docs/site/changelog.html](docs/site/changelog.html) · library: [docs/index.html](docs/index.html)

All notable changes to the **glove product** are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer](https://semver.org/) via `VERSION` and [docs/release-control.md](docs/release-control.md).
Compatibility: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## [Unreleased]

## [0.7.0] - 2026-10-04

### Added

- **Showreel** (`package/showreel/`) — a 15-second, 60 fps motion piece in two cuts, 16:9 and 9:16 for social media, cut on the beat of a 120 BPM soundtrack. `reel.html` is one hand-written Canvas2D file with a deterministic `render(frame)`; `scripts/soundtrack.ts` synthesizes the audio; `scripts/capture.ts` renders frames in parallel headless Chromium, caches Google Fonts in `.cache/fonts/`, encodes with ffmpeg, then deletes the frames and temporary browser profiles (`--keep-frames` opts out). No animation libraries and no package dependencies. `bun run publish` writes the web encodes and contact-sheet poster in `assets/showreel/`. The README and the themed library show it.
- **Simplified Technical English (ASD-STE100) skill** — `./install.sh --with-ste` (opt-in) fetches [0xpili/simplified-technical-english](https://github.com/0xpili/simplified-technical-english) at pinned commit `1e148d6` into `$AGENTS_HOME/skills/` and links it into the enabled Claude and OpenCode surfaces (`scripts/install-ste.sh`). Referenced, not vendored: the ASD-STE100 word list never enters this repo. Existing copies are left alone unless `--force`, which moves them to `$TEMPERANCE_BACKUP_DIR` first. A forced update fetches and validates the replacement in staging before it retires the active checkout, and a `STE_SKILL_HOME` inside a surface's skills dir is treated as an in-place install, never a self-link. `TEMPERANCE_STE_MODE=uninstall` removes only links that point to the managed checkout, in the configured roots, and moves the checkout to backups instead of deleting it.
- **`package/ste-check/`** — bun/TypeScript port of the upstream `ste_check.py` (no Python dependency). Output is byte-identical to upstream on 366 corpus runs and 16 committed golden fixtures, including Python-Unicode regex edge cases.
- **STE docs gate** (`bun package/ste-check/docs-gate.ts`, in `scripts/verify-all.sh`) — per-doc error ratchet over `QUICKSTART.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `docs/*.md`. A doc may not gain errors; new docs must have zero; `--tighten` only lowers counts. The gate puts each heading line and table row in its own block, so prose directly under a heading or table is still checked (the CLI keeps upstream behavior).
- `docs/ste.md` (written in STE); `tests/install-ste.sh`; STE attribution in `CREDITS.md`, `UPSTREAM.md`, `THIRD_PARTY_NOTICES.md`.

### Changed

- `QUICKSTART.md` rewritten in STE (5 → 0 structural errors; commands, code, tables, and headings unchanged).
- OpenCode managed agents `temperance-auto`, `temperance-algorithm`, `temperance-continuity`, and `temperance-worker` allow the `simplified-technical-english` skill. Locked lanes (`temperance-native`, planner, validator, `code-fast`) and the EC2 profile are unchanged.

### Fixed

- **`wire-multi-backend.sh` backup-name collision wrote into the repo.** One run backs up the `~/.kimi/skills/temperance-engine` CLI link (kept as a symlink to the repo skill) and a foreign Kimi desktop `temperance-engine` dir under the same name. The second `cp -RP` followed the first backup's symlink, so the foreign dir was copied into the repo as `skills/temperance-engine/temperance-engine/` and never reached the backup. That extra leaf then failed every install-surface COPY record with `COPY_HASH_INVENTORY_MISMATCH`. A new `backup_target` helper never reuses a name inside a run.
- `tests/wire-batch.sh`: the "foreign content preserved in a backup" check passed vacuously (`find | xargs grep` exits 0 when find matches nothing); it now requires a real backup file. A new check asserts that the repo `skills/` tree is byte-for-byte unchanged.
- `tests/verify-install-private-path-guard.sh`: the synthetic `CREDITS.md` now includes the STE attribution that `verify-install.sh` requires, so the guard regression suite keeps passing.
- **ripgrep is now an explicit dependency, and a missing rg fails closed.** Without the `rg` binary, `scripts/omniroute-codex-preview.sh` silently skipped its credential-leak scan (the `if rg` read exit 127 as "no leak") and still wrote a receipt. It now exits 127 with `rg is required`, as the Hermes preview already did. `tests/omniroute-autostart-launchd.sh` and `tests/omniroute-hermes-preview.sh` false-passed checks without rg; they now fail at once. `scripts/verify-all.sh` refuses to start without rg, alongside its bun check. `scripts/verify-install.sh` prints an advisory `warn:` line (install still succeeds). `tests/omniroute-native-integration.sh` passes `--no-require-git`, so its exact-match scan honors `.gitignore` in non-git checkouts.
- `tests/temperance-proxy-live.sh` also pins the proxy's Kimi session read (`TEMPERANCE_KIMI_STATE`) to its temp dir, deletes that dir on exit, and asserts by correlation ID that none of its own requests reach the operator request log (`$HOME/.temperance_engine/state/openai-proxy.jsonl`, which is the repo on a host checkout), so unrelated traffic from a live relay cannot break it.
- **install-surface typecheck is green again.** The LaunchAgent lifecycle support (d4748c9) left three `tsc` errors that the Verify workflow does not run. Two plist removals in `src/lifecycle/executor.ts` now pass an explicit `recursive: false` (no behavior change). The real one: the install doctor sent `LAUNCHAGENT` records to the transform observer, which would report a misleading `ADAPTER_UNAVAILABLE`. Doctor now reports them as `UNAVAILABLE` with `LAUNCHAGENT_OBSERVATION_UNAVAILABLE`, because it cannot verify the plist or launchctl state yet. No shipped fragment declares a LaunchAgent record, so current doctor output does not change. `test/doctor.test.ts` covers the class.

### Qualification boundary

- This is the `0.7.0` feature release: the opt-in STE skill and docs gate, and
  the showreel. It is not completion of the separately tracked v1.1 clean-host
  qualification milestone or a claim of end-to-end 1M sessions.
- The adapter pin remains `9router@0.5.75`; other versions remain held. Router
  changes still under review (organ registry, hosted-router edge) are not part
  of this release.
- Per-attempt gateway context enforcement and durable checkpoint recovery remain
  unqualified, as in `0.6.0`.
- The showreel is documentation media. `install.sh` does not install it, and it
  changes no installer, doctor, lifecycle, or routing contract.

## [0.6.0] - 2026-09-19

### Added

- Portable v4 hand-in-glove onboarding with optional personal profiles, private
  host bindings, dependency-aware organs, mounted-volume checks, and read-only
  project discovery and explicit enrollment.
- Guided seven-step onboarding: Host, Projects, Providers, Combos, Organs/tools,
  Integrations, Review. The headless agent flow shares the same actions and
  admission gates as the TUI, with explicit handoffs for sign-in and changes.
- Exact-version `9router@0.5.75` capability adapter, opaque OAuth interaction,
  live provider/model discovery, reviewed combo seating, and digest-bound
  replacement/cutover transactions with rollback evidence.
- Read-only operator health, install doctor integration, local opt-in bounded
  metadata telemetry, and log inspection from either the TUI or JSON CLI.
- Optional session-policy admission checks for context budgets, phase aliases,
  seats, and fallback; shared seven-phase alchemical/Kosha header projection.

### Changed

- Temperance remains independently installable. Noesis/Cambium is an optional
  personal layer, not a required dependency or source of shipped private state.
- Onboarding uses sequential guidance instead of tabs, with Enter actions and
  Enter/y final confirmation. Blocked plans remain impossible to confirm.
- Scoped lifecycle updates and refreshed COPY provenance reconcile managed
  surfaces without treating unavailable transformations as successful installs.

### Fixed

- Preserve Unicode in managed instructions and pending wizard choices across
  routing, health, and log handoffs; keep agent step arrays in workflow order.
- Keep successful admission diagnostics out of worker completion output so
  blank responses cannot masquerade as successful model work.
- Keep synthetic test homes portable and isolate launcher, proxy, and routing
  fixtures from the operator's optional personal policy, logs, and live catalog.

### Security

- OAuth proof and provider tokens remain outside plans, receipts, and telemetry.
  Logs use a bounded, owner-only, metadata-only store with strict input handling.
- Missing, stale, incompatible, or unverified routing/context evidence holds
  admission. Prerequisite availability is never reported as runtime health.

### Qualification boundary

- This is the `0.6.0` feature release, not completion of the separately tracked
  v1.1 clean-host qualification milestone or a claim of end-to-end 1M sessions.
- The adapter pin remains `9router@0.5.75`; other versions, including `0.5.81`,
  are not qualified and are held. Provider sign-in and persisted combo membership
  require fresh verification on each installation.
- Per-attempt gateway context enforcement and durable checkpoint recovery are
  not qualified. A selected long-context policy remains held where enforcement
  cannot be verified. Native client context capacity is not established here.
- App/volume presence does not establish Obsidian tunneling or dashboard health.
  Unsupported doctor transforms/generators remain explicitly unavailable.

## [0.5.4] - 2026-08-26 — v5 arc closed (XVII Star + Swords minors) + v4.3 fix

Product bump reflecting the local runtime's v5.4 Five of Swords state. All noted work landed via the noesis-cambium repo (`~/.temperance_engine`); this glove entry records the semver correspondence + summary. Full receipts in the host runtime CHANGELOG at `~/.temperance_engine/CHANGELOG.md` and Arcana canonical spec at `~/.temperance_engine/ARCANA-NOMENCLATURE.md`.

### Added (day of 2026-08-26)

- **Plugin Contract v1** (v14 · XIV Temperance) — 7 alchemical phase agents at `~/.claude/agents/{Observe,Think,Plan,Build,Execute,Verify,Learn}.md`. Structural depth cap · Panch Kosha layer declaration · distribution rule · fail-open receipts.
- **45 cluster orchestrator agents** (v14.1 · Ace of Wands) at `~/.claude/agents/clusters/*Orchestrator.md`, sourced from repository-managed SKILL.md hubs.
- **Alchemy stage-hub map v3** + dispatch advisory (v14.2 · Two of Wands).
- **SPRD-03 combo-diversity fix** (v14.3 · Three of Wands) — `resolveCapabilityField()` connection-prefix fallback in `router/truth-contract.ts`. 27/27 tests pass.
- **v5 canonical banner + surface unification** (v17.0 · XVII The Star) — Header + Kosha Spine × 3 + Timeline + Adaptive Island layout. Speculum browser UI stays as opt-in visualization (dual-surface contract).
- **8 surface adapters + 6 `/te` slash commands + Adaptive Island state machine** (v17.1 · Ace of Swords).
- **Dual-surface stabilization** (v17.2 · Four of Swords).
- **`/te install` auto-installer + memory continuity** (v17.3 · Two of Swords) — shared inject-common library, cross-CLI shim installer, `.zshrc`/`.bashrc` full wire-in, memory env exports (`TE_MEMORY_LIBER` + `OMNIROUTE_MEMORY_URL`).
- **Real-event wiring** (v17.4 · Five of Swords) — AdaptiveIslandStateHook Claude Code PreToolUse+PostToolUse, Timeline SSE consumer (tail -F events.jsonl) with opt-in LaunchAgent, banner collector migration to push-based cache.
- **`te` master CLI** — single entry point (`te dashboard`, `te dispatch <Phase> "<task>"`, `te caps/state/actions/workflow/island/graph`, `te install`, `te bridge`, etc.).
- **Superset Terminal Preset**: "Temperance Engine · Dispatch" (3-pane split: `te` + event tail + `te help`).
- **Superset consolidation**: duplicate presets removed (`Temperance Engine`/`claude`/`grok`/`opencode` presets that duplicated Agents), Agents kept as canonical wired-in path.

### Changed

- Statusline (`~/.claude/statusline-command.sh`) appends `banner/emit-v5-extras.sh` output — adds v5 Timeline row + Adaptive Island rows to existing 7-row LCARS statusline without replacing any of the rich data (SPECULUM · OPUS · LIBER · PRIMA · NOESIS phase strip).
- Blueprint Artifact bumped Rev 04 → Rev 05 → Rev 06 → Rev 07 (compression stamp fix + § 16 Since Rev 04 additions).
- Cross-tree updates landed in Cambium (`ARCHITECTURE.md`/`VERSIONS.md`/`README.md` on `codex/project-r2-mapping-plan` branch, pushed) + skill-clusters (`.planning/STATE.md`/`NEXT-WAVE.json`/`CLAUDE.md` refreshed; 10 June-era plan/task docs archived).

### Fixed

- Claude Code unknown-model window warning silenced for `noesis-*` combos via `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` + `CLAUDE_CODE_MAX_CONTEXT_TOKENS=1000000` in `superset-claude-inject.sh`.
- `te_alias_bin` zsh portability — replaced bash-only `declare -F` with `[ -n "$BASH_VERSION" ]` guard around `export -f`.
- SSE consumer design pivot — bridge SSE emits periodic snapshots, not per-event push. Consumer now `tail -F`s `state/manifest/events.jsonl` directly (correct event granularity, same push-based semantics).

### Release-control plane

- Release-control plane: `VERSION`, `docs/release-control.md`, `docs/COMPATIBILITY.md`, and organ owner/ecosystem maps (`docs/OWNERS.md`, `docs/ECOSYSTEM.md`). Host runtime now has matching `~/.temperance_engine/VERSION` and `CHANGELOG.md`. OmniRoute remains independently versioned and pinned at 3.8.48.
- Phase 1 GSD plans (`01-01`/`01-02`/`01-03`) for the provenance compiler and read-only `temperance doctor`, planned with `--skip-ui`. Execution has not started.
- HITL seat routing: Codex App has no `AskUserQuestion` — discuss/plan gates resume on Grok/Claude; missing picker writes a checkpoint instead of numbered lists or a dead session. Speculum stays glass. See `docs/GSD-HITL-PICKER.md`.
- Speculum is named via portless: `https://speculum.localhost:1355` (loopback still `:5173`; IAB keeps `:5173`). Organ map distilled in `docs/ECOSYSTEM.md`.
- Portless is a referenced third-party infra package (`THIRD_PARTY_NOTICES.md`, `scripts/apply-portless-organs.sh`). Speculum lists **bound planning projects** only (no ALL PROJECTS / `$HOME` / CodexBar).

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

[Unreleased]: https://github.com/Sheshiyer/temperance_engine/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/Sheshiyer/temperance_engine/releases/tag/v0.7.0
[0.6.0]: https://github.com/Sheshiyer/temperance_engine/releases/tag/v0.6.0
[0.1.0]: https://github.com/Sheshiyer/temperance_engine/releases/tag/v0.1.0
