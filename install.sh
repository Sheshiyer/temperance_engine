#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DRY_RUN=0
VOICE_MODE=auto
CLAUDE_MODE=skip
CODEX_MODE=skip
OPENCODE_MODE=install
CURSOR_MODE=install
GSD_MODE=skip
RELAY_MODE=skip
MANIFEST_MODE=skip
SPINE_MODE=skip
FORCE=0
PRESERVE_EXISTING=0
OPTIONAL_REQUESTED=0
KIT_MODE=0
# Transport markers prevent missing metadata from silently becoming a checkout.
if [ -e "$ROOT_DIR/KIT-PROVENANCE.json" ] || [ -L "$ROOT_DIR/KIT-PROVENANCE.json" ] \
  || [ -e "$ROOT_DIR/INNER-MANIFEST.sha256" ] || [ -L "$ROOT_DIR/INNER-MANIFEST.sha256" ] \
  || [ -e "$ROOT_DIR/toolchain" ] || [ -L "$ROOT_DIR/toolchain" ]; then
  KIT_MODE=1
  PRESERVE_EXISTING=1
fi

for arg in "$@"; do
  case "$arg" in --with-*) OPTIONAL_REQUESTED=1 ;; esac
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --preserve-existing) PRESERVE_EXISTING=1 ;;
    --skip-voice) VOICE_MODE=skip ;;
    --with-voice) VOICE_MODE=force ;;
    --with-claude) CLAUDE_MODE=install ;;
    --skip-claude) CLAUDE_MODE=skip ;;
    --with-codex) CODEX_MODE=install ;;
    --skip-codex) CODEX_MODE=skip ;;
    --with-opencode) OPENCODE_MODE=install ;;
    --skip-opencode) OPENCODE_MODE=skip ;;
    --with-cursor) CURSOR_MODE=install ;;
    --skip-cursor) CURSOR_MODE=skip ;;
    --with-gsd) GSD_MODE=install ;;
    --skip-gsd) GSD_MODE=skip ;;
    --with-manifest) MANIFEST_MODE=install ;;
    --skip-manifest) MANIFEST_MODE=skip ;;
    --with-spine)
      SPINE_MODE=install
      CODEX_MODE=install
      GSD_MODE=install
      MANIFEST_MODE=install
      CLAUDE_MODE=install
      ;;
    --with-relay) RELAY_MODE=install ;;
    --skip-relay) RELAY_MODE=skip ;;
    --force) FORCE=1 ;;
    -h|--help)
      printf '%s\n' "Usage: ./install.sh [--dry-run] [--skip-voice|--with-voice] [--with-claude|--skip-claude] [--with-codex|--skip-codex] [--with-opencode|--skip-opencode] [--with-cursor|--skip-cursor] [--with-gsd|--skip-gsd] [--with-manifest|--skip-manifest] [--with-spine] [--with-relay|--skip-relay] [--force] [--preserve-existing]"
      printf '%s\n' "  --with-spine  Thoughtseed member glove: Claude+Codex compose hooks, /gsd:* on Claude/Codex/OpenCode/Grok, Manifest, Pulse (does not vendor GSD core or copy secrets)"
      printf '%s\n' "  --preserve-existing  Minimal generic templates only; preserve every existing path, no activation or force (automatic in a portable kit)."
      printf '%s\n' "  Portable kit: verify the archive with its independently trusted digest first; metadata is compatibility only, not authorization."
      exit 0
      ;;
    *)
      printf '%s\n' "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# Metadata is a compatibility assertion inside an ALREADY verified archive.
# It never authenticates the archive, authorizes a profile, or issues identity.
if [ "$KIT_MODE" = 1 ]; then
  if [ ! -x /usr/bin/perl ] || ! /usr/bin/perl -MJSON::PP -MFcntl -e 1 2>/dev/null; then
    printf '%s\n' 'KIT_METADATA_HOLD: stock Perl JSON::PP/Fcntl unavailable; no effects' >&2
    exit 1
  fi
  if ! /usr/bin/perl - "$ROOT_DIR/KIT-PROVENANCE.json" <<'KIT_METADATA'
