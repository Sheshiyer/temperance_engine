#!/usr/bin/env bash
# Generalized availability/quota reconciler for Temperance's governed OmniRoute
# combos. Supersedes scripts/omniroute-temperance-planner-quota.sh (now a
# deprecation shim that forwards here with --combo te-plan).
#
# The reconciler is policy-driven: package/router/omniroute-fallback-policy.json
# (schema temperance-fallback-v1) declares, for every governed combo, the BASE
# model list (including the original codex judges), per-slot substitute chains,
# anchors (never substituted), fusion judges, and tier metadata. Live state is
# compared against the DESIRED state computed from the policy plus live
# availability signals; a live combo that already matches the desired
# (substituted) state is valid, not drift.
#
# Availability model per provider slot, in precedence order:
#   a) manual-disable (HARD DOWN): provider isActive:false via GET
#      /api/providers, OR provider absent from `omniroute usage quota` while
#      >=1 other provider is present -> substitution mandatory, reason
#      "manual-disable".
#   b) remaining quota < threshold_percent -> substitute, reason "quota".
#   c) unknown/no data -> fail-open for priority combos (keep live state);
#      FAIL-CLOSED for fusion combos (verdict HOLD, no mutation, exit 3).
#
# Rules: restore hysteresis (a base model returns only when its provider is
# isActive:true AND remaining >= restore_hysteresis_percent); dedup (if two
# slots resolve to the same substitute, the later slot takes its next chain
# entry); judge independence (a fusion judge substitute must not equal any
# post-substitution panel model); fusion panel floor (>= max(minPanel,2)
# resolvable panel models after substitution, else HOLD); tier2 (bench) models
# may only land in trailing/chain-end positions -- a tier2 model in slot
# position 0 yields a "requires-probe" verdict (dry-run) or a HOLD (--apply).
#
# Mutations use full-body PUT /api/combos/:id (OmniRoute supports PUT; there is
# no PATCH), preserving the combo id and every untouched field. Every run that
# can mutate snapshots {settings, combos, catalog, policy, plan} to
# .omniroute-backups/omniroute-reconcile-<UTC>.json first -- including
# dry-runs. The global activeCombo is verified unchanged after any apply.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE_URL="${TEMPERANCE_OMNIROUTE_ADMIN_URL:-http://127.0.0.1:20128}"
BASE_URL="${BASE_URL%/}"
BACKUP_DIR="${TEMPERANCE_OMNIROUTE_BACKUP_DIR:-$REPO_ROOT/.omniroute-backups}"
ADMIN_SERVICE="OmniRoute Temperance Admin"
API_KEY_SERVICE="OmniRoute Temperance API Key"
STATE_DIR="${TEMPERANCE_STATE_DIR:-${HOME}/.temperance_engine}/state"
STATE_PATH="${TEMPERANCE_RECONCILE_STATE:-${STATE_DIR}/omniroute-reconcile.json}"
LEGACY_STATE_PATH="${TEMPERANCE_PLANNER_QUOTA_STATE:-${STATE_DIR}/omniroute-planner-quota.json}"
EVENTS_PATH="${TEMPERANCE_RECONCILE_EVENTS:-${STATE_DIR}/omniroute-reconcile-events.jsonl}"
SCHEMA_VERSION="temperance-reconcile-v1"
POLICY_PATH="${TEMPERANCE_FALLBACK_POLICY:-$REPO_ROOT/package/router/omniroute-fallback-policy.json}"
OMNIROUTE_BIN="${TEMPERANCE_OMNIROUTE_CLI:-omniroute}"
MODE="dry-run"
SCOPE=""
ROLLBACK_PATH=""
TIMER_ACTION=""
TIMER_INTERVAL="${TEMPERANCE_RECONCILE_INTERVAL:-900}"
THRESHOLD_OVERRIDE=""
LABEL="com.temperance.engine.reconcile"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
OLD_LABEL="com.temperance.engine.planner-quota"
OLD_PLIST_PATH="${HOME}/Library/LaunchAgents/${OLD_LABEL}.plist"
USER_SAFE="${USER:-$(id -un)}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/omniroute-temperance-reconcile.sh                  # authenticated dry-run (default)
  scripts/omniroute-temperance-reconcile.sh --status         # read-only availability + diff report
  scripts/omniroute-temperance-reconcile.sh --apply          # reconcile combos to the desired state
  scripts/omniroute-temperance-reconcile.sh --rollback FILE  # restore governed combos from a snapshot
  scripts/omniroute-temperance-reconcile.sh --combo NAME     # scope any mode to one combo
  scripts/omniroute-temperance-reconcile.sh --threshold-percent N
  scripts/omniroute-temperance-reconcile.sh --install-timer [--interval-seconds N]
  scripts/omniroute-temperance-reconcile.sh --uninstall-timer
  scripts/omniroute-temperance-reconcile.sh --timer-status

