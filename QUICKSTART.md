# Temperance Engine — Quick Start

Themed page: [docs/site/quickstart.html](docs/site/quickstart.html) · library: [docs/index.html](docs/index.html)

Temperance Engine gives multi-backend routing to AI agents that write code.
This file uses Simplified Technical English (STE). Refer to [docs/ste.md](docs/ste.md).

## Member install (full glove)

```bash
cd temperance_engine
./install.sh --with-spine
./verify.sh
/gsd:doctor
# or: temperance-project-init --cwd . --check
```

`/gsd:*` sets the mode. There is no NOESIS quiz.
A real picker shows only on a bare first prompt that has no saved session mode or cwd mode.
Then Claude and Codex open the ChatGPT IAB, and Grok prints `http://127.0.0.1:5173`.
Cursor uses the alwaysApply rule and `AGENTS.md`.
Refer to [docs/gsd-manifest-spine.md](docs/gsd-manifest-spine.md) and [docs/gsd-goal-handoff.md](docs/gsd-goal-handoff.md).

## Install (routing CLIs only)

```bash
cd temperance_engine
./scripts/wire-multi-backend.sh
```

The script installs these items:
- The `temperance-route` CLI in `~/.local/bin/`
- The `temperance-dispatch` CLI, which compares backends in parallel
- The `temperance-batch` CLI, which runs governed fleets of parallel tasks
- `temperance-opencode`, an OpenCode launcher that uses the macOS Keychain
- `temperance-claude`, an allowlisted native OmniRoute Claude launcher
- OpenCode hooks that add routing context
- The enrichment core, which classifies each task automatically

## CLI Commands

### Route a Task

```bash
# See recommended backend/model
temperance-route "implement authentication middleware"
# → Task type: balanced
# → Backend: command-code
# → Model: claude-sonnet-5

# Get JSON output
temperance-route --json "refactor the database layer"

# Generate execution command
temperance-route --command "quick fix: typo"

# Execute directly
temperance-route --execute "simple task"

# Force specific backend
temperance-route --backend kimi "long coding task"
```

### Compare Across Backends

```bash
# Run same task on multiple backends
temperance-dispatch "analyze architecture"

# Specify backends
temperance-dispatch --backends "kimi,grok" "implement feature"

# Use all available
temperance-dispatch --all "complex task"
```

### Run the Governed Fleet

For independent code tasks, pin a model that passed the exact client-wire probe.
Do not send a fleet portfolio only because it shows in the catalog.
This is an example of a tasks file:

```json
[
  {"id":"tests","task":"Implement the routing tests.","backend":"omniroute","model":"<exact-probe-passing-non-sol-model>"},
  {"id":"docs","task":"Update the accepted runtime documentation.","backend":"omniroute","model":"<exact-probe-passing-non-sol-model>"}
]
```

```bash
temperance-batch --tasks tasks.json --concurrency 4 --worktree
```

`temperance-batch` controls parallel tasks, validation, receipts, and worktree isolation.
It does this for models that pass the Codex Responses/tool wire.
Spark is an optional compatibility rail. Spark is not the only default.

If a non-Codex wire probe fails or stops early, Temperance does not promote that model.
Temperance also does not downgrade that model without a notice.

For a governed native audit with a non-Codex model, use an exact allowlisted OmniRoute profile.
Antigravity and GitHub Claude are two different provider families:

```bash
temperance-claude antigravity-claude-sonnet-5 -p "Audit architecture only; do not edit."
temperance-claude gh-claude-sonnet-5 -p "Audit rollback only; do not edit."
```

The two launchers read a dedicated inference key from the macOS Keychain.
Do not use Sol-family models for worker dispatch.

## Task Types & Routing

| Task Type | Triggers | Model |
|-----------|----------|-------|
| `fast` | "quick", "simple", "minor" | see below |
| `long-horizon` | "refactor", "migrate", "entire" | see below |
| `reasoning` | "analyze", "debug", "explain" | see below |
| `validation` | "review", "verify", "audit" | see below |
| `creative` | "brainstorm", "explore" | see below |
| `inline` | "extract", "list" (no tools) | current session |

The pins from task type to model have one source only.
The source is `model_for_type` in `package/router/classify-task.sh`.
These pins agree with the live command-code catalog (`command-code --list-models`).
To resolve a task, run `sh package/router/classify-task.sh "<task>"`.
On 2026-07-28, we removed an old copy of the pins from this table.
The one-classifier doctrine permits only one copy.

## Automatic Routing Context

Each prompt gets a `<temperance-context>` block with routing hints:

```xml
<temperance-context>
mode/tier: ALGORITHM / E3 | reason: multi-step request | source: classifier
intent: refactor the auth system | not: none
guardrails: ...
isa: /path/to/ISA.md
routing: backends=command-code,kimi,grok | task=long-horizon | preferred=command-code:moonshotai/Kimi-K2.7-Code
</temperance-context>
```

The agent reads the `routing:` line.
The line tells the agent which backend and model to use for a delegated task.

## Available Backends

| Backend | CLI | Models | Best For |
|---------|-----|--------|----------|
| **omniroute** | `temperance-batch`, `temperance-claude`, `temperance-opencode` | Exact probe-passing models and governed aliases | Authenticated heterogeneous execution |
| **command-code** | `command-code` | 35 models | Primary, versatile |
| **kimi** | `kimi` | K2.7 Code (262K) | Long-horizon coding |
| **grok** | `~/.grok/bin/grok` | grok-composer-2.5-fast | Fast iteration |

### Latency Characteristics

| Backend | Startup | Simple Task | Complex Task | Recommended Timeout |
|---------|---------|-------------|--------------|---------------------|
| `command-code` | ~10s | 15-20s | 30-120s | 180s |
| `kimi` | ~3s | 10-15s | 30-60s | 120s |
| `grok` | ~5s | 10-15s | 20-40s | 90s |

**Note:** command-code has a higher latency because it uses an agentic model of execution.
For a simple task that must complete quickly, use `kimi` or `grok`.

## Check Status

```bash
./scripts/wire-multi-backend.sh --status
./scripts/omniroute-client-auth.sh verify
./scripts/omniroute-codex-preview.sh
./scripts/omniroute-hermes-preview.sh
bun scripts/omniroute-native-cli-readiness.ts
```

Refer to [`docs/omniroute-native-integration.md`](docs/omniroute-native-integration.md) for these subjects:
- Context Settings
- CLI Code/Agents
- Hermes
- Cloudflare Access
- Provider topology semantics
- Local auth receipts
- Remote promotion gates

The preview commands are only gates for proposals and validation.
They do not replace the governed Codex profiles.
They do not write a live Hermes configuration.

The native CLI readiness command does an offline comparison of seven reviewed 3.8.51 source digests and markers.
It does not certify the full package.
It is not an authenticated compression preview.

MCP stays disabled, and its scope enforcement is dormant.
A2A stays disabled until its execution endpoint enforces governed credentials.

## Revert

```bash
./scripts/wire-multi-backend.sh --revert
```

Each change is a symlink with a backup. You can revert each change.
