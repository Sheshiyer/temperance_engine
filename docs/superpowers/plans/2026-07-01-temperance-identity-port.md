# Temperance Identity Port & Layering Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a permanent sandbox test harness that proves the installer's layering, plus a surgical, reversible tool that renames the live OpenCode/Codex operator surfaces to "Temperance Engine" without altering their PAI content.

**Architecture:** Two new POSIX-sh scripts. `tests/sandbox-install.sh` runs a real install into a throwaway `HOME` and asserts file landing, backups, dry-run safety, restore, hook behavior, and GSD gating. `scripts/apply-identity.sh` prepends a delimited `<!-- temperance:identity -->` block to the three live `AGENTS.md` files, backup-first, idempotent, and reversible via `--remove`. A dedicated `tests/identity-tool.sh` proves the tool against fixtures before it ever touches live.

**Tech Stack:** POSIX `sh`, existing `scripts/lib.sh` primitives (`backup_file`, `ensure_dir`, `is_dry_run`), `awk`/`grep`/`cmp`/`find`. No new dependencies.

## Global Constraints

- POSIX `sh` only (`#!/usr/bin/env sh`); no bash-isms, no hard `bun`/`node` dependency.
- Every real write goes through `backup_file` first (backups under `$TEMPERANCE_BACKUP_DIR`, default `$HOME/.temperance_engine/backups`).
- Tests must NEVER touch the real `$HOME` — only `$(mktemp -d)` sandboxes.
- Sandbox install must pin `TEMPERANCE_PULSE_PORT=39337` and kill any spawned Pulse PID on cleanup, so the live `:31337` server is never disturbed.
- Live identity apply is **dry-run by default**; a real write happens only with `--apply` AND explicit human go/no-go.
- Out of scope, never touched: `~/.claude/PAI`, the `~/.codex/PAI` symlink, `CLAUDE.md`, voice ("NOESIS"/"noesisX").
- Direction: live is truth. The tool attaches identity; it never replaces PAI content.
- Identity block markers, verbatim: `<!-- temperance:identity:start -->` and `<!-- temperance:identity:end -->`.

---

## File Structure

- Create `tests/sandbox-install.sh` — installer layering harness (Task 1).
- Create `tests/identity-tool.sh` — identity-tool unit test against fixtures (Task 2).
- Create `scripts/apply-identity.sh` — the surgical identity tool (Task 2).
- Modify `scripts/verify-install.sh` — add `check_file` entries + include `tests/*.sh` in the syntax loop (Task 3).
- Modify `ISA.md` — add ISC-33/ISC-34, Test Strategy rows, Features row, Decisions entries (Task 3).
- Live operator files `~/AGENTS.md`, `~/.config/opencode/AGENTS.md`, `~/.codex/AGENTS.md` — modified only in Task 4, gated.

---

### Task 1: Sandbox install-layering harness

**Files:**
- Create: `tests/sandbox-install.sh`
- Test: (this file IS the test)

**Interfaces:**
- Consumes: `install.sh` (repo root), `package/hooks/ParallelDispatchContext.hook.sh`.
- Produces: a standalone harness `sh tests/sandbox-install.sh` that exits 0 iff layering is correct.

- [ ] **Step 1: Write the harness**

Create `tests/sandbox-install.sh`:

