#!/usr/bin/env bash
# Quota-aware reconciler for the te-plan combo's live OmniRoute model list.
#
# OmniRoute's own combo failover (`failoverBeforeRetry`) is REACTIVE: it only
# moves to the next priority tier after a request actually fails. It has no
# built-in strategy that means "prefer github/codex normally, but proactively
# switch to a specific backup once remaining quota drops below a threshold"
# (the closest native strategies are `headroom`, which always picks whoever
# has the most quota with no sticky primary preference, and `reset-aware`,
# which ranks by which quota window resets soonest -- neither matches this
# shape). Achieving the threshold-gated, sticky-primary behavior therefore
# requires Temperance to periodically recompute the desired model order and,
# when it differs from what's live, delete and recreate the te-plan combo
# (OmniRoute's API has no PATCH/update endpoint for an existing combo -- only
# create and delete, matching the pattern already used for rollback in
# scripts/omniroute-temperance-fleet.sh).
#
# Every mutation is snapshot-first and reversible via --rollback, matching the
# existing role-combo lifecycle script exactly. The default is a read-only
# dry-run; nothing is ever mutated without --apply.

set -euo pipefail

BASE_URL="${TEMPERANCE_OMNIROUTE_ADMIN_URL:-http://127.0.0.1:20128}"
BASE_URL="${BASE_URL%/}"
BACKUP_DIR="${TEMPERANCE_OMNIROUTE_BACKUP_DIR:-$PWD/.omniroute-backups}"
ADMIN_SERVICE="OmniRoute Temperance Admin"
API_KEY_SERVICE="OmniRoute Temperance API Key"
STATE_DIR="${TEMPERANCE_STATE_DIR:-${HOME}/.temperance_engine}/state"
STATE_PATH="${TEMPERANCE_PLANNER_QUOTA_STATE:-${STATE_DIR}/omniroute-planner-quota.json}"
SCHEMA_VERSION="temperance-planner-quota-v1"
COMBO_NAME="te-plan"
THRESHOLD_PERCENT="${TEMPERANCE_PLANNER_QUOTA_THRESHOLD:-30}"
OMNIROUTE_BIN="${TEMPERANCE_OMNIROUTE_CLI:-omniroute}"
MODE="dry-run"
ROLLBACK_PATH=""
TIMER_ACTION=""
TIMER_INTERVAL="${TEMPERANCE_PLANNER_QUOTA_INTERVAL:-900}"
LABEL="com.temperance.engine.planner-quota"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"

# Guarded slots: which combo model position substitutes to kimi-k3 when its
# own connection's live remaining% drops below THRESHOLD_PERCENT. Each slot's
# provider id must match a `provider` field in `omniroute usage quota` output.
declare -A SLOT_MODEL=( [github]="github/gpt-5.4" [codex]="codex/gpt-5.6-sol-max" )
FALLBACK_MODEL="nebius/Qwen/Qwen3-235B-A22B-Instruct-2507"
KIMI_MODEL="kimi-coding-apikey/k3"
KIMI_PROVIDER="kimi-coding-apikey"

usage() {
  cat <<'USAGE'
Usage:
  scripts/omniroute-temperance-planner-quota.sh                 # authenticated dry-run
  scripts/omniroute-temperance-planner-quota.sh --status         # read-only quota + diff report
  scripts/omniroute-temperance-planner-quota.sh --apply          # reconcile te-plan to the desired model order
  scripts/omniroute-temperance-planner-quota.sh --rollback FILE   # restore te-plan from a prior snapshot
  scripts/omniroute-temperance-planner-quota.sh --install-timer [--interval-seconds N]
  scripts/omniroute-temperance-planner-quota.sh --uninstall-timer
  scripts/omniroute-temperance-planner-quota.sh --timer-status

When github's or codex's live quota (via `omniroute usage quota`) drops below
--threshold-percent (default 30), that slot substitutes kimi-coding-apikey/k3
independently -- unless kimi's OWN remaining quota is also below the
threshold, in which case the original model is left in place (falling
through to OmniRoute's existing reactive failover to the Nebius fallback).
Substitutions never touch the Nebius fallback slot itself.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) MODE="apply" ;;
    --dry-run) MODE="dry-run" ;;
    --status) MODE="status" ;;
    --rollback) MODE="rollback"; shift; [ "$#" -ge 1 ] || { usage >&2; exit 2; }; ROLLBACK_PATH="$1" ;;
    --threshold-percent) shift; [ "$#" -ge 1 ] || { usage >&2; exit 2; }; THRESHOLD_PERCENT="$1" ;;
    --install-timer) TIMER_ACTION="install" ;;
    --uninstall-timer) TIMER_ACTION="uninstall" ;;
    --timer-status) TIMER_ACTION="status" ;;
    --interval-seconds) shift; [ "$#" -ge 1 ] || { usage >&2; exit 2; }; TIMER_INTERVAL="$1" ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

