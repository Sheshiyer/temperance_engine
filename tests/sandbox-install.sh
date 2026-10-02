#!/usr/bin/env sh
# Sandbox test harness for the Temperance Engine installer.
# Runs real file installation in two bounded phases; no Pulse/service startup.
# Never touches the real home directory. Not run from verify-install.sh (would recurse).
set -u

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1" >&2; }

SANDBOX=$(mktemp -d 2>/dev/null || mktemp -d -t tesandbox)
INSTALL_ROOT="$SANDBOX/install"
# Qualification supplies independently pinned real tools. Ordinary developers
# may discover binaries on PATH; that default hash is observation, not trust.
TEST_NODE=${TEMPERANCE_TEST_NODE:-$(command -v node 2>/dev/null || true)}
TEST_BUN=${TEMPERANCE_TEST_BUN:-$(command -v bun 2>/dev/null || true)}
cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
mkdir -p "$INSTALL_ROOT" "$SANDBOX/tools" "$SANDBOX/gsd-tools" "$SANDBOX/tmp"
FILE_PATH="$SANDBOX/tools"
GSD_PATH="$SANDBOX/gsd-tools:$FILE_PATH"
# Closed stock tool inventory. No ambient bin directory is appended, so Bun,
# CodeGraph, gsd-sdk, client CLIs, launchctl and service tools cannot leak in.
for tool in sh bash env awk basename cat chmod cmp cp date dirname find grep \
    head ln ls mkdir mktemp mv readlink rm rmdir rsync sed sort tail touch tr \
    uname wc python3; do
  if [ -x "/usr/bin/$tool" ]; then stock="/usr/bin/$tool"
  elif [ -x "/bin/$tool" ]; then stock="/bin/$tool"
  else printf 'HOLD: required stock tool missing: %s\n' "$tool" >&2; exit 1
  fi
  ln -s "$stock" "$FILE_PATH/$tool" || exit 1
done

copy_real_tool() {
  env -i PATH="$FILE_PATH" HOME="$SANDBOX" TMPDIR="$SANDBOX/tmp" \
    "$FILE_PATH/python3" - "$1" "$2" "$3" <<'PYTOOL'
import hashlib, os, pathlib, re, stat, sys
source, destination, expected = sys.argv[1:]
if not source or not os.path.isabs(source):
    raise SystemExit("HOLD: absolute real tool path required")
if expected and not re.fullmatch(r"[0-9a-f]{64}", expected):
    raise SystemExit("HOLD: malformed expected tool hash")
source = str(pathlib.Path(source).resolve(strict=True))
fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
try:
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode) or not before.st_mode & 0o111:
        raise SystemExit("HOLD: tool is not an executable regular binary")
    with os.fdopen(fd, "rb", closefd=False) as stream:
        body = stream.read()
    after = os.fstat(fd)
    current = os.stat(source, follow_symlinks=False)
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_mode)
    if identity(before) != identity(after) or identity(after) != identity(current):
        raise SystemExit("HOLD: tool changed during read")
finally:
    os.close(fd)
# Reject shell/JS wrappers; binary format alone does not authenticate a tool.
if body[:4] not in (b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xfe\xed\xfa\xce", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf"):
    raise SystemExit("HOLD: expected real executable binary, not a wrapper")
digest = hashlib.sha256(body).hexdigest()
if expected and digest != expected:
    raise SystemExit("HOLD: tool hash differs from independent fixture pin")
with open(destination, "xb") as out:
    out.write(body)
os.chmod(destination, 0o700)
if hashlib.sha256(pathlib.Path(destination).read_bytes()).hexdigest() != digest:
    raise SystemExit("HOLD: copied tool differs")
print(("independent-pin-matched" if expected else "observed-only-untrusted-discovery") + ": " + pathlib.Path(destination).name + " sha256=" + digest)
PYTOOL
}
copy_real_tool "$TEST_NODE" "$FILE_PATH/node" "${TEMPERANCE_TEST_NODE_SHA256:-}" || exit 1
copy_real_tool "$TEST_BUN" "$SANDBOX/gsd-tools/bun" "${TEMPERANCE_TEST_BUN_SHA256:-}" || exit 1

