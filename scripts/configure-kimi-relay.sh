#!/usr/bin/env bash
# Opt Kimi (kimi-cli by default; the desktop daimon runtime via the wrapper
# script) into the local Temperance automatic provider. Kimi configs are
# user/app-owned TOML, so instead of rewriting the file through a parser this
# script appends one marker-delimited managed block and (when needed) rewrites
# exactly one tagged line -- the user's file stays byte-identical outside the
# managed region, and disable restores it exactly.
#
# Kimi's hook runner cannot inject additionalContext, so enrichment for this
# surface happens in temperance-openai-proxy; the provider block tags requests
# with X-Temperance-Surface: kimi and the registered UserPromptSubmit hook
# maintains the cwd sidecar the relay reads. See package/adapters/kimi/README.md.

set -euo pipefail

KIMI_HOME="${KIMI_HOME:-${HOME}/.kimi}"
CONFIG_PATH="${TEMPERANCE_KIMI_CONFIG:-${KIMI_HOME}/config.toml}"
STATE_DIR="${TEMPERANCE_STATE_DIR:-${HOME}/.temperance_engine}/relay"
STATE_NAME="${TEMPERANCE_KIMI_STATE_NAME:-kimi-provider.json}"
STATE_PATH="${STATE_DIR}/${STATE_NAME}"
SCHEMA_VERSION="${TEMPERANCE_KIMI_SCHEMA:-temperance-kimi-relay-v1}"
BACKUP_ROOT="${TEMPERANCE_BACKUP_DIR:-${HOME}/.temperance_engine/backups}"
RELAY_BASE_URL="${TEMPERANCE_PROXY_BASE_URL:-http://127.0.0.1:20129/v1}"
DIRECT_BASE_URL="${TEMPERANCE_OMNIROUTE_BASE_URL:-http://127.0.0.1:20128/v1}"
PROVIDER_ID="temperance"
MODEL_KEY="temperance/temperance-auto"
MODEL_ID="temperance-auto"
HOOK_SOURCE="${TEMPERANCE_KIMI_HOOK_SOURCE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/package/adapters/kimi/UserPromptSubmit.hook.sh}"
HOOK_INSTALL_PATH="${TEMPERANCE_KIMI_HOOK_PATH:-${KIMI_HOME}/hooks/temperance-user-prompt-submit.sh}"
RECORD_SHA="${TEMPERANCE_KIMI_RECORD_SHA:-0}"
BLOCK_START="# --- temperance:managed:start (${SCHEMA_VERSION}) ---"
BLOCK_END="# --- temperance:managed:end ---"
HOOK_TAG="# temperance:managed-hook"
DEFAULT_TAG="# temperance:managed-default"

DRY_RUN=false
NO_HOOK=false
SET_DEFAULT=false
ACTION="enable"

for arg in "$@"; do
  case "$arg" in
    enable|--enable) ACTION="enable" ;;
    disable|--disable) ACTION="disable" ;;
    --dry-run) DRY_RUN=true ;;
    --no-hook) NO_HOOK=true ;;
    --set-default) SET_DEFAULT=true ;;
    -h|--help)
      cat <<'USAGE'
Usage: configure-kimi-relay.sh [enable|disable] [--dry-run] [--no-hook] [--set-default]

enable        Append the managed `temperance` provider block (relay :20129),
              register the Temperance UserPromptSubmit hook, and record a state
              marker. Never touches default_model unless --set-default.
disable       Remove the managed block, restore any rewritten lines exactly,
              remove the installed hook copy and the state marker.
--dry-run     Print the would-be changes without touching any file.
--no-hook     Skip hook installation/registration (provider lane only).
--set-default Also point default_model at the governed lane (recorded and
              restored on disable).
USAGE
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 127; }
[[ -f "$CONFIG_PATH" ]] || { echo "Kimi config not found: $CONFIG_PATH" >&2; exit 1; }

sha_file() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1;
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1;
  else echo ""; fi
}

validate_toml() {
  # Parse-or-die gate using bun's native TOML loader; skipped (with a warning)
  # only when bun is absent. The candidate is copied to a .toml suffix because
  # bun keys the loader off the extension.
  command -v bun >/dev/null 2>&1 || { echo "warning: bun not found; skipping TOML validation" >&2; return 0; }
  local candidate="$1" check
  check="$(mktemp "${TMPDIR:-/tmp}/temperance-kimi-check.XXXXXX")" || return 1
  mv "$check" "${check}.toml"; check="${check}.toml"
  cp "$candidate" "$check"
  if ! bun -e "await import('$check')" >/dev/null 2>&1; then
    rm -f "$check"
    echo "Refusing to write: candidate config is not valid TOML" >&2
    return 1
  fi
  rm -f "$check"
}

