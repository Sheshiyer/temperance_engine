#!/usr/bin/env bash

# Sourced curl helpers that keep credentials and JSON payloads out of child
# process arguments. Callers retain ownership of TLS, timeout, and response
# flags; these helpers only provide process-private input channels.

# Cloudflare Access service-token headers for a remote OmniRoute origin, as an
# extra `--config FILE` that every helper below (and omniroute_curl) passes to
# curl. Empty until omniroute_access_init loads a token.
OMNIROUTE_ACCESS_ARGS=()
OMNIROUTE_ACCESS_ID_SERVICE="OmniRoute Temperance Access Client ID"
OMNIROUTE_ACCESS_SECRET_SERVICE="OmniRoute Temperance Access Client Secret"

omniroute_origin_is_loopback() {
  local host="${1#*://}"
  host="${host%%/*}"
  case "$host" in
    \[*\]*) host="${host%%]*}]" ;;
    *) host="${host%%:*}" ;;
  esac
  case "$host" in
    127.0.0.1|localhost|\[::1\]) return 0 ;;
    *) return 1 ;;
  esac
}

# omniroute_access_init BASE_URL PRIVATE_DIR
# A loopback origin needs no Access token. For a remote origin, load the
# service token from TEMPERANCE_OMNIROUTE_ACCESS_CLIENT_ID/_SECRET or the macOS
# Keychain into a 0600 curl config in PRIVATE_DIR. Without a token, refuse
# (return 1) so the admin password is never sent to an unprotected public
# login. TEMPERANCE_OMNIROUTE_ALLOW_REMOTE_LOGIN_WITHOUT_ACCESS=1 is an explicit
# opt-out for an origin that a private network already protects.
omniroute_access_init() {
  local base_url="$1" private_dir="$2" user_safe="${USER:-$(id -un)}"
  local client_id="${TEMPERANCE_OMNIROUTE_ACCESS_CLIENT_ID:-}"
  local client_secret="${TEMPERANCE_OMNIROUTE_ACCESS_CLIENT_SECRET:-}"
  OMNIROUTE_ACCESS_ARGS=()
  omniroute_origin_is_loopback "$base_url" && return 0
  if [ -z "$client_id" ] && command -v security >/dev/null 2>&1; then
    client_id="$(security find-generic-password -a "$user_safe" -s "$OMNIROUTE_ACCESS_ID_SERVICE" -w 2>/dev/null || true)"
    client_secret="$(security find-generic-password -a "$user_safe" -s "$OMNIROUTE_ACCESS_SECRET_SERVICE" -w 2>/dev/null || true)"
  fi
  if [ -n "$client_id" ] && [ -n "$client_secret" ]; then
    local config="$private_dir/access.curlrc"
    ( umask 077 && printf 'header = "CF-Access-Client-Id: %s"\nheader = "CF-Access-Client-Secret: %s"\n' \
        "$client_id" "$client_secret" > "$config" )
    OMNIROUTE_ACCESS_ARGS=(--config "$config")
    return 0
  fi
  if [ "${TEMPERANCE_OMNIROUTE_ALLOW_REMOTE_LOGIN_WITHOUT_ACCESS:-0}" = 1 ]; then
    echo "warning: sending the OmniRoute admin login to $base_url without a Cloudflare Access token" >&2
    return 0
  fi
  cat >&2 <<EOF
Refusing to send the OmniRoute admin password to $base_url: no Cloudflare Access
service token is configured for this remote origin. Store one in the Keychain:
  security add-generic-password -U -a "\$USER" -s "$OMNIROUTE_ACCESS_ID_SERVICE" -w
  security add-generic-password -U -a "\$USER" -s "$OMNIROUTE_ACCESS_SECRET_SERVICE" -w
or set TEMPERANCE_OMNIROUTE_ACCESS_CLIENT_ID and TEMPERANCE_OMNIROUTE_ACCESS_CLIENT_SECRET.
See docs/te-memory-access.md.
EOF
  return 1
}

# omniroute_access_rejected HTTP_CODE: true when a remote login was stopped by
# Cloudflare Access (a redirect to its login page or a 403) rather than OmniRoute.
omniroute_access_rejected() {
  [ "${#OMNIROUTE_ACCESS_ARGS[@]}" -gt 0 ] || return 1
  case "$1" in 301|302|303|307|308|403) return 0 ;; *) return 1 ;; esac
}

omniroute_curl() {
  curl ${OMNIROUTE_ACCESS_ARGS[@]+"${OMNIROUTE_ACCESS_ARGS[@]}"} "$@"
}

omniroute_curl_bearer() {
  local key="$1"
  shift
  if [ -n "$key" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$key" | \
      curl ${OMNIROUTE_ACCESS_ARGS[@]+"${OMNIROUTE_ACCESS_ARGS[@]}"} --config - "$@"
  else
    omniroute_curl "$@"
  fi
}

omniroute_curl_payload() {
  local payload="$1"
  shift
  exec 3<<<"$payload"
  curl ${OMNIROUTE_ACCESS_ARGS[@]+"${OMNIROUTE_ACCESS_ARGS[@]}"} --data-binary @/dev/fd/3 "$@"
  exec 3<&-
}

omniroute_curl_bearer_payload() {
  local key="$1" payload="$2"
  shift 2
  exec 3<<<"$payload"
  printf 'header = "Authorization: Bearer %s"\n' "$key" | \
    curl ${OMNIROUTE_ACCESS_ARGS[@]+"${OMNIROUTE_ACCESS_ARGS[@]}"} --config - --data-binary @/dev/fd/3 "$@"
  exec 3<&-
}

omniroute_curl_csrf_payload() {
  local csrf="$1" payload="$2"
  shift 2
  exec 3<<<"$payload"
  printf 'header = "x-omniroute-csrf: %s"\n' "$csrf" | \
    curl ${OMNIROUTE_ACCESS_ARGS[@]+"${OMNIROUTE_ACCESS_ARGS[@]}"} --config - --data-binary @/dev/fd/3 "$@"
  exec 3<&-
}