use strict; use warnings; use JSON::PP; use Fcntl qw(:DEFAULT);
sub hold { die "KIT_METADATA_HOLD: unsupported or malformed kit metadata; no effects\n" }
my $path=shift; my @before=lstat $path;
@before && -f _ && !-l _ && $before[3]==1 && $before[7]>0 && $before[7]<=8192 or hold();
sysopen(my $in,$path,O_RDONLY|O_NOFOLLOW) or hold();
my @opened=stat $in; $before[0]==$opened[0] && $before[1]==$opened[1] or hold();
my $raw=''; while(length($raw)<=8192){my $n=read($in,my $part,8193-length($raw));defined($n) or hold();last unless $n;$raw.=$part;}
close $in; length($raw)<=8192 or hold();
# The builder emits plain ASCII keys/values. Refuse alternate escaped spellings
# and duplicate keys rather than permit parser-dependent compatibility choices.
$raw !~ /\\|[^\x09\x0a\x0d\x20-\x7e]/ or hold();
my %keys; while($raw=~/"([^"]*)"\s*:/g){$keys{$1}++ and hold();}
my $p=eval {JSON::PP->new->decode($raw)}; $@ and hold();
sub object {my($v,@keys)=@_;ref($v) eq 'HASH' or hold();my %allowed=map {$_=>1}@keys;keys(%$v)==@keys or hold();for(@keys){exists($v->{$_}) or hold();}for(keys %$v){$allowed{$_} or hold();}}
sub exact {my($v,$expected)=@_;defined($v)&&!ref($v)&&$v eq $expected or hold();}
sub pattern {my($v,$re)=@_;defined($v)&&!ref($v)&&$v=~$re or hold();}
object($p,qw(schema source_commit source_tree registry_lock_sha256 install_manifest_lock_sha256 reviewed_vendor_digest bun opentui ajv typescript native pending));
exact($p->{schema},'temperance.kit-provenance.v1');
pattern($p->{source_commit},qr/\A[0-9a-f]{40}\z/);pattern($p->{source_tree},qr/\Agit-tree:[0-9a-f]{40}\z/);
for(qw(registry_lock_sha256 install_manifest_lock_sha256)){pattern($p->{$_},qr/\A[0-9a-f]{64}\z/);}
pattern($p->{reviewed_vendor_digest},qr/\Asha256:[0-9a-f]{64}\z/);
exact($p->{bun},'1.3.5');exact($p->{opentui},'0.5.11');exact($p->{ajv},'8.20.0');exact($p->{typescript},'5.9.3');
object($p->{native},qw(path format arch sha256 authority));
exact($p->{native}{path},'package/install-surface/node_modules/@opentui/core-darwin-arm64/libopentui.dylib');
exact($p->{native}{format},'Mach-O');exact($p->{native}{arch},'arm64');
pattern($p->{native}{sha256},qr/\A[0-9a-f]{64}\z/);
exact($p->{native}{authority},'observation-bound-to-reviewed-vendor-tree');
ref($p->{pending}) eq 'ARRAY' && @{$p->{pending}}<=16 or hold();
for(@{$p->{pending}}){pattern($_,qr/\A[A-Za-z0-9][A-Za-z0-9 .\/-]{0,127}\z/);}
KIT_METADATA
  then exit 1; fi
fi

# ── Architecture and private-overlay gate (BEFORE all mutations) ─────────────
# Detect OS and CPU. Unsupported combinations hold all effects. A private
# overlay cannot override an architecture hold.
_UNAME_OS=$(uname -s 2>/dev/null || true)
_UNAME_ARCH=$(uname -m 2>/dev/null || true)
_ARCH_HELD=0
if [ "$KIT_MODE" = 1 ] && { [ "$_UNAME_OS" != Darwin ] || [ "$_UNAME_ARCH" != arm64 ]; }; then
  printf '%s\n' 'KIT_PLATFORM_HOLD: this kit closure requires Darwin/arm64; no effects' >&2
  exit 1
fi
if [ "$PRESERVE_EXISTING" = 1 ]; then
  if [ "$OPTIONAL_REQUESTED" = 1 ] || [ "$FORCE" = 1 ]; then
    printf '%s\n' 'BOOTSTRAP_OPTION_HOLD: minimal preservation mode admits no optional activation or force; no effects' >&2
    exit 1
  fi
  VOICE_MODE=skip
  CLAUDE_MODE=skip
  CODEX_MODE=skip
  OPENCODE_MODE=skip
  CURSOR_MODE=skip
  GSD_MODE=skip
  MANIFEST_MODE=skip
  SPINE_MODE=skip
  RELAY_MODE=skip
fi

