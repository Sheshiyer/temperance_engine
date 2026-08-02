#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUIDE="$ROOT_DIR/docs/omniroute-native-integration.md"

status=0
live_check_result="skipped"

pass() {
  printf 'ok - %s\n' "$1"
}

fail() {
  printf 'FAIL - %s\n' "$1"
  status=1
}

note() {
  printf 'SKIP - %s\n' "$1"
}

require_file() {
  if [ -f "$1" ]; then
    pass "$2"
  else
    fail "$2"
  fi
}

require_fixed() {
  if grep -Fq "$2" "$1"; then
    pass "$3"
  else
    fail "$3"
  fi
}

check_command_code_runtime_imports() {
  local target="$1"
  if [[ ! -f "$target" ]]; then
    printf '%s\n' 'command_code_helper_missing' >&2
    return 1
  fi
  if ! grep -Fxq \
    "import { resolveContextSources } from '../../enrich/contextSources';" "$target"; then
    printf '%s\n' 'command_code_resolver_runtime_import_missing' >&2
    return 1
  fi
  if ! grep -Fxq \
    "import { contextSources } from '../../enrich/stages/contextSources';" "$target"; then
    printf '%s\n' 'command_code_serializer_runtime_import_missing' >&2
    return 1
  fi
}

require_count() {
  count="$(grep -Fc "$2" "$1" || true)"
  if [ "$count" = "$3" ]; then
    pass "$4"
  else
    fail "$4: expected $3, got $count"
  fi
}

reject_bad_lines() {
  file="$1"
  description="$2"
  keep_pattern="$3"
  shift 3
  bad_lines=""
  for pattern in "$@"; do
    matches="$(grep -Ein "$pattern" "$file" || true)"
    if [ -n "$matches" ]; then
      if [ -n "$keep_pattern" ]; then
        matches="$(printf '%s\n' "$matches" | grep -Eiv "$keep_pattern" || true)"
      fi
      if [ -n "$matches" ]; then
        bad_lines="$bad_lines$matches"
      fi
    fi
  done
  if [ -n "$bad_lines" ]; then
    fail "$description"
  else
    pass "$description"
  fi
}

workflow_dispatch_excerpt() {
  awk '
    /^  "dispatch": \{/ {
      capture=1
    }
    capture {
      print
    }
    capture && /^  },$/ {
      exit
    }
  ' "$1"
}

fleet_dispatch_excerpt() {
  awk '
    /dispatch_payload=.*payload te-dispatch/ {
      capture=1
    }
    capture && /creative_payload=.*payload te-creative/ {
      exit
    }
    capture {
      print
    }
  ' "$1"
}

check_repository_contract() {
  workflow_contract="$ROOT_DIR/package/router/temperance-workflows.json"
  fleet_contract="$ROOT_DIR/scripts/omniroute-temperance-fleet.sh"
  spark_found=0
  round_robin_found=0

  for file in "$workflow_contract" "$fleet_contract"; do
    if [ ! -r "$file" ]; then
      fail "canonical te-dispatch contract is readable ($file)"
      continue
    fi
    pass "canonical te-dispatch contract is readable ($file)"
    case "$file" in
      *.json) excerpt="$(workflow_dispatch_excerpt "$file")" ;;
      *.sh) excerpt="$(fleet_dispatch_excerpt "$file")" ;;
      *) excerpt="" ;;
    esac
    if [ -z "$excerpt" ]; then
      fail "te-dispatch block is discoverable ($file)"
      continue
    fi
    pass "te-dispatch block is discoverable ($file)"
    if printf '%s' "$excerpt" | grep -Fq 'codex/gpt-5.3-codex-spark'; then
      spark_found=1
    fi
    if printf '%s' "$excerpt" | grep -Fq 'round-robin'; then
      round_robin_found=1
    fi
    if printf '%s' "$excerpt" | grep -Eiq '(^|[^[:alpha:]])sol([-/]|[^[:alpha:]]|$)'; then
      fail "repository te-dispatch contract is Sol-free ($file)"
    else
      pass "repository te-dispatch contract is Sol-free ($file)"
    fi
  done

  if [ "$spark_found" = 1 ]; then
    pass "repository te-dispatch contract includes Codex Spark"
  else
    fail "repository te-dispatch contract includes Codex Spark"
  fi
  if [ "$round_robin_found" = 1 ]; then
    pass "repository te-dispatch contract stays round-robin"
  else
    fail "repository te-dispatch contract stays round-robin"
  fi
}

