# Temperance Engine — Identity Port & Layering Test (Design)

Date: 2026-07-01
Status: Approved design, pre-implementation

## Context

`temperance_engine` is a public installer repo that packages the author's live PAI-style
runtime (OpenCode/Cursor-first, optional Claude/Codex). The author's OpenCode and Codex
setups **already run this runtime**, but under the "PAI" name, not "Temperance Engine."

The goal is twofold and the second half touches a live daily-driver environment, so it must
be surgical and unambiguous:

1. **Test the code and layering** of this repo, in isolation, to prove it installs correctly
   before anything is applied to the live environment.
2. **Port the identity** to the live OpenCode/Codex operator surfaces — i.e. rename them to
   "Temperance Engine" — without altering their working content.

### Grounded facts (verified read-only, 2026-07-01)

- Live operator surfaces are pure PAI-branded, zero "temperance" strings:
  - `~/AGENTS.md` — 120 lines, `# PAI 4.0.3 — Personal AI Infrastructure`
  - `~/.config/opencode/AGENTS.md` — 6.2 KB, `## PAI Runtime For OpenCode`
  - `~/.codex/AGENTS.md` — 5.2 KB, `# PAI 4.0.3 — Personal AI Infrastructure`
- Live files are **richer than** the repo's templates (they carry more working doctrine).
- `~/.codex/` is a live ~2.5 GB working dir (auth.json, config.toml, sessions, a
  `PAI → ~/.claude/PAI` symlink). Never point a naive installer at it.
- `uninstall.sh` is a 10-line advisory helper; it does not auto-restore. Rollback is
  "restore from newest timestamped backup," documented in `docs/rollback.md`.
- `scripts/lib.sh` provides `backup_file` / `install_file` / `ensure_dir` / `is_dry_run`;
  every write in the repo already goes through `backup_file` first.

## Decisions (locked)

1. **Direction — live is truth, repo gives naming only.** The rich live PAI files remain the
   real content. The repo templates are **not** copied over live files. We attach identity,
   never replace content.
2. **Rename scope — operator surfaces only.** "Temperance Engine" becomes the identity on the
   three live `AGENTS.md` operator surfaces. `~/.claude/PAI`, the `~/.codex/PAI` symlink,
   `CLAUDE.md`, and voice ("NOESIS"/"noesisX") are **out of scope and untouched**. Cursor needs
   nothing on live — its templates are already Temperance-named and project-local.
3. **Test deliverable — both.** Build a permanent sandbox test harness in the repo, then run it
   green before touching the rename.
4. **Identity attach method — delimited block (Approach A).** Chosen over in-place H1 retitle
   (lossy reversal, fragile idempotency) and separate-file+include (unreliable auto-load).

## Non-Goals

- No content replacement of live files with repo templates.
- No rename of the PAI methodology, `~/.claude/PAI` dir, the codex symlink, `CLAUDE.md`, or voice.
- No automated `uninstall` beyond the existing backup-restore path.
- No new preference store (ISA.md remains the single one, per prior decision).

## Deliverable 1 — Sandbox test harness

New file: `tests/sandbox-install.sh` (POSIX `sh`, executable). Permanent, repeatable, CI-friendly.

**Isolation.** Creates one throwaway root under `$(mktemp -d)` and points every environment
variable the installer honors into it — `PAI_HOME`, `CODEX_HOME`, `OPENCODE_HOME`,
`CURSOR_HOME`, `AGENTS_HOME`, `TEMPERANCE_STATE_DIR`, `TEMPERANCE_BACKUP_DIR`, and `HOME` — so a
**real** (non-dry-run) install cannot touch the real home directory. `set -eu`; traps clean up
the temp root on exit.

**Assertions (each prints PASS/FAIL; any FAIL → non-zero exit):**

1. **File landing.** After a real `install.sh --skip-voice --with-claude --with-codex --with-gsd`
   into the sandbox, assert each expected destination exists:
   `$HOME/AGENTS.md` (sandbox `HOME`; written by `install-pai.sh` as `$HOME/AGENTS.md`),
   `$PAI_HOME/CLAUDE.md.template`,
   `$PAI_HOME/PAI/PULSE/compat-server.ts`, `$CODEX_HOME/hooks/skill_cluster_resolver.mjs`,
   `$OPENCODE_HOME/AGENTS.md`, `$OPENCODE_HOME/opencode.json`, `$CODEX_HOME/AGENTS.md`,
   `$CURSOR_HOME/templates/temperance-engine.AGENTS.md`,
   `$CURSOR_HOME/templates/temperance-engine.rules.mdc`.
