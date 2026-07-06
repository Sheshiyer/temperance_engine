# GSD-Awareness Hook Wiring + Non-Destructive ratandevelopers GSD Conversion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `temperance-parallel-dispatch` external-backend rail actually reachable inside GSD projects by (a) shipping a guarded, opt-in installer that safely registers the `ParallelDispatchContext` SessionStart hook into `~/.claude/settings.json`, and (b) non-destructively converting the real `ratandevelopers` project to GSD-managed so the wiring can be proven end-to-end.

**Architecture:** Three separable changes. **(A)** A new opt-in `scripts/wire-session-hook.sh` in `temperance_engine` copies the SessionStart hook to a stable `~/.claude/hooks/` path and `jq`-injects a `.hooks.SessionStart` entry pointing at it — backup-first, idempotent, atomic, `--revert`-symmetric — plus two defect fixes in the hook itself. This is the shippable PR. **(B)** `ratandevelopers` gets an additive `.planning/` (via interactive `/gsd:new-project` with research skipped, or a minimal manual scaffold) that *references* the existing `.docs/` corpus instead of regenerating it. **(C)** An end-to-end smoke test proves the hook fires there and a real `temperance-batch` dispatch executes on an external backend — all worktree-isolated so `ratandevelopers` tracked files are never touched.

**Tech Stack:** POSIX `sh` (the hook) + `bash` (wire script/tests, mirroring `scripts/wire-multi-backend.sh`), `jq` 1.7 for JSON-safe settings.json edits, GSD (`open-gsd/gsd-core`) for the `.planning/` structure, `temperance-batch` (→ `package/router/dispatch-tasklist.sh`) for the external rail.

## Global Constraints

- **Never blind-write `~/.claude/settings.json`.** Only ever: `backup_file` it → edit via `jq` into a `mktemp` temp → `jq empty` verify the temp → atomic `mv`. Never `sed`/`awk`/in-place. Abort byte-identical on any failure.
- **All paths generalized** through `$HOME` / `${PAI_HOME:-$HOME/.claude}` / `$REPO_ROOT` / `$SCRIPT_DIR` — no `/Users/...` or `/Volumes/...` literals in shipped files.
- **`settings.json` hook commands are absolute** (Claude Code requires it). Compute `CMD` once as the resolved stable path and use the identical string for add/check/remove.
- **Registered path is the stable `~/.claude/hooks/` copy, NEVER the `/Volumes` clone** (removable mount → broken SessionStart chain when unmounted).
- **`wire-session-hook.sh` is OPT-IN and MUST NOT be called from `install.sh`.** `install.sh` deliberately never touches `settings.json`.
- **Do NOT delete `docs/parallel-dispatch.md`** — `scripts/verify-install.sh:22` `check_file`s it; it is an intentional redirect stub (ISC-37). Only the hook's runtime *reference string* moves to `docs/pai-flow.md`.
- **Non-destructive to `ratandevelopers`:** never read/write/reference `.docs/`, README.md, the HTML brief, or any tracked file. `.planning/` is purely additive. The smoke dispatch runs `--worktree` + `--out /private/tmp`, and `--apply-worktree` is deliberately omitted. Invariant: `git -C ratandevelopers rev-parse HEAD` stays `9afa657…` and `git status --porcelain` stays empty across the whole run.
- **Rollback is defined for every change** and applied in reverse order (settings entry → hook copy → `.planning/` → tmp artifacts).

---

## File Structure

**temperance_engine (the shippable PR):**
- Modify: `package/hooks/ParallelDispatchContext.hook.sh` — two defect fixes (stale doc ref; stale header comment).
- Create: `scripts/wire-session-hook.sh` — the guarded opt-in installer (bash, self-contained, mirrors `wire-multi-backend.sh`; not sourced from `lib.sh`).
- Create: `tests/wire-session-hook.sh` — fixture-based test suite (bash, mirrors `tests/wire-batch.sh`). Auto-linted by `verify-install.sh`'s `tests/*.sh` loop.

**ratandevelopers (live, additive, separate repo):**
- Create: `.planning/PROJECT.md`, `.planning/config.json`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md` — GSD scaffold referencing `.docs/`.

**Machine state (live, reversible):**
- Create: `~/.claude/hooks/ParallelDispatchContext.hook.sh` (stable copy).
- Modify: `~/.claude/settings.json` — one appended `.hooks.SessionStart` group.

---

## Phase 1 — temperance_engine: hook fixes + guarded wire script (the PR)

### Task 1: Fix the two defects in `ParallelDispatchContext.hook.sh`

**Files:**
- Modify: `package/hooks/ParallelDispatchContext.hook.sh` (runtime string ~line 76; header comment ~lines 5-16)
- Test: `tests/wire-session-hook.sh` (defect-regression asserts, created in Task 3)

**Interfaces:**
- Produces: a hook that prints `See docs/pai-flow.md …` (not `docs/parallel-dispatch.md`) and whose header no longer claims "the installer does not copy this hook anywhere."

- [ ] **Step 1: Write the failing regression check** (temporary inline check; folded into `tests/wire-session-hook.sh` in Task 3)

```bash
grep -q 'docs/pai-flow.md' package/hooks/ParallelDispatchContext.hook.sh \
  && ! grep -q 'See docs/parallel-dispatch.md' package/hooks/ParallelDispatchContext.hook.sh \
  && ! grep -q 'installer does not copy this hook anywhere' package/hooks/ParallelDispatchContext.hook.sh \
  && echo PASS || echo FAIL