fixture_env() {
  fixture_root="$1"; fixture_path="$2"; shift 2
  env -i PATH="$fixture_path" HOME="$fixture_root" TMPDIR="$SANDBOX/tmp" \
    PAI_HOME="$fixture_root/.claude" PAI_DIR="$fixture_root/.claude/PAI" \
    CLAUDE_HOME="$fixture_root/.claude" CLAUDE_CONFIG_DIR="$fixture_root/.claude" \
    GSD_HOME="$fixture_root/.claude/get-shit-done" \
    CODEX_HOME="$fixture_root/.codex" \
    OPENCODE_HOME="$fixture_root/.config/opencode" OPENCODE_CONFIG_DIR="$fixture_root/.config/opencode" \
    CURSOR_HOME="$fixture_root/.cursor" CURSOR_CONFIG_DIR="$fixture_root/.cursor" \
    AGENTS_HOME="$fixture_root/.agents" \
    XDG_CONFIG_HOME="$fixture_root/.config" XDG_STATE_HOME="$fixture_root/.local/state" \
    XDG_DATA_HOME="$fixture_root/.local/share" XDG_CACHE_HOME="$fixture_root/.cache" \
    TEMPERANCE_STATE="$fixture_root/.temperance_engine" TEMPERANCE_STATE_DIR="$fixture_root/.temperance_engine" \
    TEMPERANCE_BACKUP_DIR="$fixture_root/.temperance_engine/backups" \
    LIVE=0 TEMPERANCE_ALLOW_LIVE_INSPECTION=0 DO_NOT_TRACK=1 CI=1 "$@"
}
run_install() {
  root="$1"; shift
  fixture_env "$root" "$FILE_PATH" sh "$REPO_ROOT/install.sh" \
    --skip-voice --skip-gsd --skip-manifest --skip-relay "$@"
}
run_gsd_install() {
  root="$1"; shift
  fixture_env "$root" "$GSD_PATH" sh "$REPO_ROOT/install.sh" \
    --skip-voice --skip-manifest --skip-relay --skip-claude --with-codex --with-gsd "$@"
}
assert_no_pulse() {
  if [ ! -e "$1/.claude/PAI/PULSE/compat-server.pid" ] \
      && [ ! -L "$1/.claude/PAI/PULSE/compat-server.pid" ] \
      && [ ! -e "$1/.claude/PAI/PULSE/compat-server.log" ] \
      && [ ! -L "$1/.claude/PAI/PULSE/compat-server.log" ]; then
    ok "Pulse startup pid/log artifacts absent after bounded file-install phases"
  else
    bad "unexpected Pulse startup artifact; no pidfile process adopted or signalled"
  fi
}

if fixture_env "$INSTALL_ROOT" "$FILE_PATH" sh -c '
  for tool in bun codegraph gsd-sdk claude codex opencode cursor command-code kimi launchctl; do
    if command -v "$tool" >/dev/null 2>&1; then exit 1; fi
  done
'; then
  ok "file-install PATH excludes Bun, optional clients and activation tools"
else
  bad "file-install PATH exposed an unintended executable"
  exit 1
fi

# GSD core remains an external dependency.  The real installer deliberately
# refuses to generate wrappers until every mapped upstream workflow exists.
# Seed only disposable, source-derived fixture files so this full-surface test
# proves the install path without reading a developer's real GSD checkout.
seed_gsd_workflows() {
  root="$1"
  fixture_env "$root" "$FILE_PATH" env REPO_ROOT="$REPO_ROOT" \
    WORKFLOW_ROOT="$root/.claude/get-shit-done/workflows" \
    node -e '
      const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
      const { join } = require("node:path");
      const map = JSON.parse(readFileSync(join(process.env.REPO_ROOT, "package/router/gsd-rail-map.json"), "utf8"));
      const special = new Set(["goal", "loop", "doctor", "research-phase", "workstreams"]);
      const root = process.env.WORKFLOW_ROOT;
      mkdirSync(root, { recursive: true });
      for (const name of Object.keys(map.commands)) {
        if (special.has(name)) continue;
        if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`unsafe fixture workflow name: ${name}`);
        writeFileSync(join(root, `${name}.md`), `# Synthetic external GSD workflow fixture: ${name}\n`);
      }
    '
}

