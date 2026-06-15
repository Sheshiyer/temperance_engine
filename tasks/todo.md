# Temperance Engine Repo Error Review

Started: 2026-06-15

## Intent

Review what this repository does, reproduce the current errors, then fix the errors without weakening the public installer guarantees.

## Current Understanding

Temperance Engine is a public packaging repository for a local PAI operator runtime. Its job is to provide a backup-first one-time installer, verification and rollback helpers, PAI/Codex/OpenCode instruction templates, optional local voice/Pulse compatibility, skill-cluster routing guidance, and CodeGraph-first `.agents` search rules. It must not bundle private memory, credentials, proprietary voice packs, or machine-specific local paths.

## Reproduced Failures

- [x] `./verify.sh` currently fails because `scripts/verify-install.sh` runs `sh -n` over every shell script while `scripts/readme-continuity-check.sh` is Bash-only.
- [x] `./install.sh --dry-run --skip-voice` currently fails because install ends by running the same failing verification pass.
- [x] Public tracked files currently expose local absolute paths in README/NotebookLM metadata and `scripts/rebuild-readme.sh`.

## Council Synthesis

- [x] Treat the main issue as verifier drift plus public-surface path hygiene, not a broad installer rewrite.
- [x] Keep Bash scripts allowed only when their shebang declares Bash, and make verification lint scripts with their declared interpreter.
- [x] Scrub local absolute paths from public artifacts and add a regression check so they do not return.
- [x] Prove the installer contract with `./verify.sh`, `./install.sh --dry-run --skip-voice`, and a denylist scan for private paths.

## Implementation Plan

- [x] Explain the repository purpose and current failure mode before implementation.
- [x] Fix shell verification so Bash scripts are linted with Bash and POSIX scripts remain linted with `sh`.
- [x] Remove hard-coded local pipeline paths from `scripts/rebuild-readme.sh` and make the pipeline path configurable.
- [x] Sanitize README Asset Trail generation so public metadata uses repo-relative/documented commands only.
- [x] Sanitize `.readme-notebooklm/assets/manifest.json` so tracked asset metadata does not contain local absolute paths.
- [x] Extend verification to fail on private absolute path leaks in the public/install surface.
- [x] Run shell syntax, package verification, dry-run install, runtime build, resolver, and path-denylist checks.
- [x] Add a review/results section here with final evidence.

## Check-In Gate

Implementation is paused here until this plan is checked in with the user, per repo workflow instructions.

User confirmed proceed.

## Review

Completed on 2026-06-15.

Changes made:

- `scripts/verify-install.sh` now lints each script with the shell declared by its shebang, so Bash scripts use `bash -n` and POSIX scripts use `sh -n`.
- `scripts/verify-install.sh` now checks public/install surfaces for private local path patterns.
- `scripts/rebuild-readme.sh` no longer hard-codes a private NotebookLM pipeline path; regeneration uses `READMEREBUILD_PIPELINE`.
- README Asset Trail now documents a configurable public command.
- `.readme-notebooklm/assets/manifest.json` now stores repo-relative source and asset paths.

Verification evidence:

- `./verify.sh` passed and reported `Temperance Engine verification passed`.
- `./install.sh --dry-run --skip-voice` passed and ended with `Install flow complete`.
- Declared shell syntax check passed for root scripts and `scripts/*.sh`.
- `bun build package/pulse-compat/compat-server.ts --target=bun` passed.
- `node package/skill-resolvers/skill_cluster_resolver.mjs` returned `{"continue":true,"temperance":"skill-index-present","skills":790}`.
- `bash scripts/readme-continuity-check.sh HEAD HEAD` passed.
- The tracked-file private-path denylist scan returned no matches.

## Follow-Up: OpenCode/Cursor-First Optional Claude

Requested on 2026-06-15.

Intent:

Make Temperance Engine usable by teams that primarily work in OpenCode or Cursor and do not have Claude Pro/Max or Claude Code subscription access. Claude-specific templates, advisor calls, auth, and model assumptions must be optional rather than required gates.

Plan:

- [x] Make installer flags explicit for optional Claude, Codex, Cursor, and OpenCode surfaces.
- [x] Add Cursor guidance/template support without requiring a global Claude installation.
- [x] Update README, architecture, rollback, credits, upstream, skills metadata, and skill card language to position OpenCode/Cursor first.
- [x] Ensure verification checks OpenCode/Cursor support and no longer implies Claude auth/model requirements.
- [x] Run `./verify.sh`, dry-run install with Claude skipped, and path hygiene checks.

Review:

- `install.sh` now defaults to `CLAUDE_MODE=skip`, `CODEX_MODE=skip`, `OPENCODE_MODE=install`, and `CURSOR_MODE=install`.
- `scripts/install-pai.sh` installs the portable `AGENTS.md` template by default and installs Claude/Pulse files only with `--with-claude`.
- `scripts/configure-opencode.sh` installs OpenCode and Cursor templates by default and installs Codex only with `--with-codex`.
- `templates/cursor.AGENTS.md` and `templates/cursor.rules.mdc` provide Cursor project-local guidance without Claude auth or model gates.
- Public docs, skills metadata, README generated assets, and verification checks now describe OpenCode/Cursor-first defaults.

Verification evidence:

- `./verify.sh` passed and reported `Temperance Engine verification passed`.
- `./install.sh --dry-run --skip-voice` passed with `CLAUDE_MODE=skip`, `CODEX_MODE=skip`, and Cursor/OpenCode template writes.
- `./install.sh --dry-run --skip-voice --with-claude --with-codex` passed and proved optional Claude/Pulse and Codex paths still work when explicitly requested.
- `bash scripts/readme-continuity-check.sh HEAD HEAD` passed.
- `bun build package/pulse-compat/compat-server.ts --target=bun` passed.
- `node package/skill-resolvers/skill_cluster_resolver.mjs` returned `{"continue":true,"temperance":"skill-index-present","skills":790}`.
- `git diff --check` passed.
- The tracked-file private-path denylist scan returned no matches.