```

- [ ] **Step 2: Run it to verify it FAILS**

Run the block above. Expected: `FAIL` (current hook still points at `docs/parallel-dispatch.md` and carries the stale header claim).

- [ ] **Step 3: Fix defect 1 — the runtime doc reference**

In `package/hooks/ParallelDispatchContext.hook.sh`, change the `printf` guidance line:

```sh
# BEFORE:
printf 'See docs/parallel-dispatch.md before choosing sequential vs parallel work for this project.\n'
# AFTER:
printf 'See docs/pai-flow.md before choosing sequential vs parallel work for this project.\n'
```

*Why:* `docs/parallel-dispatch.md` is retired to a redirect stub (ISC-37); the live Execute-phase decision framework is in `docs/pai-flow.md`. Do NOT delete the stub — `verify-install.sh` still checks its presence.

- [ ] **Step 4: Fix defect 2 — the stale header comment**

Rewrite the header block (the lines describing installation) so it reads, in substance:

```sh
# Installed to a stable path by scripts/wire-session-hook.sh, which copies this
# file to $PAI_HOME/hooks/ParallelDispatchContext.hook.sh and registers a
# SessionStart entry pointing at that stable copy. If registering manually,
# point settings.json at that installed path -- never at a repo clone on a
# removable volume (it vanishes on unmount and breaks every future session).
```

Remove the two stale assertions: "The installer does not copy this hook anywhere" and the "clone (recommended if you may `git pull`)" guidance.

- [ ] **Step 5: Run the regression check to verify it PASSES**

Run the Step 1 block. Expected: `PASS`.

- [ ] **Step 6: Commit**

```bash
git add package/hooks/ParallelDispatchContext.hook.sh
git commit -m "fix(hook): ParallelDispatchContext points at docs/pai-flow.md; drop stale install header"
```

---

### Task 2: Create the guarded opt-in installer `scripts/wire-session-hook.sh`

**Files:**
- Create: `scripts/wire-session-hook.sh`
- Test: `tests/wire-session-hook.sh` (Task 3)

**Interfaces:**
- Consumes: `jq` on PATH; `package/hooks/ParallelDispatchContext.hook.sh` (`HOOK_SRC`); an existing, valid `$PAI_HOME/settings.json`.
- Produces CLI surface: `wire-session-hook.sh [--dry-run|--revert|--status|-h]`. Injects/removes exactly one `.hooks.SessionStart` group whose single `.hooks[].command == "$PAI_HOME/hooks/ParallelDispatchContext.hook.sh"`.
- Produces the three canonical `jq` filters (add/check/remove) reused by the tests.

- [ ] **Step 1: Write the full script**

Create `scripts/wire-session-hook.sh` (mirrors `wire-multi-backend.sh` conventions; self-contained bash; NOT sourced from `lib.sh`):

```bash
#!/usr/bin/env bash
# wire-session-hook.sh -- OPT-IN, backup-first registration of the
# ParallelDispatchContext SessionStart hook into settings.json.
#
# NOT called by install.sh. The default installer deliberately never writes
# settings.json (structure it does not own). This is the explicit, reversible
# opt-in for the GSD-awareness nudge. It (1) copies the hook to a STABLE path
# under $PAI_HOME/hooks/ (never the removable repo clone) and (2) jq-injects a
# SessionStart entry pointing at that stable path -- backup-first, idempotent,
# atomic. --revert is symmetric and ownership-guarded.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${TEMPERANCE_BACKUP_DIR:-$HOME/.temperance_engine/backups}/$TIMESTAMP"

PAI_HOME="${PAI_HOME:-$HOME/.claude}"
HOOKS_DIR="$PAI_HOME/hooks"
HOOK_DEST="$HOOKS_DIR/ParallelDispatchContext.hook.sh"
HOOK_SRC="$REPO_ROOT/package/hooks/ParallelDispatchContext.hook.sh"
SETTINGS="$PAI_HOME/settings.json"
CMD="$HOOK_DEST"   # exact absolute literal injected into and matched out of settings.json

MODE=install
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --revert)  MODE=revert ;;
    --status)  MODE=status ;;
    -h|--help)
      cat <<EOF
Usage: scripts/wire-session-hook.sh [--dry-run|--revert|--status|-h]

OPT-IN registration of the ParallelDispatchContext SessionStart hook.
NOT run by install.sh. Copies the hook to \$PAI_HOME/hooks/ and registers a
SessionStart entry pointing at that stable path. Backup-first, idempotent,
atomic, and reversible via --revert.
EOF
      exit 0 ;;
    *) printf 'unknown arg: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