check_live_db_contract() {
  db_path="${OMNIROUTE_DB_PATH:-$HOME/.omniroute/storage.sqlite}"

  if ! command -v sqlite3 >/dev/null 2>&1; then
    note "live OmniRoute DB inspection skipped: sqlite3 unavailable"
    return
  fi

  if [ ! -r "$db_path" ]; then
    note "live OmniRoute DB inspection skipped: $db_path unavailable"
    return
  fi

  if ! sqlite3 -readonly "$db_path" 'SELECT 1;' >/dev/null 2>&1; then
    note "live OmniRoute DB inspection skipped: read-only open failed"
    return
  fi

  combo_table="$(sqlite3 -readonly "$db_path" \
    "SELECT name FROM sqlite_master WHERE type='table' AND lower(name)='combos' LIMIT 1;" \
    2>/dev/null | tr -d '\r')"
  if [ -z "$combo_table" ]; then
    note "live OmniRoute DB inspection skipped: combos table not found"
    return
  fi

  columns="$(sqlite3 -readonly "$db_path" "PRAGMA table_info($combo_table);" 2>/dev/null | cut -d'|' -f2 || true)"
  if ! printf '%s\n' "$columns" | grep -Fxq 'name'; then
    note "live OmniRoute DB inspection skipped: combos.name column not found"
    return
  fi

  select_expr=""
  for column in name strategy models config description systemMessage data payload definition; do
    if printf '%s\n' "$columns" | grep -Fxq "$column"; then
      if [ -n "$select_expr" ]; then
        select_expr="$select_expr || ' ' || "
      fi
      select_expr="${select_expr}COALESCE(CAST($column AS TEXT),'')"
    fi
  done

  if [ -z "$select_expr" ]; then
    note "live OmniRoute DB inspection skipped: no readable te-dispatch text columns"
    return
  fi

  live_contract="$(sqlite3 -readonly "$db_path" \
    "SELECT $select_expr FROM $combo_table WHERE name='te-dispatch' LIMIT 1;" \
    2>/dev/null || true)"

  if [ -z "$live_contract" ]; then
    note "live OmniRoute DB inspection skipped: te-dispatch row not found"
    return
  fi

  if printf '%s' "$live_contract" | grep -Eiq '(^|[^[:alpha:]])sol([-/]|[^[:alpha:]]|$)'; then
    fail "live te-dispatch contract is Sol-free"
  else
    pass "live te-dispatch contract is Sol-free"
  fi

  if printf '%s' "$live_contract" | grep -Fq 'codex/gpt-5.3-codex-spark'; then
    pass "live te-dispatch contract includes Codex Spark"
    live_check_result="ran"
  else
    note "live OmniRoute DB inspection skipped: te-dispatch row lacks discoverable Spark text"
  fi
}

check_live_transport_contract() {
  state_path="${OMNIROUTE_QUICK_TUNNEL_STATE:-$HOME/.omniroute/cloudflared/quick-tunnel-state.json}"

  if [ -r "$state_path" ] && command -v jq >/dev/null 2>&1; then
    if jq -e '.status == "stopped" and .pid == null and ((.url // "") == "")' \
      "$state_path" >/dev/null 2>&1; then
      pass "optional live Quick Tunnel state is stopped and cleared"
    else
      fail "optional live Quick Tunnel state is stopped and cleared"
    fi
  else
    note "live Quick Tunnel state inspection skipped: state or jq unavailable"
  fi

  if ! command -v lsof >/dev/null 2>&1; then
    note "live OmniRoute listener inspection skipped: lsof unavailable"
    return
  fi

  listeners="$(lsof -nP -iTCP:20128 -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 {print $9}' || true)"
  if [ -z "$listeners" ]; then
    note "live OmniRoute listener inspection skipped: port 20128 is not listening"
    return
  fi
  if printf '%s\n' "$listeners" | grep -Ev '^(127\.0\.0\.1|\[::1\]):20128$' >/dev/null 2>&1; then
    fail "optional live OmniRoute listeners are loopback-only"
  else
    pass "optional live OmniRoute listeners are loopback-only"
  fi
}