# Keep the production boundary explicit: the wrapper installer must leave an
# empty external GSD root untouched instead of generating a partial surface.
GSD_PRECHECK_ROOT="$SANDBOX/gsd-precheck"
mkdir -p "$GSD_PRECHECK_ROOT"
if fixture_env "$GSD_PRECHECK_ROOT" "$GSD_PATH" node "$REPO_ROOT/package/router/gsd-command-install.mjs" --apply \
     >"$SANDBOX/gsd-precheck.log" 2>&1; then
  bad "GSD wrapper installer accepted missing external workflows"
elif grep -q '^surface_workflow_missing: ' "$SANDBOX/gsd-precheck.log" \
     && [ ! -e "$GSD_PRECHECK_ROOT/.codex/prompts" ]; then
  ok "GSD wrapper installer fails closed before destination writes"
else
  bad "GSD wrapper installer missing-workflow boundary changed"
fi

if seed_gsd_workflows "$INSTALL_ROOT"; then
  ok "external GSD workflow fixture seeded from rail map"
else
  bad "external GSD workflow fixture could not be seeded"
fi

# --- Assertion 1: real file landing, then real GSD wrappers (no activation) ---
if run_install "$INSTALL_ROOT" --with-claude --with-codex \
     >"$SANDBOX/install1.log" 2>&1; then
  ok "Claude/Codex file-install phase exited 0"
else
  bad "file-install phase exited non-zero (see $SANDBOX/install1.log)"
fi

if run_gsd_install "$INSTALL_ROOT" >"$SANDBOX/gsd1.log" 2>&1; then
  ok "real GSD wrapper phase exited 0 with Claude skipped"
else
  bad "GSD wrapper phase exited non-zero (see $SANDBOX/gsd1.log)"
fi
assert_no_pulse "$INSTALL_ROOT"

for rel in \
  "AGENTS.md" \
  ".claude/CLAUDE.md.template" \
  ".claude/PAI/PULSE/compat-server.ts" \
  ".codex/hooks/skill_cluster_resolver.mjs" \
  ".config/opencode/AGENTS.md" \
  ".config/opencode/opencode.json" \
  ".codex/AGENTS.md" \
  ".claude/PAI/enrich/index.ts" \
  ".claude/PAI/router/classify-task.sh" \
  ".claude/hooks/PromptProcessing.hook.ts" \
  ".codex/hooks/PromptProcessing.hook.ts" \
  ".codex/hooks/GsdCommand.hook.ts" \
  ".codex/prompts/gsd-doctor.md" \
  ".local/bin/temperance-route" \
  ".local/bin/temperance-dispatch" \
  ".local/bin/temperance-batch" \
  ".cursor/templates/temperance-engine.AGENTS.md" \
  ".cursor/templates/temperance-engine.rules.mdc" \
; do
  if [ -f "$INSTALL_ROOT/$rel" ]; then ok "landed: $rel"; else bad "missing: $rel"; fi
done

# --- Assertion 2: backup + idempotency on second install ---
if run_install "$INSTALL_ROOT" --with-claude --with-codex \
     >"$SANDBOX/install2.log" 2>&1; then
  ok "re-install exited 0"
else
  bad "re-install exited non-zero"
fi
if run_gsd_install "$INSTALL_ROOT" >"$SANDBOX/gsd2.log" 2>&1; then
  ok "real GSD wrapper re-install and backup phase exited 0"
else
  bad "GSD wrapper re-install phase exited non-zero"
fi
assert_no_pulse "$INSTALL_ROOT"
if find "$INSTALL_ROOT/.temperance_engine/backups" -type f 2>/dev/null | grep -q .; then
  ok "backups created on re-install"