log(){  printf '[wire-session] %s\n' "$*"; }
warn(){ printf '[wire-session] WARN: %s\n' "$*" >&2; }
err(){  printf '[wire-session] ERROR: %s\n' "$*" >&2; exit 1; }

# ---- jq filters (single source of truth; tests reuse these shapes) ----
JQ_CHECK='((.hooks.SessionStart // []) | any((.hooks // []) | any(.command == $cmd)))'
JQ_ADD='.hooks = (.hooks // {}) | .hooks.SessionStart = ((.hooks.SessionStart // []) + [{"hooks":[{"type":"command","command":$cmd}]}])'
JQ_REMOVE='.hooks.SessionStart = ((.hooks.SessionStart // []) | map(.hooks = ((.hooks // []) | map(select(.command != $cmd)))) | map(select((.hooks // []) | length > 0)))'

is_registered(){ jq -e --arg cmd "$CMD" "$JQ_CHECK" "$SETTINGS" >/dev/null 2>&1; }

require_valid_settings(){
  [ -f "$SETTINGS" ] || err "settings.json not found at $SETTINGS. Launch Claude Code once so it materializes its own settings.json; this script never fabricates it."
  jq empty "$SETTINGS" >/dev/null 2>&1 || err "$SETTINGS is not valid JSON; refusing to touch it."
}

backup_settings(){
  mkdir -p "$BACKUP_DIR"
  cp "$SETTINGS" "$BACKUP_DIR/settings.json"
  log "Backed up settings.json -> $BACKUP_DIR/settings.json"
}

# Atomic jq write: filter -> temp -> verify -> mv. Never edits in place.
jq_write(){  # $1 = jq filter
  local filter="$1" tmp
  tmp="$(mktemp "${SETTINGS}.XXXXXX")"
  trap 'rm -f "$tmp"' RETURN
  if ! jq --arg cmd "$CMD" "$filter" "$SETTINGS" > "$tmp"; then
    err "jq transform failed; settings.json left untouched."
  fi
  jq empty "$tmp" >/dev/null 2>&1 || err "jq produced invalid JSON; settings.json left untouched."
  mv "$tmp" "$SETTINGS"
  trap - RETURN
}

install_hook_file(){
  if [ "$DRY_RUN" = "1" ]; then
    log "Would ensure $HOOKS_DIR exists"
    [ -e "$HOOK_DEST" ] && log "Would back up existing $HOOK_DEST" || true
    log "Would copy hook -> $HOOK_DEST (chmod +x)"
    return 0
  fi
  mkdir -p "$HOOKS_DIR"
  if [ -e "$HOOK_DEST" ]; then
    mkdir -p "$BACKUP_DIR"
    cp "$HOOK_DEST" "$BACKUP_DIR/ParallelDispatchContext.hook.sh"
    log "Backed up existing hook -> $BACKUP_DIR/ParallelDispatchContext.hook.sh"
  fi
  cp "$HOOK_SRC" "$HOOK_DEST"
  chmod +x "$HOOK_DEST"
  log "Installed hook -> $HOOK_DEST"
}

do_install(){
  command -v jq >/dev/null 2>&1 || err "jq is required but not found on PATH"
  [ -f "$HOOK_SRC" ] || err "hook source not found: $HOOK_SRC"
  require_valid_settings

  install_hook_file

  if is_registered; then
    log "[skip] SessionStart entry already registered ($CMD)"
    check_status
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "Would back up settings.json"
    log "Would add SessionStart entry: $CMD"
    check_status
    return 0
  fi

  backup_settings
  jq_write "$JQ_ADD"
  log "Registered SessionStart entry: $CMD"
  check_status
  log "Restart Claude Code to load the new SessionStart hook."
  log "To revert: $0 --revert"
}