Policy: package/router/omniroute-fallback-policy.json (temperance-fallback-v1)
declares base models, anchors, per-slot substitute chains, fusion judges, and
tier metadata for every governed combo. Availability signals come from GET
/api/providers (manual-disable isActive:false) and `omniroute usage quota`
(hard-down when absent from a non-empty report; quota-down below the
threshold). Priority combos fail open on unknown data; fusion combos fail
closed (HOLD, exit 3). Restores require remaining >= threshold + hysteresis.
The script never changes OmniRoute's global activeCombo.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) MODE="apply" ;;
    --dry-run) MODE="dry-run" ;;
    --status) MODE="status" ;;
    --rollback) MODE="rollback"; shift; [ "$#" -ge 1 ] || { usage >&2; exit 2; }; ROLLBACK_PATH="$1" ;;
    --combo) shift; [ "$#" -ge 1 ] || { usage >&2; exit 2; }; SCOPE="$1" ;;
    --threshold-percent) shift; [ "$#" -ge 1 ] || { usage >&2; exit 2; }; THRESHOLD_OVERRIDE="$1" ;;
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

# ── Timer lifecycle (macOS LaunchAgent; independent of the reconcile path) ──
if [ -n "$TIMER_ACTION" ]; then
  domain="gui/$(id -u)"
  case "$TIMER_ACTION" in
    install)
      SELF_PATH="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
      mkdir -p "${HOME}/Library/LaunchAgents" "$STATE_DIR"
      # Migrate the legacy planner-quota timer: unload it and retire its plist.
      if launchctl print "$domain/$OLD_LABEL" >/dev/null 2>&1; then
        launchctl bootout "$domain/$OLD_LABEL" 2>/dev/null || true
        echo "Unloaded legacy timer $OLD_LABEL"
      fi
      if [ -f "$OLD_PLIST_PATH" ]; then
        mv "$OLD_PLIST_PATH" "$OLD_PLIST_PATH.removed.$(date +%Y%m%d-%H%M%S)"
        echo "Retired legacy plist: $OLD_PLIST_PATH -> .removed.$(date +%Y%m%d-%H%M%S)"
      fi
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
  <key>WorkingDirectory</key><string>${REPO_ROOT}</string>
  <key>StartInterval</key><integer>${TIMER_INTERVAL}</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>${STATE_DIR}/reconcile.log</string>
  <key>StandardErrorPath</key><string>${STATE_DIR}/reconcile.log</string>
</dict>
</plist>
EOF
      chmod 600 "$PLIST_PATH"
      launchctl bootout "$domain/$LABEL" 2>/dev/null || true
      launchctl bootstrap "$domain" "$PLIST_PATH"
      echo "Installed $LABEL at $PLIST_PATH (runs --apply every ${TIMER_INTERVAL}s)"
      exit 0
      ;;
    uninstall)
      launchctl bootout "$domain/$LABEL" 2>/dev/null || true
      if [ -f "$PLIST_PATH" ]; then
        mv "$PLIST_PATH" "$PLIST_PATH.removed.$(date +%Y%m%d-%H%M%S)"
      fi
      echo "Unloaded $LABEL; plist retained as a timestamped .removed file"
      exit 0
      ;;
    status)
      launchctl print "$domain/$LABEL" 2>/dev/null || { echo "$LABEL is not loaded"; exit 1; }
      exit 0
      ;;
  esac
