#!/usr/bin/env bash
# Install or roll back the Linux Temperance relay beside OmniRoute. The
# existing Hermes credential is delivered by PID 1 with LoadCredential=;
# this installer never reads, copies, prints, or changes the credential.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${TEMPERANCE_SERVICE_NAME:-temperance-proxy.service}"
UNIT_SOURCE="${TEMPERANCE_UNIT_SOURCE:-$ROOT/deploy/systemd/temperance-proxy.service}"
UNIT_PATH="${TEMPERANCE_UNIT_PATH:-/etc/systemd/system/$SERVICE_NAME}"
RELEASE_ROOT="${TEMPERANCE_RELEASE_ROOT:-/opt/temperance/releases}"
CURRENT_LINK="${TEMPERANCE_CURRENT_LINK:-/opt/temperance/current}"
STATE_ROOT="${TEMPERANCE_SYSTEMD_STATE_ROOT:-/var/lib/temperance-engine/systemd-rollouts}"
LOG_DIR="${TEMPERANCE_LOG_DIR:-/var/log/temperance}"
ROUTER_STATE_DIR="${TEMPERANCE_ROUTER_STATE_DIR:-/var/lib/temperance-engine/router-state}"
RUN_USER="${TEMPERANCE_RUN_USER:-temperance-router}"
RUN_GROUP="${TEMPERANCE_RUN_GROUP:-temperance-router}"
CREDENTIAL_SOURCE="${TEMPERANCE_CREDENTIAL_SOURCE:-/etc/hermes/omniroute-proxy.key}"
ROLLOUT_ID="${TEMPERANCE_ROLLOUT_ID:-}"
MODE="apply"
ROLLBACK_RECEIPT=""

usage() {
  cat <<'USAGE'
Usage:
  sudo TEMPERANCE_ROLLOUT_ID=<id> scripts/install-temperance-proxy-systemd.sh --apply
  sudo scripts/install-temperance-proxy-systemd.sh --validate
  sudo scripts/install-temperance-proxy-systemd.sh --rollback <receipt>

The apply path installs package/router and package/enrich into an immutable,
rollout-named release and atomically repoints /opt/temperance/current.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) MODE="apply" ;;
    --validate) MODE="validate" ;;
    --rollback)
      MODE="rollback"
      shift
      [ "$#" -ge 1 ] || { usage >&2; exit 2; }
      ROLLBACK_RECEIPT="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

[ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }
for required in bun cp curl find getent id install jq readlink sha256sum sort ss stat systemctl useradd groupadd xargs; do
  command -v "$required" >/dev/null 2>&1 || { echo "Required command is unavailable: $required" >&2; exit 127; }
done

sha256_file() { sha256sum "$1" | awk '{print $1}'; }

validate_runtime() {
  systemctl is-active --quiet "$SERVICE_NAME"
  systemctl is-enabled --quiet "$SERVICE_NAME"
  [ -L "$CURRENT_LINK" ]
  [ "$(systemctl show -p User --value "$SERVICE_NAME")" = "$RUN_USER" ]
  [ "$(systemctl show -p Group --value "$SERVICE_NAME")" = "$RUN_GROUP" ]
  ! id -nG "$RUN_USER" | tr ' ' '\n' | grep -qx hermes
  [ "$(stat -c '%a' "$CREDENTIAL_SOURCE")" -le 640 ]
  ss -ltnH '( sport = :20129 )' | awk '{print $4}' | grep -Eq '^(127\.0\.0\.1|\[::1\]):20129$'
  health="$(curl -fsS http://127.0.0.1:20129/health)"
  jq -e '.ok == true and .automatic_ready == false and (.automatic_unavailable_reason | type == "string" and length > 0)' <<<"$health" >/dev/null
  printf 'Validated Linux Temperance relay: loopback, isolated identity, S-tier fail-closed.\n'
}

