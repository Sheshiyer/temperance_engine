# Temperance Engine - Quick Start

Multi-backend routing for AI coding agents.

## Install

```bash
cd temperance_engine
./scripts/wire-multi-backend.sh
```

This installs:
- `temperance-route` CLI to `~/.local/bin/`
- `temperance-dispatch` CLI for parallel comparison
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

## Task Types & Routing

| Task Type | Triggers | Model |
|-----------|----------|-------|
| `fast` | "quick", "simple", "minor" | `deepseek/deepseek-v4-flash` |
| `long-horizon` | "refactor", "migrate", "entire" | `moonshotai/Kimi-K2.7-Code` |
| `reasoning` | "analyze", "debug", "explain" | `claude-fable-5` |
| `validation` | "review", "verify", "audit" | `google/gemini-3.5-flash` |
| `creative` | "brainstorm", "explore" | `claude-sonnet-5` |
| `inline` | "extract", "list" (no tools) | current session |

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
```

## Revert

```bash
./scripts/wire-multi-backend.sh --revert
```

All changes are symlinks with backups - fully reversible.