```sh
#!/usr/bin/env sh
# Sandbox test harness for the Temperance Engine installer.
# Runs a REAL install into a throwaway HOME and asserts layering.
# Never touches the real home directory. Not run from verify-install.sh (would recurse).
set -u

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1" >&2; }

SANDBOX=$(mktemp -d 2>/dev/null || mktemp -d -t tesandbox)
INSTALL_ROOT="$SANDBOX/install"
PULSE_PID_FILE="$INSTALL_ROOT/.claude/PAI/PULSE/compat-server.pid"
cleanup() {
  if [ -f "$PULSE_PID_FILE" ]; then
    p=$(cat "$PULSE_PID_FILE" 2>/dev/null || true)
    [ -n "${p:-}" ] && kill "$p" 2>/dev/null || true
  fi
  rm -rf "$SANDBOX"
}
trap cleanup EXIT INT TERM
mkdir -p "$INSTALL_ROOT"

run_install() {
  root="$1"; shift
  ( export HOME="$root" \
      PAI_HOME="$root/.claude" \
      CODEX_HOME="$root/.codex" \
      OPENCODE_HOME="$root/.config/opencode" \
      CURSOR_HOME="$root/.cursor" \
      AGENTS_HOME="$root/.agents" \
      TEMPERANCE_STATE_DIR="$root/.temperance_engine" \
      TEMPERANCE_BACKUP_DIR="$root/.temperance_engine/backups" \
      TEMPERANCE_PULSE_PORT=39337
    sh "$REPO_ROOT/install.sh" "$@" )
}

# --- Assertion 1: file landing after a real full install ---
if run_install "$INSTALL_ROOT" --skip-voice --with-claude --with-codex --with-gsd \
     >"$SANDBOX/install1.log" 2>&1; then
  ok "install exited 0"
else
  bad "install exited non-zero (see $SANDBOX/install1.log)"
fi

for rel in \
  "AGENTS.md" \
  ".claude/CLAUDE.md.template" \
  ".claude/PAI/PULSE/compat-server.ts" \
  ".codex/hooks/skill_cluster_resolver.mjs" \
  ".config/opencode/AGENTS.md" \
  ".config/opencode/opencode.json" \
  ".codex/AGENTS.md" \
  ".cursor/templates/temperance-engine.AGENTS.md" \
  ".cursor/templates/temperance-engine.rules.mdc" \
; do
  if [ -f "$INSTALL_ROOT/$rel" ]; then ok "landed: $rel"; else bad "missing: $rel"; fi
done

# --- Assertion 2: backup + idempotency on second install ---
if run_install "$INSTALL_ROOT" --skip-voice --with-claude --with-codex --with-gsd \
     >"$SANDBOX/install2.log" 2>&1; then
  ok "re-install exited 0"
else
  bad "re-install exited non-zero"
fi
if find "$INSTALL_ROOT/.temperance_engine/backups" -type f 2>/dev/null | grep -q .; then
  ok "backups created on re-install"
else
  bad "no backups after re-install"
fi

# --- Assertion 3: dry-run mutates nothing ---
DRY_ROOT="$SANDBOX/dry"
mkdir -p "$DRY_ROOT"
run_install "$DRY_ROOT" --dry-run --skip-voice >"$SANDBOX/dry.log" 2>&1 || true
created=$(find "$DRY_ROOT" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$created" = "0" ]; then ok "dry-run created no files"; else bad "dry-run created $created files"; fi

# --- Assertion 4: restore-from-backup (real rollback path) ---
# Use a unique basename that is unconditionally re-written (hence backed up on install 2).
TARGET="$INSTALL_ROOT/.claude/CLAUDE.md.template"
cp "$TARGET" "$SANDBOX/expected_claude_tmpl"
printf 'SENTINEL-CORRUPT\n' > "$TARGET"
NEWEST=$(find "$INSTALL_ROOT/.temperance_engine/backups" -type f -name 'CLAUDE.md.template' 2>/dev/null | sort | tail -n 1)
if [ -n "$NEWEST" ] && cp "$NEWEST" "$TARGET" && cmp -s "$TARGET" "$SANDBOX/expected_claude_tmpl"; then
  ok "restore-from-backup matches installed bytes"
else
  bad "restore-from-backup failed"
fi

# --- Assertion 5: hook behavior ---
HOOK="$REPO_ROOT/package/hooks/ParallelDispatchContext.hook.sh"
PROJ="$SANDBOX/proj"
mkdir -p "$PROJ/.planning/workstreams/api" "$PROJ/.planning/workstreams/ui"
printf 'ws-api\n' > "$PROJ/.planning/active-workstream"
printf '{ "model_profile": "quality", "workflow": { "auto_advance": false } }\n' > "$PROJ/.planning/config.json"
OUT=$(CLAUDE_PROJECT_DIR="$PROJ" sh "$HOOK")
if printf '%s' "$OUT" | grep -q 'GSD-managed project detected' \
   && printf '%s' "$OUT" | grep -q 'model_profile: quality'; then
  ok "hook emits advisory for GSD project"
else
  bad "hook advisory output missing"
fi
BARE="$SANDBOX/bare"; mkdir -p "$BARE"
OUT2=$(CLAUDE_PROJECT_DIR="$BARE" sh "$HOOK")
if [ -z "$OUT2" ]; then ok "hook silent for non-GSD dir"; else bad "hook not silent for non-GSD dir"; fi

# --- Assertion 6: GSD gating ---
mkdir -p "$SANDBOX/g1" "$SANDBOX/g2"
OUT_ON=$(run_install "$SANDBOX/g1" --dry-run --skip-voice --with-gsd 2>&1 || true)
printf '%s' "$OUT_ON" | grep -q 'GSD_MODE=install' && ok "gsd on: GSD_MODE=install" || bad "gsd on gating"
OUT_OFF=$(run_install "$SANDBOX/g2" --dry-run --skip-voice 2>&1 || true)
printf '%s' "$OUT_OFF" | grep -q 'GSD_MODE=skip' && ok "gsd off: GSD_MODE=skip" || bad "gsd off gating"

printf '\n=== %d passed, %d failed ===\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Make it executable and syntax-check**

Run:
```bash
chmod +x tests/sandbox-install.sh
sh -n tests/sandbox-install.sh && echo "syntax ok"
```
Expected: `syntax ok`

- [ ] **Step 3: Run the harness — expect all green**

Run:
```bash
sh tests/sandbox-install.sh
```
Expected: a list of `PASS:` lines and a final `=== N passed, 0 failed ===`, exit 0. (The installer already exists and is correct; a red here is a real layering finding to investigate before proceeding.)

- [ ] **Step 4: Confirm the real HOME was untouched**

Run:
```bash
ls -la "$HOME/.temperance_engine/backups" 2>/dev/null | tail -3; echo "exit: $?"
```
Expected: no NEW backup dirs created by the harness run (the harness writes only under its temp sandbox). Existing backups from prior real installs, if any, are unchanged.

- [ ] **Step 5: Commit**

```bash
git add tests/sandbox-install.sh
git commit -m "test: add sandbox install-layering harness"
```

---

### Task 2: Surgical identity tool (TDD)

**Files:**
- Create: `tests/identity-tool.sh`
- Create: `scripts/apply-identity.sh`

**Interfaces:**
- Consumes: `scripts/lib.sh` (`backup_file`, `say`).
- Produces: `scripts/apply-identity.sh` with modes `--dry-run` (default), `--apply`, `--remove`; env overrides `IDENTITY_HOME_AGENTS`, `IDENTITY_OPENCODE_AGENTS`, `IDENTITY_CODEX_AGENTS` for the three targets.

- [ ] **Step 1: Write the failing test**

Create `tests/identity-tool.sh`:

```sh
#!/usr/bin/env sh
# Unit test for scripts/apply-identity.sh against throwaway fixtures.
set -u
REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TOOL="$REPO_ROOT/scripts/apply-identity.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1" >&2; }