restore_receipt() {
  local receipt="$1" current_target applied_target applied_unit_hash previous_unit backup previous_enabled previous_active
  jq -e '.schemaVersion == 1 and .kind == "temperance-linux-relay-rollout"' "$receipt" >/dev/null
  applied_target="$(jq -er '.appliedCurrentTarget' "$receipt")"
  current_target="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
  [ "$current_target" = "$applied_target" ] || { echo "Current release drifted; refusing rollback" >&2; exit 1; }
  applied_unit_hash="$(jq -er '.appliedUnitHash' "$receipt")"
  [ -f "$UNIT_PATH" ] && [ "$(sha256_file "$UNIT_PATH")" = "$applied_unit_hash" ] || {
    echo "Service unit drifted; refusing rollback" >&2
    exit 1
  }
  previous_unit="$(jq -r '.previousUnitPath // empty' "$receipt")"
  backup="$(jq -r '.unitBackupPath // empty' "$receipt")"
  if [ -n "$previous_unit" ]; then
    [ -f "$backup" ] || { echo "Unit backup is missing: $backup" >&2; exit 1; }
    install -m 0644 "$backup" "$UNIT_PATH"
  else
    rm -f "$UNIT_PATH"
  fi
  previous_target="$(jq -r '.previousCurrentTarget // empty' "$receipt")"
  if [ -n "$previous_target" ]; then
    ln -sfn "$previous_target" "$CURRENT_LINK"
  else
    rm -f "$CURRENT_LINK"
  fi
  systemctl daemon-reload
  previous_enabled="$(jq -r '.previousEnabled' "$receipt")"
  previous_active="$(jq -r '.previousActive' "$receipt")"
  if [ "$previous_enabled" = "enabled" ]; then systemctl enable "$SERVICE_NAME" >/dev/null; else systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true; fi
  if [ "$previous_active" = "active" ]; then systemctl restart "$SERVICE_NAME"; else systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true; fi
  printf 'Rolled back Linux Temperance relay from %s\n' "$receipt"
}

if [ "$MODE" = "validate" ]; then
  validate_runtime
  exit 0
fi

if [ "$MODE" = "rollback" ]; then
  [ -f "$ROLLBACK_RECEIPT" ] || { echo "Rollback receipt not found: $ROLLBACK_RECEIPT" >&2; exit 1; }
  restore_receipt "$ROLLBACK_RECEIPT"
  exit 0
fi

case "$ROLLOUT_ID" in
  ""|*[!A-Za-z0-9._-]*) echo "TEMPERANCE_ROLLOUT_ID must contain only letters, numbers, dot, underscore, or dash" >&2; exit 2 ;;
esac
[ -f "$UNIT_SOURCE" ] || { echo "Unit template not found: $UNIT_SOURCE" >&2; exit 1; }
[ -d "$ROOT/package/router" ] || { echo "Router source not found" >&2; exit 1; }
[ -d "$ROOT/package/enrich" ] || { echo "Enrichment source not found" >&2; exit 1; }
[ -f "$ROOT/scripts/configure-opencode-session-profiles.sh" ] || { echo "OpenCode reconciler source not found" >&2; exit 1; }
[ -d "$ROOT/skills/temperance-native" ] || { echo "Native skill source not found" >&2; exit 1; }
[ -d "$ROOT/skills/temperance-algorithm" ] || { echo "Algorithm skill source not found" >&2; exit 1; }
[ -f "$CREDENTIAL_SOURCE" ] || { echo "Existing OmniRoute credential source not found" >&2; exit 1; }

release_dir="$RELEASE_ROOT/$ROLLOUT_ID"
rollout_dir="$STATE_ROOT/$ROLLOUT_ID"
receipt_path="$rollout_dir/receipt.json"
[ ! -e "$release_dir" ] || { echo "Release already exists: $release_dir" >&2; exit 1; }
[ ! -e "$receipt_path" ] || { echo "Receipt already exists: $receipt_path" >&2; exit 1; }
[ ! -e "$CURRENT_LINK" ] || [ -L "$CURRENT_LINK" ] || { echo "Current path is not a symlink: $CURRENT_LINK" >&2; exit 1; }