do_revert(){
  command -v jq >/dev/null 2>&1 || err "jq is required but not found on PATH"
  # (a) settings.json entry
  if [ -f "$SETTINGS" ] && jq empty "$SETTINGS" >/dev/null 2>&1; then
    if is_registered; then
      if [ "$DRY_RUN" = "1" ]; then
        log "Would back up settings.json and remove SessionStart entry: $CMD"
      else
        backup_settings
        jq_write "$JQ_REMOVE"
        log "Removed SessionStart entry: $CMD"
      fi
    else
      log "[skip] no SessionStart entry to remove"
    fi
  else
    warn "settings.json missing or invalid; skipping entry removal"
  fi
  # (b) stable hook file -- only if it is a regular file we own (never a symlink)
  if [ -L "$HOOK_DEST" ]; then
    warn "$HOOK_DEST is a symlink (user-managed); leaving it in place"
  elif [ -f "$HOOK_DEST" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      log "Would remove hook file: $HOOK_DEST"
    else
      rm -f "$HOOK_DEST"
      log "Removed hook file: $HOOK_DEST"
    fi
  else
    log "[skip] no hook file at $HOOK_DEST"
  fi
}

check_status(){
  printf '\n'
  printf '═══════════════════════════════════════════════════════════════\n'
  printf 'TEMPERANCE ENGINE - SESSIONSTART HOOK WIRING STATUS\n'
  printf '═══════════════════════════════════════════════════════════════\n'
  if [ -L "$HOOK_DEST" ]; then
    printf '  [SYMLINK] hook: %s\n' "$HOOK_DEST"
  elif [ -f "$HOOK_DEST" ]; then
    printf '  [OK]      hook: %s\n' "$HOOK_DEST"
  else
    printf '  [MISSING] hook: %s\n' "$HOOK_DEST"
  fi
  if [ -f "$SETTINGS" ] && jq empty "$SETTINGS" >/dev/null 2>&1; then
    if is_registered; then
      printf '  [REGISTERED]     SessionStart entry present\n'
    else
      printf '  [NOT REGISTERED] SessionStart entry absent\n'
    fi
    printf '  SessionStart groups: %s\n' "$(jq '.hooks.SessionStart | length' "$SETTINGS")"
  else
    printf '  [MISSING] settings.json (%s)\n' "$SETTINGS"
  fi
  printf '═══════════════════════════════════════════════════════════════\n'
}

case "$MODE" in
  status) check_status ;;
  revert) do_revert ;;
  *)      do_install ;;