require_file "$GUIDE" "guide exists"
require_file "$ROOT_DIR/package/router/omniroute-native-control-plane.ts" \
  "read-only native control-plane collector exists"
require_file "$ROOT_DIR/package/router/omniroute-native-control-plane.test.ts" \
  "native control-plane adversarial tests exist"
require_file "$ROOT_DIR/scripts/omniroute-native-status.ts" \
  "native control-plane status command exists"
require_file "$ROOT_DIR/package/router/omniroute-context-preview.ts" \
  "synthetic Context Settings qualifier core exists"
require_file "$ROOT_DIR/package/router/omniroute-context-preview.test.ts" \
  "Context Settings qualifier adversarial tests exist"
require_file "$ROOT_DIR/scripts/omniroute-context-preview.ts" \
  "Context Settings qualifier command exists"
require_file "$ROOT_DIR/package/router/omniroute-native-cli-readiness.ts" \
  "offline native CLI readiness inspector exists"
require_file "$ROOT_DIR/package/router/omniroute-native-cli-readiness.test.ts" \
  "offline native CLI readiness adversarial tests exist"
require_file "$ROOT_DIR/scripts/omniroute-native-cli-readiness.ts" \
  "offline native CLI readiness command exists"
CONTEXT_PREVIEW_CORE="$ROOT_DIR/package/router/omniroute-context-preview.ts"
CONTEXT_PREVIEW_CLI="$ROOT_DIR/scripts/omniroute-context-preview.ts"
if grep -Eq 'Bearer |oma_live_|--token-file|readStrictPreviewToken' \
  "$CONTEXT_PREVIEW_CORE" "$CONTEXT_PREVIEW_CLI"; then
  fail "Context Settings production qualifier contains a reusable credential path"
else
  pass "Context Settings production qualifier has zero credential transport"
fi
NATIVE_CLI_READINESS_CORE="$ROOT_DIR/package/router/omniroute-native-cli-readiness.ts"
NATIVE_CLI_READINESS_CLI="$ROOT_DIR/scripts/omniroute-native-cli-readiness.ts"
if grep -Eq 'Bun\.spawn|fetch\(|node:(net|http|https|tls)|child_process|Deno\.Command|new WebSocket|process\.env|keytar|find-generic-password' \
  "$NATIVE_CLI_READINESS_CORE" "$NATIVE_CLI_READINESS_CLI"; then
  fail "native CLI readiness production surface contains online or credential execution"
else
  pass "native CLI readiness production surface is offline static inspection"
fi
if grep -Eq '(packageIntegrityComplete|entrypointResolutionPinned|loadedModuleGraphVerified|consumerPromotionUseAuthorized|transportBound|replayAuthorized|promotionAuthorized): true' \
  "$NATIVE_CLI_READINESS_CORE" "$NATIVE_CLI_READINESS_CLI"; then
  fail "native CLI readiness nonclaims remain literal fail-closed constants"
else
  pass "native CLI readiness nonclaims remain literal fail-closed constants"
fi
READINESS_PRODUCTION_CONSUMERS="$(rg -l --glob '*.ts' --glob '!*.test.ts' \
  'from .*omniroute-native-cli-readiness' "$ROOT_DIR/package" "$ROOT_DIR/scripts" || true)"
if [ "$READINESS_PRODUCTION_CONSUMERS" = "$NATIVE_CLI_READINESS_CLI" ]; then
  pass "native CLI readiness has only its diagnostic CLI consumer"
else
  fail "native CLI readiness has only its diagnostic CLI consumer"
fi
require_file "$ROOT_DIR/package/enrich/contextSources.ts" \
  "client-owned pointer context-source resolver exists"