2. **Backup + idempotency.** Run the same install a second time; assert at least one timestamped
   backup file now exists under `$TEMPERANCE_BACKUP_DIR` and that re-install still exits 0.
3. **Dry-run mutates nothing.** Into a second fresh temp root, run `install.sh --dry-run
   --skip-voice`; assert zero files were created under that root.
4. **Restore-from-backup (real rollback path).** Overwrite a known installed file with sentinel
   bytes, then copy the newest backup of it back; assert the file matches its post-install bytes.
5. **Hook behavior.** Run `package/hooks/ParallelDispatchContext.hook.sh` with
   `CLAUDE_PROJECT_DIR` pointed at a fabricated `.planning/` project (with a `config.json` and
   `workstreams/`); assert stdout contains `GSD-managed project detected` and the
   `model_profile` line. Run it against a non-`.planning/` dir; assert empty stdout and exit 0.
6. **GSD gating.** Assert `--with-gsd` dry-run prints `GSD_MODE=install` and the reference note;
   assert default prints `GSD_MODE=skip`.

**Not wired into `verify.sh`.** `verify-install.sh` runs *inside* `install.sh`; calling a full
install from it would recurse. The harness is standalone: `sh tests/sandbox-install.sh`, and a
CI step can call it.

## Deliverable 2 — Surgical identity tool

New file: `scripts/apply-identity.sh` (POSIX `sh`, executable). Sources `scripts/lib.sh` for
`backup_file`.

**Identity block (Approach A).** Inserted at the very top of each target file, between markers:

```
<!-- temperance:identity:start -->
# Temperance Engine

This surface operates as **Temperance Engine**, the local operator identity for OpenCode/Codex.
Temperance Engine is the productized packaging of the PAI methodology below; the PAI doctrine,
phases, memory, and voice remain the operating substrate and are unchanged.
<!-- temperance:identity:end -->

```

The original PAI content follows the block, byte-for-byte unchanged.

**Targets:** `~/AGENTS.md`, `~/.config/opencode/AGENTS.md`, `~/.codex/AGENTS.md`
(overridable via env vars for testing).

**Behavior:**
- **Dry-run by default.** With no flag, prints each target and the exact block that would be
  inserted; writes nothing. `--apply` performs the write.
- **Backup-first.** Every real write calls `backup_file` before modifying, so the pre-rename
  version is recoverable under `$TEMPERANCE_BACKUP_DIR`.
- **Idempotent.** If a `temperance:identity` block already exists at the top, replace it in place
  rather than stacking a second one.
- **Reversible.** `--remove` strips the marked block, returning the file to pure PAI.
- **Refuses ambiguity.** If a file is missing, it is reported and skipped, never created.

## Execution sequence (the surgical part)

1. Build `tests/sandbox-install.sh`; run it; get all assertions green.
2. Build `scripts/apply-identity.sh`.
3. Run `apply-identity.sh` in **dry-run** against live; present the exact per-file diff/block.
4. **Stop for explicit go/no-go.** Apply for real (`--apply`, backup-first) only on approval.
5. Confirm each live file now carries the identity block above unchanged PAI content; note the
   backup location for one-command rollback (`--remove` or restore-from-backup).

## Verification

- `sh -n` on both new scripts.
- `tests/sandbox-install.sh` exits 0 with all six assertion groups PASS.
- `apply-identity.sh` dry-run output reviewed before any live write.
- Post-apply: `grep -l 'temperance:identity' ~/AGENTS.md ~/.config/opencode/AGENTS.md
  ~/.codex/AGENTS.md` lists all three; PAI body diff below the block is empty.
- Repo `verify.sh` still passes (new files added to its `check_file` list where appropriate;
  `apply-identity.sh` is linted by the existing `scripts/*.sh` syntax loop).

## Rollback

- Live rename: `scripts/apply-identity.sh --remove`, or restore the newest timestamped backup
  under `$TEMPERANCE_BACKUP_DIR` (per `docs/rollback.md`).
- Harness: operates only in temp dirs; nothing to roll back.

## ISA tracking

Add criteria to `ISA.md`: harness existence + green run, and the identity tool's
dry-run-default / backup-first / idempotent / reversible guarantees (grep-verifiable: no
unconditional write path, `--remove` present). Record the three locked decisions in the
Decisions log.