esac
```

- [ ] **Step 2: Syntax-check**

Run: `bash -n scripts/wire-session-hook.sh`
Expected: no output, exit 0.

- [ ] **Step 3: Smoke the `--help` and `--status` paths (no mutation)**

Run: `bash scripts/wire-session-hook.sh --help` → prints usage, exit 0.
Run: `bash scripts/wire-session-hook.sh --status` → prints the status banner reading current live state (`[MISSING]`/`[NOT REGISTERED]` expected pre-install), exit 0, and **no file changed**.

- [ ] **Step 4: Commit**

```bash
git add scripts/wire-session-hook.sh
git commit -m "feat(wire): opt-in scripts/wire-session-hook.sh registers the SessionStart hook (backup-first, idempotent, --revert)"
```

---

### Task 3: Fixture-based test suite `tests/wire-session-hook.sh`

**Files:**
- Create: `tests/wire-session-hook.sh`
- Modify: (none — `verify-install.sh` auto-lints `tests/*.sh`)

**Interfaces:**
- Consumes: `scripts/wire-session-hook.sh` driven against an **isolated fixture** via `PAI_HOME` override to a `mktemp -d` dir (the operator's real `~/.claude/settings.json` is NEVER touched by the test).

- [ ] **Step 1: Write the test suite**

Create `tests/wire-session-hook.sh` (mirrors `tests/wire-batch.sh`/`tests/skill-install.sh` skeleton):

```bash
#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$DIR/scripts/wire-session-hook.sh"
HOOK="$DIR/package/hooks/ParallelDispatchContext.hook.sh"
fail=0

# --- hook defect regressions (Task 1) ---
grep -q 'docs/pai-flow.md' "$HOOK" && echo "ok - hook points at docs/pai-flow.md" || { echo "FAIL - hook missing pai-flow.md ref"; fail=1; }
grep -q 'See docs/parallel-dispatch.md' "$HOOK" && { echo "FAIL - hook still surfaces retired parallel-dispatch.md"; fail=1; } || echo "ok - retired doc ref not surfaced"
grep -q 'installer does not copy this hook anywhere' "$HOOK" && { echo "FAIL - stale header claim present"; fail=1; } || echo "ok - stale header claim removed"

# --- isolated fixture: a settings.json with 4 SessionStart groups + a sentinel top-level key ---
FIX="$(mktemp -d)"
export PAI_HOME="$FIX"
cat > "$FIX/settings.json" <<'JSON'
{
  "unknownTopKey": 123,
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "/x/a.ts" } ] },
      { "hooks": [ { "type": "command", "command": "/x/b.js" } ] },
      { "matcher": "", "hooks": [ { "type": "command", "command": "/x/peon.sh", "timeout": 5 } ] },
      { "hooks": [ { "type": "command", "command": "/x/c.ts" } ] }
    ]
  }
}
JSON
CMD="$FIX/hooks/ParallelDispatchContext.hook.sh"
before_sha="$(shasum "$FIX/settings.json" | awk '{print $1}')"

# --- DRY-RUN mutates nothing ---
out="$(bash "$SCRIPT" --dry-run 2>&1)"; rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q 'Would add' && echo "ok - dry-run logs Would add" || { echo "FAIL - dry-run"; fail=1; }
after_sha="$(shasum "$FIX/settings.json" | awk '{print $1}')"
[ "$before_sha" = "$after_sha" ] && echo "ok - dry-run left settings.json byte-identical" || { echo "FAIL - dry-run mutated settings.json"; fail=1; }
[ ! -e "$CMD" ] && echo "ok - dry-run created no hook file" || { echo "FAIL - dry-run created hook file"; fail=1; }

# --- INSTALL adds exactly one entry ---
bash "$SCRIPT" >/dev/null 2>&1
len="$(jq '.hooks.SessionStart | length' "$FIX/settings.json")"
[ "$len" = "5" ] && echo "ok - install added one group (5 total)" || { echo "FAIL - group count $len"; fail=1; }
occ="$(jq --arg c "$CMD" '[.hooks.SessionStart[].hooks[]?.command] | map(select(. == $c)) | length' "$FIX/settings.json")"
[ "$occ" = "1" ] && echo "ok - exactly one occurrence of our command" || { echo "FAIL - occurrence=$occ"; fail=1; }
[ -f "$CMD" ] && echo "ok - hook copied to stable path" || { echo "FAIL - hook not copied"; fail=1; }

# --- IDEMPOTENT second run ---
out2="$(bash "$SCRIPT" 2>&1)"
echo "$out2" | grep -q 'already registered' && echo "ok - second run is a skip" || { echo "FAIL - not idempotent"; fail=1; }
len2="$(jq '.hooks.SessionStart | length' "$FIX/settings.json")"
[ "$len2" = "5" ] && echo "ok - no duplicate on second run" || { echo "FAIL - duplicate group ($len2)"; fail=1; }

# --- unknown keys + foreign groups preserved after install ---
[ "$(jq '.unknownTopKey' "$FIX/settings.json")" = "123" ] && echo "ok - unknown top-level key preserved" || { echo "FAIL - lost unknown key"; fail=1; }
jq -e '[.hooks.SessionStart[].hooks[]?.command] | index("/x/peon.sh")' "$FIX/settings.json" >/dev/null && echo "ok - foreign command preserved" || { echo "FAIL - foreign command dropped"; fail=1; }

# --- REVERT restores symmetry ---
bash "$SCRIPT" --revert >/dev/null 2>&1
len3="$(jq '.hooks.SessionStart | length' "$FIX/settings.json")"
[ "$len3" = "4" ] && echo "ok - revert restored group count" || { echo "FAIL - revert count $len3"; fail=1; }
occ3="$(jq --arg c "$CMD" '[.hooks.SessionStart[].hooks[]?.command] | map(select(. == $c)) | length' "$FIX/settings.json")"
[ "$occ3" = "0" ] && echo "ok - revert removed our entry" || { echo "FAIL - entry remains"; fail=1; }
[ ! -e "$CMD" ] && echo "ok - revert removed stable hook file" || { echo "FAIL - hook file remains"; fail=1; }
[ "$(jq '.unknownTopKey' "$FIX/settings.json")" = "123" ] && echo "ok - unknown key survived revert" || { echo "FAIL - revert lost unknown key"; fail=1; }

# --- VALID JSON after every op ---
jq empty "$FIX/settings.json" && echo "ok - settings.json still valid JSON" || { echo "FAIL - invalid JSON"; fail=1; }

# --- REVERT-when-absent is a no-op ---
sha_x="$(shasum "$FIX/settings.json" | awk '{print $1}')"
bash "$SCRIPT" --revert >/dev/null 2>&1
sha_y="$(shasum "$FIX/settings.json" | awk '{print $1}')"
[ "$sha_x" = "$sha_y" ] && echo "ok - revert-when-absent is a no-op" || { echo "FAIL - revert-absent mutated"; fail=1; }

# --- GUARD: missing settings.json errs, does not fabricate ---
FIX2="$(mktemp -d)"; PAI_HOME="$FIX2" bash "$SCRIPT" >/dev/null 2>&1
[ $? -ne 0 ] && [ ! -e "$FIX2/settings.json" ] && echo "ok - missing settings.json errs, not fabricated" || { echo "FAIL - fabricated or exited 0 on missing settings"; fail=1; }

# --- GUARD: invalid settings.json refused, left untouched ---
FIX3="$(mktemp -d)"; printf '{ "hooks": ' > "$FIX3/settings.json"; broke_before="$(shasum "$FIX3/settings.json" | awk '{print $1}')"
PAI_HOME="$FIX3" bash "$SCRIPT" >/dev/null 2>&1
broke_after="$(shasum "$FIX3/settings.json" | awk '{print $1}')"
[ "$broke_before" = "$broke_after" ] && echo "ok - invalid settings.json left untouched" || { echo "FAIL - touched invalid settings.json"; fail=1; }

rm -rf "$FIX" "$FIX2" "$FIX3"
exit $fail
```

- [ ] **Step 2: Run the test suite**

Run: `bash tests/wire-session-hook.sh`
Expected: every line `ok - …`, exit 0.

- [ ] **Step 3: Run the full repo gate**

Run: `bash verify.sh` (expect `Temperance Engine verification passed`, exit 0), then each `tests/*.sh` (all PASS), then `cd package/enrich && bun test` (expect `40 pass`).

- [ ] **Step 4: Commit**

```bash
git add tests/wire-session-hook.sh
git commit -m "test(wire): fixture-based tests for wire-session-hook.sh (dry-run/idempotency/revert/guards)"
```

---

## Phase 2 — Apply the wiring live on this machine

### Task 4: Register the SessionStart hook live (backup-first)

**Files:** live machine only (`~/.claude/hooks/`, `~/.claude/settings.json`) — no repo files.

- [ ] **Step 1: Dry-run against the REAL settings.json**

Run: `bash scripts/wire-session-hook.sh --dry-run`
Expected: `Would add SessionStart entry: /Users/<you>/.claude/hooks/ParallelDispatchContext.hook.sh`, status shows `[MISSING]`/`[NOT REGISTERED]`, exit 0. **Confirm nothing changed:** `jq '.hooks.SessionStart | length' ~/.claude/settings.json` still `4`.

- [ ] **Step 2: Apply live**

Run: `bash scripts/wire-session-hook.sh`
Expected: `Installed hook -> …`, `Backed up settings.json -> ~/.temperance_engine/backups/<ts>/settings.json`, `Registered SessionStart entry`, status `[OK]`/`[REGISTERED]`, `SessionStart groups: 5`.

- [ ] **Step 3: Verify JSON validity + exactly one entry**

```bash
jq empty ~/.claude/settings.json && echo VALID
jq '[.hooks.SessionStart[].hooks[]?.command] | map(select(test("ParallelDispatchContext"))) | length' ~/.claude/settings.json   # -> 1
test -x ~/.claude/hooks/ParallelDispatchContext.hook.sh && echo "hook installed + executable"
```
Expected: `VALID`, `1`, `hook installed + executable`.

- [ ] **Step 4: Idempotency check live**

Run: `bash scripts/wire-session-hook.sh` again → `[skip] … already registered`, `SessionStart groups: 5` (unchanged).

---

## Phase 3 — ratandevelopers: non-destructive GSD conversion

> **Non-destructive contract:** everything here is additive to `.planning/`. `.docs/` is never read or written by GSD. Confirm `git -C <ratandevelopers> status --porcelain` shows ONLY the new untracked `.planning/` path afterward.

**Absolute path:** `/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/ratandevelopers` (referred to below as `$RD`).

### Task 5: Create the additive `.planning/` scaffold

Two routes — **5A (recommended)** interactive GSD, or **5B** minimal manual scaffold if you can't run the interactive command. Do ONE.

**Interfaces (both routes produce):** `.planning/PROJECT.md` (with the three health-required headers `## What This Is`, `## Core Value`, `## Requirements`), `.planning/config.json` (top-level `model_profile` + `workflow.auto_advance` — the two keys the hook reads), `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md`.

- [ ] **Step 1: Confirm clean starting state**

```bash
git -C "$RD" status --porcelain    # expected: empty
ls "$RD/.planning" 2>&1            # expected: No such file or directory
```

- [ ] **Step 2 (Route 5A — recommended): interactive `/gsd:new-project`**

In a Claude Code session **whose project dir is `$RD`**, run `/gsd:new-project`. When it asks *"Research the domain ecosystem?"*, choose **Skip research** (this is the single control that prevents GSD spawning 4 researcher agents that would write competing docs into `.planning/research/`). When prompted for context, cite the existing corpus. GSD detects no code (`is_brownfield=false`) so it will NOT offer codebase mapping. It writes only under `.planning/`.

Then **edit `.planning/PROJECT.md`** to add the `## Context` block citing `.docs/` (see 5B sample), and **rewrite `.planning/ROADMAP.md`** phases to map 1:1 onto `.docs/plans/2026-07-05-coauthor-m1-possibilities-demo.md` (see 5B sample).

- [ ] **Step 2 (Route 5B — manual fallback): write the 5 files verbatim**

Only if you cannot run the interactive command. `mkdir -p "$RD/.planning"`, then create:

`.planning/config.json`:
```json
{
  "model_profile": "balanced",
  "commit_docs": true,
  "parallelization": true,
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": true,
    "auto_advance": false,
    "discuss_mode": "discuss"
  },
  "hooks": { "context_warnings": true },
  "agent_skills": {}
}
```

`.planning/PROJECT.md`:
```markdown
# Ratan Developers — Property Co-Author

## What This Is

A buyer-driven PropTech co-authoring funnel for North Bangalore (Sahakara Nagar / Kodigehalli) real estate: AI voice discovery -> personalized landing -> real-time 3D villa customization -> transparent earned-rank reveal -> Expression of Interest.

## Core Value

The voice-call -> personalized "your home is ready" -> instant 3D material-swap -> honest earned-rank reveal must feel magical and compliant (earned rank, never a live decreasing price).

## Requirements

### Validated
(None yet — pre-build; market research complete under .docs/)

### Active
- [ ] M1 "Possibilities Demo" per .docs/plans/2026-07-05-coauthor-m1-possibilities-demo.md
- [ ] Reuse M0 funnel/discovery contracts verbatim
- [ ] Mobile-first R3F 3D configurator

### Out of Scope
- Live decreasing price the buyer pays — compliance (earned rank only)

## Context

Domain research is COMPLETE and lives in .docs/ (do NOT regenerate):
- .docs/Property_CoAuthor_Market_Research_Brief.pdf, .docs/property_coauthor_report.html
- .docs/Bangalore_Location_Report_13.060083N_77.610528E.md, .docs/Bangalore_North_Housing_Inventory_8km_Report.md, .docs/Bangalore_North_RealEstate_Inventory_8km_Radius.md, .docs/North_Bangalore_Development_Recommendation_Report.md
- .docs/bangalore_metro_connectivity_analysis_13.060083N_77.610528E.md, .docs/lake_proximity_report_sahakara_nagar.md, .docs/north_bangalore_land_rates_report_2026.md
- Prior plans: .docs/plan.md, .docs/plans/2026-07-05-coauthor-m1-possibilities-demo.md
- ../property_coauthor_strategy_brief.html (repo root)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Skip GSD research; reuse .docs/ | Corpus already exists | Pending |

---
*Last updated: 2026-07-06 after manual GSD scaffold*
```

`.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md`: use the exact sample content from the research output (phases mapping to the M1 demo plan; STATE.md < 100 lines with Phase numbers aligned to ROADMAP; REQ-01..REQ-05 derived from the demo plan's constraints/beats). *(Full samples are in the research result attached to this plan's session; reproduce them verbatim.)*

- [ ] **Step 3: Verify additive-only (nothing existing touched)**

```bash
git -C "$RD" status --porcelain          # expected: only "?? .planning/" lines
git -C "$RD" diff --stat                 # expected: EMPTY (no tracked file changed)
```
If anything under `.docs/`, `README.md`, or the HTML brief shows up → STOP, you mutated existing work; revert and investigate.

- [ ] **Step 4: (Decision) commit `.planning/` to ratandevelopers or leave untracked**

For the verification pass, **leave it untracked** so rollback is a clean delete. Only commit deliberately if you've decided GSD state should persist in that repo (a separate, explicit choice — see rollback).

---

### Task 6: Verify the hook now fires in ratandevelopers

- [ ] **Step 1: Fire the installed hook against ratandevelopers**

```bash
CLAUDE_PROJECT_DIR="$RD" sh ~/.claude/hooks/ParallelDispatchContext.hook.sh; echo "exit=$?"
```
Expected stdout (note the **post-Task-1** doc reference):
```
<system-reminder>
GSD-managed project detected (.planning/ present).
GSD config.json model_profile: balanced (read-only; GSD remains authoritative for its own workflow config)
GSD config.json workflow.auto_advance: false
See docs/pai-flow.md before choosing sequential vs parallel work for this project.
</system-reminder>
exit=0
```
(The `model_profile`/`auto_advance` lines appear because `.planning/config.json` carries those keys. If you did an empty-dir minimal case, only the "detected" + "See docs/pai-flow.md" lines appear.)

- [ ] **Step 2: Prove it's gated on the dir, not cwd**

```bash
cd ~ && CLAUDE_PROJECT_DIR="$RD" sh ~/.claude/hooks/ParallelDispatchContext.hook.sh | head -1
```
Expected: same first line — confirms a real SessionStart (which sets `CLAUDE_PROJECT_DIR`) fires regardless of launcher cwd.

---

## Phase 4 — End-to-end smoke test (worktree-isolated, non-destructive)

### Task 7: Negative control — hook stays silent without `.planning/`

- [ ] **Step 1: Guaranteed-clean control**

```bash
SC=$(mktemp -d); OUT=$(CLAUDE_PROJECT_DIR="$SC" sh ~/.claude/hooks/ParallelDispatchContext.hook.sh); RC=$?; rmdir "$SC"
[ -z "$OUT" ] && [ "$RC" -eq 0 ] && echo NEGATIVE_PASS || echo NEGATIVE_FAIL
```
Expected: `NEGATIVE_PASS`.

### Task 8: Real external-backend dispatch inside ratandevelopers

**Interfaces:** `temperance-batch --tasks <json> --worktree --foreground --out <dir>` → writes `index.json`, `SUMMARY.md`, `<id>.out`, `<id>.diff` under `<out>`; per-task `status` ∈ `ok|failed|timeout|unavailable`.

- [ ] **Step 1: Record the pre-run invariant**

```bash
git -C "$RD" rev-parse HEAD          # record (expected 9afa657…)
git -C "$RD" status --porcelain      # expected: only "?? .planning/" (or empty if not created)
git -C "$RD" worktree list           # expected: only the main worktree
```

- [ ] **Step 2: Write a trivial read-only task file (to /private/tmp, NOT the repo)**

```bash
cat > /private/tmp/te-smoke-tasks.json <<'JSON'
[{"id":"smoke","task":"Reply with exactly the word PONG and nothing else."}]
JSON
```

- [ ] **Step 3: Dispatch, worktree-isolated, output to /private/tmp**

```bash
cd "$RD"
RUN=/private/tmp/te-smoke-run
temperance-batch --tasks /private/tmp/te-smoke-tasks.json --worktree --foreground --out "$RUN"
```

- [ ] **Step 4: Inspect — prove an external backend actually executed**

```bash
jq '.summary, (.tasks[] | {id,backend,model,status,exit,duration_s})' "$RUN/index.json"
cat "$RUN/SUMMARY.md"
cat "$RUN/smoke.out"     # backend's literal stdout — should contain PONG
cat "$RUN/smoke.diff"    # EMPTY for this read-only task
```
Expected: `.tasks[0].status == "ok"`, `exit == 0`, a real `backend/model` (e.g. `command-code/claude-sonnet-5` or `grok/grok-build`), `duration_s > 0` (the proof the external rail ran — a phantom rail would emit `EXTERNAL_RAIL_UNAVAILABLE`/`unavailable`); `smoke.out` contains `PONG`; `smoke.diff` empty; SUMMARY shows `- [ok] smoke (...) exit=0`.

- [ ] **Step 5: Assert the post-run invariant (non-destructive)**

```bash
git -C "$RD" rev-parse HEAD          # unchanged
git -C "$RD" status --porcelain      # unchanged (only "?? .planning/" or empty)
git -C "$RD" worktree list           # only the main worktree — no te-dispatch/* residue
git -C "$RD" for-each-ref refs/heads/te-dispatch/*   # empty
```
Expected: HEAD unchanged, status unchanged, no worktree/branch residue. If a worktree leaked, `SUMMARY.md`/`$RUN/.leaks` will name it — prune with `git -C "$RD" worktree prune` + delete stragglers.

---

## Phase 5 — Finish the temperance_engine branch → PR

### Task 9: Final gate + PR

- [ ] **Step 1: Final full gate on the branch HEAD**

Run `bash verify.sh`, every `tests/*.sh` (incl. `tests/wire-session-hook.sh`), and `cd package/enrich && bun test`. All green.

- [ ] **Step 2: Branch, push, PR**

```bash
git checkout -b wire-session-hook
git push -u origin wire-session-hook
gh pr create --title "feat(wire): opt-in SessionStart hook installer + ParallelDispatchContext doc fixes" \
  --body "Adds scripts/wire-session-hook.sh (guarded, backup-first, idempotent, --revert) to register the ParallelDispatchContext SessionStart hook, and fixes two defects in the hook (retired doc ref -> docs/pai-flow.md; stale install header). Opt-in only; install.sh untouched. Tests: tests/wire-session-hook.sh."
```

- [ ] **Step 3: Watch CI (`guard` + `verify`) to green, then hold for review** (matches the session's established PR flow).

### Task 10: Record rollback (reference — do NOT execute unless rolling back)

Reverse order, so no window where a registered hook points at a deleted file:
1. `bash scripts/wire-session-hook.sh --revert` — removes the settings.json entry AND the stable hook file (symlink-guarded), backup-first.
2. `rmdir "$RD/.planning"` (or `rm -rf` if populated) — remove the additive dir; `git -C "$RD" status --porcelain` empty again.
3. `rm -rf /private/tmp/te-smoke-run /private/tmp/te-smoke-tasks.json` — tmp artifacts.
4. Full settings.json restore if ever needed: `cp ~/.temperance_engine/backups/<ts>/settings.json ~/.claude/settings.json` then `jq empty` verify.

---

## Self-Review

**1. Spec coverage** — every concern from the session maps to a task:
- Guarded settings.json write (never blind-write) → Task 2 (`jq_write` atomic temp+verify+mv, backup-first) + Task 3 guards.
- Two hook defects → Task 1.
- Opt-in, not in install.sh → Task 2 header + Global Constraints (verified: `install.sh` unchanged).
- Live apply → Task 4.
- Non-destructive GSD conversion referencing `.docs/` → Task 5 (Skip research; cite corpus; additive-only assert in Step 3).
- Hook fires in the real project → Task 6.
- External backend actually runs → Task 8 (real `temperance-batch`, `duration_s>0`, `PONG`).
- Non-destructive proof → Tasks 5.3, 8.1, 8.5 (HEAD + porcelain + worktree invariants).
- Rollback → Task 10 + Global Constraints.

**2. Placeholder scan** — one deliberate pointer: Task 5B references the research result for the verbatim `ROADMAP.md`/`STATE.md`/`REQUIREMENTS.md` sample bodies rather than re-pasting ~120 lines; `config.json` and `PROJECT.md` (the two the hook + health check actually key on) are inline in full. Acceptable: the cited content is in this session's research output and Route 5A (recommended) generates these files via GSD anyway.

**3. Type/name consistency** — `CMD` is computed once (`$HOOK_DEST`) and reused across `JQ_CHECK`/`JQ_ADD`/`JQ_REMOVE` and the tests. `PAI_HOME` override is honored uniformly (script + tests). The hook's post-fix output string (`docs/pai-flow.md`) is consistently reflected in Task 6's expected output. `--apply-worktree` is consistently omitted in Task 8.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-06-gsd-hook-wiring-and-ratandevelopers-conversion.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