require_file "$ROOT_DIR/package/enrich/stages/contextSources.ts" \
  "pointer context-source serialization stage exists"
require_file "$ROOT_DIR/package/enrich/contextSources.test.ts" \
  "pointer context-source adversarial tests exist"
require_file "$ROOT_DIR/package/adapters/command-code/context-sources-line.ts" \
  "direct Command Code metadata-only pointer helper exists"
COMMAND_CODE_HELPER="$ROOT_DIR/package/adapters/command-code/context-sources-line.ts"
if check_command_code_runtime_imports "$COMMAND_CODE_HELPER"; then
  pass "direct Command Code helper has exact production runtime imports"
else
  fail "direct Command Code helper has exact production runtime imports"
fi

IMPORT_CONTROL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/temperance-import-control.XXXXXX")"
MUTATED_HELPER="$IMPORT_CONTROL_DIR/context-sources-line.ts"
MUTATED_ERROR="$IMPORT_CONTROL_DIR/mutated.err"
ABSENT_ERROR="$IMPORT_CONTROL_DIR/absent.err"
sed "s#from '../../enrich/contextSources'#from './fixture-contextSources'#" \
  "$COMMAND_CODE_HELPER" > "$MUTATED_HELPER"
if check_command_code_runtime_imports "$MUTATED_HELPER" 2> "$MUTATED_ERROR"; then
  fail "runtime-import gate rejects a substituted resolver"
elif grep -Fq 'command_code_resolver_runtime_import_missing' "$MUTATED_ERROR"; then
  pass "runtime-import gate rejects a substituted resolver"
else
  fail "runtime-import substitution control failed for another reason"
fi
if check_command_code_runtime_imports "$IMPORT_CONTROL_DIR/absent.ts" 2> "$ABSENT_ERROR"; then
  fail "runtime-import gate rejects an absent helper"
elif grep -Fq 'command_code_helper_missing' "$ABSENT_ERROR"; then
  pass "runtime-import gate rejects an absent helper"
else
  fail "runtime-import missing-file control failed for another reason"
fi
unlink "$MUTATED_HELPER"
unlink "$MUTATED_ERROR"
unlink "$ABSENT_ERROR"
rmdir "$IMPORT_CONTROL_DIR"
require_file "$ROOT_DIR/package/adapters/command-code/validate-agents-md.ts" \
  "direct Command Code exact-one validator exists"
require_fixed "$ROOT_DIR/package/adapters/command-code/generate-agents-md.sh" \
  'CONTEXT_SOURCES_HELPER=' \
  "actual Command Code shell renderer delegates pointer projection"
require_fixed "$ROOT_DIR/package/adapters/command-code/generate-agents-md.ts" \
  "surface: 'command-code'" \
  "documented Command Code renderer uses the explicit surface"
require_fixed "$ROOT_DIR/package/adapters/command-code/generate-agents-md.ts" \
  'renderCommandCodeContextSources' \
  "documented Command Code renderer emits the canonical pointer line"
require_fixed "$GUIDE" '| Surface | Policy / execution owner | Adopt status | Promotion gate |' \
  "guide exposes the required ownership matrix header"
require_fixed "$GUIDE" \
  'PAI, GSD, ISA, and skill clusters remain policy owners; Codex and Hermes own' \
  "guide states the exact architecture boundary"
require_fixed "$GUIDE" \
  'Dashboard/session login is separate from client API Bearer authentication.' \
  "guide separates dashboard auth from client API auth"
require_fixed "$GUIDE" \
  'A login redirect must never be treated as proof that `/v1` is protected.' \
  "guide rejects login-redirect-as-api-proof"
require_fixed "$GUIDE" '### Synthetic preview qualifier' \
  "guide documents the synthetic Context Settings qualifier"
require_fixed "$GUIDE" \
  'The qualifier accepts no prompt text, body path, stdin body, workspace file, or alternate' \
  "guide keeps Context Settings fixtures synthetic-only"
require_fixed "$GUIDE" \
  'This command never enables the master, selects an' \
  "guide keeps Context Settings promotion non-mutating"
require_fixed "$GUIDE" \
  'A scoped access token alone is not sufficient.' \
  "guide requires process-bound authentication before semantic preview"