SANDBOX=$(mktemp -d 2>/dev/null || mktemp -d -t teid)
trap 'rm -rf "$SANDBOX"' EXIT INT TERM
export TEMPERANCE_STATE_DIR="$SANDBOX/state"
export TEMPERANCE_BACKUP_DIR="$SANDBOX/state/backups"

FIX="$SANDBOX/AGENTS.md"
printf '# PAI 4.0.3 — Personal AI Infrastructure\n\nbody line\n' > "$FIX"
cp "$FIX" "$SANDBOX/orig"

run_tool() {
  ( export IDENTITY_HOME_AGENTS="$FIX" \
           IDENTITY_OPENCODE_AGENTS="$SANDBOX/none1" \
           IDENTITY_CODEX_AGENTS="$SANDBOX/none2"
    sh "$TOOL" "$@" )
}

run_tool --dry-run >/dev/null 2>&1
cmp -s "$FIX" "$SANDBOX/orig" && ok "dry-run leaves file unchanged" || bad "dry-run mutated file"

run_tool --apply >/dev/null 2>&1
head -1 "$FIX" | grep -qF 'temperance:identity:start' && ok "apply inserts block at top" || bad "apply missing block"
grep -qF '# PAI 4.0.3 — Personal AI Infrastructure' "$FIX" && ok "apply preserves PAI body" || bad "apply lost PAI body"