fi

command -v security >/dev/null || { echo "macOS security CLI is required" >&2; exit 1; }
mkdir -p "$STATE_DIR" "$BACKUP_DIR"

if [ "$MODE" = "rollback" ]; then
  [ -f "$ROLLBACK_PATH" ] || { echo "rollback snapshot not found: $ROLLBACK_PATH" >&2; exit 1; }
fi

# ── Policy (schema temperance-fallback-v1; zero combo names hardcoded below) ──
[ -f "$POLICY_PATH" ] || { echo "fallback policy not found: $POLICY_PATH" >&2; exit 1; }
jq -e '.schema == "temperance-fallback-v1" and (.combos | type == "array") and (.threshold_percent | type == "number")' \
  "$POLICY_PATH" >/dev/null 2>&1 || { echo "fallback policy failed schema sanity check: $POLICY_PATH" >&2; exit 1; }
THRESHOLD_PERCENT="${THRESHOLD_OVERRIDE:-$(jq -r '.threshold_percent' "$POLICY_PATH")}"
HYSTERESIS_PERCENT="$(jq -r '.restore_hysteresis_percent // (.threshold_percent + 10)' "$POLICY_PATH")"

if [ -n "$SCOPE" ]; then
  jq -e --arg n "$SCOPE" '[.combos[] | select(.name == $n)] | length == 1' "$POLICY_PATH" >/dev/null \
    || { echo "combo not found in policy: $SCOPE" >&2; exit 2; }
fi

# ── Auth + live reads ──
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ADMIN_PASSWORD="$(security find-generic-password -a "$USER_SAFE" -s "$ADMIN_SERVICE" -w)"
INFERENCE_KEY="$(security find-generic-password -a "$USER_SAFE" -s "$API_KEY_SERVICE" -w)"

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

# ── Rollback: restore governed combos from a prior snapshot via full-body PUT ──
if [ "$MODE" = "rollback" ]; then
  settings="$(api_get /api/settings)"
  active_before="$(jq -c '.activeCombo // null' <<<"$settings")"
  [ "$active_before" = "null" ] || { echo "Refusing to proceed: global activeCombo is $active_before, expected null." >&2; exit 1; }
  old_combos="$(jq -c 'if (.combos | type) == "object" then .combos.combos else .combos end' "$ROLLBACK_PATH")"
  live_combos="$(api_get /api/combos)"
  names_json="$(jq -c --arg scope "$SCOPE" '[.combos[] | select($scope == "" or .name == $scope) | .name]' "$POLICY_PATH")"
  for name in $(jq -r '.[]' <<<"$names_json"); do
    snap_body="$(jq -c --arg n "$name" '([.[] | select(.name == $n)] | .[0]) // empty' <<<"$old_combos")"
    [ -n "$snap_body" ] || { echo "snapshot has no combo named $name; skipping" >&2; continue; }
    live_id="$(jq -r --arg n "$name" '([.combos[] | select(.name == $n)] | .[0].id) // empty' <<<"$live_combos")"
    [ -n "$live_id" ] || { echo "live combo not found: $name; skipping" >&2; continue; }
    body="$(jq -c --arg id "$live_id" '.id = $id' <<<"$snap_body")"
    api_mutate PUT "/api/combos/$live_id" "$body" >/dev/null
    printf 'Restored %s id=%s from %s\n' "$name" "$live_id" "$ROLLBACK_PATH"
  done
  active_after="$(jq -c '.activeCombo // null' <<<"$(api_get /api/settings)")"
  [ "$active_after" = "$active_before" ] || { echo "Global activeCombo changed unexpectedly: before=$active_before after=$active_after" >&2; exit 1; }
  jq -cn --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg file "$ROLLBACK_PATH" --arg scope "$SCOPE" \
    '{ts:$ts, event:"rollback", file:$file, scope:$scope}' >> "$EVENTS_PATH"
  printf 'Global activeCombo after: %s (unchanged)\n' "$active_after"
  exit 0
fi