require_fixed "$GUIDE" '### Offline native CLI readiness' \
  "guide documents separate offline native CLI readiness"
require_fixed "$GUIDE" \
  'It never imports or executes those' \
  "guide forbids installed token-loader execution"
require_fixed "$GUIDE" \
  'reviewed whole-file SHA-256' \
  "guide binds static verification to reviewed source digests"
require_fixed "$GUIDE" \
  'blockingCondition:"401 AUTH_001 unresolved"' \
  "guide keeps unresolved authorization machine-readable"
require_fixed "$GUIDE" \
  'packageIntegrityComplete:false' \
  "guide limits verification to the reviewed allowlist"
require_fixed "$GUIDE" \
  'instant-observation' \
  "guide forbids cached or replayed readiness evidence"
require_fixed "$GUIDE" \
  'No socket/PID' \
  "guide keeps dormant process-bound transport out of tree"
require_fixed "$GUIDE" \
  'GitHub skill discovery is discovery-only and must flow through `skill-index.json`' \
  "guide keeps GitHub skill discovery candidate-only"
require_fixed "$GUIDE" 'Quick Tunnel stays disabled.' \
  "guide keeps Quick Tunnel disabled"
require_fixed "$GUIDE" \
  'Global compression, custom system prompt, MCP execution, A2A execution, and' \
  "guide records the current unpromoted safety posture"
require_fixed "$GUIDE" \
  'Never use Sol for worker dispatch. Select an exact model and launcher from live' \
  "guide keeps Sol out of worker dispatch"
require_fixed "$GUIDE" \
  'External Codex workers ignore' \
  "guide defaults external Codex workers to user-config isolation"
require_fixed "$GUIDE" \
  'Every task packet is self-contained' \
  "guide requires self-contained external worker context"
require_fixed "$GUIDE" \
  'Permission hardening is scoped to those artifacts' \
  "guide avoids worker umask blast radius"
require_fixed "$GUIDE" \
  'Split adoption: native non-Codex Claude rails pass; Codex Responses members remain model-by-model gated.' \
  "guide gates te-dispatch by proven client-wire evidence"
require_fixed "$GUIDE" \
  'Spark remains a known compatibility rail, but it is' \
  "guide keeps Spark optional rather than exclusive"
require_fixed "$GUIDE" \
  'The command returns one short-lived, versioned document with exactly five' \
  "guide defines the five-layer native snapshot"
require_fixed "$GUIDE" \
  'without a dashboard session, admin key,' \
  "guide excludes management credentials from native observation"
require_fixed "$GUIDE" \
  'responses can include credential-bearing connection fields' \
  "guide forbids secret-bearing management payload retention"
require_fixed "$GUIDE" \
  '`promotionAuthorized: false`' \
  "guide keeps native snapshot non-authoritative"
require_fixed "$GUIDE" \
  'Live in-flight activity is' \
  "guide separates persisted activity from WebSocket telemetry"
require_fixed "$GUIDE" \
  'Collection requires exact database schema version `1`' \
  "guide binds the native snapshot to the database schema"
require_fixed "$GUIDE" \
  'The listener PID must hold the same' \
  "guide binds the runtime package and database identity"
require_fixed "$GUIDE" \
  'across workers and direct CLI fallbacks' \
  "guide excludes Sol aliases from every dispatch target"
require_fixed "$GUIDE" \
  'any process makes the result `unsafe`' \
  "guide joins Quick Tunnel state to local process evidence"
require_fixed "$GUIDE" \
  '`REQUIRE_API_KEY` resolves to `true`; anonymous and invalid-Bearer catalog' \
  "guide records mandatory local client authentication"
require_fixed "$GUIDE" \
  'Antigravity and' \
  "guide records verified native non-Codex provider diversity"
require_fixed "$GUIDE" \
  'remote promotion is' \
  "guide records the closed Cloudflare promotion gate"
require_fixed "$GUIDE" \
  'Cloudflare promotion is a two-phase transaction' \
  "guide defines transactional named-tunnel promotion"