case "$_UNAME_OS" in
  Darwin)
    case "$_UNAME_ARCH" in
      arm64|x86_64) ;;
      *)
        printf 'UNSUPPORTED_PLATFORM: architecture %s/%s is not supported by the portable kit\n' \
          "$_UNAME_OS" "$_UNAME_ARCH" >&2
        printf 'Hold: no effects applied. Review docs/modular-mac-lifecycle.md and re-run on supported hardware.\n' >&2
        _ARCH_HELD=1
        ;;
    esac
    ;;
  Linux)
    case "$_UNAME_ARCH" in
      x86_64|aarch64|arm64) ;;
      *)
        printf 'UNSUPPORTED_PLATFORM: architecture %s/%s is not supported by the portable kit\n' \
          "$_UNAME_OS" "$_UNAME_ARCH" >&2
        printf 'Hold: no effects applied. Review docs/modular-mac-lifecycle.md and re-run on supported hardware.\n' >&2
        _ARCH_HELD=1
        ;;
    esac
    ;;
  *)
    printf 'UNSUPPORTED_PLATFORM: OS %s is not supported by the portable kit\n' \
      "$_UNAME_OS" >&2
    printf 'Hold: no effects applied. Review docs/modular-mac-lifecycle.md and re-run on supported hardware.\n' >&2
    _ARCH_HELD=1
    ;;
esac

if [ "$_ARCH_HELD" -eq 1 ]; then
  exit 1
fi

# Private-overlay gate: no personal-overlay adapter has been reviewed or merged.
# Any TEMPERANCE_PRIVATE_OVERLAY request is unconditionally HELD before any
# effect. JSON schema string matching alone is not schema validation, and no
# reviewed adapter exists for any overlay schema version.
# The existing in-memory host-binding composer is a separate seam and is not
# activated by this environment variable.
if [ -n "${TEMPERANCE_PRIVATE_OVERLAY:-}" ]; then
  printf 'OVERLAY_HOLD: personal overlay adapter not yet reviewed or merged\n' >&2
  printf 'Hold: no effects applied. All personal overlay requests are held until\n' >&2
  printf 'a reviewed adapter is merged. Unset TEMPERANCE_PRIVATE_OVERLAY to proceed.\n' >&2
  exit 1
fi

export TEMPERANCE_ROOT="$ROOT_DIR"
export TEMPERANCE_DRY_RUN="$DRY_RUN"
export TEMPERANCE_VOICE_MODE="$VOICE_MODE"
export TEMPERANCE_CLAUDE_MODE="$CLAUDE_MODE"
export TEMPERANCE_CODEX_MODE="$CODEX_MODE"
export TEMPERANCE_OPENCODE_MODE="$OPENCODE_MODE"
export TEMPERANCE_CURSOR_MODE="$CURSOR_MODE"
export TEMPERANCE_GSD_MODE="$GSD_MODE"
export TEMPERANCE_MANIFEST_MODE="$MANIFEST_MODE"
export TEMPERANCE_SPINE_MODE="$SPINE_MODE"
export TEMPERANCE_RELAY_MODE="$RELAY_MODE"
export TEMPERANCE_ENGINE_ROOT="$ROOT_DIR"
export TEMPERANCE_FORCE="$FORCE"
export TEMPERANCE_PRESERVE_EXISTING="$PRESERVE_EXISTING"
export PAI_HOME="${PAI_HOME:-$HOME/.claude}"
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export OPENCODE_HOME="${OPENCODE_HOME:-$HOME/.config/opencode}"
export CURSOR_HOME="${CURSOR_HOME:-$HOME/.cursor}"
export AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"
export TEMPERANCE_STATE_DIR="${TEMPERANCE_STATE_DIR:-$HOME/.temperance_engine}"
export TEMPERANCE_BACKUP_DIR="${TEMPERANCE_BACKUP_DIR:-$TEMPERANCE_STATE_DIR/backups}"

if [ "$PRESERVE_EXISTING" = 1 ]; then
  . "$ROOT_DIR/scripts/lib.sh"
  preserve_bootstrap sources "$ROOT_DIR/templates/AGENTS.md" "$ROOT_DIR/package/skill-resolvers/skill_cluster_resolver.mjs"
  # Validate every generic destination before creating even its parent folders.
  preserve_bootstrap check "$HOME/AGENTS.md" "$CODEX_HOME/hooks/skill_cluster_resolver.mjs" "$AGENTS_HOME/.bootstrap-check"
  sh "$ROOT_DIR/scripts/install-pai.sh"
  sh "$ROOT_DIR/scripts/install-skill-clusters.sh"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s\n' 'Minimal bootstrap dry-run complete: no files created; no optional activation.'
  else
    printf '%s\n' 'Minimal bootstrap complete: generic surfaces created or preserved-existing; no optional activation.'
  fi
  printf '%s\n' 'Full repository verification and migration profile acceptance are separate checks.'
  exit 0
fi