# ── Timer lifecycle (macOS LaunchAgent; independent of the auth/reconcile path below) ──
if [ -n "$TIMER_ACTION" ]; then
  case "$TIMER_ACTION" in
    install)
      command -v security >/dev/null || { echo "macOS security CLI is required" >&2; exit 1; }
      SELF_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
      mkdir -p "$(dirname "$PLIST_PATH")" "$STATE_DIR"
      if [ -f "$PLIST_PATH" ]; then
        cp -p "$PLIST_PATH" "$PLIST_PATH.bak.$(date +%Y%m%d-%H%M%S)"
      fi
      cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${SELF_PATH}</string>
    <string>--apply</string>
  </array>
  <key>WorkingDirectory</key><string>${HOME}</string>
  <key>StartInterval</key><integer>${TIMER_INTERVAL}</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>${STATE_DIR}/planner-quota.log</string>
  <key>StandardErrorPath</key><string>${STATE_DIR}/planner-quota.log</string>
</dict>
</plist>
EOF
      chmod 600 "$PLIST_PATH"
      domain="gui/$(id -u)"
      launchctl bootout "$domain/$LABEL" 2>/dev/null || true
      launchctl bootstrap "$domain" "$PLIST_PATH"
      echo "Installed $LABEL at $PLIST_PATH (runs --apply every ${TIMER_INTERVAL}s)"
      exit 0
      ;;
    uninstall)
      domain="gui/$(id -u)"
      launchctl bootout "$domain/$LABEL" 2>/dev/null || true
      if [ -f "$PLIST_PATH" ]; then
        mv "$PLIST_PATH" "$PLIST_PATH.removed.$(date +%Y%m%d-%H%M%S)"
      fi
      echo "Unloaded $LABEL; plist retained as a timestamped .removed file"
      exit 0
      ;;
    status)
      launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null || { echo "$LABEL is not loaded"; exit 1; }
      exit 0
      ;;
  esac
fi

mkdir -p "$STATE_DIR"
[ "$MODE" != "rollback" ] || [ -f "$ROLLBACK_PATH" ] || { echo "rollback snapshot not found: $ROLLBACK_PATH" >&2; exit 1; }

# ── Live quota poll (read-only; the sanctioned OmniRoute-owned data source) ──
command -v "$OMNIROUTE_BIN" >/dev/null || { echo "omniroute CLI is required" >&2; exit 1; }
quota_json="$("$OMNIROUTE_BIN" --output json usage quota 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | sed -n '/^\[/,$p')"
echo "$quota_json" | jq -e 'type == "array"' >/dev/null 2>&1 || { echo "omniroute usage quota returned an unexpected shape" >&2; exit 1; }

provider_remaining() { # $1 = provider id -> prints remaining percent, or empty if unknown
  jq -r --arg p "$1" '(.[] | select(.provider == $p) | .remaining) // empty' <<<"$quota_json"
}
provider_state() {
  jq -r --arg p "$1" '(.[] | select(.provider == $p) | .state) // "unknown"' <<<"$quota_json"
}
below_threshold() { # $1 = provider id -> "true"/"false"; unknown providers are treated as healthy (fail open, never trigger a switch on missing data)
  local remaining state
  remaining="$(provider_remaining "$1")"
  state="$(provider_state "$1")"
  if [ -z "$remaining" ]; then echo "false"; return; fi
  if [ "$state" != "available" ]; then echo "true"; return; fi
  awk -v r="$remaining" -v t="$THRESHOLD_PERCENT" 'BEGIN { print (r < t) ? "true" : "false" }'
}

