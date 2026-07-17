#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  printf '%s\n' 'usage: capture-ec2-shadow-health.sh SESSION_ID before|after [RELEASE_DIR]' >&2
  exit 64
fi

SESSION_ID=$1
PHASE=$2
RELEASE_DIR=${3:-}
if [[ ! "$SESSION_ID" =~ ^[A-Za-z0-9._:-]+$ || ! "$PHASE" =~ ^(before|after)$ ]]; then
  printf '%s\n' 'unsafe proof identity' >&2
  exit 65
fi

unit_state() {
  local unit=$1
  local property=$2
  systemctl show "$unit" --property="$property" --value 2>/dev/null || true
}

GATEWAY_PATH=$(unit_state hermes-gateway.service FragmentPath)
RUNNER_PATH=$(unit_state hermes-runner.service FragmentPath)
TIMER_PATH=$(unit_state hermes-runner.timer FragmentPath)
GATEWAY_HASH=$(test -f "$GATEWAY_PATH" && sha256sum "$GATEWAY_PATH" | awk '{print "sha256:"$1}' || true)
RUNNER_HASH=$(test -f "$RUNNER_PATH" && sha256sum "$RUNNER_PATH" | awk '{print "sha256:"$1}' || true)
TIMER_HASH=$(test -f "$TIMER_PATH" && sha256sum "$TIMER_PATH" | awk '{print "sha256:"$1}' || true)
RELEASE_MANIFEST_HASH=$(test -n "$RELEASE_DIR" && test -f "$RELEASE_DIR/release-manifest.json" && sha256sum "$RELEASE_DIR/release-manifest.json" | awk '{print "sha256:"$1}' || true)
TEMPERANCE_UNIT_FILES=$(systemctl list-unit-files 'temperance*' --no-legend --no-pager 2>/dev/null | awk 'NF {count++} END {print count+0}')
PUBLIC_LISTENERS=$(ss -ltnH | awk '$4 !~ /^127\./ && $4 !~ /^\[::1\]/ {print $4}' | sort -u | paste -sd ',' -)
HAS_CURRENT_PATH=false
if [[ -e /opt/temperance-headless/current || -L /opt/temperance-headless/current ]]; then
  HAS_CURRENT_PATH=true
fi

jq -n \
  --arg schema 'thoughtseed.temperance.ec2_health_snapshot.v1' \
  --arg sessionId "$SESSION_ID" \
  --arg phase "$PHASE" \
  --arg capturedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg hostname "$(hostname)" \
  --arg gatewayActive "$(systemctl is-active hermes-gateway.service 2>/dev/null || true)" \
  --arg gatewayEnabled "$(systemctl is-enabled hermes-gateway.service 2>/dev/null || true)" \
  --arg gatewaySince "$(unit_state hermes-gateway.service ActiveEnterTimestamp)" \
  --arg gatewayUnitHash "$GATEWAY_HASH" \
  --arg runnerTimerActive "$(systemctl is-active hermes-runner.timer 2>/dev/null || true)" \
  --arg runnerTimerEnabled "$(systemctl is-enabled hermes-runner.timer 2>/dev/null || true)" \
  --arg runnerTimerSince "$(unit_state hermes-runner.timer ActiveEnterTimestamp)" \
  --arg runnerTimerHash "$TIMER_HASH" \
  --arg runnerResult "$(unit_state hermes-runner.service Result)" \
  --arg runnerExitStatus "$(unit_state hermes-runner.service ExecMainStatus)" \
  --arg runnerUnitHash "$RUNNER_HASH" \
  --arg releaseManifestHash "$RELEASE_MANIFEST_HASH" \
  --arg publicListeners "$PUBLIC_LISTENERS" \
  --argjson temperancePersistentUnitFiles "$TEMPERANCE_UNIT_FILES" \
  --argjson hasCurrentPath "$HAS_CURRENT_PATH" \
  '{
    schema: $schema,
    sessionId: $sessionId,
    phase: $phase,
    capturedAt: $capturedAt,
    hostname: $hostname,
    hermes: {
      gateway: {active: $gatewayActive, enabled: $gatewayEnabled, activeSince: $gatewaySince, unitHash: $gatewayUnitHash},
      runnerTimer: {active: $runnerTimerActive, enabled: $runnerTimerEnabled, activeSince: $runnerTimerSince, unitHash: $runnerTimerHash},
      runnerLast: {result: $runnerResult, exitStatus: $runnerExitStatus, unitHash: $runnerUnitHash}
    },
    temperance: {
      releaseManifestHash: $releaseManifestHash,
      persistentUnitFiles: $temperancePersistentUnitFiles,
      hasCurrentPath: $hasCurrentPath
    },
    network: {publicListeners: ($publicListeners | split(",") | map(select(length > 0)))}
  }'