if ! getent group "$RUN_GROUP" >/dev/null; then groupadd --system "$RUN_GROUP"; fi
if ! id "$RUN_USER" >/dev/null 2>&1; then
  useradd --system --gid "$RUN_GROUP" --home-dir /nonexistent --shell /usr/sbin/nologin "$RUN_USER"
fi
! id -nG "$RUN_USER" | tr ' ' '\n' | grep -qx hermes || { echo "$RUN_USER must not belong to the hermes group" >&2; exit 1; }

umask 077
install -d -m 0755 "$RELEASE_ROOT" "$release_dir"
cp -a "$ROOT/package/router" "$release_dir/router"
cp -a "$ROOT/package/enrich" "$release_dir/enrich"
install -d -m 0755 "$release_dir/scripts" "$release_dir/skills"
install -m 0755 "$ROOT/scripts/configure-opencode-session-profiles.sh" "$release_dir/scripts/configure-opencode-session-profiles.sh"
cp -a "$ROOT/skills/temperance-native" "$release_dir/skills/temperance-native"
cp -a "$ROOT/skills/temperance-algorithm" "$release_dir/skills/temperance-algorithm"
if [ -d "$ROOT/docs/runbooks" ]; then
  install -d -m 0755 "$release_dir/docs"
  cp -a "$ROOT/docs/runbooks" "$release_dir/docs/runbooks"
fi
(cd "$release_dir" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256)
chmod -R a-w "$release_dir"
install -d -m 0750 -o "$RUN_USER" -g "$RUN_GROUP" "$LOG_DIR" "$ROUTER_STATE_DIR"
install -d -m 0700 "$rollout_dir"

previous_unit_path=""
unit_backup_path=""
if [ -f "$UNIT_PATH" ]; then
  previous_unit_path="$UNIT_PATH"
  unit_backup_path="$rollout_dir/temperance-proxy.service.preapply"
  install -m 0600 "$UNIT_PATH" "$unit_backup_path"
fi
previous_target="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
previous_enabled="$(systemctl is-enabled "$SERVICE_NAME" 2>/dev/null || true)"
previous_active="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)"

install -m 0644 "$UNIT_SOURCE" "$UNIT_PATH"
ln -sfn "$release_dir" "$CURRENT_LINK"
applied_unit_hash="$(sha256_file "$UNIT_PATH")"
release_manifest_hash="$(sha256_file "$release_dir/MANIFEST.sha256")"

jq -n \
  --arg rolloutId "$ROLLOUT_ID" \
  --arg receiptPath "$receipt_path" \
  --arg previousUnitPath "$previous_unit_path" \
  --arg unitBackupPath "$unit_backup_path" \
  --arg previousCurrentTarget "$previous_target" \
  --arg appliedCurrentTarget "$release_dir" \
  --arg previousEnabled "$previous_enabled" \
  --arg previousActive "$previous_active" \
  --arg appliedUnitHash "$applied_unit_hash" \
  --arg releaseManifestHash "$release_manifest_hash" \
  '{schemaVersion:1,kind:"temperance-linux-relay-rollout",rolloutId:$rolloutId,receiptPath:$receiptPath,previousUnitPath:$previousUnitPath,unitBackupPath:$unitBackupPath,previousCurrentTarget:$previousCurrentTarget,appliedCurrentTarget:$appliedCurrentTarget,previousEnabled:$previousEnabled,previousActive:$previousActive,appliedUnitHash:$appliedUnitHash,releaseManifestHash:$releaseManifestHash,rollbackOrder:["service-unit","current-symlink","systemd-state"]}' \
  >"$receipt_path"
chmod 600 "$receipt_path"

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME" >/dev/null
if ! validate_runtime; then
  echo "Relay validation failed; restoring the pre-apply service state" >&2
  restore_receipt "$receipt_path"
  exit 1
fi

printf 'Applied Linux Temperance relay release: %s\n' "$release_dir"
printf 'Rollback receipt: %s\n' "$receipt_path"
