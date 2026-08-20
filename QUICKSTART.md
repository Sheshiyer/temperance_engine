# Temperance Engine — Quick Start

Themed page: [docs/site/quickstart.html](docs/site/quickstart.html) · library: [docs/index.html](docs/index.html)

Multi-backend routing for AI coding agents.

## Member install (full glove)

```bash
cd temperance_engine
./install.sh --with-spine
./verify.sh
/gsd:doctor
# or: temperance-project-init --cwd . --check
```

`/gsd:*` binds the mode (no NOESIS quiz). A real picker only on a bare first prompt with no saved session/cwd mode. Then ChatGPT IAB (Claude/Codex) or print `http://127.0.0.1:5173` (Grok). Cursor uses the alwaysApply rule + `AGENTS.md`. See [docs/gsd-manifest-spine.md](docs/gsd-manifest-spine.md) and [docs/gsd-goal-handoff.md](docs/gsd-goal-handoff.md).

## Install (routing CLIs only)

```bash
cd temperance_engine
./scripts/wire-multi-backend.sh
```

This installs:
- `temperance-route` CLI to `~/.local/bin/`
- `temperance-dispatch` CLI for parallel comparison
- `temperance-batch` CLI for governed parallel task fleets
- `temperance-opencode` Keychain-backed OpenCode launcher
- `temperance-claude` allowlisted native OmniRoute Claude launcher
- OpenCode hooks with routing context
- Enrichment core with automatic task classification

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

For independent coding tasks, pin a model that has passed the exact client-wire
probe. Do not send a fleet portfolio merely because it appears in the catalog:

```json
[
  {"id":"tests","task":"Implement the routing tests.","backend":"omniroute","model":"<exact-probe-passing-non-sol-model>"},
  {"id":"docs","task":"Update the accepted runtime documentation.","backend":"omniroute","model":"<exact-probe-passing-non-sol-model>"}
]
```

```bash
temperance-batch --tasks tasks.json --concurrency 4 --worktree
```

`temperance-batch` owns parallel tasks, validation, receipts, and worktree
isolation for models that pass the Codex Responses/tool wire. Spark is an
optional compatibility rail, not the exclusive default. A failed or truncated
non-Codex wire probe is never promoted or silently downgraded.

For governed native non-Codex audits, use an exact allowlisted OmniRoute
profile. Antigravity and GitHub Claude are separate provider families:

```bash
temperance-claude antigravity-claude-sonnet-5 -p "Audit architecture only; do not edit."
temperance-claude gh-claude-sonnet-5 -p "Audit rollback only; do not edit."
```

Both launchers read a dedicated inference key from macOS Keychain. Sol-family
models remain forbidden for worker dispatch.

## Task Types & Routing

| Task Type | Triggers | Model |
|-----------|----------|-------|
| `fast` | "quick", "simple", "minor" | see below |
| `long-horizon` | "refactor", "migrate", "entire" | see below |
| `reasoning` | "analyze", "debug", "explain" | see below |
| `validation` | "review", "verify", "audit" | see below |
| `creative` | "brainstorm", "explore" | see below |
| `inline` | "extract", "list" (no tools) | current session |

Type→model pins have exactly one source: `model_for_type` in
`package/router/classify-task.sh`, verified against the live command-code
catalog (`command-code --list-models`). Resolve any task with
`sh package/router/classify-task.sh "<task>"`. (2026-07-28: this table
previously carried a stale inline copy of the pins; removed per the
one-classifier doctrine.)

## Automatic Routing Context

Every prompt gets a `<temperance-context>` block with routing hints:

```xml
<temperance-context>
mode/tier: ALGORITHM / E3 | reason: multi-step request | source: classifier
intent: refactor the auth system | not: none
guardrails: ...
isa: /path/to/ISA.md
routing: backends=command-code,kimi,grok | task=long-horizon | preferred=command-code:moonshotai/Kimi-K2.7-Code
</temperance-context>
```

The agent sees the `routing:` line and knows which backend/model to use when delegating.

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

**Note:** command-code has higher latency due to its agentic execution model. For time-critical simple tasks, prefer `kimi` or `grok`.

## Check Status

```bash
./scripts/wire-multi-backend.sh --status
./scripts/omniroute-client-auth.sh verify
./scripts/omniroute-codex-preview.sh
./scripts/omniroute-hermes-preview.sh
bun scripts/omniroute-native-cli-readiness.ts
```

See [`docs/omniroute-native-integration.md`](docs/omniroute-native-integration.md)
for Context Settings, CLI Code/Agents, Hermes, Cloudflare Access, provider
topology semantics, local auth receipts, and remote promotion gates.
The preview commands are proposal/validation gates only: they do not replace
the governed Codex profiles or write a live Hermes configuration. The native
CLI readiness command compares six reviewed 3.8.48 source digests and markers
offline; it does not certify the full package and is not an authenticated
compression preview. MCP remains disabled
with dormant scope enforcement; A2A
remains disabled until its execution endpoint enforces governed credentials.

## Revert

```bash
./scripts/wire-multi-backend.sh --revert
```

All changes are symlinks with backups - fully reversible.
