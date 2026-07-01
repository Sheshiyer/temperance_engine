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