run_tool --apply >/dev/null 2>&1
count=$(grep -cF 'temperance:identity:start' "$FIX")
[ "$count" = "1" ] && ok "apply idempotent (single block)" || bad "apply stacked $count blocks"

find "$TEMPERANCE_BACKUP_DIR" -type f -name 'AGENTS.md' 2>/dev/null | grep -q . \
  && ok "backup created on apply" || bad "no backup on apply"

run_tool --remove >/dev/null 2>&1
grep -qF 'temperance:identity' "$FIX" && bad "remove left block behind" || ok "remove strips block"
cmp -s "$FIX" "$SANDBOX/orig" && ok "remove restores original bytes" || bad "remove did not restore original"

printf '\n=== %d passed, %d failed ===\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
chmod +x tests/identity-tool.sh
sh tests/identity-tool.sh; echo "exit: $?"
```
Expected: FAIL — `scripts/apply-identity.sh` does not exist yet, so the tool invocations error and assertions fail; non-zero exit.

- [ ] **Step 3: Write the identity tool**

Create `scripts/apply-identity.sh`:

```sh
#!/usr/bin/env sh
set -eu

TEMPERANCE_ROOT="${TEMPERANCE_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
. "$TEMPERANCE_ROOT/scripts/lib.sh"

MODE=dryrun
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE=dryrun ;;
    --apply)   MODE=apply ;;
    --remove)  MODE=remove ;;
    -h|--help)
      printf '%s\n' "Usage: apply-identity.sh [--dry-run|--apply|--remove]"
      printf '%s\n' "Attaches the Temperance Engine identity block to the operator AGENTS.md files."
      printf '%s\n' "Dry-run by default; --apply writes (backup-first); --remove strips the block."
      exit 0 ;;
    *) printf '%s\n' "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

: "${IDENTITY_HOME_AGENTS:=$HOME/AGENTS.md}"
: "${IDENTITY_OPENCODE_AGENTS:=$HOME/.config/opencode/AGENTS.md}"
: "${IDENTITY_CODEX_AGENTS:=$HOME/.codex/AGENTS.md}"

START='<!-- temperance:identity:start -->'
END='<!-- temperance:identity:end -->'

identity_block() {
  printf '%s\n' "$START"
  printf '# Temperance Engine\n\n'
  printf 'This surface operates as **Temperance Engine**, the local operator identity for OpenCode/Codex.\n'
  printf 'Temperance Engine is the productized packaging of the PAI methodology below; the PAI doctrine,\n'
  printf 'phases, memory, and voice remain the operating substrate and are unchanged.\n'
  printf '%s\n\n' "$END"
}

strip_block() {
  awk -v s="$START" -v e="$END" '
    $0==s { inblk=1; next }
    inblk && $0==e { inblk=0; skipblank=1; next }
    inblk { next }
    skipblank && $0=="" { skipblank=0; next }
    { skipblank=0; print }
  ' "$1"
}

apply_one() {
  target="$1"
  if [ ! -f "$target" ]; then
    say "skip (missing): $target"
    return 0
  fi
  case "$MODE" in
    dryrun)
      say "DRY-RUN target: $target"
      say "Would ensure this block is at the top:"
      identity_block
      ;;
    apply)
      backup_file "$target"
      tmp="$target.temperance.tmp"
      { identity_block; strip_block "$target"; } > "$tmp"
      mv "$tmp" "$target"
      say "applied: $target"
      ;;
    remove)
      if grep -qF "$START" "$target"; then
        backup_file "$target"
        tmp="$target.temperance.tmp"
        strip_block "$target" > "$tmp"
        mv "$tmp" "$target"
        say "removed: $target"
      else
        say "no block present: $target"
      fi
      ;;
  esac
}