else
  bad "no backups after re-install"
fi

# Real GSD backup helper creates adjacent recovery copies, distinct from the
# legacy install-file backup tree. Require actual byte equality, not a mock exit.
GSD_BACKUP=$(find "$INSTALL_ROOT/.codex/prompts" -type f -name 'gsd-doctor.md.bak.*' 2>/dev/null | sort | tail -n 1)
if [ -n "$GSD_BACKUP" ] && cmp -s "$GSD_BACKUP" "$INSTALL_ROOT/.codex/prompts/gsd-doctor.md"; then
  ok "real GSD helper retained an exact wrapper backup"
else
  bad "real GSD wrapper backup missing or changed"
fi

# --- Assertion 3: dry-run mutates nothing ---
DRY_ROOT="$SANDBOX/dry"
mkdir -p "$DRY_ROOT"
run_install "$DRY_ROOT" --dry-run --skip-voice >"$SANDBOX/dry.log" 2>&1 || true
created=$(find "$DRY_ROOT" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$created" = "0" ]; then ok "dry-run created no files"; else bad "dry-run created $created files"; fi

# --- Assertion 4: restore-from-backup (real rollback path) ---
# Backups are now path-slug named (full source path, / -> __), not basename
# (see scripts/lib.sh backup_file). Find the newest backup by the slug of
# the known target path instead of a basename match.
TARGET="$INSTALL_ROOT/.claude/CLAUDE.md.template"
TARGET_SLUG=$(printf '%s' "$TARGET" | sed 's#^/##; s#/#__#g')
cp "$TARGET" "$SANDBOX/expected_claude_tmpl"
printf 'SENTINEL-CORRUPT\n' > "$TARGET"
NEWEST=$(find "$INSTALL_ROOT/.temperance_engine/backups" -type f -name "$TARGET_SLUG" 2>/dev/null | sort | tail -n 1)
if [ -n "$NEWEST" ] && cp "$NEWEST" "$TARGET" && cmp -s "$TARGET" "$SANDBOX/expected_claude_tmpl"; then
  ok "restore-from-backup matches installed bytes"
else
  bad "restore-from-backup failed"
fi

# --- Assertion 4b: backup collision regression (G4) ---
# Two different source files that share a basename must both survive as
# distinct, path-unique backup files (no basename clobber).
COLL_ROOT="$SANDBOX/collide"
mkdir -p "$COLL_ROOT/a" "$COLL_ROOT/b" "$COLL_ROOT/backups"
COLL_A="$COLL_ROOT/a/AGENTS.md"
COLL_B="$COLL_ROOT/b/AGENTS.md"
printf 'AAA original\n' > "$COLL_A"
printf 'BBB original\n' > "$COLL_B"
fixture_env "$COLL_ROOT" "$FILE_PATH" env REPO_ROOT="$REPO_ROOT" COLL_ROOT="$COLL_ROOT" \
  COLL_A="$COLL_A" COLL_B="$COLL_B" sh -c '
  . "$REPO_ROOT/scripts/lib.sh"
  export TEMPERANCE_BACKUP_DIR="$COLL_ROOT/backups"
  backup_file "$COLL_A"
  backup_file "$COLL_B"
'

COLL_COUNT=$(find "$COLL_ROOT/backups" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$COLL_COUNT" -ge 2 ]; then
  ok "backup collision regression: same-basename targets get distinct backups ($COLL_COUNT files)"
else
  bad "backup collision: only $COLL_COUNT backup(s) for 2 same-basename targets"
fi

# --- Assertion 5: hook behavior ---
HOOK="$REPO_ROOT/package/hooks/ParallelDispatchContext.hook.sh"
PROJ="$SANDBOX/proj"
mkdir -p "$PROJ/.planning/workstreams/api" "$PROJ/.planning/workstreams/ui"
printf 'ws-api\n' > "$PROJ/.planning/active-workstream"
printf '{ "model_profile": "quality", "workflow": { "auto_advance": false } }\n' > "$PROJ/.planning/config.json"
OUT=$(fixture_env "$PROJ" "$FILE_PATH" env CLAUDE_PROJECT_DIR="$PROJ" sh "$HOOK")
if printf '%s' "$OUT" | grep -q 'GSD-managed project detected' \
   && printf '%s' "$OUT" | grep -q 'model_profile: quality'; then
  ok "hook emits advisory for GSD project"
else
  bad "hook advisory output missing"
fi
BARE="$SANDBOX/bare"; mkdir -p "$BARE"
OUT2=$(fixture_env "$BARE" "$FILE_PATH" env CLAUDE_PROJECT_DIR="$BARE" sh "$HOOK")
if [ -z "$OUT2" ]; then ok "hook silent for non-GSD dir"; else bad "hook not silent for non-GSD dir"; fi

# --- Assertion 6: GSD gating ---
mkdir -p "$SANDBOX/g1" "$SANDBOX/g2"
OUT_ON=$(run_gsd_install "$SANDBOX/g1" --dry-run 2>&1 || true)
printf '%s' "$OUT_ON" | grep -q 'GSD_MODE=install' && ok "gsd on: GSD_MODE=install" || bad "gsd on gating"
OUT_OFF=$(run_install "$SANDBOX/g2" --dry-run --skip-voice 2>&1 || true)
printf '%s' "$OUT_OFF" | grep -q 'GSD_MODE=skip' && ok "gsd off: GSD_MODE=skip" || bad "gsd off gating"

# --- Assertion 7: installer live-content guard (G3) ---
# A pre-populated live operator file (carrying a temperance:identity marker)
# must survive a default (non-force) install, and must be overwritten with
# --force.
GUARD_ROOT="$SANDBOX/guard"
mkdir -p "$GUARD_ROOT"
GUARD_TARGET="$GUARD_ROOT/AGENTS.md"
printf '<!-- temperance:identity:start -->\nreal live operator content\n<!-- temperance:identity:end -->\n' > "$GUARD_TARGET"
cp "$GUARD_TARGET" "$SANDBOX/guard_expected"

run_install "$GUARD_ROOT" --skip-voice >"$SANDBOX/guard1.log" 2>&1
if cmp -s "$GUARD_TARGET" "$SANDBOX/guard_expected"; then
  ok "G3 guard: default install preserves live operator AGENTS.md"
else
  bad "G3 guard: default install overwrote live operator AGENTS.md"
fi
if grep -q 'skipping' "$SANDBOX/guard1.log"; then
  ok "G3 guard: skip warning printed on default install"
else
  bad "G3 guard: no skip warning printed on default install"
fi

run_install "$GUARD_ROOT" --skip-voice --force >"$SANDBOX/guard2.log" 2>&1
if cmp -s "$GUARD_TARGET" "$SANDBOX/guard_expected"; then
  bad "G3 guard: --force did not overwrite live operator AGENTS.md"
else
  ok "G3 guard: --force overwrites live operator AGENTS.md"
fi

# --- Assertion 8: compat-server does not invoke the broken peon.sh contract ---
# peon.sh is control-only (pause|resume|mute|unmute|toggle|status|volume|
# rotation|notifications) and has no "play a pack" command; the compat
# server must play sounds directly (afplay + pack manifest), never via
# peon.sh --pack/--category.
COMPAT_SERVER="$REPO_ROOT/package/pulse-compat/compat-server.ts"
if grep -qE -- '--pack|--category' "$COMPAT_SERVER"; then
  bad "compat-server still invokes the broken peon.sh --pack/--category contract"
else
  ok "compat-server does not invoke peon.sh --pack/--category"
fi
if grep -q 'afplay' "$COMPAT_SERVER" && grep -qE 'manifest|openpeon\.json' "$COMPAT_SERVER"; then
  ok "compat-server references afplay and pack manifest resolution"
else
  bad "compat-server missing afplay/manifest references"
fi

printf '\n=== %d passed, %d failed ===\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
