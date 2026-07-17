#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PACKAGE_DIR="$ROOT_DIR/package/headless"
OUTPUT_DIR=${TEMPERANCE_HEADLESS_OUTPUT_DIR:-"$ROOT_DIR/dist/headless"}

if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" && "${TEMPERANCE_ALLOW_DIRTY_BUILD:-0}" != "1" ]]; then
  printf '%s\n' 'refusing dirty build; commit the exact release source or set TEMPERANCE_ALLOW_DIRTY_BUILD=1' >&2
  exit 1
fi

SOURCE_COMMIT=$(git -C "$ROOT_DIR" rev-parse HEAD)
VERSION=$(node -p "require('$PACKAGE_DIR/package.json').version")
RELEASE_ID="${VERSION}-${SOURCE_COMMIT:0:12}"
ARCHIVE_NAME="temperance-headless-shadow-${RELEASE_ID}.tar.gz"
STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/temperance-headless-shadow.XXXXXX")
RELEASE_ROOT="$STAGING_DIR/temperance-headless-shadow-${RELEASE_ID}"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

cd "$PACKAGE_DIR"
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run standalone:audit
npm run standalone:smoke

mkdir -p \
  "$RELEASE_ROOT/bin" \
  "$RELEASE_ROOT/lib" \
  "$RELEASE_ROOT/schema" \
  "$RELEASE_ROOT/share/fixtures"

cp "$PACKAGE_DIR/bin/temperance-shadow" "$RELEASE_ROOT/bin/temperance-shadow"
cp "$PACKAGE_DIR/lib/runtime.mjs" "$RELEASE_ROOT/lib/runtime.mjs"
cp "$PACKAGE_DIR/schema/shadow-attempt.v1.schema.json" "$RELEASE_ROOT/schema/shadow-attempt.v1.schema.json"
cp "$PACKAGE_DIR/share/policy.v1.json" "$RELEASE_ROOT/share/policy.v1.json"
cp "$PACKAGE_DIR/fixtures/hermes-shadow-attempt.v1.json" "$RELEASE_ROOT/share/fixtures/hermes-shadow-attempt.v1.json"
cp "$PACKAGE_DIR/fixtures/invalid-missing-approval.v1.json" "$RELEASE_ROOT/share/fixtures/invalid-missing-approval.v1.json"
cp "$PACKAGE_DIR/fixtures/invalid-unknown-field.v1.json" "$RELEASE_ROOT/share/fixtures/invalid-unknown-field.v1.json"
cp "$PACKAGE_DIR/README.md" "$RELEASE_ROOT/README.md"
chmod 0755 "$RELEASE_ROOT/bin/temperance-shadow" "$RELEASE_ROOT/lib/runtime.mjs"
find "$RELEASE_ROOT" -type d -exec chmod 0755 {} +
find "$RELEASE_ROOT" -type f ! -path '*/bin/temperance-shadow' ! -path '*/lib/runtime.mjs' -exec chmod 0644 {} +

node - "$RELEASE_ROOT" "$VERSION" "$SOURCE_COMMIT" "$RELEASE_ID" <<'NODE'
const { createHash } = require("node:crypto");
const { readdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { join, relative } = require("node:path");

const [root, version, sourceCommit, releaseId] = process.argv.slice(2);
function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
const files = walk(root)
  .filter((path) => !path.endsWith("/release-manifest.json"))
  .map((path) => ({
    path: relative(root, path).replaceAll("\\", "/"),
    sha256: sha256(readFileSync(path)),
  }))
  .sort((left, right) => left.path.localeCompare(right.path, "en"));
const contentDigest = sha256(Buffer.from(JSON.stringify(files), "utf8"));
const manifest = {
  schema: "thoughtseed.temperance.headless_release.v1",
  releaseId,
  version,
  sourceCommit,
  node: ">=22 <23",
  contentDigest,
  files,
};
writeFileSync(join(root, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
NODE

# macOS attaches com.apple.provenance to newly copied files. That metadata is
# not part of the runtime contract and makes GNU tar emit extended-header
# warnings on EC2, so remove it from the disposable staging tree only.
if command -v xattr >/dev/null 2>&1; then
  xattr -cr "$RELEASE_ROOT"
fi

mkdir -p "$OUTPUT_DIR"
ARCHIVE_PATH="$OUTPUT_DIR/$ARCHIVE_NAME"
COPYFILE_DISABLE=1 tar -czf "$ARCHIVE_PATH" -C "$STAGING_DIR" "$(basename "$RELEASE_ROOT")"
ARCHIVE_SHA=$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')
printf '%s  %s\n' "$ARCHIVE_SHA" "$ARCHIVE_NAME" > "$ARCHIVE_PATH.sha256"
printf '{"schema":"thoughtseed.temperance.build_result.v1","releaseId":"%s","sourceCommit":"%s","archive":"%s","sha256":"sha256:%s"}\n' \
  "$RELEASE_ID" "$SOURCE_COMMIT" "$ARCHIVE_PATH" "$ARCHIVE_SHA"