apply_one "$IDENTITY_HOME_AGENTS"
apply_one "$IDENTITY_OPENCODE_AGENTS"
apply_one "$IDENTITY_CODEX_AGENTS"
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
chmod +x scripts/apply-identity.sh
sh -n scripts/apply-identity.sh && sh tests/identity-tool.sh; echo "exit: $?"
```
Expected: all `PASS:`, final `=== 7 passed, 0 failed ===`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/apply-identity.sh tests/identity-tool.sh
git commit -m "feat: add surgical, reversible Temperance identity tool + test"
```

---

### Task 3: Repo integration (verify + ISA)

**Files:**
- Modify: `scripts/verify-install.sh`
- Modify: `ISA.md`

**Interfaces:**
- Consumes: the two new scripts and two new test files from Tasks 1–2.
- Produces: `verify.sh` passing with the new files tracked; ISA at 34/34.

- [ ] **Step 1: Add existence checks + lint the tests dir in verify-install.sh**

In `scripts/verify-install.sh`, after the line `check_file "$ROOT/docs/preference-layers.md"`, add:

```sh
check_file "$ROOT/scripts/apply-identity.sh"
check_file "$ROOT/tests/sandbox-install.sh"
check_file "$ROOT/tests/identity-tool.sh"
```

Then change the syntax-lint loop from:

```sh
for script in "$ROOT"/*.sh "$ROOT/scripts"/*.sh; do
  check_shell_syntax "$script"
done
```

to:

```sh
for script in "$ROOT"/*.sh "$ROOT/scripts"/*.sh "$ROOT/tests"/*.sh; do
  [ -f "$script" ] || continue
  check_shell_syntax "$script"
done
```

- [ ] **Step 2: Add ISC-33 and ISC-34 to ISA.md**

Bump front-matter `progress: 32/32` → `progress: 34/34`.

After the `- [x] ISC-32:` line, add:

```
- [x] ISC-33: `tests/sandbox-install.sh` asserts installer layering in an isolated sandbox (real install, backups, dry-run safety, restore-from-backup, hook behavior, GSD gating) and never touches the real home directory.
- [x] ISC-34: `scripts/apply-identity.sh` attaches the Temperance identity block to the operator `AGENTS.md` surfaces: dry-run default, backup-first, idempotent, and reversible (`--remove`), proven by `tests/identity-tool.sh`.
```

After the `| ISC-32 |` Test Strategy row, add:

```
| ISC-33 | shell | `sh tests/sandbox-install.sh` exits 0 with all assertions PASS | zero failures | run harness |
| ISC-34 | shell | `sh tests/identity-tool.sh` exits 0; tool has no unconditional write path and a `--remove` mode | zero failures | run test + grep |
```

After the `| Preference-layer precedence |` Features row, add:

```
| Layering test harness | ISC-33 | installer scripts | no |
| Identity port tool | ISC-34 | operator AGENTS.md surfaces | no |
```

After the last `2026-07-01:` Decisions entry, add:

```
- 2026-07-01: Port the runtime identity to live operator surfaces as an attached, reversible `<!-- temperance:identity -->` block (live-is-truth), never a content replacement; prove the installer layering first with an isolated sandbox harness that pins the Pulse port and cannot touch the real home directory.
```

- [ ] **Step 3: Run repo verification**

Run:
```bash
sh -n scripts/verify-install.sh && ./verify.sh
```
Expected: ends with `Temperance Engine verification passed`, including `ok:` lines for the three new files and `syntax ok:` for both `tests/*.sh`.

- [ ] **Step 4: Confirm ISA counts**