require_fixed "$GUIDE" \
  '`prepare` cannot create DNS, start the connector, expose a public route, or' \
  "guide keeps prepare private and non-routable"
require_fixed "$GUIDE" \
  '`promote` requires a fresh, one-use approval receipt bound to the exact prepared' \
  "guide binds public promotion to fresh approval"
require_fixed "$GUIDE" \
  'Cloudflare credentials are external inputs, not manifest content.' \
  "guide keeps Cloudflare credentials outside manifests"
require_fixed "$GUIDE" \
  'Delete the exact owned DNS route, clean up tunnel connections, and poll until' \
  "guide records safe remote rollback ordering"
require_fixed "$GUIDE" \
  'Quick Tunnel is never a' \
  "guide forbids Quick Tunnel fallback"
require_fixed "$GUIDE" \
  'The injected preflight is a contract input, not authenticated Cloudflare' \
  "guide disclaims self-authenticating preflight evidence"
require_fixed "$GUIDE" \
  '`PROMOTION_STUCK_OPEN`, preserves Access and both credentials, returns nonzero,' \
  "guide preserves protection after failed DNS containment"
require_fixed "$GUIDE" \
  'They are not claimed by the current' \
  "guide separates mock canaries from staging proof"
require_fixed "$GUIDE" \
  'provided Ed25519 public key' \
  "guide records cryptographic approval verification"
require_fixed "$GUIDE" \
  'never treats a deterministic name as provenance' \
  "guide rejects same-name foreign recovery adoption"
require_fixed "$GUIDE" \
  '## Client-owned pointer Context Source bridge' \
  "guide documents the adopted pointer-only bridge"
require_fixed "$GUIDE" \
  'metadata and canonical-path operations only' \
  "guide keeps context-source resolution body-free"
require_fixed "$GUIDE" \
  'creates no Obsidian/Notion credential, MCP/A2A registration, Hermes file, Cloudflare' \
  "guide records the pointer bridge no-mutation boundary"
require_fixed "$GUIDE" \
  'direct Command Code AGENTS renderer' \
  "guide adopts direct Command Code without replacing its renderer policy"
require_fixed "$GUIDE" \
  'delegates only' \
  "guide limits Command Code adoption to pointer projection"

for surface in \
  'Cloudflare transport' \
  'Dashboard auth' \
  'Client API auth' \
  'Context Settings engines' \
  'Context Sources' \
  'CLI Code' \
  'CLI Agents and Hermes' \
  'MCP' \
  'A2A' \
  'GitHub skill discovery' \
  '`te-dispatch`' \
  'OBSERVE' \
  'THINK' \
  'PLAN' \
  'EXECUTE' \
  'VERIFY' \
  'LEARN' \
  'COMPLETE' \
  'GSD `.planning`' \
  '`ISA.md`' \
  '`skill-index.json`'
do
  require_count "$GUIDE" "| $surface |" 1 "matrix includes exactly one row for $surface"
done

reject_bad_lines "$GUIDE" \
  "guide does not recommend enabling Quick Tunnel" \
  'disabled' \
  'enable Quick Tunnel' 'Quick Tunnel enabled' 'promote Quick Tunnel' 'Quick Tunnel promoted'
reject_bad_lines "$GUIDE" \
  "guide does not recommend direct skill installation" \
  'never recommend direct installation' \
  'install directly' 'direct installation' 'direct install'
reject_bad_lines "$GUIDE" \
  "guide does not duplicate policy ownership onto OmniRoute" \
  '' \
  'OmniRoute owns PAI' 'OmniRoute owns GSD' 'OmniRoute owns ISA' 'OmniRoute owns skill'
reject_bad_lines "$GUIDE" \
  "guide does not assign ISA or planning ownership to Codex or Hermes" \
  '' \
  'Codex owns ISA' 'Hermes owns ISA' 'Codex owns GSD' 'Hermes owns GSD'

check_repository_contract
check_live_db_contract
check_live_transport_contract

if [ "$live_check_result" = "ran" ]; then
  pass "optional live OmniRoute inspection completed"
else
  note "optional live OmniRoute inspection remained non-blocking"
fi

exit "$status"
