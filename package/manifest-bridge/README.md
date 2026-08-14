# Temperance Manifest Bridge

Local-first event plane for the `manifest-skill-137` visual client.

It is intentionally additive: existing PAI hooks, project planning files, Temperance routing, and OmniRoute remain the sources of truth. The bridge normalizes safe projections into an append-only JSONL log, rebuilds a materialized state, and serves a snapshot plus Server-Sent Events.

## Run

```bash
cd /path/to/temperance_engine/package/manifest-bridge
bun test
bun run src/cli.ts init --cwd /path/to/project
bun run src/cli.ts sync --cwd /path/to/project
bun run src/cli.ts serve --all

# Or install the supervised, loopback-only service (recommended for PAI hooks):
cd /path/to/temperance_engine
bash scripts/temperance-manifest-bridge-launchd.sh install
bash scripts/temperance-manifest-bridge-launchd.sh status

# In a second terminal:
cd /path/to/manifest-skill-137/visual-pcb
VITE_MANIFEST_BRIDGE_URL=http://127.0.0.1:8766 npm run dev -- --host 127.0.0.1
```

The visual client is a separate repository on purpose. See
[../../docs/manifest-control-plane.md](../../docs/manifest-control-plane.md)
for the end-to-end ownership map and local setup.

The default local endpoints are:

- `GET http://127.0.0.1:8766/projects` — initialized and observed project registry
- `GET http://127.0.0.1:8766/snapshot?project_id=<id>` — one project projection
- `GET http://127.0.0.1:8766/snapshot?project_id=all` — aggregate projection
- `GET http://127.0.0.1:8766/events?project_id=<id>` — filtered initial snapshot and events
- `GET http://127.0.0.1:8766/events?project_id=all` — aggregate initial snapshot and events
- `POST http://127.0.0.1:8766/events` — normalized, redacted event ingestion
- `GET http://127.0.0.1:8766/health`

The append-only logs default to `~/.temperance_engine/state/manifest/projects/<project_id>/events.jsonl`. Legacy unscoped events remain at `events.jsonl`. Set `TEMPERANCE_MANIFEST_STATE_DIR` to override the host state root.

### Runtime ownership and visible receipts

The LaunchAgent `com.temperance.engine.manifest-bridge` is the only supported
long-running owner of port `127.0.0.1:8766`. It starts the bridge with
`--no-watch`: Algorithm activation and lifecycle hooks publish the event plane
directly, so installing the service does not scan or mutate every registered
project. The launchd definition starts with an empty environment (the bridge
does not need OmniRoute credentials), is reversible, and has a bounded health
check:

```bash
bash scripts/temperance-manifest-bridge-launchd.sh install
bash scripts/temperance-manifest-bridge-launchd.sh status
bash scripts/temperance-manifest-bridge-launchd.sh uninstall
```

### Doctor, debug snapshot, and safe traces

Use the doctor before blaming the visual console. It checks the state root,
activation policy, registry, active-run receipts, JSONL normalization and
project scope, bridge health, protected OmniRoute reachability, launchd, and
installed prompt-hook receipt wiring. It is read-only unless `--record` or
`--repair-duplicates` is explicit.

```bash
cd "$TEMPERANCE_ROOT/package/manifest-bridge"
bun run doctor --verbose
bun run doctor --json --record
bun run doctor --repair-duplicates # timestamped JSONL backup first
bun run debug --project-id <id> --limit 50

# Optional: restart under redacted request/event tracing, then inspect it.
cd "$TEMPERANCE_ROOT"
bash scripts/temperance-manifest-bridge-launchd.sh install --debug
bash scripts/temperance-manifest-bridge-launchd.sh logs 100
```

Debug traces include only method, path, status, duration, event kind, project
ID, acceptance, idempotency outcome, and error class. They never include request bodies, prompts,
tool output, headers, environment values, or evidence contents; the log rotates
at 1 MB to `bridge-debug.jsonl.1`.

After an Algorithm classifier result, the installed PromptProcessing adapters
append `<manifest-runtime>` to the same prompt context that contains
`<temperance-rail>`. It makes the bridge port, active run ID/project/enrollment,
and credential-free OmniRoute reachability explicit to both the PAI response
header and the Manifest event plane. `OFFLINE` is intentional truth, not a
fail-open claim: the durable activation remains local but live SSE cannot wake
until launchd restores the bridge.

### Visual console service

The bridge is an API/SSE server; browser requests to `http://127.0.0.1:8766`
redirect to the visual console at `http://127.0.0.1:5173`. Install the console
as its own supervised local service, then use either address in a browser:

```bash
cd "$TEMPERANCE_ROOT"
bash scripts/temperance-manifest-console-launchd.sh install
bash scripts/temperance-manifest-console-launchd.sh status
```

The console root defaults to
`~/.temperance_engine/integrations/manifest-skill-137/visual-pcb`; override it
with `MANIFEST_CONSOLE_ROOT` when the cluster is checked out elsewhere. The
doctor treats the console as required and reports `console-health` plus
`console-launchd` separately from the bridge checks.

## Algorithm-only activation policy

Manifest begins a project run only after PAI's classifier resolves
`MODE: ALGORITHM`. It then resolves the real Git worktree root, checks a
host-owned allowlist, and writes a bounded `algorithm.activated` event. Native,
Minimal, non-Git, and out-of-policy paths are intentionally silent.

Create `~/.temperance_engine/state/manifest/activation-policy.json` from
[`examples/activation-policy.json`](examples/activation-policy.json):

```json
{
  "schema": "temperance.manifest.activation-policy.v1",
  "enabled": true,
  "allowed_roots": ["/absolute/path/to/portfolio"]
}
```

An eligible repository without `.temperance/manifest.json` is projected as
**observed-only**; the hook does not create files in that repository. Use
`temperance-project-init --cwd <git-root>` only when the operator chooses to
enroll it. The active run receipt is keyed by session ID, so later lifecycle
events carry the same `run_id` and cannot leak between projects.

## Project lifecycle

`temperance-project-init --cwd <repo>` now registers the project identity as
`.temperance/manifest.json`. The direct bridge commands are:

```bash
bun run src/cli.ts init --cwd /path/to/project
bun run src/cli.ts sync --cwd /path/to/project
bun run src/cli.ts projects
```

Project IDs are deterministic from canonical paths, so two repositories with
the same basename cannot collide. A single host bridge owns `127.0.0.1:8766`;
projects never compete for ports.

`sync --cwd <repo>` is safe to repeat: watcher observations use stable IDs
derived from their source-file fingerprints. Human planner phase labels that
do not match the seven Algorithm phases remain in `phase_label` instead of
being rejected. A running bridge replays external project-log syncs on
snapshot reads and forwards newly observed events to matching SSE clients.

## Emit a fixture

```bash
printf '%s' '{"source":"manifest","kind":"demo.pulse","status":"synthetic","project_id":"demo","payload":{"message":"hello"}}' \
  | bun run src/cli.ts emit
```

Existing hooks can later call the fail-open summary adapter without sending raw prompts or tool output:

```bash
printf '%s' '{"hook_event_name":"PostToolUse","tool_name":"Agent","session_id":"s1","tool_input":{"description":"worker one"}}' \
  | bun run src/cli.ts hook --cwd /path/to/project
```

## Registered Claude hook

The active Claude settings register one additive async `PostToolUse` matcher for
`Agent` at `/Users/sheshnarayaniyer/.claude/hooks/ManifestEvent.hook.ts`. It
normalizes the bounded summary, POSTs it to `/events` when the bridge is live,
and falls back to the local JSONL file when the bridge is unavailable. Every
failure path exits successfully so agent execution is never coupled to the UI.

## Contract rules

- Secret-like keys are replaced with `[REDACTED]`.
- Strings, arrays, objects, and nesting are bounded.
- Malformed events return a failure result and do not crash the bridge.
- Duplicate event IDs are ignored.
- The bridge remains usable with no connected visual client.
- Synthetic events are explicitly marked and must never be presented as observed runtime truth.
- JSONL, snapshots, SSE, and the visual client are projection only. They do not
  grant approval, claim a dispatch, or start a worker.

## Visual-client handoff

`visual-pcb` loads `/snapshot`, subscribes to named `snapshot` and `manifest`
SSE events, and renders live/stale/offline provenance. It has no seeded runtime
state or simulation controls: empty telemetry stays visibly empty. Configure the
bridge with `VITE_MANIFEST_BRIDGE_URL`; no OmniRoute credentials are sent to the
UI.

## Optional swarm-control gate

The bridge can host the database-backed claim endpoint only when both
`TEMPERANCE_SWARM_CONTROL_ENABLED=1` and `TEMPERANCE_CONTROL_DATABASE_URL` are
set. Automatic launch remains separately disabled unless
`TEMPERANCE_SWARM_AUTOLAUNCH=1` is deliberately enabled by the controller.

Run PostgreSQL behavior tests only against an explicit disposable database:

```bash
TEMPERANCE_CONTROL_DATABASE_URL='postgresql://…' bun test
```

The remaining worker-receipt and terminal-closure release gates are tracked in
[../../docs/ORCHESTRATION-GAP-REGISTER.md](../../docs/ORCHESTRATION-GAP-REGISTER.md).