# ── Live quota poll (read-only; disabled providers vanish from this report) ──
command -v "$OMNIROUTE_BIN" >/dev/null || { echo "omniroute CLI is required" >&2; exit 1; }
quota_json="$("$OMNIROUTE_BIN" --output json usage quota 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | sed -n '/^\[/,$p')"
echo "$quota_json" | jq -e 'type == "array"' >/dev/null 2>&1 || { echo "omniroute usage quota returned an unexpected shape" >&2; exit 1; }

settings="$(api_get /api/settings)"
combos="$(api_get /api/combos)"
providers="$(api_get /api/providers)"
catalog="$(curl -sS -f -H "Authorization: Bearer $INFERENCE_KEY" "$BASE_URL/v1/models")"

active_before="$(jq -c '.activeCombo // null' <<<"$settings")"
[ "$active_before" = "null" ] || { echo "Refusing to proceed: global activeCombo is $active_before, expected null." >&2; exit 1; }

# ── Desired-state planner (jq; policy-driven, no hardcoded combo names) ──
cat > "$TMP_DIR/plan.jq" <<'JQ'
def provider_of($m): ($m | split("/") | .[0]);

def conn_active($p):
  ([ $connections[] | select((.provider // .name // "") == $p) | .isActive ] | .[0]) // null;

def quota_entry($p):
  ([ $quota[] | select((.provider // "") == $p) ] | .[0]) // null;

# Availability classification, precedence: manual-disable > quota > unknown.
def classify($p):
  (conn_active($p)) as $a
  | (quota_entry($p)) as $q
  | (if $q == null then null else ($q.remaining // null) end) as $r
  | (if $q == null then null else ($q.state // null) end) as $s
  | if $a == false then
      {status:"hard_down", signal:"manual-disable", remaining:$r, state:$s, isActive:$a}
    elif ($q == null and ($quota | length) >= 1) then
      {status:"hard_down", signal:"manual-disable", remaining:$r, state:$s, isActive:$a}
    elif $q == null then
      {status:"unknown", signal:"unknown", remaining:null, state:null, isActive:$a}
    elif ($s != "available") then
      {status:"down_quota", signal:"quota", remaining:$r, state:$s, isActive:$a}
    elif ($r == null) then
      {status:"unknown", signal:"unknown", remaining:$r, state:$s, isActive:$a}
    elif (($r + 0) < $threshold) then
      {status:"down_quota", signal:"quota", remaining:$r, state:$s, isActive:$a}
    elif (($r + 0) < $hysteresis) then
      {status:"weak_up", signal:"quota", remaining:$r, state:$s, isActive:$a}
    else
      {status:"strong_up", signal:"quota", remaining:$r, state:$s, isActive:$a}
    end;

def resolvable($m; $fail_open):
  (classify(provider_of($m)).status) as $st
  | ($st == "strong_up" or $st == "weak_up" or ($fail_open and $st == "unknown"));

def tier_of($m):
  if ($policy.tiers.tier1.models | index($m)) != null then 1
  elif ($policy.tiers.tier2.models | index($m)) != null then 2
  else 1 end;

def resolve_slot($slot; $livem; $used; $bench; $fail_open):
  (provider_of($slot.model)) as $bp
  | (classify($bp)) as $bc
  | (($slot.substitutes // []) + $bench) as $chain
  | if $bc.status == "strong_up" then
      { model: $slot.model, base: $slot.model, tier: tier_of($slot.model),
        event: (if $livem == $slot.model then null else "restore" end),
        reason: (if $livem == $slot.model then null else "restore" end),
        from: (if $livem == $slot.model then null else $livem end) }
    elif ($bc.status == "weak_up" and $livem == $slot.model) then
      { model: $slot.model, base: $slot.model, tier: tier_of($slot.model), event: null,
        note: "hysteresis: provider \($bp) above threshold but below the restore watermark; base stays live" }
    elif ($bc.status == "unknown" and $fail_open) then
      { model: $livem, base: $slot.model, tier: tier_of($livem), event: null,
        note: "fail-open: provider \($bp) availability unknown; keeping live model" }
    elif $bc.status == "unknown" then
      { hold: "fail-closed: provider \($bp) availability unknown for guarded slot \($slot.model)" }
    else
      ([ $chain[] | . as $e | select(($used | index($e.model)) == null) | select(resolvable($e.model; $fail_open)) ]) as $cands
      | if ($cands | length) > 0 then
          ($cands[0]) as $pick
          | { model: $pick.model, base: $slot.model, tier: ($pick.tier // tier_of($pick.model)),
              event: (if $livem == $pick.model then null else "substitute" end),
              reason: $bc.signal,
              from: (if $livem == $pick.model then null else $livem end),
              note: (if $livem == $pick.model then "already substituted (valid live state)" else null end) }
        elif $fail_open then
          (if (([$slot.model] + [$chain[].model]) | index($livem)) != null then $livem else $slot.model end) as $keep
          | { model: $keep, base: $slot.model, tier: tier_of($keep), event: null,
              note: "no resolvable substitute for \($slot.model); fail-open keeping status quo" }
        else
          { hold: "fail-closed: no resolvable substitute for guarded slot \($slot.model)" }
        end
    end;

def resolve_judge($judge; $livej; $panel):
  (provider_of($judge.model)) as $jp
  | (classify($jp)) as $jc
  | ($judge.substitutes // []) as $chain
  | if $jc.status == "strong_up" then
      { model: $judge.model, base: $judge.model, tier: tier_of($judge.model),
        event: (if $livej == $judge.model then null else "restore" end),
        reason: (if $livej == $judge.model then null else "restore" end),
        from: (if $livej == $judge.model then null else $livej end) }
    elif ($jc.status == "weak_up" and $livej == $judge.model) then
      { model: $judge.model, base: $judge.model, tier: tier_of($judge.model), event: null,
        note: "hysteresis: judge provider \($jp) below the restore watermark; base stays live" }
    elif $jc.status == "unknown" then
      { hold: "fail-closed: judge provider \($jp) availability unknown" }
    else
      ([ $chain[] | . as $e | select(($panel | index($e.model)) == null) | select(resolvable($e.model; false)) ]) as $cands
      | if ($cands | length) > 0 then
          ($cands[0]) as $pick
          | { model: $pick.model, base: $judge.model, tier: ($pick.tier // tier_of($pick.model)),
              event: (if $livej == $pick.model then null else "substitute" end),
              reason: $jc.signal,
              from: (if $livej == $pick.model then null else $livej end),
              note: (if $livej == $pick.model then "already substituted (valid live state)" else null end) }
        else
          { hold: "fail-closed: no independent resolvable judge substitute for \($judge.model)" }
        end
    end;

def plan_combo($c):
  ([ $live[] | select(.name == $c.name) ] | .[0]) as $lc
  | if $lc == null then
      { name: $c.name, verdict: "hold", hold_reason: "combo \($c.name) not found live",
        live_models: [], desired_models: [], changed: false, substitutions: [] }
    else
    ([ $lc.models[].model ]) as $liveModels
    | ($lc.config.judgeModel // null) as $liveJudge
    | ($c.strategy // $lc.strategy // "priority") as $strategy
    | ($strategy == "fusion") as $is_fusion
    | ($is_fusion | not) as $fail_open
    | if ($c.monitor_only // false) then
        { name: $c.name, strategy: $strategy, monitor_only: true, verdict: "monitor",
          live_models: $liveModels, desired_models: $liveModels,
          live_judge: $liveJudge, desired_judge: $liveJudge, changed: false, substitutions: [],
          observed: [ $liveModels[] | { model: ., availability: classify(provider_of(.)) } ] }
      else
      (reduce range(0; ($c.slots | length)) as $i (
        { used: [], results: [], hold: null };
        ($c.slots[$i]) as $slot
        | ($liveModels[$i] // $slot.model) as $livem
        | if .hold != null then .
          elif (($slot.role // "guarded") == "anchor") then
            (classify(provider_of($slot.model))) as $ac
            | if ($is_fusion and $ac.status == "unknown") then
                .hold = "fail-closed: anchor provider \(provider_of($slot.model)) availability unknown"
              else
                .results += [{ model: $slot.model, base: $slot.model, role: "anchor", tier: tier_of($slot.model), event: null,
                               note: (if ($ac.status == "hard_down" or $ac.status == "down_quota")
                                      then "anchor provider \(provider_of($slot.model)) unavailable (\($ac.signal)); anchors are never substituted"
                                      else null end) }]
                | .used += [$slot.model]
              end
          else
            (resolve_slot($slot; $livem; .used; ($c.bench // []); $fail_open)) as $r
            | if (($r.hold // null) != null) then .hold = $r.hold
              else .results += [$r + {role: "guarded"}] | .used += [$r.model]
              end
          end
      )) as $sp
      | ([ $sp.results[].model ]) as $desiredPanel
      | (if (($sp.hold // null) == null and $is_fusion and (($c.judge // null) != null))
         then resolve_judge($c.judge; $liveJudge; $desiredPanel)
         else null end) as $judgePlan
      | (if (($judgePlan.hold // null) != null) then $judgePlan.hold else $sp.hold end) as $hold1
      | (if ($hold1 == null and $is_fusion) then
           ([ $desiredPanel[] | . as $m
              | select((classify(provider_of($m)).status == "strong_up") or (classify(provider_of($m)).status == "weak_up")) ]
            | length) as $resolvableCount
           | ((($c.minPanel // 2) + 0) as $mp | if $mp < 2 then 2 else $mp end) as $floor
           | if $resolvableCount < $floor
             then "fusion panel floor: only \($resolvableCount) resolvable panel models (< \($floor))"
             else null end
         else $hold1 end) as $hold2
      | (if ($hold2 == null and ($desiredPanel | length) > 0 and (tier_of($desiredPanel[0]) == 2))
         then "requires-probe" else $hold2 end) as $verdictHold
      | ($judgePlan.model // $liveJudge) as $desiredJudge
      | (($desiredPanel != $liveModels) or ($is_fusion and ($desiredJudge != $liveJudge))) as $changed
      | { name: $c.name, strategy: $strategy, monitor_only: false,
          verdict: (if $verdictHold == "requires-probe" then "requires-probe"
                    elif $verdictHold != null then "hold"
                    elif $changed then "reconcile"
                    else "ok" end),
          hold_reason: (if $verdictHold == "requires-probe"
                        then "tier2 model \($desiredPanel[0]) would land in slot position 0; probe required before promotion"
                        else $verdictHold end),
          live_models: $liveModels,
          desired_models: $desiredPanel,
          live_judge: $liveJudge,
          desired_judge: $desiredJudge,
          changed: $changed,
          slots: $sp.results,
          judge: $judgePlan,
          substitutions: ([ $sp.results[] | select((.event // null) != null)
                            | {slot: .base, from: .from, to: .model, reason: .reason, tier: .tier, event: .event} ]
                          + (if (($judgePlan.event // null) != null)
                             then [{slot: "judge", from: $judgePlan.from, to: $judgePlan.model,
                                    reason: $judgePlan.reason, tier: $judgePlan.tier, event: $judgePlan.event}]
                             else [] end)),
          active_substitutions: ([ $sp.results[] | select((.base // null) != null and .model != .base)
                                   | {slot: (.base | split("/") | .[0]), from: .base, to: .model,
                                      reason: (.reason // "unknown"), tier: .tier} ]
                                 + (if (($judgePlan.model // null) != null and ($judgePlan.base // null) != null
                                        and $judgePlan.model != $judgePlan.base)
                                    then [{slot: "judge", from: $judgePlan.base, to: $judgePlan.model,
                                           reason: ($judgePlan.reason // "unknown"), tier: $judgePlan.tier}]
                                    else [] end)) }
      end
    end;

($policy.combos | map(select($scope == "" or .name == $scope))) as $targets
| ([ $targets[] | plan_combo(.) ]) as $plans
| { threshold_percent: $threshold,
    restore_hysteresis_percent: $hysteresis,
    scope: $scope,
    providers: (([ $quota[].provider ] + [ $connections[] | (.provider // .name) ] | unique) as $ps
                | reduce $ps[] as $p ({}; .[$p] = classify($p))),
    combos: $plans,
    any_hold: ([ $plans[] | select(.verdict == "hold" or .verdict == "requires-probe") ] | length > 0) }
JQ

plan="$(jq -n \
  --argjson policy "$(cat "$POLICY_PATH")" \
  --argjson live "$(jq -c '.combos' <<<"$combos")" \
  --argjson connections "$(jq -c '.connections // []' <<<"$providers")" \
  --argjson quota "$quota_json" \
  --argjson threshold "$THRESHOLD_PERCENT" \
  --argjson hysteresis "$HYSTERESIS_PERCENT" \
  --arg scope "$SCOPE" \
  -f "$TMP_DIR/plan.jq")"

# ── State file (schema temperance-reconcile-v1; superset of planner-quota state) ──
CHECKED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -n \
  --arg schema "$SCHEMA_VERSION" \
  --arg checked_at "$CHECKED_AT" \
  --arg policy "${POLICY_PATH#"$REPO_ROOT"/}" \
  --argjson plan "$plan" \
  '{schema_version:$schema, checked_at:$checked_at,
    threshold_percent:$plan.threshold_percent,
    restore_hysteresis_percent:$plan.restore_hysteresis_percent,
    policy:$policy,
    providers:$plan.providers,
    combos:($plan.combos | map({key:.name, value:{strategy, monitor_only, verdict, hold_reason, live_models, desired_models, live_judge, desired_judge, changed, substitutions, active_substitutions}}) | from_entries)}
   + (([$plan.combos[] | select(.name == "te-plan")] | .[0]) as $tp
      | if $tp == null then {} else {desired_models:$tp.desired_models, substitutions:$tp.active_substitutions} end)' \
  > "$STATE_PATH"
chmod 600 "$STATE_PATH"

# Keep the legacy planner-quota state file fresh when te-plan is in scope, so
# package/router/temperance-workflows.ts resolveWorkflow("planner", ...) keeps
# reading live quota data from its expected path.
if jq -e '[.combos[] | select(.name == "te-plan")] | length > 0' <<<"$plan" >/dev/null; then
  jq -n \
    --arg schema "temperance-planner-quota-v1" \
    --arg checked_at "$CHECKED_AT" \
    --argjson threshold "$THRESHOLD_PERCENT" \
    --argjson plan "$plan" \
    '($plan.combos[] | select(.name == "te-plan")) as $tp
     | {schema_version:$schema, checked_at:$checked_at, threshold_percent:$threshold,
        providers:{github:{remaining:$plan.providers.github.remaining, state:($plan.providers.github.state // "unknown")},
                   codex:{remaining:$plan.providers.codex.remaining, state:($plan.providers.codex.state // "unknown")},
                   "kimi-coding-apikey":{remaining:$plan.providers["kimi-coding-apikey"].remaining, state:($plan.providers["kimi-coding-apikey"].state // "unknown")}},
        desired_models:$tp.desired_models, substitutions:$tp.active_substitutions,
        superseded_by:"omniroute-reconcile.json (temperance-reconcile-v1)"}' \
    > "$LEGACY_STATE_PATH"
  chmod 600 "$LEGACY_STATE_PATH"
fi

# ── Events (jsonl): run summary + per-change + holds ──
jq -cn \
  --arg ts "$CHECKED_AT" \
  --arg mode "$MODE" \
  --arg scope "$SCOPE" \
  --argjson plan "$plan" \
  '([{ts:$ts, event:"run", mode:$mode, scope:$scope,
      verdicts:($plan.combos | map({key:.name, value:.verdict}) | from_entries)}]
    + [$plan.combos[] | . as $c | .substitutions[]?
       | {ts:$ts, event:.event, combo:$c.name, slot:.slot, from:.from, to:.to, reason:.reason, tier:.tier}]
    + [$plan.combos[] | select(.verdict == "hold" or .verdict == "requires-probe")
       | {ts:$ts, event:.verdict, combo:.name, hold_reason:.hold_reason}])[]' \
  >> "$EVENTS_PATH"

# ── Report ──
jq -r '
  .combos[] |
  "== \(.name) (\(.strategy // "priority")) — verdict: \(.verdict) ==",
  (if .verdict == "monitor" then
     "  monitor-only; live: \(.live_models | tojson)",
     (.observed[]? | "    observed \(.model): \(.availability.status)\(if .availability.remaining != null then " (\(.availability.remaining)% \(.availability.state))" else "" end)")
   else
     "  live:    \(.live_models | tojson)",
     "  desired: \(.desired_models | tojson)",
     (if .strategy == "fusion" then
        "  judge:   \(.live_judge) -> \(.desired_judge)"
      else empty end),
     (.substitutions[]? | "  \(.event): \(.from) -> \(.to) [slot \(.slot); reason \(.reason); tier\(.tier)]"),
     (if .hold_reason != null then "  hold_reason: \(.hold_reason)" else empty end)
   end),
  ""
' <<<"$plan"

if [ "$MODE" = "status" ]; then
  jq . "$STATE_PATH"
  jq -e '.any_hold | not' <<<"$plan" >/dev/null && exit 0 || exit 3
fi

# ── Snapshot BEFORE any mutation (dry-run included) ──
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PATH="$BACKUP_DIR/omniroute-reconcile-$STAMP.json"
jq -n \
  --arg baseUrl "$BASE_URL" \
  --arg capturedAt "$STAMP" \
  --argjson settings "$settings" \
  --argjson combos "$combos" \
  --argjson catalog "$catalog" \
  --argjson policy "$(cat "$POLICY_PATH")" \
  --argjson plan "$plan" \
  '{schemaVersion:1,baseUrl:$baseUrl,capturedAt:$capturedAt,settings:$settings,combos:$combos,catalog:$catalog,policy:$policy,plan:$plan}' \
  > "$BACKUP_PATH"
printf 'Snapshot: %s\n' "$BACKUP_PATH"

if [ "$MODE" = "dry-run" ]; then
  printf '(dry-run; pass --apply to reconcile)\n'
  jq -e '.any_hold | not' <<<"$plan" >/dev/null && exit 0 || exit 3
fi

# ── Apply: full-body PUT only for combos whose desired state differs ──
for name in $(jq -r '.combos[] | select(.changed == true and .verdict == "reconcile") | .name' <<<"$plan"); do
  desired_models="$(jq -c --arg n "$name" '.combos[] | select(.name == $n) | .desired_models' <<<"$plan")"
  desired_judge="$(jq -c --arg n "$name" '.combos[] | select(.name == $n) | .desired_judge' <<<"$plan")"
  body="$(jq -c --arg n "$name" --argjson desired "$desired_models" --argjson judge "$desired_judge" '
    (.combos[] | select(.name == $n)) as $lc
    | $lc
    | .models = [ range(0; ($desired | length)) as $i
        | ($desired[$i]) as $m
        | (([ $lc.models[] | select(.model == $m) ] | .[0])
           // { id: ($lc.name + "-model-" + (($i + 1) | tostring) + "-"
                    + ($m | ascii_downcase | gsub("[^a-z0-9]+"; "-") | sub("^-"; "") | sub("-$"; ""))),
                kind: "model", model: $m, providerId: ($m | split("/") | .[0]), weight: 0 }) ]
    | if $judge != null then .config.judgeModel = $judge else . end
  ' <<<"$combos")"
  live_id="$(jq -r --arg n "$name" '.combos[] | select(.name == $n) | .id' <<<"$combos")"
  api_mutate PUT "/api/combos/$live_id" "$body" >/dev/null
  printf 'Reconciled %s id=%s\n' "$name" "$live_id"
  combos="$(api_get /api/combos)"
done

active_after="$(jq -c '.activeCombo // null' <<<"$(api_get /api/settings)")"
[ "$active_after" = "$active_before" ] || { echo "Global activeCombo changed unexpectedly: before=$active_before after=$active_after" >&2; exit 1; }
printf 'Global activeCombo after: %s (unchanged)\n' "$active_after"
printf 'Applied snapshot: %s (use --rollback %s to restore)\n' "$BACKUP_PATH" "$BACKUP_PATH"

jq -e '.any_hold | not' <<<"$plan" >/dev/null && exit 0 || exit 3