kimi_ok="false"
[ "$(below_threshold "$KIMI_PROVIDER")" = "false" ] && kimi_ok="true"

desired_models=()
substitutions="[]"
seen_kimi="false"
for slot in github codex; do
  base_model="${SLOT_MODEL[$slot]}"
  if [ "$(below_threshold "$slot")" = "true" ] && [ "$kimi_ok" = "true" ]; then
    if [ "$seen_kimi" = "true" ]; then
      # Both slots triggered: dedupe rather than list kimi-k3 twice.
      continue
    fi
    desired_models+=("$KIMI_MODEL")
    seen_kimi="true"
    substitutions="$(jq -c --argjson subs "$substitutions" --arg slot "$slot" --arg from "$base_model" --arg to "$KIMI_MODEL" \
      --arg remaining "$(provider_remaining "$slot")" --arg threshold "$THRESHOLD_PERCENT" \
      '$subs + [{slot:$slot, from:$from, to:$to, reason:("remaining " + $remaining + "% < " + $threshold + "%")}]' <<<"null")"
  else
    desired_models+=("$base_model")
  fi
done
desired_models+=("$FALLBACK_MODEL")

desired_json="$(printf '%s\n' "${desired_models[@]}" | jq -R . | jq -sc .)"
providers_json="$(jq -nc \
  --arg gh_r "$(provider_remaining github)" --arg gh_s "$(provider_state github)" \
  --arg cx_r "$(provider_remaining codex)" --arg cx_s "$(provider_state codex)" \
  --arg km_r "$(provider_remaining "$KIMI_PROVIDER")" --arg km_s "$(provider_state "$KIMI_PROVIDER")" \
  --arg km_name "$KIMI_PROVIDER" \
  '{
    github: {remaining: ($gh_r | if . == "" then null else tonumber end), state: $gh_s},
    codex: {remaining: ($cx_r | if . == "" then null else tonumber end), state: $cx_s}
  } + {($km_name): {remaining: ($km_r | if . == "" then null else tonumber end), state: $km_s}}')"

write_state() {
  jq -n \
    --arg schema "$SCHEMA_VERSION" \
    --arg checked_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson threshold "$THRESHOLD_PERCENT" \
    --argjson providers "$providers_json" \
    --argjson desired_models "$desired_json" \
    --argjson substitutions "$substitutions" \
    '{schema_version:$schema, checked_at:$checked_at, threshold_percent:$threshold, providers:$providers, desired_models:$desired_models, substitutions:$substitutions}' \
    > "$STATE_PATH"
  chmod 600 "$STATE_PATH"
}
write_state

if [ "$MODE" = "status" ]; then
  jq . "$STATE_PATH"
  exit 0
fi

command -v security >/dev/null || { echo "macOS security CLI is required" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
ADMIN_PASSWORD="$(security find-generic-password -a "$USER" -s "$ADMIN_SERVICE" -w)"
login_http="$(curl -sS -o "$TMP_DIR/login.json" -w '%{http_code}' -c "$TMP_DIR/cookie" \
  -H 'content-type: application/json' \
  -d "$(jq -nc --arg password "$ADMIN_PASSWORD" '{password:$password}')" \
  "$BASE_URL/api/auth/login")"
case "$login_http" in 2*) ;; *) echo "OmniRoute admin login failed (HTTP $login_http)" >&2; exit 1 ;; esac
CSRF="$(curl -sS -f -b "$TMP_DIR/cookie" "$BASE_URL/api/auth/csrf" | jq -er '.token')"

