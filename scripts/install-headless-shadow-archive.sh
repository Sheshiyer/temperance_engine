#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  printf '%s\n' 'usage: install-headless-shadow-archive.sh ARCHIVE EXPECTED_SHA256 RELEASE_ID' >&2
  exit 64
fi
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  printf '%s\n' 'installer must run as root' >&2
  exit 77
fi

ARCHIVE=$1
EXPECTED_SHA=${2#sha256:}
RELEASE_ID=$3
BASE_DIR=/opt/temperance-headless
RELEASES_DIR="$BASE_DIR/releases"
TARGET_DIR="$RELEASES_DIR/$RELEASE_ID"

if [[ ! "$RELEASE_ID" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  printf '%s\n' 'unsafe release id' >&2
  exit 65
fi

ACTUAL_SHA=$(sha256sum "$ARCHIVE" | awk '{print $1}')
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  printf '%s\n' 'archive checksum mismatch' >&2
  exit 66
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [[ "$NODE_MAJOR" != "22" ]]; then
  printf '%s\n' 'Node 22 is required' >&2
  exit 69
fi

install -d -o root -g root -m 0755 "$BASE_DIR" "$RELEASES_DIR"
STAGING_DIR=$(mktemp -d "$BASE_DIR/.install.XXXXXX")
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

while IFS= read -r archive_path; do
  if [[ "$archive_path" = /* || "$archive_path" == *'../'* || "$archive_path" == '..' ]]; then
    printf '%s\n' 'archive contains unsafe path' >&2
    exit 65
  fi
done < <(tar -tzf "$ARCHIVE")

tar -xzf "$ARCHIVE" -C "$STAGING_DIR"
EXTRACTED_DIR="$STAGING_DIR/temperance-headless-shadow-$RELEASE_ID"
if [[ ! -d "$EXTRACTED_DIR" ]]; then
  printf '%s\n' 'archive release root mismatch' >&2
  exit 65
fi

MANIFEST="$EXTRACTED_DIR/release-manifest.json"
if [[ $(jq -r '.schema' "$MANIFEST") != 'thoughtseed.temperance.headless_release.v1' ]]; then
  printf '%s\n' 'release manifest schema mismatch' >&2
  exit 65
fi
if [[ $(jq -r '.releaseId' "$MANIFEST") != "$RELEASE_ID" ]]; then
  printf '%s\n' 'release manifest id mismatch' >&2
  exit 65
fi

while IFS=$'\t' read -r relative_path expected_digest; do
  if [[ "$relative_path" = /* || "$relative_path" == *'..'* ]]; then
    printf '%s\n' 'manifest contains unsafe path' >&2
    exit 65
  fi
  actual_digest="sha256:$(sha256sum "$EXTRACTED_DIR/$relative_path" | awk '{print $1}')"
  if [[ "$actual_digest" != "$expected_digest" ]]; then
    printf 'content checksum mismatch: %s\n' "$relative_path" >&2
    exit 66
  fi
done < <(jq -r '.files[] | [.path, .sha256] | @tsv' "$MANIFEST")

if id temperance-shadow >/dev/null 2>&1; then
  if id -nG temperance-shadow | tr ' ' '\n' | grep -qx hermes; then
    printf '%s\n' 'temperance-shadow must not belong to hermes group' >&2
    exit 77
  fi
else
  useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin temperance-shadow
fi

if [[ -e "$TARGET_DIR" ]]; then
  if cmp -s "$TARGET_DIR/release-manifest.json" "$MANIFEST"; then
    printf '{"schema":"thoughtseed.temperance.install_result.v1","releaseId":"%s","installed":false,"idempotent":true,"path":"%s"}\n' "$RELEASE_ID" "$TARGET_DIR"
    exit 0
  fi
  printf '%s\n' 'release path exists with different manifest' >&2
  exit 73
fi

chown -R root:root "$EXTRACTED_DIR"
find "$EXTRACTED_DIR" -type d -exec chmod 0755 {} +
find "$EXTRACTED_DIR" -type f -exec chmod 0644 {} +
chmod 0755 "$EXTRACTED_DIR/bin/temperance-shadow" "$EXTRACTED_DIR/lib/runtime.mjs"
mv "$EXTRACTED_DIR" "$TARGET_DIR"
sync

if [[ -e "$BASE_DIR/current" || -L "$BASE_DIR/current" ]]; then
  printf '%s\n' 'unexpected active current path' >&2
  exit 78
fi

printf '{"schema":"thoughtseed.temperance.install_result.v1","releaseId":"%s","installed":true,"idempotent":false,"path":"%s"}\n' "$RELEASE_ID" "$TARGET_DIR"