printf '%s\n' "Temperance Engine installer"
printf '%s\n' "PAI_HOME=$PAI_HOME"
printf '%s\n' "CODEX_HOME=$CODEX_HOME"
printf '%s\n' "OPENCODE_HOME=$OPENCODE_HOME"
printf '%s\n' "CURSOR_HOME=$CURSOR_HOME"
printf '%s\n' "AGENTS_HOME=$AGENTS_HOME"
printf '%s\n' "CLAUDE_MODE=$CLAUDE_MODE"
printf '%s\n' "CODEX_MODE=$CODEX_MODE"
printf '%s\n' "OPENCODE_MODE=$OPENCODE_MODE"
printf '%s\n' "CURSOR_MODE=$CURSOR_MODE"
printf '%s\n' "GSD_MODE=$GSD_MODE"
printf '%s\n' "MANIFEST_MODE=$MANIFEST_MODE"
printf '%s\n' "SPINE_MODE=$SPINE_MODE"
printf '%s\n' "RELAY_MODE=$RELAY_MODE"
printf '%s\n' "FORCE=$FORCE"

sh "$ROOT_DIR/scripts/install-pai.sh"

# Install temperance-parallel-dispatch skill (backup-first)
if test "${TEMPERANCE_CLAUDE_MODE:-skip}" = "install"; then
  SKILL_SRC="$ROOT_DIR/skills/temperance-parallel-dispatch"
  SKILL_DST="$HOME/.claude/skills/temperance-parallel-dispatch"
  if test -d "$SKILL_SRC"; then
    BAK=""
    if test -e "$SKILL_DST"; then
      # Back up outside ~/.claude/skills/ -- that directory is scanned for
      # skills, so a sibling .bak dropped in-place gets picked up as a phantom skill.
      BAK="$TEMPERANCE_BACKUP_DIR/$(date -u +%Y%m%dT%H%M%SZ)/temperance-parallel-dispatch"
      if test "$DRY_RUN" = "1"; then
        printf 'DRY_RUN: cp -R %s %s\n' "$SKILL_DST" "$BAK"
        printf 'DRY_RUN: rm -rf %s\n' "$SKILL_DST"
      else
        mkdir -p "$(dirname "$BAK")"
        cp -R "$SKILL_DST" "$BAK"
        # cp -R into a pre-existing directory nests SRC inside DST instead of
        # replacing it, so clear the destination first.
        rm -rf "$SKILL_DST"
      fi
    fi
    if test "$DRY_RUN" = "1"; then
      printf 'DRY_RUN: mkdir -p %s\n' "$HOME/.claude/skills"
      printf 'DRY_RUN: cp -R %s %s\n' "$SKILL_SRC" "$SKILL_DST"
    else
      mkdir -p "$HOME/.claude/skills"
      cp -R "$SKILL_SRC" "$SKILL_DST"
    fi
    printf '%s\n' "[install] temperance-parallel-dispatch skill -> $SKILL_DST"
    if test -n "$BAK"; then
      printf '%s\n' "[install] backed up prior skill -> $BAK"
    fi
  fi
fi

sh "$ROOT_DIR/scripts/install-skill-clusters.sh"
sh "$ROOT_DIR/scripts/install-peon-ping.sh"
sh "$ROOT_DIR/scripts/install-codegraph.sh"
sh "$ROOT_DIR/scripts/install-gsd.sh"
sh "$ROOT_DIR/scripts/install-spine.sh"
sh "$ROOT_DIR/scripts/configure-opencode.sh"

# The primary local surfaces share one router/enrichment wiring pass. Keep it
# explicit in dry-run output and let the script preserve existing user hooks.
if test "$CLAUDE_MODE" = install || test "$CODEX_MODE" = install || test "$OPENCODE_MODE" = install; then
  if test "$DRY_RUN" = 1; then
    bash "$ROOT_DIR/scripts/wire-multi-backend.sh" --dry-run
  else
    bash "$ROOT_DIR/scripts/wire-multi-backend.sh"
  fi
fi

if test "$RELAY_MODE" = install; then
  if test "$DRY_RUN" = 1; then
    printf '%s\n' "DRY_RUN: would install the Temperance relay LaunchAgent and configure the automatic OpenCode provider"
  else
    bash "$ROOT_DIR/scripts/temperance-proxy-launchd.sh" install
    bash "$ROOT_DIR/scripts/configure-opencode-relay.sh" --enable
  fi
fi

sh "$ROOT_DIR/scripts/verify-install.sh"

printf '%s\n' "Install flow complete. Restart OpenCode or Cursor sessions to reload instruction surfaces. Restart Claude or Codex only if those optional surfaces were enabled."
