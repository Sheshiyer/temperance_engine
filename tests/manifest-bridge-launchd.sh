#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP="$(mktemp -d "${TMPDIR:-/tmp}/manifest-bridge-launchd.XXXXXX")"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$TEMP/bin" "$TEMP/home"

for command in bun curl launchctl; do
  cat > "$TEMP/bin/$command" <<'EOF'
#!/usr/bin/env bash
case "$(basename "$0")" in
  curl) printf '%s\n' '{"ok":true,"service":"temperance-manifest-bridge"}' ;;
  *) exit 0 ;;
esac
EOF
  chmod 700 "$TEMP/bin/$command"
done

HOME="$TEMP/home" PATH="$TEMP/bin:/usr/bin:/bin:/usr/sbin:/sbin" TEMPERANCE_ENGINE_ROOT="$ROOT" \
  bash "$ROOT/scripts/temperance-manifest-bridge-launchd.sh" install --debug >/dev/null
PLIST="$TEMP/home/Library/LaunchAgents/com.temperance.engine.manifest-bridge.plist"
plutil -lint "$PLIST" >/dev/null
grep -q '<string>--no-watch</string>' "$PLIST"
grep -q '<string>8766</string>' "$PLIST"
grep -q 'com.temperance.engine.manifest-bridge' "$PLIST"
grep -q '<string>TEMPERANCE_MANIFEST_LOG_LEVEL=debug</string>' "$PLIST"
HOME="$TEMP/home" PATH="$TEMP/bin:/usr/bin:/bin:/usr/sbin:/sbin" TEMPERANCE_ENGINE_ROOT="$ROOT" \
  bash "$ROOT/scripts/temperance-manifest-bridge-launchd.sh" status | grep -q '"health":"ready"'
echo "=== manifest-bridge-launchd: PASS ==="