strip_managed_block() { # stdin -> stdout without the managed region
  awk -v start="$BLOCK_START" -v end="$BLOCK_END" '
    $0 == start { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
  '
}

# kimi-cli rewrites config.toml in its own canonical serialization on every
# run: semantic content survives, but comments -- including the managed-block
# markers -- do not. When our state marker says the temperance tables are ours,
# strip them by TABLE HEADER instead of by marker, plus any [[hooks]] entry
# whose command is our installed hook.
strip_semantic_tables() { # stdin -> stdout
  awk -v hook_path="$HOOK_INSTALL_PATH" '
    function is_our_header(line) {
      return line == "[providers.temperance]" \
        || line == "[providers.temperance.custom_headers]" \
        || line == "[models.\"temperance/temperance-auto\"]"
    }
    function flush_hooks(  i) {
      if (!ours) for (i = 0; i < nbuf; i++) print buf[i]
      nbuf = 0; ours = 0
    }
    /^\[\[hooks\]\][[:space:]]*$/ {
      if (inhooks) flush_hooks()
      inhooks = 1; nbuf = 0; ours = 0; buf[nbuf++] = $0; next
    }
    /^\[/ {
      if (inhooks) { flush_hooks(); inhooks = 0 }
      if (is_our_header($0)) { skip = 1; next }
      skip = 0; print; next
    }
    {
      if (inhooks) { buf[nbuf++] = $0; if (index($0, hook_path) > 0) ours = 1; next }
      if (!skip) print
    }
    END { if (inhooks) flush_hooks() }
  '
}

state_says_managed() {
  [[ -f "$STATE_PATH" ]] && jq -e '.managed == true' "$STATE_PATH" >/dev/null 2>&1
}

tmp_path="$(mktemp "${TMPDIR:-/tmp}/temperance-kimi.XXXXXX")"
cleanup() { rm -f "$tmp_path"; }
trap cleanup EXIT

if [[ "$ACTION" == enable ]]; then
  health="$(curl -fsS --connect-timeout 1 --max-time 3 "${RELAY_BASE_URL%/v1}/health" 2>/dev/null || true)"
  if [[ -z "$health" ]] || ! jq -e '.service == "temperance-openai-proxy" and .automatic_model == "temperance-auto" and ((.enrichment_surfaces // []) | index("kimi") != null)' <<<"$health" >/dev/null 2>&1; then
    echo "Temperance relay is not healthy (or lacks kimi enrichment) at ${RELAY_BASE_URL%/v1}; start/update it before enabling the Kimi lane." >&2
    exit 1
  fi

  strip_managed_block <"$CONFIG_PATH" >"$tmp_path"
  if state_says_managed; then
    # kimi may have normalized away our markers; the state marker proves the
    # temperance tables are ours, so strip them semantically before re-adding.
    strip_semantic_tables <"$tmp_path" >"${tmp_path}.sem" && mv "${tmp_path}.sem" "$tmp_path"
  fi

  # Never merge into user-authored tables: abort if a foreign temperance
  # provider/model remains after removing everything we manage.
  if grep -Eq '^\[providers\.temperance\]|^\[models\."temperance/' "$tmp_path"; then
    echo "Refusing to enable: a user-authored [providers.temperance] or temperance/* model exists in $CONFIG_PATH" >&2
    exit 1
  fi

  hook_mode="skipped"
  hooks_line_original=""
  previous_default_model=""
  # Re-enable inherits the recorded originals: the config already carries our
  # tagged rewrites, so re-capturing "originals" from it would clobber the
  # true pre-Temperance lines and break disable's exact restore.
  if [[ -f "$STATE_PATH" ]]; then
    hooks_line_original="$(jq -r '.hooks_line_original // empty' "$STATE_PATH" 2>/dev/null || true)"
    previous_default_model="$(jq -r '.previous_default_model // empty' "$STATE_PATH" 2>/dev/null || true)"
  fi
  hook_entry="{ event = \"UserPromptSubmit\", command = \"${HOOK_INSTALL_PATH}\", timeout = 10 }"
  if ! $NO_HOOK; then
    if grep -Fq "$HOOK_INSTALL_PATH" "$tmp_path"; then
      hook_mode="managed"
    elif grep -Eq '^hooks[[:space:]]*=[[:space:]]*\[\][[:space:]]*$' "$tmp_path"; then
      hooks_line_original="$(grep -E '^hooks[[:space:]]*=[[:space:]]*\[\][[:space:]]*$' "$tmp_path" | head -n1)"
      awk -v repl="hooks = [${hook_entry}]  ${HOOK_TAG}" '
        !done && $0 ~ /^hooks[[:space:]]*=[[:space:]]*\[\][[:space:]]*$/ { print repl; done = 1; next }
        { print }
      ' "$tmp_path" >"${tmp_path}.hooks" && mv "${tmp_path}.hooks" "$tmp_path"
      hook_mode="managed"
    elif grep -Eq '^hooks[[:space:]]*=' "$tmp_path"; then
      # A non-empty inline hooks array we do not own: appending [[hooks]] would
      # redefine the key, so leave registration to the user.
      hook_mode="manual"
      echo "note: existing hooks configuration detected; add this entry manually:" >&2
      echo "  ${hook_entry}" >&2
    else
      # No inline hooks key. Appending a [[hooks]] table is valid TOML even
      # when other [[hooks]] entries exist (array-of-tables extends).
      hook_mode="managed-block"
    fi
  fi

  if $SET_DEFAULT; then
    if grep -E '^default_model[[:space:]]*=' "$tmp_path" | head -n1 | grep -Fq "$DEFAULT_TAG"; then
      : # already managed; keep the inherited original
    elif grep -Eq '^default_model[[:space:]]*=' "$tmp_path"; then
      previous_default_model="$(grep -E '^default_model[[:space:]]*=' "$tmp_path" | head -n1)"
      awk -v repl="default_model = \"${MODEL_KEY}\"  ${DEFAULT_TAG}" '
        !done && $0 ~ /^default_model[[:space:]]*=/ { print repl; done = 1; next }
        { print }
      ' "$tmp_path" >"${tmp_path}.default" && mv "${tmp_path}.default" "$tmp_path"
    else
      echo "note: no default_model line found; --set-default skipped" >&2
    fi
  fi

  {
    echo "$BLOCK_START"
    echo "[providers.${PROVIDER_ID}]"
    echo "type = \"openai_legacy\""
    echo "base_url = \"${RELAY_BASE_URL}\""
    echo "# The relay injects the real OmniRoute key from the local keychain."
    echo "api_key = \"temperance-local\""
    echo ""
    echo "[providers.${PROVIDER_ID}.custom_headers]"
    echo "X-Temperance-Surface = \"kimi\""
    echo ""
    echo "[models.\"${MODEL_KEY}\"]"
    echo "provider = \"${PROVIDER_ID}\""
    echo "model = \"${MODEL_ID}\""
    echo "max_context_size = 200000"
    if [[ "$hook_mode" == "managed-block" ]]; then
      echo ""
      echo "[[hooks]]"
      echo "event = \"UserPromptSubmit\""
      echo "command = \"${HOOK_INSTALL_PATH}\""
      echo "timeout = 10"
    fi
    echo "$BLOCK_END"
  } >>"$tmp_path"

  validate_toml "$tmp_path"

  if $DRY_RUN; then
    echo "--- dry-run: managed block that would be appended to $CONFIG_PATH ---"
    awk -v start="$BLOCK_START" -v end="$BLOCK_END" '$0 == start { show = 1 } show { print } $0 == end { show = 0 }' "$tmp_path"
    [[ -n "$hooks_line_original" ]] && echo "--- hooks line would become: hooks = [${hook_entry}]  ${HOOK_TAG}"
    [[ -n "$previous_default_model" ]] && echo "--- default_model would become: ${MODEL_KEY}"
    [[ "$hook_mode" == "manual" ]] && echo "--- hook registration: manual (existing hooks config preserved)"
    exit 0
  fi

  if ! $NO_HOOK && [[ "$hook_mode" != "manual" ]]; then
    mkdir -p "$(dirname "$HOOK_INSTALL_PATH")"
    if [[ -f "$HOOK_INSTALL_PATH" ]] && ! cmp -s "$HOOK_SOURCE" "$HOOK_INSTALL_PATH"; then
      hook_backup="${BACKUP_ROOT}/$(date -u +%Y%m%dT%H%M%SZ)-$$/$(basename "$HOOK_INSTALL_PATH")"
      mkdir -p "$(dirname "$hook_backup")"
      cp -p "$HOOK_INSTALL_PATH" "$hook_backup"
    fi
    cp "$HOOK_SOURCE" "$HOOK_INSTALL_PATH"
    chmod 755 "$HOOK_INSTALL_PATH"
  fi

  backup_path="${BACKUP_ROOT}/$(date -u +%Y%m%dT%H%M%SZ)-$$/$(basename "$CONFIG_PATH")"
  mkdir -p "$(dirname "$backup_path")" "$STATE_DIR"
  chmod 700 "$(dirname "$backup_path")" 2>/dev/null || true
  cp -p "$CONFIG_PATH" "$backup_path"
  chmod 600 "$backup_path" 2>/dev/null || true
  mv "$tmp_path" "$CONFIG_PATH"
  trap - EXIT
  chmod 600 "$CONFIG_PATH"

  config_sha=""
  [[ "$RECORD_SHA" == "1" ]] && config_sha="$(sha_file "$CONFIG_PATH")"
  jq -n \
    --arg schema "$SCHEMA_VERSION" \
    --arg provider "$PROVIDER_ID" \
    --arg model "$MODEL_KEY" \
    --arg base "$RELAY_BASE_URL" \
    --arg hook "$hook_mode" \
    --arg hook_path "$HOOK_INSTALL_PATH" \
    --arg hooks_line_original "$hooks_line_original" \
    --arg previous_default_model "$previous_default_model" \
    --arg config_path "$CONFIG_PATH" \
    --arg config_sha256 "$config_sha" \
    '{schema_version:$schema,managed:true,provider:$provider,model:$model,base_url:$base,
      hook:$hook,hook_path:$hook_path,hooks_line_original:$hooks_line_original,
      previous_default_model:$previous_default_model,config_path:$config_path}
     + (if $config_sha256 == "" then {} else {config_sha256:$config_sha256} end)' >"$STATE_PATH"
  chmod 600 "$STATE_PATH"

  echo "Kimi relay configuration enabled: $CONFIG_PATH"
  echo "Backup: $backup_path"
  echo "Automatic model: ${MODEL_KEY} (relay ${RELAY_BASE_URL})"
  echo "Direct OmniRoute remains available at ${DIRECT_BASE_URL}"
  [[ "$hook_mode" == "manual" ]] && echo "Hook registration requires a manual edit (see note above)."
  exit 0
fi

# --- disable ---
if ! grep -Fq "$BLOCK_START" "$CONFIG_PATH" && [[ ! -f "$STATE_PATH" ]]; then
  echo "Nothing to disable: no managed block or state marker found."
  exit 0
fi
DISABLE_SEMANTIC=false
state_says_managed && DISABLE_SEMANTIC=true

hooks_line_original=""
previous_default_model=""
hook_path="$HOOK_INSTALL_PATH"
if [[ -f "$STATE_PATH" ]]; then
  hooks_line_original="$(jq -r '.hooks_line_original // empty' "$STATE_PATH" 2>/dev/null || true)"
  previous_default_model="$(jq -r '.previous_default_model // empty' "$STATE_PATH" 2>/dev/null || true)"
  hook_path="$(jq -r '.hook_path // empty' "$STATE_PATH" 2>/dev/null || echo "$HOOK_INSTALL_PATH")"
  [[ -n "$hook_path" ]] || hook_path="$HOOK_INSTALL_PATH"
fi

strip_managed_block <"$CONFIG_PATH" >"$tmp_path"
if $DISABLE_SEMANTIC; then
  # After a kimi config rewrite the markers are gone; remove our tables and
  # hook entry by header/content instead (HOOK_INSTALL_PATH may differ from the
  # recorded hook_path only if env changed between enable and disable).
  HOOK_INSTALL_PATH="$hook_path" strip_semantic_tables <"$tmp_path" >"${tmp_path}.sem" && mv "${tmp_path}.sem" "$tmp_path"
fi

if [[ -n "$hooks_line_original" ]]; then
  awk -v tag="$HOOK_TAG" -v repl="$hooks_line_original" '
    !done && index($0, tag) > 0 && $0 ~ /^hooks[[:space:]]*=/ { print repl; done = 1; next }
    { print }
  ' "$tmp_path" >"${tmp_path}.hooks" && mv "${tmp_path}.hooks" "$tmp_path"
fi
if [[ -n "$previous_default_model" ]]; then
  awk -v tag="$DEFAULT_TAG" -v repl="$previous_default_model" '
    !done && index($0, tag) > 0 && $0 ~ /^default_model[[:space:]]*=/ { print repl; done = 1; next }
    { print }
  ' "$tmp_path" >"${tmp_path}.default" && mv "${tmp_path}.default" "$tmp_path"
fi

validate_toml "$tmp_path"

if $DRY_RUN; then
  echo "--- dry-run: managed block would be removed from $CONFIG_PATH"
  [[ -n "$hooks_line_original" ]] && echo "--- hooks line would be restored to: $hooks_line_original"
  [[ -n "$previous_default_model" ]] && echo "--- default_model would be restored to: $previous_default_model"
  exit 0
fi

backup_path="${BACKUP_ROOT}/$(date -u +%Y%m%dT%H%M%SZ)-$$/$(basename "$CONFIG_PATH")"
mkdir -p "$(dirname "$backup_path")"
chmod 700 "$(dirname "$backup_path")" 2>/dev/null || true
cp -p "$CONFIG_PATH" "$backup_path"
chmod 600 "$backup_path" 2>/dev/null || true
mv "$tmp_path" "$CONFIG_PATH"
trap - EXIT
chmod 600 "$CONFIG_PATH"

[[ -f "$hook_path" ]] && rm -f "$hook_path"
rm -f "$STATE_PATH"

echo "Kimi relay configuration disabled: $CONFIG_PATH"
echo "Backup: $backup_path"
