#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP="$(mktemp -d "${TMPDIR:-/tmp}/manifest-console-launchd.XXXXXX")"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$TEMP/bin" "$TEMP/home/console/node_modules/.bin"
printf '{"scripts":{"dev":"vite"}}\n' > "$TEMP/home/console/package.json"
touch "$TEMP/home/console/node_modules/.bin/vite"; chmod 700 "$TEMP/home/console/node_modules/.bin/vite"
for command in npm curl launchctl; do
  cat > "$TEMP/bin/$command" <<'EOF'
#!/usr/bin/env bash
case "$(basename "$0")" in
  curl) printf '%s\n' '<html><div id="root"></div></html>' ;;
  *) exit 0 ;;
esac
EOF
  chmod 700 "$TEMP/bin/$command"
done
HOME="$TEMP/home" PATH="$TEMP/bin:/usr/bin:/bin:/usr/sbin:/sbin" MANIFEST_CONSOLE_ROOT="$TEMP/home/console" \
  bash "$ROOT/scripts/temperance-manifest-console-launchd.sh" install >/dev/null
PLIST="$TEMP/home/Library/LaunchAgents/com.temperance.engine.manifest-console.plist"
plutil -lint "$PLIST" >/dev/null
grep -q 'VITE_MANIFEST_BRIDGE_URL=http://127.0.0.1:8766' "$PLIST"
grep -q '<string>--strictPort</string>' "$PLIST"
HOME="$TEMP/home" PATH="$TEMP/bin:/usr/bin:/bin:/usr/sbin:/sbin" MANIFEST_CONSOLE_ROOT="$TEMP/home/console" \
  bash "$ROOT/scripts/temperance-manifest-console-launchd.sh" status | grep -q '"health":"ready"'
echo "=== manifest-console-launchd: PASS ==="