Run:
```bash
grep -c '^- \[x\] ISC-' ISA.md
```
Expected: `34`

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-install.sh ISA.md
git commit -m "chore: track identity port + layering harness in verify and ISA (ISC-33/34)"
```

---

### Task 4: Live identity port (GATED — touches the live environment)

**Files:**
- Modify (live, gated): `~/AGENTS.md`, `~/.config/opencode/AGENTS.md`, `~/.codex/AGENTS.md`

**Interfaces:**
- Consumes: `scripts/apply-identity.sh` from Task 2.
- Produces: three live operator files carrying the identity block above unchanged PAI content.

- [ ] **Step 1: Capture pre-apply bytes for a body diff**

Run:
```bash
for f in "$HOME/AGENTS.md" "$HOME/.config/opencode/AGENTS.md" "$HOME/.codex/AGENTS.md"; do
  cp "$f" "/tmp/te-preapply-$(printf '%s' "$f" | tr '/' '_')"
done
echo "captured"
```
Expected: `captured`

- [ ] **Step 2: Dry-run against live and present the exact block**

Run:
```bash
sh scripts/apply-identity.sh --dry-run
```
Expected: three `DRY-RUN target:` sections, each showing the identity block. No file modified.

- [ ] **Step 3: STOP — human go/no-go**

Present the dry-run output to the user. Do not proceed to Step 4 without an explicit "apply it" / "go". If no-go, stop here; nothing was changed.

- [ ] **Step 4: Apply for real (backup-first)**

Run:
```bash
sh scripts/apply-identity.sh --apply
```
Expected: three `applied:` lines.

- [ ] **Step 5: Verify identity present and PAI body intact**

Run:
```bash
grep -l 'temperance:identity' "$HOME/AGENTS.md" "$HOME/.config/opencode/AGENTS.md" "$HOME/.codex/AGENTS.md"
for f in "$HOME/AGENTS.md" "$HOME/.config/opencode/AGENTS.md" "$HOME/.codex/AGENTS.md"; do
  pre="/tmp/te-preapply-$(printf '%s' "$f" | tr '/' '_')"
  # strip the freshly-added block, compare to pre-apply bytes
  awk -v s='<!-- temperance:identity:start -->' -v e='<!-- temperance:identity:end -->' \
    '$0==s{inblk=1;next} inblk&&$0==e{inblk=0;skip=1;next} inblk{next} skip&&$0==""{skip=0;next} {skip=0;print}' \
    "$f" | cmp -s - "$pre" && echo "BODY-INTACT: $f" || echo "BODY-CHANGED: $f"
done
```
Expected: all three paths listed by `grep -l`, and three `BODY-INTACT:` lines (PAI content unchanged beneath the block).

- [ ] **Step 6: Record the rollback command (no commit — live files are outside the repo)**

Rollback is either:
```bash
sh scripts/apply-identity.sh --remove
```
or restore the newest backup under `$HOME/.temperance_engine/backups`. The live operator files are not part of this repo and are not committed.

---

## Self-Review

**Spec coverage:**
- Deliverable 1 (sandbox harness, 6 assertions) → Task 1. All six assertions present.
- Deliverable 2 (identity tool: dry-run default, backup-first, idempotent, reversible) → Task 2, proven by `tests/identity-tool.sh`.
- Execution sequence (harness green → tool → live dry-run → gated apply) → Tasks 1–4 in order, with the STOP gate in Task 4 Step 3.
- Verification + ISA tracking → Task 3.
- Rollback → Task 4 Step 6.
- Non-goals (no content replace, PAI core untouched, no new preference store) → enforced by the identity-block approach and Global Constraints.

**Placeholder scan:** No TBD/TODO; every script is shown in full; every command has expected output.

**Type/name consistency:** `run_install` (Task 1), `run_tool`/`apply_one`/`strip_block`/`identity_block` (Task 2) are defined where used. Markers `<!-- temperance:identity:start/end -->` identical across the tool, the tests, and Task 4's verify awk. Env override names (`IDENTITY_HOME_AGENTS` etc.) match between tool and test. Port `39337` used consistently in the harness.
