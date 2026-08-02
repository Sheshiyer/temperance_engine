#!/usr/bin/env bash

# Sourced curl helpers that keep credentials and JSON payloads out of child
# process arguments. Callers retain ownership of TLS, timeout, and response
# flags; these helpers only provide process-private input channels.

omniroute_curl_bearer() {
  local key="$1"
  shift
  if [ -n "$key" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$key" | curl --config - "$@"
  else
    curl "$@"
  fi
}

omniroute_curl_payload() {
  local payload="$1"
  shift
  exec 3<<<"$payload"
  curl --data-binary @/dev/fd/3 "$@"
  exec 3<&-
}

omniroute_curl_bearer_payload() {
  local key="$1" payload="$2"
  shift 2
  exec 3<<<"$payload"
  printf 'header = "Authorization: Bearer %s"\n' "$key" | \
    curl --config - --data-binary @/dev/fd/3 "$@"
  exec 3<&-
}

omniroute_curl_csrf_payload() {
  local csrf="$1" payload="$2"
  shift 2
  exec 3<<<"$payload"
  printf 'header = "x-omniroute-csrf: %s"\n' "$csrf" | \
    curl --config - --data-binary @/dev/fd/3 "$@"
  exec 3<&-
}