api_get() { curl -sS -f -b "$TMP_DIR/cookie" "$BASE_URL$1"; }
api_mutate() {
  local method="$1" path="$2" payload="$3" response="$TMP_DIR/mutate.json" http
  http="$(curl -sS -o "$response" -w '%{http_code}' -X "$method" -b "$TMP_DIR/cookie" \
    -H 'origin: http://127.0.0.1:20128' -H 'referer: http://127.0.0.1:20128/dashboard' \
    -H 'content-type: application/json' -H "x-csrf-token: $CSRF" -d "$payload" "$BASE_URL$path")"
  case "$http" in 2*) cat "$response" ;; *) echo "OmniRoute mutation failed: $method $path (HTTP $http)" >&2; cat "$response" >&2; return 1 ;; esac
}

settings="$(api_get /api/settings)"
combos="$(api_get /api/combos)"
active_before="$(jq -c '.activeCombo // null' <<<"$settings")"

if [ "$MODE" = "rollback" ]; then
  restore_combo="$(jq -e --arg name "$COMBO_NAME" '.combos.combos[] | select(.name == $name)' "$ROLLBACK_PATH")"
  current_id="$(jq -r --arg name "$COMBO_NAME" '.combos[] | select(.name == $name) | .id' <<<"$combos")"
  [ -z "$current_id" ] || api_mutate DELETE "/api/combos/$current_id" '{}' >/dev/null
  recreate_payload="$(jq -c '{name, description, systemMessage, models: [.models[] | {model}], strategy, config}' <<<"$restore_combo")"
  response="$(api_mutate POST /api/combos "$recreate_payload")"
  printf 'Restored %s id=%s from %s\n' "$(jq -r .name <<<"$response")" "$(jq -r .id <<<"$response")" "$ROLLBACK_PATH"
  exit 0
fi

existing_combo="$(jq -c --arg name "$COMBO_NAME" '.combos[] | select(.name == $name)' <<<"$combos")"
[ -n "$existing_combo" ] || { echo "Combo not found: $COMBO_NAME (run scripts/omniroute-temperance-fleet.sh --apply first)" >&2; exit 1; }
live_models_json="$(jq -c '[.models[].model]' <<<"$existing_combo")"

if [ "$live_models_json" = "$desired_json" ]; then
  printf 'te-plan already matches the quota-aware desired order: %s\n' "$desired_json"
  exit 0
fi

printf 'te-plan model order differs.\n  live:    %s\n  desired: %s\n' "$live_models_json" "$desired_json"
if [ "$MODE" = "dry-run" ]; then
  printf 'Substitutions: %s\n' "$substitutions"
  printf '(dry-run; pass --apply to reconcile)\n'
  exit 0
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PATH="$BACKUP_DIR/omniroute-planner-quota-$STAMP.json"
jq -n --arg baseUrl "$BASE_URL" --arg capturedAt "$STAMP" \
  --argjson settings "$settings" --argjson combos "$combos" \
  '{schemaVersion:1,baseUrl:$baseUrl,capturedAt:$capturedAt,settings:$settings,combos:$combos}' \
  > "$BACKUP_PATH"

new_models_json="$(jq -c '[.[] | {model: .}]' <<<"$desired_json")"
recreate_payload="$(jq -c --argjson models "$new_models_json" \
  '{name, description, systemMessage, models: $models, strategy, config}' <<<"$existing_combo")"

api_mutate DELETE "/api/combos/$(jq -r .id <<<"$existing_combo")" '{}' >/dev/null
response="$(api_mutate POST /api/combos "$recreate_payload")"
printf 'Reconciled %s id=%s\n' "$(jq -r .name <<<"$response")" "$(jq -r .id <<<"$response")"

active_after="$(jq -c '.activeCombo // null' <<<"$(api_get /api/settings)")"
[ "$active_after" = "$active_before" ] || { echo "Global activeCombo changed unexpectedly" >&2; exit 1; }
printf 'Global activeCombo after: %s (unchanged)\n' "$active_after"
printf 'Substitutions applied: %s\n' "$substitutions"
printf 'Backup: %s (use --rollback %s to restore)\n' "$BACKUP_PATH" "$BACKUP_PATH"
