#!/usr/bin/env bash
set -euo pipefail

ROOT="${TEMPERANCE_ROOT:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

BASE_COMMIT="${1:-}"
HEAD_COMMIT="${2:-HEAD}"
MODE="${3:-check}"

README_PATH="$ROOT/README.md"
fail=0

print_section() {
  printf '\n%s\n' "== $1 =="
}

assert_marker() {
  local marker="$1"
  if ! grep -q -- "<!-- readme-gen:start:${marker} -->" "$README_PATH"; then
    printf 'Missing start marker for %s in %s\n' "$marker" "${README_PATH##*/}" >&2
    fail=1
  fi
  if ! grep -q -- "<!-- readme-gen:end:${marker} -->" "$README_PATH"; then
    printf 'Missing end marker for %s in %s\n' "$marker" "${README_PATH##*/}" >&2
    fail=1
  fi
}

is_version_signal() {
  case "$1" in
    CHANGELOG.md|ISA.md|CREDITS.md|UPSTREAM.md|SECURITY.md|CONTRIBUTING.md|LICENSE*|\
    README.md|\
    install.sh|uninstall.sh|verify.sh|\
    .github/workflows/*|.github/*|docs/*|assets/*|scripts/*|skills/*|templates/*|package/*|tasks/*|\
    .readme-notebooklm/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

append_worktree_changes_if_needed() {
  local requested_head="$1"
  local resolved_head

  resolved_head="$(git rev-parse --verify "$requested_head" 2>/dev/null || true)"
  if [[ -z "$resolved_head" ]]; then
    return
  fi

  if [[ "$resolved_head" != "$(git rev-parse --verify HEAD)" ]]; then
    return
  fi

  mapfile -t worktree_changed < <(
    {
      git diff --name-only
      git diff --cached --name-only
      git ls-files --others --exclude-standard
    } | awk 'NF' | sort -u
  )

  if (( ${#worktree_changed[@]} == 0 )); then
    return
  fi

  mapfile -t changed_files < <(
    printf '%s\n' "${changed_files[@]}" "${worktree_changed[@]}" | awk 'NF' | sort -u
  )
}

validate_notebook_metadata() {
  if ! grep -q -- "readme-gen:start:notebooklm-metadata" "$README_PATH"; then
    return
  fi

  local manifest_path="$ROOT/.readme-notebooklm/assets/manifest.json"
  if [[ ! -f "$manifest_path" ]]; then
    printf 'NotebookLM metadata section exists but manifest is missing: %s\n' "$manifest_path" >&2
    fail=1
    return
  fi

  local manifest_count metadata_count
  manifest_count=$(python3 - "$manifest_path" <<'PY'
import json,sys
p=sys.argv[1]
try:
    with open(p,'r',encoding='utf-8') as f:
        data=json.load(f)
    print(len(data.get('sources', [])))
except Exception:
    print('')
PY
  )

  metadata_count=$(sed -n '/readme-gen:start:notebooklm-metadata/,/readme-gen:end:notebooklm-metadata/p' "$README_PATH" \
    | sed -n 's/^- source-count: \([0-9][0-9]*\).*/\1/p')

  if [[ -n "$metadata_count" && -n "$manifest_count" && "$metadata_count" != "$manifest_count" ]]; then
    printf 'Asset Trail source-count (%s) does not match manifest sources (%s)\n' "$metadata_count" "$manifest_count" >&2
    fail=1
  fi

  local required_paths=(
    "$manifest_path"
    "$ROOT/.readme-notebooklm/assets/notebooklm-report.md"
    "$ROOT/.readme-notebooklm/assets/notebooklm-mind-map.json"
    "$ROOT/.readme-notebooklm/assets/notebooklm-data-table.csv"
  )

  local missing=0
  for p in "${required_paths[@]}"; do
    if [[ ! -f "$p" ]]; then
      missing=1
      printf 'Expected NotebookLM asset missing: %s\n' "$p" >&2
    fi
  done

  if [[ "$missing" -ne 0 ]]; then
    fail=1
  fi
}

print_section "Marker validation"
for marker in notebooklm-report notebooklm-mindmap notebooklm-table notebooklm-metadata; do
  assert_marker "$marker"
done

if [[ "$MODE" == "skip-diff" ]]; then
  printf 'Mode is skip-diff; commit-diff checks disabled.\n'
  if (( fail != 0 )); then
    exit 1
  fi
  exit 0
fi

# Commit-range checks only run in CI or when explicitly called with base/HEAD.
if [[ -z "$BASE_COMMIT" ]]; then
  printf 'No BASE_COMMIT provided; skipping drift checks against changed files.\n'
  if (( fail != 0 )); then
    exit 1
  fi
  exit 0
fi

if ! git cat-file -e "$BASE_COMMIT"^{commit} 2>/dev/null; then
  printf 'Could not resolve BASE_COMMIT=%s; skipping drift checks.\n' "$BASE_COMMIT" >&2
  if (( fail != 0 )); then
    exit 1
  fi
  exit 0
fi

mapfile -t changed_files < <(git diff --name-only "$BASE_COMMIT" "$HEAD_COMMIT")
append_worktree_changes_if_needed "$HEAD_COMMIT"

if (( ${#changed_files[@]} == 0 )); then
  printf 'No changed files detected from %s to %s.\n' "$BASE_COMMIT" "$HEAD_COMMIT"
  if (( fail != 0 )); then
    exit 1
  fi
  exit 0
fi

print_section "Version-sensitive drift check"
version_signal=0
readme_changed=0
assets_changed=0

for changed in "${changed_files[@]}"; do
  [[ "$changed" == README.md ]] && readme_changed=1
  [[ "$changed" == .readme-notebooklm/* ]] && assets_changed=1

  if is_version_signal "$changed"; then
    version_signal=1
  fi
done

if (( version_signal == 1 )); then
  if (( readme_changed == 0 )); then
    printf 'Version/signals file changed but README.md was not updated in this change set.\n' >&2
    printf 'Please refresh README (with NotebookLM metadata) before merge:\n' >&2
    printf '  * Base: %s\n' "$BASE_COMMIT" >&2
    printf '  * Head: %s\n' "$HEAD_COMMIT" >&2
    fail=1
  fi

  if grep -q -- "readme-gen:start:notebooklm" "$README_PATH" && (( assets_changed == 0 )) && [[ -d "$ROOT/.readme-notebooklm" ]]; then
    printf 'NotebookLM-backed README markers are present, but .readme-notebooklm assets were not updated.\n' >&2
    fail=1
  fi

  validate_notebook_metadata
fi

print_section "Result"
if (( fail != 0 )); then
  printf 'README continuity checks failed.\n' >&2
  exit 1
fi

printf 'README continuity checks passed.\n'
