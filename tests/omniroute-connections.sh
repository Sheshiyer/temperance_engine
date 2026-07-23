#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$ROOT_DIR/tests/fixtures/omniroute-connections.json"
REPORT="$(TEMPERANCE_CONNECTIONS_FIXTURE="$FIXTURE" "$ROOT_DIR/scripts/omniroute-connections.sh" --json)"

jq -e '
  .schema_version == "temperance-omniroute-connections-v1"
  and .source == "fixture"
  and .read_only.writes == false
  and .read_only.credential_writes == false
  and .connections.active_count == 3
  and .catalog.advertised_count == 3
  and .catalog.unique_model_count == 2
  and .catalog.duplicate_count == 1
  and ([.connections.items[] | select(.provider == "command-code")][0].eligible == true)
  and ([.connections.items[] | select(.provider == "opencode")]|length) == 0
  and (.leverage.unmapped_providers == ["new-provider"])
  and (.leverage.degraded_providers == [])
  and (.safety.full_model_ids_emitted == false)
  and (.safety.credential_fields_emitted == false)
  and ((tostring | test("sk-fixture-secret|Bearer fixture-secret"; "i")) == false)
' <<< "$REPORT" >/dev/null

echo "ok - connection inventory fixture has stable redacted schema"
echo "ok - duplicate catalog aliases are counted and deterministically collapsed"
echo "ok - unknown providers are unmapped and not eligible"
echo "ok - fixture inventory does not emit credential material"
